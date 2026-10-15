use crate::rng::SplitMix64;
use fractal_life_shared::constants::*;
use fractal_life_shared::types::EnvProfile;

#[derive(Clone)]
pub struct AgentChemistry {
    pub elements: Vec<f32>,
    pub molecules: Vec<f32>,
    pub ions: Vec<f32>,
    pub enzymes: Vec<f32>,
    pub ph: f64,
}

#[derive(Clone)]
pub struct ChemTerrain {
    pub o2: Vec<f32>,
    pub ph: Vec<f32>,
    pub toxin: Vec<f32>,
    pub minerals: Vec<f32>,
    pub size: usize,
}

/// Real-world element stoichiometry for digestion, in sim element order
/// [C,H,O,N,P,S,Fe,K]. When grounding is present these come from real PubChem
/// molecular formulas; otherwise they default to the hand-authored ratios.
#[derive(Clone, Default)]
pub struct ChemStoich {
    pub plant: [f64; 8],
    pub meat: [f64; 8],
    pub enabled: bool,
}

impl ChemStoich {
    pub fn grounded(plant: [f64; 8], meat: [f64; 8]) -> Self {
        Self {
            plant,
            meat,
            enabled: true,
        }
    }
}

const DEFAULT_PLANT_STOICH: [f64; 8] = [6.0, 4.0, 3.0, 1.5, 0.0, 0.0, 0.0, 0.0];
const DEFAULT_MEAT_STOICH: [f64; 8] = [5.0, 3.0, 0.0, 3.0, 1.5, 1.0, 0.8, 0.0];

pub fn create_agent_chemistry(genome: &[f32], seed: u32) -> AgentChemistry {
    let mut rng = SplitMix64::new(seed as u64);
    let mut elements = vec![0.0f32; ELEMENT_COUNT];
    let mut molecules = vec![0.0f32; MOLECULE_COUNT];
    let mut ions = vec![0.0f32; ION_COUNT];
    let mut enzymes = vec![0.0f32; ENZYME_TYPE_COUNT];

    let carb_bias = genome.get(120).copied().unwrap_or(0.5) as f64;
    let nitro_bias = genome.get(121).copied().unwrap_or(0.5) as f64;
    let phospho_bias = genome.get(122).copied().unwrap_or(0.5) as f64;
    let sulfur_bias = genome.get(123).copied().unwrap_or(0.5) as f64;
    let catalysis_rate = genome.get(124).copied().unwrap_or(0.5) as f64;
    let tox_resist = genome.get(125).copied().unwrap_or(0.5) as f64;
    let ion_pump = genome.get(126).copied().unwrap_or(0.5) as f64;
    let redox_balance = genome.get(127).copied().unwrap_or(0.5) as f64;

    elements[0] = (15.0 + carb_bias * 20.0) as f32;
    elements[1] = (20.0 + rng.next_float64() * 10.0) as f32;
    elements[2] = (15.0 + (1.0 - redox_balance) * 15.0) as f32;
    elements[3] = (10.0 + nitro_bias * 15.0) as f32;
    elements[4] = (5.0 + phospho_bias * 10.0) as f32;
    elements[5] = (3.0 + sulfur_bias * 7.0) as f32;
    elements[6] = (2.0 + rng.next_float64() * 3.0) as f32;
    elements[7] = (5.0 + ion_pump * 10.0) as f32;

    molecules[0] = (20.0 + rng.next_float64() * 15.0) as f32;
    molecules[1] = (10.0 + rng.next_float64() * 10.0) as f32;
    molecules[2] = (5.0 + nitro_bias * 10.0) as f32;
    molecules[3] = (3.0 + carb_bias * 8.0) as f32;
    molecules[4] = (2.0 + phospho_bias * 5.0) as f32;
    molecules[5] = (2.0 + catalysis_rate * 5.0) as f32;
    molecules[6] = 3.0;
    molecules[7] = (tox_resist * 5.0) as f32;
    molecules[8] = 2.0;
    molecules[9] = (15.0 + rng.next_float64() * 10.0) as f32;
    molecules[10] = (2.0 + carb_bias * 5.0) as f32;
    molecules[11] = (5.0 + ion_pump * 5.0) as f32;

    ions[0] = (10.0 + ion_pump * 5.0) as f32;
    ions[1] = (8.0 + ion_pump * 5.0) as f32;
    ions[2] = (2.0 + rng.next_float64() * 3.0) as f32;
    ions[3] = (1.0 + rng.next_float64() * 2.0) as f32;
    ions[4] = (8.0 + ion_pump * 4.0) as f32;

    enzymes[0] = (3.0 + catalysis_rate * 5.0) as f32;
    enzymes[1] = (2.0 + catalysis_rate * 4.0) as f32;
    enzymes[2] = (2.0 + catalysis_rate * 3.0) as f32;
    enzymes[3] = (1.0 + catalysis_rate * 3.0) as f32;
    enzymes[4] = (1.0 + catalysis_rate * 2.0) as f32;
    enzymes[5] = (1.0 + catalysis_rate * 2.0) as f32;

    AgentChemistry {
        elements,
        molecules,
        ions,
        enzymes,
        ph: PH_NEUTRAL as f64 + (rng.next_float64() - 0.5) * 0.6,
    }
}

