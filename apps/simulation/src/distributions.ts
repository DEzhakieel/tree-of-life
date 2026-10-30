/**
 * Probability distributions — non-uniform random number generation from the
 * deterministic SplitMix64 PRNG.
 *
 * Contract (see `docs/MATHEMATICS.md`):
 *
 *  - Every sampler draws only from the `SplitMix64` instance passed in, so a
 *    caller that replays a seed replays the sample exactly.
 *  - Every sampler validates its parameters and throws `RangeError` rather than
 *    returning `NaN`, `Infinity`, or looping forever. The previous Poisson
 *    implementation looped forever for `lambda >= 30`; the limiting behaviour is
 *    covered by `test/mathContracts.test.ts` against the exact pmf.
 *  - Nobody in the engine calls these yet (the engine uses
 *    `SplitMix64.nextGaussian`), so fixing them cannot move any recorded result.
 *    They are verified so the first caller inherits correct distributions.
 */

import type { SplitMix64 } from './rng.js';

const TWO_PI = 2 * Math.PI;

function requireFinite(name: string, v: number): void {
  if (!Number.isFinite(v)) throw new RangeError(`${name} must be finite, got ${v}`);
}

function requirePositive(name: string, v: number): void {
  requireFinite(name, v);
  if (!(v > 0)) throw new RangeError(`${name} must be > 0, got ${v}`);
}

/** Lanczos approximation of ln Γ(x) for x > 0 (g = 7, n = 9, ~1e-15 relative). */
const LANCZOS = [
  0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
  -176.61502916214059, 12.507343278686905, -0.13857109526572012,
  9.9843695780195716e-6, 1.5056327351493116e-7,
];

export function logGamma(x: number): number {
  if (!(x > 0)) throw new RangeError(`logGamma domain is x > 0, got ${x}`);
  if (x < 0.5) {
    // reflection: Γ(x)Γ(1-x) = π / sin(πx)
    return Math.log(Math.PI / Math.sin(Math.PI * x)) - logGamma(1 - x);
  }
  const z = x - 1;
  let a = LANCZOS[0]!;
  for (let i = 1; i < LANCZOS.length; i++) a += LANCZOS[i]! / (z + i);
  const t = z + 7.5;
  return 0.5 * Math.log(TWO_PI) + (z + 0.5) * Math.log(t) - t + Math.log(a);
}

/** Exact Poisson pmf, exported for tests and for likelihood work. */
export function poissonPmf(k: number, lambda: number): number {
  if (!Number.isInteger(k) || k < 0) return 0;
  if (lambda === 0) return k === 0 ? 1 : 0;
  requirePositive('lambda', lambda);
  return Math.exp(k * Math.log(lambda) - lambda - logGamma(k + 1));
}

/**
 * Standard normal, Box-Muller. Two uniform draws per sample.
 *
 * `u1 = 0` is rejected rather than replaced by 1e-10: substituting a fixed
 * epsilon truncates the tail at ~6.8σ and biases the variance of every run in
 * which it fires.
 */
export function gaussianRng(rng: SplitMix64, mean = 0, stddev = 1): number {
  requireFinite('mean', mean);
  requireFinite('stddev', stddev);
  if (stddev < 0) throw new RangeError(`stddev must be >= 0, got ${stddev}`);
  let u1 = 0;
  while (u1 === 0) u1 = rng.nextFloat();
  const u2 = rng.nextFloat();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(TWO_PI * u2) * stddev + mean;
}

/**
 * Exponential distribution with rate λ; mean 1/λ, variance 1/λ².
 * Uses `log1p` so small draws keep full relative precision.
 */
export function exponentialRng(rng: SplitMix64, rate: number): number {
  requirePositive('rate', rate);
  let u = 0;
  while (u === 0) u = rng.nextFloat();
  return -Math.log1p(-u) / rate;
}

/**
 * Poisson distribution.
 *
 * `lambda < 30`  Knuth's product method (exact, O(λ)).
 * `lambda >= 30` Ahrens–Dieter (1982) logistic rejection envelope, exact up to
 *                floating point and O(1) per draw.
 *
 * `lambda === 0` returns 0 without consuming a draw.
 */
export function poissonRng(rng: SplitMix64, lambda: number): number {
  requireFinite('lambda', lambda);
  if (lambda < 0) throw new RangeError(`lambda must be >= 0, got ${lambda}`);
  if (lambda === 0) return 0;

  if (lambda < 30) {
    const L = Math.exp(-lambda);
    let k = 0;
    let p = 1;
    do {
      k++;
      p *= rng.nextFloat();
    } while (p > L);
    return k - 1;
  }

  // Ahrens–Dieter: a logistic envelope centred so that the rounded value is the
  // candidate count, accepted against the exact Poisson pmf in log space.
  const c = 0.767 - 3.36 / lambda;
  const beta = Math.PI / Math.sqrt(3 * lambda);
  const alpha = beta * lambda;
  const k = Math.log(c) - lambda - Math.log(beta);
  for (;;) {
    let u = 0;
    while (u === 0) u = rng.nextFloat();
    const x = (alpha - Math.log((1 - u) / u)) / beta;
    const n = Math.floor(x + 0.5);
    if (n < 0) continue;
    let v = 0;
    while (v === 0) v = rng.nextFloat();
    const y = alpha - beta * x;
    // log( v / (1 + e^y)^2 ) without overflow for large |y|
    const logAccept = y + Math.log(v) - 2 * Math.log1p(Math.exp(y));
    const logPmf = k + n * Math.log(lambda) - logGamma(n + 1);
    if (logAccept <= logPmf) return n;
  }
}

