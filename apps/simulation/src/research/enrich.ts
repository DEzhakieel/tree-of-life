/**
 * Enrichment CLI — fetches real-world data from open scientific APIs
 * and writes an offline snapshot for deterministic engine grounding.
 *
 * Usage: npm run enrich -w @fractal-life/simulation
 *
 * Sources:
 *   - PubChem PUG REST: molecular formulas/properties
 *   - GBIF species API:  taxonomy + occurrence counts
 *   - Kazusa codon database: human codon usage table
 */

import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EnrichmentSnapshot, type EnrichmentSnapshot as SnapType } from '@fractal-life/shared';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(__dirname, '..', '..', 'data');
const OUT_PATH = resolve(DATA_DIR, 'enrichment.json');

const MOLECULE_SPECS: {
  index: number;
  name: string;
  role: string;
  query: string;
}[] = [
  { index: 0,  name: 'glucose',            role: 'glucose',    query: 'glucose' },
  { index: 1,  name: 'adenosine triphosphate', role: 'atp',   query: 'adenosine triphosphate' },
  { index: 2,  name: 'glycine',            role: 'aminoAcid',  query: 'glycine' },
  { index: 3,  name: 'palmitic acid',      role: 'lipid',      query: 'palmitic acid' },
  { index: 4,  name: 'adenosine monophosphate', role: 'nucleotide', query: 'adenosine monophosphate' },
  // index 5 enzyme — derived from codon usage; not fetched directly
  { index: 6,  name: 'insulin',            role: 'protein',    query: 'insulin human' },
  { index: 7,  name: 'tetrodotoxin',       role: 'toxin',      query: 'tetrodotoxin' },
  { index: 8,  name: 'acetylcholine',      role: 'signal',     query: 'acetylcholine' },
  { index: 9,  name: 'sucrose',            role: 'sugar',      query: 'sucrose' },
  { index: 10, name: 'oleic acid',         role: 'fattyAcid',  query: 'oleic acid' },
  { index: 11, name: 'glycine betaine',    role: 'osmolyte',   query: 'glycine betaine' },
];

const TROPHIC_TAXA: {
  level: number;
  role: string;
  name: string;
  scientificName: string;
}[] = [
  { level: 0, role: 'producer',  name: 'perennial ryegrass', scientificName: 'Lolium perenne' },
  { level: 0, role: 'producer',  name: 'annual meadow grass', scientificName: 'Poa annua' },
  { level: 1, role: 'herbivore', name: 'European rabbit',    scientificName: 'Oryctolagus cuniculus' },
  { level: 1, role: 'herbivore', name: 'red deer',           scientificName: 'Cervus elaphus' },
  { level: 2, role: 'carnivore', name: 'red fox',            scientificName: 'Vulpes vulpes' },
  { level: 2, role: 'carnivore', name: 'red-tailed hawk',    scientificName: 'Buteo jamaicensis' },
  { level: 3, role: 'apex',      name: 'grey wolf',          scientificName: 'Canis lupus' },
  { level: 3, role: 'apex',      name: 'mountain lion',      scientificName: 'Puma concolor' },
  { level: 4, role: 'decomposer', name: 'oyster mushroom',   scientificName: 'Pleurotus ostreatus' },
];

// ----- helpers ----------------------------------------------------------------

const ELEMENT_ORDER = ['C', 'H', 'O', 'N', 'P', 'S', 'Fe', 'K'] as const;
const ELEMENT_IDX = new Map<string, number>(ELEMENT_ORDER.map((s, i) => [s, i]));

/** Parse a PubChem MolecularFormula string into counts per sim element. */
function parseFormula(formula: string): number[] {
  const counts = new Array<number>(8).fill(0);
  const re = /([A-Z][a-z]?)(\d*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(formula)) !== null) {
    const el = m[1];
    const n = m[2] ? parseInt(m[2], 10) : 1;
    const idx = ELEMENT_IDX.get(el);
    if (idx !== undefined) counts[idx] = n;
  }
  return counts;
}

function scale(arr: number[], factor: number): number[] {
  return arr.map(v => v * factor);
}

async function fetchJson(url: string, timeout = 25000): Promise<any> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

// ----- PubChem ----------------------------------------------------------------

