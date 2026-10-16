import assert from 'node:assert/strict';
import { test } from 'node:test';
import { objectives, scoreMulti, meetsThresholds } from '../src/research/design/objectives.js';
import { randomCandidate, type DesignParam } from '../src/research/design/candidate.js';
import type { LadderResult, LadderLevelVerdict } from '../src/research/ladder.js';

/** synthetic ladder result: only the fields the objectives read */
function fakeResult(verdicts: Record<string, LadderLevelVerdict['verdict']>, cognition?: Partial<{ adaptationFrac: number; hazardCorr: number; signalCorr: number; speciesMemeMIMax: number }>): LadderResult {
  const levels: LadderLevelVerdict[] = Object.entries(verdicts).map(([level, verdict]) => ({ level, verdict, evidence: {}, note: '' }));
  return {
    synthesis: { levels, chain: '' },
    options: { maxPopulation: 400 },
    summary: {
      life: { finalAlive: 200 },
      interaction: { maxSpecies: 4 },
      cognition: { adaptationFrac: 0.25, hazardCorr: -0.4, signalCorr: 0.3, speciesMemeMIMax: 0.2, ...cognition },
    },
  } as unknown as LadderResult;
}

test('emergence objectives read real ladder level names (L1 life / L2 interaction / L3 cognition)', () => {
  // regression: objectives used to match level === 'L1' and silently scored 0
  const r = fakeResult({ 'L1 life': 'EMERGENT', 'L2 interaction': 'PARTIAL', 'L3 cognition': 'ABSENT' });
  assert.equal(objectives.l1Emergent().value(r), 1);
  assert.equal(objectives.l2Emergent().value(r), 0.5);
  assert.equal(objectives.l3Emergent().value(r), 0);
});

test('emergence objectives tolerate bare L1/L2/L3 ids', () => {
  const r = fakeResult({ L1: 'PARTIAL', L2: 'EMERGENT', L3: 'PARTIAL' });
  assert.equal(objectives.l1Emergent().value(r), 0.5);
  assert.equal(objectives.l2Emergent().value(r), 1);
  assert.equal(objectives.l3Emergent().value(r), 0.5);
});

test('numeric objectives clamp and scale as documented', () => {
  const r = fakeResult({ 'L1 life': 'EMERGENT' }, { adaptationFrac: 0.4, hazardCorr: -0.8, signalCorr: 0.5, speciesMemeMIMax: 0.6 });
  assert.equal(objectives.adaptation().value(r), 40);
  assert.equal(objectives.lifeSteady().value(r), 0.5);
  assert.equal(objectives.speciation().value(r), 4);
  assert.equal(objectives.hazardAvoidance().value(r), 0.8);
  assert.equal(objectives.signalUse().value(r), 0.5);
  assert.equal(objectives.cultureMemeMI().value(r), 0.6);
});

test('scoreMulti applies weights; meetsThresholds gates on threshold', () => {
  const r = fakeResult({ 'L1 life': 'EMERGENT', 'L3 cognition': 'EMERGENT' });
  const objs = [objectives.l1Emergent(), objectives.adaptation(50)];
  const s = scoreMulti(objs, r);
  assert.equal(s.breakdown['l1-emergent'], 1);
  assert.equal(s.breakdown['adaptation'], 25);
  assert.equal(s.total, 26);
  assert.equal(meetsThresholds(objs, r), false, 'adaptation 25 < 50 must fail the gate');

  const pass = meetsThresholds([objectives.l1Emergent(), objectives.lifeSteady()], r);
  assert.equal(pass, true);
});

test('randomCandidate is deterministic per seed and respects bounds/integer', () => {
  const params: DesignParam[] = [
    { key: 'foodRegenRate', min: 0.0001, max: 0.001 },
    { key: 'spawnCount', min: 10, max: 100, integer: true },
  ];
  const a = randomCandidate(params, 42);
  const b = randomCandidate(params, 42);
  const c = randomCandidate(params, 43);
  assert.deepEqual(a.params, b.params);
  assert.notDeepEqual(a.params, c.params);
  const fr = a.params['foodRegenRate'] as number;
  const sc = a.params['spawnCount'] as number;
  assert.ok(fr >= 0.0001 && fr <= 0.001);
  assert.ok(sc >= 10 && sc <= 100 && Number.isInteger(sc));
});
