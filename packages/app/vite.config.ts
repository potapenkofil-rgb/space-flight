import { resolve } from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  root: import.meta.dirname,
  build: {
    outDir: 'dist',
    target: 'es2022',
    // Additive multi-page build (Agent D, PLAN.md §7): `flight.html`/`map.html`
    // are standalone entry points for the flight/map scenes (see
    // `scenes/flight/standalone.ts` / `scenes/map/standalone.ts`), used until
    // real in-app menu → scene navigation is wired post-merge. `index.html`
    // (the menu) is unchanged — customizing `rollupOptions.input` just means
    // listing it explicitly alongside the new pages.
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        flight: resolve(import.meta.dirname, 'flight.html'),
        map: resolve(import.meta.dirname, 'map.html'),
      },
    },
  },
  server: {
    port: 5183,
    strictPort: true,
  },
  preview: {
    port: 4173,
    strictPort: true,
  },
});
