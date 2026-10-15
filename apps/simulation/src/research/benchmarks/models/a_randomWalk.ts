/**
 * Benchmark A — Random walkers (Brownian diffusion).
 *
 * N independent walkers on an unbounded plane, each step adding an isotropic
 * Gaussian increment of per-axis variance σ². Einstein's 1905 result fixes the
 * mean-squared displacement exactly:
 *
 *     ⟨|r(t)|²⟩ = 2·d·D·t,   d = 2 dimensions,   D = σ²/2
 *
 * so the MSD grows linearly in time (log–log slope α = 1) and its slope is
 * 2σ². Both are measured from a log–log fit, giving an exact, non-stochastic
 * ground truth (large N averages away the sampling noise).
 */

import { BenchRng, seedFromString } from '../rng.js';
import { linreg, logLogSlope, sha256OfNumbers } from '../signatures.js';
import type { BenchmarkModel, BenchmarkScale, BenchParams, RunOutput } from '../types.js';

const FULL = { walkers: 2000, steps: 2000, stride: 25, sigma: 1 };
const QUICK = { walkers: 400, steps: 600, stride: 20, sigma: 1 };

export const randomWalkBenchmark: BenchmarkModel = {
  id: 'A',
  name: 'Random walkers',
  family: 'diffusion',
  stochastic: false,
  reference:
    'Einstein (1905) / Pearson (1905): MSD(t) = 2·d·D·t with D = σ²/2 per axis; log–log slope α = 1.',
  run(seed: string, scale: BenchmarkScale, params: BenchParams = {}): RunOutput {
    const cfg = { ...(scale === 'quick' ? QUICK : FULL), ...params };
    const rng = new BenchRng(seedFromString(seed));
    const n = cfg.walkers;
    const x = new Float64Array(n);
    const y = new Float64Array(n);

    const times: number[] = [];
    const msd: number[] = [];
    let nextCheck = cfg.stride;

    for (let t = 1; t <= cfg.steps; t++) {
      for (let i = 0; i < n; i++) {
        x[i]! += rng.gaussian() * cfg.sigma;
        y[i]! += rng.gaussian() * cfg.sigma;
      }
      if (t === nextCheck) {
        let s = 0;
        for (let i = 0; i < n; i++) s += x[i]! * x[i]! + y[i]! * y[i]!;
        times.push(t);
        msd.push(s / n);
        nextCheck += cfg.stride;
      }
    }

    const alpha = logLogSlope(times, msd);
    const slope = linreg(times, msd).slope; // ≈ 2σ² (MSD = 2σ²·t for d = 2)
    const theoretical = 2 * cfg.sigma * cfg.sigma;

    return {
      signature: {
        alpha,
        msdSlope: slope,
        dRelErr: Math.abs(slope / theoretical - 1),
      },
      fingerprint: sha256OfNumbers(x, y),
    };
  },
  checks: [
    {
      key: 'alpha',
      test: 'range',
      lo: 0.98,
      hi: 1.02,
      note: 'MSD is linear in time: log–log slope α = 1 (Einstein).',
      gate: true,
      referenceKind: 'analytic',
      citation: 'Einstein (1905)',
    },
    {
      key: 'dRelErr',
      test: 'lte',
      value: 0.03,
      note: 'fitted MSD slope matches 2σ² to within 3% (D = σ²/2).',
      gate: true,
      referenceKind: 'analytic',
      citation: 'Einstein (1905)',
    },
  ],
  params: [
    { key: 'sigma', label: 'step σ (per axis)', def: 1, min: 0.25, max: 4, log: true },
    { key: 'stride', label: 'MSD sample stride', def: 25, min: 5, max: 100 },
    { key: 'walkers', label: 'walkers N', def: 2000, min: 250, max: 8000 },
  ],
  analytic: { alpha: 1, dRelErr: 0 },
  empirical: {
    systemId: 'random-walk-pearson',
    claim: 'Brownian MSD grows linearly in time with slope 2σ² (Einstein/Pearson 1905).',
  },
};
