use fractal_life_shared::types::{WorldConfig, WorldParams};
use fractal_life_simulation::engine::Engine;

// Decoupling simulation time from render time.
//
// `Engine::set_record_delta(false)` suppresses the per-agent MT_DELTA frame that
// `tick` would otherwise build. The simulation must be completely unaffected:
// the whole point is to run the same trajectory faster when nobody is watching.
// These tests pin that invariant, plus the fact that the default is still
// `true` so every other test, trace and the TS<->WASM parity harness keep
// seeing byte-identical frames.

fn world(seed: &str, spawn: usize) -> WorldConfig {
    WorldConfig {
        id: "rd".to_string(),
        seed: seed.to_string(),
        fractal_type: "julia",
        params: WorldParams {
            spawn_count: spawn,
            ..WorldParams::default()
        },
        created_at: 0.0,
        current_tick: 0,
        universe: None,
        cell_bio: None,
        biophysics: None,
        omics: Some(true),
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

/// Run `ticks` ticks and return the full observable agent table, so two engines
/// can be compared field-by-field (including bit patterns of the floats).
fn run(seed: &str, spawn: usize, ticks: u32, record: bool) -> Vec<AgentStateRow> {
    let mut e = Engine::new(world(seed, spawn));
    e.set_record_delta(record);
    for _ in 0..ticks {
        e.tick();
    }
    e.all_agent_states()
        .into_iter()
        .map(|a| AgentStateRow {
            id: a.id,
            x: a.x,
            y: a.y,
            energy: a.energy,
            state: a.state,
            species: a.species,
            meme: a.meme,
        })
        .collect()
}

#[derive(Clone, Copy, PartialEq, Debug)]
struct AgentStateRow {
    id: u32,
    x: f64,
    y: f64,
    energy: f32,
    state: u8,
    species: u32,
    meme: f32,
}

#[test]
fn suppressing_the_delta_frame_does_not_change_the_trajectory() {
    // long enough to cover births, deaths and fractal escapes
    for (seed, spawn, ticks) in [
        ("rd-a", 40usize, 60u32),
        ("rd-b", 120, 120),
        ("rd-c", 8, 200),
    ] {
        let with = run(seed, spawn, ticks, true);
        let without = run(seed, spawn, ticks, false);
        assert_eq!(
            with, without,
            "record_delta=false diverged the simulation for seed {seed} ({spawn} agents, {ticks} ticks)"
        );
        assert!(
            !with.is_empty(),
            "seed {seed} produced no agents to compare"
        );
    }
}

#[test]
fn record_delta_defaults_to_true_and_is_togglable() {
    let mut e = Engine::new(world("rd-default", 10));
    assert!(
        e.record_delta(),
        "default must stay true to preserve parity"
    );

    let before = e.tick();
    assert!(before.delta_count > 0, "default engine must emit a frame");
    assert!(before.delta.len() > 7, "frame should carry agent payloads");

    e.set_record_delta(false);
    assert!(!e.record_delta());
    let after = e.tick();
    assert_eq!(after.delta_count, 0, "no agent writes expected");
    assert_eq!(
        after.delta.len(),
        7,
        "header only: type + tick + count placeholder"
    );

    // toggling back on must resume immediately, mid-stream
    e.set_record_delta(true);
    let resumed = e.tick();
    assert!(resumed.delta_count > 0, "re-enabling must resume the frame");
}

#[test]
fn suppressed_frames_still_advance_tick_number() {
    let mut e = Engine::new(world("rd-tick", 5));
    e.set_record_delta(false);
    let start = e.current_tick();
    for _ in 0..25 {
        e.tick();
    }
    assert_eq!(e.current_tick(), start + 25);
}
