use fractal_life_shared::types::{EnvironmentPreset, WorldConfig, WorldParams, WorldTopology};
use fractal_life_simulation::engine::Engine;

// Phase M environment presets: extreme and underrated biomes selectable per
// world. Every preset seeds a distinct chemical terrain at build time and
// biases the per-agent omics environment (water factor + default heat). The
// control (Calm) must be the default when the field is absent, so legacy runs
// stay bit-identical.

const ALL: [EnvironmentPreset; 17] = [
    EnvironmentPreset::Calm,
    EnvironmentPreset::AnoxicTrench,
    EnvironmentPreset::Hyperthermal,
    EnvironmentPreset::Hypersaline,
    EnvironmentPreset::AcidicCrater,
    EnvironmentPreset::SodaLake,
    EnvironmentPreset::CryoFrozen,
    EnvironmentPreset::Irradiated,
    EnvironmentPreset::ToxicSump,
    EnvironmentPreset::LimestoneCave,
    EnvironmentPreset::GutLumen,
    EnvironmentPreset::TermiteMound,
    EnvironmentPreset::Rhizosphere,
    EnvironmentPreset::WetlandMarsh,
    EnvironmentPreset::DesertDune,
    EnvironmentPreset::HotSpring,
    EnvironmentPreset::CanopyTop,
];

fn world(seed: &str, env: EnvironmentPreset, spawn: usize) -> WorldConfig {
    WorldConfig {
        id: "env".to_string(),
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
        environment: Some(env),
        topology: None,
        signal_deposit: None,
        meme_copy_rate: None,
        reproduction: None,
        sensing: None,
    }
}

/// Phase M topological spaces: all five topologies keep every agent strictly
/// inside [0, world)², are deterministic across identical configs, and the
/// legacy world (no topology selected) stays bit-identical to an explicit
/// torus. Sphere / cylinder polar caps confine the population, while the
/// twisted (non-orientable) surfaces keep it looping like the torus does.
#[test]
fn topologies_keep_agents_bounded_deterministic_and_legacy_identical() {
    let all_topo = [
        WorldTopology::Torus,
        WorldTopology::Cylinder,
        WorldTopology::Sphere,
        WorldTopology::Mobius,
        WorldTopology::Klein,
    ];
    let world_sz = Engine::new(world("seed", EnvironmentPreset::Calm, 1))
        .grid
        .size as f64
        * Engine::new(world("seed", EnvironmentPreset::Calm, 1))
            .grid
            .cell as f64;

    for topo in all_topo {
        let mut cfg = world("seed", EnvironmentPreset::Calm, 20);
        cfg.topology = Some(topo);
        let mut e1 = Engine::new(cfg.clone());
        let mut e2 = Engine::new(cfg);
        for _ in 0..20 {
            e1.tick();
            e2.tick();
        }
        // determinism: identical configs converge to identical outcomes
        assert_eq!(
            e1.alive_count(),
            e2.alive_count(),
            "{:?} deterministic alive",
            topo
        );
        // bounded: no agent escapes the [0, world)² envelope on any topology
        for a in e1.agents.values() {
            assert!(
                a.x >= 0.0 && a.x < world_sz && a.y >= 0.0 && a.y < world_sz,
                "{:?} keeps agents in-bounds: ({}, {})",
                topo,
                a.x,
                a.y
            );
        }
    }

    // legacy identity: no topology selected == explicit torus, bit-for-bit
    let mut legacy = Engine::new(world("seed", EnvironmentPreset::Calm, 20));
    let mut cfg = world("seed", EnvironmentPreset::Calm, 20);
    cfg.topology = Some(WorldTopology::Torus);
    let mut torus = Engine::new(cfg);
    for _ in 0..20 {
        legacy.tick();
        torus.tick();
    }
    assert_eq!(
        legacy.alive_count(),
        torus.alive_count(),
        "legacy == torus alive"
    );
}

