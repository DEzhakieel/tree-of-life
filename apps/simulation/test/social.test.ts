import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_PARAMS, GENOME_SIZE, type WorldConfig } from '@fractal-life/shared';
import { Engine } from '../src/engine.js';
import { SplitMix64 } from '../src/rng.js';
import { randomGenome, crossoverGenome } from '../src/genome.js';

function makeWorld(seed: string, spawnCount: number, overrides: Partial<typeof DEFAULT_PARAMS> = {}): WorldConfig {
  return {
    id: `social-${seed}`,
    seed,
    fractalType: 'mandelbrot',
    params: { ...DEFAULT_PARAMS, spawnCount, ...overrides },
    createdAt: 0,
    currentTick: 0,
  };
}

/**
 * Genome that always reproduces (out[3]=sigmoid(5)) and eats (out[2]), with
 * signalling/hunting forced off and a low-cost phenotype. All brain weights are
 * zero so outputs are pure biases: b2 = genome[103..109].
 */
function breederGenome(): Float32Array {
  const g = new Float32Array(GENOME_SIZE);
  g[0] = 1 / 3; // fractal c = 0 (main cardioid): bounded, survives
  g[1] = 0; // cIm = 0; senseRadius 36
  g[2] = -1; // metabolism 0.02
  g[6] = -1; // size 0.5
  g[7] = 0; // herbivore
  g[8] = 1; // fertility 2.0
  g[9] = 1; // longevity 1.5
  g[10] = -1; // mutability 0.25
  g[105] = 5; // out[2] eat
  g[106] = 5; // out[3] reproduce
  g[107] = -5; // out[4] hunt off
  g[108] = -5; // out[5] signal off
  return g;
}

describe('crossoverGenome', () => {
  it('child genes come from exactly one parent and stay in [-1,1]', () => {
    const a = randomGenome(new SplitMix64(11));
    const b = randomGenome(new SplitMix64(22));
    const child = crossoverGenome(a, b, new SplitMix64(33));
    for (let i = 0; i < GENOME_SIZE; i++) {
      const v = child[i]!;
      assert.ok(v === a[i] || v === b[i], `gene ${i} must be a parental allele`);
      assert.ok(v >= -1 && v <= 1);
    }
  });

  it('is deterministic for identical seeds', () => {
    const a = randomGenome(new SplitMix64(44));
    const b = randomGenome(new SplitMix64(55));
    const c1 = crossoverGenome(a, b, new SplitMix64(66));
    const c2 = crossoverGenome(a, b, new SplitMix64(66));
    assert.deepEqual([...c1], [...c2]);
  });
});

describe('sexual reproduction', () => {
  it('co-located same-species breeders mate: one child, both parents invest', () => {
    const genome = breederGenome();
    const engine = new Engine(makeWorld('sex', 2), [
      { id: 0, genome },
      { id: 1, genome },
    ]);
    // co-locate the two founders so they are always within sense radius
    const f0 = engine.agents.get(0)!;
    const f1 = engine.agents.get(1)!;
    f0.x = f0.y = f1.x = f1.y = 500;
    f0.energy = f0.water = f1.energy = f1.water = engine.params.energyCapacity * 0.5;

    let birthTick = -1;
    let births = 0;
    for (let t = 1; t <= 60 && birthTick < 0; t++) {
      const r = engine.tick();
      if (r.stats.births > 0) {
        birthTick = engine.currentTick;
        births = r.stats.births;
      }
    }
    assert.ok(birthTick > 0, 'a birth should happen once breeders reach reproductive age');
    assert.equal(births, 1, 'a single sexual mating event produces exactly one child');

    const parent = engine.agents.get(0)!;
    const mate = engine.agents.get(1)!;
    assert.ok(parent.alive && mate.alive, 'both parents survive the birth');
    assert.equal(parent.lastReproTick, birthTick, 'mother marked as reproduced');
    assert.equal(mate.lastReproTick, birthTick, 'mate marked as reproduced (mated flag)');
    assert.ok(parent.reproductions >= 1 && mate.reproductions >= 1, 'both parents get reproduction credit');

    // the child inherits the maternal id as parentId and is of the same species
    let childId = -1;
    for (const [id, a] of engine.agents) {
      if (a.parentId === 0 && a.bornAtTick === birthTick) childId = id;
    }
    assert.ok(childId >= 0, 'child references the mother as parentId');
    const child = engine.agents.get(childId)!;
    assert.equal(child.species, parent.species, 'crossover child is the same species');
  });

  it('an agent cannot reproduce twice in one tick (guard prevents double births)', () => {
    const genome = breederGenome();
    const engine = new Engine(makeWorld('sex-guard', 2), [
      { id: 0, genome },
      { id: 1, genome },
    ]);
    const f0 = engine.agents.get(0)!;
    const f1 = engine.agents.get(1)!;
    f0.x = f0.y = f1.x = f1.y = 500;
    f0.energy = f0.water = f1.energy = f1.water = engine.params.energyCapacity * 0.5;

    for (let t = 1; t <= 60; t++) {
      const r = engine.tick();
      if (r.stats.births > 0) {
        // with the mated-flag guard the two co-located breeders produce exactly
        // one child per reproduction window (not two)
        assert.equal(r.stats.births, 1, `tick ${t} produced ${r.stats.births} births`);
      }
    }
  });
});
