import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { WorldConfig } from '@fractal-life/shared';
import { DEFAULT_PARAMS } from '@fractal-life/shared';
import { Engine } from '../src/engine.js';
import { SplitMix64 } from '../src/rng.js';
import { randomGenome } from '../src/genome.js';
import { createBrain, spawnBrain, stepPomdp, type BrainState, type POMDPConfig } from '../src/brain.js';

const DEFAULT_HIDDEN = [4, 6, 7, 10, 13];

function makeWorld(spawnCount = 8, seed = 'pomdp-test'): WorldConfig {
  return {
    id: `test-${seed}`,
    seed,
    fractalType: 'mandelbrot',
    params: { ...DEFAULT_PARAMS, spawnCount },
    createdAt: 0,
    currentTick: 0,
  };
}

function frames(engine: Engine, ticks: number, brain: boolean, pomdp?: POMDPConfig) {
  engine.setBrainConfig({ enabled: brain, pomdp });
  const out: Array<Record<string, unknown>> = [];
  for (let t = 0; t < ticks; t++) {
    engine.tick();
    out.push({ ...(engine as unknown as { __tr: Record<string, unknown> }).__tr });
  }
  return out;
}

describe('POMDP perception', () => {
  it('is disabled by default: no belief/obsRaw/obsNoise telemetry', () => {
    const f = frames(new Engine(makeWorld()), 30, true);
    for (let t = 0; t < 30; t++) {
      assert.equal('belief' in f[t]!, false);
      assert.equal('obsRaw' in f[t]!, false);
      assert.equal('obsNoise' in f[t]!, false);
    }
  });

  it('perturbs the hidden channels with observation noise and leaves the rest raw', () => {
    const pomdp: POMDPConfig = { enabled: true, noise: 0.4, gain: 0.3, weight: 0.5 };
    const eng = new Engine(makeWorld());
    eng.setBrainConfig({ enabled: true, pomdp });
    let perturbed = false;
    let noiseSeen = false;
    for (let t = 0; t < 60; t++) {
      eng.tick();
      const tr = (eng as unknown as { __tr: Record<string, unknown> }).__tr;
      if (!tr.sensors) continue; // escape/death tick: incomplete trace
      const s = tr.sensors as number[];
      const raw = tr.obsRaw as number[];
      const noise = tr.obsNoise as number[];
      for (const k of DEFAULT_HIDDEN) {
        if (Math.abs(s[k]! - raw[k]!) > 1e-9) perturbed = true;
      }
      // visible channels pass through untouched
      for (const k of [0, 1, 2, 3, 5, 8, 9, 11, 12, 14]) {
        assert.equal(s[k], raw[k], `visible channel ${k} tick ${t + 1}`);
      }
      if (noise?.some((v) => v !== 0)) noiseSeen = true;
    }
    assert.ok(perturbed, 'hidden channels should be perturbed by observation noise');
    assert.ok(noiseSeen, 'obsNoise telemetry should report non-zero perturbations');
  });

  it('runs deterministically for identical seeds and pomdp config', () => {
    const cfg: POMDPConfig = { enabled: true, noise: 0.15, gain: 0.3, weight: 0.5 };
    const a = frames(new Engine(makeWorld()), 30, true, cfg);
    const b = frames(new Engine(makeWorld()), 30, true, cfg);
    for (let t = 0; t < 30; t++) {
      assert.deepEqual(a[t]!.sensors, b[t]!.sensors, `tick ${t + 1} sensors`);
      assert.deepEqual(a[t]!.belief, b[t]!.belief, `tick ${t + 1} belief`);
      assert.deepEqual(a[t]!.obsNoise, b[t]!.obsNoise, `tick ${t + 1} obsNoise`);
    }
  });

  it('keeps belief in [0,1] and updates it away from the uncertain prior', () => {
    const pomdp: POMDPConfig = { enabled: true, noise: 0.2, gain: 0.4, weight: 0.5 };
    const eng = new Engine(makeWorld(8));
    eng.setBrainConfig({ enabled: true, pomdp });
    let present = 0;
    let updated = false;
    for (let t = 0; t < 200; t++) {
      eng.tick();
      const tr = (eng as unknown as { __tr: Record<string, unknown> }).__tr;
      const belief = tr.belief as number[] | undefined;
      if (!belief) continue; // escape/death tick: incomplete trace
      present++;
      assert.ok(belief.length === DEFAULT_HIDDEN.length, `belief sized to hidden channels (tick ${t + 1})`);
      assert.ok(belief.every((v) => v >= 0 && v <= 1), 'belief stays in [0,1]');
      if (belief.some((v) => Math.abs(v - 0.5) > 1e-6)) updated = true;
    }
    assert.ok(present > 150, `belief present in most ticks (${present}/200)`);
    assert.ok(updated, 'belief should depart from the 0.5 uncertain prior');
  });

  it('belief-guidance: with weight=1, zero noise, the policy input IS the belief', () => {
    const pomdp: POMDPConfig = { enabled: true, noise: 0, gain: 0.3, weight: 1 };
    const eng = new Engine(makeWorld(4));
    eng.setBrainConfig({ enabled: true, pomdp });
    let exact = false;
    for (let t = 0; t < 60; t++) {
      eng.tick();
      const tr = (eng as unknown as { __tr: Record<string, unknown> }).__tr;
      const s = tr.sensors as number[] | undefined;
      const b = tr.belief as number[] | undefined;
      if (!s || !b) continue;
      for (const k of DEFAULT_HIDDEN) {
        if (s[k] === b[DEFAULT_HIDDEN.indexOf(k)]) exact = true;
      }
    }
    assert.ok(exact, 'weight=1 should feed the belief channel, not the raw value');
  });

  it('mixes differently for weight=0 (observations only) vs weight=1 (belief only)', () => {
    const obsOnly: POMDPConfig = { enabled: true, noise: 0, gain: 0.3, weight: 0 };
    const belOnly: POMDPConfig = { enabled: true, noise: 0, gain: 0.3, weight: 1 };
    const a = new Engine(makeWorld(4));
    const b = new Engine(makeWorld(4));
    a.setBrainConfig({ enabled: true, pomdp: obsOnly });
    b.setBrainConfig({ enabled: true, pomdp: belOnly });
    let diverge = false;
    for (let t = 0; t < 40; t++) {
      a.tick();
      b.tick();
      const ta = (a as unknown as { __tr: Record<string, unknown> }).__tr;
      const tb = (b as unknown as { __tr: Record<string, unknown> }).__tr;
      if (!ta.sensors || !tb.sensors) continue;
      const sa = ta.sensors as number[];
      const sb = tb.sensors as number[];
      for (const k of DEFAULT_HIDDEN) {
        if (Math.abs(sa[k]! - sb[k]!) > 1e-9) { diverge = true; break; }
      }
    }
    assert.ok(diverge, 'belief weight should change the policy input');
  });

  it('offspring inherit the parent belief priors (spawnBrain)', () => {
    const cfg = { enabled: true, pomdp: { enabled: true, gain: 0.2 } as POMDPConfig };
    const parent = createBrain(randomGenome(new SplitMix64(42)), cfg);
    assert.equal(parent.belief.length, DEFAULT_HIDDEN.length);
    const priors = [0.9, 0.1, 0.9, 0.1, 0.9];
    parent.belief.set(priors);
    const child = spawnBrain(parent, randomGenome(new SplitMix64(7)), cfg);
    assert.equal(child.belief.length, parent.belief.length);
    const got = Array.from(child.belief);
    for (let i = 0; i < priors.length; i++) {
      assert.ok(Math.abs(got[i]! - priors[i]!) < 1e-6, `belief[${i}] inherited (${got[i]} vs ${priors[i]})`);
    }
  });

  it('is inert when the brain itself is disabled', () => {
    const pomdp: POMDPConfig = { enabled: true, noise: 0.5, gain: 1, weight: 1 };
    const a = frames(new Engine(makeWorld()), 20, false);
    const b = frames(new Engine(makeWorld()), 20, false, pomdp);
    for (let t = 0; t < 20; t++) {
      assert.deepEqual(a[t]!.sensors, b[t]!.sensors, `tick ${t + 1}`);
      assert.equal('belief' in b[t]!, false);
      assert.equal('obsNoise' in b[t]!, false);
    }
  });

  it('stepPomdp clamps observations to [0,1] and writes noise telemetry', () => {
    const b: BrainState = createBrain(randomGenome(new SplitMix64(1)), { enabled: true });
    b.belief.set([0.5, 0.5, 0.5, 0.5, 0.5]);
    const sensors = new Float32Array(15).fill(1); // saturating reads exercise clamping
    sensors[0] = 0;
    const noiseOut = new Float32Array(15);
    stepPomdp(b, sensors, { enabled: true, noise: 0.9, gain: 0.5, weight: 0.5 }, 3, 2, noiseOut);
    for (const k of DEFAULT_HIDDEN) {
      assert.ok(sensors[k]! >= 0 && sensors[k]! <= 1, `channel ${k} clamped`);
    }
    assert.equal(sensors[0], 0, 'unchanged channel untouched');
    assert.ok(noiseOut.slice(0, 5).some((v) => v !== 0), 'noise telemetry non-zero');
    assert.ok(b.belief.every((v) => v >= 0 && v <= 1), 'belief stays clamped');
  });
});