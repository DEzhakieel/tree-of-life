import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  ALL_RULE_BITS,
  CONWAY,
  DD_SIZE,
  FAMILIES,
  LEGAL_RULE_MASK,
  LifeCA,
  SHOCKS,
  assayRule,
  buildDoomsdayReport,
  dosePermutationP,
  evolveLineage,
  hamming,
  mutateRule,
  ols3,
  reproductionScore,
  ruleLabel,
  scoreRule,
  spearman,
  spearmanCI,
  theilSen,
  type LineageResult,
} from '../src/research/doomsday.js';
import { mulberry32 } from '../src/research/stats.js';

/** Coordinates of every live cell, as `x,y` strings in row-major order. */
function live(ca: LifeCA): string[] {
  const out: string[] = [];
  for (let y = 0; y < ca.size; y++) {
    for (let x = 0; x < ca.size; x++) {
      if (ca.state[y * ca.size + x]) out.push(`${x},${y}`);
    }
  }
  return out;
}

function blank(ca: LifeCA): void {
  ca.load(new Uint8Array(ca.total));
}

describe('Experiment A - rule algebra', () => {
  it('rejects B0 and keeps every mutation legal', () => {
    assert.equal(LEGAL_RULE_MASK & 1, 0);
    const rng = mulberry32(1);
    let r = CONWAY;
    for (let i = 0; i < 500; i++) {
      r = mutateRule(r, rng, 0.5);
      assert.equal(r & 1, 0, 'B0 must never be set');
      assert.ok(r >= 0 && r <= ALL_RULE_BITS);
    }
  });

  it('always changes the rule when it mutates', () => {
    const rng = mulberry32(7);
    for (let i = 0; i < 200; i++) {
      const r = mutateRule(CONWAY, rng, 0);
      assert.notEqual(r, CONWAY);
    }
  });

  it('labels rules in B/S notation', () => {
    assert.equal(ruleLabel(CONWAY), 'B3/S23');
    assert.equal(ruleLabel(0), 'B-/S-');
  });

  it('counts Hamming distance over 18 bits', () => {
    assert.equal(hamming(CONWAY, CONWAY), 0);
    assert.equal(hamming(CONWAY, CONWAY ^ (1 << 4) ^ (1 << 12)), 2);
  });
});

describe('Experiment A - cellular automaton', () => {
  it('keeps a 2x2 block alive (still life)', () => {
    const ca = new LifeCA(16);
    blank(ca);
    for (const [x, y] of [[2, 2], [3, 2], [2, 3], [3, 3]]) ca.state[y! * 16 + x!] = 1;
    ca.step(CONWAY);
    assert.deepEqual(live(ca).sort(), ['2,2', '2,3', '3,2', '3,3']);
  });

  it('oscillates a blinker with period 2', () => {
    const ca = new LifeCA(16);
    blank(ca);
    for (const x of [5, 6, 7]) ca.state[5 * 16 + x] = 1;
    ca.step(CONWAY);
    assert.deepEqual(live(ca).sort(), ['6,4', '6,5', '6,6']);
    ca.step(CONWAY);
    assert.deepEqual(live(ca).sort(), ['5,5', '6,5', '7,5']);
  });

  it('kills an isolated cell under B3/S23', () => {
    const ca = new LifeCA(16);
    blank(ca);
    ca.state[8 * 16 + 8] = 1;
    ca.step(CONWAY);
    assert.equal(ca.alive(), 0);
  });

  it('is deterministic given the same initial state', () => {
    const a = new LifeCA(24);
    const b = new LifeCA(24);
    a.setSoup(123, 0.3);
    b.setSoup(123, 0.3);
    for (let t = 0; t < 40; t++) {
      a.step(CONWAY);
      b.step(CONWAY);
    }
    assert.deepEqual([...a.state], [...b.state]);
    assert.equal(a.alive(), b.alive());
  });

  it('separates soups from different seeds', () => {
    const a = new LifeCA(24);
    const b = new LifeCA(24);
    a.setSoup(1, 0.3);
    b.setSoup(2, 0.3);
    assert.notDeepEqual([...a.state], [...b.state]);
  });

  it('killFraction is exact at the boundaries', () => {
    const ca = new LifeCA(16);
    ca.setSoup(9, 0.5);
    const before = ca.alive();
    assert.equal(ca.killFraction(0, mulberry32(1)), 0);
    assert.equal(ca.alive(), before);
    assert.equal(ca.killFraction(1, mulberry32(1)), before);
    assert.equal(ca.alive(), 0);
  });

  it('requires an rng for noise or partial updates', () => {
    const ca = new LifeCA(16);
    ca.setSoup(4, 0.3);
    assert.throws(() => ca.step(CONWAY, { noise: 0.1 }), RangeError);
    assert.throws(() => ca.step(CONWAY, { partial: 0.5 }), RangeError);
    assert.doesNotThrow(() => ca.step(CONWAY));
  });

  it('rejects a state of the wrong size', () => {
    const ca = new LifeCA(16);
    assert.throws(() => ca.load(new Uint8Array(10)), RangeError);
  });
});

