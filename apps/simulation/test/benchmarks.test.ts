import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runAllBenchmarks, runBenchmark } from '../src/research/benchmarks/harness.js';
import { BENCHMARK_MODELS } from '../src/research/benchmarks/models/index.js';
import { renderBenchReport, renderBenchSvg } from '../src/research/benchmarks/benchRun.js';
import type { BenchmarkModel } from '../src/research/benchmarks/types.js';

const EXPECTED = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'];

test('registry exposes the ten canonical models A–J in order', () => {
  assert.deepEqual(
    BENCHMARK_MODELS.map((m) => m.id),
    EXPECTED,
  );
  for (const m of BENCHMARK_MODELS) {
    assert.ok(m.name.length > 0, `${m.id} has a name`);
    assert.ok(m.reference.length > 0, `${m.id} cites a reference`);
    assert.ok(m.checks.some((c) => c.gate), `${m.id} has at least one gating check`);
  }
});

test('gate semantics: gte/lte/range/eqAbs all pass on a conforming synthetic model', () => {
  const model: BenchmarkModel = {
    id: 'A',
    name: 'synthetic',
    family: 'test',
    stochastic: false,
    reference: 'none',
    run: () => ({ signature: { v: 0.5 }, fingerprint: 'deadbeef' }),
    checks: [
      { key: 'v', test: 'gte', value: 0.4, note: '', gate: true },
      { key: 'v', test: 'lte', value: 0.6, note: '', gate: true },
      { key: 'v', test: 'range', lo: 0.4, hi: 0.6, note: '', gate: true },
      { key: 'v', test: 'eqAbs', value: 0.5, tol: 0.01, note: '', gate: true },
    ],
  };
  const r = runBenchmark(model, { scale: 'quick' });
  assert.equal(r.verdict, 'PASS');
  assert.equal(r.fidelity, 1);
  assert.equal(r.determinism, true);
});

test('gate semantics: a violated gte threshold fails its check', () => {
  const model: BenchmarkModel = {
    id: 'A',
    name: 'synthetic-fail',
    family: 'test',
    stochastic: false,
    reference: 'none',
    run: () => ({ signature: { v: 0.5 }, fingerprint: 'deadbeef' }),
    checks: [{ key: 'v', test: 'gte', value: 0.6, note: '', gate: true }],
  };
  const r = runBenchmark(model, { scale: 'quick' });
  assert.equal(r.verdict, 'FAIL');
  assert.equal(r.checks[0]!.pass, false);
});

test('a missing signature key is a hard failure, not a crash', () => {
  const model: BenchmarkModel = {
    id: 'A',
    name: 'synthetic-missing',
    family: 'test',
    stochastic: false,
    reference: 'none',
    run: () => ({ signature: {}, fingerprint: 'deadbeef' }),
    checks: [{ key: 'absent', test: 'gte', value: 0.1, note: '', gate: true }],
  };
  const r = runBenchmark(model, { scale: 'quick' });
  assert.equal(r.verdict, 'FAIL');
  assert.equal(r.checks[0]!.pass, false);
  assert.ok(Number.isNaN(r.checks[0]!.observed));
});

test('all ten models pass the quick suite with determinism', () => {
  const card = runAllBenchmarks(BENCHMARK_MODELS, { scale: 'quick' });
  assert.equal(card.results.length, 10);
  for (const r of card.results) {
    assert.equal(r.verdict, 'PASS', `${r.id} (${r.name}) should pass quick`);
    assert.equal(r.fidelity, 1, `${r.id} has full fidelity`);
    assert.equal(r.determinism, true, `${r.id} is deterministic`);
  }
  assert.equal(card.pass, true);

  const { md } = renderBenchReport(card);
  assert.ok(md.includes('Benchmark suite'));
  assert.ok(md.includes('overall: **PASS**'));
  assert.ok(renderBenchSvg(card).includes('<svg'));
});
