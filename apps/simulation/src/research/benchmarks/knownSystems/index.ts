/**
 * Known-systems registry — index + report builder.
 *
 * Combines the scientific and platform inventories and computes fidelity by
 * re-running each linked benchmark over the canonical seed cohort. Entries
 * without a shipped replication are reported as `documented`.
 *
 * Two independent fidelities are reported per replicated entry:
 *   fidelity        gated acceptance checks passing (our chosen criterion)
 *   targets         engine output landing inside the band the literature
 *                   supports, for measured/derived reference values
 * A model can pass every gate and still miss its published target; that
 * divergence is the point of keeping the two apart.
 */

import { runBenchmark } from '../harness.js';
import { BENCHMARK_MODELS } from '../models/index.js';
import type { BenchId, BenchResult, BenchmarkScale } from '../types.js';
import { PLATFORM_SYSTEMS } from './platforms.js';
import { SCIENTIFIC_SYSTEMS } from './scientific.js';
import { aggregateTargets, assessTargets } from './targets.js';
import type { KnownEntry, KnownReport, KnownSystem, TargetAssessment } from './types.js';

export const KNOWN_SYSTEMS: KnownSystem[] = [...SCIENTIFIC_SYSTEMS, ...PLATFORM_SYSTEMS];

export function buildKnownReport(scale: BenchmarkScale = 'full'): KnownReport {
  const started = Date.now();
  const byId = new Map(BENCHMARK_MODELS.map((m) => [m.id, m]));
  const runCache = new Map<BenchId, BenchResult>();

  const runLinked = (benchId: BenchId): BenchResult | undefined => {
    let r = runCache.get(benchId);
    if (r === undefined) {
      const model = byId.get(benchId);
      if (!model) return undefined;
      r = runBenchmark(model, { scale, determinismCheck: false });
      runCache.set(benchId, r);
    }
    return r;
  };

  const entries: KnownEntry[] = KNOWN_SYSTEMS.map((s) => {
    let fidelity: number | undefined;
    let targetAssessment: TargetAssessment | undefined;
    if (s.replicated && s.benchId) {
      const r = runLinked(s.benchId);
      if (r) {
        fidelity = r.fidelity;
        targetAssessment = assessTargets(s, r);
      }
    }
    const status: KnownEntry['status'] = !s.replicated || fidelity === undefined ? 'documented' : fidelity >= 0.999 ? 'replicated' : 'partial';
    return { ...s, fidelity, status, targetAssessment };
  });

  const replicated = entries.filter((e) => e.status !== 'documented');
  const meanFidelity = replicated.length ? replicated.reduce((a, e) => a + (e.fidelity ?? 0), 0) / replicated.length : 0;
  const agg = aggregateTargets(entries.map((e) => e.targetAssessment));

  return {
    scale,
    entries,
    scientific: entries.filter((e) => e.domain === 'scientific').length,
    platforms: entries.filter((e) => e.domain === 'platform').length,
    replicated: replicated.length,
    meanFidelity,
    assessed: agg.assessed,
    empiricalHits: agg.hits,
    empiricalTotal: agg.total,
    empiricalFidelity: agg.fidelity,
    totalMs: Date.now() - started,
  };
}

export type { KnownEntry, KnownReport, KnownSystem } from './types.js';
export { assessTargets, scoreTarget, aggregateTargets } from './targets.js';
export type { TargetAssessment, TargetScore } from './types.js';
