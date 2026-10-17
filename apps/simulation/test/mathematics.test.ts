import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../src/research/stats.js';
import * as T from '../src/research/statistics.js';
import * as C from '../src/research/complexity.js';
import { sbpBF } from '../src/research/bayes.js';

/**
 * Mathematical consistency gate.
 *
 * The research program derives every reported number from a small, dependency
 * free measurement layer. This file pins the *identities* those layers must
 * satisfy — not just "returns a number", but "returns the mathematically
 * correct number" — so a regression in the statistic math cannot silently move
 * a published effect size or p-value.
 *
 *   stats.ts        point estimates + seeded resampling (bootstrap/permutation)
 *   statistics.ts   descriptive stats + classical tests (t, F, binomial)
 *   bayes.ts        p -> minimal Bayes factor (Sellke–Berger–Pericchi)
 *   complexity.ts   measurement math for the complexity lab
 */

const near = (a: number, b: number, eps = 1e-9): boolean => Math.abs(a - b) <= eps;

describe('mathematics · descriptive statistics are exact', () => {
  it('mean and sample standard deviation (n−1) match hand computation', () => {
    assert.equal(S.mean([2, 4, 6]), 4);
    // variance of [2,4,6] with n-1 = (4+0+4)/2 = 4 -> sd = 2
    assert.ok(near(S.stdev([2, 4, 6]), 2));
    assert.ok(near(T.sd([2, 4, 6]), 2));
    assert.equal(T.mean([2, 4, 6]), 4);
    assert.ok(near(T.se([2, 4, 6]), 2 / Math.sqrt(3)));
  });

  it('median is the midpoint for odd n and the mean of the middle pair for even n', () => {
    assert.equal(S.median([1, 2, 3]), 2);
    assert.equal(S.median([1, 2, 3, 4]), 2.5);
    assert.equal(T.median([5, 1, 3]), 3);
  });

  it('quantile interpolates linearly and is monotone in p', () => {
    const xs = [0, 10, 20, 30, 40];
    assert.equal(S.quantile(xs, 0), 0);
    assert.equal(S.quantile(xs, 1), 40);
    assert.equal(S.quantile(xs, 0.5), 20);
    assert.equal(S.quantile(xs, 0.25), 10);
    let prev = -Infinity;
    for (let p = 0; p <= 1.0001; p += 0.1) {
      const q = S.quantile(xs, p);
      assert.ok(q >= prev, `quantile not monotone at p=${p}`);
      prev = q;
    }
  });

  it('empty/degenerate inputs are handled without throwing or returning garbage', () => {
    assert.ok(Number.isNaN(S.mean([])));
    assert.equal(S.stdev([1]), 0);
    assert.equal(T.sd([1]), 0);
    assert.equal(T.sd([]), 0);
    const emptyMedian = S.median([]);
    assert.ok(Number.isNaN(emptyMedian) || emptyMedian === 0, 'empty median is NaN or 0, not a throw');
  });
});

describe('mathematics · resampling is seeded and hence reproducible', () => {
  it('mulberry32 yields the identical stream for the same seed and stays in [0,1)', () => {
    const a = S.mulberry32(12345);
    const b = S.mulberry32(12345);
    for (let i = 0; i < 500; i++) {
      const x = a();
      assert.equal(x, b(), 'same seed must replay');
      assert.ok(x >= 0 && x < 1, `draw ${x} out of [0,1)`);
    }
    const c = S.mulberry32(999);
    assert.notEqual(S.mulberry32(12345)(), c(), 'different seeds diverge');
  });

  it('bootstrapCI is deterministic and brackets the sample mean', () => {
    const xs = [3, 4, 5, 6, 7, 8, 9, 10];
    const c1 = S.bootstrapCI(xs, { r: 42 });
    const c2 = S.bootstrapCI(xs, { r: 42 });
    assert.equal(c1.lo, c2.lo);
    assert.equal(c1.hi, c2.hi);
    assert.ok(c1.lo <= S.mean(xs) + 1e-9 && c1.hi >= S.mean(xs) - 1e-9, 'CI brackets the mean');
    assert.ok(c1.lo <= c1.hi);
  });

  it('percentile bootstrapCI is deterministic given a seedKey', () => {
    const xs = [1, 2, 3, 4, 5, 6, 7, 8, 9];
    const a = T.bootstrapCI(xs, T.mean, { B: 400, seedKey: 'unit' });
    const b = T.bootstrapCI(xs, T.mean, { B: 400, seedKey: 'unit' });
    assert.deepEqual(a, b);
    assert.ok(a[0] <= a[1]);
  });
});

