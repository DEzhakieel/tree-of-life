import { BENCHMARK_MODELS } from '../models/index.js';
import { runBenchmark } from '../harness.js';
import type { BenchmarkScale } from '../types.js';
import type { RigorCheck, RigorSection } from './types.js';

export function runReproducibility(scale: BenchmarkScale = 'full'): RigorSection {
  const checks: RigorCheck[] = [];
  let detOk = 0;
  for (const m of BENCHMARK_MODELS) {
    const r = runBenchmark(m, { scale, determinismCheck: true });
    const ok = r.determinism;
    if (ok) detOk++;
    checks.push({
      module: 'reproducibility',
      key: `${m.id}-det`,
      label: `${m.id} determinism (double-run fingerprint)`,
      outcome: ok ? 'PASS' : 'FAIL',
      value: ok ? 1 : 0,
      detail: `verdict=${r.verdict}`,
    });
  }
  const summary = `determinism: ${detOk}/${BENCHMARK_MODELS.length} pass (double-run fingerprint gate)`;
  return {
    id: 'reproducibility',
    title: 'Reproducibility (fingerprints + seed cohort)',
    summary,
    checks,
  };
}
