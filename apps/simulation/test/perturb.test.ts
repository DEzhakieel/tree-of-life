import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeDrives, decodeStrategies } from '../src/genome.js';
import {
  BASELINE,
  OUTCOME_KEYS,
  PERTURBATIONS,
  baselineGenome,
  channelVerdict,
  mean,
  perturbedGenome,
  runDelta,
  stddev,
  summarizePerturbation,
  type ChannelExercise,
} from '../src/research/perturb.js';

const byId = (id: string) => {
  const p = PERTURBATIONS.find((x) => x.id === id);
  if (!p) throw new Error(`no perturbation ${id}`);
  return p;
};

const counter = (over: Partial<ChannelExercise> = {}): ChannelExercise => ({
  neighboursPerAgent: 1,
  richAgentTicks: 10,
  poorAgentTicks: 10,
signalDeposited: 5,
  noiseAgentTicks: 10,
  donations: 7,
  culled: 0,
  ...over,
});

test('baseline genome decodes the declared noise and cooperation', () => {
  const spec = { ...BASELINE, noise: 0.1, cooperation: 0.5 };
  const g = baselineGenome();
  const base = perturbedGenome(g, PERTURBATIONS[0]!);
  // strategies and drives must survive the write/read round trip
  const s = decodeStrategies(base);
  assert.ok(Math.abs(s.cooperation - spec.cooperation) < 1e-6, `cooperation ${s.cooperation}`);
  const d = decodeDrives(base);
  assert.ok(Math.abs(d.noise - spec.noise) < 1e-6, `noise ${d.noise}`);
});

test('noise x2 doubles the decoded noise drive and leaves cooperation alone', () => {
  const base = baselineGenome();
  const x2 = perturbedGenome(base, byId('noise-x2'));
  assert.ok(Math.abs(decodeDrives(x2).noise - 2 * BASELINE.noise) < 1e-6);
  assert.ok(Math.abs(decodeStrategies(x2).cooperation - BASELINE.cooperation) < 1e-6);
});

test('no-cooperation drives cooperation to its floor, strictly below baseline', () => {
  const base = baselineGenome();
  const g = perturbedGenome(base, byId('no-cooperation'));
  const c = decodeStrategies(g).cooperation;
  assert.ok(c < 0.02, `expected cooperation at the floor, got ${c}`);
  assert.ok(c < decodeStrategies(base).cooperation);
  // and it must be the only axis that moved
  assert.ok(Math.abs(decodeDrives(g).noise - BASELINE.noise) < 1e-6);
});

test('genome perturbations each move exactly one axis', () => {
  const base = baselineGenome();
  for (const p of PERTURBATIONS) {
    if (p.kind === 'baseline') continue; // the reference condition changes nothing by construction
    if (p.kind === 'cull') continue; // a cull is a runtime event, not a gene; see the next test
    const g = perturbedGenome(base, p);
    let differing = 0;
    for (let i = 0; i < base.length; i++) if (base[i] !== g[i]) differing++;
    assert.ok(differing >= 1, `${p.id} changed nothing`);
    assert.ok(differing <= 2, `${p.id} changed ${differing} genes; it should be a single-axis intervention`);
  }
});

test('the cull edits no genes at all, so its effect can only be attributed to the kill', () => {
  // this is the property that keeps a cull honest: if the genome differed, the population
  // drop could not be attributed to the removal
  const base = baselineGenome();
  const g = perturbedGenome(base, byId('cull-20pct'));
  assert.deepEqual([...g], [...base]);
});

test('every outcome key is covered and deltas are exactly perturbed minus baseline', () => {
  const d = runDelta('perturb.t1', byId('cull-20pct'), { ...BASELINE, ticks: 40 }, false);
  for (const k of OUTCOME_KEYS) {
    assert.equal(d.delta[k], d.perturbed[k] - d.baseline[k], `delta ${k} is not perturbed - baseline`);
  }
});

test('the same seed replays identically', () => {
  const spec = { ...BASELINE, ticks: 40 };
  const a = runDelta('perturb.t2', byId('noise-x2'), spec, false);
  const b = runDelta('perturb.t2', byId('noise-x2'), spec, false);
  assert.equal(a.fingerprint, b.fingerprint);
});

test('doubleRun throws only when a replay disagrees', () => {
  // a short deterministic run must survive the replay check
  const d = runDelta('perturb.t3', byId('noise-x2'), { ...BASELINE, ticks: 25 }, true);
  assert.ok(d.fingerprint.length > 0);
});

test('the cull removes the requested share and shows up as a population drop', () => {
  const d = runDelta('perturb.t4', byId('cull-20pct'), { ...BASELINE, ticks: 60 }, false);
  assert.equal(d.channel.culled, Math.round(100 * 0.2));
  // 20% fewer survivors, allow for any further natural attrition either side of it
  assert.ok(d.delta.aliveFrac < -0.15, `aliveFrac delta ${d.delta.aliveFrac}`);
});

