/**
 * Empirical-target scoring.
 *
 * Scores a benchmark run against the quantitative reference values a source
 * reports, independently of the model's own acceptance gates. The band is the
 * uncertainty the source supports (`tol`, or `lo`/`hi`); a target counts as a
 * hit when the seed-aggregated mean lands inside it and the bootstrap CI does
 * not straddle the far edge.
 *
 * Only `measured` and `derived` targets count toward `fidelity`: an `expected`
 * target is our quantification of a qualitative claim, so including it would
 * let a conservative restatement of our own criterion score as independent
 * evidence. They are still reported.
 */

import type { BenchResult, BenchId } from '../types.js';
import type { EmpiricalTarget, KnownSystem, TargetAssessment, TargetScore, TargetKind } from './types.js';

function bandOf(t: EmpiricalTarget): [number, number] {
  if (typeof t.lo === 'number' && typeof t.hi === 'number') return [t.lo, t.hi];
  const tol = t.tol ?? 0;
  return [t.value - tol, t.value + tol];
}

export const STRICT_KINDS: readonly TargetKind[] = ['measured', 'derived'];

export function isStrictTarget(t: EmpiricalTarget): boolean {
  return STRICT_KINDS.includes(t.kind);
}

export function scoreTarget(t: EmpiricalTarget, result: BenchResult): TargetScore {
  const observed = result.signature[t.key];
  const ci = result.ci[t.key] ?? [observed, observed];
  const band = bandOf(t);
  const finite = Number.isFinite(observed);
  const [lo, hi] = band;
  const withinBand = finite && observed >= lo && observed <= hi;
  // a CI that straddles a band edge means the claim is not resolved at this
  // seed count, so it does not count as a hit
  const resolved = finite && ci[0] >= lo && ci[1] <= hi;
  return {
    key: t.key,
    target: t.value,
    observed: finite ? observed : NaN,
    ci: [ci[0], ci[1]],
    band,
    absErr: finite ? Math.abs(observed - t.value) : NaN,
    relErr: finite && t.value !== 0 ? Math.abs(observed / t.value - 1) : NaN,
    withinBand: withinBand && resolved,
    kind: t.kind,
    source: t.source,
  };
}

export function assessTargets(
  system: Pick<KnownSystem, 'id' | 'benchId' | 'targets'>,
  result: BenchResult,
): TargetAssessment | undefined {
  const targets = system.targets ?? [];
  const benchId = system.benchId as BenchId | undefined;
  if (!benchId || targets.length === 0) return undefined;

  const scores = targets.map((t) => scoreTarget(t, result));
  const hits = scores.filter((s) => s.withinBand).length;
  const strict = scores.filter((s) => isStrictTarget({ kind: s.kind, key: s.key, value: s.target, source: s.source }));
  const strictHits = strict.filter((s) => s.withinBand).length;
  const fidelity = strict.length > 0 ? strictHits / strict.length : 1;
  const status: TargetAssessment['status'] =
    strict.length === 0 ? 'matched' : fidelity >= 1 ? 'matched' : fidelity > 0 ? 'partial' : 'unmatched';

  return { systemId: system.id, benchId, scores, hits, total: scores.length, strictHits, strictTotal: strict.length, fidelity, status };
}

/** aggregate strict hits across assessments (the report-level empirical fidelity) */
export function aggregateTargets(assessments: readonly (TargetAssessment | undefined)[]): {
  assessed: number;
  hits: number;
  total: number;
  fidelity: number;
} {
  const used = assessments.filter((a): a is TargetAssessment => a !== undefined && a.strictTotal > 0);
  const hits = used.reduce((a, x) => a + x.strictHits, 0);
  const total = used.reduce((a, x) => a + x.strictTotal, 0);
  return { assessed: used.length, hits, total, fidelity: total > 0 ? hits / total : 1 };
}
