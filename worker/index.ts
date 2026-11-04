/**
 * Worker de tradtracker: assets estáticos + fallback SPA (issue #40).
 *
 * Con `assets.not_found_handling: "none"`, `env.ASSETS.fetch` devuelve 404 en
 * vez de una página, y el fallback lo pone este Worker. Es lo que permite
 * distinguir un asset ausente (404 seco, `no-store`) de una ruta de la app
 * (index.html). Servir el index para `/assets/*` envenenaba la caché del
 * cliente: el navegador guardaba HTML bajo la URL de un `.js` con
 * `Cache-Control: immutable` y la app quedaba rota durante un año.
 */

interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> };
}

/** Rutas que son ficheros, no rutas de la app: si faltan, 404 y nunca `index.html`. */
const ASSET_PREFIXES = ['/assets/', '/soundfonts/'];

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const asset = await env.ASSETS.fetch(request);
    if (asset.status !== 404) return asset;

    // Un asset ausente es un 404, nunca una página: servir HTML aquí envenena la caché del cliente.
    // `/soundfonts/` entra en la misma regla desde que las carpetas de samples cambian de nombre: un
    // `fiddle-mp3/D4.mp3` que ya no existe llegaba al fallback y devolvía `index.html` con 200.
    if (ASSET_PREFIXES.some((prefix) => url.pathname.startsWith(prefix))) {
      return new Response('Not Found', {
        status: 404,
        headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
      });
    }

    // Fallback SPA: cualquier otra ruta sirve el index para que la app arranque.
    return env.ASSETS.fetch(new Request(new URL('/index.html', url), { method: 'GET', headers: request.headers }));
  },
};
