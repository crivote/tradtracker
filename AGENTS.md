# AGENTS.md — tradtracker

Instrucciones para agentes de IA (OpenCode, Claude Code, etc.) operando en este repo.

**Última revisión: 2026-10-28.** Antes de esta fecha este fichero describía un proyecto que aún no existía. Si algo aquí contradice la spec, manda la spec.

## Repositorio

- **Forgejo:** https://git.crivote.dedyn.io/crivote/tradtracker
- **Remote local:** `forgejo` (origin principal). GitHub actúa como espejo de backup.
- **URL SSH:** `git@forgejo-tradtracker:crivote/tradtracker.git`
- **Clave privada:** `/home/victor/.ssh/forgejo_deploy_tradtracker` (deploy key con escritura, solo este repo, alias en `~/.ssh/config`).

```bash
git add -A
git commit -F <fichero>     # nunca -m con backticks/acentos: el shell los rompe
git push forgejo main
```

## Documento canónico

`/home/victor/docs-central/plans/tradtracker-especificacion-y-roadmap.md` (**v0.2.1**), en el repo `docs-central`, no en este. Este repo implementa; no decide producto.

## Stack

SolidJS + Vite + Tailwind + TypeScript · Supabase (auth, Postgres, Storage) · **Cloudflare** (Worker con assets estáticos, construido desde el espejo de GitHub — ver `DEPLOY.md`).
Dependencias ya elegidas en el andamio: `@sqlite.org/sqlite-wasm`, `abcjs`, `@supabase/supabase-js`, `@solidjs/router`, `lucide-solid`.

## Supabase

- **Proyecto propio:** `msysmkaqmefvyemzqftf`, región `eu-central-1`, plan free de la org `crivote's Org`.
- **Es hermano del de TradTube** (`kshrrvowxibjqhsvijgh`), no el mismo: sin joins y sin auth compartida.
- **Credenciales:** `~/secrets/tradtracker-db.txt` (contraseña y cadena de conexión) y `~/secrets/tradtracker-keys.txt` (URL, `ANON`, `SERVICE_ROLE`, publishable/secret). Permisos 600, fuera de git.
- **La `service_role`/`secret` nunca va al cliente ni al navegador.** En el front, solo `VITE_SUPABASE_ANON_KEY` (o la publishable).

### Auth (implementada 2026-10-28, issue #6)

- **Email + contraseña**, registro abierto, **sin verificación obligatoria**. El proyecto tiene
  `mailer_autoconfirm = true`: sin eso `signUp` devuelve usuario **sin sesión** y el registro no deja entrar.
  Se cambia con `PATCH /v1/projects/<ref>/config/auth`.
- **Recuperación de contraseña: FUERA DE ALCANCE por decisión del propietario** (2026-10-28). El SMTP por
  defecto del plan free entrega 2 correos/hora; no prometer el flujo hasta configurar SMTP propio.
- `site_url` del proyecto: `https://tradtracker.crivote.workers.dev`.
- Cliente en `src/lib/supabase.ts` (`persistSession` + `autoRefreshToken`, sin OAuth ni magic link); la
  sesión se expone por `src/lib/session.tsx`; el guard de rutas vive en `src/components/Layout.tsx`.
- **La Admin API (`/auth/v1/admin/users`) exige `apikey` Y `Authorization: Bearer` con la `service_role`
  legacy.** Con solo `apikey` responde `401 Invalid API key`, que se confunde con una credencial muerta.

## Decisiones de arquitectura vigentes (2026-10-28)

| # | Decisión |
|---|----------|
| D1 | Proyecto Supabase hermano. La única lectura cruzada son los **vídeos**, por PostgREST de TradTube con la anon key |
| D2 | Los favoritos de TradTube **no** se migran (13, y son de entrada de vídeo) |
| D3 | Multiusuario público desde v1, RLS completa desde el primer esquema |
| D4 | **Identidad propia**: `pr_tunes.id` uuid + `origin` + `origin_ref`. Sin esquema prefijado `ts:`/`loc:` |

## Esquema (migraciones `001`–`003`)

- **`pr_tunes`** — definición compartida del tune. `id uuid`, `origin` (por defecto `'thesession'`), `origin_ref` (id de TheSession), `name`, `rhythm`, `meter`, `key`, `abc`, `created_by`, `created_at`. Único `(origin, origin_ref)`.
  RLS: lectura para autenticados; alta/edición/borrado solo del creador.
- **`pr_repertoire`** — lo personal. `user_id`, `tune_id → pr_tunes`, overrides (`custom_title/rhythm/key/abc`), `status` (`nueva|aprendiendo|media|afianzada|aparcada`), `rating` 1–5, `image_path`, `notes`, marcas de tiempo. Único `(user_id, tune_id)`.
  RLS: `for all` con `user_id = auth.uid()`.
- Trigger `pr_repertoire_touch_trg`: actualiza `status_changed_at` cuando cambia `status`.
- **`002_repertoire_user_default.sql`** — `user_id` con `default auth.uid()`: el cliente inserta solo
  `tune_id` y la base decide el dueño (la RLS lo vuelve a comprobar). Sin esto el front tendría que enviar
  su propio uuid, que es un dato de confianza del navegador.
