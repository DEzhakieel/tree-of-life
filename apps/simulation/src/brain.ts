import {
  MLP_WEIGHTS,
  MLP_HOUT_W,
  MLP_INPUTS,
  MLP_HIDDEN,
  MLP_OUTPUTS,
  BRAIN_OFFSET,
  BRAIN_REC_OFFSET,
  BRAIN_REC_COUNT,
  CRITIC_OFFSET,
  PLASTICITY_OFFSET,
  PLASTICITY_GENES,
} from '@fractal-life/shared';
import { fastTanh } from './genome.js';

/** POMDP perception: sensors picked out as partially observable get
 *  deterministic observation noise, a running belief estimate, and the belief
 *  is blended into the policy input (belief-guided action). Opt-in per engine
 *  via `BrainConfig.pomdp`. */
export interface POMDPConfig {
  enabled: boolean;
  /** observation noise scale; each hidden channel is perturbed by
   *  ±uniform(0,noise) seeded from (tick, agent id, channel). Default 0.08. */
  noise?: number;
  /** belief filter learning rate (exponential average toward observations),
   *  0..1. Default 0.2. */
  gain?: number;
  /** belief blend weight in the policy input: `(1-w)*obs + w*belief`.
   *  Default 0.4 — policy acts mostly on the observation, tempered by belief. */
  weight?: number;
  /** sensor channels treated as partially observable. Default masks the
   *  distal/uncertain quantities: nearest neighbour D, food, meat, threat D,
   *  minerals. */
  hidden?: number[];
}

/** sensor channels that are only indirectly observable by default */
export const DEFAULT_POMDP_HIDDEN = [4, 6, 7, 10, 13];

/** Stochastic policy head: add Gaussian exploration noise to the motor
 *  outputs. The mean policy `out` is still what backprop learns through
 *  (reparameterization: sampled action = mean + sigma * eps), so exploration
 *  and gradient descent coexist. Default: deterministic (no sampling). */
export interface PolicyConfig {
  mode: 'deterministic' | 'gaussian';
  /** action noise std (full `sigma` at tick 0) */
  sigma: number;
  /** noise floor after the entropy-annealing schedule completes */
  sigmaMin: number;
  /** ticks over which sigma anneals sigma -> sigmaMin (0 = constant) */
  annealTicks: number;
}

/** Engine-level config — optional overrides beat the per-agent genes. */
export interface BrainConfig {
  enabled: boolean;
  lr?: number;
  gamma?: number;
  lambda?: number;
  inherit?: number;
  /** learning rule. `hebbian` = surprise-modulated three-factor Hebbian (the
   *  historical default, mirrored by the WASM engine); `backprop` = gradient
   *  descent through the MLP on the TD error (TS engine only). Default
   *  hebbian, so parity with the Rust build is preserved out of the box. */
  learn?: 'hebbian' | 'backprop';
  /** when provided and enabled, applies the hidden/noisy-observation model */
  pomdp?: POMDPConfig;
  /** stochastic policy head (default deterministic — pure gradient ascent) */
  policy?: PolicyConfig;
  /** backprop SGD: dropout probability applied to hidden units during the
   *  weight update. Masks are re-drawn per (agent, tick); inference is
   *  unaffected because dropout only gates the learning step. Default 0. */
  dropout?: number;
  /** backprop SGD: std of the zero-mean Gaussian noise added to each weight
   *  delta, a crude stochastic-gradient regularizer. Default 0. */
  gradNoise?: number;
  /** backprop exploration bonus: gradient of H ~ -|out| on the two motor
   *  heads, pushing outputs toward the high-entropy center and resisting
   *  policy collapse. Default 0. */
  entropy?: number;
}

