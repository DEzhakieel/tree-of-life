import { WORLD_SIZE, MAX_AGENTS } from './constants.js';
import type { EnrichmentSnapshot } from './grounding.js';
import type { UniverseConfig } from './universe.js';

export interface WorldParams {
  /** Julia seed, complex c = cReal + i*cImag */
  cReal: number;
  cImag: number;
  maxIter: number;
  escapeRadius: number;
  /** Complex-plane region covered by the world square. */
  centerX: number;
  centerY: number;
  /** Complex-plane width spanned by the whole WORLD_SIZE world. */
  worldScale: number;
  /** how many founders are spawned at world creation */
  spawnCount: number;
  metabolismBase: number;
  maxPopulation: number;
  foodRegenRate: number;
  energyCapacity: number;
  agentMaxAge: number;
  /** 1.0 = real time; <1 = slow-motion (deep zoom = slower life). Driven by camera zoom. */
  timeScale: number;
  /** ticks per day/night cycle (plants photosynthesise in daylight) */
  dayLength: number;
  /** ticks per seasonal cycle (drives moisture => boom/bust food dynamics) */
  seasonLength: number;
}

export type FractalType = 'mandelbrot' | 'julia' | 'perlin';

/** Phase M biome presets — selectable worlds from the benign to the extreme
 *  (hydrothermal vents, anoxic trenches, crater lakes, permafrost, irradiated
 *  waste) and the underrated (cave, gut lumen, termite mound, rhizosphere,
 *  marsh, desert, hot spring, canopy). Each preset remaps the four chemical
 *  terrain bases seeded at world build plus a water factor and a default heat
 *  for the per-agent omics environment. */
export type EnvironmentPreset =
  | 'calm'
  | 'anoxicTrench'
  | 'hyperthermal'
  | 'hypersaline'
  | 'acidicCrater'
  | 'sodaLake'
  | 'cryoFrozen'
  | 'irradiated'
  | 'toxicSump'
  | 'limestoneCave'
  | 'gutLumen'
  | 'termiteMound'
  | 'rhizosphere'
  | 'wetlandMarsh'
  | 'desertDune'
  | 'hotSpring'
  | 'canopyTop';

/** The concrete effect of an environment preset on the chemical terrain and
 *  the per-agent omics environment. Mirrors Rust `EnvProfile`. */
export interface EnvProfile {
  desc: string;
  /** seeded O2 base of the chem terrain (0..1) */
  o2: number;
  /** seeded pH base of the chem terrain (3..11) */
  ph: number;
  /** seeded toxin base of the chem terrain (0..1) */
  toxin: number;
  /** seeded minerals base of the chem terrain (0..1) */
  minerals: number;
  /** moisture multiplier applied to the per-agent omics water signal */
  waterFactor: number;
  /** default heat for the per-agent omics environment (weather overrides) */
  heat: number;
}

