import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_PARAMS, GENOME_SIZE, encodeStats, decodeStats, type WorldConfig } from '@fractal-life/shared';
import { Engine } from '../src/engine.js';
import { SplitMix64 } from '../src/rng.js';
import { decodeStrategies, decodePhenotype, decodeDrives } from '../src/genome.js';

function makeWorld(seed: string, spawnCount = 40, overrides: Partial<typeof DEFAULT_PARAMS> = {}): WorldConfig {
  return {
    id: `gt-${seed}`,
    seed,
    fractalType: 'mandelbrot',
    params: { ...DEFAULT_PARAMS, spawnCount, ...overrides },
    createdAt: 0,
    currentTick: 0,
  };
}

describe('Strategy gene decoding', () => {
  it('decodes all four strategy genes from the genome', () => {
    const g = new Float32Array(GENOME_SIZE);
    g[116] = 0.8;   // aggression
    g[117] = -0.4;  // cooperation
    g[118] = 0.2;   // risk
    g[119] = -0.6;  // deception
    const s = decodeStrategies(g);
    assert.ok(s.aggression >= 0 && s.aggression <= 1, `aggression ${s.aggression} out of range`);
    assert.ok(s.cooperation >= 0 && s.cooperation <= 1, `cooperation ${s.cooperation} out of range`);
    assert.ok(s.risk >= 0 && s.risk <= 1, `risk ${s.risk} out of range`);
    assert.ok(s.deception >= 0 && s.deception <= 1, `deception ${s.deception} out of range`);
    assert.ok(s.aggression > 0.5, 'high genome[116] should decode to high aggression');
    assert.ok(s.cooperation < 0.5, 'negative genome[117] should decode to low cooperation');
    assert.ok(s.deception < 0.5, 'negative genome[119] should decode to low deception');
  });

  it('agents are created with strategy genes and game theory tracking fields', () => {
    const engine = new Engine(makeWorld('gt-create', 10));
    let checked = 0;
    for (const a of engine.agents.values()) {
      if (!a.alive) continue;
      assert.ok(a.strategy !== undefined, 'agent must have strategy field');
      assert.ok(a.strategy.aggression >= 0 && a.strategy.aggression <= 1);
      assert.ok(a.strategy.cooperation >= 0 && a.strategy.cooperation <= 1);
      assert.ok(a.strategy.risk >= 0 && a.strategy.risk <= 1);
      assert.ok(a.strategy.deception >= 0 && a.strategy.deception <= 1);
      assert.equal(typeof a.totalDonated, 'number');
      assert.equal(typeof a.totalReceived, 'number');
      assert.equal(typeof a.totalHuntDamage, 'number');
      assert.equal(typeof a.timesHunted, 'number');
      checked++;
    }
    assert.ok(checked > 0, 'should have checked at least one alive agent');
  });
});

describe('Game theory stats in SimStats', () => {
  it('SimStats contains all new game theory fields after a tick', () => {
    const engine = new Engine(makeWorld('gt-stats', 30));
    const s = engine.tick().stats;
    assert.equal(typeof s.meanAggression, 'number');
    assert.equal(typeof s.meanCooperation, 'number');
    assert.equal(typeof s.meanRisk, 'number');
    assert.equal(typeof s.meanDeception, 'number');
    assert.equal(typeof s.predatorGeneFraction, 'number');
    assert.equal(typeof s.preyGeneFraction, 'number');
    assert.equal(typeof s.energyInequality, 'number');
    assert.equal(typeof s.donationRatio, 'number');
    assert.ok(s.meanAggression >= 0 && s.meanAggression <= 1, `meanAggression ${s.meanAggression}`);
    assert.ok(s.meanCooperation >= 0 && s.meanCooperation <= 1);
    assert.ok(s.predatorGeneFraction >= 0 && s.predatorGeneFraction <= 1);
    assert.ok(s.preyGeneFraction >= 0 && s.preyGeneFraction <= 1);
    assert.ok(s.energyInequality >= 0 && s.energyInequality <= 1);
  });

  it('determinism: identical seeds produce identical game theory stats', () => {
    const a = new Engine(makeWorld('gt-det', 30));
    const b = new Engine(makeWorld('gt-det', 30));
    for (let i = 0; i < 50; i++) {
      const sa = a.tick().stats;
      const sb = b.tick().stats;
      assert.equal(sa.meanAggression, sb.meanAggression, `meanAggression mismatch at tick ${i}`);
      assert.equal(sa.meanCooperation, sb.meanCooperation, `meanCooperation mismatch at tick ${i}`);
      assert.equal(sa.meanRisk, sb.meanRisk, `meanRisk mismatch at tick ${i}`);
      assert.equal(sa.meanDeception, sb.meanDeception, `meanDeception mismatch at tick ${i}`);
      assert.equal(sa.predatorGeneFraction, sb.predatorGeneFraction, `predatorGeneFraction mismatch at tick ${i}`);
      assert.equal(sa.preyGeneFraction, sb.preyGeneFraction, `preyGeneFraction mismatch at tick ${i}`);
      assert.equal(sa.energyInequality, sb.energyInequality, `energyInequality mismatch at tick ${i}`);
    }
  });
});

