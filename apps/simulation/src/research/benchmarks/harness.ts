/**
 * Benchmark harness.
 *
 * Runs each model over a fixed seed cohort, aggregates each signature key to a
 * mean ± 95% bootstrap CI, applies the model's declarative acceptance checks,
 * and enforces the repo-wide determinism discipline: every evaluated run is
 * executed twice and must reproduce its full-state fingerprint bit-for-bit.
 *
 * Gate semantics (agreed threshold spec):
 *   gte    pass iff mean >= v  AND  ci.lo >= v      ("should happen")
 *   lte    pass iff mean <= v  AND  ci.hi <= v      ("should not happen")
 *   range  pass iff mean in [lo,hi] AND ci inside [lo,hi]
 *   eqAbs  pass iff |mean - v| <= tol               (exact/near-exact models)
 * Deterministic models evaluate a single seed, so their CI is degenerate and
 * the checks reduce to the point value.
 */

import { bootstrapCI } from '../stats.js';
import type {
  BenchCheck,
  BenchmarkModel,
  BenchmarkScale,
  BenchParams,
  BenchResult,
  BenchScorecard,
  CheckOutcome,
  RunOutput,
} from './types.js';

/** fixed seed cohort — matches the repo's reproducibility-seed convention */
export const BENCH_SEEDS = [
  'bench-seed-0001',
  'bench-seed-0002',
  'bench-seed-0003',
  'bench-seed-0004',
  'bench-seed-0005',
];

export interface RunBenchmarkOptions {
  scale: BenchmarkScale;
  seeds?: string[];
  /** override the double-run determinism check (tests may disable for speed) */
  determinismCheck?: boolean;
  /** parameter overrides applied to every run */
  params?: BenchParams;
}

function applyCheck(check: BenchCheck, mean: number, ci: [number, number]): CheckOutcome {
  let pass = false;
  let threshold: number | [number, number];
  switch (check.test) {
    case 'gte': {
      const v = check.value ?? 0;
      threshold = v;
      pass = mean >= v && ci[0] >= v;
      break;
    }
    case 'lte': {
      const v = check.value ?? 0;
      threshold = v;
      pass = mean <= v && ci[1] <= v;
      break;
    }
    case 'range': {
      const lo = check.lo ?? -Infinity;
      const hi = check.hi ?? Infinity;
      threshold = [lo, hi];
      pass = mean >= lo && mean <= hi && ci[0] >= lo && ci[1] <= hi;
      break;
    }
    case 'eqAbs': {
      const v = check.value ?? 0;
      const tol = check.tol ?? 0;
      threshold = v;
      pass = Math.abs(mean - v) <= tol;
      break;
    }
  }
  return { key: check.key, test: check.test, threshold, observed: mean, ci, pass, gate: check.gate, note: check.note };
}

/** run one model once (no determinism check) — the unit the CLI double-runs. */
export function runModelOnce(
  model: BenchmarkModel,
  seed: string,
  scale: BenchmarkScale,
  params?: BenchParams,
): RunOutput {
  return model.run(seed, scale, params);
}

export function runBenchmark(model: BenchmarkModel, opts: RunBenchmarkOptions): BenchResult {
  const started = Date.now();
  const pool = opts.seeds ?? BENCH_SEEDS;
  const seeds = model.stochastic ? pool : pool.slice(0, 1);
  const checkDeterminism = opts.determinismCheck ?? true;

  const perKey: Record<string, number[]> = {};
  let determinism = true;
  let firstSignature: Record<string, number> = {};

  seeds.forEach((seed, idx) => {
    const a = runModelOnce(model, seed, opts.scale, opts.params);
    if (checkDeterminism) {
      const b = runModelOnce(model, seed, opts.scale, opts.params);
      if (a.fingerprint !== b.fingerprint) determinism = false;
    }
    if (idx === 0) firstSignature = a.signature;
    for (const [k, v] of Object.entries(a.signature)) {
      (perKey[k] ??= []).push(v);
    }
  });

  const signature: Record<string, number> = {};
  const ci: Record<string, [number, number]> = {};
  Object.entries(perKey).forEach(([k, values], i) => {
    if (values.length === 1) {
      signature[k] = values[0]!;
      ci[k] = [values[0]!, values[0]!];
    } else {
      const c = bootstrapCI(values, { r: 0x8e2c + i });
      signature[k] = c.mean;
      ci[k] = [c.lo, c.hi];
    }
  });

  const checks = model.checks.map((c) => {
    const m = signature[c.key];
    if (m === undefined) {
      // a missing signature key is a hard failure, not a crash
      return applyCheck(c, NaN, [NaN, NaN]);
    }
    return applyCheck(c, m, ci[c.key] ?? [m, m]);
  });

  const gated = checks.filter((c) => c.gate);
  const passed = gated.filter((c) => c.pass).length;
  const fidelity = gated.length > 0 ? passed / gated.length : 1;
  const verdict = gated.every((c) => c.pass) && determinism ? 'PASS' : 'FAIL';

  void firstSignature;
  return {
    id: model.id,
    name: model.name,
    family: model.family,
    stochastic: model.stochastic,
    seeds: seeds.length,
    scale: opts.scale,
    signature,
    ci,
    checks,
    fidelity,
    determinism,
    verdict,
    elapsedMs: Date.now() - started,
  };
}

export function runAllBenchmarks(
  models: readonly BenchmarkModel[],
  opts: RunBenchmarkOptions,
): BenchScorecard {
  const started = Date.now();
  const pool = opts.seeds ?? BENCH_SEEDS;
  const results: BenchResult[] = [];
  for (const model of models) {
    const r = runBenchmark(model, opts);
    results.push(r);
    console.log(`[bench ${r.id}] ${r.name} — ${r.verdict} (fidelity ${r.fidelity.toFixed(2)}, ${r.elapsedMs}ms)`);
  }
  return {
    scale: opts.scale,
    seeds: pool,
    results,
    pass: results.every((r) => r.verdict === 'PASS'),
    totalMs: Date.now() - started,
  };
}
