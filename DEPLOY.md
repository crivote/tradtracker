# Despliegue — tradtracker

**Decisión 2026-11-08:** frontal en **Netlify**, construido desde el **espejo público de GitHub**.
Motivo: el bloqueo por fútbol de LaLiga no bloquea dominios sino **IPs concretas**, y el par anycast que
Cloudflare asignaba a esta zona (`188.114.96.5` / `188.114.97.5`) figura en la lista de todos los
partidos desde agosto de 2026. Netlify sirve desde su propia red y no aparece en esas listas —igual que
TradTube—. El Worker de Cloudflare se retiró el mismo día; el diagnóstico completo vive en la skill
`tradtracker`, sección «Bloqueo por fútbol».

## Flujo

```
git push forgejo main
        │  (push mirror de Forgejo, sync_on_commit=True)
        ▼
github.com/crivote/tradtracker  (público, espejo)
        │  (integración Git de Netlify)
        ▼
Netlify (proyecto `tuneshed`) → https://tuneshed.netlify.app
```

- Forgejo (self-hosted) es el **origen de verdad**. GitHub es sólo el puente que Netlify sabe leer.
- El mirror se configuró el 2026-10-28 desde la API de Forgejo (`sync_on_commit=true`, `interval=0s`).
- Si el espejo se queda atrás, Netlify no reconstruye. Comprobarlo con
  `GET /api/v1/repos/crivote/tradtracker/push_mirrors` (`last_error` vacío) y, si hace falta, forzar con
  `POST …/push_mirrors-sync` y volver a mirar **en GitHub**, no en el log de Forgejo.

## Configuración del proyecto en Netlify

| Ajuste | Valor |
|---|---|
| Repositorio | `crivote/tradtracker` (rama `main`) |
| Build command | `npm run build` |
| Publish directory | `dist` |
| Nombre del proyecto | `tuneshed` → `tuneshed.netlify.app` |

`tradtracker.netlify.app` y `tunetracker.netlify.app` están ocupados por terceros: el nombre libre que se
eligió fue **tuneshed**.

Las **cuatro** variables van en **Project configuration → Environment variables**, con scope **Builds**:
`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_TRADTUBE_URL`, `VITE_TRADTUBE_ANON`.

### Tienen que ser variables de BUILD, no de runtime

Vite incrusta las `VITE_*` en el bundle **en tiempo de compilación**; una variable de runtime no llega al
JavaScript y el cliente no puede hablar con Supabase.

- `scripts/check-env.mjs`, encadenado en `npm run build`, **aborta el build** si faltan. Un build fallido
  deja intacto el despliegue anterior; un build mudo lo sustituía por una app sin configurar —fue el
  episodio del 2026-10-28, cuando una variable llamada `VITE_SUPABASE` (sin sufijo) dejó la app en blanco.
- El nombre importa al carácter: `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY`. Una barra final en la
  URL se tolera (se recorta y se avisa en el log).
- Comprobación de que el build las lleva: `curl -s https://tuneshed.netlify.app/ | grep -o
  'assets/index-[^"]*\.js'` y buscar el `ref` del proyecto dentro del bundle descargado.
- **La `service_role`/`secret` no se pone nunca aquí.** El front habla sólo con la anon key y las RLS.

## Ruteo: el fallback SPA va en `netlify.toml`, con el 404 de los assets DELANTE

La regla clásica `/* → /index.html 200` a secas **resucita el issue #40**: un asset ausente acaba servido
como `index.html` con 200 y `Cache-Control: immutable`, el navegador guarda HTML bajo la URL de un `.js` y
la app queda en negro sin recuperación —ni F5 la arregla, porque no vuelve a pedir el fichero—. Por eso en
`netlify.toml` van **antes** del catch-all:

```toml
[[redirects]]
  from = "/assets/*"
  to = "/404.html"
  status = 404

[[redirects]]
  from = "/soundfonts/*"
  to = "/404.html"
  status = 404

[[redirects]]
  from = "/*"
  to = "/index.html"
  status = 200
```

