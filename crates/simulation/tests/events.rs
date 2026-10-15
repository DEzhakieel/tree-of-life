//! Event emission: typed payloads on the wire shape shared with the TS engine
//! (`packages/shared` SimEvent), take semantics for the returned buffer, and
//! the emission-side event policy filter.

use fractal_life_shared::types::{
    DeathCause, Intervention, InterventionType, WorldConfig, WorldParams,
};
use fractal_life_simulation::engine::Engine;

fn world(seed: &str, spawn_count: usize) -> WorldConfig {
    WorldConfig {
        id: "events".to_string(),
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

fn iv(itype: InterventionType, sequence: u32) -> Intervention {
    Intervention {
        itype,
        x: Some(512.0),
        y: Some(512.0),
        radius: Some(32.0),
        amount: None,
        ticks: None,
        genome: None,
        time_scale: None,
        agent_id: None,
        index: None,
        value: None,
        sequence,
    }
}

#[test]
fn death_events_carry_typed_payloads() {
    let mut e = Engine::new(world("death", 60));
    let mut deaths = 0u32;
    for _ in 0..300 {
        let r = e.tick();
        for ev in &r.events {
            if ev.etype == "death" {
                deaths += 1;
                assert_eq!(
                    ev.data.cause.is_some(),
                    true,
                    "death event must record a cause"
                );
                assert!(ev.data.agent_id.is_some());
                assert!(ev.data.species.is_some());
                assert!(ev.data.x.is_some() && ev.data.y.is_some());
                assert!(ev.data.age.is_some());
                if ev.data.cause == Some(DeathCause::Predation) {
                    if let Some(killer) = ev.data.killer_id {
                        assert!(killer >= 0);
                    }
                }
            }
        }
    }
    assert!(deaths > 0, "expected at least one death in 300 ticks");
}

#[test]
fn birth_events_carry_parent_attribution() {
    let mut e = Engine::new(world("birth", 80));
    let mut births = 0u32;
    for _ in 0..600 {
        let r = e.tick();
        for ev in &r.events {
            if ev.etype == "birth" {
                births += 1;
                assert!(ev.data.agent_id.is_some());
                assert!(ev.data.parent_id.is_some());
                assert!(ev.data.species.is_some());
                assert!(ev.data.energy.is_some());
            }
        }
    }
    assert!(births > 0, "expected at least one birth in 600 ticks");
}

#[test]
fn intervention_events_arrive_with_the_next_tick() {
    let mut e = Engine::new(world("iv", 30));
    e.tick();
    e.apply_intervention(&iv(InterventionType::Meteor, 1));
    let r = e.tick();
    let ivs: Vec<_> = r
        .events
        .iter()
        .filter(|ev| ev.etype == "intervention")
        .collect();
    assert_eq!(
        ivs.len(),
        1,
        "intervention applied between ticks must be delivered"
    );
    assert_eq!(ivs[0].data.itype, Some("meteor"));
    assert_eq!(ivs[0].data.x, Some(512.0));
    assert_eq!(ivs[0].data.y, Some(512.0));
    assert!(ivs[0].significance > 0.0 && ivs[0].significance <= 1.0);
}

#[test]
fn event_policy_filters_emission() {
    let mut e = Engine::new(world("policy", 40));
    e.set_event_policy(Some(vec!["intervention".to_string()]));
    for _ in 0..150 {
        let r = e.tick();
        for ev in &r.events {
            assert_eq!(
                ev.etype, "intervention",
                "non-included event types must not be emitted"
            );
        }
    }
    e.apply_intervention(&iv(InterventionType::Nuke, 1));
    let r = e.tick();
    assert!(r
        .events
        .iter()
        .any(|ev| ev.etype == "intervention" && ev.data.itype == Some("nuke")));
}

#[test]
fn emitted_events_are_policy_free_by_default() {
    let mut e = Engine::new(world("default-policy", 60));
    e.apply_intervention(&iv(InterventionType::SeedFood, 1));
    let mut seen_intervention = false;
    let mut seen_death = false;
    for _ in 0..50 {
        let r = e.tick();
        for ev in &r.events {
            seen_intervention |= ev.etype == "intervention";
            seen_death |= ev.etype == "death";
        }
    }
    assert!(
        seen_intervention,
        "default policy must not filter interventions"
    );
    assert!(seen_death, "default policy must not filter deaths");
}
