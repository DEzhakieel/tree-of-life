use crate::rng::SplitMix64;
use fractal_life_shared::constants::*;

#[derive(Clone)]
pub struct DnaSystem {
    pub integrity: f64,
    pub damage_accum: f64,
    pub expression: Vec<f32>,
    pub total_errors: u32,
    pub total_repairs: u32,
    pub epigenetic: Vec<f32>,
}

const EXPRESSION_BLOCKS: usize = 24;
const EPIGENETIC_SIZE: usize = 24;

pub fn create_dna_system() -> DnaSystem {
    DnaSystem {
        integrity: 1.0,
        damage_accum: 0.0,
        expression: vec![0.5; EXPRESSION_BLOCKS],
        total_errors: 0,
        total_repairs: 0,
        epigenetic: vec![0.0; EPIGENETIC_SIZE],
    }
}

pub struct DnaResult {
    pub atp_cost: f64,
    pub mutations_occurred: bool,
    pub genome_modified: bool,
}

pub fn tick_dna(
    dna: &mut DnaSystem,
    genes: &crate::genome::DnaGenes,
    dt: f64,
    rng: &mut SplitMix64,
    available_atp: f64,
) -> DnaResult {
    let mut atp_cost = 0.0f64;
    let mut mutations_occurred = false;
    let mut genome_modified = false;
    let mut repaired_this_tick = false;

    // Environmental damage
    let damage_rate = 0.001 * (1.0 - genes.dna_stability * 0.8);
    dna.damage_accum += damage_rate * dt;

    if dna.damage_accum > 0.1 {
        let decay = dna.damage_accum * 0.01 * dt;
        dna.integrity = (dna.integrity - decay).max(0.0);
        dna.damage_accum *= 0.95;
    }

    // Repair
    if dna.damage_accum > 0.01 && available_atp > DNA_REPAIR_COST as f64 {
        let repair_efficiency = genes.repair_rate * genes.repair_accuracy;
        let repaired = dna.damage_accum.min(repair_efficiency * 0.1 * dt);
        dna.damage_accum -= repaired;
        dna.integrity = (dna.integrity + repaired * 0.5).min(1.0);
        atp_cost += DNA_REPAIR_COST as f64 * dt;
        repaired_this_tick = true;
    }

    // Gene expression drift
    let expr_drift = genes.epigenetic_noise * 0.01 * dt;
    for b in 0..EXPRESSION_BLOCKS {
        let base = genes.gene_expression;
        let noise = (rng.next_float64() - 0.5) * 2.0 * expr_drift;
        dna.expression[b] = (dna.expression[b] as f64 + noise + (base - 0.5) * 0.001 * dt)
            .max(0.0)
            .min(1.0) as f32;
    }

    // Epigenetic marks
    for b in 0..EPIGENETIC_SIZE {
        if rng.next_float64() < genes.epigenetic_noise * 0.005 * dt {
            dna.epigenetic[b] = if dna.epigenetic[b] > 0.5 { 0.0 } else { 1.0 };
        }
    }

    // Transposon events
    if rng.next_float64() < genes.transposon_rate * 0.0001 * dt {
        genome_modified = true;
    }

    // Mutation tracking
    let mutation_prob = DNA_BASE_ERROR_RATE as f64
        * (1.0 - genes.replication_fidelity * 0.9)
        * (1.0 - dna.integrity * 0.5);
    if rng.next_float64() < mutation_prob * dt {
        mutations_occurred = true;
        dna.total_errors += 1;
        dna.integrity = (dna.integrity - 0.005).max(0.0);
    }

    if repaired_this_tick {
        dna.total_repairs += 1;
    }

    DnaResult {
        atp_cost,
        mutations_occurred,
        genome_modified,
    }
}
