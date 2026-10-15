import { fnv1a32 } from '@fractal-life/shared';

/**
 * Phase M measurement layer: descriptive statistics, classical hypothesis
 * tests, bootstrap resampling, and exact binomial intervals — all in plain
 * TypeScript with deterministic seeds (mulberry32 / fnv1a32), so every number
 * in the research reports is reproducible bit-for-bit.
 *
 * Numerics:
 *  - Student-t CDF and F CDF go through the regularized incomplete beta
 *    function (Lanczos lgamma + Lentz continued fraction), so p-values are
 *    accurate to ~1e-9 instead of table lookups.
 *  - Confidence intervals default to Student-t (small n); bootstrap intervals
 *    are percentile-based with a fixed seed per call site.
 *  - Clopper-Pearson gives exact (conservative) binomial intervals — used for
 *    lattice colonization proportions. Caveat documented in the reports: cells
 *    in one lattice are spatially correlated, so those intervals are
 *    anti-conservative as *ecological* uncertainty (they describe cell-level
 *    draw noise only).
 */

/** deterministic 32-bit stream (the same mulberry32 used by the lattice
 *  harness — the 64-bit splitmix constant overflows JS doubles). */
export function mulberry32(seed: number): () => number {
  let s = seed >>> 0 || 0x6d2b79f5;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function seedFrom(key: string): number {
  return fnv1a32(key);
}

// ---- descriptive ----

export function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

/** sample standard deviation (Bessel-corrected) */
export function sd(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1));
}

export function se(xs: number[]): number {
  return sd(xs) / Math.sqrt(xs.length);
}

export function quantile(xs: number[], q: number): number {
  const s = [...xs].sort((a, b) => a - b);
  if (s.length === 1) return s[0];
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}

export function median(xs: number[]): number {
  return quantile(xs, 0.5);
}

export interface Summary {
  n: number;
  mean: number;
  sd: number;
  se: number;
  median: number;
  ci95: [number, number];
  min: number;
  max: number;
}

export function summarize(xs: number[]): Summary {
  const m = mean(xs);
  const s = sd(xs);
  const h = tCritical(xs.length - 1) * (s / Math.sqrt(xs.length));
  return {
    n: xs.length,
    mean: m,
    sd: s,
    se: s / Math.sqrt(xs.length),
    median: median(xs),
    ci95: [m - h, m + h],
    min: Math.min(...xs),
    max: Math.max(...xs),
  };
}

// ---- Student-t critical values (two-sided 95%) ----

const T975 = [
  0, 12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228,
  2.201, 2.179, 2.16, 2.145, 2.131, 2.12, 2.11, 2.101, 2.093, 2.086, 2.08,
  2.074, 2.069, 2.064, 2.06, 2.056, 2.052, 2.048, 2.045, 2.042,
];

/** two-sided 95% Student-t critical value (table ≤ 30 df, Cornish-Fisher beyond) */
export function tCritical(df: number): number {
  if (df <= 0) return Infinity;
  if (df < T975.length) return T975[df];
  const z = 1.959963984540054;
  const v = df;
  return (
    z +
    (z ** 3 + z) / (4 * v) +
    (5 * z ** 5 + 16 * z ** 3 + 3 * z) / (96 * v * v)
  );
}

// ---- special functions: lgamma, incomplete beta ----

const LANCZOS = [
  676.5203681218851, -1259.1392167224028, 771.32342877765313,
  -176.61502916214059, 12.507343278686905, -0.13857109526572012,
  9.9843695780195716e-6, 1.5056327351493116e-7,
];

export function lgamma(z: number): number {
  if (z < 0.5) {
    return Math.log(Math.PI / Math.sin(Math.PI * z)) - lgamma(1 - z);
  }
  z -= 1;
  let x = 0.99999999999980993;
  for (let i = 0; i < LANCZOS.length; i++) {
    x += LANCZOS[i] / (z + i + 1);
  }
  const t = z + LANCZOS.length - 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
}

