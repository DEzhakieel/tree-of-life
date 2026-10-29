import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Engine } from '../src/engine.js';
import { makeWorld } from '../src/research/scenarios.js';
import { mutateGenomeScaled } from '../src/genome.js';
import { SplitMix64 } from '../src/rng.js';
import {
  CONDITIONS,
  MIN_BOOTSTRAP_REPS,
  MIN_DETECTION,
  MIN_GENETIC_CONTRAST,
  RETENTION_BAR,
  conditionById,
  decideM4,
  fisherExact,
  geneticSummary,
  trajectory,
  type AblationRun,
  type ConditionOutcome,
  type GeneticSample,
  type RescueCondition,
} from '../src/research/rescueAblation.js';

/* ------------------------------------------------------------- the lever -- */

test('mutationScale 0 copies the genome exactly; >0 changes loci', () => {
  const parent = new Float32Array(64);
  for (let i = 0; i < parent.length; i++) parent[i] = ((i * 37) % 101) / 101 - 0.5;
  const rngA = new SplitMix64(1);
  const clone = mutateGenomeScaled(parent, rngA, 0, 0);
  assert.notEqual(clone, parent, 'the child is a new buffer');
  assert.deepEqual([...clone.slice(0, parent.length)], [...parent], 'zero rate and sigma must copy every locus');

  const rngB = new SplitMix64(1);
  const mutated = mutateGenomeScaled(parent, rngB, 0.5, 0.2);
  const changed = [...mutated].filter((v, i) => v !== parent[i]).length;
  assert.ok(changed > 0, 'a non-zero rate must change at least one locus');
});

test('the engine applies mutationScale to the measured mutation supply', () => {
  const run = (scale: number | undefined, ticks: number) => {
    const world = makeWorld('lever-probe', 80, { maxPopulation: 200, foodRegenRate: 0.005, metabolismBase: 0.5 });
    if (scale !== undefined) world.mutationScale = scale;
    const engine = new Engine(world);
    for (let t = 0; t < ticks; t++) engine.tick();
    return engine;
  };

  const clonal = run(0, 100);
  const baseline = run(1, 100);
  const elevated = run(4, 100);

  assert.ok(clonal.birthCount > 0, 'the probe must actually reproduce');
  assert.equal(clonal.mutationLoci, 0, 'clonal reproduction must not change a single locus');
  assert.ok(baseline.mutationLoci > 0, 'the registered world must mutate');
  assert.ok(
    elevated.mutationLoci > baseline.mutationLoci,
    `elevated supply ${elevated.mutationLoci} must exceed baseline ${baseline.mutationLoci}`,
  );

  // ×1 is the registered world: adding the lever must not change its trajectory
  const implicit = run(undefined, 60);
  const explicit = run(1, 60);
  assert.equal(implicit.birthCount, explicit.birthCount);
  assert.equal(implicit.mutationLoci, explicit.mutationLoci);
  assert.deepEqual(implicit.agents.get(0)?.genome, explicit.agents.get(0)?.genome);
});

/* --------------------------------------------------------- genetic summary -- */

const sample = (tick: number, locusVariance: number, lociPerBirth: number): GeneticSample => ({
  tick,
  n: 10,
  locusVariance,
  basalVariance: locusVariance / 2,
  meanBasal: 0.5,
  mutationLoci: lociPerBirth * 10,
  births: 10,
  lociPerBirth,
});

function run(condition: RescueCondition, genetic: GeneticSample[]): AblationRun {
  return {
    condition,
    seed: 's',
    ramp: 300,
    pop: [10],
    stress: [1],
    collapse: null,
    collapseStress: null,
    genetic,
  };
}

test('geneticSummary uses the registered windows', () => {
  const runs = [
    run('clonal', [sample(0, 0.4, 0), sample(100, 0.3, 0), sample(300, 0.2, 0), sample(900, 0.1, 0)]),
    run('clonal', [sample(0, 0.2, 0), sample(100, 0.2, 0), sample(300, 0.2, 0), sample(900, 0.0, 0)]),
  ];
  runs[1]!.seed = 's2';
  const s = geneticSummary(runs);
  assert.equal(s.runs, 2);
  assert.ok(Math.abs(s.founderVar - 0.275) < 1e-12, 'founder window averages ticks 0 and 100');
  assert.ok(Math.abs(s.plateauVar - 0.2) < 1e-12, 'plateau window averages the tick-300 samples');
  assert.ok(Math.abs(s.retention - 0.2 / 0.275) < 1e-12);
  assert.ok(Math.abs(s.finalVar - 0.05) < 1e-12);
  assert.equal(s.lociPerBirth, 0);
  assert.equal(s.plateauRuns, 2);
});

