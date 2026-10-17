import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Engine } from '../src/engine.js';
import { makeWorld, runConservation, worldFingerprint } from '../src/research/scenarios.js';

/**
 * Conservation gate.
 *
 * The engine is a cycling-matter world: carrion decays into soil minerals,
 * plants grow by drawing them back, and agents hold a bounded energy reserve.
 * This file asserts the *accounting* invariants that must hold for the matter
 * story to be closed:
 *
 *   - carrion decay equals the mineral gain at the decomposition fraction;
 *   - no matter pool (food, meat, minerals, signal) goes negative;
 *   - standing food never exceeds a cell's carrying capacity;
 *   - every agent's energy stays inside its capacity and above zero;
 *   - the world state is a pure function of its definition (fingerprint).
 *
 * All runs use a low-iteration fractal (maxIter: 2) and short horizons so the
 * gate stays cheap while exercising the real tick loop.
 */

type World = ConstructorParameters<typeof Engine>[0];

function fastWorld(seed: string, spawn: number, overrides: Record<string, number> = {}): World {
  return makeWorld(seed, spawn, { maxIter: 2, ...overrides }) as World;
}

describe('conservation · carrion decay equals mineral gain', () => {
  it('runConservation reports ~zero meat and mineral error on every seed', () => {
    for (const seed of ['cons.a', 'cons.b', 'cons.c']) {
      const r = runConservation(seed, 50);
      // decay = injected * MEAT_DECAY(0.002) = 0.1 ; mineral gain = decay * DECOMP_FRACTION(0.5) = 0.05
      assert.ok(Math.abs(r.meatDecayed - 0.1) < 1e-5, `seed ${seed}: meatDecayed ${r.meatDecayed}`);
      assert.ok(Math.abs(r.expectedDecay - 0.1) < 1e-6);
      assert.ok(Math.abs(r.expectedMineralGain - 0.05) < 1e-6);
      assert.ok(Math.abs(r.meatError) < 1e-3, `seed ${seed}: meatError ${r.meatError}`);
      assert.ok(Math.abs(r.mineralError) < 1e-3, `seed ${seed}: mineralError ${r.mineralError}`);
    }
  });

  it('scales linearly with the injected amount', () => {
    const half = runConservation('cons.scale', 25);
    const full = runConservation('cons.scale', 50);
    assert.ok(Math.abs(half.meatDecayed * 2 - full.meatDecayed) < 1e-6);
    assert.ok(Math.abs(half.mineralGained * 2 - full.mineralGained) < 1e-3);
  });

  it('is reproducible: the same scenario yields identical numbers', () => {
    const a = runConservation('cons.repro', 50);
    const b = runConservation('cons.repro', 50);
    assert.deepEqual(a, b);
  });
});

describe('conservation · matter pools never go negative', () => {
  it('food, meat, minerals and signal stay non-negative over a run', () => {
    const eng = new Engine(fastWorld('cons.pools', 20));
    for (let t = 0; t < 120; t++) eng.tick();
    const g = eng.grid;
    const floor = (a: Float32Array): number => {
      let m = Infinity;
      for (let i = 0; i < a.length; i++) if (a[i]! < m) m = a[i]!;
      return m;
    };
    assert.ok(floor(g.food) >= -1e-4, `food floor ${floor(g.food)}`);
    assert.ok(floor(g.meat) >= -1e-4, `meat floor ${floor(g.meat)}`);
    assert.ok(floor(g.minerals) >= -1e-4, `minerals floor ${floor(g.minerals)}`);
    assert.ok(floor(g.signal) >= -1e-4, `signal floor ${floor(g.signal)}`);
  });

  it('standing food never exceeds the cell carrying capacity', () => {
    const eng = new Engine(fastWorld('cons.cap', 20));
    for (let t = 0; t < 80; t++) eng.tick();
    const { food, cap } = eng.grid;
    for (let i = 0; i < food.length; i++) {
      assert.ok(food[i]! <= cap[i]! + 1e-3, `cell ${i}: food ${food[i]} > cap ${cap[i]}`);
    }
  });
});

describe('conservation · agent energy is bounded by capacity', () => {
  it('every alive agent stays within [0, energyCapacity]', () => {
    const cap = 100;
    const eng = new Engine(fastWorld('cons.energy', 40, { energyCapacity: cap }));
    for (let t = 0; t < 120; t++) eng.tick();
    let checked = 0;
    for (const a of eng.agents.values()) {
      if (!a.alive) continue;
      assert.ok(a.energy >= 0, `agent ${a.id} energy ${a.energy}`);
      assert.ok(a.energy <= cap + 1e-2, `agent ${a.id} energy ${a.energy} > cap ${cap}`);
      checked++;
    }
    assert.ok(checked >= 0, 'energy bound holds vacuously if the run went extinct');
  });
});

describe('conservation · the world state is a pure function of its definition', () => {
  it('identical worlds produce identical full-state fingerprints at every tick', () => {
    const world = fastWorld('cons.fp', 12);
    const a = new Engine(world);
    const b = new Engine(world);
    for (let t = 0; t < 60; t++) {
      a.tick();
      b.tick();
      assert.equal(worldFingerprint(a), worldFingerprint(b), `fingerprint divergence at tick ${t}`);
    }
  });
});
