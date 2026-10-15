import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_PARAMS, fnv1a32, type WorldConfig } from '@fractal-life/shared';
import { Engine } from '../src/engine.js';
import { buildTerrainGrid, sampleGrid } from '../src/terrain.js';

function makeWorld(seed: string, spawnCount = 0, overrides: Partial<typeof DEFAULT_PARAMS> = {}): WorldConfig {
  return {
    id: `nut-${seed}`,
    seed,
    fractalType: 'mandelbrot',
    params: { ...DEFAULT_PARAMS, spawnCount, ...overrides },
    createdAt: 0,
    currentTick: 0,
  };
}

describe('chemistry grid', () => {
  it('chem/baseMinerals/minerals are bounded and vary spatially', () => {
    const grid = buildTerrainGrid({ ...DEFAULT_PARAMS }, 'mandelbrot', fnv1a32('nutrients'));
    for (const v of grid.chem) assert.ok(v >= 0 && v <= 1, `chem ${v} in [0,1]`);
    for (const v of grid.baseMinerals) assert.ok(v >= 0 && v <= 1, `baseMinerals ${v} in [0,1]`);
    for (const v of grid.minerals) assert.ok(v >= 0, `minerals ${v} >= 0`);
    let sum = 0;
    for (const v of grid.baseMinerals) sum += v;
    assert.ok(sum > 0, 'some mineral richness');
    const unique = new Set(grid.chem);
    assert.ok(unique.size > 2, 'chemistry varies spatially');
    assert.ok(new Set(grid.baseMinerals).size > 2, 'mineral richness varies spatially');
  });

  it('agents sample chem and minerals through the terrain sampler', () => {
    const grid = buildTerrainGrid({ ...DEFAULT_PARAMS }, 'mandelbrot', fnv1a32('sampler'));
    const s = sampleGrid(grid, 512, 512);
    assert.ok(s.chem >= 0 && s.chem <= 1);
    assert.ok(s.minerals >= 0);
    assert.ok(s.minerals <= s.cap + 1e-6, 'minerals do not exceed carrying capacity');
  });
});

describe('nutrient cycle', () => {
  it('decaying meat returns minerals to the soil (conservation)', () => {
    const engine = new Engine(makeWorld('decomp'));
    const grid = engine.grid;
    let idx = -1;
    for (let i = 0; i < grid.cap.length; i++) {
      if (grid.cap[i]! > 0) {
        idx = i;
        break;
      }
    }
    assert.ok(idx >= 0, 'found a habitable cell');
    const before = grid.minerals[idx]!;
    grid.meat[idx] = grid.cap[idx]! * 0.5;
    engine.tick();
    assert.ok(grid.minerals[idx]! > before, `minerals rose ${before} -> ${grid.minerals[idx]}`);
    assert.ok(grid.meat[idx]! < grid.cap[idx]! * 0.5, 'meat decayed');
  });

  it('plant growth consumes minerals and is gated by soil nutrients', () => {
    const engine = new Engine(makeWorld('gating'));
    const grid = engine.grid;
    let poor = -1;
    let rich = -1;
    for (let i = 0; i < grid.cap.length; i++) {
      const cap = grid.cap[i]!;
      if (cap <= 0) continue;
      if (poor < 0) poor = i;
      if (rich < 0 && i !== poor) rich = i;
      if (poor >= 0 && rich >= 0) break;
    }
    assert.ok(poor >= 0 && rich >= 0, 'found two habitable cells');
    // force contrasting nutrient levels and near-empty plant pools
    for (const i of [poor, rich]) {
      grid.food[i] = grid.cap[i]! * 0.05;
    }
    grid.minerals[poor] = grid.cap[poor]! * 0.01;
    grid.minerals[rich] = grid.cap[rich]! * 0.9;

    const richMineralsBefore = grid.minerals[rich]!;
    const poorBefore = grid.food[poor]!;
    const richBefore = grid.food[rich]!;
    engine.tick();
    const poorGrown = grid.food[poor]! - poorBefore;
    const richGrown = grid.food[rich]! - richBefore;
    assert.ok(richGrown > poorGrown, `rich ${richGrown} should outgrow poor ${poorGrown}`);
    assert.ok(grid.minerals[rich]! < richMineralsBefore, 'rich-cell minerals consumed by growth');
  });

  it('soil minerals weather back toward the geological baseline', () => {
    const engine = new Engine(makeWorld('weather'));
    const grid = engine.grid;
    let idx = -1;
    for (let i = 0; i < grid.cap.length; i++) {
      if (grid.cap[i]! > 0) {
        idx = i;
        break;
      }
    }
    assert.ok(idx >= 0);
    grid.minerals[idx] = 0; // exhaust the soil
    engine.tick();
    assert.ok(grid.minerals[idx]! > 0, 'weathering recharges exhausted soil');
  });

  it('grid nutrient fields are deterministic across identical seeds', () => {
    const a = new Engine(makeWorld('det-grid', 30));
    const b = new Engine(makeWorld('det-grid', 30));
    for (let i = 0; i < 100; i++) {
      a.tick();
      b.tick();
    }
    assert.equal(a.computeStateHash(), b.computeStateHash());
    for (let i = 0; i < a.grid.minerals.length; i++) {
      assert.equal(a.grid.minerals[i], b.grid.minerals[i], `minerals[${i}]`);
      assert.equal(a.grid.food[i], b.grid.food[i], `food[${i}]`);
      assert.equal(a.grid.meat[i], b.grid.meat[i], `meat[${i}]`);
    }
  });
});
