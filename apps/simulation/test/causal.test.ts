import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WORLD_SIZE } from '@fractal-life/shared';
import { feedGenome } from '../src/research/scenarios.js';
import {
  CAUSAL_COMPONENTS,
  COMPONENT_IDS,
  ArmConfig,
  buildArmGenome,
  classifyBehaviour,
  collectiveStateOf,
  componentOf,
  componentOfGene,
  decodeSenseRadius,
  enumerateArms,
  leaveOneOut,
  meanAndCv,
  polarizationOf,
  rotationalOrderOf,
  runArm,
  replicateArm,
  densitySweep,
  replicateStudy,
  senseToSeparationRatio,
  separationRadius,
  setKey,
  parseSetKey,
  spreadOf,
  thresholdsFor,
  torusCentroid,
  torusDelta,
  causalWorldFactory,
  DEFAULT_ARM,
  DENSE_ARM,
  SPARSE_ARM,
  resolveDensityEndpoints,
  MILL_ROTATION_THRESHOLD,
  backgroundGenome,
  GENOME_BACKGROUNDS,
  replicateOnBackground,
  thresholdSensitivity,
  type BehaviourClass,
  type CollectiveState,
  type ComponentSet,
} from '../src/research/causal.js';

const FAST: ArmConfig = { spawn: 24, arena: 90, ticks: 120, sampleEvery: 20, seedSpeed: 2, rngSeed: 7 };
/** the density used by the study, where the triad actually reaches a flock */
const DENSE: ArmConfig = { spawn: 24, arena: 90, ticks: 400, sampleEvery: 20, seedSpeed: 2, rngSeed: 999 };
/** the sparse arm of the study, where mean spacing sits far outside the separation radius */
const SPARSE: ArmConfig = { spawn: 60, arena: 140, ticks: 400, sampleEvery: 20, seedSpeed: 2, rngSeed: 999 };

/* ---------------- component alphabet and set keys ---------------- */

test('causal alphabet is the four neighbour-coupled drives', () => {
  assert.deepEqual([...COMPONENT_IDS].sort(), ['alignment', 'circulation', 'cohesion', 'separation']);
});

test('every component maps to a drive gene inside the drive block', () => {
  for (const c of CAUSAL_COMPONENTS) {
    assert.ok(c.geneIndex >= 110, `${c.id} gene ${c.geneIndex} outside drive block`);
    assert.equal(componentOfGene(c.geneIndex)!.id, c.id);
  }
});

test('setKey round-trips through parseSetKey for all 16 subsets', () => {
  const arms = enumerateArms();
  assert.equal(arms.length, 16);
  for (const set of arms) {
    assert.deepEqual(parseSetKey(setKey(set)), set, `round-trip failed for ${setKey(set) || 'none'}`);
  }
  assert.equal(setKey([]), 'none');
  assert.deepEqual(parseSetKey('none'), []);
});

test('setKey is independent of the order the components are given in', () => {
  assert.equal(setKey(['separation', 'alignment']), setKey(['alignment', 'separation']));
  assert.equal(setKey(['circulation', 'alignment', 'cohesion']), 'alignment+cohesion+circulation');
});

test('enumerateArms covers every subset exactly once, ordered by size', () => {
  const arms = enumerateArms();
  assert.equal(new Set(arms.map(setKey)).size, 16);
  for (let i = 1; i < arms.length; i++) assert.ok(arms[i]!.length >= arms[i - 1]!.length);
});

test('leaveOneOut returns the base set plus each single-component removal', () => {
  const base: ComponentSet = ['alignment', 'cohesion', 'separation'];
  const outs = leaveOneOut(base);
  assert.equal(outs.length, 4);
  assert.deepEqual(outs[0], base);
  for (const o of outs.slice(1)) {
    assert.equal(o.length, 2);
    assert.ok(base.some((id) => !o.includes(id)));
  }
});

/* ---------------- genome construction ---------------- */

test('buildArmGenome writes only drive genes and never the dual-use c genes', () => {
  const base = feedGenome({ diet: -1 });
  for (const set of enumerateArms()) {
    const g = buildArmGenome(set, base);
    for (let i = 0; i < g.length; i++) {
      if (i < 110) assert.equal(g[i], base[i], `arm ${setKey(set)} mutated non-drive gene ${i}`);
    }
  }
});

test('genes 0 and 1 encode the agent point c, so cIm must never be touched', () => {
  // regression guard: writing g[1] to widen the sense radius sets cIm = 1, which
  // puts every agent on an escaping orbit and kills the whole population on tick 1
  const base = feedGenome({ diet: -1 });
  assert.equal(base[1], 0, 'feedGenome must pin cIm to 0 for a bounded orbit');
  for (const set of enumerateArms()) assert.equal(buildArmGenome(set, base)[1], base[1]);
});

test('a disabled component contributes a literal zero weight', () => {
  const g = buildArmGenome(['cohesion'], feedGenome({ diet: -1 }));
  assert.equal(g[componentOf('cohesion').geneIndex], componentOf('cohesion').onGene);
  for (const id of ['alignment', 'separation'] as const) {
    assert.equal(g[componentOf(id).geneIndex], componentOf(id).offGene, `${id} should be off`);
  }
  const circ = componentOf('circulation');
  assert.equal(g[circ.geneIndex], circ.offGene, 'circulation must be 0, not -1');
});

