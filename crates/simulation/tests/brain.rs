use fractal_life_shared::constants::{
    BRAIN_OFFSET, GENOME_SIZE, MLP_HIDDEN, MLP_OUTPUTS, MLP_WEIGHTS,
};
use fractal_life_shared::types::{WorldConfig, WorldParams};
use fractal_life_simulation::brain::{self, BrainConfig};
use fractal_life_simulation::engine::Engine;
use fractal_life_simulation::rng::SplitMix64;

fn world(seed: &str) -> WorldConfig {
    WorldConfig {
        id: "test".to_string(),
        seed: seed.to_string(),
        fractal_type: "julia",
        params: WorldParams {
            spawn_count: 60,
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

fn genome(seed: u64) -> Vec<f32> {
    let mut rng = SplitMix64::new(seed);
    (0..GENOME_SIZE)
        .map(|_| rng.next_float() * 2.0 - 1.0)
        .collect()
}

fn engine(seed: &str) -> Engine {
    let mut e = Engine::new(world(seed));
    e.set_brain_config(BrainConfig::default());
    e
}

/// Forward pass is deterministic: two identical brains + same sensors => same outputs.
#[test]
fn forward_is_deterministic() {
    let cfg = BrainConfig::default();
    let g = genome(42);
    let mut b1 = brain::seed_brain(&g, &cfg);
    let mut b2 = brain::seed_brain(&g, &cfg);
    let sensors = [
        0.1, 0.5, -0.2, 0.8, 0.0, 0.3, 1.0, 0.1, 0.7, -0.4, 0.2, 0.9, -0.8, 0.4, 0.3,
    ];
    let mut h1 = [0.0f32; MLP_HIDDEN];
    let mut h2 = [0.0f32; MLP_HIDDEN];
    let mut o1 = [0.0f32; MLP_OUTPUTS];
    let mut o2 = [0.0f32; MLP_OUTPUTS];
    let v1 = brain::forward_plastic(&mut b1, &sensors, &mut h1, &mut o1);
    let v2 = brain::forward_plastic(&mut b2, &sensors, &mut h2, &mut o2);
    assert_eq!(v1, v2);
    for i in 0..MLP_OUTPUTS {
        assert_eq!(o1[i], o2[i], "output {} diverged", i);
    }
    for i in 0..MLP_HIDDEN {
        assert_eq!(h1[i], h2[i], "hidden {} diverged", i);
    }
}

/// Learning changes the weights: after observing a reward (nonzero TD), the
/// plastic output layer must drift from the genome template.
#[test]
fn observe_changes_weights() {
    let cfg = BrainConfig {
        enabled: true,
        lr_override: Some(0.05),
        gamma_override: None,
        lambda_override: Some(0.9),
        inherit_override: None,
        ..BrainConfig::default()
    };
    let g = genome(7);
    let mut b = brain::seed_brain(&g, &cfg);
    let before: Vec<f32> = b.w.into();
    let sensors = [
        0.1, -0.5, 0.3, 0.8, 0.0, 0.3, 1.0, 0.1, 0.7, -0.4, 0.2, 0.9, -0.8, 0.4, 0.3,
    ];
    let mut h = [0.0f32; MLP_HIDDEN];
    let mut o = [0.0f32; MLP_OUTPUTS];
    let v = brain::forward_plastic(&mut b, &sensors, &mut h, &mut o);
    assert_eq!(b.last_reward, 0.0);
    let surprise = brain::observe(&mut b, 0.05, v, &h, &o);
    assert!(
        surprise > 0.0,
        "positive reward vs zero prior value must surprise"
    );
    let after = b.w;
    let mut changed = 0;
    for (a, c) in before.iter().zip(after.iter()) {
        if (a - c).abs() > 1e-6 {
            changed += 1;
        }
    }
    assert!(changed > 0, "no weights moved after a learning step");
    // weights stay clamped in [-2, 2]
    for &w in after.iter() {
        assert!((-2.0..=2.0).contains(&w), "weight out of range: {w}");
    }
}

/// Heredity: with inherit=1 the child's brain is the parent's brain; with
/// inherit=0 it falls back to the child's own genome template (no transfer).
#[test]
fn heredity_alpha_controls_transfer() {
    let cfg0 = BrainConfig {
        enabled: true,
        lr_override: Some(0.05),
        gamma_override: None,
        lambda_override: None,
        inherit_override: Some(0.0),
        ..BrainConfig::default()
    };
    let cfg1 = BrainConfig {
        enabled: true,
        lr_override: Some(0.05),
        gamma_override: None,
        lambda_override: None,
        inherit_override: Some(1.0),
        ..BrainConfig::default()
    };
    let parent_g = genome(1);
    let child_g = genome(2);
    let mut parent = brain::seed_brain(&parent_g, &cfg0);
    let sensors = [
        0.5, 0.1, -0.3, 0.9, 0.2, 0.0, 0.6, 0.4, 0.3, -0.1, 0.8, 0.1, -0.5, 0.2, 0.7,
    ];
    let mut h = [0.0f32; MLP_HIDDEN];
    let mut o = [0.0f32; MLP_OUTPUTS];
    let v = brain::forward_plastic(&mut parent, &sensors, &mut h, &mut o);
    brain::observe(&mut parent, 0.04, v, &h, &o);

    // alpha = 1: child synapses == parent synapses (up to fp rounding).
    let child1 = brain::spawn_brain(&parent, &child_g, &cfg1);
    for i in 0..MLP_WEIGHTS {
        assert!(
            (child1.w[i] - parent.w[i]).abs() < 1e-6,
            "alpha=1 must fully inherit at gene {i}"
        );
    }
    // alpha = 0: child synapses == child's own template (no learned transfer).
    let child0 = brain::spawn_brain(&parent, &child_g, &cfg0);
    for i in 0..MLP_WEIGHTS {
        assert_eq!(
            child0.w[i],
            child_g[BRAIN_OFFSET + i],
            "alpha=0 must reset to template at gene {i}"
        );
    }
}

/// Full-engine determinism with plastic brains enabled: two identical engines
/// tick identically, and enabling the brain changes the trajectory from the
/// static-genome baseline.
#[test]
fn engine_with_brain_is_deterministic_and_changes_trajectory() {
    let mut a = engine("brain-det");
    let mut b = engine("brain-det");
    let mut base = Engine::new(world("brain-det"));
    base.set_brain_config(BrainConfig {
        enabled: false,
        ..BrainConfig::default()
    });
    for _ in 0..240 {
        a.tick();
        b.tick();
        base.tick();
    }
    assert_eq!(a.current_tick(), 240);
    assert_eq!(
        a.compute_state_hash_value(),
        b.compute_state_hash_value(),
        "plastic brains must not break determinism"
    );
    assert_eq!(a.alive_count(), b.alive_count());
    // The plastic brain (surprise-modulated updates) must alter the dynamical
    // trajectory relative to the fixed-genome baseline.
    assert_ne!(
        a.compute_state_hash_value(),
        base.compute_state_hash_value(),
        "plastic brain must change the trajectory"
    );
}

/// Brain genes are read defensively: a genome shorter than GENOME_SIZE (a
/// pre-brain persisted world) still yields a working brain without panicking.
#[test]
fn short_genome_pads_to_zero() {
    let cfg = BrainConfig::default();
    let short = vec![0.3f32; 192];
    let b = brain::seed_brain(&short, &cfg);
    // plasticity + recurrent + critic slots read 0 -> defaults
    assert_eq!(b.rec[0], 0.0);
    assert_eq!(b.cv[0], 0.0);
    assert_eq!(b.cb, 0.0);
    let _ = brain::spawn_brain(&b, &short, &cfg);
}

/// Brain telemetry: over a run, at least one agent usually learns something
/// (the surprise accumulator runs), and the stats survive the whole pipeline.
#[test]
fn brain_stats_shape() {
    let mut e = engine("brain-tel");
    for _ in 0..120 {
        e.tick();
    }
    let (mean_plasticity, mean_surprise, plastic_agents) = e.brain_stats();
    assert!(mean_plasticity >= 0.0);
    assert!(mean_surprise >= 0.0);
    assert!((0.0..=1.0).contains(&plastic_agents));
}
