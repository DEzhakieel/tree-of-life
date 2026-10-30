import {
  WORLD_SIZE,
  TERRAIN_CELL,
  STATE,
  MT,
  FIXED_POINT,
  MAX_AGENTS,
  ByteWriter,
  encodeSnapshot,
  encodeStats,
  encodeSetMap,
  type WorldConfig,
  type WorldParams,
  type WorldStatus,
  type SimStats,
  type SimEvent,
  type EventType,
  type DeathCause,
  type Intervention,
  type InterventionType,
  type AgentState,
  type LineageNode,
  fnv1a32,
  deriveWorldPhysics,
  ENV_PROFILES,
  type WorldPhysics,
  type EnvProfile,
  type WorldTopology,
} from '@fractal-life/shared';
import { SplitMix64, streamSeed, initSeed, memeSeed, envSeed, omicsSeed } from './rng.js';
import { randomGenome, mutateGenomeScaled, spliceGenome, crossoverGenome, recombineGenomes, decodePhenotype, forwardGenome, fractalGenes, decodeDrives, decodeStrategies, decodeImmuneGenes, decodePredPreyGenes, decodeReproGenes, decodeMetabGenes, genomeSimilarity, type Phenotype, type StrategyGenes } from './genome.js';
import { decodeEcosystemGenes } from './ecosystem.js';
import { stepMovement } from './physics.js';
import { buildTerrainGrid, sampleGridInto, type TerrainGrid, type GridSample } from './terrain.js';
import { SpatialHash } from './spatialHash.js';
import type { SimAgent } from './agent.js';
import { createLyapunovState, updateLyapunov, type LyapunovState } from './lyapunov.js';
import { createReplicatorState, updateReplicator, setProjection, type ReplicatorState } from './replicator.js';
import { createVectorField, computeVectorFields, type VectorFieldResult } from './vectorfield.js';
import { createGameOfLife, stepGameOfLife, seedFromAgents, type GameOfLifeState } from './gameoflife.js';
import { createTensorState, updateTensors, type TensorState } from './tensors.js';
import { createAgentChemistry, createChemTerrain, tickAgentChemistry, tickChemTerrain, type AgentChemistry, type ChemTerrain } from './chemistry.js';
import { createAgentOmics, tickOmics, OmicsTotals, zeroOmicsAgg, type OmicsAgg } from './omics.js';
import { createDnaSystem, tickDna, decodeDnaGenes, type DnaSystem } from './dna.js';
import { createCellState, tickCell, decodeCellGenes, decodeMembraneGenes, type CellState } from './cells.js';
import { createCellBioState, applyCellBioTick } from './cellbio.js';
import { createEcosystemGrid, updateEcosystemGrid, assignTrophicLevel, competitionPressure, mutualismBenefit, carryingCapacity, getLocalResources, type EcosystemGrid } from './ecosystem.js';
import { createSelectionState, updateSpecies, computeSelectionPressure, computeFitness, type SelectionState } from './selection.js';
import { createBrain, spawnBrain, forwardBrain, observeBrain, backpropBrain, policySigma, sampleGaussianAction, learnedMag, stepPomdp, DEFAULT_POMDP_HIDDEN, type BrainConfig, type BrainState, type PolicyConfig, type BackpropOpts } from './brain.js';
import { ELEMENT_COUNT, MOLECULE_COUNT, ENZYME_TYPE_COUNT, CHEM_MAX_MOLECULE, CHEM_MAX_ENZYME, PH_NEUTRAL, IMMUNE_COST, BASAL_METABOLIC_COST, AEROBIC_ATP_RATE, ENV_REINJECT_RATE, THERMOREGULATION_COST, DORMANCY_CONSERVATION, PACK_BONUS, SEXUAL_COST_MULT, MLP_HIDDEN, MLP_WEIGHTS, GENOME_SIZE } from '@fractal-life/shared';
import { DEFAULT_WEATHER_MATRIX, stepWeather, stepOu, stepBurst, poissonDraw, createWorldStochState, WEATHER_NAMES, type WorldStochasticConfig, type WorldStochState } from './worldStoch.js';
import { auditWorld, type Violation } from './mathAudit.js';

const EATING_RATE = 0.008;
const MEAT_EATING_RATE = 0.012;
/** density-dependent starvation stress multiplier for ecology grounding */
const CROWDING_STRESS = 0.5;
/** instantaneous resource pulse (fraction of cell capacity) applied to a cell
 *  hit by a Poisson point-process regen event */
const BURST_REGEN_BOOST = 0.05;
const REPRO_ENERGY_THRESHOLD = 0.62;
const REPRO_AGE_MIN = 10;
const CHILD_ENERGY_FRACTION = 0.22;
const CHILD_WATER_FRACTION = 0.25;
/** per-tick water loss (sweat); reduced from 0.012 to 0.004 so the water equation
 *  reaches approximate break-even at typical terrain moisture (~0.17), allowing
 *  populations to persist without thirst driving every long run to extinction. */
const WATER_EVAP_RATE = 0.004;
const WATER_ABSORB_RATE = 0.02;
const BITE_FRACTION = 0.02;
const SIGNAL_DEPOSIT = 0.08;
const SIGNAL_DECAY = 0.95;
const SIGNAL_DIFFUSE = 0.12;
/** chemical energy spent per unit of signalling per tick (costly/honest signals) */
const SIGNAL_COST = 0.015;
/** kin altruism: donate surplus once energy exceeds this fraction of capacity */
const ALTRUISM_THRESHOLD = 0.75;
/** max donation per tick as a fraction of capacity (scaled by size) */
const DONATION_RATE = 0.02;
/** probability per tick of imitating the most successful neighbour's meme */
const MEME_COPY_RATE = 0.02;
/** memes closer than this are "the same tag" (greenbeard recognition) */
const MEME_TOLERANCE = 0.05;
/** gaussian innovation sigma applied to inherited memes */
const MEME_INNOVATION = 0.01;
const MEAT_DECAY = 0.002;
/** fraction of decayed carrion retained as soil minerals (rest is heat) */
const DECOMP_FRACTION = 0.5;
/** minerals consumed per unit of plant biomass grown */
const PLANT_NUTRIENT_USE = 0.3;
/** per-tick drift of soil minerals toward the geological baseline */
const MINERAL_WEATHERING = 0.0008;
const LGT_RATE = 0.03;
const LGT_BLOCK = 8;
const NEIGHBOR_MAX = 24;
const DEAD_RETENTION = 25000;
/** how many leading genome genes feed the deterministic species fingerprint */
const SPECIES_GENES = 32;
/** fractal escape: |z|^2 > ESCAPE_B2 means the orbit has diverged past |z| = 2 */
const ESCAPE_B2 = 4;
/** cap on orbit iterations accumulated per agent (wire depth is u8 anyway) */
const ORBIT_DEPTH_CAP = 1024;
/** scale applied to the instinctive drive vector before it blends with brain thrust */
const DRIVE_SCALE = 0.6;
/** "personal space" radius for the separation drive, scaled by body size */
const SEPARATION_RADIUS = 8;
/** parameter-plane window: cRe in [-2, 1], cIm in [-1.25, 1.25] */
const CRE_MIN = -2;
const CRE_RANGE = 3;
const CIM_MIN = -1.25;
const CIM_RANGE = 2.5;
/** orbit richness drives survival: flux 0.5 (deep interior) .. 1 (boundary) */
const FLUX_MIN = 0.5;
const FLUX_MAX = 1;
// Local aliases of exported constants (module binding reads defeat V8 folding).
const WORLD = WORLD_SIZE;
const CELL = TERRAIN_CELL;
const ST = STATE;
const MTX = MT;
const FP = FIXED_POINT;
const TWO_PI = Math.PI * 2;
const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

interface RecordedIntervention {
  tick: number;
  intervention: Intervention;
}

export interface TickResult {
  tick: number;
  /** binary DELTA frame (MTX.DELTA) ready to broadcast */
  delta: Uint8Array<ArrayBufferLike>;
  deltaCount: number;
  stats: SimStats;
  events: SimEvent[];
}

const emptyState = (id: number, x: number, y: number, energy: number, state: number, species: number, meme: number): AgentState => ({
  id,
  x,
  y,
  energy,
  state,
  species,
  meme,
});

/** Severity hint in [0,1] attached to death events (mirrors Rust death_significance). */
const DEATH_SIG: Record<DeathCause, number> = {
  starvation: 0.3,
  thirst: 0.3,
  age: 0.1,
  predation: 0.5,
  escape: 0.6,
  intervention: 1.0,
};

/** Severity hint per intervention type (mirrors the Rust significance match). */
const INTERVENTION_SIG: Record<InterventionType, number> = {
  meteor: 1.0,
  nuke: 1.0,
  seedFood: 0.5,
  spawnAgent: 0.4,
  pauseRegion: 0.3,
  setTimeScale: 0.2,
  setGene: 0.15,
};

/**
 * Deterministic simulation engine.
 *
 * Determinism contract: state at any tick is a pure function of
 * (worldSeed, worldParams, ordered intervention log). No Math.random(),
 * no wall-clock, no hash-map iteration order — agents are always iterated in
 * ascending id order, and every stochastic draw comes from a SplitMix64
 * stream seeded by (worldSeed, tick, agentId).
 */
export class Engine {
  readonly config: WorldConfig;
  readonly params: WorldParams;
  agents = new Map<number, SimAgent>();
  /** loci changed by mutation + lateral transfer at birth; instrument for ablation studies */
  mutationLoci = 0;
  /** lifetime birth count, paired with `mutationLoci` */
  birthCount = 0;
  grid: TerrainGrid;
  interventionLog: RecordedIntervention[] = [];
  private nextId = 0;
  private tickNum = 0;
  private spatial = new SpatialHash();
  private deadAgents: number[] = []; // ids of dead agents, oldest first, for retention capping
  private tickDeaths = 0; // deaths recorded so far in the current tick (still in the spatial hash)
  private prevAlive = 0;
  private prevSpecies = 0;
  private prevCentroidX = 0;
  private prevCentroidY = 0;
  private aliveIds: number[] = [];
  private bornQueue: SimAgent[] = [];
  private events: SimEvent[] = [];
  private lastBirths = 0;
  private lastDeaths = 0;
  private lastDonation = 0; // energy gifted via greenbeard altruism this tick
  private lastEscapeDeaths = 0;
  private lastDeathCauses: Record<DeathCause, number> = {
    starvation: 0,
    thirst: 0,
    age: 0,
    predation: 0,
    intervention: 0,
    escape: 0,
  };
  private sensors = new Float32Array(15);
  private hidden = new Float32Array(4);
  private out = new Float32Array(7);
  private neighbors = new Int32Array(NEIGHBOR_MAX);
  /** plastic recurrent brains: engine-level config (overrides beat the genes) */
  private brainCfg: BrainConfig = { enabled: true };
  /** POMDP-vetted sensor channels (empty when the perception model is off) */
  private pomdpChannels: number[] = [];
  /** scratch buffer for per-channel observation noise telemetry */
  private pomdpNoise = new Float32Array(15);
  /** stochastic policy head scratch: sampled actions + raw normal draws.
   *  `out` stays the *mean* policy; `act` is what propels the agent. */
  private act = new Float32Array(7);
  private actEps = new Float32Array(7);
  /** engine-level exploration sigma for the current tick (annealed schedule) */
  private policySigmaVal = 0;
  /** backprop SGD scratch: hidden-unit keep mask + gradient noise normals */
  private dropMask = new Float32Array(MLP_HIDDEN);
  private gradNoiseVec = new Float32Array(0);
  /** stochastic world processes: OU resource field, Poisson bursts, weather */
  private worldStochCfg: WorldStochasticConfig | undefined;
  private worldStochState: WorldStochState | undefined;
  /** running |reward-prediction-error| totals for surprise telemetry */
  private brainSurpriseSum = 0;
  private brainSurpriseN = 0;
  private signalNext: Float32Array<ArrayBuffer> = new Float32Array(0);
  /** per-cell max orbit depth of currently alive lineages (the "evolved set") */
  private setMapDepth: Uint8Array = new Uint8Array(0);
  /** per-cell escape marks — a lineage diverged here; decays between emits */
  private setMapEscape: Uint8Array = new Uint8Array(0);
  private sample: GridSample = { height: 0, energy: 0, moisture: 0, hazard: 0, food: 0, meat: 0, signal: 0, cap: 0, chem: 0, minerals: 0 };
  private deltaW = new ByteWriter(8192);
  private lastDeltaBytes: Uint8Array<ArrayBufferLike> = new Uint8Array(0);
  private lastDeltaCount = 0;
  // --- math modules ---
  readonly lyapunov: LyapunovState;
  readonly replicator: ReplicatorState;
  readonly vectorField: VectorFieldResult;
  readonly gameOfLife: GameOfLifeState;
  readonly tensors: TensorState;
  readonly chemTerrain: ChemTerrain;
  readonly ecosystemGrid: EcosystemGrid;
  readonly selectionState: SelectionState;
  /** Phase M biome bias: the environment preset's chemical terrain seeding
   *  plus the water factor / default heat applied to per-agent omics envs. */
  private readonly envProfile: EnvProfile;
  /** Phase M topological space: the boundary condition applied to agent
   *  movement. Falls back to the legacy torus when the config does not pick
   *  a topology. */
  private readonly topology: WorldTopology;
  /** Phase M observability: total y-cap crossings handled by the topology over
   *  the engine's run (cumulative; research reports use it to show the boundary
   *  condition actually engaged). */
  public topologyEdgeHits = 0;
  /** real-world chemistry acceptance (enrichment snapshot) for digestion */
  private groundStoich?: { plant: number[]; meat: number[] };
  /** real-world ecology priors: per-trophic-level expected biomass fraction
   *  derived from GBIF occurrence abundance. When present, over-abundant levels
   *  (relative share exceeding real-world expectation) incur crowding stress and
   *  are capped at reproduction. */
  private groundEcoFra: number[] | null = null;
  /** per-trophic-level alive population at the start of the current tick */
  private groundLevelPop = new Int32Array(5);
  /** per-trophic-level crowding penalty in [0,∞) for the current tick */
  private groundCrowd = new Float32Array(5);
  /** physically-derived world parameters (astrophysical frame), legacy when absent */
  private worldPhysics: WorldPhysics;

