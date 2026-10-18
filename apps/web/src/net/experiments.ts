/**
 * Experiment directory client.
 *
 * The panel must stay useful on a static host (GitHub Pages) where no API
 * server exists, so `loadExperiments` probes `GET /api/health` once and falls
 * back to the browser-side catalog — the same `defaultExperiments()` the server
 * registers, imported through a subpath that pulls in no Node built-ins. In
 * that mode the directory is read-only: run/reproduce fail with a message that
 * names the missing server.
 */
import type { ExperimentJob } from '@fractal-life/shared';
import type { Experiment, ExperimentManifest, ReproduceReport } from '@fractal-life/simulation/research';
import { defaultExperiments } from '@fractal-life/simulation/research/registry';

export type Job = ExperimentJob<ExperimentManifest, ReproduceReport>;
export type ExperimentSource = 'online' | 'offline';

export const POLL_MS = 1000;
const PROBE_TIMEOUT_MS = 2500;

let source: ExperimentSource | null = null;
let catalog: Promise<{ source: ExperimentSource; experiments: Experiment[] }> | null = null;

/** True when the API is answering; cached for the session. */
export async function probeServer(): Promise<ExperimentSource> {
  if (source) return source;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const res = await fetch('/api/health', { signal: controller.signal });
    source = res.ok ? 'online' : 'offline';
  } catch {
    source = 'offline';
  } finally {
    clearTimeout(timer);
  }
  return source;
}

export function loadExperiments(): Promise<{ source: ExperimentSource; experiments: Experiment[] }> {
  if (!catalog) {
    catalog = (async () => {
      if ((await probeServer()) === 'offline') return { source: 'offline' as const, experiments: defaultExperiments().list() };
      try {
        const res = await fetch('/api/experiments');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = (await res.json()) as { experiments: Experiment[] };
        if (!Array.isArray(body.experiments)) throw new Error('malformed response');
        return { source: 'online' as const, experiments: body.experiments };
      } catch {
        return { source: 'offline' as const, experiments: defaultExperiments().list() };
      }
    })();
  }
  return catalog;
}

export async function startRun(id: string, doubleCheck: boolean): Promise<Job> {
  const res = await fetch(`/api/experiments/${encodeURIComponent(id)}/run`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ doubleCheck }),
  });
  if (!res.ok) throw new Error(await errorText(res, `could not start '${id}'`));
  const body = (await res.json()) as { job: Job };
  return body.job;
}

export async function startReproduce(id: string): Promise<Job> {
  const res = await fetch(`/api/experiments/${encodeURIComponent(id)}/reproduce`, { method: 'POST' });
  if (!res.ok) throw new Error(await errorText(res, `could not reproduce '${id}'`));
  const body = (await res.json()) as { job: Job };
  return body.job;
}

export async function fetchJob(jobId: string): Promise<Job | null> {
  const res = await fetch(`/api/experiments/jobs/${encodeURIComponent(jobId)}`);
  if (!res.ok) return null;
  return (await res.json()) as Job;
}

export async function fetchManifest(id: string): Promise<ExperimentManifest | null> {
  const res = await fetch(`/api/experiments/${encodeURIComponent(id)}/manifest`);
  if (!res.ok) return null;
  return (await res.json()) as ExperimentManifest;
}

/** Poll a queued job until it settles. Returns a cancel function. */
export function pollJob(jobId: string, onJob: (job: Job) => void, onGone: (err: Error) => void): () => void {
  let stopped = false;
  const tick = async () => {
    const job = await fetchJob(jobId);
    if (stopped) return;
    if (!job) {
      onGone(new Error('job disappeared — the server was restarted'));
      return;
    }
    onJob(job);
    if (job.status === 'done' || job.status === 'error') return;
    setTimeout(() => void tick(), POLL_MS);
  };
  void tick();
  return () => {
    stopped = true;
  };
}

async function errorText(res: Response, fallback: string): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string };
    return body.error ?? `${fallback} (HTTP ${res.status})`;
  } catch {
    return `${fallback} (HTTP ${res.status})`;
  }
}
