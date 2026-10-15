use crate::agent::*;
use crate::biophysics;
use crate::brain::{self, BrainConfig, BrainState};
use crate::cellbio;
use crate::cells;
use crate::chemistry::{self, ChemStoich, ChemTerrain};
use crate::discovery;
use crate::dna;
use crate::ecosystem::{self, EcosystemGrid};
use crate::genome;
use crate::omics;
use crate::rng::{
    disc_seed, dyn_seed, env_seed, init_seed, meme_seed, omics_seed, stream_seed, SplitMix64,
};
use crate::selection::{self, assign_species, FitnessComponents, SelectionState};
use crate::spatial_hash::SpatialHash;
use crate::terrain::{self, GridSample, TerrainGrid};
use crate::world_stoch::{self, WorldStochState, WorldStochasticConfig};
use fractal_life_shared::constants::*;
use fractal_life_shared::hash::fnv1a32;
use fractal_life_shared::protocol::*;
use fractal_life_shared::types::*;
use fractal_life_shared::universe::{derive_world_physics, WorldPhysics};
use serde::Serialize;
use std::collections::{HashMap, HashSet};

// Engine-local constants (matching TS engine.ts). All are f64 so arithmetic
// with agent scalars mirrors the TS reference's JS `number` (double) semantics.
const EATING_RATE: f64 = 0.008;
const MEAT_EATING_RATE: f64 = 0.012;
const REPRO_ENERGY_THRESHOLD: f64 = 0.62;
const REPRO_AGE_MIN: f64 = 10.0;
const CHILD_ENERGY_FRACTION: f64 = 0.22;
const CHILD_WATER_FRACTION: f64 = 0.25;
const WATER_EVAP_RATE: f64 = 0.004;
const WATER_ABSORB_RATE: f64 = 0.02;
const BITE_FRACTION: f64 = 0.02;
const SIGNAL_DEPOSIT: f64 = 0.08;
const SIGNAL_DECAY: f64 = 0.95;
const SIGNAL_DIFFUSE: f64 = 0.12;
const SIGNAL_COST: f64 = 0.015;
const ALTRUISM_THRESHOLD: f64 = 0.75;
const DONATION_RATE: f64 = 0.02;
const MEME_COPY_RATE: f64 = 0.02;
const MEME_TOLERANCE: f64 = 0.05;
const MEME_INNOVATION: f64 = 0.01;
const MEAT_DECAY: f64 = 0.002;
const DECOMP_FRACTION: f64 = 0.5;
const PLANT_NUTRIENT_USE: f64 = 0.3;
const MINERAL_WEATHERING: f64 = 0.0008;
const LGT_RATE: f64 = 0.03;
const LGT_BLOCK: usize = 8;
const NEIGHBOR_MAX: usize = 24;
const DEAD_RETENTION: usize = 25000;
#[allow(dead_code)]
const SPECIES_GENES: usize = 32;
const ESCAPE_B2: f64 = 4.0;
const ORBIT_DEPTH_CAP: u32 = 1024;
const DRIVE_SCALE: f64 = 0.6;
const SEPARATION_RADIUS: f64 = 8.0;
const FLUX_MIN: f64 = 0.5;
const FLUX_MAX: f64 = 1.0;
const CRE_MIN: f64 = -2.0;
const CRE_RANGE: f64 = 3.0;
const CIM_MIN: f64 = -1.25;
const CIM_RANGE: f64 = 2.5;
const TWO_PI: f64 = std::f64::consts::PI * 2.0;
const BURST_REGEN_BOOST: f64 = 0.05;

fn clamp(v: f64, lo: f64, hi: f64) -> f64 {
    v.max(lo).min(hi)
}
fn wrap(v: f64) -> f64 {
    let world = WORLD_SIZE_USIZE as f64;
    if v < 0.0 {
        v + world
    } else if v >= world {
        v - world
    } else {
        v
    }
}

/// Rich population observables returned by `population_metrics()`. Mirrors the
/// TS engine's `populationObservables()` so WASM/server stats match the
/// reference engine bit-for-bit on the shared fields.
struct Metrics4 {
    entropy: f32,
    diversity: f32,
    complexity: f32,
    predator_fraction: f32,
    culture_count: u32,
    mean_altruism: f32,
    meme_entropy: f32,
    species_meme_mi: f32,
    mean_aggression: f32,
    mean_cooperation: f32,
    mean_risk: f32,
    mean_deception: f32,
    predator_gene_fraction: f32,
    prey_gene_fraction: f32,
    energy_inequality: f32,
    donation_ratio: f32,
}

impl Metrics4 {
    fn zero() -> Self {
        Metrics4 {
            entropy: 0.0,
            diversity: 0.0,
            complexity: 0.0,
            predator_fraction: 0.0,
            culture_count: 0,
            mean_altruism: 0.0,
            meme_entropy: 0.0,
            species_meme_mi: 0.0,
            mean_aggression: 0.0,
            mean_cooperation: 0.0,
            mean_risk: 0.0,
            mean_deception: 0.0,
            predator_gene_fraction: 0.0,
            prey_gene_fraction: 0.0,
            energy_inequality: 0.0,
            donation_ratio: 0.0,
        }
    }
}

fn grid_idx(grid: &TerrainGrid, wx: f64, wy: f64) -> usize {
    let size = grid.size;
    let ix = ((wx / grid.cell as f64).floor() as usize).min(size - 1);
    let iy = ((wy / grid.cell as f64).floor() as usize).min(size - 1);
    iy * size + ix
}

fn withdraw_into(arr: &mut [f32], size: usize, cell: f32, wx: f64, wy: f64, amount: f64) {
    let gx = wx / cell as f64;
    let gy = wy / cell as f64;
    let ix = (gx.floor() as usize).min(size - 1);
    let iy = (gy.floor() as usize).min(size - 1);
    let fx = (gx - ix as f64).max(0.0).min(1.0);
    let fy = (gy - iy as f64).max(0.0).min(1.0);
    let x1 = (ix + 1).min(size - 1);
    let y1 = (iy + 1).min(size - 1);
    let w00 = (1.0 - fx) * (1.0 - fy);
    let w10 = fx * (1.0 - fy);
    let w01 = (1.0 - fx) * fy;
    let w11 = fx * fy;
    arr[iy * size + ix] = (arr[iy * size + ix] as f64 - amount * w00).max(0.0) as f32;
    arr[iy * size + x1] = (arr[iy * size + x1] as f64 - amount * w10).max(0.0) as f32;
    arr[y1 * size + ix] = (arr[y1 * size + ix] as f64 - amount * w01).max(0.0) as f32;
    arr[y1 * size + x1] = (arr[y1 * size + x1] as f64 - amount * w11).max(0.0) as f32;
}

pub struct TickResult {
    pub tick: u32,
    pub delta: Vec<u8>,
    pub delta_count: u32,
    pub stats: SimStats,
    pub events: Vec<SimEvent>,
}

#[derive(Clone, Debug, Serialize)]
pub struct SimEvent {
    pub world_id: String,
    pub tick: u32,
    #[serde(rename = "type")]
    pub etype: String,
    pub significance: f32,
    pub data: EventData,
}

/// Per-event payload. Mirrors the TS `SimEvent` union's per-type `data`
/// shapes field-for-field (serialised camelCase; `None` fields are omitted so
/// the wire object matches an absent optional key on the TS side).
#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EventData {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub agent_id: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent_id: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mate_id: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub killer_id: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub predator_id: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub prey_id: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cause: Option<DeathCause>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub species: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub x: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub y: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub energy: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub age: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub novelty: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bite: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub itype: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub from: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub to: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub deaths: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub distance: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub top1: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub top2: Option<f64>,
}

/// Severity hint in [0,1] attached to `death` events (rarity/impact weighting
/// for display and analysis; mirrors the TS DEATH_SIG table).
const fn death_significance(cause: DeathCause) -> f32 {
    match cause {
        DeathCause::Starvation | DeathCause::Thirst => 0.3,
        DeathCause::Age => 0.1,
        DeathCause::Predation => 0.5,
        DeathCause::Escape => 0.6,
        DeathCause::Intervention => 1.0,
    }
}

pub struct Engine {
    pub config: WorldConfig,
    pub params: WorldParams,
    pub agents: HashMap<u32, SimAgent>,
    pub grid: TerrainGrid,
    pub world_physics: WorldPhysics,
    pub intervention_log: Vec<(u32, Intervention)>,
    next_id: u32,
    tick_num: u32,
    spatial: SpatialHash,
    dead_agents: Vec<u32>,
    tick_deaths: u32,
    prev_alive: u32,
    prev_species: u32,
    prev_centroid_x: f64,
    prev_centroid_y: f64,
    alive_ids: Vec<u32>,
    born_queue: Vec<SimAgent>,
    events: Vec<SimEvent>,
    /// emission filter (None = all event types); set via `set_event_policy`
    event_policy: Option<Vec<String>>,
    last_births: u32,
    last_deaths: u32,
    last_donation: f64,
    last_escape_deaths: u32,
    sensors: Vec<f32>,
    hidden: [f32; MLP_HIDDEN],
    out: [f32; MLP_OUTPUTS],
    neighbors: Vec<i32>,
    signal_next: Vec<f32>,
    #[allow(dead_code)]
    set_map_depth: Vec<u8>,
    set_map_escape: Vec<u8>,
    sample: GridSample,
    pub lyapunov_exponent: f32,
    pub selection_state: SelectionState,
    pub ecosystem_grid: EcosystemGrid,
    /// legacy physics constants are used (existing behaviour unchanged).
    pub chem_terrain: ChemTerrain,
    /// Phase M biome bias: the environment preset's chemical terrain seeding
    /// plus the water factor / default heat applied to per-agent omics envs.
    pub env_profile: EnvProfile,
    /// Phase M topological space: the boundary condition applied to agent
    /// movement (edge identification of the world plane). Falls back to the
    /// legacy torus when the config does not pick a topology.
    pub topology: WorldTopology,
    /// real-world grounding (chemistry stoich + ecology priors), when set
    ground_stoich: Option<ChemStoich>,
    ground_eco_fra: [f32; 5],
    ground_level_pop: [u32; 5],
    ground_crowd: [f32; 5],
    /// plastic recurrent brain configuration (learning on/off, overrides)
    brain_cfg: BrainConfig,
    /// running mean of |TD error| for the plastic brains (stats telemetry)
    brain_surprise_sum: f64,
    brain_surprise_n: u32,
    /// stochastic world processes (weather / OU field / Poisson bursts), opt-in
    world_stoch_cfg: Option<WorldStochasticConfig>,
    world_stoch_state: Option<WorldStochState>,
    /// when false, `tick` skips building the per-agent MT_DELTA frame. The
    /// simulation itself is untouched — only the render payload is suppressed,
    /// so a headless run can go far faster than a watched one.
    record_delta: bool,
    /// current annealing sigma for a gaussian policy head (recomputed per tick)
    policy_sigma_val: f64,
    /// POMDP observation noise (per hidden channel), engine scratch
    pomdp_noise: [f32; MLP_INPUTS],
    /// sampled actions for the stochastic policy head, engine scratch
    act: [f32; MLP_OUTPUTS],
    act_eps: [f32; MLP_OUTPUTS],
    /// backprop SGD regularizer scratch, engine-level
    drop_mask: [f32; MLP_HIDDEN],
    grad_noise_vec: Vec<f32>,
    /// last-agent parity trace (single-agent debugging; overwritten per tick)
    pub trace: DebugTrace,
    /// biophysics mass proxy from the previous tick (conservation telemetry)
    prev_mass_proxy: f64,
    bio_forces: HashMap<u32, (f64, f64)>,
}

/// Per-tick intermediate values captured for parity bisection. Only the last
/// processed agent's trace survives; single-agent probes are exact.
#[derive(Clone, Default)]
pub struct DebugTrace {
    pub tick: u32,
    pub agent_id: u32,
    pub sensors: [f32; MLP_INPUTS],
    pub out: [f32; MLP_OUTPUTS],
    pub drive_x: f64,
    pub drive_y: f64,
    pub d_alg_y: f64,
    pub d_co_y: f64,
    pub d_sep_y: f64,
    pub d_osc_y: f64,
    pub d_noise_y: f64,
    pub ph: f64,
    pub osc: f64,
    pub noise: f64,
    pub sin_ph: f64,
    pub cos_ph: f64,
    pub thrust_x: f64,
    pub thrust_y: f64,
    pub water_frac: f64,
    pub dh: f64,
    pub hazard: f64,
    pub chem_mod: f64,
    pub flux: f64,
    pub zmag2: f64,
    pub daylight: f64,
    pub season_phase: f64,
    pub season_moisture: f64,
    pub energy_before: f64,
    pub nb_count: u32,
    pub weather_id: u32,
    pub weather_moisture: f64,
    pub weather_growth: f64,
    pub policy_sigma: f64,
    pub act: [f32; MLP_OUTPUTS],
    pub eps: [f32; MLP_OUTPUTS],
    pub belief: [f32; brain::POMDP_BELIEF],
    pub obs_raw: [f32; MLP_INPUTS],
    pub obs_noise: [f32; MLP_INPUTS],
}

/// Real-world grounding data derived from the offline enrichment snapshot.
/// Set via `Engine::set_grounding` (or the WASM `set_reality_json`).
#[derive(Clone, Default)]
pub struct Grounding {
    pub chem_stoich: Option<ChemStoich>,
    /// expected relative community fraction per trophic level (0..=4)
    pub eco_fra: [f32; 5],
    pub enabled: bool,
}

const CROWDING_STRESS: f64 = 0.5;

impl Engine {
    pub fn new(config: WorldConfig) -> Self {
        let world_physics = derive_world_physics(config.universe.as_ref());
        let params = config.params.clone();
        let perlin_seed = fnv1a32(&config.seed);
        let grid = terrain::build_terrain_grid(&params, config.fractal_type, perlin_seed);
        let grid_size = grid.size;
        let cell_count = (WORLD_SIZE_USIZE as f32 / SPATIAL_CELL) as usize;
        let env_profile = config
            .environment
            .unwrap_or(EnvironmentPreset::Calm)
            .profile();
        let topology = config.topology.unwrap_or(WorldTopology::Torus);

        let mut engine = Engine {
            config,
            params,
            agents: HashMap::new(),
            grid,
            world_physics,
            intervention_log: Vec::new(),
            next_id: 0,
            tick_num: 0,
            spatial: SpatialHash::new(SPATIAL_CELL, cell_count),
            dead_agents: Vec::new(),
            tick_deaths: 0,
            prev_alive: 0,
            prev_species: 0,
            prev_centroid_x: 0.0,
            prev_centroid_y: 0.0,
            alive_ids: Vec::new(),
            born_queue: Vec::new(),
            events: Vec::new(),
            event_policy: None,
            last_births: 0,
            last_deaths: 0,
            last_donation: 0.0,
            last_escape_deaths: 0,
            sensors: vec![0.0; MLP_INPUTS],
            hidden: [0.0; MLP_HIDDEN],
            out: [0.0; MLP_OUTPUTS],
            neighbors: vec![-1; NEIGHBOR_MAX],
            signal_next: vec![0.0; grid_size * grid_size],
            set_map_depth: vec![0; grid_size * grid_size],
            set_map_escape: vec![0; grid_size * grid_size],
            sample: GridSample::default(),
            lyapunov_exponent: 0.0,
            selection_state: selection::create_selection_state(),
            ecosystem_grid: ecosystem::create_ecosystem_grid(),
            chem_terrain: chemistry::create_chem_terrain(grid_size, env_profile),
            env_profile,
            topology,
            ground_stoich: None,
            ground_eco_fra: [0.0; 5],
            ground_level_pop: [0; 5],
            ground_crowd: [0.0; 5],
            brain_cfg: BrainConfig::default(),
            brain_surprise_sum: 0.0,
            brain_surprise_n: 0,
            world_stoch_cfg: None,
            world_stoch_state: None,
            record_delta: true,
            policy_sigma_val: 0.0,
            pomdp_noise: [0.0; MLP_INPUTS],
            act: [0.0; MLP_OUTPUTS],
            act_eps: [0.0; MLP_OUTPUTS],
            drop_mask: [1.0; MLP_HIDDEN],
            grad_noise_vec: vec![0.0; MLP_WEIGHTS + MLP_HIDDEN + 1],
            trace: DebugTrace::default(),
            prev_mass_proxy: 0.0,
            bio_forces: HashMap::new(),
        };
        engine.spawn_founders();
        engine
    }