  constructor(
    config: WorldConfig,
    genomeOverrides?: { id: number; genome: Float32Array }[],
    private deadRetention: number = DEAD_RETENTION,
  ) {
    this.config = config;
    this.params = { ...config.params };
    this.worldPhysics = deriveWorldPhysics(config.universe);
    this.groundStoich = config.grounding
      ? {
          plant: config.grounding.chemistry.stoichiometry.plant,
          meat: config.grounding.chemistry.stoichiometry.meat,
        }
      : undefined;
    // Derive per-trophic-level expected fraction from real GBIF abundance.
    // Each level carries its real occurrenceFraction (share of the community);
    // levels above the TOP of the data (apex) use the apex value so exotic
    // trophic assignments don't run unbounded.
    if (config.grounding?.ecology?.priors) {
      const priors = [...config.grounding.ecology.priors].sort((a, b) => a.level - b.level);
      const fra: number[] = [];
      let lastTop = 0;
      for (const p of priors) {
        const f = p.occurrenceFraction > 0 ? p.occurrenceFraction : 0;
        fra[p.level] = f;
        lastTop = f;
      }
      // default for levels not present in the data
      for (let lv = 5; lv-- > 0;) if (fra[lv] === undefined) fra[lv] = lastTop;
      this.groundEcoFra = fra;
    }
    this.grid = buildTerrainGrid(this.params, config.fractalType, fnv1a32(config.seed));
    const gridSize = this.grid.size;
    this.envProfile = ENV_PROFILES[config.environment ?? 'calm'];this.signalNext = new Float32Array(gridSize * gridSize);
    this.topology = config.topology ?? 'torus';
    this.setMapDepth = new Uint8Array(gridSize * gridSize);
    this.setMapEscape = new Uint8Array(gridSize * gridSize);
    this.lyapunov = createLyapunovState();
    this.replicator = createReplicatorState();
    this.vectorField = createVectorField(gridSize);
    this.gameOfLife = createGameOfLife(gridSize);
    this.tensors = createTensorState();
    this.chemTerrain = createChemTerrain(gridSize, this.envProfile);
    this.ecosystemGrid = createEcosystemGrid();
    this.selectionState = createSelectionState();
    this.spawnFounders(genomeOverrides);
  }

  get currentTick(): number {
    return this.tickNum;
  }

  /**
   * Check the current state against the engine's mathematical invariants
   * (`src/mathAudit.ts`, contract in `docs/MATHEMATICS.md`). Pure: no draws, no
   * mutation, no reordering, so calling it cannot change a trajectory. Returns
   * `[]` when the state is inside the domain the update equations assume.
   * Pass the stats object from the last `tick()` to include it in the audit.
   */
  audit(stats?: object): Violation[] {
    return auditWorld(
      {
        tick: this.tickNum,
        worldSize: this.grid.size * this.grid.cell,
        maxPopulation: this.params.maxPopulation,
        energyCapacity: this.params.energyCapacity,
        agents: this.agents.values(),
        stats,
      },
      GENOME_SIZE,
    );
  }

  /** Configure the plastic recurrent brains. Must be set before the first tick
   *  for a deterministic trajectory. */
  setBrainConfig(cfg: BrainConfig): void {
    this.brainCfg = {
      enabled: cfg.enabled ?? true,
      lr: cfg.lr,
      gamma: cfg.gamma,
      lambda: cfg.lambda,
      inherit: cfg.inherit,
      learn: cfg.learn ?? 'hebbian',
      pomdp: cfg.pomdp,
      policy: cfg.policy,
      dropout: cfg.dropout ?? 0,
      gradNoise: cfg.gradNoise ?? 0,
      entropy: cfg.entropy ?? 0,
    };
    const p = cfg.pomdp;
    this.pomdpChannels = p?.enabled ? (p.hidden ?? DEFAULT_POMDP_HIDDEN) : [];
    if (((cfg.dropout ?? 0) > 0 || (cfg.gradNoise ?? 0) > 0) && this.gradNoiseVec.length !== MLP_WEIGHTS + MLP_HIDDEN + 1) {
      this.gradNoiseVec = new Float32Array(MLP_WEIGHTS + MLP_HIDDEN + 1);
    }
  }

  /** Enable/configure the stochastic world processes (OU resource field,
   *  Poisson point-process regen bursts, Markov-chain weather). Disabled by
   *  default so determinism/parity traces are untouched; when a value is
   *  omitted the module defaults are used. Must be set before the first tick. */
  setWorldStochastics(cfg: Partial<WorldStochasticConfig> | null): void {
    if (cfg == null || cfg.enabled === false) {
      this.worldStochCfg = undefined;
      this.worldStochState = undefined;
      return;
    }
    this.worldStochCfg = {
      enabled: true,
      poissonRate: cfg.poissonRate ?? 40,
      ouTheta: cfg.ouTheta ?? 0.01,
      ouSigma: cfg.ouSigma ?? 0.02,
      ouBand: cfg.ouBand ?? 0.25,
      weather: cfg.weather ?? null,
    };
    this.worldStochState = createWorldStochState(this.grid.size);
  }

  get brainConfig(): BrainConfig {
    return { ...this.brainCfg };
  }

  /** Aggregate brain telemetry: learned deviation from the genome template,
   *  mean reward-prediction surprise, and the fraction of alive agents whose
   *  synapses have actually moved. */
  brainStats(): { enabled: boolean; meanPlasticity: number; meanSurprise: number; plasticAgents: number } {
    if (!this.brainCfg.enabled || this.aliveIds.length === 0) {
      return { enabled: this.brainCfg.enabled, meanPlasticity: 0, meanSurprise: 0, plasticAgents: 0 };
    }
    let magSum = 0;
    let drifted = 0;
    let n = 0;
    for (const id of this.aliveIds) {
      const a = this.agents.get(id);
      if (!a) continue;
      const mag = learnedMag(a.brain, a.genome);
      magSum += mag;
      if (mag > 0.001) drifted++;
      n++;
    }
    return {
      enabled: this.brainCfg.enabled,
      meanPlasticity: n > 0 ? magSum / n : 0,
      meanSurprise: this.brainSurpriseN > 0 ? this.brainSurpriseSum / this.brainSurpriseN : 0,
      plasticAgents: n > 0 ? drifted / n : 0,
    };
  }

  /** Effective population cap for a trophic level. When ecology grounding is
   *  present this scales the flat maxPopulation by the real GBIF expected
   *  fraction; otherwise it falls back to maxPopulation. */
  private levelCap(level: number, cap: number): number {
    if (!this.groundEcoFra) return cap;
    const fra = this.groundEcoFra[level];
    if (fra === undefined || fra <= 0) return this.params.maxPopulation;
    return cap * fra;
  }


  get lastDelta(): { bytes: Uint8Array<ArrayBufferLike>; count: number } {
    return { bytes: this.lastDeltaBytes, count: this.lastDeltaCount };
  }

  // ---------------------------------------------------------------------------
  // Initialisation
  // ---------------------------------------------------------------------------

  private spawnFounders(genomeOverrides?: { id: number; genome: Float32Array }[]): void {
    const rng = new SplitMix64(initSeed(this.config.seed));
    const count = this.params.spawnCount;
    const cap = this.params.energyCapacity;
    const overrides = new Map<number, Float32Array>();
    if (genomeOverrides) for (const o of genomeOverrides) overrides.set(o.id, o.genome);
    for (let i = 0; i < count; i++) {
      const id = this.nextId++;
      const genome = overrides.get(id) ?? randomGenome(rng);
      const x = rng.nextFloat() * WORLD;
      const y = rng.nextFloat() * WORLD;
      const meme = rng.nextFloat();
      const agent = this.createAgent({
        id,
        parentId: -1,
        genome,
        x,
        y,
        energy: cap * 0.5,
        water: cap * 0.5,
        bornAtTick: 0,
        meme: this.cultureOn() ? meme : 0,
      });
      this.agents.set(id, agent);
    }
    this.prevAlive = count;
    this.prevSpecies = this.countSpecies();
  }

  private createAgent(opts: {
    id: number;
    parentId: number;
    genome: Float32Array;
    x: number;
    y: number;
    energy: number;
    water: number;
    bornAtTick: number;
    meme?: number;
    parentBrain?: BrainState;
  }): SimAgent {
    const phenotype = decodePhenotype(opts.genome);
    phenotype.capacity = this.params.energyCapacity;
    const c = fractalGenes(opts.genome);
    const drives = decodeDrives(opts.genome);
    const strategy = decodeStrategies(opts.genome);
    const immuneGenes = decodeImmuneGenes(opts.genome);
    const predpreyGenes = decodePredPreyGenes(opts.genome);
    const reproGenes = decodeReproGenes(opts.genome);
    const metabGenes = decodeMetabGenes(opts.genome);
    const dnaGenes = decodeDnaGenes(opts.genome);
    const cellGenes = decodeCellGenes(opts.genome);
    const cap = this.params.energyCapacity;
    const trophicLevel = assignTrophicLevel(phenotype.diet, strategy.aggression);
    const memGenes = decodeMembraneGenes(opts.genome);
    const chemistry = createAgentChemistry(opts.genome, opts.id * 2654435761);
    const cell = createCellState(cellGenes);
    if (this.config.cellBio) {
      cell.bio = createCellBioState(memGenes, chemistry);
    }
    const omics = this.config.omics ? createAgentOmics(opts.genome, opts.id) : undefined;

    return {
      id: opts.id,
      parentId: opts.parentId,
      genome: opts.genome,
      phenotype,
      x: opts.x,
      y: opts.y,
      vx: 0,
      vy: 0,
      energy: opts.energy,
      water: opts.water,
      age: 0,
      alive: true,
      species: this.assignSpecies(opts.genome),
      bornAtTick: opts.bornAtTick,
      diedAtTick: -1,
      finalFitness: 0,
      energyAcquired: 0,
      kills: 0,
      reproductions: 0,
      altruism: 0,
      meme: opts.meme ?? 0,
      lastReproTick: -1,
      pausedTicks: 0,
      lastHuntedTick: -1,
      lastHuntedBy: -1,
      cRe: c.cRe,
      cIm: c.cIm,
      zRe: 0,
      zIm: 0,
      orbitDepth: 1,
      drives,
      strategy,
      totalDonated: 0,
      totalReceived: 0,
      totalHuntDamage: 0,
      timesHunted: 0,
      chemistry,
      omics,
      dna: createDnaSystem(),
      cell,
      immune: {
        pathogenLoad: 0,
        innate: immuneGenes.innate,
        adaptive: immuneGenes.adaptive,
        immuneMemory: 0,
        inflammation: 0,
        autoimmunity: 0,
        pathogensFought: 0,
        symbiontLoad: 0,
      },
      predprey: {
        stealth: predpreyGenes.stealth,
        pursuit: predpreyGenes.pursuit,
        ambush: predpreyGenes.ambush,
        packBonus: 0,
        escapeEnergy: 0,
        warningCalls: 0,
        mimicry: predpreyGenes.mimicry,
        aposematism: predpreyGenes.aposematism,
        isHiding: false,
        isChasing: false,
        ticksSinceHunt: 0,
      },
      repro: {
        sexual: reproGenes.sexual,
        mateSelectivity: reproGenes.mateSelectivity,
        parentalInvestment: reproGenes.parentalInvestment,
        clutchSize: Math.max(1, Math.round(reproGenes.clutchSize * 4)),
        generationTime: reproGenes.generationTime,
        senescence: reproGenes.senescence,
        fecundity: reproGenes.fecundity,
        dormancy: reproGenes.dormancy,
        isDormant: false,
        ticksSinceBirth: 0,
        isMature: false,
        mateFound: false,
      },
      metabolism: {
        basalRate: metabGenes.basalRate,
        aerobicCapacity: metabGenes.aerobic,
        anaerobicCapacity: metabGenes.anaerobic,
        bodyTemperature: 37,
        fatStorage: 0,
        sugarMetab: metabGenes.sugarMetab,
        proteinMetab: metabGenes.proteinMetab,
        lipidMetab: metabGenes.lipidMetab,
        metabolicMode: 'aerobic',
      },
      trophicLevel,
      fitness: { energyFitness: 0, survivalFitness: 0, reproductiveFitness: 0, socialFitness: 0, metabolicFitness: 0, total: 0 },
      ecosystem: decodeEcosystemGenes(opts.genome),
      immuneGenes,
      predpreyGenes,
      reproGenes,
      metabGenes,
      brain: opts.parentBrain
        ? spawnBrain(opts.parentBrain, opts.genome, this.brainCfg)
        : createBrain(opts.genome, this.brainCfg),
    };
  }

  private assignSpecies(genome: Float32Array): number {
    // Deterministic species fingerprint: quantise the leading genes to 3 bits
    // each and hash. Genomes within ~1/8 of gene space collapse to the same
    // species id, mirroring the "similarity > 0.9" grouping without O(n^2).
    let h = 0x811c9dc5;
    let acc = 0;
    let bits = 0;
    for (let i = 0; i < SPECIES_GENES; i++) {
      const level = Math.round(((genome[i]! + 1) / 2) * 7);
      acc = (acc << 3) | (level & 7);
      bits += 3;
      if (bits >= 30) {
        h ^= acc;
        h = Math.imul(h, 0x01000193);
        acc = 0;
        bits = 0;
      }
    }
    h ^= acc;
    h = Math.imul(h, 0x01000193);
    return h >>> 0;
  }

  // ---------------------------------------------------------------------------
  // Tick
  // ---------------------------------------------------------------------------

