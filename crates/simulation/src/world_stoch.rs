use crate::rng::SplitMix64;

/// Seeded stochastic world processes, ported 1:1 from the TS `worldStoch.ts`.
/// Everything is driven by a SplitMix64 seeded from (worldSeed, tick) via
/// `env_seed`, so the same seed reproduces identical world fluctuations while
/// still being genuinely noisy (and therefore *different* from a deterministic
/// twin with the same seed).

pub const DEFAULT_WEATHER_MATRIX: [[f64; 4]; 4] = [
    [0.85, 0.08, 0.04, 0.03],
    [0.18, 0.75, 0.02, 0.05],
    [0.10, 0.03, 0.82, 0.05],
    [0.15, 0.06, 0.05, 0.74],
];

pub const WEATHER_NAMES: [&str; 4] = ["clear", "rain", "drought", "heat"];
pub const WEATHER_MOISTURE: [f64; 4] = [1.0, 1.25, 0.7, 0.9];
pub const WEATHER_GROWTH: [f64; 4] = [1.0, 1.15, 0.8, 1.3];

pub const DEFAULT_POISSON_RATE: f64 = 40.0;
pub const DEFAULT_OU_THETA: f64 = 0.01;
pub const DEFAULT_OU_SIGMA: f64 = 0.02;
pub const DEFAULT_OU_BAND: f64 = 0.25;

/// Master switch. When `enabled` is false, `regenerate` behaves exactly as
/// before (the default, so determinism/parity traces stay untouched).
#[derive(Clone, Debug)]
pub struct WorldStochasticConfig {
    pub enabled: bool,
    /// Expected per-tick Poisson point-process events (cells burst-regened).
    pub poisson_rate: f64,
    /// OU mean-reversion rate of the per-cell resource multiplier field.
    pub ou_theta: f64,
    /// OU volatility (std of the driving noise per unit time).
    pub ou_sigma: f64,
    /// OU field is clamped to [1-band, 1+band] so growth never goes negative.
    pub ou_band: f64,
    /// Weather transition matrix (row = current state). None => default.
    pub weather: Option<[[f64; 4]; 4]>,
}

impl Default for WorldStochasticConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            poisson_rate: DEFAULT_POISSON_RATE,
            ou_theta: DEFAULT_OU_THETA,
            ou_sigma: DEFAULT_OU_SIGMA,
            ou_band: DEFAULT_OU_BAND,
            weather: None,
        }
    }
}

pub struct WorldStochState {
    pub ou_mul: Vec<f32>,
    pub weather: usize,
    pub weather_moisture: f64,
    pub weather_growth: f64,
    pub cell_count: usize,
    pub burst_flags: Vec<u8>,
}

pub fn create_world_stoch_state(size: usize) -> WorldStochState {
    let n = size * size;
    WorldStochState {
        ou_mul: vec![1.0; n],
        weather: 0,
        weather_moisture: 1.0,
        weather_growth: 1.0,
        cell_count: n,
        burst_flags: vec![0; n],
    }
}

/// Advance the Markov-chain weather; consumes exactly ONE random draw.
pub fn step_weather(state: &mut WorldStochState, rng: &mut SplitMix64, matrix: &[[f64; 4]; 4]) {
    let row = matrix[state.weather];
    let u = rng.next_float64();
    let mut acc = 0.0f64;
    let mut next = state.weather;
    for k in 0..row.len() {
        acc += row[k];
        if u < acc {
            next = k;
            break;
        }
    }
    state.weather = next;
    state.weather_moisture = WEATHER_MOISTURE[next];
    state.weather_growth = WEATHER_GROWTH[next];
}

/// OU fluctuation of the per-cell resource multiplier field. One gaussian/cell.
pub fn step_ou(
    state: &mut WorldStochState,
    rng: &mut SplitMix64,
    cfg: &WorldStochasticConfig,
    ts: f64,
) {
    let theta = cfg.ou_theta;
    let sigma = cfg.ou_sigma;
    let lo = 1.0 - cfg.ou_band;
    let hi = 1.0 + cfg.ou_band;
    let sq = ts.sqrt();
    let mul = &mut state.ou_mul;
    for i in 0..mul.len() {
        let x =
            mul[i] as f64 + theta * (1.0 - mul[i] as f64) * ts + sigma * sq * rng.next_gaussian64();
        mul[i] = if x < lo {
            lo as f32
        } else if x > hi {
            hi as f32
        } else {
            x as f32
        };
    }
}

/// Poisson point process: vertex count of seeded events living this tick.
pub fn poisson_draw(rng: &mut SplitMix64, lambda: f64) -> u32 {
    let l = (-lambda).exp();
    let mut k = 0u32;
    let mut p = 1.0f64;
    loop {
        p *= rng.next_float64();
        k += 1;
        if p <= l || k >= 1000 {
            break;
        }
    }
    k - 1
}

/// Draw `count` distinct cells to burst-regenerate; zeroes the flag buffer
/// first. Rejection-samples so each flagged cell is unique (a cell cannot be
/// hit twice in one pulse).
pub fn step_burst(state: &mut WorldStochState, rng: &mut SplitMix64, count: u32) {
    let flags = &mut state.burst_flags;
    for f in flags.iter_mut() {
        *f = 0;
    }
    if count == 0 {
        return;
    }
    let n = state.cell_count;
    if n == 0 {
        return;
    }
    let target = count.min(n as u32) as usize;
    let mut placed = 0usize;
    let mut guard = 0usize;
    let guard_limit = count as usize * 16;
    while placed < target && guard < guard_limit {
        let idx = rng.next_int(n as u32) as usize;
        if flags[idx] == 0 {
            flags[idx] = 1;
            placed += 1;
        }
        guard += 1;
    }
}