test('trajectory buckets by tick and averages across runs', () => {
  const runs = [
    run('baseline', [sample(0, 0.2, 10), sample(10, 0.4, 10), sample(60, 0.6, 10)]),
    run('baseline', [sample(0, 0.4, 10), sample(10, 0.6, 10)]),
  ];
  const tr = trajectory(runs, 'baseline', 50);
  assert.deepEqual(tr.map((p) => p.tick), [0, 50]);
  assert.ok(Math.abs(tr[0]!.locusVariance - 0.4) < 1e-12, 'ticks 0 and 10 share a bucket');
  assert.ok(Math.abs(tr[1]!.locusVariance - 0.6) < 1e-12);
  assert.equal(trajectory(runs, 'clonal', 50).length, 0);
});

/* ---------------------------------------------------------------- verdict -- */

function outcome(
  condition: RescueCondition,
  o: {
    leadSlope: number;
    collapseFraction?: number;
    lociPerBirth?: number;
    ci?: [number, number];
    detectionRate?: number;
    bootstrapReps?: number;
  },
): ConditionOutcome {
  const collapsed = Math.round((o.collapseFraction ?? 1) * 48);
  const cf = o.collapseFraction ?? 1;
  const detectionRate = o.detectionRate ?? 0.6;
  const bootstrapReps = o.bootstrapReps ?? 1000;
  return {
    condition,
    label: condition,
    mutationScale: conditionById(condition).mutationScale,
    runs: 48,
    collapsed,
    collapseFraction: cf,
    estimable: cf >= 0.5 && collapsed >= 4,
    detectionRate,
    slopeReliable: cf >= 0.5 && collapsed >= 4 && detectionRate >= MIN_DETECTION && bootstrapReps >= MIN_BOOTSTRAP_REPS,
    registered: null,
    aucSlope: -0.0003,
    aucR2: 0.7,
    leadSlope: o.leadSlope,
    leadR2: 0.3,
    aucBootstrap: null,
    leadBootstrap: {
      median: o.leadSlope,
      lo: o.ci?.[0] ?? o.leadSlope,
      hi: o.ci?.[1] ?? o.leadSlope,
      reps: bootstrapReps,
      shareNegative: 1,
    },
    multiverse: {
      specs: 1056,
      aucMedian: 0,
      aucQ05: 0,
      aucQ95: 0,
      aucShareNegative: 0.5,
      leadMedian: o.leadSlope,
      leadQ05: o.leadSlope,
      leadQ95: o.leadSlope,
      leadShareNegative: 0.5,
    },
    genetic: {
      runs: 48,
      founderVar: 0.3,
      plateauVar: 0.2,
      retention: 0.66,
      finalVar: 0.1,
      basalVariance: 0.01,
      meanBasal: 0.5,
      lociPerBirth: o.lociPerBirth ?? 10,
      finalLociPerBirth: o.lociPerBirth ?? 10,
      plateauRuns: 48,
    },
  };
}

const supportedArms = () => [
  outcome('clonal', { leadSlope: -0.001, lociPerBirth: 0, ci: [-0.002, 0.0005] }),
  outcome('baseline', { leadSlope: -0.004, lociPerBirth: 15 }),
  outcome('elevated', { leadSlope: -0.008, lociPerBirth: 50 }),
];

test('M4 is supported only when the clonal arm flattens and the manipulation bites', () => {
  const v = decideM4(supportedArms());
  assert.equal(v.verdict, 'supported');
  assert.equal(v.manipulationOk, true);
  assert.ok(v.leadRetained < RETENTION_BAR);
  assert.equal(v.monotoneDoseResponse, true);
});

test('M4 is refuted when the clonal arm keeps the slope', () => {
  const arms = supportedArms();
  arms[0] = outcome('clonal', { leadSlope: -0.003, lociPerBirth: 0, ci: [-0.004, -0.001] });
  const v = decideM4(arms);
  assert.equal(v.verdict, 'refuted');
  assert.ok(v.leadRetained >= RETENTION_BAR);
});

test('M4 is unresolved when the clonal arm barely collapses', () => {
  const arms = supportedArms();
  arms[0] = outcome('clonal', { leadSlope: -0.001, lociPerBirth: 0, collapseFraction: 0.25 });
  const v = decideM4(arms);
  assert.equal(v.verdict, 'unresolved');
  assert.equal(v.estimable, false);
});

