import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  outDir: 'dist',
  target: 'node18',
  external: ['pg', 'uWebSockets.js', 'ws', 'express'],
  noExternal: [/@fractal-life\//],
  sourcemap: false,
  clean: true,
});
