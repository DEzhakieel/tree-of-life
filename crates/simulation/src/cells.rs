use crate::cellbio::CellBioState;
use crate::genome::CellGenes;
use crate::genome::MembraneGenes;
use crate::rng::SplitMix64;
use fractal_life_shared::constants::*;

#[derive(Clone)]
pub struct CellState {
    pub radius: f64,
    pub membrane_potential: f64,
    pub membrane_integrity: f64,
    pub mito_efficiency: f64,
    pub ribosomes: f64,
    pub cytoskeleton: f64,
    pub vesicle_buffer: Vec<f32>,
    pub tension: f64,
    pub cell_cycle: u8,
    pub division_progress: f64,
    pub division_count: u32,
    pub is_dividing: bool,
    pub division_timer: f64,
    /// Optional cell-biochemistry state (only when WorldConfig.cell_bio is on).
    pub bio: Option<CellBioState>,
}

pub fn create_cell_state(cell_genes: &CellGenes) -> CellState {
    CellState {
        radius: 3.0 + cell_genes.cell_size * 5.0,
        membrane_potential: -70.0,
        membrane_integrity: 1.0,
        mito_efficiency: cell_genes.mitochondria_count,
        ribosomes: cell_genes.ribosome_count,
        cytoskeleton: cell_genes.cytoskeleton,
        vesicle_buffer: vec![0.0; MOLECULE_COUNT],
        tension: 0.0,
        cell_cycle: 0,
        division_progress: 0.0,
        division_count: 0,
        is_dividing: false,
        division_timer: 0.0,
        bio: None,
    }
}

pub struct CellResult {
    pub atp_cost: f64,
    pub ready_to_divide: bool,
    pub membrane_damage: f64,
}

pub fn tick_cell(
    cell: &mut CellState,
    cell_genes: &CellGenes,
    mem_genes: &MembraneGenes,
    ions: &[f32],
    dt: f64,
    _rng: &mut SplitMix64,
    energy: f64,
) -> CellResult {
    let mut atp_cost = 0.0f64;
    let mut membrane_damage = 0.0f64;

    // Membrane potential
    let na_k_ratio = if ions[0] > 0.0 {
        ions[1] as f64 / (ions[0] as f64 + 0.001)
    } else {
        1.0
    };
    let pump_cost = mem_genes.pump_density * MEMBRANE_TRANSPORT_COST as f64 * dt;
    atp_cost += pump_cost;
    cell.membrane_potential = -70.0 + (na_k_ratio - 1.0) * 30.0;

    // Membrane tension
    let osmotic_diff = (ions[0] as f64 + ions[1] as f64 - ions[4] as f64).abs();
    cell.tension += osmotic_diff * 0.001 * dt;
    cell.tension *= 0.99;

    // Membrane integrity
    let thickness_bonus = cell_genes.membrane_thickness * 0.3;
    cell.membrane_integrity = (cell.membrane_integrity - cell.tension * 0.01 * dt
        + thickness_bonus * 0.001 * dt)
        .max(0.0)
        .min(1.0);

    if cell.tension > 0.5 {
        membrane_damage = cell.tension * 0.02 * dt;
        cell.membrane_integrity = (cell.membrane_integrity - membrane_damage).max(0.0);
    }

    // Vesicle transport
    let transport_rate = cell_genes.vesicle_traffic * 0.01 * dt;
    atp_cost += transport_rate * MEMBRANE_TRANSPORT_COST as f64;

    // Cytoskeleton
    atp_cost += cell_genes.cytoskeleton * 0.001 * dt;

    // Cell cycle
    let mut ready_to_divide = false;
    if !cell.is_dividing {
        let cycle_rate = cell_genes.cell_size * 0.0005 * dt;
        cell.division_progress += cycle_rate * energy * 0.1;
        if cell.division_progress >= 1.0 && energy > CELL_DIVISION_THRESHOLD as f64 {
            cell.is_dividing = true;
            cell.division_timer = 60.0;
            cell.division_progress = 0.0;
        }
    } else {
        cell.division_timer -= dt;
        if cell.division_timer <= 0.0 {
            cell.is_dividing = false;
            cell.division_count += 1;
            cell.radius = 3.0 + cell_genes.cell_size * 5.0;
            ready_to_divide = true;
        }
    }

    CellResult {
        atp_cost,
        ready_to_divide,
        membrane_damage,
    }
}