test('circulation is a signed drive, so its off value is 0 not -1', () => {
  const circ = CAUSAL_COMPONENTS.find((c) => c.id === 'circulation')!;
  assert.equal(circ.offGene, 0);
  const g = buildArmGenome([], feedGenome({ diet: -1 }));
  assert.equal(g[circ.geneIndex], 0);
});

/* ---------------- geometry helpers ---------------- */

test('torusDelta wraps across the seam and reports second minus first', () => {
  assert.equal(torusDelta(5, WORLD_SIZE - 5), -10);
  assert.equal(torusDelta(WORLD_SIZE - 5, 5), 10);
  assert.equal(torusDelta(140, 100), -40);
  assert.equal(torusDelta(100, 140), 40);
});

test('torusCentroid survives a group straddling the seam', () => {
  const c = torusCentroid([2, WORLD_SIZE - 2], [10, 10]);
  assert.ok(Math.min(c.x, WORLD_SIZE - c.x) < 5, `centroid x ${c.x} should sit near the seam`);
  assert.ok(Math.abs(c.y - 10) < 5);
});

test('spreadOf is zero for a coincident group', () => {
  assert.equal(spreadOf([5, 5], [5, 5], 5, 5), 0);
});

test('polarization separates aligned from isotropic headings', () => {
  const aligned = polarizationOf([1, 1, 1, 1], [0, 0, 0, 0]);
  assert.ok(aligned > 0.99, `aligned pol ${aligned}`);
  const opposed = polarizationOf([1, -1], [0, 0]);
  assert.ok(opposed < 0.05, `opposed pol ${opposed}`);
  const stopped = polarizationOf([0, 0], [0, 0]);
  assert.equal(stopped, 0);
});

test('rotationalOrderOf separates a mill from a translating flock', () => {
  // four agents on a circle, each moving tangentially: a mill
  const r = 10;
  const xs = [r, 0, -r, 0];
  const ys = [0, r, 0, -r];
  const vxs = [0, -1, 0, 1];
  const vys = [1, 0, -1, 0];
  const mill = rotationalOrderOf(xs, ys, vxs, vys, 0, 0);
  assert.ok(mill > 0.5, `mill rotational order ${mill}`);
  // same circle, but everyone translating the same way: a flock, not a mill
  const flock = rotationalOrderOf(xs, ys, [1, 1, 1, 1], [0, 0, 0, 0], 0, 0);
  assert.ok(flock < 0.3, `flock rotational order ${flock}`);
});

test('rotationalOrderOf ignores the world origin when a group translates', () => {
  const xs = [1105, 1080, 1100, 1085];
  const ys = [1030, 1020, 1040, 1010];
  const vxs = [1, 1, 1, 1];
  const vys = [0, 0, 0, 0];
  const c = torusCentroid(xs, ys);
  const aboutOwn = rotationalOrderOf(xs, ys, vxs, vys, c.x, c.y);
  assert.ok(aboutOwn < 0.3, `a translating group must not read as a mill, got ${aboutOwn}`);
});

test('density endpoints default to the study pair, and an override scales the other one', () => {
  // --arena/--spawn used to be accepted by the CLI and then silently discarded,
  // because runCausalStudy hardcoded both endpoints. These lock the contract in.
  assert.deepEqual(resolveDensityEndpoints(), { dense: DENSE_ARM, sparse: SPARSE_ARM });
  assert.deepEqual(resolveDensityEndpoints({}), { dense: DENSE_ARM, sparse: SPARSE_ARM });

  const scaled = resolveDensityEndpoints({ arena: 180, spawn: 48 });
  assert.equal(scaled.dense.arena, 180);
  assert.equal(scaled.dense.spawn, 48);
  // preserves the default pair's own ratios rather than holding density fixed
  assert.equal(scaled.sparse.arena, 180 * (SPARSE_ARM.arena / DENSE_ARM.arena));
  assert.equal(scaled.sparse.spawn, 48 * (SPARSE_ARM.spawn / DENSE_ARM.spawn));
  // the point of the contrast: the two endpoints must not collapse onto each other
  assert.ok(scaled.sparse.arena > scaled.dense.arena);
  assert.notDeepEqual(scaled.sparse, scaled.dense);
});

test('a partial density override is ignored rather than half-applied', () => {
  // only one of arena/spawn given would silently move one endpoint and not the
  // other, which is worse than not honouring it at all
  assert.deepEqual(resolveDensityEndpoints({ arena: 180 }), { dense: DENSE_ARM, sparse: SPARSE_ARM });
  assert.deepEqual(resolveDensityEndpoints({ spawn: 48 }), { dense: DENSE_ARM, sparse: SPARSE_ARM });
});

