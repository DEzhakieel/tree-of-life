use crate::rng::SplitMix64;

/// Phase D curiosity / pattern-recognition subsystem (WorldConfig.discovery).
///
/// Every agent quantises its local context into a 16-bit *signature*, compares
/// it against a small bounded *codebook* of remembered prototype signatures and
/// forms a "recognition memory" whenever the nearest prototype differs by more
/// than a novelty threshold. Recognition events grant a tiny energy reward and
/// push the agent into an *exploration* mode that biases its steering for a
/// short window — a curiosity drive that lets pattern-seekers sample the world
/// more widely while still staying deterministic (no RNG inside: everything is
/// pure integer math over the agent's own state, so the TS reference mirror is
/// bit-exact).
///
/// Everything is gated behind the flag: when `WorldConfig.discovery` is
/// absent/false the engine performs none of this and the legacy trajectory is
/// bit-identical.

/// Codebook size — how many prototypical contexts one agent remembers.
pub const DISC_PROTOTYPES: usize = 8;
/// Signature width in bits.
pub const DISC_SIG_BITS: usize = 16;
/// Novelty threshold: a signature is "discovered" when the hamming distance to
/// the nearest prototype exceeds 35% of the signature width.
pub const DISC_NOVELTY_THRESHOLD: f64 = 0.35;
/// Energy reward (fraction of the capacity budget) per recognition event.
pub const DISC_REWARD: f64 = 0.5;
/// Cooldown after a discovery (in base ticks) before another can fire.
pub const DISC_COOLDOWN_TICKS: f64 = 6.0;
/// Exploration-mode duration (in base ticks) granted by a discovery.
pub const DISC_EXPLORE_TICKS: f64 = 20.0;
/// Steering bias applied while exploring (added to the drive, after DRIVE_SCALE).
pub const DISC_EXPLORE_TURN: f64 = 0.18;
/// Memory half-life-ish: per-tick decay of the prototype hit counts.
pub const DISC_MEMORY_DECAY: f64 = 0.96;
/// Start codebook spread: prototypes are seeded at creation time from this many
/// SplitMix64 draws, so every world starts from a distinct recognition baseline
/// (parity-safe: the TS mirror constructs the same seeded codebook).
pub const DISC_INIT_DRAWS: usize = DISC_PROTOTYPES;

#[derive(Clone)]
pub struct DiscoveryState {
    /// Bounded prototype codebook (16-bit signatures).
    pub codebook: [u16; DISC_PROTOTYPES],
    /// Rolling hit counts per prototype (memory-decayed each tick).
    pub hits: [u32; DISC_PROTOTYPES],
    /// Next codebook slot to overwrite (round-robin ageing).
    pub last_hit: usize,
    /// Discovery cooldown remaining (time-scaled).
    pub cooldown: f64,
    /// Exploration-mode time remaining (time-scaled).
    pub explore_ticks: f64,
    /// Lifetime recognition events.
    pub discoveries: u64,
}

#[derive(Default, Clone)]
pub struct DiscoveryTotals {
    pub discoveries: u64,
    pub novelty_sum: f64,
    pub memory_diversity_sum: f64,
    pub exploring: u64,
}

#[derive(Clone, Copy, Debug)]
pub struct DiscoveryResult {
    pub discovered: bool,
    pub novelty: f64,
    pub exploring: bool,
}

/// Seed the codebook from `seed_0` (a SplitMix64 stream in the init domain) so
/// the reference engine reproduces the same starting prototypes.
pub fn create_discovery_state(seed_0: u32) -> DiscoveryState {
    let mut rng = SplitMix64::new(seed_0 as u64);
    let mut codebook = [0u16; DISC_PROTOTYPES];
    for c in codebook.iter_mut() {
        *c = (rng.next() as u16) ^ ((rng.next() >> 16) as u16);
    }
    DiscoveryState {
        codebook,
        hits: [0; DISC_PROTOTYPES],
        last_hit: 0,
        cooldown: 0.0,
        explore_ticks: 0.0,
        discoveries: 0,
    }
}

/// Quantise a per-agent context into a 16-bit signature. Pure integer math over
/// values available to both engines, so it is bit-identical in Rust and TS.
/// `alive_ratio` is neighbour/population density in [0, 1); `day_phase` and
/// `season_phase` are in [0, 1].
pub fn signature(
    energy_frac: f64,
    water_frac: f64,
    age_frac: f64,
    meme: f64,
    hunger_frac: f64,
    // Hazard bound for a future hazard-sensitive axis; kept in the signature so
    // the TS mirror's tolerant call sites stay in step.
    _hazard: f64,
    day_phase: f64,
    season_phase: f64,
    alive_ratio: f64,
) -> u16 {
    let mut s: u16 = 0;
    let _ = &_hazard;
    for (i, &fr) in [
        energy_frac,
        water_frac,
        age_frac,
        meme,
        hunger_frac,
        day_phase,
        season_phase,
        alive_ratio,
    ]
    .iter()
    .enumerate()
    {
        s |= (bucket4(fr) & 0b11) << (i * 2);
    }
    s
}

