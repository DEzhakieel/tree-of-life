import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_PARAMS, GENOME_SIZE, type WorldConfig } from '@fractal-life/shared';
import { Engine } from '../src/engine.js';
import { SplitMix64 } from '../src/rng.js';
import { createLyapunovState, updateLyapunov } from '../src/lyapunov.js';
import { createReplicatorState, updateReplicator } from '../src/replicator.js';
import { createVectorField, computeVectorFields } from '../src/vectorfield.js';
import { createGameOfLife, stepGameOfLife } from '../src/gameoflife.js';
import { createTensorState, updateTensors } from '../src/tensors.js';
import {
  gaussianRng, exponentialRng, poissonRng, gammaRng, betaRng,
  vonMisesRng, logisticRng, bernoulliRng,
} from '../src/distributions.js';

function makeWorld(seed: string, spawnCount = 40, overrides: Partial<typeof DEFAULT_PARAMS> = {}): WorldConfig {
  return {
    id: `math-${seed}`,
    seed,
    fractalType: 'mandelbrot',
    params: { ...DEFAULT_PARAMS, spawnCount, ...overrides },
    createdAt: 0,
    currentTick: 0,
  };
}

describe('Distributions', () => {
  it('gaussianRng produces values with ~0 mean and ~1 stddev over many samples', () => {
    const rng = new SplitMix64(42);
    const samples: number[] = [];
    for (let i = 0; i < 10000; i++) samples.push(gaussianRng(rng));
    const mean = samples.reduce((s, v) => s + v, 0) / samples.length;
    const variance = samples.reduce((s, v) => s + (v - mean) ** 2, 0) / samples.length;
    assert.ok(Math.abs(mean) < 0.1, `mean ${mean} should be ~0`);
    assert.ok(Math.abs(variance - 1) < 0.2, `variance ${variance} should be ~1`);
  });

  it('exponentialRng produces non-negative values', () => {
    const rng = new SplitMix64(99);
    for (let i = 0; i < 1000; i++) {
      const v = exponentialRng(rng, 2);
      assert.ok(v >= 0, `exponential ${v} must be >= 0`);
    }
  });

  it('poissonRng produces non-negative integers', () => {
    const rng = new SplitMix64(77);
    for (let i = 0; i < 1000; i++) {
      const v = poissonRng(rng, 5);
      assert.ok(v >= 0 && Number.isInteger(v), `poisson ${v} must be non-negative integer`);
    }
  });

  it('gammaRng produces positive values', () => {
    const rng = new SplitMix64(55);
    for (let i = 0; i < 500; i++) {
      const v = gammaRng(rng, 2, 1);
      assert.ok(v > 0, `gamma ${v} must be > 0`);
    }
  });

  it('betaRng produces values in [0,1]', () => {
    const rng = new SplitMix64(33);
    for (let i = 0; i < 500; i++) {
      const v = betaRng(rng, 2, 5);
      assert.ok(v >= 0 && v <= 1, `beta ${v} must be in [0,1]`);
    }
  });

  it('vonMisesRng produces values in [0, 2π)', () => {
    const rng = new SplitMix64(11);
    for (let i = 0; i < 500; i++) {
      const v = vonMisesRng(rng, Math.PI, 5);
      assert.ok(v >= 0 && v < 2 * Math.PI, `vonMises ${v} must be in [0, 2π)`);
    }
  });

  it('logisticRng produces real values', () => {
    const rng = new SplitMix64(22);
    for (let i = 0; i < 500; i++) {
      const v = logisticRng(rng, 0, 1);
      assert.ok(Number.isFinite(v), `logistic ${v} must be finite`);
    }
  });

  it('bernoulliRng produces booleans with roughly correct probability', () => {
    const rng = new SplitMix64(44);
    let trueCount = 0;
    const n = 1000;
    for (let i = 0; i < n; i++) if (bernoulliRng(rng, 0.3)) trueCount++;
    const freq = trueCount / n;
    assert.ok(Math.abs(freq - 0.3) < 0.1, `bernoulli freq ${freq} should be ~0.3`);
  });
});

describe('Game of Life', () => {
  it('runs and produces valid globals', () => {
    const ca = createGameOfLife(32);
    // seed a glider pattern
    const g = ca.current;
    const s = 32;
    g[1 * s + 2] = 1;
    g[2 * s + 3] = 1;
    g[3 * s + 1] = 1;
    g[3 * s + 2] = 1;
    g[3 * s + 3] = 1;

    for (let i = 0; i < 10; i++) stepGameOfLife(ca);
    assert.equal(ca.generation, 10);
    assert.ok(ca.globals.aliveFraction >= 0 && ca.globals.aliveFraction <= 1);
    assert.ok(ca.globals.complexity >= 0);
  });

  it('all-dead grid stays dead', () => {
    const ca = createGameOfLife(16);
    stepGameOfLife(ca);
    assert.equal(ca.globals.aliveFraction, 0);
    assert.equal(ca.globals.births, 0);
  });

  it('still life (block) persists', () => {
    const ca = createGameOfLife(16);
    const s = 16;
    // 2x2 block at (5,5)
    ca.current[5 * s + 5] = 1;
    ca.current[5 * s + 6] = 1;
    ca.current[6 * s + 5] = 1;
    ca.current[6 * s + 6] = 1;
    const before = ca.globals.aliveFraction;
    stepGameOfLife(ca);
    // block should survive
    assert.equal(ca.current[5 * s + 5], 1);
    assert.equal(ca.current[6 * s + 6], 1);
  });
});

