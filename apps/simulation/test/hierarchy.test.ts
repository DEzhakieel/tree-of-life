import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { LadderResult, LadderLevelVerdict } from '../src/research/ladder.js';
import { objectives, scoreMulti, meetsThresholds } from '../src/research/design/objectives.js';
import { availableObjectives, resolveObjectives, DEFAULT_OBJECTIVES } from '../src/research/experiment.js';

/**
 * Hierarchy gate.
 *
 * Emergence is scored on a three-rung ladder — L1 life, L2 interaction,
 * L3 cognition — and the rungs are *ordered*: the design objectives and the
 * conjunction test must encode that order, and the level-name contract must be
 * read correctly.
 *
 * This pins the regression fixed when the experiment runner landed: objectives
 * used to match the bare string 'L1' against the engine's real level names
 * ('L1 life', 'L2 interaction', 'L3 cognition'), so every emergence score
 * silently collapsed to zero. The tests below use synthetic ladder results so
 * they stay cheap and exact; the real runLadder naming is exercised by
 * experiment.test.ts.
 */

type Verdict = LadderLevelVerdict['verdict'];

interface SyntheticOpts {
  levels: { level: string; verdict: Verdict }[];
  adaptationFrac?: number;
  finalAlive?: number;
  maxPopulation?: number;
  maxSpecies?: number;
  hazardCorr?: number;
  signalCorr?: number;
  speciesMemeMIMax?: number;
}

function ladder(o: SyntheticOpts): LadderResult {
  return {
    synthesis: {
      levels: o.levels.map((l) => ({ level: l.level, verdict: l.verdict, evidence: {}, note: '' })),
      chain: '',
    },
    summary: {
      cognition: {
        adaptationFrac: o.adaptationFrac ?? 0,
        hazardCorr: o.hazardCorr ?? 0,
        signalCorr: o.signalCorr ?? 0,
        speciesMemeMIMax: o.speciesMemeMIMax ?? 0,
      },
      life: { finalAlive: o.finalAlive ?? 0 },
      interaction: { maxSpecies: o.maxSpecies ?? 0 },
    },
    options: { maxPopulation: o.maxPopulation ?? 100 },
  } as unknown as LadderResult;
}

const rungs = (l1: Verdict, l2: Verdict, l3: Verdict): LadderResult =>
  ladder({
    levels: [
      { level: 'L1 life', verdict: l1 },
      { level: 'L2 interaction', verdict: l2 },
      { level: 'L3 cognition', verdict: l3 },
    ],
  });

describe('hierarchy · level-name contract is read by prefix', () => {
  it('reads the real ladder names (L1 life / L2 interaction / L3 cognition)', () => {
    const r = rungs('EMERGENT', 'PARTIAL', 'ABSENT');
    assert.equal(objectives.l1Emergent().value(r), 1);
    assert.equal(objectives.l2Emergent().value(r), 0.5);
    assert.equal(objectives.l3Emergent().value(r), 0);
  });

  it('a bare rung name still matches, but a different rung does not', () => {
    const bare = ladder({ levels: [{ level: 'L1', verdict: 'EMERGENT' }] });
    assert.equal(objectives.l1Emergent().value(bare), 1);
    assert.equal(objectives.l2Emergent().value(bare), 0, 'L2 must not match the L1 rung');
    const matter = ladder({ levels: [{ level: 'L0 matter', verdict: 'EMERGENT' }] });
    assert.equal(objectives.l1Emergent().value(matter), 0, 'L0 must not be read as L1');
  });

  it('a missing rung scores zero rather than throwing', () => {
    const none = ladder({ levels: [] });
    assert.equal(objectives.l1Emergent().value(none), 0);
    assert.equal(objectives.l2Emergent().value(none), 0);
    assert.equal(objectives.l3Emergent().value(none), 0);
  });
});

describe('hierarchy · verdict scores are ordered EMERGENT > PARTIAL > ABSENT', () => {
  it('the three rungs map to 1 > 0.5 > 0', () => {
    for (const obj of [objectives.l1Emergent(), objectives.l2Emergent(), objectives.l3Emergent()]) {
      const e = rungs('EMERGENT', 'EMERGENT', 'EMERGENT');
      const p = rungs('PARTIAL', 'PARTIAL', 'PARTIAL');
      const a = rungs('ABSENT', 'ABSENT', 'ABSENT');
      assert.ok(obj.value(e) > obj.value(p), `${obj.id}: EMERGENT must outrank PARTIAL`);
      assert.ok(obj.value(p) > obj.value(a), `${obj.id}: PARTIAL must outrank ABSENT`);
    }
  });
});

