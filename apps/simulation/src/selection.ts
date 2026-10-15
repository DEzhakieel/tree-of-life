import {
  SPECIATION_THRESHOLD,
  WORLD_SIZE,
} from '@fractal-life/shared';
import type { SplitMix64 } from './rng.js';
import { genomeSimilarity, isSameSpecies } from './genome.js';

/**
 * Fitness component breakdown for tracking selection pressures.
 */
export interface FitnessComponents {
  /** Energy acquisition rate (food + hunting) */
  energyFitness: number;
  /** Survival fitness (avoiding death from predation, starvation, age) */
  survivalFitness: number;
  /** Reproductive fitness (number of surviving offspring) */
  reproductiveFitness: number;
  /** Social fitness (benefit from cooperation, mutualism) */
  socialFitness: number;
  /** Metabolic efficiency (energy gained vs spent) */
  metabolicFitness: number;
  /** Composite fitness score */
  total: number;
}

/**
 * Per-species tracking for adaptive radiation.
 */
export interface SpeciesRecord {
  /** Species identifier (assigned at speciation event) */
  id: number;
  /** Mean genome of all living members */
  meanGenome: Float32Array;
  /** Number of living members */
  population: number;
  /** Peak population ever reached */
  peakPopulation: number;
  /** Tick when species first appeared */
  originTick: number;
  /** Mean fitness of living members */
  meanFitness: number;
  /** Genetic diversity within species (mean pairwise distance) */
  geneticDiversity: number;
  /** Dominant trophic level */
  dominantTrophicLevel: number;
  /** Whether species is declining */
  isDeclining: boolean;
}

/**
 * Selection pressure snapshot: what environmental factors are driving selection.
 */
export interface SelectionPressure {
  /** Predation pressure (how much predation shapes the population) */
  predationPressure: number;
  /** Competition pressure (resource scarcity) */
  competitionPressure: number;
  /** Environmental stress (temperature, terrain, etc.) */
  environmentalStress: number;
  /** Sexual selection pressure */
  sexualSelection: number;
  /** Frequency-dependent selection (rare phenotype advantage) */
  frequencyDependence: number;
}

/**
 * Ecosystem-level selection state.
 */
export interface SelectionState {
  /** All tracked species */
  species: Map<number, SpeciesRecord>;
  /** Next species ID */
  nextSpeciesId: number;
  /** Selection pressures active this tick */
  pressure: SelectionPressure;
  /** Total speciation events */
  speciationEvents: number;
  /** Total extinction events */
  extinctionEvents: number;
  /** Adaptive radiation events (multiple speciations in short time) */
  radiationEvents: number;
  /** Speciation event count at last radiation check */
  lastRadiationCheck: number;
  /** Tick of last radiation check */
  lastRadiationTick: number;
}

export function createSelectionState(): SelectionState {
  return {
    species: new Map(),
    nextSpeciesId: 1,
    pressure: {
      predationPressure: 0,
      competitionPressure: 0,
      environmentalStress: 0,
      sexualSelection: 0,
      frequencyDependence: 0,
    },
    speciationEvents: 0,
    extinctionEvents: 0,
    radiationEvents: 0,
    lastRadiationCheck: 0,
    lastRadiationTick: 0,
  };
}

/**
 * Compute composite fitness from components, weighted by environment.
 */
export function computeFitness(
  energyFitness: number,
  survivalFitness: number,
  reproductiveFitness: number,
  socialFitness: number,
  metabolicFitness: number,
  pressure: SelectionPressure,
): FitnessComponents {
  // Weight selection pressures
  const energyWeight = 1 - pressure.sexualSelection * 0.3;
  const reproductiveWeight = 0.3 + pressure.sexualSelection * 0.4;
  const socialWeight = 0.1 + pressure.competitionPressure * 0.2;

  const total =
    energyFitness * energyWeight * 0.3 +
    survivalFitness * 0.25 +
    reproductiveFitness * reproductiveWeight * 0.25 +
    socialFitness * socialWeight * 0.1 +
    metabolicFitness * 0.1;

  return {
    energyFitness,
    survivalFitness,
    reproductiveFitness,
    socialFitness,
    metabolicFitness,
    total: Math.max(0, Math.min(1, total)),
  };
}

/**
 * Update species tracking: assign agents to species, detect speciation/extinction.
 */
