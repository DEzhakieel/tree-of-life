import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  FORCE_REP_SIGMA,
  FORCE_REP_K,
  FORCE_ATTRACT_K,
  FORCE_CUTOFF,
  FORCE_SOFTEN_R,
  FORCE_MAX,
  FORCE_DRIVE_SCALE,
  AFFINITY_WEIGHT,
  REPULSION_WEIGHT,
  CONSERVATION_MASS_TOL,
  SYMMETRY_POLARITY_TOL,
  BOND_ENERGY_K,
  ENTHALPY_GIBBS_WEIGHT,
  ENTROPY_PRODUCTION_K,
  CARNOT_TEMP_MIN,
  CARNOT_TEMP_MAX,
  HEAT_WASTE_FRACTION,
  ENGINE_POWER_K,
  RADIATION_EMISSIVITY,
  RADIATION_STEFAN_BOLTZMANN,
} from '../src/constants.js';

describe('biophysics constants', () => {
  it('exposes the full biophysics constant block', () => {
    const block = {
      FORCE_REP_SIGMA, FORCE_REP_K, FORCE_ATTRACT_K, FORCE_CUTOFF,
      FORCE_SOFTEN_R, FORCE_MAX, FORCE_DRIVE_SCALE,
      AFFINITY_WEIGHT, REPULSION_WEIGHT, CONSERVATION_MASS_TOL,
      SYMMETRY_POLARITY_TOL, BOND_ENERGY_K, ENTHALPY_GIBBS_WEIGHT,
      ENTROPY_PRODUCTION_K, CARNOT_TEMP_MIN, CARNOT_TEMP_MAX,
      HEAT_WASTE_FRACTION, ENGINE_POWER_K, RADIATION_EMISSIVITY,
      RADIATION_STEFAN_BOLTZMANN,
    };
    assert.equal(Object.keys(block).length, 20);
    for (const v of Object.values(block)) {
      assert.ok(Number.isFinite(v), `constant must be finite, got ${v}`);
    }
  });
  it('keeps designed values (mirrored 1:1 in crates/shared/src/constants.rs)', () => {
    assert.equal(FORCE_REP_SIGMA, 8.0);
    assert.equal(FORCE_REP_K, 0.02);
    assert.equal(FORCE_ATTRACT_K, 0.002);
    assert.equal(FORCE_CUTOFF, 24.0);
    assert.equal(FORCE_SOFTEN_R, 3.0);
    assert.equal(FORCE_MAX, 6.0);
    assert.equal(FORCE_DRIVE_SCALE, 8.0);
    assert.equal(AFFINITY_WEIGHT, 1.0);
    assert.equal(REPULSION_WEIGHT, 1.0);
    assert.equal(CONSERVATION_MASS_TOL, 0.0001);
    assert.equal(SYMMETRY_POLARITY_TOL, 0.001);
    assert.equal(BOND_ENERGY_K, 0.6);
    assert.equal(ENTHALPY_GIBBS_WEIGHT, 0.8);
    assert.equal(ENTROPY_PRODUCTION_K, 0.02);
    assert.equal(CARNOT_TEMP_MIN, 278.0);
    assert.equal(CARNOT_TEMP_MAX, 310.0);
    assert.equal(HEAT_WASTE_FRACTION, 0.4);
    assert.equal(ENGINE_POWER_K, 0.5);
    assert.equal(RADIATION_EMISSIVITY, 0.9);
    assert.equal(RADIATION_STEFAN_BOLTZMANN, 5.67e-8);
  });
});