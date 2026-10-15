use crate::genome::fast_tanh;
use crate::rng::SplitMix64;
use fractal_life_shared::constants::*;

/// POMDP perception: the belief vector is sized to this fixed channel count
/// and seeded with mid-range (0.5) priors so perception can be enabled after
/// founder spawn without resizing anything.
pub const POMDP_BELIEF: usize = 5;

/// Sensor channels treated as partially observable by default (distal /
/// uncertain quantities: nearest-neighbour D, food, meat, threat D, minerals).
pub const DEFAULT_POMDP_HIDDEN: [usize; POMDP_BELIEF] = [4, 6, 7, 10, 13];

/// Learning rule: `hebbian` = surprise-modulated three-factor Hebbian (the
/// historical default, mirrored by the WASM engine); `backprop` = gradient
/// descent through the MLP on the TD error (TS engine only). Default hebbian,
/// so parity with the Rust build is preserved out of the box.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum LearnRule {
    Hebbian,
    Backprop,
}

/// Stochastic policy head: add Gaussian exploration noise to the motor
/// outputs. The mean policy `out` is still what backprop learns through
/// (reparameterization: sampled action = mean + sigma * eps), so exploration
/// and gradient descent coexist. Default: deterministic (no sampling).
#[derive(Clone, Debug)]
pub struct PolicyConfig {
    pub mode: PolicyMode,
    /// action noise std (full `sigma` at tick 0)
    pub sigma: f64,
    /// noise floor after the entropy-annealing schedule completes
    pub sigma_min: f64,
    /// ticks over which sigma anneals sigma -> sigma_min (0 = constant)
    pub anneal_ticks: u32,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PolicyMode {
    Deterministic,
    Gaussian,
}

/// POMDP perception config. When `enabled`, the partially-observable sensor
/// channels get deterministic observation noise, a running belief estimate,
/// and the belief is blended into the policy input (belief-guided action).
#[derive(Clone, Debug)]
pub struct PomdpConfig {
    pub enabled: bool,
    /// observation noise scale; each hidden channel is perturbed by
    /// ±uniform(0,noise) seeded from (tick, agent id, channel). Default 0.08.
    pub noise: f64,
    /// belief filter learning rate (exponential average toward observations),
    /// 0..1. Default 0.2.
    pub gain: f64,
    /// belief blend weight in the policy input: `(1-w)*obs + w*belief`.
    /// Default 0.4.
    pub weight: f64,
    /// sensor channels treated as partially observable. None => default set.
    pub hidden: Option<Vec<usize>>,
}

/// Option bag for `backprop_brain`'s stochastic-gradient regularizers.
pub struct BackpropOpts<'a> {
    /// hidden-unit dropout probability (0 = no dropout)
    pub dropout: f64,
    /// 1 = keep, 0 = drop; length MLP_HIDDEN. Ignored when dropout is 0.
    pub drop_mask: Option<&'a [f32; MLP_HIDDEN]>,
    /// std of gradient noise (0 = none)
    pub grad_noise: f64,
    /// standard normals (length MLP_WEIGHTS + MLP_HIDDEN + 1) added to the
    /// weight deltas; ignored when grad_noise is 0.
    pub grad_noise_vec: Option<&'a [f32]>,
    /// entropy bonus on the motor heads (see BrainConfig.entropy)
    pub entropy: f64,
}

/// Engine-level configuration for the plastic recurrent brains. When an
/// override is `Some`, it wins over the per-agent plasticity genes; when
/// `None`, each agent learns with its own heritable hyper-parameters.
#[derive(Clone, Debug)]
pub struct BrainConfig {
    pub enabled: bool,
    pub lr_override: Option<f64>,
    pub gamma_override: Option<f64>,
    pub lambda_override: Option<f64>,
    pub inherit_override: Option<f64>,
    pub learn: LearnRule,
    /// when provided and enabled, applies the hidden/noisy-observation model
    pub pomdp: Option<PomdpConfig>,
    /// stochastic policy head (default deterministic — pure gradient ascent)
    pub policy: Option<PolicyConfig>,
    /// backprop SGD: dropout probability applied to hidden units during the
    /// weight update. Default 0.
    pub dropout: f64,
    /// backprop SGD: std of the zero-mean Gaussian noise added to each weight
    /// delta. Default 0.
    pub grad_noise: f64,
    /// backprop exploration bonus on the motor heads. Default 0.
    pub entropy: f64,
}

impl Default for BrainConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            lr_override: None,
            gamma_override: None,
            lambda_override: None,
            inherit_override: None,
            learn: LearnRule::Hebbian,
            pomdp: None,
            policy: None,
            dropout: 0.0,
            grad_noise: 0.0,
            entropy: 0.0,
        }
    }
}

