import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { WorldConfig } from '@fractal-life/shared';
import { DEFAULT_PARAMS } from '@fractal-life/shared';
import { MLP_INPUTS, MLP_HIDDEN, MLP_OUTPUTS, MLP_WEIGHTS } from '@fractal-life/shared';
import { Engine } from '../src/engine.js';
import { SplitMix64 } from '../src/rng.js';
import { randomGenome } from '../src/genome.js';
import { createBrain, forwardBrain, backpropBrain, policySigma, sampleGaussianAction, type BrainConfig, type PolicyConfig } from '../src/brain.js';
import {
  createWorldStochState,
  stepWeather,
  stepOu,
  stepBurst,
  poissonDraw,
  DEFAULT_WEATHER_MATRIX,
  type WorldStochasticConfig,
} from '../src/worldStoch.js';

function makeWorld(spawnCount = 8, seed = 'stoch-test'): WorldConfig {
  return {
    id: `test-${seed}`,
    seed,
    fractalType: 'mandelbrot',
    params: { ...DEFAULT_PARAMS, spawnCount },
    createdAt: 0,
    currentTick: 0,
  };
}

function frames(engine: Engine, ticks: number, cfg: BrainConfig) {
  engine.setBrainConfig(cfg);
  const out: Array<Record<string, unknown>> = [];
  for (let t = 0; t < ticks; t++) {
    engine.tick();
    out.push({ ...(engine as unknown as { __tr: Record<string, unknown> }).__tr });
  }
  return out;
}

/** Brain with every trainable weight zeroed: h stays 0, v = cb, out[0..1]=0. */
function cleanBrain(cfg: BrainConfig) {
  const b = createBrain(randomGenome(new SplitMix64(5)), cfg);
  b.w.fill(0);
  b.rec.fill(0);
  b.cv.fill(0);
  b.cb = 0;
  b.h.fill(0);
  b.e.fill(0);
  return b;
}

const OUT_BASE = MLP_INPUTS * MLP_HIDDEN + MLP_HIDDEN;

describe('stochastic world: defaults & determinism', () => {
  it('off by default (no weather trace, plain regen)', () => {
    const eng = new Engine(makeWorld());
    eng.setBrainConfig({ enabled: false });
    eng.tick();
    const tr = (eng as unknown as { __tr: Record<string, unknown> }).__tr;
    assert.equal(tr.weatherId, undefined, 'no weather telemetry when disabled');
    assert.equal(tr.weather, undefined);
  });

  it('is deterministic for identical seeds & config', () => {
    const a = new Engine(makeWorld(6, 'world-stoch'));
    const b = new Engine(makeWorld(6, 'world-stoch'));
    a.setWorldStochastics({});
    b.setWorldStochastics({});
    a.setBrainConfig({ enabled: false });
    b.setBrainConfig({ enabled: false });
    for (let t = 0; t < 120; t++) {
      a.tick();
      b.tick();
      assert.equal((a as unknown as { __tr: Record<string, unknown> }).__tr.weatherId,
        (b as unknown as { __tr: Record<string, unknown> }).__tr.weatherId, `tick ${t + 1} weather`);
      assert.deepEqual(a.grid.food, b.grid.food, `tick ${t + 1} food grid`);
    }
  });

  it('diverges from the plain deterministic world', () => {
    const a = new Engine(makeWorld(6, 'world-stoch'));
    const b = new Engine(makeWorld(6, 'world-stoch'));
    b.setWorldStochastics({});
    a.setBrainConfig({ enabled: false });
    b.setBrainConfig({ enabled: false });
    let diff = 0;
    for (let t = 0; t < 80; t++) {
      a.tick();
      b.tick();
      if (b.grid.food.some((v, i) => v !== a.grid.food[i])) diff++;
    }
    assert.ok(diff > 0, 'stochastic world should perturb resource regen');
    const seen = new Set<number>();
    for (let t = 0; t < 80; t++) {
      seen.add((b as unknown as { __tr: Record<string, unknown> }).__tr.weatherId as number);
    }
    assert.ok(seen.size > 0, 'weather states observed');
  });

  it('reaches every weather state over a long run', () => {
    const eng = new Engine(makeWorld(3, 'weather-reach'));
    eng.setWorldStochastics({});
    eng.setBrainConfig({ enabled: false });
    const seen = new Set<number>();
    for (let t = 0; t < 2000; t++) {
      eng.tick();
      seen.add((eng as unknown as { __tr: Record<string, unknown> }).__tr.weatherId as number);
    }
    for (let s = 0; s < 4; s++) {
      assert.ok(seen.has(s), `weather state ${s} reachable`);
    }
  });
});

