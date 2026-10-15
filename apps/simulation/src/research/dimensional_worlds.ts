import { fnv1a32 } from '@fractal-life/shared';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Phase M dimensionality experiment — a minimal N-D cellular world.
 *
 * The full engine is 2-D by construction (fractal plane, 2-D spatial hash,
 * 2-D chem grids), so dimensionality itself cannot be exercised in-engine.
 * This harness builds a tiny, self-contained N-dimensional consumer–resource
 * lattice and runs the SAME physical story at N = 1..4 spatial dimensions:
 * resource grows logistically, is consumed by colonies, and diffuses across
 * the nearest 2N neighbours. The boundary is a full torus (all axes wrap) —
 * the lattice analog of the engine's legacy topology — or a reflecting box.
 *
 * Metrics:
 *  - survival (fraction of cells that keep a living colony at steady state)
 *  - resource variance (spatial patterning — how strongly niches separate)
 *  - Shannon entropy (information content of the discretized living field)
 *  - final biomass, and the mean inter-colony distance (mixing character)
 *
 * Hypothesis knob: for a FIXED total volume V and diffusion across 2N faces,
 * the lattice side is V^(1/N), so as N grows the world gets longer and the
 * characteristic mixing time (∝ side²) grows. Life can therefore keep more
 * spatially-separated niches alive in higher dimensions — resource variance
 * and Shannon entropy should rise with N while survival stays bounded. The
 * torus (no boundary) and the reflecting box (walls) differ only through the
 * wall flux; doubling as a topology cross-check with the engine experiments.
 *
 * Fully deterministic: every draw comes from a stream seeded per (dim, world).
 */

export interface LatticeSpec {
  dims: number[]; // side length per axis; total volume = ∏ dims
  cols?: number; // living colonies seeded at t=0
  growth?: number; // logistic growth rate
  capacity?: number; // resource carrying capacity per cell
  consume?: number; // resource drawn per colony tick
  yieldAv?: number; // biomass gain per unit resource
  death?: number; // per-tick colony mortality
  diffX?: number; // diffusion coefficient
  wallFlux?: number; // box-edge resource flux (how leaky the walls are)
  ticks?: number;
  topology?: 'torus' | 'box';
  seed?: string;
}

export interface LatticeOutcome {
  dims: number[];
  volume: number;
  side: number; // longest axis — mixing length ∝ side²
  connectivity: number; // 2N neighbours per cell
  topology: 'torus' | 'box';
  ticks: number;
  survivors: number;
  survival: number; // survivors / volume
  finalBiomass: number;
  resourceMean: number;
  resourceVar: number; // spatial variance of resource at steady state
  shannon: number; // bits of living-field entropy
  finalColonies: number;
  meanColonyDist: number; // mean pairwise distance (world units, wrapped on torus)
  spread: number; // RMS distance of surviving colonies from their centroid
  esdRes: number; // equilibrium total resource (proxy for ecosystem size)
}

/** deterministic per-cell hash stream (32-bit mulberry32 — the 64-bit splitmix
 *  constant overflows JS doubles and degenerates to a tiny period) */
