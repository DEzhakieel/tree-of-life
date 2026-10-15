import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_PARAMS, GENOME_SIZE, type WorldConfig } from '@fractal-life/shared';
import { Engine } from '../src/engine.js';

function makeWorld(seed: string, spawnCount: number, overrides: Partial<typeof DEFAULT_PARAMS> = {}): WorldConfig {
  return {
    id: `obs-${seed}`,
    seed,
    fractalType: 'mandelbrot',
    params: { ...DEFAULT_PARAMS, spawnCount, ...overrides },
    createdAt: 0,
    currentTick: 0,
  };
}

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

describe('observables', () => {
  it('single-species population has zero entropy, diversity and complexity', () => {
    // interior genome (c = 0): the single founder is guaranteed bounded, so the
    // population is exactly one species that never goes extinct mid-test
    const engine = new Engine(makeWorld('one', 1), [{ id: 0, genome: neutralGenome() }]);
    for (let i = 0; i < 20; i++) engine.tick();
    const s = engine.stats();
    assert.equal(s.speciesCount, 1);
    assert.equal(s.entropy, 0);
    assert.equal(s.diversity, 0);
    assert.equal(s.complexity, 0);
  });

  it('species diversity lifts entropy and Simpson diversity above zero', () => {
    const genome = neutralGenome();
    const engine = new Engine(makeWorld('two', 3), [
      { id: 0, genome: genome },
      { id: 1, genome: Float32Array.from(genome) },
      { id: 2, genome: Float32Array.from(genome) },
    ]);
    // skewed 2:1 split — dominated species + minority gives disequilibrium
    engine.agents.get(0)!.species = 1111;
    engine.agents.get(1)!.species = 1111;
    engine.agents.get(2)!.species = 2222;
    const s = engine.stats();
    assert.ok(s.entropy > 0.5, `entropy ${s.entropy}`);
    assert.ok(s.diversity > 0.3, `diversity ${s.diversity}`);
    assert.ok(s.complexity > 0, `complexity ${s.complexity}`);
  });

  it('cooperation reflects the energy donated via greenbeard altruism', () => {
    const genome = neutralGenome();
    const engine = new Engine(makeWorld('coop', 2), [
      { id: 0, genome },
      { id: 1, genome },
    ]);
    const cap = engine.params.energyCapacity;
    const A = engine.agents.get(0)!;
    const B = engine.agents.get(1)!;
    A.x = A.y = B.x = B.y = 500;
    A.energy = cap * 0.95;
    B.energy = cap * 0.1;
    A.meme = B.meme = 0.4;

    engine.tick();
    const s = engine.stats();
    assert.ok(s.cooperation > 0, `cooperation ${s.cooperation}`);
    assert.ok(Math.abs(s.cooperation - A.altruism / s.energySum) < 1e-6, 'donation share matches ledger');
  });

  it('predatorFraction counts carnivorous agents', () => {
    const genome = neutralGenome();
    const engine = new Engine(makeWorld('pred', 2), [
      { id: 0, genome },
      { id: 1, genome: Float32Array.from(genome) },
    ]);
    engine.agents.get(0)!.genome[7] = 1; // carnivore
    engine.agents.get(0)!.phenotype.diet = 0.9;
    engine.agents.get(1)!.genome[7] = -1; // herbivore
    engine.agents.get(1)!.phenotype.diet = 0.1;
    assert.equal(engine.stats().predatorFraction, 0.5);
  });

  it('cultureCount buckets meme tags by tolerance and meanAltruism tracks donations', () => {
    const genome = neutralGenome();
    const engine = new Engine(makeWorld('culture', 3), [
      { id: 0, genome },
      { id: 1, genome: Float32Array.from(genome) },
      { id: 2, genome: Float32Array.from(genome) },
    ]);
    const cap = engine.params.energyCapacity;
    const A = engine.agents.get(0)!;
    const B = engine.agents.get(1)!;
    const C = engine.agents.get(2)!;
    A.x = A.y = B.x = B.y = C.x = C.y = 500;
    A.meme = 0.21;
    B.meme = 0.22; // same culture bucket as A
    C.meme = 0.81; // distinct culture
    A.altruism = 0.5 * cap;
    B.altruism = 0.1 * cap;
    C.altruism = 0;
    const s = engine.stats();
    assert.equal(s.cultureCount, 2);
    assert.ok(Math.abs(s.meanAltruism - (0.5 + 0.1) / 3) < 1e-9, `meanAltruism ${s.meanAltruism}`);
  });

  it('meme entropy measures cultural diversity', () => {
    const genome = neutralGenome();
    const engine = new Engine(makeWorld('memeh', 4), [
      { id: 0, genome },
      { id: 1, genome: Float32Array.from(genome) },
      { id: 2, genome: Float32Array.from(genome) },
      { id: 3, genome: Float32Array.from(genome) },
    ]);
    engine.agents.get(0)!.meme = 0.1;
    engine.agents.get(1)!.meme = 0.1;
    engine.agents.get(2)!.meme = 0.9;
    engine.agents.get(3)!.meme = 0.9;
    assert.ok(Math.abs(engine.stats().memeEntropy - 1) < 1e-9, 'two equal cultures -> 1 bit');
    for (const a of engine.agents.values()) a.meme = 0.1;
    assert.ok(Math.abs(engine.stats().memeEntropy - 0) < 1e-9, 'single culture -> 0 bits');
  });

  it('species<->culture MI is high when memes track lineage and low when they cross it', () => {
    const genome = neutralGenome();
    const mk = (seed: string) =>
      new Engine(makeWorld(seed, 4), [
        { id: 0, genome },
        { id: 1, genome: Float32Array.from(genome) },
        { id: 2, genome: Float32Array.from(genome) },
        { id: 3, genome: Float32Array.from(genome) },
      ]);
    const segregated = mk('mi-high');
    // species A carries meme 0.1, species B carries meme 0.9 — culture follows lineage
    segregated.agents.get(0)!.species = 1;
    segregated.agents.get(1)!.species = 1;
    segregated.agents.get(2)!.species = 2;
    segregated.agents.get(3)!.species = 2;
    segregated.agents.get(0)!.meme = 0.1;
    segregated.agents.get(1)!.meme = 0.1;
    segregated.agents.get(2)!.meme = 0.9;
    segregated.agents.get(3)!.meme = 0.9;
    assert.ok(segregated.stats().speciesMemeMI > 0.99, `MI=${segregated.stats().speciesMemeMI}`);

    const crossed = mk('mi-low');
    // memes spread across species boundaries — culture no longer predicts species
    crossed.agents.get(0)!.species = 1;
    crossed.agents.get(1)!.species = 1;
    crossed.agents.get(2)!.species = 2;
    crossed.agents.get(3)!.species = 2;
    crossed.agents.get(0)!.meme = 0.1;
    crossed.agents.get(1)!.meme = 0.9;
    crossed.agents.get(2)!.meme = 0.1;
    crossed.agents.get(3)!.meme = 0.9;
    assert.ok(crossed.stats().speciesMemeMI < 0.01, `MI=${crossed.stats().speciesMemeMI}`);
  });
});