export function updateSpecies(
  state: SelectionState,
  agents: Array<{
    id: number;
    genome: Float32Array;
    alive: boolean;
    energy: number;
    fitness: number;
    trophicLevel: number;
  }>,
  currentTick: number,
): void {
  // Track per-species genome sums for mean genome update
  const genomeSums = new Map<number, Float32Array>();

  // Reset populations
  for (const sp of state.species.values()) {
    sp.population = 0;
    sp.meanFitness = 0;
    genomeSums.set(sp.id, new Float32Array(sp.meanGenome.length));
  }

  // Assign living agents to species
  const living = agents.filter(a => a.alive);
  const assigned = new Set<number>();

  for (const agent of living) {
    let bestSpecies = -1;
    let bestSimilarity = 0;

    for (const [spId, sp] of state.species) {
      if (!isSameSpecies(agent.genome, sp.meanGenome)) continue;
      const sim = genomeSimilarity(agent.genome, sp.meanGenome);
      if (sim > bestSimilarity) {
        bestSimilarity = sim;
        bestSpecies = spId;
      }
    }

    if (bestSpecies >= 0) {
      const sp = state.species.get(bestSpecies)!;
      sp.population += 1;
      sp.meanFitness += agent.fitness;
      assigned.add(agent.id);
      // Accumulate genome for mean update
      const sum = genomeSums.get(bestSpecies)!;
      for (let i = 0; i < agent.genome.length && i < sum.length; i++) {
        sum[i] += agent.genome[i]!;
      }
    } else {
      // Create new species
      const spId = state.nextSpeciesId++;
      state.species.set(spId, {
        id: spId,
        meanGenome: new Float32Array(agent.genome),
        population: 1,
        peakPopulation: 1,
        originTick: currentTick,
        meanFitness: agent.fitness,
        geneticDiversity: 0,
        dominantTrophicLevel: agent.trophicLevel,
        isDeclining: false,
      });
      assigned.add(agent.id);
      state.speciationEvents += 1;
      // Initialize genome sum for the new species
      const newSum = new Float32Array(agent.genome.length);
      for (let i = 0; i < agent.genome.length; i++) {
        newSum[i] = agent.genome[i]!;
      }
      genomeSums.set(spId, newSum);
    }
  }

  // Update mean genomes and detect extinctions
  const extinctSpecies: number[] = [];
  for (const [spId, sp] of state.species) {
    if (sp.population === 0) {
      extinctSpecies.push(spId);
      state.extinctionEvents += 1;
      continue;
    }
    sp.meanFitness /= sp.population;
    sp.peakPopulation = Math.max(sp.peakPopulation, sp.population);
    // Update mean genome from accumulated sums
    const sum = genomeSums.get(spId);
    if (sum) {
      for (let i = 0; i < sp.meanGenome.length; i++) {
        sp.meanGenome[i] = sum[i]! / sp.population;
      }
    }
  }

  // Clean up extinct species (keep for historical record if recently extinct)
  for (const spId of extinctSpecies) {
    state.species.delete(spId);
  }

  // Detect adaptive radiation: many new species in short time
  const newSpeciations = state.speciationEvents - state.lastRadiationCheck;
  const ticksSinceCheck = currentTick - state.lastRadiationTick;
  if (ticksSinceCheck >= 100 && newSpeciations >= 3) {
    state.radiationEvents += 1;
  }
  // Update check window periodically (every 100 ticks)
  if (ticksSinceCheck >= 100) {
    state.lastRadiationCheck = state.speciationEvents;
    state.lastRadiationTick = currentTick;
  }
}

/**
 * Compute selection pressures from current ecosystem state.
 */
export function computeSelectionPressure(
  totalPopulation: number,
  carryingCapacity: number,
  predationRate: number,
  meanAge: number,
  maxAge: number,
  reproductionRate: number,
): SelectionPressure {
  const popRatio = totalPopulation / Math.max(1, carryingCapacity);

  return {
    predationPressure: Math.min(1, predationRate * 10),
    competitionPressure: Math.min(1, Math.max(0, popRatio - 0.5) * 2),
    environmentalStress: Math.min(1, 1 - meanAge / Math.max(1, maxAge)),
    sexualSelection: Math.min(1, reproductionRate * 0.5),
    frequencyDependence: Math.min(1, 1 - popRatio),
  };
}

/**
 * Frequency-dependent selection: rare phenotypes have higher fitness.
 * This maintains genetic diversity in the population.
 */
export function frequencyDependentBonus(
  phenotypeHash: number,
  population: number,
): number {
  // Simple hash-based rarity: more unique = higher bonus
  const rarity = 1 - (phenotypeHash % 100) / 100;
  return rarity * 0.1 * (population / 1000);
}

/**
 * Inclusive fitness (Hamilton's rule): r * B > C
 * r = relatedness, B = benefit to recipient, C = cost to actor
 */
export function hamiltonsRule(
  relatedness: number,
  benefit: number,
  cost: number,
): boolean {
  return relatedness * benefit > cost;
}

/**
 * Compute relatedness between two agents based on genome similarity.
 */
export function relatedness(a: Float32Array, b: Float32Array): number {
  return genomeSimilarity(a, b);
}

/**
 * Lande-Arnold sexual selection: compute mating success based on trait.
 */
export function sexualSelectionMatingSuccess(
  traitValue: number,
  femalePreference: number,
  variance: number,
): number {
  const z = (traitValue - femalePreference) / Math.max(0.01, variance);
  return Math.exp(-0.5 * z * z); // Gaussian preference function
}

/**
 * Fisherian runaway: if female preference and male trait are genetically correlated,
 * both can evolve rapidly. Returns the runaway acceleration.
 */
export function fisherianRunaway(
  traitGeneticCorrelation: number,
  currentTrait: number,
  currentPreference: number,
): number {
  return traitGeneticCorrelation * currentTrait * currentPreference * 0.01;
}
