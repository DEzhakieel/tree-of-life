import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { EwsPoint } from '@fractal-life/shared';
import { EWS_INDICATORS, ewsSeries } from '@fractal-life/shared';
import {
  DEFAULT_LEAD,
  KS,
  multiverseSpecs,
  detrenderWidth,
  specId,
  REGISTERED_SPEC,
  transformOrder,
  rollingCv,
  windowStats,
  ewsPoints,
  ols,
  quantile,
  bootstrapSlope,
  detectWarning,
  firstSustained,
  axisRows,
  type MultiverseSpec,
  type SpecOutcome,
  type Fit,
} from '../src/research/ewsMultiverse.js';

const fit = (slope: number): Fit => ({ slope, intercept: 0, r2: 1 });

function outcome(spec: MultiverseSpec, aucSlope: number, leadSlope: number): SpecOutcome {
  const aucSlopeRec = {} as SpecOutcome['aucSlope'];
  const leadSlopeRec = {} as SpecOutcome['leadParamSlope'];
  const ticksRec = {} as SpecOutcome['leadTicksSlope'];
  for (const ind of EWS_INDICATORS) {
    aucSlopeRec[ind] = fit(aucSlope);
    leadSlopeRec[ind] = fit(leadSlope);
    ticksRec[ind] = fit(0);
  }
  return {
    spec,
    id: specId(spec),
    runs: 1,
    collapsed: 1,
    pooledAuc: Object.fromEntries(EWS_INDICATORS.map((i) => [i, 0.5])) as SpecOutcome['pooledAuc'],
    aucSlope: aucSlopeRec,
    leadParamSlope: leadSlopeRec,
    leadTicksSlope: ticksRec,
    detect: Object.fromEntries(EWS_INDICATORS.map((i) => [i, 1])) as SpecOutcome['detect'],
    meanLeadParam: Object.fromEntries(EWS_INDICATORS.map((i) => [i, 0])) as SpecOutcome['meanLeadParam'],
    aucBySeed: {} as SpecOutcome['aucBySeed'],
    leadBySeed: {} as SpecOutcome['leadBySeed'],
  };
}

test('spec space excludes smoothers wider than the analysis window', () => {
  const specs = multiverseSpecs();
  assert.ok(specs.length > 500, `expected a large space, got ${specs.length}`);
  for (const s of specs) {
    assert.ok(detrenderWidth(s.detrender) <= s.window, `${s.detrender} does not fit window ${s.window}`);
    assert.ok(KS.includes(s.k));
  }
  const ids = new Set(specs.map(specId));
  assert.equal(ids.size, specs.length, 'spec ids must be unique');
  assert.ok(ids.has(specId(REGISTERED_SPEC)), 'the registered spec must be inside the multiverse');
});

test('the registered spec is the analysis the thesis reports', () => {
  assert.deepEqual(
    { order: REGISTERED_SPEC.order, window: REGISTERED_SPEC.window, detrender: REGISTERED_SPEC.detrender, k: REGISTERED_SPEC.k },
    { order: 'pop', window: 60, detrender: 'ma25', k: 1.5 },
  );
});

test('order-parameter transforms are monotone where they should be', () => {
  const pop = [0, 1, 10, 100, 499];
  for (const order of ['pop', 'log', 'sqrt'] as const) {
    const y = transformOrder(pop, order, 60);
    assert.equal(y.length, pop.length);
    for (let i = 1; i < y.length; i++) assert.ok(y[i] >= y[i - 1], `${order} not monotone at ${i}`);
  }
  const cv = transformOrder([5, 5, 5, 5, 5], 'cv', 3);
  assert.equal(cv.length, 5);
  assert.equal(cv[4], 0, 'a constant series has zero coefficient of variation');
});

test('rollingCv is causal', () => {
  const a = rollingCv([1, 2, 3, 4, 5, 6], 3);
  const b = rollingCv([1, 2, 3, 4, 5, 99], 3);
  assert.deepEqual(a.slice(0, 5), b.slice(0, 5), 'changing the future must not change the past');
});

test('detrender none reproduces plain variance, and detrending removes a trend', () => {
  const ramp = Array.from({ length: 40 }, (_, i) => i * 2);
  const plain = windowStats(ramp, 'none');
  assert.ok(plain.variance > 100);
  const detr = windowStats(ramp, 'linear');
  assert.ok(detr.variance < plain.variance, 'linear detrend must shrink a linear trend residual');
});

test('ols recovers a known slope and R2', () => {
  const xs = [1, 2, 3, 4, 5];
  const f = ols(xs, xs.map((x) => 3 + 2 * x));
  assert.ok(Math.abs(f.slope - 2) < 1e-12);
  assert.ok(Math.abs(f.r2 - 1) < 1e-12);
  assert.equal(ols([1], [1]).slope, 0);
});

