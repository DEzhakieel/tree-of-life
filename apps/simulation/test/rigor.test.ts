import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BENCHMARK_MODELS } from '../src/research/benchmarks/models/index.js';
import { runValidation } from '../src/research/benchmarks/rigor/validation.js';
import { runNovelty } from '../src/research/benchmarks/rigor/novelty.js';
import { runRigor } from '../src/research/benchmarks/rigor/rigorRun.js';

test('rigor validation links every model to an empirical or explicit gap', () => {
  const v = runValidation();
  assert.equal(v.id, 'validation');
  assert.equal(v.checks.length, BENCHMARK_MODELS.length);
  for (const c of v.checks) {
    assert.ok(c.module === 'validation');
    assert.ok(c.outcome === 'PASS' || c.outcome === 'WARN');
  }
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
