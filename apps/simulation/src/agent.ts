import type { Phenotype, PatternDrives, StrategyGenes } from './genome.js';
import type { AgentChemistry } from './chemistry.js';
import type { DnaSystem } from './dna.js';
import type { CellState } from './cells.js';
import type { EcosystemGenes } from './ecosystem.js';
import type { FitnessComponents } from './selection.js';
import type { BrainState } from './brain.js';
import type { AgentOmics } from './omics.js';

/**
 * Immune system state for an agent.
 */
export interface ImmuneState {
  /** Pathogen load in [0, MAX_PATHOGEN_LOAD] */
  pathogenLoad: number;
  /** Innate immunity effectiveness */
  innate: number;
  /** Adaptive immunity: learned pathogen recognition */
  adaptive: number;
  /** Immune memory: ticks remaining of pathogen-specific immunity */
  immuneMemory: number;
  /** Inflammation level (high = damage to self) */
  inflammation: number;
  /** Autoimmunity risk: self-damage from overactive immunity */
  autoimmunity: number;
  /** Number of pathogens this agent has successfully fought */
  pathogensFought: number;
  /** Symbiont load: beneficial microbe count */
  symbiontLoad: number;
}

/**
 * Predator-prey tracking state.
 */
export interface PredPreyState {
  /** Stealth level: detection avoidance */
  stealth: number;
  /** Pursuit speed bonus when chasing prey */
  pursuit: number;
  /** Ambush damage multiplier */
  ambush: number;
  /** Pack hunting bonus from nearby allies */
  packBonus: number;
  /** Escape energy spent fleeing */
  escapeEnergy: number;
  /** Warning call signals sent */
  warningCalls: number;
  /** Mimicry similarity to dangerous species */
  mimicry: number;
  /** Aposematism: warning coloration effect */
  aposematism: number;
  /** Whether currently hiding (reduced detection) */
  isHiding: boolean;
  /** Whether currently in chase mode */
  isChasing: boolean;
  /** Ticks since last hunt attempt */
  ticksSinceHunt: number;
}

/**
 * Reproduction system state.
 */
export interface ReproState {
  /** Sexual reproduction tendency */
  sexual: number;
  /** Mate selectivity */
  mateSelectivity: number;
  /** Parental investment: energy given to offspring */
  parentalInvestment: number;
  /** Clutch size: number of offspring per event */
  clutchSize: number;
  /** Generation time: ticks to maturity */
  generationTime: number;
  /** Senescence: aging rate after maturity */
  senescence: number;
  /** Fecundity: propagule production rate */
  fecundity: number;
  /** Dormancy ability */
  dormancy: number;
  /** Whether currently dormant */
  isDormant: boolean;
  /** Ticks since birth */
  ticksSinceBirth: number;
  /** Whether sexually mature */
  isMature: boolean;
  /** Mate found this tick */
  mateFound: boolean;
}

/**
 * Energy metabolism state.
 */
export interface MetabolismState {
  /** Basal metabolic rate */
  basalRate: number;
  /** Aerobic capacity */
  aerobicCapacity: number;
  /** Anaerobic capacity */
  anaerobicCapacity: number;
  /** Thermoregulation: body temperature */
  bodyTemperature: number;
  /** Fat storage: long-term energy reserves */
  fatStorage: number;
  /** Sugar metabolism efficiency */
  sugarMetab: number;
  /** Protein metabolism efficiency */
  proteinMetab: number;
  /** Lipid metabolism efficiency */
  lipidMetab: number;
  /** Current metabolic mode: 'aerobic', 'anaerobic', 'mixed' */
  metabolicMode: string;
}

/**
 * Immune system genes decoded from genome.
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

/**
 * Predator-prey genes decoded from genome.
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

/**
 * Reproduction genes decoded from genome.
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

/**
 * Energy metabolism genes decoded from genome.
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

/** Live simulation agent. Dead agents are retained (capped) for lineage. */
export interface SimAgent {
  id: number;
  parentId: number;
  genome: Float32Array;
  phenotype: Phenotype;
  x: number;
  y: number;
  /** momentum from terrain physics — velocity (world units/tick at timeScale 1) */
  vx: number;
  vy: number;
  energy: number;
  water: number;
  age: number;
  alive: boolean;
  species: number;
  bornAtTick: number;
  diedAtTick: number;
  finalFitness: number;
  energyAcquired: number;
  kills: number;
  reproductions: number;
  /** energy donated to kin (same-tag neighbours) — counts toward inclusive fitness */
  altruism: number;
  /** cultural trait (meme tag) in [0,1] — spreads by imitation, not genes */
  meme: number;
  /** tick this agent last participated in reproduction (asexual or as a mate) */
  lastReproTick: number;
  /** tick this agent was last hunted (for predation death attribution) */
  lastHuntedTick: number;
  /** id of the agent that landed the hunt blow this tick (-1 = none/warning only) */
  lastHuntedBy: number;
  /** remaining ticks frozen by a pauseRegion intervention */
  pausedTicks: number;
  /** pattern drives decoded once at birth (instinct genes that steer thrust) */
  drives: PatternDrives;
  /** strategy genes decoded once at birth (game-theory modulation of decisions) */
  strategy: StrategyGenes;
  /** complex parameter c mapped from genes 0/1 — the lineage's fractal niche */
  cRe: number;
  cIm: number;
  /** current orbit point z (critical orbit: z0 = 0, z -> z^2 + c) */
  zRe: number;
  zIm: number;
  /** iterations applied to the orbit since birth (capped for wire encoding) */
  orbitDepth: number;
  /** lifetime energy spent on donations (tracked for game-theory observables) */
  totalDonated: number;
  /** lifetime energy received from donations */
  totalReceived: number;
  /** lifetime energy dealt in hunts */
  totalHuntDamage: number;
  /** number of times this agent was hunted (survived or died) */
  timesHunted: number;
  /** per-agent molecular chemistry state */
  chemistry: AgentChemistry;
  /** Molecular-omics state (only when WorldConfig.omics is on) */
  omics?: AgentOmics;
  /** DNA replication and repair system */
  dna: DnaSystem;
  /** Cell structure and membrane state */
  cell: CellState;
  /** Immune system state */
  immune: ImmuneState;
  /** Predator-prey tracking state */
  predprey: PredPreyState;
  /** Reproduction system state */
  repro: ReproState;
  /** Energy metabolism state */
  metabolism: MetabolismState;
  /** Trophic level in ecosystem (0=producer, 1=herbivore, 2=carnivore, 3=apex, 4=decomposer) */
  trophicLevel: number;
  /** Fitness components for selection tracking */
  fitness: FitnessComponents;
  /** Ecosystem adaptation genes */
  ecosystem: EcosystemGenes;
  /** Immune genes */
  immuneGenes: ImmuneGenes;
  /** Predator-prey genes */
  predpreyGenes: PredPreyGenes;
  /** Reproduction genes */
  reproGenes: ReproGenes;
  /** Metabolism genes */
  metabGenes: MetabGenes;
  /** plastic recurrent neural network (surprise-modulated Hebbian learning) */
  brain: BrainState;
}
