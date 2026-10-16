import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  runExperiment,
  reproduceExperiment,
  saveManifest,
  loadManifest,
  resolveObjectives,
  availableObjectives,
  runDigest,
  ladderOptsFor,
  type Experiment,
} from '../src/research/experiment.js';
import { ExperimentRegistry, defaultExperiments } from '../src/research/experimentRegistry.js';
import { runLadder, type LadderOptions, type LadderResult } from '../src/research/ladder.js';

/** small experiment: short ticks; with the fake runner these are metadata only */
function smallExp(overrides: Partial<Experiment> = {}): Experiment {
  return {
    id: 'test-exp',
    name: 'Test Experiment',
    hypothesis: 'digests are bit-exact across identical runs',
    tags: ['test'],
    seeds: ['exp-seed-0001'],
    ladder: { ticks: 120, spawnCount: 12, maxPopulation: 60, sampleEvery: 40 },
    objectiveIds: ['l1-emergent', 'life-steady'],
    createdAt: '2026-10-16T00:00:00.000Z',
    ...overrides,
  };
}

/** deterministic cheap stand-in for runLadder: summary numbers are a pure
 * function of (seed, ticks, spawnCount), so digest semantics are testable
 * without the ~20 s controlled-scenario cost of the real ladder */
function fakeRunner(o: LadderOptions): LadderResult {
  let h = 0;
  const key = `${o.seed}|${o.ticks}|${o.spawnCount}|${o.maxPopulation}`;
  for (let i = 0; i < key.length; i++) h = (Math.imul(h, 31) + key.charCodeAt(i)) | 0;
  const v = ((h >>> 0) % 1000) / 1000;
  return {
    provenance: { fake: true },
    options: o,
    trajectory: [],
    worldFingerprint: `fake-${(h >>> 0).toString(16)}`,
    summary: {
      life: { finalAlive: Math.round(v * 100) },
      interaction: { maxSpecies: Math.round(v * 10) },
      cognition: { adaptationFrac: v, hazardCorr: v - 0.5, signalCorr: v - 0.5, speciesMemeMIMax: v },
    },
    synthesis: {
      levels: [
        { level: 'L1 life', verdict: (v > 0.3 ? 'EMERGENT' : 'ABSENT') as 'EMERGENT' | 'ABSENT', evidence: {}, note: 'fake' },
        { level: 'L2 interaction', verdict: 'ABSENT' as const, evidence: {}, note: 'fake' },
        { level: 'L3 cognition', verdict: 'ABSENT' as const, evidence: {}, note: 'fake' },
      ],
      chain: 'fake',
    },
    controlled: {},
  } as unknown as LadderResult;
}

test('registry registers and lists default experiments', () => {
  const reg = defaultExperiments();
  const ids = reg.list().map((e) => e.id);
  assert.ok(ids.includes('l3-baseline'));
  assert.ok(ids.includes('abundance-lift'));
  assert.equal(reg.require('l3-baseline').seeds.length, 3);
  assert.throws(() => reg.require('nope'), /unknown experiment/);
});

test('registry rejects duplicate ids and empty seed lists', () => {
  const reg = new ExperimentRegistry();
  const e = smallExp();
  reg.register(e);
  assert.throws(() => reg.register(e), /already registered/);
  assert.throws(() => reg.register(smallExp({ id: 'x2', seeds: [] })), />=1 seed/);
});

test('resolveObjectives resolves known ids and rejects unknown', () => {
  const objs = resolveObjectives(['l3-emergent', 'adaptation']);
  assert.deepEqual(objs.map((o) => o.id), ['l3-emergent', 'adaptation']);
  assert.ok(availableObjectives().includes('culture-mi'));
  assert.throws(() => resolveObjectives(['bogus']), /unknown objective/);
  assert.deepEqual(resolveObjectives().map((o) => o.id), ['l1-emergent', 'l2-emergent', 'l3-emergent', 'adaptation']);
});

test('ladderOptsFor applies experiment config but pins the seed', () => {
  const e = smallExp({ ladder: { ticks: 777, spawnCount: 12, seed: 'evil-seed' } });
  const o = ladderOptsFor(e, 'loop-seed');
  assert.equal(o.seed, 'loop-seed');
  assert.equal(o.ticks, 777);
  assert.equal(o.spawnCount, 12);
});

