/**
 * Replicator dynamics — the fundamental equation of evolutionary game theory.
 *
 *   dx_i/dt = x_i · (f_i(x) − φ(x))
 *
 * where:
 *   x_i = frequency of strategy type i
 *   f_i = fitness of strategy type i (mean energy acquired)
 *   φ   = population mean fitness = Σ x_j · f_j
 *
 * This module tracks the distribution of strategy genes across the population
 * in discrete bins, computes fitness-weighted frequency changes, and returns
 * the replicator derivatives that the engine uses to apply weak selective
 * pressure on offspring strategy genes.
 *
 * Strategy space is 4D: (aggression, cooperation, risk, deception), each in [0,1].
 * We use a 1D projection along the current dominant eigenvector of the trait
 * covariance matrix (computed in tensors.ts) to reduce dimensionality, then
 * bin into N_BINS intervals.
 */

import type { SimAgent } from './agent.js';
import { SplitMix64 } from './rng.js';
import { fnv1a32 } from '@fractal-life/shared';

const N_BINS = 12;
const EPSILON = 0.01; // selection intensity

export interface ReplicatorState {
  /** bin frequencies (sum to 1) */
  frequencies: Float64Array;
  /** bin mean fitness (energy acquired) */
  fitness: Float64Array;
  /** bin counts */
  counts: Float64Array;
  /** replicator derivatives dx/dt per bin */
  derivatives: Float64Array;
  /** population mean fitness */
  meanFitness: number;
  /** selection entropy: H(x) = -Σ x_i log(x_i) — measures strategy diversity */
  selectionEntropy: number;
  /** dominant strategy index */
  dominantBin: number;
  /** fixation index: frequency of the dominant strategy (>0.8 = fixation) */
  fixationIndex: number;
  /** Price equation: Cov(fitness, frequency) + E[fitness * frequency change] */
  priceEquation: {
    /** selection component: Cov(f_i, x_i) */
    selection: number;
    /** transmission component: E[x_i * Δx_i] */
    transmission: number;
  };
  /** internal: projection weights for 4D → 1D reduction */
  projectionWeights: [number, number, number, number];
  /** internal: projection offset */
  projectionOffset: number;
}

export function createReplicatorState(): ReplicatorState {
  return {
    frequencies: new Float64Array(N_BINS),
    fitness: new Float64Array(N_BINS),
    counts: new Float64Array(N_BINS),
    derivatives: new Float64Array(N_BINS),
    meanFitness: 0,
    selectionEntropy: 0,
    dominantBin: 0,
    fixationIndex: 0,
    priceEquation: { selection: 0, transmission: 0 },
    projectionWeights: [1, 0, 0, 0], // default: project onto aggression axis
    projectionOffset: 0,
  };
}

/**
 * Project a 4D strategy vector onto 1D using PCA-style projection.
 * The projection weights are updated periodically from the trait covariance
 * eigenvector (dominant direction of variation).
 */
function project(s: ReplicatorState, agg: number, coop: number, risk: number, decep: number): number {
  const [w0, w1, w2, w3] = s.projectionWeights;
  return w0 * agg + w1 * coop + w2 * risk + w3 * decep + s.projectionOffset;
}

/**
 * Bin a projected value into [0, N_BINS-1].
 */
function binIndex(v: number): number {
  const b = Math.floor(v * N_BINS);
  return b < 0 ? 0 : b >= N_BINS ? N_BINS - 1 : b;
}

/**
 * Update replicator dynamics from the current alive population.
 * Call once per tick (or less frequently for performance).
 */
