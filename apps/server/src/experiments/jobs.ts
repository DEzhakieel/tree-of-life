/** Experiment job queue.
 *
 * One long-lived worker thread, FIFO queue: a 6000-tick ladder seed costs
 * ~150 s and an ews sweep ~2.5 min, so jobs are minutes long and must never
 * touch the event loop the live worlds run on. The worker is created lazily
 * (tsx transpiles the whole simulation graph on first load) and reused, which
 * keeps the second job from paying that startup again.
 *
 * Completed runs are written next to the CLI's `--out` directory, so the panel
 * and `research:experiment --verify` read the same manifest files.
 */
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import { saveManifest } from '@fractal-life/simulation/research';
import type {
  ExperimentJob,
  ExperimentJobInput,
  ExperimentJobMessage,
  ExperimentJobQueue,
  ExperimentJobRequest,
  ExperimentWorkerHandle,
} from './types.js';

function resolveOutDir(): string {
  // 3 levels up from src/experiments/ (source), 2 from dist/ (tsup bundle).
  for (const rel of ['../../../simulation/research/experiments/', '../../simulation/research/experiments/']) {
    const dir = fileURLToPath(new URL(rel, import.meta.url));
    if (existsSync(join(dir, '..'))) return dir;
  }
  return fileURLToPath(new URL('../../../simulation/research/experiments/', import.meta.url));
}

export const EXPERIMENT_OUT_DIR = resolveOutDir();

export function experimentManifestPath(id: string, outDir: string = EXPERIMENT_OUT_DIR): string {
  return join(outDir, `${id}.json`);
}

const JOB_TIMEOUT_MS = 30 * 60_000;

/** Source runs need the tsx loader (the worker file is .ts); the tsup bundle
 * ships it as plain JS and must not ask for a loader that may be absent. */
function spawnWorker(): ExperimentWorkerHandle {
  const sourceUrl = new URL('./worker.ts', import.meta.url);
  const isSource = existsSync(fileURLToPath(sourceUrl));
  const url = isSource ? sourceUrl : new URL('./worker.js', import.meta.url);
  return new Worker(url, isSource ? { execArgv: ['--loader', 'tsx/esm'] } : {}) as ExperimentWorkerHandle;
}

export class ExperimentJobs implements ExperimentJobQueue {
  private jobs = new Map<string, ExperimentJob>();
  private queue: ExperimentJobRequest[] = [];
  private worker: ExperimentWorkerHandle | null = null;
  private active: string | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly spawn: () => ExperimentWorkerHandle = spawnWorker,
    private readonly outDir: string = EXPERIMENT_OUT_DIR,
  ) {}

  submit(input: ExperimentJobInput): ExperimentJob {
    const jobId = randomUUID();
    const job: ExperimentJob = {
      id: jobId,
      mode: input.mode,
      experimentId: input.mode === 'run' ? input.experiment.id : input.manifest.experiment.id,
      status: 'queued',
      progress: null,
      createdAt: new Date().toISOString(),
    };
    this.jobs.set(jobId, job);
    this.queue.push({ ...input, jobId });
    this.pump();
    return this.jobs.get(jobId)!;
  }

  get(jobId: string): ExperimentJob | undefined {
    return this.jobs.get(jobId);
  }

  list(): ExperimentJob[] {
    return [...this.jobs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  /** Terminate the worker and drop queued work (server shutdown). */
  shutdown(): void {
    this.queue = [];
    const w = this.worker;
    this.worker = null;
    this.active = null;
    this.clearTimer();
    if (w) void w.terminate();
  }

  private pump(): void {
    if (this.active !== null || this.queue.length === 0) return;
    const req = this.queue.shift()!;
    const job = this.jobs.get(req.jobId);
    if (!job) {
      this.pump();
      return;
    }
    job.status = 'running';
    job.startedAt = new Date().toISOString();
    this.active = req.jobId;
    this.ensureWorker().postMessage(req);
    this.timer = setTimeout(() => this.failActive(`experiment timed out after ${JOB_TIMEOUT_MS / 60_000} min`), JOB_TIMEOUT_MS);
  }

  private ensureWorker(): ExperimentWorkerHandle {
    if (this.worker) return this.worker;
    const w = this.spawn();
    // Handlers close over `w` so a stale worker's exit can never fail a job
    // that a newer worker has already picked up.
    w.on('message', (m: ExperimentJobMessage) => this.onMessage(m));
    w.on('error', (err: Error) => this.onWorkerDown(w, err.message));
    w.on('exit', (code: number) => this.onWorkerDown(w, `worker exited with code ${code}`));
    this.worker = w;
    return w;
  }

  private onMessage(msg: ExperimentJobMessage): void {
    const job = this.jobs.get(msg.jobId);
    if (!job) return;
    if (msg.type === 'progress') {
      job.progress = { done: msg.done, total: msg.total, label: msg.label };
      return;
    }
    if (msg.type === 'error') {
      this.finish(msg.jobId, (j) => {
        j.status = 'error';
        j.error = msg.message;
      });
      return;
    }
    this.finish(msg.jobId, (j) => {
      j.status = 'done';
      j.manifest = msg.manifest;
      j.report = msg.report;
      if (msg.manifest && j.mode === 'run') {
        try {
          saveManifest(msg.manifest, experimentManifestPath(j.experimentId, this.outDir));
        } catch (err) {
          j.saveError = (err as Error).message;
        }
      }
    });
  }

  private finish(jobId: string, mutate: (job: ExperimentJob) => void): void {
    const job = this.jobs.get(jobId);
    if (job) {
      mutate(job);
      job.finishedAt = new Date().toISOString();
    }
    if (this.active === jobId) {
      this.active = null;
      this.clearTimer();
      this.pump();
    }
  }

  private failActive(reason: string): void {
    const id = this.active;
    if (id === null) return;
    const w = this.worker;
    // Detach first so the 'exit' this terminate causes is read as intentional.
    this.worker = null;
    if (w) void w.terminate();
    this.finish(id, (j) => {
      j.status = 'error';
      j.error = reason;
    });
  }

  private onWorkerDown(w: ExperimentWorkerHandle, reason: string): void {
    if (this.worker !== w) return;
    this.worker = null;
    const id = this.active;
    if (id === null) return;
    this.finish(id, (j) => {
      j.status = 'error';
      j.error = reason;
    });
  }

  private clearTimer(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}