async function fetchPubChem(spec: typeof MOLECULE_SPECS[number]): Promise<{
  index: number; name: string; role: string;
  pubchemCid?: number; molecularFormula?: string;
  molecularWeight?: number; iupacName?: string;
  elementCounts: number[];
} | null> {
  try {
    const enc = encodeURIComponent(spec.query);
    const url =
      `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/${enc}` +
      `/property/MolecularWeight,MolecularFormula,IUPACName/JSON`;
    const json = await fetchJson(url);
    const p = json?.PropertyTable?.Properties?.[0];
    if (!p) return null;
    const formula: string = p.MolecularFormula ?? '';
    const elementCounts = parseFormula(formula);
    return {
      index: spec.index,
      name: spec.name,
      role: spec.role,
      pubchemCid: p.CID,
      molecularFormula: formula,
      molecularWeight: parseFloat(p.MolecularWeight) || undefined,
      iupacName: p.IUPACName,
      elementCounts,
    };
  } catch (e: any) {
    console.warn(`  PubChem ${spec.name}: ${e.message}`);
    return null;
  }
}

// ----- GBIF -------------------------------------------------------------------

async function fetchGbifTaxon(scientificName: string): Promise<{
  usageKey: number; kingdom?: string; phylum?: string;
  class?: string; order?: string; family?: string; genus?: string;
  taxonomicStatus: string;
} | null> {
  try {
    const enc = encodeURIComponent(scientificName);
    const url = `https://api.gbif.org/v1/species/match?name=${enc}`;
    const json = await fetchJson(url);
    if (!json || json.matchType === 'NONE') return null;
    return {
      usageKey: json.usageKey,
      kingdom: json.kingdom,
      phylum: json.phylum,
      class: json.clazz,
      order: json.order,
      family: json.family,
      genus: json.genus,
      taxonomicStatus: json.status,
    };
  } catch (e: any) {
    console.warn(`  GBIF ${scientificName}: ${e.message}`);
    return null;
  }
}

async function fetchGbifOccurrences(taxonKey: number): Promise<number> {
  try {
    const url =
      `https://api.gbif.org/v1/occurrence/search?taxonKey=${taxonKey}` +
      `&limit=0&hierarchical=false&occurrenceStatus=present`;
    const json = await fetchJson(url);
    return json?.count ?? 0;
  } catch {
    return 0;
  }
}

// ----- Kazusa codon usage -----------------------------------------------------

const AMINO_ACID_FORMULAS: Record<string, number[]> = {
  // standard amino acid elemental counts [C, H, O, N, P, S, Fe, K]
  A: [3, 7, 2, 1, 0, 0, 0, 0],
  R: [6, 14, 2, 4, 0, 0, 0, 0],
  N: [4, 8, 3, 2, 0, 0, 0, 0],
  D: [4, 7, 4, 1, 0, 0, 0, 0],
  C: [3, 7, 2, 1, 0, 1, 0, 0],
  E: [5, 9, 4, 1, 0, 0, 0, 0],
  Q: [5, 10, 3, 2, 0, 0, 0, 0],
  G: [2, 5, 2, 1, 0, 0, 0, 0],
  H: [6, 9, 2, 3, 0, 0, 0, 0],
  I: [6, 13, 2, 1, 0, 0, 0, 0],
  L: [6, 13, 2, 1, 0, 0, 0, 0],
  K: [6, 14, 2, 2, 0, 0, 0, 0],
  M: [5, 11, 2, 1, 0, 1, 0, 0],
  F: [9, 11, 2, 1, 0, 0, 0, 0],
  P: [5, 9, 2, 1, 0, 0, 0, 0],
  S: [3, 7, 3, 1, 0, 0, 0, 0],
  T: [4, 9, 3, 1, 0, 0, 0, 0],
  W: [11, 12, 2, 2, 0, 0, 0, 0],
  Y: [9, 11, 3, 1, 0, 0, 0, 0],
  V: [5, 11, 2, 1, 0, 0, 0, 0],
};

/** Hydrophobicity (Kyte-Doolittle) per amino acid (normalised to [0,1]). */
const HYDROPHOBICITY: Record<string, number> = {
  A: 0.62, R: -2.53, N: -0.78, D: -0.90, C: 0.29,
  E: -0.74, Q: -0.85, G: 0.48, H: -0.40, I: 0.73,
  L: 0.53, K: -1.35, M: 0.61, F: 0.64, P: -0.07,
  S: -0.18, T: -0.05, W: 0.37, Y: 0.02, V: 0.54,
};