  tick(): TickResult {
    this.tickNum++;
    const t = this.tickNum;
    const ts = this.params.timeScale;
    const cap = this.params.energyCapacity;

    // deterministic environment cycle: day/night + seasons
    const dayPhase = (t % this.params.dayLength) / this.params.dayLength;
    const seasonPhase = (t % this.params.seasonLength) / this.params.seasonLength;
    const daylight = 0.5 + 0.5 * Math.cos(TWO_PI * dayPhase);
    const seasonCycle = 0.5 + 0.5 * Math.sin(TWO_PI * seasonPhase);
    // eccentric orbits break temporal uniformity → seasons flatten out
    const amplitude = this.worldPhysics.symmetryLaws.temporalUniformity;
    let seasonMoisture = 0.4 + 0.6 * amplitude * seasonCycle;
    // stochastic world processes: Markov-chain weather, OU resource field and
    // Poisson point-process regen bursts. All draws come from the per-tick env
    // stream so the whole trajectory stays reproducible given the seed.
    if (this.worldStochCfg?.enabled && this.worldStochState) {
      const wrng = new SplitMix64(envSeed(this.config.seed, t));
      stepWeather(this.worldStochState, wrng, this.worldStochCfg.weather ?? DEFAULT_WEATHER_MATRIX);
      seasonMoisture = Math.min(1, Math.max(0, seasonMoisture * this.worldStochState.weatherMoisture));
      stepOu(this.worldStochState, wrng, this.worldStochCfg, ts);
      stepBurst(this.worldStochState, wrng, poissonDraw(wrng, this.worldStochCfg.poissonRate));
    }
    (this as any).__tr = { tick: t, daylight, seasonPhase, seasonMoisture };
    if (this.worldStochCfg?.enabled && this.worldStochState) {
      (this as any).__tr.weatherId = this.worldStochState.weather;
      (this as any).__tr.weather = WEATHER_NAMES[this.worldStochState.weather];
      (this as any).__tr.weatherMoisture = this.worldStochState.weatherMoisture;
      (this as any).__tr.weatherGrowth = this.worldStochState.weatherGrowth;
    }
    const pol = this.brainCfg.policy;
    this.policySigmaVal = pol?.mode === 'gaussian' ? policySigma(pol, t) : 0;

    // 1. spatial hash rebuild + alive id snapshot (ascending id order)
    this.spatial.clear();
    this.tickDeaths = 0;
    this.lastDonation = 0;
    this.aliveIds.length = 0;
    this.bornQueue.length = 0;
    let births = 0;
    let deaths = 0;
    let energySum = 0;
    let waterSum = 0;
    let centroidX = 0;
    let centroidY = 0;
    let dStarv = 0;
    let dThirst = 0;
    let dAge = 0;
    let dPred = 0;
    let dEscape = 0;

    for (const a of this.agents.values()) {
      if (a.alive) {
        this.spatial.insert(a.id, a.x, a.y);
        this.aliveIds.push(a.id);
      }
    }

    // ecology grounding: per-level alive population + density-dependent crowding
    // penalty. A level whose relative share exceeds its real-world (GBIF) expected
    // fraction is over-abundant -> crowding stress, gating energy and reproduction.
    // Falls back to no penalty when ungrounded.
    this.groundLevelPop.fill(0);
    this.groundCrowd.fill(0);
    if (this.groundEcoFra) {
      for (const a of this.agents.values()) {
        if (!a.alive) continue;
        const lv = a.trophicLevel;
        if (lv >= 0 && lv < 5) this.groundLevelPop[lv]++;
      }
      const popSum = this.groundLevelPop[0] + this.groundLevelPop[1] + this.groundLevelPop[2] + this.groundLevelPop[3] + this.groundLevelPop[4];
      if (popSum > 0) {
        for (let lv = 0; lv < 5; lv++) {
          const actual = this.groundLevelPop[lv]! / popSum;
          const expected = this.groundEcoFra[lv] ?? 0;
          this.groundCrowd[lv] = expected > 0 ? Math.max(0, actual / expected - 1) : 0;
        }
      }
    }

    // 2-4. sensor sampling + brain forward pass + actions (deterministic order)
    const sensors = this.sensors;
    const hidden = this.hidden;
    const out = this.out;
    const sample = this.sample;
    const neighbors = this.neighbors;
    const w = this.deltaW;
    w.off = 0;
    w.u8(MTX.DELTA);
    w.u32(t);
    const countOffset = w.off;
    w.u16(0);
    let prevId = 0;
    let deltaCount = 0;
    const omicsTotals = new OmicsTotals();

    for (let i = 0; i < this.aliveIds.length; i++) {
      const a = this.agents.get(this.aliveIds[i]!)!;
      if (!a.alive) continue; // killed mid-tick by a predator

      if (a.pausedTicks > 0) {
        a.pausedTicks--;
        prevId = this.writeAgent(w, prevId, a, ST.PAUSED, cap, countOffset, ++deltaCount);
        energySum += a.energy;
        waterSum += a.water;
        centroidX += a.x;
        centroidY += a.y;
        continue;
      }

      a.age += ts;
      if (a.energy <= 0 || a.water <= 0 || a.age > this.params.agentMaxAge * a.phenotype.longevity) {
        const cause: DeathCause = a.water <= 0 ? 'thirst' : a.energy <= 0 ? (a.lastHuntedTick === t ? 'predation' : 'starvation') : 'age';
        this.kill(a, t, cause);
        deaths++;
        if (cause === 'starvation') dStarv++;
        else if (cause === 'thirst') dThirst++;
        else if (cause === 'predation') dPred++;
        else dAge++;
        prevId = this.writeAgent(w, prevId, a, ST.DEAD, cap, countOffset, ++deltaCount);
        continue;
      }

      // THE FRACTAL IS THE SYSTEM: each agent IS an orbit point z -> z^2 + c,
      // one iteration per tick. Orbits that diverge past |z| = 2 have escaped
      // the set and go extinct — boundedness is a survival pressure. Orbit
      // richness (flux) also drives niche productivity: boundary orbits run
      // hot (better feeding, cheaper upkeep), deep interior orbits are stable
      // but lean. Lineages evolve where they are bounded; the set drawn on
      // screen is literally the persistence map of life.
      a.orbitDepth = Math.min(ORBIT_DEPTH_CAP, a.orbitDepth + 1);
      const ozRe = a.zRe;
      const ozIm = a.zIm;
      const nr = ozRe * ozRe - ozIm * ozIm + a.cRe;
      const ni = 2 * ozRe * ozIm + a.cIm;
      a.zRe = nr;
      a.zIm = ni;
      const zmag2 = nr * nr + ni * ni;
      if (zmag2 > ESCAPE_B2) {
        this.markEscape(a);
        this.kill(a, t, 'escape');
        deaths++;
        dEscape++;
        prevId = this.writeAgent(w, prevId, a, ST.DEAD, cap, countOffset, ++deltaCount);
        continue;
      }
      const flux = FLUX_MIN + (FLUX_MAX - FLUX_MIN) * clamp(zmag2 / ESCAPE_B2, 0, 1);
    (this as any).__tr.zmag2 = zmag2;
    (this as any).__tr.flux = flux;

      const pheno = a.phenotype;
      const size = pheno.size;
      const diet = pheno.diet;
      const sense = pheno.senseRadius;
      sampleGridInto(this.grid, a.x, a.y, sample);

      // chemistry terrain sampling (O2, pH, toxin, minerals at agent position)
      const chemIdx = gridIdx(this.grid, a.x, a.y);
      const localO2 = this.chemTerrain.O2[chemIdx] ?? 0.3;
      const localPH = this.chemTerrain.pH[chemIdx] ?? PH_NEUTRAL;
      const localToxin = this.chemTerrain.toxin[chemIdx] ?? 0;
      const localMinerals = this.chemTerrain.minerals[chemIdx] ?? 0.15;

      // neighbor scan (positions are the tick-start snapshot => deterministic).
      // Self is excluded: hunting must target prey, not bite its own tail.
      const nbCount = this.spatial.queryNeighbors(a.x, a.y, sense, neighbors, NEIGHBOR_MAX);
      (this as any).__tr.nbCount = nbCount;
      let nearestD2 = Infinity;
      let nearestId = -1;
      let inRadius = 0;
      let threatD2 = Infinity;
      let sumVx = 0;
      let sumVy = 0;
      let sumX = 0;
      let sumY = 0;
      let sepX = 0;
      let sepY = 0;
      let sepCount = 0;
      const sepR2 = (SEPARATION_RADIUS * size) ** 2;
      for (let k = 0; k < nbCount; k++) {
        const nb = this.agents.get(neighbors[k]!)!;
        if (!nb.alive || nb.id === a.id) continue;
        const ddx = nb.x - a.x;
        const ddy = nb.y - a.y;
        const d2 = ddx * ddx + ddy * ddy;
        if (d2 < nearestD2) {
          nearestD2 = d2;
          nearestId = nb.id;
        }
        if (d2 <= sense * sense) inRadius++;
        if (nb.phenotype.diet > 0.6 && nb.phenotype.size >= size && d2 < threatD2) threatD2 = d2;
        // drive accumulators (pattern instincts steer thrust below)
        sumVx += nb.vx;
        sumVy += nb.vy;
        sumX += nb.x;
        sumY += nb.y;
        if (d2 > 0 && d2 <= sepR2) {
          const inv = 1 / Math.sqrt(d2);
          sepX += -ddx * inv;
          sepY += -ddy * inv;
          sepCount++;
        }
      }

      sensors[0] = sample.height;
      sensors[1] = a.energy / cap;
      sensors[2] = sample.moisture;
      sensors[3] = sample.hazard;
      sensors[4] = Number.isFinite(nearestD2) ? Math.min(1, Math.sqrt(nearestD2) / sense) : 1;
      sensors[5] = Math.min(1, inRadius / 8);
      sensors[6] = sample.cap > 0 ? Math.min(1, sample.food / sample.cap) : 0;
      sensors[7] = sample.cap > 0 ? Math.min(1, sample.meat / Math.max(1, sample.cap)) : 0;
      sensors[8] = sample.signal;
      sensors[9] = seasonPhase;
      sensors[10] = Number.isFinite(threatD2) ? Math.min(1, Math.sqrt(threatD2) / sense) : 1;
      // own momentum (velocity normalized to the max phenotype speed) so the
      // brain can learn to manage thrust against drag, slope and inertia
      sensors[11] = clamp(a.vx / 4.5, -1, 1);
      sensors[12] = clamp(a.vy / 4.5, -1, 1);
      // soil chemistry + available nutrients: lets the brain seek productive soil
      sensors[13] = sample.cap > 0 ? Math.min(1, sample.minerals / Math.max(0.001, sample.cap)) : 0;
      sensors[14] = sample.chem;

      // POMDP perception: hidden + noisy observations, belief-filtered, then
      // blended back into the policy input so acting is belief-guided. Only
      // active when the brain (which carries the belief) is enabled.
      if (this.pomdpChannels.length > 0 && this.brainCfg.enabled && this.brainCfg.pomdp?.enabled) {
        (this as any).__tr.obsRaw = Array.from(sensors);
        stepPomdp(a.brain, sensors, this.brainCfg.pomdp!, t, a.id, this.pomdpNoise);
        (this as any).__tr.belief = Array.from(a.brain.belief);
        (this as any).__tr.obsNoise = Array.from(this.pomdpNoise.subarray(0, this.pomdpChannels.length));
      }

      (this as any).__tr.sensors = Array.from(sensors);
      (this as any).__tr.hazard = sample.hazard;

      // Energy at decision time — the reference point for the learning
      // reward (net energy gained over the whole tick).
      const energyBefore = a.energy;
      (this as any).__tr.energyBefore = energyBefore;
      let vCur = 0;
      if (this.brainCfg.enabled) {
        vCur = forwardBrain(a.brain, sensors, hidden, out);
      } else {
        forwardGenome(a.genome, sensors, hidden, out);
      }

      // stochastic policy: sample Gaussian exploration around the mean `out`
      // (reparameterized — the agent propels itself with `act`, but backprop
      // still learns the mean, so exploration and gradient descent coexist).
      // Deterministic policies just keep act = mean and consume no draws.
      const pol = this.brainCfg.policy;
      let actionOut = out;
      if (pol?.mode === 'gaussian') {
        const rngA = new SplitMix64(streamSeed(this.config.seed, t * 7 + 3, a.id));
        sampleGaussianAction(out, this.act, this.actEps, this.policySigmaVal, () => rngA.nextGaussian());
        actionOut = this.act;
        (this as any).__tr.act = Array.from(this.act);
        (this as any).__tr.eps = Array.from(this.actEps.subarray(0, 2));
        (this as any).__tr.sigma = this.policySigmaVal;
      }

      // PATTERN DRIVES: heritable instincts that steer the brain's thrust so
      // the simulation *generates* the structures the model detector reads:
      //   alignment  → flow / flocking / synchronization
      //   cohesion   → clusters / networks / orbitals
      //   separation → lattices / honeycombs / packing / voronoi
      //   circulation→ spirals / orbitals (signed: either handedness)
      //   oscillation→ waves / cycles / oscillations (periodic thrust pulse)
      //   noise      → chaos / randomness (deterministic jitter)
      const drv = a.drives;
      let driveX = 0;
      let driveY = 0;
      (this as any).__tr.dAlgY = 0;
      (this as any).__tr.dCoY = 0;
      (this as any).__tr.dSepY = 0;
      (this as any).__tr.dOscY = 0;
      (this as any).__tr.dNoiseY = 0;
      const strength = drv.alignment + drv.cohesion + drv.separation + Math.abs(drv.circulation) + drv.oscillation + drv.noise;
      if (strength > 0.001) {
        if (nbCount > 0) {
          // alignment: steer along the mean neighbour heading
          if (drv.alignment > 0.01) {
            const hm = Math.hypot(sumVx, sumVy);
            if (hm > 0.01) {
              driveX += (sumVx / hm) * drv.alignment;
              driveY += (sumVy / hm) * drv.alignment;
              (this as any).__tr.dAlgY = (sumVy / hm) * drv.alignment;
            }
          }
          // cohesion: steer toward the local centroid (with wrap-aware delta)
          if (drv.cohesion > 0.01 || Math.abs(drv.circulation) > 0.01) {
            let cdx = sumX / nbCount - a.x;
            let cdy = sumY / nbCount - a.y;
            if (cdx > WORLD / 2) cdx -= WORLD;
            else if (cdx < -WORLD / 2) cdx += WORLD;
            if (cdy > WORLD / 2) cdy -= WORLD;
            else if (cdy < -WORLD / 2) cdy += WORLD;
            const cm = Math.hypot(cdx, cdy);
            if (cm > 0.01) {
              driveX += (cdx / cm) * drv.cohesion;
              driveY += (cdy / cm) * drv.cohesion;
              (this as any).__tr.dCoY = (cdy / cm) * drv.cohesion;
              // circulation: tangential orbit around the centroid
              driveX += (-cdy / cm) * drv.circulation;
              driveY += (cdx / cm) * drv.circulation;
            }
          }
          // separation: repel from crowding (personal-space radius by size)
          if (drv.separation > 0.01 && sepCount > 0) {
            const sm = Math.hypot(sepX, sepY);
            if (sm > 0.01) {
              driveX += (sepX / sm) * drv.separation;
              driveY += (sepY / sm) * drv.separation;
              (this as any).__tr.dSepY = (sepY / sm) * drv.separation;
            }
          }
        }
        // oscillation: periodic thrust pulse. Phase is anchored to the lineage's
        // fractal parameter c (heritable, species-consistent) so populations
        // synchronize into coherent waves rather than cancelling — the detector's
        // waves/cycles read the emergent population-level periodicity.
        if (drv.oscillation > 0.01) {
          const ph = t * (0.02 + drv.oscillation * 0.1) + a.cRe * 1.2 + a.cIm * 2.4;
          (this as any).__tr.ph = ph;
          (this as any).__tr.osc = drv.oscillation;
          driveX += Math.sin(ph) * drv.oscillation;
          driveY += Math.cos(ph) * drv.oscillation;
          (this as any).__tr.dOscY = Math.cos(ph) * drv.oscillation;
          (this as any).__tr.sinPh = Math.sin(ph);
          (this as any).__tr.cosPh = Math.cos(ph);
        }
        // noise: deterministic jitter (hash of tick + id), no Math.random
        if (drv.noise > 0.01) {
          (this as any).__tr.noise = drv.noise;
          let h = Math.imul(t + 1, 374761393) ^ Math.imul(a.id + 1, 668265263);
          h = Math.imul(h ^ (h >>> 13), 1274126177);
          h ^= h >>> 16;
          const nx = ((h & 0xffff) / 32767.5 - 1) * drv.noise;
          const ny = (((h >>> 16) & 0xffff) / 32767.5 - 1) * drv.noise;
          (this as any).__tr.dNoiseY = ny;
          driveX += nx;
          driveY += ny;
        }
      }
      const thrustX = clamp(actionOut[0]! + driveX * DRIVE_SCALE, -1, 1);
      const thrustY = clamp(actionOut[1]! + driveY * DRIVE_SCALE, -1, 1);
      (this as any).__tr.out = Array.from(out);
      (this as any).__tr.driveX = driveX;
      (this as any).__tr.driveY = driveY;
      (this as any).__tr.thrustX = thrustX;
      (this as any).__tr.thrustY = thrustY;

      // movement with momentum + terrain slope physics (deterministic)
      const waterFrac = a.water / cap;
      let climbCost = 0;
      if (this.sensingOn()) {
        const m = stepMovement({
          x: a.x,
          y: a.y,
          vx: a.vx,
          vy: a.vy,
          thrustX,
          thrustY,
          speed: pheno.speed,
          size,
          ts,
          waterFrac,
          hazard: sample.hazard,
          grid: this.grid,
          worldPhysics: this.worldPhysics,
          topology: this.topology,
        });
        this.topologyEdgeHits += m.edgeHit ? 1 : 0;
        a.x = m.x;
        a.y = m.y;
        a.vx = m.vx;
        a.vy = m.vy;
        (this as any).__tr.waterFrac = waterFrac;
        (this as any).__tr.dh = m.dh;
        climbCost = m.climbCost;
      } else {
        // Sensorimotor loop disabled (adaptive-agent ablation): the agent
        // neither steers nor drifts, so it exposes no state->action feedback.
        a.vx = 0;
        a.vy = 0;
        (this as any).__tr.waterFrac = waterFrac;
        (this as any).__tr.dh = 0;
      }

      // metabolic + movement cost (scaled by size and terrain hazard); soil
      // chemistry modulates enzyme efficiency (metabolism runs cheaper on
      // favourable soils) — mild selection pressure on chem-sensing brains.
      // risk gene modulates hazard penalty: risk-tolerant agents pay less
      // metabolic cost in hazardous terrain (they've evolved to thrive there).
      const riskDiscount = 1 - a.strategy.risk * 0.3;
      const metab = pheno.metabolism * this.params.metabolismBase;
      const chemMod = 0.85 + 0.3 * sample.chem;
      (this as any).__tr.chemMod = chemMod;
      const moveMag = Math.abs(thrustX) + Math.abs(thrustY);
      // orbit richness discounts upkeep: boundary niches (flux -> 1) are energy-rich
      a.energy -= metab * size * (0.5 + sample.hazard * riskDiscount) * chemMod * ts * (1.6 - flux) + metab * size * moveMag * 0.3 * ts;
      // ecology grounding: density-dependent (crowding) metabolic stress — a level
      // over its real GBIF carrying capacity pays extra upkeep, gating reproduction
      // and driving starvation. Zero when ungrounded.
      if (this.groundCrowd[a.trophicLevel]! > 0) {
        a.energy -= metab * size * this.groundCrowd[a.trophicLevel]! * CROWDING_STRESS * ts;
      }
      // climb tax: chemical energy spent lifting body mass — converted to heat,
      // never created; descent pays nothing back (friction dissipates the gain)
      a.energy -= climbCost;

      // water balance: evaporate (sweat), absorb from moisture (amplified by drink output)
      const evap = WATER_EVAP_RATE * size * ts * (1.3 - sample.moisture * 0.6) * (1 + sample.hazard * 0.5);
      const drinkBoost = 1 + out[6]! * 3;
      const absorb = WATER_ABSORB_RATE * sample.moisture * drinkBoost * seasonMoisture * ts;
      a.water = clamp(a.water - evap + absorb, 0, cap);

      // feed on plants / carrion (efficiency driven by diet)
      if (a.energy < cap) {
        const plantEff = diet < 0.4 ? 1 : diet > 0.6 ? 0.04 : 0.5;
        if (sample.food > 0) {
          const need = cap - a.energy;
          const intake = Math.min(need, sample.food * EATING_RATE * ts * out[2]! * plantEff * size * (0.6 + 0.8 * flux));
          if (intake > 0) {
            a.energy += intake;
            a.energyAcquired += intake;
            withdrawFood(this.grid, a.x, a.y, intake);
          }
        }
        const meatEff = diet > 0.6 ? 1 : diet < 0.4 ? 0.04 : 0.6;
        if (sample.meat > 0 && a.energy < cap) {
          const need = cap - a.energy;
          const intake = Math.min(need, sample.meat * MEAT_EATING_RATE * ts * out[2]! * meatEff * size * (0.6 + 0.8 * flux));
          if (intake > 0) {
            a.energy += intake;
            a.energyAcquired += intake;
            withdrawMeat(this.grid, a.x, a.y, intake);
          }
        }
      }

      // --- agent chemistry tick ---
      const plantIntake = sample.food > 0 ? 1 : 0;
      const meatIntake = sample.meat > 0 ? 1 : 0;
      const chemEnergyDelta = tickAgentChemistry(
        a.chemistry, plantIntake, meatIntake, sample.moisture,
        localO2, localPH, localToxin, localMinerals,
        diet, a.genome[124] ?? 0.5, a.genome[125] ?? 0.5,
        a.genome[126] ?? 0.5, a.genome[127] ?? 0.5, ts,
        this.groundStoich,
      );
      a.energy = clamp(a.energy + chemEnergyDelta * cap * 0.01, 0, cap);

      // --- DNA system tick ---
      const dnaGenes = decodeDnaGenes(a.genome);
      const dnaResult = tickDna(a.dna, dnaGenes, ts, new SplitMix64(streamSeed(this.config.seed, t, a.id * 7 + 1000)), a.chemistry.molecules[1]);
      a.energy = clamp(a.energy - dnaResult.atpCost * cap * 0.001, 0, cap);
      if (dnaResult.mutationsOccurred) {
        // Small integrity-based penalty
        a.energy = clamp(a.energy * (0.99 + a.dna.integrity * 0.01), 0, cap);
      }

      // --- Molecular-omics tick (opt-in via WorldConfig.omics) ---
      if (this.config.omics) {
        const o = (a.omics ??= createAgentOmics(a.genome, a.id));
        const heat =
          this.worldStochState?.weather === 3 ? 1.0 :
          this.worldStochState?.weather === 2 ? 0.8 :
          this.worldStochState?.weather === 1 ? 0.2 : this.envProfile.heat;
        omicsTotals.add(
          tickOmics(
            o, a.genome, a.dna, a.chemistry,
            { o2: localO2, food: sample.food, meat: sample.meat, ph: localPH, toxin: localToxin, water: Math.min(1, Math.max(0, sample.moisture * this.envProfile.waterFactor)), heat },
            ts,
            omicsSeed(this.config.seed, t, a.id),
            !!this.config.omicsStochastic,
            !!this.config.combinatorial,
          ),
        );
      }

      // --- Cell system tick ---
      const cellGenes = decodeCellGenes(a.genome);
      const memGenes = decodeMembraneGenes(a.genome);
      const cellResult = tickCell(a.cell, cellGenes, memGenes, a.chemistry.ions, ts, new SplitMix64(streamSeed(this.config.seed, t, a.id * 13 + 2000)), a.energy);
      a.energy = clamp(a.energy - cellResult.atpCost * cap * 0.001, 0, cap);

      // --- Cell biochemistry tick (opt-in via WorldConfig.cellBio) ---
      let foldEffect = 1;
      if (this.config.cellBio) {
        a.cell.bio = a.cell.bio ?? createCellBioState(memGenes, a.chemistry);
        const bioRng = new SplitMix64(streamSeed(this.config.seed, t, a.id * 23 + 3000));
        const bioRes = applyCellBioTick(
          a.chemistry, a.cell, a.cell.bio, memGenes, cellGenes,
          a.genome[124] ?? 0.5,
          { O2Local: localO2, mineralLocal: localMinerals, toxinLocal: localToxin, pHLocal: localPH, waterAvailable: sample.moisture },
          bioRng,
          ts,
        );
        a.energy = clamp(a.energy - bioRes.atpCost * cap * 0.001, 0, cap);
        foldEffect = bioRes.foldEffect;
      }
      // Note: phenotype.size is NOT dynamically updated from cell — it is set at
      // birth and changes only via genome mutation. The lerp was removed to avoid
      // stale local `size` variable bugs in the hunt check.

      // --- Immune system tick ---
      const immuneGenesDec = decodeImmuneGenes(a.genome);
      const immuneResponse = immuneGenesDec.innate * 0.001 + immuneGenesDec.adaptive * a.immune.adaptive * 0.001;
      if (a.immune.pathogenLoad > 0) {
        const fought = Math.min(a.immune.pathogenLoad, immuneResponse * ts);
        a.immune.pathogenLoad = Math.max(0, a.immune.pathogenLoad - fought);
        a.immune.pathogensFought += fought;
        a.energy = clamp(a.energy - IMMUNE_COST * ts * cap * 0.001, 0, cap);
        a.immune.inflammation = Math.min(1, a.immune.inflammation + fought * immuneGenesDec.inflammation * 0.01);
      }
      a.immune.inflammation *= 0.99;
      if (a.immune.inflammation > 0.5 && immuneGenesDec.autoimmunity > 0.3) {
        a.energy = clamp(a.energy - a.immune.inflammation * immuneGenesDec.autoimmunity * 0.002 * ts * cap * 0.01, 0, cap);
      }
      if (a.immune.immuneMemory > 0) a.immune.immuneMemory -= ts;
      a.immune.symbiontLoad = Math.max(0, Math.min(10, a.immune.symbiontLoad + (immuneGenesDec.symbiontTolerance * 0.001 - 0.0005) * ts));

      // --- Metabolism tick ---
      const metabGenesDec = decodeMetabGenes(a.genome);
      const basalCost = BASAL_METABOLIC_COST * metabGenesDec.basalRate * ts;
      a.energy = clamp(a.energy - basalCost * cap * 0.01, 0, cap);
      if (a.cell.mitoEfficiency > 0 && a.energy > 0) {
        const aerobicAtp = AEROBIC_ATP_RATE * metabGenesDec.aerobic * a.cell.mitoEfficiency * ts * (0.4 + 0.6 * foldEffect);
        const localO2ForMito = this.chemTerrain.O2[gridIdx(this.grid, a.x, a.y)] ?? 0.3;
        const atpGain = aerobicAtp * localO2ForMito;
        a.energy = clamp(a.energy + atpGain * cap * 0.001, 0, cap);
      }
      if (metabGenesDec.thermoregulation > 0.3) {
        a.energy = clamp(a.energy - THERMOREGULATION_COST * metabGenesDec.thermoregulation * ts * cap * 0.001, 0, cap);
      }

      // --- Predator-prey behavior ---
      const predpreyGenesDec = decodePredPreyGenes(a.genome);
      a.predprey.stealth = predpreyGenesDec.stealth;
      a.predprey.pursuit = predpreyGenesDec.pursuit;
      a.predprey.ambush = predpreyGenesDec.ambush;
      a.predprey.mimicry = predpreyGenesDec.mimicry;
      a.predprey.aposematism = predpreyGenesDec.aposematism;
      a.predprey.ticksSinceHunt++;
      if (!a.predprey.isChasing) a.predprey.ticksSinceHunt = 0;

      // Stealth: reduces detection by predators
      const effectiveSense = a.phenotype.senseRadius * (1 - a.predprey.stealth * 0.4);

      // --- Dormancy check ---
      if (a.repro.dormancy > 0.5 && a.energy < cap * 0.15) {
        a.repro.isDormant = true;
        const dormancySavings = DORMANCY_CONSERVATION;
        a.energy = clamp(a.energy - BASAL_METABOLIC_COST * (1 - dormancySavings) * ts, 0, cap);
      } else if (a.repro.isDormant && a.energy > cap * 0.3) {
        a.repro.isDormant = false;
      }

      // --- Reproduction gene tracking ---
      a.repro.ticksSinceBirth += ts;
      const maturityAge = 10 + a.repro.generationTime * 40;
      a.repro.isMature = a.repro.ticksSinceBirth >= maturityAge;

      // hunt: carnivores/omnivores attack the nearest prey when hungry
      // aggression gene modulates the hunt threshold: aggressive agents (agg > 0.5)
      // lower the brain-output threshold needed to trigger a hunt; docile agents
      // (agg < 0.5) raise it, making them less likely to attack even when the brain
      // fires the hunt output.  The gene also scales bite intensity.
      // Predator-prey enhancements: pursuit bonus, ambush damage, pack hunting
      const aggThreshold = 0.5 + (0.5 - a.strategy.aggression) * 0.4;
      if (diet > 0.5 && out[4]! > aggThreshold && nearestId >= 0 && a.energy < cap * 0.85) {
        const prey = this.agents.get(nearestId)!;
        if (prey.alive && prey.phenotype.size <= size) {
          const rng = new SplitMix64(streamSeed(this.config.seed, t, a.id));
          const relSpeed = prey.phenotype.speed / Math.max(0.1, pheno.speed);
          // Escape calculation enhanced with predator-prey genes
          const stealthBonus = prey.predprey.stealth * 0.2;
          const pursuitBonus = a.predprey.pursuit * 0.15;
          const escape = clamp(0.1 + relSpeed * 0.3 + (prey.phenotype.size > size ? 0.15 : 0) + (prey.energy / cap) * 0.15 - pursuitBonus + stealthBonus, 0, 0.7);
          if (rng.nextFloat() > escape) {
            const aggScale = 0.5 + a.strategy.aggression * 0.5;
            // Ambush bonus: stationary agents deal more damage
            const isStationary = Math.abs(a.vx) < 0.1 && Math.abs(a.vy) < 0.1;
            const ambushMult = isStationary ? (1 + a.predprey.ambush * 0.5) : 1;
            // Pack hunting bonus: nearby allies increase damage
            let packAllies = 0;
            for (let k = 0; k < nbCount; k++) {
              const nb = this.agents.get(neighbors[k]!)!;
              if (nb.alive && nb.id !== a.id && nb.species === a.species && nb.strategy.aggression > 0.5) packAllies++;
            }
            const packMult = 1 + Math.min(packAllies, 5) * PACK_BONUS * a.predpreyGenes.packHunting;
            const bite = Math.min(BITE_FRACTION * size * out[4]! * ts * cap * aggScale * ambushMult * packMult, prey.energy);
            prey.energy -= bite;
            prey.lastHuntedTick = t;
            prey.lastHuntedBy = a.id;
            prey.timesHunted++;
            a.totalHuntDamage += bite;
            if (prey.energy <= 0) {
              a.kills++;
              this.emitEvent('predation', 0.4, {
                predatorId: a.id,
                preyId: prey.id,
                x: prey.x,
                y: prey.y,
                bite,
              });
            }
            const gain = bite * 0.6;
            a.energy = Math.min(cap, a.energy + gain);
            a.energyAcquired += gain;
            a.predprey.isChasing = true;
            // Warning call: alert nearby same-species agents about the hunt
            if (a.predpreyGenes.warningCall > 0.3 && nbCount > 0) {
              for (let k = 0; k < nbCount; k++) {
                const nb = this.agents.get(neighbors[k]!)!;
                if (nb.alive && nb.id !== a.id && nb.species === a.species) {
                  // Keep a real blow landed this tick (attribution intact);
                  // a pure warning marks the tick with no killer.
                  if (nb.lastHuntedTick !== t) {
                    nb.lastHuntedTick = t;
                    nb.lastHuntedBy = -1;
                  }
                }
              }
              a.predprey.warningCalls++;
            }
          }
        }
      } else {
        a.predprey.isChasing = false;
      }

      // costly signalling: emitting pheromone burns chemical energy, so strong
      // signals are honest indicators of surplus energy (handicap principle).
      // deception gene modulates the cost: deceptive agents pay less energy per
      // unit of signal emitted (cheap talk), making their signals less reliable
      // as honest indicators — but they can still be copied by imitators.
      if (out[5]! > 0.3 && a.energy > cap * 0.15) {
        const honestCost = 1 - a.strategy.deception * 0.7;
        const cost = out[5]! * SIGNAL_COST * size * ts * honestCost;
        a.energy -= cost;
        const deposit = this.config.signalDeposit ?? 1;
        if (deposit > 0) {
          const idx = gridIdx(this.grid, a.x, a.y);
          this.grid.signal[idx] = Math.min(1, this.grid.signal[idx]! + out[5]! * SIGNAL_DEPOSIT * deposit * ts);
        }
      }

      // memetic greenbeard altruism: with a surplus, share food with the
      // nearest needy neighbour that carries the same cultural tag — culture,
      // not kinship, drives cooperation here (tag-based model).
      // cooperation gene modulates: generous agents donate at lower surplus
      // thresholds and give larger gifts; selfish agents only donate when very
      // full and give less.
      const coopThreshold = ALTRUISM_THRESHOLD - (a.strategy.cooperation - 0.5) * 0.2;
      const coopScale = 0.4 + a.strategy.cooperation * 0.6;
      if (a.energy > cap * coopThreshold && out[5]! > 0.3) {
        let kin: SimAgent | undefined;
        let kinD2 = Infinity;
        for (let k = 0; k < nbCount; k++) {
          const nb = this.agents.get(neighbors[k]!)!;
          if (!nb.alive || nb.id === a.id || Math.abs(nb.meme - a.meme) > MEME_TOLERANCE || nb.energy > cap * 0.3) continue;
          const ddx = nb.x - a.x;
          const ddy = nb.y - a.y;
          const d2 = ddx * ddx + ddy * ddy;
          if (d2 < kinD2) {
            kinD2 = d2;
            kin = nb;
          }
        }
        if (kin) {
          const gift = Math.min(a.energy - cap * 0.5, DONATION_RATE * size * ts * cap * coopScale);
          if (gift > 0) {
            a.energy -= gift;
            a.altruism += gift;
            a.totalDonated += gift;
            kin.energy = Math.min(cap, kin.energy + gift);
            kin.totalReceived += gift;
            this.lastDonation += gift;
          }
        }
      }

      // memetic transmission: imitate the most successful neighbour (prestige
      // bias) — culture spreads by copying the successful, not the related
      if (nbCount > 0) {
        let roleModel: SimAgent | undefined;
        let modelEnergy = -1;
        for (let k = 0; k < nbCount; k++) {
          const nb = this.agents.get(neighbors[k]!)!;
          if (!nb.alive || nb.id === a.id || nb.energy <= modelEnergy) continue;
          modelEnergy = nb.energy;
          roleModel = nb;
        }
        if (roleModel && roleModel.energy > a.energy && Math.abs(roleModel.meme - a.meme) > MEME_TOLERANCE) {
          const memeRng = new SplitMix64(memeSeed(this.config.seed, t, a.id));
          const copyRate = MEME_COPY_RATE * (this.config.memeCopyRate ?? 1);
          if (memeRng.nextFloat() < copyRate * ts) {
            a.meme = roleModel.meme;
          }
        }
      }

      // reproduction: asexual (clone + mutation) by default; when a compatible
      // mate is near, sexual — both parents invest and the child recombines
      // their genomes (single-point crossover). An agent can participate in
      // reproduction at most once per tick (lastReproTick guard).
      // Enhanced with reproduction genes: sexual/asexual, mate selectivity,
      // parental investment, clutch size, generation time.
      const reproThreshold = REPRO_ENERGY_THRESHOLD / pheno.fertility;
      const sexualCostMult = a.repro.sexual > 0.5 ? SEXUAL_COST_MULT : 1;
      const globalPop = this.aliveIds.length - deaths + this.bornQueue.length;
      // Ecology grounding: cap reproduction per trophic level using real GBIF
      // abundance. When ungrounded, this falls back to the flat cap.
      let canReproduce = globalPop < this.params.maxPopulation;
      if (canReproduce && this.groundEcoFra) {
        let sameLevel = 0;
        for (const other of this.agents.values()) {
          if (other.alive && other.trophicLevel === a.trophicLevel) sameLevel++;
        }
        // account for children already queued this tick at the same level
        for (const child of this.bornQueue) {
          if (child.trophicLevel === a.trophicLevel) sameLevel++;
        }
        canReproduce = sameLevel < this.levelCap(a.trophicLevel, this.params.maxPopulation);
      }
      if (
        this.reproductionOn() &&
        out[3]! > 0.5 &&
        a.lastReproTick !== t &&
        a.age >= REPRO_AGE_MIN &&
        a.repro.isMature &&
        a.energy > cap * reproThreshold * sexualCostMult &&
        canReproduce
      ) {
        // deterministic mate search over tick-start neighbours
        // Enhanced with mate selectivity: choosier agents need closer genome match
        let mate: SimAgent | undefined;
        let mateD2 = sense * sense;
        for (let k = 0; k < nbCount; k++) {
          const nb = this.agents.get(neighbors[k]!)!;
          if (!nb.alive || nb.id === a.id || nb.species !== a.species || nb.lastReproTick === t) continue;
          if (nb.age + ts < REPRO_AGE_MIN || nb.energy <= cap * (REPRO_ENERGY_THRESHOLD / nb.phenotype.fertility)) continue;
          // Mate selectivity: choosy agents prefer genetically similar mates
          const sim = genomeSimilarity(a.genome, nb.genome);
          if (a.repro.mateSelectivity > 0.5 && sim < 0.85) continue;
          const ddx = nb.x - a.x;
          const ddy = nb.y - a.y;
          const d2 = ddx * ddx + ddy * ddy;
          if (d2 <= mateD2) {
            mateD2 = d2;
            mate = nb;
          }
        }

        const childId = this.nextId++;
        const childRng = new SplitMix64(streamSeed(this.config.seed, t, childId));
        const pre = a.energy;
        const preW = a.water;
        const bPre = mate ? mate.energy : 0;
        // Parental investment: higher investment = more energy to offspring
        const investMult = 0.5 + a.repro.parentalInvestment * 0.5;
        a.energy = pre * (mate ? 0.55 * (1 - a.repro.parentalInvestment * 0.1) : 0.5 * (1 - a.repro.parentalInvestment * 0.1));
        a.water = preW * 0.5;
        a.lastReproTick = t;
        if (mate) {
          mate.energy = bPre * (0.45 * (1 - mate.repro.parentalInvestment * 0.1));
          mate.lastReproTick = t;
        }
        const mutRate = Math.min(1, 0.05 * pheno.mutability * (this.config.mutationScale ?? 1));
        const mutSigma = 0.05 * pheno.mutability * (this.config.mutationScale ?? 1);
        const recombined = this.config.recombination && mate;
        const baseGenome = mate
          ? recombined
            ? recombineGenomes(a.genome, mate.genome, childRng)
            : crossoverGenome(a.genome, mate.genome, childRng)
          : a.genome;
        const genome = mutateGenomeScaled(baseGenome, childRng, mutRate, mutSigma);
        // Count mutation supply against the *post-recombination* base: sexual
        // crossover must not be mistaken for de-novo mutation in an ablation.
        let mutatedLoci = 0;
        for (let i = 0; i < genome.length; i++) if (genome[i] !== baseGenome[i]) mutatedLoci++;
        if (nbCount > 0 && childRng.nextFloat() < LGT_RATE * pheno.mutability * (this.config.mutationScale ?? 1)) {
          const donor = this.agents.get(neighbors[childRng.nextInt(nbCount)]!);
          if (donor) {
            const before = Float32Array.from(genome);
            spliceGenome(genome, donor.genome, childRng, LGT_BLOCK);
            for (let i = 0; i < genome.length; i++) if (genome[i] !== before[i]) mutatedLoci++;
          }
        }
        this.mutationLoci += mutatedLoci;
        this.birthCount += 1;
        const childEnergy = Math.min(cap, Math.max(1, mate ? (pre + bPre) * CHILD_ENERGY_FRACTION * 0.5 * investMult : pre * CHILD_ENERGY_FRACTION * investMult));
        const childX = wrap(a.x + childRng.nextSigned() * 3);
        const childY = wrap(a.y + childRng.nextSigned() * 3);
        const childMeme = clamp(a.meme + childRng.nextGaussian() * MEME_INNOVATION, 0, 1);
        const child = this.createAgent({
          id: childId,
          parentId: a.id,
          genome,
          parentBrain: a.brain,
          x: childX,
          y: childY,
          energy: childEnergy,
          water: Math.min(cap, Math.max(0, preW * CHILD_WATER_FRACTION)),
          bornAtTick: t,
          meme: this.cultureOn() ? childMeme : 0,
        });
        a.reproductions++;
        if (mate) mate.reproductions++;
        this.agents.set(childId, child);
        this.bornQueue.push(child);
        this.emitEvent('birth', 0.15, {
          agentId: child.id,
          parentId: a.id,
          ...(mate ? { mateId: mate.id } : {}),
          species: child.species,
          x: child.x,
          y: child.y,
          energy: child.energy,
        });
        prevId = this.writeAgent(w, prevId, child, ST.BORN, cap, countOffset, ++deltaCount);
        births++;
      }

      if (a.energy <= 0 || a.water <= 0 || a.age > this.params.agentMaxAge * a.phenotype.longevity) {
        const cause: DeathCause = a.water <= 0 ? 'thirst' : a.energy <= 0 ? (a.lastHuntedTick === t ? 'predation' : 'starvation') : 'age';
        this.kill(a, t, cause);
        deaths++;
        if (cause === 'starvation') dStarv++;
        else if (cause === 'thirst') dThirst++;
        else if (cause === 'predation') dPred++;
        else dAge++;
        prevId = this.writeAgent(w, prevId, a, ST.DEAD, cap, countOffset, ++deltaCount);
        continue;
      }

      // Plastic brain learning: reward = net energy change over the tick
      // (feeding + metabolism + predation + reproduction), scaled down.
      if (this.brainCfg.enabled) {
        const reward = clamp((a.energy - energyBefore) / cap / ts, -0.05, 0.05);
        if (this.brainCfg.learn === 'backprop') {
          // SGD regularization: dropout masks + gradient noise re-drawn per
          // (agent, tick) from the same seed as all other agent streams.
          let opts: BackpropOpts | undefined;
          if ((this.brainCfg.dropout ?? 0) > 0 || (this.brainCfg.gradNoise ?? 0) > 0) {
            const rngL = new SplitMix64(streamSeed(this.config.seed, t * 11 + 1, a.id));
            const d = this.brainCfg.dropout ?? 0;
            for (let j = 0; j < MLP_HIDDEN; j++) this.dropMask[j] = d > 0 && rngL.nextFloat() < d ? 0 : 1;
            if ((this.brainCfg.gradNoise ?? 0) > 0 && this.gradNoiseVec.length > 0) {
              for (let k = 0; k < this.gradNoiseVec.length; k++) this.gradNoiseVec[k] = rngL.nextGaussian();
            }
            opts = {
              dropout: this.brainCfg.dropout ?? 0,
              dropMask: this.dropMask,
              gradNoise: this.brainCfg.gradNoise ?? 0,
              gradNoiseVec: this.gradNoiseVec,
              entropy: this.brainCfg.entropy ?? 0,
            };
          } else if ((this.brainCfg.entropy ?? 0) > 0) {
            opts = { entropy: this.brainCfg.entropy ?? 0 };
          }
          const surprise = backpropBrain(a.brain, reward, vCur, hidden, out, sensors, opts);
          this.brainSurpriseSum += surprise;
          this.brainSurpriseN++;
        } else {
          const surprise = observeBrain(a.brain, reward, vCur, hidden, out);
          this.brainSurpriseSum += surprise;
          this.brainSurpriseN++;
        }
      }

      energySum += a.energy;
      waterSum += a.water;
      centroidX += a.x;
      centroidY += a.y;
      prevId = this.writeAgent(w, prevId, a, ST.ALIVE, cap, countOffset, ++deltaCount);
    }

    w.patchU16(countOffset, deltaCount);

    // 5. regenerate resources + decay carrion; diffuse the pheromone field
    this.regenerate(ts, daylight, seasonMoisture);
    this.diffuseSignal(ts);

    // 5b. chemical terrain diffusion and source/sink terms
    tickChemTerrain(this.chemTerrain, this.grid.food, this.grid.meat, daylight, seasonMoisture, ts);

    // Phase M biome regime: explicit presets re-inject their profile bases into
    // the chemical terrain each tick so extreme / underrated worlds keep their
    // environmental identity (an anoxic trench stays anoxic). Absent preset =
    // purely legacy dynamics.
    if (this.config.environment) {
      const reinject = ENV_REINJECT_RATE * ts;
      const p = this.envProfile;
      const n = this.chemTerrain.size * this.chemTerrain.size;
      for (let i = 0; i < n; i++) {
        this.chemTerrain.O2[i] = Math.max(0, Math.min(1,
          this.chemTerrain.O2[i]! + (p.o2 - this.chemTerrain.O2[i]!) * reinject));
        this.chemTerrain.pH[i] = Math.max(3, Math.min(11,
          this.chemTerrain.pH[i]! + (p.ph - this.chemTerrain.pH[i]!) * reinject));
        this.chemTerrain.toxin[i] = Math.max(0, Math.min(1,
          this.chemTerrain.toxin[i]! + (p.toxin - this.chemTerrain.toxin[i]!) * reinject));
        this.chemTerrain.minerals[i] = Math.max(0, Math.min(1,
          this.chemTerrain.minerals[i]! + (p.minerals - this.chemTerrain.minerals[i]!) * reinject));
      }
    }

    // 6. math module updates (chaos, evolution, vector fields, CA, tensors)
    const lyapunovExp = updateLyapunov(this.lyapunov, this.agents, WORLD, ts);
    updateReplicator(this.replicator, this.agents, ts);
    computeVectorFields(this.vectorField, this.grid, this.agents);
    seedFromAgents(this.gameOfLife, this.agents, 1, TERRAIN_CELL);
    stepGameOfLife(this.gameOfLife);
    updateTensors(this.tensors, this.agents);
    // Feed dominant eigenvector into replicator projection every 100 ticks
    if (t % 100 === 0 && this.tensors.agentCount > 2) {
      const ev = this.tensors.eigenvectors;
      const mean = this.tensors.mean;
      setProjection(this.replicator, [ev[0]!, ev[8]!, ev[16]!, ev[24]!], mean[0]!);
    }

    // 7. ecosystem grid update: track trophic levels and resource distribution
    const agentList: Array<{ x: number; y: number; alive: boolean; diet: number; energy: number; trophicLevel: number }> = [];
    for (const a of this.agents.values()) {
      if (a.alive) {
        agentList.push({ x: a.x, y: a.y, alive: true, diet: a.phenotype.diet, energy: a.energy, trophicLevel: a.trophicLevel });
        // Compute fitness for living agents
        const survivalFrac = a.age / (this.params.agentMaxAge * a.phenotype.longevity);
        const metabolicFrac = a.energyAcquired > 0 ? Math.min(1, a.energy / Math.max(1, a.energyAcquired * 0.5)) : 0;
        a.fitness = computeFitness(
          Math.min(1, a.energyAcquired / Math.max(1, cap * 0.5)),
          1 - survivalFrac,
          Math.min(1, a.reproductions * 0.2),
          Math.min(1, a.altruism * 0.1),
          metabolicFrac,
          this.selectionState.pressure,
        );
      }
    }
    updateEcosystemGrid(this.ecosystemGrid, agentList, ts);

    // birth bookkeeping
    for (const child of this.bornQueue) {
      this.aliveIds.push(child.id);
      energySum += child.energy;
      waterSum += child.water;
      centroidX += child.x;
      centroidY += child.y;
    }

    // events
    const aliveCountFinal = this.aliveIds.length;
    const speciesCount = this.countSpecies();
    const avgEnergy = aliveCountFinal > 0 ? energySum / aliveCountFinal : 0;
    const avgWater = aliveCountFinal > 0 ? waterSum / aliveCountFinal : 0;
    const centroidXAvg = aliveCountFinal > 0 ? centroidX / aliveCountFinal : 0;
    const centroidYAvg = aliveCountFinal > 0 ? centroidY / aliveCountFinal : 0;
    this.detectEvents(aliveCountFinal, speciesCount, centroidXAvg, centroidYAvg, dStarv, dThirst, dPred);
    this.prevAlive = aliveCountFinal;
    this.prevSpecies = speciesCount;
    this.prevCentroidX = centroidXAvg;
    this.prevCentroidY = centroidYAvg;
    this.lastBirths = births;
    this.lastDeaths = deaths;
    this.lastEscapeDeaths = dEscape;
    this.lastDeathCauses = { starvation: dStarv, thirst: dThirst, age: dAge, predation: dPred, escape: dEscape, intervention: deaths - dStarv - dThirst - dAge - dPred - dEscape };

    // 8. selection pressure update (after aliveCountFinal is computed)
    this.selectionState.pressure = computeSelectionPressure(
      aliveCountFinal,
      this.params.maxPopulation,
      dPred / Math.max(1, aliveCountFinal),
      aliveCountFinal > 0 ? energySum / aliveCountFinal / cap : 0,
      this.params.agentMaxAge,
      births / Math.max(1, aliveCountFinal),
    );

    const stats: SimStats = {
      tick: t,
      population: this.agents.size,
      aliveCount: aliveCountFinal,
      deadCount: deaths,
      speciesCount,
      avgEnergy,
      avgWater,
      tickRate: 0, // set by host
      stateHash: this.computeStateHash(),
      timeScale: ts,
      energySum,
      births,
      deaths,
      escapeDeaths: dEscape,
      ...this.distributionObservables(),
      cooperation: energySum > 0 ? this.lastDonation / energySum : 0,
      // math module observables
      lyapunovExponent: lyapunovExp,
      selectionEntropy: this.replicator.selectionEntropy,
      fixationIndex: this.replicator.fixationIndex,
      priceEquationSelection: this.replicator.priceEquation.selection,
      foodGradMagMean: this.vectorField.globals.foodGradMagMean,
      foodLapMean: this.vectorField.globals.foodLapMean,
      velocityDivMean: this.vectorField.globals.velocityDivMean,
      velocityCurlMagMean: this.vectorField.globals.velocityCurlMagMean,
      caAliveFraction: this.gameOfLife.globals.aliveFraction,
      caComplexity: this.gameOfLife.globals.complexity,
      traitTotalVariance: this.tensors.totalVariance,
      traitEffectiveDim: this.tensors.effectiveDimension,
      traitAnisotropy: this.tensors.anisotropy,
      ...this.chemistryObservables(),
      ...this.biologyObservables(),
      ...this.brainStats(),
      // Biophysics observables — computed by the Rust/WASM engine (opt-in
      // `WorldConfig.biophysics`); the TS reference reports neutral zeros so
      // it stays a valid, wire-compatible SimStats without running the field.
      meanForce: 0,
      clusterCount: 0,
      clusterOrder: 0,
      rotationalOrder: 0,
      spatialEntropy: 0,
      dimensionalEntropy: 0,
      orgIndex: 0,
      massConservation: 0,
      symmetryDrift: 0,
      cascadeRate: 0,
      bondEnergy: 0,
      reactionEnthalpy: 0,
      carnotEfficiency: 0,
      heatWaste: 0,
      enginePower: 0,
      radiationField: 0,
      thermalBalance: 0,
      ...this.omicsObservables(omicsTotals, aliveCountFinal),
    };

    this.lastDeltaBytes = w.finish();
    this.lastDeltaCount = deltaCount;

    // take, don't share: the returned events are handed to the caller
    // (recorder/sink) and the engine starts the next tick with an empty
    // buffer. Also means events pushed between ticks (e.g. an intervention
    // applied while paused) are delivered with the next tick instead of
    // being cleared away at tick start.
    const events = this.events;
    this.events = [];
    return {
      tick: t,
      delta: this.lastDeltaBytes,
      deltaCount,
      stats,
      events,
    };
  }

