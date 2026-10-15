use fractal_life_shared::hash::fnv1a32;

const U64_MASK: u64 = 0xffffffffffffffff;
const GOLDEN: u64 = 0x9e3779b97f4a7c15;
const C1: u64 = 0xbf58476d1ce4e5b9;
const C2: u64 = 0x94d049bb133111eb;

/// SplitMix64 PRNG — fully deterministic, all simulation randomness flows through this.
#[derive(Clone)]
pub struct SplitMix64 {
    state: u64,
}

impl SplitMix64 {
    pub fn new(seed: u64) -> Self {
        let mut s = Self {
            state: seed & U64_MASK,
        };
        s.next(); // warm up
        s
    }

    /// 32-bit unsigned integer, [0, 2^32)
    pub fn next(&mut self) -> u32 {
        self.state = self.state.wrapping_add(GOLDEN) & U64_MASK;
        let mut z = self.state;
        z = ((z ^ (z >> 30)).wrapping_mul(C1)) & U64_MASK;
        z = ((z ^ (z >> 27)).wrapping_mul(C2)) & U64_MASK;
        ((z ^ (z >> 31)) & 0xffffffff) as u32
    }

    /// Float in [0, 1).
    ///
    /// Mirrors the TS reference exactly: `nextFloat()` is `next() / 4294967296`
    /// computed in IEEE-754 double precision, then narrowed to f32 on store
    /// (e.g. into the genome Float32Array). Rounding the division to f32
    /// *before* consumers multiply would change every random draw vs the
    /// reference. We compute in f64 and round once at the boundary, like JS.
    pub fn next_float(&mut self) -> f32 {
        (self.next() as f64 / 4294967296.0) as f32
    }

    /// Float in [-1, 1)
    pub fn next_signed(&mut self) -> f32 {
        let f = self.next() as f64 / 4294967296.0;
        (f * 2.0 - 1.0) as f32
    }

    /// Float in [0, 1) at full IEEE-754 double precision. Consumes exactly one
    /// `next()` draw (stream-aligned with `next_float`) but retains the f64
    /// value, matching the TS reference's `nextFloat()`. Used only where the
    /// reference keeps the value as an f64 `number` — i.e. agent coordinates.
    pub fn next_float64(&mut self) -> f64 {
        self.next() as f64 / 4294967296.0
    }

    /// Float in [-1, 1) at full f64 precision. Stream-aligned with
    /// `next_signed`; used only for coordinate generation.
    pub fn next_signed64(&mut self) -> f64 {
        let f = self.next() as f64 / 4294967296.0;
        f * 2.0 - 1.0
    }

    /// Integer in [0, n). Bias-free.
    pub fn next_int(&mut self, n: u32) -> u32 {
        if n <= 1 {
            return 0;
        }
        let limit = (u64::from(u32::MAX) + 1) / u64::from(n) * u64::from(n);
        let mut v = self.next() as u64;
        while v >= limit {
            v = self.next() as u64;
        }
        (v % u64::from(n)) as u32
    }

    /// Standard normal via Box-Muller
    pub fn next_gaussian(&mut self) -> f32 {
        let mut u = 0.0;
        let mut v = 0.0;
        while u == 0.0 {
            u = self.next_float();
        }
        while v == 0.0 {
            v = self.next_float();
        }
        (-2.0 * u.ln()).sqrt() * (2.0 * std::f32::consts::PI * v).cos()
    }

    /// Standard normal at full f64 precision (Box-Muller), stream-aligned with
    /// `next_float`/`next_float64` (two `next()` draws). Mirrors the TS
    /// reference's `nextGaussian()` which returns an f64 `number`.
    pub fn next_gaussian64(&mut self) -> f64 {
        let mut u = 0.0f64;
        let mut v = 0.0f64;
        while u == 0.0 {
            u = self.next_float64();
        }
        while v == 0.0 {
            v = self.next_float64();
        }
        (-2.0 * u.ln()).sqrt() * (2.0 * std::f64::consts::PI * v).cos()
    }
}

pub fn stream_seed(world_seed: &str, tick: u32, agent_id: u32) -> u32 {
    fnv1a32(&format!("{}:{}:{}", world_seed, tick, agent_id))
}

pub fn meme_seed(world_seed: &str, tick: u32, agent_id: u32) -> u32 {
    fnv1a32(&format!("{}:meme:{}:{}", world_seed, tick, agent_id))
}

pub fn env_seed(world_seed: &str, tick: u32) -> u32 {
    fnv1a32(&format!("{}:env:{}", world_seed, tick))
}

/// Independent stream for the molecular-omics layer's stochastic draws
/// (stochastic gene expression + folding entropy). Kept in its own domain so
/// the draws never collide with the mutation / meme / env streams, and both
/// engines construct a fresh SplitMix64 from it inside `tick_omics`.
pub fn omics_seed(world_seed: &str, tick: u32, agent_id: u32) -> u32 {
    fnv1a32(&format!("{}:omics:{}:{}", world_seed, tick, agent_id))
}

/// Independent stream for Phase D stochastic-dynamics draws (behavioural OU
/// steering noise + mutation bursts). Own domain so it never collides with the
/// mutation / meme / env / omics streams, and the TS reference constructs the
/// same SplitMix64 from it.
pub fn dyn_seed(world_seed: &str, tick: u32, agent_id: u32) -> u32 {
    fnv1a32(&format!("{}:dyn:{}:{}", world_seed, tick, agent_id))
}

/// Per-agent discovery codebook initialisation (world + agent domain), so the
/// TS mirror builds the same starting prototypes.
pub fn disc_seed(world_seed: &str, agent_id: u32) -> u32 {
    fnv1a32(&format!("{}:disc:{}", world_seed, agent_id))
}

pub fn init_seed(world_seed: &str) -> u32 {
    fnv1a32(&format!("{}:init", world_seed))
}
