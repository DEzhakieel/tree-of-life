import type { SimStats } from '@fractal-life/shared';
import type { AgentBuffer } from '../net/agentBuffer.js';
import type { GroundLayer } from '../store/useStore.js';

/**
 * The model hierarchy is built from *emergent universal patterns* — the
 * recurring structures that show up in any sufficiently complex system:
 *
 *   fractals · branches · orbitals · networks · spirals · waves · cycles ·
 *   oscillations · symmetry · broken symmetry · hierarchy · modularity ·
 *   clusters · layers · shells · lattices · honeycombs · voronoi ·
 *   tesselations · bubbles & foams · packing · randomness · chaos ·
 *   attractors · emergence · feedback loops · avalanche · percolations ·
 *   diffusion · flow · synchronization · competition · cooperation · growth ·
 *   decay.
 *
 * Every pattern is *detected* in the live simulation state (spatial analysis
 * of the agent field, network analysis of the clusters, and spectral analysis
 * of the time series) rather than labelled by hand. Tiers group patterns that
 * emerge together; tiers/patterns that have a spatial reading expose a
 * `ground` layer so they can be painted on the world floor (the evolved set
 * is the fractal tier made visible).
 */
export interface PatternMetric {
  id: string;
  name: string;
  desc: string;
  color: string;
  /** normalised 0..1 reading. */
  value: number;
  /** human-readable value. */
  display: string;
  /** optional ground-layer mode this pattern maps to. */
  ground?: GroundLayer;
}

export interface TierMetric {
  id: string;
  name: string;
  color: string;
  patterns: PatternMetric[];
}

const WORLD = 2048;
const BINS = 32;
const CELL = WORLD / BINS;
const N = BINS * BINS;
const MAX_HIST = 240;
const WIN = 80;

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

// ---------------------------------------------------------------------------
// Rolling time-series kept across compute calls.
// ---------------------------------------------------------------------------
const popHist: number[] = [];
const dispHist: number[] = [];
const ctrHist: number[] = [];
const entHist: number[] = [];
const divHist: number[] = [];
const cplHist: number[] = [];
let lastStatsTick = -1;

/**
 * Clear the rolling observables. Call whenever a new world/session starts so
 * time-series readings (autocorrelation, trend, spectral peaks) never bleed
 * across worlds.
 */
export function resetModelHistories(): void {
  popHist.length = 0;
  dispHist.length = 0;
  ctrHist.length = 0;
  entHist.length = 0;
  divHist.length = 0;
  cplHist.length = 0;
  lastStatsTick = -1;
}

function push(hist: number[], v: number): void {
  hist.push(v);
  if (hist.length > MAX_HIST) hist.shift();
}

function autocorr(series: number[], lag: number): number {
  const n = series.length;
  if (n < lag + 4) return 0;
  let mean = 0;
  for (let i = 0; i < n; i++) mean += series[i]!;
  mean /= n;
  let num = 0;
  let d1 = 0;
  let d2 = 0;
  for (let i = 0; i < n - lag; i++) {
    num += (series[i]! - mean) * (series[i + lag]! - mean);
    d1 += (series[i]! - mean) ** 2;
    d2 += (series[i + lag]! - mean) ** 2;
  }
  if (d1 === 0 || d2 === 0) return 0;
  return num / Math.sqrt(d1 * d2);
}

function pearson(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n < 8) return 0;
  let ma = 0;
  let mb = 0;
  for (let i = 0; i < n; i++) {
    ma += a[i]!;
    mb += b[i]!;
  }
  ma /= n;
  mb /= n;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i]! - ma;
    const y = b[i]! - mb;
    num += x * y;
    da += x * x;
    db += y * y;
  }
  if (da === 0 || db === 0) return 0;
  return num / Math.sqrt(da * db);
}