export const ENV_PROFILES: Record<EnvironmentPreset, EnvProfile> = {
  calm: { desc: 'Temperate wetland pool (control)', o2: 0.3, ph: 7.0, toxin: 0.0, minerals: 0.15, waterFactor: 1.0, heat: 0.5 },
  anoxicTrench: { desc: 'Deep-sea trench — anoxic, pressurised, sulfidic', o2: 0.02, ph: 7.4, toxin: 0.25, minerals: 0.5, waterFactor: 1.0, heat: 0.1 },
  hyperthermal: { desc: 'Hydrothermal vent — hot, acidic', o2: 0.15, ph: 4.5, toxin: 0.5, minerals: 0.9, waterFactor: 1.0, heat: 1.0 },
  hypersaline: { desc: 'Hypersaline brine lagoon', o2: 0.4, ph: 8.2, toxin: 0.1, minerals: 0.6, waterFactor: 0.55, heat: 0.7 },
  acidicCrater: { desc: 'Volcanic crater lake — pH 3', o2: 0.5, ph: 3.0, toxin: 0.35, minerals: 0.7, waterFactor: 0.9, heat: 0.6 },
  sodaLake: { desc: 'Soda lake — alkaline pH 10.5', o2: 0.45, ph: 10.5, toxin: 0.1, minerals: 0.55, waterFactor: 0.7, heat: 0.7 },
  cryoFrozen: { desc: 'Permafrost — permanently frozen', o2: 0.6, ph: 7.0, toxin: 0.05, minerals: 0.2, waterFactor: 0.12, heat: 0.0 },
  irradiated: { desc: 'Radiotropic waste ground', o2: 0.5, ph: 6.0, toxin: 0.8, minerals: 0.4, waterFactor: 0.5, heat: 0.6 },
  toxicSump: { desc: 'Anoxic toxic smog sump', o2: 0.08, ph: 4.0, toxin: 0.7, minerals: 0.3, waterFactor: 0.4, heat: 0.45 },
  limestoneCave: { desc: 'Limestone cave', o2: 0.18, ph: 7.6, toxin: 0.05, minerals: 0.8, waterFactor: 0.85, heat: 0.3 },
  gutLumen: { desc: 'Vertebrate gut lumen', o2: 0.05, ph: 6.0, toxin: 0.15, minerals: 0.2, waterFactor: 0.9, heat: 0.85 },
  termiteMound: { desc: 'Termite mound core', o2: 0.12, ph: 6.5, toxin: 0.1, minerals: 0.6, waterFactor: 0.7, heat: 0.9 },
  rhizosphere: { desc: 'Soil rhizosphere', o2: 0.2, ph: 6.2, toxin: 0.05, minerals: 0.7, waterFactor: 0.75, heat: 0.45 },
  wetlandMarsh: { desc: 'Anoxic wetland marsh', o2: 0.12, ph: 5.2, toxin: 0.2, minerals: 0.3, waterFactor: 1.0, heat: 0.5 },
  desertDune: { desc: 'Desert dune — desiccated', o2: 0.7, ph: 8.0, toxin: 0.05, minerals: 0.35, waterFactor: 0.1, heat: 0.6 },
  hotSpring: { desc: 'Algal hot spring', o2: 0.6, ph: 8.5, toxin: 0.1, minerals: 0.45, waterFactor: 0.95, heat: 0.9 },
  canopyTop: { desc: 'Forest canopy', o2: 0.85, ph: 7.0, toxin: 0.02, minerals: 0.15, waterFactor: 0.85, heat: 0.55 },
};

/** Phase M topological spaces — the boundary condition that selects how the
 *  edges of the world plane are identified when agents move. Mirrors Rust
 *  `WorldTopology`. Longitude (x) wraps in every topology; latitude (y) wraps
 *  on the torus / klein bottle and reflects on the cylinder / sphere / möbius. */
export type WorldTopology =
  | 'torus'
  | 'cylinder'
  | 'sphere'
  | 'mobius'
  | 'kleinBottle';

export const TOPOLOGIES: readonly WorldTopology[] = [
  'torus',
  'cylinder',
  'sphere',
  'mobius',
  'kleinBottle',
] as const;

/** metadata for research reports, mirrors Rust `WorldTopology::desc` */
export const TOPOLOGY_DEFS: Record<WorldTopology, { desc: string; wrapsY: boolean }> = {
  torus: { desc: 'planet-style: both axes wrap (legacy)', wrapsY: true },
  cylinder: { desc: 'band: longitude wraps, polar caps reflect', wrapsY: false },
  sphere: { desc: 'globe: longitude wraps, poles reflect', wrapsY: false },
  mobius: { desc: 'non-orientable: longitude wraps, caps reflect with a half-twist', wrapsY: false },
  kleinBottle: { desc: 'non-orientable: longitude wraps, latitude loops flipped', wrapsY: true },
};

/**
 * Life substrate — the rule set that advances a world's bodies each tick.
 * `agents` is the full behavioural engine (the only kind the Rust/WASM engine
 * and the server understand); the others are pure-TS substrates that run in
 * the web worker and the console TUI only, and are chosen at world creation.
 */
export type SubstrateKind = 'agents' | 'particles' | 'lattice' | 'graph';

export const SUBSTRATES: readonly SubstrateKind[] = ['agents', 'particles', 'lattice', 'graph'] as const;

/** Optional per-substrate knobs. All fields have engine-side defaults; the
 *  world is valid with only `kind` set. */
export interface SubstrateConfig {
  kind: SubstrateKind;
  /** particles: near-field attraction gain (default 1). */
  attraction?: number;
  /** particles: near-field repulsion gain (default 1). */
  repulsion?: number;
  /** lattice: per-tick random cell flip probability (default 0). */
  noise?: number;
  /** graph: neighbour-link radius in world units (default 90). */
  linkRadius?: number;
}

