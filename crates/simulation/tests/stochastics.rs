use fractal_life_shared::constants::{
    GENOME_SIZE, MLP_HIDDEN, MLP_INPUTS, MLP_OUTPUTS, MLP_WEIGHTS,
};
use fractal_life_shared::types::{WorldConfig, WorldParams};
use fractal_life_simulation::brain::{
    self, BackpropOpts, BrainConfig, LearnRule, PolicyConfig, PolicyMode, PomdpConfig,
    DEFAULT_POMDP_HIDDEN, POMDP_BELIEF,
};
use fractal_life_simulation::engine::Engine;
use fractal_life_simulation::rng::SplitMix64;
use fractal_life_simulation::world_stoch::{self, WorldStochasticConfig};

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

fn sensors15() -> [f32; MLP_INPUTS] {
    [
        0.1, -0.5, 0.3, 0.8, 0.0, 0.3, 1.0, 0.1, 0.7, -0.4, 0.2, 0.9, -0.8, 0.4, 0.3,
    ]
}

/// Weather chain: deterministic for a seed, bounded to the state set, and its
/// moisture/growth outputs always match the declared per-state tables.
#[test]
fn step_weather_is_deterministic_and_stays_valid() {
    let mut s1 = world_stoch::create_world_stoch_state(4);
    let mut s2 = world_stoch::create_world_stoch_state(4);
    let m = world_stoch::DEFAULT_WEATHER_MATRIX;
    let mut r1 = SplitMix64::new(123);
    let mut r2 = SplitMix64::new(123);
    let mut moved = false;
    for _ in 0..200 {
        world_stoch::step_weather(&mut s1, &mut r1, &m);
        world_stoch::step_weather(&mut s2, &mut r2, &m);
        assert_eq!(s1.weather, s2.weather, "weather must be seed-deterministic");
        assert!(s1.weather < 4);
        assert_eq!(
            s1.weather_moisture,
            world_stoch::WEATHER_MOISTURE[s1.weather]
        );
        assert_eq!(s1.weather_growth, world_stoch::WEATHER_GROWTH[s1.weather]);
        if s1.weather != 0 {
            moved = true;
        }
    }
    // with the default matrix, staying in state 0 for 200 steps has probability
    // 0.85^200 ~ 5e-15 Ã¢â‚¬â€ so this seed must have left the initial state.
    assert!(
        moved,
        "weather chain must not stay locked in the initial state"
    );
}

/// Poisson event count: deterministic under a seed, non-negative, and ~0 when
/// the rate is vanishingly small.
#[test]
fn poisson_draw_is_deterministic_and_zero_for_tiny_lambda() {
    let mut r1 = SplitMix64::new(7);
    let mut r2 = SplitMix64::new(7);
    for _ in 0..50 {
        let a = world_stoch::poisson_draw(&mut r1, 40.0);
        let b = world_stoch::poisson_draw(&mut r2, 40.0);
        assert_eq!(a, b, "poisson draw must be seed-deterministic");
        assert!(a <= 999);
    }
    let mut r = SplitMix64::new(11);
    assert_eq!(world_stoch::poisson_draw(&mut r, 1e-9), 0);
}

/// OU resource field: stays inside the [1-band, 1+band] clamp forever, is
/// seed-deterministic, and actually fluctuates away from the neutral value.
#[test]
fn step_ou_respects_band_and_is_deterministic() {
    let cfg = WorldStochasticConfig::default();
    let lo = 1.0 - cfg.ou_band;
    let hi = 1.0 + cfg.ou_band;
    let mut s1 = world_stoch::create_world_stoch_state(5);
    let mut s2 = world_stoch::create_world_stoch_state(5);
    let mut r1 = SplitMix64::new(99);
    let mut r2 = SplitMix64::new(99);
    let mut fluctuated = 0;
    for _ in 0..50 {
        world_stoch::step_ou(&mut s1, &mut r1, &cfg, 1.0);
        world_stoch::step_ou(&mut s2, &mut r2, &cfg, 1.0);
    }
    for i in 0..25 {
        let v = s1.ou_mul[i];
        assert!(
            v >= lo as f32 - 1e-6 && v <= hi as f32 + 1e-6,
            "ou_mul[{i}] out of band: {v}"
        );
        assert_eq!(
            s1.ou_mul[i], s2.ou_mul[i],
            "ou field must be seed-deterministic"
        );
        if (v - 1.0).abs() > 1e-6 {
            fluctuated += 1;
        }
    }
    assert!(fluctuated > 0, "ou field must fluctuate away from neutral");
}

