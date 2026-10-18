/** Experiment worker thread.
 *
 * A single 6000-tick ladder seed takes ~150 s, so running an experiment on the
 * server's main thread would stall every live world and the whole API. This
 * thread runs `runExperiment` / `reproduceExperiment` untouched and streams a
 * progress message per unit of work back to the job manager.
 *
 * Started with the tsx loader when running from source; when the server is
 * bundled by tsup this file ships as plain JS and the loader is skipped.
 */
import { parentPort } from 'node:worker_threads';
import { runExperiment, reproduceExperiment } from '@fractal-life/simulation/research';
import type { ExperimentJobMessage, ExperimentJobRequest } from './types.js';

const port = parentPort;
if (!port) throw new Error('experiment worker must be spawned as a worker thread');

port.on('message', (req: ExperimentJobRequest) => {
  try {
    if (req.mode === 'run') {
      const manifest = runExperiment(req.experiment, {
        doubleCheck: req.doubleCheck,
        onProgress: (p) => {
          const msg: ExperimentJobMessage = { jobId: req.jobId, type: 'progress', ...p };
          port.postMessage(msg);
        },
      });
      port.postMessage({ jobId: req.jobId, type: 'result', manifest } satisfies ExperimentJobMessage);
    } else {
      port.postMessage({ jobId: req.jobId, type: 'result', report: reproduceExperiment(req.manifest) } satisfies ExperimentJobMessage);
    }
  } catch (err) {
    port.postMessage({ jobId: req.jobId, type: 'error', message: (err as Error).message } satisfies ExperimentJobMessage);
  }
});
