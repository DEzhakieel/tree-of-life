/**
 * Benchmark D — Lotka–Volterra predator–prey.
 *
 * The canonical continuous model
 *
 *     dx/dt =  αx − βxy
 *     dy/dt =  δxy − γy
 *
 * Linearising about the coexistence fixed point (x*, y*) = (γ/δ, α/β) gives a
 * neutral centre with the closed-orbit (small-oscillation) period
 *
 *     T = 2π / √(αγ),
 *
 * the predator peak lagging the prey peak by exactly T/4, and the quantity
 * H = δx − γ ln x + βy − α ln y conserved. Each seed draws a small random
 * perturbation of the fixed point, so the measured period/lag/drift are
 * properties of the system rather than of a particular initial condition.
 */

import { BenchRng, seedFromString } from '../rng.js';
import { sha256OfNumbers } from '../signatures.js';
import type { BenchmarkModel, BenchmarkScale, BenchParams, RunOutput } from '../types.js';

interface Coef {
  alpha: number;
  gamma: number;
  beta: number;
  delta: number;
}

interface Cfg {
  dt: number;
  periods: number;
}

const FULL: Cfg = { dt: 0.002, periods: 5 };
const QUICK: Cfg = { dt: 0.004, periods: 4 };

function deriv(x: number, y: number, c: Coef): [number, number] {
  return [c.alpha * x - c.beta * x * y, c.delta * x * y - c.gamma * y];
}

/** one classical RK4 step */
function rk4(x: number, y: number, dt: number, c: Coef): [number, number] {
  const [k1x, k1y] = deriv(x, y, c);
  const [k2x, k2y] = deriv(x + (dt / 2) * k1x, y + (dt / 2) * k1y, c);
  const [k3x, k3y] = deriv(x + (dt / 2) * k2x, y + (dt / 2) * k2y, c);
  const [k4x, k4y] = deriv(x + dt * k3x, y + dt * k3y, c);
  return [x + (dt / 6) * (k1x + 2 * k2x + 2 * k3x + k4x), y + (dt / 6) * (k1y + 2 * k2y + 2 * k3y + k4y)];
}

function invariant(x: number, y: number, c: Coef): number {
  return c.delta * x - c.gamma * Math.log(x) + c.beta * y - c.alpha * Math.log(y);
}

/** local maxima with parabolic sub-step refinement */
function peakTimes(series: Float64Array, times: Float64Array, mean: number): number[] {
  const out: number[] = [];
  for (let i = 1; i < series.length - 1; i++) {
    const a = series[i - 1]!;
    const b = series[i]!;
    const c = series[i + 1]!;
    if (b > a && b >= c && b > mean) {
      const denom = a - 2 * b + c;
      const shift = denom !== 0 ? (0.5 * (a - c)) / denom : 0;
      out.push(times[i]! + shift * (times[1]! - times[0]!));
    }
  }
  return out;
}

function meanDiff(peaks: number[]): number {
  if (peaks.length < 2) return NaN;
  let s = 0;
  for (let i = 1; i < peaks.length; i++) s += peaks[i]! - peaks[i - 1]!;
  return s / (peaks.length - 1);
}

