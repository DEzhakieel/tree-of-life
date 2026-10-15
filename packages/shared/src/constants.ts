/** Plastic recurrent brain block: Elman feedback weights [192..207]. */
export const BRAIN_REC_OFFSET = 192;
export const BRAIN_REC_COUNT = 16;
/** Learned critic over the hidden layer [208..212]: 4 weights + 1 bias. */
export const CRITIC_OFFSET = BRAIN_REC_OFFSET + BRAIN_REC_COUNT;
export const CRITIC_COUNT = 5;
/** Heredity of learned synapses + learning hyper-parameters [213..216]. */
export const PLASTICITY_OFFSET = CRITIC_OFFSET + CRITIC_COUNT;
export const PLASTICITY_COUNT = 4;
export const PLASTICITY_GENES = {
  INHERIT: 0,
  LR: 1,
  GAMMA: 2,
  LAMBDA: 3,
} as const;
export const BRAIN_BLOCK_COUNT = BRAIN_REC_COUNT + CRITIC_COUNT + PLASTICITY_COUNT;
export const GENOME_SIZE = 192 + BRAIN_BLOCK_COUNT;
export const MLP_INPUTS = 15;
export const MLP_HIDDEN = 4;
export const MLP_OUTPUTS = 7;
/**
 * Genome layout (217 genes):
 *   [0..10]    phenotype (11)
 *   [11..109]  brain MLP weights (99)
 *   [110..115] pattern drives (6)
 *   [116..119] strategy (4)
 *   [120..127] chemistry (8)
 *   [128..135] DNA system (8)
 *   [136..143] immune system (8)
 *   [144..151] predator-prey (8)
 *   [152..159] reproduction (8)
 *   [160..167] energy metabolism (8)
 *   [168..175] cellular structure (8)
 *   [176..183] ecosystem adaptation (8)
 *   [184..191] membrane (8)
 *   [192..207] plastic recurrent brain — Elman Wrec (16)
 *   [208..212] learned critic — Wcritic (4) + bias (1)
 *   [213..216] plasticity genes — inherit, lr, gamma, lambda (4)
 */
export const PHENOTYPE_OFFSET = 0;
export const PHENOTYPE_COUNT = 11;
export const MLP_WEIGHTS = MLP_INPUTS * MLP_HIDDEN + MLP_HIDDEN + MLP_HIDDEN * MLP_OUTPUTS + MLP_OUTPUTS; // 99
/** Hidden->output weights + biases (the plastic output layer). */
export const MLP_HOUT_W = MLP_HIDDEN * MLP_OUTPUTS + MLP_OUTPUTS; // 35
export const BRAIN_OFFSET = PHENOTYPE_OFFSET + PHENOTYPE_COUNT;
export const RESERVED_OFFSET = BRAIN_OFFSET + MLP_WEIGHTS;

/**
 * Pattern-drive genes living in the reserved genome region. Each drives one of
 * the universal patterns the web detector reads, so evolution tunes behaviour
 * that *generates* the structures the model hierarchy reports.
 *
 *   [110] alignment    — steer toward the mean heading of neighbours (flow, flocking, synchronization)
 *   [111] cohesion     — steer toward the local centroid (clusters, networks, orbitals)
 *   [112] separation   — steer away from crowding (lattices, honeycombs, packing, voronoi)
 *   [113] circulation  — signed tangential steering around the centroid (spirals, orbitals)
 *   [114] oscillation  — periodic thrust modulation (waves, cycles, oscillations)
 *   [115] noise        — deterministic jitter weight (chaos, randomness)
 */
export const DRIVE_OFFSET = RESERVED_OFFSET; // 110
export const DRIVE_COUNT = 6;
export const DRIVES = {
  ALIGNMENT: 0,
  COHESION: 1,
  SEPARATION: 2,
  CIRCULATION: 3,
  OSCILLATION: 4,
  NOISE: 5,
} as const;

/**
 * Strategy genes: heritable Darwinian game-theory genes that modulate the
 * brain's decisions. Each maps to a weight in [0,1] (except aggression,
 * which is signed so agents can be actively anti-predatory).
 *
 *   [116] aggression    — hunting intensity: >0.5 = predator, <0.5 = prey
 *   [117] cooperation   — greenbeard generosity: tendency to donate surplus
 *   [118] risk          — exploration vs exploitation: willingness to enter hazards
 *   [119] deception     — signal dishonesty: emit signals at lower cost (cheap talk)
 */