function betacf(a: number, b: number, x: number): number {
  const MAXIT = 200;
  const EPS = 3e-14;
  const FPMIN = 1e-300;
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= MAXIT; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return h;
}

/** regularized incomplete beta I_x(a, b) */
export function betai(a: number, b: number, x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const front = Math.exp(
    lgamma(a + b) - lgamma(a) - lgamma(b) + a * Math.log(x) + b * Math.log(1 - x),
  );
  return x < (a + 1) / (a + b + 2)
    ? (front * betacf(a, b, x)) / a
    : 1 - (front * betacf(b, a, 1 - x)) / b;
}

/** two-sided p-value for an observed t statistic */
export function pFromT(t: number, df: number): number {
  if (!isFinite(t) || df <= 0) return 1;
  return betai(df / 2, 0.5, df / (df + t * t));
}

// ---- hypothesis tests ----

export interface WelchResult {
  meanA: number;
  meanB: number;
  meanDiff: number;
  t: number;
  df: number;
  p: number;
  cohensD: number;
}

/** Welch's two-sample t-test (unequal variances) */
export function welch(a: number[], b: number[]): WelchResult {
  const ma = mean(a);
  const mb = mean(b);
  const va = sd(a) ** 2;
  const vb = sd(b) ** 2;
  const na = a.length;
  const nb = b.length;
  const se2 = va / na + vb / nb;
  const t = se2 === 0 ? 0 : (ma - mb) / Math.sqrt(se2);
  const df =
    se2 === 0
      ? 1
      : (se2 * se2) /
        ((va / na) ** 2 / (na - 1) + (vb / nb) ** 2 / (nb - 1));
  const pooled = Math.sqrt(((na - 1) * va + (nb - 1) * vb) / (na + nb - 2));
  return {
    meanA: ma,
    meanB: mb,
    meanDiff: ma - mb,
    t,
    df,
    p: pFromT(t, df),
    cohensD: pooled === 0 ? 0 : (ma - mb) / pooled,
  };
}

export interface PairedResult {
  meanDiff: number;
  sdDiff: number;
  t: number;
  df: number;
  p: number;
  cohensDz: number;
}

/** paired t-test over matched observations (same habitat on both sides) */
export function pairedT(a: number[], b: number[]): PairedResult {
  if (a.length !== b.length) throw new Error('pairedT: length mismatch');
  const diffs = a.map((v, i) => v - b[i]);
  const md = mean(diffs);
  const s = sd(diffs);
  const n = diffs.length;
  const t = s === 0 ? 0 : md / (s / Math.sqrt(n));
  return {
    meanDiff: md,
    sdDiff: s,
    t,
    df: n - 1,
    p: pFromT(t, n - 1),
    cohensDz: s === 0 ? 0 : md / s,
  };
}

export interface AnovaResult {
  f: number;
  df1: number;
  df2: number;
  p: number;
  ssBetween: number;
  ssWithin: number;
}

/** one-way ANOVA (equal n per group not required) */
export function anova(groups: number[][]): AnovaResult {
  const all = groups.flat();
  const grand = mean(all);
  const k = groups.length;
  const n = all.length;
  let ssBetween = 0;
  let ssWithin = 0;
  for (const g of groups) {
    ssBetween += g.length * (mean(g) - grand) ** 2;
    const mg = mean(g);
    for (const x of g) ssWithin += (x - mg) ** 2;
  }
  const df1 = k - 1;
  const df2 = n - k;
  const ms1 = ssBetween / df1;
  const ms2 = ssWithin / df2;
  const f = ms2 === 0 ? 0 : ms1 / ms2;
  // P(F > f) for F ~ F(df1, df2): p = I_{df2 / (df2 + df1 f)}(df2/2, df1/2)
  const p = f <= 0 ? 1 : betai(df2 / 2, df1 / 2, df2 / (df2 + df1 * f));
  return { f, df1, df2, p, ssBetween, ssWithin };
}

