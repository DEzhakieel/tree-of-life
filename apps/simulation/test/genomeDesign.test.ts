import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { WorldConfig, Intervention } from '@fractal-life/shared';
import { DEFAULT_PARAMS, GENOME_SIZE } from '@fractal-life/shared';
import { Engine } from '../src/engine.js';

function makeWorld(seed: string, spawnCount = 20, overrides: Partial<(typeof DEFAULT_PARAMS)> = {}): WorldConfig {
  return {
    id: `gdesign-${seed}`,
    seed,
    fractalType: 'mandelbrot',
    params: { ...DEFAULT_PARAMS, spawnCount, ...overrides },
    createdAt: 0,
    currentTick: 0,
  };
}

function firstAlive(e: Engine) {
  for (const a of e.agents.values()) if (a.alive) return a;
  throw new Error('no alive agents');
}

function exactGenome(): Float32Array {
  const g = new Float32Array(GENOME_SIZE);
  for (let i = 0; i < GENOME_SIZE; i++) g[i] = Math.sin(i * 0.37) * 0.8;
  return g;
}

describe('spawnAgent genome semantics (TS engine)', () => {
  it('passes an exact 217-gene genome straight through', () => {
    const e = new Engine(makeWorld('full'));
    const g = exactGenome();
    e.applyIntervention({
      type: 'spawnAgent', x: 512, y: 512, radius: 4,
      genome: g, sequence: 0,
    } as Intervention);
    const spawned = [...e.agents.values()].find((a) => a.id >= 20 && a.alive);
    assert.ok(spawned, 'an agent was spawned');
    assert.equal(spawned.genome.byteLength, GENOME_SIZE * 4);
    for (let i = 0; i < GENOME_SIZE; i++) assert.equal(spawned.genome[i], g[i]);
  });

  it('head-patches a partial genome over a deterministic random base', () => {
    const raw = [0.9, -0.9, 0.1, -0.1, 0.5];
    const partial = Float32Array.from(raw);
    const run = (seed: string) => {
      const e = new Engine(makeWorld(seed, 4));
      e.applyIntervention({
        type: 'spawnAgent', x: 512, y: 512, radius: 4,
        genome: partial, sequence: 0,
      } as Intervention);
      const spawned = [...e.agents.values()].find((a) => a.id >= 4 && a.alive)!;
      return spawned;
    };
    const a = run('same');
    const b = run('same');
    assert.equal(a.genome.length, GENOME_SIZE);
    assert.equal(b.genome.length, GENOME_SIZE);
    for (let i = 0; i < GENOME_SIZE; i++) {
      assert.equal(a.genome[i], b.genome[i], `base gene ${i} is deterministic`);
    }
    for (let i = 0; i < partial.length; i++) {
      assert.equal(a.genome[i], partial[i], `partial prefix ${i} patched`);
    }
    // a different seed produces a different (still partial-patched) base
    const c = run('other-seed');
    let different = false;
    for (let i = partial.length; i < GENOME_SIZE; i++) {
      if (c.genome[i] !== a.genome[i]) { different = true; break; }
    }
    assert.ok(different, 'base differs across seeds');
  });

  it('falls back to fully random when no genome is supplied', () => {
    const run = (seed: string) => {
      const e = new Engine(makeWorld(seed, 4));
      e.applyIntervention({
        type: 'spawnAgent', x: 512, y: 512, radius: 4,
        sequence: 0,
      } as Intervention);
      return [...e.agents.values()].find((a) => a.id >= 4 && a.alive)!;
    };
    // same seed → bit-identical random genome (spawn stream determinism)
    const a = run('rand');
    const b = run('rand');
    for (let i = 0; i < GENOME_SIZE; i++) assert.equal(a.genome[i], b.genome[i]);
    // different seed → different random genome
    const c = run('rand-other');
    let different = false;
    for (let i = 0; i < GENOME_SIZE; i++) {
      if (c.genome[i] !== a.genome[i]) { different = true; break; }
    }
    assert.ok(different, 'random genomes differ across seeds');
  });
});

describe('setGene intervention (TS engine)', () => {
  it('rewrites a single gene on the genome template only, clamped ±1', () => {
    const e = new Engine(makeWorld('edit', 8));
    const target = firstAlive(e);
    const idx = 130;
    const before = target.genome[idx];
    e.applyIntervention({
      type: 'setGene', agentId: target.id, index: idx, value: 0.75, sequence: 1,
    });
    assert.equal(target.genome[idx], 0.75);
    assert.notEqual(before, 0.75);
    e.applyIntervention({
      type: 'setGene', agentId: target.id, index: idx, value: 5, sequence: 2,
    });
    assert.equal(target.genome[idx], 1, 'clamped high');
    e.applyIntervention({
      type: 'setGene', agentId: target.id, index: idx, value: -5, sequence: 3,
    });
    assert.equal(target.genome[idx], -1, 'clamped low');
  });

  it('leaves other genes untouched', () => {
    const e = new Engine(makeWorld('edit2', 8));
    const target = firstAlive(e);
    const snapshot = target.genome.slice();
    e.applyIntervention({
      type: 'setGene', agentId: target.id, index: 130, value: 0.8, sequence: 1,
    });
    for (let i = 0; i < GENOME_SIZE; i++) {
      if (i === 130) continue;
      assert.equal(target.genome[i], snapshot[i], `gene ${i} unchanged`);
    }
  });

  it('ignores dead agents, non-integer/oob indices, and missing args', () => {
    const e = new Engine(makeWorld('edit3', 8));
    const target = firstAlive(e);
    const idx = 130;
    const orig = target.genome[idx];

    e.applyIntervention({
      type: 'setGene', agentId: target.id, index: 1.5, value: 0.5, sequence: 1,
    });
    assert.equal(target.genome[idx], orig);
    e.applyIntervention({
      type: 'setGene', agentId: target.id, index: GENOME_SIZE, value: 0.5, sequence: 2,
    });
    assert.equal(target.genome[idx], orig);
    e.applyIntervention({
      type: 'setGene', agentId: -1, index: idx, value: 0.5, sequence: 3,
    });
    assert.equal(target.genome[idx], orig);
    e.applyIntervention({
      type: 'setGene', agentId: target.id, index: idx, sequence: 4,
    } as Intervention);
    assert.equal(target.genome[idx], orig);

    target.alive = false;
    e.applyIntervention({
      type: 'setGene', agentId: target.id, index: idx, value: 0.5, sequence: 5,
    });
    assert.equal(target.genome[idx], orig, 'dead agent untouched');
  });

  it('stays deterministic under replay with the same intervention log', () => {
    const run = (seed: string) => {
      const e = new Engine(makeWorld(seed, 8));
      const target = firstAlive(e);
      e.applyIntervention({
        type: 'spawnAgent', x: 300, y: 300, radius: 4, genome: exactGenome(), sequence: 1,
      });
      e.applyIntervention({
        type: 'setGene', agentId: target.id, index: 130, value: -0.9, sequence: 2,
      });
      for (let i = 0; i < 150; i++) e.tick();
      return e;
    };
    const a = run('replay');
    const b = run('replay');
    assert.equal(a.computeStateHash(), b.computeStateHash());
    assert.equal(a.currentTick, b.currentTick);
  });
});