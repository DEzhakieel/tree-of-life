use crate::cells::CellState;
use crate::chemistry::AgentChemistry;
use crate::genome::{CellGenes, MembraneGenes};
use crate::rng::SplitMix64;
use fractal_life_shared::constants::*;

/// Opt-in cell biochemistry (WorldConfig.cell_bio). Mirrors
/// apps/simulation/src/cellbio.ts exactly — every f64 computation and f32 store
/// matches the TS Float32Array reference.
/// Proteome class indices (into the `proteome` array).
pub const PROTEOME_ENZYMATIC: usize = 0; // catalysts — gates metabolic yield
pub const PROTEOME_STRUCTURAL: usize = 1; // scaffolding — gates passive flux + repair
pub const PROTEOME_CHAPERONE: usize = 2; // heat-shock pool — gates refolding + synthesis
pub const PROTEOME_SIGNALING: usize = 3; // receptor machinery — gates vesicle traffic
/// Fold-quality seed genes start at RECEPTOR_DENSITY (membrane gene 4).
/// Element / molecule / ion indices used by this module.
const E_SULFUR: usize = 5;
const M_GLUCOSE: usize = 0;
const M_ATP: usize = 1;
const M_AMINO_ACID: usize = 2;
const M_LIPID: usize = 3;
const M_PROTEIN: usize = 6;
const M_SIGNAL_MOL: usize = 8;
const M_SUGAR: usize = 9;
const M_OSMOLYTE: usize = 11;
const I_SODIUM: usize = 0;
const I_POTASSIUM: usize = 1;

#[derive(Clone)]
pub struct CellBioState {
    /// Fold quality per proteome class in [0,1].
    pub proteome: Vec<f32>,
    /// Accumulated misfolded-protein stress (>= 0).
    pub misfold_stress: f64,
    /// Membrane-surface concentration per molecule (drives passive / active flux).
    pub gradient: Vec<f32>,
}

/// Local environmental concentrations the membrane "sees".
#[derive(Clone, Copy)]
pub struct ApplyEnv {
    pub o2_local: f64,
    pub mineral_local: f64,
    pub toxin_local: f64,
    pub ph_local: f64,
    pub water_available: f64,
}

pub struct FoldResult {
    pub atp_cost: f64,
    pub fold_effect: f64,
    pub misfold_damage: f64,
}

pub struct MemResult {
    pub atp_cost: f64,
}

pub struct CellBioResult {
    pub atp_cost: f64,
    pub membrane_damage: f64,
    pub fold_effect: f64,
}

fn clamp(v: f64, lo: f64, hi: f64) -> f64 {
    lo.max(v.min(hi))
}

/// Michaelis-Menten rate with non-competitive end-product inhibition.
/// Mirrors `cellbio.ts::michaelisMentenRate`.
pub fn michaelis_menten_rate(vmax: f64, substrate: f64, product: f64) -> f64 {
    let s = substrate.max(0.0);
    let p = product.max(0.0);
    vmax * (s / (s + MM_KM as f64)) * (1.0 / (1.0 + MM_INHIBITION as f64 * (p / 100.0)))
}

/// Create the initial cell-biochemistry state: proteome seeded from the four
/// membrane-protein gene expressions, gradient equal to the bulk molecule pool.
/// Mirrors `cellbio.ts::createCellBioState`.
pub fn create_cell_bio_state(mem_genes: &MembraneGenes, chem: &AgentChemistry) -> CellBioState {
    let seeds = [
        mem_genes.receptor_density,
        mem_genes.channel_density,
        mem_genes.pump_density,
        mem_genes.lipid_composition,
    ];
    let mut proteome = [0.0f32; PROTEOME_SIZE];
    for i in 0..PROTEOME_SIZE {
        proteome[i] = (0.6 + 0.4 * seeds[i]) as f32;
    }
    let mut gradient = vec![0.0f32; MOLECULE_COUNT];
    gradient.copy_from_slice(&chem.molecules);
    CellBioState {
        proteome: proteome.to_vec(),
        misfold_stress: 0.0,
        gradient,
    }
}