  private writeAgent(
    w: ByteWriter,
    prevId: number,
    a: SimAgent,
    state: number,
    cap: number,
    _countOffset: number,
    _count: number,
  ): number {
    w.varint(a.id - prevId);
    w.varint(Math.round(a.x * FP));
    w.varint(Math.round(a.y * FP));
    const e = Math.max(0, Math.min(1, a.energy / cap));
    w.u8(Math.round(e * 255));
    w.u8(state);
    w.u32(a.species & 0xffffffff);
    w.u8(Math.round(a.meme * 255));
    return a.id;
  }

  private kill(a: SimAgent, t: number, cause: DeathCause = 'age'): void {
    a.alive = false;
    a.diedAtTick = t;
    a.finalFitness = a.energyAcquired + a.kills * 60 + a.reproductions * 50 + a.altruism * 0.5 + a.age;
    // carrion: leftover body mass enters the meat pool
    const idx = gridIdx(this.grid, a.x, a.y);
    const meatCap = Math.max(0.5, this.grid.cap[idx]!);
    this.grid.meat[idx] = Math.min(meatCap, this.grid.meat[idx]! + a.energy * 0.4);
    this.deadAgents.push(a.id);
    this.tickDeaths++;
    // Never evict an agent that died in the current tick: it is still referenced
    // by this tick's spatial hash, so dropping it would leave dangling neighbor ids.
    while (this.deadAgents.length - this.tickDeaths > this.deadRetention) {
      this.agents.delete(this.deadAgents.shift()!);
    }
    this.emitEvent('death', DEATH_SIG[cause], {
      agentId: a.id,
      cause,
      species: a.species,
      x: a.x,
      y: a.y,
      age: a.age,
      energy: a.energy,
      ...(cause === 'predation' && a.lastHuntedTick === t && a.lastHuntedBy >= 0 ? { killerId: a.lastHuntedBy } : {}),
    });
  }

