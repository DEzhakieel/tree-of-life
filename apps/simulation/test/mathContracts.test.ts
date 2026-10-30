/**
 * Mathematical contract tests.
 *
 * Everything here is deterministic: fixed seeds, fixed sample counts, and
 * tolerances set at ~5σ of the sampling error so a pass is a statement about the
 * implementation, not about luck. The point is that the primitives the engine
 * claims to rest on — a uniform stream, normal draws, and a state that stays in
 * the domain of its own equations — are measured rather than assumed.
 *
 * See `docs/MATHEMATICS.md` for the contract these tests enforce.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DEFAULT_PARAMS, GENOME_SIZE, type WorldConfig, type WorldParams } from '@fractal-life/shared';
import { SplitMix64, streamSeed, memeSeed, omicsSeed, envSeed, initSeed } from '../src/rng.js';
import {
  gaussianRng,
  exponentialRng,
  poissonRng,
  poissonPmf,
  gammaRng,
  betaRng,
  vonMisesRng,
  multivariateGaussianRng,
  logisticRng,
  bernoulliRng,
  logGamma,
} from '../src/distributions.js';
import { Engine } from '../src/engine.js';
import { auditWorld, describeViolations, type AuditableAgent } from '../src/mathAudit.js';

/* ------------------------------------------------------------------ stats -- */

function mean(xs: number[]): number {
  let s = 0;
  for (const v of xs) s += v;
  return s / xs.length;
}

function variance(xs: number[]): number {
  const m = mean(xs);
  let s = 0;
  for (const v of xs) s += (v - m) * (v - m);
  return s / xs.length;
}

/** Kolmogorov–Smirnov distance between the sample and a CDF. */
function ksDistance(xs: number[], cdf: (x: number) => number): number {
  const sorted = [...xs].sort((a, b) => a - b);
  const n = sorted.length;
  let d = 0;
  for (let i = 0; i < n; i++) {
    const f = cdf(sorted[i]!);
    d = Math.max(d, Math.abs(f - i / n), Math.abs((i + 1) / n - f));
  }
  return d;
}

/** Standard normal CDF (Abramowitz–Stegun 7.1.26, |error| < 1.5e-7). */
function normalCdf(x: number): number {
  const z = x / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * Math.abs(z));
  const erf =
    1 -
    (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-z * z);
  return 0.5 * (1 + (z >= 0 ? erf : -erf));
}

/** Chi-square statistic of observed counts against expected counts. */
function chiSquare(observed: number[], expected: number[]): number {
  let s = 0;
  for (let i = 0; i < observed.length; i++) {
    const e = expected[i]!;
    s += (observed[i]! - e) * (observed[i]! - e) / e;
  }
  return s;
}

/* -------------------------------------------------------------- the stream -- */

test('SplitMix64: uniform floats have the right moments and no serial correlation', () => {
  const rng = new SplitMix64(0x5eed);
  const n = 200000;
  const xs = new Array<number>(n);
  for (let i = 0; i < n; i++) xs[i] = rng.nextFloat();
  const m = mean(xs);
  const v = variance(xs);
  // sd of the mean is sqrt(1/12n) = 6.5e-4; allow ~5σ
  assert.ok(Math.abs(m - 0.5) < 3e-3, `mean ${m}`);
  assert.ok(Math.abs(v - 1 / 12) < 1e-3, `variance ${v}`);

  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    const d = xs[i]! - m;
    den += d * d;
    if (i > 0) num += d * (xs[i - 1]! - m);
  }
  const rho = num / den;
  assert.ok(Math.abs(rho) < 0.01, `lag-1 autocorrelation ${rho}`);
});

test('SplitMix64: 65,536-bucket occupancy is consistent with uniform', () => {
  const buckets = 1 << 16;
  const counts = new Int32Array(buckets);
  const rng = new SplitMix64(12345);
  const n = 1 << 20;
  for (let i = 0; i < n; i++) counts[rng.next() % buckets]++;
  const expected = new Float64Array(buckets).fill(n / buckets);
  const chi = chiSquare(Array.from(counts), Array.from(expected));
  // df = 65535: mean 65535, sd 362; accept ±5σ
  assert.ok(Math.abs(chi - buckets) < 5 * Math.sqrt(2 * buckets) * 1.2, `chi-square ${chi}`);
});