test('robust sufficient sets are anchored to a target that can differ by density', () => {
  // The bug this pins: `robustSufficientSparse` used to report arms reaching the full
  // set's *modal* class, which at low density is `cohesive`. So the low-density list
  // named `alignment+circulation` - an arm that is a coherent mass on all 5 seeds -
  // while the high-density list named arms that flock. Two adjacent tables, answering
  // different questions. The target-independent flocking list is the comparable one.
  const rep = replicateStudy(causalWorldFactory, DENSE, SPARSE, [101, 202, 303, 404, 505]);
  assert.equal(rep.targetDense, 'flocking');
  assert.equal(rep.targetSparse, 'cohesive');

  // the sufficient lists are self-consistent with their own targets
  const td = rep.dense.filter((r) => r.key && rep.robustSufficientDense.includes(r.key));
  const ts = rep.sparse.filter((r) => r.key && rep.robustSufficientSparse.includes(r.key));
  for (const r of td) assert.equal(r.modal, rep.targetDense, `${r.key} must match the dense target`);
  for (const r of ts) assert.equal(r.modal, rep.targetSparse, `${r.key} must match the sparse target`);

  // the flocking lists mean the same thing at both densities and are what the
  // report leads with
  for (const k of rep.robustFlockingDense) {
    const r = rep.dense.find((x) => x.key === k)!;
    assert.ok(r.counts.flocking === 5, `${k} flocks on only ${r.counts.flocking}/5 dense seeds`);
  }
  for (const k of rep.robustFlockingSparse) {
    const r = rep.sparse.find((x) => x.key === k)!;
    assert.ok(r.counts.flocking === 5, `${k} flocks on only ${r.counts.flocking}/5 sparse seeds`);
  }
  // the cross-density claim the report leads on
  assert.deepEqual(rep.robustFlockingDense.filter((k) => rep.robustFlockingSparse.includes(k)), [
    'cohesion+separation+circulation',
  ]);
});

test('the mill threshold is a named constant the report can quote', () => {
  // the mill boundary was described in prose as marginal when it is actually a
  // narrow but perfectly consistent cut; sharing the literal prevents that drift
  assert.equal(MILL_ROTATION_THRESHOLD, thresholdsFor(FAST, 36).millRotationalOrder);
});

test('meanAndCv reports heterogeneity', () => {
  const flat = meanAndCv([5, 5, 5, 5]);
  assert.equal(flat.mean, 5);
  assert.equal(flat.cv, 0);
  const varied = meanAndCv([1, 3, 5, 7]);
  assert.equal(varied.mean, 4);
  assert.ok(varied.cv > 0.5);
  assert.deepEqual(meanAndCv([]), { mean: 0, cv: 0 });
});

test('collectiveStateOf returns zeros for an empty population', () => {
  const s = collectiveStateOf([], [], [], [], [], [], 0);
  assert.equal(s.alive, 0);
  assert.equal(s.movers, 0);
  assert.equal(s.polarization, 0);
  assert.equal(s.spread, 0);
});

/* ---------------- the separation-radius anomaly ---------------- */

test('separation radius is 9x smaller than the sense radius in feedGenome agents', () => {
  const g = feedGenome({ diet: -1 });
  const sense = decodeSenseRadius(g);
  const sep = separationRadius(g);
  assert.equal(sep, 4, 'gene 6 pinned to -1 gives body size 0.5, so 8 * 0.5 = 4');
  assert.ok(sense > 8 * sep, `sense ${sense} should vastly exceed separation ${sep}`);
  assert.ok(senseToSeparationRatio(g) >= 8);
});

/* ---------------- behaviour classification ---------------- */

const T = thresholdsFor(FAST, 36);

function classify(over: Partial<Parameters<typeof classifyBehaviour>[0]>, arena = FAST.arena) {
  return classifyBehaviour(
    {
      movers: 40,
      alive: 40,
      polarization: 0.9,
      rotationalOrder: 0.0,
      spread: arena,
      neighbourMean: 6,
      densityCv: 0.3,
      nearestNeighbour: 20,
      nearestNeighbourCv: 0.4,
      ...over,
    },
    arena,
    T,
  );
}

test('a stopped population is inert regardless of geometry', () => {
  assert.equal(classify({ movers: 0, polarization: 0 }), 'inert');
  assert.equal(classify({ alive: 0, movers: 0 }), 'inert');
});

test('a group that has spread past the arena is dispersed', () => {
  assert.equal(classify({ spread: FAST.arena * 2.5 }), 'dispersed');
});

test('a group packed inside the separation radius is a clot, not a flock', () => {
  // cohesion alone at high density: perfect heading agreement, agents overlapping
  assert.equal(classify({ polarization: 1.0, nearestNeighbour: 1.6, nearestNeighbourCv: 2.3 }), 'clumped');
  assert.equal(T.separationRadius, 4);
});

test('a near-perfectly polarized collapsed clot cannot be called a flock', () => {
  // the specific false positive a naive polarization test would have produced
  assert.notEqual(classify({ polarization: 0.99, nearestNeighbour: 1.5, nearestNeighbourCv: 0.5 }), 'flocking');
});

test('an evenly spaced bounded translating group is a flock', () => {
  assert.equal(classify({ polarization: 0.9, nearestNeighbour: 6, nearestNeighbourCv: 0.5, spread: FAST.arena * 0.5 }), 'flocking');
});

test('a ragged bounded group is merely cohesive, not a flock', () => {
  assert.equal(classify({ nearestNeighbour: 13, nearestNeighbourCv: 5.1 }), 'cohesive');
});

test('a rotating group is a mill, not a flock', () => {
  assert.equal(classify({ rotationalOrder: 0.6, nearestNeighbour: 6, nearestNeighbourCv: 0.5 }), 'milling');
});

/* ---------------- arm execution ---------------- */

test('the all-off arm is inert: no drive means no motion', () => {
  const r = runArm([], FAST, causalWorldFactory);
  assert.equal(r.behaviour, 'inert');
  assert.equal(r.settled.movers, 0);
  assert.ok(r.drift < 1e-3, `drift should be nil, got ${r.drift}`);
  assert.equal(r.alive, FAST.spawn, 'nobody starves under the high-food control');
});