describe('stochastic world: modules', () => {
  it('OU field stays inside [1-band, 1+band] perturbed but mean-reverting', () => {
    const cfg: WorldStochasticConfig = { enabled: true, poissonRate: 40, ouTheta: 0.3, ouSigma: 0.06, ouBand: 0.25, weather: null };
    let st = createWorldStochState(8);
    const rng = new SplitMix64(42);
    for (let t = 0; t < 400; t++) stepOu(st, rng, cfg, 1);
    for (const v of st.ouMul) {
      assert.ok(v >= 0.75 && v <= 1.25, `ouMul ${v} within band`);
    }
    const spread = Math.max(...st.ouMul) - Math.min(...st.ouMul);
    assert.ok(spread > 0.01, 'OU field fluctuates');
    // mean-reversion: after enough annealing the field hovers near 1
    st = createWorldStochState(8);
    const rng2 = new SplitMix64(43);
    const calm: WorldStochasticConfig = { ...cfg, ouSigma: 0.002 };
    for (let t = 0; t < 2000; t++) stepOu(st, rng2, calm, 1);
    const mean = st.ouMul.reduce((s, v) => s + v, 0) / st.ouMul.length;
    assert.ok(Math.abs(mean - 1) < 0.1, `mean-reverted toward 1 (${mean})`);
  });

  it('Poisson draws are non-negative, reproducible and near the rate', () => {
    const rng = new SplitMix64(7);
    const draws = Array.from({ length: 400 }, () => poissonDraw(rng, 40));
    assert.ok(draws.every((d) => d >= 0), 'no negative counts');
    const mean = draws.reduce((s, d) => s + d, 0) / draws.length;
    assert.ok(mean > 28 && mean < 52, `mean events/tick ~ lambda (${mean})`);
    assert.equal(poissonDraw(new SplitMix64(7), 40), poissonDraw(new SplitMix64(7), 40), 'reproducible');
  });

  it('burst flags mark exactly count cells', () => {
    const st = createWorldStochState(8); // 64 cells
    const rng = new SplitMix64(3);
    stepBurst(st, rng, 20);
    assert.equal(st.burstFlags.reduce((s, v) => s + v, 0), 20);
  });

  it('weather is a proper Markov chain on the default transition matrix', () => {
    const st = createWorldStochState(2);
    const counts = [0, 0, 0, 0];
    const rng = new SplitMix64(11);
    for (let t = 0; t < 6000; t++) {
      stepWeather(st, rng, DEFAULT_WEATHER_MATRIX);
      counts[st.weather]!++;
    }
    const total = counts.reduce((s, c) => s + c, 0);
    for (let s = 0; s < 4; s++) {
      const frac = counts[s]! / total;
      assert.ok(frac > 0.01 && frac < 0.99, `weather ${s} plausible stationary share (${frac})`);
    }
  });
});

describe('stochastic policy: gaussian head', () => {
  const pol: PolicyConfig = { mode: 'gaussian', sigma: 0.3, sigmaMin: 0.05, annealTicks: 1000 };

  it('samples actions around the mean and records eps', () => {
    const tr = frames(new Engine(makeWorld(8, 'policy-exp')), 60, { enabled: true, policy: pol });
    let sampled = false;
    let inBounds = true;
    for (const f of tr) {
      const act = f.act as number[] | undefined;
      const out = f.out as number[] | undefined;
      const eps = f.eps as number[] | undefined;
      if (!act) continue;
      if (eps && (Math.abs(eps[0]!) > 1e-9 || Math.abs(eps[1]!) > 1e-9)) sampled = true;
      if (act.some((v) => v < -1 || v > 1)) inBounds = false;
      if (out && Math.abs(act[0]! - out[0]!) > 1e-9) sampled = true;
    }
    assert.ok(sampled, 'gaussian policy actually perturbed some action');
    assert.ok(inBounds, 'sampled actions clamped to [-1,1]');
  });

  it('is deterministic for identical seeds', () => {
    const cfg: BrainConfig = { enabled: true, policy: pol };
    const a = frames(new Engine(makeWorld(8, 'policy-det')), 50, cfg);
    const b = frames(new Engine(makeWorld(8, 'policy-det')), 50, cfg);
    for (let t = 0; t < 50; t++) {
      assert.deepEqual(a[t]!.act, b[t]!.act, `tick ${t + 1} act`);
      assert.deepEqual(a[t]!.eps, b[t]!.eps, `tick ${t + 1} eps`);
    }
  });

  it('anneals sigma from start to floor and emits it in telemetry', () => {
    assert.equal(policySigma(pol, 0), 0.3);
    assert.equal(policySigma(pol, 1000), 0.05);
    const mid = policySigma({ ...pol, sigma: 0.5, sigmaMin: 0.05, annealTicks: 100 }, 50);
    assert.ok(Math.abs(mid - 0.275) < 1e-9, `linear anneal midpoint (${mid})`);
    const flat = policySigma({ ...pol, sigma: 0.2, sigmaMin: 0.1, annealTicks: 0 }, 9999);
    assert.equal(flat, 0.1, 'annealTicks 0 => constant floor');
  });

  it('movement diverges from the mean-only (deterministic) policy', () => {
    const cfgD: BrainConfig = { enabled: true };
    const cfgG: BrainConfig = { enabled: true, policy: pol };
    const d = frames(new Engine(makeWorld(8, 'policy-thrust')), 60, cfgD);
    const g = frames(new Engine(makeWorld(8, 'policy-thrust')), 60, cfgG);
    assert.equal(d[0]!.act, undefined, 'deterministic policy has no act trace');
    let diff = false;
    for (let t = 0; t < 60; t++) {
      if ((d[t]!.thrustX as number) !== (g[t]!.thrustX as number)) diff = true;
    }
    assert.ok(diff, 'stochastic sampling changes actual propulsion');
  });
});

