# AGENTS.md — tradtracker

Instrucciones para agentes de IA (OpenCode, Claude Code, etc.) operando en este repo.

**Última revisión: 2026-11-10.** Si algo aquí contradice la spec, manda la spec; si contradice al código, este
fichero se ha quedado atrás y se corrige en el mismo corte. Las reglas de producto y las trampas medidas viven en
la skill `tradtracker`; aquí está lo que un agente necesita para no romper nada.

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

**Solo el push a `main` publica**: Forgejo espeja a GitHub y Netlify construye desde ahí. Una rama pusheada no
despliega nada, y el espejo no siempre cruza solo — compruébalo en el destino (`DEPLOY.md`).

## Documento canónico

`/home/victor/docs-central/plans/tradtracker-especificacion-y-roadmap.md` (**v0.3**), en el repo `docs-central`.
Este repo implementa; no decide producto.

## Stack

SolidJS + Vite 5 + Tailwind + TypeScript · Supabase (auth, Postgres, Storage) · **Netlify** como frontal público
(proyecto `tuneshed`, https://tuneshed.netlify.app), construido desde el espejo de GitHub — ver `DEPLOY.md`.
El Worker de Cloudflare se retiró el 2026-11-08: el par anycast que la zona tenía asignado está bloqueado por los
operadores españoles en cada ventana de partido. No lo reintroduzcas sin leer el porqué en la skill `tradtracker`.

Dependencias ya elegidas en el andamio: `@sqlite.org/sqlite-wasm`, `abcjs`, `@supabase/supabase-js`, `@solidjs/router`, `lucide-solid`.

## Pantallas

Ocho rutas; seis se pintan sobre **papel** (`repertoire.css` declara `--paper`, `--ink`… en `.repertoire-home`, y
`Layout` decide con `isPaper()` cuáles van a sangre). Una superficie nueva de papel se pinta con esas variables,
nunca con la paleta oscura del detalle.

| Ruta | Qué es |
|---|---|
| `/` | **Biblioteca**: cartas por banda (`shaky` → `mastered`), tres filas por banda, orden por abandono. Los recuentos de la cabecera son puertas. |
| `/learning` | **Banco de trabajo**: lista con dwell, ensayos, disparador de reproducción por fila y las tres salidas; tope configurable (6 por defecto). |
| `/level/:band` | **Listado**: tabla de consulta de un peldaño, del backlog (`to_learn`), del cajón (`shelved`) o de todo (`all`). Ahí vive el etiquetado en bloque. |
| `/practice` | Lista de ensayo del día. |
| `/history` | **Historial**: ensayos agrupados por día local, cifras del rango (7/30/90 días) y gráfica de barras con un carril por día. Solo lectura. |
| `/search` | Búsqueda sobre el repertorio (cruza peldaños y aparcadas). |
| `/repertoire/:id` | Detalle de la tune (paleta oscura, no papel). |
| `/about` | Procedencia y tamaño del catálogo. |

**Marcar un ensayo es un solo gesto en toda la app.** `PracticeMarkHost` (en `Layout`) monta un único popup en un
portal del `body`, con valoración opcional 1–5 en estrellas y una nota. Los disparadores están en el menú de la carta,
el botón del taller, el menú del listado, la ficha y el botón «Rate» de la lista del día. Los tres primeros pasan por
`store.practise`, que **abre el popup y no escribe**: la escritura vive en `logPractice`. Abierto desde la lista del
día, el popup lleva el `sessionId` de la lista y **actualiza** la línea de esa tune en vez de abrir otra sesión.

El alta de tunes es un **cajón lateral** (`src/components/AddTuneAside.tsx`) desde `/` y `/learning`: no empuja la
pantalla, y deja elegir el nivel antes de añadir. El import del tunebook de The Session vive plegado dentro.

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
- `site_url` del proyecto: `https://tuneshed.netlify.app`.
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

## Esquema (migraciones `001`–`016`)

- **`pr_tunes`** — definición compartida del tune. `id uuid`, `origin` (por defecto `'thesession'`), `origin_ref` (id de TheSession), `name`, `rhythm`, `meter`, `key`, `abc`, `composer` (010), `created_by`, `created_at`. Único `(origin, origin_ref)`.
  RLS: lectura para autenticados; alta/edición/borrado solo del creador.
- **`pr_repertoire`** — lo personal. `user_id`, `tune_id → pr_tunes`, overrides (`custom_title/rhythm/key/abc`), `status`, `rating`, `image_path`, `notes`, marcas de tiempo, `shelved` (006) y `favorite` (008). Único `(user_id, tune_id)`.
  - **`status` es una escalera de cinco peldaños**, no el enum viejo: `to_learn` (backlog, el valor por defecto),
    `learning`, `shaky` (011), `playing_along`, `solo_ready`, `mastered` (013). Lo impone el CHECK: `'aparcada'` y
    el vocabulario anterior devuelven **400**.
  - **`shelved` es una bandera transversal**, no un peldaño: una aparcada conserva su altura y sale de rotación.
  - **Doce columnas de imagen** (005, con `artic` añadido en 015): fuente, id, URLs, autor, licencia, encuadre
    (`focal_x`, `focal_y`, `zoom`) y fecha de elección.
  RLS: `for all` con `user_id = auth.uid()`.
- **`pr_repertoire_stats`** (007) — vista con `practice_count` y `avg_quality` por fila de repertorio, con
  `security_invoker = true`: sin esa opción la vista se salta la RLS y devuelve las filas de todos.
- **Sesiones** (004): `pr_sessions` y `pr_session_tunes` (`quality` opcional). La función `pr_recompute_last_practiced`
  (009) mantiene `last_practiced_at`, y el trigger `pr_session_tunes_touch_trg` la dispara. **Este modelo se
  retira** (decisión del dueño, 2026-11-13): la unidad pasa a ser la marca por tune y día (issue #56).
- **Transiciones del peldaño** (016): `pr_ladder_event` es un registro **append-only** de cada cambio de
  `status` y de `shelved` (`kind`, `from_value`, `to_value`, `at`, `source`). Lo escribe el trigger
  `pr_ladder_event_trg` sobre `pr_repertoire`: un `update` que no toca ninguno de los dos **no crea evento**.
  `source` (`ui`/`import`/`migration`/`backfill`) permite excluir escrituras masivas de las gráficas. El
  backfill dejó un evento por fila fechado en `status_changed_at`: **no es una transición**, es la última
  foto conocida, y leerlo como transición pinta 426 promociones el día del corte.
- **Etiquetas** (012): `pr_tag_facets`, `pr_tags` y `pr_user_tune_tags`, más `pr_tag_with_ancestors` para aplicar una
  faceta con sus hijos.
- Trigger `pr_repertoire_touch_trg`: mueve `status_changed_at` cuando cambia `status` — y **no** al aparcar.
- **`002_repertoire_user_default.sql`** — `user_id` con `default auth.uid()`: el cliente inserta solo
  `tune_id` y la base decide el dueño (la RLS lo vuelve a comprobar). Sin esto el front tendría que enviar
  su propio uuid, que es un dato de confianza del navegador.
- **`003_seed_catalogue.sql`** — 12 tunes reales de TheSession (`origin_ref` = `tune_id` del catálogo),
  idempotente. Es semilla, no catálogo: el catálogo completo es el artefacto SQLite (issue #4).

**Sets, links y settings no existen todavía** (fases #13/#14/#15): donde la UI los nombre, van deshabilitados con el
motivo escrito, nunca con una pantalla a medias.

### Cómo se aplican las migraciones

No hay `psql` ni CLI de Supabase instalados en el host. Dos vías, ambas válidas:

1. **API de gestión** (la usada el 2026-10-28): `POST https://api.supabase.com/v1/projects/<ref>/database/query` con `{"query": "<sql>"}` y `Authorization: Bearer $SUPABASE_PAT`. Una sentencia por llamada; los bloques `$$` hay que partirlos con cuidado.
2. Instalar el CLI (`supabase db push`) cuando convenga; requiere `supabase link` con el proyecto.

Trampa medida: el endpoint devuelve **`201` con cuerpo `[]`** en DDL, así que comparar contra `200` da un falso
negativo; y comprueba el cambio con un `select` al catálogo (`pg_get_constraintdef`), no con el código de estado.

Las migraciones se escriben **idempotentes** (`if not exists`, `drop policy if exists`): se han de poder reaplicar sobre un proyecto a medias sin romper nada.

**Trampa medida (2026-10-28):** el endpoint acepta **una sentencia por llamada**, y hay que partir el
fichero por `;`. Quita los comentarios **antes** de partir: un `;` dentro de un comentario corta la
sentencia en dos y el resto del comentario se envía como SQL (`ERROR: 42601` señalando una línea que
parece válida). Los bloques `$$` también hay que respetarlos.

## Estado del código (2026-11-10)

- `src/lib/` — cliente Supabase y sesión (`supabase.ts`, `session.tsx`); repertorio (`repertoire.ts` con el acceso a
  datos, `repertoire-model.ts` con el modelo **puro** —comparadores, bandas, escalera— y `repertoire-store.ts`, el
  estado compartido por las tres pantallas del repertorio); catálogo (`catalogue.ts` con la consulta FTS5 y el orden,
  `catalogue-db.ts` con la apertura del artefacto por SQLite WASM); práctica (`practice*.ts`); imágenes
  (`image-sources.ts` puro, `image-search.ts` de red); etiquetas (`tags.ts`, `tags-db.ts`); reproductor
  (`player-*.ts`, `abc*.ts`).
- `src/routes/` — `Repertoire` (biblioteca), `Learning` (banco de trabajo), `LevelList` (listado de un peldaño),
  `Practice` (lista del día), `History` (historial por días), `Search`, `TuneDetail`, `Login` y `About`.
- `src/components/` — `Layout` (armazón, guard de rutas y popup de ensayo), `TuneCard`, `PlayTrigger`, `PlayerDock`,
  `AddTuneAside`, `BackgroundPicker`, `PracticeMark` (popup de valoración), `PracticeChart` (barras del historial),
  `TagPicker`, `ImportFromSession`, `BrandMark`.
- Pruebas: `npm run test:run` (Vitest). Typecheck: `npx tsc --noEmit -p tsconfig.json`. Build: `npm run build`.
  **Mide la línea base antes de tu corte y verifica por la diferencia**: un recuento escrito aquí caduca.
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

Artefacto SQLite client-side (`public/thesession.db`, 4,9 MB, **23.448 tunes**, FTS5 sobre `tunes_search`). Se copia del repo de TradTube; **no se edita aquí**. Columnas: `tune_id, name, type, meter, composer, tunebooks, popularity_score`. **No contiene ABC ni tonalidad** — ver decisión abierta A7 de la spec.

- **El `.db` SÍ se versiona** (excepción a la regla de ficheros grandes, abajo): el build de Netlify no tiene acceso a TradTube y el navegador lo descarga tal cual. 4,9 MB, y se sirve con la caché larga de `public/_headers`.
- **Se regenera con `node scripts/fetch-catalogue.mjs [--source <ruta>]`** (por defecto lee `~/Proyectos/tradtube/public/thesession.db`): copia, mide e inspecciona el artefacto y escribe `public/thesession.meta.json` con fecha de copia, commit de TradTube, sha256 y recuentos. Ese sidecar es lo que muestra la vista «About»; **la cabecera de SQLite no tiene hueco de texto** para meterlo, y el catálogo no se edita.
- **Búsqueda (issue #4):** `src/lib/catalogue.ts` construye la expresión FTS5 y ordena; `src/lib/catalogue-db.ts` abre el artefacto con `sqlite3_deserialize` (sin OPFS ni COOP/COEP). Cada token se busca en `name` **y** en `aliases`, así que un título alternativo devuelve el `tune_id` correcto.
- **Alta desde el catálogo:** `ensureTune()` resuelve la fila de `pr_tunes` por `(origin='thesession', origin_ref=tune_id)` y solo la crea si no existe (23505 → relectura). El uuid de `pr_tunes` es interno; el id de TheSession vive en `origin_ref`.

## Convenciones

- Commits en español, concisos, uno por unidad lógica. Mensajes multi-línea siempre con `git commit -F`.
- **Nunca** commitear `.env`, `.env.local`, claves ni cadenas de conexión. `.gitignore` ya los cubre; verificar con `git status --porcelain` antes de `git add -A`.
- **La UI va en inglés** (producto público para la comunidad trad); código, comentarios y commits en español.
- No añadir ficheros grandes (`node_modules`, `dist`, capturas) al repo. **Única excepción: `public/thesession.db`**, el artefacto del catálogo (4,9 MB), porque el build no puede reconstruirlo y el navegador lo necesita (issue #4).
- Un frente por sesión: la fase se cierra y se valida antes de abrir la siguiente.
