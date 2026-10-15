import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  computePrimitives,
  noveltyResidual,
  radarSeries,
  summarizeRadar,
  LEVELS,
  PRIMITIVE_IDS,
  type PrimitiveId,
  type RadarAgent,
  type RadarSample,
  type RadarTerrain,
} from '../src/emergenceRadar.js';
import { emptySimStats } from '../src/worldConfig.js';

const sample = (
  tick: number,
  primitives: Partial<Record<PrimitiveId, number>>,
  measured: PrimitiveId[] = Object.keys(primitives) as PrimitiveId[],
): RadarSample => ({ tick, primitives, measured });

const terrain = (over: Partial<RadarTerrain> = {}): RadarTerrain => ({
  food: new Array(9).fill(0),
  meat: new Array(9).fill(0),
  minerals: new Array(9).fill(0),
  signal: new Array(9).fill(0),
  ...over,
});

describe('LEVELS catalogue', () => {
  it('lists 11 levels in order L0..L10 with unique ids', () => {
    assert.equal(LEVELS.length, 11);
    assert.deepEqual(
      LEVELS.map((l) => l.id),
      ['L0', 'L1', 'L2', 'L3', 'L4', 'L5', 'L6', 'L7', 'L8', 'L9', 'L10'],
    );
    assert.deepEqual(LEVELS.map((l) => l.index), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it('every level references only known primitives and earlier levels', () => {
    const known = new Set(PRIMITIVE_IDS);
    const seen = new Set<string>();
    for (const l of LEVELS) {
      for (const p of l.primitives) assert.ok(known.has(p), `${l.id} uses unknown ${p}`);
      for (const d of l.deps) assert.ok(seen.has(d), `${l.id} depends on later ${d}`);
      seen.add(l.id);
    }
  });
});

describe('computePrimitives', () => {
  it('measures terrain- and stats-derived primitives when substrate is present', () => {
    const stats = emptySimStats(3, 1, { avgEnergy: 0.5, avgWater: 0.25, meanDNAIntegrity: 0.9 });
    const s = computePrimitives({ tick: 3, stats, terrain: terrain({ signal: [1, 2, 3, 4] }) });
    assert.ok(s.measured.includes('matterFlux'));
    assert.ok(s.measured.includes('infoTransfer'));
    assert.ok(s.measured.includes('homeostasis'));
    assert.ok(s.measured.includes('copyFidelity'));
    assert.equal(s.primitives.infoTransfer, 10);
    assert.equal(s.primitives.homeostasis, 0.75);
  });

  it('leaves grid-only primitives unmeasured (DORMANT) when there is no terrain', () => {
    const s = computePrimitives({ tick: 0, stats: emptySimStats(0, 1) });
    assert.ok(!s.measured.includes('matterFlux'));
    assert.ok(!s.measured.includes('infoTransfer'));
    assert.ok(!s.measured.includes('feedback'));
    assert.ok(s.measured.includes('homeostasis'));
  });

  it('scores state→action feedback from velocity alignment with the food gradient', () => {
    const food = new Array(9).fill(0);
    food[1 * 3 + 2] = 10; // rich cell to the +x side of (1,1)
    const toward: RadarAgent = { id: 1, x: 1.5, y: 1.5, species: 0, alive: true, vx: 1, vy: 0 };
    const away: RadarAgent = { id: 2, x: 1.5, y: 1.5, species: 0, alive: true, vx: -1, vy: 0 };
    const up = computePrimitives({ tick: 0, stats: emptySimStats(0, 1), terrain: terrain({ food }), agents: [toward] });
    const down = computePrimitives({ tick: 0, stats: emptySimStats(0, 1), terrain: terrain({ food }), agents: [away] });
    assert.ok(up.primitives.feedback! > 0.9);
    assert.ok(down.primitives.feedback! < -0.9);
  });

  it('scores heredity from pairwise genome distance and drops it for clones', () => {
    const a: RadarAgent = { id: 1, x: 0, y: 0, species: 0, alive: true, genome: [0, 0, 0] };
    const b: RadarAgent = { id: 2, x: 0, y: 0, species: 0, alive: true, genome: [1, 1, 1] };
    const c: RadarAgent = { id: 3, x: 0, y: 0, species: 0, alive: true, genome: [0, 0, 0] };
    const varied = computePrimitives({ tick: 0, stats: emptySimStats(0, 1), agents: [a, b] });
    const clone = computePrimitives({ tick: 0, stats: emptySimStats(0, 1), agents: [a, c] });
    assert.equal(varied.primitives.heredity, 1);
    assert.equal(clone.primitives.heredity, 0);
  });
});

describe('radarSeries level composition', () => {
  it('lights a single-primitive level as the primitive crosses threshold', () => {
    const pts = radarSeries([
      sample(0, { matterFlux: 0 }),
      sample(1, { matterFlux: 1 }),
      sample(2, { matterFlux: 2 }),
    ]);
    assert.deepEqual(pts.map((p) => p.status.L0), ['ABSENT', 'PARTIAL', 'EMERGENT']);
    assert.equal(pts[2]!.scores.L0, 1);
    assert.equal(summarizeRadar(pts).levels[0]!.onset, 2);
  });

  it('reports a level DORMANT when a required primitive is unavailable', () => {
    const pts = radarSeries([sample(0, { matterFlux: 0 }), sample(1, { matterFlux: 2 })]);
    assert.deepEqual(pts.map((p) => p.status.L1), ['DORMANT', 'DORMANT']);
    assert.equal(summarizeRadar(pts).levels[1]!.everMeasured, false);
  });

  it('holds a level EMERGENT through hysteresis until it drops below OFF', () => {
    const pts = radarSeries([
      sample(0, { matterFlux: 0 }),
      sample(1, { matterFlux: 1 }),
      sample(2, { matterFlux: 2 }),
      sample(3, { matterFlux: 1.5 }), // 0.75: above OFF -> stays
      sample(4, { matterFlux: 0.5 }), // 0.25: below OFF, still partial
    ]);
    assert.deepEqual(pts.map((p) => p.status.L0), ['ABSENT', 'PARTIAL', 'EMERGENT', 'EMERGENT', 'PARTIAL']);
  });

  it('averages the primitives of a conjunction', () => {
    const pts = radarSeries([
      sample(0, { matterFlux: 0, homeostasis: 0 }),
      sample(1, { matterFlux: 1, homeostasis: 0 }),
      sample(2, { matterFlux: 2, homeostasis: 0 }),
    ]);
    // matterFlux stretches [0,.5,1], homeostasis is dead (flat) -> 0
    assert.deepEqual(pts.map((p) => p.scores.L1), [0, 0.25, 0.5]);
  });

  it('marks prerequisites met only once the dependency is at least partial', () => {
    const pts = radarSeries([
      sample(0, { matterFlux: 0 }),
      sample(1, { matterFlux: 1 }),
      sample(2, { matterFlux: 2 }),
    ]);
    assert.deepEqual(pts.map((p) => p.prereqsMet.L1), [false, true, true]);
    assert.deepEqual(pts.map((p) => p.prereqsMet.L0), [true, true, true]);
  });

  it('never emits a non-finite score for hostile input', () => {
    const pts = radarSeries([
      sample(0, { matterFlux: Number.NaN }),
      sample(1, { matterFlux: 1 }),
      sample(2, { matterFlux: 2 }),
    ]);
    for (const p of pts) {
      for (const id of Object.keys(p.scores) as (keyof typeof p.scores)[]) {
        assert.ok(Number.isFinite(p.scores[id]), `${id} not finite`);
      }
      assert.ok(p.novelty >= 0 && p.novelty <= 1);
    }
  });
});

describe('noveltyResidual', () => {
  it('is flat zero for an unchanging run', () => {
    const r = noveltyResidual([
      sample(0, { matterFlux: 5 }),
      sample(1, { matterFlux: 5 }),
      sample(2, { matterFlux: 5 }),
    ]);
    assert.deepEqual(r, [0, 0, 0]);
  });

  it('spikes on a perceivable regime change', () => {
    const r = noveltyResidual([
      sample(0, { matterFlux: 0 }),
      sample(1, { matterFlux: 0 }),
      sample(2, { matterFlux: 0 }),
      sample(3, { matterFlux: 10 }),
      sample(4, { matterFlux: 10 }),
    ]);
    assert.equal(r[3], 1);
    assert.ok(r[3]! > r[0]!);
  });

  it('handles empty and single-sample runs', () => {
    assert.deepEqual(noveltyResidual([]), []);
    assert.deepEqual(noveltyResidual([sample(0, { matterFlux: 3 })]), [0]);
  });

  it('returns zeros when nothing is commonly measured', () => {
    const r = noveltyResidual([
      { tick: 0, primitives: {}, measured: [] },
      { tick: 1, primitives: {}, measured: [] },
    ]);
    assert.deepEqual(r, [0, 0]);
  });
});

describe('summarizeRadar', () => {
  it('reports onsets, peaks and the dominant emergent level', () => {
    const pts = radarSeries([
      sample(0, { matterFlux: 0 }),
      sample(1, { matterFlux: 1 }),
      sample(2, { matterFlux: 2 }),
      sample(3, { matterFlux: 2 }),
    ]);
    const sum = summarizeRadar(pts);
    assert.equal(sum.n, 4);
    assert.equal(sum.levels.length, 11);
    const l0 = sum.levels[0]!;
    assert.equal(l0.id, 'L0');
    assert.equal(l0.onset, 2);
    assert.equal(l0.everEmergent, true);
    assert.equal(l0.peakScore, 1);
    assert.equal(sum.dominant, 'L0');
    assert.ok(sum.noveltyPeak !== null);
  });

  it('handles an empty run', () => {
    const sum = summarizeRadar([]);
    assert.equal(sum.n, 0);
    assert.equal(sum.dominant, null);
    assert.equal(sum.noveltyPeak, null);
    assert.equal(sum.noveltyMean, 0);
    assert.equal(sum.levels.length, 11);
    assert.ok(sum.levels.every((l) => l.onset === null && !l.everMeasured));
  });
});
