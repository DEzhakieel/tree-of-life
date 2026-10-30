import {
  GENOME_SIZE,
  MUTATION_RATE,
  MUTATION_SIGMA,
  SPECIATION_THRESHOLD,
  DRIVE_OFFSET,
  DRIVES,
  STRATEGY_OFFSET,
  STRATEGIES,
  IMMUNE_OFFSET,
  IMMUNE_GENES,
  PREDPREY_OFFSET,
  PREDPREY_GENES,
  REPRO_OFFSET,
  REPRO_GENES,
  METAB_OFFSET,
  METAB_GENES,
  RECOMB_BLOCK_COUNT,
  RECOMB_MAX_POINTS,
} from '@fractal-life/shared';
import type { SplitMix64 } from './rng.js';

export interface Phenotype {
  speed: number;
  senseRadius: number;
  metabolism: number;
  color: [number, number, number];
  /** body mass multiplier — raises food/water needs, hunting power and escape weight */
  size: number;
  /** diet in [0,1]: <0.4 herbivore, >0.6 carnivore, else omnivore */
  diet: number;
  /** reproduction drive multiplier — lowers the energy threshold to breed */
  fertility: number;
  /** lifespan multiplier applied to agentMaxAge */
  longevity: number;
  /** scales offspring mutation rate/sigma (evolvability) */
  mutability: number;
  /** energy capacity — filled in by the engine from world params */
  capacity: number;
}

export const EMPTY_GENOME = () => new Float32Array(GENOME_SIZE);