export interface WorldConfig {
  id: string;
  seed: string;
  fractalType: FractalType;
  params: WorldParams;
  createdAt: number;
  currentTick: number;
  /** Optional real-world enrichment data snapshot — keeps determinism by being
   *  static/offline-fetched. When present, engines use grounded stoichiometry
   *  and ecology priors instead of hand-authored defaults. */
  grounding?: EnrichmentSnapshot;
  /** Optional astrophysical frame. When present, the physics engine derives
   *  real gravitational climb costs and escape-velocity caps from it; when
   *  absent, legacy physics constants are used (existing behaviour unchanged). */
  universe?: UniverseConfig;
  /** Opt-in deep cell biochemistry: protein folding, membrane lipid dynamics,
   *  concentration gradients, active/passive transport, Michaelis-Menten kinetics.
   *  When absent/false the engine uses legacy chemistry (unchanged behaviour). */
  cellBio?: boolean;
  /** Opt-in mesoscale biophysics: agent force fields (Lennard-Jones, equal-and-
   *  opposite, min-image on the torus) that BOTH steer movement (Phase 2, via
   *  FORCE_DRIVE_SCALE) and feed spatial clustering / rotational order,
   *  thermodynamic bookkeeping of the metabolic engine, and conservation /
   *  symmetry tie-outs. When absent/false the engine computes none of these
   *  (legacy trajectory unchanged). */
  biophysics?: boolean;
  /** Opt-in molecular-omics: a multi-omics layer of transcriptomics (mrna pools
   *  driven by the DNA expression blocks + epigenetic marks + inducible/
   *  repressible transcription), proteomics (protein pools translated from the
   *  transcriptome), fluxomics (pathway throughput over the 12 molecule pools),
   *  and interactomics telemetry. Phase A is observational: the pools are
   *  advanced and aggregated but never feed back into energy, pools, or DNA
   *  (legacy trajectory unchanged). */
  omics?: boolean;
  /** Phase C stochastic gene expression + folding entropy: a per-block OU
   *  noise process on transcription and folding, seeded per (world, tick,
   *  agent) so it stays reproducible. When absent/false the omics layer runs
   *  the fully deterministic Phase C core (folding, TF motifs, env
   *  classification) with no stochastic draws. */
  omicsStochastic?: boolean;
  /** Phase C combinatorial systems: an oligomer library is ligated from the
   *  molecule-pair pools and screened by the folded (native) proteome. When
   *  absent/false the fluxome runs without the library. */
  combinatorial?: boolean;
  /** Phase C recombination operators: multi-point crossover, intra-genome
   *  block shuffle and per-block combinatorial assembly during sexual
   *  reproduction. When absent/false reproduction keeps the legacy single-
   *  point crossover. */
  recombination?: boolean;
  /** Phase M environment preset: seeds the chemical terrain bases
   *  (o2 / ph / toxin / minerals) at world build and biases the per-agent
   *  omics environment (water factor, default heat). Selecting any preset
   *  (including 'calm') also activates the biome regime, which re-injects the
   *  profile's chemical basis each tick so extreme / underrated worlds keep
   *  their identity. Absent = purely legacy dynamics (bit-identical). */
  environment?: EnvironmentPreset;
  /** Phase M world topology: the edge-identification rule applied when agents
   *  move. Absent = torus (legacy bit-identical dynamics). */
  topology?: WorldTopology;
  /** Optional event emission filter: `include` lists the SimEvent types the
   *  engine may emit (absent = all types). Controls emission, never retention. */
  eventPolicy?: EventPolicy;
  /** Phase D communication-channel gain: multiplies the per-tick signal energy
   *  an agent deposits into a grid cell when signalling. Absent = 1 (legacy
   *  bit-identical); 0 closes the channel so no signal is ever emitted, which
   *  ablates the L7 information-transfer detector. */
  signalDeposit?: number;
  /** Phase D cultural-transmission gain: multiplies the per-tick probability an
   *  agent copies a higher-energy neighbour's meme. Absent = 1 (legacy
   *  bit-identical); 0 closes the whole non-genetic channel — founder tags are
   *  null, children no longer inherit memes and copying stops — ablating the L8
   *  culture detector. */
  memeCopyRate?: number;
  /** Phase D discovery / curiosity subsystem: when on, agents accumulate
   *  recognition (discovery) events whose novelty feeds the radar's open-ended
   *  novelty detector. Absent = off (legacy bit-identical). */
  discovery?: boolean;
  /** Reproduction master switch: when `false` no agent may divide, so no
   *  offspring ever appear (used to ablate the self-replication faculty).
   *  Absent or `true` = legacy behaviour. */
  reproduction?: boolean;
  /** Sensorimotor master switch: when `false` agents hold position and expose
   *  no state->action feedback (adaptive-agent ablation). Absent/`true` =
   *  legacy behaviour. */
  sensing?: boolean;
  /** Life substrate selector (see SubstrateKind). Absent = 'agents' (the
   *  full engine, bit-identical legacy behaviour). Non-agent substrates run
   *  on the pure-TS substrate engine in the web worker / console TUI; the
   *  Rust/WASM engine and the server ignore this field (serde skips unknown
   *  fields), so remote sessions always run the agent engine. */
  substrate?: SubstrateConfig;
}

