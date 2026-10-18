/**
 * Envelope for a long-running experiment job.
 *
 * Defined here rather than in the server because both ends need it: the server
 * fills it, the web panel polls it. `M`/`R` stay generic so the server can bind
 * them to the simulation package's manifest/report types while the browser
 * binds the same types via a type-only import.
 */
export interface ExperimentJob<M = unknown, R = unknown> {
  id: string;
  mode: 'run' | 'reproduce';
  experimentId: string;
  status: 'queued' | 'running' | 'done' | 'error';
  /** filled in as units of work complete (per seed, or per seed x ramp) */
  progress: { done: number; total: number; label: string } | null;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  /** mode === 'run' */
  manifest?: M;
  /** mode === 'reproduce' */
  report?: R;
  error?: string;
  /** the run succeeded but its manifest could not be written to disk */
  saveError?: string;
}