/**
 * Gamma distribution (shape k, scale θ); mean kθ, variance kθ².
 * Marsaglia–Tsang for k ≥ 1; the boost `u^(1/k)` for k < 1.
 */
export function gammaRng(rng: SplitMix64, shape: number, scale: number): number {
  requirePositive('shape', shape);
  requirePositive('scale', scale);
  if (shape < 1) {
    return gammaRng(rng, shape + 1, scale) * Math.pow(rng.nextFloat(), 1 / shape);
  }
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x = 0;
    let v = 0;
    do {
      x = gaussianRng(rng);
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;
    const u = rng.nextFloat();
    if (u < 1 - 0.0331 * (x * x) * (x * x)) return d * v * scale;
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v * scale;
  }
}

/** Beta(α, β) as the ratio of two gamma variates; mean α/(α+β). */
export function betaRng(rng: SplitMix64, alpha: number, beta: number): number {
  requirePositive('alpha', alpha);
  requirePositive('beta', beta);
  for (let attempt = 0; attempt < 64; attempt++) {
    const ga = gammaRng(rng, alpha, 1);
    const gb = gammaRng(rng, beta, 1);
    const s = ga + gb;
    if (s > 0 && Number.isFinite(s)) return ga / s;
  }
  // Both gamma draws underflowed (only reachable for absurdly small shapes).
  return alpha / (alpha + beta);
}

/**
 * Von Mises distribution on [0, 2π) — the circular analogue of the normal.
 * κ is the concentration (0 = uniform); μ is the mean direction.
 * Best–Fisher (1979) rejection sampling, as used by Ahrens–Dieter.
 */
export function vonMisesRng(rng: SplitMix64, mu: number, kappa: number): number {
  requireFinite('mu', mu);
  requireFinite('kappa', kappa);
  if (kappa < 0) throw new RangeError(`kappa must be >= 0, got ${kappa}`);
  if (kappa < 1e-6) return rng.nextFloat() * TWO_PI;
  const a = 1 + Math.sqrt(1 + 4 * kappa * kappa);
  const b = (a - Math.sqrt(2 * a)) / (2 * kappa);
  const r = (1 + b * b) / (2 * b);
  for (;;) {
    const u1 = rng.nextFloat();
    const u2 = rng.nextFloat();
    const z = Math.cos(Math.PI * u1);
    const f = (1 + r * z) / (r + z);
    const cc = kappa * (r - f);
    if (cc * (2 - cc) - u2 > 0 || Math.log(cc / u2) + 1 - cc >= 0) {
      const u3 = rng.nextFloat();
      const sign = u3 > 0.5 ? 1 : -1;
      // Positive modulo: a negative draw for mu = 0 must not escape [0, 2π).
      return ((sign * Math.acos(f) + mu) % TWO_PI + TWO_PI) % TWO_PI;
    }
  }
}

/**
 * Multivariate normal N(μ, Σ) by Cholesky factorisation Σ = LLᵀ.
 *
 * `x = μ + L z` with **independent** z_j ~ N(0,1). The previous version reused a
 * single z for every column and drew a second, unused normal per row, which
 * produced the correct marginals but destroyed every correlation: for
 * Σ = [[1, 0.8], [0.8, 1]] it returned var(y) = 1.97 and corr = 0.00.
 */
export function multivariateGaussianRng(
  rng: SplitMix64,
  mean: Float64Array,
  covariance: Float64Array,
  dim: number,
): Float64Array {
  if (!Number.isInteger(dim) || dim <= 0) throw new RangeError(`dim must be a positive integer, got ${dim}`);
  if (mean.length < dim) throw new RangeError(`mean has ${mean.length} entries, need ${dim}`);
  if (covariance.length < dim * dim) throw new RangeError(`covariance has ${covariance.length} entries, need ${dim * dim}`);

  const L = new Float64Array(dim * dim);
  for (let i = 0; i < dim; i++) {
    for (let j = 0; j <= i; j++) {
      let sum = 0;
      for (let k = 0; k < j; k++) sum += L[i * dim + k]! * L[j * dim + k]!;
      if (i === j) {
        const diag = covariance[i * dim + i]! - sum;
        if (!(diag >= -1e-12)) {
          throw new RangeError(`covariance is not positive semi-definite (diagonal ${i} = ${diag})`);
        }
        L[i * dim + j] = Math.sqrt(Math.max(0, diag));
      } else {
        const lj = L[j * dim + j]!;
        L[i * dim + j] = lj > 0 ? (covariance[i * dim + j]! - sum) / lj : 0;
      }
    }
  }

  const z = new Float64Array(dim);
  for (let j = 0; j < dim; j++) z[j] = gaussianRng(rng);
  const result = new Float64Array(dim);
  for (let i = 0; i < dim; i++) {
    let sum = 0;
    for (let j = 0; j <= i; j++) sum += L[i * dim + j]! * z[j]!;
    result[i] = mean[i]! + sum;
  }
  return result;
}

/** Logistic distribution; mean μ, variance (πs)²/3. */
export function logisticRng(rng: SplitMix64, mean = 0, scale = 1): number {
  requireFinite('mean', mean);
  requirePositive('scale', scale);
  let u = 0;
  while (u === 0) u = rng.nextFloat();
  return mean + scale * Math.log(u / (1 - u));
}

/** Bernoulli trial; throws outside p ∈ [0, 1] instead of silently inverting. */
export function bernoulliRng(rng: SplitMix64, p: number): boolean {
  requireFinite('p', p);
  if (p < 0 || p > 1) throw new RangeError(`p must be in [0,1], got ${p}`);
  if (p === 0) return false;
  if (p === 1) return true;
  return rng.nextFloat() < p;
}