export const predatorPreyBenchmark: BenchmarkModel = {
  id: 'D',
  name: 'Predator–prey',
  family: 'population dynamics',
  stochastic: true,
  reference:
    'Lotka (1925) / Volterra (1926): closed orbits about (γ/δ, α/β) with period T = 2π/√(αγ), predator lag T/4, H conserved.',
  run(seed: string, scale: BenchmarkScale, params: BenchParams = {}): RunOutput {
    const cfg = { ...(scale === 'quick' ? QUICK : FULL), alpha: 1, gamma: 1, beta: 0.01, delta: 0.01, ...params };
    const c: Coef = { alpha: cfg.alpha, gamma: cfg.gamma, beta: cfg.beta, delta: cfg.delta };
    const XSTAR = c.gamma / c.delta; // 100
    const YSTAR = c.alpha / c.beta; // 100
    const T_THEORY = (2 * Math.PI) / Math.sqrt(c.alpha * c.gamma);
    const rng = new BenchRng(seedFromString(seed));
    const amp = 0.06; // small oscillation => linear period is accurate
    let x = XSTAR * (1 + amp * rng.signed());
    let y = YSTAR * (1 + amp * rng.signed());

    const tEnd = cfg.periods * T_THEORY;
    const steps = Math.ceil(tEnd / cfg.dt);
    const xs = new Float64Array(steps + 1);
    const ys = new Float64Array(steps + 1);
    const ts = new Float64Array(steps + 1);
    xs[0] = x;
    ys[0] = y;
    ts[0] = 0;
    const v0 = invariant(x, y, c);
    let vScale = Math.abs(v0);
    for (let i = 1; i <= steps; i++) {
      [x, y] = rk4(x, y, cfg.dt, c);
      xs[i] = x;
      ys[i] = y;
      ts[i] = i * cfg.dt;
      vScale = Math.max(vScale, Math.abs(invariant(x, y, c)));
    }

    const meanX = (xs[0]! + xs[steps]!) / 2;
    const meanY = YSTAR;
    const preyPeaks = peakTimes(xs, ts, meanX);
    const predPeaks = peakTimes(ys, ts, meanY);
    const tMeas = meanDiff(preyPeaks);
    const periodRelErr = Math.abs(tMeas / T_THEORY - 1);

    // predator peaks should trail prey peaks by T/4
    let lagSum = 0;
    let lagCnt = 0;
    for (const ty of predPeaks) {
      let tx = NaN;
      for (const p of preyPeaks) {
        if (p <= ty) tx = p;
        else break;
      }
      if (!Number.isNaN(tx)) {
        lagSum += ty - tx;
        lagCnt++;
      }
    }
    const phaseLagNorm = lagCnt > 0 ? lagSum / lagCnt / tMeas : NaN;

    const v1 = invariant(xs[steps]!, ys[steps]!, c);
    const invariantDriftPerPeriod =
      (Math.abs(v1 - v0) / vScale) / cfg.periods;

    return {
      signature: {
        periodRelErr,
        phaseLagNorm,
        invariantDriftPerPeriod,
      },
      fingerprint: sha256OfNumbers(xs, ys),
    };
  },
  checks: [
    {
      key: 'periodRelErr',
      test: 'lte',
      value: 0.02,
      note: 'measured orbit period matches 2π/√(αγ) to within 2%.',
      gate: true,
      referenceKind: 'analytic',
      citation: 'Lotka (1925); Volterra (1926)',
    },
    {
      key: 'phaseLagNorm',
      test: 'range',
      lo: 0.2,
      hi: 0.3,
      note: 'predator peak lags the prey peak by T/4 = 0.25 T.',
      gate: true,
      referenceKind: 'analytic',
      citation: 'Lotka–Volterra linearisation',
    },
    {
      key: 'invariantDriftPerPeriod',
      test: 'lte',
      value: 0.005,
      note: 'the first integral H = δx − γ ln x + βy − α ln y drifts by ≤0.5%/period.',
      gate: true,
      referenceKind: 'analytic',
      citation: 'Volterra (1926) first integral',
    },
  ],
  params: [
    { key: 'alpha', label: 'prey growth α', def: 1, min: 0.4, max: 2.5, log: true },
    { key: 'gamma', label: 'predator death γ', def: 1, min: 0.4, max: 2.5, log: true },
  ],
  interventions: [
    {
      id: 'abl-predation',
      label: 'predation off (β = 0)',
      kind: 'ablation',
      apply: (p) => ({ ...p, beta: 0 }),
      effects: [{ key: 'periodRelErr', direction: 'increase', note: 'without predation the predator–prey cycle cannot exist.' }],
    },
  ],
  analytic: { periodRelErr: 0, phaseLagNorm: 0.25, invariantDriftPerPeriod: 0 },
  empirical: {
    systemId: 'lotka-volterra',
    claim: 'Neutral predator–prey cycles about (γ/δ, α/β) with period 2π/√(αγ) and a quarter-period phase lag.',
  },
};
