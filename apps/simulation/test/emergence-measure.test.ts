import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  speciesLmc,
  quantize,
  contingencyMI,
  nmi,
  aggregationOrder,
  sorensenOverlap,
  lagAutocorr,
  entropyOfMap,
  measureEmergence,
  verdictFor,
  simpsonDiversity,
  entropyToPolarization,
  lempelZivComplexity,
  normalizedLz,
  moranI,
  contagionIndex,
  fillFactor,
  radialCorrelationLength,
  compressibilityRatio,
  macroRigidity,
  macroStatePersistence,
  sustainedPeak,
  sustainedSeries,
  classifyMacroRegime,
  detectMacroStates,
  sustainedReference,
  type MacroFrame,
} from '../src/research/emergence.js';
import { TIER_DEFS, buildArchetypeWorld, BASELINE_OVERRIDES } from '../src/research/archetypes.js';

// ---------------------------------------------------------------------------
// Pure measurement math — synthetic inputs only (deterministic, no engine)
// ---------------------------------------------------------------------------

test('speciesLmc: uniform = 0, single category = 0, peaked > 0, empty = 0', () => {
  assert.equal(speciesLmc([5, 5]), 0); // eq ⇒ disequilibrium 0
  assert.equal(speciesLmc([7]), 0); // n < 2 ⇒ degenerate
  assert.equal(speciesLmc([]), 0);
  assert.equal(speciesLmc([0, 0]), 0);
  const peaked = speciesLmc([8, 1, 1]);
  assert.ok(peaked > 0, `peaked LMC should be > 0, got ${peaked}`);
  assert.ok(speciesLmc([8, 1, 1]) > speciesLmc([10, 5, 5]), 'more skewed ⇒ higher LMC');
  // hand-checked LMC([8,1,1]): h≈0.9219, diseq≈0.3267 ⇒ ≈0.3012
  assert.ok(Math.abs(peaked - 0.3012) < 1e-3, `peaked was ${peaked}`);
});

test('quantize: equal-width binning with clamping and flat-range guard', () => {
  assert.equal(quantize(0, 0, 10, 5), 0);
  assert.equal(quantize(10, 0, 10, 5), 4); // clamp top edge into last bin
  assert.equal(quantize(5, 0, 10, 5), 2);
  assert.equal(quantize(2.4, 0, 10, 5), 1);
  assert.equal(quantize(999, 0, 10, 5), 4);
  assert.equal(quantize(-5, 0, 10, 5), 0);
  assert.equal(quantize(3, 7, 7, 5), 0); // flat range ⇒ bin 0
});

test('contingencyMI: perfect association = 1 bit, independent = 0, empty = 0', () => {
  assert.ok(Math.abs(contingencyMI([[10, 0], [0, 10]]) - 1) < 1e-9, 'deterministic 2×2 should give exactly 1 bit');
  assert.equal(contingencyMI([[5, 5], [5, 5]]), 0); // independent
  assert.equal(contingencyMI([]), 0);
  assert.equal(contingencyMI([[0, 0], [0, 0]]), 0);
  assert.ok(contingencyMI([[3, 0, 0], [0, 3, 0], [0, 0, 3]]) > 1, '3-state perfect association → log2(3) bits');
});

test('nmi: normalised to [0,1] with zero-guards', () => {
  assert.equal(nmi(0.5, 0), 0);
  assert.equal(nmi(0, 2), 0);
  assert.ok(Math.abs(nmi(1, 2) - 0.5) < 1e-9);
  assert.ok(nmi(2, 2) <= 1);
});

test('aggregationOrder: max entropy uniform = 0, concentrated = 1', () => {
  assert.equal(aggregationOrder([1, 1, 1, 1], 4), 0);
  assert.equal(aggregationOrder([4, 0, 0, 0], 4), 1);
  const half = aggregationOrder([2, 2, 0, 0], 4); // entropy 1 / max 2 ⇒ 0.5
  assert.ok(Math.abs(half - 0.5) < 1e-9, `half was ${half}`);
  assert.equal(aggregationOrder([1, 1], 1), 0);
});

