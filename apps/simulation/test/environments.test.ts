import { test } from 'node:test';
import assert from 'node:assert';
import { Engine } from '../src/engine.js';
import { ALL_ENV_PRESETS } from '../src/research/environments.js';
import { makeWorld } from '../src/research/scenarios.js';

test('Phase-M environment presets seed distinct chemical terrain and stay deterministic', () => {
  for (const preset of ALL_ENV_PRESETS) {
    for (const seed of ['same', 'same']) {
      const w = makeWorld(seed, 20, {}, preset);
      const e = new Engine(w);
      assert.ok(e, `${preset} builds`);
      const r = e.tick();
      assert.ok(r.stats.aliveCount > 0, `${preset} colony alive at tick 1`);
    }
  }
  // same seed + same preset twice -> identical trajectory; differing preset ->
  // the terrain chemistry must actually differ beneath the agents.
  const a = new Engine(makeWorld('det', 20, {}, 'calm'));
  const a2 = new Engine(makeWorld('det', 20, {}, 'calm'));
  const b = new Engine(makeWorld('det', 20, {}, 'acidicCrater'));
  for (let i = 0; i < 30; i++) {
    const ra = a.tick();
    const ra2 = a2.tick();
    const rb = b.tick();
    assert.equal(ra.stats.stateHash, ra2.stats.stateHash, 'deterministic per seed+preset');
    assert.notEqual(ra.stats.meanPH, rb.stats.meanPH, 'acidic world differs in mean pH');
  }
});