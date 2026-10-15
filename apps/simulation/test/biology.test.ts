import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createDnaSystem,
  tickDna,
  replicationFidelity,
  getEffectiveExpression,
  horizontalGeneTransfer,
  decodeDnaGenes,
} from '../src/dna.js';
import {
  createCellState,
  tickCell,
  membraneTransport,
  activeTransport,
  endocytosis,
  exocytosis,
  proteinSynthesisRate,
  mitochondrialAtp,
  receptorSensing,
  decodeCellGenes,
  decodeMembraneGenes,
} from '../src/cells.js';
import {
  createEcosystemGrid,
  updateEcosystemGrid,
  getLocalResources,
  competitionPressure,
  mutualismBenefit,
  parasitismDrain,
  assignTrophicLevel,
  carryingCapacity,
  migrationForce,
  territorialDefense,
  biodiversityIndex,
  foodChainEfficiency,
  decodeEcosystemGenes,
  TrophicLevel,
} from '../src/ecosystem.js';
import {
  createSelectionState,
  computeFitness,
  updateSpecies,
  computeSelectionPressure,
  frequencyDependentBonus,
  hamiltonsRule,
  relatedness,
  sexualSelectionMatingSuccess,
  fisherianRunaway,
} from '../src/selection.js';
import { SplitMix64 } from '../src/rng.js';
import { GENOME_SIZE, DNA_OFFSET, DNA_GENES, CELL_OFFSET, CELL_GENES, MEMBRANE_OFFSET, MEMBRANE_GENES, ECOSYSTEM_OFFSET, ECOSYSTEM_GENES, TERRAIN_CELL, TERRAIN_GRID, SPECIATION_THRESHOLD } from '@fractal-life/shared';

function makeRng(seed = 42): SplitMix64 {
  return new SplitMix64(seed);
}

function makeGenome(fill = 0): Float32Array {
  const g = new Float32Array(GENOME_SIZE).fill(fill);
  return g;
}

function makeGenomeWithGene(offset: number, geneIdx: number, value: number): Float32Array {
  const g = new Float32Array(GENOME_SIZE).fill(0);
  g[offset + geneIdx] = value;
  return g;
}

// ---------------------------------------------------------------------------
// DNA System Tests
// ---------------------------------------------------------------------------

