use fractal_life_shared::constants::*;
use fractal_life_simulation::cellbio::{self, ApplyEnv};
use fractal_life_simulation::cells::{create_cell_state, CellState};
use fractal_life_simulation::chemistry::{create_agent_chemistry, AgentChemistry};
use fractal_life_simulation::genome::{decode_cell_genes, decode_membrane_genes};
use fractal_life_simulation::rng::SplitMix64;

fn genome() -> Vec<f32> {
    vec![0.0; GENOME_SIZE]
}

fn env() -> ApplyEnv {
    ApplyEnv {
        o2_local: 0.3,
        mineral_local: 0.15,
        toxin_local: 0.0,
        ph_local: 7.0,
        water_available: 0.5,
    }
}

fn rng(seed: u64) -> SplitMix64 {
    SplitMix64::new(seed)
}

fn cell_with_bio(chem: &AgentChemistry) -> CellState {
    let mem = decode_membrane_genes(&genome());
    let mut cell = create_cell_state(&decode_cell_genes(&genome()));
    cell.bio = Some(cellbio::create_cell_bio_state(&mem, chem));
    cell
}

#[test]
fn create_state_seeds_proteome_and_gradient() {
    let g = genome();
    let mem = decode_membrane_genes(&g);
    let chem = create_agent_chemistry(&g, 42);
    let bio = cellbio::create_cell_bio_state(&mem, &chem);
    assert_eq!(bio.proteome.len(), PROTEOME_SIZE);
    for i in 0..PROTEOME_SIZE {
        assert!((bio.proteome[i] as f64 - (0.6 + 0.4 * 0.5)).abs() < 1e-6);
    }
    assert_eq!(bio.misfold_stress, 0.0);
    for i in 0..MOLECULE_COUNT {
        assert_eq!(
            bio.gradient[i], chem.molecules[i],
            "gradient == bulk at birth"
        );
    }
}

#[test]
fn mm_rate_saturates_and_is_zero_without_substrate() {
    assert_eq!(cellbio::michaelis_menten_rate(5.0, 0.0, 0.0), 0.0);
    let saturating = cellbio::michaelis_menten_rate(5.0, 1_000_000.0, 0.0);
    assert!(saturating < 5.0, "never exceeds Vmax");
    assert!(saturating > 4.9, "approaches Vmax");
}

#[test]
fn mm_rate_applies_end_product_inhibition() {
    let free = cellbio::michaelis_menten_rate(5.0, 50.0, 0.0);
    let inhibited = cellbio::michaelis_menten_rate(5.0, 50.0, 200.0);
    assert!(inhibited < free, "product should inhibit the rate");
    assert!(inhibited > 0.0);
    assert_eq!(cellbio::michaelis_menten_rate(0.0, 10.0, 0.0), 0.0);
    assert_eq!(cellbio::michaelis_menten_rate(5.0, -5.0, 0.0), 0.0);
}

#[test]
fn folding_acidic_ph_stresses_proteome() {
    let mk = |ph: f64| {
        let g = genome();
        let mut chem = create_agent_chemistry(&g, 42);
        chem.ph = ph;
        let mut cell = cell_with_bio(&chem);
        for _ in 0..80 {
            cellbio::tick_folding(&mut chem, &mut cell, 0.5, 1.0 / 60.0);
        }
        cell
    };
    let neutral = mk(7.0);
    let acidic = mk(9.0);
    let qn = neutral.bio.as_ref().unwrap().proteome[0] as f64;
    let qa = acidic.bio.as_ref().unwrap().proteome[0] as f64;
    assert!(
        qa < qn,
        "acidic fold {} should be worse than neutral {}",
        qa,
        qn
    );
}

#[test]
fn folding_sulfur_deficiency_reduces_quality_and_raises_stress() {
    let mk = |s: f32| {
        let g = genome();
        let mut chem = create_agent_chemistry(&g, 42);
        chem.elements[5] = s;
        let mut cell = cell_with_bio(&chem);
        for _ in 0..120 {
            cellbio::tick_folding(&mut chem, &mut cell, 0.5, 1.0 / 60.0);
        }
        cell
    };
    let low_s = mk(1.0);
    let high_s = mk(8.0);
    assert!(
        low_s.bio.as_ref().unwrap().misfold_stress > high_s.bio.as_ref().unwrap().misfold_stress,
        "low-S stresses harder"
    );
    assert!(
        low_s.bio.as_ref().unwrap().proteome[0] < high_s.bio.as_ref().unwrap().proteome[0],
        "low-S folds worse"
    );
    assert!(high_s.bio.as_ref().unwrap().proteome[0] > 0.0);
}

