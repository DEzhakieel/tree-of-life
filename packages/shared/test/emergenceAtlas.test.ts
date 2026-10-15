import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  atlasSeries,
  regimeOf,
  summarizeAtlas,
  type AtlasSample,
} from '../src/emergenceAtlas.js';

const sample = (over: Partial<AtlasSample> & { tick: number }): AtlasSample => ({
  entropy: 0,
  diversity: 0,
  complexity: 0,
  ...over,
});

describe('regimeOf bands', () => {
  it('splits the axis at thirds', () => {
    assert.equal(regimeOf(0), 'order');
    assert.equal(regimeOf(1 / 3), 'order');
    assert.equal(regimeOf(1 / 3 + 1e-9), 'edge');
    assert.equal(regimeOf(0.5), 'edge');
    assert.equal(regimeOf(2 / 3 - 1e-9), 'edge');
    assert.equal(regimeOf(2 / 3), 'chaos');
    assert.equal(regimeOf(1), 'chaos');
  });
});

describe('composite disorder coordinate', () => {
  it('puts a run with no variation at the ordered corner', () => {
    const pts = atlasSeries([
      sample({ tick: 0, speciesCount: 1, lyapunovExponent: 0 }),
      sample({ tick: 1, speciesCount: 1, lyapunovExponent: 0 }),
    ]);
    assert.equal(pts[0]!.x, 0);
    assert.equal(pts[0]!.regime, 'order');
    assert.equal(pts[0]!.y, 0);
  });

  it('stretches structural and dynamical components across the run envelope', () => {
    // evenness 2/3 -> 1, lyapunov -4 -> +4; both reach both ends, so the
    // trajectory traverses the full diagram from the run's own extremes
    const pts = atlasSeries([
      sample({ tick: 0, entropy: 2, diversity: 1, speciesCount: 8, lyapunovExponent: -4 }),
      sample({ tick: 1, entropy: 3, diversity: 1, speciesCount: 8, lyapunovExponent: 4 }),
    ]);
    assert.equal(pts[0]!.x, 0);
    assert.equal(pts[0]!.regime, 'order');
    assert.equal(pts[1]!.x, 1);
    assert.equal(pts[1]!.regime, 'chaos');
  });

  it('drops a flat lyapunov instead of letting it steer the coordinate', () => {
    const pts = atlasSeries([
      sample({ tick: 0, entropy: 3, diversity: 0, speciesCount: 8, lyapunovExponent: 0 }),
      sample({ tick: 1, entropy: 3, diversity: 1, speciesCount: 8, lyapunovExponent: 0 }),
    ]);
    // evenness constant -> dead, lyapunov dead, only diversity drives x
    assert.equal(pts[0]!.x, 0);
    assert.equal(pts[1]!.x, 1);
    assert.equal(pts[1]!.regime, 'chaos');
  });

  it('gates lyapunov on positive reach: always-negative runs are not chaotic', () => {
    const pts = atlasSeries([
      sample({ tick: 0, diversity: 0, lyapunovExponent: -2 }),
      sample({ tick: 1, diversity: 0.5, lyapunovExponent: -1.999 }),
      sample({ tick: 2, diversity: 1, lyapunovExponent: -1.9 }),
    ]);
    // lyapunov excluded despite varying -> x is the stretched diversity alone
    assert.equal(pts[0]!.x, 0);
    assert.equal(pts[1]!.x, 0.5);
    assert.equal(pts[2]!.x, 1);
  });

  it('falls back to run-scaled raw entropy when speciesCount is missing', () => {
    const pts = atlasSeries([
      sample({ tick: 0, entropy: 0, diversity: 0 }),
      sample({ tick: 1, entropy: 1, diversity: 0 }),
      sample({ tick: 2, entropy: 2, diversity: 0 }),
    ]);
    // diversity flat -> dead; entropy is the only component
    assert.equal(pts[0]!.x, 0);
    assert.equal(pts[1]!.x, 0.5);
    assert.equal(pts[2]!.x, 1);
  });

  it('a mixed series falls back to entropy; all-dead series freeze at 0', () => {
    const mixed = atlasSeries([
      sample({ tick: 0, entropy: 0, diversity: 0, speciesCount: 4 }),
      sample({ tick: 1, entropy: 2, diversity: 0 }),
    ]);
    assert.equal(mixed[0]!.x, 0);
    assert.equal(mixed[1]!.x, 1);

    const dead = atlasSeries([
      sample({ tick: 0, entropy: 2, diversity: 0.5, speciesCount: 4 }),
      sample({ tick: 1, entropy: 2, diversity: 0.5, speciesCount: 4 }),
    ]);
    assert.equal(dead[0]!.x, 0);
    assert.equal(dead[1]!.x, 0);
    assert.equal(dead[1]!.regime, 'order');
  });

  it('never emits NaN for hostile input', () => {
    const pts = atlasSeries([
      sample({ tick: 0, entropy: Number.NaN, diversity: Number.NaN, complexity: Number.NaN, speciesCount: 4 }),
      sample({ tick: 1, entropy: 1, diversity: 0.5, complexity: 1, speciesCount: 4, lyapunovExponent: Number.NaN }),
      sample({ tick: 2, entropy: 2, diversity: 0.7, complexity: 2, speciesCount: 4, lyapunovExponent: 1 }),
    ]);
    for (const p of pts) {
      assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y));
      assert.ok(p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1);
    }
    assert.equal(pts[2]!.x, 1); // the clean point is the disordered extreme
    assert.equal(pts[0]!.x, 0); // non-finite maps to the ordered end
  });
});

