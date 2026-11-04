import { defineConfig } from 'vitest/config';
import solidPlugin from 'vite-plugin-solid';

export default defineConfig({
  plugins: [solidPlugin()],
  server: {
    port: 3000,
    host: true,
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
