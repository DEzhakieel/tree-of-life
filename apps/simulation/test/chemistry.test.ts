import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createAgentChemistry,
  createChemTerrain,
  tickAgentChemistry,
  tickChemTerrain,
  normaliseChemistry,
} from '../src/chemistry.js';
import {
  ELEMENT_COUNT,
  MOLECULE_COUNT,
  ION_COUNT,
  ENZYME_TYPE_COUNT,
  CHEM_MAX_ELEMENT,
  CHEM_MAX_MOLECULE,
  CHEM_MAX_ION,
  CHEM_MAX_ENZYME,
  PH_NEUTRAL,
  TERRAIN_GRID,
} from '@fractal-life/shared';
import { Engine } from '../src/engine.js';
import { fnv1a32 } from '@fractal-life/shared';

const defaultGenome = new Float32Array(128).fill(0.5);

describe('createAgentChemistry', () => {
  it('returns correctly-sized arrays', () => {
    const c = createAgentChemistry(defaultGenome, 42);
    assert.equal(c.elements.length, ELEMENT_COUNT);
    assert.equal(c.molecules.length, MOLECULE_COUNT);
    assert.equal(c.ions.length, ION_COUNT);
    assert.equal(c.enzymes.length, ENZYME_TYPE_COUNT);
  });

  it('all concentrations are in valid range', () => {
    const c = createAgentChemistry(defaultGenome, 100);
    for (let i = 0; i < ELEMENT_COUNT; i++) {
      assert.ok(c.elements[i]! >= 0 && c.elements[i]! <= CHEM_MAX_ELEMENT, `element[${i}]=${c.elements[i]}`);
    }
    for (let i = 0; i < MOLECULE_COUNT; i++) {
      assert.ok(c.molecules[i]! >= 0 && c.molecules[i]! <= CHEM_MAX_MOLECULE, `molecule[${i}]=${c.molecules[i]}`);
    }
    for (let i = 0; i < ION_COUNT; i++) {
      assert.ok(c.ions[i]! >= 0 && c.ions[i]! <= CHEM_MAX_ION, `ion[${i}]=${c.ions[i]}`);
    }
    for (let i = 0; i < ENZYME_TYPE_COUNT; i++) {
      assert.ok(c.enzymes[i]! >= 0 && c.enzymes[i]! <= CHEM_MAX_ENZYME, `enzyme[${i}]=${c.enzymes[i]}`);
    }
    assert.ok(c.pH > 3 && c.pH < 11, `pH=${c.pH}`);
  });

  it('different seeds produce different chemistry', () => {
    const a = createAgentChemistry(defaultGenome, 1);
    const b = createAgentChemistry(defaultGenome, 2);
    let different = false;
    for (let i = 0; i < ELEMENT_COUNT; i++) {
      if (a.elements[i] !== b.elements[i]) { different = true; break; }
    }
    assert.ok(different, 'different seeds should produce different element concentrations');
  });

  it('genome variation affects initial chemistry', () => {
    const highCarb = new Float32Array(128).fill(0.5);
    highCarb[120] = 1.0; // max carb preference
    const lowCarb = new Float32Array(128).fill(0.5);
    lowCarb[120] = 0.0; // min carb preference
    const hc = createAgentChemistry(highCarb, 42);
    const lc = createAgentChemistry(lowCarb, 42);
    assert.ok(hc.elements[0]! > lc.elements[0]!, 'high carb gene should produce more C');
  });
});

describe('createChemTerrain', () => {
  it('creates grids of correct size', () => {
    const t = createChemTerrain(16);
    assert.equal(t.size, 16);
    assert.equal(t.O2.length, 16 * 16);
    assert.equal(t.pH.length, 16 * 16);
    assert.equal(t.toxin.length, 16 * 16);
    assert.equal(t.minerals.length, 16 * 16);
  });

  it('initial O2 is positive, pH is neutral', () => {
    const t = createChemTerrain(8);
    for (let i = 0; i < 64; i++) {
      assert.ok(t.O2[i]! > 0, `O2[${i}]=${t.O2[i]}`);
      assert.equal(t.pH[i], PH_NEUTRAL);
      assert.ok(t.toxin[i] === 0, 'toxin should start at 0');
    }
  });
});

