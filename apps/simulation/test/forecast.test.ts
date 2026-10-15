import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { TrendForecaster, forecastSeries } from '../src/forecast.js';

describe('TrendForecaster', () => {
  it('forecasts a straight-line series without crashing and produces coherent bands', () => {
    const fc = new TrendForecaster({
      series: ['x'],
      window: 8,
      hidden: 12,
      lr: 0.05,
      horizon: 4,
      seed: 0x5eed,
    });
    for (let t = 1; t <= 40; t++) {
      fc.observe(t, { x: 10 + t * 2 });
    }
    const out = fc.forecast();
    assert.equal(out.horizon, 4);
    assert.equal(out.steps.length, 4);
    // present value is ~90; every extrapolated step should stay finite and
    // greater than the series minimum (normalised range keeps it bounded)
    for (const st of out.steps) {
      assert.ok(Number.isFinite(st.values.x!), 'step value is finite');
      assert.ok(st.values.x! > 10, 'extrapolation stays above the series floor');
    }
    // bands enclose the trend
    const b = out.bands.x!;
    assert.ok(b.lo <= b.trend && b.trend <= b.hi, `trend ${b.trend} inside [${b.lo}, ${b.hi}]`);
    assert.ok(Number.isFinite(b.trend));
  });

  it('reproducibility: same seed + data => identical output', () => {
    const run = () => {
      const fc = new TrendForecaster({ series: ['x'], window: 6, hidden: 8, lr: 0.05, horizon: 3, seed: 1234 });
      for (let t = 1; t <= 30; t++) fc.observe(t, { x: Math.sin(t * 0.5) * 3 });
      return fc.forecast();
    };
    const a = run();
    const b = run();
    assert.deepEqual(a.steps, b.steps);
    assert.deepEqual(a.bands, b.bands);
  });

  it('short series (rows < window) still forecasts without crashing', () => {
    // regression: windowInput used to index out of range when the ring held
    // fewer rows than the requested window
    const fc = new TrendForecaster({ series: ['x', 'y'], window: 24, hidden: 12, lr: 0.05, horizon: 5, seed: 7 });
    for (let t = 1; t <= 10; t++) fc.observe(t, { x: t * 3, y: 100 - t });
    const out = fc.forecast();
    assert.equal(out.steps.length, 5);
    assert.ok(Number.isFinite(out.bands.x!.trend));
    assert.ok(Number.isFinite(out.bands.y!.trend));
  });

  it('missing/bad series keys are tolerated', () => {
    const fc = new TrendForecaster({ series: ['a', 'b'], window: 4, hidden: 4, lr: 0.05, horizon: 2, seed: 1 });
    for (let t = 1; t <= 20; t++) fc.observe(t, { a: t, b: Number.NaN });
    const out = fc.forecast();
    assert.equal(out.steps.length, 2);
  });
});

describe('forecastSeries convenience wrapper', () => {
  it('clamps the window to the trajectory size so short ladders forecast', () => {
    const trajectory = Array.from({ length: 6 }, (_, i) => ({ tick: i, alive: i * 2, energy: 50 - i }));
    const out = forecastSeries(trajectory as never, ['alive', 'energy'], { horizon: 3, seed: 42 });
    assert.equal(out.steps.length, 3);
    assert.ok(out.window <= 5, `window ${out.window} clamped below trajectory length`);
    assert.ok(Number.isFinite(out.bands.alive!.trend));
  });
});
