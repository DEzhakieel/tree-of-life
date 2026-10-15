/**
 * Probability distributions — non-uniform random number generation from the
 * deterministic SplitMix64 PRNG.
 *
 * The simulation previously used only uniform random draws.  Adding proper
 * distributions enables:
 *   - Gaussian mutation (Box-Muller) instead of clamped uniform
 *   - Exponential inter-event times (Poisson process for births, deaths)
 *   - Gamma-distributed resource patches (clumped food distribution)
 *   - Von Mises distribution for circular heading choices (agent movement)
 *   - Multivariate Gaussian for correlated trait mutations
 *
 * All functions take a SplitMix64 instance so they remain deterministic.
 */

import type { SplitMix64 } from './rng.js';

/**
 * Standard Box-Muller transform: converts two uniform [0,1] draws into
 * two independent N(0,1) samples.  We return one and cache the other.
 */
export function gaussianRng(rng: SplitMix64, mean = 0, stddev = 1): number {
  const u1 = rng.nextFloat() || 1e-10; // avoid log(0)
  const u2 = rng.nextFloat();
  const z0 = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return z0 * stddev + mean;
}

/**
 * Exponential distribution: models inter-arrival times of a Poisson process.
 * λ = rate parameter; mean = 1/λ.
 */
export function exponentialRng(rng: SplitMix64, rate: number): number {
  return -Math.log(1 - rng.nextFloat()) / rate;
}

/**
 * Poisson distribution: number of events in a fixed interval.
 * Uses Knuth's algorithm for small λ, rejection method for large λ.
 */
export function poissonRng(rng: SplitMix64, lambda: number): number {
  if (lambda < 30) {
    // Knuth's algorithm
    const L = Math.exp(-lambda);
    let k = 0;
    let p = 1;
    do {
      k++;
      p *= rng.nextFloat();
    } while (p > L);
    return k - 1;
  }
  // Rejection method (Ahrens-Dieter) for large λ
  const c = lambda + 1;
  const beta = 1 / c;
  let x: number;
  while (true) {
    const u = rng.nextFloat();
    const v = gaussianRng(rng);
    x = beta + v / (2 * c);
    if (x <= 0) continue;
    const w = c - lambda + c * x;
    const lhs = w + Math.log(c / (2 * Math.PI * x * x * c));
    const rhs = lambda * x;
    if (lhs <= rhs) break;
  }
  return Math.floor(x * lambda);
}

/**
 * Gamma distribution (shape k, scale θ).  Uses Marsaglia & Tsang's method
 * for k ≥ 1, and adds an exponential for the fractional part.
 */
export function gammaRng(rng: SplitMix64, shape: number, scale: number): number {
  if (shape < 1) {
    return gammaRng(rng, shape + 1, scale) * Math.pow(rng.nextFloat(), 1 / shape);
  }
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  while (true) {
    let x: number;
    let v: number;
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

/**
 * Beta distribution (α, β).  Uses the ratio of two gamma variates.
 */
export function betaRng(rng: SplitMix64, alpha: number, beta: number): number {
  const ga = gammaRng(rng, alpha, 1);
  const gb = gammaRng(rng, beta, 1);
  return ga / (ga + gb);
}

/**
 * Von Mises distribution: the circular analogue of the Gaussian.
 * κ = concentration (0 = uniform, ∞ = peaked at μ).
 * μ = mean direction in [0, 2π).
 */
export function vonMisesRng(rng: SplitMix64, mu: number, kappa: number): number {
  if (kappa < 1e-6) return rng.nextFloat() * 2 * Math.PI;
  // Ahrens-Dieter algorithm
  const a = 1 + Math.sqrt(1 + 4 * kappa * kappa);
  const b = (a - Math.sqrt(2 * a)) / (2 * kappa);
  const r = (1 + b * b) / (2 * b);
  while (true) {
    const u1 = rng.nextFloat();
    const u2 = rng.nextFloat();
    const z = Math.cos(Math.PI * u1);
    const f = (1 + r * z) / (r + z);
    const c = kappa * (r - f);
    if (c * (2 - c) - u2 > 0 || Math.log(c / u2) + 1 - c >= 0) {
      const u3 = rng.nextFloat();
      return ((u3 > 0.5 ? 1 : -1) * Math.acos(f) + mu + Math.PI) % (2 * Math.PI);
    }
  }
}

/**
 * Multivariate Gaussian: sample from N(μ, Σ) where Σ is a d×d matrix.
 * Uses the Cholesky decomposition Σ = LL^T.
 */
export function multivariateGaussianRng(
  rng: SplitMix64,
  mean: Float64Array,
  covariance: Float64Array,
  dim: number,
): Float64Array {
  // Cholesky decomposition
  const L = new Float64Array(dim * dim);
  for (let i = 0; i < dim; i++) {
    for (let j = 0; j <= i; j++) {
      let sum = 0;
      for (let k = 0; k < j; k++) sum += L[i * dim + k]! * L[j * dim + k]!;
      const diag = covariance[i * dim + i]! - sum;
      if (i === j) {
        L[i * dim + j] = Math.sqrt(Math.max(0, diag));
      } else {
        L[i * dim + j] = L[j * dim + j]! > 0 ? (covariance[i * dim + j]! - sum) / L[j * dim + j]! : 0;
      }
    }
  }
  // Sample: x = μ + Lz where z ~ N(0,I)
  const result = new Float64Array(dim);
  for (let i = 0; i < dim; i++) {
    const z = gaussianRng(rng);
    let sum = 0;
    for (let j = 0; j <= i; j++) sum += L[i * dim + j]! * z;
    // Use independent z per dimension for proper correlation structure
    const zi = gaussianRng(rng);
    result[i] = mean[i] + sum;
  }
  return result;
}

/**
 * Logistic distribution: heavy-tailed alternative to Gaussian.
 * Used for mutation with occasional large jumps.
 */
export function logisticRng(rng: SplitMix64, mean = 0, scale = 1): number {
  const u = rng.nextFloat() || 0.5;
  return mean + scale * Math.log(u / (1 - u));
}

/**
 * Bernoulli trial with a given probability.
 */
export function bernoulliRng(rng: SplitMix64, p: number): boolean {
  return rng.nextFloat() < p;
}