describe('tickAgentChemistry', () => {
  it('returns a finite number', () => {
    const c = createAgentChemistry(defaultGenome, 42);
    const delta = tickAgentChemistry(c, 0.5, 0, 0.3, 0.5, PH_NEUTRAL, 0, 0.15, 0.5, 0.5, 0.5, 0.5, 0.5, 1);
    assert.ok(Number.isFinite(delta), `delta=${delta}`);
  });

  it('food intake increases elements and sugar/glucose', () => {
    const c = createAgentChemistry(defaultGenome, 42);
    const preC = c.elements[0]!;
    const preGlucose = c.molecules[0]!;
    const preSugar = c.molecules[9]!;
    // zero enzymes so oxidase doesn't consume sugar faster than digestion adds it
    c.enzymes.fill(0);
    tickAgentChemistry(c, 1.0, 0, 0.5, 0.5, PH_NEUTRAL, 0, 0.15, 0.5, 0.2, 0.5, 0.5, 0.5, 1);
    assert.ok(c.elements[0]! > preC, 'carbon should increase with food intake');
    assert.ok(c.molecules[0]! > preGlucose, 'glucose should increase with food intake');
    assert.ok(c.molecules[9]! > preSugar, 'sugar should increase with food intake');
  });

  it('meat intake increases amino acids and N/S/Fe', () => {
    const c = createAgentChemistry(defaultGenome, 42);
    const preAA = c.molecules[2]!;
    const preN = c.elements[3]!;
    // zero enzymes so synthesis doesn't consume amino acids
    c.enzymes.fill(0);
    tickAgentChemistry(c, 0, 1.0, 0.5, 0.5, PH_NEUTRAL, 0, 0.15, 0.5, 0.8, 0.5, 0.5, 0.5, 1);
    assert.ok(c.molecules[2]! > preAA, 'amino acids should increase with meat intake');
    assert.ok(c.elements[3]! > preN, 'nitrogen should increase with meat intake');
  });

  it('toxin exposure increases toxin level (reduced by toxGene)', () => {
    const c = createAgentChemistry(defaultGenome, 42);
    const preToxin = c.molecules[7]!;
    tickAgentChemistry(c, 0, 0, 0.5, 0.5, PH_NEUTRAL, 0.8, 0.5, 1, 0.5, 0.1, 0.5, 0.5, 1);
    assert.ok(c.molecules[7]! > preToxin, 'toxin level should increase from environment');
  });

  it('high toxGene reduces toxin absorption', () => {
    const lowTox = createAgentChemistry(defaultGenome, 42);
    const highTox = createAgentChemistry(defaultGenome, 42);
    tickAgentChemistry(lowTox, 0, 0, 0.5, 0.5, PH_NEUTRAL, 0.8, 0.5, 1, 0.5, 0.1, 0.1, 0.5, 1);
    tickAgentChemistry(highTox, 0, 0, 0.5, 0.5, PH_NEUTRAL, 0.8, 0.5, 1, 0.5, 0.1, 0.9, 0.5, 1);
    assert.ok(highTox.molecules[7]! <= lowTox.molecules[7]!, 'high toxGene should reduce toxin absorption');
  });

  it('enzymes decay over time', () => {
    const c = createAgentChemistry(defaultGenome, 42);
    // zero out ATP so enzyme synthesis cannot counteract decay
    c.molecules[1] = 0;
    c.molecules[2] = 0;
    const preEnz = c.enzymes[0]!;
    tickAgentChemistry(c, 0, 0, 0.3, 0.5, PH_NEUTRAL, 0, 0.15, 0.5, 0.5, 0.5, 0.5, 0.5, 10);
    assert.ok(c.enzymes[0]! < preEnz, 'enzymes should decay over 10 ticks');
  });

  it('catalysisGene boosts ATP production via oxidase', () => {
    const lowCat = createAgentChemistry(defaultGenome, 42);
    const highCat = createAgentChemistry(defaultGenome, 42);
    // give both some sugar and O2
    lowCat.molecules[9] = 50;
    highCat.molecules[9] = 50;
    tickAgentChemistry(lowCat, 0, 0, 0.5, 0.8, PH_NEUTRAL, 0, 0.15, 0.5, 0.5, 0.1, 0.5, 0.5, 1);
    tickAgentChemistry(highCat, 0, 0, 0.5, 0.8, PH_NEUTRAL, 0, 0.15, 0.5, 0.5, 0.9, 0.5, 0.5, 1);
    assert.ok(highCat.molecules[1]! >= lowCat.molecules[1]!, 'high catalysis should produce equal or more ATP');
  });

  it('extreme pH reduces reaction rates', () => {
    const neutral = createAgentChemistry(defaultGenome, 42);
    const acidic = createAgentChemistry(defaultGenome, 42);
    neutral.molecules[9] = 30;
    acidic.molecules[9] = 30;
    tickAgentChemistry(neutral, 0, 0, 0.5, 0.8, PH_NEUTRAL, 0, 0.15, 0.5, 0.5, 0.5, 0.5, 0.5, 1);
    tickAgentChemistry(acidic, 0, 0, 0.5, 0.8, 3.0, 0, 0.15, 0.5, 0.5, 0.5, 0.5, 0.5, 1);
    assert.ok(neutral.molecules[1]! >= acidic.molecules[1]!, 'neutral pH should produce equal or more ATP than extreme pH');
  });
});