/// Burst flags: exactly `count` distinct cells flagged, saturating at the cell
/// count, and the buffer is cleared between pulses.
#[test]
fn step_burst_marks_distinct_cells() {
    let mut s = world_stoch::create_world_stoch_state(4); // 16 cells
    let mut rng = SplitMix64::new(5);
    world_stoch::step_burst(&mut s, &mut rng, 10);
    let hits = s.burst_flags.iter().filter(|&&f| f == 1).count();
    assert_eq!(hits, 10);
    // request more than the grid has -> saturates at the cell count
    world_stoch::step_burst(&mut s, &mut rng, 1000);
    let hits2 = s.burst_flags.iter().filter(|&&f| f == 1).count();
    assert_eq!(hits2, 16);
    // count = 0 clears the buffer
    world_stoch::step_burst(&mut s, &mut rng, 0);
    assert!(s.burst_flags.iter().all(|&f| f == 0));
}

/// Entropy-annealed exploration sigma: linear interpolation to a floor, pinned
/// once the schedule horizon passes, constant at the floor when annealTicks=0.
#[test]
fn policy_sigma_anneals_to_floor() {
    let cfg = PolicyConfig {
        mode: PolicyMode::Gaussian,
        sigma: 0.5,
        sigma_min: 0.1,
        anneal_ticks: 100,
    };
    assert_eq!(brain::policy_sigma(&cfg, 0), 0.5);
    assert_eq!(brain::policy_sigma(&cfg, 100), 0.1);
    assert_eq!(brain::policy_sigma(&cfg, 500), 0.1);
    let mid = brain::policy_sigma(&cfg, 50);
    assert!(
        (mid - 0.3).abs() < 1e-12,
        "tick 50 must be the midpoint: {mid}"
    );
    let flat = PolicyConfig {
        mode: PolicyMode::Gaussian,
        sigma: 0.5,
        sigma_min: 0.1,
        anneal_ticks: 0,
    };
    assert_eq!(brain::policy_sigma(&flat, 0), 0.1);
    assert_eq!(brain::policy_sigma(&flat, 7), 0.1);
}

/// Reparameterized action sampling: draws only the two motor heads (gates keep
/// the mean and a zero eps), is seed-deterministic, and stays in [-1, 1].
#[test]
fn sample_gaussian_mutates_only_motor_heads() {
    let out = [0.0f32; MLP_OUTPUTS];
    let mut r1 = SplitMix64::new(31);
    let mut r2 = SplitMix64::new(31);
    let mut act = [0.0f32; MLP_OUTPUTS];
    let mut act2 = [0.0f32; MLP_OUTPUTS];
    let mut eps = [0.0f32; MLP_OUTPUTS];
    let mut eps2 = [0.0f32; MLP_OUTPUTS];
    brain::sample_gaussian_action(&out, &mut act, &mut eps, 0.5, &mut r1);
    brain::sample_gaussian_action(&out, &mut act2, &mut eps2, 0.5, &mut r2);
    for m in 0..MLP_OUTPUTS {
        assert_eq!(act[m], act2[m], "sampled action must be seed-deterministic");
        assert!(act[m] >= -1.0 && act[m] <= 1.0);
        if m < 2 {
            assert!(eps[m] != 0.0, "motor head {m} must draw a gaussian");
        } else {
            assert_eq!(eps[m], 0.0, "gate {m} must keep a zero eps");
            assert_eq!(act[m], out[m], "gate {m} must keep the mean");
        }
    }
}