/** Uniform [-1,1] random genome. */
export function randomGenome(rng: SplitMix64): Float32Array {
  const g = new Float32Array(GENOME_SIZE);
  for (let i = 0; i < GENOME_SIZE; i++) g[i] = rng.nextSigned();
  return g;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Fast tanh (Padé approx, ~0.5% error) — avoids slow Math.tanh in the hot loop. */
export function fastTanh(x: number): number {
  if (x > 4) return 1;
  if (x < -4) return -1;
  const x2 = x * x;
  return (x * (27 + x2)) / (27 + 9 * x2);
}

export function decodePhenotype(genome: Float32Array): Phenotype {
  return {
    speed: lerp(0.5, 4.5, clamp01((genome[0] + 1) / 2)),
    senseRadius: lerp(8, 64, clamp01((genome[1] + 1) / 2)),
    metabolism: lerp(0.02, 0.25, clamp01((genome[2] + 1) / 2)),
    color: [
      clamp01((genome[3] + 1) / 2),
      clamp01((genome[4] + 1) / 2),
      clamp01((genome[5] + 1) / 2),
    ],
    size: lerp(0.5, 2.5, clamp01((genome[6] + 1) / 2)),
    diet: clamp01((genome[7] + 1) / 2),
    fertility: lerp(0.4, 2.0, clamp01((genome[8] + 1) / 2)),
    longevity: lerp(0.5, 1.5, clamp01((genome[9] + 1) / 2)),
    mutability: lerp(0.25, 2.0, clamp01((genome[10] + 1) / 2)),
    capacity: 0,
  };
}

export interface FractalGenes {
  /** complex parameter c of the agent's orbit */
  cRe: number;
  cIm: number;
}

/**
 * Genes 0/1 double as the agent's point c in the parameter plane:
 *   cRe in [-2, 1], cIm in [-1.25, 1.25]
 * Every lineage iterates the critical orbit z0 = 0 -> z^2 + c each tick.
 * Interior (bounded) orbits are the "set" and survive; escaping orbits are
 * extinction. Because genes 0/1 also encode speed/senseRadius, an agent's
 * niche and its locomotion strategy evolve together.
 */
/**
 * Pattern drives: heritable instinct genes that steer an agent's motion so the
 * simulation *generates* the universal patterns the model hierarchy detects
 * (flocking, clustering, spacing, circulation, oscillation). Each gene maps to
 * a weight in [0,1] except circulation, which is signed so it can spiral either
 * handedness. The drives are decoded once at birth and blend into the brain's
 * thrust each tick — the brain remains in charge, the drives are instincts.
 */
export interface PatternDrives {
  alignment: number;
  cohesion: number;
  separation: number;
  circulation: number;
  oscillation: number;
  noise: number;
}

/**
 * Strategy genes: heritable game-theory parameters that modulate the brain's
 * decisions each tick. Each maps to [0,1] except aggression which is signed
 * so agents can evolve to be actively anti-predatory (anti-hunting).
 */
export interface StrategyGenes {
  /** hunting intensity: >0.5 = predator, <0.5 = prey */
  aggression: number;
  /** greenbeard generosity: tendency to donate surplus energy */
  cooperation: number;
  /** exploration vs exploitation: willingness to enter hazardous terrain */
  risk: number;
  /** signal dishonesty: emit signals at lower cost (cheap talk) */
  deception: number;
}

const weight = (genome: Float32Array, index: number): number => clamp01((genome[index]! + 1) / 2);

export function decodeDrives(genome: Float32Array): PatternDrives {
  return {
    alignment: weight(genome, DRIVE_OFFSET + DRIVES.ALIGNMENT),
    cohesion: weight(genome, DRIVE_OFFSET + DRIVES.COHESION),
    separation: weight(genome, DRIVE_OFFSET + DRIVES.SEPARATION),
    circulation: genome[DRIVE_OFFSET + DRIVES.CIRCULATION]!,
    oscillation: weight(genome, DRIVE_OFFSET + DRIVES.OSCILLATION),
    noise: weight(genome, DRIVE_OFFSET + DRIVES.NOISE),
  };
}

/**
 * Decode strategy genes from the genome. Aggression is signed ([-1,1] -> [0,1])
 * so agents can evolve anti-predatory behaviour. Cooperation, risk and
 * deception are standard [0,1] weights.
 */
export function decodeStrategies(genome: Float32Array): StrategyGenes {
  return {
    aggression: weight(genome, STRATEGY_OFFSET + STRATEGIES.AGGRESSION),
    cooperation: weight(genome, STRATEGY_OFFSET + STRATEGIES.COOPERATION),
    risk: weight(genome, STRATEGY_OFFSET + STRATEGIES.RISK),
    deception: weight(genome, STRATEGY_OFFSET + STRATEGIES.DECEPTION),
  };
}

/**
 * Decode immune system genes from genome.
 */
export interface ImmuneGenes {
  innate: number;
  adaptive: number;
  memory: number;
  inflammation: number;
  autoimmunity: number;
  pathogenDetect: number;
  quarantine: number;
  symbiontTolerance: number;
}

export function decodeImmuneGenes(genome: Float32Array): ImmuneGenes {
  return {
    innate: weight(genome, IMMUNE_OFFSET + IMMUNE_GENES.INNATE),
    adaptive: weight(genome, IMMUNE_OFFSET + IMMUNE_GENES.ADAPTIVE),
    memory: weight(genome, IMMUNE_OFFSET + IMMUNE_GENES.MEMORY),
    inflammation: weight(genome, IMMUNE_OFFSET + IMMUNE_GENES.INFLAMMATION),
    autoimmunity: weight(genome, IMMUNE_OFFSET + IMMUNE_GENES.AUTOIMMUNITY),
    pathogenDetect: weight(genome, IMMUNE_OFFSET + IMMUNE_GENES.PATHOGEN_DETECT),
    quarantine: weight(genome, IMMUNE_OFFSET + IMMUNE_GENES.QUARANTINE),
    symbiontTolerance: weight(genome, IMMUNE_OFFSET + IMMUNE_GENES.SYMBIONT_TOLERANCE),
  };
}

/**
 * Decode predator-prey genes from genome.
 */
export interface PredPreyGenes {
  stealth: number;
  pursuit: number;
  ambush: number;
  packHunting: number;
  escapeUrgency: number;
  warningCall: number;
  mimicry: number;
  aposematism: number;
}

export function decodePredPreyGenes(genome: Float32Array): PredPreyGenes {
  return {
    stealth: weight(genome, PREDPREY_OFFSET + PREDPREY_GENES.STEALTH),
    pursuit: weight(genome, PREDPREY_OFFSET + PREDPREY_GENES.PURSUIT),
    ambush: weight(genome, PREDPREY_OFFSET + PREDPREY_GENES.AMBUSH),
    packHunting: weight(genome, PREDPREY_OFFSET + PREDPREY_GENES.PACK_HUNTING),
    escapeUrgency: weight(genome, PREDPREY_OFFSET + PREDPREY_GENES.ESCAPE_URGENCY),
    warningCall: weight(genome, PREDPREY_OFFSET + PREDPREY_GENES.WARNING_CALL),
    mimicry: weight(genome, PREDPREY_OFFSET + PREDPREY_GENES.MIMICRY),
    aposematism: weight(genome, PREDPREY_OFFSET + PREDPREY_GENES.APOSEMATISM),
  };
}

/**
 * Decode reproduction genes from genome.
 */
export interface ReproGenes {
  sexual: number;
  mateSelectivity: number;
  parentalInvestment: number;
  clutchSize: number;
  generationTime: number;
  senescence: number;
  fecundity: number;
  dormancy: number;
}

export function decodeReproGenes(genome: Float32Array): ReproGenes {
  return {
    sexual: weight(genome, REPRO_OFFSET + REPRO_GENES.SEXUAL),
    mateSelectivity: weight(genome, REPRO_OFFSET + REPRO_GENES.MATE_SELECTIVITY),
    parentalInvestment: weight(genome, REPRO_OFFSET + REPRO_GENES.PARENTAL_INVESTMENT),
    clutchSize: weight(genome, REPRO_OFFSET + REPRO_GENES.CLUTCH_SIZE),
    generationTime: weight(genome, REPRO_OFFSET + REPRO_GENES.GENERATION_TIME),
    senescence: weight(genome, REPRO_OFFSET + REPRO_GENES.SENESCENCE),
    fecundity: weight(genome, REPRO_OFFSET + REPRO_GENES.FECUNDITY),
    dormancy: weight(genome, REPRO_OFFSET + REPRO_GENES.DORMANCY),
  };
}

/**
 * Decode energy metabolism genes from genome.
 */
export interface MetabGenes {
  basalRate: number;
  aerobic: number;
  anaerobic: number;
  thermoregulation: number;
  fatStorage: number;
  sugarMetab: number;
  proteinMetab: number;
  lipidMetab: number;
}

export function decodeMetabGenes(genome: Float32Array): MetabGenes {
  return {
    basalRate: weight(genome, METAB_OFFSET + METAB_GENES.BASAL_RATE),
    aerobic: weight(genome, METAB_OFFSET + METAB_GENES.AEROBIC),
    anaerobic: weight(genome, METAB_OFFSET + METAB_GENES.ANAEROBIC),
    thermoregulation: weight(genome, METAB_OFFSET + METAB_GENES.THERMOREGULATION),
    fatStorage: weight(genome, METAB_OFFSET + METAB_GENES.FAT_STORAGE),
    sugarMetab: weight(genome, METAB_OFFSET + METAB_GENES.SUGAR_METAB),
    proteinMetab: weight(genome, METAB_OFFSET + METAB_GENES.PROTEIN_METAB),
    lipidMetab: weight(genome, METAB_OFFSET + METAB_GENES.LIPID_METAB),
  };
}

export function fractalGenes(genome: Float32Array): FractalGenes {
  return {
    cRe: -2 + 3 * clamp01((genome[0]! + 1) / 2),
    cIm: -1.25 + 2.5 * clamp01((genome[1]! + 1) / 2),
  };
}

export function cloneGenome(genome: Float32Array): Float32Array {
  return new Float32Array(genome);
}

/** Asexual reproduction: copy + per-gene gaussian mutation, clamped to [-1,1]. */
export function mutateGenome(genome: Float32Array, rng: SplitMix64): Float32Array {
  return mutateGenomeScaled(genome, rng, MUTATION_RATE, MUTATION_SIGMA);
}

/** Mutation with agent-specific evolvability (rate/sigma scaled by mutability). */
export function mutateGenomeScaled(genome: Float32Array, rng: SplitMix64, rate: number, sigma: number): Float32Array {
  let child = cloneGenome(genome);
  if (child.length < GENOME_SIZE) {
    const padded = new Float32Array(GENOME_SIZE);
    padded.set(child);
    child = padded;
  }
  for (let i = 0; i < GENOME_SIZE; i++) {
    if (rng.nextFloat() < rate) {
      let v = child[i]! + rng.nextGaussian() * sigma;
      if (v > 1) v = 1;
      else if (v < -1) v = -1;
      child[i] = v;
    }
  }
  return child;
}

/**
 * Lateral gene transfer: overwrite a contiguous 8-gene block of `child` with a
 * block copied from `donor` at the same offset. Gives recombination-like gene
 * flow between co-located lineages.
 */
export function spliceGenome(child: Float32Array, donor: Float32Array, rng: SplitMix64, blockSize = 8): Float32Array {
  const start = rng.nextInt(GENOME_SIZE - blockSize + 1);
  for (let i = 0; i < blockSize; i++) {
    if (start + i < child.length) child[start + i] = donor[start + i]!;
  }
  return child;
}

/**
 * Sexual reproduction: single-point crossover of two parental genomes.
 * Asexual parents use the null crossover (child clones the single parent).
 */
export function crossoverGenome(a: Float32Array, b: Float32Array, rng: SplitMix64): Float32Array {
  const child = new Float32Array(GENOME_SIZE);
  const point = rng.nextInt(GENOME_SIZE + 1);
  for (let i = 0; i < GENOME_SIZE; i++) child[i] = i < point ? (a[i] ?? 0) : (b[i] ?? 0);
  return child;
}

/**
 * Phase C recombination operators (WorldConfig.recombination). Each operator
 * consumes a FIXED, documented number of random draws so the Rust reference
 * (`crates/simulation/src/genome.rs`) reproduces the child byte-for-byte.
 *
 * Block layout: the genome is divided into `RECOMB_BLOCK_COUNT` contiguous
 * blocks of `GENOME_SIZE / RECOMB_BLOCK_COUNT` genes; the residual tail gene
 * (217 = 8 * 27 + 1) is left untouched by block operators.
 */

/** Multi-point crossover: `nPoints` segment switches between `a` (even
 * segments) and `b` (odd segments). Consumes `nPoints` draws. */
export function multiPointCrossover(
  a: Float32Array,
  b: Float32Array,
  rng: SplitMix64,
  nPoints: number,
): Float32Array {
  const points: number[] = [];
  for (let i = 0; i < nPoints; i++) points.push(rng.nextInt(GENOME_SIZE + 1));
  const child = new Float32Array(GENOME_SIZE);
  let fromA = true;
  let pi = 0;
  for (let i = 0; i < GENOME_SIZE; i++) {
    if (pi < points.length && i >= points[pi]!) {
      pi++;
      fromA = !fromA;
    }
    child[i] = (fromA ? a : b)[i] ?? 0;
  }
  return child;
}

/** Block-level shuffle: swap `RECOMB_BLOCK_COUNT / 2` random block pairs.
 * Consumes 2 draws per swap. */
export function blockShuffle(genome: Float32Array, rng: SplitMix64): Float32Array {
  const genes = Math.floor(GENOME_SIZE / RECOMB_BLOCK_COUNT);
  for (let s = 0; s < RECOMB_BLOCK_COUNT / 2; s++) {
    const i1 = rng.nextInt(RECOMB_BLOCK_COUNT);
    const i2 = rng.nextInt(RECOMB_BLOCK_COUNT);
    if (i1 === i2) continue;
    for (let k = 0; k < genes; k++) {
      const pa = i1 * genes + k;
      const pb = i2 * genes + k;
      if (pa < genome.length && pb < genome.length) {
        const tmp = genome[pa]!;
        genome[pa] = genome[pb]!;
        genome[pb] = tmp;
      }
    }
  }
  return genome;
}

/** Combinatorial assembly: rebuild each block by drawing its source parent
 * (0 -> `a`, otherwise `b`). Consumes one draw per block. */
export function combinatorialAssembly(
  a: Float32Array,
  b: Float32Array,
  child: Float32Array,
  rng: SplitMix64,
): Float32Array {
  const genes = Math.floor(GENOME_SIZE / RECOMB_BLOCK_COUNT);
  for (let block = 0; block < RECOMB_BLOCK_COUNT; block++) {
    const fromA = rng.nextInt(2) === 0;
    const src = fromA ? a : b;
    const start = block * genes;
    const end = start + genes;
    for (let i = start; i < end; i++) {
      if (i < child.length) child[i] = src[i] ?? 0;
    }
  }
  return child;
}

/** Full Phase C sexual-reproduction operator: multi-point crossover, then
 * per-block combinatorial assembly, then block shuffle. Fixed draw count:
 * RECOMB_MAX_POINTS + RECOMB_BLOCK_COUNT + RECOMB_BLOCK_COUNT. Mirrored in
 * genome.rs. */
export function recombineGenomes(a: Float32Array, b: Float32Array, rng: SplitMix64): Float32Array {
  const child = multiPointCrossover(a, b, rng, RECOMB_MAX_POINTS);
  combinatorialAssembly(a, b, child, rng);
  blockShuffle(child, rng);
  return child;
}

/**
 * Cosine similarity over the genome, in [-1, 1] (1 when either genome is all
 * zeros, so a null genome is treated as identical to any other null genome).
 * Species identity is `similarity > SPECIATION_THRESHOLD` (0.9), so negatively
 * correlated genomes are unambiguously different species.
 */
export function genomeSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < GENOME_SIZE; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  const denom = Math.sqrt(na * nb);
  if (denom === 0) return 1;
  return dot / denom;
}