pub fn create_chem_terrain(grid_size: usize, env: EnvProfile) -> ChemTerrain {
    ChemTerrain {
        o2: vec![env.o2 as f32; grid_size * grid_size],
        ph: vec![env.ph as f32; grid_size * grid_size],
        toxin: vec![env.toxin as f32; grid_size * grid_size],
        minerals: vec![env.minerals as f32; grid_size * grid_size],
        size: grid_size,
    }
}

pub fn tick_agent_chemistry(
    chem: &mut AgentChemistry,
    food_intake: f64,
    meat_intake: f64,
    water_available: f64,
    o2_local: f64,
    ph_local: f64,
    toxin_local: f64,
    mineral_local: f64,
    _diet: f64,
    catalysis_gene: f64,
    tox_gene: f64,
    ion_gene: f64,
    redox_gene: f64,
    dt: f64,
    stoich: Option<&ChemStoich>,
) -> f64 {
    let elements = &mut chem.elements;
    let molecules = &mut chem.molecules;
    let ions = &mut chem.ions;
    let enzymes = &mut chem.enzymes;

    // pH equilibration
    chem.ph += (ph_local - chem.ph) * 0.002 * dt;
    let ph_dist = (chem.ph - PH_NEUTRAL as f64).abs();
    let ph_mod = (1.0 - ph_dist / PH_RANGE as f64).max(0.1);

    // Elemental uptake
    let mineral_uptake = mineral_local * 0.3 * dt;
    elements[4] = (elements[4] as f64 + mineral_uptake * 0.3).min(CHEM_MAX_ELEMENT as f64) as f32;
    elements[5] = (elements[5] as f64 + mineral_uptake * 0.15).min(CHEM_MAX_ELEMENT as f64) as f32;
    elements[6] = (elements[6] as f64 + mineral_uptake * 0.1).min(CHEM_MAX_ELEMENT as f64) as f32;
    elements[7] = (elements[7] as f64 + mineral_uptake * 0.45).min(CHEM_MAX_ELEMENT as f64) as f32;

    let water_uptake = water_available * 0.15 * dt;
    elements[1] = (elements[1] as f64 + water_uptake * 0.67).min(CHEM_MAX_ELEMENT as f64) as f32;
    elements[2] = (elements[2] as f64 + water_uptake * 0.33).min(CHEM_MAX_ELEMENT as f64) as f32;

    let o2_uptake = o2_local * 0.2 * dt;
    elements[2] = (elements[2] as f64 + o2_uptake).min(CHEM_MAX_ELEMENT as f64) as f32;

    // Food digestion
    let digestion_rate = REACTION_RATE as f64 * 8.0;
    let (p_plant, p_meat) = match stoich {
        Some(s) if s.enabled => (s.plant, s.meat),
        _ => (DEFAULT_PLANT_STOICH, DEFAULT_MEAT_STOICH),
    };
    if food_intake > 0.0 {
        let digested = food_intake * digestion_rate * ph_mod * dt;
        elements[0] =
            (elements[0] as f64 + digested * p_plant[0]).min(CHEM_MAX_ELEMENT as f64) as f32;
        elements[1] =
            (elements[1] as f64 + digested * p_plant[1]).min(CHEM_MAX_ELEMENT as f64) as f32;
        elements[2] =
            (elements[2] as f64 + digested * p_plant[2]).min(CHEM_MAX_ELEMENT as f64) as f32;
        elements[3] =
            (elements[3] as f64 + digested * p_plant[3]).min(CHEM_MAX_ELEMENT as f64) as f32;
        elements[4] =
            (elements[4] as f64 + digested * p_plant[4]).min(CHEM_MAX_ELEMENT as f64) as f32;
        elements[5] =
            (elements[5] as f64 + digested * p_plant[5]).min(CHEM_MAX_ELEMENT as f64) as f32;
        elements[6] =
            (elements[6] as f64 + digested * p_plant[6]).min(CHEM_MAX_ELEMENT as f64) as f32;
        elements[7] =
            (elements[7] as f64 + digested * p_plant[7]).min(CHEM_MAX_ELEMENT as f64) as f32;
        molecules[9] = (molecules[9] as f64 + digested * 5.0).min(CHEM_MAX_MOLECULE as f64) as f32;
        molecules[0] = (molecules[0] as f64 + digested * 3.0).min(CHEM_MAX_MOLECULE as f64) as f32;
    }
    if meat_intake > 0.0 {
        let digested = meat_intake * digestion_rate * ph_mod * dt;
        elements[0] =
            (elements[0] as f64 + digested * p_meat[0]).min(CHEM_MAX_ELEMENT as f64) as f32;
        elements[1] =
            (elements[1] as f64 + digested * p_meat[1]).min(CHEM_MAX_ELEMENT as f64) as f32;
        elements[2] =
            (elements[2] as f64 + digested * p_meat[2]).min(CHEM_MAX_ELEMENT as f64) as f32;
        elements[3] =
            (elements[3] as f64 + digested * p_meat[3]).min(CHEM_MAX_ELEMENT as f64) as f32;
        elements[4] =
            (elements[4] as f64 + digested * p_meat[4]).min(CHEM_MAX_ELEMENT as f64) as f32;
        elements[5] =
            (elements[5] as f64 + digested * p_meat[5]).min(CHEM_MAX_ELEMENT as f64) as f32;
        elements[6] =
            (elements[6] as f64 + digested * p_meat[6]).min(CHEM_MAX_ELEMENT as f64) as f32;
        elements[7] =
            (elements[7] as f64 + digested * p_meat[7]).min(CHEM_MAX_ELEMENT as f64) as f32;
        molecules[2] = (molecules[2] as f64 + digested * 4.0).min(CHEM_MAX_MOLECULE as f64) as f32;
        molecules[10] =
            (molecules[10] as f64 + digested * 2.0).min(CHEM_MAX_MOLECULE as f64) as f32;
    }

    // Catalysed reactions
    let cat_mod = 0.3 + catalysis_gene * 1.4;

    // Oxidase: sugar + O2 → ATP
    {
        let ox_rate = enzymes[0] as f64 * cat_mod * ph_mod * REACTION_RATE as f64 * dt;
        let substrate = (molecules[9] as f64).min(o2_local * 30.0 * ox_rate);
        let produced = substrate * 0.8;
        molecules[9] = (molecules[9] as f64 - substrate) as f32;
        molecules[1] = (molecules[1] as f64 + produced).min(CHEM_MAX_MOLECULE as f64) as f32;
    }

    // Synthase: amino acid → protein
    {
        let syn_rate = enzymes[1] as f64 * cat_mod * ph_mod * REACTION_RATE as f64 * dt;
        let substrate = (molecules[2] as f64 * 0.3).min(syn_rate * 5.0);
        molecules[2] = (molecules[2] as f64 - substrate) as f32;
        molecules[6] = (molecules[6] as f64 + substrate * 0.9).min(CHEM_MAX_MOLECULE as f64) as f32;
    }

    // Ligase: fatty acid → lipid (uses ATP)
    {
        let lig_rate = enzymes[3] as f64 * cat_mod * ph_mod * REACTION_RATE as f64 * dt;
        let atp_cost = (molecules[1] as f64 * 0.2).min(lig_rate * 3.0);
        let substrate = (molecules[10] as f64 * 0.4).min(lig_rate * 4.0);
        if atp_cost > 0.5 && substrate > 0.5 {
            molecules[1] = (molecules[1] as f64 - atp_cost) as f32;
            molecules[10] = (molecules[10] as f64 - substrate) as f32;
            molecules[3] =
                (molecules[3] as f64 + substrate * 0.8).min(CHEM_MAX_MOLECULE as f64) as f32;
        }
    }

    // Transferase: nucleotide (uses ATP)
    {
        let tr_rate = enzymes[4] as f64 * cat_mod * ph_mod * REACTION_RATE as f64 * dt;
        let substrate = (molecules[4] as f64 * 0.2).min(tr_rate * 3.0);
        molecules[4] = (molecules[4] as f64 - substrate) as f32;
        let atp_cost = (molecules[1] as f64 * 0.1).min(substrate * 2.0);
        molecules[1] = (molecules[1] as f64 - atp_cost) as f32;
    }

    // Lyase: glucose → fatty acid + sugar
    {
        let ly_rate =
            enzymes[5] as f64 * cat_mod * ph_mod * REACTION_RATE as f64 * dt * (1.0 - _diet);
        let substrate = (molecules[0] as f64 * 0.15).min(ly_rate * 2.0);
        molecules[0] = (molecules[0] as f64 - substrate) as f32;
        molecules[10] =
            (molecules[10] as f64 + substrate * 0.5).min(CHEM_MAX_MOLECULE as f64) as f32;
        molecules[9] = (molecules[9] as f64 + substrate * 0.5).min(CHEM_MAX_MOLECULE as f64) as f32;
    }

    // Hydrolase: protein → amino acid (catabolism when low energy)
    {
        let hyd_rate = enzymes[2] as f64 * cat_mod * ph_mod * REACTION_RATE as f64 * dt;
        let need_atp = (molecules[1] as f64) < CHEM_MAX_MOLECULE as f64 * 0.2;
        if need_atp && molecules[6] as f64 > 5.0 {
            let substrate = (molecules[6] as f64 * 0.2).min(hyd_rate * 4.0);
            molecules[6] = (molecules[6] as f64 - substrate) as f32;
            molecules[2] =
                (molecules[2] as f64 + substrate * 0.9).min(CHEM_MAX_MOLECULE as f64) as f32;
            molecules[1] =
                (molecules[1] as f64 + substrate * 0.3).min(CHEM_MAX_MOLECULE as f64) as f32;
        }
    }

    // Enzyme synthesis
    if molecules[1] as f64 > 5.0 && molecules[2] as f64 > 3.0 {
        let cat_e = cat_mod * 0.02 * dt;
        for e in 0..ENZYME_TYPE_COUNT {
            let uptake = cat_e
                .min(molecules[2] as f64 * 0.05)
                .min(molecules[1] as f64 * 0.05);
            if uptake > 0.01 {
                enzymes[e] = (enzymes[e] as f64 + uptake * 0.8).min(CHEM_MAX_ENZYME as f64) as f32;
                molecules[2] = (molecules[2] as f64 - uptake * 0.5) as f32;
                molecules[1] = (molecules[1] as f64 - uptake * 0.3) as f32;
            }
        }
    }

    // Enzyme decay
    for e in 0..ENZYME_TYPE_COUNT {
        enzymes[e] = (enzymes[e] as f64 - 0.01 * dt).max(0.0) as f32;
    }

    // ATP decay
    molecules[1] = (molecules[1] as f64 - 0.015 * dt).max(0.0) as f32;

    // Toxin metabolism
    {
        let tox_prod = tox_gene * 0.03 * dt;
        if molecules[2] as f64 > 3.0 {
            molecules[7] = (molecules[7] as f64 + tox_prod).min(CHEM_MAX_MOLECULE as f64) as f32;
            molecules[2] = (molecules[2] as f64 - tox_prod * 0.5) as f32;
        }
        let tox_absorb = toxin_local * 0.05 * (1.0 - tox_gene * 0.7) * dt;
        molecules[7] = (molecules[7] as f64 + tox_absorb).min(CHEM_MAX_MOLECULE as f64) as f32;
        molecules[7] = (molecules[7] as f64 - 0.005 * dt).max(0.0) as f32;
    }

    // Ion pump
    {
        let pump_rate = ion_gene * 0.05 * dt;
        if molecules[1] as f64 > 2.0 {
            ions[1] = (ions[1] as f64 + pump_rate).min(CHEM_MAX_ION as f64) as f32;
            ions[0] = (ions[0] as f64 - pump_rate * 0.8).max(0.0) as f32;
            ions[4] = (ions[4] as f64 - pump_rate * 0.5).max(0.0) as f32;
            molecules[1] = (molecules[1] as f64 - pump_rate * 0.3) as f32;
        }
        ions[2] = (ions[2] as f64 - 0.01 * dt).max(0.0) as f32;
        ions[3] = (ions[3] as f64 + redox_gene * 0.01 * dt).min(CHEM_MAX_ION as f64) as f32;
    }

    // Osmolyte
    if water_available < 0.2 && molecules[1] as f64 > 3.0 {
        molecules[11] = (molecules[11] as f64 + 0.03 * dt).min(CHEM_MAX_MOLECULE as f64) as f32;
        molecules[1] = (molecules[1] as f64 - 0.01 * dt) as f32;
    } else {
        molecules[11] = (molecules[11] as f64 - 0.005 * dt).max(0.0) as f32;
    }

    // Signal molecule
    if (molecules[8] as f64) < CHEM_MAX_MOLECULE as f64 * 0.5 {
        let sig_cost = 0.002 * dt;
        molecules[8] = (molecules[8] as f64 + sig_cost).min(CHEM_MAX_MOLECULE as f64) as f32;
        molecules[1] = (molecules[1] as f64 - sig_cost * 0.5).max(0.0) as f32;
    }
    molecules[8] = (molecules[8] as f64 - 0.003 * dt).max(0.0) as f32;

    // Energy delta
    let atp_energy_gain = molecules[1] as f64 * 0.002 * dt;
    let total_molecules: f64 = molecules.iter().map(|&v| v as f64).sum();
    let maintenance_cost = total_molecules * 0.00005 * dt;

    atp_energy_gain - maintenance_cost
}

