import type { AgentState, SimEvent, SimStats, SubstrateKind, WorldConfig, WorldParams } from '@fractal-life/shared';
import { fnv1a32 } from '@fractal-life/shared';

/** Substrate kinds implemented by the pure-TS engine ('agents' is the full engine). */
export type KernelKind = Exclude<SubstrateKind, 'agents'>;

/** Per-cell life map for the ground layer (same shape the WASM engine emits). */
export interface SetMapFields {
  size: number;
  depth: Uint8Array;
  escape: Uint8Array;
}

/**
 * One substrate's state advanced by its own rule set. The SubstrateEngine
 * adapts a kernel to the full worker surface (frames, stats, interventions);
 * kernels only own dynamics + observables. All randomness flows through a
 * seeded SplitMix64 drawn in fixed ascending-id order, so two kernels built
 * from the same world config tick-for-tick identically.
 */
export interface SubstrateKernel {
  readonly kind: KernelKind;
  /** Live params reference shared with the world config (setParam mutates in place). */
  readonly params: WorldParams;
  readonly currentTick: number;
  readonly population: number;
  readonly speciesCount: number;
  /** Advance one tick and return this tick's events (individual events are
   *  rate-limited by EVENT_BUDGET; population-level events never drop). */
  step(): SimEvent[];
  /** Write current bodies as wire rows; `out` is reused across calls. */
  writeRows(out: AgentState[]): void;
  /** Fill observables onto a fresh emptySimStats row. */
  writeStats(s: SimStats): void;
  /** Life map for the ground layer, or null when the substrate has none. */
  setMapFields(): SetMapFields | null;
  /** Interventions. Positions are world units on the torus. */
  spawn(x: number, y: number): void;
  kill(x: number, y: number, radius: number): number;
  feed(x: number, y: number, amount: number): number;
  setTimeScale(timeScale: number): void;
}

/** Individual birth/death events dropped beyond this per tick so a population
 *  boom cannot flood the event feed; extinction/intervention always pass. */
export const EVENT_BUDGET = 4;

/** Deterministic FNV-1a over a byte sequence (state hashes, lattice cells). */
export function fnvBytes(bytes: Uint8Array): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i]!;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** Incremental FNV-1a for hashed numbers (quantised row state). */
export class ByteHasher {
  private h = 0x811c9dc5;

  byte(b: number): void {
    this.h = Math.imul(this.h ^ (b & 0xff), 0x01000193) >>> 0;
  }

  u16(v: number): void {
    this.byte(v);
    this.byte(v >> 8);
  }

  get value(): number {
    return this.h >>> 0;
  }
}

/** Wrap a coordinate into [0, WORLD_SIZE) (torus). */
export function wrapPos(v: number, worldSize: number): number {
  return v - worldSize * Math.floor(v / worldSize);
}

/** Minimum-image delta on a wrapping axis. Inputs are coordinates in
 *  [0, WORLD_SIZE), so the delta lands in (-W, W) — branch, no division. */
export function minImage(d: number, worldSize: number): number {
  if (d > worldSize * 0.5) return d - worldSize;
  if (d < -worldSize * 0.5) return d + worldSize;
  return d;
}

/** Shannon entropy (bits) of a count array, or 0 when total is 0. */
export function shannonFromCounts(counts: ArrayLike<number>, total: number): number {
  if (total <= 0) return 0;
  let h = 0;
  for (let i = 0; i < counts.length; i++) {
    const c = counts[i]!;
    if (c <= 0) continue;
    const p = c / total;
    h -= p * Math.log2(p);
  }
  return h;
}

/** Simpson diversity 1 - sum(p_i^2) of a count array (0 when total is 0). */
export function simpsonFromCounts(counts: ArrayLike<number>, total: number): number {
  if (total <= 0) return 0;
  let sum = 0;
  for (let i = 0; i < counts.length; i++) {
    const c = counts[i]!;
    if (c <= 0) continue;
    const p = c / total;
    sum += p * p;
  }
  return 1 - sum;
}

/** Spatial Shannon entropy of positions binned into a bins x bins grid,
 *  normalised to [0, 1] by log2(bins^2). */
export function spatialEntropy(xs: ArrayLike<number>, ys: ArrayLike<number>, n: number, bins: number, worldSize: number): number {
  if (n <= 0) return 0;
  const counts = new Float64Array(bins * bins);
  const cell = worldSize / bins;
  for (let i = 0; i < n; i++) {
    const bx = Math.min(bins - 1, Math.floor(xs[i]! / cell));
    const by = Math.min(bins - 1, Math.floor(ys[i]! / cell));
    counts[by * bins + bx]! += 1;
  }
  return shannonFromCounts(counts, n) / Math.log2(bins * bins);
}

/** Build a SimEvent with the shared base fields filled in. */
export function makeEvent(
  worldId: string,
  tick: number,
  significance: number,
  type: string,
  data: Record<string, unknown>,
): SimEvent {
  return { worldId, tick, significance, type, data } as unknown as SimEvent;
}

/** Seed for a substrate's RNG stream — deterministic from the world seed. */
export function kernelSeed(world: WorldConfig, kind: string): number {
  return fnv1a32(`${world.seed}:substrate:${kind}`);
}
