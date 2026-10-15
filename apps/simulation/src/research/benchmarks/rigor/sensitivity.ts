import { bootstrapCI, mean, mulberry32, stdev } from '../../stats.js';
import { BENCH_SEEDS } from '../harness.js';
import { BENCHMARK_MODELS } from '../models/index.js';
import type { BenchParams, BenchmarkModel, BenchmarkScale, ParamSpec } from '../types.js';
import type { RigorCheck, RigorSection } from './types.js';

const BASELINE: BenchParams = {};

function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** first signature key = the model's primary readout used as the screening output */
function primaryKey(model: BenchmarkModel, scale: BenchmarkScale, params?: BenchParams): string | undefined {
  const r = model.run(BENCH_SEEDS[0]!, scale, params);
  return Object.keys(r.signature)[0];
}

function outputOf(model: BenchmarkModel, seed: string, params: BenchParams, key: string, scale: BenchmarkScale): number {
  const r = model.run(seed, scale, params);
  return r.signature[key] ?? NaN;
}

/** map a normalized level u∈[0,1] to a parameter value (log-spaced if declared) */
function toValue(sp: ParamSpec, u: number): number {
  const clamped = Math.min(1, Math.max(0, u));
  if (sp.log && sp.min > 0) return sp.min * Math.pow(sp.max / sp.min, clamped);
  return sp.min + (sp.max - sp.min) * clamped;
}

function shuffle<T>(xs: T[], rng: () => number): void {
  for (let i = xs.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const t = xs[i]!;
    xs[i] = xs[j]!;
    xs[j] = t;
  }
}

export interface MorrisEffect {
  key: string;
  label: string;
  mu: number;
  muStar: number;
  sigma: number;
  n: number;
}

/**
 * Morris (1991) one-at-a-time screening by trajectories.
 *
 * Each trajectory starts at a random grid base point, then perturbs one
 * parameter at a time by a fixed normalized step Δ (cumulative winding-stairs
 * path), recording an elementary effect EE = Δy / Δ per parameter. Across `r`
 * trajectories we report the mean effect μ, the mean absolute effect μ* (the
 * influence ranking) and the spread σ (interaction / non-linearity). This
 * screens every declared knob, unlike the illustrative OAT sweep.
 *
 * p = 4 levels, Δ = p / (2(p-1)); base coordinates ∈ {0, 1/(p-1)} so base+Δ ≤ 1.
 */
export function morrisScreen(model: BenchmarkModel, key: string, scale: BenchmarkScale, r = 3): MorrisEffect[] {
  const params = model.params ?? [];
  const k = params.length;
  if (k === 0) return [];
  const p = 4;
  const delta = p / (2 * (p - 1));
  const step = 1 / (p - 1);
  const rng = mulberry32(hashSeed(model.id));
  const ees: number[][] = params.map(() => []);

  for (let t = 0; t < r; t++) {
    const u = params.map(() => (rng() < 0.5 ? 0 : step));
    const seed = BENCH_SEEDS[t % BENCH_SEEDS.length]!;
    const evalY = (): number => {
      const vals: BenchParams = {};
      for (let i = 0; i < k; i++) vals[params[i]!.key] = toValue(params[i]!, u[i]!);
      return outputOf(model, seed, vals, key, scale);
    };
    let y = evalY();
    const order = params.map((_, i) => i);
    shuffle(order, rng);
    for (const i of order) {
      const yBefore = y;
      u[i] = u[i]! + delta;
      y = evalY();
      const dy = y - yBefore;
      if (Number.isFinite(dy)) ees[i]!.push(dy / delta);
    }
  }

  return params.map((sp, i) => {
    const v = ees[i]!;
    const mu = v.length ? mean(v) : NaN;
    const muStar = v.length ? mean(v.map(Math.abs)) : NaN;
    const sigma = v.length > 1 ? stdev(v) : 0;
    return { key: sp.key, label: sp.label, mu, muStar, sigma, n: v.length };
  });
}

export function runSensitivity(scale: BenchmarkScale = 'quick'): RigorSection {
  const checks: RigorCheck[] = [];
  const seeds = BENCH_SEEDS;
  let studied = 0;
  let influential = 0;

  for (const m of BENCHMARK_MODELS) {
    const params = m.params ?? [];
    if (params.length === 0) continue;
    studied++;
    const key = primaryKey(m, scale) ?? '';

    // ---- illustrative one-at-a-time sweep on the first two knobs ----
    for (const sp of params.slice(0, 2)) {
      const vals: number[] = [];
      for (const s of seeds) vals.push(outputOf(m, s, {}, key, scale));
      const base = bootstrapCI(vals, { r: 0x1337 }).mean;
      const vUp = mean(seeds.map((s) => outputOf(m, s, { [sp.key]: sp.max }, key, scale)));
      const vDown = mean(seeds.map((s) => outputOf(m, s, { [sp.key]: sp.min }, key, scale)));
      const sens = Math.max(
        Math.abs((vUp - base) / Math.max(1e-9, Math.abs(base))),
        Math.abs((vDown - base) / Math.max(1e-9, Math.abs(base))),
      );
      checks.push({
        module: 'sensitivity',
        key: `${m.id}-oat-${sp.key}`,
        label: `${m.id} OAT ${sp.key}`,
        outcome: sens >= 1e-6 ? 'PASS' : 'WARN',
        value: Number(sens.toFixed(6)),
        detail: `readout ${key}: def=${base.toFixed(4)} [min=${vDown.toFixed(4)}, max=${vUp.toFixed(4)}] rel-span=${sens.toExponential(2)}`,
      });
    }

    // ---- Morris elementary-effects screen over all declared knobs ----
    const effects = morrisScreen(m, key, scale);
    const floor = 1e-6 * (1 + Math.abs(mean(seeds.map((s) => outputOf(m, s, {}, key, scale)))));
    let anyInfluential = false;
    for (const e of effects) {
      const dom = e.muStar >= floor;
      if (dom) anyInfluential = true;
      checks.push({
        module: 'sensitivity',
        key: `${m.id}-morris-${e.key}`,
        label: `${m.id} Morris ${e.key}`,
        outcome: dom ? 'PASS' : 'WARN',
        value: Number((Number.isFinite(e.muStar) ? e.muStar : NaN).toFixed(6)),
        threshold: `μ* ≥ ${floor.toExponential(2)}`,
        detail: `readout ${key}: μ=${e.mu.toExponential(2)} μ*=${e.muStar.toExponential(2)} σ=${e.sigma.toExponential(2)} (r=${e.n} trajectories)`,
      });
    }
    if (anyInfluential) influential++;
  }

  const summary =
    studied > 0
      ? `sensitivity: ${influential}/${studied} models respond to ≥1 declared knob (Morris μ* screening + OAT)`
      : 'no tunable params declared';
  return {
    id: 'sensitivity',
    title: 'Sensitivity (OAT sweep + Morris elementary-effects screening)',
    summary,
    checks,
  };
}