function gini(sizes: number[]): number {
  if (sizes.length < 2) return 0;
  const sorted = [...sizes].sort((a, b) => a - b);
  const n = sorted.length;
  let cum = 0;
  let total = 0;
  for (let i = 0; i < n; i++) {
    total += sorted[i]!;
    cum += (i + 1) * sorted[i]!;
  }
  if (total === 0) return 0;
  return (2 * cum) / (n * total) - (n + 1) / n;
}

function skewness(sizes: number[]): number {
  const n = sizes.length;
  if (n < 3) return 0;
  let mean = 0;
  for (const s of sizes) mean += s;
  mean /= n;
  let m2 = 0;
  let m3 = 0;
  for (const s of sizes) {
    const d = s - mean;
    m2 += d * d;
    m3 += d * d * d;
  }
  m2 /= n;
  m3 /= n;
  if (m2 === 0) return 0;
  return m3 / Math.pow(m2, 1.5);
}

function boxDimension(agents: AgentBuffer): number {
  const scales = [64, 32, 16];
  const counts: number[] = [];
  for (const s of scales) {
    const c = new Uint8Array(s * s);
    const cell = WORLD / s;
    for (let i = 0; i < agents.count; i++) {
      let cx = Math.floor(agents.x[i]! / cell);
      let cy = Math.floor(agents.y[i]! / cell);
      if (cx < 0) cx = 0;
      else if (cx >= s) cx = s - 1;
      if (cy < 0) cy = 0;
      else if (cy >= s) cy = s - 1;
      c[cy * s + cx] = 1;
    }
    let occ = 0;
    for (let k = 0; k < c.length; k++) occ += c[k]!;
    counts.push(occ);
  }
  if (counts[0]! < 2 || counts[1]! < 2) return 1;
  const d1 = (Math.log(counts[0]!) - Math.log(counts[1]!)) / (Math.log(64) - Math.log(32));
  const d2 =
    counts[2]! < 2
      ? d1
      : (Math.log(counts[1]!) - Math.log(counts[2]!)) / (Math.log(32) - Math.log(16));
  return Math.min(2, Math.max(1, (d1 + d2) / 2));
}

interface GridSig {
  occupied: number;
  boundary: number;
  clusters: number;
  largestFrac: number;
  compact: number;
  neighbor4Avg: number;
  latticeFrac: number;
  modFrac: number;
  neighbor8Avg: number;
  honeyFrac: number;
  indexDisp: number;
  symX: number;
  symY: number;
  radialPeaks: number;
  radialVar: number;
  energyBands: number;
  sizes: number[];
  centroid: number;
  dispersion: number;
}