#[inline]
fn bucket4(fr: f64) -> u16 {
    let v = (fr * 4.0).floor();
    if v < 0.0 {
        0u16
    } else if v > 3.0 {
        3u16
    } else {
        v as u16
    }
}

/// Advance the discovery state for one agent tick. No RNG: everything derives
/// from ``sig`` and the agent's own memory, so Rust and TS diverge nowhere.
pub fn tick_discovery(state: &mut DiscoveryState, sig: u16, ts: f64) -> DiscoveryResult {
    state.cooldown = (state.cooldown - ts).max(0.0);
    state.explore_ticks = (state.explore_ticks - ts).max(0.0);
    for h in state.hits.iter_mut() {
        *h = (*h as f64 * DISC_MEMORY_DECAY).floor() as u32;
    }

    let mut min_h = DISC_SIG_BITS as u32;
    for i in 0..DISC_PROTOTYPES {
        let d = (state.codebook[i] ^ sig).count_ones();
        if d < min_h {
            min_h = d;
        }
    }
    let novelty = min_h as f64 / DISC_SIG_BITS as f64;

    let discovered = novelty > DISC_NOVELTY_THRESHOLD && state.cooldown <= 0.0;
    if discovered {
        state.codebook[state.last_hit] = sig;
        state.hits[state.last_hit] = (state.hits[state.last_hit] + 1).min(65535);
        state.last_hit = (state.last_hit + 1) % DISC_PROTOTYPES;
        state.cooldown = DISC_COOLDOWN_TICKS * ts;
        state.explore_ticks = DISC_EXPLORE_TICKS * ts;
        state.discoveries = state.discoveries.saturating_add(1);
    }

    DiscoveryResult {
        discovered,
        novelty,
        exploring: state.explore_ticks > 0.0,
    }
}

/// Shannon entropy (bits) of the prototype hit distribution of one agent.
pub fn memory_diversity(hits: &[u32; DISC_PROTOTYPES]) -> f64 {
    let mut h = 0.0f64;
    for &v in hits.iter() {
        let p = v as f64 / DISC_PROTOTYPES as f64;
        if p > 0.0 {
            h -= p * p.log2();
        }
    }
    h
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn two_identical_agents_same_codebook() {
        let a = create_discovery_state(12345);
        let b = create_discovery_state(12345);
        assert_eq!(a.codebook, b.codebook);
        let c = create_discovery_state(54321);
        assert_ne!(a.codebook, c.codebook, "different seeds diverge");
    }

    #[test]
    fn identical_signatures_are_not_novel() {
        let mut s = create_discovery_state(7);
        s.codebook[0] = 0xAAAA;
        s.last_hit = 0;
        let r = tick_discovery(&mut s, 0xAAAA, 1.0);
        assert!(!r.discovered);
        assert!(r.novelty <= DISC_NOVELTY_THRESHOLD);
        assert!(!r.exploring);
    }

    #[test]
    fn novel_signature_triggers_discovery_and_exploration() {
        let mut s = create_discovery_state(9);
        s.codebook[0] = 0x0000;
        s.codebook[1] = 0x0000;
        s.codebook[2] = 0x0000;
        s.codebook[3] = 0x0000;
        s.codebook[4] = 0x0000;
        s.codebook[5] = 0x0000;
        s.codebook[6] = 0x0000;
        s.codebook[7] = 0x0000;
        let r = tick_discovery(&mut s, 0xFFFF, 1.0);
        assert!(r.discovered);
        assert!(r.exploring);
        assert!(s.explore_ticks > 0.0);
        assert_eq!(s.discoveries, 1);
        assert_eq!(s.codebook[s.last_hit as usize - 1], 0xFFFF);
    }

    #[test]
    fn cooldown_blocks_immediate_rediscovery() {
        let mut s = create_discovery_state(11);
        for c in s.codebook.iter_mut() {
            *c = 0;
        }
        let r1 = tick_discovery(&mut s, 0xFFFF, 1.0);
        assert!(r1.discovered);
        let r2 = tick_discovery(&mut s, 0xFFFF, 1.0);
        assert!(!r2.discovered, "cooldown suppresses second hit");
    }

    #[test]
    fn signature_buckets_boundaries() {
        assert_eq!(bucket4(-0.5), 0);
        assert_eq!(bucket4(0.0), 0);
        assert_eq!(bucket4(0.25), 1);
        assert_eq!(bucket4(0.75), 3);
        assert_eq!(bucket4(1.0), 3);
        assert_eq!(bucket4(5.0), 3);
    }
}