test('sorensenOverlap: identical = 1, disjoint = 0, half-shared = ~0.5', () => {
  assert.equal(sorensenOverlap(new Set([1, 2, 3]), new Set([1, 2, 3])), 1);
  assert.equal(sorensenOverlap(new Set([1, 2]), new Set([3, 4])), 0);
  const half = sorensenOverlap(new Set([1, 2, 3, 4]), new Set([3, 4, 5, 6]));
  assert.ok(Math.abs(half - 0.5) < 1e-9, `half was ${half}`);
  assert.equal(sorensenOverlap(new Set(), new Set()), 1); // both empty = trivially stable
  assert.equal(sorensenOverlap(new Set([1]), new Set()), 0);
});

test('lagAutocorr: monotone ramp ≈ +1, random-walk positive, short series = 0', () => {
  const ramp = Array.from({ length: 200 }, (_, i) => i);
  assert.ok(lagAutocorr(ramp, 8) > 0.95, `ramp autocorr was ${lagAutocorr(ramp, 8)}`);
  const warm = lagAutocorr([1, 2, 3], 8);
  assert.equal(warm, 0); // too short
  // slow smooth drift ⇒ strong positive autocorrelation at short lags
  let acc = 0;
  const drift = Array.from({ length: 200 }, (_, i) => {
    acc += Math.cos(i / 6);
    return acc;
  });
  assert.ok(lagAutocorr(drift, 4) > 0.5, `drift autocorr was ${lagAutocorr(drift, 4)}`);
  // perfect lag-1 anti-correlation: alternating series cancels across 4 lags ⇒ ≈0
  const alt = Array.from({ length: 200 }, (_, i) => (i % 2 === 0 ? 0 : 1));
  assert.ok(Math.abs(lagAutocorr(alt, 4)) < 0.1, `alternating autocorr should be ≈0, got ${lagAutocorr(alt, 4)}`);
});

test('entropyOfMap: counts over categorical keys', () => {
  assert.equal(entropyOfMap(new Map([[1, 1], [2, 1]])), 1);
  assert.equal(entropyOfMap(new Map([[1, 3]])), 0);
  assert.equal(entropyOfMap(new Map([[1, 0], [2, 0]])), 0);
});

test('verdictFor: thresholds map to ABSENT/PARTIAL/EMERGENT', () => {
  assert.equal(verdictFor(0.1), 'ABSENT');
  assert.equal(verdictFor(0.3), 'PARTIAL');
  assert.equal(verdictFor(0.5), 'EMERGENT');
});

// ---------------------------------------------------------------------------
// Harness smoke — one T0 world, tiny ticks
// ---------------------------------------------------------------------------

