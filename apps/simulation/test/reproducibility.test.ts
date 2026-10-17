import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Engine } from '../src/engine.js';
import { makeWorld } from '../src/research/scenarios.js';
import { fullStateHash, outcomeFingerprint, worldFingerprint } from '../src/research/snapshot.js';

/**
 * Reproducibility gate.
 *
 * The scientific contract of the simulator is that a run is a pure function of
 * its world definition:
 *
 *     S(run) = run(seed, timestep, population, params[, worldStoch])
 *
 * Two worlds that differ in the definition must diverge; two that agree must
 * agree bit-for-bit at every tick — including in the opt-in stochastic module,
 * whose randomness is itself seeded through the same deterministic stream.
 *
 *   worldFingerprint   identity of a *world definition*
 *   fullStateHash      bit-exact state of a *live run*
 *   outcomeFingerprint the observable summary a report would print
 */

type World = ConstructorParameters<typeof Engine>[0];

const fast = (seed: string, spawn = 12, extra: Record<string, number> = {}): World =>
  makeWorld(seed, spawn, { maxIter: 2, ...extra }) as World;

function trajectory(engine: Engine, ticks: number): string[] {
  const out: string[] = [];
  for (let t = 0; t < ticks; t++) {
    engine.tick();
    out.push(fullStateHash(engine));
  }
  return out;
}

describe('reproducibility · world fingerprints identify a definition', () => {
  it('is stable for the same definition and independent of key order', () => {
    assert.equal(worldFingerprint('s', { a: 1, b: 2 }), worldFingerprint('s', { a: 1, b: 2 }));
    assert.equal(worldFingerprint('s', { a: 1, b: 2 }), worldFingerprint('s', { b: 2, a: 1 }));
  });

  it('separates different seeds and different parameters', () => {
    assert.notEqual(worldFingerprint('s1', { a: 1 }), worldFingerprint('s2', { a: 1 }));
    assert.notEqual(worldFingerprint('s', { a: 1 }), worldFingerprint('s', { a: 2 }));
  });
});

describe('reproducibility · identical worlds replay bit-for-bit', () => {
  it('full-state hash agrees at every tick', () => {
    const w = fast('repro.twin');
    const a = trajectory(new Engine(w), 60);
    const b = trajectory(new Engine(w), 60);
    assert.equal(a.length, 60);
    for (let t = 0; t < 60; t++) assert.equal(a[t], b[t], `divergence at tick ${t}`);
  });

  it('outcome fingerprint agrees for identical worlds', () => {
    const w = fast('repro.outcome', 20);
    const a = new Engine(w);
    const b = new Engine(w);
    for (let t = 0; t < 40; t++) {
      a.tick();
      b.tick();
    }
    assert.equal(outcomeFingerprint(a), outcomeFingerprint(b));
  });
});

describe('reproducibility · different definitions diverge', () => {
  it('a different seed yields a different final state', () => {
    const a = new Engine(fast('repro.sA', 20));
    const b = new Engine(fast('repro.sB', 20));
    for (let t = 0; t < 50; t++) {
      a.tick();
      b.tick();
    }
    assert.notEqual(fullStateHash(a), fullStateHash(b));
  });

  it('a changed parameter yields a different final state', () => {
    const a = new Engine(fast('repro.p', 20));
    const b = new Engine(fast('repro.p', 20, { foodRegenRate: 0.01 }));
    for (let t = 0; t < 50; t++) {
      a.tick();
      b.tick();
    }
    assert.notEqual(fullStateHash(a), fullStateHash(b));
  });
});

describe('reproducibility · the stochastic research mode is still self-reproducible', () => {
  it('same-seed stochastic worlds replay bit-for-bit', () => {
    const w = fast('repro.stoch', 20);
    const a = new Engine(w);
    const b = new Engine(w);
    a.setWorldStochastics({});
    b.setWorldStochastics({});
    for (let t = 0; t < 50; t++) {
      a.tick();
      b.tick();
      assert.equal(fullStateHash(a), fullStateHash(b), `stochastic divergence at tick ${t}`);
    }
  });

  it('a stochastic world diverges from its deterministic twin (the drift is real)', () => {
    const w = fast('repro.twin-mode', 20);
    const det = new Engine(w);
    const stoch = new Engine(w);
    stoch.setWorldStochastics({});
    let diverged = false;
    for (let t = 0; t < 50; t++) {
      det.tick();
      stoch.tick();
      if (fullStateHash(det) !== fullStateHash(stoch)) diverged = true;
    }
    assert.ok(diverged, 'stochastic twin never diverged — the module is not active');
  });
});