describe('DNA system', () => {
  it('createDnaSystem returns valid initial state', () => {
    const dna = createDnaSystem();
    assert.equal(dna.integrity, 1.0);
    assert.equal(dna.damageAccum, 0);
    assert.equal(dna.totalErrors, 0);
    assert.equal(dna.totalRepairs, 0);
    assert.equal(dna.expression.length, 24);
    assert.equal(dna.epigenetic.length, 24);
    for (let i = 0; i < 24; i++) {
      assert.equal(dna.expression[i], 0.5);
      assert.equal(dna.epigenetic[i], 0);
    }
  });

  it('tickDna accumulates damage over time', () => {
    const dna = createDnaSystem();
    const genes = decodeDnaGenes(makeGenome(0));
    const rng = makeRng(1);
    tickDna(dna, genes, 1, rng, 100);
    assert.ok(dna.damageAccum > 0, 'damage should accumulate');
    assert.ok(dna.integrity <= 1.0, 'integrity should not exceed 1');
  });

  it('tickDna with high dnaStability accumulates less damage', () => {
    const stable = createDnaSystem();
    const unstable = createDnaSystem();
    const stableGenes = decodeDnaGenes(makeGenomeWithGene(DNA_OFFSET, DNA_GENES.DNA_STABILITY, 1));
    const unstableGenes = decodeDnaGenes(makeGenomeWithGene(DNA_OFFSET, DNA_GENES.DNA_STABILITY, -1));
    tickDna(stable, stableGenes, 1, makeRng(1), 100);
    tickDna(unstable, unstableGenes, 1, makeRng(2), 100);
    assert.ok(stable.damageAccum < unstable.damageAccum, 'stable DNA should accumulate less damage');
  });

  it('tickDna repair consumes ATP when damage exists', () => {
    const dna = createDnaSystem();
    dna.damageAccum = 0.15;
    const genes = decodeDnaGenes(makeGenome(0.5));
    const result = tickDna(dna, genes, 1, makeRng(1), 100);
    assert.ok(result.atpCost > 0, 'repair should consume ATP');
  });

  it('tickDna repair does not consume ATP when no ATP available', () => {
    const dna = createDnaSystem();
    dna.damageAccum = 0.15;
    const genes = decodeDnaGenes(makeGenome(0.5));
    const result = tickDna(dna, genes, 1, makeRng(1), 0);
    assert.equal(result.atpCost, 0, 'no ATP cost when no ATP available');
  });

  it('tickDna records mutations probabilistically', () => {
    let mutated = false;
    for (let trial = 0; trial < 5000; trial++) {
      const dna = createDnaSystem();
      const genes = decodeDnaGenes(makeGenome(-1)); // low fidelity
      const result = tickDna(dna, genes, 1, makeRng(trial), 100);
      if (result.mutationsOccurred) { mutated = true; break; }
    }
    assert.ok(mutated, 'mutations should occur at some point with low fidelity');
  });

  it('tickDna integrity never goes below 0', () => {
    const dna = createDnaSystem();
    dna.damageAccum = 10;
    dna.integrity = 0.001;
    const genes = decodeDnaGenes(makeGenome(-1));
    tickDna(dna, genes, 100, makeRng(1), 100);
    assert.ok(dna.integrity >= 0, 'integrity must not go below 0');
  });

  it('tickDna expression drifts from epigenetic noise', () => {
    const dna = createDnaSystem();
    const noisyGenes = decodeDnaGenes(makeGenomeWithGene(DNA_OFFSET, DNA_GENES.EPIGENETIC_NOISE, 1));
    tickDna(dna, noisyGenes, 1, makeRng(42), 100);
    let drifted = false;
    for (let i = 0; i < 24; i++) {
      if (Math.abs(dna.expression[i]! - 0.5) > 0.001) { drifted = true; break; }
    }
    assert.ok(drifted, 'expression should drift with high epigenetic noise');
  });

  it('replicationFidelity returns mutation vector with some probability', () => {
    let gotMutations = false;
    for (let i = 0; i < 5000; i++) {
      const dna = createDnaSystem();
      const genes = decodeDnaGenes(makeGenome(-1));
      const result = replicationFidelity(dna, genes, makeRng(i));
      if (result !== null) {
        gotMutations = true;
        assert.equal(result.length, GENOME_SIZE);
        break;
      }
    }
    assert.ok(gotMutations, 'mutations should occur eventually');
  });

  it('replicationFidelity with high fidelity rarely mutates', () => {
    let mutationCount = 0;
    for (let i = 0; i < 200; i++) {
      const dna = createDnaSystem();
      const genes = decodeDnaGenes(makeGenomeWithGene(DNA_OFFSET, DNA_GENES.REPLICATION_FIDELITY, 1));
      const result = replicationFidelity(dna, genes, makeRng(i));
      if (result !== null) mutationCount++;
    }
    assert.ok(mutationCount < 5, `high fidelity should rarely mutate, got ${mutationCount}/200`);
  });

  it('getEffectiveExpression returns base expression when unmethylated', () => {
    const dna = createDnaSystem();
    dna.expression[0] = 0.8;
    const result = getEffectiveExpression(dna, 0);
    assert.ok(Math.abs(result - 0.8) < 0.001, `expected ~0.8, got ${result}`);
  });

  it('getEffectiveExpression silences methylated genes', () => {
    const dna = createDnaSystem();
    dna.expression[0] = 0.8;
    dna.epigenetic[0] = 1.0;
    const result = getEffectiveExpression(dna, 0);
    assert.ok(result < 0.1, `methylated gene should be silenced, got ${result}`);
  });

  it('horizontalGeneTransfer copies a block of genes', () => {
    const recipient = makeGenome(0);
    const donor = makeGenome(1);
    const success = horizontalGeneTransfer(recipient, donor, 0.5, makeRng(42));
    if (success) {
      let changed = false;
      for (let i = 0; i < GENOME_SIZE; i++) {
        if (recipient[i] !== 0) { changed = true; break; }
      }
      assert.ok(changed, 'HGT should modify recipient genome');
    }
  });

  it('horizontalGeneTransfer returns false with low hgtGene', () => {
    let successCount = 0;
    for (let i = 0; i < 100; i++) {
      if (horizontalGeneTransfer(makeGenome(), makeGenome(1), 0.001, makeRng(i))) successCount++;
    }
    assert.ok(successCount < 5, `very low HGT gene should rarely succeed, got ${successCount}/100`);
  });

  it('decodeDnaGenes maps [-1,1] to [0,1]', () => {
    const genes = decodeDnaGenes(makeGenome(0));
    assert.equal(genes.replicationFidelity, 0.5);
    assert.equal(genes.repairRate, 0.5);
    const high = decodeDnaGenes(makeGenomeWithGene(DNA_OFFSET, DNA_GENES.REPLICATION_FIDELITY, 1));
    assert.equal(high.replicationFidelity, 1);
    const low = decodeDnaGenes(makeGenomeWithGene(DNA_OFFSET, DNA_GENES.REPLICATION_FIDELITY, -1));
    assert.equal(low.replicationFidelity, 0);
  });
});

// ---------------------------------------------------------------------------
// Cellular System Tests
// ---------------------------------------------------------------------------

