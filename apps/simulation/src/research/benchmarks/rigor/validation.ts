/**
 * Validation — does the engine reproduce what the literature reports?
 *
 * This study used to check only that a model's `empirical.systemId` existed in
 * the known-systems registry, which made it near-vacuous (every linked model
 * passed by construction). It now scores each model's run against the
 * quantitative targets attached to that known system: the published or
 * derivable reference values, with the uncertainty the source supports.
 *
 * The distinction that matters:
 *   verification  engine output vs the thresholds we chose   (harness gates)
 *   validation    engine output vs what the literature says  (targets)
 *
 * A model can pass every gate and miss its published target. That is reported
 * here rather than hidden behind a linkage check.
 */

import { runBenchmark } from '../harness.js';
import { BENCHMARK_MODELS } from '../models/index.js';
import { KNOWN_SYSTEMS } from '../knownSystems/index.js';
import { assessTargets } from '../knownSystems/targets.js';
import type { BenchResult, BenchmarkScale } from '../types.js';
import type { RigorCheck, RigorSection } from './types.js';

export function runValidation(scale: BenchmarkScale = 'full'): RigorSection {
  const checks: RigorCheck[] = [];
  const bySystemId = new Map(KNOWN_SYSTEMS.map((s) => [s.id, s]));
  const runCache = new Map<string, BenchResult>();

  let linked = 0;
  let quantified = 0;
  let matched = 0;
  let totalStrict = 0;
  let totalHits = 0;
  let strictFamilies = 0;
  let supportedFamilies = 0;

  for (const m of BENCHMARK_MODELS) {
    const e = m.empirical;
    const key = `${m.id}-emp`;

    if (!e) {
      checks.push({
        module: 'validation',
        key,
        label: `${m.id} empirical linkage`,
        outcome: 'WARN',
        value: 0,
        detail: 'no empirical linkage declared — the model has no published reference to validate against',
      });
      continue;
    }

    linked++;
    const system = bySystemId.get(e.systemId);
    if (!system) {
      checks.push({
        module: 'validation',
        key,
        label: `${m.id} → ${e.systemId}`,
        outcome: 'FAIL',
        value: 0,
        detail: `declared systemId '${e.systemId}' is not in the known-systems registry — broken linkage`,
      });
      continue;
    }

    let run = runCache.get(m.id);
    if (!run) {
      run = runBenchmark(m, { scale, determinismCheck: false });
      runCache.set(m.id, run);
    }

    const assessment = assessTargets(system, run);
    if (!assessment || assessment.strictTotal === 0) {
      checks.push({
        module: 'validation',
        key,
        label: `${m.id} → ${e.systemId}`,
        outcome: 'WARN',
        value: 0,
        detail: `linked to ${system.name}, but the source reports no measured or derivable numeric reference — claim is qualitative only: ${e.claim}`,
      });
      continue;
    }

    quantified++;
    totalStrict += assessment.strictTotal;
    totalHits += assessment.strictHits;
    strictFamilies++;
    const familyOk = assessment.strictHits === assessment.strictTotal;
    if (familyOk) supportedFamilies++;
    if (assessment.status === 'matched') matched++;

    const worst = assessment.scores
      .filter((s) => s.kind !== 'expected')
      .sort((a, b) => b.relErr - a.relErr)
      .slice(0, 3)
      .map((s) => `${s.key} obs=${s.observed.toPrecision(4)} vs ${s.target} in [${s.band[0]}, ${s.band[1]}]${s.withinBand ? '' : ' MISS'}`);

    checks.push({
      module: 'validation',
      key,
      label: `${m.id} → ${e.systemId}`,
      outcome: familyOk ? 'PASS' : assessment.strictHits > 0 ? 'WARN' : 'FAIL',
      value: Number(assessment.fidelity.toFixed(3)),
      threshold: `${assessment.strictHits}/${assessment.strictTotal} targets in band`,
      detail: `${assessment.strictHits}/${assessment.strictTotal} measured+derived targets inside the published band; worst: ${worst.join('; ')}${assessment.scores.some((s) => s.kind === 'expected') ? ' (plus qualitative targets reported separately)' : ''}`,
    });
  }

  const reportFidelity = totalStrict > 0 ? totalHits / totalStrict : 1;
  checks.push({
    module: 'validation',
    key: 'emp-report',
    label: 'aggregate empirical fidelity',
    outcome: reportFidelity >= 1 ? 'PASS' : reportFidelity >= 0.8 ? 'WARN' : 'FAIL',
    value: Number(reportFidelity.toFixed(3)),
    threshold: '1.000 = every measured/derived target reproduced',
    detail: `${totalHits}/${totalStrict} measured or derivable literature targets reproduced across ${quantified} quantified systems (${matched} fully matched); ${linked}/${BENCHMARK_MODELS.length} models carry an empirical linkage`,
  });

  const summary =
    `validation: ${supportedFamilies}/${strictFamilies} model families reproduce every measured/derived literature target ` +
    `(${totalHits}/${totalStrict} targets, aggregate ${reportFidelity.toFixed(3)}); ${linked}/${BENCHMARK_MODELS.length} models linked`;
  return {
    id: 'validation',
    title: 'Validation (engine vs published measurements)',
    summary,
    checks,
  };
}