#[test]
fn gradient_flux_conserves_surface_plus_bulk() {
    let g = genome();
    let mut chem = create_agent_chemistry(&g, 42);
    let mut cell = cell_with_bio(&chem);
    cell.bio.as_mut().unwrap().gradient[0] = 50.0;
    chem.molecules[0] = 10.0;
    let gut = cell.bio.as_ref().unwrap().gradient[0] as f64 + chem.molecules[0] as f64;
    let cell_genes = decode_cell_genes(&g);
    cellbio::tick_gradient_flux(&mut cell, &mut chem, &cell_genes, 1.0);
    let after = cell.bio.as_ref().unwrap().gradient[0] as f64 + chem.molecules[0] as f64;
    assert!(
        (after - gut).abs() < 1e-5,
        "total conserved ({} -> {})",
        gut,
        after
    );
}

#[test]
fn gradient_flux_moves_molecules_toward_bulk() {
    let g = genome();
    let mut chem = create_agent_chemistry(&g, 42);
    let mut cell = cell_with_bio(&chem);
    cell.bio.as_mut().unwrap().gradient[0] = 50.0;
    chem.molecules[0] = 10.0;
    let cell_genes = decode_cell_genes(&g);
    cellbio::tick_gradient_flux(&mut cell, &mut chem, &cell_genes, 1.0);
    assert!(
        chem.molecules[0] > 10.0,
        "bulk should gain from the gradient"
    );
    assert!(
        cell.bio.as_ref().unwrap().gradient[0] < 50.0,
        "gradient should deplete"
    );
}

#[test]
fn apply_tick_is_deterministic_and_bounded() {
    let run = |seed: u64| {
        let g = genome();
        let mut chem = create_agent_chemistry(&g, 42);
        let mut cell = cell_with_bio(&chem);
        let mem = decode_membrane_genes(&g);
        let cg = decode_cell_genes(&g);
        let mut r = rng(seed);
        cellbio::apply_cell_bio_tick(
            &mut chem,
            &mut cell,
            &mem,
            &cg,
            0.5,
            &env(),
            &mut r,
            1.0 / 60.0,
        )
    };
    let a = run(7);
    let b = run(7);
    assert_eq!(a.atp_cost, b.atp_cost);
    assert_eq!(a.membrane_damage, b.membrane_damage);
    assert_eq!(a.fold_effect, b.fold_effect);
    assert!(a.atp_cost >= 0.0);
    assert!(a.membrane_damage >= 0.0);
    assert!((0.0..=1.0).contains(&a.fold_effect));
    let g = genome();
    let mut chem = create_agent_chemistry(&g, 42);
    let mut cell = cell_with_bio(&chem);
    let mem = decode_membrane_genes(&g);
    let cg = decode_cell_genes(&g);
    let mut r = rng(3);
    cellbio::apply_cell_bio_tick(
        &mut chem,
        &mut cell,
        &mem,
        &cg,
        0.5,
        &env(),
        &mut r,
        1.0 / 60.0,
    );
    assert!((0.0..=1.0).contains(&cell.membrane_integrity));
}

#[test]
fn membrane_biochemistry_keeps_pools_non_negative_and_repairs() {
    let g = genome();
    let mut chem = create_agent_chemistry(&g, 42);
    let mem = decode_membrane_genes(&g);
    let mut cell = cell_with_bio(&chem);
    cell.membrane_integrity = 0.5;
    let mut rich = env();
    rich.mineral_local = 0.9;
    rich.o2_local = 1.0;
    for i in 0..200u64 {
        let mut r = rng(i);
        cellbio::tick_membrane_biochemistry(&mut cell, &mut chem, &mem, &rich, &mut r, 1.0 / 60.0);
        for m in 0..chem.molecules.len() {
            assert!(chem.molecules[m] >= 0.0, "molecule {} non-negative", m);
        }
        for j in 0..chem.ions.len() {
            assert!(chem.ions[j] >= 0.0, "ion {} non-negative", j);
        }
        assert!((0.0..=1.0).contains(&cell.membrane_integrity));
    }
    assert!(
        cell.membrane_integrity > 0.5,
        "lipid repair raises integrity over time"
    );
}