test('SplitMix64: nextInt is bias-free and its domain is enforced', () => {
  const rng = new SplitMix64(3);
  const counts = new Array<number>(7).fill(0);
  for (let i = 0; i < 700000; i++) counts[rng.nextInt(7)]!++;
  const expected = new Array<number>(7).fill(100000);
  const chi = chiSquare(counts, expected);
  // df = 6; 30 is far in the tail (p < 1e-4) but never flaky for a fixed seed
  assert.ok(chi < 30, `chi-square ${chi}`);

  // degenerate ranges consume no draw
  const a = new SplitMix64(9);
  const b = new SplitMix64(9);
  assert.equal(a.nextInt(1), 0);
  assert.equal(a.nextInt(0), 0);
  assert.equal(a.nextFloat(), b.nextFloat(), 'nextInt(0|1) must not advance the stream');

  // out-of-domain bounds fail loudly instead of hanging
  assert.throws(() => rng.nextInt(2 ** 32 + 1), RangeError);
  assert.throws(() => rng.nextInt(2.5), RangeError);
});

test('SplitMix64: nextGaussian is a standard normal', () => {
  const rng = new SplitMix64(7);
  const n = 50000;
  const xs = new Array<number>(n);
  for (let i = 0; i < n; i++) xs[i] = rng.nextGaussian();
  assert.ok(Math.abs(mean(xs)) < 0.02, `mean ${mean(xs)}`);
  assert.ok(Math.abs(variance(xs) - 1) < 0.02, `variance ${variance(xs)}`);
  const d = ksDistance(xs, normalCdf);
  // n = 5e4: the 5% critical value is 1.358/sqrt(n) = 0.0061
  assert.ok(d < 0.009, `KS distance ${d}`);
});

test('SplitMix64: independent seeds give decorrelated streams', () => {
  const a = new SplitMix64(1);
  const b = new SplitMix64(2);
  const n = 20000;
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i < n; i++) {
    xs.push(a.nextFloat());
    ys.push(b.nextFloat());
  }
  const mx = mean(xs);
  const my = mean(ys);
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i]! - mx;
    const dy = ys[i]! - my;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  const r = sxy / Math.sqrt(sxx * syy);
  assert.ok(Math.abs(r) < 0.03, `cross-stream correlation ${r}`);
});

test('stream seeds: domains are separated and collisions stay rare', () => {
  // The four streams must never coincide for the same (tick, agent).
  for (let t = 0; t < 50; t++) {
    for (let a = 0; a < 20; a++) {
      const s = new Set([streamSeed('w', t, a), memeSeed('w', t, a), omicsSeed('w', t, a)]);
      assert.equal(s.size, 3, `stream domains collided at t=${t} a=${a}`);
    }
  }
  assert.notEqual(envSeed('w', 3), streamSeed('w', 3, 0));
  assert.notEqual(initSeed('w'), streamSeed('w', 0, 0));

  // A 32-bit stream space cannot be collision-free: the measured rate over a
  // realistic run is ~0.02%. Pin the order of magnitude so a change to the
  // hashing scheme is a deliberate act, not an accident.
  const seen = new Set<number>();
  let collisions = 0;
  for (let t = 0; t < 1000; t++) {
    for (let a = 0; a < 500; a++) {
      const v = streamSeed('ews.a', t, a);
      if (seen.has(v)) collisions++;
      else seen.add(v);
    }
  }
  assert.ok(collisions < 250, `stream-seed collisions ${collisions}/500000`);
});

test('the PRNG sources contain no Math.random', () => {
  for (const file of ['rng.ts', 'distributions.ts']) {
    const src = readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8');
    assert.ok(!/Math\.random/.test(src), `${file} must not use Math.random`);
  }
});

/* ------------------------------------------------------------ distributions -- */

test('gaussianRng: standard normal by moments and KS distance', () => {
  const rng = new SplitMix64(42);
  const n = 40000;
  const xs: number[] = [];
  for (let i = 0; i < n; i++) xs.push(gaussianRng(rng));
  assert.ok(Math.abs(mean(xs)) < 0.03, `mean ${mean(xs)}`);
  assert.ok(Math.abs(variance(xs) - 1) < 0.03, `variance ${variance(xs)}`);
  assert.ok(ksDistance(xs, normalCdf) < 0.01, 'KS distance too large');
});

