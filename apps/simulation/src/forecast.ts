/**
 * Neural trend forecasting for the research side and the live-server forecast
 * endpoint. This is a real ML module (a small feed-forward network with a
 * hidden layer, trained online with gradient descent) — nothing LLM-ish. It
 * learns the recent dynamics of one or more world observables (population,
 * mean energy, complexity, entropy, …) and extrapolates them a few steps
 * ahead from the latest window plus an internal "velocity" state.
 *
 * Why a network? A linear extrapolation can't capture population boom/bust
 * curvature or seasonal oscillation. A hidden tanh layer adds enough capacity
 * to represent acceleration and curvature in a single shared model.
 *
 * All RNGs are seedable so forecasts are reproducible.
 */

/** Normalization tracked online: min/max over every point seen. */
class Normalizer {
  private min = Infinity;
  private max = -Infinity;

  push(v: number): void {
    if (!Number.isFinite(v)) return;
    if (v < this.min) this.min = v;
    if (v > this.max) this.max = v;
  }

  norm(v: number): number {
    const span = this.max - this.min;
    return span > 1e-9 ? (v - this.min) / span * 2 - 1 : 0;
  }

  denorm(v: number): number {
    const span = this.max - this.min;
    return span > 1e-9 ? (v + 1) / 2 * span + this.min : this.min;
  }
}

export interface ForecastConfig {
  /** series to forecast (keys into the observation rows) */
  series: string[];
  /** seconds the net has seen — window length (default 24) */
  window: number;
  /** hidden layer width (default 12) */
  hidden: number;
  /** learning rate per observation (default 0.05) */
  lr: number;
  /** steps ahead to extrapolate (default 8) */
  horizon: number;
  /** seeded rng so forecasts are reproducible (default 0x5EED) */
  seed?: number;
}

export interface ForecastStep {
  /** tick offset from the present moment, 1..horizon */
  ahead: number;
  /** per-series prediction (denormalized back to original units) */
  values: Record<string, number>;
}

export interface ForecastResult {
  series: string[];
  window: number;
  horizon: number;
  loss: number;
  /** last observed row (tick = present), for context */
  present: Record<string, number>;
  steps: ForecastStep[];
  /** forecast, expressed as a smooth five-number summary per series */
  bands: Record<string, { trend: number; lo: number; hi: number }>;
}

/** A seeded, minimal combined PRNG (mulberry32) so training is reproducible. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
const tanh = (v: number) => {
  const e = Math.exp(-2 * v);
  return (1 - e) / (1 + e);
};

/**
 * Online MLP forecaster. Feed one observation row per time step; each row is
 * one SGD update; `forecast()` then rolls the network forward `horizon` steps
 * from the latest window.
 */
export class TrendForecaster {
  readonly series: string[];
  private readonly window: number;
  private readonly horizon: number;
  private readonly lr: number;
  private readonly seed: number;
  private readonly nIn: number;
  private readonly nHid: number;
  private readonly nOut: number;
  // weights: w1[nIn*nHid], b1[nHid], w2[nHid*nOut], b2[nOut]
  private w1: Float64Array;
  private b1: Float64Array;
  private w2: Float64Array;
  private b2: Float64Array;
  /** velocity state (internal memory so trend is not just the last window) */
  private vel: Float64Array;
  private readonly norm = new Map<string, Normalizer>();
  /** row ring buffer: [{tick, values}...] */
  private ring: Array<{ tick: number; values: Record<string, number> }> = [];
  /** rolling RMS loss over the last observations */
  private lossAcc = 0;
  private lossN = 0;
  private lastLoss = 0;

  constructor(cfg: ForecastConfig) {
    this.series = cfg.series;
    this.series.forEach((s) => this.norm.set(s, new Normalizer()));
    this.window = cfg.window;
    this.horizon = cfg.horizon;
    this.lr = cfg.lr;
    this.seed = cfg.seed ?? 0x5eed;
    this.nIn = this.series.length * cfg.window;
    this.nHid = cfg.hidden;
    this.nOut = this.series.length;
    this.w1 = new Float64Array(this.nIn * this.nHid);
    this.b1 = new Float64Array(this.nHid);
    this.w2 = new Float64Array(this.nHid * this.nOut);
    this.b2 = new Float64Array(this.nOut);
    this.vel = new Float64Array(this.nHid);
    const rng = mulberry32(this.seed);
    const init = Math.sqrt(6 / (this.nIn + this.nHid));
    for (let i = 0; i < this.w1.length; i++) this.w1[i] = (rng() * 2 - 1) * init;
    for (let i = 0; i < this.w2.length; i++) this.w2[i] = (rng() * 2 - 1) * init;
  }