describe('hierarchy · emergence is a conjunction of rungs', () => {
  it('meetsThresholds is true only when all three rungs are EMERGENT', () => {
    const list = [objectives.l1Emergent(), objectives.l2Emergent(), objectives.l3Emergent()];
    assert.equal(meetsThresholds(list, rungs('EMERGENT', 'EMERGENT', 'EMERGENT')), true);
    assert.equal(meetsThresholds(list, rungs('PARTIAL', 'EMERGENT', 'EMERGENT')), false);
    assert.equal(meetsThresholds(list, rungs('EMERGENT', 'ABSENT', 'EMERGENT')), false);
    assert.equal(meetsThresholds(list, rungs('EMERGENT', 'EMERGENT', 'PARTIAL')), false);
  });

  it('scoreMulti sums the weighted rung scores and reports a per-objective breakdown', () => {
    const list = [objectives.l1Emergent(), objectives.l2Emergent(), objectives.l3Emergent()];
    const r = rungs('EMERGENT', 'PARTIAL', 'ABSENT'); // 1 + 0.5 + 0
    const { total, breakdown } = scoreMulti(list, r);
    assert.equal(total, 1.5);
    assert.deepEqual(Object.keys(breakdown).sort(), ['l1-emergent', 'l2-emergent', 'l3-emergent']);
    assert.equal(breakdown['l1-emergent'], 1);
    assert.equal(breakdown['l2-emergent'], 0.5);
    assert.equal(breakdown['l3-emergent'], 0);
  });
});

describe('hierarchy · continuous objectives are clamped and scaled correctly', () => {
  it('adaptation is a percentage (frac × 100), floored at 0', () => {
    const obj = objectives.adaptation(5);
    assert.equal(obj.value(ladder({ levels: [], adaptationFrac: 0.12 })), 12);
    assert.equal(obj.value(ladder({ levels: [], adaptationFrac: -0.5 })), 0);
    assert.equal(obj.threshold, 5);
  });

  it('lifeSteady is finalAlive / maxPopulation', () => {
    const obj = objectives.lifeSteady();
    assert.equal(obj.value(ladder({ levels: [], finalAlive: 25, maxPopulation: 100 })), 0.25);
    assert.equal(obj.value(ladder({ levels: [], finalAlive: -3, maxPopulation: 100 })), 0);
  });

  it('speciation reads maxSpecies and the bounded objectives stay in [0,1]', () => {
    assert.equal(objectives.speciation().value(ladder({ levels: [], maxSpecies: 4 })), 4);
    assert.equal(objectives.hazardAvoidance().value(ladder({ levels: [], hazardCorr: -0.5 })), 0.5);
    assert.equal(objectives.hazardAvoidance().value(ladder({ levels: [], hazardCorr: -2 })), 1);
    assert.equal(objectives.signalUse().value(ladder({ levels: [], signalCorr: 0.3 })), 0.3);
    assert.equal(objectives.cultureMemeMI().value(ladder({ levels: [], speciesMemeMIMax: 0.9 })), 0.9);
  });
});

describe('hierarchy · the objective registry is internally consistent', () => {
  it('every available objective resolves to a scored objective with a unique id', () => {
    const ids = availableObjectives();
    assert.ok(ids.length >= DEFAULT_OBJECTIVES.length);
    const resolved = resolveObjectives();
    assert.deepEqual(resolved.map((o) => o.id), DEFAULT_OBJECTIVES);
    const all = resolveObjectives(ids);
    const seen = new Set<string>();
    for (const o of all) {
      assert.ok(!seen.has(o.id), `duplicate objective id ${o.id}`);
      seen.add(o.id);
      const v = o.value(rungs('EMERGENT', 'EMERGENT', 'EMERGENT'));
      assert.ok(Number.isFinite(v), `objective ${o.id} returned a non-finite value`);
    }
  });

  it('unknown objective ids are rejected loudly', () => {
    assert.throws(() => resolveObjectives(['l1-emergent', 'does-not-exist']), /unknown objective/);
  });
});
