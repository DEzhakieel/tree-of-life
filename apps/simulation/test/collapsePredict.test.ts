import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  CP_CONDITIONS,
  CP_ENTROPY_FEATURES,
  CP_FEATURES,
  CP_POPULATION_FEATURES,
  CP_STRUCTURE_FEATURES,
  CP_TEMPORAL_FEATURES,
  CP_TEST_CONDITIONS,
  CP_TEST_SEEDS,
  CP_TRAIN_CONDITIONS,
  CP_TRAIN_SEEDS,
  buildCollapseReport,
  calibrationCoefficients,
  classifyOutcome,
  clusterBootstrap,
  conditionById,
  evaluatePredictions,
  extractFeatures,
  fitLogistic,
  logit,
  predictLogistic,
  probabilityBins,
  radiusOfGyration,
  renderCollapseMarkdown,
  reportToCsv,
  shannonBits,
  spatialStats,
  windowMean,
  type CollapseFeature,
  type CollapseOutcome,
  type CollapseRun,
  type EarlySample,
  type FeatureVector,
} from '../src/research/collapsePredict.js';
import { WORLD_SIZE } from '@fractal-life/shared';

const ZERO_FEATURES = Object.fromEntries(CP_FEATURES.map((f) => [f, 0])) as FeatureVector;

function sample(tick: number, population: number, overrides: Partial<EarlySample> = {}): EarlySample {
  return {
    tick,
    population,
    speciesEntropy: 0,
    spatialEntropy: 0,
    moranI: 0,
    clusterFrac: 0,
    occupancy: 0,
    largestComponentFrac: 0,
    radiusGyration: 0,
    meanEnergy: 0,
    ...overrides,
  };
}

function run(
  conditionId: string,
  seed: string,
  outcome: CollapseOutcome,
  featureOverrides: Partial<FeatureVector> = {},
): CollapseRun {
  const condition = conditionById(conditionId);
  return {
    condition: condition.id,
    rule: condition.rule,
    param: condition.param,
    split: condition.split,
    unseen: condition.unseen,
    seed,
    ticks: 600,
    earlyFrom: 40,
    earlyTo: 140,
    lateFrom: 500,
    lateTo: 600,
    features: { ...ZERO_FEATURES, ...featureOverrides },
    outcome,
    earlyMean: 30,
    lateMean: outcome === 'collapse' ? 2 : outcome === 'persist' ? 60 : 20,
    lateMin: outcome === 'collapse' ? 0 : 20,
    lateRatio: outcome === 'collapse' ? 0.05 : 2,
    final: outcome === 'collapse' ? 0 : 60,
    peak: 300,
    earlySamples: [],
    popSeries: [],
  };
}

/** 24 conditions x one seed each; outcome alternates so both classes exist on
 *  both sides of the split and is perfectly predicted by popTrend. */
function syntheticRuns(): CollapseRun[] {
  const runs: CollapseRun[] = [];
  let i = 0;
  for (const condition of CP_CONDITIONS) {
    const seed = condition.split === 'train' ? CP_TRAIN_SEEDS[0]! : CP_TEST_SEEDS[0]!;
    const collapse = i % 2 === 0;
    runs.push(
      run(condition.id, seed, collapse ? 'collapse' : 'persist', {
        popTrend: collapse ? -1.5 : 1.5,
      }),
    );
    i++;
  }
  return runs;
}