pub fn tick_chem_terrain(
    chem: &mut ChemTerrain,
    food_field: &[f32],
    meat_field: &[f32],
    daylight: f64,
    season_moisture: f64,
    dt: f64,
) {
    let sz = chem.size;
    let n = sz * sz;
    let diff_rate = CHEM_DIFFUSE_RATE as f64 * dt;

    let mut tmp_o2 = vec![0.0f32; n];
    let mut tmp_tox = vec![0.0f32; n];
    let mut tmp_min = vec![0.0f32; n];

    for y in 0..sz {
        for x in 0..sz {
            let i = y * sz + x;
            let xp = (x + 1) % sz;
            let xm = (x + sz - 1) % sz;
            let yp = (y + 1) % sz;
            let ym = (y + sz - 1) % sz;

            let lap_o2 = chem.o2[yp * sz + x] as f64
                + chem.o2[ym * sz + x] as f64
                + chem.o2[y * sz + xp] as f64
                + chem.o2[y * sz + xm] as f64
                - 4.0 * chem.o2[i] as f64;
            let lap_tox = chem.toxin[yp * sz + x] as f64
                + chem.toxin[ym * sz + x] as f64
                + chem.toxin[y * sz + xp] as f64
                + chem.toxin[y * sz + xm] as f64
                - 4.0 * chem.toxin[i] as f64;
            let lap_min = chem.minerals[yp * sz + x] as f64
                + chem.minerals[ym * sz + x] as f64
                + chem.minerals[y * sz + xp] as f64
                + chem.minerals[y * sz + xm] as f64
                - 4.0 * chem.minerals[i] as f64;

            tmp_o2[i] = (chem.o2[i] as f64 + diff_rate * lap_o2) as f32;
            tmp_tox[i] = (chem.toxin[i] as f64 + diff_rate * lap_tox * 0.5) as f32;
            tmp_min[i] = (chem.minerals[i] as f64 + diff_rate * lap_min * 0.3) as f32;
        }
    }

    for i in 0..n {
        let plant_o2 = food_field[i] as f64 * daylight * 0.001;
        let decay_o2 = chem.o2[i] as f64 * 0.0005;
        chem.o2[i] = (tmp_o2[i] as f64 + plant_o2 - decay_o2).max(0.0).min(1.0) as f32;

        let ph_drift = (PH_NEUTRAL as f64 - chem.ph[i] as f64) * 0.0002;
        let acid_input = chem.toxin[i] as f64 * 0.001;
        chem.ph[i] = (chem.ph[i] as f64
            + (ph_drift - acid_input + (season_moisture - 0.5) * 0.0001) * dt)
            as f32;
        chem.ph[i] = chem.ph[i].max(3.0).min(11.0);

        let meat_toxin = meat_field[i] as f64 * 0.0005;
        chem.toxin[i] = (tmp_tox[i] as f64 + meat_toxin).max(0.0).min(1.0) as f32;

        let weathering = MINERAL_ION_RATE as f64 * dt;
        let plant_uptake = if food_field[i] > 0.0 {
            0.0002 * dt
        } else {
            0.0
        };
        chem.minerals[i] = (tmp_min[i] as f64 + weathering - plant_uptake)
            .max(0.0)
            .min(1.0) as f32;

        let acid_bonus = (PH_NEUTRAL as f64 - chem.ph[i] as f64).max(0.0) * 0.0001;
        chem.minerals[i] = (chem.minerals[i] as f64 + acid_bonus).min(1.0) as f32;
    }
}