/** Option bag for `backpropBrain`'s stochastic-gradient regularizers. */
export interface BackpropOpts {
  /** hidden-unit dropout probability (0 = no dropout) */
  dropout?: number;
  /** 1 = keep, 0 = drop; length MLP_HIDDEN. Ignored when dropout is 0. */
  dropMask?: Float32Array;
  /** std of gradient noise (0 = none) */
  gradNoise?: number;
  /** standard normals (length MLP_WEIGHTS + MLP_HIDDEN + 1) added to the
   *  weight deltas; ignored when gradNoise is 0. */
  gradNoiseVec?: Float32Array;
  /** entropy bonus on the motor heads (see BrainConfig.entropy) */
  entropy?: number;
}

/**
 * Per-agent plastic recurrent neural network (mirror of the Rust brain).
 * The output layer `[64..99]` is plastic: eligibility traces + a TD critic
 * drive surprise-modulated Hebbian updates each tick.
 */
export interface BrainState {
  /** current (learned) connection weights, seeded from the genome MLP block */
  w: Float32Array;
  /** eligibility traces on the output layer */
  e: Float32Array;
  /** TD critic: predicted discounted future reward */
  v: number;
  /** recurrent hidden state (Elman feedback) */
  h: Float32Array;
  /** reward harvested as a consequence of the last decision */
  lastReward: number;
  /** recurrent weights (fixed at birth) */
  rec: Float32Array;
  /** critic readout weights over the hidden layer */
  cv: Float32Array;
  /** critic bias */
  cb: number;
  /** heredity of learned synapses (alpha) */
  inherit: number;
  /** plastic learning rate */
  lrGene: number;
  /** TD discount */
  gamma: number;
  /** eligibility trace decay */
  lambda: number;
  /** running belief estimates over the partially-observable channels
   *  (POMDP); empty when the pomdp perception model is disabled */
  belief: Float32Array;
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const genomeAt = (g: Float32Array, i: number) => g[i] ?? 0;
const mapLr = (v: number) => 0.001 + clamp01((v + 1) / 2) * 0.049;
const mapDiscount = (v: number) => 0.8 + clamp01((v + 1) / 2) * 0.19;

export function createBrain(genome: Float32Array, cfg: BrainConfig): BrainState {
  const w = new Float32Array(MLP_WEIGHTS);
  for (let i = 0; i < MLP_WEIGHTS; i++) w[i] = genomeAt(genome, BRAIN_OFFSET + i);
  const rec = new Float32Array(BRAIN_REC_COUNT);
  for (let i = 0; i < BRAIN_REC_COUNT; i++) rec[i] = genomeAt(genome, BRAIN_REC_OFFSET + i);
  const cv = new Float32Array(MLP_HIDDEN);
  for (let i = 0; i < MLP_HIDDEN; i++) cv[i] = genomeAt(genome, CRITIC_OFFSET + i);
  // belief is always sized to the default channel set so POMDP can be enabled
  // AFTER founder spawn (config is set post-construction). Bounded [0,1] priors.
  const beliefLen = DEFAULT_POMDP_HIDDEN.length;
  return {
    w,
    e: new Float32Array(MLP_HOUT_W),
    v: 0,
    h: new Float32Array(MLP_HIDDEN),
    lastReward: 0,
    rec,
    cv,
    cb: genomeAt(genome, CRITIC_OFFSET + MLP_HIDDEN),
    inherit: cfg.inherit ?? clamp01((genomeAt(genome, PLASTICITY_OFFSET + PLASTICITY_GENES.INHERIT) + 1) / 2),
    lrGene: cfg.lr ?? mapLr(genomeAt(genome, PLASTICITY_OFFSET + PLASTICITY_GENES.LR)),
    gamma: cfg.gamma ?? mapDiscount(genomeAt(genome, PLASTICITY_OFFSET + PLASTICITY_GENES.GAMMA)),
    lambda: cfg.lambda ?? mapDiscount(genomeAt(genome, PLASTICITY_OFFSET + PLASTICITY_GENES.LAMBDA)),
    // uncertain priors (mid-range) over the hidden channels
    belief: new Float32Array(beliefLen).fill(0.5),
  };
}

/** Lamarckian-Baldwinian heredity: blend parent's learned weights with the child's template. */
export function spawnBrain(parent: BrainState, genome: Float32Array, cfg: BrainConfig): BrainState {
  const b = createBrain(genome, cfg);
  if (!cfg.enabled) return b;
  const alpha = Math.min(1, Math.max(0, b.inherit));
  for (let i = 0; i < MLP_WEIGHTS; i++) {
    const template = b.w[i]!;
    b.w[i] = template + alpha * (parent.w[i]! - template);
  }
  // offspring inherit the parent's belief priors, not just its synapses
  if (parent.belief.length > 0 && b.belief.length === parent.belief.length) b.belief.set(parent.belief);
  return b;
}

export function learnedMag(b: BrainState, genome: Float32Array): number {
  let acc = 0;
  for (let i = 0; i < MLP_WEIGHTS; i++) acc += Math.abs(b.w[i]! - genomeAt(genome, BRAIN_OFFSET + i));
  return acc / MLP_WEIGHTS;
}

/**
 * Plastic recurrent forward pass (Elman MLP with learned weights). Writes the
 * hidden state back into the brain and fills `out`. Returns the critic V(s).
 */
export function forwardBrain(b: BrainState, sensor: Float32Array, hidden: Float32Array, out: Float32Array): number {
  for (let j = 0; j < MLP_HIDDEN; j++) {
    let acc = b.w[MLP_INPUTS * MLP_HIDDEN + j]!;
    for (let i = 0; i < MLP_INPUTS; i++) acc += sensor[i]! * b.w[i * MLP_HIDDEN + j]!;
    for (let k = 0; k < MLP_HIDDEN; k++) acc += b.h[k]! * b.rec[k * MLP_HIDDEN + j]!;
    hidden[j] = fastTanh(acc);
  }
  b.h.set(hidden);
  const outBase = MLP_INPUTS * MLP_HIDDEN + MLP_HIDDEN;
  for (let j = 0; j < MLP_OUTPUTS; j++) {
    let acc = b.w[outBase + MLP_HIDDEN * MLP_OUTPUTS + j]!;
    for (let i = 0; i < MLP_HIDDEN; i++) acc += hidden[i]! * b.w[outBase + i * MLP_OUTPUTS + j]!;
    out[j] = j < 2 ? fastTanh(acc) : 1 / (1 + Math.exp(-acc));
  }
  let v = b.cb;
  for (let i = 0; i < MLP_HIDDEN; i++) v += hidden[i]! * b.cv[i]!;
  return v;
}

/**
 * Surprise-modulated ("three-factor") Hebbian learning + TD critic. Returns
 * the absolute TD error (surprise), used for telemetry.
 */
export function observeBrain(b: BrainState, reward: number, vCur: number, hidden: Float32Array, out: Float32Array): number {
  const lr = b.lrGene;
  const gamma = b.gamma;
  const lambda = b.lambda;
  const td = b.lastReward + gamma * vCur - b.v;
  for (let j = 0; j < MLP_OUTPUTS; j++) {
    for (let i = 0; i < MLP_HIDDEN; i++) {
      const idx = i * MLP_OUTPUTS + j;
      b.e[idx] = lambda * b.e[idx]! + hidden[i]! * out[j]!;
    }
    const bIdx = MLP_HIDDEN * MLP_OUTPUTS + j;
    b.e[bIdx] = lambda * b.e[bIdx]! + out[j]!;
  }
  const rpe = Math.max(-1, Math.min(1, td));
  const hidBase = MLP_INPUTS * MLP_HIDDEN + MLP_HIDDEN;
  for (let idx = 0; idx < MLP_HOUT_W; idx++) {
    let wtmp = b.w[hidBase + idx]! + lr * rpe * b.e[idx]!;
    wtmp = Math.max(-2, Math.min(2, wtmp));
    b.w[hidBase + idx] = wtmp;
  }
  b.lastReward = reward;
  b.v = vCur;
  return Math.abs(td);
}

const clampW = (v: number) => (v < -2 ? -2 : v > 2 ? 2 : v);
/** value-head clamp: the critic readout is unbounded-by-activation, so it gets
 *  a wider (still bounded) range than the tanh/sigmoid-weighted layers. */
const clampV = (v: number) => (v < -4 ? -4 : v > 4 ? 4 : v);

/**
 * Backpropagation learning rule (TS engine only). Unlike `observeBrain`'s
 * three-factor Hebbian update, this does a genuine multi-layer backward pass:
 * the TD error of the critic is backpropagated through the output layer and
 * the hidden layer into the input weights, and all trainable weights are
 * updated by gradient descent. The recurrent weights stay fixed at birth
 * (no BPTT); the learned weights remain heritable via `spawnBrain`.
 *
 * Returns the absolute TD error (surprise), same convention as `observeBrain`.
 * `sensors` must be the exact input the network saw in the forward pass.
 */
export function backpropBrain(
  b: BrainState,
  reward: number,
  vCur: number,
  hidden: Float32Array,
  out: Float32Array,
  sensors: Float32Array,
  opts: BackpropOpts = {},
): number {
  const lr = b.lrGene;
  const gamma = b.gamma;
  const td = b.lastReward + gamma * vCur - b.v;
  const rpe = Math.max(-1, Math.min(1, td));
  const dropout = opts.dropout ?? 0;
  const dropMask = dropout > 0 ? opts.dropMask : undefined;
  const gn = opts.gradNoise ?? 0;
  const gradVec = gn > 0 ? opts.gradNoiseVec : undefined;
  const entropy = opts.entropy ?? 0;
  const keep = (j: number) => (dropMask === undefined || dropMask[j]! >= 1 ? true : false);
  const gv = (i: number): number =>
    gradVec !== undefined && i >= 0 && i < gradVec.length ? gn * gradVec[i]! : 0;

  // Per-hidden-unit gradient accumulated from the value head (pre-update cv)
  // and from each output head (pre-update w2).
  const gH = new Float32Array(MLP_HIDDEN);
  for (let j = 0; j < MLP_HIDDEN; j++) gH[j] = keep(j) ? rpe * b.cv[j]! : 0;

  // value head (critic readout): dL/dcv_j = -rpe * h_j, dL/dcb = -rpe
  for (let j = 0; j < MLP_HIDDEN; j++) {
    if (!keep(j)) continue;
    b.cv[j] = clampV(b.cv[j]! + lr * rpe * hidden[j]! + gv(MLP_WEIGHTS + j));
  }
  b.cb = clampV(b.cb + lr * rpe + gv(MLP_WEIGHTS + MLP_HIDDEN));

  // output head (policy): dL/dz_m = -rpe * act'(z_m). td drives the outputs
  // toward whatever increased reward (positive td reinforces the action,
  // negative td suppresses it — deterministic-policy-gradient flavoured).
  // entropy > 0 adds +entropy * out_m * act'(z_m), an anti-collapse bonus that
  // pushes the tanh motor means back toward the high-entropy center (0).
  const outBase = MLP_INPUTS * MLP_HIDDEN + MLP_HIDDEN;
  for (let m = 0; m < MLP_OUTPUTS; m++) {
    const dAct = m < 2 ? 1 - out[m]! * out[m]! : out[m]! * (1 - out[m]!);
    const ent = m < 2 ? entropy * out[m]! : 0;
    const dz = (-rpe + ent) * dAct;
    for (let j = 0; j < MLP_HIDDEN; j++) {
      const idx = outBase + j * MLP_OUTPUTS + m;
      const wOld = b.w[idx]!;
      if (keep(j)) {
        b.w[idx] = clampW(wOld - lr * dz * hidden[j]! + gv(idx));
        gH[j]! += dz * wOld;
      }
    }
    const bIdx = outBase + MLP_HIDDEN * MLP_OUTPUTS + m;
    b.w[bIdx] = clampW(b.w[bIdx]! - lr * dz + gv(bIdx));
  }

  // hidden layer: dh_j/dz_j = 1 - h_j^2 (tanh) => gradient into w1 and b1
  for (let j = 0; j < MLP_HIDDEN; j++) {
    if (!keep(j)) continue;
    const dAct = 1 - hidden[j]! * hidden[j]!;
    const g = gH[j]! * dAct;
    for (let i = 0; i < MLP_INPUTS; i++) {
      const idx = i * MLP_HIDDEN + j;
      b.w[idx] = clampW(b.w[idx]! - lr * g * sensors[i]! + gv(idx));
    }
    const b1Idx = MLP_INPUTS * MLP_HIDDEN + j;
    b.w[b1Idx] = clampW(b.w[b1Idx]! - lr * g + gv(b1Idx));
  }

  b.lastReward = reward;
  b.v = vCur;
  return Math.abs(td);
}

/** Entropy-annealed exploration sigma for tick `t` of a gaussian policy. */
export function policySigma(cfg: PolicyConfig, tick: number): number {
  if (cfg.annealTicks <= 0 || tick >= cfg.annealTicks) return cfg.sigmaMin;
  const frac = tick / cfg.annealTicks;
  return cfg.sigmaMin + (cfg.sigma - cfg.sigmaMin) * (1 - frac);
}

/**
 * Reparameterized action sampling for a stochastic policy: act = clamp01(
 * out + sigma * eps). `eps` receives the standard-normal draws used, so the
 * trace can be rewritten and the draws come from one seeded rng supply
 * (defaults to a supplied gaussian). Only the two motor heads are sampled;
 * the gating outputs keep the mean.
 */
export function sampleGaussianAction(
  out: Float32Array,
  act: Float32Array,
  eps: Float32Array,
  sigma: number,
  gauss: () => number,
): void {
  for (let m = 0; m < MLP_OUTPUTS; m++) {
    if (m < 2) {
      const e = gauss();
      eps[m] = e;
      const v = out[m]! + sigma * e;
      act[m] = v < -1 ? -1 : v > 1 ? 1 : v;
    } else {
      eps[m] = 0;
      act[m] = out[m]!;
    }
  }
}

export function brainSeed(genome: Float32Array): BrainState {
  return createBrain(genome, { enabled: true });
}

/** Deterministic per-(tick, agent, channel) noise seed in [-1,1]. No
 *  Math.random: the observation trajectory is bit-reproducible. */
const deterministicEta = (tick: number, id: number, channel: number): number => {
  let h = Math.imul(tick + 1, 374761393) ^ Math.imul(id + 1, 668265263) ^ Math.imul(channel + 7, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h & 0xffff) / 32767.5 - 1;
};

/**
 * POMDP perception step, in place on `sensors` (the raw brain input). For each
 * partially-observable channel:
 *   obs    = clamp01(raw + eta * noise)          (hidden, noisy observation)
 *   belief = belief + gain * (obs - belief)      (exponential belief filter)
 *   sensors[k] = (1-weight)*obs + weight*belief  (belief-guided policy input)
 * `beta` is seeded from (tick, id, channel) so trajectories are deterministic.
 * Writes the applied noise into `noiseOut` (per hidden channel, for telemetry).
 */
export function stepPomdp(
  b: BrainState,
  sensors: Float32Array,
  cfg: POMDPConfig,
  tick: number,
  id: number,
  noiseOut: Float32Array,
): void {
  const hidden = cfg.hidden ?? DEFAULT_POMDP_HIDDEN;
  const noise = cfg.noise ?? 0.08;
  const gain = cfg.gain ?? 0.2;
  const weight = cfg.weight ?? 0.4;
  const n = Math.min(hidden.length, b.belief.length);
  for (let j = 0; j < n; j++) {
    const k = hidden[j]!;
    if (k < 0 || k >= sensors.length) continue;
    const eta = deterministicEta(tick, id, j);
    const raw = sensors[k]!;
    const obs = clamp01(raw + eta * noise);
    noiseOut[j] = eta * noise;
    const bel = b.belief[j]! + gain * (obs - b.belief[j]!);
    b.belief[j] = bel;
    sensors[k] = (1 - weight) * obs + weight * bel;
  }
}