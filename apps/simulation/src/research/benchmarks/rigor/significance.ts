import fs from 'node:fs';
import path from 'node:path';
import { clopperPearson, mean, pFromT, sd } from '../../statistics.js';
import { sbpBF } from '../../bayes.js';
import { BENCH_SEEDS } from '../harness.js';
import { BENCHMARK_MODELS } from '../models/index.js';
import type { BenchCheck, BenchmarkModel, BenchParams, BenchmarkScale } from '../types.js';
import type { RigorCheck, RigorSection } from './types.js';

const LEDGER = path.resolve(
  'C:\\Users\\LENOVO\\Downloads\\fractallife2\\apps\\simulation\\research\\output\\rigor-hypotheses.json',
);

interface SigTest {
  mean: number;
  sd: number;
  n: number;
  t: number;
  /** two-sided p (drives the minimal Bayes factor) */
  pTwo: number;
  /** one-sided p in the claim's direction */
  pOne: number;
  signOk: boolean;
}

/**
 * One-sample one-sided Student-t test that the seed-cohort mean lies on the
 * claimed side of the gate threshold. Direction 'gt' => H1: mean > threshold
 * (a `gte` gate); 'lt' => H1: mean < threshold (an `lte` gate). When a model is
 * deterministic across seeds (sd = 0) the test degenerates to a point statement.
 */
function oneSided(vals: number[], threshold: number, dir: 'gt' | 'lt'): SigTest {
  const n = vals.length;
  const m = mean(vals);
  const s = n >= 2 ? sd(vals) : 0;
  const effect = m - threshold;
  const dirHolds = dir === 'gt' ? effect > 0 : effect < 0;
  if (n < 2 || s === 0) {
    const decisive = dirHolds && effect !== 0;
    return { mean: m, sd: s, n, t: decisive ? Infinity : 0, pTwo: decisive ? 0 : 1, pOne: decisive ? 0 : 1, signOk: decisive };
  }
  const t = effect / (s / Math.sqrt(n));
  const pTwo = pFromT(t, n - 1);
  const pOne = dir === 'gt' ? (t >= 0 ? pTwo / 2 : 1 - pTwo / 2) : (t <= 0 ? pTwo / 2 : 1 - pTwo / 2);
  return { mean: m, sd: s, n, t, pTwo, pOne, signOk: dirHolds };
}

/** Holm–Bonferroni step-down adjusted p-values (FWER control). */
function holm(ps: number[]): number[] {
  const m = ps.length;
  const order = ps.map((_, i) => i).sort((a, b) => ps[a]! - ps[b]!);
  const adj = new Array<number>(m);
  let running = 0;
  order.forEach((idx, rank) => {
    running = Math.max(running, Math.min(1, (m - rank) * ps[idx]!));
    adj[idx] = running;
  });
  return adj;
}

/**
 * Per-seed signature vectors: one FULL-scale run per cohort seed, reused for
 * every test. Full scale is required so the significance tests are evaluated in
 * the same regime as the benchmark gates they mirror — at `quick` a model can
 * pass its gate on CI bounds yet fail a one-sided test purely from scale noise.
 */
function perSeedSignatures(model: BenchmarkModel, scale: BenchmarkScale): { seed: string; sig: Record<string, number> }[] {
  const params: BenchParams = {};
  return BENCH_SEEDS.map((seed) => ({ seed, sig: model.run(seed, scale, params).signature }));
}

const oneSidedGate = (c: BenchCheck): 'gt' | 'lt' | undefined =>
  c.gate && (c.test === 'gte' || c.test === 'lte') && typeof c.value === 'number'
    ? c.test === 'gte'
      ? 'gt'
      : 'lt'
    : undefined;

