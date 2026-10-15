import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  OMICS_MRNA_BLOCKS,
  OMICS_PROTEIN_BLOCKS,
  OMICS_REACTION_COUNT,
  OMICS_TRANSCRIBE_BASE,
  OMICS_MRNA_DECAY,
  OMICS_PROTEIN_DECAY,
  OMICS_PROTEIN_YIELD,
  OMICS_ENV_INDUCTION,
  OMICS_EPI_SILENCE,
  OMICS_FLUX_SCALE,
  OMICS_FLUX_YIELD,
  OMICS_FLUX_SPLIT,
  OMICS_FLUX_CATABOLIC_BONUS,
  OMICS_FLUX_LIGASE_COST,
  OMICS_NOISE_THETA,
  OMICS_NOISE_SIGMA,
  OMICS_NOISE_GAIN,
  OMICS_FOLD_RATE,
  OMICS_FOLD_MELT,
  OMICS_FOLD_RANGE,
  OMICS_MISFOLD_DECAY,
  OMICS_UPR_THRESHOLD,
  OMICS_UPR_GAIN,
  OMICS_TF_AFFINITY_K,
  OMICS_TF_REG_MIN,
  OMICS_TF_REG_MAX,
  OMICS_TF_SIGNATURE_BITS,
  OMICS_ENV_WINDOW,
  OMICS_ENV_BUCKETS,
  OMICS_LIBRARY_SIZE,
  OMICS_LIBRARY_LIGATE,
  OMICS_LIBRARY_DECAY,
  OMICS_LIBRARY_MAX,
  RECOMB_MAX_POINTS,
  RECOMB_BLOCK_COUNT,
  RECOMB_BLOCK_MIN_GENES,
} from '../src/constants.js';

describe('omics constants', () => {
  it('exposes the full omics constant block', () => {
    const block = {
      OMICS_MRNA_BLOCKS,
      OMICS_PROTEIN_BLOCKS,
      OMICS_REACTION_COUNT,
      OMICS_TRANSCRIBE_BASE,
      OMICS_MRNA_DECAY,
      OMICS_PROTEIN_DECAY,
      OMICS_PROTEIN_YIELD,
      OMICS_ENV_INDUCTION,
      OMICS_EPI_SILENCE,
      OMICS_FLUX_SCALE,
      OMICS_FLUX_YIELD,
      OMICS_FLUX_SPLIT,
      OMICS_FLUX_CATABOLIC_BONUS,
      OMICS_FLUX_LIGASE_COST,
    };
    assert.equal(Object.keys(block).length, 14);
    for (const v of Object.values(block)) {
      assert.ok(Number.isFinite(v), `constant must be finite, got ${v}`);
    }
  });
  it('keeps designed values (mirrored 1:1 in crates/shared/src/constants.rs)', () => {
    assert.equal(OMICS_MRNA_BLOCKS, 24);
    assert.equal(OMICS_PROTEIN_BLOCKS, 24);
    assert.equal(OMICS_REACTION_COUNT, 6);
    assert.equal(OMICS_TRANSCRIBE_BASE, 0.12);
    assert.equal(OMICS_MRNA_DECAY, 0.06);
    assert.equal(OMICS_PROTEIN_DECAY, 0.03);
    assert.equal(OMICS_PROTEIN_YIELD, 0.08);
    assert.equal(OMICS_ENV_INDUCTION, 1.3);
    assert.equal(OMICS_EPI_SILENCE, 0.65);
    assert.equal(OMICS_FLUX_SCALE, 0.05);
    assert.equal(OMICS_FLUX_YIELD, 0.8);
    assert.equal(OMICS_FLUX_SPLIT, 0.5);
    assert.equal(OMICS_FLUX_CATABOLIC_BONUS, 0.3);
    assert.equal(OMICS_FLUX_LIGASE_COST, 0.5);
  });

  it('exposes the Phase C constants (stochastic expression, folding, TF motifs, library, recombination)', () => {
    const block = {
      OMICS_NOISE_THETA,
      OMICS_NOISE_SIGMA,
      OMICS_NOISE_GAIN,
      OMICS_FOLD_RATE,
      OMICS_FOLD_MELT,
      OMICS_FOLD_RANGE,
      OMICS_MISFOLD_DECAY,
      OMICS_UPR_THRESHOLD,
      OMICS_UPR_GAIN,
      OMICS_TF_AFFINITY_K,
      OMICS_TF_REG_MIN,
      OMICS_TF_REG_MAX,
      OMICS_TF_SIGNATURE_BITS,
      OMICS_ENV_WINDOW,
      OMICS_ENV_BUCKETS,
      OMICS_LIBRARY_SIZE,
      OMICS_LIBRARY_LIGATE,
      OMICS_LIBRARY_DECAY,
      OMICS_LIBRARY_MAX,
      RECOMB_MAX_POINTS,
      RECOMB_BLOCK_COUNT,
      RECOMB_BLOCK_MIN_GENES,
    };
    assert.equal(Object.keys(block).length, 22);
    for (const v of Object.values(block)) {
      assert.ok(Number.isFinite(v), `constant must be finite, got ${v}`);
    }
    // designed values, mirrored 1:1 in the Rust constants
    assert.equal(OMICS_NOISE_THETA, 0.02);
    assert.equal(OMICS_NOISE_SIGMA, 0.015);
    assert.equal(OMICS_NOISE_GAIN, 0.6);
    assert.equal(OMICS_FOLD_RATE, 0.04);
    assert.equal(OMICS_FOLD_MELT, 2.5);
    assert.equal(OMICS_FOLD_RANGE, 2.0);
    assert.equal(OMICS_MISFOLD_DECAY, 0.12);
    assert.equal(OMICS_UPR_THRESHOLD, 0.15);
    assert.equal(OMICS_UPR_GAIN, 1.5);
    assert.equal(OMICS_TF_AFFINITY_K, 1.6);
    assert.equal(OMICS_TF_REG_MIN, 0.35);
    assert.equal(OMICS_TF_REG_MAX, 3.0);
    assert.equal(OMICS_TF_SIGNATURE_BITS, 12);
    assert.equal(OMICS_ENV_WINDOW, 8);
    assert.equal(OMICS_ENV_BUCKETS, 4);
    assert.equal(OMICS_LIBRARY_SIZE, 16);
    assert.equal(OMICS_LIBRARY_LIGATE, 0.02);
    assert.equal(OMICS_LIBRARY_DECAY, 0.05);
    assert.equal(OMICS_LIBRARY_MAX, 40);
    assert.equal(RECOMB_MAX_POINTS, 5);
    assert.equal(RECOMB_BLOCK_COUNT, 8);
    assert.equal(RECOMB_BLOCK_MIN_GENES, 8);
  });
});