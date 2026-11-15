import { defineConfig } from 'vitest/config';
import solidPlugin from 'vite-plugin-solid';

/**
 * TheSession no manda CORS (#59): `/tunes/{id}/abc` responde 200 sin
 * `Access-Control-Allow-Origin`, así que el navegador no puede leerla. En
 * producción lo sirve el proxy de `netlify.toml` (`/ts/*`); en local, esto —
 * servidor de desarrollo y `vite preview`— para que el mismo `fetch`
 * same-origin funcione fuera de Netlify.
 */
const thesessionProxy = {
  '/ts': {
    target: 'https://thesession.org',
    changeOrigin: true,
    rewrite: (path: string) => path.replace(/^\/ts/, ''),
  },
};

export default defineConfig({
  plugins: [solidPlugin()],
  server: {
    port: 3000,
    host: true,
    proxy: thesessionProxy,
  },
  preview: {
    proxy: thesessionProxy,
  },
  build: {
    target: 'esnext',
  },
  optimizeDeps: {
    exclude: ['@sqlite.org/sqlite-wasm'],
  },
  test: {
    // Node 26 declara `localStorage` en `globalThis` y tapa el de jsdom; el
    // setup repone uno en memoria solo cuando falta (ver vitest.setup.ts).
    setupFiles: ['./vitest.setup.ts'],
  },
});