  private regenerate(ts: number, daylight: number, seasonMoisture: number): void {
    const wst = this.worldStochCfg?.enabled && this.worldStochState ? this.worldStochState : undefined;
    const growthMul = wst ? wst.weatherGrowth : 1;
    const ouMul = wst ? wst.ouMul : null;
    const flags = wst ? wst.burstFlags : null;
    // energy budget (insolation normalised to Earth) gates plant regrowth;
    // mass-recycling rate (gravity) gates how fast carrion returns to soil
    const energyBudgetRatio = this.worldPhysics.conservationLaws.energyBudgetRatio;
    const massRecyclingRate = this.worldPhysics.conservationLaws.massRecyclingRate;
    const rate = this.params.foodRegenRate * ts * (0.2 + 0.8 * daylight) * (0.4 + 0.6 * seasonMoisture) * growthMul * energyBudgetRatio;
    const decay = MEAT_DECAY * ts * massRecyclingRate;
    const f = this.grid.food;
    const m = this.grid.meat;
    const c = this.grid.cap;
    const mn = this.grid.minerals;
    const base = this.grid.baseMinerals;
    for (let i = 0; i < f.length; i++) {
      const cellCap = c[i]!;
      // decomposition: decaying carrion returns nutrients to the soil (a closed
      // nutrient loop — biomass energy is dissipated as heat, matter is kept)
      const meat = m[i]!;
      const decayed = meat * decay;
      if (decayed > 0) {
        m[i] = Math.max(0, meat - decayed);
        mn[i] = Math.min(cellCap, mn[i]! + decayed * DECOMP_FRACTION);
      }
      // plant growth is gated by soil nutrients: growth consumes minerals.
      // Weather multipliers and the OU fluctuation field scale the rate; a
      // cell hit by a Poisson burst event gets an instantaneous resource pulse.
      const food = f[i]!;
      if (food < cellCap) {
        const nutrientFrac = cellCap > 0 ? Math.min(1, mn[i]! / Math.max(0.001, cellCap)) : 0;
        const cellMul = ouMul ? ouMul[i]! : 1;
        let grown = Math.min(cellCap - food, cellCap * rate * (0.5 + 0.5 * nutrientFrac) * cellMul);
        if (flags && flags[i] === 1) {
          grown = Math.min(cellCap - food, grown + cellCap * BURST_REGEN_BOOST);
        }
        if (grown > 0) {
          f[i] = food + grown;
          mn[i] = Math.max(0, mn[i]! - grown * PLANT_NUTRIENT_USE);
        }
      }
      // weathering slowly restores the soil toward its geological richness
      const target = base[i]! * cellCap * 0.25;
      mn[i] = mn[i]! + (target - mn[i]!) * MINERAL_WEATHERING * ts;
    }
  }