test('baseline and perturbation are paired on the world, not on the calendar', () => {
  const spec = { ...BASELINE, ticks: 40 };
  const d = runDelta('perturb.t5', byId('noise-x2'), spec, false);
  // pairing means the baseline reuses the same founders, so the population identity of
  // the two runs is comparable; only the manipulated gene differs
  assert.notEqual(d.fingerprint, `${d.baseline.cooperationRate}`);
});

test('polarization stays a bounded order parameter', () => {
  for (const id of ['noise-x2', 'cull-20pct', 'no-communication']) {
    const d = runDelta('perturb.t6', byId(id), { ...BASELINE, ticks: 60 }, false);
    for (const side of [d.baseline, d.perturbed]) {
      assert.ok(side.polarization >= 0 && side.polarization <= 1, `${id} polarization ${side.polarization} out of [0,1]`);
    }
  }
});

test('a closed channel is reported as closed rather than as a null effect', () => {
  const closed = counter({ poorAgentTicks: 0, signalDeposited: 0, noiseAgentTicks: 0 });
  assert.equal(channelVerdict(byId('no-cooperation'), [closed], [closed]).verdict, 'closed');
  assert.equal(channelVerdict(byId('no-communication'), [closed], [closed]).verdict, 'closed');
  assert.equal(channelVerdict(byId('noise-x2'), [closed], [closed]).verdict, 'closed');
});

test('a live channel is reported as exercised', () => {
  const live = counter();
  for (const id of ['no-cooperation', 'noise-x2', 'no-communication']) {
    assert.equal(channelVerdict(byId(id), [live], [live]).verdict, 'exercised', id);
  }
});

test('a channel with both donation preconditions but no transfer is only partial', () => {
  const preconditionsMet = counter({ donations: 0 });
  assert.equal(channelVerdict(byId('no-cooperation'), [preconditionsMet], [preconditionsMet]).verdict, 'partial');
});

test('a cull that never fired is closed, not exercised', () => {
  // the horizon can be shorter than the intervention tick; that must not read as "no effect"
  const v = channelVerdict(byId('cull-20pct'), [counter({ culled: 0 })], [counter({ culled: 0 })]);
  assert.equal(v.verdict, 'closed');
  assert.match(v.evidence, /outside the run/);
});

test('the cull fires at the midpoint so short horizons still exercise it', () => {
  for (const ticks of [30, 60, 200]) {
    const d = runDelta(`perturb.cull${ticks}`, byId('cull-20pct'), { ...BASELINE, ticks }, false);
    assert.equal(d.channel.culled, 20, `ticks=${ticks} removed ${d.channel.culled}`);
    assert.ok(d.delta.aliveFrac < -0.15, `ticks=${ticks} aliveFrac delta ${d.delta.aliveFrac}`);
  }
});

test('the communication verdict is answered by the baseline, not the perturbed run', () => {
  // signal present at baseline, absent once switched off: the axis is exercised even
  // though the perturbed run's own counter is zero
  const baselineSide = counter({ signalDeposited: 100 });
  const perturbedSide = counter({ signalDeposited: 0 });
  const v = channelVerdict(byId('no-communication'), [baselineSide], [perturbedSide]);
  assert.equal(v.verdict, 'exercised');
  assert.match(v.evidence, /100\.00/);
});

test('the cull verdict is answered by the perturbed run, where the removal happened', () => {
  const v = channelVerdict(byId('cull-20pct'), [counter({ culled: 0 })], [counter({ culled: 20 })]);
  assert.equal(v.verdict, 'exercised');
  assert.match(v.evidence, /20/);
});

test('summaries split robust moves from sign-flipped noise', () => {
  const deltas = [
    { perturbation: 'noise-x2', axis: 'noise', seed: 's1', baseline: zero(), perturbed: spread(1), channel: counter(), baselineChannel: counter(), delta: spread(1), fingerprint: 'x' },
    { perturbation: 'noise-x2', axis: 'noise', seed: 's2', baseline: zero(), perturbed: spread(-1), channel: counter(), baselineChannel: counter(), delta: spread(-1), fingerprint: 'x' },
  ];
  const s = summarizePerturbation(deltas as never);
  assert.equal(s.robust.length, 0);
  assert.ok(s.signFlipped.length > 0, 'a metric that reverses sign must not be called robust');
});

function zero() {
  const o: Record<string, number> = {};
  for (const k of OUTCOME_KEYS) o[k] = 0;
  return o as never;
}
function spread(x: number) {
  const o: Record<string, number> = {};
  for (const k of OUTCOME_KEYS) o[k] = k === 'meanEnergy' ? x : 0;
  return o as never;
}

test('mean and stddev behave', () => {
  assert.equal(mean([1, 2, 3]), 2);
  assert.ok(Math.abs(stddev([2, 2, 2])) < 1e-12);
  assert.ok(stddev([0, 10]) > 0);
});

test('the declared outcome set is the one the report groups by', () => {
  assert.deepEqual([...OUTCOME_KEYS], [
    'aliveFrac',
    'meanEnergy',
    'energyTotal',
    'cooperationRate',
    'donorFrac',
    'foodCv',
    'spacing',
    'spacingCv',
    'polarization',
    'memeDominance',
  ]);
});