  get loss(): number {
    return this.lossN > 0 ? this.lossAcc / this.lossN : 0;
  }

  /** Push one observation and train one online SGD step over the current window. */
  observe(tick: number, row: Record<string, number>): void {
    this.ring.push({ tick, values: row });
    if (this.ring.length > 2 * this.window) this.ring.shift();
    for (const s of this.series) {
      const v = row[s];
      if (Number.isFinite(v)) this.norm.get(s)!.push(v);
    }
    if (this.ring.length < this.window + 1) return;
    const x = this.windowInput();
    // targets: the observation immediately after the window
    const target = this.ring[this.ring.length - 1]!;
    const t = Float64Array.from(this.series.map((s) => this.norm.get(s)!.norm(target.values[s] ?? 0)));
    this.trainStep(x, t);
    // residual loss (on normalized scale)
    let rms = 0;
    for (let i = 0; i < this.nOut; i++) {
      const d = this.forwardOut[i]! - t[i]!;
      rms += d * d;
    }
    this.lossAcc += Math.sqrt(rms / this.nOut);
    this.lossN++;
    this.lastLoss = rms / this.nOut;
  }

  /** Extrapolate `horizon` steps from the latest window, recursively. */
  forecast(): ForecastResult {
    const present = this.ring[this.ring.length - 1]!
      ? { ...this.ring[this.ring.length - 1]!.values }
      : {};
    const lastTick = this.ring.length ? this.ring[this.ring.length - 1]!.tick : 0;
    const x = this.windowInput();
    const steps: ForecastStep[] = [];
    const net = Float64Array.from(x);
    // `forwardOut` is only populated once a training step has run; when the
    // ring is shorter than the window it stays length 0, so size it ourselves.
    const outs = new Float64Array(this.nOut);
    for (let k = 1; k <= this.horizon; k++) {
      const out = this.roll(net);
      const values: Record<string, number> = {};
      for (let s = 0; s < this.series.length; s++) {
        values[this.series[s]!] = Number(this.norm.get(this.series[s]!)!.denorm(out[s]!));
      }
      steps.push({ ahead: k, values });
      // shift the window left by one and append the just-predicted point
      for (let i = 0; i < this.nIn - this.series.length; i++) net[i] = net[i + this.series.length]!;
      for (let s = 0; s < this.series.length; s++) net[this.nIn - this.series.length + s] = this.norm.get(this.series[s]!)!.norm(values[this.series[s]!]!);
      outs.set(out);
    }
    // forecast bands: linear fit of the predicted path for direction + spread
    const bands: ForecastResult['bands'] = {};
    for (const s of this.series) {
      const vals = steps.map((st) => st.values[s]!);
      const slope = lr0(steps.map((st) => st.ahead), vals);
      const sd = stdevOf(vals);
      const presentVal = Number(present[s] ?? 0);
      bands[s] = {
        trend: presentVal + slope * ((this.horizon + 1) / 2),
        lo: Math.min(presentVal, presentVal + slope * this.horizon) - sd * 2,
        hi: Math.max(presentVal, presentVal + slope * this.horizon) + sd * 2,
      };
    }
    return {
      series: [...this.series],
      window: this.window,
      horizon: this.horizon,
      loss: this.lastLoss,
      present,
      steps,
      bands,
    };
  }

  // --- internal helpers -------------------------------------------------

  private forwardOut = new Float64Array(0);

  private windowInput(): Float64Array {
    const n = this.ring.length;
    const start = Math.max(0, n - this.window);
    const x = new Float64Array(this.nIn);
    for (let i = 0; i < this.window; i++) {
      const row = this.ring[start + i];
      if (!row) continue;
      for (let s = 0; s < this.series.length; s++) {
        x[i * this.series.length + s] = this.norm.get(this.series[s]!)!.norm(row.values[this.series[s]!] ?? 0);
      }
    }
    return x;
  }