export interface AgentSummary {
  id: number;
  parentId: number;
  genome: Float32Array;
  x: number;
  y: number;
  energy: number;
  age: number;
  alive: boolean;
  species: number;
  bornAtTick: number;
  diedAtTick: number;
  finalFitness: number;
}

/** Flat, serialisable state sent to clients / persisted as snapshots. */
export interface AgentState {
  id: number;
  x: number;
  y: number;
  energy: number; // 0..1 normalised
  state: number; // STATE.*
  species: number;
  meme: number; // 0..1 cultural tag
}

export interface SimStats {
  tick: number;
  population: number;
  aliveCount: number;
  deadCount: number;
  speciesCount: number;
  avgEnergy: number;
  avgWater: number;
  tickRate: number;
  stateHash: number;
  timeScale: number;
  energySum: number;
  births: number;
  deaths: number;
  /** agents that escaped the fractal boundary this tick (orbit diverged past the escape radius). */
  escapeDeaths: number;
  /** Shannon entropy of the species-abundance distribution (bits). */
  entropy: number;
  /** Simpson diversity: 1 - sum(p_i^2). */
  diversity: number;
  /** LMC complexity: entropy x disequilibrium against the uniform distribution. */
  complexity: number;
  /** share of energy donated via greenbeard altruism this tick (0..1). */
  cooperation: number;
  /** fraction of alive agents whose diet is carnivorous (>0.6). */
  predatorFraction: number;
  /** number of distinct meme "cultural tags" among alive agents (memetic diversity). */
  cultureCount: number;
  /** mean lifetime energy donated by an alive agent, normalised to energy capacity. */
  meanAltruism: number;
  /** Shannon entropy (bits) of the meme-tag distribution — cultural diversity. */
  memeEntropy: number;
  /** normalised mutual information between meme tags and species (0..1). */
  speciesMemeMI: number;
  // --- game theory observables ---
  /** mean aggression gene across alive agents (0..1). */
  meanAggression: number;
  /** mean cooperation gene across alive agents (0..1). */
  meanCooperation: number;
  /** mean risk-tolerance gene across alive agents (0..1). */
  meanRisk: number;
  /** mean deception gene across alive agents (0..1). */
  meanDeception: number;
  /** fraction of alive agents whose aggression gene > 0.6 (active predators). */
  predatorGeneFraction: number;
  /** fraction of alive agents whose aggression gene < 0.4 (active prey). */
  preyGeneFraction: number;
  /** Gini coefficient of lifetime energy acquired (0 = perfect equality, 1 = max inequality). */
  energyInequality: number;
  /** mean (totalDonated / energyAcquired) across alive agents who acquired energy (cooperation-to-self ratio). */
  donationRatio: number;
  // --- mathematical observables ---
  /** largest Lyapunov exponent: >0 = chaos, 0 = marginal, <0 = stable */
  lyapunovExponent: number;
  /** replicator selection entropy: H(strategy bins) — measures strategy diversity */
  selectionEntropy: number;
  /** replicator fixation index: frequency of dominant strategy bin (>0.8 = fixation) */
  fixationIndex: number;
  /** replicator price equation: selection component (Cov fitness × strategy) */
  priceEquationSelection: number;
  /** vector field: mean food gradient magnitude */
  foodGradMagMean: number;
  /** vector field: mean food laplacian (positive = source-dominated) */
  foodLapMean: number;
  /** vector field: global velocity divergence (positive = expansion, negative = contraction) */
  velocityDivMean: number;
  /** vector field: mean curl magnitude (rotation intensity) */
  velocityCurlMagMean: number;
  /** Game of Life: fraction of CA cells alive */
  caAliveFraction: number;
  /** Game of Life: CA complexity (alive fraction × neighbourhood entropy) */
  caComplexity: number;
  /** trait tensor: total variance across 8 trait dimensions */
  traitTotalVariance: number;
  /** trait tensor: effective dimensionality of trait space (exp of eigenvalue entropy) */
  traitEffectiveDim: number;
  /** trait tensor: anisotropy (λ_max / λ_min — elongation of trait ellipsoid) */
  traitAnisotropy: number;
  // --- chemistry observables ---
  /** mean ATP level across alive agents (normalised to CHEM_MAX_MOLECULE) */
  meanATP: number;
  /** mean enzyme concentration across alive agents */
  meanEnzyme: number;
  /** mean toxin load across alive agents */
  meanToxin: number;
  /** mean organismal pH across alive agents */
  meanPH: number;
  /** Shannon entropy (bits) of elemental distribution — chemical diversity */
  chemicalDiversity: number;
  /** mean glucose level */
  meanGlucose: number;
  /** total protein concentration (structural capacity) */
  meanProtein: number;
  /** fraction of agents with active enzyme synthesis (enzyme > CHEM_MAX_ENZYME * 0.3) */
  activeSynthesisFraction: number;
  /** terrain: mean O2 fraction across grid */
  terrainOxygen: number;
  /** terrain: mean pH across grid */
  terrainPH: number;
  /** terrain: mean toxin fraction across grid */
  terrainToxin: number;
  // --- biology observables ---
  /** mean DNA integrity across alive agents (0 = lethal mutagenesis, 1 = perfect) */
  meanDNAIntegrity: number;
  /** mean pathogen load across alive agents */
  meanPathogenLoad: number;
  /** mean membrane potential across alive agents (mV) */
  meanMembranePot: number;
  /** mean body temperature across alive agents */
  meanBodyTemp: number;
  /** mean trophic level across alive agents (0=producer, 4=decomposer) */
  meanTrophicLevel: number;
  /** total speciation events */
  speciationRate: number;
  /** total extinction events */
  extinctionRate: number;
  /** Shannon diversity across trophic levels (0..1) */
  biodiversityIndex: number;
  /** mean composite fitness across alive agents */
  meanFitness: number;
  /** mean cell division progress across alive agents */
  meanDivisionProgress: number;
  /** mean plastic-brain deviation from the genome template (learning happened) */
  meanPlasticity: number;
  /** mean |reward-prediction-error| across alive agents (surprise drives learning) */
  meanSurprise: number;
  /** fraction of alive agents whose synapses have drifted from the genome template */
  plasticAgents: number;
  // --- biophysics observables (opt-in via WorldConfig.biophysics) ---
  /** mean pairwise force magnitude between agents (LJ repulsion + attraction) */
  meanForce: number;
  /** number of coherent spatial clusters (DBSCAN-lite within force cutoff) */
  clusterCount: number;
  /** mean occupancy-weighted order within clusters (0..1) */
  clusterOrder: number;
  /** rotational (hexatic) ordering of the agent field (0..1) */
  rotationalOrder: number;
  /** Shannon entropy (bits) of the spatial occupancy grid */
  spatialEntropy: number;
  /** effective dimensionality entropy of the agent distribution */
  dimensionalEntropy: number;
  /** organizational index: structure vs random packing (0..1) */
  orgIndex: number;
  /** relative mass-conservation drift (0 = perfectly conserved) */
  massConservation: number;
  /** chiral / circular symmetry drift (0 = symmetric) */
  symmetryDrift: number;
  /** reaction cascade rate (per-tick chemical propagation) */
  cascadeRate: number;
  /** mean covalent bond energy across agents */
  bondEnergy: number;
  /** mean reaction enthalpy of active metabolism */
  reactionEnthalpy: number;
  /** entropy production rate of the metabolic engine */
  entropyProduction: number;
  /** Carnot efficiency of thermal engines (0..1) */
  carnotEfficiency: number;
  /** heat wasted by active metabolism per tick */
  heatWaste: number;
  /** metabolic engine work rate */
  enginePower: number;
  /** radiation field magnitude at the population centroid */
  radiationField: number;
  /** residual thermal-balance error (produced - lost - stored) */
  thermalBalance: number;
  // --- omics observables (opt-in via WorldConfig.omics) ---
  /** Shannon entropy (bits) of the transcript-abundance distribution */
  expressionEntropy: number;
  /** mean mrna synthesis rate (transcription throughput) */
  transcriptActivity: number;
  /** Hill effective number of protein species */
  proteinDiversity: number;
  /** mean protein pool abundance (proteome size proxy) */
  proteomeLoad: number;
  /** total flux across the 6-reaction fluxome (pathway throughput) */
  pathwayFlux: number;
  /** Shannon entropy (bits) of the reaction-flux distribution */
  fluxDiversity: number;
  /** mean proportion of transcription allowed through epigenetic gating (0..1) */
  regulationGating: number;
  /** proteome<->enzyme coupling (cosine, 0..1) */
  ecCoupling: number;
  // --- Phase C omics observables (folding / TF / env / library) ---
  /** mean native fraction across the proteome (folded-protein yield) */
  nativeFraction: number;
  /** mean misfolded fraction across the proteome (unfolded-protein load) */
  misfoldLoad: number;
  /** mean equilibrium native fraction (proteome folding stability) */
  foldStability: number;
  /** mean regulator transcription multiplier (TF regulatory load) */
  tfRegulation: number;
  /** mean environment-recognition affinity (pattern classification score) */
  envRecognition: number;
  /** mean |expression noise| across the blocks (0 when deterministic) */
  expressionNoise: number;
  /** Shannon entropy (bits) of the oligomer library distribution */
  libraryDiversity: number;
  // --- Phase D (discovery / folding / stochastic dynamics) observables ---
  /** per-agent discovery (recognition) events this tick, normalised to population */
  discoveryRate: number;
  /** mean normalised novelty (0..1) of the agent context signatures */
  noveltyMean: number;
  /** mean memory-codebook diversity (Shannon bits) across agents */
  memoryDiversity: number;
  /** fraction of agents in exploration mode (curiosity drive active) */
  explorationFraction: number;
  /** mean behavioural OU-noise magnitude (steering jitter, Phase D) */
  behaviorNoise: number;
  /** error-prone replication bursts per division (mutation-rate multiplier) */
  mutationBurstRate: number;
  /** mean chaperone-mediated refolding throughput (folding subsystem) */
  chaperoneLoad: number;
  /** mean aggregate-seeded misfold load (proteotoxic cascade) */
  aggregateLoad: number;
  /** mean fold fidelity (native fraction retained by the folding engine) */
  foldFidelity: number;
  /** mean proteotoxicity index (aggregate-driven toxicity, 0..1) */
  proteotoxicity: number;
  /** fraction of the combinatorial oligomer library with non-zero occupancy */
  libraryCoverage: number;
  /** mean pairwise binding specificity of the combinatorial library (0..1) */
  bindingSpecificity: number;
  /** Shannon entropy (bits) of the combinatorial library's occupancy mix */
  combinatorialEntropy: number;
  // --- Phase E quantum observables (macroscopic-quantum reading of the
  // fold-cluster pools; mirror Rust omics.rs Phase-E) ---
  /** rate at which the folded-coherence dephases (heat, proteotoxicity, jitter) */
  decoherenceRate: number;
  /** mean tick-lifetime of the folded coherent state */
  coherenceLifetime: number;
  /** fold-barrier tunneling rate of the catalyst pair */
  tunnelingRate: number;
  /** residual fold-well energy at the ground state */
  zeroPointEnergy: number;
  /** Shannon entropy (bits) of the native/misfold/aggregate superposition */
  superpositionEntropy: number;
  /** transcriptome<->fold-disorder correlation entropy */
  entanglementEntropy: number;
  /** effective proteome parallelism (coherent fold branches) */
  quantumParallelism: number;
  /** probe/selection disturbance of the fold state */
  measurementBackaction: number;
  /** rate the fold superposition collapses to an outcome */
  collapseRate: number;
  /** fluxome random-walk broadening (diffusion) */
  quantumDiffusion: number;
  /** substrate/product well tunneling coupling of the pools */
  tunnelCoupling: number;
  /** structural extent of coherent folding (library scale) */
  coherenceLength: number;
  /** fidelity of the observed phase vs the ideal native outcome */
  quantumFidelity: number;
  // --- Phase G subatomic observables (subatomic reading of the SAME
  // fold-cluster/quantum pools; mirror Rust omics.rs Phase-G) ---
  /** bosonic field intensity of the enzyme/ec coupling (0..1) */
  bosonFieldIntensity: number;
  /** dephasing-attenuated EM transport blended with the fluxome current (0..1) */
  photonTransport: number;
  /** gluon confinement: binder fitness + innate toxicity (0..1) */
  gluonConfinement: number;
  /** strong scale lifting with folded fidelity (0..1) */
  strongCoupling: number;
  /** W/Z mass from the zero-point curvature (0..1) */
  weakBosonMass: number;
  /** Higgs floor from the unfolded vacuum fraction (0..1) */
  higgsMassFloor: number;
  /** charged-ness of the transcript/protein occupancy channels (0..1) */
  leptonMobility: number;
  /** oxidative electron carrier coupling to the EM photon transport (0..1) */
  electronChannel: number;
  /** quark flavor filling the combinatorial library (0..1) */
  quarkFlavorPopulation: number;
  /** up/down charge asymmetry (specificity vs misfold load, 0..1) */
  upDownAsymmetry: number;
  /** strangeness mixing the coherent + tunneling channels (0..1) */
  strangeFlavor: number;
  /** charm pool above the zero-point excited fold states (0..1) */
  charmPool: number;
  /** proton composite stability (un-aggregated load x surviving coherence, 0..1) */
  protonStability: number;
  // --- Phase H quantum-materials observables (condensed-matter reading of the
  // SAME fold-cluster/quantum pools; mirror Rust omics.rs Phase-H) ---
  latticePeriodicity: number;
  bandGap: number;
  fermiLevel: number;
  conductionBand: number;
  valenceBand: number;
  phononFlux: number;
  excitonBinding: number;
  defectDensity: number;
  dopingLevel: number;
  carrierMobility: number;
  topologicalInvariant: number;
  moireSuperlattice: number;
  latticeThermalSusceptibility: number;
  // --- Phase-I statistical-mechanics / information-theory observables
  // (thermodynamic reading of the SAME fold-cluster/quantum pools; mirror Rust
  // omics.rs Phase-I) ---
  boltzmannEntropy: number;
  shannonDissimilarity: number;
  entropyChangeRate: number;
  gibbsFreeEnergy: number;
  timeReversalAsymmetry: number;
  maxwellDemonPower: number;
  demonInformationCost: number;
  absoluteZeroProximity: number;
  quantumLandauerFloor: number;
  heatCapacityAnomaly: number;
  kbtDamping: number;
  canonicalPartitionZ: number;
  nanoparticleSurface: number;
  nanoparticleDensity: number;
  nanoporeTransport: number;
  nanoscaleContact: number;
  molecularMachineWork: number;
  assemblerAccuracy: number;
  nanofabricationYield: number;
  dnaOrigamiStability: number;
  bionanoInterface: number;
  nanozymeActivity: number;
  colloidalStability: number;
  quantumDotBrightness: number;
  nanotoxicFlux: number;
  viralLoad: number;
  bacterialLoad: number;
  archaealDensity: number;
  fungalBiomass: number;
  protistMotility: number;
  moneraPrimordial: number;
  plantPhotosynthesis: number;
  poriferanChannel: number;
  chordateNeuralTube: number;
  piscesAquaticMetabolism: number;
  mammalThermoregulation: number;
  primateCognition: number;
  symbioticIndex: number;
  metabolicRate: number;
  cardiovascularPump: number;
  respirationEfficiency: number;
  digestiveThroughput: number;
  excretoryClearance: number;
  immuneSurveillance: number;
  neuralConductance: number;
  musculoskeletalOutput: number;
  endocrineSignaling: number;
  thermoregulationControl: number;
  fluidHomeostasis: number;
  sensoryPerception: number;
  growthReplication: number;
}

