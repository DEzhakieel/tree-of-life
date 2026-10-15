import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_PARAMS, GENOME_SIZE, type WorldConfig } from '@fractal-life/shared';
import { Engine } from '../src/engine.js';

function makeWorld(seed: string, spawnCount: number, overrides: Partial<typeof DEFAULT_PARAMS> = {}): WorldConfig {
  return {
    id: `meme-${seed}`,
    seed,
    fractalType: 'mandelbrot',
    params: { ...DEFAULT_PARAMS, spawnCount, ...overrides },
    createdAt: 0,
    currentTick: 0,
  };
}

/** Low-cost, non-reproducing, non-moving genome (all brain biases zero). */
function neutralGenome(): Float32Array {
  const g = new Float32Array(GENOME_SIZE);
  g[0] = 1 / 3; // fractal c = 0 (main cardioid): bounded, survives
  g[1] = 0; // cIm = 0; senseRadius 36
  g[2] = -1; // metabolism 0.02
  g[6] = -1; // size 0.5
  g[7] = 0; // herbivore
  g[10] = -1; // mutability 0.25
  return g;
}

function coLocate(engine: Engine, ids: number[], energyFrac: number[], memes: number[]): void {
  const cap = engine.params.energyCapacity;
  ids.forEach((id, i) => {
    const a = engine.agents.get(id)!;
    a.x = a.y = 500;
    a.energy = cap * energyFrac[i]!;
    a.meme = memes[i]!;
  });
}

describe('memetics', () => {
  it('founders carry a meme tag in [0,1] and children inherit it', () => {
    const engine = new Engine(makeWorld('founders', 40));
    for (const a of engine.agents.values()) {
      assert.ok(a.meme >= 0 && a.meme <= 1, `founder meme ${a.meme} in [0,1]`);
    }
    // lineage: any born agent's meme stays near its parent's (inheritance + innovation)
    let born = false;
    for (let i = 0; i < 400 && !born; i++) {
      engine.tick();
      for (const a of engine.agents.values()) {
        if (a.parentId >= 0 && a.bornAtTick === engine.currentTick) {
          const parent = engine.agents.get(a.parentId)!;
          assert.ok(Math.abs(a.meme - parent.meme) <= 0.05, `child meme ${a.meme} near parent ${parent.meme}`);
          born = true;
          break;
        }
      }
    }
    assert.ok(born, 'at least one birth occurred');
  });

  it('a lower-energy agent imitates the more successful neighbour\'s meme', () => {
    const genome = neutralGenome();
    const engine = new Engine(makeWorld('spread', 2), [
      { id: 0, genome },
      { id: 1, genome },
    ]);
    const cap = engine.params.energyCapacity;
    const rich = engine.agents.get(0)!;
    const poor = engine.agents.get(1)!;
    rich.x = rich.y = poor.x = poor.y = 500;
    rich.energy = cap * 0.9;
    poor.energy = cap * 0.1;
    rich.meme = 0.9;
    poor.meme = 0.1;
    assert.notEqual(rich.meme, poor.meme);

    for (let t = 0; t < 500; t++) engine.tick();

    assert.ok(Math.abs(poor.meme - rich.meme) <= 0.05, `poor adopted rich's meme (${poor.meme} ~ ${rich.meme})`);
    assert.equal(rich.meme, 0.9, 'the successful carrier never copies downward');
  });

  it('greenbeard altruism donates to same-tag kin but not to different tags', () => {
    const genome = neutralGenome();
    const engine = new Engine(makeWorld('beard', 3), [
      { id: 0, genome },
      { id: 1, genome },
      { id: 2, genome },
    ]);
    const cap = engine.params.energyCapacity;
    const A = engine.agents.get(0)!;
    const B = engine.agents.get(1)!;
    const C = engine.agents.get(2)!;
    coLocate(engine, [0, 1, 2], [0.9, 0.1, 0.1], [0.2, 0.2, 0.8]);
    const bBefore = B.energy;
    const cBefore = C.energy;

    engine.tick();

    // B (same tag 0.2) receives a gift; C (tag 0.8) is excluded
    assert.ok(B.energy > bBefore + 0.5, `same-tag kin gained energy (${bBefore} -> ${B.energy})`);
    assert.ok(C.energy < cBefore + 0.1, `different-tag neighbour did not receive a gift (${cBefore} -> ${C.energy})`);
    assert.ok(A.altruism > 0, 'donor records the altruism for inclusive fitness');
  });

  it('memetic state is deterministic across identical seeds', () => {
    const a = new Engine(makeWorld('det-meme', 30));
    const b = new Engine(makeWorld('det-meme', 30));
    for (let i = 0; i < 120; i++) {
      a.tick();
      b.tick();
    }
    assert.equal(a.computeStateHash(), b.computeStateHash());
    for (const [id, agent] of a.agents) {
      assert.equal(agent.meme, b.agents.get(id)!.meme, `meme of ${id}`);
    }
  });
});