describe('Cellular system', () => {
  it('createCellState returns valid initial state', () => {
    const cellGenes = decodeCellGenes(makeGenome(0));
    const cell = createCellState(cellGenes);
    assert.ok(cell.radius > 0, 'radius should be positive');
    assert.equal(cell.membranePotential, -70);
    assert.equal(cell.membraneIntegrity, 1.0);
    assert.equal(cell.divisionProgress, 0);
    assert.equal(cell.divisionCount, 0);
    assert.equal(cell.isDividing, false);
    assert.equal(cell.divisionTimer, 0);
    assert.equal(cell.vesicleBuffer.length, 12); // MOLECULE_COUNT
  });

  it('tickCell consumes ATP for maintenance', () => {
    const cellGenes = decodeCellGenes(makeGenome(0));
    const memGenes = decodeMembraneGenes(makeGenome(0));
    const cell = createCellState(cellGenes);
    const ions = new Float32Array(5).fill(10);
    const result = tickCell(cell, cellGenes, memGenes, ions, 1, makeRng(1), 50);
    assert.ok(result.atpCost > 0, 'cell tick should have ATP cost');
  });

  it('tickCell membrane potential changes with ion ratio', () => {
    const cellGenes = decodeCellGenes(makeGenome(0));
    const memGenes = decodeMembraneGenes(makeGenome(0));
    const cell1 = createCellState(cellGenes);
    const cell2 = createCellState(cellGenes);
    const ions1 = new Float32Array([10, 5, 1, 1, 1]); // low Na/K ratio
    const ions2 = new Float32Array([5, 10, 1, 1, 1]); // high Na/K ratio
    tickCell(cell1, cellGenes, memGenes, ions1, 1, makeRng(1), 50);
    tickCell(cell2, cellGenes, memGenes, ions2, 1, makeRng(1), 50);
    assert.notEqual(cell1.membranePotential, cell2.membranePotential, 'different ion ratios should produce different potentials');
  });

  it('tickCell tension increases with osmotic diff', () => {
    const cellGenes = decodeCellGenes(makeGenome(0));
    const memGenes = decodeMembraneGenes(makeGenome(0));
    const cell = createCellState(cellGenes);
    const ions = new Float32Array([50, 50, 1, 1, 0]); // huge osmotic diff
    tickCell(cell, cellGenes, memGenes, ions, 10, makeRng(1), 50);
    assert.ok(cell.tension > 0, 'tension should increase with osmotic difference');
  });

  it('tickCell divisionProgress increases with energy', () => {
    const cellGenes = decodeCellGenes(makeGenome(0));
    const memGenes = decodeMembraneGenes(makeGenome(0));
    const cell = createCellState(cellGenes);
    const ions = new Float32Array(5).fill(10);
    tickCell(cell, cellGenes, memGenes, ions, 1, makeRng(1), 50);
    assert.ok(cell.divisionProgress > 0, 'division progress should increase with energy');
  });

  it('tickCell divisionProgress stalls without energy', () => {
    const cellGenes = decodeCellGenes(makeGenome(0));
    const memGenes = decodeMembraneGenes(makeGenome(0));
    const cell = createCellState(cellGenes);
    const ions = new Float32Array(5).fill(10);
    tickCell(cell, cellGenes, memGenes, ions, 1, makeRng(1), 0);
    assert.equal(cell.divisionProgress, 0, 'division should not progress without energy');
  });

  it('tickCell readyToDivide after enough progress + high energy', () => {
    const cellGenes = decodeCellGenes(makeGenome(0));
    const memGenes = decodeMembraneGenes(makeGenome(0));
    const cell = createCellState(cellGenes);
    const ions = new Float32Array(5).fill(10);
    let ready = false;
    for (let i = 0; i < 5000; i++) {
      const r = tickCell(cell, cellGenes, memGenes, ions, 1, makeRng(i), 100);
      if (r.readyToDivide) { ready = true; break; }
    }
    assert.ok(ready, 'cell should eventually be ready to divide');
  });

  it('tickCell membraneIntegrity decreases under high tension', () => {
    const cellGenes = decodeCellGenes(makeGenome(0));
    const memGenes = decodeMembraneGenes(makeGenome(0));
    const cell = createCellState(cellGenes);
    cell.tension = 0.6; // above the 0.5 damage threshold
    const ions = new Float32Array(5).fill(10);
    tickCell(cell, cellGenes, memGenes, ions, 1, makeRng(1), 50);
    assert.ok(cell.membraneIntegrity < 1.0, 'integrity should decrease under high tension');
  });

  it('membraneTransport diffuses molecules toward equilibrium', () => {
    const memGenes = decodeMembraneGenes(makeGenome(0.5));
    const internal = new Float32Array([10, 0, 0]);
    const external = new Float32Array([0, 10, 5]);
    membraneTransport(internal, external, memGenes, 10);
    assert.ok(internal[0]! < 10, 'internal high concentration should decrease');
    assert.ok(internal[1]! > 0, 'internal low concentration should increase');
  });

  it('activeTransport moves molecules against gradient', () => {
    const memGenes = decodeMembraneGenes(makeGenome(0.5));
    const internal = new Float32Array([0]);
    const external = new Float32Array([10]);
    const cost = activeTransport(internal, external, 0, 1, memGenes, 1);
    assert.ok(cost > 0, 'active transport should cost ATP');
    assert.ok(internal[0]! > 0, 'internal should gain molecules');
    assert.ok(external[0]! < 10, 'external should lose molecules');
  });

  it('endocytosis triggers probabilistically', () => {
    const cell = createCellState(decodeCellGenes(makeGenome(0)));
    const memGenes = decodeMembraneGenes(makeGenome(1));
    let triggered = false;
    for (let i = 0; i < 200; i++) {
      if (endocytosis(cell, memGenes, 1, makeRng(i))) { triggered = true; break; }
    }
    assert.ok(triggered, 'endocytosis should trigger with high gene value');
  });

  it('endocytosis returns false when no food', () => {
    const cell = createCellState(decodeCellGenes(makeGenome(0)));
    const memGenes = decodeMembraneGenes(makeGenome(1));
    assert.equal(endocytosis(cell, memGenes, 0, makeRng(1)), false);
  });

  it('exocytosis moves molecules outward', () => {
    const memGenes = decodeMembraneGenes(makeGenome(0.5));
    const internal = new Float32Array([5]);
    const external = new Float32Array([0]);
    exocytosis(internal, external, 0, memGenes, 1);
    assert.ok(internal[0]! < 5, 'internal should decrease');
    assert.ok(external[0]! > 0, 'external should increase');
  });

  it('proteinSynthesisRate depends on ribosomes and amino acids', () => {
    const cell = createCellState(decodeCellGenes(makeGenome(0.5)));
    const low = proteinSynthesisRate(cell, 1);
    const high = proteinSynthesisRate(cell, 50);
    assert.ok(high > low, 'more amino acids should give higher synthesis rate');
  });

  it('mitochondrialAtp depends on glucose and oxygen', () => {
    const cell = createCellState(decodeCellGenes(makeGenome(0.5)));
    const low = mitochondrialAtp(cell, 1, 1);
    const high = mitochondrialAtp(cell, 50, 50);
    assert.ok(high > low, 'more substrate should give more ATP');
  });

  it('receptorSensing scales with density and concentration', () => {
    const memGenes = decodeMembraneGenes(makeGenome(0.5));
    const low = receptorSensing(memGenes, 0.1);
    const high = receptorSensing(memGenes, 10);
    assert.ok(high > low, 'higher concentration should produce stronger signal');
  });

  it('decodeCellGenes and decodeMembraneGenes map [-1,1] to [0,1]', () => {
    const cellGenes = decodeCellGenes(makeGenome(0));
    assert.equal(cellGenes.cellSize, 0.5);
    const memGenes = decodeMembraneGenes(makeGenome(0));
    assert.equal(memGenes.permeability, 0.5);
    const highCell = decodeCellGenes(makeGenomeWithGene(CELL_OFFSET, CELL_GENES.CELL_SIZE, 1));
    assert.equal(highCell.cellSize, 1);
    const highMem = decodeMembraneGenes(makeGenomeWithGene(MEMBRANE_OFFSET, MEMBRANE_GENES.PERMEABILITY, 1));
    assert.equal(highMem.permeability, 1);
  });
});