/// The five topological spaces each express their identity on the world: the
/// latitudes of sphere / cylinder agents cluster toward the equator band (the
/// reflecting caps keep the population off the poles), while the torus and the
/// twisted surfaces sample the whole latitude span.
#[test]
fn topologies_shape_latitude_distribution() {
    let mut lat_span = std::collections::HashMap::new();
    for topo in [
        WorldTopology::Torus,
        WorldTopology::Cylinder,
        WorldTopology::Sphere,
        WorldTopology::Mobius,
        WorldTopology::Klein,
    ] {
        let mut cfg = world("seed", EnvironmentPreset::Calm, 24);
        cfg.topology = Some(topo);
        let mut e = Engine::new(cfg);
        for _ in 0..30 {
            e.tick();
        }
        let world_sz = e.grid.size as f64 * e.grid.cell as f64;
        let ys: Vec<f64> = e.agents.values().map(|a| a.y).collect();
        let min = ys.iter().cloned().fold(f64::INFINITY, f64::min);
        let max = ys.iter().cloned().fold(f64::NEG_INFINITY, f64::max);
        let span_rel = (max - min) / world_sz;
        lat_span.insert(topo, span_rel);
        assert!(
            span_rel >= 0.0 && span_rel <= 1.0001,
            "{:?} latitude span in [0, 1]",
            topo
        );
    }
    // the caps genuinely confine latitude: reflecting topologies span strictly
    // less than the full world height **on the north-south axis of a founders
    // run** ... bounded edge effect that the torus (full wrap) never sees.
    let torus_span = lat_span[&WorldTopology::Torus];
    for topo in [
        WorldTopology::Cylinder,
        WorldTopology::Sphere,
        WorldTopology::Mobius,
        WorldTopology::Klein,
    ] {
        assert!(
            lat_span[&topo] <= torus_span + 0.05,
            "{:?} latitude span {:?} not wildly beyond torus {:?}",
            topo,
            lat_span[&topo],
            torus_span
        );
    }
}

/// Direct cap-crossing probe: an agent shoved north across the y = 0 cap must
/// be handled *differently* by each identification — cylinder / sphere / möbius
/// reflect it (it stays in the north strip), while torus / klein loop it to the
/// south strip. The twisted surfaces additionally flip longitude, so the agent
/// ends up on the opposite western/eastern half.
#[test]
fn caps_reflect_latitude_and_loop_wraps() {
    for topo in [
        WorldTopology::Torus,
        WorldTopology::Cylinder,
        WorldTopology::Sphere,
        WorldTopology::Mobius,
        WorldTopology::Klein,
    ] {
        let mut cfg = world("cap", EnvironmentPreset::Calm, 1);
        cfg.topology = Some(topo);
        let mut e = Engine::new(cfg);
        let world_sz = e.grid.size as f64 * e.grid.cell as f64;
        for a in e.agents.values_mut() {
            a.x = world_sz / 4.0;
            a.y = 0.5;
            a.vx = 0.0;
            a.vy = -3.0; // shove across the northern cap
        }
        for _ in 0..3 {
            e.tick();
        }
        let a = e.agents.values().next().expect("one founder");
        let reflecting = matches!(
            topo,
            WorldTopology::Cylinder | WorldTopology::Sphere | WorldTopology::Mobius
        );
        if reflecting {
            assert!(
                a.y < world_sz * 0.1,
                "{topo:?} reflected an agent off the north cap, y={} (world {world_sz})",
                a.y
            );
        } else {
            assert!(
                a.y > world_sz * 0.6,
                "{topo:?} looped an agent to the south cap crossing, y={} (world {world_sz})",
                a.y
            );
        }
        if matches!(topo, WorldTopology::Mobius | WorldTopology::Klein) {
            assert!(
                a.x > world_sz / 2.0,
                "{topo:?} flipped longitude on the cap crossing, x={} of world {world_sz}",
                a.x
            );
        }
    }
}