test('gaussianRng: location and scale are honoured', () => {
  const rng = new SplitMix64(43);
  const xs: number[] = [];
  for (let i = 0; i < 20000; i++) xs.push(gaussianRng(rng, 5, 2));
  assert.ok(Math.abs(mean(xs) - 5) < 0.1);
  assert.ok(Math.abs(variance(xs) - 4) < 0.2);
});

test('exponentialRng: matches Exp(rate) by moments and CDF', () => {
  const rate = 2.5;
  const rng = new SplitMix64(99);
  const n = 40000;
  const xs: number[] = [];
  for (let i = 0; i < n; i++) xs.push(exponentialRng(rng, rate));
  assert.ok(Math.abs(mean(xs) - 1 / rate) < 0.01, `mean ${mean(xs)}`);
  assert.ok(Math.abs(variance(xs) - 1 / (rate * rate)) < 0.02, `variance ${variance(xs)}`);
  assert.ok(ksDistance(xs, (x) => 1 - Math.exp(-rate * x)) < 0.01);
});

test('poissonRng: exact pmf fit for the Knuth branch', () => {
  for (const lambda of [0.5, 2, 5, 20]) {
    const rng = new SplitMix64(21);
    const n = 20000;
    const xs: number[] = [];
    for (let i = 0; i < n; i++) xs.push(poissonRng(rng, lambda));
    const sdMean = Math.sqrt(lambda / n);
    assert.ok(Math.abs(mean(xs) - lambda) < 5 * sdMean + 1e-9, `lambda ${lambda}: mean ${mean(xs)}`);
    // sd of the sample variance is ~ lambda * sqrt(2/n)
    assert.ok(
      Math.abs(variance(xs) - lambda) < 5 * lambda * Math.sqrt(2 / n) + 0.02,
      `lambda ${lambda}: variance ${variance(xs)}`,
    );
    for (const v of xs) assert.ok(Number.isInteger(v) && v >= 0);
  }
});

test('poissonRng: large-lambda branch terminates and matches the pmf', () => {
  // The previous implementation looped forever for lambda >= 30. This test both
  // bounds the runtime and checks the distribution against the exact pmf.
  const lambda = 30;
  const n = 20000;
  const rng = new SplitMix64(31);
  const xs: number[] = [];
  for (let i = 0; i < n; i++) xs.push(poissonRng(rng, lambda));
  assert.ok(Math.abs(mean(xs) - lambda) < 5 * Math.sqrt(lambda / n), `mean ${mean(xs)}`);
  assert.ok(Math.abs(variance(xs) - lambda) < 5 * lambda * Math.sqrt(2 / n), `variance ${variance(xs)}`);

  const edges = [0, 20, 25, 30, 35, 40, 45, Number.POSITIVE_INFINITY];
  const observed = new Array<number>(edges.length - 1).fill(0);
  for (const v of xs) {
    for (let b = 0; b < observed.length; b++) {
      if (v >= edges[b]! && v < edges[b + 1]!) {
        observed[b]!++;
        break;
      }
    }
  }
  const expected = new Array<number>(observed.length).fill(0);
  for (let k = 0; k < 200; k++) {
    const p = poissonPmf(k, lambda);
    for (let b = 0; b < expected.length; b++) {
      if (k >= edges[b]! && k < edges[b + 1]!) {
        expected[b]! += p * n;
        break;
      }
    }
  }
  const chi = chiSquare(observed, expected);
  // 6 bins, df = 5; 25 is p ~ 1e-4
  assert.ok(chi < 25, `chi-square ${chi.toFixed(2)} on bins ${observed.join(',')}`);
});

test('poissonRng: lambda 0 and 1000 are boundary cases, not hangs', () => {
  const rng = new SplitMix64(5);
  assert.equal(poissonRng(rng, 0), 0);
  const xs: number[] = [];
  for (let i = 0; i < 4000; i++) xs.push(poissonRng(rng, 1000));
  assert.ok(Math.abs(mean(xs) - 1000) < 5 * Math.sqrt(1000 / 4000), `mean ${mean(xs)}`);
  assert.ok(Math.abs(variance(xs) - 1000) < 5 * 1000 * Math.sqrt(2 / 4000), `variance ${variance(xs)}`);
});

test('poissonPmf is a probability mass function', () => {
  for (const lambda of [0.5, 5, 30]) {
    let s = 0;
    for (let k = 0; k < 300; k++) s += poissonPmf(k, lambda);
    assert.ok(Math.abs(s - 1) < 1e-12, `lambda ${lambda}: sum ${s}`);
  }
  assert.equal(poissonPmf(0, 0), 1);
  assert.equal(poissonPmf(1, 0), 0);
  assert.equal(poissonPmf(1.5, 2), 0);
});

