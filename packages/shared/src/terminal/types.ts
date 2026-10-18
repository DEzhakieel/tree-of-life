import type { SimStats } from '../types.js';

/**
 * Platform-agnostic terminal command layer.
 *
 * The exact same {@link CommandRegistry} drives both the in-browser terminal
 * panel (`apps/web`) and the Node console TUI (`apps/simulation`). Each platform
 * supplies a {@link TerminalHost} adapter over its own control surface, so the
 * commands are written exactly once and stay in lock-step across web + console.
 */

export type TerminalPlatform = 'web' | 'console';

/** A single metric row, shared by the web panel and the console dashboard. */
export interface Metric {
  label: string;
  value: string;
}

/** Catalog row surfaced by `experiment list`. */
export interface ExperimentInfo {
  id: string;
  name: string;
  kind: 'ladder' | 'ews';
  seedCount: number;
  hypothesis: string;
}

/** Projection of a background experiment job the terminal can display. */
export interface ExperimentJobView {
  id: string;
  experimentId: string;
  mode: 'run' | 'reproduce';
  status: 'queued' | 'running' | 'done' | 'error';
  progress: { done: number; total: number; label: string } | null;
  error?: string;
  meanScore?: number;
  passRate?: number;
  reproducible?: boolean;
  matched?: boolean;
}

/** Adapter implemented by each platform to expose its live session. */
export interface TerminalHost {
  readonly platform: TerminalPlatform;
  /** Free-form status lines (mode, tick, paused, population, seed, ...). */
  describe(): Record<string, string | number | boolean | null>;
  /** Latest full stats snapshot, or null before a world exists. */
  stats(): SimStats | null;
  /** Current world params (only numeric/boolean/string scalars are surfaced). */
  params(): Record<string, string | number | boolean> | null;
  /** Apply one numeric param. Returns false for an unknown key. */
  setParam(key: string, value: number): boolean;
  control(cmd: 'play' | 'pause' | 'step'): void;
  /** Advance `n` ticks (console runs the loop; web may burst frames). */
  step(n?: number): void;
  /** Restart the world, optionally overriding a param. */
  reset(patch?: Record<string, number>): void;
  /** Spawn `count` agents (default 1). */
  spawn(count?: number): void;
  setTickRate(tps: number): void;
  setTurbo(on: boolean): void;
  /** Serializable snapshot for `export`. */
  exportState(): unknown;
  /** Optional async tick for console hosts that must pump their own loop. */
  drain?(): Promise<void>;

  // Experiment directory (optional: hosts without a server omit these and the
  // `experiment` command reports that the verb is unavailable).
  listExperiments?(): Promise<ExperimentInfo[]>;
  startExperimentRun?(id: string, doubleCheck: boolean): Promise<ExperimentJobView>;
  startExperimentVerify?(id: string): Promise<ExperimentJobView>;
  experimentJob?(jobId: string): Promise<ExperimentJobView | null>;
}

/** Runtime handed to every command. */
export interface TerminalContext {
  host: TerminalHost;
  /** Emit one or more lines of normal output. */
  print(...text: string[]): void;
  /** Emit an error line. */
  error(text: string): void;
}

/** One terminal command. */
export interface Command {
  name: string;
  aliases?: string[];
  summary: string;
  usage?: string;
  hidden?: boolean;
  run(ctx: TerminalContext, args: string[]): void | Promise<void>;
}

/** Static project metadata surfaced by `version` / `about` / `cite`. */
export interface TerminalMeta {
  name: string;
  version: string;
  author: string;
  license: string;
  repo: string;
  docs: string;
  description?: string;
}