async function fetchCodonUsage(): Promise<{
  codons: SnapType['genetics']['codons'];
  gcContent: number;
  avgHydrophobicity: number;
} | null> {
  try {
    const url =
      `https://www.kazusa.or.jp/codon/cgi-bin/showcodon.cgi?species=9606&aa=1&style=N&terminal=N&showsingle=NN`;
    const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();
    const codons: SnapType['genetics']['codons'] = [];
    const re = /([ACGTU]{3})\s+([A-Z*])\s+([\d.]+)\s+([\d.]+)\s+\((\d+)\)/g;
    let m: RegExpExecArray | null;
    let totalGorC = 0;
    let totalNt = 0;
    let hydroSum = 0;
    let hydroCount = 0;
    while ((m = re.exec(html)) !== null) {
      const [, codon, aa, frac, perK, cnt] = m;
      const count = parseInt(cnt, 10);
      const fraction = parseFloat(frac);
      const perThousand = parseFloat(perK);
      if (aa === '*') continue;
      codons.push({ codon: codon!, aminoAcid: aa!, fraction, perThousand, count });
      // GC content from nucleotide counts
      for (const ch of codon!) {
        if (ch === 'G' || ch === 'C') totalGorC += count;
        totalNt += count;
      }
      const hd = HYDROPHOBICITY[aa!];
      if (hd !== undefined) { hydroSum += hd * count; hydroCount += count; }
    }
    return {
      codons,
      gcContent: totalNt > 0 ? totalGorC / totalNt : 0.5,
      avgHydrophobicity: hydroCount > 0 ? hydroSum / hydroCount : 0.0,
    };
  } catch (e: any) {
    console.warn(`  Kazusa codon usage: ${e.message}`);
    return null;
  }
}

// ----- Derived engine params ---------------------------------------------------

function computeStoichiometry(molecules: SnapType['chemistry']['molecules']): SnapType['chemistry']['stoichiometry'] {
  const getEl = (idx: number) => molecules.find(m => m.index === idx)!.elementCounts;

  // plant food (glucose) — scale so carbon flux = current default (6)
  const glucoseEl = getEl(0);
  const glucoseScale = glucoseEl[0] > 0 ? 6 / glucoseEl[0] : 1;
  const plant = scale(glucoseEl, glucoseScale);

  // meat food (insulin/protein) — scale so carbon flux = current default (5)
  const proteinEl = getEl(6);
  const proteinScale = proteinEl[0] > 0 ? 5 / proteinEl[0] : 1;
  const meat = scale(proteinEl, proteinScale);

  // amino acid (glycine) — scale so C = 3 (current default for amino molecule gain)
  const aaEl = getEl(2);
  const aaScale = aaEl[0] > 0 ? 3 / aaEl[0] : 1;
  const aminoAcid = scale(aaEl, aaScale);

  // fatty acid (oleic acid) — scale so C = 2 (current default)
  const faEl = getEl(10);
  const faScale = faEl[0] > 0 ? 2 / faEl[0] : 1;
  const fattyAcid = scale(faEl, faScale);

  // sugar (sucrose) — scale so C = 5 (current default)
  const sugarEl = getEl(9);
  const sugarScale = sugarEl[0] > 0 ? 5 / sugarEl[0] : 1;
  const sugar = scale(sugarEl, sugarScale);

  // glucose molecule (glucose) — scale so C = 3 (current default)
  const glEl = getEl(0);
  const glScale = glEl[0] > 0 ? 3 / glEl[0] : 1;
  const glucose = scale(glEl, glScale);

  return { plant, meat, aminoAcid, fattyAcid, sugar, glucose };
}