/** How an agent died, as recorded on `death` events (mirrors Rust DeathCause). */
export type DeathCause = 'starvation' | 'thirst' | 'age' | 'predation' | 'escape' | 'intervention';

interface SimEventBase {
  worldId: string;
  tick: number;
  /** severity hint in [0,1]: rarity/impact of the event, for display and weighting */
  significance: number;
}

/**
 * Simulation events: a discriminated union on `type`. Population-level events
 * (extinction..war) are detected from aggregate stats; individual events
 * (birth/death/predation/discovery/intervention) are emitted at the engine
 * hook points. Payloads are mirrored field-for-field by the Rust engine's
 * `EventData` (camelCase JSON), so analysis code sees the same shape from
 * either engine.
 */
export type SimEvent = SimEventBase &
  (
    | { type: 'extinction'; data: { from: number; to: number } }
    | { type: 'cambrian'; data: { from: number; to: number } }
    | { type: 'migration'; data: { distance: number } }
    | { type: 'symbiosis'; data: { top1: number; top2: number; species: number } }
    | { type: 'famine'; data: { deaths: number } }
    | { type: 'drought'; data: { deaths: number } }
    | { type: 'war'; data: { deaths: number } }
    | {
        type: 'birth';
        data: { agentId: number; parentId: number; mateId?: number; species: number; x: number; y: number; energy: number };
      }
    | {
        type: 'death';
        data: { agentId: number; cause: DeathCause; species: number; x: number; y: number; age: number; energy: number; killerId?: number };
      }
    | { type: 'predation'; data: { predatorId: number; preyId: number; x: number; y: number; bite: number } }
    | { type: 'discovery'; data: { agentId: number; novelty: number } }
    | { type: 'intervention'; data: { itype: InterventionType; x?: number; y?: number; agentId?: number } }
  );