    /// Inject real-world grounding (chemistry stoichiometry + ecology priors)
    /// before simulation ticks begin. Must be set before any tick for
    /// trajectory-deterministic behavior.
    pub fn set_grounding(&mut self, grounding: Grounding) {
        self.ground_stoich = grounding.chem_stoich;
        self.ground_eco_fra = grounding.eco_fra;
    }

    pub fn grounding_stoich(&self) -> Option<&ChemStoich> {
        self.ground_stoich.as_ref()
    }

    /// Configure the plastic recurrent brains. Must be set before the first
    /// tick for a deterministic trajectory.
    pub fn set_brain_config(&mut self, cfg: BrainConfig) {
        self.brain_cfg = cfg;
    }

    pub fn brain_config(&self) -> &BrainConfig {
        &self.brain_cfg
    }

    /// Enable/configure the stochastic world processes (OU resource field,
    /// Poisson point-process regen bursts, Markov-chain weather). Disabled by
    /// default so determinism/parity traces are untouched; `None` disables.
    /// Must be set before the first tick.
    pub fn set_world_stochastics(&mut self, cfg: Option<WorldStochasticConfig>) {
        match cfg {
            Some(c) if c.enabled => {
                let size = self.grid.size;
                let state = world_stoch::create_world_stoch_state(size);
                self.world_stoch_cfg = Some(c);
                self.world_stoch_state = Some(state);
            }
            _ => {
                self.world_stoch_cfg = None;
                self.world_stoch_state = None;
            }
        }
    }

    pub fn world_stoch_config(&self) -> Option<&WorldStochasticConfig> {
        self.world_stoch_cfg.as_ref()
    }

    /// Control whether `tick` builds the MT_DELTA render frame. Defaults to
    /// `true` (identical behaviour and bytes to a build without this setter).
    /// Setting it to `false` yields the same simulation trajectory with an
    /// empty frame, so callers that don't need the visual stream can run far
    /// ahead of the renderer. May be toggled at any time.
    pub fn set_record_delta(&mut self, on: bool) {
        self.record_delta = on;
    }

    pub fn record_delta(&self) -> bool {
        self.record_delta
    }

    /// Aggregate brain telemetry: mean learned deviation from the genome
    /// template, mean reward-prediction surprise, and the fraction of alive
    /// agents whose synapses have actually moved.
    pub fn brain_stats(&self) -> (f32, f32, f32) {
        if !self.brain_cfg.enabled || self.alive_ids.is_empty() {
            return (0.0, 0.0, 0.0);
        }
        let mut mag_sum = 0.0f64;
        let mut drifted = 0u32;
        let mut n = 0u32;
        for &id in &self.alive_ids {
            if let Some(a) = self.agents.get(&id) {
                let mag = brain::learned_mag(&a.brain, &a.genome);
                mag_sum += mag;
                if mag > 0.001 {
                    drifted += 1;
                }
                n += 1;
            }
        }
        let mean_surprise = if self.brain_surprise_n > 0 {
            (self.brain_surprise_sum / self.brain_surprise_n as f64) as f32
        } else {
            0.0
        };
        let fraction = if n > 0 {
            drifted as f32 / n as f32
        } else {
            0.0
        };
        (
            if n > 0 {
                (mag_sum / n as f64) as f32
            } else {
                0.0
            },
            mean_surprise,
            fraction,
        )
    }

    fn level_cap(&self, level: usize) -> u32 {
        let total = self.ground_eco_fra.iter().fold(0.0, |a, b| a + b);
        if total <= 0.0 {
            return u32::MAX;
        }
        let t = self.params.max_population as f32 * self.ground_eco_fra[level];
        t.max(1.0) as u32
    }

    fn compute_ground_crowd(&self) -> [f32; 5] {
        let mut crowd = [0.0; 5];
        let pop_sum: u32 = self.ground_level_pop.iter().sum();
        let total = self.ground_eco_fra.iter().fold(0.0, |a, b| a + b);
        if pop_sum == 0 || total <= 0.0 {
            return crowd;
        }
        for level in 0..5 {
            let actual = self.ground_level_pop[level] as f32 / pop_sum as f32;
            let expected = self.ground_eco_fra[level];
            crowd[level] = if expected > 0.0 {
                (actual / expected - 1.0).max(0.0)
            } else {
                0.0
            };
        }
        crowd
    }

    fn rebuild_ground_level_pop(&mut self) -> [u32; 5] {
        let mut pop = [0u32; 5];
        for &id in &self.alive_ids {
            if let Some(a) = self.agents.get(&id) {
                let level = a.trophic_level as usize;
                if level < 5 {
                    pop[level] += 1;
                }
            }
        }
        pop
    }

    pub fn current_tick(&self) -> u32 {
        self.tick_num
    }
    pub fn alive_count(&self) -> u32 {
        self.alive_ids.len() as u32
    }

    pub fn compute_state_hash_value(&self) -> u32 {
        selection::compute_state_hash(&self.alive_ids, &self.agents, self.tick_num)
    }

    /// Full-precision per-agent state dump (all scalars as f64, ids/ints raw).
    /// Debug-only parity tool for WASM-vs-TS comparison; not part of the sim.
    pub fn debug_agents_json(&self) -> String {
        let mut ids: Vec<u32> = self.agents.keys().copied().collect();
        ids.sort_unstable();
        let mut json = String::from("[");
        for (i, id) in ids.iter().enumerate() {
            let a = &self.agents[id];
            if i > 0 {
                json.push(',');
            }
            json.push_str(&format!(
                "{{\"id\":{},\"alive\":{},\"died\":{},\"x\":{},\"y\":{},\"vx\":{},\"vy\":{},\"energy\":{},\"water\":{},\"meme\":{},\"cRe\":{},\"cIm\":{},\"zRe\":{},\"zIm\":{},\"orbit\":{},\"species\":{},\"age\":{},\"paused\":{}}}",
                a.id, a.alive, a.died_at_tick, a.x, a.y, a.vx, a.vy, a.energy, a.water, a.meme,
                a.c_re, a.c_im, a.z_re, a.z_im, a.orbit_depth, a.species, a.age, a.paused_ticks
            ));
        }
        json.push(']');
        json
    }

    pub fn agent_summaries_json(&self) -> String {
        let mut ids: Vec<u32> = self.agents.keys().copied().collect();
        ids.sort_unstable();
        let mut json = String::from("[");
        let mut first = true;
        for id in ids {
            let a = &self.agents[&id];
            if !first {
                json.push(',');
            }
            first = false;
            let genome_str = a
                .genome
                .as_slice()
                .iter()
                .map(|g| format!("{}", g))
                .collect::<Vec<String>>()
                .join(",");
            if self.brain_cfg.enabled {
                let gen = brain::learned_mag(&a.brain, &a.genome);
                json.push_str(&format!(
                    "{{\"id\":{},\"parentId\":{},\"bornAtTick\":{},\"diedAtTick\":{},\"alive\":{},\"species\":{},\"finalFitness\":{},\"x\":{},\"y\":{},\"energy\":{},\"age\":{},\"genome\":[{}],\"plasticity\":{}}}",
                    a.id, a.parent_id, a.born_at_tick, a.died_at_tick, a.alive, a.species, a.final_fitness, a.x, a.y, a.energy, a.age, genome_str, gen
                ));
            } else {
                json.push_str(&format!(
                    "{{\"id\":{},\"parentId\":{},\"bornAtTick\":{},\"diedAtTick\":{},\"alive\":{},\"species\":{},\"finalFitness\":{},\"x\":{},\"y\":{},\"energy\":{},\"age\":{},\"genome\":[{}]}}",
                    a.id, a.parent_id, a.born_at_tick, a.died_at_tick, a.alive, a.species, a.final_fitness, a.x, a.y, a.energy, a.age, genome_str
                ));
            }
        }
        json.push(']');
        json
    }

    fn spawn_founders(&mut self) {
        let mut rng = SplitMix64::new(init_seed(&self.config.seed) as u64);
        let count = self.params.spawn_count;
        let cap = self.params.energy_capacity;
        let culture_on = self.culture_channel_on();
        for _ in 0..count {
            let id = self.next_id;
            self.next_id += 1;
            let genome = genome::random_genome(&mut rng);
            let x = rng.next_float64() * WORLD_SIZE_USIZE as f64;
            let y = rng.next_float64() * WORLD_SIZE_USIZE as f64;
            let meme = if culture_on { rng.next_float64() } else { 0.0 };
            let agent = self.create_agent(
                id,
                -1,
                &genome,
                x,
                y,
                cap * 0.5,
                cap * 0.5,
                0,
                meme,
            );
            self.agents.insert(id, agent);
        }
        self.prev_alive = count as u32;
        self.prev_species = self.count_species();
    }

    /// Phase D: the non-genetic (cultural) channel is on unless explicitly
    /// muted (`meme_copy_rate = 0`), which zeroes founder tags and stops both
    /// vertical and horizontal meme transmission so the culture detector can be
    /// ablated on an otherwise identical world.
    fn culture_channel_on(&self) -> bool {
        self.config.meme_copy_rate.map_or(true, |r| r > 0.0)
    }

    /// Reproduction master switch: `false` forbids division entirely so no
    /// offspring appear (self-replication ablation). Absent/`true` = legacy.
    fn reproduction_on(&self) -> bool {
        self.config.reproduction.unwrap_or(true)
    }

    /// Sensorimotor master switch: `false` freezes the sense->steer loop so
    /// agents hold position (adaptive-agent ablation). Absent/`true` = legacy.
    fn sensing_on(&self) -> bool {
        self.config.sensing.unwrap_or(true)
    }

    fn create_agent(
        &mut self,
        id: u32,
        parent_id: i32,
        genome: &[f32],
        x: f64,
        y: f64,
        energy: f64,
        water: f64,
        born_at_tick: u32,
        meme: f64,
    ) -> SimAgent {
        self.create_agent_with_brain(
            id,
            parent_id,
            genome,
            x,
            y,
            energy,
            water,
            born_at_tick,
            meme,
            None,
        )
    }

    /// Same as create_agent but with optional Lamarckian heredity of the
    /// parent's learned synapses (used by reproduction).
    fn create_agent_with_brain(
        &mut self,
        id: u32,
        parent_id: i32,
        genome: &[f32],
        x: f64,
        y: f64,
        energy: f64,
        water: f64,
        born_at_tick: u32,
        meme: f64,
        parent_brain: Option<&BrainState>,
    ) -> SimAgent {
        let phenotype = genome::decode_phenotype(genome);
        let c = genome::fractal_genes(genome);
        let drives = genome::decode_drives(genome);
        let strategy = genome::decode_strategies(genome);
        let immune_genes = genome::decode_immune_genes(genome);
        let predprey_genes = genome::decode_predprey_genes(genome);
        let repro_genes = genome::decode_repro_genes(genome);
        let metab_genes = genome::decode_metab_genes(genome);
        let _dna_genes = genome::decode_dna_genes(genome);
        let cell_genes = genome::decode_cell_genes(genome);
        let ecosystem_genes = genome::decode_ecosystem_genes(genome);
        let _cap = self.params.energy_capacity;

        let tl = ecosystem::assign_trophic_level(phenotype.diet, strategy.aggression);

        let mem_genes = genome::decode_membrane_genes(genome);
        let chem_state = chemistry::create_agent_chemistry(genome, id.wrapping_mul(2654435761));
        let mut cell_state = cells::create_cell_state(&cell_genes);
        if self.config.cell_bio.unwrap_or(false) {
            cell_state.bio = Some(cellbio::create_cell_bio_state(&mem_genes, &chem_state));
        }

        SimAgent {
            id,
            parent_id,
            genome: genome.to_vec(),
            phenotype,
            x,
            y,
            vx: 0.0,
            vy: 0.0,
            energy,
            water,
            age: 0.0,
            alive: true,
            species: assign_species(genome),
            born_at_tick,
            died_at_tick: 0,
            final_fitness: 0.0,
            energy_acquired: 0.0,
            kills: 0,
            reproductions: 0,
            altruism: 0.0,
            meme,
            last_repro_tick: -1,
            last_hunted_tick: -1,
            last_hunted_by: -1,
            paused_ticks: 0,
            drives,
            strategy,
            c_re: c.c_re,
            c_im: c.c_im,
            z_re: 0.0,
            z_im: 0.0,
            orbit_depth: 1,
            total_donated: 0.0,
            total_received: 0.0,
            total_hunt_damage: 0.0,
            times_hunted: 0,
            chemistry: chem_state,
            dna: dna::create_dna_system(),
            cell: cell_state,
            immune: ImmuneState {
                pathogen_load: 0.0,
                innate: immune_genes.innate,
                adaptive: immune_genes.adaptive,
                immune_memory: 0.0,
                inflammation: 0.0,
                autoimmunity: 0.0,
                pathogens_fought: 0.0,
                symbiont_load: 0.0,
            },
            predprey: PredPreyState {
                stealth: predprey_genes.stealth,
                pursuit: predprey_genes.pursuit,
                ambush: predprey_genes.ambush,
                pack_bonus: 0.0,
                escape_energy: 0.0,
                warning_calls: 0,
                mimicry: predprey_genes.mimicry,
                aposematism: predprey_genes.aposematism,
                is_hiding: false,
                is_chasing: false,
                ticks_since_hunt: 0,
            },
            repro: ReproState {
                sexual: repro_genes.sexual,
                mate_selectivity: repro_genes.mate_selectivity,
                parental_investment: repro_genes.parental_investment,
                clutch_size: (repro_genes.clutch_size * 4.0).round().max(1.0) as u32,
                generation_time: repro_genes.generation_time,
                senescence: repro_genes.senescence,
                fecundity: repro_genes.fecundity,
                dormancy: repro_genes.dormancy,
                is_dormant: false,
                ticks_since_birth: 0.0,
                is_mature: false,
                mate_found: false,
            },
            metabolism: MetabolismState {
                basal_rate: metab_genes.basal_rate,
                aerobic_capacity: metab_genes.aerobic,
                anaerobic_capacity: metab_genes.anaerobic,
                body_temperature: 37.0,
                fat_storage: 0.0,
                sugar_metab: metab_genes.sugar_metab,
                protein_metab: metab_genes.protein_metab,
                lipid_metab: metab_genes.lipid_metab,
                metabolic_mode: "aerobic".to_string(),
            },
            trophic_level: tl as u8,
            fitness: FitnessComponents::default(),
            ecosystem: ecosystem_genes,
            immune_genes,
            predprey_genes,
            repro_genes,
            metab_genes,
            brain: match parent_brain {
                Some(parent) => brain::spawn_brain(parent, genome, &self.brain_cfg),
                None => brain::seed_brain(genome, &self.brain_cfg),
            },
            omics: None,
            discovery: None,
        }
    }

