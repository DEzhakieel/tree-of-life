import {
  ECOSYSTEM_OFFSET,
  ECOSYSTEM_GENES,
  WORLD_SIZE,
  TERRAIN_GRID,
  TERRAIN_CELL,
} from '@fractal-life/shared';
import type { SplitMix64 } from './rng.js';

/**
 * Trophic levels in the ecosystem:
 *   0 = Producer (photosynthesizer, eats sunlight/minerals)
 *   1 = Primary consumer (herbivore, eats producers)
 *   2 = Secondary consumer (carnivore, eats herbivores)
 *   3 = Tertiary consumer (apex predator)
 *   4 = Decomposer (breaks down dead organic matter)
 */
export enum TrophicLevel {
  PRODUCER = 0,
  PRIMARY_CONSUMER = 1,
  SECONDARY_CONSUMER = 2,
  TERTIARY_CONSUMER = 3,
  DECOMPOSER = 4,
}

/**
 * Ecosystem adaptation genes decoded from genome.
 */
export interface EcosystemGenes {
  nicheSpecialization: number;
  competitiveAbility: number;
  mutualism: number;
  parasitism: number;
  migration: number;
  territoriality: number;
  keystone: number;
  invasiveness: number;
}

const w01 = (v: number) => (v + 1) / 2;

export function decodeEcosystemGenes(genome: Float32Array): EcosystemGenes {
  const o = ECOSYSTEM_OFFSET;
  return {
    nicheSpecialization: w01(genome[o + ECOSYSTEM_GENES.NICHE_SPECIALIZATION]!),
    competitiveAbility: w01(genome[o + ECOSYSTEM_GENES.COMPETITIVE_ABILITY]!),
    mutualism: w01(genome[o + ECOSYSTEM_GENES.MUTUALISM]!),
    parasitism: w01(genome[o + ECOSYSTEM_GENES.PARASITISM]!),
    migration: w01(genome[o + ECOSYSTEM_GENES.MIGRATION]!),
    territoriality: w01(genome[o + ECOSYSTEM_GENES.TERRITORIALITY]!),
    keystone: w01(genome[o + ECOSYSTEM_GENES.KEYSTONE]!),
    invasiveness: w01(genome[o + ECOSYSTEM_GENES.INVASIVENESS]!),
  };
}

/**
 * Per-cell resource density grid: tracks local food chain state.
 * Each cell stores: [plantBiomass, herbivoreDensity, carnivoreDensity, decomposerActivity]
 */
const RESOURCE_SLOTS = 4;

export interface EcosystemGrid {
  data: Float32Array;
  width: number;
  height: number;
}

export function createEcosystemGrid(): EcosystemGrid {
  return {
    data: new Float32Array(TERRAIN_GRID * TERRAIN_GRID * RESOURCE_SLOTS),
    width: TERRAIN_GRID,
    height: TERRAIN_GRID,
  };
}

function idx(grid: EcosystemGrid, gx: number, gy: number, slot: number): number {
  return (gy * grid.width + gx) * RESOURCE_SLOTS + slot;
}

/**
 * Update ecosystem grid based on agent positions and states.
 * Call once per tick after all agents have moved.
 */
export function updateEcosystemGrid(
  grid: EcosystemGrid,
  agents: Array<{
    x: number;
    y: number;
    alive: boolean;
    diet: number;
    energy: number;
    trophicLevel: TrophicLevel;
  }>,
  dt: number,
): void {
  // Decay all resources
  for (let i = 0; i < grid.data.length; i++) {
    grid.data[i]! *= 0.998;
  }

  // Plant biomass grows naturally (photosynthesis)
  for (let gy = 0; gy < grid.height; gy++) {
    for (let gx = 0; gx < grid.width; gx++) {
      const pi = idx(grid, gx, gy, 0);
      grid.data[pi] = Math.min(1, grid.data[pi]! + 0.001 * dt);
    }
  }

  // Add agent contributions
  for (const a of agents) {
    if (!a.alive) continue;
    const gx = Math.floor(a.x / TERRAIN_CELL) % grid.width;
    const gy = Math.floor(a.y / TERRAIN_CELL) % grid.height;
    if (gx < 0 || gx >= grid.width || gy < 0 || gy >= grid.height) continue;

    switch (a.trophicLevel) {
      case TrophicLevel.PRODUCER:
        grid.data[idx(grid, gx, gy, 0)] = Math.min(1, grid.data[idx(grid, gx, gy, 0)]! + a.energy * 0.0001 * dt);
        break;
      case TrophicLevel.PRIMARY_CONSUMER:
        grid.data[idx(grid, gx, gy, 1)] = Math.min(1, grid.data[idx(grid, gx, gy, 1)]! + a.energy * 0.0002 * dt);
        break;
      case TrophicLevel.SECONDARY_CONSUMER:
      case TrophicLevel.TERTIARY_CONSUMER:
        grid.data[idx(grid, gx, gy, 2)] = Math.min(1, grid.data[idx(grid, gx, gy, 2)]! + a.energy * 0.0002 * dt);
        break;
      case TrophicLevel.DECOMPOSER:
        grid.data[idx(grid, gx, gy, 3)] = Math.min(1, grid.data[idx(grid, gx, gy, 3)]! + a.energy * 0.0001 * dt);
        break;
    }
  }
}