describe('mathematics · hypothesis tests return correct p-values at the identities', () => {
  it('Clopper–Pearson is exact at the boundaries', () => {
    const [lo0, hi0] = T.clopperPearson(0, 10);
    assert.equal(lo0, 0);
    assert.ok(hi0 > 0 && hi0 < 1);
    const [lo1, hi1] = T.clopperPearson(10, 10);
    assert.ok(lo1 > 0 && lo1 < 1);
    assert.equal(hi1, 1);
    // symmetric coverage for k = n/2
    const [lo5, hi5] = T.clopperPearson(5, 10);
    assert.ok(near(1 - hi5, lo5, 1e-9));
  });

  it('t-CDF via the incomplete beta is exact at t = 0 and in the tail', () => {
    assert.equal(T.pFromT(0, 10), 1);
    assert.ok(near(T.betai(1, 1, 0.3), 0.3), 'I_x(1,1) = x');
    assert.equal(T.betai(2, 3, 0), 0);
    assert.equal(T.betai(2, 3, 1), 1);
    assert.ok(T.pFromT(10, 10) < 1e-5, 'large t -> tiny p');
    assert.ok(T.pFromT(10, 10) < T.pFromT(2, 10), 'p decreases with |t|');
  });

  it('lgamma matches Γ at integer and half-integer arguments', () => {
    assert.ok(near(T.lgamma(1), 0, 1e-9));
    assert.ok(near(T.lgamma(2), 0, 1e-9));
    assert.ok(near(T.lgamma(3), Math.log(2), 1e-9));
    assert.ok(near(T.lgamma(0.5), Math.log(Math.sqrt(Math.PI)), 1e-9));
  });

  it('welch and pairedT give t = 0, p = 1 for identical samples', () => {
    const xs = [1, 2, 3, 4, 5];
    const w = T.welch(xs, xs.slice());
    assert.ok(near(w.t, 0));
    assert.equal(w.p, 1);
    const p = T.pairedT(xs, xs.slice());
    assert.ok(near(p.t, 0));
    assert.equal(p.p, 1);
  });

  it('welch is sign-consistent with the mean difference', () => {
    const w = T.welch([10, 11, 12, 13, 14], [1, 2, 3, 4, 5]);
    assert.ok(w.meanDiff > 0);
    assert.ok(w.t > 0);
    assert.ok(w.p < 0.01);
    assert.ok(w.cohensD > 0);
  });

  it('ANOVA is exact for identical groups (F = 0, p = 1)', () => {
    const a = T.anova([
      [1, 2, 3, 4],
      [1, 2, 3, 4],
      [1, 2, 3, 4],
    ]);
    assert.ok(near(a.f, 0));
    assert.equal(a.p, 1);
    assert.ok(near(a.ssWithin, 15), `ssWithin ${a.ssWithin}`);
    assert.equal(a.df1, 2);
    assert.equal(a.df2, 9);
  });

  it('pairedT rejects a length mismatch rather than silently truncating', () => {
    assert.throws(() => T.pairedT([1, 2, 3], [1, 2]));
  });

  it('two-proportion z-test is zero (p = 1) for equal proportions', () => {
    const z = T.twoProportionZ(30, 100, 30, 100);
    assert.ok(near(z.z, 0));
    assert.ok(near(z.p, 1, 1e-6));
    const zz = T.twoProportionZ(60, 100, 30, 100);
    assert.ok(zz.z > 0 && zz.p < 0.001);
  });
});

describe('mathematics · minimal Bayes factor (Sellke–Berger–Pericchi)', () => {
  it('is exactly 1 for p >= 1/e and > 1 below it, monotone decreasing in p', () => {
    assert.equal(sbpBF(1), 1);
    assert.equal(sbpBF(0.5), 1);
    assert.equal(sbpBF(1 / Math.E), 1);
    assert.ok(sbpBF(0.05) > 1);
    assert.ok(sbpBF(0.01) > sbpBF(0.05));
    assert.ok(sbpBF(0.001) > sbpBF(0.01));
  });

  it('is capped at 1e6 and never negative/infinite', () => {
    assert.equal(sbpBF(1e-16), 1e6);
    for (const p of [0, 0.3, 0.05, 1e-8]) {
      const bf = sbpBF(p);
      assert.ok(Number.isFinite(bf) && bf >= 1 && bf <= 1e6);
    }
  });
});

