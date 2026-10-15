import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  PROTEOME_SIZE,
  CHAPERONE_FOLD_RATE,
  CHAPERONE_ATP_COST,
  MISFOLD_STRESS_DECAY,
  MISFOLD_MEMBRANE_DAMAGE,
  PROTEIN_TURNOVER_RATE,
  GRADIENT_PROPAGATION_RATE,
  PASSIVE_DIFFUSION_RATE,
  MM_KM,
  MM_INHIBITION,
  LIPID_REPAIR_RATE,
  LIPID_REPAIR_ATP,
  FOLDING_SULFUR_SENSITIVITY,
} from '../src/constants.js';

describe('cell biochemistry constants', () => {
  it('exposes the full cellBio constant block', () => {
    const block = {
      PROTEOME_SIZE, CHAPERONE_FOLD_RATE, CHAPERONE_ATP_COST,
      MISFOLD_STRESS_DECAY, MISFOLD_MEMBRANE_DAMAGE, PROTEIN_TURNOVER_RATE,
      GRADIENT_PROPAGATION_RATE, PASSIVE_DIFFUSION_RATE, MM_KM, MM_INHIBITION,
      LIPID_REPAIR_RATE, LIPID_REPAIR_ATP, FOLDING_SULFUR_SENSITIVITY,
    };
    assert.equal(Object.keys(block).length, 13);
    for (const v of Object.values(block)) {
      assert.ok(Number.isFinite(v), `constant must be finite, got ${v}`);
    }
  });
  it('keeps designed values (mirrored 1:1 in crates/shared/src/constants.rs)', () => {
    assert.equal(PROTEOME_SIZE, 4);
    assert.equal(CHAPERONE_FOLD_RATE, 0.02);
    assert.equal(CHAPERONE_ATP_COST, 0.05);
    assert.equal(MISFOLD_STRESS_DECAY, 0.01);
    assert.equal(MISFOLD_MEMBRANE_DAMAGE, 0.005);
    assert.equal(PROTEIN_TURNOVER_RATE, 0.005);
    assert.equal(GRADIENT_PROPAGATION_RATE, 0.01);
    assert.equal(PASSIVE_DIFFUSION_RATE, 0.005);
    assert.equal(MM_KM, 10.0);
    assert.equal(MM_INHIBITION, 0.3);
    assert.equal(LIPID_REPAIR_RATE, 0.01);
    assert.equal(LIPID_REPAIR_ATP, 0.03);
    assert.equal(FOLDING_SULFUR_SENSITIVITY, 0.3);
  });
});