describe('Experiment D design', () => {
  it('has 24 conditions split 10 train / 14 test with no shared condition or seed', () => {
    assert.equal(CP_CONDITIONS.length, 24);
    assert.equal(CP_TRAIN_CONDITIONS.length, 10);
    assert.equal(CP_TEST_CONDITIONS.length, 14);
    assert.equal(new Set(CP_CONDITIONS.map((c) => c.id)).size, 24);
    const trainIds = new Set(CP_TRAIN_CONDITIONS.map((c) => c.id));
    for (const c of CP_TEST_CONDITIONS) assert.ok(!trainIds.has(c.id));
    assert.equal(new Set(CP_TRAIN_SEEDS).size, 8);
    assert.equal(new Set(CP_TEST_SEEDS).size, 8);
    for (const s of CP_TEST_SEEDS) assert.ok(!CP_TRAIN_SEEDS.includes(s));
  });

  it('registers unseen-rule and unseen-parameter test conditions', () => {
    for (const c of CP_TRAIN_CONDITIONS) assert.equal(c.unseen, 'none');
    for (const c of CP_TEST_CONDITIONS) assert.notEqual(c.unseen, 'none');
    const elevated = CP_TEST_CONDITIONS.filter((c) => c.rule === 'elevated');
    assert.equal(elevated.length, 8, 'elevated is unseen at every parameter');
    for (const c of elevated) {
      const heldParam = ['P3', 'P4', 'P5'].includes(c.param);
      assert.equal(c.unseen, heldParam ? 'both' : 'rule');
    }
    const unseenParams = CP_TEST_CONDITIONS.filter((c) => c.rule !== 'elevated');
    assert.deepEqual(
      [...new Set(unseenParams.map((c) => c.param))].sort(),
      ['P3', 'P4', 'P5'],
    );
    for (const c of unseenParams) assert.equal(c.unseen, 'parameter');
  });

  it('labels every condition with the declared mutation scale', () => {
    assert.equal(conditionById('clonal.P0').mutationScale, 0);
    assert.equal(conditionById('legacy.P0').mutationScale, 1);
    assert.equal(conditionById('elevated.P0').mutationScale, 4);
    // P3/P4/P5 are the held-out parameter regimes regardless of rule.
    for (const id of ['clonal.P3', 'legacy.P4', 'elevated.P5']) {
      assert.equal(conditionById(id).split, 'test');
    }
  });

  it('feature families cover the model matrix without overlap', () => {
    const families = [...CP_TEMPORAL_FEATURES, ...CP_ENTROPY_FEATURES, ...CP_STRUCTURE_FEATURES, 'meanEnergy'];
    assert.equal(new Set(families).size, CP_FEATURES.length);
    assert.deepEqual([...families].sort(), [...CP_FEATURES].sort());
    for (const f of CP_POPULATION_FEATURES) assert.ok(CP_TEMPORAL_FEATURES.includes(f));
    for (const f of CP_ENTROPY_FEATURES) assert.ok(!CP_STRUCTURE_FEATURES.includes(f));
  });
});

