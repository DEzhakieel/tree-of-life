import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { WorldConfig } from '@fractal-life/shared';
import { DEFAULT_PARAMS } from '@fractal-life/shared';
import { Engine } from '../src/engine.js';
import { SplitMix64 } from '../src/rng.js';
import { randomGenome } from '../src/genome.js';
import { createBrain, spawnBrain, forwardBrain, backpropBrain, type BrainConfig } from '../src/brain.js';
import { MLP_INPUTS, MLP_HIDDEN, MLP_OUTPUTS } from '@fractal-life/shared';

function makeWorld(spawnCount = 8, seed = 'learn-test'): WorldConfig {
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

describe('learning: hebbian default', () => {
  it('unset learn is identical to explicit hebbian', () => {
    const a = frames(new Engine(makeWorld()), 30, { enabled: true });
    const b = frames(new Engine(makeWorld()), 30, { enabled: true, learn: 'hebbian' });
    for (let t = 0; t < 30; t++) {
      assert.deepEqual(a[t]!.sensors, b[t]!.sensors, `tick ${t + 1} sensors`);
      assert.deepEqual(a[t]!.out, b[t]!.out, `tick ${t + 1} out`);
      assert.deepEqual(a[t]!.driveY, b[t]!.driveY, `tick ${t + 1} driveY`);
    }
  });
});

describe('learning: backprop', () => {
  it('is deterministic for identical seeds', () => {
    const cfg: BrainConfig = { enabled: true, learn: 'backprop' };
    const a = frames(new Engine(makeWorld()), 30, cfg);
    const b = frames(new Engine(makeWorld()), 30, cfg);
    for (let t = 0; t < 30; t++) {
      assert.deepEqual(a[t]!.out, b[t]!.out, `tick ${t + 1} out`);
      assert.deepEqual(a[t]!.sensors, b[t]!.sensors, `tick ${t + 1} sensors`);
      assert.deepEqual(a[t]!.thrustX, b[t]!.thrustX, `tick ${t + 1} thrustX`);
    }
  });

  it('produces a different learning trajectory than hebbian', () => {
    const a = frames(new Engine(makeWorld(6)), 100, { enabled: true, learn: 'hebbian' });
    const b = frames(new Engine(makeWorld(6)), 100, { enabled: true, learn: 'backprop' });
    let anyDiff = false;
    for (let t = 0; t < 100; t++) {
      const sa = a[t]!.out as number[] | undefined;
      const sb = b[t]!.out as number[] | undefined;
      if (!sa || !sb) continue;
      if (sa.some((v, i) => Math.abs(v - sb[i]!) > 1e-9)) { anyDiff = true; break; }
    }
    assert.ok(anyDiff, 'backprop should diverge from hebbian learning');
  });

  it('runs a full engine pass without NaN and reports surprise', () => {
    const eng = new Engine(makeWorld());
    eng.setBrainConfig({ enabled: true, learn: 'backprop' });
    let surprise = 0;
    let nan = false;
    for (let t = 0; t < 50; t++) {
      eng.tick();
      const tr = (eng as unknown as { __tr: Record<string, unknown> }).__tr;
      const out = tr.out as number[] | undefined;
      const s = tr.sensors as number[] | undefined;
      if (out && (out.some((v) => !Number.isFinite(v)) || s?.some((v) => !Number.isFinite(v)))) nan = true;
    }
    const stats = eng.brainStats();
    surprise = stats.meanSurprise;
    assert.equal(nan, false, 'no NaN in outputs/sensors');
    assert.ok(Number.isFinite(surprise));
  });
});

describe('learning: gradient correctness', () => {
  it('critic self-consistently converges to the TD fixed point', () => {
    // Self-loop: every state transitions to itself, so V converges to the
    // TD fixpoint V = r / (1-gamma) = 0.2 / 0.1 = 2 (inside the value clamp).
    const bs = cleanBrain({ enabled: true, learn: 'backprop', gamma: 0.9, lr: 0.05 });
    const sensors = new Float32Array(MLP_INPUTS).fill(0.5);
    const hidden = new Float32Array(MLP_HIDDEN);
    const out = new Float32Array(MLP_OUTPUTS);
    forwardBrain(bs, sensors, hidden, out);
    for (let i = 0; i < 3000; i++) {
      const vSelf = forwardBrain(bs, sensors, hidden, out); // V(s_t), h=0 => v=cb
      backpropBrain(bs, 0.2, vSelf, hidden, out, sensors);
    }
    assert.ok(Math.abs(bs.cb - 2) < 1e-2, `critic bias at fixpoint (${bs.cb} vs 2)`);
  });

  it('critic drifts toward the TD target when the oracle is fixed', () => {
    const bs = cleanBrain({ enabled: true, learn: 'backprop', gamma: 0.9, lr: 0.05 });
    const sensors = new Float32Array(MLP_INPUTS).fill(0.5);
    const hidden = new Float32Array(MLP_HIDDEN);
    const out = new Float32Array(MLP_OUTPUTS);
    forwardBrain(bs, sensors, hidden, out); // v = 0
    for (let i = 0; i < 50; i++) {
      forwardBrain(bs, sensors, hidden, out);
      backpropBrain(bs, 1, 2, hidden, out, sensors); // target = 1 + 0.9*2 = 2.8
    }
    assert.ok(bs.cb > 0.5, `raised toward +2.8 (${bs.cb})`);
    const bs2 = cleanBrain({ enabled: true, learn: 'backprop', gamma: 0.9, lr: 0.05 });
    forwardBrain(bs2, sensors, hidden, out);
    for (let i = 0; i < 50; i++) {
      forwardBrain(bs2, sensors, hidden, out);
      backpropBrain(bs2, -1, 0, hidden, out, sensors); // target = -1
    }
    assert.ok(bs2.cb < 0, `lowered toward -1 (${bs2.cb})`);
  });

  it('positive TD drives motor outputs up (reinforcement direction)', () => {
    const bs = cleanBrain({ enabled: true, learn: 'backprop', gamma: 0.9, lr: 0.05 });
    const sensors = new Float32Array(MLP_INPUTS).fill(0.5);
    const hidden = new Float32Array(MLP_HIDDEN);
    const out = new Float32Array(MLP_OUTPUTS);
    forwardBrain(bs, sensors, hidden, out);
    const start = out[0];
    for (let i = 0; i < 500; i++) {
      forwardBrain(bs, sensors, hidden, out);
      backpropBrain(bs, 1, 2, hidden, out, sensors);
    }
    forwardBrain(bs, sensors, hidden, out);
    assert.ok(out[0]! > start!, `motor output reinforced (${start} -> ${out[0]})`);
  });

  it('negative TD suppresses motor outputs down', () => {
    const bs = cleanBrain({ enabled: true, learn: 'backprop', gamma: 0.9, lr: 0.05 });
    const sensors = new Float32Array(MLP_INPUTS).fill(0.5);
    const hidden = new Float32Array(MLP_HIDDEN);
    const out = new Float32Array(MLP_OUTPUTS);
    forwardBrain(bs, sensors, hidden, out);
    const start = out[0];
    for (let i = 0; i < 500; i++) {
      forwardBrain(bs, sensors, hidden, out);
      backpropBrain(bs, -1, -2, hidden, out, sensors); // r + γv = -1 - 1.8 < 0
    }
    forwardBrain(bs, sensors, hidden, out);
    assert.ok(out[0]! < start!, `motor output suppressed (${start} -> ${out[0]})`);
  });

  it('weights stay clamped to [-2,2] after heavy training', () => {
    const bs = cleanBrain({ enabled: true, learn: 'backprop', gamma: 0.9, lr: 0.05 });
    const sensors = new Float32Array(MLP_INPUTS).fill(0.7);
    const hidden = new Float32Array(MLP_HIDDEN);
    const out = new Float32Array(MLP_OUTPUTS);
    for (let i = 0; i < 2000; i++) {
      forwardBrain(bs, sensors, hidden, out);
      backpropBrain(bs, 1, 2, hidden, out, sensors);
    }
    assert.ok(bs.w.every((v) => v >= -2 && v <= 2), 'all weights clamped');
    assert.ok(bs.cv.every((v) => v >= -4 && v <= 4), 'critic weights clamped to value-head range');
    assert.ok(Number.isFinite(bs.cb));
  });

  it('backprop-learned weights are heritable via spawnBrain', () => {
    const cfg: BrainConfig = { enabled: true, learn: 'backprop' };
    const parent = createBrain(randomGenome(new SplitMix64(9)), cfg);
    const sensors = new Float32Array(MLP_INPUTS).fill(0.5);
    const hidden = new Float32Array(MLP_HIDDEN);
    const out = new Float32Array(MLP_OUTPUTS);
    for (let i = 0; i < 300; i++) {
      forwardBrain(parent, sensors, hidden, out);
      backpropBrain(parent, 1, 2, hidden, out, sensors);
    }
    const childGenome = randomGenome(new SplitMix64(11));
    const pristine = createBrain(childGenome, cfg);
    const child = spawnBrain(parent, childGenome, cfg);
    // the child's learnable weights sit between the pristine template and the
    // parent's learned weights (Lamarckian-Baldwinian heredity, unchanged rule)
    const dParentChild = Math.abs(parent.w[0]! - child.w[0]!);
    const dParentPristine = Math.abs(parent.w[0]! - pristine.w[0]!);
    assert.ok(dParentChild < dParentPristine, 'child starts closer to the trained parent than to the template');
  });
});