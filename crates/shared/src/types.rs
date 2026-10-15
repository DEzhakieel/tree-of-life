use serde::Serialize;

pub type FractalType = &'static str;

#[derive(Clone, Debug)]
pub struct WorldParams {
    pub c_real: f64,
    pub c_imag: f64,
    pub max_iter: u32,
    pub escape_radius: f64,
    pub center_x: f64,
    pub center_y: f64,
    pub world_scale: f64,
    pub spawn_count: usize,
    pub metabolism_base: f64,
    pub max_population: usize,
    pub food_regen_rate: f64,
    pub energy_capacity: f64,
    pub agent_max_age: f64,
    pub time_scale: f64,
    pub day_length: u32,
    pub season_length: u32,
}

impl Default for WorldParams {
    fn default() -> Self {
        Self {
            c_real: -0.8,
            c_imag: 0.156,
            max_iter: 256,
            escape_radius: 65536.0,
            center_x: -0.6,
            center_y: 0.0,
            world_scale: 4.0,
            spawn_count: 300,
            metabolism_base: 1.0,
            max_population: 4000,
            food_regen_rate: 0.0003,
            energy_capacity: 100.0,
            agent_max_age: 4000.0,
            time_scale: 1.0,
            day_length: 2400,
            season_length: 20000,
        }
    }
}

#[derive(Clone, Debug, Default)]
pub struct WorldConfig {
    pub id: String,
    pub seed: String,
    pub fractal_type: FractalType,
    pub params: WorldParams,
    pub created_at: f64,
    pub current_tick: u32,
    pub universe: Option<crate::universe::UniverseConfig>,
    pub cell_bio: Option<bool>,
    pub biophysics: Option<bool>,
    pub omics: Option<bool>,
    /// Phase C stochastic gene expression + folding entropy (per-block OU
    /// noise seeded per (world, tick, agent)) — deterministic per seed.
    pub omics_stochastic: Option<bool>,
    /// Phase C combinatorial systems: oligomer library chemistry (screened by
    /// the folded proteome) alongside the fluxome.
    pub combinatorial: Option<bool>,
    /// Phase C recombination operators: multi-point crossover, block shuffle
    /// and per-block combinatorial assembly during sexual reproduction.
    pub recombination: Option<bool>,
    /// Phase D pattern recognition: the curiosity/discovery subsystem — agents
    /// quantise their local context into a signature, detect novelty against a
    /// bounded prototype codebook, form recognition memories and gain an
    /// exploration drive (WorldConfig.discovery).
    pub discovery: Option<bool>,
    /// Phase D stochastic dynamics: behaviour-level randomness on top of the
    /// omics and world stochasticity — per-agent behavioural OU steering noise
    /// and error-prone replication (mutation bursts) on division. Seeded per
    /// (world, tick, agent) so runs stay reproducible (WorldConfig.stochasticDynamics).
    pub stochastic_dynamics: Option<bool>,
    /// Phase D protein-folding mechanics sub-flag (requires omics): chaperone
    /// capacity, aggregate-seeded cascade, fold fidelity and proteotoxicity —
    /// the deeper folding model rides on top of the Phase C folding observables.
    pub folding: Option<bool>,
    /// Phase M environment preset: seeds the chemical terrain bases
    /// (o2 / ph / toxin / minerals) at world build and biases the per-agent
    /// omics environment (water factor, default heat). Selecting any preset
    /// (including `Calm`) also activates the biome regime, which re-injects the
    /// profile's chemical basis each tick so extreme / underrated worlds keep
    /// their identity. Absent = purely legacy dynamics (bit-identical).
    pub environment: Option<EnvironmentPreset>,
    /// Phase M world topology: the edge-identification rule applied when agents
    /// move. Longitude (x) wraps in every topology; latitude (y) either wraps
    /// (torus), reflects at polar caps (cylinder / sphere), or loops/flips with
    /// a half-twist (Möbius strip / Klein bottle). Absent = torus (legacy
    /// bit-identical dynamics).
    pub topology: Option<WorldTopology>,
    /// Phase D communication-channel gain: multiplies the per-tick signal energy
    /// an agent deposits into a grid cell when signalling. Absent = 1 (legacy
    /// bit-identical); 0 closes the channel (L7 information-transfer ablation).
    pub signal_deposit: Option<f32>,
    /// Phase D cultural-transmission rate: multiplies the per-tick probability
    /// an agent copies a higher-energy neighbour's meme. Absent = 1 (legacy
    /// bit-identical); 0 freezes memes (L8 culture ablation).
    pub meme_copy_rate: Option<f32>,
    /// Reproduction master switch: when `Some(false)` no agent may divide, so
    /// offspring never appear (used to ablate the self-replication faculty).
    /// Absent or `Some(true)` = legacy behaviour (reproduction allowed).
    pub reproduction: Option<bool>,
    /// Sensorimotor master switch: when `Some(false)` agents hold position and
    /// expose no state->action feedback (adaptive-agent ablation). Absent or
    /// `Some(true)` = legacy behaviour.
    pub sensing: Option<bool>,
}

