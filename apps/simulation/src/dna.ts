import {
  GENOME_SIZE,
  DNA_OFFSET,
  DNA_GENES,
  DNA_BASE_ERROR_RATE,
  DNA_REPAIR_COST,
} from '@fractal-life/shared';
import type { SplitMix64 } from './rng.js';

/**
 * DNA system: models replication fidelity, damage repair, gene expression
 * regulation, and genome stability. Each agent carries a "genome integrity"
 * score that decays with replication errors and is restored by repair.
 */
export interface DnaSystem {
  /** Genome integrity in [0,1] — 1 = perfect, 0 = lethal mutagenesis */
  integrity: number;
  /** Accumulated DNA damage since last repair */
  damageAccum: number;
  /** Gene expression profile: activation level [0,1] per gene region */
  expression: Float32Array;
  /** Number of replication errors this agent has accumulated */
  totalErrors: number;
  /** Number of successful repairs */
  totalRepairs: number;
  /** Epigenetic marks: methylation state per gene block (0 = unmethylated, 1 = methylated) */
  epigenetic: Float32Array;
}

const EXPRESSION_BLOCKS = 24; // 192 genes / 8 genes per block
const EPIGENETIC_SIZE = 24;

export function createDnaSystem(): DnaSystem {
  return {
    integrity: 1.0,
    damageAccum: 0,
    expression: new Float32Array(EXPRESSION_BLOCKS).fill(0.5),
    totalErrors: 0,
    totalRepairs: 0,
    epigenetic: new Float32Array(EPIGENETIC_SIZE).fill(0),
  };
}

/**
 * Decode DNA genes from genome into readable parameters.
 */
export interface DnaGenes {
  replicationFidelity: number;
  repairRate: number;
  repairAccuracy: number;
  geneExpression: number;
  epigeneticNoise: number;
  horizontalTransfer: number;
  transposonRate: number;
  dnaStability: number;
}

const w01 = (v: number) => (v + 1) / 2; // [-1,1] -> [0,1]

export function decodeDnaGenes(genome: Float32Array): DnaGenes {
  const o = DNA_OFFSET;
  return {
    replicationFidelity: w01(genome[o + DNA_GENES.REPLICATION_FIDELITY]!),
    repairRate: w01(genome[o + DNA_GENES.REPAIR_RATE]!),
    repairAccuracy: w01(genome[o + DNA_GENES.REPAIR_ACCURACY]!),
    geneExpression: w01(genome[o + DNA_GENES.GENE_EXPRESSION]!),
    epigeneticNoise: w01(genome[o + DNA_GENES.EPIGENETIC_NOISE]!),
    horizontalTransfer: w01(genome[o + DNA_GENES.HORIZONTAL_TRANSFER]!),
    transposonRate: w01(genome[o + DNA_GENES.TRANSPOSON_RATE]!),
    dnaStability: w01(genome[o + DNA_GENES.DNA_STABILITY]!),
  };
}

/**
 * Tick the DNA system for one agent for one simulation tick.
 *
 * - Damage accumulates passively (environmental mutagens, oxidative stress)
 * - Repair consumes ATP and restores integrity
 * - Gene expression drifts based on epigenetic noise
 * - Transposon events cause small genome rearrangements
 */