test('measureEmergence: deterministic double-pass, sane ranges, trace length', () => {
  const tier = TIER_DEFS[0]!;
  const world = buildArchetypeWorld('emerg.smoke', 12, tier, {
    energyCapacity: 150,
    foodRegenRate: BASELINE_OVERRIDES.foodRegenRate,
  });
  const a = measureEmergence(world, tier.idx, 90);
  const b = measureEmergence(world, tier.idx, 90);

  assert.equal(a.deterministic, true, 'two passes of the same world must agree on the macro state sequence');
  assert.equal(a.emergenceIndex, b.emergenceIndex, 'measurement is reproducible');
  assert.ok(a.emergenceIndex >= 0 && a.emergenceIndex <= 1.0001, `index out of range: ${a.emergenceIndex}`);
  for (const k of ['microInfo', 'macroInfo', 'complexity', 'selfOrganization', 'temporalPersistence'] as const) {
    assert.ok(a.axes[k].raw >= 0, `${k} raw < 0`);
    assert.ok(a.axes[k].norm >= 0 && a.axes[k].norm <= 1.0001, `${k} norm out of range: ${a.axes[k].norm}`);
  }
  assert.equal(a.trace.length, 90);
  assert.ok(a.trace.every((p) => p.tick >= 0 && p.microInfo >= 0));
  assert.ok(['ABSENT', 'PARTIAL', 'EMERGENT'].includes(a.verdict));
  // emergent information should be a normalised MI in [0,1]
  assert.ok(a.emergentInformation.sync >= 0 && a.emergentInformation.sync <= 1.0001);
  assert.ok(a.emergentInformation.predictive >= 0 && a.emergentInformation.predictive <= 1.0001);
  // fingerprint + trace identical across independent re-measurements
  assert.equal(a.fingerprint, b.fingerprint);
  assert.deepEqual(a.trace, b.trace);
  // Phase-2 metrics block: every axis group present and within sane bounds
  const m = a.metrics;
  assert.ok(m, 'metrics block present');
  assert.ok(m.orderPolarization.order >= 0 && m.orderPolarization.order <= 1.0001);
  assert.ok(m.orderPolarization.speciesPolarization >= 0 && m.orderPolarization.traitPolarization >= 0);
  assert.ok(m.orderPolarization.value >= 0 && m.orderPolarization.value <= 1.0001);
  assert.ok(m.spatialClustering.moranI >= -1 && m.spatialClustering.moranI <= 1);
  assert.ok(m.spatialClustering.aggregationIndex >= 0 && m.spatialClustering.aggregationIndex <= 1.0001);
  assert.ok(m.spatialClustering.fillFactor >= 0 && m.spatialClustering.fillFactor <= 1.0001);
  assert.ok(m.spatialClustering.correlationLength >= 0);
  assert.ok(m.diversity.shannonDiversity >= 0 && m.diversity.simpsonDiversity >= 0);
  assert.ok(m.diversity.evenness >= 0 && m.diversity.evenness <= 1.0001);
  assert.ok(m.diversity.traitEntropy >= 0 && m.diversity.spatialEntropy >= 0);
  assert.ok(m.information.compositionBits >= 0 && m.information.spatialBits >= 0 && m.information.culturalBits >= 0);
  assert.ok(m.information.stateBits >= 0 && m.information.totalBits >= 0);
  assert.ok(m.complexity.entropy > 0);
  assert.ok(m.complexity.compressibility >= 0 && m.complexity.compressibility <= 1.0001);
  assert.ok(m.complexity.lzComplexity >= 0 && m.complexity.lzComplexityNormalized <= 1.0001);
  assert.ok(m.complexity.correlationLength >= 0);
  assert.ok(m.complexity.temporalComplexity >= 0 && m.complexity.temporalComplexity <= 1.0001);
  assert.ok(m.complexity.meanAutocorr >= -1 && m.complexity.meanAutocorr <= 1);
  assert.equal(m.complexity.temporalComplexity, b.metrics!.complexity.temporalComplexity, 'complexity reproducible');
});

// ---------------------------------------------------------------------------
// Engine parity — our LMC equals stats().complexity for the same species counts
// ---------------------------------------------------------------------------

test('speciesLmc reproduces the engine LMC formula (entropy × disequilibrium)', () => {
  const counts = [3, 7, 1, 4, 2, 9, 1];
  const tot = counts.reduce((a, b) => a + b, 0);
  const n = counts.filter((c) => c > 0).length;
  let h = 0;
  let diseq = 0;
  const invN = 1 / n;
  for (const c of counts) {
    const p = c / tot;
    h -= p * Math.log2(p);
    diseq += (p - invN) ** 2;
  }
  assert.ok(Math.abs(speciesLmc(counts) - h * diseq) < 1e-12, 'formula parity');
});

// ---------------------------------------------------------------------------
// Phase-2 metric axes — pure lattice math (deterministic, no engine)
// ---------------------------------------------------------------------------

test('simpsonDiversity: uniform(4) = 0.75, skewed lower, single category = 0, empty = 0', () => {
  assert.equal(simpsonDiversity([4, 4, 4, 4]), 1 - 4 * 0.0625); // uniform(4) = 0.75
  assert.ok(Math.abs(simpsonDiversity([9, 1]) - 0.18) < 1e-12, String([9, 1]) + ' biased');
  assert.equal(simpsonDiversity([7]), 0); // single category ⇒ one dominant ⇒ 0
  assert.equal(simpsonDiversity([]), 0);
  assert.equal(simpsonDiversity([0, 0, 0]), 0);
});

test('entropyToPolarization: uniform = 0, single-peaked = 1, degenerate safe', () => {
  assert.equal(entropyToPolarization(2, 3), 1 - 2 / 3); // ~0.3333 (clamped)
  assert.equal(entropyToPolarization(0, 3), 1); // zero entropy ⇒ fully polarised
  assert.equal(entropyToPolarization(0, 0), 0); // degenerate range
  const mid = entropyToPolarization(1, 3);
  assert.ok(mid > 0.2 && mid < 0.8, `mid polarisation was ${mid}`);
});