export function isSameSpecies(a: Float32Array, b: Float32Array): boolean {
  return genomeSimilarity(a, b) > SPECIATION_THRESHOLD;
}

/**
 * Tiny MLP (15 -> 4 -> 7) encoded in the genome. Weights/bias are laid out
 * contiguously after the phenotype block:
 *   W1[60], b1[4], W2[28], b2[7]  == 99 floats
 *
 * Implemented as a free function writing into caller-owned scratch buffers —
 * measurably faster than a class method in V8's hot loop. Local constants are
 * hard-coded: exported module bindings defeat V8's constant folding.
 */
export function forwardGenome(
  genome: Float32Array,
  sensor: Float32Array,
  hidden: Float32Array,
  out: Float32Array,
): void {
  const g = genome;
  const h = hidden;
  const o = out;
  const INPUTS = 15;
  const HIDDEN = 4;
  const OUTPUTS = 7;
  const H1_OFFSET = 11; // BRAIN_OFFSET
  let k = H1_OFFSET;

  for (let j = 0; j < HIDDEN; j++) {
    let acc = g[k + INPUTS * HIDDEN + j]!;
    for (let i = 0; i < INPUTS; i++) {
      acc += sensor[i]! * g[k + i * HIDDEN + j]!;
    }
    h[j] = fastTanh(acc);
  }
  k += INPUTS * HIDDEN + HIDDEN;

  for (let j = 0; j < OUTPUTS; j++) {
    let acc = g[k + HIDDEN * OUTPUTS + j]!;
    for (let i = 0; i < HIDDEN; i++) {
      acc += h[i]! * g[k + i * OUTPUTS + j]!;
    }
    o[j] = j < 2 ? fastTanh(acc) : 1 / (1 + Math.exp(-acc));
  }
}

/** Back-compat wrapper. */
export class AgentBrain {
  private hidden = new Float32Array(4);

  constructor(public genome: Float32Array) {}

  forward(sensor: Float32Array, out: Float32Array): void {
    forwardGenome(this.genome, sensor, this.hidden, out);
  }
}