/// Phase M biome presets — selectable worlds from the benign to the extreme
/// (hydrothermal vents, anoxic trenches, crater lakes, permafrost, irradiated
/// waste) and the underrated (cave, gut lumen, termite mound, rhizosphere,
/// marsh, desert, hot spring, canopy). Each preset remaps the four chemical
/// terrain bases seeded at world build plus a water factor and a default heat
/// for the per-agent omics environment.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
#[repr(u8)]
pub enum EnvironmentPreset {
    Calm = 0,
    AnoxicTrench = 1,
    Hyperthermal = 2,
    Hypersaline = 3,
    AcidicCrater = 4,
    SodaLake = 5,
    CryoFrozen = 6,
    Irradiated = 7,
    ToxicSump = 8,
    LimestoneCave = 9,
    GutLumen = 10,
    TermiteMound = 11,
    Rhizosphere = 12,
    WetlandMarsh = 13,
    DesertDune = 14,
    HotSpring = 15,
    CanopyTop = 16,
}

impl Default for EnvironmentPreset {
    fn default() -> Self {
        EnvironmentPreset::Calm
    }
}

impl EnvironmentPreset {
    /// Parse a camelCase preset name picked up from configuration (JSON / WASM).
    pub fn from_name(name: &str) -> Option<EnvironmentPreset> {
        Some(match name {
            "calm" => EnvironmentPreset::Calm,
            "anoxicTrench" => EnvironmentPreset::AnoxicTrench,
            "hyperthermal" => EnvironmentPreset::Hyperthermal,
            "hypersaline" => EnvironmentPreset::Hypersaline,
            "acidicCrater" => EnvironmentPreset::AcidicCrater,
            "sodaLake" => EnvironmentPreset::SodaLake,
            "cryoFrozen" => EnvironmentPreset::CryoFrozen,
            "irradiated" => EnvironmentPreset::Irradiated,
            "toxicSump" => EnvironmentPreset::ToxicSump,
            "limestoneCave" => EnvironmentPreset::LimestoneCave,
            "gutLumen" => EnvironmentPreset::GutLumen,
            "termiteMound" => EnvironmentPreset::TermiteMound,
            "rhizosphere" => EnvironmentPreset::Rhizosphere,
            "wetlandMarsh" => EnvironmentPreset::WetlandMarsh,
            "desertDune" => EnvironmentPreset::DesertDune,
            "hotSpring" => EnvironmentPreset::HotSpring,
            "canopyTop" => EnvironmentPreset::CanopyTop,
            _ => return None,
        })
    }

