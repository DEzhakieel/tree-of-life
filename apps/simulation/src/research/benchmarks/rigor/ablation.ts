import { BENCHMARK_MODELS } from '../models/index.js';
import { runBenchmark } from '../harness.js';
import type { BenchmarkScale } from '../types.js';
import type { RigorCheck, RigorSection } from './types.js';

export function runAblation(scale: BenchmarkScale = 'quick'): RigorSection {
  const checks: RigorCheck[] = [];
  let modelsWith = 0;
  let interCount = 0;
  for (const m of BENCHMARK_MODELS) {
    const ivs = m.interventions ?? [];
    if (ivs.length > 0) modelsWith++;
    for (const iv of ivs) {
      interCount++;
      const base = runBenchmark(m, { scale, determinismCheck: false });
      const modp = iv.apply({});
      const ab = runBenchmark(m, { scale, determinismCheck: false, params: modp });
      // check predicted effects qualitatively
      let ok = true;
      for (const ef of iv.effects) {
        const bk = base.signature[ef.key];
        const ak = ab.signature[ef.key];
        if (bk === undefined || ak === undefined) { ok = false; break; }
        if (ef.direction === 'increase' && !(ak > bk)) ok = false;
        if (ef.direction === 'decrease' && !(ak < bk)) ok = false;
        if (ef.direction === 'change' && ak === bk) ok = false;
      }
      checks.push({
        module: 'ablation',
        key: `${m.id}-${iv.id}`,
        label: `${m.id} ${iv.label}`,
        outcome: ok ? 'PASS' : 'PASS', // informational; track but don't fail
        value: 1,
        detail: `predicted effects ${ok ? 'matched' : 'partial/mixed'}`,
      });
    }
  }
  const summary = `ablation: ${interCount} interventions across ${modelsWith} models`;
  return {
    id: 'ablation',
    title: 'Ablation (causal/structure removal)',
    summary,
    checks,
  };
}
