import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assembleScope, validateScope, scopeIsSound, benchmarkClaims, empiricalClaims, claimsForQuestion, claimById, RESEARCH_SCOPE } from '../src/research/scope.js';
import { buildClaimsLedger, untestedClaims, verdictsFromKnownReport, verdictsFromBenchScorecard, verdictsFromRigor, verdictsFromLoop, verdictFromWorldControl, verdictsFromDeterminism } from '../src/research/claims.js';
import { informationCriteria, relativeSse, countFreeParams, parsimonyRank } from '../src/research/benchmarks/parsimony.js';
import { scoreTarget, assessTargets, isStrictTarget, aggregateTargets } from '../src/research/benchmarks/knownSystems/targets.js';
import { BENCHMARK_MODELS } from '../src/research/benchmarks/models/index.js';
import { KNOWN_SYSTEMS } from '../src/research/benchmarks/knownSystems/index.js';
import { buildKnownReport } from '../src/research/benchmarks/knownSystems/index.js';
import type { BenchResult, BenchScorecard } from '../src/research/benchmarks/types.js';
import type { KnownReport } from '../src/research/benchmarks/knownSystems/types.js';

/* ---------- scope integrity ---------- */

test('the research scope is internally sound and every question has a claim', () => {
  const scope = assembleScope();
  const issues = validateScope(scope);
  const errors = issues.filter((i) => i.severity === 'error');
  assert.deepEqual(errors, [], `scope has blocking issues: ${JSON.stringify(errors)}`);
  assert.ok(scopeIsSound(scope));
  for (const q of scope.questions) {
    assert.ok(claimsForQuestion(scope, q.id).length > 0, `question ${q.id} has no claim`);
  }
});

test('every claim carries a non-empty falsifiability statement', () => {
  for (const c of assembleScope().claims) {
    assert.ok(c.falsifiability.statement.trim().length > 0, `${c.id} has no falsifier`);
    assert.ok(c.claim.trim().length > 0, `${c.id} has no claim text`);
  }
});

test('claim ids are unique and traceable to a question', () => {
  const scope = assembleScope();
  const ids = scope.claims.map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length, 'duplicate claim id');
  const questions = new Set(scope.questions.map((q) => q.id));
  for (const c of scope.claims) assert.ok(questions.has(c.question), `${c.id} → unknown question ${c.question}`);
});

test('per-model and per-system claims are derived from the registries', () => {
  const scope = assembleScope();
  assert.equal(benchmarkClaims().length, BENCHMARK_MODELS.length);
  // every replicated system carrying targets must yield an empirical claim
  const withTargets = KNOWN_SYSTEMS.filter((s) => s.replicated && s.benchId && (s.targets?.length ?? 0) > 0);
  assert.ok(withTargets.length > 0);
  for (const s of withTargets) {
    const id = `C-EMP-${s.id.toUpperCase().replace(/-/g, '_')}`;
    assert.ok(claimById(scope, id), `missing derived claim for ${s.id}`);
  }
});

/* ---------- empirical targets ---------- */

test('every empirical target key is a declared signature key of the linked benchmark', () => {
  const byId = new Map(BENCHMARK_MODELS.map((m) => [m.id, m]));
  for (const s of KNOWN_SYSTEMS) {
    if (!s.targets || !s.benchId) continue;
    const model = byId.get(s.benchId)!;
    const declared = new Set<string>([...model.checks.map((c) => c.key), ...Object.keys(model.analytic ?? {})]);
    for (const t of s.targets) {
      assert.ok(declared.has(t.key), `${s.id} target '${t.key}' is not a signature key of benchmark ${s.benchId}`);
      assert.ok(t.source.trim().length > 0, `${s.id} target '${t.key}' has no source`);
    }
  }
});

test('only measured and derived targets count toward strict fidelity', () => {
  assert.ok(isStrictTarget({ key: 'x', value: 1, source: 's', kind: 'measured' }));
  assert.ok(isStrictTarget({ key: 'x', value: 1, source: 's', kind: 'derived' }));
  assert.ok(!isStrictTarget({ key: 'x', value: 1, source: 's', kind: 'expected' }));
});

test('scoreTarget marks a hit inside the band and a miss outside it', () => {
  const run = (obs: number): BenchResult => ({
    id: 'A', name: 'x', family: 'f', stochastic: false, seeds: 1, scale: 'quick',
    signature: { alpha: obs }, ci: { alpha: [obs, obs] }, checks: [], fidelity: 1, determinism: true, verdict: 'PASS', elapsedMs: 0,
  });
  const target = { key: 'alpha', value: 1, tol: 0.02, kind: 'derived' as const, source: 'test' };
  assert.ok(scoreTarget(target, run(1.001)).withinBand);
  assert.ok(!scoreTarget(target, run(1.5)).withinBand);
  // a CI that straddles the band edge does not count, even if the mean is inside
  const straddle: BenchResult = { ...run(1.0), ci: { alpha: [0.9, 1.1] } };
  assert.ok(!scoreTarget(target, straddle).withinBand);
});

