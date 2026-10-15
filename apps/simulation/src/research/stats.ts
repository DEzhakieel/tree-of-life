/**
 * Dependency-free statistics for the reproducibility harness.
 *
 * All functions take plain number arrays so scenario results are easy to slice
 * by column. Sampling uses a seeded PRNG so the *analysis itself* is
 * reproducible (a run's confidence intervals / p-values can be re-derived).
 */

/** Mulberry32: tiny seeded PRNG. Deterministic given the same seed. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function mean(xs: number[]): number {
  if (xs.length === 0) return NaN;
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

/** Sample standard deviation (n-1). */
export function stdev(xs: number[]): number {
  const n = xs.length;
  if (n < 2) return 0;
  const m = mean(xs);
  let s = 0;
  for (const x of xs) s += (x - m) * (x - m);
  return Math.sqrt(s / (n - 1));
}

export function median(xs: number[]): number {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[mid - 1]! + s[mid]!) / 2 : s[mid]!;
}

/** Quantile at p in [0,1] using linear interpolation between ordered samples. */
export function quantile(xs: number[], p: number): number {
  const n = xs.length;
  if (n === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const pos = (n - 1) * Math.min(1, Math.max(0, p));
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return lo === hi ? s[lo]! : s[lo]! + (s[hi]! - s[lo]!) * (pos - lo);
}

export interface BootstrapCI {
  mean: number;
  se: number;
  lo: number;
  hi: number;
  /** fraction of the bootstrap distribution on each side of zero */
  pRight: number;
  /** 0 if CI contains zero, otherwise sign of the effect */
  sign: -1 | 0 | 1;
}

/**
 * Bias-corrected bootstrap confidence interval for the mean, plus a non-
 * parametric "significance" surrogate: the proportion of bootstrap means on
 * either side of zero (a cheap, distribution-free p-value proxy).
 *
 * @param xs samples
 * @param opts.r seed for the bootstrap RNG (deterministic)
 * @param opts.samples number of resamples
 */
export function bootstrapCI(xs: number[], opts: { r: number; samples?: number }): BootstrapCI {
  const samples = opts.samples ?? 2000;
  const rng = mulberry32(opts.r);
  const n = xs.length;
  const boot = new Array<number>(samples);
  for (let b = 0; b < samples; b++) {
    let s = 0;
    for (let i = 0; i < n; i++) s += xs[Math.floor(rng() * n)]!;
    boot[b] = s / n;
  }
  const m = mean(boot);
  const sd = stdev(boot);
  const lo = quantile(boot, 0.025);
  const hi = quantile(boot, 0.975);
  let pRight = 0;
  for (const v of boot) if (v > 0) pRight++;
  pRight /= samples;
  return { mean: m, se: sd, lo, hi, pRight, sign: lo > 0 ? 1 : hi < 0 ? -1 : 0 };
}

/**
 * Two-sided permutation test for the difference of means.
 * @returns empirical p-value: fraction of permutations with |d*| >= |d_obs|.
 */
export function permutationP(groupA: number[], groupB: number[], opts: { r: number; permutations?: number }): number {
  const permutations = opts.permutations ?? 10000;
  const rng = mulberry32(opts.r);
  const all = [...groupA, ...groupB];
  const nA = groupA.length;
  const n = all.length;
  const meanA = mean(groupA);
  const meanB = mean(groupB);
  const obs = Math.abs(meanA - meanB);
  if (obs === 0) return 1;
  let count = 0;
  for (let p = 0; p < permutations; p++) {
    // Fisher-Yates shuffle of indices
    for (let i = n - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const tmp = all[i]!;
      all[i] = all[j]!;
      all[j] = tmp;
    }
    let sA = 0;
    for (let i = 0; i < nA; i++) sA += all[i]!;
    const d = Math.abs(sA / nA - (all.reduce((x, y) => x + y, 0) - sA) / (n - nA));
    if (d >= obs) count++;
  }
  return (count + 1) / (permutations + 1);
}

/** Cohen's d (pooled SD). Positive => group A mean exceeds group B mean. */
export function cohensD(groupA: number[], groupB: number[]): number {
  const nA = groupA.length;
  const nB = groupB.length;
  if (nA < 2 || nB < 2) return NaN;
  const mA = mean(groupA);
  const mB = mean(groupB);
  const vA = stdev(groupA) ** 2;
  const vB = stdev(groupB) ** 2;
  const pooled = Math.sqrt(((nA - 1) * vA + (nB - 1) * vB) / (nA + nB - 2));
  if (pooled === 0) return mA === mB ? 0 : NaN;
  return (mA - mB) / pooled;
}

/** Wilson score interval for a binomial proportion (e.g. completion rate). */
export function wilsonCI(k: number, n: number, z = 1.959963984540054): { p: number; lo: number; hi: number } {
  if (n === 0) return { p: NaN, lo: NaN, hi: NaN };
  const p = k / n;
  const denom = 1 + z * z / n;
  const centre = p + z * z / (2 * n);
  const margin = (z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))) / denom;
  return {
    p,
    lo: Math.max(0, (centre - margin) / denom),
    hi: Math.min(1, (centre + margin) / denom),
  };
}

export function fmt(x: number, digits = 4): string {
  if (Number.isNaN(x)) return 'NaN';
  if (!Number.isFinite(x)) return x > 0 ? 'Inf' : '-Inf';
  return x.toFixed(digits);
}

export function fmtP(p: number): string {
  if (Number.isNaN(p)) return 'NaN';
  if (p < 0.001) return '< 0.001';
  return p.toFixed(3);
}

/** Human-readable effect-size descriptor following common conventions. */
export function effectLabel(d: number): string {
  const a = Math.abs(d);
  if (Number.isNaN(a)) return 'n/a';
  if (a < 0.2) return 'negligible';
  if (a < 0.5) return 'small';
  if (a < 0.8) return 'medium';
  return 'large';
}