  private forward(x: Float64Array): Float64Array {
    const h = new Float64Array(this.nHid);
    for (let j = 0; j < this.nHid; j++) {
      let acc = this.b1[j]!;
      for (let i = 0; i < this.nIn; i++) acc += x[i]! * this.w1[j * this.nIn + i]!;
      h[j] = tanh(acc);
    }
    const out = new Float64Array(this.nOut);
    for (let k = 0; k < this.nOut; k++) {
      let acc = this.b2[k]!;
      for (let j = 0; j < this.nHid; j++) acc += h[j]! * this.w2[k * this.nHid + j]!;
      out[k] = acc;
    }
    return out;
  }

  /** One gradient-descent update: backprop through one hidden layer. */
  private trainStep(x: Float64Array, target: Float64Array): void {
    const h = new Float64Array(this.nHid);
    for (let j = 0; j < this.nHid; j++) {
      let acc = this.b1[j]!;
      for (let i = 0; i < this.nIn; i++) acc += x[i]! * this.w1[j * this.nIn + i]!;
      h[j] = tanh(acc);
    }
    const out = new Float64Array(this.nOut);
    for (let k = 0; k < this.nOut; k++) {
      let acc = this.b2[k]!;
      for (let j = 0; j < this.nHid; j++) acc += h[j]! * this.w2[k * this.nHid + j]!;
      out[k] = acc;
    }
    // output deltas (linear head)
    const dOut = new Float64Array(this.nOut);
    for (let k = 0; k < this.nOut; k++) dOut[k] = out[k]! - target[k]!;
    // hidden deltas
    const dH = new Float64Array(this.nHid);
    for (let j = 0; j < this.nHid; j++) {
      let acc = 0;
      for (let k = 0; k < this.nOut; k++) acc += dOut[k]! * this.w2[k * this.nHid + j]!;
      dH[j] = acc * (1 - h[j]! * h[j]!);
    }
    // weight + bias updates
    for (let k = 0; k < this.nOut; k++) {
      for (let j = 0; j < this.nHid; j++) {
        this.w2[k * this.nHid + j]! -= this.lr * dOut[k]! * h[j]!;
      }
      this.b2[k]! -= this.lr * dOut[k]!;
    }
    for (let j = 0; j < this.nHid; j++) {
      for (let i = 0; i < this.nIn; i++) {
        this.w1[j * this.nIn + i]! -= this.lr * dH[j]! * x[i]!;
      }
      this.b1[j]! -= this.lr * dH[j]!;
    }
    this.forwardOut = out;
  }

  /** Roll the net one step: forward over the window, then update internal velocity. */
  private roll(x: Float64Array): Float64Array {
    const out = this.forward(x);
    // integrate velocity memory: a running average of successive outputs
    for (let k = 0; k < this.nOut; k++) {
      this.vel[k] = 0.8 * this.vel[k]! + 0.2 * out[k]!;
      out[k] = out[k]! * 0.5 + this.vel[k]! * 0.5;
    }
    return out;
  }
}

function lr0(xs: number[], ys: number[]): number {
  const n = xs.length;
  if (n < 2) return 0;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i]! - mx) * (ys[i]! - my);
    den += (xs[i]! - mx) * (xs[i]! - mx);
  }
  return den === 0 ? 0 : num / den;
}

function stdevOf(vs: number[]): number {
  const n = vs.length;
  if (n < 2) return 0;
  const m = vs.reduce((a, b) => a + b, 0) / n;
  return Math.sqrt(vs.reduce((a, b) => a + (b - m) * (b - m), 0) / (n - 1));
}

/** Convenience: feed a whole trajectory and get a forecast back. */
export function forecastSeries(
  trajectory: Array<{ tick: number } & Record<string, number>>,
  series: string[],
  cfg: Partial<ForecastConfig> = {},
): ForecastResult {
  const fc = new TrendForecaster({
    series,
    // never demand more history than the trajectory holds minus one (each
    // training step needs a window plus one next-tick target)
    window: Math.min(cfg.window ?? 24, Math.max(2, trajectory.length - 1)),
    hidden: cfg.hidden ?? 12,
    lr: cfg.lr ?? 0.05,
    horizon: cfg.horizon ?? 8,
    seed: cfg.seed,
  });
  for (const row of trajectory) fc.observe(row.tick, row);
  return fc.forecast();
}