/**
 * Get local resource availability for an agent at world position (x, y).
 */
export function getLocalResources(
  grid: EcosystemGrid,
  x: number,
  y: number,
): { plantBiomass: number; herbivoreDensity: number; carnivoreDensity: number; decomposerActivity: number } {
  const gx = Math.floor(x / TERRAIN_CELL) % grid.width;
  const gy = Math.floor(y / TERRAIN_CELL) % grid.height;
  if (gx < 0 || gx >= grid.width || gy < 0 || gy >= grid.height) {
    return { plantBiomass: 0, herbivoreDensity: 0, carnivoreDensity: 0, decomposerActivity: 0 };
  }
  return {
    plantBiomass: grid.data[idx(grid, gx, gy, 0)]!,
    herbivoreDensity: grid.data[idx(grid, gx, gy, 1)]!,
    carnivoreDensity: grid.data[idx(grid, gx, gy, 2)]!,
    decomposerActivity: grid.data[idx(grid, gx, gy, 3)]!,
  };
}

/**
 * Compute competitive exclusion pressure: if too many agents share the same niche,
 * competition increases. nicheSpecialization reduces overlap.
 */
export function competitionPressure(
  genes: EcosystemGenes,
  localPopulation: number,
  carryingCapacity: number,
): number {
  const nicheWidth = 0.3 + genes.nicheSpecialization * 0.7; // narrower niche = less overlap
  const ratio = localPopulation / Math.max(1, carryingCapacity);
  return Math.max(0, ratio / nicheWidth - 1) * genes.competitiveAbility * 0.01;
}

/**
 * Compute mutualism benefit from nearby compatible agents.
 */
export function mutualismBenefit(
  genes: EcosystemGenes,
  nearbyMutualists: number,
): number {
  return genes.mutualism * nearbyMutualists * 0.005;
}

/**
 * Compute parasitism drain from nearby hosts.
 */
export function parasitismDrain(
  genes: EcosystemGenes,
  nearbyHosts: number,
): number {
  return genes.parasitism * nearbyHosts * 0.003;
}

/**
 * Determine trophic level from diet gene and observed behaviour.
 */
export function assignTrophicLevel(diet: number, aggression: number): TrophicLevel {
  if (aggression > 0.7 && diet > 0.6) return TrophicLevel.TERTIARY_CONSUMER;
  if (aggression > 0.5 || diet > 0.5) return TrophicLevel.SECONDARY_CONSUMER;
  if (diet > 0.3) return TrophicLevel.PRIMARY_CONSUMER;
  if (diet < 0.15) return TrophicLevel.DECOMPOSER;
  return TrophicLevel.PRODUCER;
}

/**
 * Compute carrying capacity for a trophic level based on resource availability.
 * Higher trophic levels have lower carrying capacity (energy pyramid).
 */
export function carryingCapacity(
  trophicLevel: TrophicLevel,
  localResources: { plantBiomass: number; herbivoreDensity: number; carnivoreDensity: number; decomposerActivity: number },
): number {
  switch (trophicLevel) {
    case TrophicLevel.PRODUCER:
      return 20 + localResources.plantBiomass * 80;
    case TrophicLevel.PRIMARY_CONSUMER:
      return 10 + localResources.plantBiomass * 40;
    case TrophicLevel.SECONDARY_CONSUMER:
      return 5 + localResources.herbivoreDensity * 30;
    case TrophicLevel.TERTIARY_CONSUMER:
      return 2 + localResources.carnivoreDensity * 10;
    case TrophicLevel.DECOMPOSER:
      return 8 + localResources.decomposerActivity * 40;
    default:
      return 10;
  }
}

/**
 * Compute migration tendency: agents with high migration gene move toward
 * areas with lower competition.
 */
export function migrationForce(
  genes: EcosystemGenes,
  localPop: number,
  carrying: number,
): number {
  if (localPop < carrying * 0.8) return 0;
  const pressure = (localPop - carrying * 0.8) / (carrying * 0.2);
  return genes.migration * pressure * 0.1;
}

/**
 * Compute territorial defense cost.
 */
export function territorialDefense(
  genes: EcosystemGenes,
  localAllies: number,
): number {
  if (localAllies < 2) return 0;
  return genes.territoriality * localAllies * 0.002;
}

/**
 * Ecosystem-level biodiversity index: Shannon diversity across trophic levels.
 */
export function biodiversityIndex(populationCounts: number[]): number {
  const total = populationCounts.reduce((a, b) => a + b, 0);
  if (total === 0) return 0;
  let H = 0;
  for (const count of populationCounts) {
    if (count <= 0) continue;
    const p = count / total;
    H -= p * Math.log(p);
  }
  // Normalize by max possible entropy
  const maxH = Math.log(populationCounts.length);
  return maxH > 0 ? H / maxH : 0;
}

/**
 * Food chain efficiency: how much energy transfers between trophic levels.
 * Typically ~10% in real ecosystems (Lindeman's 10% rule).
 */
export function foodChainEfficiency(
  fromLevel: TrophicLevel,
  toLevel: TrophicLevel,
): number {
  if (toLevel <= fromLevel) return 0;
  const steps = toLevel - fromLevel;
  return Math.pow(0.1, steps); // 10% per level
}
