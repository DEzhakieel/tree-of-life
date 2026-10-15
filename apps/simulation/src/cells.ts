import {
  CELL_OFFSET,
  CELL_GENES,
  MEMBRANE_OFFSET,
  MEMBRANE_GENES,
  MEMBRANE_TRANSPORT_COST,
  CELL_DIVISION_THRESHOLD,
  ION_COUNT,
  MOLECULE_COUNT,
} from '@fractal-life/shared';
import type { SplitMix64 } from './rng.js';
import type { CellBioState } from './cellbio.js';

/**
 * Cellular structure: models the physical cell, its membrane, organelles,
 * and transport mechanics. Each agent is a single cell with internal
 * compartments that affect metabolism, transport, and division.
 */
export interface CellState {
  /** Current cell radius (affects collision, intake area) */
  radius: number;
  /** Membrane potential in mV (Na+/K+ balance) */
  membranePotential: number;
  /** Membrane integrity in [0,1] */
  membraneIntegrity: number;
  /** Mitochondria efficiency multiplier */
  mitoEfficiency: number;
  /** Ribosome count (protein synthesis rate) */
  ribosomes: number;
  /** Cytoskeleton rigidity (affects movement, shape) */
  cytoskeleton: number;
  /** Vesicle transport buffer: molecules being moved internally */
  vesicleBuffer: Float32Array;
  /** Accumulated membrane tension (high = risk of lysis) */
  tension: number;
  /** Cell cycle phase: 0=G1, 1=S, 2=G2, 3=M (division) */
  cellCycle: number;
  /** Progress toward division in [0,1] */
  divisionProgress: number;
  /** Number of divisions this lineage has undergone */
  divisionCount: number;
  /** Whether cell is currently dividing (immobile) */
  isDividing: boolean;
  /** Time remaining in division */
  divisionTimer: number;
  /** Optional cell-biochemistry state (only when WorldConfig.cellBio is on). */
  bio?: CellBioState;
}

/**
 * Decode cellular structure genes from genome.
 */
export interface CellGenes {
  cellSize: number;
  membraneThickness: number;
  ribosomeCount: number;
  mitochondriaCount: number;
  nucleusSize: number;
  cytoskeleton: number;
  vesicleTraffic: number;
  cellAdhesion: number;
}

/**
 * Decode membrane genes from genome.
 */
export interface MembraneGenes {
  permeability: number;
  activeTransport: number;
  endocytosis: number;
  exocytosis: number;
  receptorDensity: number;
  channelDensity: number;
  pumpDensity: number;
  lipidComposition: number;
}

const w01 = (v: number) => (v + 1) / 2;

export function decodeCellGenes(genome: Float32Array): CellGenes {
  const o = CELL_OFFSET;
  return {
    cellSize: w01(genome[o + CELL_GENES.CELL_SIZE]!),
    membraneThickness: w01(genome[o + CELL_GENES.MEMBRANE_THICKNESS]!),
    ribosomeCount: w01(genome[o + CELL_GENES.RIBOSOME_COUNT]!),
    mitochondriaCount: w01(genome[o + CELL_GENES.MITOCHONDRIA_COUNT]!),
    nucleusSize: w01(genome[o + CELL_GENES.NUCLEUS_SIZE]!),
    cytoskeleton: w01(genome[o + CELL_GENES.CYTOSKELETON]!),
    vesicleTraffic: w01(genome[o + CELL_GENES.VESICLE_TRAFFIC]!),
    cellAdhesion: w01(genome[o + CELL_GENES.CELL_ADHESION]!),
  };
}

export function decodeMembraneGenes(genome: Float32Array): MembraneGenes {
  const o = MEMBRANE_OFFSET;
  return {
    permeability: w01(genome[o + MEMBRANE_GENES.PERMEABILITY]!),
    activeTransport: w01(genome[o + MEMBRANE_GENES.ACTIVE_TRANSPORT]!),
    endocytosis: w01(genome[o + MEMBRANE_GENES.ENDOCYTOSIS]!),
    exocytosis: w01(genome[o + MEMBRANE_GENES.EXOCYTOSIS]!),
    receptorDensity: w01(genome[o + MEMBRANE_GENES.RECEPTOR_DENSITY]!),
    channelDensity: w01(genome[o + MEMBRANE_GENES.CHANNEL_DENSITY]!),
    pumpDensity: w01(genome[o + MEMBRANE_GENES.PUMP_DENSITY]!),
    lipidComposition: w01(genome[o + MEMBRANE_GENES.LIPID_COMPOSITION]!),
  };
}

export function createCellState(cellGenes: CellGenes): CellState {
  return {
    radius: 3 + cellGenes.cellSize * 5,
    membranePotential: -70, // resting potential in mV
    membraneIntegrity: 1.0,
    mitoEfficiency: cellGenes.mitochondriaCount,
    ribosomes: cellGenes.ribosomeCount,
    cytoskeleton: cellGenes.cytoskeleton,
    vesicleBuffer: new Float32Array(MOLECULE_COUNT),
    tension: 0,
    cellCycle: 0,
    divisionProgress: 0,
    divisionCount: 0,
    isDividing: false,
    divisionTimer: 0,
  };
}

/**
 * Tick the cell state for one simulation step.
 * Returns ATP cost and whether the cell is ready to divide.
 */
