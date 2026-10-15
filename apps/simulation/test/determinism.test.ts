import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Engine } from '../src/engine.js';
import { makeWorld } from '../src/research/scenarios.js';
import { fullStateHash, worldFingerprint } from '../src/research/snapshot.js';

/**
 * The engine-level determinism gate behind research/modes.ts.
 *
 *   S(run) = run(seed, timestep, population, parameters)            legacy mode
 *   S(run) = run(seed, timestep, population, parameters, worldStoch) research
 *
 * Every assertion is made on the strict, bit-exact full-state hash
 * (`fullStateHash`): terrain grid + chemistry field + every agent (ascending
 * id) + brains + the stochastic-world state, folded at every tick:
 *
 *   determinism.test.ts        ← this file (tier 1: the contract)
 *   research/modes.ts          ← tiers 2–4 (debug / reproducibility / research)
 *
 * The suite deliberately uses a low-iteration fractal (`maxIter: 2`) so the
 * terrain is cheap to tick while remaining byte-identical across runs — the
 * determinism contract is about identical inputs ⇒ identical outputs, and the
 * world is itself one of those inputs.
 */

type World = ConstructorParameters<typeof Engine>[0];

function fastWorld(seed: string, spawn: number, overrides: Record<string, number> = {}): World {
  return makeWorld(seed, spawn, { maxIter: 2, ...overrides }) as World;
}

function hashes(world: World, ticks: number): string[] {
  const engine = new Engine(world);
  const out: string[] = [];
  for (let i = 0; i < ticks; i++) {
    engine.tick();
    out.push(fullStateHash(engine));
  }
  return out;
}

function stochasticHashes(world: World, ticks: number): string[] {
  const engine = new Engine(world);
  engine.setWorldStochastics({});
  const out: string[] = [];
  for (let i = 0; i < ticks; i++) {
    engine.tick();
    out.push(fullStateHash(engine));
  }
  return out;
}

describe('engine determinism — S(run1) = S(run2)', () => {
  it('bit-for-bit identical full state at every tick (deterministic mode)', () => {
    const world = fastWorld('determinism-twin', 10);
    const a = hashes(world, 40);
    const b = hashes(world, 40);
    assert.equal(a.length, 40);
    for (let t = 0; t < 40; t++) assert.equal(a[t], b[t], `full-state divergence at tick ${t}`);
  });

  it('fractional timestep is part of the world identity — and still deterministic', () => {
    const pairs = [0.5, 1, 2].map((timeScale) => {
      const world = fastWorld('determinism-timescale', 8, { timeScale });
      const a = hashes(world, 24);
      const b = hashes(world, 24);
      for (let t = 0; t < 24; t++) assert.equal(a[t], b[t], `timeScale=${timeScale} diverged at tick ${t}`);
      return { timeScale, last: a[a.length - 1] };
    });
    assert.equal(new Set(pairs.map((p) => p.timeScale)).size, 3, 'three different timesteps');
    assert.equal(new Set(pairs.map((p) => p.last)).size, 3, 'each timestep must produce a different world');
  });

  it('population is part of the world identity (spawnCount)', () => {
    const smallA = hashes(fastWorld('determinism-pop', 6), 24);
    const smallB = hashes(fastWorld('determinism-pop', 6), 24);
    const large = hashes(fastWorld('determinism-pop', 12), 24);
    assert.deepEqual(smallA, smallB, 'same population must reproduce');
    assert.notEqual(smallA[smallA.length - 1], large[large.length - 1], 'spawnCount must be in the world identity');
  });

  it('parameters are part of the world identity (energy capacity)', () => {
    const base = hashes(fastWorld('determinism-params', 8), 24);
    const baseDup = hashes(fastWorld('determinism-params', 8), 24);
    const tweaked = hashes(fastWorld('determinism-params', 8, { energyCapacity: 25, foodRegenRate: 3e-3 }), 24);
    assert.deepEqual(base, baseDup);
    assert.notEqual(base[base.length - 1], tweaked[tweaked.length - 1], 'a parameter override must change the trajectory');
  });

  it('stochastic world mode is reproducible (seeded, bit-for-bit)', () => {
    const world = fastWorld('determinism-stoch', 10);
    const a = stochasticHashes(world, 40);
    const b = stochasticHashes(world, 40);
    for (let t = 0; t < 40; t++) assert.equal(a[t], b[t], `stochastic world diverged at tick ${t}`);
  });

  it('stochastic mode diverges from its deterministic twin (same seed)', () => {
    const world = fastWorld('determinism-vs-stoch', 10);
    const det = hashes(world, 40);
    const stoch = stochasticHashes(world, 40);
    let divergedAt = -1;
    for (let t = 0; t < 40; t++) {
      if (det[t] !== stoch[t]) {
        divergedAt = t;
        break;
      }
    }
    assert.ok(divergedAt >= 0, 'stochastic twin never diverged from its deterministic twin');
  });

  it('two different seeds give two different worlds', () => {
    const s1 = hashes(fastWorld('determinism-diff-1', 8), 16);
    const s2 = hashes(fastWorld('determinism-diff-2', 8), 16);
    assert.notEqual(s1[0], s2[0]);
  });
});

describe('world fingerprint covers the determinism inputs', () => {
  it('same seed + same params → same fingerprint; any axis change → different', () => {
    const fp = (seed: string, overrides: Record<string, number> = {}, spawn = 8) =>
      worldFingerprint(seed, fastWorld(seed, spawn, overrides).params as unknown as Record<string, number | string | undefined>);
    assert.equal(fp('fp-a'), fp('fp-a'));
    assert.notEqual(fp('fp-a'), fp('fp-b'), 'seed is in the identity');
    assert.notEqual(fp('fp-a', { timeScale: 2 }), fp('fp-a'), 'timestep is in the identity');
    assert.notEqual(fp('fp-a', {}, 12), fp('fp-a'), 'population is in the identity');
  });
});