test('separation alone is inert: from rest it has nothing to push against', () => {
  const r = runArm(['separation'], FAST, causalWorldFactory);
  assert.equal(r.behaviour, 'inert');
  assert.equal(r.settled.movers, 0);
});

test('every arm replays identically', () => {
  for (const set of [['alignment'], ['cohesion'], ['alignment', 'cohesion', 'separation']] as ComponentSet[]) {
    const r = runArm(set, FAST, causalWorldFactory);
    assert.ok(r.deterministic, `arm ${r.key} failed to replay`);
  }
});

test('alignment cannot bootstrap from rest, and a seeded heading revives it', () => {
  const rest = runArm(['alignment'], { ...FAST, seedSpeed: 0 }, causalWorldFactory);
  assert.equal(rest.settled.movers, 0, 'with every agent stationary the neighbour velocity sum is zero');
  assert.equal(rest.settled.polarization, 0);

  const seeded = runArm(['alignment'], FAST, causalWorldFactory);
  assert.ok(seeded.settled.movers > 0, 'a seeded heading gives alignment something to align to');
  assert.ok(seeded.settled.polarization > 0.2);
});

test('a polarization-only test would not distinguish these two arms', () => {
  // documents the reason the classifier does not lean on polarization
  const coh = runArm(['cohesion'], FAST, causalWorldFactory);
  const circ = runArm(['circulation'], FAST, causalWorldFactory);
  assert.ok(coh.settled.polarization > 0.9 && circ.settled.polarization > 0.9);
  assert.notEqual(coh.behaviour, circ.behaviour, 'but their geometry differs sharply');
});

test('the tick budget is a third axis of fragility, next to the seed and the density', () => {
  // Locks in a result that was found by accident. An earlier version of this study
  // was made faster by halving the run length to 200 ticks, which was supposed to be
  // free because the trajectories are flat early. It was not free: `cohesion` alone
  // at low density reads as a flock at 200 ticks and as a clot at 400, because the
  // measurement window is still drifting at 200. The study therefore fixes 400 ticks
  // and reports convergenceError beside every label.
  // Five seeds, because this is a statement about a modal class and three seeds
  // can tie. The distinction matters: the flip is a change in the *distribution*
  // over seeds, not a single run that happens to read differently.
  const short = replicateArm(['cohesion'], { ...SPARSE, ticks: 200 }, causalWorldFactory, REPLICATION_SEEDS);
  const long = replicateArm(['cohesion'], { ...SPARSE, ticks: 400 }, causalWorldFactory, REPLICATION_SEEDS);
  assert.equal(short.modal, 'flocking');
  assert.equal(long.modal, 'clumped');
  assert.ok(
    long.counts.flocking === 0,
    `the 400-tick window must not be a flock on any seed, got ${JSON.stringify(long.counts)}`,
  );
});

test('a longer run does not make the window stationary, because the arms are not fixed points', () => {
  // The honest reading of convergenceError: it does not decay with run length,
  // because dispersed arms keep expanding and swirling arms keep rotating. Both
  // are legitimate behaviour classes, so this is reported rather than gated on.
  const dense = { ...DEFAULT_ARM, arena: 90, spawn: 24 };
  const errAt = (ticks: number) => runArm(['alignment'], { ...dense, ticks }, causalWorldFactory, { doubleRun: false }).convergenceError;
  assert.ok(errAt(600) > errAt(200), `expected non-decaying divergence, got ${errAt(200).toFixed(3)} then ${errAt(600).toFixed(3)}`);
});

test('polarization is saturated while the geometry separates the same two arms', () => {
  // cohesion and circulation both read ~0.99 polarized, yet their spacing geometry
  // differs sharply. A polarization-based flock test cannot tell them apart, which
  // is why the classifier rests on spread and neighbour CV. The behavioural labels
  // are deliberately not asserted here: they are seed-dependent, which is exactly
  // what the replication section of the report records.
  const coh = runArm(['cohesion'], DEFAULT_ARM, causalWorldFactory);
  const circ = runArm(['circulation'], DEFAULT_ARM, causalWorldFactory);
  assert.ok(Math.abs(coh.settled.polarization - circ.settled.polarization) < 0.05, 'polarization is saturated');
  assert.ok(
    Math.abs(coh.settled.nearestNeighbourCv - circ.settled.nearestNeighbourCv) > 0.4,
    `neighbour regularity should separate them, gap ${Math.abs(coh.settled.nearestNeighbourCv - circ.settled.nearestNeighbourCv)}`,
  );
});

test('the triad does not flock until density brings spacing inside the separation radius', () => {
  const sparse = runArm(['alignment', 'cohesion', 'separation'], SPARSE, causalWorldFactory);
  const dense = runArm(['alignment', 'cohesion', 'separation'], DENSE, causalWorldFactory);

  const sep = separationRadius(feedGenome({ diet: -1 }));
  // at low density the group is far outside separation's 4-unit reach
  assert.ok(sparse.settled.nearestNeighbour > sep * 2, `sparse nn ${sparse.settled.nearestNeighbour} should exceed ${sep * 2}`);
  assert.equal(sparse.behaviour, 'cohesive');
  assert.ok(sparse.settled.nearestNeighbourCv > 1, 'a ragged mass is not a lattice');

  // at the study density spacing lands just outside separation, spacing evens out
  assert.ok(dense.settled.nearestNeighbour > sep, `dense nn ${dense.settled.nearestNeighbour} should clear ${sep}`);
  assert.ok(dense.settled.nearestNeighbour <= sep * 2);
  assert.ok(dense.settled.nearestNeighbourCv < 1, 'an even lattice is the signature of separation working');
  assert.equal(dense.behaviour, 'flocking');
});