    /// The environment profile applied by the engine: chemical terrain bases
    /// (o2 / ph / toxin / minerals), a moisture (water) factor and a default
    /// heat for the per-agent omics environment when the world has no weather.
    pub fn profile(self) -> EnvProfile {
        match self {
            EnvironmentPreset::Calm => EnvProfile {
                desc: "Temperate wetland pool (control)",
                o2: 0.30,
                ph: 7.0,
                toxin: 0.00,
                minerals: 0.15,
                water_factor: 1.00,
                heat: 0.50,
            },
            EnvironmentPreset::AnoxicTrench => EnvProfile {
                desc: "Deep-sea trench — anoxic, pressurised, sulfidic",
                o2: 0.02,
                ph: 7.4,
                toxin: 0.25,
                minerals: 0.50,
                water_factor: 1.00,
                heat: 0.10,
            },
            EnvironmentPreset::Hyperthermal => EnvProfile {
                desc: "Hydrothermal vent — hot, acidic",
                o2: 0.15,
                ph: 4.5,
                toxin: 0.50,
                minerals: 0.90,
                water_factor: 1.00,
                heat: 1.00,
            },
            EnvironmentPreset::Hypersaline => EnvProfile {
                desc: "Hypersaline brine lagoon",
                o2: 0.40,
                ph: 8.2,
                toxin: 0.10,
                minerals: 0.60,
                water_factor: 0.55,
                heat: 0.70,
            },
            EnvironmentPreset::AcidicCrater => EnvProfile {
                desc: "Volcanic crater lake — pH 3",
                o2: 0.50,
                ph: 3.0,
                toxin: 0.35,
                minerals: 0.70,
                water_factor: 0.90,
                heat: 0.60,
            },
            EnvironmentPreset::SodaLake => EnvProfile {
                desc: "Soda lake — alkaline pH 10.5",
                o2: 0.45,
                ph: 10.5,
                toxin: 0.10,
                minerals: 0.55,
                water_factor: 0.70,
                heat: 0.70,
            },
            EnvironmentPreset::CryoFrozen => EnvProfile {
                desc: "Permafrost — permanently frozen",
                o2: 0.60,
                ph: 7.0,
                toxin: 0.05,
                minerals: 0.20,
                water_factor: 0.12,
                heat: 0.00,
            },
            EnvironmentPreset::Irradiated => EnvProfile {
                desc: "Radiotropic waste ground",
                o2: 0.50,
                ph: 6.0,
                toxin: 0.80,
                minerals: 0.40,
                water_factor: 0.50,
                heat: 0.60,
            },
            EnvironmentPreset::ToxicSump => EnvProfile {
                desc: "Anoxic toxic smog sump",
                o2: 0.08,
                ph: 4.0,
                toxin: 0.70,
                minerals: 0.30,
                water_factor: 0.40,
                heat: 0.45,
            },
            EnvironmentPreset::LimestoneCave => EnvProfile {
                desc: "Limestone cave",
                o2: 0.18,
                ph: 7.6,
                toxin: 0.05,
                minerals: 0.80,
                water_factor: 0.85,
                heat: 0.30,
            },
            EnvironmentPreset::GutLumen => EnvProfile {
                desc: "Vertebrate gut lumen",
                o2: 0.05,
                ph: 6.0,
                toxin: 0.15,
                minerals: 0.20,
                water_factor: 0.90,
                heat: 0.85,
            },
            EnvironmentPreset::TermiteMound => EnvProfile {
                desc: "Termite mound core",
                o2: 0.12,
                ph: 6.5,
                toxin: 0.10,
                minerals: 0.60,
                water_factor: 0.70,
                heat: 0.90,
            },
            EnvironmentPreset::Rhizosphere => EnvProfile {
                desc: "Soil rhizosphere",
                o2: 0.20,
                ph: 6.2,
                toxin: 0.05,
                minerals: 0.70,
                water_factor: 0.75,
                heat: 0.45,
            },
            EnvironmentPreset::WetlandMarsh => EnvProfile {
                desc: "Anoxic wetland marsh",
                o2: 0.12,
                ph: 5.2,
                toxin: 0.20,
                minerals: 0.30,
                water_factor: 1.00,
                heat: 0.50,
            },
            EnvironmentPreset::DesertDune => EnvProfile {
                desc: "Desert dune — desiccated",
                o2: 0.70,
                ph: 8.0,
                toxin: 0.05,
                minerals: 0.35,
                water_factor: 0.10,
                heat: 0.60,
            },
            EnvironmentPreset::HotSpring => EnvProfile {
                desc: "Algal hot spring",
                o2: 0.60,
                ph: 8.5,
                toxin: 0.10,
                minerals: 0.45,
                water_factor: 0.95,
                heat: 0.90,
            },
            EnvironmentPreset::CanopyTop => EnvProfile {
                desc: "Forest canopy",
                o2: 0.85,
                ph: 7.0,
                toxin: 0.02,
                minerals: 0.15,
                water_factor: 0.85,
                heat: 0.55,
            },
        }
    }
}