- **`003_seed_catalogue.sql`** — 12 tunes reales de TheSession (`origin_ref` = `tune_id` del catálogo),
  idempotente. Es semilla, no catálogo: el catálogo completo es el artefacto SQLite (issue #4).

Las tablas de sesiones, sets, links, settings y favoritos **no existen todavía**: llegan con sus fases (#10, #13, #14, #15).

### Cómo se aplican las migraciones

No hay `psql` ni CLI de Supabase instalados en el host. Dos vías, ambas válidas:

1. **API de gestión** (la usada el 2026-10-28): `POST https://api.supabase.com/v1/projects/<ref>/database/query` con `{"query": "<sql>"}` y `Authorization: Bearer $SUPABASE_PAT`. Una sentencia por llamada; los bloques `$$` hay que partirlos con cuidado.
2. Instalar el CLI (`supabase db push`) cuando convenga; requiere `supabase link` con el proyecto.

Las migraciones se escriben **idempotentes** (`if not exists`, `drop policy if exists`): se han de poder reaplicar sobre un proyecto a medias sin romper nada.

**Trampa medida (2026-10-28):** el endpoint acepta **una sentencia por llamada**, y hay que partir el
fichero por `;`. Quita los comentarios **antes** de partir: un `;` dentro de un comentario corta la
sentencia en dos y el resto del comentario se envía como SQL (`ERROR: 42601` señalando una línea que
parece válida). Los bloques `$$` también hay que respetarlos.

## Estado del código (2026-10-28)

- `src/lib/` — cliente Supabase, sesión, acceso a datos del repertorio y modelo puro de presentación; `catalogue.ts` (consulta FTS5 y orden) y `catalogue-db.ts` (apertura del artefacto con SQLite WASM).
- `src/routes/` — `Login`, `Repertoire` (colección, alta desde el catálogo local, baja) y `About` (procedencia y tamaño del catálogo).
- `src/components/Layout.tsx` — cabecera y guard de rutas.
- Pruebas: `npm run test:run` (Vitest). Typecheck: `npx tsc --noEmit -p tsconfig.json`.
- `catalogue-sql.test.ts` ejecuta las sentencias reales contra `public/thesession.db` con el SQLite nativo de Node (`node:sqlite`, cargado por `createRequire` porque Vite 5 no lo lista como builtin): es la suite que prueba los alias. Lo que no cruza es el transporte wasm, que se verifica en el navegador.

## Trampas conocidas de TradTube (medidas, no supuestas)

- **No existen** las tablas `media`, `media_tunes` ni `tunes`. Las reales son **`tune_media`** (270 filas: el vídeo) y **`tune_media_entries`** (533 filas: el segmento donde suena la tune).
- **`tune_id` es `integer`** en todo el esquema de TradTube. No hay IDs prefijados.
- Los vídeos solo existen para tunes de origen TheSession.
- Consulta de vídeos verificada con anon key (join embebido incluido):

```
GET https://kshrrvowxibjqhsvijgh.supabase.co/rest/v1/tune_media_entries
    ?select=id,tune_id,start_sec,end_sec,position,key,scale,bpm,instruments,tune_media!inner(media_uri,title,channel,unavailable)
    &tune_id=eq.<origin_ref>
```

- Respetar `hidden` (no mostrar) y `unavailable` (mostrar marcado).

## Catálogo de tunes

Artefacto SQLite client-side (`public/thesession.db`, 4,48 MB, **22.775 tunes**, FTS5 sobre `tunes_search`). Se copia del repo de TradTube; **no se edita aquí**. Columnas: `tune_id, name, type, meter, composer, tunebooks, popularity_score`. **No contiene ABC ni tonalidad** — ver decisión abierta A7 de la spec.

- **El `.db` SÍ se versiona** (excepción a la regla de ficheros grandes, abajo): el build de Cloudflare no tiene acceso a TradTube y el navegador lo descarga tal cual. 4,48 MB frente al límite de 25 MiB por asset de Workers.
- **Se regenera con `node scripts/fetch-catalogue.mjs [--source <ruta>]`** (por defecto lee `~/Proyectos/tradtube/public/thesession.db`): copia, mide e inspecciona el artefacto y escribe `public/thesession.meta.json` con fecha de copia, commit de TradTube, sha256 y recuentos. Ese sidecar es lo que muestra la vista «About»; **la cabecera de SQLite no tiene hueco de texto** para meterlo, y el catálogo no se edita.
- **Búsqueda (issue #4):** `src/lib/catalogue.ts` construye la expresión FTS5 y ordena; `src/lib/catalogue-db.ts` abre el artefacto con `sqlite3_deserialize` (sin OPFS ni COOP/COEP). Cada token se busca en `name` **y** en `aliases`, así que un título alternativo devuelve el `tune_id` correcto.
- **Alta desde el catálogo:** `ensureTune()` resuelve la fila de `pr_tunes` por `(origin='thesession', origin_ref=tune_id)` y solo la crea si no existe (23505 → relectura). El uuid de `pr_tunes` es interno; el id de TheSession vive en `origin_ref`.

## Convenciones

- Commits en español, concisos, uno por unidad lógica. Mensajes multi-línea siempre con `git commit -F`.
- **Nunca** commitear `.env`, `.env.local`, claves ni cadenas de conexión. `.gitignore` ya los cubre; verificar con `git status --porcelain` antes de `git add -A`.
- **La UI va en inglés** (producto público para la comunidad trad); código, comentarios y commits en español.
- No añadir ficheros grandes (`node_modules`, `dist`, capturas) al repo. **Única excepción: `public/thesession.db`**, el artefacto del catálogo (4,48 MB), porque el build no puede reconstruirlo y el navegador lo necesita (issue #4).
- Un frente por sesión: la fase se cierra y se valida antes de abrir la siguiente.
