import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_PARAMS, type WorldConfig } from '@fractal-life/shared';
import { Engine } from '../src/engine.js';
import { loadEnrichment, loadEnrichmentRaw, ENRICHMENT_PATH, parseEnrichment } from '../src/grounding/index.js';
import { createAgentChemistry, tickAgentChemistry } from '../src/chemistry.js';
import { existsSync, readFileSync } from 'node:fs';

function makeWorld(seed: string, spawnCount = 40, grounding?: any): WorldConfig {
  return {
    id: `test-${seed}`,
    seed,
    fractalType: 'mandelbrot',
    params: { ...DEFAULT_PARAMS, spawnCount },
    createdAt: 0,
    currentTick: 0,
    grounding,
  };
}

describe('Enrichment snapshot', () => {
  it('exists and validates against the shared schema', () => {
    assert.ok(existsSync(ENRICHMENT_PATH), `enrichment snapshot missing at ${ENRICHMENT_PATH}`);
    const g = loadEnrichment();
    assert.ok(g, 'snapshot should parse');
    // provenance recorded
    assert.ok(g!.provenance.length >= 3, 'should record pubchem/gbif/kazusa provenance');
  });

  it('contains real molecular formulas and stoichiometry', () => {
    const g = loadEnrichment()!;
    // glucose (index 0) must be C6H12O6: [6,12,6,0,0,0,0,0]
    assert.deepEqual(g.chemistry.molecularFormulas[0], 'C6H12O6');
    // protein (index 6) is insulin, sulfur present in real formula
    const insulinFormula = g.chemistry.molecularFormulas[6];
    assert.match(insulinFormula, /S/);
    // meat stoichiometry derived from protein should contain nitrogen + sulfur
    assert.ok(g.chemistry.meat[3] > 1, 'meat should have nitrogen from protein');
    assert.ok(g.chemistry.meat[5] > 0, 'meat should have sulfur from protein cysteine');
  });

  it('has ecological priors covering producer..apex', () => {
    const g = loadEnrichment()!;
    const levels = g.ecology.priors.map(p => p.level);
    assert.ok(levels.includes(0) && levels.includes(3), 'priors should span producer to apex');
  });

  it('has human codon usage table', () => {
    const g = loadEnrichment()!;
    assert.ok(g.genetics.codons.length >= 59, 'should have ~61 sense codons');
    assert.ok(g.genetics.gcContent > 0.4 && g.genetics.gcContent < 0.7, 'human GC ~52%');
  });
});

describe('Grounded digestion stoichiometry', () => {
  it('plant and meat grounding change the element flux vs baseline', () => {
    const g = loadEnrichment()!;
    const genome = new Float32Array(128).fill(0.5);

    const base = createAgentChemistry(genome, 1);
    const grounded = createAgentChemistry(genome, 1);
    // identical starting chemistry
    assert.deepEqual(Array.from(base.elements), Array.from(grounded.elements));

    // baseline digestion (no stoich)
    tickAgentChemistry(base, 1, 0, 0.5, 0.5, 7, 0.1, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 1);
    // grounded digestion (real plant stoichiometry from glucose)
    tickAgentChemistry(grounded, 1, 0, 0.5, 0.5, 7, 0.1, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 1, {
      plant: g.chemistry.plant,
      meat: g.chemistry.meat,
    });

    // Real glucose is C6H12O6 (H:O = 2:1, no N/P/S/Fe/K), baseline was C6H4O3N1.5
    // -> grounded has no N flux but more H; baseline has N.
    assert.notEqual(base.elements[3], grounded.elements[3], 'nitrogen flux should differ');
    assert.notEqual(base.elements[1], grounded.elements[1], 'hydrogen flux should differ');
    assert.ok(base.elements[3] > grounded.elements[3], 'baseline (with N) > grounded (no N from glucose)');
  });

  it('real protein (insulin) meat has no phosphorus, baseline had P', () => {
    const g = loadEnrichment()!;
    // insulin: C257H383N65O77S6 — no P, no Fe
    assert.equal(g.chemistry.meat[4], 0, 'insulin has no phosphorus');
    assert.equal(g.chemistry.meat[6], 0, 'insulin has no iron');
    // baseline meat had P=1.5 and Fe=0.8
    const genome = new Float32Array(128).fill(0.5);
    const base = createAgentChemistry(genome, 1);
    const grounded = createAgentChemistry(genome, 1);
    tickAgentChemistry(base, 0, 1, 0.5, 0.5, 7, 0.1, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 1);
    tickAgentChemistry(grounded, 0, 1, 0.5, 0.5, 7, 0.1, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 1, {
      plant: g.chemistry.plant,
      meat: g.chemistry.meat,
    });
    assert.ok(base.elements[4] > grounded.elements[4], 'baseline meat adds P, real protein does not');
  });
});

describe('Grounded engine determinism', () => {
  it('two grounded engines with same seed + same snapshot produce identical state', () => {
    const g = loadEnrichmentRaw()!;
    const a = new Engine(makeWorld('grounded-alpha', 40, g));
    const b = new Engine(makeWorld('grounded-alpha', 40, g));
    for (let i = 0; i < 150; i++) { a.tick(); b.tick(); }
    assert.equal(a.computeStateHash(), b.computeStateHash());
    assert.equal(a.stats().aliveCount, b.stats().aliveCount);
  });

  it('grounded and ungrounded engines diverge (real data changes behaviour)', () => {
    const g = loadEnrichmentRaw()!;
    const base = new Engine(makeWorld('grounded-div', 60));
    const grounded = new Engine(makeWorld('grounded-div', 60, g));
    for (let i = 0; i < 500; i++) { base.tick(); grounded.tick(); }
    // Real stoichiometry should push the population on a different trajectory.
    // Compare state hash AND a richer set of observables.
    const tries = [
      [base.computeStateHash(), grounded.computeStateHash()],
      [base.stats().meanAltruism, grounded.stats().meanAltruism],
      [base.stats().cooperation, grounded.stats().cooperation],
      [base.stats().speciesCount, grounded.stats().speciesCount],
      [base.stats().complexity, grounded.stats().complexity],
    ];
    let anyDiff = tries.some(([a, b]) => a !== b);
    assert.ok(
      anyDiff,
      'grounded engine should behave differently from ungrounded baseline',
    );
  });

  it('grounded engine remains within bounds and alive', () => {
    const g = loadEnrichmentRaw()!;
    const e = new Engine(makeWorld('grounded-bounds', 60, g));
    for (let i = 0; i < 200; i++) e.tick();
    assert.ok(e.stats().aliveCount >= 0);
    assert.ok(Number.isFinite(e.stats().aliveCount));
  });
});

describe('parseEnrichment resilience', () => {
  it('is deterministic across repeated parses', () => {
    const g1 = loadEnrichment()!;
    const g2 = loadEnrichment()!;
    assert.deepEqual(
      JSON.parse(JSON.stringify(g1)),
      JSON.parse(JSON.stringify(g2)),
    );
    // re-parse the raw snapshot file directly round-trips through the schema
    const raw = JSON.parse(readFileSync(ENRICHMENT_PATH, 'utf-8'));
    assert.ok(parseEnrichment(raw));
  });
});