test('the triad hypothesis is density-dependent, and fails at low density', () => {
  // at the study density all three together do flock
  assert.equal(runArm(['alignment', 'cohesion', 'separation'], DENSE, causalWorldFactory).behaviour, 'flocking');
  // at low density the same triad does NOT flock: cohesion collapses the spacing
  // regularity that separation had established, so the group reverts to a mass
  assert.equal(runArm(['alignment', 'cohesion', 'separation'], SPARSE, causalWorldFactory).behaviour, 'cohesive');
});

test('cohesion is what breaks the triad, and circulation replaces it', () => {
  // at low density circulation alone flocks, and the triad does not
  assert.equal(runArm(['circulation'], SPARSE, causalWorldFactory).behaviour, 'flocking');
  const sepOnly = runArm(['alignment', 'separation'], SPARSE, causalWorldFactory);
  const withCoh = runArm(['alignment', 'cohesion', 'separation'], SPARSE, causalWorldFactory);
  assert.notEqual(sepOnly.behaviour, withCoh.behaviour, 'adding cohesion changes the outcome');
  // cohesion raises neighbour variability, i.e. destroys lattice regularity
  assert.ok(
    withCoh.settled.nearestNeighbourCv > sepOnly.settled.nearestNeighbourCv,
    `cohesion should roughen spacing: ${withCoh.settled.nearestNeighbourCv} vs ${sepOnly.settled.nearestNeighbourCv}`,
  );
  // so cohesion is a necessary component of the full set but not of flocking
  assert.ok(withCoh.settled.nearestNeighbourCv > 1, 'a flock needs even spacing');
});

test('alignment plus cohesion is synergistic: the pair collapses tighter than either alone', () => {
  // asserted as geometry rather than as a class label, because the class is
  // seed-dependent while the mechanism is not: the pair drives spacing below the
  // separation radius, which neither term reaches on its own
  const sep = separationRadius(feedGenome({ diet: -1 }));
  const a = runArm(['alignment'], DENSE, causalWorldFactory);
  const c = runArm(['cohesion'], DENSE, causalWorldFactory);
  const both = runArm(['alignment', 'cohesion'], DENSE, causalWorldFactory);
  assert.ok(
    both.settled.nearestNeighbour < a.settled.nearestNeighbour,
    `the pair must be tighter than alignment alone: ${both.settled.nearestNeighbour} vs ${a.settled.nearestNeighbour}`,
  );
  assert.ok(
    both.settled.nearestNeighbour < sep,
    `the pair should collapse inside the separation radius, got ${both.settled.nearestNeighbour}`,
  );
  assert.ok(c.settled.nearestNeighbour >= sep, 'cohesion alone should not reach a clot');
});

test('separation cannot rescue cohesion without a heading source', () => {
  // cohesion with separation collapses into a clot instead of a lattice
  const withBoth = runArm(['cohesion', 'separation'], DENSE, causalWorldFactory);
  assert.ok(withBoth.settled.nearestNeighbour > separationRadius(feedGenome({ diet: -1 })));
  const cohAlone = runArm(['cohesion'], DENSE, causalWorldFactory);
  assert.ok(
    cohAlone.settled.nearestNeighbour < withBoth.settled.nearestNeighbour,
    'separation must increase spacing relative to cohesion alone',
  );
});

test('alignment plus cohesion is synergistic: a clot no single term produces', () => {
  const a = runArm(['alignment'], DENSE, causalWorldFactory);
  const c = runArm(['cohesion'], DENSE, causalWorldFactory);
  const both = runArm(['alignment', 'cohesion'], DENSE, causalWorldFactory);
  const reachable = new Set([a.behaviour, c.behaviour]);
  assert.ok(!reachable.has(both.behaviour), `both=${both.behaviour} must be unreachable from ${[...reachable].join(',')}`);
  assert.equal(both.behaviour, 'clumped');
});

test('an arm is a pure function of its component set', () => {
  const a = runArm(['cohesion', 'separation'], FAST, causalWorldFactory);
  const b = runArm(['separation', 'cohesion'], FAST, causalWorldFactory);
  assert.equal(a.key, b.key, 'set order must not change the arm identity');
  assert.deepEqual(a.settled, b.settled);
});

/* ---------------- seed replication ---------------- */

const SEEDS = [101, 202, 303];

/** the study's own seed set, for tests that assert a modal class */
const REPLICATION_SEEDS = [101, 202, 303, 404, 505];

test('replicateArm reports a modal class and flags seed dependence', () => {
  const rep = replicateArm(['alignment', 'cohesion', 'separation'], DENSE, causalWorldFactory, SEEDS);
  assert.equal(rep.key, 'alignment+cohesion+separation');
  assert.equal(rep.results.length, SEEDS.length);
  const total = Object.values(rep.counts).reduce((a, b) => a + b, 0);
  assert.equal(total, SEEDS.length, 'every seed must be classified');
  assert.equal(rep.modalFraction, rep.counts[rep.modal] / SEEDS.length);
  assert.equal(rep.stable, rep.counts[rep.modal] === SEEDS.length);
});

