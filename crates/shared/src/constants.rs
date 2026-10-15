pub const GENOME_SIZE: usize = 192 + BRAIN_BLOCK_COUNT;
pub const MLP_INPUTS: usize = 15;
pub const MLP_HIDDEN: usize = 4;
pub const MLP_OUTPUTS: usize = 7;
pub const MLP_WEIGHTS: usize =
    MLP_INPUTS * MLP_HIDDEN + MLP_HIDDEN + MLP_HIDDEN * MLP_OUTPUTS + MLP_OUTPUTS;
/// Hidden->output weights + biases of the MLP (the plastic output layer on
/// which surprise-modulated Hebbian learning writes).
pub const MLP_HOUT_W: usize = MLP_HIDDEN * MLP_OUTPUTS + MLP_OUTPUTS;

// Plastic recurrent brain block — appended after the 8-gene membrane block
// so all existing gene offsets stay intact.
//   [192..207] Wrec        — 16 Elman recurrent weights (flat 4x4)
//   [208..211] Wcritic     — critic weights over hidden (4)
//   [212]      critic_bias — critic bias (1)
//   [213]      inherit     — heredity of learned synapses (alpha)
//   [214]      lr          — plastic learning-rate scale
//   [215]      gamma       — TD discount for the critic
//   [216]      lambda      — eligibility-trace decay
pub const BRAIN_REC_OFFSET: usize = 192;
pub const BRAIN_REC_COUNT: usize = 16;
pub const CRITIC_OFFSET: usize = BRAIN_REC_OFFSET + BRAIN_REC_COUNT;
pub const CRITIC_COUNT: usize = 5;
pub const PLASTICITY_OFFSET: usize = CRITIC_OFFSET + CRITIC_COUNT;
pub const PLASTICITY_COUNT: usize = 4;
pub const BRAIN_BLOCK_COUNT: usize = BRAIN_REC_COUNT + CRITIC_COUNT + PLASTICITY_COUNT;

pub const PHENOTYPE_OFFSET: usize = 0;
pub const PHENOTYPE_COUNT: usize = 11;
pub const BRAIN_OFFSET: usize = PHENOTYPE_OFFSET + PHENOTYPE_COUNT;
pub const RESERVED_OFFSET: usize = BRAIN_OFFSET + MLP_WEIGHTS;

pub const DRIVE_OFFSET: usize = RESERVED_OFFSET;
pub const DRIVE_COUNT: usize = 6;
pub mod drives {
    pub const ALIGNMENT: usize = 0;
    pub const COHESION: usize = 1;
    pub const SEPARATION: usize = 2;
    pub const CIRCULATION: usize = 3;
    pub const OSCILLATION: usize = 4;
    pub const NOISE: usize = 5;
}

pub const STRATEGY_OFFSET: usize = DRIVE_OFFSET + DRIVE_COUNT;
pub const STRATEGY_COUNT: usize = 4;
pub mod strategies {
    pub const AGGRESSION: usize = 0;
    pub const COOPERATION: usize = 1;
    pub const RISK: usize = 2;
    pub const DECEPTION: usize = 3;
}

pub const CHEM_OFFSET: usize = STRATEGY_OFFSET + STRATEGY_COUNT;
pub const CHEM_GENE_COUNT: usize = 8;

pub const DNA_OFFSET: usize = CHEM_OFFSET + CHEM_GENE_COUNT;
pub const DNA_GENE_COUNT: usize = 8;

pub const IMMUNE_OFFSET: usize = DNA_OFFSET + DNA_GENE_COUNT;
pub const IMMUNE_GENE_COUNT: usize = 8;

pub const PREDPREY_OFFSET: usize = IMMUNE_OFFSET + IMMUNE_GENE_COUNT;
pub const PREDPREY_GENE_COUNT: usize = 8;

pub const REPRO_OFFSET: usize = PREDPREY_OFFSET + PREDPREY_GENE_COUNT;
pub const REPRO_GENE_COUNT: usize = 8;

pub const METAB_OFFSET: usize = REPRO_OFFSET + REPRO_GENE_COUNT;
pub const METAB_GENE_COUNT: usize = 8;

pub const CELL_OFFSET: usize = METAB_OFFSET + METAB_GENE_COUNT;
pub const CELL_GENE_COUNT: usize = 8;

pub const ECOSYSTEM_OFFSET: usize = CELL_OFFSET + CELL_GENE_COUNT;
pub const ECOSYSTEM_GENE_COUNT: usize = 8;

pub const MEMBRANE_OFFSET: usize = ECOSYSTEM_OFFSET + ECOSYSTEM_GENE_COUNT;
pub const MEMBRANE_GENE_COUNT: usize = 8;