function analyzeGrid(agents: AgentBuffer): GridSig {
  const counts = new Int32Array(N);
  const n = agents.count;
  let sumX = 0;
  let sumY = 0;
  let sumE = 0;
  let sumE2 = 0;
  for (let i = 0; i < n; i++) {
    const x = agents.x[i]!;
    const y = agents.y[i]!;
    const e = agents.energy[i]!;
    sumX += x;
    sumY += y;
    sumE += e;
    sumE2 += e * e;
    let cx = Math.floor(x / CELL);
    let cy = Math.floor(y / CELL);
    if (cx < 0) cx = 0;
    else if (cx >= BINS) cx = BINS - 1;
    if (cy < 0) cy = 0;
    else if (cy >= BINS) cy = BINS - 1;
    counts[cy * BINS + cx]++;
  }

  const centroid = n ? Math.hypot(sumX / n - WORLD / 2, sumY / n - WORLD / 2) : 0;
  let disp = 0;
  if (n > 0) {
    const meanX = sumX / n;
    const meanY = sumY / n;
    for (let i = 0; i < n; i++) disp += Math.hypot(agents.x[i]! - meanX, agents.y[i]! - meanY);
    disp /= n;
  }
  // energy histogram (16 bins) → number of distinct energy bands
  const ebins = new Int32Array(16);
  for (let i = 0; i < n; i++) {
    const b = Math.min(15, Math.floor(agents.energy[i]! * 16));
    ebins[b]++;
  }
  let energyBands = 0;
  const emax = Math.max(...ebins);
  for (let b = 1; b < 15; b++) {
    if (ebins[b]! >= emax * 0.12 && ebins[b]! > ebins[b - 1]! && ebins[b]! >= ebins[b + 1]!) energyBands++;
  }

  // radial profile around the centroid → orbital shells
  const shells = 12;
  const radial = new Float32Array(shells);
  const radialArea = new Float32Array(shells);
  const maxR = WORLD / 2;
  if (n > 0) {
    const meanX = sumX / n;
    const meanY = sumY / n;
    for (let i = 0; i < n; i++) {
      const r = Math.hypot(agents.x[i]! - meanX, agents.y[i]! - meanY);
      const s = Math.min(shells - 1, Math.floor((r / maxR) * shells));
      radial[s]++;
    }
  }
  for (let s = 0; s < shells; s++) {
    const r0 = (s / shells) * maxR;
    const r1 = ((s + 1) / shells) * maxR;
    radialArea[s] = (r1 * r1 - r0 * r0) * Math.PI;
  }
  const norm = new Float32Array(shells);
  for (let s = 0; s < shells; s++) norm[s] = radialArea[s]! > 0 ? radial[s]! / radialArea[s]! : 0;
  const nmax = Math.max(...norm);
  let radialPeaks = 0;
  let radialMean = 0;
  for (let s = 0; s < shells; s++) radialMean += norm[s]!;
  radialMean /= shells;
  for (let s = 1; s < shells - 1; s++) {
    if (norm[s]! >= nmax * 0.35 && norm[s]! > norm[s - 1]! && norm[s]! >= norm[s + 1]!) radialPeaks++;
  }
  let radialVar = 0;
  for (let s = 0; s < shells; s++) radialVar += (norm[s]! - radialMean) ** 2;
  radialVar /= shells;
  radialVar = Math.sqrt(radialVar) / (radialMean || 1);

  // connected components (orthogonal adjacency) with per-cluster geometry
  const seen = new Uint8Array(N);
  const occupiedCells: number[] = [];
  const sizes: number[] = [];
  let occupied = 0;
  let boundary = 0;
  let largestArea = 0;
  let largestPerim = 0;
  let n4sum = 0;
  let latticeFrac = 0;
  let modFrac = 0;
  for (let start = 0; start < N; start++) {
    if (counts[start] === 0 || seen[start]) continue;
    let area = 0;
    let perim = 0;
    const stack = [start];
    seen[start] = 1;
    while (stack.length > 0) {
      const idx = stack.pop()!;
      area++;
      const x = idx % BINS;
      const y = (idx / BINS) | 0;
      let neigh = 0;
      const dirs: Array<[number, number]> = [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ];
      for (const [dx, dy] of dirs) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || nx >= BINS || ny < 0 || ny >= BINS) continue;
        const ni = ny * BINS + nx;
        if (counts[ni] > 0) {
          neigh++;
          if (!seen[ni]) {
            seen[ni] = 1;
            stack.push(ni);
          }
        }
      }
      if (neigh < 4) perim++;
      n4sum += neigh;
      if (neigh === 4) latticeFrac++;
      if (neigh >= 3) modFrac++;
      occupiedCells.push(idx);
    }
    sizes.push(area);
    occupied += area;
    boundary += perim;
    if (area > largestArea) {
      largestArea = area;
      largestPerim = perim;
    }
  }
  const clusters = sizes.length;
  const compact = largestPerim > 0 ? (4 * Math.PI * largestArea) / (largestPerim * largestPerim) : 0;

  // 8-neighbour statistics → honeycomb density
  let n8sum = 0;
  let honeyFrac = 0;
  const dirs8: Array<[number, number]> = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
    [1, 1],
    [1, -1],
    [-1, 1],
    [-1, -1],
  ];
  for (const idx of occupiedCells) {
    const x = idx % BINS;
    const y = (idx / BINS) | 0;
    let c = 0;
    for (const [dx, dy] of dirs8) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || nx >= BINS || ny < 0 || ny >= BINS) continue;
      if (counts[ny * BINS + nx] > 0) c++;
    }
    n8sum += c;
    if (c >= 5) honeyFrac++;
  }
  const neighbor4Avg = occupied ? n4sum / occupied : 0;
  const neighbor8Avg = occupied ? n8sum / occupied : 0;
  latticeFrac = occupied ? latticeFrac / occupied : 0;
  modFrac = occupied ? modFrac / occupied : 0;
  honeyFrac = occupied ? honeyFrac / occupied : 0;

  // index of dispersion (Poisson-ness) over all cells
  let cMean = 0;
  for (let i = 0; i < N; i++) cMean += counts[i]!;
  cMean /= N;
  let cVar = 0;
  for (let i = 0; i < N; i++) cVar += (counts[i]! - cMean) ** 2;
  cVar /= N;
  const indexDisp = cMean > 0 ? cVar / cMean : 0;

  // mirror symmetry of the count field
  let sym = 0;
  let symX = 1;
  let symY = 1;
  for (let y = 0; y < BINS; y++) {
    for (let x = 0; x < BINS; x++) {
      const a = counts[y * BINS + x]!;
      const bx = counts[y * BINS + (BINS - 1 - x)]!;
      const by = counts[(BINS - 1 - y) * BINS + x]!;
      sym += a;
      symX += Math.abs(a - bx);
      symY += Math.abs(a - by);
    }
  }
  if (sym > 0) {
    symX = 1 - symX / (2 * sym);
    symY = 1 - symY / (2 * sym);
    if (symX < 0) symX = 0;
    else if (symX > 1) symX = 1;
    if (symY < 0) symY = 0;
    else if (symY > 1) symY = 1;
  }

  return {
    occupied,
    boundary,
    clusters,
    largestFrac: occupied ? largestArea / occupied : 0,
    compact,
    neighbor4Avg,
    latticeFrac,
    modFrac,
    neighbor8Avg,
    honeyFrac,
    indexDisp,
    symX,
    symY,
    radialPeaks,
    radialVar,
    energyBands,
    sizes,
    centroid,
    dispersion: disp,
  };
}