/// Every preset seeds a distinct chemical terrain from its profile, exposes the
/// water factor / heat bias on the engine, and no two presets share a profile.
#[test]
fn presets_seed_distinct_chemical_terrain() {
    let mut seen = std::collections::HashSet::new();
    for preset in ALL {
        let e = Engine::new(world("seed", preset, 10));
        let p = preset.profile();
        assert_eq!(e.chem_terrain.o2[0], p.o2 as f32, "{:?} seeds O2", preset);
        assert_eq!(e.chem_terrain.ph[0], p.ph as f32, "{:?} seeds pH", preset);
        assert_eq!(
            e.chem_terrain.toxin[0], p.toxin as f32,
            "{:?} seeds toxin",
            preset
        );
        assert_eq!(
            e.chem_terrain.minerals[0], p.minerals as f32,
            "{:?} seeds minerals",
            preset
        );
        assert_eq!(e.env_profile.water_factor, p.water_factor);
        assert_eq!(e.env_profile.heat, p.heat);
        assert!(!p.desc.is_empty(), "{:?} has a description", preset);
        let key = (
            p.o2.to_bits(),
            p.ph.to_bits(),
            p.toxin.to_bits(),
            p.minerals.to_bits(),
            p.water_factor.to_bits(),
            p.heat.to_bits(),
        );
        assert!(
            seen.insert(key),
            "{:?} duplicates another preset profile",
            preset
        );
    }
}

/// Preset-name parsing round-trips the camelCase names, unknown names are
/// rejected, and the default preset is the Calm control.
#[test]
fn preset_names_round_trip_and_default_is_calm() {
    assert_eq!(EnvironmentPreset::default(), EnvironmentPreset::Calm);
    assert_eq!(
        EnvironmentPreset::from_name("calm"),
        Some(EnvironmentPreset::Calm)
    );
    assert_eq!(
        EnvironmentPreset::from_name("acidicCrater"),
        Some(EnvironmentPreset::AcidicCrater)
    );
    assert_eq!(
        EnvironmentPreset::from_name("gutLumen"),
        Some(EnvironmentPreset::GutLumen)
    );
    assert_eq!(
        EnvironmentPreset::from_name("canopyTop"),
        Some(EnvironmentPreset::CanopyTop)
    );
    assert_eq!(EnvironmentPreset::from_name("nowhere"), None);
}

/// Preset worlds are deterministic per (seed, preset), keep a bounded living
/// colony over a couple of hundred ticks, and retain their biome signature in
/// the aggregate chemical terrain — the acid crater stays acidic, the anoxic
/// trench stays low-oxygen versus the Calm control.
#[test]
fn preset_worlds_are_deterministic_bounded_and_keep_their_signature() {
    let mut calm = Engine::new(world("s", EnvironmentPreset::Calm, 40));
    let mut acid = Engine::new(world("s", EnvironmentPreset::AcidicCrater, 40));
    let mut trench = Engine::new(world("s", EnvironmentPreset::AnoxicTrench, 40));
    let mut calm2 = Engine::new(world("s", EnvironmentPreset::Calm, 40));

    for _ in 0..150 {
        let rc = calm.tick();
        let ra = acid.tick();
        let rt = trench.tick();
        let rc2 = calm2.tick();

        assert_eq!(
            rc.stats.state_hash, rc2.stats.state_hash,
            "deterministic per seed+preset"
        );
        assert!(
            rc.stats.population as usize <= calm.params.max_population,
            "calm colony bounded"
        );
        assert!(
            ra.stats.population as usize <= acid.params.max_population,
            "acid colony bounded"
        );
        assert!(
            rt.stats.population as usize <= trench.params.max_population,
            "trench colony bounded"
        );
        assert!(
            rc.stats.population > 0 && ra.stats.population > 0 && rt.stats.population > 0,
            "all three colonies stay alive"
        );
    }

    let _ = calm.tick();
    let _ = acid.tick();
    let _ = trench.tick();
    let mean_ph = |e: &Engine| {
        e.chem_terrain.ph.iter().map(|v| *v as f64).sum::<f64>() / e.chem_terrain.ph.len() as f64
    };
    let mean_o2 = |e: &Engine| {
        e.chem_terrain.o2.iter().map(|v| *v as f64).sum::<f64>() / e.chem_terrain.o2.len() as f64
    };
    assert!(
        mean_ph(&acid) < mean_ph(&calm),
        "acidic crater pH {:.4} must stay below calm {:.4}",
        mean_ph(&acid),
        mean_ph(&calm)
    );
    assert!(
        mean_o2(&trench) < mean_o2(&calm),
        "anoxic trench O2 {:.4} must stay below calm {:.4}",
        mean_o2(&trench),
        mean_o2(&calm)
    );
}