test('replication does not change a single run, only adds seeds', () => {
  const one = runArm(['cohesion', 'separation'], { ...DENSE, rngSeed: SEEDS[0]! }, causalWorldFactory);
  const rep = replicateArm(['cohesion', 'separation'], DENSE, causalWorldFactory, [SEEDS[0]!]);
  assert.equal(rep.results.length, 1);
  assert.deepEqual(rep.results[0]!.settled, one.settled);
});

test('the two dead-end components are inert on every seed', () => {
  for (const set of [[], ['separation']] as ComponentSet[]) {
    const rep = replicateArm(set, DENSE, causalWorldFactory, SEEDS);
    assert.ok(rep.stable, `${rep.key} should be stable, got ${JSON.stringify(rep.counts)}`);
    assert.equal(rep.modal, 'inert');
  }
});

test('cohesion alone never flocks on any seed at any density', () => {
  for (const cfg of [DENSE, SPARSE]) {
    const rep = replicateArm(['cohesion'], cfg, causalWorldFactory, SEEDS);
    assert.equal(rep.counts.flocking, 0, `cohesion flocked at arena ${cfg.arena}: ${JSON.stringify(rep.counts)}`);
  }
});

test('cohesion and separation together flock robustly at high density', () => {
  const rep = replicateArm(['cohesion', 'separation'], DENSE, causalWorldFactory, SEEDS);
  assert.equal(rep.modal, 'flocking');
  assert.ok(rep.modalFraction >= 2 / 3, `agreement ${rep.modalFraction} too weak to call robust`);
});

const rep = (r: { counts: Record<string, number> }) => JSON.stringify(r.counts);

test('no single component is a robust flock, but two independent pairs of routes are', () => {
  // Of the four single components, only circulation ever flocks, and cohesion and
  // separation never do. The flock is over-determined: a rotating swirl
  // (circulation) and a bounded even lattice (cohesion+separation) each reach it,
  // so neither pair is necessary and the triad is not minimal.
  // asserted across the study's full seed set rather than three seeds, because a
  // three-seed read of `cohesion` lands on a tie between cohesive and clumped
  const solo = enumerateArms().filter((s) => s.length === 1);
  for (const set of solo) {
    const dense = replicateArm(set, DENSE, causalWorldFactory, REPLICATION_SEEDS);
    const sparse = replicateArm(set, SPARSE, causalWorldFactory, REPLICATION_SEEDS);
    if (set[0] === 'cohesion' || set[0] === 'separation') {
      assert.equal(dense.counts.flocking, 0, `${rep(dense)} should never flock at high density`);
      assert.equal(sparse.counts.flocking, 0, `${rep(sparse)} should never flock at low density`);
    }
  }
  const swirl = replicateArm(['circulation'], DENSE, causalWorldFactory, SEEDS);
  const lattice = replicateArm(['cohesion', 'separation'], DENSE, causalWorldFactory, SEEDS);
  assert.ok(swirl.counts.flocking > 0, 'a swirl is one route to a flock');
  assert.ok(lattice.counts.flocking > 0, 'a bounded even lattice is the other route');
  assert.ok(!swirl.set.includes('separation'), 'the swirl route uses no separation');
  assert.ok(!lattice.set.includes('circulation'), 'the lattice route uses no circulation');
});

test('the triad flocks robustly at high density but is not minimal', () => {
  const triad = replicateArm(['alignment', 'cohesion', 'separation'], DENSE, causalWorldFactory, SEEDS);
  assert.equal(triad.modal, 'flocking');
  assert.ok(triad.stable, `triad agreement ${triad.modalFraction} is not robust`);
  // a strict subset reaches the same outcome, so the triad is sufficient but not minimal
  const subset = replicateArm(['cohesion', 'separation'], DENSE, causalWorldFactory, SEEDS);
  assert.ok(subset.counts.flocking > 0, 'a proper subset already flocks, so the triad is not minimal');
});

test('the density sweep is reported per seed, not per draw', () => {
  const rows = densitySweep(causalWorldFactory, { ...DENSE, ticks: 120 }, SEEDS);
  assert.equal(rows.length, 7);
  for (const r of rows) {
    assert.ok(r.triadAgreement >= 1 / SEEDS.length && r.triadAgreement <= 1);
    assert.ok(r.triadFlockingFraction >= 0 && r.triadFlockingFraction <= 1);
    assert.equal(r.separationRadius, 4);
    assert.ok(r.spacingInSeparationRadii > 0);
  }
  // spacing regularity must track the ratio to the separation radius
  const far = rows.filter((r) => r.spacingInSeparationRadii > 2);
  const near = rows.filter((r) => r.spacingInSeparationRadii <= 2);
  assert.ok(far.length > 0 && near.length > 0, 'sweep must span both regimes');
  const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;
  assert.ok(
    mean(near.map((r) => r.meanNearestNeighbourCv)) < mean(far.map((r) => r.meanNearestNeighbourCv)),
    'spacing regularity should improve as spacing approaches the separation radius',
  );
});

/* ---------------- threshold sensitivity ---------------- */

