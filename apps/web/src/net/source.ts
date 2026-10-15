import type { WorldConfig, Intervention } from '@fractal-life/shared';

export interface SimSource {
  /** Start streaming a world (creates engine / joins room). */
  start(world: WorldConfig): void;
  /** Queue an intervention (sequence is assigned by the authority). */
  intervene(iv: Omit<Intervention, 'sequence'>): void;
  control(cmd: 'play' | 'pause' | 'step'): void;
  setTickRate(tps: number): void;
  /** Render cadence, independent of sim rate. `frameEvery: 0` stops the render
   *  stream entirely while the simulation keeps advancing. */
  setRenderCadence?(frameEvery: number, statsEvery?: number): void;
  /** Run the tick loop flat out with no wall-clock pacing, so the simulation
   *  runs at CPU speed instead of `tps`. */
  setTurbo?(on: boolean): void;
  requestSnapshot(tick?: number): void;
  requestLineage(): void;
  /** Fetch full agent summaries (including genomes) for inspection. */
  requestAgentSummaries(): void;
  destroy(): void;
}

export type { WorldConfig, Intervention };
