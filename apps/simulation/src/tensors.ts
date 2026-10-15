/**
 * Trait covariance tensor — the second-moment structure of the population's
 * phenotypic and strategic variation.
 *
 * Given N agents each with a d-dimensional trait vector
 *   θ_i = (aggression, cooperation, risk, deception, speed, size, diet, fertility)
 *
 * we compute:
 *   μ  = (1/N) Σ θ_i                          — trait mean
 *   Σ  = (1/N) Σ (θ_i - μ)(θ_i - μ)^T        — d×d covariance matrix
 *   λ  = eigenvalues(Σ)                        — principal components
 *   det(Σ)                                      — Mahalanobis volume
 *   tr(Σ)                                       — total variance
 *
 * The eigenvalues tell us:
 *   - Which trait combinations are most variable (directions of evolution)
 *   - Whether the population is constrained to a low-dimensional manifold
 *   - The "shape" of the trait distribution (prolate, oblate, spherical)
 *
 * We also compute the fitness Hessian: the second derivative of the
 * fitness landscape along trait axes, estimated by finite differences
 * of the binned fitness data from the replicator module.
 *
 * All quantities are computed on the alive population only.
 */

import type { SimAgent } from './agent.js';

const TRAIT_DIM = 8;

export interface TensorState {
  /** trait mean vector (8D) */
  mean: Float64Array;
  /** trait covariance matrix (8×8 = 64 elements, row-major) */
  covariance: Float64Array;
  /** eigenvalues of covariance (sorted descending) */
  eigenvalues: Float64Array;
  /** eigenvectors (columns of 8×8 matrix, sorted by eigenvalue) */
  eigenvectors: Float64Array;
  /** total variance: tr(Σ) */
  totalVariance: number;
  /** Mahalanobis volume: det(Σ)^(1/d) */
  mahalanobisVolume: number;
  /** effective dimensionality: exp(H) where H = entropy of normalised eigenvalues */
  effectiveDimension: number;
  /** anisotropy: λ_max / λ_min (elongation of the trait ellipsoid) */
  anisotropy: number;
  /** number of agents used for computation */
  agentCount: number;
  /** fitness-trait correlation: correlation between each trait axis and fitness */
  fitnessCorrelation: Float64Array;
}

function extractTraits(a: SimAgent): [number, number, number, number, number, number, number, number] {
  return [
    a.strategy.aggression,
    a.strategy.cooperation,
    a.strategy.risk,
    a.strategy.deception,
    a.phenotype.speed,
    a.phenotype.size,
    a.phenotype.diet,
    a.phenotype.fertility,
  ];
}

export function createTensorState(): TensorState {
  return {
    mean: new Float64Array(TRAIT_DIM),
    covariance: new Float64Array(TRAIT_DIM * TRAIT_DIM),
    eigenvalues: new Float64Array(TRAIT_DIM),
    eigenvectors: new Float64Array(TRAIT_DIM * TRAIT_DIM),
    totalVariance: 0,
    mahalanobisVolume: 0,
    effectiveDimension: 0,
    anisotropy: 0,
    agentCount: 0,
    fitnessCorrelation: new Float64Array(TRAIT_DIM),
  };
}

/**
 * Update the trait covariance tensor from the alive population.
 * Uses Welford's online algorithm for numerically stable mean/variance.
 */
