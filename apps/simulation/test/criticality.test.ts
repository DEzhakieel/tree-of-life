import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  corr,
  derivativeCentral,
  findPeaks,
  attractorModes,
  hysteresisLoop,
  fitLogLog,
  halfMaxWidth,
  feedbackReport,
} from '../src/research/complexity.js';

/**
 * Criticality gate.
 *
 * Criticality studies ask where a system sits relative to a phase boundary:
 * power-law scaling (self-organised criticality), the width of the most
 * sensitive band (susceptibility), the number of attractors, and path
 * dependence (hysteresis). Each is a pure numeric estimator, so its
 * limits — degenerate inputs, exactness on synthetic law, monotonicity — can
 * be pinned without a world.
 */

describe('criticality · log–log fit recovers an exact power law', () => {
  it('recovers the exponent and a perfect r² on y = x²', () => {
    const xs = [1, 2, 4, 8, 16, 32];
    const ys = xs.map((x) => x * x);
    const fit = fitLogLog(xs, ys);
    assert.ok(Math.abs(fit.slope - 2) < 1e-9, `slope ${fit.slope}`);
    assert.ok(fit.r2 > 0.9999, `r2 ${fit.r2}`);
    assert.equal(fit.n, 6);
  });

  it('recovers a negative exponent on y = 1/x', () => {
    const xs = [1, 2, 4, 8, 16, 32];
    const ys = xs.map((x) => 1 / x);
    const fit = fitLogLog(xs, ys);
    assert.ok(Math.abs(fit.slope + 1) < 1e-9, `slope ${fit.slope}`);
  });

  it('ignores non-positive points and reports n < 3 as flat', () => {
    const fit = fitLogLog([1, -1, 0, 2], [1, 1, 1, 2]);
    assert.equal(fit.n, 2);
    assert.equal(fit.slope, 0);
    assert.equal(fit.r2, 0);
  });

  it('keeps r² within [0,1]', () => {
    const fit = fitLogLog([1, 2, 3, 4], [5, 2, 9, 3]);
    assert.ok(fit.r2 >= 0 && fit.r2 <= 1, `r2 ${fit.r2}`);
  });
});

describe('criticality · half-max width finds the sensitive band', () => {
  it('measures a symmetric peak over the log axis', () => {
    const d = [0, 1, 2, 1, 0];
    const lp = [0, 1, 2, 3, 4];
    const { width, center } = halfMaxWidth(d, lp);
    assert.equal(center, 2);
    assert.equal(width, 2);
  });

  it('is degenerate for short or flat inputs', () => {
    assert.deepEqual(halfMaxWidth([1, 2], [0, 1]), { width: 0, center: NaN });
    assert.deepEqual(halfMaxWidth([0, 0, 0], [5, 6, 7]), { width: 0, center: 5 });
  });
});

describe('criticality · peak finding is prominence-aware', () => {
  it('finds strict local maxima', () => {
    assert.deepEqual(findPeaks([1, 3, 1]), [1]);
    assert.deepEqual(findPeaks([0, 2, 0, 3, 0]), [1, 3]);
  });

  it('rejects weak and flat plateaus', () => {
    assert.deepEqual(findPeaks([1, 2, 1], 5), []);
    assert.deepEqual(findPeaks([2, 2, 2]), []);
  });
});

describe('criticality · attractor counting detects multimodality', () => {
  it('reports no attractor for an empty sample', () => {
    assert.deepEqual(attractorModes([]), { modes: 0, peaks: [] });
  });

  it('counts one mode for a tight unimodal sample', () => {
    const xs = Array.from({ length: 60 }, (_, i) => 0.5 + ((i % 3) - 1) * 0.01);
    assert.equal(attractorModes(xs).modes, 1);
  });

  it('counts two modes for a well-separated bimodal sample', () => {
    const a = Array.from({ length: 40 }, (_, i) => 0.2 + ((i % 3) - 1) * 0.01);
    const b = Array.from({ length: 40 }, (_, i) => 0.8 + ((i % 3) - 1) * 0.01);
    assert.equal(attractorModes([...a, ...b]).modes, 2);
  });

  it('discards samples outside the unit interval', () => {
    assert.equal(attractorModes([-1, 2, 5, NaN]).modes, 0);
  });
});

describe('criticality · hysteresis measures path dependence', () => {
  it('is zero when the up and down sweeps coincide', () => {
    const h = hysteresisLoop([0, 1, 2], [1, 2, 3], [1, 2, 3]);
    assert.equal(h.loopArea, 0);
    assert.equal(h.maxDelta, 0);
    assert.equal(h.pathIndex, 0);
  });

  it('integrates the gap between sweeps into a non-zero area', () => {
    const h = hysteresisLoop([0, 1, 2], [1, 1, 1], [0, 0, 0]);
    assert.ok(Math.abs(h.loopArea - 2) < 1e-12, `area ${h.loopArea}`);
    assert.equal(h.maxDelta, 1);
    assert.equal(h.pathIndex, 1);
  });
});

describe('criticality · correlation and birth feedback behave at the limits', () => {
  it('corr is ±1 on exact linear relations and 0 for constants/short inputs', () => {
    assert.ok(Math.abs(corr([1, 2, 3, 4], [2, 4, 6, 8]) - 1) < 1e-12);
    assert.ok(Math.abs(corr([1, 2, 3, 4], [8, 6, 4, 2]) + 1) < 1e-12);
    assert.equal(corr([1, 1, 1, 1], [1, 2, 3, 4]), 0);
    assert.equal(corr([1, 2], [1, 2]), 0);
  });

  it('feedbackReport tracks a one-tick birth response to population', () => {
    const alive = [1, 2, 3, 4, 5, 6];
    const births = [0, 1, 2, 3, 4, 5];
    const r = feedbackReport(alive, births);
    assert.ok(Math.abs(r.rhoBirthAliveLag1 - 1) < 1e-12, `rho ${r.rhoBirthAliveLag1}`);
    assert.ok(r.overdispersion > 0);
    assert.equal(feedbackReport([1, 1, 1], [0, 0, 0]).overdispersion, 0);
  });
});

describe('criticality · central derivative is exact on polynomials', () => {
  it('differentiates a line and a parabola', () => {
    const xs = [0, 1, 2, 3, 4];
    const line = xs.map((x) => 3 * x + 1);
    for (const d of derivativeCentral(line, xs)) assert.ok(Math.abs(d - 3) < 1e-12);
    const par = xs.map((x) => x * x);
    const dp = derivativeCentral(par, xs);
    assert.ok(Math.abs(dp[1] - 2) < 1e-12 && Math.abs(dp[2] - 4) < 1e-12 && Math.abs(dp[3] - 6) < 1e-12);
  });
});
