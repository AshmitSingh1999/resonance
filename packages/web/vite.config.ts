import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  root: here,
  plugins: [react()],
  server: {
    port: 5173,
    // The daemon owns the socket; the dev server proxies so the page can use a
    // same-origin URL in both development and the built app.
    proxy: { '/ws': { target: 'ws://localhost:4747', ws: true } },
  },
  build: { outDir: 'dist', emptyOutDir: true },
});