/// POMDP perception: perturbs exactly the hidden channels, refines the belief
/// priors, stays within bounds, and is bit-reproducible from the same inputs.
#[test]
fn step_pomdp_filters_belief_and_scopes_to_hidden() {
    let cfg = PomdpConfig {
        enabled: true,
        noise: 0.1,
        gain: 0.25,
        weight: 0.5,
        hidden: None,
    };
    let g = genome(3);
    let mut b = brain::seed_brain(&g, &BrainConfig::default());
    assert_eq!(b.belief, [0.5; POMDP_BELIEF]);
    let mut b2 = brain::seed_brain(&g, &BrainConfig::default());
    let mut sensors = [0.2f32; MLP_INPUTS];
    let mut sensors2 = sensors;
    let mut noise = [0.0f32; POMDP_BELIEF];
    let mut noise2 = [0.0f32; POMDP_BELIEF];
    brain::step_pomdp(&mut b, &mut sensors, &cfg, 1, 7, &mut noise);
    brain::step_pomdp(&mut b2, &mut sensors2, &cfg, 1, 7, &mut noise2);
    for (j, &k) in DEFAULT_POMDP_HIDDEN.iter().enumerate() {
        assert!(
            (sensors[k] - 0.2).abs() > 1e-6,
            "hidden channel {k} must be perturbed"
        );
        assert!(
            (sensors[k] - sensors2[k]).abs() == 0.0,
            "pomdp output must be deterministic"
        );
        assert!(
            noise[j].abs() <= 0.1 + 1e-6,
            "observation noise exceeds scale"
        );
        assert_eq!(noise[j], noise2[j]);
    }
    for k in 0..MLP_INPUTS {
        if !DEFAULT_POMDP_HIDDEN.contains(&k) {
            assert_eq!(sensors[k], 0.2, "non-hidden channel {k} must be untouched");
        }
    }
    for j in 0..POMDP_BELIEF {
        assert!((0.0..=1.0).contains(&b.belief[j]));
        assert!(
            (b.belief[j] - 0.5).abs() > 1e-6,
            "belief {j} must move toward the observation"
        );
        assert_eq!(b.belief[j], b2.belief[j]);
    }
}

/// Backprop: a nonzero TD error moves trainable weights, and every update
/// respects the clamp bounds (critic Ã‚Â±4, rest Ã‚Â±2).
#[test]
fn backprop_moves_weights_and_respects_clamps() {
    let cfg = BrainConfig {
        enabled: true,
        lr_override: Some(0.02),
        ..BrainConfig::default()
    };
    let g = genome(5);
    let mut b = brain::seed_brain(&g, &cfg);
    let before: Vec<f32> = b.w.into();
    let sensors = sensors15();
    let mut h = [0.0f32; MLP_HIDDEN];
    let mut o = [0.0f32; MLP_OUTPUTS];
    let v = brain::forward_plastic(&mut b, &sensors, &mut h, &mut o);
    let opts = BackpropOpts {
        dropout: 0.0,
        drop_mask: None,
        grad_noise: 0.0,
        grad_noise_vec: None,
        entropy: 0.05,
    };
    let surprise = brain::backprop_brain(&mut b, 0.05, v, &h, &o, &sensors, &opts);
    assert!(surprise > 0.0, "nonzero TD must yield positive surprise");
    let changed = (0..MLP_WEIGHTS)
        .filter(|&i| (b.w[i] - before[i]).abs() > 1e-6)
        .count();
    assert!(changed > 0, "backprop must move at least one weight");
    for &w in &b.w {
        assert!((-2.0..=2.0).contains(&w), "weight out of range: {w}");
    }
    for &c in &b.cv {
        assert!((-4.0..=4.0).contains(&c), "critic weight out of range: {c}");
    }
    assert!(b.cb >= -4.0 && b.cb <= 4.0);
}

