import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DRIVE_OFFSET, DRIVES, STRATEGY_OFFSET, STRATEGIES, GENOME_SIZE } from '@fractal-life/shared';
import { decodeStrategies } from '../src/genome.js';
import {
  BASELINE,
  PERTURBATIONS,
  baselineGenome,
  perturbedGenome,
  OUTCOME_KEYS,
  type Perturbation,
} from '../src/research/perturb.js';

/**
 * Perturbation gate.
 *
 * The causal study works by applying a single, named intervention to an
 * otherwise identical baseline genome and measuring the delta in a macro
 * outcome vector. For that to mean anything the baseline must be exactly
 * reproducible and each perturbation must touch exactly one gene — no more, no
 * less. This file pins both:
 *
 *   - baselineGenome is deterministic and wires the faculties the study needs;
 *   - every perturbation kind edits only its own target and returns a copy;
 *   - the perturbation registry is well formed (unique ids, one baseline).
 */

const NOISE_IDX = DRIVE_OFFSET + DRIVES.NOISE;
const COOP_IDX = STRATEGY_OFFSET + STRATEGIES.COOPERATION;

describe('perturbation · the baseline genome is deterministic and correctly wired', () => {
  it('two calls produce byte-identical genomes', () => {
    assert.deepEqual(Array.from(baselineGenome()), Array.from(baselineGenome()));
    assert.equal(baselineGenome().length, 256);
    assert.ok(baselineGenome().length >= GENOME_SIZE);
  });

  it('keeps the founder at c = 0 so orbits stay bounded', () => {
    const g = baselineGenome();
    assert.ok(Math.abs(g[0]! - 1 / 3) < 1e-6, `gene 0 = ${g[0]}`);
  });

  it('enables eating and signalling (the channels the study ablates)', () => {
    const g = baselineGenome();
    assert.equal(g[105], 5, 'eat output bias on');
    assert.equal(g[108], 5, 'signal output bias on');
    assert.equal(g[107], -5, 'hunt off (herbivore baseline)');
  });

  it('honours a custom spec', () => {
    const g = baselineGenome({ ...BASELINE, noise: 0.4, cooperation: 0.9 });
    assert.ok(Math.abs(g[NOISE_IDX]! - (0.4 * 2 - 1)) < 1e-6, `noise gene ${g[NOISE_IDX]}`);
    assert.ok(Math.abs(g[COOP_IDX]! - (0.9 * 2 - 1)) < 1e-6, `coop gene ${g[COOP_IDX]}`);
  });
});

describe('perturbation · each kind edits exactly one target and returns a copy', () => {
  const base = baselineGenome();

  it('baseline makes no change', () => {
    const p: Perturbation = { id: 'baseline', kind: 'baseline', axis: '' };
    assert.deepEqual(Array.from(perturbedGenome(base, p)), Array.from(base));
  });

  it('cooperation zeroes the cooperation gene only', () => {
    const p: Perturbation = { id: 'no-cooperation', kind: 'cooperation', axis: '' };
    const out = perturbedGenome(base, p);
    assert.ok(decodeStrategies(out).cooperation < decodeStrategies(base).cooperation);
    assert.ok(Math.abs(decodeStrategies(out).cooperation) < 1e-9, 'cooperation decodes to 0');
    // only the cooperation gene moved
    for (let i = 0; i < base.length; i++) {
      if (i === COOP_IDX) continue;
      assert.equal(out[i], base[i], `gene ${i} should be untouched`);
    }
  });

  it('noise raises the noise drive by the factor', () => {
    const p: Perturbation = { id: 'noise-x2', kind: 'noise', factor: 0.2, axis: '' };
    const out = perturbedGenome(base, p);
    assert.ok(Math.abs(out[NOISE_IDX]! - (0.2 * 2 - 1)) < 1e-6, `noise gene ${out[NOISE_IDX]}`);
    assert.ok(out[NOISE_IDX]! > base[NOISE_IDX]!, 'noise drive increased');
    for (let i = 0; i < base.length; i++) {
      if (i === NOISE_IDX) continue;
      assert.equal(out[i], base[i], `gene ${i} should be untouched`);
    }
  });

  it('communication turns the signal output off only', () => {
    const p: Perturbation = { id: 'no-communication', kind: 'communication', axis: '' };
    const out = perturbedGenome(base, p);
    assert.equal(out[108], -5);
    for (let i = 0; i < base.length; i++) {
      if (i === 108) continue;
      assert.equal(out[i], base[i], `gene ${i} should be untouched`);
    }
  });

  it('cull is a run-time intervention with no genome edit', () => {
    const p: Perturbation = { id: 'cull-20pct', kind: 'cull', fraction: 0.2, axis: '' };
    assert.deepEqual(Array.from(perturbedGenome(base, p)), Array.from(base));
  });

  it('never mutates the input genome', () => {
    const snapshot = Array.from(base);
    for (const p of PERTURBATIONS) perturbedGenome(base, p);
    assert.deepEqual(Array.from(base), snapshot, 'baseline genome was mutated in place');
  });
});

describe('perturbation · the registry is well formed', () => {
  it('has five unique conditions with exactly one baseline', () => {
    assert.equal(PERTURBATIONS.length, 5);
    const ids = PERTURBATIONS.map((p) => p.id);
    assert.equal(new Set(ids).size, ids.length, 'duplicate perturbation id');
    assert.equal(PERTURBATIONS.filter((p) => p.kind === 'baseline').length, 1);
  });

  it('every perturbation carries an axis description and a valid kind', () => {
    const kinds = new Set(['baseline', 'cooperation', 'noise', 'communication', 'cull']);
    for (const p of PERTURBATIONS) {
      assert.ok(p.axis.length > 0, `${p.id} has no axis description`);
      assert.ok(kinds.has(p.kind), `${p.id} has an unknown kind ${p.kind}`);
    }
  });

  it('the outcome vector has unique keys', () => {
    assert.equal(new Set(OUTCOME_KEYS).size, OUTCOME_KEYS.length);
    assert.ok(OUTCOME_KEYS.includes('aliveFrac'));
    assert.ok(OUTCOME_KEYS.includes('cooperationRate'));
  });
});
