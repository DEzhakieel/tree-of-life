import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  CONDITIONS,
  CONDITION_NAMES,
  SA_CELLS,
  buildSelfAttackReport,
  buildSelfAttackReportFromObservations,
  conditionByName,
  observeRun,
  rollingMean,
  runMetrics,
  runSelfAttack,
  spearman,
  spearmanCI,
  sustainedCross,
  windowMean,
  type Interventions,
} from '../src/research/selfAttack.js';

const CTRL: Interventions = { cost: false, boundary: false, signal: false };
const TICKS = 360;

function shortRun(seed: string, interventions: Interventions = CTRL) {
  return runSelfAttack({ seed, interventions, ticks: TICKS });
}

describe('selfAttack: model determinism and invariants', () => {
  it('reproduces identical series for the same seed and interventions', () => {
    const a = shortRun('det.a');
    const b = shortRun('det.a');
    assert.deepEqual(a.series, b.series);
    assert.equal(a.propagulesTotal, b.propagulesTotal);
    assert.equal(a.aliveScale2, b.aliveScale2);
  });

  it('changes the series when the seed changes', () => {
    const a = shortRun('det.a');
    const b = shortRun('det.b');
    assert.notDeepEqual(a.series.pop, b.series.pop);
  });

  it('keeps traits inside their declared ranges and populations non-negative', () => {
    const r = shortRun('inv.a');
    for (const v of r.series.build) assert.ok(v >= 0 && v <= 2, `build mean ${v}`);
    for (const v of r.series.fec) assert.ok(v >= 1 && v <= 3, `fec mean ${v}`);
    for (const v of r.series.defectors) assert.ok(v >= 0 && v <= 1, `defector fraction ${v}`);
    for (const v of r.series.pop) assert.ok(Number.isInteger(v) && v >= 0 && v <= SA_CELLS);
    for (const v of r.series.nests) assert.ok(Number.isInteger(v) && v >= 0 && v <= SA_CELLS);
    for (const v of r.series.propagules) assert.ok(Number.isInteger(v) && v >= 0);
  });

  it('never reports more living scale-2 lineages than propagules produced', () => {
    const r = shortRun('inv.b');
    assert.ok(r.aliveScale2 >= 0);
    assert.ok(r.aliveScale2 <= r.propagulesTotal + 30);
    assert.ok(r.maxDepth >= 0);
  });
});

describe('selfAttack: intervention wiring', () => {
  it('defines eight unique conditions with the expected flags', () => {
    assert.equal(CONDITIONS.length, 8);
    assert.equal(new Set(CONDITIONS.map((c) => c.name)).size, 8);
    assert.deepEqual(
      CONDITIONS.map((c) => c.name),
      [...CONDITION_NAMES],
    );
    assert.deepEqual(conditionByName('control'), { cost: false, boundary: false, signal: false });
    assert.deepEqual(conditionByName('cost+signal'), { cost: true, boundary: false, signal: true });
    assert.deepEqual(conditionByName('all'), { cost: true, boundary: true, signal: true });
    assert.throws(() => conditionByName('nope'));
  });

  it('seals the cooperative trait at the cross-scale boundary', () => {
    // With boundary ON the propagule always carries the founding builder
    // genotype, so no propagule can be a defector.
    const r = runSelfAttack({ seed: 'bnd.a', interventions: conditionByName('boundary'), ticks: 500 });
    assert.ok(r.propaguleBuilds.length > 0, 'expected at least one propagule');
    for (const b of r.propaguleBuilds) assert.ok(b >= 1, `propagule build ${b}`);
  });

  it('does not seal the boundary when the intervention is off', () => {
    const r = runSelfAttack({ seed: 'bnd.a', interventions: CTRL, ticks: 700 });
    assert.ok(r.propaguleBuilds.some((b) => b === 0), 'expected at least one defector propagule in the control');
  });
});

describe('selfAttack: metrics and statistics', () => {
  it('computes window means and rolling means', () => {
    assert.equal(windowMean([1, 2, 3, 4], 0, 4), 2.5);
    assert.equal(windowMean([1, 2, 3, 4], 3, 9), 4);
    assert.equal(windowMean([], 0, 4), 0);
    assert.deepEqual(rollingMean([2, 2, 2, 2], 2), [2, 2, 2, 2]);
    assert.ok(Math.abs(rollingMean([1, 2, 3], 2)[2]! - 2.5) < 1e-12);
  });

  it('detects a sustained collapse but not a single dip', () => {
    const flat = new Array(400).fill(1);
    assert.equal(sustainedCross(flat, 100, 0.5, 50), -1);
    const dip = [...flat];
    dip[200] = 0;
    assert.equal(sustainedCross(dip, 100, 0.5, 50), -1, 'one tick is not a sustained collapse');
    const collapsed = [...flat.slice(0, 200), ...new Array(200).fill(0)];
    assert.ok(sustainedCross(collapsed, 100, 0.5, 50) >= 190);
  });

  it('computes Spearman rho with ties', () => {
    assert.equal(spearman([1, 2, 3, 4], [10, 20, 30, 40]), 1);
    assert.equal(spearman([1, 2, 3, 4], [40, 30, 20, 10]), -1);
    assert.ok(Math.abs(spearman([1, 2, 3, 4], [1, 1, 2, 2])) < 0.95);
    const ci = spearmanCI([1, 2, 3, 4, 5], [2, 4, 6, 8, 10], { r: 1, samples: 200 });
    assert.ok(ci.rho > 0.99);
  });

  it('produces finite run metrics', () => {
    const m = runMetrics(shortRun('met.a'));
    for (const [k, v] of Object.entries(m)) {
      if (typeof v === 'number') assert.ok(Number.isFinite(v), `${k} is not finite`);
    }
    assert.ok(m.propRetention >= 0);
    assert.ok(m.buildRetention >= 0);
  });
});

describe('selfAttack: report shape', () => {
  const seeds = ['rep.a', 'rep.b'];
  const runs = CONDITIONS.flatMap((c) => seeds.map((seed) => runSelfAttack({ seed, interventions: c.interventions, ticks: 400 })));

  it('summarises every condition and returns all pre-registered claims', () => {
    const rep = buildSelfAttackReport(runs);
    assert.equal(rep.conditions.length, 8);
    assert.deepEqual(
      rep.conditions.map((c) => c.name),
      [...CONDITION_NAMES],
    );
    assert.deepEqual(
      rep.claims.map((c) => c.id),
      ['B-SELF-01', 'B-SELF-02a', 'B-SELF-02b', 'B-SELF-02c', 'B-SELF-03', 'B-SELF-04'],
    );
    for (const c of rep.claims) {
      assert.ok(['supported', 'refuted', 'inconclusive'].includes(c.verdict), c.id);
      assert.ok(c.detail.length > 0);
    }
    assert.ok(rep.rescueFloor > 0);
    assert.equal(rep.seeds.length, 2);
    assert.equal(rep.ticks, 400);
  });

  it('gives identical verdicts when reconstructed from cached observations', () => {
    const obs = runs.map(observeRun);
    const a = buildSelfAttackReport(runs);
    const b = buildSelfAttackReportFromObservations(obs);
    assert.deepEqual(
      b.claims.map((c) => [c.id, c.verdict]),
      a.claims.map((c) => [c.id, c.verdict]),
    );
    assert.equal(b.rescueFloor, a.rescueFloor);
  });

  it('rejects an empty report', () => {
    assert.throws(() => buildSelfAttackReport([]));
  });
});
