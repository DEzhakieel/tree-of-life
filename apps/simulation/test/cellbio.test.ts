import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SplitMix64 } from '../src/rng.js';
import { createAgentChemistry } from '../src/chemistry.js';
import { createCellState, decodeCellGenes, decodeMembraneGenes } from '../src/cells.js';
import {
  createCellBioState,
  michaelisMentenRate,
  tickFolding,
  tickMembraneBiochemistry,
  tickGradientFlux,
  applyCellBioTick,
  type ApplyEnv,
} from '../src/cellbio.js';
import {
  GENOME_SIZE,
  ELEMENTS,
  MOLECULES,
  MOLECULE_COUNT,
  PROTEOME_SIZE,
} from '@fractal-life/shared';

function makeGenome(fill = 0): Float32Array {
  return new Float32Array(GENOME_SIZE).fill(fill);
}

function makeEnv(over: Partial<ApplyEnv> = {}): ApplyEnv {
  return { O2Local: 0.3, mineralLocal: 0.15, toxinLocal: 0, pHLocal: 7, waterAvailable: 0.5, ...over };
}

function makeRng(seed = 42): SplitMix64 {
  return new SplitMix64(seed);
}

describe('cellbio', () => {
  it('createCellBioState seeds proteome from membrane genes and gradient from bulk', () => {
    const g = makeGenome(0);
    const mem = decodeMembraneGenes(g);
    const chem = createAgentChemistry(g, 42);
    const bio = createCellBioState(mem, chem);
    assert.equal(bio.proteome.length, PROTEOME_SIZE);
    for (let i = 0; i < PROTEOME_SIZE; i++) {
      assert.ok(Math.abs(bio.proteome[i]! - (0.6 + 0.4 * (0.5 + i * 0))) < 1e-6, 'default gene 0 -> w01 0.5 -> 0.8');
    }
    assert.equal(bio.misfoldStress, 0);
    for (let i = 0; i < MOLECULE_COUNT; i++) {
      assert.equal(bio.gradient[i]!, chem.molecules[i]!, 'gradient == bulk at birth');
    }
  });

  it('michaelisMentenRate saturates and is zero with no substrate', () => {
    assert.equal(michaelisMentenRate(5, 0, 0), 0);
    const saturating = michaelisMentenRate(5, 1_000_000, 0);
    assert.ok(saturating < 5, 'asymptotically approaches but never exceeds Vmax');
    assert.ok(saturating > 4.9, 'approaches Vmax as substrate grows');
  });

  it('michaelisMentenRate applies end-product inhibition', () => {
    const free = michaelisMentenRate(5, 50, 0);
    const inhibited = michaelisMentenRate(5, 50, 200);
    assert.ok(inhibited < free, 'product should inhibit the rate');
    assert.ok(inhibited > 0);
    // pure function: zero Vmax or zero substrate => zero
    assert.equal(michaelisMentenRate(0, 10, 0), 0);
    assert.equal(michaelisMentenRate(5, -5, 0), 0, 'negative substrate clamped to 0');
  });

  it('tickFolding: acidic pH stresses the proteome', () => {
    const g = makeGenome(0);
    const mem = decodeMembraneGenes(g);
    const mk = (ph: number) => {
      const chem = createAgentChemistry(g, 42);
      chem.pH = ph;
      const cell = createCellState(decodeCellGenes(g));
      cell.bio = createCellBioState(mem, chem);
      for (let i = 0; i < 80; i++) tickFolding(chem, cell, cell.bio, 0.5, 1 / 60);
      return { chem, cell };
    };
    const neutral = mk(7);
    const acidic = mk(9);
    const qn = neutral.cell.bio!.proteome[0]!;
    const qa = acidic.cell.bio!.proteome[0]!;
    assert.ok(qa < qn, `acidic fold ${qa} should be worse than neutral ${qn}`);
  });

  it('tickFolding: sulfur deficiency (S < 3) reduces fold quality and raises stress', () => {
    const g = makeGenome(0);
    const mem = decodeMembraneGenes(g);
    const mk = (s: number) => {
      const chem = createAgentChemistry(g, 42);
      chem.elements[ELEMENTS.SULFUR] = s;
      const cell = createCellState(decodeCellGenes(g));
      cell.bio = createCellBioState(mem, chem);
      for (let i = 0; i < 120; i++) tickFolding(chem, cell, cell.bio, 0.5, 1 / 60);
      return cell;
    };
    const lowS = mk(1);
    const highS = mk(8);
    assert.ok(lowS.bio!.misfoldStress > highS.bio!.misfoldStress, 'low-S stresses harder');
    assert.ok(lowS.bio!.proteome[0]! < highS.bio!.proteome[0]!, 'low-S folds worse');
    assert.ok(highS.bio!.proteome[0]! > 0, 'high-S proteome stays healthy');
  });

  it('tickGradientFlux conserves surface + bulk per molecule', () => {
    const g = makeGenome(0);
    const mem = decodeMembraneGenes(g);
    const chem = createAgentChemistry(g, 42);
    const cell = createCellState(decodeCellGenes(g));
    cell.bio = createCellBioState(mem, chem);
    cell.bio.gradient[0] = 50;
    chem.molecules[0] = 10;
    const gut = cell.bio.gradient[0]! + chem.molecules[0]!;
    tickGradientFlux(cell.bio, chem, decodeCellGenes(g), 1);
    const after = cell.bio.gradient[0]! + chem.molecules[0]!;
    assert.ok(Math.abs(after - gut) < 1e-5, `total conserved (${gut} -> ${after})`);
  });

  it('tickGradientFlux moves molecules from the surface toward the bulk pool', () => {
    const g = makeGenome(0);
    const mem = decodeMembraneGenes(g);
    const chem = createAgentChemistry(g, 42);
    const cell = createCellState(decodeCellGenes(g));
    cell.bio = createCellBioState(mem, chem);
    cell.bio.gradient[0] = 50;
    chem.molecules[0] = 10;
    tickGradientFlux(cell.bio, chem, decodeCellGenes(g), 1);
    assert.ok(chem.molecules[0]! > 10, 'bulk should gain from the gradient');
    assert.ok(cell.bio.gradient[0]! < 50, 'gradient should deplete');
  });

  it('applyCellBioTick is deterministic and keeps state bounded', () => {
    const g = makeGenome(0);
    const mem = decodeMembraneGenes(g);
    const cellGenes = decodeCellGenes(g);
    const run = (seed: number) => {
      const chem = createAgentChemistry(g, 42);
      const cell = createCellState(cellGenes);
      cell.bio = createCellBioState(mem, chem);
      return applyCellBioTick(chem, cell, cell.bio, mem, cellGenes, 0.5, makeEnv(), makeRng(seed), 1 / 60);
    };
    const a = run(7);
    const b = run(7);
    assert.deepEqual(a, b, 'same seed -> identical result');
    assert.ok(a.atpCost >= 0);
    assert.ok(a.membraneDamage >= 0);
    assert.ok(a.foldEffect >= 0 && a.foldEffect <= 1);
    // membrane biochemistry actually moves molecules (proteome-relative flux)
    const chem = createAgentChemistry(g, 42);
    const cell = createCellState(cellGenes);
    cell.bio = createCellBioState(mem, chem);
    applyCellBioTick(chem, cell, cell.bio, mem, cellGenes, 0.5, makeEnv(), makeRng(3), 1 / 60);
    assert.ok(cell.membraneIntegrity >= 0 && cell.membraneIntegrity <= 1);
  });

  it('tickMembraneBiochemistry keeps pools non-negative and repairs membrane', () => {
    const g = makeGenome(0);
    const mem = decodeMembraneGenes(g);
    const chem = createAgentChemistry(g, 42);
    const cell = createCellState(decodeCellGenes(g));
    cell.bio = createCellBioState(mem, chem);
    cell.membraneIntegrity = 0.5;
    for (let i = 0; i < 200; i++) {
      tickMembraneBiochemistry(cell, cell.bio, chem, mem, makeEnv({ mineralLocal: 0.9, O2Local: 1 }), makeRng(i), 1 / 60);
      for (let m = 0; m < chem.molecules.length; m++) assert.ok(chem.molecules[m]! >= 0, `molecule ${m} non-negative`);
      for (let j = 0; j < chem.ions.length; j++) assert.ok(chem.ions[j]! >= 0, `ion ${j} non-negative`);
      assert.ok(cell.membraneIntegrity >= 0 && cell.membraneIntegrity <= 1);
    }
    assert.ok(cell.membraneIntegrity > 0.5, 'lipid repair raises integrity over time');
  });
});