test('pipeline: manifest shape, aggregation, verdicts (fake runner)', () => {
  const m = runExperiment(smallExp({ seeds: ['s1', 's2'] }), { runner: fakeRunner });
  assert.equal(m.experiment.id, 'test-exp');
  assert.equal(m.perSeed.length, 2);
  for (const p of m.perSeed) {
    assert.match(p.digest, /^[0-9a-f]{64}$/);
    assert.ok(Number.isFinite(p.score));
    assert.equal(p.verdicts['L1 life'], 'EMERGENT');
  }
  assert.ok(Number.isFinite(m.aggregate.meanScore));
  assert.ok(Number.isFinite(m.aggregate.sdScore));
  assert.equal(m.aggregate.passRate, m.perSeed.filter((p) => p.thresholdsMet).length / 2);
  assert.equal(m.reproducible, true);
  assert.deepEqual(m.objectiveIds, ['l1-emergent', 'life-steady']);
  assert.equal(typeof m.ranAt, 'string');
  assert.equal(typeof m.runtime.node, 'string');
});

test('digests: identical inputs identical, different seeds differ (fake runner)', () => {
  const a = runExperiment(smallExp(), { runner: fakeRunner, doubleCheck: false });
  const b = runExperiment(smallExp(), { runner: fakeRunner, doubleCheck: false });
  assert.equal(a.perSeed[0]!.digest, b.perSeed[0]!.digest);

  const other = runExperiment(smallExp({ seeds: ['exp-seed-0002'] }), { runner: fakeRunner, doubleCheck: false });
  assert.notEqual(a.perSeed[0]!.digest, other.perSeed[0]!.digest);

  const shorter = runExperiment(
    smallExp({ ladder: { ticks: 60, spawnCount: 12, maxPopulation: 60, sampleEvery: 40 } }),
    { runner: fakeRunner, doubleCheck: false },
  );
  assert.notEqual(a.perSeed[0]!.digest, shorter.perSeed[0]!.digest);
});

test('manifest round-trips through disk; reproduce matches or flags tampering', () => {
  const dir = mkdtempSync(join(tmpdir(), 'exp-'));
  const m = runExperiment(smallExp(), { runner: fakeRunner });
  const path = join(dir, 'test-exp.json');
  saveManifest(m, path);
  assert.ok(existsSync(path));

  const loaded = loadManifest(path);
  assert.deepEqual(loaded.perSeed, m.perSeed);
  assert.deepEqual(loaded.aggregate, m.aggregate);
  assert.equal(loaded.experiment.hypothesis, m.experiment.hypothesis);

  const rep = reproduceExperiment(loaded, fakeRunner);
  assert.equal(rep.matched, true, JSON.stringify(rep.seeds));
  assert.equal(rep.seeds[0]!.recorded, rep.seeds[0]!.rerun);

  const drifted = reproduceExperiment(loaded, (o) => fakeRunner({ ...o, ticks: o.ticks + 1 }));
  assert.equal(drifted.matched, false);
  assert.notEqual(drifted.seeds[0]!.recorded, drifted.seeds[0]!.rerun);

  const onDisk = JSON.parse(readFileSync(path, 'utf8'));
  assert.equal(typeof onDisk.ranAt, 'string');
  assert.throws(() => loadManifest(join(dir, 'missing.json')), /manifest not found/);
});

test('end-to-end: real engine experiment is bit-reproducible', () => {
  const m = runExperiment(smallExp());
  const p = m.perSeed[0]!;
  assert.match(p.digest, /^[0-9a-f]{64}$/);
  assert.equal(m.reproducible, true, 'real ladder double-run must produce identical digests');
  assert.ok(p.verdicts['L1 life'] !== undefined);
  assert.equal(runDigest(runLadder(ladderOptsFor(smallExp(), 'exp-seed-0001'))), p.digest);
});

test('end-to-end: different seeds produce different digests via the world fingerprint', () => {
  // regression: digests used to hash only the (sometimes degenerate) summary,
  // so two different seeds could collide. The worldFingerprint fixes that.
  const a = runExperiment(smallExp({ seeds: ['exp-seed-0001'] }), { doubleCheck: false });
  const b = runExperiment(smallExp({ seeds: ['exp-seed-0002'] }), { doubleCheck: false });
  assert.notEqual(a.perSeed[0]!.digest, b.perSeed[0]!.digest);
});
