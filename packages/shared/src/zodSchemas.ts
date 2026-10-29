import { z } from 'zod';
import { GENOME_SIZE, WORLD_SIZE } from './constants.js';
import { EnrichmentSnapshot } from './grounding.js';

export const FractalTypeSchema = z.enum(['mandelbrot', 'julia', 'perlin']);

/**
 * Optional astrophysical frame for a world. All fields optional; any present
 * field switches the physics engine to real gravitational/escape scaling for
 * climbing costs, leaving legacy behaviour intact when the whole object is
 * absent.
 */
export const UniverseConfigSchema = z.object({
  localGravity: z.number().positive().optional(),
  parentMass: z.number().positive().optional(),
  parentLuminosity: z.number().positive().optional(),
  parentTeffective: z.number().positive().optional(),
  planetRadius: z.number().positive().optional(),
  planetMass: z.number().positive().optional(),
  semiMajorAxis: z.number().positive().optional(),
  eccentricity: z.number().min(0).max(0.999).optional(),
  dayLengthSec: z.number().positive().optional(),
  atmospherePressure: z.number().positive().optional(),
  albedo: z.number().min(0).max(0.999).optional(),
  greenhouseDelta: z.number().optional(),
});

export const WorldParamsSchema = z.object({
  cReal: z.number().min(-2).max(2).default(-0.8),
  cImag: z.number().min(-2).max(2).default(0.156),
  maxIter: z.number().int().min(32).max(4096).default(256),
  escapeRadius: z.number().min(2).max(2 ** 24).default(2 ** 16),
  centerX: z.number().default(-0.6),
  centerY: z.number().default(0),
  worldScale: z.number().min(1e-12).max(64).default(4),
  spawnCount: z.number().int().min(1).max(12000).default(600),
  metabolismBase: z.number().min(0.001).max(4).default(0.05),
  maxPopulation: z.number().int().min(1).max(12000).default(12000),
  foodRegenRate: z.number().min(0).max(0.1).default(0.0006),
  energyCapacity: z.number().min(1).max(1e6).default(100),
  agentMaxAge: z.number().int().min(10).max(1e6).default(4000),
  timeScale: z.number().min(0.01).max(1).default(1),
  dayLength: z.number().int().min(100).max(1e6).default(2400),
  seasonLength: z.number().int().min(100).max(1e7).default(20000),
});

export const CreateWorldSchema = z.object({
  seed: z.string().min(1).max(128).optional(),
  fractalType: FractalTypeSchema.optional(),
  universe: UniverseConfigSchema.optional(),
  cellBio: z.boolean().optional(),
  biophysics: z.boolean().optional(),
  omics: z.boolean().optional(),
  omicsStochastic: z.boolean().optional(),
  combinatorial: z.boolean().optional(),
  recombination: z.boolean().optional(),
  mutationScale: z.number().min(0).max(64).optional(),
  environment: z.enum(['calm', 'anoxicTrench', 'hyperthermal', 'hypersaline', 'acidicCrater', 'sodaLake', 'cryoFrozen', 'irradiated', 'toxicSump', 'limestoneCave', 'gutLumen', 'termiteMound', 'rhizosphere', 'wetlandMarsh', 'desertDune', 'hotSpring', 'canopyTop']).optional(),
  topology: z.enum(['torus', 'cylinder', 'sphere', 'mobius', 'kleinBottle']).optional(),
  signalDeposit: z.number().min(0).max(10).optional(),
  memeCopyRate: z.number().min(0).max(10).optional(),
  discovery: z.boolean().optional(),
  reproduction: z.boolean().optional(),
  sensing: z.boolean().optional(),
  grounding: EnrichmentSnapshot.optional(),
  params: WorldParamsSchema.partial().optional(),
});

export const InterventionSchema = z.object({
  type: z.enum(['meteor', 'seedFood', 'spawnAgent', 'pauseRegion', 'setTimeScale', 'nuke', 'setGene']),
  x: z.number().min(0).max(WORLD_SIZE).optional(),
  y: z.number().min(0).max(WORLD_SIZE).optional(),
  radius: z.number().positive().max(4096).optional(),
  amount: z.number().positive().max(1e6).optional(),
  ticks: z.number().int().positive().max(1e6).optional(),
  // Full genome = GENOME_SIZE; shorter arrays are accepted engine-side as a
  // head-patch over a random base (designer partial genomes). Exact-217 passes
  // through unchanged; anything taller is rejected (both engines would fall
  // back to random, so blocking it here keeps the two backends bit-identical).
  genome: z.array(z.number().min(-1).max(1)).max(GENOME_SIZE).optional(),
  timeScale: z.number().min(0.01).max(512).optional(),
  // setGene fields: rewrite a single gene on a live agent's genome.
  agentId: z.number().int().min(0).optional(),
  index: z.number().int().min(0).max(GENOME_SIZE - 1).optional(),
  value: z.number().min(-1).max(1).optional(),
  sequence: z.number().int().min(0),
});

export const SnapshotQuerySchema = z.object({
  tick: z.coerce.number().int().min(0).optional(),
});
