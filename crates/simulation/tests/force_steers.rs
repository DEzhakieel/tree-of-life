use fractal_life_shared::constants::{CHEM_OFFSET, GENOME_SIZE};
use fractal_life_shared::types::{WorldConfig, WorldParams};
use fractal_life_simulation::engine::Engine;

fn world(biophysics: bool) -> WorldConfig {
    WorldConfig {
        id: "force-steer".to_string(),
        seed: "force-steer-seed".to_string(),
        fractal_type: "julia",
        params: WorldParams {
            spawn_count: 6,
            ..WorldParams::default()
        },
        created_at: 0.0,
        current_tick: 0,
        universe: None,
        cell_bio: None,
        biophysics: if biophysics { Some(true) } else { None },
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

/// Phase 2 wiring proof: the Lennard-Jones force pass must ACT on movement.
///
/// Two alive agents are pinned 3 world-units apart (deep inside the repulsion
/// well, radius < FORCE_REP_SIGMA) with everything else isolated far away.
/// With `biophysics` on, the applied force must push the pair apart over a
/// handful of ticks; with the flag off the legacy motion must barely move them.
#[test]
fn force_field_steers_two_agents_apart() {
    fn build(biophysics: bool) -> Engine {
        let mut e = Engine::new(world(biophysics));
        let ids: Vec<u32> = e.agents.keys().copied().collect();
        assert!(ids.len() >= 2, "expected spawned agents, got {}", ids.len());
        // affinity gene fixed so the repulsion strength is predictable
        for id in &ids {
            let a = e.agents.get_mut(id).unwrap();
            if a.genome.len() < GENOME_SIZE {
                a.genome.resize(GENOME_SIZE, 0.0);
            }
            a.genome[CHEM_OFFSET] = 0.5;
            a.energy = 1.0e6;
            a.water = 1.0e6;
            a.age = 1.0;
            a.alive = true;
            a.vx = 0.0;
            a.vy = 0.0;
        }
        let mut iter = ids.iter();
        let i0 = *iter.next().unwrap();
        let i1 = *iter.next().unwrap();
        {
            let a0 = e.agents.get_mut(&i0).unwrap();
            a0.x = 544.0;
            a0.y = 548.0;
        }
        {
            let a1 = e.agents.get_mut(&i1).unwrap();
            a1.x = 544.0;
            a1.y = 551.0;
        }
        // park every other agent far outside the force cutoff
        for (k, id) in iter.enumerate() {
            let a = e.agents.get_mut(id).unwrap();
            a.x = 1200.0 + (k as f64) * 40.0;
            a.y = 1200.0 + (k as f64) * 40.0;
        }
        e
    }

    fn separation(e: &Engine, i0: u32, i1: u32) -> f64 {
        let a0 = e.agents.get(&i0).unwrap();
        let a1 = e.agents.get(&i1).unwrap();
        (a1.y - a0.y).abs()
    }

    let mut off = build(false);
    let mut on = build(true);
    let (i0, i1) = {
        let ids: Vec<u32> = off.agents.keys().copied().collect();
        (ids[0], ids[1])
    };

    assert_eq!(separation(&off, i0, i1), 3.0);
    for _ in 0..12 {
        off.tick();
        on.tick();
    }
    let sep_off = separation(&off, i0, i1);
    let sep_on = separation(&on, i0, i1);

    eprintln!("sep_off={sep_off}  sep_on={sep_on}");
    assert!(
        sep_on > sep_off,
        "forces should widen the gap: on={sep_on} off={sep_off}"
    );
    assert!(
        sep_on > 4.0,
        "repulsion should visibly push the pair apart, got {sep_on}"
    );
}