export const STRATEGY_OFFSET = DRIVE_OFFSET + DRIVE_COUNT; // 116
export const STRATEGY_COUNT = 4;
export const STRATEGIES = {
  AGGRESSION: 0,
  COOPERATION: 1,
  RISK: 2,
  DECEPTION: 3,
} as const;

/**
 * Chemistry genes: [120..127]
 *   [120] carbBias     — carbon intake preference
 *   [121] nitroBias    — nitrogen intake preference
 *   [122] phosphoBias  — phosphorus intake preference
 *   [123] sulfurBias   — sulfur intake preference
 *   [124] catalysisRate — enzyme production rate
 *   [125] toxResist    — toxin resistance
 *   [126] ionPump      — ion transport efficiency
 *   [127] redoxBalance — oxidation/reduction balance
 */
export const CHEM_OFFSET = STRATEGY_OFFSET + STRATEGY_COUNT; // 120
export const CHEM_GENE_COUNT = 8;
export const CHEM_GENES = {
  CARB_BIAS: 0,
  NITRO_BIAS: 1,
  PHOSPHO_BIAS: 2,
  SULFUR_BIAS: 3,
  CATALYSIS_RATE: 4,
  TOX_RESIST: 5,
  ION_PUMP: 6,
  REDOX_BALANCE: 7,
} as const;

/**
 * DNA system genes: [128..135]
 *   [128] replicationFidelity — DNA copy accuracy (low = more mutations)
 *   [129] repairRate — DNA damage repair speed
 *   [130] repairAccuracy — how well repairs preserve original sequence
 *   [131] geneExpression — base rate of gene activation
 *   [132] epigeneticNoise — stochastic gene expression variation
 *   [133] horizontalTransfer — rate of accepting foreign DNA
 *   [134] transposonRate — internal genome rearrangement rate
 *   [135] dnaStability — resistance to environmental DNA damage
 */
export const DNA_OFFSET = CHEM_OFFSET + CHEM_GENE_COUNT; // 128
export const DNA_GENE_COUNT = 8;
export const DNA_GENES = {
  REPLICATION_FIDELITY: 0,
  REPAIR_RATE: 1,
  REPAIR_ACCURACY: 2,
  GENE_EXPRESSION: 3,
  EPIGENETIC_NOISE: 4,
  HORIZONTAL_TRANSFER: 5,
  TRANSPOSON_RATE: 6,
  DNA_STABILITY: 7,
} as const;

/**
 * Immune system genes: [136..143]
 *   [136] innateImmunity — baseline pathogen resistance
 *   [137] adaptiveImmunity — learned pathogen recognition
 *   [138] immuneMemory — how long immune memory persists
 *   [139] inflammation — damage response intensity
 *   [140] autoImmunity — self-damage risk (overactive immunity)
 *   [141] pathogenDetect — ability to detect infected neighbors
 *   [142] quarantine — tendency to isolate from infected
 *   [143] symbiontTolerance — tolerance of beneficial microbes
 */
export const IMMUNE_OFFSET = DNA_OFFSET + DNA_GENE_COUNT; // 136
export const IMMUNE_GENE_COUNT = 8;
export const IMMUNE_GENES = {
  INNATE: 0,
  ADAPTIVE: 1,
  MEMORY: 2,
  INFLAMMATION: 3,
  AUTOIMMUNITY: 4,
  PATHOGEN_DETECT: 5,
  QUARANTINE: 6,
  SYMBIONT_TOLERANCE: 7,
} as const;

/**
 * Predator-prey genes: [144..151]
 *   [144] stealth — detection avoidance (camouflage)
 *   [145] pursuit — chase speed bonus when hunting
 *   [146] ambush — damage bonus from stationary attack
 *   [147] packHunting — bonus when hunting near allies
 *   [148] escapeUrgency — energy spent on fleeing
 *   [149] warningCall — signal allies about predators
 *   [150] mimicry — resemblance to dangerous species
 *   [151] aposematism — warning coloration (bold colors = toxic)
 */