/// Protein-folding dynamics for one tick.
/// Mirrors `cellbio.ts::tickFolding` (bio is read from `cell.bio` internally).
pub fn tick_folding(
    chem: &mut AgentChemistry,
    cell: &mut CellState,
    catalysis_gene: f64,
    dt: f64,
) -> FoldResult {
    let bio = cell.bio.as_mut().expect("cell bio state required");
    let mut atp_cost = 0.0f64;
    let sulfur = chem.elements[E_SULFUR] as f64;
    let sulfur_factor = if sulfur < 3.0 {
        1.0 + FOLDING_SULFUR_SENSITIVITY as f64
    } else {
        1.0
    };
    let ph_stress = (chem.ph - PH_NEUTRAL as f64).abs() * 0.01;
    let tension_stress = cell.tension * 0.02;
    let stress = (ph_stress + tension_stress) * sulfur_factor * dt;

    let chaperone_quality = bio.proteome[PROTEOME_CHAPERONE] as f64;

    // de-novo chaperone synthesis (amino acids + ATP -> protein)
    let synth = michaelis_menten_rate(
        catalysis_gene,
        chem.molecules[M_AMINO_ACID] as f64,
        chem.molecules[M_PROTEIN] as f64,
    ) * 0.04
        * dt;
    let synth_aa = (synth * 2.0).min(chem.molecules[M_AMINO_ACID] as f64);
    let synth_atp = (synth * 0.5).min(chem.molecules[M_ATP] as f64);
    chem.molecules[M_AMINO_ACID] = (chem.molecules[M_AMINO_ACID] as f64 - synth_aa) as f32;
    chem.molecules[M_ATP] = (chem.molecules[M_ATP] as f64 - synth_atp) as f32;
    bio.proteome[PROTEOME_CHAPERONE] = clamp(
        bio.proteome[PROTEOME_CHAPERONE] as f64 + synth * 0.2,
        0.0,
        1.0,
    ) as f32;
    atp_cost += synth_atp * CHAPERONE_ATP_COST as f64;

    for i in 0..PROTEOME_SIZE {
        let mut q = bio.proteome[i] as f64;
        q -= PROTEIN_TURNOVER_RATE as f64 * dt;
        q -= stress * 0.25;
        q += CHAPERONE_FOLD_RATE as f64 * chaperone_quality * (1.0 - q) * dt;
        bio.proteome[i] = clamp(q, 0.0, 1.0) as f32;
    }

    let mut misfold_sum = 0.0;
    for i in 0..PROTEOME_SIZE {
        misfold_sum += 1.0 - bio.proteome[i] as f64;
    }

    bio.misfold_stress = (bio.misfold_stress + misfold_sum * 0.002 * dt
        - MISFOLD_STRESS_DECAY as f64 * bio.misfold_stress * dt)
        .max(0.0);

    let fold_effect = bio.proteome[PROTEOME_ENZYMATIC] as f64;
    let misfold_damage = bio.misfold_stress * MISFOLD_MEMBRANE_DAMAGE as f64 * dt;
    cell.membrane_integrity = clamp(cell.membrane_integrity - misfold_damage, 0.0, 1.0);

    FoldResult {
        atp_cost,
        fold_effect,
        misfold_damage,
    }
}