export function tickCell(
  cell: CellState,
  cellGenes: CellGenes,
  memGenes: MembraneGenes,
  ions: Float32Array,
  dt: number,
  rng: SplitMix64,
  energy: number,
): { atpCost: number; readyToDivide: boolean; membraneDamage: number } {
  let atpCost = 0;
  let membraneDamage = 0;

  // Membrane potential: Na+/K+ pump
  const naKRatio = ions[0]! > 0 ? ions[1]! / (ions[0]! + 0.001) : 1;
  const pumpCost = memGenes.pumpDensity * MEMBRANE_TRANSPORT_COST * dt;
  atpCost += pumpCost;
  cell.membranePotential = -70 + (naKRatio - 1) * 30;

  // Membrane tension from osmotic pressure
  const osmoticDiff = Math.abs(ions[0]! + ions[1]! - ions[4]!);
  cell.tension += osmoticDiff * 0.001 * dt;
  cell.tension *= 0.99; // slow relaxation

  // Membrane integrity: thick membranes resist damage but cost more
  const thicknessBonus = cellGenes.membraneThickness * 0.3;
  cell.membraneIntegrity = Math.max(0, Math.min(1,
    cell.membraneIntegrity - cell.tension * 0.01 * dt + thicknessBonus * 0.001 * dt
  ));

  // High tension causes membrane damage
  if (cell.tension > 0.5) {
    membraneDamage = cell.tension * 0.02 * dt;
    cell.membraneIntegrity = Math.max(0, cell.membraneIntegrity - membraneDamage);
  }

  // Vesicle transport: move molecules between compartments
  const transportRate = cellGenes.vesicleTraffic * 0.01 * dt;
  atpCost += transportRate * MEMBRANE_TRANSPORT_COST;

  // Cytoskeleton maintenance
  atpCost += cellGenes.cytoskeleton * 0.001 * dt;

  // Cell cycle progression (G1 → S → G2 → M)
  if (!cell.isDividing) {
    const cycleRate = cellGenes.cellSize * 0.0005 * dt; // larger cells divide slower
    cell.divisionProgress += cycleRate * energy * 0.1;

    if (cell.divisionProgress >= 1.0 && energy > CELL_DIVISION_THRESHOLD) {
      cell.isDividing = true;
      cell.divisionTimer = 60; // ~1 second at 60 ticks/sec
      cell.divisionProgress = 0;
    }
  } else {
    cell.divisionTimer -= dt;
    if (cell.divisionTimer <= 0) {
      cell.isDividing = false;
      cell.divisionCount += 1;
      cell.radius = 3 + cellGenes.cellSize * 5; // reset size
      return { atpCost, readyToDivide: true, membraneDamage };
    }
  }

  return { atpCost, readyToDivide: false, membraneDamage };
}

/**
 * Passive membrane transport: allow molecules to diffuse based on permeability.
 */
export function membraneTransport(
  internal: Float32Array,
  external: Float32Array,
  memGenes: MembraneGenes,
  dt: number,
): void {
  const rate = memGenes.permeability * 0.002 * dt;
  for (let i = 0; i < internal.length; i++) {
    const diff = external[i]! - internal[i]!;
    internal[i]! += diff * rate;
  }
}

/**
 * Active transport: move specific molecules against gradient, costs ATP.
 */
export function activeTransport(
  internal: Float32Array,
  external: Float32Array,
  moleculeIndex: number,
  direction: number, // +1 = in, -1 = out
  memGenes: MembraneGenes,
  dt: number,
): number {
  const rate = memGenes.activeTransport * 0.01 * dt * direction;
  const moved = Math.min(Math.abs(rate), Math.abs(external[moleculeIndex]!));
  internal[moleculeIndex]! += moved * direction;
  external[moleculeIndex]! -= moved * direction;
  return MEMBRANE_TRANSPORT_COST * dt;
}

/**
 * Endocytosis: engulf external particle. Higher chance with more endocytosis gene.
 * Returns true if an engulf event occurred.
 */
export function endocytosis(
  cell: CellState,
  memGenes: MembraneGenes,
  nearbyFood: number,
  rng: SplitMix64,
): boolean {
  if (nearbyFood <= 0) return false;
  const prob = memGenes.endocytosis * 0.02;
  return rng.nextFloat() < prob;
}

/**
 * Exocytosis: release molecules into the environment.
 */
export function exocytosis(
  internal: Float32Array,
  external: Float32Array,
  moleculeIndex: number,
  memGenes: MembraneGenes,
  dt: number,
): void {
  const rate = memGenes.exocytosis * 0.005 * dt;
  const amount = Math.min(rate, internal[moleculeIndex]!);
  internal[moleculeIndex]! -= amount;
  external[moleculeIndex] = external[moleculeIndex]! + amount;
}

/**
 * Compute effective protein synthesis rate based on ribosomes and available amino acids.
 */
export function proteinSynthesisRate(
  cell: CellState,
  aminoAcids: number,
): number {
  return cell.ribosomes * 0.01 * Math.min(1, aminoAcids * 0.1);
}

/**
 * Compute effective ATP production from mitochondria.
 */
export function mitochondrialAtp(
  cell: CellState,
  glucose: number,
  oxygen: number,
): number {
  const substrate = Math.min(glucose, oxygen);
  return cell.mitoEfficiency * 0.005 * substrate;
}

/**
 * Check if cell can sense external molecule via receptors.
 */
export function receptorSensing(
  memGenes: MembraneGenes,
  externalConcentration: number,
): number {
  return memGenes.receptorDensity * externalConcentration;
}