describe('tickChemTerrain', () => {
  it('O2 increases near plants in daylight', () => {
    const chem = createChemTerrain(8);
    const food = new Float32Array(64).fill(1.0);
    const meat = new Float32Array(64);
    const preO2 = chem.O2[0]!;
    tickChemTerrain(chem, food, meat, 1.0, 0.5, 50);
    assert.ok(chem.O2[0]! > preO2, `O2 should increase with plants and daylight: before=${preO2}, after=${chem.O2[0]}`);
  });

  it('toxins accumulate near meat', () => {
    const chem = createChemTerrain(8);
    const food = new Float32Array(64);
    const meat = new Float32Array(64).fill(0.5);
    tickChemTerrain(chem, food, meat, 0.5, 0.5, 10);
    let hasToxin = false;
    for (let i = 0; i < 64; i++) { if (chem.toxin[i]! > 0) { hasToxin = true; break; } }
    assert.ok(hasToxin, 'toxins should appear near decomposing meat');
  });

  it('minerals slowly weather upward', () => {
    const chem = createChemTerrain(8);
    const food = new Float32Array(64);
    const meat = new Float32Array(64);
    const preMin = chem.minerals[0]!;
    tickChemTerrain(chem, food, meat, 0.5, 0.5, 100);
    assert.ok(chem.minerals[0]! > preMin, 'minerals should increase via weathering');
  });

  it('pH drifts toward neutral over time', () => {
    const chem = createChemTerrain(8);
    chem.pH[0] = 4.0; // acidic
    const food = new Float32Array(64);
    const meat = new Float32Array(64);
    tickChemTerrain(chem, food, meat, 0.5, 0.5, 500);
    assert.ok(chem.pH[0]! > 4.0, `pH should drift toward neutral, got ${chem.pH[0]}`);
  });
});

describe('normaliseChemistry', () => {
  it('returns values in [0,1]', () => {
    const c = createAgentChemistry(defaultGenome, 42);
    const n = normaliseChemistry(c);
    for (let i = 0; i < ELEMENT_COUNT; i++) {
      assert.ok(n.elements[i]! >= 0 && n.elements[i]! <= 1, `normElement[${i}]=${n.elements[i]}`);
    }
    for (let i = 0; i < MOLECULE_COUNT; i++) {
      assert.ok(n.molecules[i]! >= 0 && n.molecules[i]! <= 1, `normMolecule[${i}]=${n.molecules[i]}`);
    }
    assert.ok(n.pH >= 3 && n.pH <= 11);
  });
});

