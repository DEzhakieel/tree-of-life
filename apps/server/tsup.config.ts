import { defineConfig } from 'tsup';

export default defineConfig({
  // `worker` is the experiment thread; jobs.ts resolves it next to the bundle,
  // so it has to land at dist/worker.js rather than under a subdirectory.
  entry: { index: 'src/index.ts', worker: 'src/experiments/worker.ts' },
  format: ['esm'],
  outDir: 'dist',
  target: 'node18',
  external: ['pg', 'uWebSockets.js', 'ws', 'express'],
  noExternal: [/@fractal-life\//],
  sourcemap: false,
  clean: true,
});