export const PREDPREY_OFFSET = IMMUNE_OFFSET + IMMUNE_GENE_COUNT; // 144
export const PREDPREY_GENE_COUNT = 8;
export const PREDPREY_GENES = {
  STEALTH: 0,
  PURSUIT: 1,
  AMBUSH: 2,
  PACK_HUNTING: 3,
  ESCAPE_URGENCY: 4,
  WARNING_CALL: 5,
  MIMICRY: 6,
  APOSEMATISM: 7,
} as const;

/**
 * Reproduction genes: [152..159]
 *   [152] sexualRepro — tendency toward sexual vs asexual reproduction
 *   [153] mateSelectivity — choosiness in mate selection
 *   [154] parentalInvestment — energy given to offspring
 *   [155] clutchSize — number of offspring per reproduction event
 *   [156] generationTime — maturation speed
 *   [157] senescence — aging rate after maturity
 *   [158] fecundity — egg/propagule production rate
 *   [159] dormancy — ability to enter休眠 in harsh conditions
 */
export const REPRO_OFFSET = PREDPREY_OFFSET + PREDPREY_GENE_COUNT; // 152
export const REPRO_GENE_COUNT = 8;
export const REPRO_GENES = {
  SEXUAL: 0,
  MATE_SELECTIVITY: 1,
  PARENTAL_INVESTMENT: 2,
  CLUTCH_SIZE: 3,
  GENERATION_TIME: 4,
  SENESCENCE: 5,
  FECUNDITY: 6,
  DORMANCY: 7,
} as const;

/**
 * Energy metabolism genes: [160..167]
 *   [160] basalMetabolicRate — energy cost at rest
 *   [161] aerobicCapacity — efficiency of oxygen-based ATP production
 *   [162] anaerobicCapacity — energy from oxygen-free metabolism
 *   [163] thermoregulation — body heat generation/retention
 *   [164] fatStorage — efficiency of long-term energy storage
 *   [165] sugarMetabolism — glucose processing speed
 *   [166] proteinMetabolism — amino acid processing speed
 *   [167] lipidMetabolism — fatty acid processing speed
 */
export const METAB_OFFSET = REPRO_OFFSET + REPRO_GENE_COUNT; // 160
export const METAB_GENE_COUNT = 8;
export const METAB_GENES = {
  BASAL_RATE: 0,
  AEROBIC: 1,
  ANAEROBIC: 2,
  THERMOREGULATION: 3,
  FAT_STORAGE: 4,
  SUGAR_METAB: 5,
  PROTEIN_METAB: 6,
  LIPID_METAB: 7,
} as const;

/**
 * Cellular structure genes: [168..175]
 *   [168] cellSize — physical cell dimensions
 *   [169] membraneThickness — barrier integrity vs permeability
 *   [170] ribosomeCount — protein synthesis capacity
 *   [171] mitochondriaCount — ATP production organelles
 *   [172] nucleusSize — DNA protection and regulation
 *   [173] cytoskeleton — structural integrity and motility
 *   [174] vesicleTraffic — intracellular transport efficiency
 *   [175] cellAdhesion — tendency to form multicellular clusters
 */
export const CELL_OFFSET = METAB_OFFSET + METAB_GENE_COUNT; // 168
export const CELL_GENE_COUNT = 8;
export const CELL_GENES = {
  CELL_SIZE: 0,
  MEMBRANE_THICKNESS: 1,
  RIBOSOME_COUNT: 2,
  MITOCHONDRIA_COUNT: 3,
  NUCLEUS_SIZE: 4,
  CYTOSKELETON: 5,
  VESICLE_TRAFFIC: 6,
  CELL_ADHESION: 7,
} as const;

/**
 * Ecosystem adaptation genes: [176..183]
 *   [176] nicheSpecialization — breadth of resource utilization
 *   [177] competitiveAbility — success in direct competition
 *   [178] mutualism — tendency toward symbiotic relationships
 *   [179] parasitism — ability to exploit hosts
 *   [180] migration — tendency to move to new areas
 *   [181] territoriality — defense of resource patches
 *   [182] keystone — influence on ecosystem stability
 *   [183] invasiveness — ability to colonize new niches
 */
