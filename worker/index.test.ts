// @vitest-environment node
/**
 * Router del Worker (issue #40): assets, fallback SPA y el 404 de un asset ausente.
 *
 * `env.ASSETS` es un doble en memoria: sin wrangler, sin red y sin `dist/`.
 * Modela lo que hacen los assets estáticos en Workers con
 * `not_found_handling: "none"` —200 para lo que existe (incluido `/`, que los
 * assets resuelven solos a `index.html`) y 404 para todo lo que no—, que es
 * justo la condición que hacía falta para poder ejercitar la rama nueva.
 */
import { describe, expect, it } from 'vitest';
import worker from './index';

const ORIGIN = 'https://tradtracker.crivote.workers.dev';
const INDEX_HTML = '<!doctype html><html lang="en"><body><div id="root"></div></body></html>';
const REAL_ASSET = 'console.log("assets reales");\n';
const DB_BODY = 'SQLite format 3\u0000';

function makeEnv() {
  const calls: string[] = [];
  const env = {
    ASSETS: {
      async fetch(request: Request): Promise<Response> {
        const { pathname } = new URL(request.url);
        calls.push(pathname);

        switch (pathname) {
          case '/':
          case '/index.html':
            return new Response(INDEX_HTML, {
              status: 200,
              headers: { 'content-type': 'text/html; charset=utf-8' },
            });
          case '/assets/index-real.js':
            return new Response(REAL_ASSET, {
              status: 200,
              headers: { 'content-type': 'text/javascript; charset=utf-8' },
            });
          case '/thesession.db':
            return new Response(DB_BODY, {
              status: 200,
              headers: { 'content-type': 'application/octet-stream' },
            });
          default:
            return new Response('Not Found', {
              status: 404,
              headers: { 'content-type': 'text/plain; charset=utf-8' },
            });
        }
      },
    },
  };

  return { env, calls };
}

function get(path: string): Request {
  return new Request(`${ORIGIN}${path}`);
}

describe('worker: assets estáticos', () => {
  it('un asset que ya no existe es 404 seco, sin HTML y sin caché', async () => {
    const { env, calls } = makeEnv();

    const response = await worker.fetch(get('/assets/index-viejo.js'), env);

    expect(response.status).toBe(404);
    expect(response.headers.get('content-type')).not.toContain('text/html');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.text()).toBe('Not Found');
    // No se pide el index para un asset: esa es la regresión de la issue.
    expect(calls).toEqual(['/assets/index-viejo.js']);
  });

  it('un asset real se devuelve intacto, sin tocar cuerpo ni tipo', async () => {
    const { env } = makeEnv();

    const response = await worker.fetch(get('/assets/index-real.js'), env);

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/javascript; charset=utf-8');
    expect(await response.text()).toBe(REAL_ASSET);
  });

  it('el catálogo SQLite se sirve tal cual, sin pasar por el fallback', async () => {
    const { env, calls } = makeEnv();

    const response = await worker.fetch(get('/thesession.db'), env);

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/octet-stream');
    expect(await response.text()).toBe(DB_BODY);
    expect(calls).toEqual(['/thesession.db']);
  });
});

describe('worker: fallback SPA', () => {
  it('una ruta conocida sirve el index', async () => {
    const { env, calls } = makeEnv();

    const response = await worker.fetch(get('/search'), env);

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
    expect(await response.text()).toBe(INDEX_HTML);
    expect(calls).toEqual(['/search', '/index.html']);
  });

  it('una ruta dinámica sirve el index', async () => {
    const { env } = makeEnv();

    const response = await worker.fetch(get('/repertoire/abc-123'), env);

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
    expect(await response.text()).toBe(INDEX_HTML);
  });

  it('la raíz la resuelve ASSETS y no gasta fallback', async () => {
    const { env, calls } = makeEnv();

    const response = await worker.fetch(get('/'), env);

    expect(response.status).toBe(200);
    expect(await response.text()).toBe(INDEX_HTML);
    expect(calls).toEqual(['/']);
  });
});