describe('Experiment D features', () => {
  it('computes Shannon entropy in bits', () => {
    assert.equal(shannonBits([]), 0);
    assert.equal(shannonBits([0, 0]), 0);
    assert.equal(shannonBits([5]), 0);
    assert.equal(shannonBits([1, 1]), 1);
    assert.ok(Math.abs(shannonBits([1, 1, 1, 1]) - 2) < 1e-12);
  });

  it('computes spatial statistics on the torus', () => {
    const bins = 16;
    const none = spatialStats(new Int32Array(bins * bins), bins);
    assert.deepEqual(none, { entropy: 0, moranI: 0, clusterFrac: 0, occupancy: 0, largestComponentFrac: 0 });

    const uniform = spatialStats(new Int32Array(bins * bins).fill(1), bins);
    assert.ok(Math.abs(uniform.entropy - 1) < 1e-12);
    assert.ok(Math.abs(uniform.moranI) < 1e-12);
    assert.equal(uniform.occupancy, 1);
    assert.equal(uniform.clusterFrac, 1);
    assert.equal(uniform.largestComponentFrac, 1);

    const counts = new Int32Array(bins * bins);
    counts[5 * bins + 5] = 1;
    const single = spatialStats(counts, bins);
    assert.equal(single.entropy, 0);
    assert.ok(Math.abs(single.occupancy - 1 / (bins * bins)) < 1e-12);
    assert.equal(single.clusterFrac, 0);
    assert.equal(single.largestComponentFrac, 1);
    assert.ok(single.moranI < 0, 'an isolated occupied bin is negatively autocorrelated');

        // Four adjacent bins: one 2x2 block; each occupied bin has two
    // occupied rook neighbours, so the occupied-neighbour fraction is 0.5.
    const clustered = new Int32Array(bins * bins);
    for (const [x, y] of [
      [5, 5],
      [6, 5],
      [5, 6],
      [6, 6],
    ] as const) {
      clustered[y * bins + x] = 1;
    }
    const cl = spatialStats(clustered, bins);
    assert.ok(cl.moranI > 0);
    assert.equal(cl.largestComponentFrac, 1);
    assert.equal(cl.clusterFrac, 0.5);
  });

  it('computes a seam-aware radius of gyration', () => {
    assert.equal(radiusOfGyration([], []), 0);
    assert.equal(radiusOfGyration([10], [10]), 0);
    const tight = radiusOfGyration([5, 5.5, 6], [5, 5.5, 6]);
    assert.ok(tight > 0 && tight < 0.001, `tight cluster radius ${tight}`);
    // Two points straddling the periodic seam are 2 units apart, not WORLD-2.
    const seam = radiusOfGyration([1, WORLD_SIZE - 1], [100, 100]);
    assert.ok(Math.abs(seam - 1 / WORLD_SIZE) < 1e-12, `seam radius ${seam}`);
    // A 100-unit pair across the seam has radius 50/W, not ~W/2.
    const spread = radiusOfGyration([WORLD_SIZE - 50, 50], [100, 100]);
    assert.ok(Math.abs(spread - 50 / WORLD_SIZE) < 1e-12, `seam spread ${spread}`);
  });

  it('extracts deterministic early features and respects population direction', () => {
    const rising: EarlySample[] = [];
    for (let i = 0; i < 21; i++) {
      rising.push(
        sample(40 + 5 * i, 20 + 2 * i, {
          speciesEntropy: 0.5,
          spatialEntropy: 0.25,
          moranI: 0.1,
          clusterFrac: 0.4,
          occupancy: 0.2,
          largestComponentFrac: 0.8,
          radiusGyration: 0.1,
          meanEnergy: 0.6,
        }),
      );
    }
    const a = extractFeatures(rising);
    const b = extractFeatures(rising);
    assert.deepEqual(a, b);
    assert.ok(a.popTrend > 0);
    assert.ok(Math.abs(a.popTrough - 0.5) < 1e-12, 'trough/mean of a linear ramp from 20 to 60 is 0.5');
    assert.ok(Math.abs(a.meanEnergy - 0.6) < 1e-12);
    assert.ok(Math.abs(a.speciesEntropy - 0.5) < 1e-12);
    assert.ok(Math.abs(a.moranI - 0.1) < 1e-12);
    assert.ok(Number.isFinite(a.ar1) && Number.isFinite(a.popCV) && Number.isFinite(a.flicker));

    const falling = extractFeatures(rising.map((s, i) => ({ ...s, population: 60 - 2 * i })));
    assert.ok(falling.popTrend < 0);
    assert.ok(Math.abs(extractFeatures([]).logMeanPop) < 1e-12);
  });

  it('classifies outcomes at the registered thresholds and windows by tick', () => {
    assert.equal(classifyOutcome(0), 'collapse');
    assert.equal(classifyOutcome(9.999), 'collapse');
    assert.equal(classifyOutcome(10), 'ambiguous');
    assert.equal(classifyOutcome(29.999), 'ambiguous');
    assert.equal(classifyOutcome(30), 'persist');

    // alive[t - 1] is tick t, so ticks 500..599 are indices 499..598.
    const alive = new Array<number>(600).fill(0);
    for (let t = 500; t <= 599; t++) alive[t - 1] = t === 599 ? 120 : 60;
    assert.equal(windowMean(alive, 500, 600), (99 * 60 + 120) / 100);
    assert.equal(windowMean(alive, 1, 11), 0);
  });
});