function computeEcoPriors(
  taxa: SnapType['ecology']['taxa'],
): SnapType['ecology']['priors'] {
  // group by trophic level and sum occurrences
  const byLevel = new Map<number, { occ: number; role: string }>();
  for (const t of taxa) {
    const cur = byLevel.get(t.level) ?? { occ: 0, role: t.role };
    cur.occ += t.occurrenceCount;
    byLevel.set(t.level, cur);
  }
  const totalOcc = Array.from(byLevel.values()).reduce((s, v) => s + v.occ, 0);
  // carrying capacity scale: use relative abundance as trophic pyramid proxy
  // producers get the largest carrying capacity, apex the smallest
  // normalise so level 0 (producer) = 1.0, others scaled by ratio
  const l0 = byLevel.get(0)?.occ ?? 1;
  const priors: SnapType['ecology']['priors'] = [];
  for (const [level, { occ, role }] of byLevel) {
    priors.push({
      level,
      role,
      carryingCapacityScale: l0 > 0 ? occ / l0 : 1,
      occurrenceCount: occ,
      occurrenceFraction: totalOcc > 0 ? occ / totalOcc : 0,
    });
  }
  priors.sort((a, b) => a.level - b.level);
  return priors;
}

// ----- main -------------------------------------------------------------------

async function main() {
  console.log('=== Enrichment CLI — fetching real-world scientific data ===\n');

  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });

  const sources: SnapType['sources'] = [];
  const fetchedAt: Record<string, string> = {};
  const now = new Date().toISOString();

  // --- 1. PubChem molecules --------------------------------------------------
  console.log('[1/3] PubChem — molecular formulas...');
  const moleculeResults: SnapType['chemistry']['molecules'] = [];
  for (const spec of MOLECULE_SPECS) {
    process.stdout.write(`  ${spec.role} (${spec.query})...`);
    const r = await fetchPubChem(spec);
    if (r) {
      moleculeResults.push(r);
      process.stdout.write(` CID=${r.pubchemCid} ${r.molecularFormula}\n`);
    } else {
      // fallback: empty element counts
      moleculeResults.push({
        index: spec.index, name: spec.name, role: spec.role,
        elementCounts: new Array(8).fill(0),
      });
      process.stdout.write(' SKIPPED\n');
    }
  }
  // enzyme (index 5) derived from codon usage — placeholder for now
  moleculeResults.push({
    index: 5, name: 'enzyme', role: 'enzyme',
    elementCounts: new Array(8).fill(0),
  });
  moleculeResults.sort((a, b) => a.index - b.index);
  fetchedAt['pubchem'] = now;
  sources.push({
    name: 'PubChem PUG REST',
    url: 'https://pubchem.ncbi.nlm.nih.gov/rest/pug/',
    accessedAt: now,
    license: 'Public Domain (NIH)',
  });

  // --- 2. GBIF ecology -------------------------------------------------------
  console.log('\n[2/3] GBIF — taxonomy + occurrence counts...');
  const taxaResults: SnapType['ecology']['taxa'] = [];
  for (const tx of TROPHIC_TAXA) {
    process.stdout.write(`  ${tx.scientificName} (${tx.role})...`);
    const taxon = await fetchGbifTaxon(tx.scientificName);
    if (taxon) {
      const occ = await fetchGbifOccurrences(taxon.usageKey);
      taxaResults.push({
        level: tx.level,
        role: tx.role,
        scientificName: tx.scientificName,
        commonName: tx.name,
        gbifUsageKey: taxon.usageKey,
        kingdom: taxon.kingdom,
        phylum: taxon.phylum,
        class: taxon.class,
        order: taxon.order,
        family: taxon.family,
        genus: taxon.genus,
        occurrenceCount: occ,
      });
      process.stdout.write(` key=${taxon.usageKey} occ=${occ}\n`);
    } else {
      taxaResults.push({
        level: tx.level, role: tx.role,
        scientificName: tx.scientificName, commonName: tx.name,
        gbifUsageKey: 0, occurrenceCount: 0,
      });
      process.stdout.write(' SKIPPED\n');
    }
  }
  fetchedAt['gbif'] = now;
  sources.push({
    name: 'GBIF Species API + Occurrence Search',
    url: 'https://api.gbif.org/v1/',
    accessedAt: now,
    license: 'CC BY 4.0 (GBIF)',
  });

  // --- 3. Kazusa codon usage --------------------------------------------------
  console.log('\n[3/3] Kazusa — human codon usage table...');
  process.stdout.write('  Homo sapiens (9606)...');
  const codonData = await fetchCodonUsage();
  if (codonData) {
    fetchedAt['kazusa'] = now;
    sources.push({
      name: 'Kazusa Codon Usage Database',
      url: 'https://www.kazusa.or.jp/codon/',
      accessedAt: now,
      license: 'Public Domain (Kazusa DNA Research Institute)',
    });
    process.stdout.write(` ${codonData.codons.length} codons, GC=${(codonData.gcContent * 100).toFixed(1)}%\n`);
  } else {
    process.stdout.write(' SKIPPED\n');
  }

  // --- Build elements array (real periodic data) --------------------------------
  const elements = [
    { index: 0, symbol: 'C',  atomicMass: 12.011, electronegativity: 2.55 },
    { index: 1, symbol: 'H',  atomicMass: 1.008,  electronegativity: 2.20 },
    { index: 2, symbol: 'O',  atomicMass: 15.999, electronegativity: 3.44 },
    { index: 3, symbol: 'N',  atomicMass: 14.007, electronegativity: 3.04 },
    { index: 4, symbol: 'P',  atomicMass: 30.974, electronegativity: 2.19 },
    { index: 5, symbol: 'S',  atomicMass: 32.065, electronegativity: 2.58 },
    { index: 6, symbol: 'Fe', atomicMass: 55.845, electronegativity: 1.83 },
    { index: 7, symbol: 'K',  atomicMass: 39.098, electronegativity: 0.82 },
  ];

  // --- Derive enzyme (index 5) elemental composition from codon usage -----------
  if (codonData && codonData.codons.length > 0) {
    const totalCount = codonData.codons.reduce((s, c) => s + c.count, 0);
    const avgAA = new Array(8).fill(0);
    for (const c of codonData.codons) {
      const f = c.count / totalCount;
      const el = AMINO_ACID_FORMULAS[c.aminoAcid];
      if (el) {
        for (let i = 0; i < 8; i++) avgAA[i] += el[i] * f;
      }
    }
    // enzyme represents a ~300-residue average protein; scale C to match
    // the catalysisRate*5 baseline (enzyme baseline ≈ 5 units)
    const enzymeScale = avgAA[0] > 0 ? 5 / (avgAA[0] * 300) : 0;
    const enzymeAA = avgAA.map(v => v * 300 * enzymeScale);
    const enzIdx = moleculeResults.findIndex(m => m.index === 5);
    if (enzIdx >= 0) moleculeResults[enzIdx].elementCounts = enzymeAA;
  }

  // --- Compute derived engine params -------------------------------------------
  console.log('\nDeriving engine parameters...');
  const stoichiometry = computeStoichiometry(moleculeResults);
  const ecoPriors = computeEcoPriors(taxaResults);
  const totalOcc = taxaResults.reduce((s, t) => s + t.occurrenceCount, 0);
  const geneticsPrior = codonData
    ? {
        organism: 'Homo sapiens',
        gcContent: codonData.gcContent,
        avgHydrophobicity: codonData.avgHydrophobicity,
        codonCount: codonData.codons.length,
      }
    : { organism: 'Homo sapiens', gcContent: 0.41, avgHydrophobicity: 0.0, codonCount: 0 };

  const snapshot: SnapType = {
    version: 1,
    generatedAt: now,
    toolchain: `node-${process.version}`,
    sources,
    fetchedAt,
    chemistry: { elements, molecules: moleculeResults, stoichiometry },
    ecology: { taxa: taxaResults, priors: ecoPriors, totalOccurrences: totalOcc },
    genetics: { codons: codonData?.codons ?? [], prior: geneticsPrior },
  };

  // --- Validate ---------------------------------------------------------------
  const parsed = EnrichmentSnapshot.safeParse(snapshot);
  if (!parsed.success) {
    console.error('\nSchema validation failed:');
    for (const issue of parsed.error.issues) {
      console.error(`  ${issue.path.join('.')}: ${issue.message}`);
    }
    process.exit(1);
  }

  // --- Write ------------------------------------------------------------------
  writeFileSync(OUT_PATH, JSON.stringify(snapshot, null, 2), 'utf-8');
  const bytes = JSON.stringify(snapshot).length;
  console.log(`\nWrote ${OUT_PATH} (${(bytes / 1024).toFixed(1)} KB)`);
  console.log('Done.');
}

main().catch((e) => { console.error(e); process.exit(1); });