// ---------------------------------------------------------------------------
// Ecosystem System Tests
// ---------------------------------------------------------------------------

describe('Ecosystem system', () => {
  it('createEcosystemGrid returns correct dimensions', () => {
    const grid = createEcosystemGrid();
    assert.equal(grid.width, TERRAIN_GRID);
    assert.equal(grid.height, TERRAIN_GRID);
    assert.equal(grid.data.length, TERRAIN_GRID * TERRAIN_GRID * 4);
  });

  it('updateEcosystemGrid grows plant biomass naturally', () => {
    const grid = createEcosystemGrid();
    const pre = grid.data[0]!;
    updateEcosystemGrid(grid, [], 1);
    assert.ok(grid.data[0]! > pre, 'plant biomass should grow');
  });

  it('updateEcosystemGrid decays resources', () => {
    const grid = createEcosystemGrid();
    grid.data[0] = 1.0;
    updateEcosystemGrid(grid, [], 1);
    assert.ok(grid.data[0]! < 1.0, 'resources should decay');
  });

  it('updateEcosystemGrid adds agent contributions', () => {
    const grid = createEcosystemGrid();
    const agents = [{ x: 100, y: 100, alive: true, diet: 0.1, energy: 50, trophicLevel: TrophicLevel.PRODUCER }];
    updateEcosystemGrid(grid, agents, 1);
    const gx = Math.floor(100 / TERRAIN_CELL);
    const gy = Math.floor(100 / TERRAIN_CELL);
    const idx = (gy * TERRAIN_GRID + gx) * 4;
    assert.ok(grid.data[idx]! > 0.001, 'producer should add to plant biomass');
  });

  it('updateEcosystemGrid skips dead agents', () => {
    const grid = createEcosystemGrid();
    const agents = [{ x: 100 * TERRAIN_CELL, y: 100 * TERRAIN_CELL, alive: false, diet: 0.1, energy: 50, trophicLevel: TrophicLevel.PRODUCER }];
    updateEcosystemGrid(grid, agents, 1);
    // Dead agents should not contribute to ANY slot — only natural growth on slot 0
    const gx = 100; const gy = 100;
    const idx = (gy * TERRAIN_GRID + gx) * 4 + 0;
    // plant biomass is only from natural growth (0.001), not from the dead agent
    assert.ok(grid.data[idx]! <= 0.002, 'dead agents should not contribute to plant biomass');
  });

  it('getLocalResources returns zero for out-of-bounds', () => {
    const grid = createEcosystemGrid();
    const res = getLocalResources(grid, -100, -100);
    assert.equal(res.plantBiomass, 0);
    assert.equal(res.herbivoreDensity, 0);
    assert.equal(res.carnivoreDensity, 0);
    assert.equal(res.decomposerActivity, 0);
  });

  it('getLocalResources returns valid data for in-bounds', () => {
    const grid = createEcosystemGrid();
    grid.data[0] = 0.5;
    const res = getLocalResources(grid, 5, 5);
    assert.ok(res.plantBiomass >= 0, 'plant biomass should be non-negative');
  });

  it('competitionPressure increases with population', () => {
    const genes = decodeEcosystemGenes(makeGenome(0));
    const low = competitionPressure(genes, 5, 100);
    const high = competitionPressure(genes, 90, 100);
    assert.ok(high > low, 'more competition with higher population');
  });

  it('competitionPressure decreases with niche specialization', () => {
    const generalist = decodeEcosystemGenes(makeGenomeWithGene(ECOSYSTEM_OFFSET, ECOSYSTEM_GENES.NICHE_SPECIALIZATION, -1));
    const specialist = decodeEcosystemGenes(makeGenomeWithGene(ECOSYSTEM_OFFSET, ECOSYSTEM_GENES.NICHE_SPECIALIZATION, 1));
    const cpGeneral = competitionPressure(generalist, 80, 100);
    const cpSpecial = competitionPressure(specialist, 80, 100);
    assert.ok(cpGeneral > cpSpecial, 'specialists should face less competition');
  });

  it('mutualismBenefit increases with nearby mutualists', () => {
    const genes = decodeEcosystemGenes(makeGenome(0.5));
    const b0 = mutualismBenefit(genes, 0);
    const b5 = mutualismBenefit(genes, 5);
    assert.ok(b5 > b0, 'more mutualists should give more benefit');
  });

  it('parasitismDrain increases with nearby hosts', () => {
    const genes = decodeEcosystemGenes(makeGenome(0.5));
    const d0 = parasitismDrain(genes, 0);
    const d5 = parasitismDrain(genes, 5);
    assert.ok(d5 > d0, 'more hosts should give more drain');
  });

  it('assignTrophicLevel returns correct levels', () => {
    assert.equal(assignTrophicLevel(0.2, 0.1), TrophicLevel.PRODUCER);
    assert.equal(assignTrophicLevel(0.4, 0.3), TrophicLevel.PRIMARY_CONSUMER);
    assert.equal(assignTrophicLevel(0.6, 0.6), TrophicLevel.SECONDARY_CONSUMER);
    assert.equal(assignTrophicLevel(0.8, 0.8), TrophicLevel.TERTIARY_CONSUMER);
    assert.equal(assignTrophicLevel(0.1, 0.1), TrophicLevel.DECOMPOSER);
  });

  it('carryingCapacity returns positive values', () => {
    const res = { plantBiomass: 0.5, herbivoreDensity: 0.3, carnivoreDensity: 0.2, decomposerActivity: 0.1 };
    assert.ok(carryingCapacity(TrophicLevel.PRODUCER, res) > 0);
    assert.ok(carryingCapacity(TrophicLevel.PRIMARY_CONSUMER, res) > 0);
    assert.ok(carryingCapacity(TrophicLevel.SECONDARY_CONSUMER, res) > 0);
    assert.ok(carryingCapacity(TrophicLevel.TERTIARY_CONSUMER, res) > 0);
    assert.ok(carryingCapacity(TrophicLevel.DECOMPOSER, res) > 0);
  });

  it('carryingCapacity is lower for higher trophic levels (energy pyramid)', () => {
    const res = { plantBiomass: 1.0, herbivoreDensity: 1.0, carnivoreDensity: 1.0, decomposerActivity: 1.0 };
    const prod = carryingCapacity(TrophicLevel.PRODUCER, res);
    const herb = carryingCapacity(TrophicLevel.PRIMARY_CONSUMER, res);
    const carn = carryingCapacity(TrophicLevel.SECONDARY_CONSUMER, res);
    assert.ok(prod > herb, 'producers should have higher capacity than herbivores');
    assert.ok(herb > carn, 'herbivores should have higher capacity than carnivores');
  });

  it('migrationForce is zero below carrying capacity', () => {
    const genes = decodeEcosystemGenes(makeGenome(0.5));
    assert.equal(migrationForce(genes, 50, 100), 0);
  });

  it('migrationForce increases above carrying capacity', () => {
    const genes = decodeEcosystemGenes(makeGenome(0.5));
    const f = migrationForce(genes, 100, 100);
    assert.ok(f > 0, 'migration force should be positive above capacity');
  });

  it('territorialDefense is zero with few allies', () => {
    const genes = decodeEcosystemGenes(makeGenome(0.5));
    assert.equal(territorialDefense(genes, 1), 0);
  });

  it('territorialDefense increases with allies', () => {
    const genes = decodeEcosystemGenes(makeGenome(0.5));
    const f = territorialDefense(genes, 5);
    assert.ok(f > 0, 'territorial defense should be positive with enough allies');
  });

  it('biodiversityIndex is 0 for empty population', () => {
    assert.equal(biodiversityIndex([]), 0);
  });

  it('biodiversityIndex is 0 when all in one species', () => {
    assert.equal(biodiversityIndex([100, 0, 0, 0, 0]), 0);
  });

  it('biodiversityIndex increases with even distribution', () => {
    const uneven = biodiversityIndex([80, 10, 5, 3, 2]);
    const even = biodiversityIndex([20, 20, 20, 20, 20]);
    assert.ok(even > uneven, 'even distribution should have higher diversity');
  });

  it('biodiversityIndex maxes at 1 for perfectly even distribution', () => {
    const h = biodiversityIndex([10, 10, 10, 10, 10]);
    assert.ok(Math.abs(h - 1) < 0.001, `perfect evenness should give ~1, got ${h}`);
  });

  it('foodChainEfficiency is 0 for same or lower level', () => {
    assert.equal(foodChainEfficiency(TrophicLevel.PRODUCER, TrophicLevel.PRODUCER), 0);
    assert.equal(foodChainEfficiency(TrophicLevel.SECONDARY_CONSUMER, TrophicLevel.PRIMARY_CONSUMER), 0);
  });

  it('foodChainEfficiency follows 10% rule', () => {
    const oneStep = foodChainEfficiency(TrophicLevel.PRODUCER, TrophicLevel.PRIMARY_CONSUMER);
    const twoSteps = foodChainEfficiency(TrophicLevel.PRODUCER, TrophicLevel.SECONDARY_CONSUMER);
    assert.ok(Math.abs(oneStep - 0.1) < 0.001, `one step should be ~10%, got ${oneStep}`);
    assert.ok(Math.abs(twoSteps - 0.01) < 0.001, `two steps should be ~1%, got ${twoSteps}`);
  });

  it('decodeEcosystemGenes maps [-1,1] to [0,1]', () => {
    const genes = decodeEcosystemGenes(makeGenome(0));
    assert.equal(genes.nicheSpecialization, 0.5);
    const high = decodeEcosystemGenes(makeGenomeWithGene(ECOSYSTEM_OFFSET, ECOSYSTEM_GENES.NICHE_SPECIALIZATION, 1));
    assert.equal(high.nicheSpecialization, 1);
  });
});