test('gammaRng: mean and variance are shape*scale and shape*scale^2', () => {
  for (const shape of [0.5, 2, 9]) {
    const scale = 3;
    const rng = new SplitMix64(55);
    const n = 20000;
    const xs: number[] = [];
    for (let i = 0; i < n; i++) xs.push(gammaRng(rng, shape, scale));
    const m = shape * scale;
    const v = shape * scale * scale;
    assert.ok(Math.abs(mean(xs) - m) < 5 * Math.sqrt(v / n), `shape ${shape}: mean ${mean(xs)}`);
    assert.ok(Math.abs(variance(xs) - v) < 5 * Math.sqrt(2 / n) * v, `shape ${shape}: variance ${variance(xs)}`);
    for (const x of xs) assert.ok(x > 0 && Number.isFinite(x));
  }
});

test('betaRng: mean and variance match Beta(alpha, beta)', () => {
  const cases: [number, number][] = [
    [2, 5],
    [0.5, 0.5],
    [5, 2],
  ];
  for (const [alpha, beta] of cases) {
    const rng = new SplitMix64(33);
    const n = 20000;
    const xs: number[] = [];
    for (let i = 0; i < n; i++) xs.push(betaRng(rng, alpha, beta));
    const m = alpha / (alpha + beta);
    const v = (alpha * beta) / ((alpha + beta) ** 2 * (alpha + beta + 1));
    assert.ok(Math.abs(mean(xs) - m) < 0.01, `(${alpha},${beta}) mean ${mean(xs)}`);
    assert.ok(Math.abs(variance(xs) - v) < 0.01, `(${alpha},${beta}) variance ${variance(xs)}`);
    for (const x of xs) assert.ok(x >= 0 && x <= 1);
  }
});

test('vonMisesRng: stays in [0, 2pi) for mu = 0 and has the right concentration', () => {
  // The signed acos term used to escape the range for small mu: check the tight
  // case explicitly.
  const rng = new SplitMix64(11);
  const n = 20000;
  const xs: number[] = [];
  for (let i = 0; i < n; i++) {
    const v = vonMisesRng(rng, 0, 2);
    assert.ok(v >= 0 && v < 2 * Math.PI, `von Mises draw ${v} escaped [0, 2pi)`);
    xs.push(v);
  }
  let c = 0;
  let s = 0;
  for (const a of xs) {
    c += Math.cos(a);
    s += Math.sin(a);
  }
  const r = Math.hypot(c, s) / n;
  // I1(2)/I0(2) = 0.69777
  assert.ok(Math.abs(r - 0.6978) < 0.02, `mean resultant length ${r}`);
  // Symmetric about 0, so the arithmetic mean of the angles in [0, 2pi) tends
  // to pi. The old signed-angle bug pushed it well below pi.
  const m = mean(xs);
  assert.ok(Math.abs(m - Math.PI) < 0.05, `arithmetic mean ${m}`);
});

test('vonMisesRng: kappa = 0 is uniform on the circle', () => {
  const rng = new SplitMix64(12);
  const bins = new Array<number>(8).fill(0);
  const n = 40000;
  for (let i = 0; i < n; i++) bins[Math.floor(vonMisesRng(rng, 0, 0) / (Math.PI / 4)) % 8]!++;
  const chi = chiSquare(bins, new Array<number>(8).fill(n / 8));
  assert.ok(chi < 24, `chi-square ${chi}`);
});

test('multivariateGaussianRng: recovers the full covariance matrix', () => {
  const mean3 = new Float64Array([1, -2, 0.5]);
  const cov = new Float64Array([
    1.0, 0.5, -0.3,
    0.5, 2.0, 0.4,
    -0.3, 0.4, 1.5,
  ]);
  const rng = new SplitMix64(5);
  const n = 40000;
  const rows: Float64Array[] = [];
  for (let i = 0; i < n; i++) rows.push(multivariateGaussianRng(rng, mean3, cov, 3));
  for (let i = 0; i < 3; i++) {
    const col = rows.map((r) => r[i]!);
    assert.ok(Math.abs(mean(col) - mean3[i]!) < 0.03, `mean[${i}] ${mean(col)}`);
    assert.ok(Math.abs(variance(col) - cov[i * 3 + i]!) < 0.06, `var[${i}] ${variance(col)}`);
  }
  for (let i = 0; i < 3; i++) {
    for (let j = i + 1; j < 3; j++) {
      let c = 0;
      for (const r of rows) c += (r[i]! - mean3[i]!) * (r[j]! - mean3[j]!);
      c /= n;
      assert.ok(Math.abs(c - cov[i * 3 + j]!) < 0.05, `cov[${i},${j}] ${c}`);
    }
  }
});