describe('Experiment A - reproduction score', () => {
  it('scores a frozen rule as zero births even when the lattice is full', () => {
    const ca = new LifeCA(16);
    // B-/S012345678: everything that is alive survives, nothing is ever born.
    let rule = 0;
    for (let n = 0; n <= 8; n++) rule |= 1 << (9 + n);
    ca.setSoup(5, 0.3);
    const s = reproductionScore(rule, 'frozen', ca, { burn: 5, train: 10 });
    assert.equal(s.births, 0);
    assert.equal(s.viable, false);
  });

  it('scores a period-2 flipper as zero established offspring despite maximal raw births', () => {
    const ca = new LifeCA(24);
    // B12345678/S-: every cell with a neighbour is born; no cell survives, so
    // the whole lattice flips every tick and no newborn reaches maturity.
    let flip = 0;
    for (let n = 1; n <= 8; n++) flip |= 1 << n;
    const s = reproductionScore(flip, 'flip', ca, { burn: 10, train: 20, maturity: 3 });
    assert.ok(s.births > 0, 'the flipper does produce raw births');
    assert.equal(s.established, 0);
  });

  it('scores Conway on a soup as viable with births', () => {
    const ca = new LifeCA(24);
    const s = reproductionScore(CONWAY, 'conway', ca, { burn: 20, train: 30 });
    assert.ok(s.births > 0);
    assert.ok(s.viable);
    assert.ok(s.meanAlive > 0);
    assert.ok(s.turnoverPerCellTick > 0);
  });

  it('averages over initial conditions and requires all to be viable', () => {
    const ca = new LifeCA(16);
    const one = scoreRule(CONWAY, ['a'], ca);
    const two = scoreRule(CONWAY, ['a', 'b'], ca);
    assert.equal(two.births, (one.births + scoreRule(CONWAY, ['b'], ca).births) / 2);
    assert.throws(() => scoreRule(CONWAY, [], ca), RangeError);
  });
});

describe('Experiment A - assay', () => {
  it('returns every family x level x replicate cell', () => {
    const r = assayRule(CONWAY, 'assay-test', { replicates: 1, size: 24, warm: 30, shockTicks: 10, tail: 4 });
    const max = FAMILIES.reduce((n, f) => n + SHOCKS[f].length, 0);
    assert.ok(r.points.length <= max);
    for (const p of r.points) {
      assert.ok(Number.isFinite(p.retention));
      assert.ok(p.prePop >= 32, 'sub-floor populations are not assayed');
      assert.ok(p.postPop >= 0);
    }
    assert.ok(r.benignViability >= 0 && r.benignViability <= 1);
    assert.equal(r.points.length, max * r.benignViability);
  });

  it('is deterministic for the same rule and seed', () => {
    const a = assayRule(CONWAY, 'same', { replicates: 1, size: 16, warm: 10, shockTicks: 8, tail: 3 });
    const b = assayRule(CONWAY, 'same', { replicates: 1, size: 16, warm: 10, shockTicks: 8, tail: 3 });
    assert.deepEqual(a.points, b.points);
  });

  it('excludes pre-shock populations below the floor', () => {
    // B-/S-: every cell dies on the first tick, so the warm-up leaves nothing
    const dead = assayRule(0, 'dead', { replicates: 1, size: 16, warm: 10, shockTicks: 5, tail: 2 });
    assert.equal(dead.points.length, 0);
    assert.equal(dead.benignViability, 0);
    assert.ok(Number.isNaN(dead.byFamily.noise.retention));
  });

  it('a total mortality pulse leaves an empty grid', () => {
    const ca = new LifeCA(16);
    ca.setSoup(3, 0.4);
    ca.killFraction(1, mulberry32(0));
    assert.equal(ca.alive(), 0);
  });
});

describe('Experiment A - statistics', () => {
  it('spearman is +/-1 on monotone data', () => {
    assert.equal(spearman([1, 2, 3, 4], [10, 20, 30, 40]), 1);
    assert.equal(spearman([1, 2, 3, 4], [40, 30, 20, 10]), -1);
  });

  it('spearman handles ties with average ranks', () => {
    const r = spearman([1, 1, 2, 2], [1, 2, 3, 4]);
    assert.ok(r > 0.8 && r < 1);
  });

  it('spearman returns NaN for a constant vector or too few points', () => {
    assert.ok(Number.isNaN(spearman([1, 1, 1], [1, 2, 3])));
    assert.ok(Number.isNaN(spearman([1, 2], [3, 4])));
  });

  it('bootstrap interval brackets the point estimate', () => {
    const ci = spearmanCI([1, 2, 3, 4, 5, 6], [2, 1, 4, 3, 6, 5], { r: 1, samples: 200 });
    assert.ok(Number.isFinite(ci.rho));
    assert.ok(ci.lo <= ci.hi);
    assert.equal(ci.n, 6);
  });

  it('ols3 recovers a known linear model', () => {
    const rows = Array.from({ length: 40 }, (_, i) => {
      const x1 = (i % 7) - 3;
      const x2 = (i % 5) - 2;
      const x3 = i % 2;
      return { x1, x2, x3, y: 1.5 + 2 * x1 - 3 * x2 + 0.5 * x3 };
    });
    const fit = ols3(rows);
    assert.ok(Math.abs(fit.intercept - 1.5) < 1e-9);
    assert.ok(Math.abs(fit.b1 - 2) < 1e-9);
    assert.ok(Math.abs(fit.b2 + 3) < 1e-9);
    assert.ok(Math.abs(fit.b3 - 0.5) < 1e-9);
  });

  it('the dose permutation test is 1 for a constant outcome', () => {
    assert.equal(dosePermutationP([0, 1, 2, 3], [1, 1, 1, 1]), 1);
  });

  it('theil-sen slope recovers a line and ignores an outlier', () => {
    const xs = [0, 1, 2, 3, 4];
    const ys = xs.map((x) => 2 * x + 1);
    assert.ok(Math.abs(theilSen(xs, ys) - 2) < 1e-12);
    const noisy = [1, 3, 5, 7, 1000];
    assert.ok(theilSen(xs, noisy) < 3, 'one extreme point must not set the slope');
  });
});