// World
pub const WORLD_SIZE: f32 = 2048.0;
pub const WORLD_SIZE_USIZE: usize = 2048;
pub const SPATIAL_CELL: f32 = 32.0;
pub const TERRAIN_CELL: f32 = 16.0;
pub const TERRAIN_GRID: usize = (WORLD_SIZE_USIZE as f32 / TERRAIN_CELL) as usize;

pub const TICK_RATE: f32 = 60.0;
pub const TICK_MS: f32 = 1000.0 / TICK_RATE;

pub const DEFAULT_MAX_ITER: u32 = 256;
pub const DEEP_MAX_ITER: u32 = 1024;
pub const DEFAULT_ESCAPE_RADIUS: f64 = 65536.0;

pub const MUTATION_RATE: f32 = 0.05;
pub const MUTATION_SIGMA: f32 = 0.05;
pub const SPECIATION_THRESHOLD: f32 = 0.9;

pub const FIXED_POINT: f32 = 64.0;
pub const MAX_AGENTS: usize = 12000;

// Message types
pub const MT_SNAPSHOT: u8 = 0;
pub const MT_DELTA: u8 = 1;
pub const MT_STATS: u8 = 2;
pub const MT_WORLD: u8 = 3;
pub const MT_EVENT: u8 = 4;
pub const MT_INTERVENE_ACK: u8 = 5;
pub const MT_SET: u8 = 6;

// Agent states
pub const STATE_ALIVE: u8 = 0;
pub const STATE_DEAD: u8 = 1;
pub const STATE_BORN: u8 = 2;
pub const STATE_PAUSED: u8 = 3;

// Chemistry constants
pub const ELEMENT_COUNT: usize = 8;
pub const MOLECULE_COUNT: usize = 12;
pub const ION_COUNT: usize = 5;
pub const ENZYME_TYPE_COUNT: usize = 6;
pub const CHEM_MAX_ELEMENT: f32 = 100.0;
pub const CHEM_MAX_MOLECULE: f32 = 100.0;
pub const CHEM_MAX_ION: f32 = 50.0;
pub const CHEM_MAX_ENZYME: f32 = 20.0;
pub const REACTION_RATE: f32 = 0.004;
pub const TRANSPORT_RATE: f32 = 0.006;
pub const CHEM_DIFFUSE_RATE: f32 = 0.08;
pub const CHEM_DECAY_RATE: f32 = 0.995;
pub const PH_NEUTRAL: f32 = 7.0;
pub const PH_RANGE: f32 = 4.0;
pub const MINERAL_ION_RATE: f32 = 0.0005;

// Biology constants
pub const DNA_BASE_ERROR_RATE: f32 = 0.001;
pub const DNA_REPAIR_COST: f32 = 0.5;
pub const MAX_PATHOGEN_LOAD: f32 = 100.0;
pub const BASE_INFECTION_RATE: f32 = 0.02;
pub const IMMUNE_COST: f32 = 0.002;
pub const PREDATION_DAMAGE: f32 = 0.015;
pub const ESCAPE_COST: f32 = 0.008;
pub const PACK_BONUS: f32 = 0.12;
pub const SEXUAL_COST_MULT: f32 = 1.5;
pub const OFFSPRING_ENERGY_TRANSFER: f32 = 0.3;
pub const SENESCENCE_MAX_AGE: f32 = 3.0;
pub const BASAL_METABOLIC_COST: f32 = 0.003;
pub const AEROBIC_ATP_RATE: f32 = 0.01;
pub const ANAEROBIC_ATP_RATE: f32 = 0.003;
/// Phase M biome regime: fraction per tick (at ts = 1) the chemical terrain is
/// pulled toward an explicit environment preset's profile bases (o2/ph/toxin/
/// minerals). Absent presets never re-inject — legacy worlds are untouched.
pub const ENV_REINJECT_RATE: f32 = 0.02;
pub const THERMOREGULATION_COST: f32 = 0.001;
pub const CELL_DIVISION_THRESHOLD: f32 = 0.8;
pub const MEMBRANE_TRANSPORT_COST: f32 = 0.001;
pub const PATHOGEN_DETECT_RADIUS: f32 = 1.5;
pub const MUTUALISM_BONUS: f32 = 0.1;
pub const PARASITISM_DRAIN: f32 = 0.005;
pub const TERRITORIAL_COST: f32 = 0.003;
pub const DORMANCY_CONSERVATION: f32 = 0.3;
pub const CLUTCH_ENERGY_SCALE: f32 = 0.1;