describe('Experiment D model', () => {
  it('fits a separable logistic direction without regularising the intercept', () => {
    const train: CollapseRun[] = [];
    for (let i = 0; i < 20; i++) {
      const collapse = i % 2 === 0;
      const condition = CP_TRAIN_CONDITIONS[i % CP_TRAIN_CONDITIONS.length]!;
      train.push(
        run(condition.id, `s${i}`, collapse ? 'collapse' : 'persist', {
          logMeanPop: collapse ? 1 : 5,
        }),
      );
    }
    const model = fitLogistic(train, ['logMeanPop']);
    assert.equal(model.n, 20);
    assert.equal(model.positives, 10);
    assert.equal(model.baseRate, 0.5);
    assert.ok(model.weights[0]! < 0, 'higher early population predicts persistence');
    const collapsePred = predictLogistic(model, train[0]!);
    const persistPred = predictLogistic(model, train[1]!);
    assert.ok(collapsePred > 0.5 && persistPred < 0.5);
  });

  it('ignores ambiguous runs and handles a one-class training split', () => {
    const ambiguous = run('clonal.P0', 's1', 'ambiguous', { logMeanPop: 99 });
    const base = run('clonal.P1', 's2', 'persist', { logMeanPop: 1 });
    const model = fitLogistic([ambiguous, base], ['logMeanPop']);
    assert.equal(model.n, 1);
    assert.equal(model.positives, 0);
    assert.ok(predictLogistic(model, base) < 1e-6);
  });

  it('reports discrimination, Brier skill and calibration on held-out runs', () => {
    const train = [
      run('clonal.P0', 'a', 'collapse', { logMeanPop: 1 }),
      run('clonal.P1', 'a', 'persist', { logMeanPop: 5 }),
      run('legacy.P0', 'a', 'collapse', { logMeanPop: 2 }),
      run('legacy.P1', 'a', 'persist', { logMeanPop: 4 }),
    ];
    const test = [
      run('elevated.P0', 'b', 'collapse', { logMeanPop: 1.5 }),
      run('elevated.P1', 'b', 'persist', { logMeanPop: 4.5 }),
      run('elevated.P2', 'b', 'collapse', { logMeanPop: 2.5 }),
      run('elevated.P3', 'b', 'persist', { logMeanPop: 3.5 }),
    ];
    const model = fitLogistic(train, CP_POPULATION_FEATURES);
    const preds = test.map((r) => predictLogistic(model, r));
    const labels = test.map((r) => r.outcome === 'collapse');
    const metrics = evaluatePredictions(preds, labels, model.baseRate);
    assert.equal(metrics.n, 4);
    assert.equal(metrics.auc, 1);
    assert.ok(metrics.brier < metrics.brierBase);
    assert.ok(metrics.brierSkill > 0.5);
    assert.ok(metrics.ece >= 0 && metrics.ece <= 1);
  });

  it('bins predictions exhaustively and computes calibration coefficients', () => {
    const preds = [0, 0.19, 0.2, 0.5, 1];
    const labels = [false, false, true, true, true];
    const bins = probabilityBins(preds, labels, 5);
    assert.equal(bins.length, 5);
    assert.equal(bins.reduce((s, b) => s + b.n, 0), preds.length);
    const cal = calibrationCoefficients(
      [0.9, 0.9, 0.1, 0.1, 0.8, 0.2],
      [true, true, false, false, true, false],
    );
    assert.ok(Number.isFinite(cal.slope) && cal.slope > 0);
    assert.ok(Number.isFinite(cal.intercept));
    assert.ok(Math.abs(logit(0.5)) < 1e-12);
  });

  it('cluster bootstrap is deterministic and resamples conditions', () => {
    const runs = syntheticRuns();
    const labels = runs.map((r) => r.outcome === 'collapse');
    const scores = runs.map((r) => r.features.popTrend);
    const metric = (sampleRuns: readonly CollapseRun[]): number =>
      sampleRuns.filter((r) => r.outcome === 'collapse').length / Math.max(1, sampleRuns.length);
    const a = clusterBootstrap(runs, metric, 200, 7);
    const b = clusterBootstrap(runs, metric, 200, 7);
    assert.deepEqual(a, b);
    assert.ok(a.lo <= a.median && a.median <= a.hi);
    assert.ok(labels.every((l, i) => l === (scores[i]! < 0)));
  });
});

