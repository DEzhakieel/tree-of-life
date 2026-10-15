/**
 * Reusable signature extractors for the benchmark models.
 *
 * Pure, deterministic math — no RNG, no I/O beyond hashing. The entropy and
 * Pearson-correlation primitives are the same ones the research layer already
 * uses (`complexity.ts`), so a benchmark signature agrees with the rest of the
 * field guide by construction.
 */

import { createHash } from 'node:crypto';
import { entropyOf, corr } from '../complexity.js';

export { entropyOf, corr };

export interface Linfit {
  slope: number;
  intercept: number;
  r2: number;
}

/** ordinary least-squares fit y = slope·x + intercept. */
export function linreg(xs: number[], ys: number[]): Linfit {
  const n = Math.min(xs.length, ys.length);
  if (n < 2) return { slope: 0, intercept: ys[0] ?? 0, r2: 0 };
  let sx = 0;
  let sy = 0;
  for (let i = 0; i < n; i++) {
    sx += xs[i]!;
    sy += ys[i]!;
  }
  const mx = sx / n;
  const my = sy / n;
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i]! - mx;
    const dy = ys[i]! - my;
    sxx += dx * dx;
    sxy += dx * dy;
    syy += dy * dy;
  }
  const slope = sxx > 1e-15 ? sxy / sxx : 0;
  const intercept = my - slope * mx;
  const r2 = sxx > 1e-15 && syy > 1e-15 ? (sxy * sxy) / (sxx * syy) : 0;
  return { slope, intercept, r2 };
}

/** slope of log-log(ys) vs log-log(xs); the anomalous-diffusion exponent for MSD. */
export function logLogSlope(xs: number[], ys: number[]): number {
  const lx: number[] = [];
  const ly: number[] = [];
  for (let i = 0; i < Math.min(xs.length, ys.length); i++) {
    if (xs[i]! > 0 && ys[i]! > 0) {
      lx.push(Math.log10(xs[i]!));
      ly.push(Math.log10(ys[i]!));
    }
  }
  return linreg(lx, ly).slope;
}

/** mean of xs. */
export function mean(xs: number[]): number {
  if (xs.length === 0) return NaN;
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

/** population variance of xs. */
export function variance(xs: number[]): number {
  const n = xs.length;
  if (n === 0) return 0;
  const m = mean(xs);
  let s = 0;
  for (const x of xs) s += (x - m) * (x - m);
  return s / n;
}

/** normalised autocorrelation of a series at a given lag. */
export function autocorrAt(xs: number[], lag: number): number {
  const n = xs.length;
  if (lag <= 0 || lag >= n) return 0;
  const a = xs.slice(0, n - lag);
  const b = xs.slice(lag);
  return corr(a, b);
}

/**
 * Dominant period from the autocorrelation function: the first interior local
 * maximum (with a positive floor) scanning lags 1..maxLag. Returns maxLag+1 if
 * no interior peak is found.
 */
export function dominantPeriod(xs: number[], maxLag: number, floor = 0.1): number {
  if (xs.length < 4 || maxLag < 2) return maxLag + 1;
  const lag = Math.min(maxLag, Math.floor(xs.length / 3));
  const ac: number[] = new Array(lag + 1).fill(0);
  for (let k = 1; k <= lag; k++) ac[k] = autocorrAt(xs, k);
  for (let k = 2; k <= lag - 1; k++) {
    if (ac[k]! > floor && ac[k]! > ac[k - 1]! && ac[k]! >= ac[k + 1]!) return k;
  }
  // fall back to the global argmax above the floor
  let best = -1;
  let bestV = floor;
  for (let k = 1; k <= lag; k++) {
    if (ac[k]! > bestV) {
      bestV = ac[k]!;
      best = k;
    }
  }
  return best > 0 ? best : maxLag + 1;
}

/** best lag (positive = b trails a) and correlation of the cross-correlation. */
export function crossCorrBest(a: number[], b: number[], maxLag: number): { lag: number; corr: number } {
  let bestLag = 0;
  let bestC = -Infinity;
  for (let lag = 0; lag <= maxLag; lag++) {
    const n = Math.min(a.length, b.length) - lag;
    if (n < 4) break;
    const aa = a.slice(0, n);
    const bb = b.slice(lag, lag + n);
    const c = corr(aa, bb);
    if (c > bestC) {
      bestC = c;
      bestLag = lag;
    }
  }
  return { lag: bestLag, corr: bestC === -Infinity ? 0 : bestC };
}

/** Gini coefficient of a non-negative distribution, in [0,1). */
export function gini(xs: number[]): number {
  const n = xs.length;
  if (n === 0) return 0;
  const s = [...xs].sort((x, y) => x - y);
  let sum = 0;
  for (let i = 0; i < n; i++) sum += s[i]!;
  if (sum <= 1e-15) return 0;
  let cum = 0;
  for (let i = 0; i < n; i++) cum += (i + 1) * s[i]!;
  return (2 * cum) / (n * sum) - (n + 1) / n;
}

export interface GridStats {
  mean: number;
  variance: number;
  max: number;
  /** fraction of cells strictly above `threshold` */
  occupiedFraction: number;
}

/** summary statistics of a scalar grid. */
export function gridStats(grid: ArrayLike<number>, threshold = 0): GridStats {
  const n = grid.length;
  if (n === 0) return { mean: 0, variance: 0, max: 0, occupiedFraction: 0 };
  let m = 0;
  let mx = -Infinity;
  let occ = 0;
  for (let i = 0; i < n; i++) {
    const v = grid[i]!;
    m += v;
    if (v > mx) mx = v;
    if (v > threshold) occ++;
  }
  m /= n;
  let s = 0;
  for (let i = 0; i < n; i++) {
    const d = grid[i]! - m;
    s += d * d;
  }
  return { mean: m, variance: s / n, max: mx, occupiedFraction: occ / n };
}

/**
 * Number of 4-connected components of cells above `threshold` on a torus
 * (wrapping in both axes). Deterministic scan + flood fill.
 */
export function connectedComponents(grid: ArrayLike<number>, size: number, threshold = 0): number {
  const total = size * size;
  const seen = new Uint8Array(total);
  let components = 0;
  const stack: number[] = [];
  for (let start = 0; start < total; start++) {
    if (seen[start] || grid[start]! <= threshold) continue;
    components++;
    stack.length = 0;
    stack.push(start);
    seen[start] = 1;
    while (stack.length) {
      const i = stack.pop()!;
      const x = i % size;
      const y = (i / size) | 0;
      const neighbours = [
        [x, (y - 1 + size) % size],
        [x, (y + 1) % size],
        [(x - 1 + size) % size, y],
        [(x + 1) % size, y],
      ];
      for (const [nx, ny] of neighbours) {
        const j = ny! * size + nx!;
        if (!seen[j] && grid[j]! > threshold) {
          seen[j] = 1;
          stack.push(j);
        }
      }
    }
  }
  return components;
}

/** exact equality of two byte grids. */
export function gridsEqual(a: ArrayLike<number>, b: ArrayLike<number>): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** sha256 over the rounded entries of one or more numeric arrays. */
export function sha256OfNumbers(...arrays: ArrayLike<number>[]): string {
  const h = createHash('sha256');
  for (const arr of arrays) {
    const buf = new Int32Array(arr.length);
    for (let i = 0; i < arr.length; i++) buf[i] = Math.round(arr[i]! * 1e6);
    h.update(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength));
  }
  return h.digest('hex');
}
