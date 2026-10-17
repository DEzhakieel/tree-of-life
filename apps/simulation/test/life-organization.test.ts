import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  LIFE_LEVELS,
  LIFE_LEVEL_IDS,
  emptySimStats,
  lifeSeries,
  summarizeLife,
  type LifeRaw,
  type SimStats,
} from '@fractal-life/shared';

function raw(tick: number, patch: Partial<SimStats>): LifeRaw {
  return { tick, stats: emptySimStats(tick, 1, patch) };
}

/** Always-on layers only: chemistry + biology. Omics (Phase E–I) left at 0. */
function legacySeries(n = 20): LifeRaw[] {
  const out: LifeRaw[] = [];
  for (let i = 0; i < n; i++) {
    out.push(
      raw((i + 1) * 10, {
        chemicalDiversity: 1 + 0.5 * i,
        meanPH: 7 - 0.01 * i,
        terrainOxygen: 0.2 + 0.01 * i,
        terrainPH: 6.5 + 0.005 * i,
        terrainToxin: 0.05 + 0.002 * i,
        meanGlucose: 0.3 + 0.01 * i,
        meanATP: 0.4 + 0.01 * i,
        meanMembranePot: -70 + 0.1 * i,
        speciesCount: 5 + 0.5 * i,
        biodiversityIndex: 0.2 + 0.01 * i,
        meanTrophicLevel: 0.5 + 0.02 * i,
        meanFitness: 1 + 0.05 * i,
        cooperation: 0.1 + 0.005 * i,
      }),
    );
  }
  return out;
}

/** Same, plus the opt-in omics substrates that wire the outer rungs. */
function fullSeries(n = 20): LifeRaw[] {
  const base = legacySeries(n);
  for (let i = 0; i < n; i++) {
    Object.assign(base[i].stats, {
      bosonFieldIntensity: 0.3 + 0.02 * i,
      photonTransport: 0.25 + 0.02 * i,
      gluonConfinement: 0.4 + 0.015 * i,
      strongCoupling: 0.35 + 0.02 * i,
      protonStability: 0.5 + 0.01 * i,
      coherenceLifetime: 0.2 + 0.02 * i,
      tunnelingRate: 0.15 + 0.02 * i,
      nativeFraction: 0.3 + 0.02 * i,
      expressionEntropy: 1 + 0.05 * i,
      transcriptActivity: 0.4 + 0.02 * i,
      proteomeLoad: 0.5 + 0.02 * i,
      proteinDiversity: 2 + 0.1 * i,
      orgIndex: 0.1 + 0.01 * i,
      clusterOrder: 0.2 + 0.01 * i,
      rotationalOrder: 0.05 + 0.01 * i,
      metabolicRate: 0.3 + 0.02 * i,
      cardiovascularPump: 0.2 + 0.02 * i,
      respirationEfficiency: 0.25 + 0.02 * i,
      digestiveThroughput: 0.3 + 0.02 * i,
      immuneSurveillance: 0.35 + 0.02 * i,
      neuralConductance: 0.1 + 0.02 * i,
      growthReplication: 0.4 + 0.02 * i,
    });
  }
  return base;
}

describe('life-organization ladder definition', () => {
  it('has ten ordered levels O0..O9', () => {
    assert.equal(LIFE_LEVELS.length, 10);
    assert.deepEqual([...LIFE_LEVEL_IDS], ['O0', 'O1', 'O2', 'O3', 'O4', 'O5', 'O6', 'O7', 'O8', 'O9']);
    LIFE_LEVELS.forEach((def, i) => {
      assert.equal(def.index, i);
      assert.ok(def.channels.length > 0, `${def.id} has no channels`);
      for (const c of def.channels) assert.ok(c.field in emptySimStats(0, 1), `${def.id} channel ${c.field} not a SimStats field`);
    });
  });

  it('chains dependencies from O0 outward', () => {
    assert.deepEqual(LIFE_LEVELS[0].deps, []);
    for (let i = 1; i < LIFE_LEVELS.length; i++) {
      assert.deepEqual(LIFE_LEVELS[i].deps, [LIFE_LEVELS[i - 1].id]);
    }
  });
});

describe('lifeSeries substrate discipline', () => {
  it('reads unwired levels DORMANT, not zero-scored, in the legacy arm', () => {
    const s = summarizeLife(lifeSeries(legacySeries()));
    const byId = new Map(s.levels.map((l) => [l.id, l]));
    // subatomic/quantum, macromolecular-omics, organ, organ-system have no substrate
    assert.equal(byId.get('O0')!.status, 'DORMANT');
    assert.equal(byId.get('O0')!.everMeasured, false);
    assert.equal(byId.get('O7')!.status, 'DORMANT');
    assert.equal(byId.get('O8')!.status, 'DORMANT');
    // the always-on layers are measured
    for (const id of ['O1', 'O2', 'O4', 'O5', 'O6', 'O9'] as const) {
      assert.equal(byId.get(id)!.everMeasured, true, `${id} should be measured`);
      assert.notEqual(byId.get(id)!.status, 'DORMANT');
    }
  });

  it('wires the outer rungs once the omics substrate is present', () => {
    const s = summarizeLife(lifeSeries(fullSeries()));
    for (const id of ['O0', 'O3', 'O7', 'O8'] as const) {
      assert.equal(s.levels.find((l) => l.id === id)!.everMeasured, true, `${id} should be measured`);
    }
    assert.equal(s.ceiling, 'O9');
  });

  it('reports coverage rising when the substrate is wired', () => {
    const legacy = summarizeLife(lifeSeries(legacySeries()));
    const full = summarizeLife(lifeSeries(fullSeries()));
    const legO0 = legacy.levels[0].coverage;
    const fullO0 = full.levels[0].coverage;
    assert.equal(legO0, 0);
    assert.ok(fullO0 > 0.25, `O0 coverage should clear the floor, got ${fullO0}`);
  });
});

describe('lifeSeries hysteresis & novelty', () => {
  it('records a hysteretic onset when a level ramps up, and is deterministic', () => {
    const raws = fullSeries();
    const a = lifeSeries(raws);
    const b = lifeSeries(raws);
    assert.deepEqual(
      a.map((p) => p.scores.O9),
      b.map((p) => p.scores.O9),
    );
    const s = summarizeLife(a);
    const o9 = s.levels[9];
    assert.equal(o9.everEmergent, true);
    assert.ok(o9.onset !== null && o9.onset > 0 && o9.onset <= raws[raws.length - 1].tick);
  });

  it('raises the novelty residual on a change', () => {
    const raws = legacySeries(11);
    // flatten everything up to the last tick, then jump
    const flat = raw(30, { chemicalDiversity: 1, meanGlucose: 0.3, meanATP: 0.4 });
    const series: LifeRaw[] = [flat, raw(40, { chemicalDiversity: 1, meanGlucose: 0.3, meanATP: 0.4 }), raw(50, { chemicalDiversity: 3, meanGlucose: 0.9, meanATP: 0.9 })];
    const pts = lifeSeries(series);
    assert.ok(pts[pts.length - 1].novelty > pts[0].novelty);
    void raws;
  });
});
