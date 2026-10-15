import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  runFirstOrder,
  runSecondOrder,
  runThirdOrder,
  runConservation,
  determinismCheck,
  FIRST_ORDER_TICKS,
  SECOND_ORDER_WINDOW,
  THIRD_ORDER_TICKS,
  AGENT_START_ENERGY,
  PREY_ENERGY,
} from '../src/research/scenarios.js';

/**
 * Emergence, tested from first principles up: first-order (an individual and
 * its environment), second-order (interactions between individuals) and
 * third-order (closed loops that couple scales — carrion feeds the soil that
 * feeds the plants that feed the animals).
 *
 * The scenario implementations live in src/research/scenarios.ts so the exact
 * same code is exercised by the test suite AND the reproducibility harness
 * (npm run research). Every scenario is deterministic: no Math.random, no
 * iteration-order hazards, agents iterate in ascending id order and all
 * stochastic draws come from the seed stream.
 */

describe('first order — an individual trades energy with its environment', () => {
  it('an agent on a food-rich cell gains energy while an identical twin on a food-poor cell only drains', () => {
    const r = runFirstOrder('first-order');
    assert.ok(r.richCap > r.poorCap, 'the two habitats genuinely differ in carrying capacity');
    assert.ok(r.richFood > r.poorFood, 'the rich habitat holds more plants');
    assert.ok(r.aAlive && r.bAlive, 'neither agent died — the differential is about energy, not mortality');
    assert.ok(r.aEnergy > AGENT_START_ENERGY, `rich-cell agent gained energy (${r.aEnergy.toFixed(1)})`);
    assert.ok(r.bEnergy < AGENT_START_ENERGY, `poor-cell twin drained, not gained (${r.bEnergy.toFixed(1)})`);
    assert.ok(r.gap > 10, `energy gap proves the resource loop (A=${r.aEnergy.toFixed(1)} B=${r.bEnergy.toFixed(1)})`);
  });
});

describe('second order — interactions between individuals', () => {
  it('a carnivore eats its prey and then starves: a predator-prey boom/bust (Lotka-Volterra crash)', () => {
    const r = runSecondOrder('second-order');
    assert.ok(r.kills >= 1, `predator landed at least one killing bite (kills=${r.kills})`);
    assert.ok(!r.prey1Alive && !r.prey2Alive, 'both prey were consumed');
    assert.ok(!r.predAlive, 'with its prey gone the predator starves — the crash half of the boom/bust');
    assert.ok(
      r.prey1DiedAt < r.predDiedAt && r.prey2DiedAt < r.predDiedAt,
      `prey died before the predator (prey1@${r.prey1DiedAt} prey2@${r.prey2DiedAt} pred@${r.predDiedAt})`,
    );
    assert.ok(r.completed, 'the boom/bust completes within the observation window');
    assert.ok(r.prey1DiedAt < r.completedAt, 'the crash resolves before the run finishes');
  });
});

describe('third order — closed ecological loops', () => {
  it('carrion decomposition closes the nutrient loop: carrion raises soil minerals and accelerates plant regrowth', () => {
    const r = runThirdOrder('third-order');
    assert.ok(
      r.carrionGrowth > r.controlGrowth,
      `decomposition-fed soil grows more biomass (control=${r.controlGrowth.toFixed(3)} carrion=${r.carrionGrowth.toFixed(3)})`,
    );
    assert.ok(r.carrionMinerals > r.controlMinerals, 'decayed carrion enriched the soil minerals');
    assert.ok(r.controlGrowth > 0, 'even the control regrows (weathering + background minerals)');
  });

  it('decomposition conserves matter exactly: minerals gain equals decayed carrion * DECOMP_FRACTION', () => {
    const r = runConservation('third-order-conservation');
    assert.ok(Math.abs(r.meatError) < 1e-4, `meat decayed exactly (delta=${r.meatDecayed}, expected ${r.expectedDecay})`);
    assert.ok(
      Math.abs(r.mineralError) < 1e-4,
      `mineral gain is the decayed matter at the decomposition fraction (delta=${r.mineralGained}, expected ${r.expectedMineralGain})`,
    );
  });
});

describe('determinism of the emergence scenarios', () => {
  it('the first-order scenario reproduces a bit-identical world fingerprint from the same seed', () => {
    const d = determinismCheck('first-order', 'first-order-det');
    assert.ok(d.matched, `world fingerprints differ across identical runs (${d.hash})`);
  });

  it('the second-order scenario reproduces a bit-identical world fingerprint from the same seed', () => {
    const d = determinismCheck('second-order', 'second-order-det');
    assert.ok(d.matched, `world fingerprints differ across identical runs (${d.hash})`);
  });

  it('the third-order scenario reproduces a bit-identical world fingerprint from the same seed', () => {
    const d = determinismCheck('third-order', 'third-order-det');
    assert.ok(d.matched, `world fingerprints differ across identical runs (${d.hash})`);
  });
});

// Keep the exported tick/energy constants honest: bumping them changes the
// scenarios under test, and the harness's provenance reports them.
describe('scenario parameters are pinned for reproducibility', () => {
  it('tick budgets', () => {
    assert.equal(FIRST_ORDER_TICKS, 60);
    assert.equal(SECOND_ORDER_WINDOW, 2000);
    assert.equal(THIRD_ORDER_TICKS, 60);
  });
  it('energy set-points', () => {
    assert.equal(PREY_ENERGY, 30);
    assert.equal(AGENT_START_ENERGY, 15);
  });
});