export const ECOSYSTEM_OFFSET = CELL_OFFSET + CELL_GENE_COUNT; // 176
export const ECOSYSTEM_GENE_COUNT = 8;
export const ECOSYSTEM_GENES = {
  NICHE_SPECIALIZATION: 0,
  COMPETITIVE_ABILITY: 1,
  MUTUALISM: 2,
  PARASITISM: 3,
  MIGRATION: 4,
  TERRITORIALITY: 5,
  KEYSTONE: 6,
  INVASIVENESS: 7,
} as const;

/**
 * Membrane genes: [184..191]
 *   [184] permeability — ease of passive transport
 *   [185] activeTransport — ATP-powered selectivity
 *   [186] endocytosis — engulfing external particles
 *   [187] exocytosis — releasing internal molecules
 *   [188] receptorDensity — sensitivity to external signals
 *   [189] channelDensity — ion channel concentration
 *   [190] pumpDensity — ion pump concentration
 *   [191] lipidComposition — membrane fluidity and stability
 */
export const MEMBRANE_OFFSET = ECOSYSTEM_OFFSET + ECOSYSTEM_GENE_COUNT; // 184
export const MEMBRANE_GENE_COUNT = 8;
export const MEMBRANE_GENES = {
  PERMEABILITY: 0,
  ACTIVE_TRANSPORT: 1,
  ENDOCYTOSIS: 2,
  EXOCYTOSIS: 3,
  RECEPTOR_DENSITY: 4,
  CHANNEL_DENSITY: 5,
  PUMP_DENSITY: 6,
  LIPID_COMPOSITION: 7,
} as const;

/** Simulation world size in logical units (agents live in [0, WORLD_SIZE)^2). */
export const WORLD_SIZE = 2048;
/** Spatial hash cell size in world units. */
export const SPATIAL_CELL = 32;
/** Terrain grid cell size in world units. */
export const TERRAIN_CELL = 16;
/** Terrain grid resolution per axis. */
export const TERRAIN_GRID = WORLD_SIZE / TERRAIN_CELL; // 128

export const TICK_RATE = 60; // ticks per second
export const TICK_MS = 1000 / TICK_RATE;

export const DEFAULT_MAX_ITER = 256;
export const DEEP_MAX_ITER = 1024;
export const DEFAULT_ESCAPE_RADIUS = 2 ** 16;

export const MUTATION_RATE = 0.05;
export const MUTATION_SIGMA = 0.05;
export const SPECIATION_THRESHOLD = 0.9;

/** Binary message type bytes (first byte of every wire message). */
export const MT = {
  SNAPSHOT: 0,
  DELTA: 1,
  STATS: 2,
  WORLD: 3,
  EVENT: 4,
  INTERVENE_ACK: 5,
  SET: 6,
} as const;

export const FIXED_POINT = 64; // positions packed as i16 = worldUnit * FIXED_POINT

/** Agent wire state codes. */
export const STATE = {
  ALIVE: 0,
  DEAD: 1,
  BORN: 2,
  PAUSED: 3,
} as const;

export const MAX_AGENTS = 12000;

// ---------------------------------------------------------------------------
// Chemistry constants
// ---------------------------------------------------------------------------

/** Number of base chemical elements agents carry. */
export const ELEMENT_COUNT = 8;
export const ELEMENTS = {
  CARBON: 0,       // C  — energy storage backbone
  HYDROGEN: 1,     // H  — fast energy, volatile, water component
  OXYGEN: 2,       // O  — oxidation, respiration, water component
  NITROGEN: 3,     // N  — proteins, nucleic acids
  PHOSPHORUS: 4,   // P  — ATP backbone, DNA, energy transfer
  SULFUR: 5,       // S  — protein folding, Fe-S clusters
  IRON: 6,         // Fe — electron transport, catalysis
  POTASSIUM: 7,    // K  — osmotic balance, nerve signalling
} as const;