/// Total dropout freezes every gated synapse (input-hidden, hidden-output
/// policy weights, critic readout) but the unconditional biases still update Ã¢â‚¬â€
/// mirroring the TS reference exactly.
#[test]
fn backprop_total_dropout_freezes_gated_weights() {
    let cfg = BrainConfig::default();
    let g = genome(6);
    let mut b = brain::seed_brain(&g, &cfg);
    let before: Vec<f32> = b.w.into();
    let before_cv: Vec<f32> = b.cv.into();
    let sensors = sensors15();
    let mut h = [0.0f32; MLP_HIDDEN];
    let mut o = [0.0f32; MLP_OUTPUTS];
    let v = brain::forward_plastic(&mut b, &sensors, &mut h, &mut o);
    let mask = [0.0f32; MLP_HIDDEN]; // every hidden unit dropped
    let opts = BackpropOpts {
        dropout: 1.0,
        drop_mask: Some(&mask),
        grad_noise: 0.0,
        grad_noise_vec: None,
        entropy: 0.0,
    };
    brain::backprop_brain(&mut b, 0.1, v, &h, &o, &sensors, &opts);
    // gated weights: input-hidden (0..60), hidden biases (60..64), policy
    // weights (64..92) and every critic weight stay frozen
    for i in 0..92 {
        assert_eq!(
            b.w[i], before[i],
            "gated weight {i} must freeze under total dropout"
        );
    }
    for i in 0..MLP_HIDDEN {
        assert_eq!(
            b.cv[i], before_cv[i],
            "critic weight {i} must freeze under total dropout"
        );
    }
    // unconditional biases still learn: output biases (92..99) + critic bias
    let mut bias_moved = 0;
    for i in 92..MLP_WEIGHTS {
        if (b.w[i] - before[i]).abs() > 1e-6 {
            bias_moved += 1;
        }
    }
    assert!(
        bias_moved > 0,
        "output biases must still update under total dropout"
    );
}

/// Full-engine determinism with every opt-in feature (backprop + dropout +
/// gradient noise + entropy bonus + POMDP + gaussian policy + stochastic
/// world): two identical engines stay bit-identical and the combined features
/// change the trajectory from the static-genome baseline.
#[test]
fn engine_with_all_features_is_deterministic_and_changes_trajectory() {
    let mut cfg = BrainConfig::default();
    cfg.learn = LearnRule::Backprop;
    cfg.pomdp = Some(PomdpConfig {
        enabled: true,
        noise: 0.1,
        gain: 0.25,
        weight: 0.5,
        hidden: None,
    });
    cfg.policy = Some(PolicyConfig {
        mode: PolicyMode::Gaussian,
        sigma: 0.3,
        sigma_min: 0.05,
        anneal_ticks: 60,
    });
    cfg.dropout = 0.2;
    cfg.grad_noise = 0.05;
    cfg.entropy = 0.1;
    let mut a = engine("feat-det");
    a.set_brain_config(cfg.clone());
    a.set_world_stochastics(Some(WorldStochasticConfig::default()));
    let mut b = engine("feat-det");
    b.set_brain_config(cfg.clone());
    b.set_world_stochastics(Some(WorldStochasticConfig::default()));
    let mut base = Engine::new(world("feat-det"));
    base.set_brain_config(BrainConfig {
        enabled: false,
        ..BrainConfig::default()
    });
    for _ in 0..120 {
        a.tick();
        b.tick();
        base.tick();
    }
    assert_eq!(
        a.compute_state_hash_value(),
        b.compute_state_hash_value(),
        "features must not break determinism"
    );
    assert_eq!(a.alive_count(), b.alive_count());
    assert_ne!(
        a.compute_state_hash_value(),
        base.compute_state_hash_value(),
        "features must change the trajectory"
    );
}

/// World stochasticity alone (no brain): deterministic and diverges from a
/// non-stochastic twin with the same seed.
#[test]
fn engine_with_world_stoch_is_deterministic_and_changes_trajectory() {
    let ws = WorldStochasticConfig::default();
    let mut a = Engine::new(world("wst-det"));
    a.set_world_stochastics(Some(ws.clone()));
    let mut b = Engine::new(world("wst-det"));
    b.set_world_stochastics(Some(ws.clone()));
    let mut base = Engine::new(world("wst-det"));
    for _ in 0..120 {
        a.tick();
        b.tick();
        base.tick();
    }
    assert_eq!(a.compute_state_hash_value(), b.compute_state_hash_value());
    assert_eq!(a.alive_count(), b.alive_count());
    assert_ne!(
        a.compute_state_hash_value(),
        base.compute_state_hash_value(),
        "world stochasticity must change the trajectory"
    );
}
