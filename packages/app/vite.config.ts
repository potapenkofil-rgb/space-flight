import { defineConfig } from 'vite';

export default defineConfig({
  root: import.meta.dirname,
  build: {
    outDir: 'dist',
    target: 'es2022',
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