export function updateTensors(ts: TensorState, agents: Map<number, SimAgent>): void {
  let n = 0;
  const mean = new Float64Array(TRAIT_DIM);
  const m2 = new Float64Array(TRAIT_DIM * TRAIT_DIM);
  const traits: number[][] = [];
  const fitnesses: number[] = [];

  // Pass 1: compute mean
  for (const a of agents.values()) {
    if (!a.alive) continue;
    const t = extractTraits(a);
    traits.push(t);
    fitnesses.push(a.energyAcquired);
    for (let d = 0; d < TRAIT_DIM; d++) {
      mean[d] += t[d]!;
    }
    n++;
  }

  if (n < 2) {
    ts.agentCount = n;
    return;
  }

  for (let d = 0; d < TRAIT_DIM; d++) mean[d] /= n;

  // Pass 2: compute covariance via Welford's online method
  for (const t of traits) {
    for (let i = 0; i < TRAIT_DIM; i++) {
      for (let j = 0; j < TRAIT_DIM; j++) {
        m2[i * TRAIT_DIM + j] += (t[i]! - mean[i]) * (t[j]! - mean[j]);
      }
    }
  }

  for (let i = 0; i < TRAIT_DIM * TRAIT_DIM; i++) m2[i] /= n;

  // Copy results
  ts.mean.set(mean);
  ts.covariance.set(m2);
  ts.agentCount = n;

  // Eigenvalues via Jacobi iteration (8×8 is small enough)
  jacobiEigen(m2, ts.eigenvalues, ts.eigenvectors, TRAIT_DIM);

  // Total variance: tr(Σ)
  let trace = 0;
  for (let i = 0; i < TRAIT_DIM; i++) trace += m2[i * TRAIT_DIM + i]!;
  ts.totalVariance = trace;

  // Mahalanobis volume: det(Σ)^(1/d) ≈ (Π λ_i)^(1/d)
  let logDet = 0;
  for (let i = 0; i < TRAIT_DIM; i++) {
    if (ts.eigenvalues[i]! > 1e-15) logDet += Math.log(ts.eigenvalues[i]!);
  }
  ts.mahalanobisVolume = Math.exp(logDet / TRAIT_DIM);

  // Effective dimensionality: exp(H) where H = -Σ p_i log(p_i), p_i = λ_i / Σ λ_j
  let entropy = 0;
  for (let i = 0; i < TRAIT_DIM; i++) {
    const p = ts.eigenvalues[i]! / (trace || 1);
    if (p > 1e-15) entropy -= p * Math.log(p);
  }
  ts.effectiveDimension = Math.exp(entropy);

  // Anisotropy: λ_max / λ_min
  let maxLam = 0;
  let minLam = Infinity;
  for (let i = 0; i < TRAIT_DIM; i++) {
    if (ts.eigenvalues[i]! > maxLam) maxLam = ts.eigenvalues[i]!;
    if (ts.eigenvalues[i]! > 1e-15 && ts.eigenvalues[i]! < minLam) minLam = ts.eigenvalues[i]!;
  }
  ts.anisotropy = minLam > 1e-15 ? maxLam / minLam : 1000;

  // Fitness-trait correlation: Pearson correlation between each trait axis and fitness
  const fitnessMean = fitnesses.reduce((s, v) => s + v, 0) / n;
  let fitnessVar = 0;
  for (const f of fitnesses) fitnessVar += (f - fitnessMean) ** 2;
  fitnessVar /= n;

  for (let d = 0; d < TRAIT_DIM; d++) {
    let traitMean = 0;
    for (const t of traits) traitMean += t[d]!;
    traitMean /= n;

    let traitVar = 0;
    let covar = 0;
    for (let k = 0; k < n; k++) {
      const dt = traits[k]![d]! - traitMean;
      const df = fitnesses[k]! - fitnessMean;
      traitVar += dt * dt;
      covar += dt * df;
    }
    traitVar /= n;
    covar /= n;

    const denom = Math.sqrt(traitVar * fitnessVar);
    ts.fitnessCorrelation[d] = denom > 1e-15 ? covar / denom : 0;
  }
}

/**
 * Jacobi eigenvalue algorithm for a real symmetric matrix.
 * In-place rotation until off-diagonal elements converge.
 * For an 8×8 matrix this is fast enough for per-tick computation.
 */
function jacobiEigen(
  matrix: Float64Array,
  eigenvalues: Float64Array,
  eigenvectors: Float64Array,
  n: number,
): void {
  // Copy matrix
  const A = new Float64Array(n * n);
  A.set(matrix);

  // Initialize eigenvectors to identity
  eigenvectors.fill(0);
  for (let i = 0; i < n; i++) eigenvectors[i * n + i] = 1;

  const maxIter = 100;
  for (let iter = 0; iter < maxIter; iter++) {
    // Find largest off-diagonal element
    let maxVal = 0;
    let p = 0;
    let q = 1;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const v = Math.abs(A[i * n + j]!);
        if (v > maxVal) { maxVal = v; p = i; q = j; }
      }
    }
    if (maxVal < 1e-12) break;

    // Compute rotation angle
    const app = A[p * n + p]!;
    const aqq = A[q * n + q]!;
    const apq = A[p * n + q]!;
    const tau = (aqq - app) / (2 * apq);
    const t = Math.sign(tau) / (Math.abs(tau) + Math.sqrt(1 + tau * tau));
    const c = 1 / Math.sqrt(1 + t * t);
    const s = t * c;

    // Apply rotation
    for (let i = 0; i < n; i++) {
      const aip = A[i * n + p]!;
      const aiq = A[i * n + q]!;
      A[i * n + p] = c * aip - s * aiq;
      A[i * n + q] = s * aip + c * aiq;
    }
    for (let j = 0; j < n; j++) {
      const apj = A[p * n + j]!;
      const aqj = A[q * n + j]!;
      A[p * n + j] = c * apj - s * aqj;
      A[q * n + j] = s * apj + c * aqj;
    }

    // Update eigenvectors
    for (let i = 0; i < n; i++) {
      const vip = eigenvectors[i * n + p]!;
      const viq = eigenvectors[i * n + q]!;
      eigenvectors[i * n + p] = c * vip - s * viq;
      eigenvectors[i * n + q] = s * vip + c * viq;
    }
  }

  // Extract eigenvalues from diagonal
  for (let i = 0; i < n; i++) eigenvalues[i] = A[i * n + i]!;

  // Sort descending by eigenvalue
  for (let i = 0; i < n - 1; i++) {
    for (let j = i + 1; j < n; j++) {
      if (eigenvalues[j]! > eigenvalues[i]!) {
        let tmp = eigenvalues[i]!;
        eigenvalues[i] = eigenvalues[j]!;
        eigenvalues[j] = tmp;
        for (let k = 0; k < n; k++) {
          tmp = eigenvectors[k * n + i]!;
          eigenvectors[k * n + i] = eigenvectors[k * n + j]!;
          eigenvectors[k * n + j] = tmp;
        }
      }
    }
  }
}