describe('complexity coordinate', () => {
  it('normalises to the run peak', () => {
    const pts = atlasSeries([
      sample({ tick: 0, complexity: 1 }),
      sample({ tick: 1, complexity: 3 }),
      sample({ tick: 2, complexity: 2 }),
    ]);
    assert.ok(Math.abs(pts[0]!.y - 1 / 3) < 1e-9);
    assert.equal(pts[1]!.y, 1);
    assert.ok(Math.abs(pts[2]!.y - 2 / 3) < 1e-9);
  });

  it('collapses to zero when every complexity is zero', () => {
    const pts = atlasSeries([sample({ tick: 0 }), sample({ tick: 1 })]);
    assert.deepEqual(pts.map((p) => p.y), [0, 0]);
  });
});

describe('summarizeAtlas', () => {
  it('reports residence, peaks and the dominant regime', () => {
    const pts = atlasSeries([
      sample({ tick: 0, complexity: 1 }), // no moving metrics -> x=0 order
      sample({ tick: 1, entropy: 3, diversity: 1, complexity: 3, speciesCount: 8, lyapunovExponent: 4 }), // chaos
      sample({ tick: 2, entropy: 1.5, diversity: 0.5, complexity: 2, speciesCount: 4, lyapunovExponent: 0 }), // edge
      sample({ tick: 3, entropy: 3, diversity: 1, complexity: 0, speciesCount: 8, lyapunovExponent: 4 }), // chaos
    ]);
    const sum = summarizeAtlas(pts);
    assert.equal(sum.n, 4);
    assert.ok(Math.abs(sum.residence.order - 0.25) < 1e-9);
    assert.ok(Math.abs(sum.residence.chaos - 0.5) < 1e-9);
    assert.ok(Math.abs(sum.residence.order + sum.residence.edge + sum.residence.chaos - 1) < 1e-9);
    assert.equal(sum.dominant, 'chaos');
    assert.equal(sum.peak?.tick, 1);
    assert.equal(sum.start?.tick, 0);
    assert.equal(sum.end?.tick, 3);
    assert.ok(sum.meanY.chaos > 0);
    // the lone ordered point carries complexity 1 of a run peak of 3
    assert.ok(Math.abs(sum.meanY.order - 1 / 3) < 1e-9);
  });

  it('handles an empty run', () => {
    const sum = summarizeAtlas([]);
    assert.equal(sum.n, 0);
    assert.equal(sum.peak, null);
    assert.equal(sum.start, null);
    assert.equal(sum.end, null);
    assert.equal(sum.dominant, null);
    assert.deepEqual(sum.residence, { order: 0, edge: 0, chaos: 0 });
  });
});