/** Number of tracked molecular species in agent chemistry. */
export const MOLECULE_COUNT = 12;
export const MOLECULES = {
  GLUCOSE: 0,       // C6H12O6  — primary fuel
  ATP: 1,           // adenosine triphosphate — universal energy currency
  AMINO_ACID: 2,    // protein building block
  LIPID: 3,         // membrane / long-term energy store
  NUCLEOTIDE: 4,    // DNA/RNA building block
  ENZYME: 5,        // catalytic protein
  PROTEIN: 6,       // structural / functional macromolecule
  TOXIN: 7,         // defensive poison
  SIGNAL_MOL: 8,    // chemical pheromone / signal molecule
  SUGAR: 9,         // simple sugar (monosaccharide)
  FATTY_ACID: 10,   // lipid precursor
  OSMOLYTE: 11,     // osmolyte — regulates internal water balance
} as const;

/** Number of tracked ion species. */
export const ION_COUNT = 5;
export const IONS = {
  SODIUM: 0,        // Na+  — membrane potential
  POTASSIUM_ION: 1, // K+   — membrane potential, osmotic
  CALCIUM: 2,       // Ca2+ — signalling cascade second messenger
  IRON_ION: 3,      // Fe2+/Fe3+ — redox, enzyme cofactor
  CHLORIDE: 4,      // Cl-  — osmotic balance, inhibitory signals
} as const;

/** Number of enzyme types that catalyse reaction classes. */
export const ENZYME_TYPE_COUNT = 6;
export const ENZYME_TYPES = {
  OXIDASE: 0,       // catalyses oxidation of sugars → CO2 + ATP
  SYNTHASE: 1,      // catalyses anabolic synthesis (amino → protein etc.)
  HYDROLASE: 2,     // catalyses hydrolysis (macromolecule → monomers)
  LIGASE: 3,        // catalyses bond formation using ATP
  TRANSFERASE: 4,   // catalyses group transfer between molecules
  LYASE: 5,         // catalyses non-hydrolytic bond cleavage / formation
} as const;

/** Maximum concentrations for normalisation. */
export const CHEM_MAX_ELEMENT = 100;
export const CHEM_MAX_MOLECULE = 100;
export const CHEM_MAX_ION = 50;
export const CHEM_MAX_ENZYME = 20;

/** Reaction rate constant (base). */
export const REACTION_RATE = 0.004;

/** Membrane transport rate constant. */
export const TRANSPORT_RATE = 0.006;

/** Chemical diffusion rate per tick on terrain grids. */
export const CHEM_DIFFUSE_RATE = 0.08;
export const CHEM_DECAY_RATE = 0.995;

/** pH neutral value and range. */
export const PH_NEUTRAL = 7.0;
export const PH_RANGE = 4.0;

/** Soil mineral ion weathering rate. */
export const MINERAL_ION_RATE = 0.0005;

// ---------------------------------------------------------------------------
// Biological system constants
// ---------------------------------------------------------------------------

/** DNA replication base error rate per gene per division. */
export const DNA_BASE_ERROR_RATE = 0.001;
/** DNA repair energy cost (ATP per repair event). */
export const DNA_REPAIR_COST = 0.5;
/** Maximum pathogen load before immune system fails. */
export const MAX_PATHOGEN_LOAD = 100;
/** Base infection rate when exposed to pathogens. */
export const BASE_INFECTION_RATE = 0.02;
/** Immune response energy cost per tick. */
export const IMMUNE_COST = 0.002;
/** Predator damage multiplier per tick of contact. */
export const PREDATION_DAMAGE = 0.015;
/** Escape energy cost multiplier. */
export const ESCAPE_COST = 0.008;
/** Pack hunting bonus multiplier per nearby ally. */
export const PACK_BONUS = 0.12;
/** Sexual reproduction energy cost multiplier vs asexual. */
export const SEXUAL_COST_MULT = 1.5;
/** Offspring energy transfer rate from parent. */
export const OFFSPRING_ENERGY_TRANSFER = 0.3;
/** Maximum age multiplier for senescence. */
export const SENESCENCE_MAX_AGE = 3;
/** Basal metabolic energy cost per tick. */
export const BASAL_METABOLIC_COST = 0.003;
/** Aerobic ATP production rate. */
export const AEROBIC_ATP_RATE = 0.01;
/** Anaerobic ATP production rate (less efficient). */
export const ANAEROBIC_ATP_RATE = 0.003;
/** Phase M biome regime: fraction per tick (at ts = 1) the chemical terrain is
 *  pulled toward an explicit environment preset's profile bases (o2/ph/toxin/
 *  minerals). Absent presets never re-inject — legacy worlds are untouched. */