describe('Experiment A - evolution', () => {
  it('is deterministic for the same seed and arm', () => {
    const a = evolveLineage('det.a', 'moderate', CONWAY, { gens: 3, pop: 6, size: 16, assay: false });
    const b = evolveLineage('det.a', 'moderate', CONWAY, { gens: 3, pop: 6, size: 16, assay: false });
    assert.equal(a.final, b.final);
    assert.deepEqual(a.generations, b.generations);
    assert.deepEqual(a.trainFinal, b.trainFinal);
  });

  it('selection never lowers the best fitness (elitism)', () => {
    const l = evolveLineage('mono.a', 'strong', CONWAY, { gens: 6, pop: 8, size: 16, assay: false });
    for (let i = 1; i < l.generations.length; i++) {
      assert.ok(l.generations[i]!.bestFitness >= l.generations[i - 1]!.bestFitness);
    }
  });

  it('drift does not use a fitness bias and stays legal', () => {
    const l = evolveLineage('drift.a', 'drift', CONWAY, { gens: 5, pop: 6, size: 16, assay: false });
    assert.equal(l.final & 1, 0);
    assert.ok(l.distance >= 0 && l.distance <= 18);
    assert.equal(l.selectionDifferential, 0);
  });

  it('builds a report with a defined verdict and one row per lineage', () => {
    const lineages: LineageResult[] = [];
    for (const arm of ['drift', 'weak'] as const) {
      lineages.push(evolveLineage('rep.a', arm, CONWAY, { gens: 2, pop: 6, size: 16, assay: true, assayReplicates: 1 }));
    }
    const report = buildDoomsdayReport(lineages, {
      provenance: 'unit test',
      conway: lineages[0]!.assays.ancestor,
      conwayScore: scoreRule(CONWAY, ['x'], new LifeCA(16)),
      bootstrapSamples: 100,
    });
    assert.ok(['supported', 'refuted', 'no-trade-off', 'unresolved'].includes(report.verdict.verdict));
    assert.equal(report.lineages.length, 2);
    assert.equal(report.byFamily.length, 3);
    assert.equal(report.byArm.length, 4);
    assert.equal(report.config.size, DD_SIZE);
    assert.equal(report.config.fitness, 'births');
    assert.equal(report.config.meaningfulCost, 0.1);
  });

  it('records the fitness mode it was selected on', () => {
    const births = evolveLineage('mode.a', 'weak', CONWAY, { gens: 2, pop: 6, size: 16, fitness: 'births' });
    const est = evolveLineage('mode.a', 'weak', CONWAY, { gens: 2, pop: 6, size: 16, fitness: 'established' });
    assert.equal(births.fitness, 'births');
    assert.equal(est.fitness, 'established');

    const rb = buildDoomsdayReport([births], {
      provenance: 'unit test',
      conway: births.assays.ancestor,
      conwayScore: scoreRule(CONWAY, ['x'], new LifeCA(16)),
      bootstrapSamples: 50,
    });
    const re = buildDoomsdayReport([est], {
      provenance: 'unit test',
      conway: est.assays.ancestor,
      conwayScore: scoreRule(CONWAY, ['x'], new LifeCA(16)),
      bootstrapSamples: 50,
    });
    assert.equal(rb.config.fitness, 'births');
    assert.equal(re.config.fitness, 'established');
    assert.equal(rb.lineages[0]!.reproAncestor, births.heldAncestor.births);
    assert.equal(re.lineages[0]!.reproAncestor, est.heldAncestor.established);
  });

  it('uses the requested automaton size rather than the module default', () => {
    const l = evolveLineage('size.a', 'weak', CONWAY, { gens: 2, pop: 4, size: 12, assay: true, assayReplicates: 1 });
    assert.equal(l.assays.final.rule, l.final);
    assert.ok(l.assays.final.points.every((p) => p.prePop >= 32));
    assert.ok(l.assays.final.points.length <= 9);
  });
});
