import { SplitMix64 } from './rng.js';

/**
 * Seeded stochastic world processes. Everything here is driven by a
 * SplitMix64 seeded from (worldSeed, tick) via `envSeed`, so the same seed
 * reproduces identical world fluctuations while still being genuinely noisy
 * (and therefore *different* from a deterministic twin with the same seed).
 */

export interface WorldStochasticConfig {
  /** Master switch. When false, `regenerate` behaves exactly as before. */
  enabled: boolean;
  /** Expected per-tick Poisson point-process events (cells burst-regenerated). */
  poissonRate: number;
  /** OU mean-reversion rate of the per-cell resource multiplier field. */
  ouTheta: number;
  /** OU volatility (standard deviation of the driving noise per unit time). */
  ouSigma: number;
  /** OU field is clamped to [1-band, 1+band] so growth never goes negative. */
  ouBand: number;
  /** Weather transition matrix (row = current state). null => default. */
  weather: number[][] | null;
}

export interface WorldStochState {
  ouMul: Float32Array;
  weather: number;
  weatherMoisture: number;
  weatherGrowth: number;
  cellCount: number;
  burstFlags: Uint8Array;
}

export const DEFAULT_WEATHER_MATRIX: number[][] = [
  [0.85, 0.08, 0.04, 0.03],
  [0.18, 0.75, 0.02, 0.05],
  [0.1, 0.03, 0.82, 0.05],
  [0.15, 0.06, 0.05, 0.74],
];

export const WEATHER_NAMES = ['clear', 'rain', 'drought', 'heat'] as const;
export const WEATHER_MOISTURE = [1.0, 1.25, 0.7, 0.9];
export const WEATHER_GROWTH = [1.0, 1.15, 0.8, 1.3];

export const DEFAULT_WORLD_STOCHASTIC: WorldStochasticConfig = {
  enabled: true,
  poissonRate: 40,
  ouTheta: 0.01,
  ouSigma: 0.02,
  ouBand: 0.25,
  weather: null,
};

export function createWorldStochState(size: number): WorldStochState {
  const n = size * size;
  return {
    ouMul: new Float32Array(n).fill(1),
    weather: 0,
    weatherMoisture: 1,
    weatherGrowth: 1,
    cellCount: n,
    burstFlags: new Uint8Array(n),
  };
}

/** Advance the Markov-chain weather; consumes exactly ONE random draw. */
export function stepWeather(state: WorldStochState, rng: SplitMix64, matrix: number[][]): void {
  const row = matrix[state.weather]!;
  const u = rng.nextFloat();
  let acc = 0;
  let next = state.weather;
  for (let k = 0; k < row.length; k++) {
    acc += row[k]!;
    if (u < acc) {
      next = k;
      break;
    }
  }
  state.weather = next;
  state.weatherMoisture = WEATHER_MOISTURE[next]!;
  state.weatherGrowth = WEATHER_GROWTH[next]!;
}

/** OU fluctuation of the per-cell resource multiplier field. One gaussian/cell. */
export function stepOu(state: WorldStochState, rng: SplitMix64, cfg: WorldStochasticConfig, ts: number): void {
  const theta = cfg.ouTheta;
  const sigma = cfg.ouSigma;
  const lo = 1 - cfg.ouBand;
  const hi = 1 + cfg.ouBand;
  const sq = Math.sqrt(ts);
  const mul = state.ouMul;
  for (let i = 0; i < mul.length; i++) {
    const x = mul[i]! + theta * (1 - mul[i]!) * ts + sigma * sq * rng.nextGaussian();
    mul[i] = x < lo ? lo : x > hi ? hi : x;
  }
}

/** Poisson point process: vertex count of seeded events living this tick. */
export function poissonDraw(rng: SplitMix64, lambda: number): number {
  const L = Math.exp(-lambda);
  let k = 0;
  let p = 1;
  do {
    p *= rng.nextFloat();
    k++;
  } while (p > L && k < 1000);
  return k - 1;
}

/** Draw `count` distinct cells to burst-regenerate; zeroes the flag buffer
 *  first. Rejection-samples so each flagged cell is unique (a cell cannot be
 *  hit twice in one pulse). */
export function stepBurst(state: WorldStochState, rng: SplitMix64, count: number): void {
  const flags = state.burstFlags;
  flags.fill(0);
  if (count <= 0) return;
  const n = state.cellCount;
  const target = Math.min(count, n);
  let placed = 0;
  let guard = 0;
  while (placed < target && guard < count * 16) {
    const idx = rng.nextInt(n);
    if (flags[idx] === 0) {
      flags[idx] = 1;
      placed++;
    }
    guard++;
  }
}