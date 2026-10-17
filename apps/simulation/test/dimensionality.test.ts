import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  flatIndex,
  cellCoords,
  solveLattice,
  DIMENSION_WORLDS,
  BOX_WORLDS,
  type LatticeSpec,
} from '../src/research/dimensional_worlds.js';

/**
 * Dimensionality gate.
 *
 * The same ecology can be embedded in 1, 2, 3 or 4 spatial dimensions; the
 * lattice solver is the instrument that lets that comparison be made. The
 * flat-index ↔ coordinate mapping must be a bijection (or every cell overlap),
 * the derived geometry (volume, connectivity = 2·N) must be exact, and a given
 * lattice must be perfectly reproducible.
 */

describe('dimensionality · index mapping is a bijection', () => {
  const dims = [3, 4, 5];
  const volume = 3 * 4 * 5;

  it('round-trips every cell through coordinates and back', () => {
    for (let f = 0; f < volume; f++) {
      assert.equal(flatIndex(dims, cellCoords(dims, f)), f, `cell ${f}`);
    }
  });

  it('uses row-major ordering', () => {
    assert.equal(flatIndex([3, 4, 5], [0, 0, 0]), 0);
    assert.equal(flatIndex([3, 4, 5], [1, 0, 0]), 20);
    assert.equal(flatIndex([3, 4, 5], [0, 1, 0]), 5);
    assert.equal(flatIndex([3, 4, 5], [0, 0, 1]), 1);
    assert.equal(flatIndex([3, 4, 5], [2, 3, 4]), volume - 1);
  });

  it('maps coordinates back to the correct cell', () => {
    assert.deepEqual(cellCoords([3, 4, 5], 21), [1, 0, 1]);
  });
});

describe('dimensionality · derived geometry is exact', () => {
  it('computes volume, side and 2N connectivity', () => {
    for (const spec of DIMENSION_WORLDS) {
      const out = solveLattice({ ...spec, ticks: 20 });
      const N = spec.dims.length;
      assert.equal(out.volume, spec.dims.reduce((a, b) => a * b, 1));
      assert.equal(out.side, Math.max(...spec.dims));
      assert.equal(out.connectivity, 2 * N, `${N}D connectivity`);
    }
  });

  it('keeps every reported observable in a physical range', () => {
    const out = solveLattice({ dims: [32], topology: 'torus', ticks: 100 });
    assert.ok(out.survival >= 0 && out.survival <= 1, `survival ${out.survival}`);
    assert.ok(out.shannon >= 0, `shannon ${out.shannon}`);
    assert.ok(out.resourceVar >= 0, `resourceVar ${out.resourceVar}`);
    assert.ok(out.spread >= 0 && out.meanColonyDist >= 0);
    assert.ok(out.finalBiomass >= 0 && out.finalColonies >= 0);
  });
});

describe('dimensionality · topological embedding is honoured', () => {
  it('defaults to a torus and preserves an explicit box', () => {
    assert.equal(solveLattice({ dims: [16, 16], ticks: 20 }).topology, 'torus');
    const box = solveLattice({ dims: [16, 16], topology: 'box', wallFlux: 0.01, ticks: 20 });
    assert.equal(box.topology, 'box');
  });

  it('the registry spans 1 to 4 spatial dimensions', () => {
    assert.equal(DIMENSION_WORLDS.length, 4);
    assert.deepEqual(
      DIMENSION_WORLDS.map((s) => s.dims.length),
      [1, 2, 3, 4],
    );
    assert.ok(BOX_WORLDS.every((s) => s.topology === 'box'));
  });
});

describe('dimensionality · a lattice is reproducible and does not mutate its spec', () => {
  it('two identical specs give identical outcomes', () => {
    const spec: LatticeSpec = { dims: [12, 12], topology: 'torus', ticks: 60, seed: 'dim.test' };
    assert.deepEqual(solveLattice(spec), solveLattice(spec));
  });

  it('does not mutate the caller-supplied dims array', () => {
    const dims = [10, 10];
    solveLattice({ dims, ticks: 30 });
    assert.deepEqual(dims, [10, 10]);
  });
});