test('moranI: clustered block > 0, checkerboard < 0, uniform = 0', () => {
  // 4×4 top-half block: all rows 0..1 = 1, rows 2..3 = 0
  const block: number[] = [];
  for (let i = 0; i < 16; i++) block.push(i < 8 ? 1 : 0);
  assert.equal(moranI(block, 4), moranI(block, 4)); // parity double-call is deterministic
  assert.ok(moranI(block, 4) > 0, `block Moran was ${moranI(block, 4)}`);

  // checkerboard 4×4
  const check: number[] = [];
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) check.push((r + c) % 2);
  assert.ok(moranI(check, 4) < 0, `checker Moran was ${moranI(check, 4)}`);

  assert.equal(moranI(Array(16).fill(1), 4), 0); // zero variance ⇒ 0
  assert.equal(moranI([], 4), 0);
});

test('contagionIndex: full = 1, checkerboard = 0, okay bounds', () => {
  assert.equal(contagionIndex(Array(16).fill(1), 4), 1);
  const check: number[] = [];
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) check.push((r + c) % 2);
  assert.equal(contagionIndex(check, 4), 0);
  const half: number[] = [];
  for (let i = 0; i < 16; i++) half.push(i < 8 ? 1 : 0);
  const ci = contagionIndex(half, 4);
  assert.ok(ci > 0 && ci < 1, `half-block contagion was ${ci}`);
});

test('fillFactor: all = 1, half = 0.5, empty/zero safe', () => {
  assert.equal(fillFactor(Array(16).fill(1)), 1);
  const half: number[] = [];
  for (let i = 0; i < 16; i++) half.push(i < 8 ? 1 : 0);
  assert.equal(fillFactor(half), 0.5);
  assert.equal(fillFactor(Array(16).fill(0)), 0);
  assert.equal(fillFactor([]), 0);
});

// ---------------------------------------------------------------------------
// Macro-state detector — synthetic population frames (deterministic, no engine)
// ---------------------------------------------------------------------------

/** build n frames, overriding fields per tick */
function frames(n: number, over: (i: number) => Partial<MacroFrame> = () => ({})): MacroFrame[] {
  const out: MacroFrame[] = [];
  for (let i = 0; i < n; i++) {
    out.push({
      aliveFrac: 0.8,
      speciesFrac: 20,
      energyFrac: 50,
      cooperation: 0.2,
      memeEntropy: 1,
      occOrder: 0.1,
      coarseFine: 0.1,
      ...over(i),
    });
  }
  return out;
}

/** constant state sequence of length n */
function states(n: number, v = 0): number[] {
  return Array(n).fill(v);
}

test('macroRigidity: one state = 1, all distinct = top quarter share', () => {
  assert.equal(macroRigidity([3, 3, 3, 3]), 1);
  assert.equal(macroRigidity([]), 0);
  // 8 distinct states, one tick each: only the top quarter (2 of 8) counts
  assert.equal(macroRigidity([0, 1, 2, 3, 4, 5, 6, 7]), 0.25);
});

test('macroStatePersistence: constant = 1, alternating = 0, single tick = 0', () => {
  assert.equal(macroStatePersistence([2, 2, 2, 2]), 1);
  assert.equal(macroStatePersistence([0, 1, 0, 1]), 0);
  assert.equal(macroStatePersistence([5]), 0);
  // lag-1 pairs: (1,1) same, (1,2) differs, (2,2) same
  assert.ok(Math.abs(macroStatePersistence([1, 1, 2, 2]) - 2 / 3) < 1e-12);
  assert.equal(macroStatePersistence([]), 0);
});

test('sustainedPeak: a one-tick spawn burst is not the sustained level', () => {
  // 100 ticks: everything spawned at tick 0, then a flat 20% population
  const sp = [1, ...Array(99).fill(0.2)];
  const peak = sustainedPeak(sp);
  assert.ok(peak < 0.3, `spawn burst leaked into the sustained peak: ${peak}`);
  assert.ok(Math.abs(sustainedPeak(Array(100).fill(0.5)) - 0.5) < 1e-12);
  assert.equal(sustainedPeak([]), 0);
});

