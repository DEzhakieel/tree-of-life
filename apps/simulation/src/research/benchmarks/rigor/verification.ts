import { bootstrapCI } from '../../stats.js';
import { BENCH_SEEDS } from '../harness.js';
import { BENCHMARK_MODELS } from '../models/index.js';
import type { BenchCheck, BenchParams, BenchmarkModel, BenchmarkScale } from '../types.js';
import type { RigorCheck, RigorSection } from './types.js';

const BASELINE: BenchParams = {};

function runObs(model: BenchmarkModel, seeds: string[], scale: BenchmarkScale): Record<string, number[]> {
  const out: Record<string, number[]> = {};
  for (const seed of seeds) {
    const r = model.run(seed, scale, BASELINE);
    for (const [k, v] of Object.entries(r.signature)) {
      (out[k] ??= []).push(v);
    }
  }
  return out;
}

/**
 * The tolerance the model itself declares for this signature key — read from its
 * own acceptance check, so verification is exactly as strict as the model's
 * stated precision and never a looser blanket constant.
 *
 * Precedence: a gating check beats an informational one; within that, an exact
 * tolerance (`eqAbs`) beats a symmetric band (`range`), which beats a one-sided
 * bound (`gte`/`lte`, where the tolerance is the distance from the bound to the
 * analytic reference).
 */
function declaredTolerance(model: BenchmarkModel, key: string, ref: number): { tol: number; via: string } {
  const checks = model.checks.filter((c) => c.key === key);
  const rank = (c: BenchCheck): number =>
    (c.gate ? 0 : 10) + (c.test === 'eqAbs' ? 0 : c.test === 'range' ? 1 : 2);
  const pick = [...checks].sort((a, b) => rank(a) - rank(b))[0];
  if (pick) {
    if (pick.test === 'eqAbs') return { tol: pick.tol ?? 0, via: `eqAbs tol=${pick.tol ?? 0}` };
    if (pick.test === 'range') {
      const lo = pick.lo ?? -Infinity;
      const hi = pick.hi ?? Infinity;
      if (Number.isFinite(lo) && Number.isFinite(hi)) {
        const half = (hi - lo) / 2;
        return { tol: half, via: `range ±${half}` };
      }
    }
    if (pick.test === 'gte') return { tol: Math.abs((pick.value ?? 0) - ref), via: `gte≥${pick.value}` };
    if (pick.test === 'lte') return { tol: Math.abs(ref - (pick.value ?? 0)), via: `lte≤${pick.value}` };
  }
  return { tol: Math.max(1e-9, Math.abs(ref) * 0.01), via: 'default 1% rel' };
}

export function runVerification(scale: BenchmarkScale = 'full'): RigorSection {
  const checks: RigorCheck[] = [];
  const seeds = BENCH_SEEDS;
  let passCount = 0;
  let total = 0;
  for (const m of BENCHMARK_MODELS) {
    const obs = runObs(m, seeds, scale);
    const anal = m.analytic ?? {};
    for (const [k, ref] of Object.entries(anal)) {
      total++;
      const vals = obs[k];
      if (!vals || vals.length === 0) {
        checks.push({
          module: 'verification',
          key: `${m.id}-${k}`,
          label: `${m.id} ${k} analytic`,
          outcome: 'FAIL',
          value: 'missing',
          threshold: String(ref),
          detail: 'no observed value for a declared analytic key',
        });
        continue;
      }
      const c = bootstrapCI(vals, { r: 0xfeed + total });
      const mean = c.mean;
      const absErr = Math.abs(mean - ref);
      const relErr = ref === 0 ? absErr : absErr / Math.abs(ref);
      const { tol, via } = declaredTolerance(m, k, ref);
      const within = absErr <= tol + 1e-12;
      const ciCovers = c.lo - 1e-12 <= ref && ref <= c.hi + 1e-12;
      // PASS iff the observed value sits inside the model's own declared band
      // around the closed form. A miss that is only a tolerance-width issue but
      // still statistically overlaps the reference is surfaced as WARN.
      const outcome = within ? 'PASS' : ciCovers ? 'WARN' : 'FAIL';
      if (outcome === 'PASS') passCount++;
      checks.push({
        module: 'verification',
        key: `${m.id}-${k}`,
        label: `${m.id} ${k} |obs−analytic|`,
        outcome,
        value: Number(relErr.toFixed(6)),
        threshold: `${via} (tol=${Number(tol.toPrecision(4))})`,
        detail: `obs=${mean.toFixed(6)} ref=${ref} absErr=${absErr.toExponential(2)} ci=[${c.lo.toFixed(5)},${c.hi.toFixed(5)}] ciCoversRef=${ciCovers}`,
      });
    }
  }
  const summary =
    total > 0
      ? `analytic checks: ${passCount}/${total} within the model-declared tolerance (strict, per-key)`
      : 'no analytic checks declared';
  return {
    id: 'verification',
    title: 'Verification (implementation ≈ mathematics, per-key declared tolerance)',
    summary,
    checks,
  };
}