Los ficheros que existen ganan a las redirecciones (`force = false` por defecto), así que los assets
reales se sirven intactos y sólo el hueco cae en `public/404.html` (404 seco, página propia).

**Residuo conocido:** Netlify aplica la cabecera `immutable` de `/assets/*` también al 404 de esa ruta, de
modo que un asset inexistente queda cacheado. Es mucho menos grave que el #40 —un 404 no ejecuta nada—,
pero si tras un despliegue aparece una pantalla en blanco, la salida es limpiar la caché del sitio.

## Cabeceras

`public/_headers` lo copia Vite a `dist/` y Netlify lo respeta:

- `Cross-Origin-Opener-Policy: same-origin` global — **necesario para SQLite WASM**.
- COEP `credentialless` sólo en `/ffmpeg-worker.html`: `require-corp` rompería los iframes de YouTube
  (lección heredada de TradTube).
- `/thesession.db` con `Cache-Control` de un día y `application/octet-stream`; `/assets/*` inmutable.
- HSTS lo pone Netlify por su cuenta (`max-age=31536000; includeSubDomains; preload`).

## El catálogo viaja en el build (4,9 MB)

`public/thesession.db` **se versiona en el repo**: el build no tiene acceso al repo de TradTube y el
navegador descarga el artefacto tal cual para abrirlo con SQLite WASM. Es la excepción declarada a la
regla de no meter artefactos grandes (issue #4).

- Se regenera con `node scripts/fetch-catalogue.mjs [--source <ruta>]`, que además escribe
  `public/thesession.meta.json` (fecha de copia, commit de TradTube, sha256, recuentos). La vista «About»
  lee ese sidecar y el recuento real del artefacto abierto.
- El wasm de SQLite (`dist/assets/sqlite3-*.wasm`, ~860 kB) lo emite Vite con hash y se descarga **en
  segundo plano al entrar en el repertorio** (`preloadCatalogue()`), no en el login: cuando el usuario
  abre el buscador, la consulta ya es local. Medido el 2026-10-28: 4,69 MB + 860 kB una sola vez, y cero
  peticiones nuevas en las búsquedas siguientes.
- Plan free de Netlify: 100 GB/mes de ancho de banda. A 4,9 MB por visitante nuevo son ~20.000 cargas
  frías al mes; de sobra para el uso actual.

**Verificación tras desplegar** (no basta con que el build esté en verde):

```bash
H=https://tuneshed.netlify.app
curl -sI $H/thesession.db | head -5                     # 200, octet-stream, ~4,9 MB
curl -s  $H/ | grep -oE 'assets/index-[^"]+\.js'        # hash del bundle servido
curl -s -o /dev/null -w '%{http_code}\n' $H/level/solo_ready   # 200 (fallback SPA, ruta profunda)
curl -s -o /dev/null -w '%{http_code}\n' $H/assets/inventado.js   # 404 seco, no 200 text/html
```

Y en la app: el cajón de «Add a tune» debe decir «23.448 tunes from a local database» sin esperas, y «About» debe
mostrar la fecha de copia y el commit de origen.

## Dominio

Pendiente de decisión. El plan es `tradtracker.jiggyreel.com`, con el dominio en Cloudflare como
registrador y DNS, y un CNAME **DNS-only (nube gris)** al sitio de Netlify —como TradTube—. Con la nube
naranja se atasca la renovación del certificado de Netlify. El dominio no cambia nada frente al bloqueo de
fútbol: lo que lo evita es servir desde la red de Netlify, no el nombre.

## Historia: el frontal en Cloudflare (2026-10-28 → 2026-11-08)

Se sirvió desde un **Worker con assets estáticos** (`wrangler.jsonc`, fallback en `worker/index.ts`). Se
retiró porque su par anycast estaba en todas las listas de bloqueo. Las dos lecciones que siguen valiendo
y ahora aplican a Netlify: **el fallback SPA nunca debe servir HTML en `/assets/*`**, y **las `VITE_*`
tienen que existir en el build o la app sale muda**.