export type EventType = SimEvent['type'];

/** Runtime list of every event type — used by wire codecs and validators. */
export const EVENT_TYPES = [
  'extinction',
  'cambrian',
  'migration',
  'symbiosis',
  'famine',
  'drought',
  'war',
  'birth',
  'death',
  'predation',
  'discovery',
  'intervention',
] as const satisfies readonly EventType[];

/**
 * Event emission filter (WorldConfig.eventPolicy). When `include` is set,
 * only the listed event types are emitted — this is emission-side control,
 * not a retention cap: emitted events are never sampled or truncated later.
 */
export interface EventPolicy {
  include?: EventType[];
}

export type InterventionType =
  | 'meteor'
  | 'seedFood'
  | 'spawnAgent'
  | 'pauseRegion'
  | 'setTimeScale'
  | 'nuke'
  | 'setGene';

export interface Intervention {
  type: InterventionType;
  /** x,y in world units [0, WORLD_SIZE) */
  x?: number;
  y?: number;
  radius?: number;
  amount?: number;
  ticks?: number;
  genome?: Float32Array;
  timeScale?: number;
  /** setGene: target agent id */
  agentId?: number;
  /** setGene: genome index (0-based) */
  index?: number;
  /** setGene: new gene value in [-1, 1] */
  value?: number;
  sequence: number;
}

export interface LineageNode {
  id: number;
  parentId: number;
  bornAtTick: number;
  diedAtTick: number;
  species: number;
  finalFitness: number;
  alive: boolean;
  children: LineageNode[];
}

export interface WorldStatus {
  id: string;
  seed: string;
  fractalType: FractalType;
  params: WorldParams;
  currentTick: number;
  population: number;
  aliveCount: number;
  speciesCount: number;
  createdAt: number;
  interventions: number;
  paused: boolean;
}

export const DEFAULT_PARAMS: WorldParams = {
  cReal: -0.8,
  cImag: 0.156,
  maxIter: 256,
  escapeRadius: 2 ** 16,
  centerX: -0.6,
  centerY: 0,
  worldScale: 4,
  spawnCount: 300,
  metabolismBase: 1,
  maxPopulation: 4000,
  foodRegenRate: 0.0003,
  energyCapacity: 100,
  agentMaxAge: 4000,
  timeScale: 1,
  dayLength: 2400,
  seasonLength: 20000,
};

export function maxAliveAgents(): number {
  return MAX_AGENTS;
}

export function worldSize(): number {
  return WORLD_SIZE;
}
