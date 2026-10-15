import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BENCHMARK_MODELS } from '../src/research/benchmarks/models/index.js';
import { runValidation } from '../src/research/benchmarks/rigor/validation.js';
import { runNovelty } from '../src/research/benchmarks/rigor/novelty.js';
import { runRigor } from '../src/research/benchmarks/rigor/rigorRun.js';

test('rigor validation scores every model against published targets', () => {
  const v = runValidation('quick');
  assert.equal(v.id, 'validation');
  const modelChecks = v.checks.filter((c) => c.key.endsWith('-emp'));
  assert.equal(modelChecks.length, BENCHMARK_MODELS.length);
  for (const c of modelChecks) {
    assert.equal(c.module, 'validation');
    assert.ok(['PASS', 'WARN', 'FAIL'].includes(c.outcome));
  }
  const agg = v.checks.find((c) => c.key === 'emp-report');
  assert.ok(agg, 'missing aggregate empirical-fidelity check');
  assert.equal(agg.outcome, 'PASS', 'the shipped suite must reproduce every measured/derived target');
});

test('rigor novelty scorecard produces the expected gated checks', () => {
  const v = runNovelty();
  assert.equal(v.id, 'novelty');
  const keys = v.checks.map((c) => c.key);
  for (const k of ['novel-coverage', 'novel-disc', 'novel-fid', 'novel-ground', 'novel-repro', 'novel-score', 'sigspace-hash']) {
    assert.ok(keys.includes(k), `missing ${k}`);
  }
});

test('importing rigorRun does not execute the suite (proper entry guard)', () => {
  assert.equal(typeof runRigor, 'function');
});