export const ENV_REINJECT_RATE = 0.02;
/** Thermoregulation energy cost. */
export const THERMOREGULATION_COST = 0.001;
/** Cell division energy threshold. */
export const CELL_DIVISION_THRESHOLD = 0.8;
/** Membrane transport ATP cost. */
export const MEMBRANE_TRANSPORT_COST = 0.001;
/** Pathogen detection radius multiplier. */
export const PATHOGEN_DETECT_RADIUS = 1.5;
/** Mutualism benefit multiplier. */
export const MUTUALISM_BONUS = 0.1;
/** Parasitism drain rate. */
export const PARASITISM_DRAIN = 0.005;
/** Territorial defense energy cost. */
export const TERRITORIAL_COST = 0.003;
/** Dormancy energy conservation factor. */
export const DORMANCY_CONSERVATION = 0.3;
/** Clutch size energy scaling. */
export const CLUTCH_ENERGY_SCALE = 0.1;

// ---------------------------------------------------------------------------
// Cell biochemistry constants (opt-in via WorldConfig.cellBio)
// ---------------------------------------------------------------------------

/** Number of protein classes in the proteome (structural, enzymatic, chaperone, signalling). */
export const PROTEOME_SIZE = 4;
/** Fold quality improvement rate per chaperone unit per tick. */
export const CHAPERONE_FOLD_RATE = 0.02;
/** ATP cost per unit of chaperone folding work. */
export const CHAPERONE_ATP_COST = 0.05;
/** Misfold stress natural decay rate per tick. */
export const MISFOLD_STRESS_DECAY = 0.01;
/** Membrane damage per unit of misfold stress per tick. */
export const MISFOLD_MEMBRANE_DAMAGE = 0.005;
/** Protein degradation (turnover) rate per tick. */
export const PROTEIN_TURNOVER_RATE = 0.005;
/** Rate of molecule transport along cytoskeleton between bulk and gradient. */
export const GRADIENT_PROPAGATION_RATE = 0.01;
/** Passive membrane diffusion rate per tick (multiplied by permeability). */
export const PASSIVE_DIFFUSION_RATE = 0.005;
/** Michaelis-Menten half-max substrate constant. */
export const MM_KM = 10.0;
/** End-product inhibition strength (dimensionless). */
export const MM_INHIBITION = 0.3;
/** Membrane repair rate from lipid pool per tick (multiplied by lipidComposition). */
export const LIPID_REPAIR_RATE = 0.01;
/** ATP cost of lipid-based membrane repair per tick. */
export const LIPID_REPAIR_ATP = 0.03;
/** Sensitivity of fold quality to sulfur deficiency (S < 3). */
export const FOLDING_SULFUR_SENSITIVITY = 0.3;

// ---------------------------------------------------------------------------
// Biophysics constants (opt-in via WorldConfig.biophysics)
// ---------------------------------------------------------------------------

