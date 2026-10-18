import type { ExperimentJob as ExperimentJobEnvelope } from '@fractal-life/shared';
import type { Experiment, ExperimentManifest, ReproduceReport } from '@fractal-life/simulation/research';

/** What the API asks the worker to do. `run` produces a manifest; `reproduce`
 * re-runs a recorded one and compares digests bit-for-bit. */
export type ExperimentJobInput =
  | { mode: 'run'; experiment: Experiment; doubleCheck: boolean }
  | { mode: 'reproduce'; manifest: ExperimentManifest };

export type ExperimentJobRequest = ExperimentJobInput & { jobId: string };

/** Worker -> main thread. Progress streams while the job runs; exactly one
 * terminal message (result or error) follows. */
export type ExperimentJobMessage =
  | { jobId: string; type: 'progress'; done: number; total: number; label: string }
  | { jobId: string; type: 'result'; manifest?: ExperimentManifest; report?: ReproduceReport }
  | { jobId: string; type: 'error'; message: string };

export type ExperimentJobStatus = 'queued' | 'running' | 'done' | 'error';

/** Shared envelope, bound to this app's manifest/report types. */
export type ExperimentJob = ExperimentJobEnvelope<ExperimentManifest, ReproduceReport>;

/** The slice of the queue the HTTP layer depends on (faked in tests). */
export interface ExperimentJobQueue {
  submit(input: ExperimentJobInput): ExperimentJob;
  get(jobId: string): ExperimentJob | undefined;
  list(): ExperimentJob[];
}

/** Narrow view of `worker_threads.Worker`, so tests can drive the queue with a
 * scripted stand-in instead of paying for a real thread. */
export interface ExperimentWorkerHandle {
  postMessage(message: ExperimentJobRequest): void;
  terminate(): void;
  on(event: 'message', listener: (m: ExperimentJobMessage) => void): unknown;
  on(event: 'error', listener: (e: Error) => void): unknown;
  on(event: 'exit', listener: (code: number) => void): unknown;
}