test('sustainedSeries: trailing mean, partial window at the start', () => {  const s = sustainedSeries([1, ...Array(19).fill(0.2)], 0.1);
  assert.equal(s.length, 20);
  // the first sample averages only one tick, so it still reflects the burst
  assert.ok(s[0]! > 0.9);
  // by the end the window is entirely post-burst
  assert.ok(Math.abs(s[19]! - 0.2) < 1e-12);
  assert.deepEqual(sustainedSeries([], 0.1), []);
});

test('classifyMacroRegime: stage order, rigidity gate, collapse overrides', () => {
  assert.equal(classifyMacroRegime(0, 0, false), 'random');
  assert.equal(classifyMacroRegime(0.31, 0, false), 'clustered');
  assert.equal(classifyMacroRegime(0.5, 0, false), 'organized');
  // specialized needs both spatial structure and temporal rigidity
  assert.equal(classifyMacroRegime(0.9, 0.2, false), 'organized');
  assert.equal(classifyMacroRegime(0.9, 0.9, false), 'specialized');
  // collapse outranks every structural stage
  assert.equal(classifyMacroRegime(0.9, 0.9, true), 'collapsed');
  assert.equal(classifyMacroRegime(0, 0, true), 'collapsed');
});

test('sustainedReference: robust to both a spawn head start and a dead tail', () => {
  assert.equal(sustainedReference([]), 0);
  assert.equal(sustainedReference(Array(100).fill(0.5)), 0.5);
  // 60 high ticks then 140 low ones: the 75th percentile is still the high level
  const decaying = [...Array(60).fill(0.8), ...Array(140).fill(0.1)];
  assert.equal(sustainedReference(decaying), 0.8);
  // a median would have been fooled by the dead tail
  assert.equal(sustainedReference(decaying, 0.5), 0.1);
  // and a spawn head start cannot become the reference either
  assert.equal(sustainedReference([1, ...Array(199).fill(0.2)]), 0.2);
});

test('detectMacroStates: empty run is all zeros and keeps the agent order', () => {
  const m = detectMacroStates([], [], 0.42);
  assert.equal(m.sequence.length, 0);
  assert.equal(m.dominant, 'random');
  assert.equal(m.organization, 0);
  assert.equal(m.firstCollapseTick, -1);
  assert.equal(m.agentOrder, 0.42);
  assert.equal(m.divergence, 0.42);
});

test('detectMacroStates: a flat unstructured run stays random', () => {
  const m = detectMacroStates(frames(100), states(100), 0.3);
  assert.equal(m.dominant, 'random');
  assert.equal(m.final, 'random');
  assert.deepEqual(m.progression, ['random']);
  assert.equal(m.firstCollapseTick, -1);
  assert.equal(m.fractions.random, 1);
});

test('detectMacroStates: rising structure walks random -> clustered -> organized -> specialized', () => {
  // 40 ticks per stage; spatial = 0.5*occOrder + 0.5*coarseFine
  const occ = [0.1, 0.36, 0.5, 0.9];
  const f = frames(160, (i) => {
    const o = occ[Math.floor(i / 40)]!;
    return { occOrder: o, coarseFine: o };
  });
  // one repeated macro state, so rigidity clears the specialized gate
  const m = detectMacroStates(f, states(160, 4), 0.3);
  assert.deepEqual(m.progression, ['random', 'clustered', 'organized', 'specialized']);
  assert.equal(m.final, 'specialized');
  assert.equal(m.dominant, 'specialized');
  assert.equal(m.fractions.specialized, 0.25);
  assert.ok(m.rigidity >= 0.6);
  assert.equal(m.firstCollapseTick, -1);
});

test('detectMacroStates: progression lists distinct stages, not repeated oscillation', () => {
  // structure hovering on the clustered threshold, 200 ticks
  const f = frames(200, (i) => {
    const o = i % 40 < 20 ? 0.2 : 0.36;
    return { occOrder: o, coarseFine: o };
  });
  const m = detectMacroStates(f, states(200, 1), 0.3);
  assert.deepEqual(m.progression, ['random', 'clustered']);
  // the oscillation is still visible in the honest per-tick record
  assert.ok(m.transitions >= 4, `expected real oscillation, got ${m.transitions}`);
  assert.equal(m.sequence.length, 200);
  assert.ok(m.fractions.random > 0 && m.fractions.clustered > 0);
});