/// Phase M topological spaces — the boundary condition that selects how the
/// edges of the world plane are identified when agents move. Ten different
/// geometries to experiment with, ordered from the wrapped legacy world to the
/// twisted (non-orientable) surfaces:
///
/// * `torus` — both axes wrap (the legacy default, bit-identical).
/// * `cylinder` — longitude wraps, latitude reflects at both edges, a band with
///   polar caps the agents cannot push through.
/// * `sphere` — longitude wraps, latitude reflects at both poles (sphere-like
///   caps); narrower than a cylinder in that latitude never loops.
/// * `mobius` — non-orientable strip: longitude wraps, latitude reflects and a
///   half-twist flips longitude at each crossing.
/// * `klein` — non-orientable bottle: longitude wraps, latitude loops with a
///   longitude flip, so one pass around the "neck" reverses handedness.
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
#[repr(u8)]
pub enum WorldTopology {
    Torus = 0,
    Cylinder = 1,
    Sphere = 2,
    Mobius = 3,
    Klein = 4,
}

impl Default for WorldTopology {
    fn default() -> Self {
        WorldTopology::Torus
    }
}

impl WorldTopology {
    /// Parse a camelCase topology name picked up from configuration (JSON /
    /// WASM / research harness). Accepts both the short and long names.
    pub fn from_name(name: &str) -> Option<WorldTopology> {
        Some(match name {
            "torus" => WorldTopology::Torus,
            "cylinder" => WorldTopology::Cylinder,
            "sphere" => WorldTopology::Sphere,
            "mobius" => WorldTopology::Mobius,
            "mobiusStrip" => WorldTopology::Mobius,
            "klein" => WorldTopology::Klein,
            "kleinBottle" => WorldTopology::Klein,
            _ => return None,
        })
    }

    /// Longitude (x) wraps in every topology of the plane.
    pub fn wraps_x(self) -> bool {
        true
    }

    /// Latitude (y) wraps only on the torus (plain) and the Klein bottle (with
    /// a flip); on the cylinder, sphere and Möbius strip it reflects instead.
    pub fn wraps_y(self) -> bool {
        matches!(self, WorldTopology::Torus | WorldTopology::Klein)
    }

    /// Human-readable one-line description for research reports.
    pub fn desc(self) -> &'static str {
        match self {
            WorldTopology::Torus => "planet-style: both axes wrap (legacy)",
            WorldTopology::Cylinder => "band: longitude wraps, polar caps reflect",
            WorldTopology::Sphere => "globe: longitude wraps, poles reflect",
            WorldTopology::Mobius => {
                "non-orientable: longitude wraps, caps reflect with a half-twist"
            }
            WorldTopology::Klein => "non-orientable: longitude wraps, latitude loops flipped",
        }
    }
}