// Cell biochemistry constants (opt-in via WorldConfig.cellBio)
pub const PROTEOME_SIZE: usize = 4;
pub const CHAPERONE_FOLD_RATE: f32 = 0.02;
pub const CHAPERONE_ATP_COST: f32 = 0.05;
pub const MISFOLD_STRESS_DECAY: f32 = 0.01;
pub const MISFOLD_MEMBRANE_DAMAGE: f32 = 0.005;
pub const PROTEIN_TURNOVER_RATE: f32 = 0.005;
pub const GRADIENT_PROPAGATION_RATE: f32 = 0.01;
pub const PASSIVE_DIFFUSION_RATE: f32 = 0.005;
pub const MM_KM: f32 = 10.0;
pub const MM_INHIBITION: f32 = 0.3;
pub const LIPID_REPAIR_RATE: f32 = 0.01;
pub const LIPID_REPAIR_ATP: f32 = 0.03;
pub const FOLDING_SULFUR_SENSITIVITY: f32 = 0.3;

// Biophysics constants (opt-in via WorldConfig.biophysics)
// Lennard-Jones-like agent force field (observable telemetry; the force
// pass is applied to steering when WorldConfig.biophysics is set).
pub const FORCE_REP_SIGMA: f32 = 8.0;
pub const FORCE_REP_K: f32 = 0.02;
pub const FORCE_ATTRACT_K: f32 = 0.002;
pub const FORCE_CUTOFF: f32 = 24.0;
// Steering coupling of the force pass (Phase 2).
pub const FORCE_SOFTEN_R: f32 = 3.0;
pub const FORCE_MAX: f32 = 6.0;
pub const FORCE_DRIVE_SCALE: f32 = 8.0;
// Trait-affinity matching weights for the repulsion/attraction envelope.
pub const AFFINITY_WEIGHT: f32 = 1.0;
pub const REPULSION_WEIGHT: f32 = 1.0;
// Conservation / symmetry tie-outs (phase-2 survival wiring).
pub const CONSERVATION_MASS_TOL: f32 = 0.0001;
pub const SYMMETRY_POLARITY_TOL: f32 = 0.001;
// Thermodynamics of metabolism (enthalpy / entropy / Carnot engine).
pub const BOND_ENERGY_K: f32 = 0.6;
pub const ENTHALPY_GIBBS_WEIGHT: f32 = 0.8;
pub const ENTROPY_PRODUCTION_K: f32 = 0.02;
pub const CARNOT_TEMP_MIN: f32 = 278.0;
pub const CARNOT_TEMP_MAX: f32 = 310.0;
pub const HEAT_WASTE_FRACTION: f32 = 0.4;
pub const ENGINE_POWER_K: f32 = 0.5;
// Radiation field (gray-body emission for thermal balance bookkeeping).
pub const RADIATION_EMISSIVITY: f32 = 0.9;
pub const RADIATION_STEFAN_BOLTZMANN: f32 = 5.67e-8;

// Omics constants (opt-in via WorldConfig.omics). A molecular-omics layer:
// transcriptomics (mrna pools driven by dna expression + epigenetic marks),
// proteomics (protein pools translated from the transcriptome), fluxomics
// (pathway throughput over the 12 molecule pools gated by the proteome), and
// interactomics telemetry. Phase A computes observables only; Phase B couples
// the pools into energy, digestion, repair and heritability.
pub const OMICS_MRNA_BLOCKS: usize = 24; // transcript pools, mirroring dna.expression blocks
pub const OMICS_PROTEIN_BLOCKS: usize = 24; // protein pools, one per expression block
pub const OMICS_REACTION_COUNT: usize = 6; // fluxome reactions, aligned to the enzyme types
pub const OMICS_TRANSCRIBE_BASE: f32 = 0.12; // basal transcription rate per block per tick
pub const OMICS_MRNA_DECAY: f32 = 0.06; // transcript decay per tick
pub const OMICS_PROTEIN_DECAY: f32 = 0.03; // protein turnover per tick
pub const OMICS_PROTEIN_YIELD: f32 = 0.08; // translation yield (protein per mrna per tick)
pub const OMICS_ENV_INDUCTION: f32 = 1.3; // transcription induction amplitude from the environment
pub const OMICS_EPI_SILENCE: f32 = 0.65; // silencing effectiveness of an epigenetic mark
pub const OMICS_FLUX_SCALE: f32 = 0.05; // flux = catalyst * substrate-drive * cofactor * scale * dt

// Phase B active fluxome: the computed reaction fluxes are APPLIED back onto the
// molecule pools (consume substrates, produce products). Anabolic products,
// catabolic ATP recovery, ligase ATP drain and split products all use these.
pub const OMICS_FLUX_YIELD: f32 = 0.8; // anabolic product units per flux unit consumed
pub const OMICS_FLUX_SPLIT: f32 = 0.5; // product/substrate share when a reaction splits into two
pub const OMICS_FLUX_CATABOLIC_BONUS: f32 = 0.3; // ATP recovered per catabolic (hydrolase) flux unit
pub const OMICS_FLUX_LIGASE_COST: f32 = 0.5; // ATP drained per ligase flux unit