fn clamp01(v: f64) -> f64 {
    v.max(0.0).min(1.0)
}

fn genome_at(genome: &[f32], i: usize) -> f64 {
    genome.get(i).copied().unwrap_or(0.0) as f64
}

/// Map a plasticy gene ([-1,1]) onto a per-agent learning rate.
fn map_lr(v: f64) -> f64 {
    0.001 + clamp01((v + 1.0) / 2.0) * 0.049
}

/// Map a plasticity gene ([-1,1]) onto a TD discount or trace decay.
fn map_discount(v: f64) -> f64 {
    0.8 + clamp01((v + 1.0) / 2.0) * 0.19
}

/// Per-agent plastic recurrent neural network.
///
/// * `w[MLP_WEIGHTS]`  current (learned) connection weights, seeded from the
///   genome's MLP block at birth. Only the output layer `[64..99]` is plastic;
///   the sensory layer stays hard-wired from the genome.
/// * `e[MLP_HOUT_W]`   eligibility traces on the output layer.
/// * `v`              TD critic: predicted discounted future reward for the
///   sensory state the agent was in at the last decision.
/// * `h[MLP_HIDDEN]`   recurrent hidden state (Elman feedback over Wrec).
/// * `last_reward`     reward received as a consequence of the last decision.
/// * `rec[BRAIN_REC_COUNT]` recurrent weights (fixed at birth).
/// * `cv`/`cb`         critic readout over the hidden layer (fixed at birth).
#[derive(Clone)]
pub struct BrainState {
    pub w: [f32; MLP_WEIGHTS],
    pub e: [f32; MLP_HOUT_W],
    pub v: f64,
    pub h: [f32; MLP_HIDDEN],
    pub last_reward: f64,
    pub rec: [f32; BRAIN_REC_COUNT],
    pub cv: [f32; MLP_HIDDEN],
    pub cb: f64,
    pub inherit: f64,
    pub lr_gene: f64,
    pub gamma: f64,
    pub lambda: f64,
    /// running belief estimates over the partially-observable channels
    /// (POMDP); always sized to `POMDP_BELIEF` so perception can be switched
    /// on post-spawn. Bounded [0,1] priors.
    pub belief: [f32; POMDP_BELIEF],
}

impl Default for BrainState {
    fn default() -> Self {
        Self {
            w: [0.0; MLP_WEIGHTS],
            e: [0.0; MLP_HOUT_W],
            v: 0.0,
            h: [0.0; MLP_HIDDEN],
            last_reward: 0.0,
            rec: [0.0; BRAIN_REC_COUNT],
            cv: [0.0; MLP_HIDDEN],
            cb: 0.0,
            inherit: 0.0,
            lr_gene: 0.0,
            gamma: 0.9,
            lambda: 0.9,
            belief: [0.5; POMDP_BELIEF],
        }
    }
}

/// Seed a fresh brain from a genome (founders, interventions, parents with no
/// learned state yet). Reading every genome slice through `get` keeps genomes
/// shorter than GENOME_SIZE (e.g. pre-brain persisted worlds) valid.
pub fn seed_brain(genome: &[f32], cfg: &BrainConfig) -> BrainState {
    let mut b = BrainState::default();
    for i in 0..MLP_WEIGHTS {
        b.w[i] = genome_at(genome, BRAIN_OFFSET + i) as f32;
    }
    for i in 0..BRAIN_REC_COUNT {
        b.rec[i] = genome_at(genome, BRAIN_REC_OFFSET + i) as f32;
    }
    for i in 0..MLP_HIDDEN {
        b.cv[i] = genome_at(genome, CRITIC_OFFSET + i) as f32;
    }
    b.cb = genome_at(genome, CRITIC_OFFSET + MLP_HIDDEN);
    b.inherit = cfg
        .inherit_override
        .unwrap_or_else(|| clamp01((genome_at(genome, PLASTICITY_OFFSET) + 1.0) / 2.0));
    b.lr_gene = cfg
        .lr_override
        .unwrap_or_else(|| map_lr(genome_at(genome, PLASTICITY_OFFSET + 1)));
    b.gamma = cfg
        .gamma_override
        .unwrap_or_else(|| map_discount(genome_at(genome, PLASTICITY_OFFSET + 2)));
    b.lambda = cfg
        .lambda_override
        .unwrap_or_else(|| map_discount(genome_at(genome, PLASTICITY_OFFSET + 3)));
    // uncertain priors (mid-range) over the hidden channels
    b.belief = [0.5; POMDP_BELIEF];
    b
}