// ---- bootstrap ----

export type Statistic = (xs: number[]) => number;

/** percentile bootstrap CI for a statistic over one sample */
export function bootstrapCI(
  xs: number[],
  stat: Statistic = mean,
  opts: { B?: number; alpha?: number; seedKey?: string } = {},
): [number, number] {
  const B = opts.B ?? 5000;
  const alpha = opts.alpha ?? 0.05;
  const rng = mulberry32(seedFrom(opts.seedKey ?? 'bootstrap'));
  const n = xs.length;
  const stats: number[] = [];
  for (let b = 0; b < B; b++) {
    const sample: number[] = [];
    for (let i = 0; i < n; i++) sample.push(xs[Math.floor(rng() * n)]);
    stats.push(stat(sample));
  }
  stats.sort((x, y) => x - y);
  return [quantile(stats, alpha / 2), quantile(stats, 1 - alpha / 2)];
}

export interface BootstrapWin {
  /** fraction of resamples where mean(a) > mean(b) */
  pWin: number;
  /** percentile CI for the mean difference */
  ci95: [number, number];
  meanDiff: number;
  B: number;
}

/** paired bootstrap over matched pairs: P(mean(a − b) > 0) */
export function pairedBootstrapWin(
  a: number[],
  b: number[],
  opts: { B?: number; seedKey?: string } = {},
): BootstrapWin {
  if (a.length !== b.length) throw new Error('pairedBootstrapWin: length mismatch');
  const B = opts.B ?? 5000;
  const rng = mulberry32(seedFrom(opts.seedKey ?? 'paired-win'));
  const n = a.length;
  const diffs = a.map((v, i) => v - b[i]);
  const stats: number[] = [];
  let wins = 0;
  for (let i = 0; i < B; i++) {
    let acc = 0;
    for (let j = 0; j < n; j++) acc += diffs[Math.floor(rng() * n)];
    const m = acc / n;
    stats.push(m);
    if (m > 0) wins++;
  }
  stats.sort((x, y) => x - y);
  return {
    pWin: wins / B,
    ci95: [quantile(stats, 0.025), quantile(stats, 0.975)],
    meanDiff: mean(diffs),
    B,
  };
}

// ---- exact binomial intervals (Clopper–Pearson) ----

function betaQuantile(target: number, a: number, b: number): number {
  // invert I_x(a, b) by bisection — monotone on (0, 1)
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    if (betai(a, b, mid) < target) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** exact (Clopper–Pearson) two-sided (1 − alpha) CI for a binomial proportion */
export function clopperPearson(k: number, n: number, alpha = 0.05): [number, number] {
  if (n <= 0) return [0, 1];
  const lo = k === 0 ? 0 : betaQuantile(alpha / 2, k, n - k + 1);
  const hi = k === n ? 1 : betaQuantile(1 - alpha / 2, k + 1, n - k);
  return [lo, hi];
}

export interface ProportionTest {
  pA: number;
  pB: number;
  z: number;
  p: number;
}

/** two-proportion z-test (pooled) — used for lattice 1D vs 2D colonization */
export function twoProportionZ(kA: number, nA: number, kB: number, nB: number): ProportionTest {
  const pooled = (kA + kB) / (nA + nB);
  const seP = Math.sqrt(pooled * (1 - pooled) * (1 / nA + 1 / nB));
  const z = seP === 0 ? 0 : (kA / nA - kB / nB) / seP;
  // two-sided normal p via erfc approximation
  const p = 2 * (1 - normCdf(Math.abs(z)));
  return { pA: kA / nA, pB: kB / nB, z, p };
}

/** Abramowitz–Stegun 7.1.26 error function approximation */
function erf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * ax);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) *
      t +
      0.254829592) *
      t *
      Math.exp(-ax * ax);
  return sign * y;
}

function normCdf(z: number): number {
  return 0.5 * (1 + erf(z / Math.SQRT2));
}