export function updateReplicator(
  rs: ReplicatorState,
  agents: Map<number, SimAgent>,
  dt: number,
): void {
  // Reset bins
  rs.frequencies.fill(0);
  rs.fitness.fill(0);
  rs.counts.fill(0);

  let total = 0;
  let fitnessSum = 0;

  // Bin agents by projected strategy
  for (const a of agents.values()) {
    if (!a.alive) continue;
    const s = a.strategy;
    const p = project(rs, s.aggression, s.cooperation, s.risk, s.deception);
    const b = binIndex(p);
    rs.counts[b]++;
    rs.fitness[b] += a.energyAcquired;
    total++;
    fitnessSum += a.energyAcquired;
  }

  if (total === 0) return;

  // Compute frequencies and bin mean fitness
  for (let i = 0; i < N_BINS; i++) {
    rs.frequencies[i] = rs.counts[i] / total;
    rs.fitness[i] = rs.counts[i] > 0 ? rs.fitness[i] / rs.counts[i] : 0;
  }

  // Population mean fitness
  rs.meanFitness = fitnessSum / total;

  // Replicator derivatives: dx_i/dt = x_i * (f_i - φ)
  for (let i = 0; i < N_BINS; i++) {
    rs.derivatives[i] = rs.frequencies[i] * (rs.fitness[i] - rs.meanFitness);
  }

  // Selection entropy: H(x) = -Σ x_i log(x_i)
  let h = 0;
  for (let i = 0; i < N_BINS; i++) {
    const p = rs.frequencies[i];
    if (p > 1e-12) h -= p * Math.log(p);
  }
  rs.selectionEntropy = h;

  // Dominant bin and fixation index
  let maxFreq = 0;
  let maxBin = 0;
  for (let i = 0; i < N_BINS; i++) {
    if (rs.frequencies[i] > maxFreq) {
      maxFreq = rs.frequencies[i];
      maxBin = i;
    }
  }
  rs.dominantBin = maxBin;
  rs.fixationIndex = maxFreq;

  // Price equation: selection = Cov(f_i, x_i), transmission = E[x_i * dx_i/dt]
  // In the replicator formulation, selection = Σ x_i * (f_i - φ)^2 (variance of fitness)
  let selection = 0;
  for (let i = 0; i < N_BINS; i++) {
    const d = rs.fitness[i] - rs.meanFitness;
    selection += rs.frequencies[i] * d * d;
  }
  // Transmission ≈ Σ x_i * dx_i (higher-order term, approximated)
  let transmission = 0;
  for (let i = 0; i < N_BINS; i++) {
    transmission += rs.frequencies[i] * rs.derivatives[i];
  }
  rs.priceEquation = { selection, transmission };
}

/**
 * Apply weak selective pressure to an offspring's strategy genes based on
 * the current replicator dynamics. Returns modified strategy genes.
 *
 * Offspring born into bins with positive replicator derivatives get a slight
 * push toward higher fitness; those in declining bins are pushed toward the
 * population mean (regression to the mean).
 *
 * The mutation jitter runs through a seeded SplitMix64 instead of Math.random
 * so the "no Math.random anywhere in the sim core" contract holds even for
 * this (currently unwired) selection path. Callers pass their own rng to use
 * their own stream; when omitted the stream is deterministically derived from
 * the exact input state, so a given offspring mutates identically across
 * processes and machines.
 */
export function applySelection(
  rs: ReplicatorState,
  aggression: number,
  cooperation: number,
  risk: number,
  deception: number,
  mutationSigma: number,
  rng?: SplitMix64,
): { aggression: number; cooperation: number; risk: number; deception: number } {
  const p = project(rs, aggression, cooperation, risk, deception);
  const b = binIndex(p);
  const dxdt = rs.derivatives[b];

  // Selective push: positive dxdt → push toward bin center, negative → push toward mean
  const strength = EPSILON * Math.sign(dxdt) * Math.min(Math.abs(dxdt), 1);
  const noise = rng ?? new SplitMix64(fnv1a32(`${aggression}:${cooperation}:${risk}:${deception}:${mutationSigma}:${dxdt}`));

  return {
    aggression: clamp01(aggression + strength * (rs.projectionWeights[0] || 0) + mutationSigma * (noise.nextFloat() - 0.5)),
    cooperation: clamp01(cooperation + strength * (rs.projectionWeights[1] || 0) + mutationSigma * (noise.nextFloat() - 0.5)),
    risk: clamp01(risk + strength * (rs.projectionWeights[2] || 0) + mutationSigma * (noise.nextFloat() - 0.5)),
    deception: clamp01(deception + strength * (rs.projectionWeights[3] || 0) + mutationSigma * (noise.nextFloat() - 0.5)),
  };
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/**
 * Update the projection weights from the trait covariance matrix.
 * `eigenVec` is the dominant eigenvector (4D) and `offset` is the mean.
 */
export function setProjection(
  rs: ReplicatorState,
  eigenVec: [number, number, number, number],
  offset: number,
): void {
  rs.projectionWeights = eigenVec;
  rs.projectionOffset = -offset; // center the projection
}

/**
 * Reset replicator state.
 */
export function resetReplicator(rs: ReplicatorState): void {
  rs.frequencies.fill(0);
  rs.fitness.fill(0);
  rs.counts.fill(0);
  rs.derivatives.fill(0);
  rs.meanFitness = 0;
  rs.selectionEntropy = 0;
  rs.dominantBin = 0;
  rs.fixationIndex = 0;
  rs.priceEquation = { selection: 0, transmission: 0 };
}