describe('Vector fields', () => {
  it('computes gradient, laplacian, and velocity fields without errors', () => {
    const engine = new Engine(makeWorld('vf', 30));
    engine.tick();
    const vf = engine.vectorField;
    assert.ok(vf.globals.foodGradMagMean >= 0);
    assert.ok(Number.isFinite(vf.globals.foodLapMean));
    assert.ok(Number.isFinite(vf.globals.velocityDivMean));
    assert.ok(Number.isFinite(vf.globals.velocityCurlMagMean));
    assert.ok(vf.globals.foodGradMagMax >= vf.globals.foodGradMagMean);
  });
});

describe('Lyapunov exponent', () => {
  it('returns a finite number after running', () => {
    const ls = createLyapunovState();
    const engine = new Engine(makeWorld('lyap', 40));
    let exp = 0;
    for (let i = 0; i < 200; i++) {
      engine.tick();
      exp = updateLyapunov(ls, engine.agents, 2048, 1);
    }
    assert.ok(Number.isFinite(exp), `Lyapunov exponent ${exp} should be finite`);
  });
});

describe('Replicator dynamics', () => {
  it('computes frequencies and derivatives from population', () => {
    const rs = createReplicatorState();
    const engine = new Engine(makeWorld('rep', 40));
    engine.tick();
    updateReplicator(rs, engine.agents, 1);
    let freqSum = 0;
    for (let i = 0; i < 12; i++) freqSum += rs.frequencies[i];
    assert.ok(Math.abs(freqSum - 1) < 0.01, `frequencies should sum to 1, got ${freqSum}`);
    assert.ok(rs.meanFitness >= 0);
    assert.ok(rs.selectionEntropy >= 0);
  });
});

describe('Trait tensors', () => {
  it('computes covariance, eigenvalues, and observables', () => {
    const ts = createTensorState();
    const engine = new Engine(makeWorld('tensor', 40));
    engine.tick();
    updateTensors(ts, engine.agents);
    assert.ok(ts.agentCount > 0);
    assert.ok(ts.totalVariance >= 0);
    assert.ok(ts.effectiveDimension > 0);
    assert.ok(ts.anisotropy >= 1);
    // eigenvalues should be non-negative
    for (let i = 0; i < 8; i++) {
      assert.ok(ts.eigenvalues[i]! >= -1e-10, `eigenvalue ${i} = ${ts.eigenvalues[i]} should be >= 0`);
    }
  });
});

describe('Engine integration', () => {
  it('SimStats includes all new math fields', () => {
    const engine = new Engine(makeWorld('integ', 30));
    const s = engine.tick().stats;
    assert.equal(typeof s.lyapunovExponent, 'number');
    assert.equal(typeof s.selectionEntropy, 'number');
    assert.equal(typeof s.fixationIndex, 'number');
    assert.equal(typeof s.priceEquationSelection, 'number');
    assert.equal(typeof s.foodGradMagMean, 'number');
    assert.equal(typeof s.foodLapMean, 'number');
    assert.equal(typeof s.velocityDivMean, 'number');
    assert.equal(typeof s.velocityCurlMagMean, 'number');
    assert.equal(typeof s.caAliveFraction, 'number');
    assert.equal(typeof s.caComplexity, 'number');
    assert.equal(typeof s.traitTotalVariance, 'number');
    assert.equal(typeof s.traitEffectiveDim, 'number');
    assert.equal(typeof s.traitAnisotropy, 'number');
    assert.ok(Number.isFinite(s.lyapunovExponent));
    assert.ok(s.traitTotalVariance >= 0);
  });

  it('determinism: identical seeds produce identical math observables', () => {
    const a = new Engine(makeWorld('mdet', 30));
    const b = new Engine(makeWorld('mdet', 30));
    for (let i = 0; i < 30; i++) {
      const sa = a.tick().stats;
      const sb = b.tick().stats;
      assert.equal(sa.lyapunovExponent, sb.lyapunovExponent);
      assert.equal(sa.selectionEntropy, sb.selectionEntropy);
      assert.equal(sa.fixationIndex, sb.fixationIndex);
      assert.equal(sa.traitTotalVariance, sb.traitTotalVariance);
      assert.equal(sa.caAliveFraction, sb.caAliveFraction);
    }
  });
});