test('M4 is unresolved when the mutation lever does not bite', () => {
  const arms = supportedArms();
  arms[0] = outcome('clonal', { leadSlope: -0.001, lociPerBirth: 10 });
  arms[2] = outcome('elevated', { leadSlope: -0.008, lociPerBirth: 12 });
  const v = decideM4(arms);
  assert.equal(v.verdict, 'unresolved');
  assert.equal(v.manipulationOk, false);
  assert.ok(v.contrast < MIN_GENETIC_CONTRAST);
});

test('the retention boundary is decisive: exactly half counts as refuted', () => {
  const arms = supportedArms();
  arms[0] = outcome('clonal', { leadSlope: -0.002, lociPerBirth: 0 });
  const v = decideM4(arms);
  assert.ok(Math.abs(v.leadRetained - 0.5) < 1e-12);
  assert.equal(v.verdict, 'refuted');
});

test('the condition table is the registered dose–response', () => {
  assert.deepEqual(
    CONDITIONS.map((c) => [c.id, c.mutationScale]),
    [
      ['clonal', 0],
      ['baseline', 1],
      ['elevated', 4],
    ],
  );
});

/* ------------------------------------------------------- collapse contrast -- */

test('fisherExact reproduces known two-sided values', () => {
  // the realised M4 table: clonal 43/48 vs elevated 25/48
  const observed = fisherExact(43, 5, 25, 23);
  assert.ok(Math.abs(observed - 9.127e-5) < 1e-7, `got ${observed}`);

  // identical arms: no evidence of a difference
  assert.ok(Math.abs(fisherExact(43, 5, 43, 5) - 1) < 1e-9);

  // complete separation: 0/10 vs 10/10, p = 2 / C(20,10)
  const separated = fisherExact(0, 10, 10, 0);
  assert.ok(Math.abs(separated - 2 / 184756) < 1e-10, `got ${separated}`);

  // swapping the columns must not change the answer
  assert.ok(Math.abs(fisherExact(43, 5, 25, 23) - fisherExact(5, 43, 23, 25)) < 1e-12);
});

test('the verdict carries the collapse contrast with its exact p', () => {
  const arms = supportedArms();
  arms[0] = outcome('clonal', { leadSlope: -0.0142, lociPerBirth: 0, collapseFraction: 43 / 48 });
  arms[2] = outcome('elevated', { leadSlope: -0.0182, lociPerBirth: 48.1, collapseFraction: 25 / 48 });
  const v = decideM4(arms);
  assert.ok(v.rescue, 'the contrast must be present when both endpoints exist');
  assert.equal(v.rescue!.clonal.collapsed, 43);
  assert.equal(v.rescue!.elevated.collapsed, 25);
  assert.ok(v.rescue!.p < 1e-3);
});

/* ----------------------------------------------------- interpretability -- */

test('an arm detected in under 20% of runs does not yield a slope', () => {
  const arms = supportedArms();
  // the realised elevated arm: 8% detection, zero bootstrap resamples
  arms[0] = outcome('clonal', { leadSlope: -0.004, lociPerBirth: 0, collapseFraction: 43 / 48 });
  arms[2] = outcome('elevated', { leadSlope: -0.0182, lociPerBirth: 48, detectionRate: 0.08, bootstrapReps: 0 });
  const v = decideM4(arms);
  assert.equal(arms[2]!.slopeReliable, false);
  assert.equal(v.verdict, 'refuted', 'the clonal-versus-registered comparison still decides');
  assert.equal(v.monotoneDoseResponse, false, 'an unreliable slope cannot supply a dose–response');
});

test('a clonal slope with too few detections is unresolved, not refuted', () => {
  const arms = supportedArms();
  arms[0] = outcome('clonal', { leadSlope: -0.001, lociPerBirth: 0, ci: [-0.002, 0], detectionRate: 0.05 });
  const v = decideM4(arms);
  assert.equal(arms[0]!.slopeReliable, false);
  assert.equal(v.verdict, 'unresolved');
  assert.match(v.reason, /not a measurement/);
});

test('a bootstrap with no resamples is not an interval', () => {
  const arms = supportedArms();
  arms[1] = outcome('baseline', { leadSlope: -0.004, lociPerBirth: 15, bootstrapReps: 0 });
  const v = decideM4(arms);
  assert.equal(arms[1]!.slopeReliable, false);
  assert.equal(v.verdict, 'unresolved');
});

test('the interpretation gates are the registered thresholds', () => {
  assert.equal(MIN_DETECTION, 0.2);
  assert.equal(MIN_BOOTSTRAP_REPS, 100);
});