/** Lennard-Jones repulsion range (world units). */
export const FORCE_REP_SIGMA = 8.0;
/** Lennard-Jones repulsion strength. */
export const FORCE_REP_K = 0.02;
/** Lennard-Jones attraction strength. */
export const FORCE_ATTRACT_K = 0.002;
/** Force-field interaction cutoff radius (world units). */
export const FORCE_CUTOFF = 24.0;
/** Radial floor that keeps close-range forces finite (world units). */
export const FORCE_SOFTEN_R = 3.0;
/** Per-pair force magnitude ceiling applied to steering. */
export const FORCE_MAX = 6.0;
/** Coupling of the applied force pass into the movement drive. */
export const FORCE_DRIVE_SCALE = 8.0;
/** Hydrophilic trait-affinity matching weight. */
export const AFFINITY_WEIGHT = 1.0;
/** Hydrophobic trait mismatch repulsion weight. */
export const REPULSION_WEIGHT = 1.0;
/** Relative mass-conservation drift tolerance (anomaly flag threshold). */
export const CONSERVATION_MASS_TOL = 0.0001;
/** Chirality / circular-symmetry drift tolerance. */
export const SYMMETRY_POLARITY_TOL = 0.001;
/** Per-unit bond enthalpy scale. */
export const BOND_ENERGY_K = 0.6;
/** Gibbs free-energy weight on the enthalpy term. */
export const ENTHALPY_GIBBS_WEIGHT = 0.8;
/** Entropy production rate scaling. */
export const ENTROPY_PRODUCTION_K = 0.02;
/** Carnot engine cold-reservoir temperature (K). */
export const CARNOT_TEMP_MIN = 278.0;
/** Carnot engine hot-reservoir temperature (K). */
export const CARNOT_TEMP_MAX = 310.0;
/** Fraction of metabolic ATP lost as heat. */
export const HEAT_WASTE_FRACTION = 0.4;
/** Work-rate (engine power) conversion scale. */
export const ENGINE_POWER_K = 0.5;
/** Gray-body emissivity for radiation bookkeeping. */
export const RADIATION_EMISSIVITY = 0.9;
/** Stefan-Boltzmann constant (W m^-2 K^-4). */
export const RADIATION_STEFAN_BOLTZMANN = 5.67e-8;