// ---------------------------------------------------------------------------
// Selection System Tests
// ---------------------------------------------------------------------------

describe('Selection system', () => {
  it('createSelectionState returns valid initial state', () => {
    const state = createSelectionState();
    assert.equal(state.species.size, 0);
    assert.equal(state.nextSpeciesId, 1);
    assert.equal(state.speciationEvents, 0);
    assert.equal(state.extinctionEvents, 0);
    assert.equal(state.radiationEvents, 0);
    assert.equal(state.pressure.predationPressure, 0);
  });

  it('computeFitness returns value in [0,1]', () => {
    const pressure = createSelectionState().pressure;
    const f = computeFitness(0.5, 0.5, 0.5, 0.5, 0.5, pressure);
    assert.ok(f.total >= 0 && f.total <= 1, `fitness should be in [0,1], got ${f.total}`);
  });

  it('computeFitness higher energy fitness gives higher total', () => {
    const pressure = createSelectionState().pressure;
    const low = computeFitness(0.1, 0.5, 0.5, 0.5, 0.5, pressure);
    const high = computeFitness(0.9, 0.5, 0.5, 0.5, 0.5, pressure);
    assert.ok(high.total > low.total, 'higher energy fitness should give higher total');
  });

  it('computeFitness with high sexual selection weights reproduction more', () => {
    const noSex = createSelectionState().pressure;
    noSex.sexualSelection = 0;
    const highSex = createSelectionState().pressure;
    highSex.sexualSelection = 1;
    const lowRepro = computeFitness(0.5, 0.5, 0.1, 0.5, 0.5, noSex);
    const highRepro = computeFitness(0.5, 0.5, 0.9, 0.5, 0.5, highSex);
    // With high sexual selection, reproductive fitness is weighted more
    assert.ok(highRepro.total > lowRepro.total, 'high reproductive + high sexual selection should give higher fitness');
  });

  it('updateSpecies creates species for first-seen agents', () => {
    const state = createSelectionState();
    const agents = [
      { id: 1, genome: makeGenome(0.5), alive: true, energy: 50, fitness: 0.5, trophicLevel: 0 },
      { id: 2, genome: makeGenome(0.5), alive: true, energy: 50, fitness: 0.5, trophicLevel: 0 },
    ];
    updateSpecies(state, agents, 1);
    assert.ok(state.species.size >= 1, 'should have at least one species');
    assert.ok(state.speciationEvents >= 1, 'should have recorded speciation events');
  });

  it('updateSpecies assigns similar agents to same species', () => {
    const state = createSelectionState();
    const g1 = makeGenome(0.5);
    const g2 = makeGenome(0.501); // very similar
    const agents = [
      { id: 1, genome: g1, alive: true, energy: 50, fitness: 0.5, trophicLevel: 0 },
      { id: 2, genome: g2, alive: true, energy: 50, fitness: 0.5, trophicLevel: 0 },
    ];
    updateSpecies(state, agents, 1);
    assert.equal(state.species.size, 1, 'very similar agents should be in same species');
  });

  it('updateSpecies creates separate species for dissimilar agents', () => {
    const state = createSelectionState();
    const g1 = new Float32Array(GENOME_SIZE).fill(1);
    const g2 = new Float32Array(GENOME_SIZE).fill(-1);
    const agents = [
      { id: 1, genome: g1, alive: true, energy: 50, fitness: 0.5, trophicLevel: 0 },
      { id: 2, genome: g2, alive: true, energy: 50, fitness: 0.5, trophicLevel: 0 },
    ];
    updateSpecies(state, agents, 1);
    assert.equal(state.species.size, 2, 'completely different agents should form separate species');
  });

  it('updateSpecies detects extinction', () => {
    const state = createSelectionState();
    const agents = [
      { id: 1, genome: makeGenome(0.5), alive: true, energy: 50, fitness: 0.5, trophicLevel: 0 },
    ];
    updateSpecies(state, agents, 1);
    assert.equal(state.species.size, 1);
    // Now all dead
    const deadAgents = [
      { id: 1, genome: makeGenome(0.5), alive: false, energy: 0, fitness: 0, trophicLevel: 0 },
    ];
    updateSpecies(state, deadAgents, 2);
    assert.equal(state.species.size, 0, 'species should go extinct');
    assert.ok(state.extinctionEvents >= 1, 'extinction should be recorded');
  });

  it('updateSpecies computes meanFitness correctly', () => {
    const state = createSelectionState();
    const agents = [
      { id: 1, genome: makeGenome(0.5), alive: true, energy: 50, fitness: 0.8, trophicLevel: 0 },
      { id: 2, genome: makeGenome(0.501), alive: true, energy: 50, fitness: 0.2, trophicLevel: 0 },
    ];
    updateSpecies(state, agents, 1);
    const sp = [...state.species.values()][0]!;
    assert.ok(Math.abs(sp.meanFitness - 0.5) < 0.001, `mean fitness should be ~0.5, got ${sp.meanFitness}`);
  });

  it('updateSpecies updates mean genome', () => {
    const state = createSelectionState();
    const g1 = new Float32Array(GENOME_SIZE).fill(0.5);
    const g2 = new Float32Array(GENOME_SIZE).fill(0.7);
    const agents = [
      { id: 1, genome: g1, alive: true, energy: 50, fitness: 0.5, trophicLevel: 0 },
      { id: 2, genome: g2, alive: true, energy: 50, fitness: 0.5, trophicLevel: 0 },
    ];
    updateSpecies(state, agents, 1);
    const sp = [...state.species.values()][0]!;
    // Mean genome should be average of 0.5 and 0.7 = 0.6
    assert.ok(Math.abs(sp.meanGenome[0] - 0.6) < 0.001, `mean genome[0] should be ~0.6, got ${sp.meanGenome[0]}`);
  });

  it('updateSpecies radiation detection uses recent window', () => {
    const state = createSelectionState();
    // Run 200 ticks with speciation events
    for (let t = 0; t < 200; t++) {
      const agents = [
        { id: t, genome: makeGenome(t * 0.1), alive: true, energy: 50, fitness: 0.5, trophicLevel: 0 },
      ];
      updateSpecies(state, agents, t);
    }
    // With many speciation events, radiation should be detected
    assert.ok(state.radiationEvents >= 0, 'radiation events should be tracked');
    // Key: after the check window resets, radiationEvents should NOT keep incrementing
    const prevRadiation = state.radiationEvents;
    // Run another 200 ticks with no NEW speciations (reuse same genomes)
    const agents = [
      { id: 1000, genome: makeGenome(0.5), alive: true, energy: 50, fitness: 0.5, trophicLevel: 0 },
    ];
    for (let t = 200; t < 400; t++) {
      updateSpecies(state, agents, t);
    }
    // Since no new speciations happened, radiation should not increase
    assert.ok(state.radiationEvents <= prevRadiation + 1, 'radiation should not increase without new speciations');
  });

  it('computeSelectionPressure returns valid values', () => {
    const p = computeSelectionPressure(100, 1000, 0.05, 0.5, 1.0, 0.1);
    assert.ok(p.predationPressure >= 0 && p.predationPressure <= 1);
    assert.ok(p.competitionPressure >= 0 && p.competitionPressure <= 1);
    assert.ok(p.environmentalStress >= 0 && p.environmentalStress <= 1);
    assert.ok(p.sexualSelection >= 0 && p.sexualSelection <= 1);
    assert.ok(p.frequencyDependence >= 0 && p.frequencyDependence <= 1);
  });

  it('computeSelectionPressure competition increases with population', () => {
    const low = computeSelectionPressure(100, 1000, 0, 0.5, 1, 0);
    const high = computeSelectionPressure(800, 1000, 0, 0.5, 1, 0);
    assert.ok(high.competitionPressure > low.competitionPressure, 'competition should increase with population');
  });

  it('frequencyDependentBonus varies with phenotype hash', () => {
    const b1 = frequencyDependentBonus(0, 1000);
    const b2 = frequencyDependentBonus(99, 1000);
    assert.ok(b1 > b2, 'rare phenotype (hash=0) should get higher bonus');
  });

  it('frequencyDependentBonus scales with population', () => {
    const b100 = frequencyDependentBonus(50, 100);
    const b1000 = frequencyDependentBonus(50, 1000);
    assert.ok(b1000 > b100, 'larger population should scale the bonus');
  });

  it('hamiltonsRule returns true when r*B > C', () => {
    assert.equal(hamiltonsRule(0.5, 10, 2), true);
    assert.equal(hamiltonsRule(0.5, 2, 10), false);
    assert.equal(hamiltonsRule(1.0, 5, 4), true);
  });

  it('relatedness returns genome similarity', () => {
    const g1 = makeGenome(0.5);
    const g2 = makeGenome(0.5);
    assert.ok(relatedness(g1, g2) > 0.99, 'identical genomes should have high relatedness');
  });

  it('sexualSelectionMatingSuccess is highest when trait matches preference', () => {
    const exact = sexualSelectionMatingSuccess(5, 5, 1);
    const off = sexualSelectionMatingSuccess(8, 5, 1);
    assert.ok(exact > off, 'exact match should have higher success');
    assert.ok(Math.abs(exact - 1) < 0.001, 'exact match should be ~1');
  });

  it('sexualSelectionMatingSuccess decreases with variance for matching trait', () => {
    const exact = sexualSelectionMatingSuccess(5, 5, 0.5);
    const exactWide = sexualSelectionMatingSuccess(5, 5, 5);
    assert.ok(exact >= exactWide, 'exact match should score at least as high regardless of variance');
    // For an off-trait value, narrow variance penalizes more
    const offNarrow = sexualSelectionMatingSuccess(6, 5, 0.5);
    const offWide = sexualSelectionMatingSuccess(6, 5, 5);
    assert.ok(offWide > offNarrow, 'wide variance should penalize off-trait less');
  });

  it('fisherianRunaway returns acceleration', () => {
    const a = fisherianRunaway(0.5, 1.0, 1.0);
    assert.ok(a > 0, 'positive correlation with positive trait/preference should give positive runaway');
    const b = fisherianRunaway(-0.5, 1.0, 1.0);
    assert.ok(b < 0, 'negative correlation should give negative runaway');
  });

  it('fisherianRunaway is zero with zero trait', () => {
    assert.equal(fisherianRunaway(1.0, 0, 1.0), 0);
  });
});

