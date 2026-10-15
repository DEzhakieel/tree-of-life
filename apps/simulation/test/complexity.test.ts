import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  attractorModes,
  calibrateSupply,
  capLogs,
  CAP_LOG_MAX,
  CAP_LOG_MIN,
  supplyLogs,
  SUPPLY_LOG_MAX,
  SUPPLY_LOG_MIN,
  corr,
  crossPartial,
  halfMaxWidth,
  derivativeCentral,
  entropyOf,
  feedbackReport,
  findPeaks,
  fitLogLog,
  hysteresisLoop,
  interactionCrossPartials,
  mean,
  stddev,
  buildLabWorld,
  runLabWorld,
  richLineage,
  sizeFor,
  SIZE_QUICK,
} from '../src/research/complexity.js';
import { TIER_DEFS } from '../src/research/archetypes.js';
import { Engine } from '../src/engine.js';

// ---------------------------------------------------------------------------
// Pure measurement math — synthetic inputs only (deterministic, no engine)
// ---------------------------------------------------------------------------

test('entropyOf: uniform bernoulli = 1, degenerate = 0, empty = 0', () => {
  assert.equal(entropyOf([1, 1]), 1);
  assert.equal(entropyOf([7]), 0);
  assert.equal(entropyOf([]), 0);
  assert.equal(entropyOf([1, 1, 1, 1]), 2);
});

test('mean/stddev: basic statistics', () => {
  assert.equal(mean([2, 4, 6]), 4);
  assert.ok(Math.abs(stddev([2, 4, 6]) - Math.sqrt(4)) < 1e-9);
  assert.equal(stddev([5, 5, 5]), 0);
  assert.equal(mean([]), 0);
});

test('corr: perfect monotone relationships', () => {
  assert.ok(Math.abs(corr([1, 2, 3, 4, 5], [2, 4, 6, 8, 10]) - 1) < 1e-9);
  assert.ok(Math.abs(corr([1, 2, 3, 4, 5], [10, 8, 6, 4, 2]) + 1) < 1e-9);
  assert.equal(corr([1, 1, 1], [1, 2, 3]), 0);
  assert.equal(corr([], []), 0);
});

test('derivativeCentral: d(x²)/dx = 2x', () => {
  const xs = Array.from({ length: 11 }, (_, i) => i);
  const ys = xs.map((x) => x * x);
  const d = derivativeCentral(ys, xs);
  assert.ok(Math.abs(d[5]! - 10) < 1e-9);
  assert.ok(Math.abs(d[0]! - 1) < 1e-9);
  assert.ok(Math.abs(d[10]! - 19) < 1e-9);
});

test('findPeaks: strict local maxima + prominence filter', () => {
  assert.deepEqual(findPeaks([0, 3, 0, 1, 0, 2, 0]), [1, 3, 5]);
  assert.deepEqual(findPeaks([5, 4, 3, 2, 1]), []);
  assert.deepEqual(findPeaks([0, 0.3, 0, 2, 0], 0.5), [3]);
  assert.deepEqual(findPeaks([0, 0.4, 0, 2, 0], 0.5), [3]); // left peak 0.4 < 0.5 filtered
});

test('attractorModes: bimodal splits into two modes, unimodal stays one', () => {
  const bimodal = Array.from({ length: 20 }, (_, i) => (i < 10 ? 0.15 : 0.6));
  const uni = Array.from({ length: 20 }, () => 0.35);
  assert.equal(attractorModes(bimodal).modes, 2);
  assert.equal(attractorModes(uni).modes, 1);
  assert.equal(attractorModes([]).modes, 0);
});

test('feedbackReport: lagged correlation + overdispersion', () => {
  const alive = Array.from({ length: 20 }, (_, i) => Math.min(16, 6 + i));
  const births = alive.map((a) => Math.max(0, a - 5)); // births follow population w/ saturation
  const rep = feedbackReport(alive, births);
  assert.ok(rep.rhoBirthAliveLag1 > 0.5, 'lagged birth↔population correlation should be positive');
  assert.ok(Number.isFinite(rep.rhoBirthLag1));
  const clustered = [8, 8, 8, 8, 8, 2, 2, 2, 8, 8, 8, 8];
  assert.ok(feedbackReport(clustered, clustered).overdispersion > 1, 'bursty births should be overdispersed');
});