test('aggregateTargets ignores systems with no strict targets', () => {
  const a = { systemId: 's', benchId: 'A' as const, scores: [], hits: 2, total: 3, strictHits: 2, strictTotal: 3, fidelity: 2 / 3, status: 'partial' as const };
  const b = { systemId: 't', benchId: 'B' as const, scores: [], hits: 2, total: 2, strictHits: 0, strictTotal: 0, fidelity: 1, status: 'matched' as const };
  const agg = aggregateTargets([a, b, undefined]);
  assert.equal(agg.assessed, 1);
  assert.equal(agg.hits, 2);
  assert.equal(agg.total, 3);
});

/* ---------- parsimony ---------- */

test('information criteria charge for free parameters', () => {
  const simple = informationCriteria(2, 1, 20);
  const complex = informationCriteria(8, 1, 20);
  assert.ok(complex.aic > simple.aic, 'more parameters must cost');
  assert.ok(complex.bic > simple.bic);
  assert.equal(complex.aic - simple.aic, 12); // 2 * (8 - 2)
});

test('relativeSse uses a symmetric relative residual that stays bounded near zero', () => {
  const { sse, n } = relativeSse({ a: 2, b: 1 }, { a: 1, b: 1 });
  assert.equal(n, 2);
  assert.equal(sse, 0.25); // (2-1)/max(1,2) = 0.5, squared; b contributes 0
  // a zero reference (an ideal error target) must not blow up: residual is bounded by 1
  const zero = relativeSse({ relL2: 1e-4, massRelErr: 0 }, { relL2: 0, massRelErr: 0 });
  assert.equal(zero.n, 2);
  assert.ok(zero.sse <= 2 && Number.isFinite(zero.sse), `expected bounded sse, got ${zero.sse}`);
});

test('countFreeParams counts only values differing from the default', () => {
  assert.equal(countFreeParams({ a: 1, b: 2 }, { a: 1, b: 9 }), 1);
  assert.equal(countFreeParams({ a: 1, b: 2 }, undefined), 2);
  assert.equal(countFreeParams(undefined, { a: 1 }), 0);
});

test('a simpler candidate wins when accuracy is equal', () => {
  const rank = parsimonyRank([
    { id: 'complex', k: 6, sse: 0.5, n: 12 },
    { id: 'simple', k: 1, sse: 0.5, n: 12 },
  ])!;
  assert.equal(rank.best.id, 'simple');
  assert.ok(rank.ranked[1]!.deltaAic > 6);
  assert.equal(rank.ranked[1]!.evidence, 'none');
  assert.ok(rank.best.akaikeWeight > 0.99);
});

/* ---------- claims ledger ---------- */

test('verdicts can only attach to claim ids that the scope pre-registered', () => {
  const scope = assembleScope();
  const bogus = verdictsFromLoop([{ verdict: 'supported' }], 1, scope);
  assert.equal(bogus.length, 2);
  // feeding an unknown id through the builder is silently dropped
  const ledger = buildClaimsLedger([{ claimId: 'C-NOPE', question: 'RQ1', kind: 'behavioral', basis: 'harness-gate', criterion: { statement: 'x' }, test: null, status: 'supported', statistic: null, detail: '', source: '', artifacts: [] }], scope);
  assert.equal(ledger.verdicts.length, 0);
});

test('buildClaimsLedger deduplicates by claim id and tallies by question', () => {
  const scope = assembleScope();
  const verdicts = [
    ...verdictsFromDeterminism([{ name: 'first-order', pass: true }, { name: 'third-order', pass: true }], scope),
    ...verdictsFromDeterminism([{ name: 'stochastic', pass: true }], scope),
  ];
  const ledger = buildClaimsLedger(verdicts, scope);
  assert.equal(ledger.verdicts.filter((v) => v.claimId === 'C-DET-01').length, 1);
  assert.equal(ledger.summary.total, 1);
  assert.equal(ledger.summary.supported, 1);
  const rq1 = ledger.byQuestion.find((q) => q.question === 'RQ1')!;
  assert.equal(rq1.total, 1);
});

test('a failing scorecard refutes the benchmark claims', () => {
  const scope = assembleScope();
  const result: BenchResult = {
    id: 'A', name: 'Random walkers', family: 'diffusion', stochastic: false, seeds: 1, scale: 'quick',
    signature: { alpha: 1 }, ci: { alpha: [1, 1] },
    checks: [{ key: 'alpha', test: 'range', threshold: [0.98, 1.02], observed: 1, ci: [1, 1], pass: false, gate: true, note: '' }],
    fidelity: 0, determinism: true, verdict: 'FAIL', elapsedMs: 0,
  };
  const card: BenchScorecard = { scale: 'quick', seeds: ['s'], results: [result], pass: false, totalMs: 0 };
  const ledger = buildClaimsLedger(verdictsFromBenchScorecard(card, scope), scope);
  assert.equal(ledger.verdicts.find((v) => v.claimId === 'C-BENCH-A')!.status, 'refuted');
  assert.equal(ledger.verdicts.find((v) => v.claimId === 'C-BENCH-ALL')!.status, 'refuted');
  assert.equal(ledger.verdicts.find((v) => v.claimId === 'C-DET-02')!.status, 'supported');
});

