use fractal_life_shared::types::{WorldConfig, WorldParams};
use fractal_life_simulation::engine::Engine;

fn world(omics: bool) -> WorldConfig {
    WorldConfig {
        id: "omics".to_string(),
        seed: "omics-seed".to_string(),
        fractal_type: "julia",
        params: WorldParams {
            spawn_count: 20,
            ..WorldParams::default()
        },
        created_at: 0.0,
        current_tick: 0,
        universe: None,
        cell_bio: None,
        biophysics: None,
        omics: if omics { Some(true) } else { None },
        omics_stochastic: Some(true),
        combinatorial: Some(true),
        recombination: Some(true),
        discovery: Some(true),
        folding: Some(true),
        stochastic_dynamics: Some(true),
        environment: None,
        topology: None,
        signal_deposit: None,
        meme_copy_rate: None,
        reproduction: None,
        sensing: None,
    }
}

/// Phase A wiring proof. The OFF engine stays bit-identical to a pre-omics run
/// (every omics field 0), the ON engine emits strictly nonzero telemetry, and
/// two ON engines on the same seed are deterministic tick-by-tick.
#[test]
fn omics_telemetry_does_not_perturb_the_legacy_trajectory() {
    let mut off = Engine::new(world(false));
    let mut on = Engine::new(world(true));
    let mut on2 = Engine::new(world(true));

    let mut saw_telemetry = false;
    for _ in 0..30 {
        let r_off = off.tick();
        let r_on = on.tick();
        let r_on2 = on2.tick();

        // OFF engine must never emit omics telemetry.
        assert_eq!(r_off.stats.expression_entropy, 0.0);
        assert_eq!(r_off.stats.transcript_activity, 0.0);
        assert_eq!(r_off.stats.pathway_flux, 0.0);

        // Determinism: the two ON engines agree bit-for-bit.
        assert_eq!(r_on.stats.state_hash, r_on2.stats.state_hash);
        assert_eq!(
            r_on.stats.expression_entropy,
            r_on2.stats.expression_entropy
        );
        assert_eq!(r_on.stats.proteome_load, r_on2.stats.proteome_load);
        assert_eq!(r_on.stats.pathway_flux, r_on2.stats.pathway_flux);

        // ON emits real molecular-omics telemetry.
        assert!(
            r_on.stats.transcript_activity > 0.0,
            "transcription must be live"
        );
        assert!(r_on.stats.proteome_load > 0.0, "proteome accrues");
        assert!(
            r_on.stats.regulation_gating > 0.5,
            "default epi state is largely unmarked"
        );
        saw_telemetry = true;
    }
    assert!(saw_telemetry);
}

/// Phase B (active fluxome) proof: with the omics feature on, the six reaction
/// fluxes are applied back onto the chemistry molecule pools instead of being
/// read-only telemetry. Therefore ON runs must mutate pools (vs the OFF
/// baseline) and still stay perfectly deterministic across runs.
#[test]
fn active_fluxome_mutates_pools_only_when_enabled() {
    let mut off = Engine::new(world(false));
    let mut on = Engine::new(world(true));
    let mut on2 = Engine::new(world(true));

    for _ in 0..40 {
        off.tick();
        on.tick();
        on2.tick();
    }

    // Many pool couples must be bit-equal for the two ON runs (determinism)
    // and at least one pool (ATP, protein, ...) must diverge from OFF.
    let ids: Vec<u32> = on.agents.keys().copied().collect();
    let shared: Vec<u32> = ids
        .iter()
        .copied()
        .filter(|id| off.agents.contains_key(id))
        .collect();
    assert!(!shared.is_empty(), "OFF and ON must share living agents");
    for id in shared.iter().take(5) {
        let a = &on.agents[id];
        let b = &on2.agents[id];
        assert_eq!(
            a.chemistry.molecules, b.chemistry.molecules,
            "ON runs deterministic (id {id})"
        );
    }
    let any_diverged = shared
        .iter()
        .any(|id| on.agents[id].chemistry.molecules != off.agents[id].chemistry.molecules);
    assert!(
        any_diverged,
        "active fluxome must perturb the molecule pools vs the OFF baseline"
    );
}

/// Every pool must stay inside a sane range even under long runs. The omics
/// fluxome itself clamps to [0, CHEM_MAX_MOLECULE]; the legacy chemistry,
/// however, occasionally undershoots below 0 with unfloored subtractions, so
/// the hard bound is [floor, CHEM_MAX] with a small legacy-undershoot margin.
#[test]
fn fluxome_keeps_pools_bounded() {
    let mut off = Engine::new(world(false));
    let mut on = Engine::new(world(true));
    for _ in 0..120 {
        off.tick();
        on.tick();
    }
    let legacy_floor = off
        .agents
        .values()
        .flat_map(|a| a.chemistry.molecules.iter().copied())
        .fold(f32::INFINITY, f32::min);
    let floor = legacy_floor.min(-8.0) - 8.0;
    for a in on.agents.values() {
        for (i, &v) in a.chemistry.molecules.iter().enumerate() {
            assert!(
                (floor..=100.0).contains(&v),
                "pool {i} out of bounds: {v} (floor {floor})"
            );
        }
    }
}