  private diffuseSignal(ts: number): void {
    const sig = this.grid.signal;
    const ns = this.signalNext;
    const size = this.grid.size;
    const d = SIGNAL_DIFFUSE;
    const keep = 1 - 4 * d;
    const decay = Math.pow(SIGNAL_DECAY, ts);
    const lastRow = (size - 1) * size;
    for (let y = 0; y < size; y++) {
      const row = y * size;
      const up = y > 0 ? row - size : lastRow;
      const dn = y < size - 1 ? row + size : 0;
      for (let x = 0; x < size; x++) {
        const i = row + x;
        // toroidal wrap: the world is a torus, so signals must not leak off the
        // edges or the margins would desync from the wrapped movement of agents
        const l = x > 0 ? i - 1 : row + size - 1;
        const r = x < size - 1 ? i + 1 : row;
        const u = sig[up + x]!;
        const dwn = sig[dn + x]!;
        ns[i] = (sig[i]! * keep + d * (sig[l]! + sig[r]! + u + dwn)) * decay;
      }
    }
    const tmp = this.grid.signal;
    this.grid.signal = ns;
    this.signalNext = tmp;
  }

  // ---------------------------------------------------------------------------
  // Stats / hashing
  // ---------------------------------------------------------------------------

  countSpecies(): number {
    const seen = new Set<number>();
    for (const a of this.agents.values()) if (a.alive) seen.add(a.species);
    return seen.size;
  }

  /**
   * Phase D: the non-genetic (cultural) channel is on unless explicitly muted
   * (`memeCopyRate = 0`), which zeroes founder tags and stops vertical and
   * horizontal meme transmission so the culture detector can be ablated.
   */
  private cultureOn(): boolean {
    return (this.config.memeCopyRate ?? 1) > 0;
  }

  /** Reproduction master switch: `false` forbids division entirely so no
   *  offspring appear (self-replication ablation). Absent/`true` = legacy. */
  private reproductionOn(): boolean {
    return this.config.reproduction ?? true;
  }

  /** Sensorimotor switch: `false` freezes the sense->steer loop so agents hold
   *  position (adaptive-agent ablation). Absent/`true` = legacy behaviour. */
  private sensingOn(): boolean {
    return this.config.sensing ?? true;
  }

  /**
   * Complex-systems observables over the alive population: Shannon entropy,
   * Simpson diversity and LMC complexity of the species-abundance distribution,
   * plus carnivore share, cultural (meme) diversity, mean lifetime altruism,
   * meme entropy, the species<->culture mutual information, and game-theory
   * observables (strategy gene distributions, inequality, donation ratio).
   */
  private distributionObservables(): {
    entropy: number;
    diversity: number;
    complexity: number;
    predatorFraction: number;
    cultureCount: number;
    meanAltruism: number;
    memeEntropy: number;
    speciesMemeMI: number;
    meanAggression: number;
    meanCooperation: number;
    meanRisk: number;
    meanDeception: number;
    predatorGeneFraction: number;
    preyGeneFraction: number;
    energyInequality: number;
    donationRatio: number;
  } {
    const counts = new Map<number, number>();
    const memeCounts = new Map<number, number>();
    const joint = new Map<string, number>();
    const cultures = new Set<number>();
    let carnivores = 0;
    let total = 0;
    let altruismSum = 0;
    let aggSum = 0;
    let coopSum = 0;
    let riskSum = 0;
    let decepSum = 0;
    let predGeneCount = 0;
    let preyGeneCount = 0;
    let donationSum = 0;
    let donationCount = 0;
    const fitnesses: number[] = [];
    const cap = this.params.energyCapacity;
    for (const a of this.agents.values()) {
      if (!a.alive) continue;
      total++;
      if (a.phenotype.diet > 0.6) carnivores++;
      altruismSum += a.altruism;
      aggSum += a.strategy.aggression;
      coopSum += a.strategy.cooperation;
      riskSum += a.strategy.risk;
      decepSum += a.strategy.deception;
      if (a.strategy.aggression > 0.6) predGeneCount++;
      if (a.strategy.aggression < 0.4) preyGeneCount++;
      if (a.energyAcquired > 0) {
        donationSum += a.totalDonated / a.energyAcquired;
        donationCount++;
      }
      fitnesses.push(a.energyAcquired);
      const mb = Math.round(a.meme / MEME_TOLERANCE);
      counts.set(a.species, (counts.get(a.species) ?? 0) + 1);
      memeCounts.set(mb, (memeCounts.get(mb) ?? 0) + 1);
      joint.set(`${a.species}|${mb}`, (joint.get(`${a.species}|${mb}`) ?? 0) + 1);
      cultures.add(mb);
    }
    if (total === 0) {
      return {
        entropy: 0,
        diversity: 0,
        complexity: 0,
        predatorFraction: 0,
        cultureCount: 0,
        meanAltruism: 0,
        memeEntropy: 0,
        speciesMemeMI: 0,
        meanAggression: 0,
        meanCooperation: 0,
        meanRisk: 0,
        meanDeception: 0,
        predatorGeneFraction: 0,
        preyGeneFraction: 0,
        energyInequality: 0,
        donationRatio: 0,
      };
    }
    const entropyOf = (map: Map<number, number>): number => {
      let h = 0;
      for (const c of map.values()) {
        const p = c / total;
        if (p > 0) h -= p * Math.log2(p);
      }
      return h;
    };
    const n = counts.size;
    let h = 0;
    let simpson = 0;
    let diseq = 0;
    const invN = 1 / n;
    for (const c of counts.values()) {
      const p = c / total;
      if (p > 0) h -= p * Math.log2(p);
      simpson += p * p;
      const d = p - invN;
      diseq += d * d;
    }
    // species<->culture mutual information, normalised to [0,1]
    let jointH = 0;
    for (const c of joint.values()) {
      const p = c / total;
      if (p > 0) jointH -= p * Math.log2(p);
    }
    const hMeme = entropyOf(memeCounts);
    const mi = h > 0 && hMeme > 0 ? Math.max(0, h + hMeme - jointH) : 0;
    const miNorm = mi > 0 ? Math.min(1, mi / Math.min(h, hMeme)) : 0;
    // Gini coefficient of lifetime energy acquired
    fitnesses.sort((a, b) => a - b);
    let giniNum = 0;
    for (let i = 0; i < fitnesses.length; i++) {
      giniNum += (2 * (i + 1) - fitnesses.length - 1) * fitnesses[i]!;
    }
    const giniDen = fitnesses.length * fitnesses.reduce((s, v) => s + v, 0);
    const gini = giniDen > 0 ? Math.max(0, giniNum / giniDen) : 0;
    return {
      entropy: h,
      diversity: 1 - simpson,
      complexity: h * diseq,
      predatorFraction: carnivores / total,
      cultureCount: cultures.size,
      meanAltruism: cap > 0 ? altruismSum / total / cap : 0,
      memeEntropy: hMeme,
      speciesMemeMI: miNorm,
      meanAggression: aggSum / total,
      meanCooperation: coopSum / total,
      meanRisk: riskSum / total,
      meanDeception: decepSum / total,
      predatorGeneFraction: predGeneCount / total,
      preyGeneFraction: preyGeneCount / total,
      energyInequality: gini,
      donationRatio: donationCount > 0 ? donationSum / donationCount : 0,
    };
  }