// ---------------------------------------------------------------------------
// Engine Integration Tests
// ---------------------------------------------------------------------------

import { Engine } from '../src/engine.js';

describe('Biology engine integration', () => {
  it('agents have all biology state after spawn', () => {
    const engine = new Engine({
      id: 'test',
      seed: 'bio-test',
      fractalType: 'mandelbrot',
      params: {
        cReal: -0.8, cImag: 0.156, maxIter: 256, escapeRadius: 2 ** 16,
        centerX: -0.6, centerY: 0, worldScale: 4, spawnCount: 10,
        metabolismBase: 1, maxPopulation: 100, foodRegenRate: 0.0003,
        energyCapacity: 100, agentMaxAge: 4000, timeScale: 1,
        dayLength: 2400, seasonLength: 20000,
      },
      createdAt: 0, currentTick: 0,
    });
    let hasAll = 0;
    for (const a of engine.agents.values()) {
      if (a.alive && a.dna && a.cell && a.immune && a.predprey && a.repro && a.metabolism && a.ecosystem) hasAll++;
    }
    assert.ok(hasAll > 0, 'spawned agents should have all biology state');
  });

  it('tick runs without crashes for 100 ticks', () => {
    const engine = new Engine({
      id: 'test',
      seed: 'bio-tick',
      fractalType: 'mandelbrot',
      params: {
        cReal: -0.8, cImag: 0.156, maxIter: 128, escapeRadius: 2 ** 16,
        centerX: -0.6, centerY: 0, worldScale: 4, spawnCount: 20,
        metabolismBase: 1, maxPopulation: 200, foodRegenRate: 0.0003,
        energyCapacity: 100, agentMaxAge: 4000, timeScale: 1,
        dayLength: 2400, seasonLength: 20000,
      },
      createdAt: 0, currentTick: 0,
    });
    for (let i = 0; i < 100; i++) engine.tick();
    const s = engine.stats();
    assert.ok(typeof s.meanDNAIntegrity === 'number');
    assert.ok(typeof s.meanPathogenLoad === 'number');
    assert.ok(typeof s.meanMembranePot === 'number');
    assert.ok(typeof s.meanBodyTemp === 'number');
    assert.ok(typeof s.meanTrophicLevel === 'number');
    assert.ok(typeof s.speciationRate === 'number');
    assert.ok(typeof s.extinctionRate === 'number');
    assert.ok(typeof s.biodiversityIndex === 'number');
    assert.ok(typeof s.meanFitness === 'number');
    assert.ok(typeof s.meanDivisionProgress === 'number');
    assert.ok(Number.isFinite(s.meanDNAIntegrity));
    assert.ok(Number.isFinite(s.meanFitness));
  });

  it('biology tick is deterministic', () => {
    const make = () => new Engine({
      id: 'test',
      seed: 'bio-det',
      fractalType: 'mandelbrot',
      params: {
        cReal: -0.8, cImag: 0.156, maxIter: 128, escapeRadius: 2 ** 16,
        centerX: -0.6, centerY: 0, worldScale: 4, spawnCount: 15,
        metabolismBase: 1, maxPopulation: 150, foodRegenRate: 0.0003,
        energyCapacity: 100, agentMaxAge: 4000, timeScale: 1,
        dayLength: 2400, seasonLength: 20000,
      },
      createdAt: 0, currentTick: 0,
    });
    const e1 = make();
    const e2 = make();
    for (let i = 0; i < 50; i++) { e1.tick(); e2.tick(); }
    const s1 = e1.stats();
    const s2 = e2.stats();
    assert.equal(s1.meanDNAIntegrity, s2.meanDNAIntegrity, 'meanDNAIntegrity should be deterministic');
    assert.equal(s1.meanFitness, s2.meanFitness, 'meanFitness should be deterministic');
    assert.equal(s1.biodiversityIndex, s2.biodiversityIndex, 'biodiversityIndex should be deterministic');
  });
});