describe('mathematics · complexity-lab measurement math', () => {
  it('entropyOf: uniform-k is log2(k), a point mass is 0', () => {
    assert.ok(near(C.entropyOf([1, 1, 1, 1]), 2));
    assert.ok(near(C.entropyOf([8]), 0));
    assert.equal(C.entropyOf([]), 0);
    assert.equal(C.entropyOf([0, 0, 0]), 0);
  });

  it('corr is +1 / −1 for perfect linear relations and 0 for a constant', () => {
    const x = [1, 2, 3, 4, 5];
    assert.ok(near(C.corr(x, [2, 4, 6, 8, 10]), 1));
    assert.ok(near(C.corr(x, [10, 8, 6, 4, 2]), -1));
    assert.equal(C.corr(x, [7, 7, 7, 7, 7]), 0);
    assert.equal(C.corr([1, 2], [1, 2]), 0, 'fewer than 3 finite pairs -> 0');
  });

  it('derivativeCentral reproduces the analytic slope of a polynomial', () => {
    // f(x) = x² sampled on a unit grid -> central differences
    const d = C.derivativeCentral([0, 1, 4, 9], [0, 1, 2, 3]);
    assert.deepEqual(d, [1, 2, 4, 5]);
  });

  it('crossPartial recovers the mixed partial of a separable product surface', () => {
    const lcaps = [0, 1, 2];
    const lgs = [0, 1, 2];
    const vals = lcaps.map((c) => lgs.map((g) => c * g));
    const { maxCross, where } = C.crossPartial(vals, lcaps, lgs);
    assert.ok(near(maxCross, 1), `expected 1, got ${maxCross}`);
    assert.equal(where.i, 1);
    assert.equal(where.j, 1);
  });

  it('findPeaks finds interior maxima and respects the prominence filter', () => {
    assert.deepEqual(C.findPeaks([0, 1, 2, 1, 0]), [2]);
    assert.deepEqual(C.findPeaks([0, 1, 0, 1, 0], 0.5), [1, 3]);
    assert.deepEqual(C.findPeaks([1, 1, 1, 1]), [], 'a plateau is not a peak');
  });

  it('attractorModes counts one mode for a unimodal cloud and two for a bimodal one', () => {
    const uni: number[] = [];
    for (let i = 0; i < 80; i++) uni.push(0.3 + 0.01 * Math.sin(i));
    assert.equal(C.attractorModes(uni).modes, 1);
    const bi: number[] = [];
    for (let i = 0; i < 60; i++) bi.push(0.2 + 0.01 * Math.sin(i));
    for (let i = 0; i < 60; i++) bi.push(0.8 + 0.01 * Math.cos(i));
    assert.equal(C.attractorModes(bi).modes, 2);
  });

  it('halfMaxWidth measures the width of a derivative plateau', () => {
    const { width, center } = C.halfMaxWidth([0, 1, 1, 1, 0], [0, 1, 2, 3, 4]);
    assert.ok(near(width, 2), `width ${width}`);
    assert.ok(near(center, 1), `center ${center}`);
  });

  it('hysteresisLoop is zero when the up and down sweeps coincide', () => {
    const flat = C.hysteresisLoop([0, 1, 2], [0.5, 0.5, 0.5], [0.5, 0.5, 0.5]);
    assert.ok(near(flat.loopArea, 0));
    assert.equal(flat.pathIndex, 0);
    assert.ok(near(flat.maxDelta, 0));
  });

  it('hysteresisLoop is positive and path-dependent when the branches separate', () => {
    const loop = C.hysteresisLoop([0, 1, 2], [0.2, 0.2, 0.2], [0.8, 0.8, 0.8]);
    assert.ok(loop.loopArea > 0, `loopArea ${loop.loopArea}`);
    assert.equal(loop.pathIndex, 1);
    assert.ok(near(loop.maxDelta, 0.6));
  });
});