  private omicsObservables(totals: OmicsTotals, aliveCount: number): OmicsAgg {
    if (!this.config.omics) return zeroOmicsAgg();
    return totals.mean(aliveCount);
  }

  private chemistryObservables(): {
    meanATP: number; meanEnzyme: number; meanToxin: number; meanPH: number;
    chemicalDiversity: number; meanGlucose: number; meanProtein: number;
    activeSynthesisFraction: number; terrainOxygen: number; terrainPH: number;
    terrainToxin: number;
  } {
    let atpSum = 0, enzymeSum = 0, toxinSum = 0, phSum = 0;
    let glucoseSum = 0, proteinSum = 0, activeSynth = 0;
    let chemDivAcc = 0;
    let total = 0;
    const invMaxMol = 1 / CHEM_MAX_MOLECULE;
    const invMaxEnz = 1 / CHEM_MAX_ENZYME;
    for (const a of this.agents.values()) {
      if (!a.alive) continue;
      total++;
      const c = a.chemistry;
      atpSum += c.molecules[1]! * invMaxMol;
      glucoseSum += c.molecules[0]! * invMaxMol;
      proteinSum += c.molecules[6]! * invMaxMol;
      toxinSum += c.molecules[7]! * invMaxMol;
      phSum += c.pH;
      let eSum = 0;
      for (let e = 0; e < ENZYME_TYPE_COUNT; e++) {
        const v = c.enzymes[e]! * invMaxEnz;
        eSum += v;
      }
      enzymeSum += eSum / ENZYME_TYPE_COUNT;
      if (c.enzymes[1]! > CHEM_MAX_ENZYME * 0.3) activeSynth++;
      // Shannon entropy of elemental distribution
      let elemTotal = 0;
      for (let i = 0; i < ELEMENT_COUNT; i++) elemTotal += c.elements[i]!;
      if (elemTotal > 0) {
        let eh = 0;
        for (let i = 0; i < ELEMENT_COUNT; i++) {
          const p = c.elements[i]! / elemTotal;
          if (p > 0) eh -= p * Math.log2(p);
        }
        chemDivAcc += eh;
      }
    }
    // terrain averages
    let tO2 = 0, tPH = 0, tToxin = 0;
    const n = this.chemTerrain.size * this.chemTerrain.size;
    for (let i = 0; i < n; i++) {
      tO2 += this.chemTerrain.O2[i]!;
      tPH += this.chemTerrain.pH[i]!;
      tToxin += this.chemTerrain.toxin[i]!;
    }
    const invN = n > 0 ? 1 / n : 0;
    return {
      meanATP: total > 0 ? atpSum / total : 0,
      meanEnzyme: total > 0 ? enzymeSum / total : 0,
      meanToxin: total > 0 ? toxinSum / total : 0,
      meanPH: total > 0 ? phSum / total : 0,
      chemicalDiversity: total > 0 ? chemDivAcc / total : 0,
      meanGlucose: total > 0 ? glucoseSum / total : 0,
      meanProtein: total > 0 ? proteinSum / total : 0,
      activeSynthesisFraction: total > 0 ? activeSynth / total : 0,
      terrainOxygen: tO2 * invN,
      terrainPH: tPH * invN,
      terrainToxin: tToxin * invN,
    };
  }

  private biologyObservables(): {
    meanDNAIntegrity: number; meanPathogenLoad: number; meanMembranePot: number;
    meanBodyTemp: number; meanTrophicLevel: number; speciationRate: number;
    extinctionRate: number; biodiversityIndex: number; meanFitness: number;
    meanDivisionProgress: number;
  } {
    let dnaIntSum = 0, pathSum = 0, memPotSum = 0, tempSum = 0;
    let trophicSum = 0, fitnessSum = 0, divProgSum = 0;
    let total = 0;
    const trophicCounts = [0, 0, 0, 0, 0];
    for (const a of this.agents.values()) {
      if (!a.alive) continue;
      total++;
      dnaIntSum += a.dna.integrity;
      pathSum += a.immune.pathogenLoad;
      memPotSum += a.cell.membranePotential;
      tempSum += a.metabolism.bodyTemperature;
      trophicSum += a.trophicLevel;
      fitnessSum += a.fitness.total;
      divProgSum += a.cell.divisionProgress;
      if (a.trophicLevel >= 0 && a.trophicLevel < 5) trophicCounts[a.trophicLevel]++;
    }
    // Shannon diversity across trophic levels
    const tTotal = trophicCounts.reduce((a, b) => a + b, 0);
    let biodiversity = 0;
    if (tTotal > 0) {
      for (const c of trophicCounts) {
        if (c <= 0) continue;
        const p = c / tTotal;
        biodiversity -= p * Math.log(p);
      }
      biodiversity /= Math.log(5);
    }
    return {
      meanDNAIntegrity: total > 0 ? dnaIntSum / total : 1,
      meanPathogenLoad: total > 0 ? pathSum / total : 0,
      meanMembranePot: total > 0 ? memPotSum / total : -70,
      meanBodyTemp: total > 0 ? tempSum / total : 37,
      meanTrophicLevel: total > 0 ? trophicSum / total : 0,
      speciationRate: this.selectionState.speciationEvents,
      extinctionRate: this.selectionState.extinctionEvents,
      biodiversityIndex: biodiversity,
      meanFitness: total > 0 ? fitnessSum / total : 0,
      meanDivisionProgress: total > 0 ? divProgSum / total : 0,
    };
  }

  computeStateHash(): number {
    let h = 0x811c9dc5;
    for (let i = 0; i < this.aliveIds.length; i++) {
      const a = this.agents.get(this.aliveIds[i]!)!;
      h ^= (a.id >>> 0) ^ Math.round(a.x * 10) ^ Math.round(a.y * 10) ^ Math.round(a.energy * 100) ^ Math.round(a.water * 100);
      h ^= Math.round(a.vx * 100) ^ Math.round(a.vy * 100) ^ Math.round(a.meme * 1000);
      h ^= Math.round(a.zRe * 100) ^ Math.round(a.zIm * 100) ^ a.orbitDepth;
      // plastic brain signature: aggregate learned synapses + critic +
      // recurrent memory so replay of a life with learning is verifiable.
      let bw = 0;
      for (const x of a.brain.w) bw += x;
      let bh = 0;
      for (const x of a.brain.h) bh += x;
      h ^= Math.round(bw * 512) ^ Math.round(a.brain.v * 4096) ^ Math.round(bh * 4096) ^ Math.round(a.brain.lastReward * 16384);
      h = Math.imul(h, 0x01000193);
    }
    h ^= this.tickNum;
    h = Math.imul(h, 0x01000193);
    return h >>> 0;
  }

  /**
   * Typed event emission: policy-filtered push into the current tick's event
   * buffer (drained by `tick()` — see the take semantics at tick end).
   */
  private emitEvent<T extends EventType>(
    type: T,
    significance: number,
    data: Extract<SimEvent, { type: T }>['data'],
  ): void {
    const include = this.config.eventPolicy?.include;
    if (include && !include.includes(type)) return;
    const ev = { worldId: this.config.id, tick: this.tickNum, type, significance, data } as unknown as SimEvent;
    this.events.push(ev);
  }

  detectEvents(aliveCount: number, speciesCount: number, cx: number, cy: number, dStarv: number, dThirst: number, dPred: number): void {
    // extinction
    if (this.prevAlive > 20 && aliveCount < this.prevAlive * 0.5 && aliveCount > 0) {
      this.emitEvent('extinction', 1 - aliveCount / this.prevAlive, { from: this.prevAlive, to: aliveCount });
    }
    // cambrian (rapid speciation burst)
    if (this.prevSpecies > 0 && speciesCount > this.prevSpecies * 1.3 && speciesCount - this.prevSpecies >= 3) {
      this.emitEvent('cambrian', (speciesCount - this.prevSpecies) / speciesCount, { from: this.prevSpecies, to: speciesCount });
    }
    // migration (large centroid shift)
    const moved = Math.hypot(cx - this.prevCentroidX, cy - this.prevCentroidY);
    if (moved > WORLD * 0.1) {
      this.emitEvent('migration', Math.min(1, moved / (WORLD * 0.4)), { distance: moved });
    }
    // symbiosis (two large coexisting species)
    const hist = new Map<number, number>();
    for (const a of this.agents.values()) if (a.alive) hist.set(a.species, (hist.get(a.species) ?? 0) + 1);
    const sizes = [...hist.values()].sort((x, y) => y - x);
    if (sizes.length >= 2 && aliveCount > 50) {
      const top = sizes[0]! / aliveCount;
      const second = sizes[1]! / aliveCount;
      if (top >= 0.2 && second >= 0.2) {
        this.emitEvent('symbiosis', Math.min(top, second), { top1: top, top2: second, species: hist.size });
      }
    }
    // famine (mass starvation)
    if (this.prevAlive > 20 && dStarv > this.prevAlive * 0.15) {
      this.emitEvent('famine', Math.min(1, dStarv / this.prevAlive), { deaths: dStarv });
    }
    // drought (mass dehydration)
    if (this.prevAlive > 20 && dThirst > this.prevAlive * 0.15) {
      this.emitEvent('drought', Math.min(1, dThirst / this.prevAlive), { deaths: dThirst });
    }
    // war (large predation bout)
    if (this.prevAlive > 20 && dPred > this.prevAlive * 0.15) {
      this.emitEvent('war', Math.min(1, dPred / this.prevAlive), { deaths: dPred });
    }
  }

  // ---------------------------------------------------------------------------
  // Interventions
  // ---------------------------------------------------------------------------

  applyIntervention(iv: Intervention): void {
    const t = this.tickNum;
    const cap = this.params.energyCapacity;
    switch (iv.type) {
      case 'meteor': {
        const r = iv.radius ?? 64;
        const r2 = r * r;
        for (const a of this.agents.values()) {
          if (!a.alive) continue;
          const dx = a.x - (iv.x ?? 0);
          const dy = a.y - (iv.y ?? 0);
          if (dx * dx + dy * dy < r2) {
            a.energy = 0;
            this.kill(a, t, 'intervention');
          }
        }
        break;
      }
      case 'nuke': {
        for (const a of this.agents.values()) {
          if (a.alive) {
            a.energy = 0;
            this.kill(a, t, 'intervention');
          }
        }
        break;
      }
      case 'seedFood': {
        const r = iv.radius ?? 96;
        const amount = iv.amount ?? 50;
        for (let gy = 0; gy < this.grid.size; gy++) {
          for (let gx = 0; gx < this.grid.size; gx++) {
            const wx = (gx + 0.5) * CELL;
            const wy = (gy + 0.5) * CELL;
            const dx = wx - (iv.x ?? 0);
            const dy = wy - (iv.y ?? 0);
            if (dx * dx + dy * dy < r * r) {
              const idx = gy * this.grid.size + gx;
              this.grid.food[idx] = Math.min(this.grid.cap[idx]!, this.grid.food[idx]! + amount);
            }
          }
        }
        break;
      }
      case 'spawnAgent': {
        // Respect the same population ceiling as natural births, otherwise the
        // Spawn tool could grow the map unboundedly past maxPopulation.
        if (this.aliveCount() >= Math.min(this.params.maxPopulation, MAX_AGENTS)) break;
        const rng = new SplitMix64(streamSeed(this.config.seed, t, this.nextId));
        // Genome semantics mirror the Rust backend exactly (determinism parity):
        // exact-217 passes through; shorter arrays are a head-patch over a random
        // base; absent (or unbalanced) falls back to fully random. JSON transport
        // delivers plain number[] — normalize to Float32Array up front.
        const input = iv.genome !== undefined ? Float32Array.from(iv.genome) : undefined;
        let genome: Float32Array;
        if (input && input.length === GENOME_SIZE) {
          genome = input;
        } else if (input && input.length < GENOME_SIZE) {
          genome = randomGenome(rng);
          genome.set(input.subarray(0, input.length));
        } else {
          genome = randomGenome(rng);
        }
        const id = this.nextId++;
        const agent = this.createAgent({
          id,
          parentId: -1,
          genome,
          x: iv.x ?? WORLD / 2,
          y: iv.y ?? WORLD / 2,
          energy: cap * 0.6,
          water: cap * 0.6,
          bornAtTick: t,
          meme: rng.nextFloat(),
        });
        this.agents.set(id, agent);
        break;
      }
      case 'pauseRegion': {
        const r = iv.radius ?? 64;
        const r2 = r * r;
        for (const a of this.agents.values()) {
          if (!a.alive) continue;
          const dx = a.x - (iv.x ?? 0);
          const dy = a.y - (iv.y ?? 0);
          if (dx * dx + dy * dy < r2) a.pausedTicks = Math.max(a.pausedTicks, iv.ticks ?? 60);
        }
        break;
      }
      case 'setTimeScale':
        if (iv.timeScale !== undefined) this.params.timeScale = iv.timeScale;
        break;
      case 'setGene': {
        // Rewrite one gene on a live agent's genome template. Only the heredity
        // template is touched — decoded traits / learned brain stay as-is (parity
        // with the Rust backend). Deterministic: no RNG consumed.
        if (iv.agentId === undefined || iv.index === undefined || iv.value === undefined) break;
        const a = this.agents.get(iv.agentId);
        if (!a || !a.alive) break;
        if (Number.isInteger(iv.index) && iv.index >= 0 && iv.index < GENOME_SIZE) {
          a.genome[iv.index] = Math.max(-1, Math.min(1, iv.value));
        }
        break;
      }
    }
    this.emitEvent('intervention', INTERVENTION_SIG[iv.type], {
      itype: iv.type,
      ...(iv.x !== undefined ? { x: iv.x } : {}),
      ...(iv.y !== undefined ? { y: iv.y } : {}),
      ...(iv.agentId !== undefined ? { agentId: iv.agentId } : {}),
    });
    this.interventionLog.push({ tick: t, intervention: iv });
  }