describe('Experiment D report', () => {
  it('builds every model, claim and condition summary', () => {
    const report = buildCollapseReport(syntheticRuns(), '2026-10-31T00:00:00.000Z');
    assert.deepEqual(
      report.models.map((m) => m.name),
      ['full', 'population', 'temporal', 'entropy', 'structure', 'noEntropy', 'noStructure'],
    );
    assert.deepEqual(
      report.claims.map((c) => c.id),
      ['D-PRED-01', 'D-PRED-02', 'D-PRED-03', 'D-PRED-04', 'D-PRED-05'],
    );
    assert.equal(report.train.n, 10);
    assert.equal(report.test.n, 14);
    assert.equal(report.validity.passed, true);
    assert.deepEqual(report.validity.reasons, []);
    assert.equal(report.validity.trainPositives, 6);
    assert.equal(report.validity.trainNegatives, 4);
    assert.equal(report.validity.testPositives, 6);
    assert.equal(report.validity.testNegatives, 8);
    assert.equal(report.conditionSummaries.length, 24);
    for (const c of report.conditionSummaries) {
      assert.equal(c.n, 1);
      assert.equal(c.collapse + c.persist + c.ambiguous, 1);
    }
    const full = report.models.find((m) => m.name === 'full')!;
    const entropy = report.models.find((m) => m.name === 'entropy')!;
    assert.equal(full.metrics.auc, 1);
    assert.equal(entropy.metrics.auc, 0.5, 'a constant feature carries no ranking');
    assert.equal(report.claims.find((c) => c.id === 'D-PRED-01')!.verdict, 'supported');
    assert.equal(report.claims.find((c) => c.id === 'D-PRED-04')!.verdict, 'supported');
    assert.equal(report.univariate.length, CP_FEATURES.length);
  });

  it('forces every verdict to inconclusive when the label gate fails', () => {
    const runs = [
      run('clonal.P0', 'a', 'collapse', { logMeanPop: 1 }),
      run('clonal.P1', 'a', 'persist', { logMeanPop: 5 }),
      run('elevated.P0', 'b', 'collapse', { logMeanPop: 1 }),
      run('elevated.P1', 'b', 'persist', { logMeanPop: 5 }),
    ];
    const report = buildCollapseReport(runs, '2026-10-31T00:00:00.000Z');
    assert.equal(report.validity.passed, false);
    assert.ok(report.validity.reasons.length >= 2);
    for (const c of report.claims) {
      assert.equal(c.verdict, 'inconclusive');
      assert.ok(c.detail.includes('Label gate failed'));
    }
    assert.ok(renderCollapseMarkdown(report).includes('**Failed.**'));
  });

  it('renders markdown and CSV with the registered framing', () => {
    const report = buildCollapseReport(syntheticRuns(), '2026-10-31T00:00:00.000Z');
    const md = renderCollapseMarkdown(report);
    assert.ok(md.includes('# Experiment D'));
    assert.ok(md.includes('D-PRED-01'));
    assert.ok(md.includes('Pilot disclosure'));
    assert.ok(md.includes('unseen rule'));
    const csv = reportToCsv(report);
    const lines = csv.trim().split('\n');
    assert.equal(lines.length, 25);
    for (const f of CP_FEATURES) assert.ok(lines[0]!.includes(f));
    // Every run has a unique condition|seed key: no world is reused across the split.
    const keys = report.runs.map((r) => `${r.condition}|${r.seed}`);
    assert.equal(new Set(keys).size, keys.length);
  });
});