    fn count_species(&self) -> u32 {
        let mut seen = std::collections::HashSet::new();
        for a in self.agents.values() {
            if a.alive {
                seen.insert(a.species);
            }
        }
        seen.len() as u32
    }

    /// Rich population observables, ported 1:1 from the TS engine's
    /// `populationObservables()` so the WASM/server stats match the reference.
    /// Returns a `Metrics4` populated with entropy, diversity, complexity +
    /// predator_fraction, culture_count, meme_entropy, species_meme_mi,
    /// mean_aggression, mean_cooperation, mean_risk, mean_deception,
    /// predator_gene_fraction, prey_gene_fraction, energy_inequality (Gini),
    /// donation_ratio. The entropy/diversity/complexity trio drives the server
    /// /forecast observables, so it is important they are actually computed.
    fn population_metrics(&self) -> Metrics4 {
        let mut total: usize = 0;
        let mut carnivores: usize = 0;
        let mut altruism_sum: f64 = 0.0;
        let mut agg_sum: f64 = 0.0;
        let mut coop_sum: f64 = 0.0;
        let mut risk_sum: f64 = 0.0;
        let mut decep_sum: f64 = 0.0;
        let mut pred_gene_count: usize = 0;
        let mut prey_gene_count: usize = 0;
        let mut donation_sum: f64 = 0.0;
        let mut donation_count: usize = 0;
        let mut fitnesses: Vec<f64> = Vec::new();
        let mut counts: HashMap<u32, usize> = HashMap::new();
        let mut meme_counts: HashMap<i64, usize> = HashMap::new();
        let mut joint: HashMap<(u32, i64), usize> = HashMap::new();
        let mut cultures: HashSet<i64> = HashSet::new();
        let cap = self.params.energy_capacity;
        for a in self.agents.values() {
            if !a.alive {
                continue;
            }
            total += 1;
            if a.phenotype.diet > 0.6 {
                carnivores += 1;
            }
            altruism_sum += a.altruism;
            agg_sum += a.strategy.aggression;
            coop_sum += a.strategy.cooperation;
            risk_sum += a.strategy.risk;
            decep_sum += a.strategy.deception;
            if a.strategy.aggression > 0.6 {
                pred_gene_count += 1;
            }
            if a.strategy.aggression < 0.4 {
                prey_gene_count += 1;
            }
            if a.energy_acquired > 0.0 {
                donation_sum += a.total_donated / a.energy_acquired;
                donation_count += 1;
            }
            fitnesses.push(a.energy_acquired);
            let mb = (a.meme / MEME_TOLERANCE).round() as i64;
            *counts.entry(a.species).or_insert(0) += 1;
            *meme_counts.entry(mb).or_insert(0) += 1;
            *joint.entry((a.species, mb)).or_insert(0) += 1;
            cultures.insert(mb);
        }
        if total == 0 {
            return Metrics4::zero();
        }
        let total_f = total as f64;
        let entropy_of = |map: &HashMap<i64, usize>| -> f64 {
            let mut h = 0.0f64;
            for &c in map.values() {
                let p = c as f64 / total_f;
                if p > 0.0 {
                    h -= p * p.log2();
                }
            }
            h
        };
        let n = counts.len() as f64;
        let mut h = 0.0f64;
        let mut simpson = 0.0f64;
        let mut diseq = 0.0f64;
        let inv_n = 1.0 / n;
        for &c in counts.values() {
            let p = c as f64 / total_f;
            if p > 0.0 {
                h -= p * p.log2();
            }
            simpson += p * p;
            let d = p - inv_n;
            diseq += d * d;
        }
        let mut joint_h = 0.0f64;
        for &c in joint.values() {
            let p = c as f64 / total_f;
            if p > 0.0 {
                joint_h -= p * p.log2();
            }
        }
        let h_meme = entropy_of(&meme_counts);
        let mi = if h > 0.0 && h_meme > 0.0 {
            (h + h_meme - joint_h).max(0.0)
        } else {
            0.0
        };
        let mi_norm = if mi > 0.0 {
            (mi / h.min(h_meme)).min(1.0)
        } else {
            0.0
        };
        fitnesses.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
        let mut gini_num = 0.0f64;
        for i in 0..fitnesses.len() {
            gini_num += (2.0 * (i + 1) as f64 - fitnesses.len() as f64 - 1.0) * fitnesses[i];
        }
        let fitness_sum: f64 = fitnesses.iter().sum();
        let gini = if fitness_sum > 0.0 {
            (gini_num / (fitnesses.len() as f64 * fitness_sum)).max(0.0)
        } else {
            0.0
        };
        Metrics4 {
            entropy: h as f32,
            diversity: (1.0 - simpson) as f32,
            complexity: (h * diseq) as f32,
            predator_fraction: (carnivores as f64 / total_f) as f32,
            culture_count: cultures.len() as u32,
            mean_altruism: if cap > 0.0 {
                (altruism_sum / total_f / cap) as f32
            } else {
                0.0
            },
            meme_entropy: h_meme as f32,
            species_meme_mi: mi_norm as f32,
            mean_aggression: (agg_sum / total_f) as f32,
            mean_cooperation: (coop_sum / total_f) as f32,
            mean_risk: (risk_sum / total_f) as f32,
            mean_deception: (decep_sum / total_f) as f32,
            predator_gene_fraction: (pred_gene_count as f64 / total_f) as f32,
            prey_gene_fraction: (prey_gene_count as f64 / total_f) as f32,
            energy_inequality: gini as f32,
            donation_ratio: if donation_count > 0 {
                (donation_sum / donation_count as f64) as f32
            } else {
                0.0
            },
        }
    }

    fn mark_escape(&mut self, a: &SimAgent) {
        let size = self.grid.size;
        let ix = clamp(
            ((a.c_re - CRE_MIN) / CRE_RANGE * size as f64).floor(),
            0.0,
            (size - 1) as f64,
        ) as usize;
        let iy = clamp(
            ((a.c_im - CIM_MIN) / CIM_RANGE * size as f64).floor(),
            0.0,
            (size - 1) as f64,
        ) as usize;
        self.set_map_escape[iy * size + ix] = 255;
    }