export function tickDna(
  dna: DnaSystem,
  genes: DnaGenes,
  dt: number,
  rng: SplitMix64,
  availableAtp: number,
): { atpCost: number; mutationsOccurred: boolean; genomeModified: boolean } {
  let atpCost = 0;
  let mutationsOccurred = false;
  let genomeModified = false;
  let repairedThisTick = false;

  // Environmental damage accumulation (oxidative, UV, etc.)
  const damageRate = 0.001 * (1 - genes.dnaStability * 0.8);
  dna.damageAccum += damageRate * dt;

  // Integrity decay from accumulated damage
  if (dna.damageAccum > 0.1) {
    const decay = dna.damageAccum * 0.01 * dt;
    dna.integrity = Math.max(0, dna.integrity - decay);
    dna.damageAccum *= 0.95;
  }

  // Repair process: consumes ATP, restores integrity
  if (dna.damageAccum > 0.01 && availableAtp > DNA_REPAIR_COST) {
    const repairEfficiency = genes.repairRate * genes.repairAccuracy;
    const repaired = Math.min(dna.damageAccum, repairEfficiency * 0.1 * dt);
    dna.damageAccum -= repaired;
    dna.integrity = Math.min(1, dna.integrity + repaired * 0.5);
    atpCost += DNA_REPAIR_COST * dt;
    repairedThisTick = true;
  }

  // Gene expression drift from epigenetic noise
  const exprDrift = genes.epigeneticNoise * 0.01 * dt;
  for (let b = 0; b < EXPRESSION_BLOCKS; b++) {
    const base = genes.geneExpression;
    const noise = (rng.nextFloat() - 0.5) * 2 * exprDrift;
    dna.expression[b] = Math.max(0, Math.min(1, dna.expression[b] + noise + (base - 0.5) * 0.001 * dt));
  }

  // Epigenetic marks drift
  for (let b = 0; b < EPIGENETIC_SIZE; b++) {
    if (rng.nextFloat() < genes.epigeneticNoise * 0.005 * dt) {
      dna.epigenetic[b] = dna.epigenetic[b] > 0.5 ? 0 : 1;
    }
  }

  // Transposon events: small internal rearrangements
  if (rng.nextFloat() < genes.transposonRate * 0.0001 * dt) {
    genomeModified = true;
  }

  // Mutation tracking: lower integrity = more mutations
  const mutationProb = DNA_BASE_ERROR_RATE * (1 - genes.replicationFidelity * 0.9) * (1 - dna.integrity * 0.5);
  if (rng.nextFloat() < mutationProb * dt) {
    mutationsOccurred = true;
    dna.totalErrors += 1;
    dna.integrity = Math.max(0, dna.integrity - 0.005);
  }

  // Track discrete repair events (once per tick if any repair occurred)
  if (repairedThisTick) {
    dna.totalRepairs += 1;
  }

  return { atpCost, mutationsOccurred, genomeModified };
}

/**
 * Apply DNA-level mutations during reproduction.
 * Higher integrity = fewer errors; fidelity gene controls base rate.
 */
export function replicationFidelity(
  dna: DnaSystem,
  genes: DnaGenes,
  rng: SplitMix64,
): Float32Array | null {
  // Chance of a replication error block
  const errorRate = DNA_BASE_ERROR_RATE * (1 - genes.replicationFidelity) * (1 - dna.integrity * 0.3);
  if (rng.nextFloat() < errorRate) {
    // Return a small mutation vector to apply to the child genome
    const mutations = new Float32Array(GENOME_SIZE);
    const count = Math.floor(rng.nextFloat() * 5) + 1;
    for (let i = 0; i < count; i++) {
      const idx = Math.floor(rng.nextFloat() * GENOME_SIZE);
      mutations[idx] = (rng.nextFloat() - 0.5) * 0.1; // small perturbation
    }
    return mutations;
  }
  return null;
}

/**
 * Compute effective gene expression for a specific gene block,
 * modified by epigenetic marks and expression level.
 */
export function getEffectiveExpression(
  dna: DnaSystem,
  blockIndex: number,
): number {
  const base = dna.expression[blockIndex % EXPRESSION_BLOCKS] ?? 0.5;
  const mark = dna.epigenetic[blockIndex % EPIGENETIC_SIZE] ?? 0;
  // Methylated genes are silenced
  return mark > 0.5 ? base * 0.1 : base;
}

/**
 * Horizontal gene transfer: accept a block of genes from a donor genome.
 * Probability based on the HGT gene and compatibility.
 */
export function horizontalGeneTransfer(
  recipient: Float32Array,
  donor: Float32Array,
  hgtGene: number,
  rng: SplitMix64,
): boolean {
  if (rng.nextFloat() > hgtGene * 0.001) return false;
  // Transfer a random block of 4-16 genes
  const blockSize = 4 + Math.floor(rng.nextFloat() * 13);
  const start = Math.floor(rng.nextFloat() * (GENOME_SIZE - blockSize));
  for (let i = 0; i < blockSize; i++) {
    recipient[start + i] = donor[start + i]!;
  }
  return true;
}