test('hysteresisLoop: nonzero loop ⇒ area + path index', () => {
  const lp = [0, 1, 2];
  const up = [0.1, 0.5, 0.9];
  const down = [0.9, 0.5, 0.1];
  const r = hysteresisLoop(lp, up, down);
  assert.ok(Math.abs(r.loopArea - 0.8) < 1e-9, `loop area was ${r.loopArea}`);
  assert.ok(Math.abs(r.pathIndex - 2 / 3) < 1e-9);
  assert.ok(Math.abs(r.maxDelta - 0.8) < 1e-9);
});

test('fitLogLog: recovers a power-law exponent', () => {
  const xs = [1, 2, 4, 8, 16];
  const ys = xs.map((x) => 3 * x * x);
  const fit = fitLogLog(xs, ys);
  assert.ok(Math.abs(fit.slope - 2) < 0.01, `slope was ${fit.slope}`);
  assert.ok(fit.r2 > 0.99);
  const lin = fitLogLog([10, 20, 30, 40, 50], [10, 20, 30, 40, 50]);
  assert.ok(Math.abs(lin.slope - 1) < 0.01);
  assert.equal(fitLogLog([1, 1, 1], [1, 1, 1]).n, 0); // flat domain → degenerate fit, no false exponent
});

test('capLogs / supplyLogs cover the declared log ranges', () => {
  const c = capLogs(17);
  assert.ok(Math.abs(c[0]! - CAP_LOG_MIN) < 1e-9);
  assert.ok(Math.abs(c[c.length - 1]! - CAP_LOG_MAX) < 1e-9);
  const s = supplyLogs(13);
  assert.ok(Math.abs(s[0]! - SUPPLY_LOG_MIN) < 1e-9);
  assert.ok(Math.abs(s[s.length - 1]! - SUPPLY_LOG_MAX) < 1e-9);
});

test('sizeFor: sizes are coherent and quick ≪ full', () => {
  const q = sizeFor('quick');
  const f = sizeFor('full');
  const d = sizeFor('dense');
  assert.equal(SIZE_QUICK().capScanG, q.capScanG);
  assert.ok(q.capScanG < f.capScanG && f.capScanG < d.capScanG);
  assert.ok(q.supScanG < f.supScanG && f.supScanG < d.supScanG);
  assert.ok(q.spawn > 0 && q.scanTicks > 0);
});

test('crossPartial: additive = 0, multiplicative interaction = constant', () => {
  const lc = [0, 1, 2, 3];
  const lg = [-5, -4, -3, -2];
  const additive = lc.map((c) => lg.map((g) => 2 * c + 3 * g));
  const r0 = crossPartial(additive, lc, lg);
  assert.equal(r0.maxCross, 0);
  const interacting = lc.map((c) => lg.map((g) => 2 * c + 3 * g + 0.7 * c * g));
  const r1 = crossPartial(interacting, lc, lg);
  assert.ok(Math.abs(r1.maxCross - 0.7) < 1e-9, `maxCross was ${r1.maxCross}`);
  assert.ok(r1.where.i >= 1 && r1.where.j >= 1);
  // interior only — a 2×n surface has no inner cells
  assert.equal(crossPartial(lc.map((c) => lg.map((g) => c * g)).slice(0, 2), lc.slice(0, 2), lg).where.i, -1);
});

test('halfMaxWidth: region above half-peak on a linear grid', () => {
  const lp = [-2, -1, 0, 1, 2];
  const d = [0, 1, 2, 1, 0]; // |d| ≥ 1 spans lp −1…1
  assert.ok(Math.abs(halfMaxWidth(d, lp).width - 2) < 1e-9);
  assert.ok(Math.abs(halfMaxWidth(d, lp).center) < 1e-9);
  const spike = [0, 0, 5, 0, 0]; // isolated spike → zero width
  assert.ok(halfMaxWidth(spike, lp).width === 0);
  const flat = [1, 1, 1, 1, 1]; // no isolated peak → falls back to the full sampled window
  assert.ok(halfMaxWidth(flat, lp).width >= lp[4]! - lp[0]!);
});

