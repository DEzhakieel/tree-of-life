use crate::brain::BrainState;
use crate::cells::CellState;
use crate::chemistry::AgentChemistry;
use crate::dna::DnaSystem;
use crate::genome::{
    EcosystemGenes, ImmuneGenes, MetabGenes, PatternDrives, Phenotype, PredPreyGenes, ReproGenes,
    StrategyGenes,
};
use crate::omics::AgentOmics;
use crate::selection::FitnessComponents;

#[derive(Clone)]
pub struct ImmuneState {
    pub pathogen_load: f64,
    pub innate: f64,
    pub adaptive: f64,
    pub immune_memory: f64,
    pub inflammation: f64,
    pub autoimmunity: f64,
    pub pathogens_fought: f64,
    pub symbiont_load: f64,
}

#[derive(Clone)]
pub struct PredPreyState {
    pub stealth: f64,
    pub pursuit: f64,
    pub ambush: f64,
    pub pack_bonus: f64,
    pub escape_energy: f64,
    pub warning_calls: u32,
    pub mimicry: f64,
    pub aposematism: f64,
    pub is_hiding: bool,
    pub is_chasing: bool,
    pub ticks_since_hunt: u32,
}

#[derive(Clone)]
pub struct ReproState {
    pub sexual: f64,
    pub mate_selectivity: f64,
    pub parental_investment: f64,
    pub clutch_size: u32,
    pub generation_time: f64,
    pub senescence: f64,
    pub fecundity: f64,
    pub dormancy: f64,
    pub is_dormant: bool,
    pub ticks_since_birth: f64,
    pub is_mature: bool,
    pub mate_found: bool,
}

#[derive(Clone)]
pub struct MetabolismState {
    pub basal_rate: f64,
    pub aerobic_capacity: f64,
    pub anaerobic_capacity: f64,
    pub body_temperature: f64,
    pub fat_storage: f64,
    pub sugar_metab: f64,
    pub protein_metab: f64,
    pub lipid_metab: f64,
    pub metabolic_mode: String,
}

#[derive(Clone)]
pub struct SimAgent {
    pub id: u32,
    pub parent_id: i32,
    pub genome: Vec<f32>,
    pub phenotype: Phenotype,
    pub x: f64,
    pub y: f64,
    pub vx: f64,
    pub vy: f64,
    pub energy: f64,
    pub water: f64,
    pub age: f64,
    pub alive: bool,
    pub species: u32,
    pub born_at_tick: u32,
    pub died_at_tick: u32,
    pub final_fitness: f64,
    pub energy_acquired: f64,
    pub kills: u32,
    pub reproductions: u32,
    pub altruism: f64,
    pub meme: f64,
    pub last_repro_tick: i32,
    pub last_hunted_tick: i32,
    /// id of the agent that landed the hunt blow this tick (-1 = none/warning only)
    pub last_hunted_by: i32,
    pub paused_ticks: u32,
    pub drives: PatternDrives,
    pub strategy: StrategyGenes,
    pub c_re: f64,
    pub c_im: f64,
    pub z_re: f64,
    pub z_im: f64,
    pub orbit_depth: u32,
    pub total_donated: f64,
    pub total_received: f64,
    pub total_hunt_damage: f64,
    pub times_hunted: u32,
    pub chemistry: AgentChemistry,
    pub dna: DnaSystem,
    pub cell: CellState,
    pub immune: ImmuneState,
    pub predprey: PredPreyState,
    pub repro: ReproState,
    pub metabolism: MetabolismState,
    pub trophic_level: u8,
    pub fitness: FitnessComponents,
    pub ecosystem: EcosystemGenes,
    pub immune_genes: ImmuneGenes,
    pub predprey_genes: PredPreyGenes,
    pub repro_genes: ReproGenes,
    pub metab_genes: MetabGenes,
    /// Plastic recurrent neural network — learns within a lifetime and can pass
    /// its learned synapses on to offspring (Lamarckian-Baldwinian heredity).
    pub brain: BrainState,
    /// Optional molecular-omics state (WorldConfig.omics), lazily created on
    /// the first flagged tick like `CellState.bio`.
    pub omics: Option<AgentOmics>,
    /// Optional curiosity / pattern-recognition state (WorldConfig.discovery).
    pub discovery: Option<crate::discovery::DiscoveryState>,
}
