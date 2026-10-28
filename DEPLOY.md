# Despliegue — tradtracker

**Decisión 2026-10-28:** frontal en **Cloudflare Pages**, construido desde el **espejo público de GitHub**. Motivo: ancho de banda ilimitado y 500 builds/mes (el catálogo son 4,7 MB por visitante nuevo; Netlify free son 100 GB/mes).

## Flujo

```
git push forgejo main
        │  (push mirror de Forgejo, sync_on_commit=True)
        ▼
github.com/crivote/tradtracker  (público, espejo)
        │  (integración Git de Cloudflare Pages)
        ▼
Cloudflare Pages → https://tradtracker.pages.dev
```

- Forgejo (self-hosted) es el **origen de verdad**. GitHub es solo el puente que Cloudflare sabe leer: ninguno de los dos soporta Forgejo directamente.
- El mirror se configuró el 2026-10-28 desde la API de Forgejo con los mismos parámetros que el de TradTube: `sync_on_commit=true`, `interval=0s`.
- Si el espejo falla, Cloudflare no reconstruye. Comprobarlo con:
  `GET /api/v1/repos/crivote/tradtracker/push_mirrors` → `last_error` debe estar vacío.

## Configuración del proyecto en Cloudflare Pages

| Ajuste | Valor |
|---|---|
| Repositorio | `crivote/tradtracker` (rama `main`) |
| Framework preset | None (es un proyecto Vite propio) |
| Build command | `npm run build` |
| Output directory | `dist` |
| Variables de entorno | `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY` |

Las dos variables se configuran **en el panel de Pages**, no en el repo. La anon key es pública por diseño, pero no se commitea: así se puede rotar sin tocar el código.

**La `service_role`/`secret` no se pone nunca aquí.** Todo el front habla con la anon key y las políticas RLS.

## Cabeceras y ruteo

Los ficheros `public/_headers` y `public/_redirects` los copia Vite a `dist/` y Pages los respeta:

- `Cross-Origin-Opener-Policy: same-origin` global — **necesario para SQLite WASM**.
- COEP `credentialless` solo en el worker aislado, si algún día se usa ffmpeg.wasm: `require-corp` rompería los iframes de YouTube (lección heredada de TradTube).
- `/* /index.html 200` para que el router de SolidJS resuelva cualquier ruta.
- `/thesession.db` con `Cache-Control: 1 día`; `/assets/*` inmutable.

## Alternativa sin espejo

Si algún día se quiere desplegar sin GitHub:

```bash
npm run build
npx wrangler pages deploy dist --project-name tradtracker
```

Requiere un token de Cloudflare con permiso `Pages:Edit` en `CLOUDFLARE_API_TOKEN`. No hay auto-deploy al hacer push por esta vía: habría que dispararlo desde un script o un runner.

## Dominio

`crivote.dedyn.io` está en **deSEC** (`ns1.desec.io`), con el ápex apuntando al homelab. Para un dominio propio (p. ej. `tradtracker.crivote.dedyn.io`) hay que crear el CNAME que indique Cloudflare en su panel, en deSEC, y añadir el dominio en Pages. Pendiente de decisión: no bloquea el primer deploy en `*.pages.dev`.
