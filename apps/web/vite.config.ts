import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const proxyTarget = process.env.FLS_API ?? 'http://localhost:8080';
// GitHub Pages serves project sites under /<repo>/. Set FLS_BASE=/tree-of-life/
// for that deployment; defaults to '/' for local dev and root hosting.
const base = process.env.FLS_BASE ?? '/';

export default defineConfig({
  base,
  plugins: [react()],
  server: {
    port: 5173,
    host: '127.0.0.1',
    proxy: {
      '/api': { target: proxyTarget, changeOrigin: true },
      '/ws': { target: proxyTarget.replace('http', 'ws'), ws: true },
    },
  },
  build: {
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 2000,
  },
  worker: {
    format: 'es',
  },
});
