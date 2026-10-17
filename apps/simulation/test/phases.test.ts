import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ENV_PROFILES, type EnvironmentPreset } from '@fractal-life/shared';
import { MODE_DEFS, type ScientificMode } from '../src/research/modes.js';
import { EXTREME_PRESETS, biomeClass } from '../src/research/environments.js';
import {
  WEATHER_NAMES,
  WEATHER_MOISTURE,
  WEATHER_GROWTH,
  DEFAULT_WEATHER_MATRIX,
} from '../src/worldStoch.js';

/**
 * Phase gate.
 *
 * The world is not one place but a family of regimes, and the phase labels that
 * organise the research must be a well-defined partition:
 *
 *   biome   — every environment preset is exactly one of control / extreme /
 *             underrated, with no gaps and no overlaps;
 *   weather — the four Markov weather states are a proper distribution;
 *   mode    — the four scientific modes form the determinism → … → research
 *             ladder, each with a purpose and a gate.
 */

const ALL_PRESETS = Object.keys(ENV_PROFILES) as EnvironmentPreset[];

describe('phases · the biome partition is total and disjoint', () => {
  it('classifies calm as the control', () => {
    assert.equal(biomeClass('calm'), 'control');
  });

  it('classifies every EXTREME_PRESETS entry as extreme', () => {
    for (const p of EXTREME_PRESETS) assert.equal(biomeClass(p), 'extreme', p);
  });

  it('classifies the remaining presets as underrated', () => {
    const underrated = ALL_PRESETS.filter((p) => p !== 'calm' && !EXTREME_PRESETS.includes(p));
    assert.ok(underrated.length > 0, 'expected some underrated presets');
    for (const p of underrated) assert.equal(biomeClass(p), 'underrated', p);
  });

  it('assigns every preset to exactly one class', () => {
    for (const p of ALL_PRESETS) {
      const c = biomeClass(p);
      assert.ok(c === 'control' || c === 'extreme' || c === 'underrated', `${p} -> ${c}`);
    }
  });

  it('never lists calm among the extremes and has no duplicates', () => {
    assert.ok(!EXTREME_PRESETS.includes('calm'));
    assert.equal(new Set(EXTREME_PRESETS).size, EXTREME_PRESETS.length);
    assert.ok(EXTREME_PRESETS.every((p) => p in ENV_PROFILES));
  });
});

describe('phases · the weather Markov chain is a valid distribution', () => {
  it('has four named states', () => {
    assert.equal(WEATHER_NAMES.length, 4);
    assert.equal(new Set(WEATHER_NAMES).size, 4);
  });

  it('has a transition matrix whose every row sums to one', () => {
    assert.equal(DEFAULT_WEATHER_MATRIX.length, WEATHER_NAMES.length);
    for (const row of DEFAULT_WEATHER_MATRIX) {
      assert.equal(row.length, WEATHER_NAMES.length);
      const sum = row.reduce((a, b) => a + b, 0);
      assert.ok(Math.abs(sum - 1) < 1e-9, `row sums to ${sum}`);
    }
  });

  it('gives every weather state a moisture and a growth factor', () => {
    assert.equal(WEATHER_MOISTURE.length, WEATHER_NAMES.length);
    assert.equal(WEATHER_GROWTH.length, WEATHER_NAMES.length);
    for (const v of [...WEATHER_MOISTURE, ...WEATHER_GROWTH]) assert.ok(v > 0, `non-positive factor ${v}`);
  });
});

describe('phases · the scientific-mode ladder is complete', () => {
  const modes: ScientificMode[] = ['determinism', 'debugging', 'reproducibility', 'research'];

  it('defines exactly the four ladder modes', () => {
    assert.deepEqual(Object.keys(MODE_DEFS).sort(), [...modes].sort());
  });

  it('keeps the legacy modes deterministic and turns stochasticity on only up the ladder', () => {
    assert.equal(MODE_DEFS.determinism.stochastic, false);
    assert.equal(MODE_DEFS.debugging.stochastic, false);
    assert.equal(MODE_DEFS.reproducibility.stochastic, true);
    assert.equal(MODE_DEFS.research.stochastic, true);
  });

  it('gives every mode a purpose and a gate', () => {
    for (const m of modes) {
      assert.ok(MODE_DEFS[m].purpose.length > 0, `${m} missing purpose`);
      assert.ok(MODE_DEFS[m].gate.length > 0, `${m} missing gate`);
    }
  });
});