class LWorldRng {
  private s: number;
  constructor(seed: number) {
    this.s = seed >>> 0 || 0x6d2b79f5;
  }
  next(): number {
    let t = (this.s = (this.s + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  }
  unit(): number {
    return this.next() / 4294967296;
  }
}

/** mix a multivariate cell index into a flat index (row-major over the dims) */
export function flatIndex(dims: number[], idx: number[]): number {
  let f = 0;
  for (let d = 0; d < dims.length; d++) {
    f = f * dims[d] + idx[d];
  }
  return f;
}

export function cellCoords(dims: number[], flat: number): number[] {
  const idx = new Array(dims.length).fill(0);
  for (let d = dims.length - 1; d >= 0; d--) {
    idx[d] = flat % dims[d];
    flat = Math.floor(flat / dims[d]);
  }
  return idx;
}

/** wrap a coordinate on a torus; reflect it on a box edge (walls) */
function fold(dim: number, side: number, wrap: boolean): number {
  if (wrap) {
    return ((dim % side) + side) % side;
  }
  if (dim < 0) return -dim;
  if (dim >= side) return 2 * side - 2 - dim;
  return dim;
}

export function solveLattice(specin: LatticeSpec): LatticeOutcome {
  const dims = specin.dims;
  const N = dims.length;
  const volume = dims.reduce((a, b) => a * b, 1);
  const side = Math.max(...dims);
  const wrap = specin.topology !== 'box';
  const growth = specin.growth ?? 0.05;
  const capacity = specin.capacity ?? 1.0;
  const consume = specin.consume ?? 0.02;
  const yieldAv = specin.yieldAv ?? 2.5;
  const death = specin.death ?? 0.005;
  const diffX = specin.diffX ?? 0.02;
  const wallFlux = specin.wallFlux ?? 0.0;
  const ticks = specin.ticks ?? 1000;
  const cols = specin.cols ?? Math.min(8, volume);

  const r = new Float64Array(volume);
  const m = new Float64Array(volume);
  const rn = new Float64Array(volume);
  const mn = new Float64Array(volume);
  const sp = new Float64Array(volume); // dispersal accumulator
  const rng = new LWorldRng(fnv1a32(`${specin.seed ?? 'lattice'}:${dims.join('x')}:${specin.topology ?? 'torus'}`));

  // seed resource field near capacity with a little noise
  for (let i = 0; i < volume; i++) {
    r[i] = capacity * (0.9 + 0.1 * rng.unit());
  }
  // seed colonies at scattered cells
  const chosen = new Set<number>();
  while (chosen.size < cols) {
    chosen.add(Math.floor(rng.unit() * volume));
  }
  for (const c of chosen) {
    m[c] = 1.0;
  }

  const neighborsOf = (idx: number[]): number[][] => {
    const nb: number[][] = [];
    for (let d = 0; d < N; d++) {
      const up = idx.slice();
      const dn = idx.slice();
      up[d] = fold(idx[d] + 1, dims[d], wrap);
      dn[d] = fold(idx[d] - 1, dims[d], wrap);
      nb.push(up, dn);
    }
    return nb;
  };

  // densely-packed colonies spill biomass outward to their 2N faces — a crude
  // motility/dispersal rule so life can actually spread through the space
  const SPILL_THRESH = 1.5;
  const SPILL_FRAC = 0.05;

  for (let t = 0; t < ticks; t++) {
    sp.fill(0);
    for (let i = 0; i < volume; i++) {
      const idx = cellCoords(dims, i);
      const neighbors = neighborsOf(idx);
      // resource: logistic growth minus consumption; diffusion over 2N faces
      let laplacian = 0;
      for (const nb of neighbors) {
        laplacian += r[flatIndex(dims, nb)];
      }
      laplacian -= 2 * N * r[i];
      let dr = growth * r[i] * (1 - r[i] / capacity) - consume * m[i] * Math.min(1, r[i]);
      dr += diffX * laplacian;
      // box walls leak (a fixed outward flux when the world has edges)
      if (!wrap) {
        for (let d = 0; d < N; d++) {
          if (idx[d] === 0 || idx[d] === dims[d] - 1) dr -= wallFlux * r[i];
        }
      }
      rn[i] = Math.max(0, r[i] + dr);
      // colonies: eat what the resource yields; die when starved
      const uptake = consume * m[i] * Math.min(1, r[i]);
      const dm = yieldAv * uptake - death * m[i];
      const base = Math.max(0, m[i] + dm);
      mn[i] = base;
      if (base > SPILL_THRESH) {
        const per = (base - SPILL_THRESH) * SPILL_FRAC;
        sp[i] = per * 2 * N; // total pushed out this step
        mn[i] = base - sp[i];
      }
    }
    // receive neighbour spill (each face contributes per/2 into that cell)
    for (let i = 0; i < volume; i++) {
      let inflow = 0;
      const idx = cellCoords(dims, i);
      for (const nb of neighborsOf(idx)) {
        inflow += sp[flatIndex(dims, nb)] / (2 * N);
      }
      mn[i] = Math.min(4 * SPILL_THRESH, Math.max(0, mn[i] + inflow));
    }
    const tmpR = r;
    const tmpM = m;
    r.set(rn);
    m.set(mn);
    rn.set(tmpR);
    mn.set(tmpM);
  }

  // ---- metrics at steady state ----
  const survivors = m.reduce((a, v) => a + (v > 0.01 ? 1 : 0), 0);
  const survival = survivors / volume;
  const finalBiomass = m.reduce((a, v) => a + v, 0);
  const resourceMean = r.reduce((a, v) => a + v, 0) / volume;
  const resourceVar =
    r.reduce((a, v) => a + (v - resourceMean) ** 2, 0) / volume;

  // Shannon entropy of the binarized living field (colony / empty)
  let c0 = 0;
  let c1 = 0;
  for (const v of m) {
    if (v > 0.01) c1++;
    else c0++;
  }
  const p1 = c1 / volume;
  const shannon =
    p1 > 0 && p1 < 1 ? -(p1 * Math.log2(p1) + (1 - p1) * Math.log2(1 - p1)) : 0;

  // mean pairwise wrapped distance between surviving colony cells
  let distSum = 0;
  let distCount = 0;
  const cells: number[][] = [];
  for (let i = 0; i < volume; i++) {
    if (m[i] > 0.01) cells.push(cellCoords(dims, i));
  }
  for (let a = 0; a < cells.length; a++) {
    for (let b = a + 1; b < cells.length; b++) {
      let d = 0;
      for (let k = 0; k < N; k++) {
        let dim = Math.abs(cells[a][k] - cells[b][k]);
        if (wrap) dim = Math.min(dim, dims[k] - dim);
        d += dim * dim;
      }
      distSum += Math.sqrt(d);
      distCount++;
    }
  }
  const meanColonyDist = distCount > 0 ? distSum / distCount : 0;

  // RMS spread of surviving colonies around their centroid (geographic reach)
  let spread = 0;
  if (cells.length > 1) {
    const centroid = new Array(N).fill(0);
    for (const c of cells) for (let k = 0; k < N; k++) centroid[k] += c[k];
    for (let k = 0; k < N; k++) centroid[k] /= cells.length;
    let ss = 0;
    for (const c of cells) {
      let di = 0;
      for (let k = 0; k < N; k++) di += (c[k] - centroid[k]) ** 2;
      ss += di;
    }
    spread = Math.sqrt(ss / cells.length);
  }

  return {
    dims,
    volume,
    side,
    connectivity: 2 * N,
    topology: wrap ? 'torus' : 'box',
    ticks,
    survivors,
    survival,
    finalBiomass,
    resourceMean,
    resourceVar,
    shannon,
    finalColonies: c1,
    meanColonyDist,
    spread,
    esdRes: r.reduce((a, v) => a + v, 0),
  };
}

// ---- experiment grid ----

// keep the total lattice volume fixed at 4096 cells across all dimensions so
// the only thing that changes with N is the geometry of space itself.
export const DIMENSION_WORLDS: LatticeSpec[] = [
  { dims: [4096], topology: 'torus' },
  { dims: [64, 64], topology: 'torus' },
  { dims: [16, 16, 16], topology: 'torus' },
  { dims: [8, 8, 8, 8], topology: 'torus' },
];

export const BOX_WORLDS: LatticeSpec[] = [
  { dims: [64, 64], topology: 'box', wallFlux: 0.001 },
  { dims: [16, 16, 16], topology: 'box', wallFlux: 0.001 },
];

export function runLatticeExperiment(): LatticeOutcome[] {
  const specs = [...DIMENSION_WORLDS, ...BOX_WORLDS];
  const out: LatticeOutcome[] = [];
  for (const spec of specs) {
    out.push(solveLattice({ ...spec, seed: 'lattice', ticks: 2000 }));
  }
  return out;
}

const outputDir = fileURLToPath(new URL('../../research/output/', import.meta.url));

function fmtNum(digits: number) {
  return (v: number) => v.toFixed(digits);
}

function renderTable(columns: [string, string][], rows: Record<string, unknown>[]) {
  const head = `| ${columns.map((c) => c[1]).join(' | ')} |`;
  const sep = `|${columns.map(() => '---').join('|')}|`;
  const body = rows
    .map((r) => `| ${columns.map((c) => String(r[c[0]] ?? '')).join(' | ')} |`)
    .join('\n');
  return `${head}\n${sep}\n${body}\n`;
}

function writeOutput() {
  const rows = runLatticeExperiment();
  const cols: [string, string][] = [
    ['dims', 'dims'],
    ['volume', 'volume'],
    ['side', 'side len'],
    ['connectivity', 'faces/cell'],
    ['topology', 'topology'],
    ['survival', 'survival'],
    ['finalBiomass', 'biomass'],
    ['resourceMean', 'res μ'],
    ['resourceVar', 'res var'],
    ['shannon', 'Shannon bits'],
    ['finalColonies', 'colonies'],
    ['meanColonyDist', 'mean dist'],
    ['spread', 'spread'],
    ['esdRes', 'total res'],
  ];
  const fmtRows: Record<string, unknown>[] = rows.map((r) => ({
    dims: r.dims.join('×'),
    volume: r.volume,
    side: r.side,
    connectivity: r.connectivity,
    topology: r.topology,
    survival: fmtNum(3)(r.survival),
    finalBiomass: fmtNum(1)(r.finalBiomass),
    resourceMean: fmtNum(3)(r.resourceMean),
    resourceVar: fmtNum(3)(r.resourceVar),
    shannon: fmtNum(3)(r.shannon),
    finalColonies: r.finalColonies,
    meanColonyDist: fmtNum(2)(r.meanColonyDist),
    spread: fmtNum(2)(r.spread),
    esdRes: fmtNum(2)(r.esdRes),
  }));

  mkdirSync(outputDir, { recursive: true });
  const title = `Dimensionality experiment — same volume (4096 cells), N = 1..4 spatial dimensions, torus vs box`;
  const meta = [
    'Minimal N-D consumer–resource lattice: logistic growth, colonial consumption,',
    'diffusion over the 2N nearest neighbours. Fixed volume so only the geometry of',
    'space changes with N. Torus = all axes wrap (engine default); box = reflecting walls.',
  ];
  const md = `# ${title}\n\n${meta.join(' ')}\n\n${renderTable(cols, fmtRows)}\n`;
  writeFileSync(join(outputDir, 'lattice.md'), md);
  writeFileSync(join(outputDir, 'lattice.csv'), [cols.map((c) => c[1]).join(','), ...fmtRows.map((r) => cols.map((c) => String(r[c[0]])).join(','))].join('\n') + '\n');
  writeFileSync(join(outputDir, 'lattice.json'), JSON.stringify({ generatedAt: new Date().toISOString(), meta, runs: fmtRows }, null, 2) + '\n');

  console.log(`# Dimensionality experiment (volume ${rows[0].volume}, 2000 ticks)\n`);
  for (const r of rows) {
    console.log(`## ${r.dims.join('×')}D lattice (${r.topology}, ${r.connectivity} faces/cell)`);
    console.log(`survival=${fmtNum(3)(r.survival)} biomass=${fmtNum(1)(r.finalBiomass)} res μ=${fmtNum(3)(r.resourceMean)} var=${fmtNum(3)(r.resourceVar)} Shannon=${fmtNum(3)(r.shannon)} colonies=${r.finalColonies} spread=${fmtNum(2)(r.spread)}\n`);
  }
  console.log('\n' + renderTable(cols, fmtRows));
  console.log(`\nwritten: ${join(outputDir, 'lattice.md')}`);
}

if (process.argv[1]?.endsWith('dimensional_worlds.ts')) {
  writeOutput();
}