/// Birth with Lamarckian-Baldwinian heredity: the child's synapses are a blend
/// of the parent's *learned* weights and the child's own genome template,
/// weighted by the child's `inherit` gene (alpha).
pub fn spawn_brain(parent: &BrainState, genome: &[f32], cfg: &BrainConfig) -> BrainState {
    let mut b = seed_brain(genome, cfg);
    if !cfg.enabled {
        return b;
    }
    let alpha = b.inherit.clamp(0.0, 1.0);
    for i in 0..MLP_WEIGHTS {
        let template = b.w[i] as f64;
        b.w[i] = (template + alpha * (parent.w[i] as f64 - template)) as f32;
    }
    // offspring inherit the parent's belief priors, not just its synapses
    b.belief = parent.belief;
    b
}

/// Magnitude of learned deviation from the genome template (L1 / weights).
pub fn learned_mag(b: &BrainState, genome: &[f32]) -> f64 {
    let mut acc = 0.0f64;
    for i in 0..MLP_WEIGHTS {
        acc += (b.w[i] as f64 - genome_at(genome, BRAIN_OFFSET + i)).abs();
    }
    acc / MLP_WEIGHTS as f64
}

/// Plastic recurrent forward pass (Elman-style MLP with learned weights).
/// Writes the hidden state back into the brain and fills `out`. Returns the
/// critic value V(s) for the current sensory state.
pub fn forward_plastic(
    b: &mut BrainState,
    sensor: &[f32],
    hidden: &mut [f32; MLP_HIDDEN],
    out: &mut [f32; MLP_OUTPUTS],
) -> f64 {
    let prev = b.h;
    for j in 0..MLP_HIDDEN {
        let mut acc = b.w[MLP_INPUTS * MLP_HIDDEN + j] as f64;
        for i in 0..MLP_INPUTS {
            acc += sensor[i] as f64 * b.w[i * MLP_HIDDEN + j] as f64;
        }
        for k in 0..MLP_HIDDEN {
            acc += prev[k] as f64 * b.rec[k * MLP_HIDDEN + j] as f64;
        }
        hidden[j] = fast_tanh(acc) as f32;
    }
    b.h = *hidden;
    for j in 0..MLP_OUTPUTS {
        let mut acc =
            b.w[MLP_INPUTS * MLP_HIDDEN + MLP_HIDDEN + MLP_HIDDEN * MLP_OUTPUTS + j] as f64;
        for i in 0..MLP_HIDDEN {
            acc += hidden[i] as f64
                * b.w[MLP_INPUTS * MLP_HIDDEN + MLP_HIDDEN + i * MLP_OUTPUTS + j] as f64;
        }
        out[j] = if j < 2 {
            fast_tanh(acc) as f32
        } else {
            (1.0 / (1.0 + (-acc).exp())) as f32
        };
    }
    let mut v = b.cb;
    for i in 0..MLP_HIDDEN {
        v += hidden[i] as f64 * b.cv[i] as f64;
    }
    v
}

/// Surprise-modulated ("three-factor") Hebbian learning with a TD critic — the
/// pure ML/NN in the agentic loop. Reward-modulated eligibility traces update
/// the plastic output layer toward locally rewarding decisions.
///
/// Returns the absolute TD error (`|surprise|`), used for telemetry.
pub fn observe(
    b: &mut BrainState,
    reward: f64,
    v_cur: f64,
    hidden: &[f32; MLP_HIDDEN],
    out: &[f32; MLP_OUTPUTS],
) -> f64 {
    let lr = b.lr_gene;
    let gamma = b.gamma;
    let lambda = b.lambda;
    // TD(0) prediction error: reward harvested + discounted successor value
    // minus the value predicted at the last decision.
    let td = b.last_reward + gamma * v_cur - b.v;
    // Eligibility traces over the plastic output layer (current activity pair).
    for j in 0..MLP_OUTPUTS {
        for i in 0..MLP_HIDDEN {
            let idx = i * MLP_OUTPUTS + j;
            b.e[idx] = (lambda * b.e[idx] as f64 + hidden[i] as f64 * out[j] as f64) as f32;
        }
        let b_idx = MLP_HIDDEN * MLP_OUTPUTS + j;
        b.e[b_idx] = (lambda * b.e[b_idx] as f64 + out[j] as f64) as f32;
    }
    // Reward-modulated Hebbian update (epoch-independent, no gradient).
    let rpe = td.clamp(-1.0, 1.0);
    let hid_base = MLP_INPUTS * MLP_HIDDEN + MLP_HIDDEN;
    for idx in 0..MLP_HOUT_W {
        let mut wtmp = b.w[hid_base + idx] as f64 + lr * rpe * b.e[idx] as f64;
        wtmp = wtmp.max(-2.0).min(2.0);
        b.w[hid_base + idx] = wtmp as f32;
    }
    b.last_reward = reward;
    b.v = v_cur;
    td.abs()
}