test('logisticRng: mean 0 and variance (pi*s)^2/3', () => {
  const rng = new SplitMix64(12);
  const n = 40000;
  const xs: number[] = [];
  for (let i = 0; i < n; i++) xs.push(logisticRng(rng, 0, 1));
  assert.ok(Math.abs(mean(xs)) < 0.05, `mean ${mean(xs)}`);
  assert.ok(Math.abs(variance(xs) - (Math.PI * Math.PI) / 3) < 0.1, `variance ${variance(xs)}`);
});

test('bernoulliRng: frequency matches p and the endpoints are exact', () => {
  const rng = new SplitMix64(44);
  const n = 40000;
  let hits = 0;
  for (let i = 0; i < n; i++) if (bernoulliRng(rng, 0.3)) hits++;
  const p = hits / n;
  assert.ok(Math.abs(p - 0.3) < 0.01, `frequency ${p}`);
  assert.equal(bernoulliRng(rng, 0), false);
  assert.equal(bernoulliRng(rng, 1), true);
});

test('samplers reject out-of-domain parameters instead of returning NaN or looping', () => {
  const rng = new SplitMix64(1);
  assert.throws(() => exponentialRng(rng, 0), RangeError);
  assert.throws(() => exponentialRng(rng, Number.NaN), RangeError);
  assert.throws(() => poissonRng(rng, -1), RangeError);
  assert.throws(() => gammaRng(rng, 0, 1), RangeError);
  assert.throws(() => gammaRng(rng, 1, -1), RangeError);
  assert.throws(() => betaRng(rng, 0, 1), RangeError);
  assert.throws(() => vonMisesRng(rng, 0, -1), RangeError);
  assert.throws(() => bernoulliRng(rng, 1.5), RangeError);
  assert.throws(() => gaussianRng(rng, 0, -1), RangeError);
  assert.throws(() => logisticRng(rng, 0, 0), RangeError);
  assert.throws(() => logGamma(0), RangeError);
  assert.throws(
    () => multivariateGaussianRng(rng, new Float64Array(2), new Float64Array([1, 2, 2, 1]), 2),
    RangeError,
    'a non-PSD covariance must be rejected',
  );
});

test('every sampler replays exactly from the same seed', () => {
  const sequence = (seed: number): number[] => {
    const rng = new SplitMix64(seed);
    return [
      gaussianRng(rng, 1, 2),
      exponentialRng(rng, 3),
      poissonRng(rng, 4),
      poissonRng(rng, 400),
      gammaRng(rng, 0.7, 2),
      betaRng(rng, 2, 3),
      vonMisesRng(rng, 1, 4),
      logisticRng(rng, -1, 0.5),
      bernoulliRng(rng, 0.25) ? 1 : 0,
      ...multivariateGaussianRng(rng, new Float64Array([0, 0]), new Float64Array([1, 0.3, 0.3, 1]), 2),
    ];
  };
  assert.deepEqual(sequence(2024), sequence(2024));
  assert.notDeepEqual(sequence(2024), sequence(2025));
});

/* ------------------------------------------------------------- state audit -- */

function makeWorld(seed: string, spawn: number, params: Partial<WorldParams> = {}, extra: Partial<WorldConfig> = {}): WorldConfig {
  return {
    id: `audit-${seed}`,
    seed,
    fractalType: 'mandelbrot',
    params: { ...DEFAULT_PARAMS, spawnCount: spawn, ...params },
    createdAt: 0,
    currentTick: 0,
    ...extra,
  };
}