/// Membrane biology for one tick.
/// Mirrors `cellbio.ts::tickMembraneBiochemistry` (bio read from `cell.bio`).
pub fn tick_membrane_biochemistry(
    cell: &mut CellState,
    chem: &mut AgentChemistry,
    mem_genes: &MembraneGenes,
    env: &ApplyEnv,
    rng: &mut SplitMix64,
    dt: f64,
) -> MemResult {
    let bio = cell.bio.as_mut().expect("cell bio state required");
    let mut atp_cost = 0.0f64;

    // --- external medium concentrations (derived from local terrain) ---
    let mut external_molecule = [0.0f32; MOLECULE_COUNT];
    external_molecule[M_OSMOLYTE] = (env.water_available * 20.0) as f32;
    external_molecule[M_AMINO_ACID] = (env.mineral_local * 10.0) as f32;
    external_molecule[M_SUGAR] = (env.mineral_local * 5.0) as f32;
    external_molecule[M_GLUCOSE] = (env.mineral_local * 3.0) as f32;
    external_molecule[M_SIGNAL_MOL] = (env.toxin_local * 5.0) as f32;
    let mut external_ions = [0.0f32; ION_COUNT];
    external_ions[I_SODIUM] = (12.0 + env.mineral_local * 5.0) as f32;
    external_ions[I_POTASSIUM] = 6.0;
    external_ions[2] = 2.0;
    external_ions[3] = 1.0;
    external_ions[4] = (10.0 + env.mineral_local * 3.0) as f32;

    // --- passive diffusion: medium <-> surface gradient ---
    let structural_quality = bio.proteome[PROTEOME_STRUCTURAL] as f64;
    let diff_rate =
        mem_genes.permeability * PASSIVE_DIFFUSION_RATE as f64 * (0.5 + structural_quality) * dt;
    for (i, &ext) in external_molecule.iter().enumerate() {
        let diff = ext as f64 - bio.gradient[i] as f64;
        bio.gradient[i] = (bio.gradient[i] as f64 + diff * diff_rate) as f32;
    }

    // --- active ion pump: Na+ out / K+ in against the gradient, ATP-gated ---
    let pump_rate = mem_genes.pump_density * mem_genes.active_transport * 2.0 * dt;
    let na_excess = (chem.ions[I_SODIUM] as f64 - external_ions[I_SODIUM] as f64).max(0.0);
    let k_deficit = (external_ions[I_POTASSIUM] as f64 - chem.ions[I_POTASSIUM] as f64).max(0.0);
    let na_pump = na_excess.min(pump_rate);
    let k_pump = k_deficit.min(pump_rate * 0.8);
    let atp_use = (na_pump + k_pump) * MEMBRANE_TRANSPORT_COST as f64;
    let atp_avail = chem.molecules[M_ATP] as f64;
    if atp_use <= atp_avail {
        chem.ions[I_SODIUM] = (chem.ions[I_SODIUM] as f64 - na_pump) as f32;
        chem.ions[I_POTASSIUM] = (chem.ions[I_POTASSIUM] as f64 + k_pump) as f32;
        chem.molecules[M_ATP] = (atp_avail - atp_use) as f32;
        atp_cost += atp_use;
    }

    // --- mitochondrial respiration: glucose + O2 -> ATP (MM limited) ---
    let glucose = chem.molecules[M_GLUCOSE] as f64;
    let enzyme_quality = bio.proteome[PROTEOME_ENZYMATIC] as f64;
    let mito_base = cell.mito_efficiency
        * 0.02
        * glucose.min(40.0)
        * env.o2_local
        * (0.5 + enzyme_quality)
        * dt;
    let mito = mito_base * michaelis_menten_rate(1.0, glucose, chem.molecules[M_ATP] as f64);
    let glucose_used = (mito * 5.0).min(glucose);
    chem.molecules[M_GLUCOSE] = (chem.molecules[M_GLUCOSE] as f64 - glucose_used) as f32;
    chem.molecules[M_ATP] = (chem.molecules[M_ATP] as f64 + mito) as f32;

    // --- lipid-based membrane repair ---
    if cell.membrane_integrity < 1.0 {
        let repair_mag = mem_genes.lipid_composition
            * LIPID_REPAIR_RATE as f64
            * dt
            * (0.5 + structural_quality);
        let lipid_spent = repair_mag * 0.5;
        let lipid_avail = chem.molecules[M_LIPID] as f64;
        if lipid_spent <= lipid_avail {
            chem.molecules[M_LIPID] = (chem.molecules[M_LIPID] as f64 - lipid_spent) as f32;
            cell.membrane_integrity = clamp(cell.membrane_integrity + repair_mag, 0.0, 1.0);
            atp_cost += LIPID_REPAIR_ATP as f64 * dt;
        }
    }

    // --- endocytosis: engulf external rich medium (RNG-gated; same gate as
    // cells.ts `endocytosis`: `nearby > 0 && rng.nextFloat() < endocytosis * 0.02`) ---
    let nearby = external_molecule[M_GLUCOSE] as f64
        + external_molecule[M_AMINO_ACID] as f64
        + external_molecule[M_SUGAR] as f64;
    if nearby > 0.0 && rng.next_float64() < mem_genes.endocytosis * 0.02 {
        let gain = nearby * 0.2;
        let g_glc = (gain * 0.4).min(external_molecule[M_GLUCOSE] as f64);
        let g_aa = (gain * 0.4).min(external_molecule[M_AMINO_ACID] as f64);
        let g_sugar = (gain * 0.2).min(external_molecule[M_SUGAR] as f64);
        bio.gradient[M_GLUCOSE] = (bio.gradient[M_GLUCOSE] as f64 - g_glc) as f32;
        bio.gradient[M_AMINO_ACID] = (bio.gradient[M_AMINO_ACID] as f64 - g_aa) as f32;
        bio.gradient[M_SUGAR] = (bio.gradient[M_SUGAR] as f64 - g_sugar) as f32;
        chem.molecules[M_GLUCOSE] = (chem.molecules[M_GLUCOSE] as f64 + g_glc) as f32;
        chem.molecules[M_AMINO_ACID] = (chem.molecules[M_AMINO_ACID] as f64 + g_aa) as f32;
        chem.molecules[M_SUGAR] = (chem.molecules[M_SUGAR] as f64 + g_sugar) as f32;
    }

    // --- exocytosis: release signal molecules onto the surface ---
    let signal_out = mem_genes.exocytosis * (bio.proteome[PROTEOME_SIGNALING] as f64) * 0.005 * dt;
    let amt = signal_out.min(chem.molecules[M_SIGNAL_MOL] as f64);
    chem.molecules[M_SIGNAL_MOL] = (chem.molecules[M_SIGNAL_MOL] as f64 - amt) as f32;
    bio.gradient[M_SIGNAL_MOL] = (bio.gradient[M_SIGNAL_MOL] as f64 + amt) as f32;

    MemResult { atp_cost }
}