test('a threshold probe is a no-op at factor 1 and reports its own edges', () => {
  // sitting just above the default mill cut, so raising it by 25% takes the run out
  const runs = [
    { density: 'high', arena: 90, settled: state({ rotationalOrder: 0.26, polarization: 0.2 }), behaviour: 'milling' as const },
    { density: 'high', arena: 90, settled: state({ rotationalOrder: 0.05, spread: 200 }), behaviour: 'dispersed' as const },
  ];
  const [probe] = thresholdSensitivity(runs, thresholdsFor(DENSE, 36, 4));
  assert.ok(probe);
  const atNominal = probe.factors.indexOf(1);
  assert.equal(probe.changedFraction[atNominal], 0, 'the nominal factor must relabel nothing');
  assert.deepEqual(probe.perFactor[atNominal], runs.map((r) => r.behaviour));
  const mill = probe.transitions.find((t) => t.pair.startsWith('milling'));
  assert.ok(mill, `expected a milling edge, got ${JSON.stringify(probe.transitions)}`);
  assert.equal(mill.pair, 'milling->cohesive', 'raising the cut should demote the mill, not promote it');
  assert.ok(mill.at > 0, 'the edge is recorded at a perturbed factor, never at 1');
});

test('threshold sweep covers every classifier cut, and polarization is the least load-bearing', () => {
  const runs = sampleRuns();
  const probes = thresholdSensitivity(runs, thresholdsFor(DENSE, 36, 4));
  const labels = probes.map((p) => p.threshold).sort();
  assert.deepEqual(labels, [
    'cohesiveSpreadFrac',
    'dispersedSpreadFrac',
    'flockPolarization',
    'latticeNeighbourCv',
    'millRotationalOrder',
  ]);
  for (const p of probes) {
    assert.equal(p.perFactor.length, p.factors.length);
    for (const row of p.perFactor) assert.equal(row.length, runs.length);
    // labelsEntered is only ever a class some run was moved *into*, so it can never
    // contain a label that no run ever left its nominal class for
    for (const label of p.labelsEntered) {
      assert.ok(
        p.transitions.some((t) => t.pair.endsWith(`->${label}`)),
        `${p.label} admits ${label} but no transition leads to it`,
      );
    }
    assert.ok(p.labelsEntered.length <= 6);
    const entered = new Set(
      p.perFactor.flatMap((row) => row.filter((c, j) => c !== runs[j]!.behaviour)),
    );
    assert.deepEqual([...entered].sort(), p.labelsEntered, `${p.label} labelsEntered must be the moved-into set`);
  }
  const polarization = probes.find((p) => p.threshold === 'flockPolarization')!;
  const worst = Math.max(...probes.map((p) => Math.max(...p.changedFraction)));
  assert.ok(
    Math.max(...polarization.changedFraction) <= worst,
    'the polarization floor should not be the most exposed cut in the sweep',
  );
});

test('every relabel the sweep reports is reproducible from the stored run states', () => {
  // Recomputing the sweep by hand must land on exactly the same classes, counts and
  // transitions. A report table that cannot be recomputed from the stored states is
  // not checkable, and an uncheckable robustness table is decoration.
  const runs = sampleRuns();
  const t = thresholdsFor(DENSE, 36, 4);
  for (const probe of thresholdSensitivity(runs, t)) {
    // transitions are aggregated across all factors, so they are checked against the
    // union of every factor's moves rather than against any single factor
    const allMoves: string[] = [];
    probe.perFactor.forEach((row, i) => {
      const moved: string[] = [];
      for (const [j, got] of row.entries()) {
        const want = classifyBehaviour(runs[j]!.settled, runs[j]!.arena, {
          ...t,
          [probe.threshold]: probe.nominal * probe.factors[i]!,
        });
        assert.equal(got, want, `${probe.label} factor ${probe.factors[i]} run ${j}`);
        if (got !== runs[j]!.behaviour) moved.push(`${runs[j]!.behaviour}->${got}`);
      }
      assert.equal(
        moved.length / runs.length,
        probe.changedFraction[i]!,
        `${probe.label} factor ${probe.factors[i]} changedFraction`,
      );
      allMoves.push(...moved);
    });
    const observed = new Map<string, number>();
    for (const m of allMoves) observed.set(m, (observed.get(m) ?? 0) + 1);
    assert.equal(
      probe.transitions.length,
      observed.size,
      `${probe.label} transition table does not match the observed moves`,
    );
    for (const [pair, count] of observed) {
      const row = probe.transitions.find((x) => x.pair === pair);
      assert.ok(row, `${probe.label} is missing observed transition ${pair}`);
      assert.equal(row.count, count, `${probe.label} miscounted ${pair}`);
    }
    const atNominal = probe.factors.indexOf(1);
    for (const x of probe.transitions) {
      assert.ok(x.at !== atNominal, `${probe.label} transition ${x.pair} attributed to the nominal factor`);
    }
  }
});

/* ---------------- second genome background ---------------- */