test('interactionCrossPartials recovers a planted cross term on a real surface', () => {
  const caps = [10, 100, 1000];
  const gs = [1e-5, 1e-3, 1e-1];
  const lc = caps.map((c) => Math.log10(c));
  const lg = gs.map((g) => Math.log10(g));
  const rows = [];
  for (const rule of [1, 3]) {
    for (const c of caps) {
      for (const g of gs) {
        const lcap = Math.log10(c);
        const lgv = Math.log10(g);
        rows.push({
          rule,
          cap: c,
          lcap,
          g,
          lg: lgv,
          seed: 's',
          aliveFrac: 0.1 + 0.02 * lcap + 0.05 * lgv + 0.013 * lcap * lgv,
          species: 2,
          cooperation: 0.5,
        });
      }
    }
  }
  const out = interactionCrossPartials(rows, lc, lg, ['aliveFrac']);
  assert.equal(out.length, 2);
  for (const o of out) assert.ok(Math.abs(o.maxCross - 0.013) < 1e-7, `T${o.rule} cross was ${o.maxCross}`);
});

// ---------------------------------------------------------------------------
// Engine-level: the lab harness stays deterministic on both micro axes
// ---------------------------------------------------------------------------

function tickWorld(seed: string, tier: number, axis: 'cellCap' | 'supply', p: number, ticks: number): string {
  const overrides: Record<string, number> = axis === 'supply' ? { foodRegenRate: p, energyCapacity: 25 } : { energyCapacity: p };
  const world = buildLabWorld(seed, 16, TIER_DEFS[tier]!, overrides);
  return runLabWorld(world, TIER_DEFS[tier]!, ticks, false, seed, axis, p, 16).hash;
}

test('lab harness: capacity-axis worlds are bit-reproducible', () => {
  const a = tickWorld('lab.test.s1', 3, 'cellCap', 150, 40);
  const b = tickWorld('lab.test.s1', 3, 'cellCap', 150, 40);
  assert.equal(a, b);
});

test('lab harness: supply-axis calibration is deterministic', () => {
  const a = tickWorld('lab.test.s1', 1, 'supply', 3e-3, 60);
  const b = tickWorld('lab.test.s1', 1, 'supply', 3e-3, 60);
  assert.equal(a, b);
});

test('calibrateSupply leaves the grid cap invariant', () => {
  const engine = new Engine(buildLabWorld('lab.test.s2', 16, TIER_DEFS[3]!));
  const capBefore = [...engine.grid.cap];
  calibrateSupply(engine, 1e-4);
  assert.deepEqual([...engine.grid.cap], capBefore);
  assert.ok(engine.grid.food.some((f) => f > 0));
});

test('richLineage produces surviving founder genomes', () => {
  const lineage = richLineage('lab.test.s6', TIER_DEFS[3]!, 'cellCap', 600, 40);
  assert.ok(lineage.genomes.length >= 1, 'seed lab.test.s6 must yield founders at the rich end');
  assert.equal(lineage.genomes[0]!.length, lineage.genomes[0]!.length);
});

test('lab runner survives a small integration scan (structure sanity)', () => {
  const size = sizeFor('quick');
  const seeds = ['lab.it.b', 'lab.it.a'];
  const tier = TIER_DEFS[1]!;
  const runsA = [25, 600].map((p) => runLabWorld(buildLabWorld(seeds[0]!, size.spawn, tier, { energyCapacity: p }), tier, 80, true, seeds[0]!, 'cellCap', p, size.spawn));
  const runsB = runsA.map((r) => runLabWorld(buildLabWorld(seeds[1]!, size.spawn, tier, { energyCapacity: r.p }), tier, 80, true, seeds[1]!, 'cellCap', r.p, size.spawn));
  assert.notEqual(runsA[0]!.macro.aliveFrac, runsA[1]!.macro.aliveFrac, 'capacity must change the outcome');
  assert.ok(runsA[0]!.aliveSeries && runsA[0]!.aliveSeries!.length === 80);
  assert.ok(runsA[0]!.hash !== runsB[0]!.hash, 'different seeds → different state');
});