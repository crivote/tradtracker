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

SolidJS + Vite + Tailwind + TypeScript · Supabase (auth, Postgres, Storage) · Netlify.
Dependencias ya elegidas en el andamio: `@sqlite.org/sqlite-wasm`, `abcjs`, `@supabase/supabase-js`, `@solidjs/router`, `lucide-solid`.

## Supabase

- **Proyecto propio:** `msysmkaqmefvyemzqftf`, región `eu-central-1`, plan free de la org `crivote's Org`.
- **Es hermano del de TradTube** (`kshrrvowxibjqhsvijgh`), no el mismo: sin joins y sin auth compartida.
- **Credenciales:** `~/secrets/tradtracker-db.txt` (contraseña y cadena de conexión) y `~/secrets/tradtracker-keys.txt` (URL, `ANON`, `SERVICE_ROLE`, publishable/secret). Permisos 600, fuera de git.
- **La `service_role`/`secret` nunca va al cliente ni al navegador.** En el front, solo `VITE_SUPABASE_ANON_KEY` (o la publishable).

## Decisiones de arquitectura vigentes (2026-10-28)

| # | Decisión |
|---|----------|
| D1 | Proyecto Supabase hermano. La única lectura cruzada son los **vídeos**, por PostgREST de TradTube con la anon key |
| D2 | Los favoritos de TradTube **no** se migran (13, y son de entrada de vídeo) |
| D3 | Multiusuario público desde v1, RLS completa desde el primer esquema |
| D4 | **Identidad propia**: `pr_tunes.id` uuid + `origin` + `origin_ref`. Sin esquema prefijado `ts:`/`loc:` |

## Esquema (migración `001_initial_schema.sql`)

- **`pr_tunes`** — definición compartida del tune. `id uuid`, `origin` (por defecto `'thesession'`), `origin_ref` (id de TheSession), `name`, `rhythm`, `meter`, `key`, `abc`, `created_by`, `created_at`. Único `(origin, origin_ref)`.
  RLS: lectura para autenticados; alta/edición/borrado solo del creador.
- **`pr_repertoire`** — lo personal. `user_id`, `tune_id → pr_tunes`, overrides (`custom_title/rhythm/key/abc`), `status` (`nueva|aprendiendo|media|afianzada|aparcada`), `rating` 1–5, `image_path`, `notes`, marcas de tiempo. Único `(user_id, tune_id)`.
  RLS: `for all` con `user_id = auth.uid()`.
- Trigger `pr_repertoire_touch_trg`: actualiza `status_changed_at` cuando cambia `status`.

Las tablas de sesiones, sets, links, settings y favoritos **no existen todavía**: llegan con sus fases (#10, #13, #14, #15, #6).

### Cómo se aplican las migraciones

No hay `psql` ni CLI de Supabase instalados en el host. Dos vías, ambas válidas:

1. **API de gestión** (la usada el 2026-10-28): `POST https://api.supabase.com/v1/projects/<ref>/database/query` con `{"query": "<sql>"}` y `Authorization: Bearer $SUPABASE_PAT`. Una sentencia por llamada; los bloques `$$` hay que partirlos con cuidado.
2. Instalar el CLI (`supabase db push`) cuando convenga; requiere `supabase link` con el proyecto.

Las migraciones se escriben **idempotentes** (`if not exists`, `drop policy if exists`): se han de poder reaplicar sobre un proyecto a medias sin romper nada.

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

Artefacto SQLite client-side (`public/thesession.db`, 4,7 MB, **22.775 tunes**, FTS5 sobre `tunes_search`). Se copia del repo de TradTube; **no se edita aquí**. Columnas: `tune_id, name, type, meter, composer, tunebooks, popularity_score`. **No contiene ABC ni tonalidad** — ver decisión abierta A7 de la spec.

## Convenciones

- Commits en español, concisos, uno por unidad lógica. Mensajes multi-línea siempre con `git commit -F`.
- **Nunca** commitear `.env`, `.env.local`, claves ni cadenas de conexión. `.gitignore` ya los cubre; verificar con `git status --porcelain` antes de `git add -A`.
- No añadir ficheros grandes (artefactos SQLite, `node_modules`, `dist`) al repo.
- Un frente por sesión: la fase se cierra y se valida antes de abrir la siguiente.