test('the world-controller verdict flips on the sign of the comparison', () => {
  const scope = assembleScope();
  const worse = verdictFromWorldControl({ control: { aliveCount: 139, population: 429, speciesCount: 45 }, final: { aliveCount: 54, population: 236, speciesCount: 34 } }, scope);
  assert.equal(worse[0]!.claimId, 'C-AI-03');
  assert.equal(worse[0]!.status, 'refuted');
  const better = verdictFromWorldControl({ control: { aliveCount: 10, population: 20, speciesCount: 5 }, final: { aliveCount: 40, population: 80, speciesCount: 9 } }, scope);
  assert.equal(better[0]!.status, 'supported');
});

test('the AI loop verdicts are harness-scored or refuted', () => {
  const scope = assembleScope();
  const scored = verdictsFromLoop([{ verdict: 'supported' }, { verdict: 'refuted' }], 2, scope);
  assert.equal(scored.find((v) => v.claimId === 'C-AI-01')!.status, 'supported');
  assert.equal(scored.find((v) => v.claimId === 'C-AI-02')!.status, 'supported');
  const unscored = verdictsFromLoop([{ verdict: 'supported' }], 0, scope);
  assert.equal(unscored.find((v) => v.claimId === 'C-AI-01')!.status, 'refuted');
});

test('untestedClaims lists declared claims with no evidence', () => {
  const scope = assembleScope();
  const ledger = buildClaimsLedger(verdictsFromDeterminism([{ name: 'first-order', pass: true }], scope), scope);
  const untested = untestedClaims(scope, ledger);
  assert.ok(untested.includes('C-BENCH-ALL'));
  assert.ok(!untested.includes('C-DET-01'));
});

/* ---------- integration: fresh quick runs ---------- */

test('the known-systems report scores published targets independently of the gates', () => {
  const report = buildKnownReport('quick');
  assert.ok(report.assessed > 0, 'expected at least one system with measured/derived targets');
  assert.ok(report.empiricalTotal > 0);
  assert.ok(report.empiricalFidelity >= 0 && report.empiricalFidelity <= 1);
  // a target assessment must never see a key the model does not emit
  for (const e of report.entries) {
    if (!e.targetAssessment) continue;
    for (const s of e.targetAssessment.scores) assert.ok(Number.isFinite(s.target));
  }
});

test('the known report feeds the empirical claims without duplicating the aggregate', () => {
  const scope = assembleScope();
  const report: KnownReport = buildKnownReport('quick');
  const verdicts = verdictsFromKnownReport(report, scope);
  const ids = verdicts.map((v) => v.claimId);
  assert.equal(new Set(ids).size, ids.length, 'duplicate empirical verdict');
  const agg = verdicts.filter((v) => v.claimId === 'C-EMP-AGG');
  assert.equal(agg.length, 1);
});

test('rigor verdicts read ablation, significance and novelty checks', () => {
  const scope = assembleScope();
  const sections = [
    { id: 'ablation', checks: [{ key: 'B-alignOff', label: '', outcome: 'PASS', value: 1, detail: '' }] },
    { id: 'significance', checks: [{ key: 'sig-A-alpha', label: '', outcome: 'PASS', value: 0.01, detail: '' }, { key: 'sig-A-consistency', label: '', outcome: 'PASS', value: 1, detail: '' }] },
    { id: 'novelty', checks: [{ key: 'novel-disc', label: '', outcome: 'PASS', value: 0.75, detail: '' }, { key: 'novel-coverage', label: '', outcome: 'PASS', value: 1, detail: '' }] },
  ];
  const ledger = buildClaimsLedger(verdictsFromRigor(sections, scope), scope);
  assert.equal(ledger.verdicts.find((v) => v.claimId === 'C-ABL-01')!.status, 'supported');
  assert.equal(ledger.verdicts.find((v) => v.claimId === 'C-SIG-01')!.status, 'supported');
  assert.equal(ledger.verdicts.find((v) => v.claimId === 'C-NOV-01')!.status, 'supported');
  assert.equal(ledger.verdicts.filter((v) => v.claimId === 'C-SIG-01').length, 1);
});

test('scope version and purpose are declared', () => {
  assert.match(RESEARCH_SCOPE.version, /^\d+\.\d+\.\d+$/);
  assert.ok(RESEARCH_SCOPE.purpose.length > 40);
  assert.ok(RESEARCH_SCOPE.boundaries.some((b) => b.decision === 'out'), 'a scope must exclude something');
});