    pub fn tick(&mut self) -> TickResult {
        self.tick_num += 1;
        let t = self.tick_num;
        let ts = self.params.time_scale;
        let cap = self.params.energy_capacity;

        let day_phase = (t % self.params.day_length) as f64 / self.params.day_length as f64;
        let season_phase =
            (t % self.params.season_length) as f64 / self.params.season_length as f64;
        let daylight = 0.5 + 0.5 * (TWO_PI * day_phase).cos();
        let season_cycle = 0.5 + 0.5 * (TWO_PI * season_phase).sin();
        // eccentric orbits break temporal uniformity → seasons flatten out
        let amplitude = self.world_physics.symmetry_laws.temporal_uniformity;
        let mut season_moisture = 0.4 + 0.6 * amplitude * season_cycle;

        // stochastic world processes: Markov-chain weather, OU resource field
        // and Poisson point-process regen bursts. All draws come from the
        // per-tick env stream so the whole trajectory stays reproducible.
        if let Some(wcfg) = self.world_stoch_cfg.clone() {
            if let Some(state) = self.world_stoch_state.as_mut() {
                let mut wrng = SplitMix64::new(env_seed(&self.config.seed, t) as u64);
                let matrix = wcfg.weather.unwrap_or(world_stoch::DEFAULT_WEATHER_MATRIX);
                world_stoch::step_weather(state, &mut wrng, &matrix);
                season_moisture = (season_moisture * state.weather_moisture).clamp(0.0, 1.0);
                world_stoch::step_ou(state, &mut wrng, &wcfg, ts);
                let n_burst = world_stoch::poisson_draw(&mut wrng, wcfg.poisson_rate);
                world_stoch::step_burst(&mut *state, &mut wrng, n_burst);
            }
        }

        self.trace.tick = t;
        self.trace.daylight = daylight;
        self.trace.season_phase = season_phase;
        self.trace.season_moisture = season_moisture;
        if let Some(state) = self.world_stoch_state.as_ref() {
            self.trace.weather_id = state.weather as u32;
            self.trace.weather_moisture = state.weather_moisture;
            self.trace.weather_growth = state.weather_growth;
        }

        // entropy-annealed exploration sigma for a gaussian policy head
        self.policy_sigma_val = match &self.brain_cfg.policy {
            Some(p) if p.mode == brain::PolicyMode::Gaussian => brain::policy_sigma(p, t),
            _ => 0.0,
        };

        // 1. Spatial hash rebuild
        self.spatial.clear();
        self.tick_deaths = 0;
        self.last_donation = 0.0;
        self.alive_ids.clear();
        self.born_queue.clear();
        let mut births = 0u32;
        let mut deaths = 0u32;
        let mut energy_sum = 0.0f64;
        let mut water_sum = 0.0f64;
        let mut centroid_x = 0.0f64;
        let mut centroid_y = 0.0f64;
        let mut d_starv = 0u32;
        let mut d_thirst = 0u32;
        let mut _d_age = 0u32;
        let mut d_pred = 0u32;
        let mut d_escape = 0u32;
        let mut omics_totals = omics::OmicsTotals::default();
        let mut discovery_totals = discovery::DiscoveryTotals::default();
        let mut behavior_noise_sum = 0.0f64;
        let mut burst_events = 0u32;
        let mut division_count = 0u32;

        // Ascending id order — the reference TS engine processes agents in map
        // insertion order (ids only increase), so sorting reproduces it and keeps
        // the whole tick deterministic across fresh engines (a HashMap's
        // iteration order itself is randomized per instance).
        let mut alive_ids: Vec<u32> = self
            .agents
            .values()
            .filter(|a| a.alive)
            .map(|a| a.id)
            .collect();
        alive_ids.sort_unstable();

        for &id in &alive_ids {
            let a = self.agents.get(&id).unwrap();
            self.spatial.insert(id as i32, a.x, a.y);
            self.alive_ids.push(id);
        }
        // The grid is a CSR bucket array, which cannot be finalised until every agent
        // is binned: seal() prefix-sums the per-cell counts and scatters the slots.
        self.spatial.seal();

        // Ecology grounding: recompute per-level population + crowding from the
        // alive snapshot so the crowding penalty and reproduction caps reflect
        // the current community composition (trajectory-divergent when set).
        self.ground_level_pop = self.rebuild_ground_level_pop();
        self.ground_crowd = self.compute_ground_crowd();

        // 2-4. Sensor + brain + actions
        let record_delta = self.record_delta;
        let mut delta_w = ByteWriter::new(if record_delta { 8192 } else { 8 });
        delta_w.u8(MT_DELTA);
        delta_w.u32(t);
        let count_offset = delta_w.buf.len();
        delta_w.u16(0);
        let mut prev_id = 0u32;
        let mut delta_count = 0u32;

        let alive_clone = self.alive_ids.clone();
        for &aid in &alive_clone {
            // Remove agent from map temporarily to avoid borrow conflicts
            let mut a = match self.agents.remove(&aid) {
                Some(a) if a.alive => a,
                _ => continue,
            };
            let culture_on = self.culture_channel_on();

            if a.paused_ticks > 0 {
                a.paused_ticks -= 1;
                if record_delta {
                    delta_count += 1;
                    pack_agent_write(
                        &mut delta_w,
                        prev_id,
                        a.id,
                        a.x,
                        a.y,
                        a.energy,
                        cap,
                        STATE_PAUSED,
                        a.species,
                        a.meme,
                    );
                }
                prev_id = a.id;
                energy_sum += a.energy;
                water_sum += a.water;
                centroid_x += a.x;
                centroid_y += a.y;
                self.agents.insert(a.id, a);
                continue;
            }

            a.age += ts;
            if a.energy <= 0.0
                || a.water <= 0.0
                || a.age > self.params.agent_max_age * a.phenotype.longevity
            {
                let cause = if a.water <= 0.0 {
                    DeathCause::Thirst
                } else if a.energy <= 0.0 {
                    if a.last_hunted_tick == t as i32 {
                        DeathCause::Predation
                    } else {
                        DeathCause::Starvation
                    }
                } else {
                    DeathCause::Age
                };
                match cause {
                    DeathCause::Starvation => d_starv += 1,
                    DeathCause::Thirst => d_thirst += 1,
                    DeathCause::Predation => d_pred += 1,
                    _ => _d_age += 1,
                }
                self.detach_kill(&mut a, t, cause);
                deaths += 1;
                if record_delta {
                    delta_count += 1;
                    pack_agent_write(
                        &mut delta_w,
                        prev_id,
                        a.id,
                        a.x,
                        a.y,
                        0.0,
                        cap,
                        STATE_DEAD,
                        a.species,
                        a.meme,
                    );
                }
                prev_id = a.id;
                self.agents.insert(a.id, a);
                continue;
            }

            // Fractal orbit
            a.orbit_depth = (a.orbit_depth + 1).min(ORBIT_DEPTH_CAP);
            let nr = a.z_re * a.z_re - a.z_im * a.z_im + a.c_re;
            let ni = 2.0 * a.z_re * a.z_im + a.c_im;
            a.z_re = nr;
            a.z_im = ni;
            let zmag2 = nr * nr + ni * ni;
            if zmag2 > ESCAPE_B2 {
                self.mark_escape(&a);
                self.detach_kill(&mut a, t, DeathCause::Escape);
                deaths += 1;
                d_escape += 1;
                if record_delta {
                    delta_count += 1;
                    pack_agent_write(
                        &mut delta_w,
                        prev_id,
                        a.id,
                        a.x,
                        a.y,
                        0.0,
                        cap,
                        STATE_DEAD,
                        a.species,
                        a.meme,
                    );
                }
                prev_id = a.id;
                self.agents.insert(a.id, a);
                continue;
            }
            let flux = FLUX_MIN + (FLUX_MAX - FLUX_MIN) * clamp(zmag2 / ESCAPE_B2, 0.0, 1.0);

            self.trace.agent_id = a.id;
            self.trace.zmag2 = zmag2;
            self.trace.flux = flux;

            let pheno = a.phenotype.clone();
            let size = pheno.size;
            let diet = pheno.diet;
            let sense = pheno.sense_radius;
            terrain::sample_grid_into(&self.grid, a.x, a.y, &mut self.sample);

            let chem_idx = grid_idx(&self.grid, a.x, a.y);
            let local_o2 = *self.chem_terrain.o2.get(chem_idx).unwrap_or(&0.3);
            let local_ph = *self.chem_terrain.ph.get(chem_idx).unwrap_or(&PH_NEUTRAL);
            let local_toxin = *self.chem_terrain.toxin.get(chem_idx).unwrap_or(&0.0);
            let local_minerals = *self.chem_terrain.minerals.get(chem_idx).unwrap_or(&0.15);

            // Neighbor scan
            let nb_count =
                self.spatial
                    .query_neighbors(a.x, a.y, sense, &mut self.neighbors, NEIGHBOR_MAX);
            let mut nearest_d2 = f64::INFINITY;
            let mut nearest_id: i32 = -1;
            let mut in_radius = 0u32;
            let mut threat_d2 = f64::INFINITY;
            let mut sum_vx = 0.0f64;
            let mut sum_vy = 0.0f64;
            let mut sum_x = 0.0f64;
            let mut sum_y = 0.0f64;
            let mut sep_x = 0.0f64;
            let mut sep_y = 0.0f64;
            let mut sep_count = 0u32;
            let sep_r2 = (SEPARATION_RADIUS * size).powi(2);

            for k in 0..nb_count {
                let nb_id = self.neighbors[k] as u32;
                let nb = match self.agents.get(&nb_id) {
                    Some(nb) if nb.alive && nb.id != a.id => nb,
                    _ => continue,
                };
                let ddx = nb.x - a.x;
                let ddy = nb.y - a.y;
                let d2 = ddx * ddx + ddy * ddy;
                if d2 < nearest_d2 {
                    nearest_d2 = d2;
                    nearest_id = nb.id as i32;
                }
                if d2 <= sense * sense {
                    in_radius += 1;
                }
                if nb.phenotype.diet > 0.6 && nb.phenotype.size >= size && d2 < threat_d2 {
                    threat_d2 = d2;
                }
                sum_vx += nb.vx;
                sum_vy += nb.vy;
                sum_x += nb.x;
                sum_y += nb.y;
                if d2 > 0.0 && d2 <= sep_r2 {
                    let inv = 1.0 / d2.sqrt();
                    sep_x += -ddx * inv;
                    sep_y += -ddy * inv;
                    sep_count += 1;
                }
            }

            // Sensors
            self.sensors[0] = self.sample.height as f32;
            self.sensors[1] = (a.energy / cap) as f32;
            self.sensors[2] = self.sample.moisture as f32;
            self.sensors[3] = self.sample.hazard as f32;
            self.sensors[4] = if nearest_d2.is_finite() {
                ((nearest_d2.sqrt() / sense).min(1.0)) as f32
            } else {
                1.0
            };
            self.sensors[5] = (in_radius as f32 / 8.0).min(1.0);
            self.sensors[6] = if self.sample.cap > 0.0 {
                (self.sample.food / self.sample.cap).min(1.0) as f32
            } else {
                0.0
            };
            self.sensors[7] = if self.sample.cap > 0.0 {
                (self.sample.meat / self.sample.cap.max(1.0)).min(1.0) as f32
            } else {
                0.0
            };
            self.sensors[8] = self.sample.signal as f32;
            self.sensors[9] = season_phase as f32;
            self.sensors[10] = if threat_d2.is_finite() {
                ((threat_d2.sqrt() / sense).min(1.0)) as f32
            } else {
                1.0
            };
            self.sensors[11] = (a.vx / 4.5).clamp(-1.0, 1.0) as f32;
            self.sensors[12] = (a.vy / 4.5).clamp(-1.0, 1.0) as f32;
            self.sensors[13] = if self.sample.cap > 0.0 {
                (self.sample.minerals / self.sample.cap.max(0.001)).min(1.0) as f32
            } else {
                0.0
            };
            self.sensors[14] = self.sample.chem as f32;

            self.trace.nb_count = nb_count as u32;

            // POMDP perception: hidden + noisy observations, belief-filtered,
            // then blended back into the policy input so acting is
            // belief-guided. Only active when the brain (which carries the
            // belief) is enabled.
            if self.brain_cfg.enabled {
                if let Some(pomdp) = self.brain_cfg.pomdp.as_ref() {
                    if pomdp.enabled {
                        self.trace.obs_raw = self.sensors.to_vec().try_into().unwrap();
                        brain::step_pomdp(
                            &mut a.brain,
                            &mut self.sensors,
                            pomdp,
                            t,
                            a.id,
                            &mut self.pomdp_noise,
                        );
                        self.trace.belief = a.brain.belief;
                        let n = pomdp
                            .hidden
                            .as_ref()
                            .map_or(brain::DEFAULT_POMDP_HIDDEN.len(), |v| v.len())
                            .min(brain::POMDP_BELIEF);
                        self.trace.obs_noise = [0.0; MLP_INPUTS];
                        self.trace.obs_noise[..n].copy_from_slice(&self.pomdp_noise[..n]);
                    }
                }
            }

            self.trace.sensors = self.sensors.to_vec().try_into().unwrap();
            self.trace.hazard = self.sample.hazard;

            // Energy at decision time — the reference point for the learning
            // reward (net energy gained over the whole tick).
            let energy_before = a.energy;
            let v_cur = if self.brain_cfg.enabled {
                brain::forward_plastic(&mut a.brain, &self.sensors, &mut self.hidden, &mut self.out)
            } else {
                genome::forward_genome(&a.genome, &self.sensors, &mut self.hidden, &mut self.out);
                0.0
            };
            self.trace.energy_before = energy_before;

            // stochastic policy: sample Gaussian exploration around the mean
            // `out` (reparameterized — the agent propels itself with `act`, but
            // backprop still learns the mean, so exploration and gradient
            // descent coexist). Deterministic policies keep act = mean and
            // consume no draws.
            let mut action_means = &self.out;
            if self
                .brain_cfg
                .policy
                .as_ref()
                .is_some_and(|p| p.mode == brain::PolicyMode::Gaussian)
            {
                let mut rng_a = SplitMix64::new(stream_seed(
                    &self.config.seed,
                    t.wrapping_mul(7).wrapping_add(3),
                    a.id,
                ) as u64);
                brain::sample_gaussian_action(
                    &self.out,
                    &mut self.act,
                    &mut self.act_eps,
                    self.policy_sigma_val,
                    &mut rng_a,
                );
                action_means = &self.act;
                self.trace.act = self.act;
                self.trace.eps = self.act_eps;
                self.trace.policy_sigma = self.policy_sigma_val;
            }

            // Pattern drives
            let drv = &a.drives;
            let mut drive_x = 0.0f64;
            let mut drive_y = 0.0f64;
            self.trace.d_alg_y = 0.0;
            self.trace.d_co_y = 0.0;
            self.trace.d_sep_y = 0.0;
            self.trace.d_osc_y = 0.0;
            self.trace.d_noise_y = 0.0;
            let strength = drv.alignment
                + drv.cohesion
                + drv.separation
                + drv.circulation.abs()
                + drv.oscillation
                + drv.noise;
            if strength > 0.001 {
                if nb_count > 0 {
                    if drv.alignment > 0.01 {
                        let hm = sum_vx.hypot(sum_vy);
                        if hm > 0.01 {
                            drive_x += (sum_vx / hm) * drv.alignment;
                            self.trace.d_alg_y = (sum_vy / hm) * drv.alignment;
                            drive_y += (sum_vy / hm) * drv.alignment;
                        }
                    }
                    if drv.cohesion > 0.01 || drv.circulation.abs() > 0.01 {
                        let mut cdx = sum_x / nb_count as f64 - a.x;
                        let mut cdy = sum_y / nb_count as f64 - a.y;
                        let half_world = WORLD_SIZE_USIZE as f64 / 2.0;
                        if cdx > half_world {
                            cdx -= WORLD_SIZE_USIZE as f64;
                        } else if cdx < -half_world {
                            cdx += WORLD_SIZE_USIZE as f64;
                        }
                        if cdy > half_world {
                            cdy -= WORLD_SIZE_USIZE as f64;
                        } else if cdy < -half_world {
                            cdy += WORLD_SIZE_USIZE as f64;
                        }
                        let cm = cdx.hypot(cdy);
                        if cm > 0.01 {
                            drive_x += (cdx / cm) * drv.cohesion;
                            self.trace.d_co_y = (cdy / cm) * drv.cohesion;
                            drive_y += (cdy / cm) * drv.cohesion;
                            drive_x += (-cdy / cm) * drv.circulation;
                            drive_y += (cdx / cm) * drv.circulation;
                        }
                    }
                    if drv.separation > 0.01 && sep_count > 0 {
                        let sm = sep_x.hypot(sep_y);
                        if sm > 0.01 {
                            drive_x += (sep_x / sm) * drv.separation;
                            self.trace.d_sep_y = (sep_y / sm) * drv.separation;
                            drive_y += (sep_y / sm) * drv.separation;
                        }
                    }
                }
                if drv.oscillation > 0.01 {
                    let ph =
                        t as f64 * (0.02 + drv.oscillation * 0.1) + a.c_re * 1.2 + a.c_im * 2.4;
                    self.trace.ph = ph;
                    self.trace.osc = drv.oscillation;
                    drive_x += (ph.sin()) * drv.oscillation;
                    self.trace.d_osc_y = (ph.cos()) * drv.oscillation;
                    drive_y += (ph.cos()) * drv.oscillation;
                    self.trace.sin_ph = ph.sin();
                    self.trace.cos_ph = ph.cos();
                }
                if drv.noise > 0.01 {
                    self.trace.noise = drv.noise;
                    let mut h = (t.wrapping_add(1)).wrapping_mul(374761393)
                        ^ (a.id.wrapping_add(1)).wrapping_mul(668265263);
                    h = (h ^ (h >> 13)).wrapping_mul(1274126177);
                    h ^= h >> 16;
                    let nx = ((h & 0xffff) as f64 / 32767.5 - 1.0) * drv.noise;
                    let ny = (((h >> 16) & 0xffff) as f64 / 32767.5 - 1.0) * drv.noise;
                    self.trace.d_noise_y = ny;
                    drive_x += nx;
                    drive_y += ny;
                }
            }

            // Phase 2: couple the mesoscale Lennard-Jones force pass into the
            // steering drive (affinity clustering spacing / collapse). Forces
            // were computed from the previous tick's positions, so the move
            // below sees a consistent, deterministic field.
            if self.config.biophysics.unwrap_or(false) {
                if let Some(&(fx, fy)) = self.bio_forces.get(&a.id) {
                    drive_x += fx * FORCE_DRIVE_SCALE as f64;
                    drive_y += fy * FORCE_DRIVE_SCALE as f64;
                }
            }

            // Phase D stochastic dynamics: behaviour-level steering noise —
            // a per-(seed,tick,agent) gaussian pulse scaled by sqrt(dt), i.e.
            // genuinely noisy morphs that still reproduce exactly per seed.
            if self.config.stochastic_dynamics.unwrap_or(false) {
                let mut srng = SplitMix64::new(dyn_seed(&self.config.seed, t, a.id) as u64);
                let noise_x = (srng.next_gaussian64() * STOCH_OU_SIGMA * ts.sqrt())
                    .clamp(-STOCH_OU_LIMIT, STOCH_OU_LIMIT);
                let noise_y = (srng.next_gaussian64() * STOCH_OU_SIGMA * ts.sqrt())
                    .clamp(-STOCH_OU_LIMIT, STOCH_OU_LIMIT);
                drive_x += noise_x;
                drive_y += noise_y;
                behavior_noise_sum += noise_x.abs() + noise_y.abs();
            }

            // Phase D discovery: an agent in exploration mode wanders — its
            // steering gains the same hash-noise turn the hebbian-noise path
            // uses, so the move stays deterministic and parity-safe.
            if self.config.discovery.unwrap_or(false) {
                if let Some(ds) = a.discovery.as_ref() {
                    if ds.explore_ticks > 0.0 {
                        let mut h = (t.wrapping_add(3)).wrapping_mul(374761393)
                            ^ (a.id.wrapping_add(7)).wrapping_mul(668265263);
                        h = (h ^ (h >> 13)).wrapping_mul(1274126177);
                        h ^= h >> 16;
                        let nx =
                            ((h & 0xffff) as f64 / 32767.5 - 1.0) * discovery::DISC_EXPLORE_TURN;
                        let ny = (((h >> 16) & 0xffff) as f64 / 32767.5 - 1.0)
                            * discovery::DISC_EXPLORE_TURN;
                        drive_x += nx;
                        drive_y += ny;
                    }
                }
            }

            let thrust_x = (action_means[0] as f64 + drive_x * DRIVE_SCALE).clamp(-1.0, 1.0);
            let thrust_y = (action_means[1] as f64 + drive_y * DRIVE_SCALE).clamp(-1.0, 1.0);

            self.trace.out = self.out;
            self.trace.drive_x = drive_x;
            self.trace.drive_y = drive_y;
            self.trace.thrust_x = thrust_x;
            self.trace.thrust_y = thrust_y;

            // Movement
            let water_frac = a.water / cap;
            let climb_cost = if self.sensing_on() {
                let m = crate::physics::step_movement(
                    a.x,
                    a.y,
                    a.vx,
                    a.vy,
                    thrust_x,
                    thrust_y,
                    pheno.speed,
                    size,
                    ts,
                    water_frac,
                    self.sample.hazard,
                    &self.grid,
                    &self.world_physics,
                    self.topology,
                );
                a.x = m.x;
                a.y = m.y;
                a.vx = m.vx;
                a.vy = m.vy;
                self.trace.water_frac = water_frac;
                self.trace.dh = m.dh;
                m.climb_cost
            } else {
                // Sensorimotor loop disabled (adaptive-agent ablation): the
                // agent neither steers nor drifts, so it exposes no
                // state->action feedback substrate.
                a.vx = 0.0;
                a.vy = 0.0;
                self.trace.water_frac = water_frac;
                self.trace.dh = 0.0;
                0.0
            };

            // Metabolic cost
            let risk_discount = 1.0 - a.strategy.risk * 0.3;
            let metab = pheno.metabolism * self.params.metabolism_base;
            let chem_mod = 0.85 + 0.3 * self.sample.chem;
            self.trace.chem_mod = chem_mod;
            let move_mag = thrust_x.abs() + thrust_y.abs();
            a.energy -= metab
                * size
                * (0.5 + self.sample.hazard * risk_discount)
                * chem_mod
                * ts
                * (1.6 - flux)
                + metab * size * move_mag * 0.3 * ts;

            // Ecology grounding: over its real GBIF carrying capacity a trophic
            // level pays extra upkeep, gating reproduction and driving starvation.
            let lv = a.trophic_level as usize;
            if lv < 5 && self.ground_crowd[lv] > 0.0 {
                a.energy -= metab * size * self.ground_crowd[lv] as f64 * CROWDING_STRESS * ts;
            }

            // climb tax (deducted after the crowding check, matching the TS
            // reference order so the subtraction roundings line up)
            a.energy -= climb_cost;

            // Water balance
            let evap = WATER_EVAP_RATE
                * size
                * ts
                * (1.3 - self.sample.moisture * 0.6)
                * (1.0 + self.sample.hazard * 0.5);
            let drink_boost = 1.0 + self.out[6] as f64 * 3.0;
            let absorb =
                WATER_ABSORB_RATE * self.sample.moisture * drink_boost * season_moisture * ts;
            a.water = clamp(a.water - evap + absorb, 0.0, cap);

            // Feeding
            if a.energy < cap {
                let plant_eff: f64 = if diet < 0.4 {
                    1.0
                } else if diet > 0.6 {
                    0.04
                } else {
                    0.5
                };
                if self.sample.food > 0.0 {
                    let need = cap - a.energy;
                    let intake = need.min(
                        self.sample.food
                            * EATING_RATE
                            * ts
                            * self.out[2] as f64
                            * plant_eff
                            * size
                            * (0.6 + 0.8 * flux),
                    );
                    if intake > 0.0 {
                        a.energy += intake;
                        a.energy_acquired += intake;
                        withdraw_into(
                            &mut self.grid.food,
                            self.grid.size,
                            self.grid.cell,
                            a.x,
                            a.y,
                            intake,
                        );
                    }
                }
                let meat_eff: f64 = if diet > 0.6 {
                    1.0
                } else if diet < 0.4 {
                    0.04
                } else {
                    0.6
                };
                if self.sample.meat > 0.0 && a.energy < cap {
                    let need = cap - a.energy;
                    let intake = need.min(
                        self.sample.meat
                            * MEAT_EATING_RATE
                            * ts
                            * self.out[2] as f64
                            * meat_eff
                            * size
                            * (0.6 + 0.8 * flux),
                    );
                    if intake > 0.0 {
                        a.energy += intake;
                        a.energy_acquired += intake;
                        withdraw_into(
                            &mut self.grid.meat,
                            self.grid.size,
                            self.grid.cell,
                            a.x,
                            a.y,
                            intake,
                        );
                    }
                }
            }

            // Chemistry tick
            let plant_intake: f64 = if self.sample.food > 0.0 { 1.0 } else { 0.0 };
            let meat_intake: f64 = if self.sample.meat > 0.0 { 1.0 } else { 0.0 };
            let chem_delta = chemistry::tick_agent_chemistry(
                &mut a.chemistry,
                plant_intake,
                meat_intake,
                self.sample.moisture,
                local_o2 as f64,
                local_ph as f64,
                local_toxin as f64,
                local_minerals as f64,
                diet,
                *a.genome.get(124).unwrap_or(&0.5) as f64,
                *a.genome.get(125).unwrap_or(&0.5) as f64,
                *a.genome.get(126).unwrap_or(&0.5) as f64,
                *a.genome.get(127).unwrap_or(&0.5) as f64,
                ts,
                self.ground_stoich.as_ref(),
            );
            a.energy = clamp(a.energy + chem_delta * cap * 0.01, 0.0, cap);

            // DNA tick
            let dna_genes = genome::decode_dna_genes(&a.genome);
            let mut dna_rng =
                SplitMix64::new(stream_seed(&self.config.seed, t, a.id * 7 + 1000) as u64);
            let dna_result = dna::tick_dna(
                &mut a.dna,
                &dna_genes,
                ts,
                &mut dna_rng,
                a.chemistry.molecules[1] as f64,
            );
            a.energy = clamp(a.energy - dna_result.atp_cost * cap * 0.001, 0.0, cap);
            if dna_result.mutations_occurred {
                a.energy = clamp(a.energy * (0.99 + a.dna.integrity * 0.01), 0.0, cap);
            }

            // Molecular-omics tick (opt-in via WorldConfig.omics): transcriptomics / proteomics /
            // fluxomics observables + Phase C folding / TF regulation / env classification (and,
            // under the sub-flags, stochastic expression + folding entropy and combinatorial
            // library chemistry). Reads the DNA expression + epigenetic marks and the chemistry
            // pools; advances only the per-agent omics state (no energy / pool mutations beyond
            // the fluxome + library, which the chemistry pass already accounts for).
            if self.config.omics.unwrap_or(false) {
                if a.omics.is_none() {
                    a.omics = Some(omics::create_agent_omics(&a.genome, a.id));
                }
                let heat = match self.trace.weather_id {
                    3 => 1.0,
                    2 => 0.8,
                    1 => 0.2,
                    _ => self.env_profile.heat,
                };
                let omics_env = omics::OmicsEnv {
                    o2: local_o2 as f64,
                    food: self.sample.food,
                    meat: self.sample.meat,
                    ph: local_ph as f64,
                    toxin: local_toxin as f64,
                    water: (self.sample.moisture * self.env_profile.water_factor).clamp(0.0, 1.0),
                    heat,
                };
                let om_seed = omics_seed(&self.config.seed, t, a.id);
                let om_agg = omics::tick_omics(
                    a.omics.as_mut().unwrap(),
                    &a.genome,
                    &a.dna,
                    &mut a.chemistry,
                    &omics_env,
                    ts,
                    om_seed,
                    self.config.omics_stochastic.unwrap_or(false),
                    self.config.combinatorial.unwrap_or(false),
                    self.config.folding.unwrap_or(false),
                );
                omics_totals.add(&om_agg);
            }

            // Phase D discovery / curiosity (opt-in via WorldConfig.discovery):
            // quantise the local context, compare against the prototype codebook,
            // reward pattern-recognition events and hand out an exploration
            // window. Pure integer/state math — no RNG — so it is bit-exact in
            // the TS reference mirror.
            if self.config.discovery.unwrap_or(false) {
                if a.discovery.is_none() {
                    a.discovery = Some(discovery::create_discovery_state(disc_seed(
                        &self.config.seed,
                        a.id,
                    )));
                }
                let ds = a.discovery.as_mut().unwrap();
                let energy_frac = (a.energy / cap).clamp(0.0, 1.0);
                let sig = discovery::signature(
                    energy_frac,
                    (a.water / cap).clamp(0.0, 1.0),
                    (a.age / self.params.agent_max_age).clamp(0.0, 1.0),
                    a.meme.clamp(0.0, 1.0),
                    1.0 - energy_frac,
                    self.sample.hazard.clamp(0.0, 1.0),
                    day_phase,
                    season_phase,
                    (nb_count as f64 / NEIGHBOR_MAX as f64).clamp(0.0, 1.0),
                );
                let res = discovery::tick_discovery(ds, sig, ts);
                if res.discovered {
                    a.energy = clamp(a.energy + discovery::DISC_REWARD * cap * 0.01, 0.0, cap);
                    discovery_totals.discoveries += 1;
                    self.push_event(
                        "discovery",
                        res.novelty.clamp(0.0, 1.0) as f32,
                        EventData {
                            agent_id: Some(a.id),
                            novelty: Some(res.novelty),
                            ..Default::default()
                        },
                    );
                }
                discovery_totals.novelty_sum += res.novelty;
                discovery_totals.memory_diversity_sum += discovery::memory_diversity(&ds.hits);
                if res.exploring {
                    discovery_totals.exploring += 1;
                }
            }

            // Cell tick
            let cell_genes = genome::decode_cell_genes(&a.genome);
            let mem_genes = genome::decode_membrane_genes(&a.genome);
            let mut cell_rng =
                SplitMix64::new(stream_seed(&self.config.seed, t, a.id * 13 + 2000) as u64);
            let cell_result = cells::tick_cell(
                &mut a.cell,
                &cell_genes,
                &mem_genes,
                &a.chemistry.ions,
                ts,
                &mut cell_rng,
                a.energy,
            );
            a.energy = clamp(a.energy - cell_result.atp_cost * cap * 0.001, 0.0, cap);

            // Cell biochemistry tick (opt-in via WorldConfig.cell_bio)
            let mut fold_effect = 1.0;
            if self.config.cell_bio.unwrap_or(false) {
                if a.cell.bio.is_none() {
                    a.cell.bio = Some(cellbio::create_cell_bio_state(&mem_genes, &a.chemistry));
                }
                let mut bio_rng =
                    SplitMix64::new(stream_seed(&self.config.seed, t, a.id * 23 + 3000) as u64);
                let bio_res = cellbio::apply_cell_bio_tick(
                    &mut a.chemistry,
                    &mut a.cell,
                    &mem_genes,
                    &cell_genes,
                    *a.genome.get(124).unwrap_or(&0.5) as f64,
                    &cellbio::ApplyEnv {
                        o2_local: local_o2 as f64,
                        mineral_local: local_minerals as f64,
                        toxin_local: local_toxin as f64,
                        ph_local: local_ph as f64,
                        water_available: self.sample.moisture,
                    },
                    &mut bio_rng,
                    ts,
                );
                a.energy = clamp(a.energy - bio_res.atp_cost * cap * 0.001, 0.0, cap);
                fold_effect = bio_res.fold_effect;
            }

            // Immune tick
            let immune_g = genome::decode_immune_genes(&a.genome);
            let immune_response =
                immune_g.innate * 0.001 + immune_g.adaptive * a.immune.adaptive * 0.001;
            if a.immune.pathogen_load > 0.0 {
                let fought = a.immune.pathogen_load.min(immune_response * ts);
                a.immune.pathogen_load = (a.immune.pathogen_load - fought).max(0.0);
                a.immune.pathogens_fought += fought;
                a.energy = clamp(a.energy - IMMUNE_COST as f64 * ts * cap * 0.001, 0.0, cap);
                a.immune.inflammation =
                    (a.immune.inflammation + fought * immune_g.inflammation * 0.01).min(1.0);
            }
            a.immune.inflammation *= 0.99;
            if a.immune.inflammation > 0.5 && immune_g.autoimmunity > 0.3 {
                a.energy = clamp(
                    a.energy
                        - a.immune.inflammation * immune_g.autoimmunity * 0.002 * ts * cap * 0.01,
                    0.0,
                    cap,
                );
            }
            if a.immune.immune_memory > 0.0 {
                a.immune.immune_memory -= ts;
            }
            a.immune.symbiont_load = (a.immune.symbiont_load
                + (immune_g.symbiont_tolerance * 0.001 - 0.0005) * ts)
                .max(0.0)
                .min(10.0);

            // Metabolism tick
            let metab_g = genome::decode_metab_genes(&a.genome);
            let basal_cost = BASAL_METABOLIC_COST as f64 * metab_g.basal_rate * ts;
            a.energy = clamp(a.energy - basal_cost * cap * 0.01, 0.0, cap);
            if a.cell.mito_efficiency > 0.0 && a.energy > 0.0 {
                let aerobic_atp = AEROBIC_ATP_RATE as f64
                    * metab_g.aerobic
                    * a.cell.mito_efficiency
                    * ts
                    * (0.4 + 0.6 * fold_effect);
                let local_o2_mito = *self
                    .chem_terrain
                    .o2
                    .get(grid_idx(&self.grid, a.x, a.y))
                    .unwrap_or(&0.3);
                let atp_gain = aerobic_atp * local_o2_mito as f64;
                a.energy = clamp(a.energy + atp_gain * cap * 0.001, 0.0, cap);
            }
            if metab_g.thermoregulation > 0.3 {
                a.energy = clamp(
                    a.energy
                        - THERMOREGULATION_COST as f64
                            * metab_g.thermoregulation
                            * ts
                            * cap
                            * 0.001,
                    0.0,
                    cap,
                );
            }

            // Predator-prey
            let pp_g = genome::decode_predprey_genes(&a.genome);
            a.predprey.stealth = pp_g.stealth;
            a.predprey.pursuit = pp_g.pursuit;
            a.predprey.ambush = pp_g.ambush;
            a.predprey.mimicry = pp_g.mimicry;
            a.predprey.aposematism = pp_g.aposematism;
            a.predprey.ticks_since_hunt += 1;
            if !a.predprey.is_chasing {
                a.predprey.ticks_since_hunt = 0;
            }

            // Dormancy
            if a.repro.dormancy > 0.5 && a.energy < cap * 0.15 {
                a.repro.is_dormant = true;
                a.energy = clamp(
                    a.energy
                        - BASAL_METABOLIC_COST as f64 * (1.0 - DORMANCY_CONSERVATION as f64) * ts,
                    0.0,
                    cap,
                );
            } else if a.repro.is_dormant && a.energy > cap * 0.3 {
                a.repro.is_dormant = false;
            }

            // Reproduction tracking
            a.repro.ticks_since_birth += ts;
            let maturity_age = 10.0 + a.repro.generation_time * 40.0;
            a.repro.is_mature = a.repro.ticks_since_birth >= maturity_age;

            // Hunt
            let agg_threshold = 0.5 + (0.5 - a.strategy.aggression) * 0.4;
            if diet > 0.5
                && self.out[4] as f64 > agg_threshold
                && nearest_id >= 0
                && a.energy < cap * 0.85
            {
                let prey_id = nearest_id as u32;
                if let Some(prey) = self.agents.get(&prey_id) {
                    if prey.alive && prey.phenotype.size <= size {
                        let prey_energy = prey.energy;
                        let prey_speed = prey.phenotype.speed;
                        let prey_stealth = prey.predprey.stealth;
                        let prey_size = prey.phenotype.size;
                        let mut hunt_rng =
                            SplitMix64::new(stream_seed(&self.config.seed, t, a.id) as u64);
                        let rel_speed = prey_speed / 0.1_f64.max(pheno.speed);
                        let stealth_bonus = prey_stealth * 0.2;
                        let pursuit_bonus = a.predprey.pursuit * 0.15;
                        let escape = clamp(
                            0.1 + rel_speed * 0.3
                                + if prey_size > size { 0.15 } else { 0.0 }
                                + (prey_energy / cap) * 0.15
                                - pursuit_bonus
                                + stealth_bonus,
                            0.0,
                            0.7,
                        );
                        if hunt_rng.next_float64() > escape {
                            let agg_scale = 0.5 + a.strategy.aggression * 0.5;
                            let is_stationary = a.vx.abs() < 0.1 && a.vy.abs() < 0.1;
                            let ambush_mult = if is_stationary {
                                1.0 + a.predprey.ambush * 0.5
                            } else {
                                1.0
                            };
                            let mut pack_allies = 0u32;
                            for k in 0..nb_count {
                                let nb_id2 = self.neighbors[k] as u32;
                                if let Some(nb) = self.agents.get(&nb_id2) {
                                    if nb.alive
                                        && nb.id != a.id
                                        && nb.species == a.species
                                        && nb.strategy.aggression > 0.5
                                    {
                                        pack_allies += 1;
                                    }
                                }
                            }
                            let pack_mult = 1.0
                                + (pack_allies as f64).min(5.0)
                                    * PACK_BONUS as f64
                                    * a.predprey_genes.pack_hunting;
                            let bite = (BITE_FRACTION
                                * size
                                * self.out[4] as f64
                                * ts
                                * cap
                                * agg_scale
                                * ambush_mult
                                * pack_mult)
                                .min(prey_energy);
                            let gain = bite * 0.6;
                            if let Some(prey_mut) = self.agents.get_mut(&prey_id) {
                                prey_mut.energy -= bite;
                                prey_mut.last_hunted_tick = t as i32;
                                prey_mut.last_hunted_by = a.id as i32;
                                prey_mut.times_hunted += 1;
                            }
                            a.total_hunt_damage += bite;
                            if bite >= prey_energy {
                                a.kills += 1;
                                let (px, py) = self
                                    .agents
                                    .get(&prey_id)
                                    .map(|p| (p.x, p.y))
                                    .unwrap_or((0.0, 0.0));
                                self.push_event(
                                    "predation",
                                    0.4,
                                    EventData {
                                        predator_id: Some(a.id),
                                        prey_id: Some(prey_id),
                                        x: Some(px),
                                        y: Some(py),
                                        bite: Some(bite),
                                        ..Default::default()
                                    },
                                );
                            }
                            a.energy = (a.energy + gain).min(cap);
                            a.energy_acquired += gain;
                            a.predprey.is_chasing = true;
                            // Warning call: alert nearby same-species agents about the hunt
                            if a.predprey_genes.warning_call > 0.3 && nb_count > 0 {
                                let mut warned: Vec<u32> = Vec::new();
                                for k in 0..nb_count {
                                    let nb_id2 = self.neighbors[k] as u32;
                                    if let Some(nb) = self.agents.get(&nb_id2) {
                                        if nb.alive && nb.id != a.id && nb.species == a.species {
                                            warned.push(nb_id2);
                                        }
                                    }
                                }
                                for wid in warned {
                                    if let Some(nb) = self.agents.get_mut(&wid) {
                                        // Keep a real blow landed this tick (attribution
                                        // intact); a pure warning marks the tick with no
                                        // killer.
                                        if nb.last_hunted_tick != t as i32 {
                                            nb.last_hunted_tick = t as i32;
                                            nb.last_hunted_by = -1;
                                        }
                                    }
                                }
                                a.predprey.warning_calls += 1;
                            }
                        }
                    }
                }
            } else {
                a.predprey.is_chasing = false;
            }

            // Signalling
            if self.out[5] as f64 > 0.3 && a.energy > cap * 0.15 {
                let honest_cost = 1.0 - a.strategy.deception * 0.7;
                let cost = self.out[5] as f64 * SIGNAL_COST * size * ts * honest_cost;
                a.energy -= cost;
                let deposit = self.config.signal_deposit.unwrap_or(1.0) as f64;
                if deposit > 0.0 {
                    let idx = grid_idx(&self.grid, a.x, a.y);
                    self.grid.signal[idx] = (self.grid.signal[idx] as f64
                        + self.out[5] as f64 * SIGNAL_DEPOSIT * deposit * ts)
                        .min(1.0) as f32;
                }
            }

            // Greenbeard altruism
            {
                let coop_threshold = ALTRUISM_THRESHOLD - (a.strategy.cooperation - 0.5) * 0.2;
                let coop_scale = 0.4 + a.strategy.cooperation * 0.6;
                if a.energy > cap * coop_threshold && self.out[5] as f64 > 0.3 {
                    let mut kin_d2 = f64::INFINITY;
                    let mut kin_id: Option<u32> = None;
                    for k in 0..nb_count {
                        let nb_id2 = self.neighbors[k] as u32;
                        if let Some(nb) = self.agents.get(&nb_id2) {
                            if !nb.alive || nb.id == aid {
                                continue;
                            }
                            if (nb.meme - a.meme).abs() > MEME_TOLERANCE {
                                continue;
                            }
                            if nb.energy > cap * 0.3 {
                                continue;
                            }
                            let ddx = nb.x - a.x;
                            let ddy = nb.y - a.y;
                            let d2 = ddx * ddx + ddy * ddy;
                            if d2 < kin_d2 {
                                kin_d2 = d2;
                                kin_id = Some(nb.id);
                            }
                        }
                    }
                    if let Some(kid) = kin_id {
                        let gift = (a.energy - cap * 0.5)
                            .min(DONATION_RATE * size * ts * cap * coop_scale);
                        if gift > 0.0 {
                            a.energy -= gift;
                            a.altruism += gift;
                            a.total_donated += gift;
                            self.last_donation += gift;
                            if let Some(kin) = self.agents.get_mut(&kid) {
                                kin.energy = (kin.energy + gift).min(cap);
                                kin.total_received += gift;
                            }
                        }
                    }
                }
            }

            // Memetic transmission
            if nb_count > 0 {
                let mut role_model_id: Option<u32> = None;
                let mut model_energy = -1.0f64;
                let my_energy = a.energy;
                let my_meme = a.meme;
                for k in 0..nb_count {
                    let nb_id2 = self.neighbors[k] as u32;
                    if let Some(nb) = self.agents.get(&nb_id2) {
                        if !nb.alive || nb.id == aid || nb.energy <= model_energy {
                            continue;
                        }
                        model_energy = nb.energy;
                        role_model_id = Some(nb.id);
                    }
                }
                if let Some(rm_id) = role_model_id {
                    let rm_meme = self.agents.get(&rm_id).map(|rm| (rm.energy, rm.meme));
                    if let Some((rm_energy, rm_meme_val)) = rm_meme {
                        if rm_energy > my_energy && (rm_meme_val - my_meme).abs() > MEME_TOLERANCE {
                            let mut meme_rng =
                                SplitMix64::new(meme_seed(&self.config.seed, t, aid) as u64);
                            let copy_rate =
                                MEME_COPY_RATE * self.config.meme_copy_rate.unwrap_or(1.0) as f64;
                            if meme_rng.next_float64() < copy_rate * ts {
                                a.meme = rm_meme_val;
                            }
                        }
                    }
                }
            }

            // Reproduction
            {
                let repro_threshold = REPRO_ENERGY_THRESHOLD / pheno.fertility;
                let sexual_cost_mult = if a.repro.sexual > 0.5 {
                    SEXUAL_COST_MULT as f64
                } else {
                    1.0
                };
                let global_pop_ok = ((self.alive_ids.len() as u32).wrapping_sub(deaths)
                    + self.born_queue.len() as u32)
                    < self.params.max_population as u32;
                // Ecology grounding: cap reproduction per trophic level using real
                // GBIF abundance. Falls back to the flat cap when ungrounded.
                let ground_cap_ok = {
                    let total = self.ground_eco_fra.iter().fold(0.0, |a, b| a + b);
                    if total <= 0.0 {
                        true
                    } else {
                        let lv = a.trophic_level as usize;
                        let cap_lv = self.level_cap(lv);
                        let mut same_level = self.ground_level_pop[lv];
                        for child in &self.born_queue {
                            if (child.trophic_level as usize) == lv {
                                same_level += 1;
                            }
                        }
                        same_level < cap_lv
                    }
                };
                if self.reproduction_on()
                    && self.out[3] > 0.5
                    && a.last_repro_tick != t as i32
                    && a.age >= REPRO_AGE_MIN
                    && a.repro.is_mature
                    && a.energy > cap * repro_threshold * sexual_cost_mult
                    && global_pop_ok
                    && ground_cap_ok
                {
                    let mut mate_d2 = sense * sense;
                    let mut mate_id: Option<u32> = None;
                    for k in 0..nb_count {
                        let nb_id2 = self.neighbors[k] as u32;
                        if let Some(nb) = self.agents.get(&nb_id2) {
                            if !nb.alive
                                || nb.id == aid
                                || nb.species != a.species
                                || nb.last_repro_tick == t as i32
                            {
                                continue;
                            }
                            if nb.age + ts < REPRO_AGE_MIN
                                || nb.energy
                                    <= cap * (REPRO_ENERGY_THRESHOLD / nb.phenotype.fertility)
                            {
                                continue;
                            }
                            let sim = genome::genome_similarity(&a.genome, &nb.genome);
                            if a.repro.mate_selectivity > 0.5 && sim < 0.85 {
                                continue;
                            }
                            let ddx = nb.x - a.x;
                            let ddy = nb.y - a.y;
                            let d2 = ddx * ddx + ddy * ddy;
                            if d2 <= mate_d2 {
                                mate_d2 = d2;
                                mate_id = Some(nb.id);
                            }
                        }
                    }

                    let child_id = self.next_id;
                    self.next_id += 1;
                    let mut child_rng =
                        SplitMix64::new(stream_seed(&self.config.seed, t, child_id) as u64);
                    let pre = a.energy;
                    let pre_w = a.water;
                    let b_pre =
                        mate_id.map_or(0.0, |mid| self.agents.get(&mid).map_or(0.0, |m| m.energy));
                    let invest_mult = 0.5 + a.repro.parental_investment * 0.5;

                    // Parent energy cost
                    a.energy = pre
                        * (if mate_id.is_some() {
                            0.55 * (1.0 - a.repro.parental_investment * 0.1)
                        } else {
                            0.5 * (1.0 - a.repro.parental_investment * 0.1)
                        });
                    a.water = pre_w * 0.5;
                    a.last_repro_tick = t as i32;
                    if let Some(mid) = mate_id {
                        if let Some(mate) = self.agents.get_mut(&mid) {
                            mate.energy =
                                b_pre * (0.45 * (1.0 - mate.repro.parental_investment * 0.1));
                            mate.last_repro_tick = t as i32;
                        }
                    }

                    let genome_parent = a.genome.clone();
                    let mut genome_child = if mate_id.is_some() {
                        let mate_genome = self
                            .agents
                            .get(&mate_id.unwrap())
                            .map(|m| m.genome.clone())
                            .unwrap_or_else(|| genome_parent.clone());
                        // Phase C: combinatorial recombination operators replace
                        // the single-point crossover when enabled.
                        let crossed = if self.config.recombination.unwrap_or(false) {
                            genome::recombine_genomes(&genome_parent, &mate_genome, &mut child_rng)
                        } else {
                            genome::crossover_genome(&genome_parent, &mate_genome, &mut child_rng)
                        };
                        genome::mutate_genome_scaled(
                            &crossed,
                            &mut child_rng,
                            (0.05 * pheno.mutability).min(1.0),
                            0.05 * pheno.mutability,
                        )
                    } else {
                        genome::mutate_genome_scaled(
                            &genome_parent,
                            &mut child_rng,
                            (0.05 * pheno.mutability).min(1.0),
                            0.05 * pheno.mutability,
                        )
                    };
                    // Lateral gene transfer: occasionally splice a block from a
                    // random neighbor's genome (draw order matches TS so the
                    // childRng stream stays aligned with the reference engine).
                    if nb_count > 0 && child_rng.next_float64() < LGT_RATE * pheno.mutability {
                        let donor_idx = child_rng.next_int(nb_count as u32) as usize;
                        if let Some(donor) = self.agents.get(&(self.neighbors[donor_idx] as u32)) {
                            genome::splice_genome(
                                &mut genome_child,
                                &donor.genome,
                                &mut child_rng,
                                LGT_BLOCK,
                            );
                        }
                    }

                    // Phase D stochastic dynamics: error-prone replication —
                    // mutation bursts fire extra mutate passes on division. The
                    // draws come from the same childRng stream so the TS
                    // reference engine stays bit-aligned on the whole stream.
                    if self.config.stochastic_dynamics.unwrap_or(false) {
                        division_count += 1;
                        if child_rng.next_float64() < STOCH_BURST_RATE {
                            let bursts = 1 + child_rng.next_int(STOCH_BURST_MAX);
                            for _ in 0..bursts {
                                genome_child = genome::mutate_genome_scaled(
                                    &genome_child,
                                    &mut child_rng,
                                    (0.05 * pheno.mutability).min(1.0),
                                    0.05 * pheno.mutability,
                                );
                            }
                            burst_events += 1;
                        }
                    }

                    let child_energy = cap.min(1.0_f64.max(if mate_id.is_some() {
                        (pre + b_pre) * CHILD_ENERGY_FRACTION * 0.5 * invest_mult
                    } else {
                        pre * CHILD_ENERGY_FRACTION * invest_mult
                    }));
                    let child_x = wrap(a.x + child_rng.next_signed64() * 3.0);
                    let child_y = wrap(a.y + child_rng.next_signed64() * 3.0);
                    let innovation = child_rng.next_gaussian64() * MEME_INNOVATION;
                    let child_meme = if culture_on {
                        clamp(a.meme + innovation, 0.0, 1.0)
                    } else {
                        0.0
                    };
                    let child = self.create_agent_with_brain(
                        child_id,
                        aid as i32,
                        &genome_child,
                        child_x,
                        child_y,
                        child_energy,
                        (pre_w * CHILD_WATER_FRACTION).max(0.0).min(cap),
                        t,
                        child_meme,
                        Some(&a.brain),
                    );
                    a.reproductions += 1;
                    if let Some(mid) = mate_id {
                        if let Some(mate) = self.agents.get_mut(&mid) {
                            mate.reproductions += 1;
                        }
                    }
                    if record_delta {
                        delta_count += 1;
                        pack_agent_write(
                            &mut delta_w,
                            prev_id,
                            child_id,
                            child.x,
                            child.y,
                            child.energy,
                            cap,
                            STATE_BORN,
                            child.species,
                            child.meme,
                        );
                    }
                    prev_id = child_id;
                    self.push_event(
                        "birth",
                        0.15,
                        EventData {
                            agent_id: Some(child_id),
                            parent_id: Some(aid as i32),
                            mate_id,
                            species: Some(child.species),
                            x: Some(child.x),
                            y: Some(child.y),
                            energy: Some(child.energy),
                            ..Default::default()
                        },
                    );
                    self.born_queue.push(child.clone());
                    self.agents.insert(child_id, child);
                    births += 1;
                }
            }

            // Post-action death check
            if a.energy <= 0.0
                || a.water <= 0.0
                || a.age > self.params.agent_max_age * a.phenotype.longevity
            {
                let cause = if a.water <= 0.0 {
                    DeathCause::Thirst
                } else if a.energy <= 0.0 {
                    if a.last_hunted_tick == t as i32 {
                        DeathCause::Predation
                    } else {
                        DeathCause::Starvation
                    }
                } else {
                    DeathCause::Age
                };
                match cause {
                    DeathCause::Starvation => d_starv += 1,
                    DeathCause::Thirst => d_thirst += 1,
                    DeathCause::Predation => d_pred += 1,
                    _ => {}
                }
                self.detach_kill(&mut a, t, cause);
                deaths += 1;
                if record_delta {
                    delta_count += 1;
                    pack_agent_write(
                        &mut delta_w,
                        prev_id,
                        aid,
                        a.x,
                        a.y,
                        0.0,
                        cap,
                        STATE_DEAD,
                        a.species,
                        a.meme,
                    );
                }
                prev_id = aid;
                self.agents.insert(a.id, a);
                continue;
            }

            // Plastic brain learning: reward = net energy change over the tick
            // (feeding + metabolism + predation + reproduction), scaled down.
            if self.brain_cfg.enabled {
                let reward = ((a.energy - energy_before) / cap / ts).clamp(-0.05, 0.05);
                let surprise = match self.brain_cfg.learn {
                    brain::LearnRule::Backprop => {
                        let dropout = self.brain_cfg.dropout;
                        let grad_noise = self.brain_cfg.grad_noise;
                        let entropy = self.brain_cfg.entropy;
                        if dropout > 0.0 || grad_noise > 0.0 {
                            // SGD regularization: dropout masks + gradient noise
                            // re-drawn per (agent, tick) from the same stream
                            // seed as all other agent streams.
                            let mut rng_l = SplitMix64::new(stream_seed(
                                &self.config.seed,
                                t.wrapping_mul(11).wrapping_add(1),
                                a.id,
                            ) as u64);
                            if dropout > 0.0 {
                                for j in 0..MLP_HIDDEN {
                                    self.drop_mask[j] = if rng_l.next_float64() < dropout {
                                        0.0
                                    } else {
                                        1.0
                                    };
                                }
                            }
                            if grad_noise > 0.0 {
                                for k in 0..self.grad_noise_vec.len() {
                                    self.grad_noise_vec[k] = rng_l.next_gaussian64() as f32;
                                }
                            }
                            let opts = brain::BackpropOpts {
                                dropout,
                                drop_mask: if dropout > 0.0 {
                                    Some(&self.drop_mask)
                                } else {
                                    None
                                },
                                grad_noise,
                                grad_noise_vec: if grad_noise > 0.0 {
                                    Some(&self.grad_noise_vec)
                                } else {
                                    None
                                },
                                entropy,
                            };
                            brain::backprop_brain(
                                &mut a.brain,
                                reward,
                                v_cur,
                                &self.hidden,
                                &self.out,
                                &self.sensors,
                                &opts,
                            )
                        } else {
                            let opts = brain::BackpropOpts {
                                dropout: 0.0,
                                drop_mask: None,
                                grad_noise: 0.0,
                                grad_noise_vec: None,
                                entropy,
                            };
                            brain::backprop_brain(
                                &mut a.brain,
                                reward,
                                v_cur,
                                &self.hidden,
                                &self.out,
                                &self.sensors,
                                &opts,
                            )
                        }
                    }
                    brain::LearnRule::Hebbian => {
                        brain::observe(&mut a.brain, reward, v_cur, &self.hidden, &self.out)
                    }
                };
                self.brain_surprise_sum += surprise;
                self.brain_surprise_n += 1;
            }

            energy_sum += a.energy;
            water_sum += a.water;
            centroid_x += a.x;
            centroid_y += a.y;
            if record_delta {
                delta_count += 1;
                pack_agent_write(
                    &mut delta_w,
                    prev_id,
                    a.id,
                    a.x,
                    a.y,
                    a.energy,
                    cap,
                    STATE_ALIVE,
                    a.species,
                    a.meme,
                );
            }
            prev_id = a.id;
            self.agents.insert(a.id, a);
        }

        delta_w.patch_u16(count_offset, delta_count as u16);

        // 5. Regenerate + decay
        self.regenerate(ts, daylight, season_moisture);
        self.diffuse_signal(ts);

        // 5b. Chemical terrain
        let food_clone = self.grid.food.clone();
        let meat_clone = self.grid.meat.clone();
        chemistry::tick_chem_terrain(
            &mut self.chem_terrain,
            &food_clone,
            &meat_clone,
            daylight,
            season_moisture,
            ts,
        );

        // Phase M biome regime: explicit presets re-inject their profile bases
        // into the chemical terrain each tick so extreme / underrated worlds
        // keep their environmental identity (an anoxic trench stays anoxic).
        // Absent preset = purely legacy dynamics.
        if self.config.environment.is_some() {
            let reinject = ENV_REINJECT_RATE as f64 * ts;
            let p = self.env_profile;
            for i in 0..self.chem_terrain.size * self.chem_terrain.size {
                self.chem_terrain.o2[i] = (self.chem_terrain.o2[i] as f64
                    + (p.o2 - self.chem_terrain.o2[i] as f64) * reinject)
                    as f32;
                self.chem_terrain.ph[i] = (self.chem_terrain.ph[i] as f64
                    + (p.ph - self.chem_terrain.ph[i] as f64) * reinject)
                    .clamp(3.0, 11.0) as f32;
                self.chem_terrain.toxin[i] = (self.chem_terrain.toxin[i] as f64
                    + (p.toxin - self.chem_terrain.toxin[i] as f64) * reinject)
                    as f32;
                self.chem_terrain.minerals[i] = (self.chem_terrain.minerals[i] as f64
                    + (p.minerals - self.chem_terrain.minerals[i] as f64) * reinject)
                    as f32;
            }
        }

        // Birth bookkeeping
        for child in &self.born_queue {
            self.alive_ids.push(child.id);
            energy_sum += child.energy;
            water_sum += child.water;
            centroid_x += child.x;
            centroid_y += child.y;
        }

        let alive_count_final = self.alive_ids.len() as u32;
        let species_count = self.count_species();
        let avg_energy = if alive_count_final > 0 {
            energy_sum / alive_count_final as f64
        } else {
            0.0
        };
        let avg_water = if alive_count_final > 0 {
            water_sum / alive_count_final as f64
        } else {
            0.0
        };
        let cx_avg = if alive_count_final > 0 {
            centroid_x / alive_count_final as f64
        } else {
            0.0
        };
        let cy_avg = if alive_count_final > 0 {
            centroid_y / alive_count_final as f64
        } else {
            0.0
        };

        self.detect_events(
            alive_count_final,
            species_count,
            cx_avg,
            cy_avg,
            d_starv,
            d_thirst,
            d_pred,
        );
        self.prev_alive = alive_count_final;
        self.prev_species = species_count;
        self.prev_centroid_x = cx_avg;
        self.prev_centroid_y = cy_avg;
        self.last_births = births;
        self.last_deaths = deaths;
        self.last_escape_deaths = d_escape;

        // Selection pressure
        self.selection_state.pressure = selection::compute_selection_pressure(
            alive_count_final,
            self.params.max_population as u32,
            d_pred as f64 / (alive_count_final as f64).max(1.0),
            if alive_count_final > 0 {
                energy_sum / alive_count_final as f64 / cap
            } else {
                0.0
            },
            self.params.agent_max_age,
            births as f64 / (alive_count_final as f64).max(1.0),
        );

        let state_hash = selection::compute_state_hash(&self.alive_ids, &self.agents, t);

        let (mean_plasticity, mean_surprise, plastic_agents) = self.brain_stats();

        let m = self.population_metrics();

        // Biophysics telemetry (opt-in via WorldConfig.biophysics)
        let (
            mean_force,
            cluster_count,
            cluster_order,
            rotational_order,
            spatial_entropy,
            dimensional_entropy,
            org_index,
            symmetry_drift,
            cascade_rate,
            bond_energy,
            reaction_enthalpy,
            entropy_production,
            carnot_efficiency,
            heat_waste,
            engine_power,
            radiation_field,
            thermal_balance,
            mass_conservation,
        ) = if self.config.biophysics.unwrap_or(false) {
            let pts = biophysics::build_points(&self.agents, &self.alive_ids);
            let field = biophysics::compute_field(&pts);
            self.bio_forces = pts
                .iter()
                .zip(field.fx.iter().zip(field.fy.iter()))
                .map(|(p, (&fxx, &fyy))| (p.id, (fxx, fyy)))
                .collect();
            let field_agg = field.agg;
            let n_alive = alive_count_final.max(1) as f64;
            let mut th_cascade = 0.0f64;
            let mut th_bond = 0.0f64;
            let mut th_enthalpy = 0.0f64;
            let mut th_entropy = 0.0f64;
            let mut th_carnot = 0.0f64;
            let mut th_heat = 0.0f64;
            let mut th_power = 0.0f64;
            let mut th_rad = 0.0f64;
            let mut th_bal = 0.0f64;
            let mut mass_sum = 0.0f64;
            for &id in &self.alive_ids {
                if let Some(a) = self.agents.get(&id) {
                    if !a.alive {
                        continue;
                    }
                    let th = biophysics::agent_thermo(a, ts, cap, 0.3);
                    th_cascade += th.cascade_rate;
                    th_bond += th.bond_energy;
                    th_enthalpy += th.reaction_enthalpy;
                    th_entropy += th.entropy_production;
                    th_carnot += th.carnot_efficiency;
                    th_heat += th.heat_waste;
                    th_power += th.engine_power;
                    th_rad += th.radiation_field;
                    th_bal += th.thermal_balance;
                    mass_sum += a.energy * 100.0;
                    for &el in &a.chemistry.elements {
                        mass_sum += el as f64;
                    }
                    for &mo in &a.chemistry.molecules {
                        mass_sum += mo as f64 * 0.5;
                    }
                }
            }
            let mass_conservation = if self.prev_mass_proxy > 0.0 {
                ((mass_sum - self.prev_mass_proxy).abs() / self.prev_mass_proxy).min(1.0)
            } else {
                0.0
            };
            self.prev_mass_proxy = mass_sum;
            (
                field_agg.mean_force as f32,
                field_agg.cluster_count as f32,
                field_agg.cluster_order as f32,
                field_agg.rotational_order as f32,
                field_agg.spatial_entropy as f32,
                field_agg.dimensional_entropy as f32,
                field_agg.org_index as f32,
                field_agg.symmetry_drift as f32,
                (th_cascade / n_alive) as f32,
                (th_bond / n_alive) as f32,
                (th_enthalpy / n_alive) as f32,
                (th_entropy / n_alive) as f32,
                (th_carnot / n_alive) as f32,
                (th_heat / n_alive) as f32,
                (th_power / n_alive) as f32,
                (th_rad / n_alive) as f32,
                (th_bal / n_alive) as f32,
                mass_conservation as f32,
            )
        } else {
            (
                0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0,
                0.0, 0.0,
            )
        };

        // Omics telemetry (opt-in via WorldConfig.omics)
        let omics_agg = if self.config.omics.unwrap_or(false) {
            omics_totals.mean(alive_count_final.max(1) as f64)
        } else {
            omics::OmicsAgg::default()
        };

        let stats = SimStats {
            tick: t,
            population: self.agents.len() as u32,
            alive_count: alive_count_final,
            dead_count: deaths,
            species_count,
            avg_energy: avg_energy as f32,
            avg_water: avg_water as f32,
            tick_rate: 0.0,
            state_hash,
            time_scale: ts as f32,
            energy_sum: energy_sum as f32,
            births,
            deaths,
            escape_deaths: d_escape,
            entropy: m.entropy,
            diversity: m.diversity,
            complexity: m.complexity,
            cooperation: if energy_sum > 0.0 {
                (self.last_donation / energy_sum) as f32
            } else {
                0.0
            },
            predator_fraction: m.predator_fraction,
            culture_count: m.culture_count,
            mean_altruism: m.mean_altruism,
            meme_entropy: m.meme_entropy,
            species_meme_mi: m.species_meme_mi,
            mean_aggression: m.mean_aggression,
            mean_cooperation: m.mean_cooperation,
            mean_risk: m.mean_risk,
            mean_deception: m.mean_deception,
            predator_gene_fraction: m.predator_gene_fraction,
            prey_gene_fraction: m.prey_gene_fraction,
            energy_inequality: m.energy_inequality,
            donation_ratio: m.donation_ratio,
            lyapunov_exponent: self.lyapunov_exponent,
            selection_entropy: 0.0,
            fixation_index: 0.0,
            price_equation_selection: 0.0,
            food_grad_mag_mean: 0.0,
            food_lap_mean: 0.0,
            velocity_div_mean: 0.0,
            velocity_curl_mag_mean: 0.0,
            ca_alive_fraction: 0.0,
            ca_complexity: 0.0,
            trait_total_variance: 0.0,
            trait_effective_dim: 0.0,
            trait_anisotropy: 0.0,
            mean_atp: 0.0,
            mean_enzyme: 0.0,
            mean_toxin: 0.0,
            mean_ph: 0.0,
            chemical_diversity: 0.0,
            mean_glucose: 0.0,
            mean_protein: 0.0,
            active_synthesis_fraction: 0.0,
            terrain_oxygen: 0.0,
            terrain_ph: 0.0,
            terrain_toxin: 0.0,
            mean_dna_integrity: 0.0,
            mean_pathogen_load: 0.0,
            mean_membrane_pot: -70.0,
            mean_body_temp: 37.0,
            mean_trophic_level: 0.0,
            speciation_rate: self.selection_state.speciation_events as f32,
            extinction_rate: self.selection_state.extinction_events as f32,
            biodiversity_index: 0.0,
            mean_fitness: 0.0,
            mean_division_progress: 0.0,
            mean_plasticity,
            mean_surprise,
            plastic_agents,
            mean_force,
            cluster_count,
            cluster_order,
            rotational_order,
            spatial_entropy,
            dimensional_entropy,
            org_index,
            mass_conservation,
            symmetry_drift,
            cascade_rate,
            bond_energy,
            reaction_enthalpy,
            entropy_production,
            carnot_efficiency,
            heat_waste,
            engine_power,
            radiation_field,
            thermal_balance,
            expression_entropy: omics_agg.expression_entropy as f32,
            transcript_activity: omics_agg.transcript_activity as f32,
            protein_diversity: omics_agg.protein_diversity as f32,
            proteome_load: omics_agg.proteome_load as f32,
            pathway_flux: omics_agg.pathway_flux as f32,
            flux_diversity: omics_agg.flux_diversity as f32,
            regulation_gating: omics_agg.regulation_gating as f32,
            ec_coupling: omics_agg.ec_coupling as f32,
            native_fraction: omics_agg.native_fraction as f32,
            misfold_load: omics_agg.misfold_load as f32,
            fold_stability: omics_agg.fold_stability as f32,
            tf_regulation: omics_agg.tf_regulation as f32,
            env_recognition: omics_agg.env_recognition as f32,
            expression_noise: omics_agg.expression_noise as f32,
            library_diversity: omics_agg.library_diversity as f32,
            discovery_rate: (discovery_totals.discoveries as f32) / alive_count_final.max(1) as f32,
            novelty_mean: (discovery_totals.novelty_sum / alive_count_final.max(1) as f64) as f32,
            memory_diversity: (discovery_totals.memory_diversity_sum
                / alive_count_final.max(1) as f64) as f32,
            exploration_fraction: (discovery_totals.exploring as f32)
                / alive_count_final.max(1) as f32,
            behavior_noise: (behavior_noise_sum / alive_count_final.max(1) as f64) as f32,
            mutation_burst_rate: if division_count > 0 {
                burst_events as f32 / division_count as f32
            } else {
                0.0
            },
            chaperone_load: omics_agg.chaperone_load as f32,
            aggregate_load: omics_agg.aggregate_load as f32,
            fold_fidelity: omics_agg.fold_fidelity as f32,
            proteotoxicity: omics_agg.proteotoxicity as f32,
            library_coverage: omics_agg.library_coverage as f32,
            binding_specificity: omics_agg.binding_specificity as f32,
            combinatorial_entropy: omics_agg.combinatorial_entropy as f32,
        };

        TickResult {
            tick: t,
            delta: delta_w.into_vec(),
            delta_count,
            stats,
            // take, don't clone: the returned events are handed to the caller
            // (recorder/sink) and the engine starts the next tick with an empty
            // buffer. Also means events pushed between ticks (e.g. by an
            // intervention applied while paused) are delivered with the next
            // tick instead of being cleared away.
            events: std::mem::take(&mut self.events),
        }
    }