test('the auditor fires on planted violations', () => {
  const agent = (over: Partial<AuditableAgent>): AuditableAgent => ({
    id: 1,
    x: 10,
    y: 10,
    vx: 0,
    vy: 0,
    energy: 5,
    water: 5,
    age: 1,
    alive: true,
    genome: new Float32Array(GENOME_SIZE),
    ...over,
  });
  const ctx = { tick: 7, worldSize: 100, maxPopulation: 2, energyCapacity: 10 };

  const clean = auditWorld({ ...ctx, agents: [agent({})] }, GENOME_SIZE);
  assert.deepEqual(clean, [], describeViolations(clean));

  const nan = auditWorld({ ...ctx, agents: [agent({ x: Number.NaN })] }, GENOME_SIZE);
  assert.equal(nan.length, 1);
  assert.equal(nan[0]!.field, 'x');

  const outside = auditWorld({ ...ctx, agents: [agent({ y: 100 })] }, GENOME_SIZE);
  assert.equal(outside.length, 1);
  assert.equal(outside[0]!.field, 'y');

  const overfull = auditWorld({ ...ctx, agents: [agent({ energy: 11 })] }, GENOME_SIZE);
  assert.equal(overfull.length, 1);
  assert.equal(overfull[0]!.field, 'energy');

  const dead = auditWorld({ ...ctx, agents: [agent({ alive: false, energy: -5, x: -1 })] }, GENOME_SIZE);
  assert.equal(dead.length, 1, 'a dead agent may hold negative energy and a stale position, nothing worse');
  assert.equal(dead[0]!.field, 'x');

  const crowded = auditWorld({ ...ctx, agents: [agent({ id: 1 }), agent({ id: 2 }), agent({ id: 3 })] }, GENOME_SIZE);
  assert.ok(crowded.some((v) => v.field === 'population'));

  const badStats = auditWorld({ ...ctx, agents: [agent({})], stats: { a: 1, nested: { b: Number.POSITIVE_INFINITY } } }, GENOME_SIZE);
  assert.equal(badStats.length, 1);
  assert.equal(badStats[0]!.field, 'stats.nested.b');

  const badGenome = auditWorld(
    { ...ctx, agents: [agent({ genome: new Float32Array([Number.NaN]) })] },
    GENOME_SIZE,
  );
  assert.ok(badGenome.some((v) => v.field === 'genome.length'));
  assert.ok(badGenome.some((v) => v.field.startsWith('genome[')));
});

test('a nominal world stays inside its own domain for 120 ticks', () => {
  const engine = new Engine(makeWorld('nominal', 40));
  for (let i = 0; i < 120; i++) {
    const res = engine.tick();
    const violations = engine.audit(res.stats);
    assert.deepEqual(violations, [], `tick ${engine.currentTick}: ${describeViolations(violations)}`);
  }
});

test('extreme configurations stay inside their domain', () => {
  const configs: Array<[string, WorldConfig]> = [
    ['max mutation', makeWorld('mut64', 40, {}, { mutationScale: 64 })],
    ['tight energy', makeWorld('tight', 60, { energyCapacity: 20, spawnCount: 60 })],
    ['slow world', makeWorld('slow', 40, { timeScale: 2 })],
    ['sphere topology', makeWorld('sphere', 40, {}, { topology: 'sphere' })],
  ];
  for (const [label, config] of configs) {
    const engine = new Engine(config);
    for (let i = 0; i < 60; i++) {
      const res = engine.tick();
      const violations = engine.audit(res.stats);
      assert.deepEqual(violations, [], `${label} tick ${engine.currentTick}: ${describeViolations(violations)}`);
    }
  }
});

test('the audit is inert: it does not touch the trajectory', () => {
  const a = new Engine(makeWorld('inert', 40));
  const b = new Engine(makeWorld('inert', 40));
  const snapshot = (e: Engine): number[] =>
    [...e.agents.values()]
      .sort((x, y) => x.id - y.id)
      .flatMap((x) => [x.id, x.x, x.y, x.vx, x.vy, x.energy, x.water, ...x.genome]);
  for (let i = 0; i < 60; i++) {
    const ra = a.tick();
    const rb = b.tick();
    a.audit(ra.stats);
    assert.equal(ra.stats.stateHash, rb.stats.stateHash, `tick ${i}`);

    // Auditing a mutated copy must not disturb the engine either.
    auditWorld(
      {
        tick: a.currentTick,
        worldSize: a.grid.size * a.grid.cell,
        maxPopulation: a.params.maxPopulation,
        energyCapacity: a.params.energyCapacity,
        agents: [...a.agents.values()].map((x) => ({ ...x, x: Number.NaN })),
      },
      GENOME_SIZE,
    );
  }
  assert.deepEqual(snapshot(a), snapshot(b), 'audited and unaudited runs must agree bit for bit');
});