// ---------------------------------------------------------------------------
// Tier + pattern definitions, and their live readings.
// ---------------------------------------------------------------------------
const P = (
  id: string,
  name: string,
  desc: string,
  color: string,
  value: number,
  display: string,
  ground?: GroundLayer,
): PatternMetric => ({ id, name, desc, color, value, display, ground });

const ZERO = '—';

function readings(
  g: GridSig,
  dim: number,
  s: SimStats | null,
  _alive: number,
): TierMetric[] {
  const packed = g.occupied / N;
  const sym = Math.max(g.symX, g.symY);
  const indexD = g.indexDisp;
  const boundaryRatio = g.occupied > 0 ? g.boundary / g.occupied : 0;

  const pHist = popHist.slice(-WIN);
  const trend =
    pHist.length > 12 ? (pHist[pHist.length - 1]! - pHist[0]!) / Math.max(1, pHist[0]!) : 0;

  let drift = 0;
  if (ctrHist.length > 12) {
    drift = Math.abs(ctrHist[ctrHist.length - 1]! - ctrHist[ctrHist.length - 1 - 12]!);
  }
  let diff = 0;
  if (dispHist.length > 12) {
    const a = dispHist[dispHist.length - 1 - 12]!;
    diff = a > 0 ? (dispHist[dispHist.length - 1]! - a) / a : 0;
  }

  // spectral readings over the population series
  const ac1 = autocorr(pHist, 1);
  const ac2 = autocorr(pHist, 2);
  const ac3 = autocorr(pHist, 3);
  let peakAC = 0;
  for (let lag = 2; lag <= 8; lag++) peakAC = Math.max(peakAC, autocorr(pHist, lag));
  let oscAmp = 0;
  if (pHist.length > 8) {
    let mn = Infinity;
    let mx = -Infinity;
    let sm = 0;
    for (const v of pHist) {
      if (v < mn) mn = v;
      if (v > mx) mx = v;
      sm += v;
    }
    const mean = sm / pHist.length;
    oscAmp = mean > 0 ? (mx - mn) / mean : 0;
  }
  let relVol = 0;
  let kurt = 0;
  if (pHist.length > 8) {
    const deltas: number[] = [];
    let sm = 0;
    for (let i = 1; i < pHist.length; i++) {
      const d = Math.abs(pHist[i]! - pHist[i - 1]!);
      deltas.push(d);
      sm += d;
    }
    const mean = sm / deltas.length;
    let v = 0;
    for (const d of deltas) v += (d - mean) ** 2;
    const sd = Math.sqrt(v / deltas.length);
    relVol = mean > 0 ? sd / mean : 0;
    if (sd > 0) {
      for (const d of deltas) kurt += ((d - mean) / sd) ** 4;
      kurt /= deltas.length;
    }
  }
  const chaosV = pHist.length > 8 ? (1 - Math.abs(ac1)) * Math.min(2, oscAmp) : 0;

  // wave persistence over the entropy series (stats-sourced)
  const waves = (autocorr(entHist, 1) + autocorr(entHist, 2) + autocorr(entHist, 3)) / 3;
  const sync = Math.abs(pearson(entHist.slice(-60), divHist.slice(-60)));
  const feedback = (Math.max(0, ac2) + Math.max(0, ac3)) / 2;

  const emergenceSlope =
    cplHist.length > 8 ? cplHist[cplHist.length - 1]! - cplHist[cplHist.length - 1 - 8]! : 0;

  const tier = (name: string, color: string, patterns: PatternMetric[]): TierMetric => ({
    id: name.toLowerCase().replace(/[^a-z]+/g, ''),
    name,
    color,
    patterns,
  });

  return [
    tier('Geometry', '#a5b4fc', [
      P('fractals', 'Fractals', 'box-counting dimension of the population field', '#e2e8f0', clamp01(dim - 1), `D ${dim.toFixed(2)}`, 'set'),
      P('symmetry', 'Symmetry', 'mirror symmetry of the spatial field', '#93c5fd', clamp01(sym), `${(clamp01(sym) * 100).toFixed(0)}%`),
      P('brokenSymmetry', 'Broken symmetry', 'departure from perfect mirror symmetry', '#c4b5fd', clamp01(1 - sym), `${(clamp01(1 - sym) * 100).toFixed(0)}%`),
      P('lattices', 'Lattices', 'cells with four orthogonal neighbours', '#818cf8', clamp01(g.latticeFrac), `${(g.latticeFrac * 100).toFixed(0)}%`),
      P('tesselations', 'Tesselations', 'uniform coverage of space', '#6366f1', clamp01(1 - indexD / 2), `${(clamp01(1 - indexD / 2) * 100).toFixed(0)}%`),
    ]),
    tier('Dynamics', '#7dd3fc', [
      P('waves', 'Waves', 'sustained oscillation of system observables', '#7dd3fc', clamp01((waves - 0.1) * 1.5), waves.toFixed(2)),
      P('orbitals', 'Orbitals', 'distinct radial density shells around the centroid', '#38bdf8', clamp01((g.radialPeaks - 1) / 4), `rings ${g.radialPeaks}`),
      P('spirals', 'Spirals', 'elongation of the largest colony', '#22d3ee', clamp01(1 - g.compact), `elong ${(1 - g.compact).toFixed(2)}`),
      P('flow', 'Flow', 'drift of the population centroid', '#0ea5e9', clamp01(drift / (WORLD / 12)), `${(drift / (WORLD / 12)).toFixed(2)}`),
      P('diffusion', 'Diffusion', 'spread of the population dispersion', '#a5f3fc', clamp01(diff), diff >= 0 ? `+${(diff * 100).toFixed(0)}%` : ZERO),
    ]),
    tier('Randomness & chaos', '#c084fc', [
      P('randomness', 'Randomness', 'Poisson-ness of the density field', '#c084fc', clamp01(indexD / 2), `D ${indexD.toFixed(2)}`),
      P('chaos', 'Chaos', 'volatility × unpredictability of population', '#a855f7', clamp01(chaosV), chaosV.toFixed(2)),
      P('attractors', 'Attractors', 'concentration toward dominant species states', '#e879f9', clamp01(1 - (s?.diversity ?? 0)), `${((1 - (s?.diversity ?? 0)) * 100).toFixed(0)}%`),
    ]),
    tier('Matter', '#fca5a5', [
      P('packing', 'Packing', 'fraction of space occupied', '#fca5a5', clamp01(packed * 2), `${(packed * 100).toFixed(1)}%`, 'density'),
      P('layers', 'Layers', 'distinct energy bands in the population', '#f87171', clamp01((g.energyBands - 1) / 4), `bands ${g.energyBands}`, 'energy'),
      P('bubblesFoams', 'Bubbles & foams', 'cells of life separated by voids', '#fb7185', clamp01((1 - packed) * Math.min(1, g.clusters / 8)), `voids ${((1 - packed) * 100).toFixed(0)}%`),
      P('shells', 'Shells', 'radial banding of density', '#fdba74', clamp01(g.radialVar * 3), `${(g.radialVar * 100).toFixed(0)}%`),
    ]),
    tier('Connectivity', '#f472b6', [
      P('networks', 'Networks', 'mean neighbour degree of occupied cells', '#f472b6', clamp01(g.neighbor8Avg / 8), `deg ${g.neighbor8Avg.toFixed(1)}`),
      P('modularity', 'Modularity', 'dense cores within colonies', '#f9a8d4', clamp01(g.modFrac), `${(g.modFrac * 100).toFixed(0)}%`),
      P('honeycombs', 'Honeycombs', 'cells packed with many neighbours', '#fda4af', clamp01(g.honeyFrac), `${(g.honeyFrac * 100).toFixed(0)}%`),
      P('voronoi', 'Voronoi', 'cell walls around colonies', '#e9d5ff', clamp01(boundaryRatio * 0.8), `walls ${(boundaryRatio * 100).toFixed(0)}%`),
      P('synchronization', 'Synchronization', 'co-movement of observables', '#f0abfc', clamp01(sync), `r ${sync.toFixed(2)}`),
    ]),
    tier('Heredity', '#34d399', [
      P('branches', 'Branches', 'inequality in colony sizes', '#34d399', clamp01(gini(g.sizes)), `g ${gini(g.sizes).toFixed(2)}`, 'gene'),
      P('growth', 'Growth', 'population expansion', '#a3e635', clamp01(trend), trend >= 0 ? `+${(trend * 100).toFixed(0)}%` : ZERO),
      P('decay', 'Decay', 'population contraction', '#84cc16', clamp01(-trend), trend <= 0 ? `${(trend * 100).toFixed(0)}%` : ZERO),
    ]),
    tier('Fluctuation', '#fbbf24', [
      P('cycles', 'Cycles', 'periodic recurrence in population', '#fbbf24', clamp01((peakAC - 0.3) / 0.7), `ρ ${peakAC.toFixed(2)}`),
      P('oscillations', 'Oscillations', 'amplitude of population swings', '#fcd34d', clamp01(oscAmp / 2), `amp ${(oscAmp * 100).toFixed(0)}%`),
      P('avalanche', 'Avalanche', 'burstiness of population steps', '#f59e0b', clamp01((kurt - 3) / 5), `κ ${kurt.toFixed(1)}`),
    ]),
    tier('Strategy', '#38bdf8', [
      P('competition', 'Competition', 'predator strategies in play', '#38bdf8', clamp01(s?.predatorFraction ?? 0), `${((s?.predatorFraction ?? 0) * 100).toFixed(0)}%`),
      P('cooperation', 'Cooperation', 'energy shared between agents', '#22d3ee', clamp01(s?.cooperation ?? 0), `${((s?.cooperation ?? 0) * 100).toFixed(0)}%`),
      P('aggression', 'Aggression', 'mean aggression gene across agents', '#fb7185', clamp01(s?.meanAggression ?? 0), `${((s?.meanAggression ?? 0) * 100).toFixed(0)}%`),
      P('deception', 'Deception', 'signal dishonesty — cheap-talk signalling', '#a78bfa', clamp01(s?.meanDeception ?? 0), `${((s?.meanDeception ?? 0) * 100).toFixed(0)}%`),
      P('riskTolerance', 'Risk tolerance', 'mean risk gene (hazard-seeking)', '#f59e0b', clamp01(s?.meanRisk ?? 0), `${((s?.meanRisk ?? 0) * 100).toFixed(0)}%`),
      P('strategyDiversity', 'Strategy diversity', 'replicator selection entropy across strategies', '#c084fc', clamp01((s?.selectionEntropy ?? 0) / 4), `H ${(s?.selectionEntropy ?? 0).toFixed(2)}`),
      P('fixation', 'Fixation', 'dominant strategy frequency (>0.8 = locked in)', '#e879f9', clamp01(s?.fixationIndex ?? 0), `${((s?.fixationIndex ?? 0) * 100).toFixed(0)}%`),
      P('selectionPressure', 'Selection pressure', 'price-equation covariance of fitness × strategy', '#f0abfc', clamp01(Math.abs(s?.priceEquationSelection ?? 0) / 10), `σ ${(s?.priceEquationSelection ?? 0).toFixed(3)}`),
      P('altruism', 'Altruism', 'lifetime energy donated vs acquired', '#a3e635', clamp01(s?.donationRatio ?? 0), `${((s?.donationRatio ?? 0) * 100).toFixed(0)}%`),
    ]),
    tier('Emergence', '#f87171', [
      P('emergence', 'Emergence', 'LMC complexity and its trend', '#f87171', clamp01((s?.complexity ?? 0) / 5 + emergenceSlope * 2), `${(s?.complexity ?? 0).toFixed(3)}`),
      P('feedbackLoops', 'Feedback loops', 'self-reinforcing population persistence', '#fca5a5', clamp01(feedback), `fb ${feedback.toFixed(2)}`),
      P('hierarchy', 'Hierarchy', 'skew of colony-size distribution', '#fecaca', clamp01(skewness(g.sizes) / 3), `γ ${skewness(g.sizes).toFixed(1)}`),
    ]),
    tier('Ecology', '#2dd4bf', [
      P('clusters', 'Clusters', 'spatially connected colonies', '#2dd4bf', clamp01(g.clusters / 40), `${g.clusters}`),
      P('percolations', 'Percolations', 'dominant colony spanning share', '#5eead4', clamp01(g.largestFrac), `${(g.largestFrac * 100).toFixed(0)}%`),
    ]),
  ];
}

/**
 * Detect every universal pattern in the live simulation state and organise
 * them into the model hierarchy. Tiers run bottom→top (geometry → ecology).
 */
export function computeModelLayers(
  stats: SimStats | null,
  agents: AgentBuffer,
): TierMetric[] {
  const g = analyzeGrid(agents);
  const dim = boxDimension(agents);

  // maintain rolling histories
  push(popHist, agents.count);
  push(dispHist, g.dispersion);
  push(ctrHist, g.centroid);
  if (stats && stats.tick !== lastStatsTick) {
    lastStatsTick = stats.tick;
    push(entHist, stats.entropy);
    push(divHist, stats.diversity);
    push(cplHist, stats.complexity);
  }

  return readings(g, dim, stats, agents.count);
}