test('the declared variant background actually moves the geometry it claims to move', () => {
  const base = feedGenome({ diet: -1 });
  const variant = backgroundGenome('double-size');
  assert.notDeepEqual([...variant], [...base], 'the variant must differ from feedGenome');
  const defaultSep = separationRadius(buildArmGenome([], base));
  const variantSep = separationRadius(buildArmGenome([], variant));
  assert.equal(defaultSep, 4);
  assert.equal(variantSep, 8, 'gene 6 = -0.5 must decode to a doubled separation radius');
  assert.equal(decodeSenseRadius(buildArmGenome([], variant)), decodeSenseRadius(buildArmGenome([], base)));
  for (const b of GENOME_BACKGROUNDS) {
    const g = buildArmGenome([], backgroundGenome(b.name));
    assert.ok(separationRadius(g) >= 4, `${b.name} must decode to a real separation radius`);
    assert.equal(decodeSenseRadius(g), 36, `${b.name} must not touch the sense radius`);
    assert.ok(b.rationale.length > 0, `${b.name} must state what it is for`);
  }
  // and the variant must be a genuine geometry change, not just a different label
  assert.notEqual(variantSep, defaultSep);
});

test('the arms with no drive pathway stay inert on a different genome', () => {
  // The one prediction a background change cannot break: an arm whose drives are all
  // off has no pathway, so it cannot start behaving differently just because the
  // founder genome is bigger.
  const variant = backgroundGenome('double-size');
  for (const set of [[], ['separation']] as ComponentSet[]) {
    for (const cfg of [DENSE, SPARSE]) {
      const rep = replicateArm(set, cfg, causalWorldFactory, REPLICATION_SEEDS, { base: variant });
      assert.equal(rep.modal, 'inert', `${setKey(set)} should stay inert on the variant background`);
      assert.ok(rep.stable, `${setKey(set)} should not become seed-dependent on the variant`);
    }
  }
});

test('robust flocking is preserved across backgrounds, and the variant is not a subset copy', () => {
  // Guards against the failure mode where a "second background" accidentally reruns the
  // default. If the variant lists were literally the default lists, this would pass
  // while proving nothing, so both directions are asserted.
  const variant = backgroundGenome('double-size');
  for (const key of ['cohesion+separation', 'cohesion+separation+circulation'] as const) {
    const set = parseSetKey(key);
    const base = replicateArm(set, DENSE, causalWorldFactory, REPLICATION_SEEDS);
    const alt = replicateArm(set, DENSE, causalWorldFactory, REPLICATION_SEEDS, { base: variant });
    assert.ok(base.counts.flocking > 0, `${key} flocks on the default background`);
    assert.ok(alt.counts.flocking > 0, `${key} flocks on the variant background too`);
  }
  // A genuinely different geometry must not reproduce every label exactly. Asserted on
  // agreement counts rather than modal classes: doubling the separation radius can
  // preserve a modal class while changing how many seeds agree on it, and the agreement
  // is the sharper signal that the geometry actually entered the dynamics.
  const shifted = enumerateArms().filter(
    (set) =>
      replicateArm(set, DENSE, causalWorldFactory, SEEDS, { base: variant }).modalFraction !==
      replicateArm(set, DENSE, causalWorldFactory, SEEDS).modalFraction,
  );
  assert.ok(
    shifted.length > 0,
    'the variant background changed no agreement at all, so it is not exercising a different geometry',
  );
});

test('replicateOnBackground returns both densities with the variant geometry applied', () => {
  const variant = backgroundGenome('double-size');
  const rows = replicateOnBackground(causalWorldFactory, FAST, FAST, variant, SEEDS);
  assert.equal(rows.dense.length, 16);
  assert.equal(rows.sparse.length, 16);
  const inert = rows.dense.find((r) => r.key === 'none')!;
  assert.equal(inert.modal, 'inert', 'no drives means inert regardless of body size');
  // both densities must come back under the same arm keys, or the pairing is broken
  assert.deepEqual(
    rows.dense.map((r) => r.key),
    rows.sparse.map((r) => r.key),
  );
});

/* ---------------- helpers ---------------- */

/** a synthetic CollectiveState with only the fields a given test cares about overridden */
function state(o: Partial<CollectiveState>): CollectiveState {
  return {
    alive: 24,
    movers: 24,
    polarization: 0.5,
    rotationalOrder: 0.1,
    spread: 20,
    neighbourMean: 6,
    densityCv: 0.5,
    nearestNeighbour: 8,
    nearestNeighbourCv: 0.5,
    meanSpeed: 1,
    ...o,
  };
}

/** a mixed set of settled states, enough for the sweep to move several cuts */
function sampleRuns(): { density: string; arena: number; settled: CollectiveState; behaviour: BehaviourClass }[] {
  const raw: { density: string; arena: number; settled: CollectiveState }[] = [
    // high rotational order, low polarization: a mill at the default cut
    { density: 'high', arena: 90, settled: state({ rotationalOrder: 0.9, polarization: 0.2, spread: 5, densityCv: 0.3 }) },
    // high polarization, even spacing: a flock
    { density: 'high', arena: 90, settled: state({ rotationalOrder: 0.1, polarization: 0.95, spread: 20, nearestNeighbourCv: 0.5 }) },
    // low density and a patchy lattice: cohesive or clumped
    { density: 'low', arena: 140, settled: state({ rotationalOrder: 0.4, polarization: 0.3, spread: 60, densityCv: 1.8, nearestNeighbour: 20 }) },
    // spread far past the arena: dispersed
    { density: 'low', arena: 140, settled: state({ rotationalOrder: 0.2, polarization: 0.5, spread: 30, densityCv: 1.2 }) },
  ];
  const t = thresholdsFor(DENSE, 36, 4);
  return raw.map((r) => ({ ...r, behaviour: classifyBehaviour(r.settled, r.arena, t) }));
}