// --- Omics constants (opt-in via WorldConfig.omics) ---
// A molecular-omics layer: transcriptomics (mrna pools driven by dna expression
// + epigenetic marks), proteomics (protein pools), fluxomics (pathway throughput
// over the 12 molecule pools), interactomics telemetry. Phase A = observables;
// Phase B couples pools into energy, digestion, repair, heritability.
/** Transcript pools, mirroring dna.expression blocks. */
export const OMICS_MRNA_BLOCKS = 24;
/** Protein pools, one per expression block. */
export const OMICS_PROTEIN_BLOCKS = 24;
/** Fluxome reactions, aligned to the enzyme types. */
export const OMICS_REACTION_COUNT = 6;
/** Basal transcription rate per block per tick. */
export const OMICS_TRANSCRIBE_BASE = 0.12;
/** Transcript decay per tick. */
export const OMICS_MRNA_DECAY = 0.06;
/** Protein turnover per tick. */
export const OMICS_PROTEIN_DECAY = 0.03;
/** Translation yield (protein per mrna per tick). */
export const OMICS_PROTEIN_YIELD = 0.08;
/** Transcription induction amplitude from the environment. */
export const OMICS_ENV_INDUCTION = 1.3;
/** Silencing effectiveness of an epigenetic mark. */
export const OMICS_EPI_SILENCE = 0.65;
/** Flux = catalyst * substrate-drive * cofactor * scale * dt. */
export const OMICS_FLUX_SCALE = 0.05;
// Phase B active fluxome: the computed reaction fluxes are APPLIED back onto the
// molecule pools (consume substrates, produce products). Anabolic products,
// catabolic ATP recovery, ligase ATP drain and split products all use these.
/** Anabolic product units per unit of flux consumed. */
export const OMICS_FLUX_YIELD = 0.8;
/** Product/substrate share when a reaction splits into two outputs. */
export const OMICS_FLUX_SPLIT = 0.5;
/** ATP recovered per catabolic (hydrolase) flux unit. */
export const OMICS_FLUX_CATABOLIC_BONUS = 0.3;
/** ATP drained per ligase flux unit. */
export const OMICS_FLUX_LIGASE_COST = 0.5;
// --- Phase C: regulatory protein-folding layer (opt-in, WorldConfig.omics + sub-flags) ---
// Stochastic gene expression (WorldConfig.omicsStochastic): a per-block OU noise
// process on transcription, so identical genomes diverge cell-to-cell.
/** OU mean-reversion rate of the per-block expression noise. */
export const OMICS_NOISE_THETA = 0.02;
/** OU volatility (std of the noise-driving Gaussian per unit time). */
export const OMICS_NOISE_SIGMA = 0.015;
/** Noise amplification into the transcription rate (0.0.., sensible ~0.5). */
export const OMICS_NOISE_GAIN = 0.6;
// Protein folding stability landscape: each protein block derives a folding
// stability from its sequence fingerprint (motif); the native fraction relaxes
// toward a Boltzmann equilibrium scaled by folding temperature (heat).
/** Fold relaxation rate per tick toward the equilibrium native fraction. */
export const OMICS_FOLD_RATE = 0.04;
/** Thermal scale of the native-fraction Boltzmann factor (fold units/K). */
export const OMICS_FOLD_MELT = 2.5;
/** Width of the folding-energy distribution per block (fold units). */
export const OMICS_FOLD_RANGE = 2.0;
/** Misfolded protein turnover vs native (fold-misfolded decay faster). */
export const OMICS_MISFOLD_DECAY = 0.12;
/** Misfold load above which the UPR damps transcription. */
export const OMICS_UPR_THRESHOLD = 0.15;
/** Strength of the UPR transcription damping. */
export const OMICS_UPR_GAIN = 1.5;
// Transcription-factor motifs + combinatorial promoter gates: each block's TF
// carries a sequence fingerprint (motif) that binds to other blocks' promoter
// addresses; gates combine two regulators through OR / AND / NOT logic.
/** Affinity scale of motif<->promoter hamming distance into binding. */
export const OMICS_TF_AFFINITY_K = 1.6;
/** Minimal regulator multiplier on transcription (per-block). */
export const OMICS_TF_REG_MIN = 0.35;
/** Maximal regulator multiplier on transcription (per-block). */
export const OMICS_TF_REG_MAX = 3.0;
/** Bits of the motif / env signature used for recognition binding. */
export const OMICS_TF_SIGNATURE_BITS = 12;
/** Blocks per expression window used to recognise a recurring env pattern. */
export const OMICS_ENV_WINDOW = 8;
/** Environment signature buckets per dimension (per-axis quantisation). */
export const OMICS_ENV_BUCKETS = 4;
// Combinatorial library chemistry (WorldConfig.combinatorial): an oligomer
// library ligated from molecule-pair pools, screened by the native (folded)
// catalyst fraction — the "combinatorial space" the fluxome explores.
/** Number of oligomer library pools (static molecule-pair table). */
export const OMICS_LIBRARY_SIZE = 16;
/** Oligomer ligation rate (library pools per unit substrate x catalyst). */
export const OMICS_LIBRARY_LIGATE = 0.02;
/** Oligomer decay rate per tick. */
export const OMICS_LIBRARY_DECAY = 0.05;
/** Oligomer pool cap (unlike molecules, oligomers scale out of 100). */
export const OMICS_LIBRARY_MAX = 40;
// Phase D folding-cluster constants (WorldConfig.folding) — mirrored
// bit-faithfully from crates/shared/constants.rs. A chaperone scalar + a
// per-block aggregate pool drive the refold cascade that the library screen
// then ligand-selects against.
/** Chaperone-mediated refolding / aggregate-dissolve rate per tick. */
export const OMICS_CHAP_RATE = 0.06;
/** Misfolded-protein -> aggregate seeding rate per tick. */
export const OMICS_AGG_SEED = 0.05;
/** Spontaneous aggregate dissolution rate per tick. */
export const OMICS_AGG_DISSOLVE = 0.02;
/** Aggregate-driven misfold cascade gain (amplifies the cascade). */
export const OMICS_CASCADE_GAIN = 0.5;
/** Aggregate load at which the cascade starts to kick in (Power law). */
export const OMICS_AGG_THRESHOLD = 0.3;
/** Combinatorial library selection/refinement rate per tick. */
export const OMICS_SELECT_RATE = 0.006;
/** Pair affinity below which a library variant is depleted (weak binder). */
export const OMICS_BIND_WEAK = 0.25;
/** Pair affinity above which a library variant is replenished (strong binder). */
export const OMICS_BIND_STRONG = 0.5;
// Genome recombination operators (WorldConfig.recombination): heritable
// multi-point crossover, intra-genome block shuffles, and per-block
// combinatorial assembly from both parents.
/** Maximum crossover points used by multi-point recombination. */
export const RECOMB_MAX_POINTS = 5;
/** Gene blocks used by combinatorial assembly / shuffle. */
export const RECOMB_BLOCK_COUNT = 8;
/** Minimum block size in genes for shuffle/assembly. */
export const RECOMB_BLOCK_MIN_GENES = 8;