/// The concrete effect of an environment preset on the chemical terrain and
/// the per-agent omics environment.
#[derive(Clone, Copy, Debug)]
pub struct EnvProfile {
    pub desc: &'static str,
    /// seeded O2 base of the chem terrain (0..1)
    pub o2: f64,
    /// seeded pH base of the chem terrain (3..11)
    pub ph: f64,
    /// seeded toxin base of the chem terrain (0..1)
    pub toxin: f64,
    /// seeded minerals base of the chem terrain (0..1)
    pub minerals: f64,
    /// moisture multiplier applied to the per-agent omics water signal
    pub water_factor: f64,
    /// default heat for the per-agent omics environment (weather overrides)
    pub heat: f64,
}

#[derive(Clone, Debug, Default)]
pub struct AgentState {
    pub id: u32,
    pub x: f64,
    pub y: f64,
    pub energy: f32,
    pub state: u8,
    pub species: u32,
    pub meme: f32,
}

#[derive(Clone, Debug, Default)]
pub struct SimStats {
    pub tick: u32,
    pub population: u32,
    pub alive_count: u32,
    pub dead_count: u32,
    pub species_count: u32,
    pub avg_energy: f32,
    pub avg_water: f32,
    pub tick_rate: f32,
    pub state_hash: u32,
    pub time_scale: f32,
    pub energy_sum: f32,
    pub births: u32,
    pub deaths: u32,
    pub escape_deaths: u32,
    pub entropy: f32,
    pub diversity: f32,
    pub complexity: f32,
    pub cooperation: f32,
    pub predator_fraction: f32,
    pub culture_count: u32,
    pub mean_altruism: f32,
    pub meme_entropy: f32,
    pub species_meme_mi: f32,
    pub mean_aggression: f32,
    pub mean_cooperation: f32,
    pub mean_risk: f32,
    pub mean_deception: f32,
    pub predator_gene_fraction: f32,
    pub prey_gene_fraction: f32,
    pub energy_inequality: f32,
    pub donation_ratio: f32,
    pub lyapunov_exponent: f32,
    pub selection_entropy: f32,
    pub fixation_index: f32,
    pub price_equation_selection: f32,
    pub food_grad_mag_mean: f32,
    pub food_lap_mean: f32,
    pub velocity_div_mean: f32,
    pub velocity_curl_mag_mean: f32,
    pub ca_alive_fraction: f32,
    pub ca_complexity: f32,
    pub trait_total_variance: f32,
    pub trait_effective_dim: f32,
    pub trait_anisotropy: f32,
    pub mean_atp: f32,
    pub mean_enzyme: f32,
    pub mean_toxin: f32,
    pub mean_ph: f32,
    pub chemical_diversity: f32,
    pub mean_glucose: f32,
    pub mean_protein: f32,
    pub active_synthesis_fraction: f32,
    pub terrain_oxygen: f32,
    pub terrain_ph: f32,
    pub terrain_toxin: f32,
    pub mean_dna_integrity: f32,
    pub mean_pathogen_load: f32,
    pub mean_membrane_pot: f32,
    pub mean_body_temp: f32,
    pub mean_trophic_level: f32,
    pub speciation_rate: f32,
    pub extinction_rate: f32,
    pub biodiversity_index: f32,
    pub mean_fitness: f32,
    pub mean_division_progress: f32,
    pub mean_plasticity: f32,
    pub mean_surprise: f32,
    pub plastic_agents: f32,
    // --- biophysics observables (opt-in via WorldConfig.biophysics) ---
    pub mean_force: f32,
    pub cluster_count: f32,
    pub cluster_order: f32,
    pub rotational_order: f32,
    pub spatial_entropy: f32,
    pub dimensional_entropy: f32,
    pub org_index: f32,
    pub mass_conservation: f32,
    pub symmetry_drift: f32,
    pub cascade_rate: f32,
    pub bond_energy: f32,
    pub reaction_enthalpy: f32,
    pub entropy_production: f32,
    pub carnot_efficiency: f32,
    pub heat_waste: f32,
    pub engine_power: f32,
    pub radiation_field: f32,
    pub thermal_balance: f32,
    // --- omics observables (opt-in via WorldConfig.omics) ---
    pub expression_entropy: f32,
    pub transcript_activity: f32,
    pub protein_diversity: f32,
    pub proteome_load: f32,
    pub pathway_flux: f32,
    pub flux_diversity: f32,
    pub regulation_gating: f32,
    pub ec_coupling: f32,
    // --- Phase C omics observables (folding / TF / env / library) ---
    pub native_fraction: f32,
    pub misfold_load: f32,
    pub fold_stability: f32,
    pub tf_regulation: f32,
    pub env_recognition: f32,
    pub expression_noise: f32,
    pub library_diversity: f32,
    // --- Phase D discovery observables (opt-in via WorldConfig.discovery) ---
    pub discovery_rate: f32,
    pub novelty_mean: f32,
    pub memory_diversity: f32,
    pub exploration_fraction: f32,
    // --- Phase D stochastic-dynamics observables (opt-in via WorldConfig.stochasticDynamics) ---
    pub behavior_noise: f32,
    pub mutation_burst_rate: f32,
    // --- Phase D protein-folding observables (deeper model via WorldConfig.folding) ---
    pub chaperone_load: f32,
    pub aggregate_load: f32,
    pub fold_fidelity: f32,
    pub proteotoxicity: f32,
    // --- Phase D combinatorial observables (combinatorial selection) ---
    pub library_coverage: f32,
    pub binding_specificity: f32,
    pub combinatorial_entropy: f32,
}

