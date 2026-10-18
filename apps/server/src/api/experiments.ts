import { Router } from 'express';
import { defaultExperiments, loadManifest } from '@fractal-life/simulation/research';
import { EXPERIMENT_OUT_DIR, experimentManifestPath } from '../experiments/jobs.js';
import type { ExperimentJobQueue } from '../experiments/types.js';

/**
 * Experiment directory: list the registered experiments, start one in the
 * background, and poll its job for progress. Runs are minutes long, so `run`
 * answers 202 immediately and the work happens on a worker thread.
 *
 * Experiments are returned whole rather than as a projection: a few hundred
 * bytes each, and the browser's offline catalog is the same `Experiment[]`
 * value, so online and offline render from one shape.
 *
 * Manifests are written to disk, so `GET /:id/manifest` and `POST /:id/reproduce`
 * still work after a restart even though the job itself is gone.
 */
export function createExperimentsApi(jobs: ExperimentJobQueue, outDir: string = EXPERIMENT_OUT_DIR): Router {
  const api = Router();
  const registry = defaultExperiments();

  api.get('/', (_req, res) => {
    res.json({ experiments: registry.list() });
  });

  // Job routes first: `/jobs` must not be read as an experiment id.
  api.get('/jobs', (_req, res) => {
    res.json({ jobs: jobs.list() });
  });

  api.get('/jobs/:jobId', (req, res) => {
    const job = jobs.get(req.params.jobId);
    if (!job) {
      res.status(404).json({ error: 'job not found' });
      return;
    }
    res.json(job);
  });

  api.get('/:id', (req, res) => {
    const exp = registry.get(req.params.id);
    if (!exp) {
      res.status(404).json({ error: `unknown experiment '${req.params.id}' (have: ${registry.list().map((e) => e.id).join(', ')})` });
      return;
    }
    res.json(exp);
  });

  api.get('/:id/manifest', (req, res) => {
    const exp = registry.get(req.params.id);
    if (!exp) {
      res.status(404).json({ error: 'experiment not found' });
      return;
    }
    try {
      res.json(loadManifest(experimentManifestPath(exp.id, outDir)));
    } catch {
      res.status(404).json({ error: `no recorded manifest for '${exp.id}' yet — run it first` });
    }
  });

  api.post('/:id/run', (req, res) => {
    const exp = registry.get(req.params.id);
    if (!exp) {
      res.status(404).json({ error: 'experiment not found' });
      return;
    }
    const doubleCheck = (req.body ?? {}).doubleCheck === true;
    res.status(202).json({ job: jobs.submit({ mode: 'run', experiment: exp, doubleCheck }) });
  });

  api.post('/:id/reproduce', (req, res) => {
    const exp = registry.get(req.params.id);
    if (!exp) {
      res.status(404).json({ error: 'experiment not found' });
      return;
    }
    let manifest;
    try {
      manifest = loadManifest(experimentManifestPath(exp.id, outDir));
    } catch {
      res.status(404).json({ error: `no recorded manifest for '${exp.id}' — run it first` });
      return;
    }
    res.status(202).json({ job: jobs.submit({ mode: 'reproduce', manifest }) });
  });

  return api;
}