    /// Apply a god-mode intervention. Ported from the TS engine so local and
    /// remote worlds behave identically.
    pub fn apply_intervention(&mut self, iv: &Intervention) {
        let t = self.tick_num;
        let cap = self.params.energy_capacity;
        match &iv.itype {
            InterventionType::Meteor => {
                let r = iv.radius.unwrap_or(64.0);
                let r2 = r as f64 * r as f64;
                let (cx, cy) = (iv.x.unwrap_or(0.0), iv.y.unwrap_or(0.0));
                let ids: Vec<u32> = self
                    .agents
                    .values()
                    .filter(|a| a.alive && (a.x - cx).powi(2) + (a.y - cy).powi(2) < r2)
                    .map(|a| a.id)
                    .collect();
                for id in ids {
                    if let Some(a) = self.agents.get_mut(&id) {
                        a.energy = 0.0;
                    }
                }
            }
            InterventionType::Nuke => {
                let ids: Vec<u32> = self
                    .agents
                    .values()
                    .filter(|a| a.alive)
                    .map(|a| a.id)
                    .collect();
                for id in ids {
                    if let Some(a) = self.agents.get_mut(&id) {
                        a.energy = 0.0;
                    }
                }
            }
            InterventionType::SeedFood => {
                let r = iv.radius.unwrap_or(96.0);
                let r2 = r as f64 * r as f64;
                let amount = iv.amount.unwrap_or(50.0);
                let (cx, cy) = (iv.x.unwrap_or(0.0), iv.y.unwrap_or(0.0));
                let size = self.grid.size;
                let cell = self.grid.cell;
                for gy in 0..size {
                    for gx in 0..size {
                        let wx = (gx as f64 + 0.5) * cell as f64;
                        let wy = (gy as f64 + 0.5) * cell as f64;
                        let dx = wx - cx;
                        let dy = wy - cy;
                        if dx * dx + dy * dy < r2 {
                            let idx = gy * size + gx;
                            self.grid.food[idx] = ((self.grid.food[idx] as f64 + amount as f64)
                                .min(self.grid.cap[idx] as f64))
                                as f32;
                        }
                    }
                }
            }
            InterventionType::SpawnAgent => {
                if self.alive_count() >= (self.params.max_population as u32).min(MAX_AGENTS as u32)
                {
                    return;
                }
                let mut rng =
                    SplitMix64::new(stream_seed(&self.config.seed, t, self.next_id) as u64);
                let genome: Vec<f32> = match &iv.genome {
                    Some(g) if g.len() == GENOME_SIZE => g.clone(),
                    Some(g) if g.len() < GENOME_SIZE => {
                        // partial genome: random base, patch in the given genes
                        let mut gg = genome::random_genome(&mut rng);
                        gg[..g.len()].copy_from_slice(g);
                        gg
                    }
                    _ => genome::random_genome(&mut rng),
                };
                let id = self.next_id;
                self.next_id += 1;
                let world = WORLD_SIZE_USIZE as f64;
                let agent = self.create_agent(
                    id,
                    -1,
                    &genome,
                    iv.x.unwrap_or(world / 2.0),
                    iv.y.unwrap_or(world / 2.0),
                    cap * 0.6,
                    cap * 0.6,
                    t,
                    rng.next_float64(),
                );
                self.agents.insert(id, agent);
            }
            InterventionType::PauseRegion => {
                let r = iv.radius.unwrap_or(64.0);
                let r2 = r as f64 * r as f64;
                let ticks = iv.ticks.unwrap_or(60);
                let (cx, cy) = (iv.x.unwrap_or(0.0), iv.y.unwrap_or(0.0));
                for a in self.agents.values_mut() {
                    if !a.alive {
                        continue;
                    }
                    let dx = a.x - cx;
                    let dy = a.y - cy;
                    if dx * dx + dy * dy < r2 {
                        a.paused_ticks = a.paused_ticks.max(ticks);
                    }
                }
            }
            InterventionType::SetTimeScale => {
                if let Some(ts) = iv.time_scale {
                    self.params.time_scale = ts;
                }
            }
            InterventionType::SetGene => {
                // Genome-template rewrite: heredity (offspring) + inspection.
                // The live agent's decoded traits / learned brain are untouched —
                // deterministic and parity-safe on both engine backends.
                if let (Some(id), Some(idx), Some(val)) = (iv.agent_id, iv.index, iv.value) {
                    if let Some(a) = self.agents.get_mut(&id) {
                        if a.alive && (idx as usize) < a.genome.len() {
                            a.genome[idx as usize] = val.clamp(-1.0, 1.0);
                        }
                    }
                }
            }
        }
        // Agents with clamped energy die on the next tick's death pass just like
        // natural deaths — no need to force-remove here.
        let significance = match &iv.itype {
            InterventionType::Meteor => 1.0,
            InterventionType::Nuke => 1.0,
            InterventionType::SeedFood => 0.5,
            InterventionType::SpawnAgent => 0.4,
            InterventionType::PauseRegion => 0.3,
            InterventionType::SetTimeScale => 0.2,
            InterventionType::SetGene => 0.15,
        };
        self.push_event(
            "intervention",
            significance,
            EventData {
                itype: Some(iv.itype.as_name()),
                x: iv.x,
                y: iv.y,
                agent_id: iv.agent_id,
                ..Default::default()
            },
        );
        self.intervention_log.push((t, iv.clone()));
    }