/// Passive membrane transport: allow molecules to diffuse based on permeability.
/// Mirrors `cells.ts::membraneTransport` exactly.
pub fn membrane_transport(
    internal: &mut [f32],
    external: &[f32],
    mem_genes: &MembraneGenes,
    dt: f64,
) {
    let rate = mem_genes.permeability * 0.002 * dt;
    for i in 0..internal.len() {
        let diff = external[i] as f64 - internal[i] as f64;
        internal[i] = (internal[i] as f64 + diff * rate) as f32;
    }
}

/// Active transport: move a molecule against its gradient, costing ATP.
/// Mirrors `cells.ts::activeTransport` exactly.
pub fn active_transport(
    internal: &mut [f32],
    external: &mut [f32],
    molecule_index: usize,
    direction: f64, // +1 = in, -1 = out
    mem_genes: &MembraneGenes,
    dt: f64,
) -> f64 {
    let rate = mem_genes.active_transport * 0.01 * dt * direction;
    let moved = rate.abs().min((external[molecule_index] as f64).abs());
    internal[molecule_index] = (internal[molecule_index] as f64 + moved * direction) as f32;
    external[molecule_index] = (external[molecule_index] as f64 - moved * direction) as f32;
    MEMBRANE_TRANSPORT_COST as f64 * dt
}

/// Endocytosis: engulf an external particle. Higher chance with more endocytosis gene.
/// Mirrors `cells.ts::endocytosis` exactly (TS `nextFloat` = full f64 precision).
pub fn endocytosis(
    _cell: &CellState,
    mem_genes: &MembraneGenes,
    nearby_food: f64,
    rng: &mut SplitMix64,
) -> bool {
    if nearby_food <= 0.0 {
        return false;
    }
    let prob = mem_genes.endocytosis * 0.02;
    rng.next_float64() < prob
}

/// Exocytosis: release molecules into the environment.
/// Mirrors `cells.ts::exocytosis` exactly.
pub fn exocytosis(
    internal: &mut [f32],
    external: &mut [f32],
    molecule_index: usize,
    mem_genes: &MembraneGenes,
    dt: f64,
) {
    let rate = mem_genes.exocytosis * 0.005 * dt;
    let amount = rate.min(internal[molecule_index] as f64);
    internal[molecule_index] = (internal[molecule_index] as f64 - amount) as f32;
    external[molecule_index] = (external[molecule_index] as f64 + amount) as f32;
}

/// Effective protein synthesis rate based on ribosomes and available amino acids.
/// Mirrors `cells.ts::proteinSynthesisRate` exactly.
pub fn protein_synthesis_rate(cell: &CellState, amino_acids: f64) -> f64 {
    cell.ribosomes * 0.01 * (1.0_f64).min(amino_acids * 0.1)
}

/// Effective ATP production from mitochondria.
/// Mirrors `cells.ts::mitochondrialAtp` exactly.
pub fn mitochondrial_atp(cell: &CellState, glucose: f64, oxygen: f64) -> f64 {
    let substrate = glucose.min(oxygen);
    cell.mito_efficiency * 0.005 * substrate
}

/// Receptor-based sensing of an external molecule concentration.
/// Mirrors `cells.ts::receptorSensing` exactly.
pub fn receptor_sensing(mem_genes: &MembraneGenes, external_concentration: f64) -> f64 {
    mem_genes.receptor_density * external_concentration
}