describe('backprop SGD regularizers', () => {
  it('sampleGaussianAction: sigma 0 replicates the mean, sigma>0 samples', () => {
    const out = new Float32Array(MLP_OUTPUTS);
    out[0] = -0.2; out[1] = 0.35; out[2] = 0.8; out[3] = 0.4; out[4] = 0.9; out[5] = 0.2; out[6] = 0.1;
    const act = new Float32Array(MLP_OUTPUTS);
    const eps = new Float32Array(MLP_OUTPUTS);
    sampleGaussianAction(out, act, eps, 0, () => new SplitMix64(1).nextGaussian());
    assert.deepEqual(Array.from(act), Array.from(out), 'zero sigma = mean policy');
    let anyNoise = false;
    sampleGaussianAction(out, act, eps, 1, () => new SplitMix64(1).nextGaussian());
    for (let m = 0; m < 2; m++) if (Math.abs(act[m]! - out[m]!) > 1e-9) anyNoise = true;
    assert.ok(anyNoise, 'nonzero sigma perturbs motor heads');
    for (let m = 2; m < MLP_OUTPUTS; m++) assert.equal(act[m], out[m], 'gates keep the mean');
  });

  it('dropout freezes the dropped hidden unit row', () => {
    const bs = cleanBrain({ enabled: true, learn: 'backprop', gamma: 0.9, lr: 0.05 });
    // give hidden unit 0 and 1 the same driven activation so both would update
    for (let i = 0; i < MLP_INPUTS; i++) {
      bs.w[i * MLP_HIDDEN] = 0.5;
      bs.w[i * MLP_HIDDEN + 1] = 0.5;
    }
    bs.cv[0] = 1;
    bs.cv[1] = 1;
    const sensors = new Float32Array(MLP_INPUTS).fill(0.5);
    const hidden = new Float32Array(MLP_HIDDEN);
    const out = new Float32Array(MLP_OUTPUTS);
    forwardBrain(bs, sensors, hidden, out);
    const dropMask = new Float32Array(MLP_HIDDEN).fill(1);
    dropMask[1] = 0;
    const w1col = (j: number) => Array.from({ length: MLP_INPUTS }, (_, i) => bs.w[i * MLP_HIDDEN + j]!);
    const w2row1Before = Array.from(bs.w.subarray(OUT_BASE + MLP_OUTPUTS, OUT_BASE + 2 * MLP_OUTPUTS));
    const w2row0Before = Array.from(bs.w.subarray(OUT_BASE, OUT_BASE + MLP_OUTPUTS));
    const w1col1Before = w1col(1);
    const cv1Before = bs.cv[1];
    // td = reward + gamma*vCur - b.v = 1 + 1.8 - 0 = 2.8 => rpe = 1, real updates
    backpropBrain(bs, 1, 2, hidden, out, sensors, { dropout: 1, dropMask });
    const w2row1After = Array.from(bs.w.subarray(OUT_BASE + MLP_OUTPUTS, OUT_BASE + 2 * MLP_OUTPUTS));
    const w2row0After = Array.from(bs.w.subarray(OUT_BASE, OUT_BASE + MLP_OUTPUTS));
    const w1col1After = w1col(1);
    assert.deepEqual(w2row1After, w2row1Before, 'dropped unit w2 row untouched');
    assert.deepEqual(w1col1After, w1col1Before, 'dropped unit w1 column untouched');
    assert.equal(bs.cv[1], cv1Before, 'dropped unit critic weight untouched');
    assert.notDeepEqual(w2row0After, w2row0Before, 'kept unit w2 row updated');
  });

  it('gradient noise lands exactly on a zero-gradient update', () => {
    const gn = 0.01;
    // zero network => every analytical gradient is 0, so the update is exactly
    // the injected noise: w = gn * vec (deterministic, seeded).
    const bs = cleanBrain({ enabled: true, learn: 'backprop', gamma: 0.9, lr: 0.05 });
    const sensors = new Float32Array(MLP_INPUTS).fill(0.5);
    const hidden = new Float32Array(MLP_HIDDEN);
    const out = new Float32Array(MLP_OUTPUTS);
    forwardBrain(bs, sensors, hidden, out);
    const vec = new Float32Array(MLP_WEIGHTS + MLP_HIDDEN + 1);
    for (let k = 0; k < vec.length; k++) vec[k] = new SplitMix64(900 + k).nextGaussian();
    backpropBrain(bs, 0, 0, hidden, out, sensors, { gradNoise: gn, gradNoiseVec: vec });
    const near = (got: number, want: number) => Math.abs(got - want) < 1e-9;
    for (let i = 0; i < MLP_WEIGHTS; i++) {
      assert.ok(near(bs.w[i]!, Math.max(-2, Math.min(2, gn * vec[i]!))), `w[${i}] = noise`);
    }
    for (let j = 0; j < MLP_HIDDEN; j++) {
      assert.ok(near(bs.cv[j]!, Math.max(-4, Math.min(4, gn * vec[MLP_WEIGHTS + j]!))), `cv[${j}] = noise`);
    }
    assert.ok(near(bs.cb, Math.max(-4, Math.min(4, gn * vec[MLP_WEIGHTS + MLP_HIDDEN]!))), 'cb = noise');
  });

  it('entropy bonus pushes motor means toward the high-entropy center', () => {
    const mk = () => {
      const b = cleanBrain({ enabled: true, learn: 'backprop', gamma: 0.9, lr: 0.05 });
      b.w[OUT_BASE + MLP_HIDDEN * MLP_OUTPUTS] = 0.7; // motor-0 bias -> out[0] ~ 0.604
      return b;
    };
    const run = (entropy: number) => {
      const b = mk();
      const sensors = new Float32Array(MLP_INPUTS).fill(0.5);
      const hidden = new Float32Array(MLP_HIDDEN);
      const out = new Float32Array(MLP_OUTPUTS);
      forwardBrain(b, sensors, hidden, out);
      const start = out[0]!;
      for (let i = 0; i < 60; i++) {
        forwardBrain(b, sensors, hidden, out); // r=vCur=0, td=0 => no reinf
        backpropBrain(b, 0, 0, hidden, out, sensors, entropy > 0 ? { entropy } : undefined);
      }
      forwardBrain(b, sensors, hidden, out);
      return { start, end: out[0]! };
    };
    const plain = run(0);
    assert.ok(Math.abs(plain.end - plain.start) < 1e-9, `no entropy => no-op (${plain.start}->${plain.end})`);
    const ent = run(1);
    assert.ok(ent.end < ent.start - 0.01, `entropy pulls mean down (${ent.start}->${ent.end})`);
  });

  it('full stack (gaussian policy + backprop + dropout + gradNoise + entropy) runs deterministically without NaN', () => {
    const cfg: BrainConfig = {
      enabled: true,
      learn: 'backprop',
      policy: { mode: 'gaussian', sigma: 0.3, sigmaMin: 0.1, annealTicks: 500 },
      dropout: 0.2,
      gradNoise: 0.005,
      entropy: 0.25,
    };
    const a = frames(new Engine(makeWorld(8, 'full-stack')), 80, cfg);
    const b = frames(new Engine(makeWorld(8, 'full-stack')), 80, cfg);
    let nan = false;
    for (let t = 0; t < 80; t++) {
      const act = a[t]!.act as number[] | undefined;
      const out = a[t]!.out as number[] | undefined;
      if (act && (act.some((v) => !Number.isFinite(v)) || out?.some((v) => !Number.isFinite(v)))) nan = true;
      assert.deepEqual(a[t]!.act, b[t]!.act, `tick ${t + 1} act deterministic`);
      assert.deepEqual(a[t]!.eps, b[t]!.eps, `tick ${t + 1} eps deterministic`);
    }
    assert.equal(nan, false, 'no NaN in sampled actions or means');
  });
});