import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  TIER_DEFS,
  buildArchetypeWorld,
  runArchetypePair,
  type ArchetypeRow,
} from '../src/research/archetypes.js';

/**
 * Engine-level gate behind research/archetypes.ts — the agent complexity
 * ladder:  T0 simple rules → T1 constraints → T2 cognition → T3 systems.
 *
 * Every tier runs the same world shape, physics baseline and seeds; a tier
 * differs from the one below ONLY by the faculty it adds (calm biome +
 * heritable genomes / learned brain / intracellular omics). Because the
 * engine is a pure function of its world definition, every assertion here is
 * made determinism-first: two runs of a world must reproduce bit-for-bit.
 *
 * Faculties are detected by the metrics they unlock (0 → >0 exactly where the
 * faculty is introduced), so the suite verifies the report's central ladder
 * claim at the engine level.
 */

type Tier = (typeof TIER_DEFS)[number];

const SEEDS = ['archetypes.test1', 'archetypes.test2', 'archetypes.test3'];
const SPAWN = 12;
const TICKS = 40;

function runFast(tier: Tier, seed: string) {
  const world = buildArchetypeWorld(seed, SPAWN, tier, { maxIter: 2 });
  return runArchetypePair(world, tier, TICKS);
}

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

function aggregateRow(tier: Tier): { census: ArchetypeRow['census']; metrics: ArchetypeRow['metrics']; deterministic: boolean } {
  const rows = SEEDS.map((s) => runFast(tier, s).a);
  return {
    census: {
      alive: Math.round(mean(rows.map((r) => r.census.alive))),
      species: Math.round(mean(rows.map((r) => r.census.species))),
      births: Math.round(mean(rows.map((r) => r.census.births))),
      deaths: Math.round(mean(rows.map((r) => r.census.deaths))),
      selectionEntropy: mean(rows.map((r) => r.census.selectionEntropy)),
      traitDim: mean(rows.map((r) => r.census.traitDim)),
    },
    metrics: {
      genomeDist: mean(rows.map((r) => r.metrics.genomeDist)),
      memeCV: mean(rows.map((r) => r.metrics.memeCV)),
      energyCV: mean(rows.map((r) => r.metrics.energyCV)),
      proteomeCV: mean(rows.map((r) => r.metrics.proteomeCV)),
      plasticAgents: Math.round(mean(rows.map((r) => r.metrics.plasticAgents))),
      meanPlasticity: mean(rows.map((r) => r.metrics.meanPlasticity)),
      meanSurprise: mean(rows.map((r) => r.metrics.meanSurprise)),
    },
    deterministic: rows.every((r) => r.deterministic),
  };
}

const T0 = TIER_DEFS[0]!;
const T1 = TIER_DEFS[1]!;
const T2 = TIER_DEFS[2]!;
const T3 = TIER_DEFS[3]!;

describe('archetype ladder — every tier is internally deterministic', () => {
  it('each of the four archetypes reproduces itself bit-for-bit on every seed', () => {
    for (const tier of TIER_DEFS) {
      for (const seed of SEEDS) {
        const { a, b, deterministic } = runFast(tier, seed);
        assert.equal(a.hashes.length, TICKS);
        assert.equal(a.hashes.length, b.hashes.length);
        for (let i = 0; i < a.hashes.length; i++) {
          assert.equal(a.hashes[i], b.hashes[i], `T${tier.idx} seed ${seed} diverged at tick ${i}`);
        }
        assert.equal(deterministic, true, `T${tier.idx} seed ${seed} not marked reproducible`);
      }
    }
  });

  it('survival is non-nil in every archetype (alive > 0 on every seed)', () => {
    for (const tier of TIER_DEFS) {
      for (const seed of SEEDS) {
        const { a } = runFast(tier, seed);
        assert.ok(a.census.alive > 0, `T${tier.idx} seed ${seed} went extinct`);
      }
    }
  });
});

describe('archetype ladder — faculties unlock exactly where introduced', () => {
  it('T0 · simple rules — clonal reflexes: NO heritable diversity, learning or chemistry', () => {
    const rows = SEEDS.map((s) => runFast(T0, s).a);
    for (const r of rows) {
      assert.equal(r.metrics.genomeDist, 0, `seed ${r.seed} genomeDist should be 0 (clones)`);
      assert.equal(r.metrics.memeCV, 0, `seed ${r.seed} memeCV should be 0 (identical meme)`);
      assert.equal(r.metrics.proteomeCV, 0, `seed ${r.seed} proteomeCV should be 0 (no omics)`);
      assert.equal(r.metrics.meanSurprise, 0, `seed ${r.seed} surprise should be 0 (reflex only)`);
      assert.equal(r.metrics.meanPlasticity, 0, `seed ${r.seed} plasticity should be 0 (reflex only)`);
    }
  });

  it('T1 · constraints — heritable genomes differentiate the individuals (still reflex, no chemistry)', () => {
    const agg = aggregateRow(T1);
    assert.ok(agg.metrics.genomeDist > 0.05, `T1 genome distance ${agg.metrics.genomeDist} should rise above zero`);
    assert.ok(agg.metrics.memeCV > 0.05, `T1 meme CV ${agg.metrics.memeCV} should rise above zero`);
    assert.ok(agg.metrics.meanSurprise <= 1e-9, 'T1 must still be reflex-only (no learning)');
    assert.ok(agg.metrics.meanPlasticity <= 1e-9, 'T1 must still be reflex-only (no plasticity)');
    assert.ok(agg.metrics.proteomeCV <= 1e-9, 'T1 must have no omics yet');
  });

  it('T2 · cognition — the learned policy turns on (per-individual learning signal)', () => {
    const agg = aggregateRow(T2);
    assert.ok(agg.metrics.meanSurprise > 0 || agg.metrics.plasticAgents > 0, `T2 learning signal missing: surprise=${agg.metrics.meanSurprise} plastic=${agg.metrics.plasticAgents}`);
    assert.ok(agg.metrics.proteomeCV <= 1e-9, 'T2 must have no omics yet');
  });

  it('T3 · systems — intracellular omics turn on (protein pools inside each individual)', () => {
    const agg = aggregateRow(T3);
    assert.ok(agg.metrics.proteomeCV > 1e-4, `T3 protein-pool CV ${agg.metrics.proteomeCV} should rise above zero`);
  });

  it('the 0 → >0 footprint is ordered: diversity@T1, learning@T2, chemistry@T3', () => {
    const g = [T0, T1, T2, T3].map((t) => (aggregateRow(t).metrics.genomeDist > 0.05));
    const s = [T0, T1, T2, T3].map((t) => (aggregateRow(t).metrics.meanSurprise > 1e-9));
    const p = [T0, T1, T2, T3].map((t) => (aggregateRow(t).metrics.proteomeCV > 1e-4));
    assert.deepEqual(g, [false, true, true, true], 'heritable diversity must unlock at T1');
    assert.deepEqual(s, [false, false, true, true], 'learning must unlock at T2');
    assert.deepEqual(p, [false, false, false, true], 'intracellular chemistry must unlock at T3');
  });
});