/// Cytoskeleton-driven transport between surface gradient and bulk molecule
/// pool. Surface + bulk conserved for every molecule species.
/// Mirrors `cellbio.ts::tickGradientFlux` (bio read from `cell.bio`).
pub fn tick_gradient_flux(
    cell: &mut CellState,
    chem: &mut AgentChemistry,
    cell_genes: &CellGenes,
    dt: f64,
) {
    let bio = cell.bio.as_mut().expect("cell bio state required");
    let rate = GRADIENT_PROPAGATION_RATE as f64
        * (0.5 + cell_genes.cytoskeleton)
        * (0.5 + cell_genes.vesicle_traffic)
        * dt;
    for i in 0..MOLECULE_COUNT {
        let d = bio.gradient[i] as f64 - chem.molecules[i] as f64;
        let flux = d * rate;
        bio.gradient[i] = (bio.gradient[i] as f64 - flux).max(0.0) as f32;
        chem.molecules[i] = (chem.molecules[i] as f64 + flux).max(0.0) as f32;
    }
}

/// Orchestrator: folding -> membrane biochemistry -> gradient flux.
/// Mirrors `cellbio.ts::applyCellBioTick` (the TS reference takes `bio` as a
/// separate argument; here it is read from `cell.bio` to keep the borrow
/// checker happy at the call site).
pub fn apply_cell_bio_tick(
    chem: &mut AgentChemistry,
    cell: &mut CellState,
    mem_genes: &MembraneGenes,
    cell_genes: &CellGenes,
    catalysis_gene: f64,
    env: &ApplyEnv,
    rng: &mut SplitMix64,
    dt: f64,
) -> CellBioResult {
    let fold = tick_folding(chem, cell, catalysis_gene, dt);
    let mem = tick_membrane_biochemistry(cell, chem, mem_genes, env, rng, dt);
    tick_gradient_flux(cell, chem, cell_genes, dt);
    CellBioResult {
        atp_cost: fold.atp_cost + mem.atp_cost,
        membrane_damage: fold.misfold_damage,
        fold_effect: fold.fold_effect,
    }
}