    #[allow(dead_code)]
    fn kill_agent(&mut self, id: u32, t: u32) {
        let a = self.agents.get_mut(&id).unwrap();
        a.alive = false;
        a.died_at_tick = t;
        a.final_fitness = a.energy_acquired
            + a.kills as f64 * 60.0
            + a.reproductions as f64 * 50.0
            + a.altruism * 0.5
            + a.age;
        let idx = grid_idx(&self.grid, a.x, a.y);
        let meat_cap = self.grid.cap[idx].max(0.5);
        self.grid.meat[idx] =
            ((self.grid.meat[idx] as f64 + a.energy * 0.4).min(meat_cap as f64)) as f32;
        self.dead_agents.push(id);
        self.tick_deaths += 1;
        while self.dead_agents.len() - self.tick_deaths as usize > DEAD_RETENTION {
            if let Some(evicted) = self.dead_agents.first().copied() {
                self.dead_agents.remove(0);
                self.agents.remove(&evicted);
            } else {
                break;
            }
        }
    }

    /// Emit an event into the current tick's buffer (policy-filtered).
    /// `etype` is the wire name matching the TS `EventType` union.
    fn push_event(&mut self, etype: &str, significance: f32, data: EventData) {
        if let Some(include) = &self.event_policy {
            if !include.iter().any(|t| t == etype) {
                return;
            }
        }
        self.events.push(SimEvent {
            world_id: self.config.id.clone(),
            tick: self.tick_num,
            etype: etype.to_string(),
            significance,
            data,
        });
    }

