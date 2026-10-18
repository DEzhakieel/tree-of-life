import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  aucByDistance,
  coefficientOfVariation,
  detectCollapse,
  ewsSeries,
  ewsWindow,
  flickering,
  indicatorValue,
  kendallTau,
  lag1Autocorrelation,
  leadTime,
  mean,
  movingAverage,
  recoveryRate,
  rocAuc,
  skewness,
  variance,
  type EwsPoint,
} from '@fractal-life/shared';

function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

describe('criticalTransitions descriptive statistics', () => {
  it('computes mean and variance', () => {
    assert.equal(mean([1, 2, 3, 4]), 2.5);
    assert.equal(variance([2, 2, 2]), 0);
    assert.ok(Math.abs(variance([0, 2]) - 1) < 1e-12);
  });

  it('computes skewness sign', () => {
    assert.ok(skewness([0, 0, 0, 1]) > 0);
    assert.ok(skewness([0, 1, 1, 1]) < 0);
  });

  it('computes CV relative to the mean', () => {
    assert.equal(coefficientOfVariation([5, 5, 5]), 0);
    assert.ok(coefficientOfVariation([1, 3]) > 0);
  });

  it('moving average is causal and reaches the window', () => {
    const ma = movingAverage([0, 10, 20, 30], 2);
    assert.deepEqual(ma, [0, 5, 15, 25]);
  });
});

describe('criticalTransitions temporal indicators', () => {
  it('AR(1) is near 1 for a smooth trend and near 0 for white noise', () => {
    const trend = Array.from({ length: 200 }, (_, i) => i);
    assert.ok(lag1Autocorrelation(trend) > 0.98);
    const rng = lcg(1);
    const noise = Array.from({ length: 2000 }, () => rng() - 0.5);
    assert.ok(Math.abs(lag1Autocorrelation(noise)) < 0.1);
  });

  it('recovery rate is -ln(AR(1))', () => {
    assert.ok(Math.abs(recoveryRate(0.5) - Math.log(2)) < 1e-9);
    assert.ok(recoveryRate(0.5) > recoveryRate(0.9));
  });

  it('flickering counts mean crossings', () => {
    assert.ok(flickering([1, -1, 1, -1, 1]) > 0.9);
    assert.equal(flickering([5, 5, 5, 5]), 0);
  });
});

describe('criticalTransitions rank statistics', () => {
  it('kendallTau is +1 / -1 for monotone series', () => {
    assert.equal(kendallTau([1, 2, 3, 4, 5]), 1);
    assert.equal(kendallTau([5, 4, 3, 2, 1]), -1);
  });

  it('rocAuc is 1 for perfect separation and 0 for inversion', () => {
    const labels = [true, true, false, false];
    assert.equal(rocAuc(labels, [4, 3, 2, 1]), 1);
    assert.equal(rocAuc(labels, [1, 2, 3, 4]), 0);
    assert.equal(rocAuc([true, false], [1, 1]), 0.5);
  });
});

describe('criticalTransitions windowing and detection', () => {
  it('ewsSeries steps the window across the series', () => {
    const series = Array.from({ length: 100 }, () => 1);
    const pts = ewsSeries(series, { window: 20, step: 10, detrend: 10 });
    assert.equal(pts.length, 9);
    assert.equal(pts[0].center, 10);
    assert.equal(pts[pts.length - 1].tick, 80);
  });

  it('ewsWindow flags higher variance for a noisier slice', () => {
    const calm = Array.from({ length: 60 }, (_, i) => 100 + (i % 2));
    const rng = lcg(7);
    const wild = Array.from({ length: 60 }, () => 100 + (rng() - 0.5) * 40);
    assert.ok(ewsWindow(wild, 15).variance > ewsWindow(calm, 15).variance);
  });

  it('detectCollapse finds a sustained drop and its plateau', () => {
    const series = [...Array(60).fill(100), ...Array(60).fill(0)];
    const ev = detectCollapse(series, { burnIn: 20, plateauFrom: 10, plateauTo: 50, fraction: 0.25, hold: 10 });
    assert.ok(ev);
    assert.equal(ev!.plateau, 100);
    assert.equal(ev!.threshold, 25);
    assert.ok(ev!.tick >= 60 && ev!.tick <= 61);
  });

  it('leadTime warns before a rising-variance collapse', () => {
    const pts: EwsPoint[] = [];
    for (let c = 0; c < 200; c += 10) {
      const v = c < 80 ? 1 + (c / 10) % 2 * 0.1 : c < 150 ? 5 : 50;
      pts.push({ tick: c, center: c, mean: 100, variance: v, ar1: 0.5, recovery: Math.log(2), cv: 0.01, skewness: 0, flicker: 0.1 });
    }
    const lead = leadTime(pts, 'variance', 200, { baselineFrom: 0, baselineTo: 70, horizon: 200, k: 1.5, sustain: 0.6 });
    assert.ok(lead);
    assert.ok(lead!.tick <= 90);
    assert.ok(lead!.leadTicks > 100);
  });

  it('aucByDistance rewards a rising indicator with a high AUC', () => {
    const pts: EwsPoint[] = [];
    for (let c = 0; c < 300; c += 10) {
      const dt = 200 - c;
      const v = dt > 0 && dt <= 100 ? 100 : 1;
      pts.push({ tick: c, center: c, mean: 100, variance: v, ar1: 0.5, recovery: Math.log(2), cv: 0.01, skewness: 0, flicker: 0.1 });
    }
    const { auc } = aucByDistance(pts, 'variance', 200, 0, 100, 50);
    assert.ok(auc > 0.9);
  });

  it('indicatorValue reads the named field', () => {
    const p: EwsPoint = { tick: 1, center: 1, mean: 2, variance: 3, ar1: 0.4, recovery: 1, cv: 0.1, skewness: 0.2, flicker: 0.3 };
    assert.equal(indicatorValue(p, 'ar1'), 0.4);
    assert.equal(indicatorValue(p, 'variance'), 3);
  });
});
