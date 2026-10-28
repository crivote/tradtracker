# Despliegue — tradtracker

**Decisión 2026-10-28:** frontal en **Cloudflare**, construido desde el **espejo público de GitHub**. Motivo: ancho de banda ilimitado y 500 builds/mes (el catálogo son 4,7 MB por visitante nuevo; Netlify free son 100 GB/mes).

**Ojo con el nombre:** lo que el panel ofrece hoy como «Pages» acaba desplegándose como **Worker con assets estáticos** (`npx wrangler deploy`, nombre de worker `tradtracker`). No es una diferencia cosmética: cambia dónde se declara el fallback SPA (ver más abajo).

## Flujo

```
git push forgejo main
        │  (push mirror de Forgejo, sync_on_commit=True)
        ▼
github.com/crivote/tradtracker  (público, espejo)
        │  (integración Git de Cloudflare)
        ▼
Cloudflare (Worker `tradtracker`) → https://tradtracker.<subdominio>.workers.dev
```

- Forgejo (self-hosted) es el **origen de verdad**. GitHub es solo el puente que Cloudflare sabe leer: ninguno de los dos soporta Forgejo directamente.
- El mirror se configuró el 2026-10-28 desde la API de Forgejo con los mismos parámetros que el de TradTube: `sync_on_commit=true`, `interval=0s`.
- Si el espejo falla, Cloudflare no reconstruye. Comprobarlo con:
  `GET /api/v1/repos/crivote/tradtracker/push_mirrors` → `last_error` debe estar vacío.

## Configuración del proyecto en Cloudflare

| Ajuste | Valor |
|---|---|
| Repositorio | `crivote/tradtracker` (rama `main`) |
| Framework preset | None (proyecto Vite propio) |
| Build command | `npm run build` |
| Output directory | `dist` |
| Deploy command | `npx wrangler deploy` (lo pone Cloudflare por defecto) |
| Variables de entorno | `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY` |

Las dos variables se configuran **en el panel de Cloudflare**, no en el repo. La anon key es pública por diseño, pero no se commitea: así se puede rotar sin tocar el código.

### Tienen que ser variables de BUILD, no de runtime

**Medido el 2026-10-28:** el despliegue salió sin ellas y la app quedó en blanco. Vite incrusta `VITE_*`
en el bundle **en tiempo de compilación**; una variable de runtime no llega al JavaScript y el cliente no
puede hablar con Supabase.

- Ruta correcta: **Workers & Pages → tradtracker → Settings → Build → «Build variables and secrets»**.
- Ruta que NO sirve para esto: **Settings → Variables & Secrets** (esa es de runtime).
- Después de guardarlas hay que **reconstruir** (Retry deployment o un push nuevo): cambiarlas no
  reconstruye solo.
- Comprobación rápida de si el build las lleva: `curl -s https://…/ | grep -o 'assets/index-[^"]*\.js'`
  y buscar el `ref` del proyecto dentro del bundle. Si no aparece, faltan.
- Desde el 2026-10-28 la app no se queda en blanco si faltan: muestra un aviso de configuración en la
  cabecera (`src/lib/supabase.ts` lo detecta y `Layout.tsx` lo pinta).
- **Y el build ahora falla antes de desplegar** (`scripts/check-env.mjs`, encadenado en `npm run build`).
  Un build fallido deja intacto el despliegue anterior; un build mudo lo sustituía por una app sin
  configurar. Si Cloudflare marca el build en rojo con «Faltan variables de Supabase», es esta guarda:
  el problema está en esta sección, no en el código.
- **Comprobado el 2026-10-28**: Vite sí incrusta variables que vengan del entorno del proceso (probado
  compilando sin `.env.local` y con `VITE_*` exportadas). Si la guarda salta en Cloudflare, las
  variables no están llegando al contenedor de build; no es limitación de Vite.

**La `service_role`/`secret` no se pone nunca aquí.** Todo el front habla con la anon key y las políticas RLS.

## Ruteo: el fallback SPA va en `wrangler.jsonc`, NO en `_redirects`

Primer despliegue (2026-10-28) falló con:

```
Invalid _redirects configuration:
Line 2: Infinite loop detected in this rule. [code: 100324]
```

La regla clásica de Pages `/* /index.html 200` se interpreta en Workers como un bucle: servir `index.html` y volver a casar la regla. La forma correcta para assets estáticos es declararlo en `wrangler.jsonc`, que **sí** se versiona en el repo:

```jsonc
{
  "name": "tradtracker",
  "compatibility_date": "2026-10-23",
  "assets": {
    "directory": "./dist",
    "not_found_handling": "single-page-application"
  }
}
```

`not_found_handling: "single-page-application"` hace que cualquier ruta desconocida devuelva `index.html` con 200, que es lo que necesita el router de SolidJS. Por eso **no hay `public/_redirects`**: se borró a propósito.

## Cabeceras

`public/_headers` lo copia Vite a `dist/` y el worker lo respeta:

- `Cross-Origin-Opener-Policy: same-origin` global — **necesario para SQLite WASM**.
- COEP `credentialless` solo en el worker aislado, si algún día se usa ffmpeg.wasm: `require-corp` rompería los iframes de YouTube (lección heredada de TradTube).
- `/thesession.db` con `Cache-Control: 1 día`; `/assets/*` inmutable.

## Alternativa sin espejo

Si algún día se quiere desplegar sin GitHub:

```bash
npm run build
npx wrangler deploy          # usa el wrangler.jsonc del repo
```

Requiere un token de Cloudflare en `CLOUDFLARE_API_TOKEN`. No hay auto-deploy al hacer push por esta vía: habría que dispararlo desde un script o un runner.

## Dominio

`crivote.dedyn.io` está en **deSEC** (`ns1.desec.io`), con el ápex apuntando al homelab. Para un dominio propio (p. ej. `tradtracker.crivote.dedyn.io`) hay que añadir el dominio en Cloudflare y crear el CNAME que indique, en deSEC. Pendiente de decisión: no bloquea el despliegue en `*.workers.dev`.
