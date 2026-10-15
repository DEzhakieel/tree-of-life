use std::collections::HashMap;

#[derive(Clone, Debug, Default)]
pub struct FitnessComponents {
    pub energy_fitness: f64,
    pub survival_fitness: f64,
    pub reproductive_fitness: f64,
    pub social_fitness: f64,
    pub metabolic_fitness: f64,
    pub total: f64,
}

#[derive(Clone)]
pub struct SpeciesRecord {
    pub id: u32,
    pub mean_genome: Vec<f32>,
    pub population: u32,
    pub peak_population: u32,
    pub origin_tick: u32,
    pub mean_fitness: f64,
    pub genetic_diversity: f64,
    pub dominant_trophic_level: u8,
    pub is_declining: bool,
}

#[derive(Clone, Debug, Default)]
pub struct SelectionPressure {
    pub predation_pressure: f64,
    pub competition_pressure: f64,
    pub environmental_stress: f64,
    pub sexual_selection: f64,
    pub frequency_dependence: f64,
}

pub struct SelectionState {
    pub species: HashMap<u32, SpeciesRecord>,
    pub next_species_id: u32,
    pub pressure: SelectionPressure,
    pub speciation_events: u32,
    pub extinction_events: u32,
    pub radiation_events: u32,
    pub last_radiation_check: u32,
    pub last_radiation_tick: u32,
}

pub fn create_selection_state() -> SelectionState {
    SelectionState {
        species: HashMap::new(),
        next_species_id: 1,
        pressure: SelectionPressure::default(),
        speciation_events: 0,
        extinction_events: 0,
        radiation_events: 0,
        last_radiation_check: 0,
        last_radiation_tick: 0,
    }
}

pub fn compute_fitness(
    energy_fitness: f64,
    survival_fitness: f64,
    reproductive_fitness: f64,
    social_fitness: f64,
    metabolic_fitness: f64,
    pressure: &SelectionPressure,
) -> FitnessComponents {
    let energy_weight = 1.0 - pressure.sexual_selection * 0.3;
    let reproductive_weight = 0.3 + pressure.sexual_selection * 0.4;
    let social_weight = 0.1 + pressure.competition_pressure * 0.2;
    let total = energy_fitness * energy_weight * 0.3
        + survival_fitness * 0.25
        + reproductive_fitness * reproductive_weight * 0.25
        + social_fitness * social_weight * 0.1
        + metabolic_fitness * 0.1;
    FitnessComponents {
        energy_fitness,
        survival_fitness,
        reproductive_fitness,
        social_fitness,
        metabolic_fitness,
        total: total.max(0.0).min(1.0),
    }
}

pub fn compute_selection_pressure(
    total_population: u32,
    carrying_capacity: u32,
    predation_rate: f64,
    mean_age: f64,
    max_age: f64,
    reproduction_rate: f64,
) -> SelectionPressure {
    let pop_ratio = total_population as f64 / (carrying_capacity as f64).max(1.0);
    SelectionPressure {
        predation_pressure: (predation_rate * 10.0).min(1.0),
        competition_pressure: ((pop_ratio - 0.5).max(0.0) * 2.0).min(1.0),
        environmental_stress: (1.0 - mean_age / max_age.max(1.0)).min(1.0),
        sexual_selection: (reproduction_rate * 0.5).min(1.0),
        frequency_dependence: (1.0 - pop_ratio).min(1.0),
    }
}

pub fn assign_species(genome: &[f32]) -> u32 {
    let mut h: u32 = 0x811c9dc5;
    let mut acc: u32 = 0;
    let mut bits: u32 = 0;
    let species_genes = 32;
    for i in 0..species_genes {
        let v = genome.get(i).copied().unwrap_or(0.0);
        let level = ((v + 1.0) / 2.0 * 7.0).round() as u32;
        acc = (acc << 3) | (level & 7);
        bits += 3;
        if bits >= 30 {
            h ^= acc;
            h = h.wrapping_mul(0x01000193);
            acc = 0;
            bits = 0;
        }
    }
    h ^= acc;
    h = h.wrapping_mul(0x01000193);
    h
}

pub fn compute_state_hash(
    alive_ids: &[u32],
    agents: &HashMap<u32, crate::agent::SimAgent>,
    tick: u32,
) -> u32 {
    let mut h: u32 = 0x811c9dc5;
    for &id in alive_ids {
        if let Some(a) = agents.get(&id) {
            h ^= (a.id)
                ^ (a.x * 10.0).round() as u32
                ^ (a.y * 10.0).round() as u32
                ^ (a.energy * 100.0).round() as u32
                ^ (a.water * 100.0).round() as u32;
            h ^= (a.vx * 100.0).round() as u32
                ^ (a.vy * 100.0).round() as u32
                ^ (a.meme * 1000.0).round() as u32;
            h ^= (a.z_re * 100.0).round() as u32 ^ (a.z_im * 100.0).round() as u32 ^ a.orbit_depth;
            // plastic brain signature: aggregate learned synapses + critic +
            // recurrent memory so replay of a life with learning is verifiable.
            let mut bw = 0.0f32;
            for &x in &a.brain.w {
                bw += x;
            }
            let mut bh = 0.0f32;
            for &x in &a.brain.h {
                bh += x;
            }
            h ^= (bw * 512.0).round() as u32
                ^ (a.brain.v * 4096.0).round() as u32
                ^ (bh * 4096.0).round() as u32
                ^ (a.brain.last_reward * 16384.0).round() as u32;
            h = h.wrapping_mul(0x01000193);
        }
    }
    h ^= tick;
    h = h.wrapping_mul(0x01000193);
    h
}