  // ---------------------------------------------------------------------------
  // Snapshots / lineage / status
  // ---------------------------------------------------------------------------

  allAgentStates(): AgentState[] {
    const cap = this.params.energyCapacity;
    const out: AgentState[] = [];
    for (const a of this.agents.values()) {
      if (a.alive) {
        out.push(emptyState(a.id, a.x, a.y, Math.max(0, Math.min(1, a.energy / cap)), ST.ALIVE, a.species, a.meme));
      }
    }
    return out;
  }

  encodeSnapshotMessage(): Uint8Array {
    return encodeSnapshot(this.tickNum, this.params.timeScale, this.countSpecies(), this.aliveCount(), this.allAgentStates());
  }

  encodeStatsMessage(): Uint8Array {
    return encodeStats(this.stats());
  }

  /**
   * The "evolved set": recompute per-cell max orbit depth from the currently
   * alive lineages and emit as a SET frame. Cells with no surviving lineage
   * read 0 — the shape of the set emerges as the persistence map of life.
   */
  encodeSetMapMessage(): Uint8Array {
    const size = this.grid.size;
    this.setMapDepth.fill(0);
    for (const a of this.agents.values()) {
      if (!a.alive) continue;
      const idx = this.paramCell(a.cRe, a.cIm, size);
      const depth = Math.min(255, a.orbitDepth);
      if (depth > this.setMapDepth[idx]!) this.setMapDepth[idx] = depth;
    }
    // escape scars fade between emits
    for (let i = 0; i < this.setMapEscape.length; i++) {
      const v = this.setMapEscape[i]!;
      this.setMapEscape[i] = v > 0 ? Math.max(1, Math.round(v * 0.85)) : 0;
    }
    return encodeSetMap(this.tickNum, size, this.setMapDepth, this.setMapEscape);
  }

  /** Mark the parameter-plane cell of an escaped lineage (boundedness failure). */
  private markEscape(a: SimAgent): void {
    this.setMapEscape[this.paramCell(a.cRe, a.cIm, this.grid.size)] = 255;
  }

  /** Parameter-plane cell for a complex parameter c, on a size x size grid. */
  private paramCell(cRe: number, cIm: number, size: number): number {
    const ix = clamp(Math.floor(((cRe - CRE_MIN) / CRE_RANGE) * size), 0, size - 1);
    const iy = clamp(Math.floor(((cIm - CIM_MIN) / CIM_RANGE) * size), 0, size - 1);
    return iy * size + ix;
  }

  aliveCount(): number {
    let n = 0;
    for (const a of this.agents.values()) if (a.alive) n++;
    return n;
  }

  stats(): SimStats {
    let aliveCount = 0;
    let energySum = 0;
    let waterSum = 0;
    for (const a of this.agents.values()) {
      if (a.alive) {
        aliveCount++;
        energySum += a.energy;
        waterSum += a.water;
      }
    }
    return {
      tick: this.tickNum,
      population: this.agents.size,
      aliveCount,
      deadCount: this.lastDeaths,
      speciesCount: this.countSpecies(),
      avgEnergy: aliveCount > 0 ? energySum / aliveCount : 0,
      avgWater: aliveCount > 0 ? waterSum / aliveCount : 0,
      tickRate: 0,
      stateHash: this.computeStateHash(),
      timeScale: this.params.timeScale,
      energySum,
      births: this.lastBirths,
      deaths: this.lastDeaths,
      escapeDeaths: this.lastEscapeDeaths,
      ...this.distributionObservables(),
      cooperation: energySum > 0 ? this.lastDonation / energySum : 0,
      lyapunovExponent: this.lyapunov.exponent,
      selectionEntropy: this.replicator.selectionEntropy,
      fixationIndex: this.replicator.fixationIndex,
      priceEquationSelection: this.replicator.priceEquation.selection,
      foodGradMagMean: this.vectorField.globals.foodGradMagMean,
      foodLapMean: this.vectorField.globals.foodLapMean,
      velocityDivMean: this.vectorField.globals.velocityDivMean,
      velocityCurlMagMean: this.vectorField.globals.velocityCurlMagMean,
      caAliveFraction: this.gameOfLife.globals.aliveFraction,
      caComplexity: this.gameOfLife.globals.complexity,
      traitTotalVariance: this.tensors.totalVariance,
      traitEffectiveDim: this.tensors.effectiveDimension,
      traitAnisotropy: this.tensors.anisotropy,
      ...this.chemistryObservables(),
      ...this.biologyObservables(),
      ...this.brainStats(),
      // Biophysics observables — computed by the Rust/WASM engine (opt-in
      // `WorldConfig.biophysics`); the TS reference reports neutral zeros so
      // it stays a valid, wire-compatible SimStats without running the field.
      meanForce: 0,
      clusterCount: 0,
      clusterOrder: 0,
      rotationalOrder: 0,
      spatialEntropy: 0,
      dimensionalEntropy: 0,
      orgIndex: 0,
      massConservation: 0,
      symmetryDrift: 0,
      cascadeRate: 0,
      bondEnergy: 0,
      reactionEnthalpy: 0,
      entropyProduction: 0,
      carnotEfficiency: 0,
      heatWaste: 0,
      enginePower: 0,
      radiationField: 0,
      thermalBalance: 0,
      expressionEntropy: 0,
      transcriptActivity: 0,
      proteinDiversity: 0,
      proteomeLoad: 0,
      pathwayFlux: 0,
      fluxDiversity: 0,
      regulationGating: 0,
      ecCoupling: 0,
      nativeFraction: 0,
      misfoldLoad: 0,
      foldStability: 0,
      tfRegulation: 0,
      envRecognition: 0,
      expressionNoise: 0,
      libraryDiversity: 0,
      // --- Phase D observables (opt-in via WorldConfig.discovery / folding /
      // stochasticDynamics). Zeroed here so the pure-TS reference stays a valid
      // SimStats and `engine.ts`<->`wasm` stats JSON parity holds bit-for-bit.
      discoveryRate: 0,
      noveltyMean: 0,
      memoryDiversity: 0,
      explorationFraction: 0,
      behaviorNoise: 0,
      mutationBurstRate: 0,
      chaperoneLoad: 0,
      aggregateLoad: 0,
      foldFidelity: 0,
      proteotoxicity: 0,
      libraryCoverage: 0,
      bindingSpecificity: 0,
      combinatorialEntropy: 0,
      // --- Phase E quantum observables (opt-in via the omics fold-cluster
      // lane). Zeroed here so the pure-TS reference stays a valid SimStats and
      // `engine.ts`<->`wasm` stats JSON parity holds bit-for-bit.
      decoherenceRate: 0,
      coherenceLifetime: 0,
      tunnelingRate: 0,
      zeroPointEnergy: 0,
      superpositionEntropy: 0,
      entanglementEntropy: 0,
      quantumParallelism: 0,
      measurementBackaction: 0,
      collapseRate: 0,
      quantumDiffusion: 0,
      tunnelCoupling: 0,
      coherenceLength: 0,
      quantumFidelity: 0,
      // --- Phase G subatomic observables (opt-in via the omics fold-cluster
      // lane). Zeroed here so the pure-TS reference stays a valid SimStats and
      // `engine.ts`<->`wasm` stats JSON parity holds bit-for-bit.
      bosonFieldIntensity: 0,
      photonTransport: 0,
      gluonConfinement: 0,
      strongCoupling: 0,
      weakBosonMass: 0,
      higgsMassFloor: 0,
      leptonMobility: 0,
      electronChannel: 0,
      quarkFlavorPopulation: 0,
      upDownAsymmetry: 0,
      strangeFlavor: 0,
      charmPool: 0,
      protonStability: 0,
      latticePeriodicity: 0,
      bandGap: 0,
      fermiLevel: 0,
      conductionBand: 0,
      valenceBand: 0,
      phononFlux: 0,
      excitonBinding: 0,
      defectDensity: 0,
      dopingLevel: 0,
      carrierMobility: 0,
      topologicalInvariant: 0,
      moireSuperlattice: 0,
      latticeThermalSusceptibility: 0,
      // --- Phase-I statistical-mechanics / information-theory observables
      // (opt-in via the omics fold-cluster lane). Zeroed here so the pure-TS
      // reference stays a valid SimStats and `engine.ts`<->`wasm` stats JSON
      // parity holds bit-for-bit.
      boltzmannEntropy: 0,
      shannonDissimilarity: 0,
      entropyChangeRate: 0,
      gibbsFreeEnergy: 0,
      timeReversalAsymmetry: 0,
      maxwellDemonPower: 0,
      demonInformationCost: 0,
      absoluteZeroProximity: 0,
      quantumLandauerFloor: 0,
      heatCapacityAnomaly: 0,
      kbtDamping: 0,
      canonicalPartitionZ: 0,
      nanoparticleSurface: 0,
      nanoparticleDensity: 0,
      nanoporeTransport: 0,
      nanoscaleContact: 0,
      molecularMachineWork: 0,
      assemblerAccuracy: 0,
      nanofabricationYield: 0,
      dnaOrigamiStability: 0,
      bionanoInterface: 0,
      nanozymeActivity: 0,
      colloidalStability: 0,
      quantumDotBrightness: 0,
      nanotoxicFlux: 0,
      viralLoad: 0,
      bacterialLoad: 0,
      archaealDensity: 0,
      fungalBiomass: 0,
      protistMotility: 0,
      moneraPrimordial: 0,
      plantPhotosynthesis: 0,
      poriferanChannel: 0,
      chordateNeuralTube: 0,
      piscesAquaticMetabolism: 0,
      mammalThermoregulation: 0,
      primateCognition: 0,
      symbioticIndex: 0,
      metabolicRate: 0,
      cardiovascularPump: 0,
      respirationEfficiency: 0,
      digestiveThroughput: 0,
      excretoryClearance: 0,
      immuneSurveillance: 0,
      neuralConductance: 0,
      musculoskeletalOutput: 0,
      endocrineSignaling: 0,
      thermoregulationControl: 0,
      fluidHomeostasis: 0,
      sensoryPerception: 0,
      growthReplication: 0,
    };
  }

  agentSummaries(): import('@fractal-life/shared').AgentSummary[] {
    const out: import('@fractal-life/shared').AgentSummary[] = [];
    for (const a of this.agents.values()) {
      out.push({
        id: a.id,
        parentId: a.parentId,
        genome: a.genome,
        x: a.x,
        y: a.y,
        energy: a.energy,
        age: a.age,
        alive: a.alive,
        species: a.species,
        bornAtTick: a.bornAtTick,
        diedAtTick: a.diedAtTick,
        finalFitness: a.finalFitness,
      });
    }
    return out;
  }

  worldStatus(paused = false): WorldStatus {
    const s = this.stats();
    return {
      id: this.config.id,
      seed: this.config.seed,
      fractalType: this.config.fractalType,
      params: { ...this.params },
      currentTick: this.tickNum,
      population: s.population,
      aliveCount: s.aliveCount,
      speciesCount: s.speciesCount,
      createdAt: this.config.createdAt,
      interventions: this.interventionLog.length,
      paused,
    };
  }

  buildLineage(): LineageNode[] {
    const nodes = new Map<number, LineageNode>();
    for (const a of this.agents.values()) {
      nodes.set(a.id, {
        id: a.id,
        parentId: a.parentId,
        bornAtTick: a.bornAtTick,
        diedAtTick: a.diedAtTick,
        species: a.species,
        finalFitness: a.finalFitness,
        alive: a.alive,
        children: [],
      });
    }
    const roots: LineageNode[] = [];
    for (const node of nodes.values()) {
      const parent = node.parentId >= 0 ? nodes.get(node.parentId) : undefined;
      if (parent) parent.children.push(node);
      else roots.push(node);
    }
    return roots;
  }

  /**
   * Deterministic replay from the recorded intervention log.
   * Returns a fresh engine advanced to `targetTick`.
   */
  static replay(config: WorldConfig, log: RecordedIntervention[], targetTick: number): Engine {
    const engine = new Engine(config);
    const byTick = new Map<number, Intervention[]>();
    for (const rec of log) {
      if (rec.tick > targetTick) break;
      const arr = byTick.get(rec.tick) ?? [];
      arr.push(rec.intervention);
      byTick.set(rec.tick, arr);
    }
    while (engine.tickNum < targetTick) {
      const atTick = byTick.get(engine.tickNum);
      if (atTick) for (const iv of atTick) engine.applyIntervention(iv);
      engine.tick();
    }
    return engine;
  }

  getInterventionLog(): RecordedIntervention[] {
    return this.interventionLog.map((r) => ({ tick: r.tick, intervention: { ...r.intervention, genome: r.intervention.genome ? new Float32Array(r.intervention.genome) : undefined } }));
  }
}

function wrap(v: number): number {
  if (v < 0) return v + WORLD;
  if (v >= WORLD) return v - WORLD;
  return v;
}

function gridIdx(grid: TerrainGrid, wx: number, wy: number): number {
  const size = grid.size;
  const ix = Math.max(0, Math.min(size - 1, Math.floor(wx / CELL)));
  const iy = Math.max(0, Math.min(size - 1, Math.floor(wy / CELL)));
  return iy * size + ix;
}

/** Withdraw `amount` from the bilinear neighbourhood of a point. */
function withdrawFood(grid: TerrainGrid, wx: number, wy: number, amount: number): void {
  withdrawInto(grid.food, grid.size, wx, wy, amount);
}

/** Withdraw `amount` of meat from the bilinear neighbourhood of a point. */
function withdrawMeat(grid: TerrainGrid, wx: number, wy: number, amount: number): void {
  withdrawInto(grid.meat, grid.size, wx, wy, amount);
}

function withdrawInto(arr: Float32Array, size: number, wx: number, wy: number, amount: number): void {
  const gx = wx / CELL;
  const gy = wy / CELL;
  const ix = Math.max(0, Math.min(size - 1, Math.floor(gx)));
  const iy = Math.max(0, Math.min(size - 1, Math.floor(gy)));
  const fx = Math.min(1, Math.max(0, gx - ix));
  const fy = Math.min(1, Math.max(0, gy - iy));
  const x1 = Math.min(size - 1, ix + 1);
  const y1 = Math.min(size - 1, iy + 1);
  const w00 = (1 - fx) * (1 - fy);
  const w10 = fx * (1 - fy);
  const w01 = (1 - fx) * fy;
  const w11 = fx * fy;
  arr[iy * size + ix] = Math.max(0, arr[iy * size + ix]! - amount * w00);
  arr[iy * size + x1] = Math.max(0, arr[iy * size + x1]! - amount * w10);
  arr[y1 * size + ix] = Math.max(0, arr[y1 * size + ix]! - amount * w01);
  arr[y1 * size + x1] = Math.max(0, arr[y1 * size + x1]! - amount * w11);
}

export type { Phenotype };
export { MAX_AGENTS, fnv1a32 };