#[derive(Clone, Debug)]
pub enum InterventionType {
    Meteor,
    SeedFood,
    SpawnAgent,
    PauseRegion,
    SetTimeScale,
    Nuke,
    SetGene,
}

impl InterventionType {
    /// Wire name of the intervention (camelCase, matches the TS InterventionType
    /// and the names used when parsing JS-side config/intervention JSON).
    pub fn as_name(&self) -> &'static str {
        match self {
            InterventionType::Meteor => "meteor",
            InterventionType::SeedFood => "seedFood",
            InterventionType::SpawnAgent => "spawnAgent",
            InterventionType::PauseRegion => "pauseRegion",
            InterventionType::SetTimeScale => "setTimeScale",
            InterventionType::Nuke => "nuke",
            InterventionType::SetGene => "setGene",
        }
    }
}

#[derive(Clone, Debug)]
pub struct Intervention {
    pub itype: InterventionType,
    pub x: Option<f64>,
    pub y: Option<f64>,
    pub radius: Option<f32>,
    pub amount: Option<f32>,
    pub ticks: Option<u32>,
    pub genome: Option<Vec<f32>>,
    pub time_scale: Option<f64>,
    pub agent_id: Option<u32>,
    pub index: Option<u32>,
    pub value: Option<f32>,
    pub sequence: u32,
}

#[derive(Clone, Debug, Default)]
pub struct LineageNode {
    pub id: u32,
    pub parent_id: i32,
    pub born_at_tick: u32,
    pub died_at_tick: u32,
    pub species: u32,
    pub final_fitness: f32,
    pub alive: bool,
}

#[derive(Clone, Debug)]
pub struct WorldStatus {
    pub id: String,
    pub seed: String,
    pub fractal_type: FractalType,
    pub params: WorldParams,
    pub current_tick: u32,
    pub population: u32,
    pub alive_count: u32,
    pub species_count: u32,
    pub created_at: f64,
    pub interventions: usize,
    pub paused: bool,
}

/// How an agent died, as recorded on `death` events (mirrors the TS DeathCause
/// union). Serialises to the lowercase wire name.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum DeathCause {
    Starvation,
    Thirst,
    Age,
    Predation,
    Intervention,
    Escape,
}
