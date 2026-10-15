/**
 * Benchmark G — Iterated Prisoner's Dilemma (spatial reciprocity).
 *
 * Nowak & May (1992): on a lattice, players accumulate payoff against their
 * eight neighbours and imitate the highest-scoring strategy in their 3×3 block.
 * Spatial clustering lets reciprocators shield one another, so cooperation is
 * sustained (≥0.90 for a mild temptation b). Under well-mixed (random) matching
 * there is no such protection and defectors sweep the population (≤0.05), the
 * classic spatial-reciprocity result.
 *
 * Payoffs (Axelrod): R=1 (C–C), T=b (D–C), P=0 (D–D), S=0 (C–D).
 */

import { BenchRng, seedFromString } from '../rng.js';
import { sha256OfNumbers } from '../signatures.js';
import type { BenchmarkModel, BenchmarkScale, BenchParams, RunOutput } from '../types.js';

interface Cfg {
  n: number;
  gens: number;
  avg: number;
}

const FULL: Cfg = { n: 80, gens: 220, avg: 60 };
const QUICK: Cfg = { n: 56, gens: 160, avg: 40 };

// 8-neighbour offsets
const OFF: [number, number][] = [
  [-1, -1], [0, -1], [1, -1],
  [-1, 0], [1, 0],
  [-1, 1], [0, 1], [1, 1],
];

function payoff(a: number, bstrat: number, b: number): number {
  // a, bstrat: 1 = cooperate, 0 = defect
  if (a === 1 && bstrat === 1) return 1;
  if (a === 0 && bstrat === 1) return b;
  return 0;
}

function mutate(score: Float64Array, strat: Uint8Array, n: number): number {
  // synchronous imitation of the highest-scoring strategy in the 3×3 block
  const next = strat.slice();
  let coop = 0;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const i = y * n + x;
      let best = score[i]!;
      let bestStrat = strat[i]!;
      for (const [dx, dy] of OFF) {
        const j = ((y + dy + n) % n) * n + ((x + dx + n) % n);
        if (score[j]! > best) {
          best = score[j]!;
          bestStrat = strat[j]!;
        }
      }
      next[i] = bestStrat;
      coop += bestStrat;
    }
  }
  strat.set(next);
  return coop / (n * n);
}

function runSpatial(seed: string, cfg: Cfg, b: number): number {
  const { n, gens, avg } = cfg;
  const rng = new BenchRng(seedFromString(seed + ':spatial'));
  const strat = new Uint8Array(n * n);
  for (let i = 0; i < strat.length; i++) strat[i] = rng.unit() < 0.5 ? 1 : 0;
  const score = new Float64Array(n * n);
  let coopSum = 0;
  let coopCnt = 0;
  for (let g = 0; g < gens; g++) {
    score.fill(0);
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const i = y * n + x;
        const a = strat[i]!;
        let s = 0;
        for (const [dx, dy] of OFF) {
          const j = ((y + dy + n) % n) * n + ((x + dx + n) % n);
          s += payoff(a, strat[j]!, b);
        }
        score[i] = s;
      }
    }
    const coop = mutate(score, strat, n);
    if (g >= gens - avg) {
      coopSum += coop;
      coopCnt++;
    }
  }
  return coopCnt > 0 ? coopSum / coopCnt : 0;
}

function runWellMixed(seed: string, cfg: Cfg, b: number): number {
  const { n, gens, avg } = cfg;
  const total = n * n;
  const rng = new BenchRng(seedFromString(seed + ':mixed'));
  const strat = new Uint8Array(total);
  for (let i = 0; i < total; i++) strat[i] = rng.unit() < 0.5 ? 1 : 0;
  const score = new Float64Array(total);
  const sample = new Int32Array(9); // 8 opponents + self
  let coopSum = 0;
  let coopCnt = 0;
  for (let g = 0; g < gens; g++) {
    score.fill(0);
    // each player scores against 8 random opponents
    for (let i = 0; i < total; i++) {
      let s = 0;
      for (let k = 0; k < 8; k++) {
        const j = rng.int(total);
        s += payoff(strat[i]!, strat[j]!, b);
      }
      score[i] = s;
    }
    // each player imitates the best of 8 random others (plus self)
    const next = strat.slice();
    let coop = 0;
    for (let i = 0; i < total; i++) {
      sample[0] = i;
      for (let k = 1; k <= 8; k++) sample[k] = rng.int(total);
      let best = score[sample[0]!]!;
      let bestStrat = strat[sample[0]!]!;
      for (let k = 1; k <= 8; k++) {
        const j = sample[k]!;
        if (score[j]! > best) {
          best = score[j]!;
          bestStrat = strat[j]!;
        }
      }
      next[i] = bestStrat;
      coop += bestStrat;
    }
    strat.set(next);
    if (g >= gens - avg) {
      coopSum += coop / total;
      coopCnt++;
    }
  }
  return coopCnt > 0 ? coopSum / coopCnt : 0;
}

export const cooperationBenchmark: BenchmarkModel = {
  id: 'G',
  name: 'Iterated Prisoner’s Dilemma',
  family: 'evolutionary game theory',
  stochastic: true,
  reference:
    'Axelrod (1984) / Nowak & May (1992): spatial clustering sustains cooperation, well-mixed matching collapses it.',
  run(seed: string, scale: BenchmarkScale, params: BenchParams = {}): RunOutput {
    const cfg = { ...(scale === 'quick' ? QUICK : FULL), b: 1.05, ...params };
    const spatial = runSpatial(seed, cfg, cfg.b);
    const mixed = runWellMixed(seed, cfg, cfg.b);
    return {
      signature: { coopSpatial: spatial, coopWellMixed: mixed },
      fingerprint: sha256OfNumbers(Float64Array.from([spatial, mixed])),
    };
  },
  checks: [
    {
      key: 'coopSpatial',
      test: 'gte',
      value: 0.9,
      note: 'spatial reciprocity sustains cooperation: ≥90% cooperators.',
      gate: true,
      referenceKind: 'empirical',
      citation: 'Nowak & May (1992)',
    },
    {
      key: 'coopWellMixed',
      test: 'lte',
      value: 0.05,
      note: 'without spatial structure defectors sweep the population: ≤5% cooperators.',
      gate: true,
      referenceKind: 'theory',
      citation: 'Axelrod (1984)',
    },
  ],
  params: [
    { key: 'b', label: 'temptation to defect b', def: 1.05, min: 1.0, max: 1.2, log: true },
  ],
  interventions: [
    {
      id: 'abl-lattice',
      label: 'remove spatial structure (well-mixed)',
      kind: 'ablation',
      apply: (p) => ({ ...p }),
      effects: [{ key: 'coopWellMixed', direction: 'increase', note: 'well-mixed dynamics collapse cooperation.' }],
    },
  ],
  empirical: {
    systemId: 'spatial-ipd-nowak-may',
    claim: 'Spatial lattice enables cooperation to persist for mild temptation b; well-mixed matching drives defection.',
  },
};