    /// Restrict event emission to the given types (None = all types). This is
    /// emission-side control only — emitted events are never sampled later.
    pub fn set_event_policy(&mut self, include: Option<Vec<String>>) {
        self.event_policy = include;
    }

    fn detach_kill(&mut self, a: &mut SimAgent, t: u32, cause: DeathCause) {
        a.alive = false;
        a.died_at_tick = t;
        a.final_fitness = a.energy_acquired
            + a.kills as f64 * 60.0
            + a.reproductions as f64 * 50.0
            + a.altruism * 0.5
            + a.age;
        let idx = grid_idx(&self.grid, a.x, a.y);
        let meat_cap = self.grid.cap[idx].max(0.5);
        self.grid.meat[idx] =
            ((self.grid.meat[idx] as f64 + a.energy * 0.4).min(meat_cap as f64)) as f32;
        self.dead_agents.push(a.id);
        self.tick_deaths += 1;
        while self.dead_agents.len() - self.tick_deaths as usize > DEAD_RETENTION {
            if let Some(evicted) = self.dead_agents.first().copied() {
                self.dead_agents.remove(0);
                self.agents.remove(&evicted);
            } else {
                break;
            }
        }
        self.push_event(
            "death",
            death_significance(cause),
            EventData {
                agent_id: Some(a.id),
                cause: Some(cause),
                species: Some(a.species),
                x: Some(a.x),
                y: Some(a.y),
                age: Some(a.age),
                energy: Some(a.energy),
                killer_id: if cause == DeathCause::Predation && a.last_hunted_by >= 0 {
                    Some(a.last_hunted_by)
                } else {
                    None
                },
                ..Default::default()
            },
        );
    }