/// Entropy-annealed exploration sigma for tick `t` of a gaussian policy.
pub fn policy_sigma(cfg: &PolicyConfig, tick: u32) -> f64 {
    if cfg.anneal_ticks == 0 || tick >= cfg.anneal_ticks {
        return cfg.sigma_min;
    }
    let frac = tick as f64 / cfg.anneal_ticks as f64;
    cfg.sigma_min + (cfg.sigma - cfg.sigma_min) * (1.0 - frac)
}

/// Reparameterized action sampling for a stochastic policy: act = clamp01(
/// out + sigma * eps). Only the two motor heads are sampled; the gating
/// outputs keep the mean. The draws come from the supplied rng (a seeded
/// SplitMix64 in the engine), stream-aligned with the TS reference.
pub fn sample_gaussian_action(
    out: &[f32; MLP_OUTPUTS],
    act: &mut [f32; MLP_OUTPUTS],
    eps: &mut [f32; MLP_OUTPUTS],
    sigma: f64,
    rng: &mut SplitMix64,
) {
    for m in 0..MLP_OUTPUTS {
        if m < 2 {
            let e = rng.next_gaussian64();
            eps[m] = e as f32;
            let v = out[m] as f64 + sigma * e;
            act[m] = if v < -1.0 {
                -1.0
            } else if v > 1.0 {
                1.0
            } else {
                v
            } as f32;
        } else {
            eps[m] = 0.0;
            act[m] = out[m];
        }
    }
}

/// Deterministic per-(tick, agent, channel) noise seed in [-1,1]. No
/// Math.random: the observation trajectory is bit-reproducible. Mirrors the
/// TS `deterministicEta` inline hash exactly (u32 wrapping ops == JS imul).
fn deterministic_eta(tick: u32, id: u32, channel: usize) -> f64 {
    let mut h = (tick + 1).wrapping_mul(374761393)
        ^ (id + 1).wrapping_mul(668265263)
        ^ ((channel as u32) + 7).wrapping_mul(2246822519);
    h = (h ^ (h >> 13)).wrapping_mul(1274126177);
    h ^= h >> 16;
    (h & 0xffff) as f64 / 32767.5 - 1.0
}

/// POMDP perception step, in place on `sensors` (the raw brain input). For each
/// partially-observable channel:
///   obs    = clamp01(raw + eta * noise)          (hidden, noisy observation)
///   belief = belief + gain * (obs - belief)      (exponential belief filter)
///   sensors[k] = (1-weight)*obs + weight*belief  (belief-guided policy input)
/// `eta` is seeded from (tick, id, channel) so trajectories are deterministic.
/// Writes the applied noise into `noise_out` (per hidden channel, for telemetry).
pub fn step_pomdp(
    b: &mut BrainState,
    sensors: &mut [f32],
    cfg: &PomdpConfig,
    tick: u32,
    id: u32,
    noise_out: &mut [f32],
) {
    let hidden: &[usize] = cfg.hidden.as_deref().unwrap_or(&DEFAULT_POMDP_HIDDEN);
    let noise = cfg.noise;
    let gain = cfg.gain;
    let weight = cfg.weight;
    let n = hidden.len().min(b.belief.len());
    for j in 0..n {
        let k = hidden[j];
        if k >= sensors.len() {
            continue;
        }
        let eta = deterministic_eta(tick, id, j);
        let raw = sensors[k] as f64;
        let obs = clamp01(raw + eta * noise);
        noise_out[j] = (eta * noise) as f32;
        let bel = b.belief[j] as f64 + gain * (obs - b.belief[j] as f64);
        b.belief[j] = bel as f32;
        sensors[k] = ((1.0 - weight) * obs + weight * bel) as f32;
    }
}

fn clamp_w(v: f64) -> f64 {
    if v < -2.0 {
        -2.0
    } else if v > 2.0 {
        2.0
    } else {
        v
    }
}

/// value-head clamp: the critic readout is unbounded-by-activation, so it gets
/// a wider (still bounded) range than the tanh/sigmoid-weighted layers.
fn clamp_v(v: f64) -> f64 {
    if v < -4.0 {
        -4.0
    } else if v > 4.0 {
        4.0
    } else {
        v
    }
}