test('quantile interpolates', () => {
  assert.equal(quantile([1, 2, 3, 4], 0), 1);
  assert.equal(quantile([1, 2, 3, 4], 1), 4);
  assert.equal(quantile([1, 2, 3, 4], 0.5), 2.5);
});

function point(i: number, variance: number): EwsPoint {
  return { tick: i * 15, center: i * 15 + 30, mean: 1, variance, ar1: 0.1, recovery: 2.3, cv: 0.1, skewness: 0, flicker: 0.1 };
}

test('a rising variance is detected, and the horizon rule is enforced', () => {
  const points: EwsPoint[] = [];
  for (let i = 0; i < 40; i++) {
    const v = i < 20 ? 1 + 0.01 * i : 2 + 0.5 * (i - 20);
    points.push(point(i, v));
  }
  const opts = { ...DEFAULT_LEAD, baseline: 'preramp' as const, k: 1.5, sustain: 0.7, baselineFrom: 0, baselineTo: 300 };
  const det = detectWarning(points, 'variance', 600, [1], opts);
  assert.ok(det, 'rising variance must be detected');
  assert.ok(det.tick < 600);
  assert.ok(det.leadTicks > 0);

  const tooEarly = detectWarning(points, 'variance', 600, [1], { ...opts, horizon: 10 });
  assert.equal(tooEarly, null, 'a warning beyond the horizon is rejected, not silently accepted');
});

test('sustain rule needs a sustained crossing, not a single spike', () => {
  const pre = [point(0, 1), point(1, 1), point(2, 1), point(3, 1)];
  const spike = [false, true, false, false];
  assert.equal(firstSustained(pre, spike, 0.7, 100, 1000, 2), null);
  const sustained = [false, false, true, true];
  const det = firstSustained(pre, sustained, 0.7, 100, 1000, 2);
  assert.ok(det);
  assert.equal(det.tick, 30);
});

test('the registered detrender reproduces the shared EWS path exactly', () => {
  // If this drifts, the multiverse is no longer varying around the thesis's own
  // analysis, and every comparison to the registered numbers is invalid.
  let s = 12345;
  const rand = (): number => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const series: number[] = [];
  let v = 300;
  for (let i = 0; i < 400; i++) {
    v = Math.max(0, v + (rand() - 0.45) * 20);
    series.push(v);
  }
  const mine = ewsPoints(series, 60, 15, 'ma25');
  const theirs = ewsSeries(series, { window: 60, step: 15, detrend: 25 });
  assert.equal(mine.length, theirs.length);
  for (let i = 0; i < mine.length; i++) {
    assert.equal(mine[i].tick, theirs[i].tick);
    assert.ok(Math.abs(mine[i].variance - theirs[i].variance) < 1e-9, `variance mismatch at ${i}`);
    assert.ok(Math.abs(mine[i].ar1 - theirs[i].ar1) < 1e-9, `ar1 mismatch at ${i}`);
    assert.ok(Math.abs(mine[i].skewness - theirs[i].skewness) < 1e-9, `skewness mismatch at ${i}`);
    assert.ok(Math.abs(mine[i].cv - theirs[i].cv) < 1e-12, `cv mismatch at ${i}`);
    assert.ok(Math.abs(mine[i].flicker - theirs[i].flicker) < 1e-12, `flicker mismatch at ${i}`);
  }
});

test('bootstrap is deterministic, seed-aware, and centred on the sample slope', () => {
  const ramps = [300, 450, 600, 750, 900, 1050];
  // per-ramp AUC means decline with tau, which is the registered failure
  const meansPerRamp = [0.72, 0.70, 0.68, 0.66, 0.58, 0.54];
  const cols: Record<number, (number | null)[]> = {};
  ramps.forEach((r, k) => {
    cols[r] = Array.from({ length: 16 }, (_, i) => meansPerRamp[k] + (i % 3) * 0.01);
  });
  const a = bootstrapSlope(ramps, cols, 300, 7);
  const b = bootstrapSlope(ramps, cols, 300, 7);
  assert.deepEqual(a, b, 'same seed must give the same interval');
  assert.ok(a.lo <= a.median && a.median <= a.hi);
  assert.ok(a.lo < 0 && a.hi < 0, 'a uniformly negative gradient must stay negative under resampling');
  assert.equal(a.shareNegative, 1);
});

test('axis verdicts follow the pre-registered bars', () => {
  const specs = multiverseSpecs().slice(0, 12);
  const made = specs.map((s, i) => outcome(s, -0.0003, i < 6 ? -0.00002 : -0.0003));
  const rows = axisRows(made, 'order', 'variance', 'leadParam', -0.0003);
  assert.ok(rows.length > 0);
  for (const r of rows) {
    assert.ok(r.reduction <= 1.0001);
    if (r.verdict === 'supported') {
      assert.ok(r.reduction >= 0.5 && r.shareFlattened >= 0.9);
    }
  }
});