    fn regenerate(&mut self, ts: f64, daylight: f64, season_moisture: f64) {
        let wst_enabled = match &self.world_stoch_cfg {
            Some(c) => c.enabled,
            None => false,
        };
        let growth_mul = match &self.world_stoch_state {
            Some(s) if wst_enabled => s.weather_growth,
            _ => 1.0,
        };
        let ou_mul: Option<&Vec<f32>> = if wst_enabled {
            self.world_stoch_state.as_ref().map(|s| &s.ou_mul)
        } else {
            None
        };
        let burst_flags: Option<&Vec<u8>> = if wst_enabled {
            self.world_stoch_state.as_ref().map(|s| &s.burst_flags)
        } else {
            None
        };
        // energy budget (insolation normalised to Earth) gates plant regrowth;
        // mass-recycling rate (gravity) gates how fast carrion returns to soil
        let energy_budget_ratio = self.world_physics.conservation_laws.energy_budget_ratio;
        let mass_recycling_rate = self.world_physics.conservation_laws.mass_recycling_rate;
        let rate = self.params.food_regen_rate
            * ts
            * (0.2 + 0.8 * daylight)
            * (0.4 + 0.6 * season_moisture)
            * growth_mul
            * energy_budget_ratio;
        let decay = MEAT_DECAY * ts * mass_recycling_rate;
        let n = self.grid.size * self.grid.size;
        for i in 0..n {
            let cell_cap = self.grid.cap[i] as f64;
            let meat = self.grid.meat[i] as f64;
            let decayed = meat * decay;
            if decayed > 0.0 {
                self.grid.meat[i] = (meat - decayed).max(0.0) as f32;
                self.grid.minerals[i] =
                    (self.grid.minerals[i] as f64 + decayed * DECOMP_FRACTION).min(cell_cap) as f32;
            }
            let food = self.grid.food[i] as f64;
            if food < cell_cap {
                let nutrient_frac = if cell_cap > 0.0 {
                    (self.grid.minerals[i] as f64 / cell_cap.max(0.001)).min(1.0)
                } else {
                    0.0
                };
                let cell_mul = match ou_mul {
                    Some(m) => m[i] as f64,
                    None => 1.0,
                };
                let mut grown =
                    (cell_cap - food).min(cell_cap * rate * (0.5 + 0.5 * nutrient_frac) * cell_mul);
                if let Some(flags) = burst_flags {
                    if flags[i] == 1 {
                        grown = (cell_cap - food).min(grown + cell_cap * BURST_REGEN_BOOST);
                    }
                }
                if grown > 0.0 {
                    self.grid.food[i] = (food + grown) as f32;
                    self.grid.minerals[i] =
                        (self.grid.minerals[i] as f64 - grown * PLANT_NUTRIENT_USE).max(0.0) as f32;
                }
            }
            let target = self.grid.base_minerals[i] as f64 * cell_cap * 0.25;
            self.grid.minerals[i] = (self.grid.minerals[i] as f64
                + (target - self.grid.minerals[i] as f64) * MINERAL_WEATHERING * ts)
                as f32;
        }
    }

    fn diffuse_signal(&mut self, ts: f64) {
        let sig = &self.grid.signal;
        let size = self.grid.size;
        let d = SIGNAL_DIFFUSE;
        let keep = 1.0 - 4.0 * d;
        let decay = SIGNAL_DECAY.powf(ts);
        let last_row = (size - 1) * size;
        for y in 0..size {
            let row = y * size;
            let up = if y > 0 { row - size } else { last_row };
            let dn = if y < size - 1 { row + size } else { 0 };
            for x in 0..size {
                let i = row + x;
                let l = if x > 0 { i - 1 } else { row + size - 1 };
                let r = if x < size - 1 { i + 1 } else { row };
                self.signal_next[i] = ((sig[i] as f64 * keep
                    + d * (sig[l] as f64
                        + sig[r] as f64
                        + sig[up + x] as f64
                        + sig[dn + x] as f64))
                    * decay) as f32;
            }
        }
        std::mem::swap(&mut self.grid.signal, &mut self.signal_next);
    }

    fn detect_events(
        &mut self,
        alive_count: u32,
        species_count: u32,
        cx: f64,
        cy: f64,
        d_starv: u32,
        d_thirst: u32,
        d_pred: u32,
    ) {
        let prev = self.prev_alive;
        if prev > 20 && (alive_count as f64) < prev as f64 * 0.5 && alive_count > 0 {
            self.push_event(
                "extinction",
                1.0 - alive_count as f32 / prev as f32,
                EventData {
                    from: Some(prev as f64),
                    to: Some(alive_count as f64),
                    ..Default::default()
                },
            );
        }
        if self.prev_species > 0
            && species_count > (self.prev_species as f32 * 1.3) as u32
            && species_count.wrapping_sub(self.prev_species) >= 3
        {
            self.push_event(
                "cambrian",
                (species_count - self.prev_species) as f32 / species_count as f32,
                EventData {
                    from: Some(self.prev_species as f64),
                    to: Some(species_count as f64),
                    ..Default::default()
                },
            );
        }
        let moved = (cx - self.prev_centroid_x).hypot(cy - self.prev_centroid_y);
        if moved > WORLD_SIZE_USIZE as f64 * 0.1 {
            self.push_event(
                "migration",
                (moved / (WORLD_SIZE_USIZE as f64 * 0.4)).min(1.0) as f32,
                EventData {
                    distance: Some(moved),
                    ..Default::default()
                },
            );
        }
        // symbiosis: two large coexisting species (mirrors TS detectEvents)
        if alive_count > 50 {
            let mut counts: HashMap<u32, u32> = HashMap::new();
            for a in self.agents.values() {
                if a.alive {
                    *counts.entry(a.species).or_insert(0) += 1;
                }
            }
            let mut sizes: Vec<u32> = counts.values().copied().collect();
            sizes.sort_unstable_by(|p, q| q.cmp(p));
            if sizes.len() >= 2 {
                let top = sizes[0] as f64 / alive_count as f64;
                let second = sizes[1] as f64 / alive_count as f64;
                if top >= 0.2 && second >= 0.2 {
                    let n_species = counts.len() as u32;
                    self.push_event(
                        "symbiosis",
                        top.min(second) as f32,
                        EventData {
                            top1: Some(top),
                            top2: Some(second),
                            species: Some(n_species),
                            ..Default::default()
                        },
                    );
                }
            }
        }
        // famine / drought / war: mass-death detectors (mirrors TS detectEvents)
        if prev > 20 {
            let p = prev as f64;
            if (d_starv as f64) > p * 0.15 {
                self.push_event(
                    "famine",
                    (d_starv as f64 / p).min(1.0) as f32,
                    EventData {
                        deaths: Some(d_starv as f64),
                        ..Default::default()
                    },
                );
            }
            if (d_thirst as f64) > p * 0.15 {
                self.push_event(
                    "drought",
                    (d_thirst as f64 / p).min(1.0) as f32,
                    EventData {
                        deaths: Some(d_thirst as f64),
                        ..Default::default()
                    },
                );
            }
            if (d_pred as f64) > p * 0.15 {
                self.push_event(
                    "war",
                    (d_pred as f64 / p).min(1.0) as f32,
                    EventData {
                        deaths: Some(d_pred as f64),
                        ..Default::default()
                    },
                );
            }
        }
    }

    pub fn all_agent_states(&self) -> Vec<AgentState> {
        let cap = self.params.energy_capacity;
        let mut ids: Vec<u32> = self.agents.keys().copied().collect();
        ids.sort_unstable();
        ids.iter()
            .filter_map(|&id| {
                let a = self.agents.get(&id)?;
                if !a.alive {
                    return None;
                }
                Some(AgentState {
                    id: a.id,
                    x: a.x,
                    y: a.y,
                    energy: ((a.energy / cap).max(0.0).min(1.0)) as f32,
                    state: STATE_ALIVE,
                    species: a.species,
                    meme: a.meme as f32,
                })
            })
            .collect()
    }

    pub fn world_status(&self, paused: bool) -> WorldStatus {
        let alive_count = self.alive_ids.len() as u32;
        let species_count = self.count_species();
        WorldStatus {
            id: self.config.id.clone(),
            seed: self.config.seed.clone(),
            fractal_type: self.config.fractal_type,
            params: self.params.clone(),
            current_tick: self.tick_num,
            population: self.agents.len() as u32,
            alive_count,
            species_count,
            created_at: self.config.created_at,
            interventions: self.intervention_log.len(),
            paused,
        }
    }

    pub fn build_lineage(&self) -> Vec<LineageNode> {
        self.agents
            .values()
            .map(|a| LineageNode {
                id: a.id,
                parent_id: a.parent_id,
                born_at_tick: a.born_at_tick,
                died_at_tick: a.died_at_tick,
                species: a.species,
                final_fitness: a.final_fitness as f32,
                alive: a.alive,
            })
            .collect()
    }

    pub fn set_map_size(&self) -> usize {
        self.grid.size
    }

    pub fn set_map_depth(&self) -> &[u8] {
        &self.set_map_depth
    }

    pub fn set_map_escape(&self) -> &[u8] {
        &self.set_map_escape
    }
}

fn pack_agent_write(
    w: &mut ByteWriter,
    prev_id: u32,
    id: u32,
    x: f64,
    y: f64,
    energy: f64,
    cap: f64,
    state: u8,
    species: u32,
    meme: f64,
) {
    let fp = FIXED_POINT;
    w.varint(id.wrapping_sub(prev_id));
    w.varint((x * fp as f64).round() as u32);
    w.varint((y * fp as f64).round() as u32);
    w.u8(((energy / cap).max(0.0).min(1.0) * 255.0).round() as u8);
    w.u8(state);
    w.u32(species);
    w.u8((meme * 255.0).round().max(0.0).min(255.0) as u8);
}