/// Backpropagation learning rule (TS engine only). Unlike `observe`'s
/// three-factor Hebbian update, this does a genuine multi-layer backward pass:
/// the TD error of the critic is backpropagated through the output layer and
/// the hidden layer into the input weights, and all trainable weights are
/// updated by gradient descent. The recurrent weights stay fixed at birth
/// (no BPTT); the learned weights remain heritable via `spawn_brain`.
///
/// Returns the absolute TD error (surprise), same convention as `observe`.
/// `sensors` must be the exact input the network saw in the forward pass.
pub fn backprop_brain(
    b: &mut BrainState,
    reward: f64,
    v_cur: f64,
    hidden: &[f32; MLP_HIDDEN],
    out: &[f32; MLP_OUTPUTS],
    sensors: &[f32],
    opts: &BackpropOpts,
) -> f64 {
    let lr = b.lr_gene;
    let gamma = b.gamma;
    let td = b.last_reward + gamma * v_cur - b.v;
    let rpe = td.clamp(-1.0, 1.0);
    let dropout = opts.dropout;
    let drop_mask = if dropout > 0.0 { opts.drop_mask } else { None };
    let gn = opts.grad_noise;
    let grad_vec = if gn > 0.0 { opts.grad_noise_vec } else { None };
    let entropy = opts.entropy;
    let keep = |j: usize| drop_mask.is_none_or(|m| m[j] >= 1.0);
    let gv = |i: usize| -> f64 {
        match grad_vec {
            Some(v) if i < v.len() => gn * v[i] as f64,
            _ => 0.0,
        }
    };

    // Per-hidden-unit gradient accumulated from the value head (pre-update cv)
    // and from each output head (pre-update w2).
    let mut g_h = [0.0f32; MLP_HIDDEN];
    for j in 0..MLP_HIDDEN {
        g_h[j] = if keep(j) {
            (rpe * b.cv[j] as f64) as f32
        } else {
            0.0
        };
    }

    // value head (critic readout): dL/dcv_j = -rpe * h_j, dL/dcb = -rpe
    for j in 0..MLP_HIDDEN {
        if !keep(j) {
            continue;
        }
        b.cv[j] =
            clamp_v(b.cv[j] as f64 + lr * rpe * hidden[j] as f64 + gv(MLP_WEIGHTS + j)) as f32;
    }
    b.cb = clamp_v(b.cb + lr * rpe + gv(MLP_WEIGHTS + MLP_HIDDEN));

    // output head (policy): dL/dz_m = -rpe * act'(z_m). entropy > 0 adds
    // +entropy * out_m * act'(z_m), an anti-collapse bonus that pushes the tanh
    // motor means back toward the high-entropy center (0).
    let out_base = MLP_INPUTS * MLP_HIDDEN + MLP_HIDDEN;
    for m in 0..MLP_OUTPUTS {
        let d_act = if m < 2 {
            1.0 - out[m] as f64 * out[m] as f64
        } else {
            out[m] as f64 * (1.0 - out[m] as f64)
        };
        let ent = if m < 2 { entropy * out[m] as f64 } else { 0.0 };
        let dz = (-rpe + ent) * d_act;
        for j in 0..MLP_HIDDEN {
            let idx = out_base + j * MLP_OUTPUTS + m;
            let w_old = b.w[idx] as f64;
            if keep(j) {
                b.w[idx] = clamp_w(w_old - lr * dz * hidden[j] as f64 + gv(idx)) as f32;
                g_h[j] = (g_h[j] as f64 + dz * w_old) as f32;
            }
        }
        let b_idx = out_base + MLP_HIDDEN * MLP_OUTPUTS + m;
        b.w[b_idx] = clamp_w(b.w[b_idx] as f64 - lr * dz + gv(b_idx)) as f32;
    }

    // hidden layer: dh_j/dz_j = 1 - h_j^2 (tanh) => gradient into w1 and b1
    for j in 0..MLP_HIDDEN {
        if !keep(j) {
            continue;
        }
        let d_act = 1.0 - hidden[j] as f64 * hidden[j] as f64;
        let g = g_h[j] as f64 * d_act;
        for i in 0..MLP_INPUTS {
            let idx = i * MLP_HIDDEN + j;
            b.w[idx] = clamp_w(b.w[idx] as f64 - lr * g * sensors[i] as f64 + gv(idx)) as f32;
        }
        let b1_idx = MLP_INPUTS * MLP_HIDDEN + j;
        b.w[b1_idx] = clamp_w(b.w[b1_idx] as f64 - lr * g + gv(b1_idx)) as f32;
    }

    b.last_reward = reward;
    b.v = v_cur;
    td.abs()
}