export function runSignificance(scale: BenchmarkScale = 'full'): RigorSection {
  const checks: RigorCheck[] = [];
  const ledgerFamily: unknown[] = [];
  let tested = 0;
  let supported = 0;

  for (const m of BENCHMARK_MODELS) {
    const perSeed = perSeedSignatures(m, scale);
    const tests: { check: BenchCheck; dir: 'gt' | 'lt'; st: SigTest }[] = [];
    for (const c of m.checks) {
      const dir = oneSidedGate(c);
      if (!dir) continue;
      const vals = perSeed.map((s) => s.sig[c.key]).filter((v): v is number => Number.isFinite(v));
      if (vals.length === 0) continue;
      tests.push({ check: c, dir, st: oneSided(vals, c.value!, dir) });
    }
    if (tests.length === 0) continue;
    tested++;

    // Holm correction over this model's own family of claims
    const adj = holm(tests.map((t) => t.st.pOne));
    let modelSupported = true;
    tests.forEach((t, i) => {
      const holmP = adj[i]!;
      const bf = sbpBF(t.st.pTwo);
      const outcome = !t.st.signOk ? 'FAIL' : holmP < 0.05 ? 'PASS' : 'WARN';
      if (outcome !== 'PASS') modelSupported = false;
      const cmp = t.dir === 'gt' ? '≥' : '≤';
      checks.push({
        module: 'significance',
        key: `sig-${m.id}-${t.check.key}`,
        label: `${m.id} ${t.check.key} ${cmp} ${t.check.value}`,
        outcome,
        value: Number(holmP.toFixed(5)),
        threshold: 'Holm p < 0.05',
        detail: `mean=${t.st.mean.toFixed(4)} sd=${t.st.sd.toFixed(4)} n=${t.st.n} t=${Number.isFinite(t.st.t) ? t.st.t.toFixed(2) : '∞'} raw p₁=${t.st.pOne.toExponential(2)} Holm p=${holmP.toExponential(2)} BF≤${bf.toFixed(2)}`,
      });
      ledgerFamily.push({
        model: m.id,
        key: t.check.key,
        direction: t.dir === 'gt' ? 'gte' : 'lte',
        threshold: t.check.value,
        mean: t.st.mean,
        sd: t.st.sd,
        n: t.st.n,
        t: t.st.t,
        pTwo: t.st.pTwo,
        pOne: t.st.pOne,
        holmP,
        bf,
        outcome,
      });
    });

    // exact (Clopper–Pearson) per-seed consistency: how many seeds individually clear every gate
    const k = perSeed.filter(({ sig }) =>
      tests.every((t) => {
        const v = sig[t.check.key];
        if (!Number.isFinite(v)) return false;
        return t.dir === 'gt' ? v! >= t.check.value! : v! <= t.check.value!;
      }),
    ).length;
    const n = perSeed.length;
    const bin = clopperPearson(k, n);
    checks.push({
      module: 'significance',
      key: `sig-${m.id}-consistency`,
      label: `${m.id} per-seed gate consistency`,
      outcome: k === n ? 'PASS' : k >= n / 2 ? 'WARN' : 'FAIL',
      value: Number((k / n).toFixed(3)),
      threshold: 'k/n = 1',
      detail: `${k}/${n} seeds clear all gates; exact 95% CI [${bin[0].toFixed(3)}, ${bin[1].toFixed(3)}]`,
    });
    if (modelSupported) supported++;
  }

  // sequential, deterministic ledger (fully derived ⇒ idempotent re-runs)
  try {
    fs.mkdirSync(path.dirname(LEDGER), { recursive: true });
    fs.writeFileSync(
      LEDGER,
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          method:
            'one-sample one-sided Student-t on the seed-cohort mean vs each gating threshold; ' +
            'Holm–Bonferroni adjustment within each model family (FWER 0.05); ' +
            'Sellke–Berger–Pericchi minimal Bayes factor from the two-sided p; ' +
            'exact Clopper–Pearson per-seed gate-consistency interval.',
          family: ledgerFamily,
        },
        null,
        2,
      ),
    );
  } catch {
    /* ledger is best-effort */
  }

  const summary = `significance: ${supported}/${tested} model families supported (Holm FWER 0.05) across ${ledgerFamily.length} directional claims`;
  return {
    id: 'significance',
    title: 'Statistical significance (one-sided t + Holm–Bonferroni + Bayes factors)',
    summary,
    checks,
  };
}