describe('Binary protocol roundtrip', () => {
  it('encodeStats/decodeStats preserves game theory fields', () => {
    const engine = new Engine(makeWorld('gt-codec', 20));
    engine.tick();
    const s = engine.tick().stats;
    const bytes = encodeStats(s);
    const d = decodeStats(bytes);
    const approx = (a: number, b: number) => Math.abs(a - b) < 1e-4;
    assert.ok(approx(d.meanAggression, s.meanAggression), `meanAggression ${d.meanAggression} ~= ${s.meanAggression}`);
    assert.ok(approx(d.meanCooperation, s.meanCooperation), `meanCooperation ${d.meanCooperation} ~= ${s.meanCooperation}`);
    assert.ok(approx(d.meanRisk, s.meanRisk), `meanRisk ${d.meanRisk} ~= ${s.meanRisk}`);
    assert.ok(approx(d.meanDeception, s.meanDeception), `meanDeception ${d.meanDeception} ~= ${s.meanDeception}`);
    assert.ok(approx(d.predatorGeneFraction, s.predatorGeneFraction), `predatorGeneFraction ${d.predatorGeneFraction} ~= ${s.predatorGeneFraction}`);
    assert.ok(approx(d.preyGeneFraction, s.preyGeneFraction), `preyGeneFraction ${d.preyGeneFraction} ~= ${s.preyGeneFraction}`);
    assert.ok(approx(d.energyInequality, s.energyInequality), `energyInequality ${d.energyInequality} ~= ${s.energyInequality}`);
    assert.ok(approx(d.donationRatio, s.donationRatio), `donationRatio ${d.donationRatio} ~= ${s.donationRatio}`);
  });

  it('encodeStats/decodeStats round-trips the 13 Phase-E quantum keys', () => {
    const world = makeWorld('gt-quantum', 20);
    (world as unknown as { omics: boolean }).omics = true;
    const engine = new Engine(world);
    engine.tick();
    const s = engine.tick().stats;
    const bytes = encodeStats(s);
    const d = decodeStats(bytes);
    const approx = (a: number, b: number) => Math.abs(a - b) < 1e-4;
    const keys = [
      'decoherenceRate',
      'coherenceLifetime',
      'tunnelingRate',
      'zeroPointEnergy',
      'superpositionEntropy',
      'entanglementEntropy',
      'quantumParallelism',
      'measurementBackaction',
      'collapseRate',
      'quantumDiffusion',
      'tunnelCoupling',
      'coherenceLength',
      'quantumFidelity',
    ] as const;
    for (const k of keys) {
      const orig = s[k] as number;
      const fmt = d[k] as number;
      assert.ok(Number.isFinite(orig), `${k} source is finite (${orig})`);
      assert.ok(approx(fmt, orig), `${k} ${fmt} ~= ${orig}`);
    }
  });

  it('Phase-F couplings (zeroPointEnergy/coherenceLifetime/measurementBackaction) surface in omicsObservables and round-trip the wire', () => {
    const world = makeWorld('gt-phase-f', 20);
    (world as unknown as { omics: boolean }).omics = true;
    const engine = new Engine(world);
    engine.tick();
    const s = engine.tick().stats;
    const bytes = encodeStats(s);
    const d = decodeStats(bytes);
    const approx = (a: number, b: number) => Math.abs(a - b) < 1e-4;
    const couplings = [
      'zeroPointEnergy',
      'coherenceLifetime',
      'measurementBackaction',
    ] as const;
    for (const k of couplings) {
      const orig = s[k] as number;
      const fmt = d[k] as number;
      assert.ok(Number.isFinite(orig), `Phase-F ${k} is live in omicsObservables (${orig})`);
      assert.ok(orig >= 0 && orig <= 1, `Phase-F ${k} in [0,1] (${orig})`);
      assert.ok(approx(fmt, orig), `Phase-F ${k} ${fmt} ~= ${orig}`);
    }
  });

  it('Phase-G subatomic keys surface in omicsObservables and round-trip the wire', () => {
    const world = makeWorld('gt-phase-g', 20);
    (world as unknown as { omics: boolean }).omics = true;
    const engine = new Engine(world);
    engine.tick();
    const s = engine.tick().stats;
    const bytes = encodeStats(s);
    const d = decodeStats(bytes);
    const approx = (a: number, b: number) => Math.abs(a - b) < 1e-4;
    const subatomic = [
      'bosonFieldIntensity',
      'photonTransport',
      'gluonConfinement',
      'strongCoupling',
      'weakBosonMass',
      'higgsMassFloor',
      'leptonMobility',
      'electronChannel',
      'quarkFlavorPopulation',
      'upDownAsymmetry',
      'strangeFlavor',
      'charmPool',
      'protonStability',
    ] as const;
    for (const k of subatomic) {
      const orig = s[k] as number;
      const fmt = d[k] as number;
      assert.ok(Number.isFinite(orig), `Phase-G ${k} is live in omicsObservables (${orig})`);
      assert.ok(orig >= 0 && orig <= 1, `Phase-G ${k} in [0,1] (${orig})`);
      assert.ok(approx(fmt, orig), `Phase-G ${k} ${fmt} ~= ${orig}`);
    }
  });

  it('Phase-H materials keys surface in omicsObservables and round-trip the wire', () => {
    const world = makeWorld('gt-phase-h', 20);
    (world as unknown as { omics: boolean }).omics = true;
    const engine = new Engine(world);
    engine.tick();
    const s = engine.tick().stats;
    const bytes = encodeStats(s);
    const d = decodeStats(bytes);
    const approx = (a: number, b: number) => Math.abs(a - b) < 1e-4;
    const materials = [
      'latticePeriodicity',
      'bandGap',
      'fermiLevel',
      'conductionBand',
      'valenceBand',
      'phononFlux',
      'excitonBinding',
      'defectDensity',
      'dopingLevel',
      'carrierMobility',
      'topologicalInvariant',
      'moireSuperlattice',
      'latticeThermalSusceptibility',
    ] as const;
    for (const k of materials) {
      const orig = s[k] as number;
      const fmt = d[k] as number;
      assert.ok(Number.isFinite(orig), `Phase-H ${k} is live in omicsObservables (${orig})`);
      assert.ok(orig >= 0 && orig <= 1, `Phase-H ${k} in [0,1] (${orig})`);
      assert.ok(approx(fmt, orig), `Phase-H ${k} ${fmt} ~= ${orig}`);
    }
  });

  it('Phase-I statistical-mechanics keys surface in omicsObservables and round-trip the wire', () => {
    const world = makeWorld('gt-phase-i', 20);
    (world as unknown as { omics: boolean }).omics = true;
    const engine = new Engine(world);
    engine.tick();
    const s = engine.tick().stats;
    const bytes = encodeStats(s);
    const d = decodeStats(bytes);
    const approx = (a: number, b: number) => Math.abs(a - b) < 1e-4;
    const statistical = [
      'boltzmannEntropy',
      'shannonDissimilarity',
      'entropyChangeRate',
      'gibbsFreeEnergy',
      'entropyProduction',
      'timeReversalAsymmetry',
      'maxwellDemonPower',
      'demonInformationCost',
      'absoluteZeroProximity',
      'quantumLandauerFloor',
      'heatCapacityAnomaly',
      'kbtDamping',
      'canonicalPartitionZ',
    ] as const;
    for (const k of statistical) {
      const orig = s[k] as number;
      const fmt = d[k] as number;
      assert.ok(Number.isFinite(orig), `Phase-I ${k} is live in omicsObservables (${orig})`);
      assert.ok(orig >= 0 && orig <= 1, `Phase-I ${k} in [0,1] (${orig})`);
      assert.ok(approx(fmt, orig), `Phase-I ${k} ${fmt} ~= ${orig}`);
    }
  });

  it('Phase-J nanosystems keys surface in omicsObservables and round-trip the wire', () => {
    const world = makeWorld('gt-phase-j', 20);
    (world as unknown as { omics: boolean }).omics = true;
    const engine = new Engine(world);
    engine.tick();
    const s = engine.tick().stats;
    const bytes = encodeStats(s);
    const d = decodeStats(bytes);
    const approx = (a: number, b: number) => Math.abs(a - b) < 1e-4;
    const nanosystems = [
      'nanoparticleSurface',
      'nanoparticleDensity',
      'nanoporeTransport',
      'nanoscaleContact',
      'molecularMachineWork',
      'assemblerAccuracy',
      'nanofabricationYield',
      'dnaOrigamiStability',
      'bionanoInterface',
      'nanozymeActivity',
      'colloidalStability',
      'quantumDotBrightness',
      'nanotoxicFlux',
    ] as const;
    for (const k of nanosystems) {
      const orig = s[k] as number;
      const fmt = d[k] as number;
      assert.ok(Number.isFinite(orig), `Phase-J ${k} is live in omicsObservables (${orig})`);
      assert.ok(orig >= 0 && orig <= 1, `Phase-J ${k} in [0,1] (${orig})`);
      assert.ok(approx(fmt, orig), `Phase-J ${k} ${fmt} ~= ${orig}`);
    }
  });

  it('Phase-K phylogeny keys surface in omicsObservables and round-trip the wire', () => {
    const world = makeWorld('gt-phase-k', 20);
    (world as unknown as { omics: boolean }).omics = true;
    const engine = new Engine(world);
    engine.tick();
    const s = engine.tick().stats;
    const bytes = encodeStats(s);
    const d = decodeStats(bytes);
    const approx = (a: number, b: number) => Math.abs(a - b) < 1e-4;
    const phylogeny = [
      'viralLoad',
      'bacterialLoad',
      'archaealDensity',
      'fungalBiomass',
      'protistMotility',
      'moneraPrimordial',
      'plantPhotosynthesis',
      'poriferanChannel',
      'chordateNeuralTube',
      'piscesAquaticMetabolism',
      'mammalThermoregulation',
      'primateCognition',
      'symbioticIndex',
    ] as const;
    for (const k of phylogeny) {
      const orig = s[k] as number;
      const fmt = d[k] as number;
      assert.ok(Number.isFinite(orig), `Phase-K ${k} is live in omicsObservables (${orig})`);
      assert.ok(orig >= 0 && orig <= 1, `Phase-K ${k} in [0,1] (${orig})`);
      assert.ok(approx(fmt, orig), `Phase-K ${k} ${fmt} ~= ${orig}`);
    }
  });

  it('Phase-L physiology keys surface in omicsObservables and round-trip the wire', () => {
    const world = makeWorld('gt-phase-l', 20);
    (world as unknown as { omics: boolean }).omics = true;
    const engine = new Engine(world);
    engine.tick();
    const s = engine.tick().stats;
    const bytes = encodeStats(s);
    const d = decodeStats(bytes);
    const approx = (a: number, b: number) => Math.abs(a - b) < 1e-4;
    const physiology = [
      'metabolicRate',
      'cardiovascularPump',
      'respirationEfficiency',
      'digestiveThroughput',
      'excretoryClearance',
      'immuneSurveillance',
      'neuralConductance',
      'musculoskeletalOutput',
      'endocrineSignaling',
      'thermoregulationControl',
      'fluidHomeostasis',
      'sensoryPerception',
      'growthReplication',
    ] as const;
    for (const k of physiology) {
      const orig = s[k] as number;
      const fmt = d[k] as number;
      assert.ok(Number.isFinite(orig), `Phase-L ${k} is live in omicsObservables (${orig})`);
      assert.ok(orig >= 0 && orig <= 1, `Phase-L ${k} in [0,1] (${orig})`);
      assert.ok(approx(fmt, orig), `Phase-L ${k} ${fmt} ~= ${orig}`);
    }
  });
});