describe('Engine integration', () => {
  it('agents have chemistry after spawn', () => {
    const engine = new Engine({
      id: 'test',
      seed: 'chemistry-test',
      fractalType: 'mandelbrot',
      params: {
        cReal: -0.8, cImag: 0.156, maxIter: 256, escapeRadius: 2 ** 16,
        centerX: -0.6, centerY: 0, worldScale: 4, spawnCount: 10,
        metabolismBase: 1, maxPopulation: 100, foodRegenRate: 0.0003,
        energyCapacity: 100, agentMaxAge: 4000, timeScale: 1,
        dayLength: 2400, seasonLength: 20000,
      },
      createdAt: 0, currentTick: 0,
    });
    let aliveWithChem = 0;
    for (const a of engine.agents.values()) {
      if (a.alive && a.chemistry) aliveWithChem++;
    }
    assert.ok(aliveWithChem > 0, 'spawned agents should have chemistry');
  });

  it('tick does not crash and stats include chemistry fields', () => {
    const engine = new Engine({
      id: 'test',
      seed: 'chem-tick',
      fractalType: 'julia',
      params: {
        cReal: -0.4, cImag: 0.6, maxIter: 128, escapeRadius: 2 ** 16,
        centerX: 0, centerY: 0, worldScale: 4, spawnCount: 20,
        metabolismBase: 1, maxPopulation: 200, foodRegenRate: 0.0003,
        energyCapacity: 100, agentMaxAge: 4000, timeScale: 1,
        dayLength: 2400, seasonLength: 20000,
      },
      createdAt: 0, currentTick: 0,
    });
    for (let i = 0; i < 50; i++) engine.tick();
    const s = engine.stats();
    assert.ok(typeof s.meanATP === 'number', 'stats should have meanATP');
    assert.ok(typeof s.chemicalDiversity === 'number', 'stats should have chemicalDiversity');
    assert.ok(typeof s.terrainOxygen === 'number', 'stats should have terrainOxygen');
    assert.ok(typeof s.terrainPH === 'number', 'stats should have terrainPH');
    assert.ok(typeof s.terrainToxin === 'number', 'stats should have terrainToxin');
    assert.ok(Number.isFinite(s.meanATP));
    assert.ok(Number.isFinite(s.chemicalDiversity));
  });

  it('chemistry tick produces deterministic results', () => {
    const make = () => new Engine({
      id: 'test',
      seed: 'chem-det',
      fractalType: 'mandelbrot',
      params: {
        cReal: -0.8, cImag: 0.156, maxIter: 128, escapeRadius: 2 ** 16,
        centerX: -0.6, centerY: 0, worldScale: 4, spawnCount: 15,
        metabolismBase: 1, maxPopulation: 150, foodRegenRate: 0.0003,
        energyCapacity: 100, agentMaxAge: 4000, timeScale: 1,
        dayLength: 2400, seasonLength: 20000,
      },
      createdAt: 0, currentTick: 0,
    });
    const e1 = make();
    const e2 = make();
    for (let i = 0; i < 100; i++) { e1.tick(); e2.tick(); }
    const s1 = e1.stats();
    const s2 = e2.stats();
    assert.equal(s1.meanATP, s2.meanATP, 'meanATP should be deterministic');
    assert.equal(s1.chemicalDiversity, s2.chemicalDiversity, 'chemicalDiversity should be deterministic');
    assert.equal(s1.terrainOxygen, s2.terrainOxygen, 'terrainOxygen should be deterministic');
    assert.equal(s1.meanEnzyme, s2.meanEnzyme, 'meanEnzyme should be deterministic');
  });
});