test('detectMacroStates: macroOrder is population order and divergence contrasts the levels', () => {
  const f = frames(50, () => ({ occOrder: 0.4, coarseFine: 0.4 }));
  const m = detectMacroStates(f, states(50, 2), 0.25);
  assert.ok(Math.abs(m.macroOrder - 0.4) < 1e-12);
  assert.equal(m.agentOrder, 0.25);
  assert.ok(Math.abs(m.divergence - Math.abs(m.macroOrder - m.agentOrder)) < 1e-12);
  assert.ok(Math.abs(m.divergence - 0.15) < 1e-12);
});

test('detectMacroStates: organization is the mean of its four components', () => {
  const m = detectMacroStates(frames(80), states(80, 3), 0.3);
  const expected = (m.spatialStructure + m.coordination + m.rigidity + m.persistence) / 4;
  assert.ok(Math.abs(m.organization - expected) < 1e-12);
  for (const v of [m.spatialStructure, m.coordination, m.rigidity, m.persistence]) {
    assert.ok(v >= 0 && v <= 1, `component out of [0,1]: ${v}`);
  }
});

test('detectMacroStates: a settled low-energy population is not reported as collapsed', () => {
  // flat population, but energy and species start high then sit at half: the
  // spawn transient must not be mistaken for a normal level
  const f = frames(200, (i) => ({
    aliveFrac: 0.5,
    speciesFrac: i < 20 ? 100 : 50,
    energyFrac: i < 20 ? 100 : 50,
  }));
  const m = detectMacroStates(f, states(200, 0), 0.3);
  assert.equal(m.firstCollapseTick, -1, 'settling to half of a spawn burst is not collapse');
  assert.notEqual(m.final, 'collapsed');
});

test('detectMacroStates: a terminal population collapse is detected', () => {
  // healthy for 80 ticks, then the population dies out for the remaining 120
  const f = frames(200, (i) => ({ aliveFrac: i < 80 ? 0.8 : 0.05 }));
  const m = detectMacroStates(f, states(200, 0), 0.3);
  assert.ok(m.firstCollapseTick > 70, `collapse detected too early: ${m.firstCollapseTick}`);
  assert.ok(m.firstCollapseTick < 120, `collapse detected too late: ${m.firstCollapseTick}`);
  assert.equal(m.final, 'collapsed');
  assert.equal(m.dominant, 'collapsed');
  assert.ok(m.vitality < 0.6, `expected low vitality, got ${m.vitality}`);
  // the dead tail must not become the run's own reference level
  assert.ok(Math.abs(m.referenceAliveFrac - 0.8) < 1e-12);
});

test('detectMacroStates: collapse is not absorbing — a recovered run reports recovery', () => {
  // collapse around tick 60, then recover to a full population
  const f = frames(200, (i) => ({ aliveFrac: i < 50 ? 0.8 : i < 80 ? 0.02 : 0.8 }));
  const m = detectMacroStates(f, states(200, 0), 0.3);
  assert.ok(m.firstCollapseTick > 0, 'the dip should be detected');
  assert.notEqual(m.final, 'collapsed', 'a recovered population must not stay collapsed');
  assert.ok(m.fractions.collapsed > 0, 'the dip itself should still be reported');
});

test('detectMacroStates: deterministic across repeated calls', () => {
  const f = frames(120, (i) => {
    const o = 0.1 + (i / 120) * 0.6;
    return { occOrder: o, coarseFine: o, aliveFrac: 0.6 - i * 0.002 };
  });
  const s = states(120, 7);
  assert.equal(JSON.stringify(detectMacroStates(f, s, 0.33)), JSON.stringify(detectMacroStates(f, s, 0.33)));
});

test('detectMacroStates: macro level and agent level stay independent inputs', () => {
  // identical population, different agent-level order: only agentOrder/divergence move
  const f = frames(60, () => ({ occOrder: 0.3, coarseFine: 0.3 }));
  const s = states(60, 1);
  const a = detectMacroStates(f, s, 0.1);
  const b = detectMacroStates(f, s, 0.9);
  assert.equal(a.sequence.join(), b.sequence.join());
  assert.equal(a.dominant, b.dominant);
  assert.equal(a.organization, b.organization);
  assert.equal(a.agentOrder, 0.1);
  assert.equal(b.agentOrder, 0.9);
  assert.ok(b.divergence > a.divergence);
});