// Phase C regulatory protein-folding layer (opt-in behind the omics flag + the
// omicsStochastic / combinatorial sub-flags): stochastic gene expression (per-
// block OU noise), a protein folding stability landscape (native fraction +
// misfold + UPR), transcription-factor motif binding + combinatorial promoter
// gates, environment pattern classification, and a combinatorial oligomer
// library screened by the folded proteome.
pub const OMICS_NOISE_THETA: f32 = 0.02; // OU mean-reversion of expression noise
pub const OMICS_NOISE_SIGMA: f32 = 0.015; // OU volatility of the noise process
pub const OMICS_NOISE_GAIN: f32 = 0.6; // noise amplification into transcription
pub const OMICS_FOLD_RATE: f32 = 0.04; // native-fraction relaxation per tick
pub const OMICS_FOLD_MELT: f32 = 2.5; // thermal scale of the fold Boltzmann factor
pub const OMICS_FOLD_RANGE: f32 = 2.0; // folding-energy distribution width
pub const OMICS_MISFOLD_DECAY: f32 = 0.12; // misfolded protein turnover
pub const OMICS_UPR_THRESHOLD: f32 = 0.15; // misfold load that triggers the UPR
pub const OMICS_UPR_GAIN: f32 = 1.5; // UPR transcription damping strength
pub const OMICS_TF_AFFINITY_K: f32 = 1.6; // motif<>promoter hamming -> binding scale
pub const OMICS_TF_REG_MIN: f32 = 0.35; // min regulator multiplier on transcription
pub const OMICS_TF_REG_MAX: f32 = 3.0; // max regulator multiplier on transcription
pub const OMICS_TF_SIGNATURE_BITS: usize = 12; // motif / env signature bits for binding
pub const OMICS_ENV_WINDOW: usize = 8; // env pattern memory window (ticks)
pub const OMICS_ENV_BUCKETS: usize = 4; // env signature buckets per dimension
pub const OMICS_LIBRARY_SIZE: usize = 16; // oligomer library pools
pub const OMICS_LIBRARY_LIGATE: f32 = 0.02; // oligomer ligation rate
pub const OMICS_LIBRARY_DECAY: f32 = 0.05; // oligomer turnover
pub const OMICS_LIBRARY_MAX: f32 = 40.0; // oligomer pool cap

// Phase D protein-folding mechanics (WorldConfig.folding, requires omics):
// chaperone capacity + aggregate cascade on top of the Phase C folding layer.
pub const OMICS_CHAP_RATE: f32 = 0.06; // chaperone-mediated refold/dissolve rate per tick
pub const OMICS_AGG_SEED: f32 = 0.05; // misfold -> aggregate seeding rate per tick
pub const OMICS_AGG_DISSOLVE: f32 = 0.02; // spontaneous aggregate dissolution per tick
pub const OMICS_CASCADE_GAIN: f32 = 0.5; // aggregate-driven misfold amplification
pub const OMICS_AGG_THRESHOLD: f32 = 0.3; // aggregate load that powers the cascade

// Phase D combinatorial selection (WorldConfig.combinatorial): pairwise
// binding-config selection pressure on the oligomer library.
pub const OMICS_SELECT_RATE: f32 = 0.006; // library selection depletion/replenish per tick
pub const OMICS_BIND_WEAK: f32 = 0.25; // pair affinity below which binders are depleted
pub const OMICS_BIND_STRONG: f32 = 0.5; // pair affinity above which binders are replenished

// Phase D stochastic dynamics (WorldConfig.stochasticDynamics): behaviour-level
// randomness — error-prone replication (mutation bursts) + behavioural OU noise.
pub const STOCH_BURST_RATE: f64 = 0.08; // probability a child division fires a mutation burst
pub const STOCH_BURST_MAX: u32 = 3; // extra mutate passes per burst (1..=MAX)
pub const STOCH_OU_THETA: f64 = 0.02; // behavioural OU mean-reversion
pub const STOCH_OU_SIGMA: f64 = 0.10; // behavioural OU volatility
pub const STOCH_OU_LIMIT: f64 = 0.25; // behavioural noise clamp magnitude

// Genome recombination operators (WorldConfig.recombination): multi-point
// crossover, intra-genome block shuffle and per-block combinatorial assembly.
pub const RECOMB_MAX_POINTS: usize = 5; // max crossover points
pub const RECOMB_BLOCK_COUNT: usize = 8; // assembly blocks over the genome
pub const RECOMB_BLOCK_MIN_GENES: usize = 8; // minimum block size in genes
