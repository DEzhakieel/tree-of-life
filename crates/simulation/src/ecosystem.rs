use fractal_life_shared::constants::{TERRAIN_CELL, TERRAIN_GRID};

#[derive(Clone, Debug, Default)]
pub struct EcosystemGenes {
    pub niche_specialization: f64,
    pub competitive_ability: f64,
    pub mutualism: f64,
    pub parasitism: f64,
    pub migration: f64,
    pub territoriality: f64,
    pub keystone: f64,
    pub invasiveness: f64,
}

#[repr(u8)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TrophicLevel {
    Producer = 0,
    PrimaryConsumer = 1,
    SecondaryConsumer = 2,
    TertiaryConsumer = 3,
    Decomposer = 4,
}

pub fn assign_trophic_level(diet: f64, aggression: f64) -> TrophicLevel {
    if aggression > 0.7 && diet > 0.6 {
        return TrophicLevel::TertiaryConsumer;
    }
    if aggression > 0.5 || diet > 0.5 {
        return TrophicLevel::SecondaryConsumer;
    }
    if diet > 0.3 {
        return TrophicLevel::PrimaryConsumer;
    }
    if diet < 0.15 {
        return TrophicLevel::Decomposer;
    }
    TrophicLevel::Producer
}

const RESOURCE_SLOTS: usize = 4;

pub struct EcosystemGrid {
    pub data: Vec<f32>,
    pub width: usize,
    pub height: usize,
}

pub fn create_ecosystem_grid() -> EcosystemGrid {
    EcosystemGrid {
        data: vec![0.0; TERRAIN_GRID * TERRAIN_GRID * RESOURCE_SLOTS],
        width: TERRAIN_GRID,
        height: TERRAIN_GRID,
    }
}

pub struct AgentInfo {
    pub x: f64,
    pub y: f64,
    pub alive: bool,
    pub energy: f64,
    pub trophic_level: u8,
}

pub fn update_ecosystem_grid(grid: &mut EcosystemGrid, agents: &[AgentInfo], dt: f64) {
    // Decay
    for v in grid.data.iter_mut() {
        *v = (*v as f64 * 0.998) as f32;
    }
    // Plant growth
    for gy in 0..grid.height {
        for gx in 0..grid.width {
            let pi = (gy * grid.width + gx) * RESOURCE_SLOTS;
            grid.data[pi] = (grid.data[pi] as f64 + 0.001 * dt).min(1.0) as f32;
        }
    }
    // Agent contributions
    for a in agents {
        if !a.alive {
            continue;
        }
        let gx = ((a.x / TERRAIN_CELL as f64) as usize) % grid.width;
        let gy = ((a.y / TERRAIN_CELL as f64) as usize) % grid.height;
        let base = (gy * grid.width + gx) * RESOURCE_SLOTS;
        match a.trophic_level {
            0 => {
                grid.data[base] = (grid.data[base] as f64 + a.energy * 0.0001 * dt).min(1.0) as f32
            }
            1 => {
                grid.data[base + 1] =
                    (grid.data[base + 1] as f64 + a.energy * 0.0002 * dt).min(1.0) as f32
            }
            2 | 3 => {
                grid.data[base + 2] =
                    (grid.data[base + 2] as f64 + a.energy * 0.0002 * dt).min(1.0) as f32
            }
            4 => {
                grid.data[base + 3] =
                    (grid.data[base + 3] as f64 + a.energy * 0.0001 * dt).min(1.0) as f32
            }
            _ => {}
        }
    }
}

pub struct LocalResources {
    pub plant_biomass: f32,
    pub herbivore_density: f32,
    pub carnivore_density: f32,
    pub decomposer_activity: f32,
}

pub fn get_local_resources(grid: &EcosystemGrid, x: f64, y: f64) -> LocalResources {
    let gx = ((x / TERRAIN_CELL as f64) as usize) % grid.width;
    let gy = ((y / TERRAIN_CELL as f64) as usize) % grid.height;
    let base = (gy * grid.width + gx) * RESOURCE_SLOTS;
    LocalResources {
        plant_biomass: grid.data[base],
        herbivore_density: grid.data[base + 1],
        carnivore_density: grid.data[base + 2],
        decomposer_activity: grid.data[base + 3],
    }
}

pub fn carrying_capacity(trophic_level: u8, res: &LocalResources) -> f32 {
    match trophic_level {
        0 => 20.0 + res.plant_biomass * 80.0,
        1 => 10.0 + res.plant_biomass * 40.0,
        2 => 5.0 + res.herbivore_density * 30.0,
        3 => 2.0 + res.carnivore_density * 10.0,
        4 => 8.0 + res.decomposer_activity * 40.0,
        _ => 10.0,
    }
}

pub fn biodiversity_index(population_counts: &[f32]) -> f32 {
    let total: f32 = population_counts.iter().sum();
    if total == 0.0 {
        return 0.0;
    }
    let mut h = 0.0f32;
    for &c in population_counts {
        if c <= 0.0 {
            continue;
        }
        let p = c / total;
        h -= p * p.ln();
    }
    let max_h = (population_counts.len() as f32).ln();
    if max_h > 0.0 {
        h / max_h
    } else {
        0.0
    }
}
