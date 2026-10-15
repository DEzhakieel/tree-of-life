//! setGene + spawnAgent genome semantics Ã¢â‚¬â€ must mirror the TS engine
//! (apps/simulation/test/genomeDesign.test.ts) and the shared zod schema.
use fractal_life_shared::constants::GENOME_SIZE;
use fractal_life_shared::types::{Intervention, InterventionType, WorldConfig, WorldParams};
use fractal_life_simulation::agent::SimAgent;
use fractal_life_simulation::engine::Engine;

fn world(seed: &str, spawn_count: usize) -> WorldConfig {
    WorldConfig {
        id: "setgene".to_string(),
        seed: seed.to_string(),
        fractal_type: "julia",
        params: WorldParams {
            spawn_count,
            ..WorldParams::default()
        },
        created_at: 0.0,
        current_tick: 0,
        universe: None,
        cell_bio: None,
        biophysics: None,
        omics: None,
        omics_stochastic: None,
        combinatorial: None,
        recombination: None,
        discovery: None,
        folding: None,
        stochastic_dynamics: None,
        environment: None,
        topology: None,
        signal_deposit: None,
        meme_copy_rate: None,
        reproduction: None,
        sensing: None,
    }
}

fn exact_genome() -> Vec<f32> {
    (0..GENOME_SIZE)
        .map(|i| (i as f32 * 0.37_f32).sin() * 0.8)
        .collect()
}

fn spawn(iv_type: InterventionType) -> Intervention {
    Intervention {
        itype: iv_type,
        x: Some(512.0),
        y: Some(512.0),
        radius: Some(4.0),
        amount: None,
        ticks: None,
        genome: None,
        time_scale: None,
        agent_id: None,
        index: None,
        value: None,
        sequence: 0,
    }
}

fn latest_alive(e: &Engine, from_id: u32) -> &SimAgent {
    e.agents
        .values()
        .filter(|a| a.alive && a.id >= from_id)
        .max_by_key(|a| a.id)
        .expect("spawned agent exists")
}

fn first_alive(e: &Engine) -> u32 {
    e.agents.values().find(|a| a.alive).expect("alive agent").id
}

fn set_gene(e: &mut Engine, agent_id: Option<u32>, index: Option<u32>, value: Option<f32>) {
    let mut iv = spawn(InterventionType::SetGene);
    iv.agent_id = agent_id;
    iv.index = index;
    iv.value = value;
    e.apply_intervention(&iv);
}

#[test]
fn exact_217_genome_passes_through() {
    let mut e = Engine::new(world("full", 20));
    let g = exact_genome();
    let mut iv = spawn(InterventionType::SpawnAgent);
    iv.genome = Some(g.clone());
    e.apply_intervention(&iv);
    let a = latest_alive(&e, 20);
    assert_eq!(a.genome.len(), GENOME_SIZE);
    assert_eq!(a.genome, g);
}

#[test]
fn partial_genome_head_patches_over_deterministic_base() {
    fn run(seed: &str) -> Vec<f32> {
        let mut e = Engine::new(world(seed, 4));
        let mut iv = spawn(InterventionType::SpawnAgent);
        iv.genome = Some(vec![0.9, -0.9, 0.1, -0.1, 0.5]);
        e.apply_intervention(&iv);
        latest_alive(&e, 4).genome.clone()
    }
    let a = run("same");
    let b = run("same");
    assert_eq!(a.len(), GENOME_SIZE);
    assert_eq!(b.len(), GENOME_SIZE);
    assert_eq!(a, b, "base genes are deterministic for the same seed");
    assert_eq!(&a[0..5], &[0.9, -0.9, 0.1, -0.1, 0.5], "prefix patched");
    let c = run("other-seed");
    assert_ne!(&a[5..], &c[5..], "base differs across seeds");
}

#[test]
fn missing_genome_falls_back_to_random_deterministically() {
    fn run(seed: &str) -> Vec<f32> {
        let mut e = Engine::new(world(seed, 4));
        e.apply_intervention(&spawn(InterventionType::SpawnAgent));
        latest_alive(&e, 4).genome.clone()
    }
    let a = run("rand");
    let b = run("rand");
    assert_eq!(a, b);
    let c = run("rand-other");
    assert_ne!(a, c, "different seed Ã¢â€ â€™ different random genome");
}

#[test]
fn set_gene_rewrites_template_clamped() {
    let mut e = Engine::new(world("edit", 8));
    let id = first_alive(&e);
    let idx = 130_u32;
    let before = e.agents[&id].genome[idx as usize];

    set_gene(&mut e, Some(id), Some(idx), Some(0.75));
    assert_eq!(e.agents[&id].genome[idx as usize], 0.75);
    assert_ne!(before, 0.75);

    set_gene(&mut e, Some(id), Some(idx), Some(5.0));
    assert_eq!(e.agents[&id].genome[idx as usize], 1.0, "clamped high");

    set_gene(&mut e, Some(id), Some(idx), Some(-5.0));
    assert_eq!(e.agents[&id].genome[idx as usize], -1.0, "clamped low");
}

#[test]
fn set_gene_ignores_dead_agents_and_bad_indices() {
    let mut e = Engine::new(world("edit2", 8));
    let id = first_alive(&e);
    let idx = 130_u32;
    let orig = e.agents[&id].genome[idx as usize];

    set_gene(&mut e, Some(id), Some(GENOME_SIZE as u32), Some(0.5)); // oob index
    assert_eq!(e.agents[&id].genome[idx as usize], orig);
    set_gene(&mut e, Some(u32::MAX), Some(idx), Some(0.5)); // unknown agent
    assert_eq!(e.agents[&id].genome[idx as usize], orig);
    set_gene(&mut e, Some(id), Some(idx), None); // missing value
    assert_eq!(e.agents[&id].genome[idx as usize], orig);

    e.agents.get_mut(&id).unwrap().alive = false;
    set_gene(&mut e, Some(id), Some(idx), Some(0.5)); // dead agent
    assert_eq!(e.agents[&id].genome[idx as usize], orig);
}
