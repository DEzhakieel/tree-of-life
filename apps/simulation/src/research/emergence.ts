import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';
import { TERRAIN_CELL, TERRAIN_GRID, type SimStats } from '@fractal-life/shared';
import { Engine } from '../engine.js';
import { TIER_DEFS, buildArchetypeWorld } from './archetypes.js';
import { entropyOf, corr } from './complexity.js';
import { feedGenome } from './scenarios.js';
import { outcomeFingerprint } from './snapshot.js';

/**
 * Emergence measurement layer — emergence as an OBJECT that can be measured.
 *
 * Emergence here is not a label but a typed measurement object aggregated from
 * FIVE observable axes over a double-run of a world:
 *
 *   1. microInfo           — information resident in the MICRO level:
 *                            per-tick Shannon entropy of the species
 *                            composition AMONG living individuals plus the
 *                            entropy of their positions on the fine 128²
 *                            terrain lattice (sum of marginal entropies =
 *                            an upper-bound proxy of the joint micro state).
 *   2. macroInfo           — information in the MACRO level: the Shannon
 *                            entropy of the sequence of quantized aggregate
 *                            macro states the system actually visits
 *                            (aliveFrac, species, energy, cooperation, meme
 *                            entropy each in 8 bins) over the run.
 *   3. complexity          — the LMC (entropy × disequilibrium) of the species
 *                            abundance distribution, exactly the engine's
 *                            `stats().complexity` formula re-derived here.
 *   4. selfOrganization    — deviation from the maximum-entropy uniform
 *                            arrangement: (a) aggregation order 1−H/logBins of
 *                            the macro 16² lattice occupancy, and (b) the
 *                            coarse-to-fine entropy ratio 1−H_coarse/H_fine
 *                            (structure visible after coarse-graining far
 *                            beyond what the fine detail implies by itself).
 *   5. temporalPersistence — how long-lived the structure is: survival
 *                            fraction of the run, mean lag-1..L autocorrelation
 *                            of the population series, and first-half vs
 *                            second-half species-coexistence overlap
 *                            (Sørensen).
 *
 * On top of the five axes the object carries the real emergence signature:
 *
 *   emergentInformation    — normalised mutual information between the MICRO
 *                            information level and the MACRO state over the
 *                            run: sync (same tick I(µ;M)) and predictive
 *                            (I(µ(t); M(t+1))). The micro level is represented
 *                            by the run-calibrated quantized micro-information
 *                            value (composition + spatial entropy, 8 bins),
 *                            the macro level by the visited macro-state index
 *                            — how much of the aggregate state is informed by
 *                            — and forecast from — the microscopic information.
 *
 *   emergenceIndex         — mean of the five axes, each normalised to [0,1]
 *                            by its information-theoretic maximum support.
 *   verdict                — ABSENT / PARTIAL / EMERGENT by index threshold.
 *
 * The layer is deterministic-first: every world is measured twice (identical
 * engines), and the two passes must agree bit-for-bit on the quantized macro
 * state sequence and the outcome fingerprint. No RNG beyond the engine's own
 * seeded SplitMix64 streams. Every world runs the archetype ladder (T0 simple
 * rules → T1 constraints → T2 cognition → T3 systems) at 3 cell capacities,
 * so emergence is attributable to the faculty added, exactly like the
 * archetype and complexity labs.
 *
 * Outputs (research/output/): emergence.md/.json/.csv + plots/emergence.svg.
 * Run: npx tsx apps/simulation/src/research/emergence.ts [--quick]
 */

export const EMERGENCE_TICKS = 240;
export const EMERGENCE_SPAWN = 40;
export const EMERGENCE_SEEDS = ['archetypes.s1', 'archetypes.s2', 'archetypes.s3'];
export const EMERGENCE_CAPACITIES = [60, 150, 400] as const;

/** fine-grained occupancy lattice (the terrain grid itself) */
const MICRO_LATTICE = TERRAIN_GRID; // 128
const M_CELL = TERRAIN_CELL; // 16 → world 2048
/** coarse lattice used for the aggregation / self-organisation measurement */
const MACRO_LATTICE = 16;
const MACRO_BINS = MACRO_LATTICE * MACRO_LATTICE;
/** equal-width bins per macro scalar when forming macro states */
const MACRO_LEVELS = 8;
/** equal-width bins for micro-information when pairing it with macro states (EI) */
const MICRO_INFO_BINS = 8;
const AUTOCORR_MAX_LAG = 8;
/** bins for trait polarization histograms (aggression/cooperation/risk) */
const TRAIT_BINS = 16;
/** maximum Chebyshev lag probed by the radial correlation length estimator */
const METRIC_CORR_MAXLAG = 8;
/** levels + fixed amplitude range for the alive-series temporal complexity */
const TEMPORAL_LEVELS = 8;
const ALIVE_BIN_RANGE = EMERGENCE_SPAWN * 10;

const outputDir = fileURLToPath(new URL('../../research/output/', import.meta.url));
const plotsDir = join(outputDir, 'plots');

type WorldSpec = ConstructorParameters<typeof Engine>[0];

// ---------------------------------------------------------------------------
// Measurement math (deterministic, exported for the test gate)
// ---------------------------------------------------------------------------

/** LMC complexity — Shannon entropy × squared disequilibrium from equipartition (engine parity). */
export function speciesLmc(counts: number[]): number {
  const tot = counts.reduce((a, b) => a + b, 0);
  if (tot === 0) return 0;
  const n = counts.filter((c) => c > 0).length;
  if (n < 2) return 0;
  let h = 0;
  let diseq = 0;
  const invN = 1 / n;
  for (const c of counts) {
    if (c <= 0) continue;
    const p = c / tot;
    h -= p * Math.log2(p);
    const d = p - invN;
    diseq += d * d;
  }
  return h * diseq;
}

/** equal-width quantizer → bin index in [0, levels). Deterministic. */
export function quantize(value: number, lo: number, hi: number, levels: number): number {
  const span = hi - lo;
  if (!(span > 0)) return 0;
  const t = (value - lo) / span;
  const k = Math.floor(t * levels);
  return Math.max(0, Math.min(levels - 1, k));
}

/** mutual information (bits) from a contingency table (rows × cols). */
export function contingencyMI(counts: number[][]): number {
  if (!counts.length) return 0;
  const cols = counts[0]?.length ?? 0;
  if (cols === 0) return 0;
  let tot = 0;
  for (const row of counts) for (const c of row) tot += c;
  if (!(tot > 0)) return 0;
  const px = counts.map((r) => r.reduce((a, b) => a + b, 0) / tot);
  const py: number[] = new Array(cols).fill(0);
  for (const row of counts) for (let j = 0; j < cols; j++) py[j]! += row[j]! / tot;
  let mi = 0;
  for (let i = 0; i < counts.length; i++) {
    for (let j = 0; j < cols; j++) {
      const p = counts[i]![j]! / tot;
      if (!(p > 0)) continue;
      const ex = px[i]! * py[j]!;
      if (!(ex > 0)) continue;
      mi += p * Math.log2(p / ex);
    }
  }
  return Math.max(0, mi);
}

/** normalised mutual information — MI divided by the marginal entropy of the macro axis. */
export function nmi(mi: number, macroEntropy: number): number {
  if (!(macroEntropy > 1e-9) || !(mi > 1e-9)) return 0;
  return Math.max(0, Math.min(1, mi / macroEntropy));
}

/** aggregation order: 1 − H/log2(bins) over a cell-count lattice — deviation from uniform. */
export function aggregationOrder(countsPerBin: number[], nBins: number): number {
  if (nBins < 2) return 0;
  const h = entropyOf(countsPerBin);
  const hmax = Math.log2(nBins);
  if (!(hmax > 0)) return 0;
  return Math.max(0, Math.min(1, 1 - h / hmax));
}

/** Sørensen similarity of two sets of categorical keys, in [0,1]. */
export function sorensenOverlap<T>(a: Set<T>, b: Set<T>): number {
  if (a.size === 0 && b.size === 0) return 1;
  if (a.size === 0 || b.size === 0) return 0;
  let common = 0;
  for (const x of a) if (b.has(x)) common++;
  return (2 * common) / (a.size + b.size);
}

/** mean Pearson autocorrelation of a series at lags 1..maxLag. */
export function lagAutocorr(xs: number[], maxLag: number): number {
  if (xs.length < 4) return 0;
  const lag = Math.max(1, Math.min(maxLag, Math.floor(xs.length / 3)));
  let sum = 0;
  for (let k = 1; k <= lag; k++) {
    const a = xs.slice(0, xs.length - k);
    const b = xs.slice(k);
    sum += corr(a, b);
  }
  return sum / lag;
}

/** count a distribution over categorical keys → entropy of the counts. */
export function entropyOfMap<T>(map: Map<T, number>): number {
  return entropyOf(
    [...map.values()].filter((c) => c > 0),
  );
}

// --- emergence metrics — pure measurement math (deterministic, test-gated) ---

/** Simpson diversity 1 − Σp² over a count distribution; 0 if < 2 individuals. */
export function simpsonDiversity(counts: number[]): number {
  const tot = counts.reduce((a, b) => a + b, 0);
  if (!(tot > 0)) return 0;
  let sq = 0;
  for (const c of counts) {
    if (c > 0) sq += (c / tot) ** 2;
  }
  return Math.max(0, Math.min(1, 1 - sq));
}

/** polarization from a Shannon entropy against its maximum: 1 − H/Hmax ∈ [0,1]. */
export function entropyToPolarization(h: number, hmax: number): number {
  if (!(hmax > 1e-9)) return 0;
  return Math.max(0, Math.min(1, 1 - h / hmax));
}

/**
 * Lempel–Ziv 76 "production complexity" c(n): the number of distinct phrases
 * in the incremental parsing of a sequence. Deterministic; O(n²) worst case.
 */
export function lempelZivComplexity(seq: number[]): number {
  const n = seq.length;
  if (n === 0) return 0;
  let c = 1;
  let l = 1;
  let i = 0;
  let k = 1;
  let kmax = 1;
  while (true) {
    if (i + k > n || l + k > n) {
      c++;
      break;
    }
    if (seq[i + k - 1] === seq[l + k - 1]) {
      k++;
      if (k > kmax) kmax = k;
    } else {
      if (k > kmax) kmax = k;
      i++;
      if (i === l) {
        c++;
        l += kmax;
        if (l >= n) break;
        i = 0;
        k = 1;
        kmax = 1;
      } else {
        k = 1;
      }
    }
  }
  return c;
}

/** normalised LZ complexity: c(n)·log2(alphabet)/n, clamped to [0,1]. */
export function normalizedLz(seq: number[], alphabet: number): number {
  if (seq.length < 2 || alphabet < 2) return 0;
  const c = lempelZivComplexity(seq);
  return Math.max(0, Math.min(1, (c * Math.log2(alphabet)) / seq.length));
}

/**
 * global Moran's I over a row-major square lattice with rook (4-neighbour)
 * adjacency, no wrap: positive = clustered, negative = segregated, ~0 = random.
 */
export function moranI(grid: ArrayLike<number>, size: number): number {
  const N = grid.length;
  if (N < 4) return 0;
  let mean = 0;
  for (let i = 0; i < N; i++) mean += grid[i]!;
  mean /= N;
  let z2 = 0;
  const z = new Array(N).fill(0);
  for (let idx = 0; idx < N; idx++) {
    const d = grid[idx]! - mean;
    z[idx] = d;
    z2 += d * d;
  }
  if (!(z2 > 1e-12)) return 0;
  let num = 0;
  let wsum = 0;
  for (let r = 0; r < size; r++) {
    const row = r * size;
    for (let c = 0; c < size; c++) {
      const idx = row + c;
      const zi = z[idx]!;
      if (r > 0) {
        num += 2 * zi * z[idx - size]!;
        wsum += 2;
      }
      if (r < size - 1) {
        num += 2 * zi * z[idx + size]!;
        wsum += 2;
      }
      if (c > 0) {
        num += 2 * zi * z[idx - 1]!;
        wsum += 2;
      }
      if (c < size - 1) {
        num += 2 * zi * z[idx + 1]!;
        wsum += 2;
      }
    }
  }
  if (!(wsum > 0)) return 0;
  const I = (N / wsum) * (num / z2);
  return Math.max(-1, Math.min(1, I));
}

/** contagion/aggregation index: fraction of neighbour slots around occupied cells that are also occupied. */
export function contagionIndex(grid: ArrayLike<number>, size: number): number {
  let slots = 0;
  let hits = 0;
  for (let r = 0; r < size; r++) {
    const row = r * size;
    for (let c = 0; c < size; c++) {
      if (grid[row + c]! <= 0) continue;
      if (r > 0) {
        slots++;
        if (grid[row - size + c]! > 0) hits++;
      }
      if (r < size - 1) {
        slots++;
        if (grid[row + size + c]! > 0) hits++;
      }
      if (c > 0) {
        slots++;
        if (grid[row + c - 1]! > 0) hits++;
      }
      if (c < size - 1) {
        slots++;
        if (grid[row + c + 1]! > 0) hits++;
      }
    }
  }
  return slots > 0 ? hits / slots : 0;
}

/** fraction of lattice cells that are occupied (value > 0). */
export function fillFactor(grid: ArrayLike<number>): number {
  if (grid.length === 0) return 0;
  let occ = 0;
  for (let i = 0; i < grid.length; i++) if (grid[i]! > 0) occ++;
  return occ / grid.length;
}

/**
 * radial spatial correlation length: the first Chebyshev lag at which the
 * normalised spatial autocovariance decays below 1/e of its own scale.
 * Returns maxLag when long-range (never breaks), and a sub-cell estimate
 * (< 1) when nearest neighbours already decorrelate.
 */
export function radialCorrelationLength(grid: ArrayLike<number>, size: number, maxLag: number): number {
  const N = grid.length;
  if (N < 4 || maxLag < 1) return 0;
  let mean = 0;
  for (let i = 0; i < N; i++) mean += grid[i]!;
  mean /= N;
  let z2 = 0;
  for (let i = 0; i < N; i++) {
    const d = grid[i]! - mean;
    z2 += d * d;
  }
  if (!(z2 > 1e-12)) return 0;
  const acc = new Array(maxLag + 1).fill(0);
  const cnt = new Array(maxLag + 1).fill(0);
  for (let i = 0; i < N; i++) {
    const ri = (i / size) | 0;
    const ci = i % size;
    const zi = grid[i]! - mean;
    for (let j = i + 1; j < N; j++) {
      const rj = (j / size) | 0;
      const cj = j % size;
      const d = Math.max(Math.abs(ri - rj), Math.abs(ci - cj));
      if (d >= 1 && d <= maxLag) {
        acc[d]! += zi * (grid[j]! - mean);
        cnt[d]! += 1;
      }
    }
  }
  const thresh = Math.exp(-1);
  for (let d = 1; d <= maxLag; d++) {
    const C = cnt[d]! > 0 ? acc[d]! / cnt[d]! / z2 : 0;
    if (C <= thresh) return d === 1 ? (C > 1e-9 ? 1 : 0.5) : d - 1 + (C > 0 ? 1 : 0);
  }
  return maxLag;
}

/** compressibility ratio 1 − compressed/raw over byte sizes, clamped to [0,1]. */
export function compressibilityRatio(rawBytes: number, compressedBytes: number): number {
  if (!(rawBytes > 0)) return 0;
  return Math.max(0, Math.min(1, 1 - compressedBytes / rawBytes));
}

// ---------------------------------------------------------------------------
// Macro-state detector (population level, deliberately not agent level)
// ---------------------------------------------------------------------------
//
// The metric axes above are built from AGENT-level primitives: which species
// an individual is, where it sits, what its traits and energy are. The
// macro-state detector asks a different question -- what state is the
// population-as-a-system in -- so it reads only aggregate scalars (alive
// fraction, species count, mean energy, donation ratio, meme entropy), the coarse
// occupancy lattice, and the sequence of quantized macro states the system
// visits. It never inspects an individual agent.
//
// Five stages, in the order a system is expected to acquire them:
//
//   random      no macroscopic structure: coarse occupancy near uniform and the
//               system re-visits many distinct macro states.
//   clustered   the population condenses in space -- coarse occupancy becomes
//               non-uniform -- while macro states are still fluid.
//   organized   spatial structure plus coordination: donations and a settled
//               cultural field, with macro states beginning to repeat.
//   specialized spatial structure AND temporal rigidity: the macro-state
//               sequence collapses onto a few recurrent states.
//   collapsed   the population cannot hold its own normal level of alive fraction,
//               species count or mean energy. Judged against the run's own median
//               so the initial spawn burst cannot masquerade as a normal level.
//               Not absorbing: these populations do sometimes recover.
//
// collapsed overrides the structural stages, because losing the population
// destroys structure instead of reporting more of it.
//
// Every raw population scalar is normalized against the run itself, so the
// stages mean the same thing at any cell capacity or spawn count.

/** one tick of the population observed as a single system; no per-agent data */
export interface MacroFrame {
  /** living individuals over population, 0..1 */
  aliveFrac: number;
  /** distinct species alive, raw count */
  speciesFrac: number;
  /** mean energy per agent, raw units */
  energyFrac: number;
  /** donations over energy, a raw ratio (not bounded to 1) */
  cooperation: number;
  /** Shannon entropy of the meme field, in bits (may exceed 1) */
  memeEntropy: number;
  /** non-uniformity of the coarse occupancy lattice; 0 = uniform */
  occOrder: number;
  /** structure surviving coarse-graining: 1 - H_coarse / H_fine */
  coarseFine: number;
}

export type MacroRegime = 'random' | 'clustered' | 'organized' | 'specialized' | 'collapsed';

export const MACRO_REGIMES: readonly MacroRegime[] = ['random', 'clustered', 'organized', 'specialized', 'collapsed'];

/** spatial structure thresholds separating the four structural stages */
const MACRO_STAGE_CLUSTERED = 0.3;
const MACRO_STAGE_ORGANIZED = 0.42;
const MACRO_STAGE_SPECIALIZED = 0.55;
/** temporal rigidity a structured population needs before it counts as specialized */
const MACRO_RIGID_SPECIALIZED = 0.6;
/** a run is collapsed once it sustains this share of its own peak level */
const MACRO_COLLAPSE_RATIO = 0.6;
/** trailing window, as a share of the run, used for sustained levels */
const MACRO_WINDOW = 0.1;
/** quantile of a run's sustained levels taken as its normal level, for collapse */
const MACRO_REFERENCE_Q = 0.75;

export interface MacroStateSummary {
  /** per-tick regime labels */
  sequence: MacroRegime[];
  /** distinct regimes in order of first appearance */
  progression: MacroRegime[];
  /** regime holding the largest share of ticks; ties resolve to the later stage */
  dominant: MacroRegime;
  /** regime of the final tick */
  final: MacroRegime;
  fractions: Record<MacroRegime, number>;
  /**
   * Raw regime changes between consecutive ticks, so a population hovering on a
   * threshold is visible as a high count. Use `progression` for the trajectory
   * and `fractions` for occupancy.
   */
  transitions: number;
  /** mean spatial structure, 0..1 */
  spatialStructure: number;
  /** mean population-level coordination, 0..1 */
  coordination: number;
  /** share of ticks spent in the most-visited quarter of macro states, 0..1 */
  rigidity: number;
  /** mean lag-1 agreement of the macro-state sequence, 0..1 */
  persistence: number;
  /** composite macro organization: mean(spatial, coordination, rigidity, persistence) */
  organization: number;
  /** highest sustained alive fraction, ignoring the spawn transient */
  peakAliveFrac: number;
  /**
   * Level the population held for most of the run, the yardstick `collapsed` is
   * judged against: a run is collapsed only once it cannot hold this share of
   * itself.
   */
  referenceAliveFrac: number;
  terminalAliveFrac: number;
  /** terminal over sustained peak alive fraction, 0..1 */
  vitality: number;
  /** first tick labelled collapsed, or -1 if the population always held its level */
  firstCollapseTick: number;
  /** population-scale spatial order: mean coarse-occupancy non-uniformity */
  macroOrder: number;
  /** agent-scale order blend, supplied by the caller so the levels can be contrasted */
  agentOrder: number;
  /** |macroOrder - agentOrder|: how far the two levels of description disagree */
  divergence: number;
}

/** share of ticks spent in the most-visited quarter of the visited macro states */
export function macroRigidity(states: ArrayLike<number>): number {
  const n = states.length;
  if (n === 0) return 0;
  const hist = new Map<number, number>();
  for (let i = 0; i < n; i++) {
    const s = states[i]!;
    hist.set(s, (hist.get(s) ?? 0) + 1);
  }
  const counts = [...hist.values()].sort((a, b) => b - a);
  const k = Math.max(1, Math.ceil(counts.length / 4));
  let top = 0;
  for (let i = 0; i < k; i++) top += counts[i]!;
  return top / n;
}

/** mean lag-1 agreement of the macro-state sequence: how repeatable the trajectory is */
export function macroStatePersistence(states: ArrayLike<number>): number {
  const n = states.length;
  if (n < 2) return 0;
  let same = 0;
  for (let i = 1; i < n; i++) if (states[i] === states[i - 1]) same++;
  return same / (n - 1);
}

/**
 * The level a run held for at least a q share of its life, used as its "normal
 * level". A high quantile is robust in both directions: the spawn transient
 * cannot become the reference, and neither can a long dead tail.
 */
export function sustainedReference(values: ArrayLike<number>, q = MACRO_REFERENCE_Q): number {
  const n = values.length;
  if (n === 0) return 0;
  const s = Array.from(values).sort((a, b) => a - b);
  const pos = Math.min(n - 1, Math.max(0, Math.round(q * (n - 1))));
  return s[pos]!;
}

/** mean of the trailing share of a series, used as the terminal level */
function tailMean(values: ArrayLike<number>, tailFrac: number): number {
  const n = values.length;
  if (n === 0) return 0;
  const t = Math.max(1, Math.floor(n * tailFrac));
  let sum = 0;
  for (let i = n - t; i < n; i++) sum += values[i]!;
  return sum / t;
}

/**
 * Highest SUSTAINED level of a raw series: the largest trailing-window mean.
 * A one-tick spike (such as every spawned agent being alive at tick 0) cannot
 * reach it, so a run that simply settles below its spawn burst is not mistaken
 * for a collapse.
 */
export function sustainedPeak(values: ArrayLike<number>, windowFrac: number = MACRO_WINDOW): number {
  const n = values.length;
  if (n === 0) return 0;
  const w = Math.max(1, Math.floor(n * windowFrac));
  let sum = 0;
  for (let i = 0; i < w; i++) sum += values[i]!;
  let best = sum / w;
  for (let i = w; i < n; i++) {
    sum += values[i]! - values[i - w]!;
    const m = sum / w;
    if (m > best) best = m;
  }
  return best;
}

/**
 * Trailing-window means of a raw series, so a momentary dip cannot be read as
 * a sustained loss. Index i is the mean over the last 'windowFrac of the run.
 */
export function sustainedSeries(values: ArrayLike<number>, windowFrac: number = MACRO_WINDOW): number[] {
  const n = values.length;
  if (n === 0) return [];
  const w = Math.max(1, Math.floor(n * windowFrac));
  const out: number[] = new Array(n);
  let sum = 0;
  for (let i = 0; i < n; i++) {
    sum += values[i]!;
    if (i >= w) sum -= values[i - w]!;
    out[i] = sum / Math.min(i + 1, w);
  }
  return out;
}

/** the structural stage decision, given spatial structure and macro-state rigidity */
export function classifyMacroRegime(spatial: number, rigidity: number, collapsed: boolean): MacroRegime {
  if (collapsed) return 'collapsed';
  if (spatial >= MACRO_STAGE_SPECIALIZED && rigidity >= MACRO_RIGID_SPECIALIZED) return 'specialized';
  if (spatial >= MACRO_STAGE_ORGANIZED) return 'organized';
  if (spatial >= MACRO_STAGE_CLUSTERED) return 'clustered';
  return 'random';
}

function emptyMacroState(agentOrder: number): MacroStateSummary {
  return {
    sequence: [],
    progression: [],
    dominant: 'random',
    final: 'random',
    fractions: { random: 0, clustered: 0, organized: 0, specialized: 0, collapsed: 0 },
    transitions: 0,
    spatialStructure: 0,
    coordination: 0,
    rigidity: 0,
    persistence: 0,
    organization: 0,
    peakAliveFrac: 0,
    referenceAliveFrac: 0,
    terminalAliveFrac: 0,
    vitality: 0,
    firstCollapseTick: -1,
    macroOrder: 0,
    agentOrder,
    divergence: Math.abs(agentOrder),
  };
}

/**
 * Classify a run into the macro-state progression. 'frames' must hold the per-tick
 * population aggregates, 'states' the per-tick quantized macro-state index, and
 * 'agentOrder' the agent-level order blend so the two levels of description are
 * contrasted rather than conflated. Deterministic: no RNG, and every threshold is
 * either a fixed constant or derived from the run itself.
 */
export function detectMacroStates(frames: MacroFrame[], states: ArrayLike<number>, agentOrder: number): MacroStateSummary {
  const n = Math.min(frames.length, states.length);
  if (n === 0) return emptyMacroState(agentOrder);

  const alive = new Array<number>(n);
  const coop = new Array<number>(n);
  const meme = new Array<number>(n);
  const species = new Array<number>(n);
  const energy = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    alive[i] = frames[i]!.aliveFrac;
    coop[i] = frames[i]!.cooperation;
    meme[i] = frames[i]!.memeEntropy;
    species[i] = frames[i]!.speciesFrac;
    energy[i] = frames[i]!.energyFrac;
  }

  // sustained levels, so the initial spawn burst and single-tick noise are ignored
  const aliveS = sustainedSeries(alive);
  const speciesS = sustainedSeries(species);
  const energyS = sustainedSeries(energy);
  const peakAlive = sustainedPeak(alive);
  const peakCoop = sustainedPeak(coop);
  const peakMeme = sustainedPeak(meme);

  const rigidity = macroRigidity(states);
  const persistence = macroStatePersistence(states);

  const rawLabels: MacroRegime[] = new Array(n);
  let spatialSum = 0;
  let coordSum = 0;
  let occSum = 0;
  for (let i = 0; i < n; i++) {
    const f = frames[i]!;
    const spatial = 0.5 * f.occOrder + 0.5 * f.coarseFine;
    spatialSum += spatial;
    occSum += f.occOrder;

    // coordination: donation output near its own sustained best, plus a cultural
    // field settled well below its own entropy peak. No cultural field at all
    // means nothing to converge, so it scores 0 rather than a free 1.
    const coopOrder = peakCoop > 1e-12 ? Math.max(0, Math.min(1, coop[i]! / peakCoop)) : 0;
    const memeOrder = peakMeme > 1e-12 ? Math.max(0, Math.min(1, 1 - meme[i]! / peakMeme)) : 0;
    coordSum += 0.5 * coopOrder + 0.5 * memeOrder;

    rawLabels[i] = classifyMacroRegime(spatial, rigidity, false);
  }

  // collapse is a run-level loss of vitality, judged on sustained levels. The
  // yardstick is the level the run held for most of its life, not its peak: a
  // run that simply settles below its spawn burst, or below its own early
  // energy maximum, is not collapsing. Collapse is NOT absorbing -- these
  // populations do recover, and a recovered run must not keep reporting it.
  const sequence = rawLabels.slice();
  const refAlive = sustainedReference(aliveS);
  const refSpecies = sustainedReference(speciesS);
  const refEnergy = sustainedReference(energyS);
  let collapseTick = -1;
  for (let i = 0; i < n; i++) {
    const weak = refAlive > 1e-12 && aliveS[i]! < MACRO_COLLAPSE_RATIO * refAlive;
    const starved = refSpecies > 1e-12 && refEnergy > 1e-12 && speciesS[i]! < 0.5 * refSpecies && energyS[i]! < 0.5 * refEnergy;
    const collapsed = weak || starved;
    if (collapsed && collapseTick < 0) collapseTick = i;
    if (collapsed) sequence[i] = 'collapsed';
  }

  const fractions: Record<MacroRegime, number> = { random: 0, clustered: 0, organized: 0, specialized: 0, collapsed: 0 };
  for (let i = 0; i < n; i++) fractions[sequence[i]!] += 1;
  for (const r of MACRO_REGIMES) fractions[r] /= n;

  const progression: MacroRegime[] = [];
  const seen = new Set<MacroRegime>();
  let transitions = 0;
  for (let i = 0; i < n; i++) {
    const r = sequence[i]!;
    if (i > 0 && r !== sequence[i - 1]) transitions++;
    if (!seen.has(r)) {
      seen.add(r);
      progression.push(r);
    }
  }

  let dominant: MacroRegime = 'random';
  // ties resolve toward the later stage, so an evenly-occupied run is reported
  // at the most structured reading its trajectory actually supports
  for (const r of MACRO_REGIMES) if (fractions[r] >= fractions[dominant]) dominant = r;

  const terminal = tailMean(alive, 0.2);
  const spatialStructure = spatialSum / n;
  const coordination = coordSum / n;
  const macroOrder = occSum / n;
  return {
    sequence,
    progression,
    dominant,
    final: sequence[n - 1]!,
    fractions,
    transitions,
    spatialStructure,
    coordination,
    rigidity,
    persistence,
    organization: (spatialStructure + coordination + rigidity + persistence) / 4,
    peakAliveFrac: peakAlive,
    referenceAliveFrac: refAlive,
    terminalAliveFrac: terminal,
    vitality: peakAlive > 1e-12 ? terminal / peakAlive : 0,
    firstCollapseTick: collapseTick,
    macroOrder,
    agentOrder,
    divergence: Math.abs(macroOrder - agentOrder),
  };
}



// Emergence object types
// ---------------------------------------------------------------------------

export interface EmergenceAxis {
  raw: number;
  norm: number;
}

export interface EmergenceAxes {
  microInfo: EmergenceAxis;
  macroInfo: EmergenceAxis;
  complexity: EmergenceAxis;
  selfOrganization: EmergenceAxis;
  temporalPersistence: EmergenceAxis;
}

export interface EmergenceMetrics {
  /** (a) order/polarization: spatial order + species dominance + trait polarization. */
  orderPolarization: { order: number; speciesPolarization: number; traitPolarization: number; value: number };
  /** (b) spatial clustering: contagion/aggregation, Moran's I, fill factor, radial correlation length. */
  spatialClustering: { aggregationIndex: number; moranI: number; fillFactor: number; correlationLength: number };
  /** (c) diversity/entropy: Shannon/Simpson/evenness of species, trait entropy, spatial entropy. */
  diversity: { shannonDiversity: number; simpsonDiversity: number; evenness: number; traitEntropy: number; spatialEntropy: number };
  /** (d) information: entropy resident in composition, positions, culture and the macro state. */
  information: { compositionBits: number; spatialBits: number; culturalBits: number; stateBits: number; totalBits: number };
  /** (e) complexity: entropy, compressibility, Lempel–Ziv, correlation length, temporal complexity. */
  complexity: {
    entropy: number;
    compressibility: number;
    lzComplexity: number;
    lzComplexityNormalized: number;
    correlationLength: number;
    temporalComplexity: number;
    meanAutocorr: number;
  };
}

export interface EmergenceTracePoint {
  tick: number;
  aliveCount: number;
  microInfo: number;
  complexity: number;
  aggregation: number;
  macroState: number;
}

export interface EmergenceMeasurement {
  world: { tier: number; tierName: string; seed: string; capacity: number; spawn: number; ticks: number };
  axes: EmergenceAxes;
  metrics: EmergenceMetrics;
  /** population-level regime classification; distinct from the agent-level metrics above */
  macroState: MacroStateSummary;
  components: { speciesSupport: number; distinctMacroStates: number; survival: number; autocorr: number; overlap: number; aggOrder: number; coarseFine: number; nmiSync: number; nmiPredictive: number };
  emergentInformation: { sync: number; predictive: number; miBitsSync: number; miBitsPredictive: number };
  emergenceIndex: number;
  verdict: 'ABSENT' | 'PARTIAL' | 'EMERGENT';
  deterministic: boolean;
  fingerprint: string;
  trace: EmergenceTracePoint[];
}

export interface EmergenceRow extends Omit<EmergenceMeasurement, 'trace'> {
  fingerprint: string;
}

export interface EmergenceReport {
  mode: 'quick' | 'full';
  ticks: number;
  spawn: number;
  measurements: Record<string, EmergenceMeasurement>;
  rows: EmergenceRow[];
  pass: boolean;
}

const VERDICT_PARTIAL = 0.22;
const VERDICT_EMERGENT = 0.4;

export function verdictFor(index: number): EmergenceMeasurement['verdict'] {
  if (index >= VERDICT_EMERGENT) return 'EMERGENT';
  if (index >= VERDICT_PARTIAL) return 'PARTIAL';
  return 'ABSENT';
}

// ---------------------------------------------------------------------------
// Measurement core — two identical passes (calibration then measurement)
// ---------------------------------------------------------------------------

interface Calibration {
  min: number[];
  max: number[];
  speciesSupport: number;
}

function makeEngine(world: WorldSpec, tierIdx: number): Engine {
  const tier = TIER_DEFS[tierIdx]!;
  const engine = new Engine(world);
  engine.setBrainConfig({ enabled: tier.brain, ...(tier.brain ? { learn: 'backprop' } : {}) });
  if (tier.clones) {
    const g0 = feedGenome({ diet: 1 });
    for (const a of engine.agents.values()) {
      a.genome.set(g0.subarray(0, Math.min(a.genome.length, g0.length)));
      a.meme = 0.5;
    }
  }
  return engine;
}

/** five-dimensional macro summary used to form the quantized macro state index. */
function macroVector(s: SimStats): number[] {
  return [
    s.population > 0 ? s.aliveCount / s.population : 0,
    s.speciesCount,
    s.avgEnergy,
    s.cooperation,
    s.memeEntropy,
  ];
}

function macroStateIndex(s: SimStats, cal: Calibration): number {
  let idx = 0;
  const v = macroVector(s);
  for (let i = 0; i < v.length; i++) {
    idx = idx * MACRO_LEVELS + quantize(v[i]!, cal.min[i], cal.max[i], MACRO_LEVELS);
  }
  return idx;
}

function snapshotMacroStates(world: WorldSpec, tierIdx: number, ticks: number): { cal: Calibration; states: number[] } {
  const engine = makeEngine(world, tierIdx);
  const dims = 5;
  const min = new Array(dims).fill(Infinity);
  const max = new Array(dims).fill(-Infinity);
  const vectors: number[][] = [];
  let speciesSupport = 0;
  for (let t = 0; t < ticks; t++) {
    engine.tick();
    const s = engine.stats();
    const v = macroVector(s);
    for (let i = 0; i < dims; i++) {
      if (v[i]! < min[i]!) min[i] = v[i];
      if (v[i]! > max[i]!) max[i] = v[i];
    }
    if (s.speciesCount > speciesSupport) speciesSupport = s.speciesCount;
    vectors.push(v);
  }
  // index every state with the FINAL settled range so pass-1 and pass-2 agree.
  const states = vectors.map((v) => {
    let idx = 0;
    for (let i = 0; i < dims; i++) idx = idx * MACRO_LEVELS + quantize(v[i]!, min[i]!, max[i]!, MACRO_LEVELS);
    return idx;
  });
  return { cal: { min, max, speciesSupport }, states };
}

export function measureEmergence(world: WorldSpec, tierIdx: number, ticks: number): EmergenceMeasurement {
  const tier = TIER_DEFS[tierIdx]!;

  // pass 1 — calibrate macro-scalar ranges and the macro state space.
  const { cal, states: pass1States } = snapshotMacroStates(world, tierIdx, ticks);

  // pass 2 — identical trajectory; the real measurement.
  const engine = makeEngine(world, tierIdx);
  const trace: EmergenceTracePoint[] = [];
  const aliveSeries: number[] = [];
  const pass2States: number[] = [];

  // per-tick POPULATION aggregates, consumed by the macro-state detector
  const macroFrames: MacroFrame[] = [];

  const macroHist = new Map<number, number>();
  const microSamples: number[] = [];

  let microHsum = 0;
  let hSppSum = 0;
  let hCellSum = 0;
  let simpsonSum = 0;
  let evennessSum = 0;
  let polarizationSppSum = 0;
  let traitPolarSum = 0;
  let aggressionEntropySum = 0;
  let memeSum = 0;
  let lmcSum = 0;
  let aggSum = 0;
  let coarseFineSum = 0;
  let aliveTicks = 0;
  const speciesSetFirst = new Set<number>();
  const speciesSetSecond = new Set<number>();
  let speciesSupport = 0;

  const cellCounts = new Map<number, number>();
  const coarseCounts = new Map<number, number>();
  const speciesCounts = new Map<number, number>();
  const coarseHeat = new Float64Array(MACRO_BINS);
  const traitMaps: Array<Map<number, number>> = [new Map(), new Map(), new Map()];

  for (let t = 0; t < ticks; t++) {
    engine.tick();
    const s = engine.stats();
    const mIdx = macroStateIndex(s, cal);
    pass2States.push(mIdx);
    macroHist.set(mIdx, (macroHist.get(mIdx) ?? 0) + 1);

    cellCounts.clear();
    coarseCounts.clear();
    speciesCounts.clear();

    for (const a of engine.agents.values()) {
      if (!a.alive) continue;
      speciesCounts.set(a.species, (speciesCounts.get(a.species) ?? 0) + 1);
      const gx = Math.floor(a.x / M_CELL) % MICRO_LATTICE;
      const gy = Math.floor(a.y / M_CELL) % MICRO_LATTICE;
      const idx = gy * MICRO_LATTICE + gx;
      cellCounts.set(idx, (cellCounts.get(idx) ?? 0) + 1);
      const cx = Math.floor(a.x / (M_CELL * (MICRO_LATTICE / MACRO_LATTICE))) % MACRO_LATTICE;
      const cy = Math.floor(a.y / (M_CELL * (MICRO_LATTICE / MACRO_LATTICE))) % MACRO_LATTICE;
      const cidx = cy * MACRO_LATTICE + cx;
      coarseCounts.set(cidx, (coarseCounts.get(cidx) ?? 0) + 1);
      const traits = a.strategy;
      if (traits) {
        for (let q = 0; q < 3; q++) {
          const v = q === 0 ? traits.aggression : q === 1 ? traits.cooperation : traits.risk;
          const bin = Math.max(0, Math.min(TRAIT_BINS - 1, Math.floor(v * TRAIT_BINS)));
          traitMaps[q]!.set(bin, (traitMaps[q]!.get(bin) ?? 0) + 1);
        }
      }
    }

    if (s.aliveCount > 0) aliveTicks++;
    aliveSeries.push(s.aliveCount);

    const spCounts = [...speciesCounts.values()];
    const hSpp = entropyOf(spCounts);
    const hCell = entropyOf([...cellCounts.values()]);
    const hCoarse = entropyOf([...coarseCounts.values()]);
    const hMicro = hSpp + hCell;
    microHsum += hMicro;
    microSamples.push(hMicro);
    hSppSum += hSpp;
    hCellSum += hCell;
    lmcSum += speciesLmc(spCounts);
    aggSum += aggregationOrder([...coarseCounts.values()], MACRO_BINS);
    coarseFineSum += hCoarse > 1e-12 && hCell > 1e-12 ? Math.max(0, 1 - hCoarse / hCell) : 0;
    memeSum += s.memeEntropy;

    // macro-state detector input: population aggregates only, no per-agent data.
    macroFrames.push({
      aliveFrac: s.population > 0 ? s.aliveCount / s.population : 0,
      speciesFrac: s.speciesCount,
      energyFrac: s.avgEnergy,
      cooperation: s.cooperation,
      memeEntropy: s.memeEntropy,
      occOrder: aggregationOrder([...coarseCounts.values()], MACRO_BINS),
      coarseFine: hCoarse > 1e-12 && hCell > 1e-12 ? Math.max(0, 1 - hCoarse / hCell) : 0,
    });

    const totSpp = spCounts.reduce((a, b) => a + b, 0);
    const nSppAlive = speciesCounts.size;
    if (totSpp > 0) {
      simpsonSum += simpsonDiversity(spCounts);
      const hmaxSpp = nSppAlive > 1 ? Math.log2(nSppAlive) : 0;
      polarizationSppSum += entropyToPolarization(hSpp, hmaxSpp);
      evennessSum += hmaxSpp > 0 ? Math.min(1, hSpp / hmaxSpp) : 0;
    }
    const hTraitMax = Math.log2(TRAIT_BINS);
    let traitPol = 0;
    for (let q = 0; q < 3; q++) {
      traitPol += entropyToPolarization(entropyOf([...traitMaps[q]!.values()]), hTraitMax) / 3;
    }
    traitPolarSum += traitPol;
    aggressionEntropySum += entropyOf([...traitMaps[0]!.values()]);
    for (const tm of traitMaps) tm.clear();
    for (const cidx of coarseCounts.keys()) coarseHeat[cidx]! += 1;

    if (t < ticks / 2) {
      for (const sp of speciesCounts.keys()) speciesSetFirst.add(sp);
    } else {
      for (const sp of speciesCounts.keys()) speciesSetSecond.add(sp);
    }
    if (speciesCounts.size > speciesSupport) speciesSupport = speciesCounts.size;

    trace.push({ tick: t, aliveCount: s.aliveCount, microInfo: hMicro, complexity: lmcSum / (t + 1), aggregation: aggSum / (t + 1), macroState: mIdx });
  }

  const macroEntropy = entropyOfMap(macroHist);
  const distinctMacroStates = macroHist.size;
  const survival = aliveTicks / ticks;
  const autocorr = lagAutocorr(aliveSeries, AUTOCORR_MAX_LAG);
  const overlap = sorensenOverlap(speciesSetFirst, speciesSetSecond);
  const deterministic = pass2States.length === pass1States.length && pass2States.every((v, i) => v === pass1States[i]);

  // emergent information — quantized micro-information value (8 bins) vs macro
  // state: sync I(µ;M) and predictive I(µ(t); M(t+1)), both normalised by H(M).
  const columnOf = new Map<number, number>();
  const macroStatesSeen = new Set(pass2States);
  for (const st of macroStatesSeen) columnOf.set(st, columnOf.size);
  const syncRows = new Map<number, number[]>();
  const predRows = new Map<number, number[]>();
  const microLo = Math.min(...microSamples);
  const microHi = Math.max(...microSamples);
  for (let t = 0; t < ticks; t++) {
    const b = quantize(microSamples[t]!, microLo, microHi, MICRO_INFO_BINS);
    let sRow = syncRows.get(b);
    if (!sRow) {
      sRow = new Array(columnOf.size).fill(0);
      syncRows.set(b, sRow);
    }
    sRow[columnOf.get(pass2States[t]!)!]! += 1;
    if (t < ticks - 1) {
      let pRow = predRows.get(b);
      if (!pRow) {
        pRow = new Array(columnOf.size).fill(0);
        predRows.set(b, pRow);
      }
      pRow[columnOf.get(pass1States[t + 1]!)!]! += 1;
    }
  }

  const miSync = contingencyMI([...syncRows.values()]);
  const miPred = contingencyMI([...predRows.values()]);
  const nmiSync = nmi(miSync, macroEntropy);
  const nmiPredictive = nmi(miPred, macroEntropy);

  // --- emergence metrics (a–e) ------------------------------------------------
  const correlationLength = radialCorrelationLength(coarseHeat, MACRO_LATTICE, METRIC_CORR_MAXLAG);
  const order = aggSum / ticks;
  const speciesPolarization = polarizationSppSum / ticks;
  const traitPolarization = traitPolarSum / ticks;
  const aggregationIndex = contagionIndex(coarseHeat, MACRO_LATTICE);
  const moranISpatial = moranI(coarseHeat, MACRO_LATTICE);
  const compositionBits = hSppSum / ticks;
  const spatialBits = hCellSum / ticks;
  const culturalBits = memeSum / ticks;
  const shannonDiversity = compositionBits;
  const traitEntropy = aggressionEntropySum / ticks;

  const stateSeq: number[] = pass2States;
  const rawState = new Uint8Array(stateSeq.length * 2);
  for (let i = 0; i < stateSeq.length; i++) {
    rawState[i * 2] = stateSeq[i]! & 0xff;
    rawState[i * 2 + 1] = (stateSeq[i]! >> 8) & 0xff;
  }
  const compressibility = compressibilityRatio(rawState.length, deflateSync(rawState, { level: 9 }).length);
  const binnedAlive = aliveSeries.map((v) => quantize(v, 0, ALIVE_BIN_RANGE, TEMPORAL_LEVELS));

  const metrics: EmergenceMetrics = {
    orderPolarization: {
      order,
      speciesPolarization,
      traitPolarization,
      value: (order + speciesPolarization + traitPolarization) / 3,
    },
    spatialClustering: {
      aggregationIndex,
      moranI: moranISpatial,
      fillFactor: fillFactor(coarseHeat),
      correlationLength,
    },
    diversity: {
      shannonDiversity,
      simpsonDiversity: simpsonSum / ticks,
      evenness: evennessSum / ticks,
      traitEntropy,
      spatialEntropy: spatialBits,
    },
    information: {
      compositionBits,
      spatialBits,
      culturalBits,
      stateBits: macroEntropy,
      totalBits: compositionBits + spatialBits + culturalBits,
    },
    complexity: {
      entropy: shannonDiversity,
      compressibility,
      lzComplexity: lempelZivComplexity(stateSeq),
      lzComplexityNormalized: normalizedLz(stateSeq, distinctMacroStates),
      correlationLength,
      temporalComplexity: normalizedLz(binnedAlive, TEMPORAL_LEVELS),
      meanAutocorr: autocorr,
    },
  };

  const nCells = MICRO_LATTICE * MICRO_LATTICE;
  const spMaxEntropy = Math.log2(1 + speciesSupport);
  const cellMaxEntropy = Math.log2(nCells);
  const macroMaxEntropy = Math.log2(Math.max(1, distinctMacroStates));

  const axes: EmergenceAxes = {
    microInfo: { raw: microHsum / ticks, norm: Math.min(1, (microHsum / ticks) / Math.max(1e-9, spMaxEntropy + cellMaxEntropy)) },
    macroInfo: { raw: macroEntropy, norm: Math.min(1, macroEntropy / Math.max(1e-9, macroMaxEntropy)) },
    complexity: { raw: lmcSum / ticks, norm: Math.min(1, lmcSum / ticks / Math.max(1e-9, spMaxEntropy)) },
    selfOrganization: { raw: (aggSum + coarseFineSum) / (2 * ticks), norm: Math.min(1, (aggSum + coarseFineSum) / (2 * ticks)) },
    temporalPersistence: { raw: (survival + Math.max(0, autocorr) + overlap) / 3, norm: (survival + Math.max(0, autocorr) + overlap) / 3 },
  };

  const emergenceIndex =
    (axes.microInfo.norm + axes.macroInfo.norm + axes.complexity.norm + axes.selfOrganization.norm + axes.temporalPersistence.norm) / 5;

  // macro-state detector: classify the run at the POPULATION level and contrast
  // it with the agent-level order blend rather than folding the two together.
  const macroState = detectMacroStates(macroFrames, pass2States, metrics.orderPolarization.value);

  const measurement: EmergenceMeasurement = {
    world: { tier: tierIdx, tierName: tier.name, seed: world.seed, capacity: world.params.energyCapacity, spawn: world.params.spawnCount, ticks },
    axes,
    metrics,
    macroState,
    components: {
      speciesSupport,
      distinctMacroStates,
      survival,
      autocorr,
      overlap,
      aggOrder: aggSum / ticks,
      coarseFine: coarseFineSum / ticks,
      nmiSync,
      nmiPredictive,
    },
    emergentInformation: { sync: nmiSync, predictive: nmiPredictive, miBitsSync: miSync, miBitsPredictive: miPred },
    emergenceIndex,
    verdict: verdictFor(emergenceIndex),
    deterministic,
    fingerprint: outcomeFingerprint(engine),
    trace,
  };

  return measurement;
}

// ---------------------------------------------------------------------------
// Ladder run
// ---------------------------------------------------------------------------

export function runEmergenceLadder(mode: 'quick' | 'full' = 'full'): EmergenceReport {
  const capacities = mode === 'quick' ? [150] : [...EMERGENCE_CAPACITIES];
  const report: EmergenceReport = { mode, ticks: EMERGENCE_TICKS, spawn: EMERGENCE_SPAWN, measurements: {}, rows: [], pass: true };

  for (const tier of TIER_DEFS) {
    console.log(`[emergence-lab ${mode}] tier ${tier.idx} · ${tier.name}`);
    for (const seed of EMERGENCE_SEEDS) {
      for (const capacity of capacities) {
        const world = buildArchetypeWorld(seed, EMERGENCE_SPAWN, tier, {
          energyCapacity: capacity,
          foodRegenRate: 0.003,
          metabolismBase: 0.5,
        });
        const m = measureEmergence(world, tier.idx, EMERGENCE_TICKS);
        const key = `T${tier.idx}:${capacity}:${seed}`;
        report.measurements[key] = m;
        const { trace, ...row } = m;
        report.rows.push(row as EmergenceRow);
      }
    }
  }
  report.pass = Object.values(report.measurements).every((m) => m.deterministic);
  return report;
}

// ---------------------------------------------------------------------------
// Report rendering
// ---------------------------------------------------------------------------

const fmt = (x: number): string => x.toFixed(3);
const fmtB = (x: number): string => x.toFixed(4);

function axisCell(a: EmergenceAxis): string {
  return `${fmtB(a.raw)} / ${fmtB(a.norm)}`;
}

export function renderEmergenceReport(report: EmergenceReport): { md: string; json: string; csv: string } {
  const byTier = (idx: number): EmergenceRow[] => report.rows.filter((r) => r.world.tier === idx);
  const avg = (idx: number, pick: (r: EmergenceRow) => number) => {
    const xs = byTier(idx).map(pick);
    return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
  };
  const sd = (idx: number, pick: (r: EmergenceRow) => number) => {
    const xs = byTier(idx).map(pick);
    if (xs.length < 2) return 0;
    const m = xs.reduce((a, b) => a + b, 0) / xs.length;
    return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1));
  };

  const lines: string[] = [
    '# Emergence — an object that can be measured',
    '',
    'Emergence is typed here as a measurement object over five observable axes, all computed from one deterministic double-run of a world:',
    '',
    '1. **information in the micro level** — Shannon entropy of the species composition *among living individuals* plus the entropy of their positions on the fine 128² terrain lattice (bits; upper-bound proxy of the joint micro state).',
    '2. **information in the macro level** — Shannon entropy of the quantized aggregate macro-state sequence the system visits (aliveFrac · species · energyMean · cooperation · memeEntropy, each 8 bins).',
    '3. **complexity** — LMC of the species abundance (entropy × disequilibrium; the engine\'s `stats().complexity` formula, re-derived here).',
    '4. **self-organization** — deviation from the maximum-entropy uniform arrangement: aggregation order `1−H/logBins` of the coarse 16² occupancy, and the coarse-to-fine entropy ratio `1−H_coarse/H_fine`.',
    '5. **temporal persistence** — survival fraction, mean lag-1..8 population autocorrelation, and first-half vs second-half species-overlap (Sørensen).',
    '',
    'The object also carries the **emergent information** signature (NMI between the quantized micro-information value and the macro state, sync + predictive) and a composite **emergence index** (mean of the five normalised axes), with an **ABSENT / PARTIAL / EMERGENT** verdict.',
    '',
    `Every world is measured twice and must reproduce bit-for-bit (outcome fingerprint + macro-state sequence): determinism ${report.pass ? '**PASS**' : '**FAIL**'}.`,
    `Grid: tiers T0–T3 × capacities [${capacities(report).join(', ')}] × ${report.rows.length} worlds, ${report.ticks} ticks, ${report.spawn} spawn each.`,
    '',
  ];

  lines.push(
    '## Emergence by tier (mean ± sd over capacities × seeds)',
    '',
    '| tier | emergence index | verdict | microInfo (bits) | macroInfo (bits) | complexity | self-organization | persistence | EI sync NMI | EI predictive NMI |',
    '| --- | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
    ...TIER_DEFS.map(
      (t) =>
        `| **${t.name}** | ${avg(t.idx, (r) => r.emergenceIndex).toFixed(3)} | ${verdictFor(avg(t.idx, (r) => r.emergenceIndex))} | ${avg(t.idx, (r) => r.axes.microInfo.raw).toFixed(2)} ± ${sd(t.idx, (r) => r.axes.microInfo.raw).toFixed(2)} | ${avg(t.idx, (r) => r.axes.macroInfo.raw).toFixed(2)} | ${avg(t.idx, (r) => r.axes.complexity.raw).toFixed(3)} | ${avg(t.idx, (r) => r.axes.selfOrganization.raw).toFixed(3)} | ${avg(t.idx, (r) => r.axes.temporalPersistence.raw).toFixed(3)} | ${avg(t.idx, (r) => r.emergentInformation.sync).toFixed(3)} | ${avg(t.idx, (r) => r.emergentInformation.predictive).toFixed(3)} |`,
    ),
    '',
  );

  lines.push(
    '## Normalised axes by tier',
    '',
    '| tier | microInfo | macroInfo | complexity | self-organization | persistence | index |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: |',
    ...TIER_DEFS.map(
      (t) =>
        `| ${t.name} | ${avg(t.idx, (r) => r.axes.microInfo.norm).toFixed(3)} | ${avg(t.idx, (r) => r.axes.macroInfo.norm).toFixed(3)} | ${avg(t.idx, (r) => r.axes.complexity.norm).toFixed(3)} | ${avg(t.idx, (r) => r.axes.selfOrganization.norm).toFixed(3)} | ${avg(t.idx, (r) => r.axes.temporalPersistence.norm).toFixed(3)} | ${avg(t.idx, (r) => r.emergenceIndex).toFixed(3)} |`,
    ),
    '',
  );

  const phase2 = (i: number): string[] => [
    avg(i, (r) => r.metrics.orderPolarization.order).toFixed(3),
    avg(i, (r) => r.metrics.orderPolarization.speciesPolarization).toFixed(3),
    avg(i, (r) => r.metrics.orderPolarization.traitPolarization).toFixed(3),
    avg(i, (r) => r.metrics.spatialClustering.aggregationIndex).toFixed(3),
    avg(i, (r) => r.metrics.spatialClustering.moranI).toFixed(3),
    avg(i, (r) => r.metrics.spatialClustering.fillFactor).toFixed(3),
    avg(i, (r) => r.metrics.spatialClustering.correlationLength).toFixed(3),
    avg(i, (r) => r.metrics.diversity.shannonDiversity).toFixed(3),
    avg(i, (r) => r.metrics.diversity.simpsonDiversity).toFixed(3),
    avg(i, (r) => r.metrics.diversity.evenness).toFixed(3),
    avg(i, (r) => r.metrics.information.totalBits).toFixed(3),
    avg(i, (r) => r.metrics.complexity.compressibility).toFixed(3),
    avg(i, (r) => r.metrics.complexity.lzComplexity).toFixed(3),
    avg(i, (r) => r.metrics.complexity.lzComplexityNormalized).toFixed(3),
    avg(i, (r) => r.metrics.complexity.temporalComplexity).toFixed(3),
  ];

  lines.push(
'## Phase-2 metric axes (mean over capacities and seeds)',
'',
'Each world additionally carries five named metric groups computed from the same deterministic double-run. Spatial metrics read the coarse occupancy lattice; complexity mixes Lempel-Ziv 76 production complexity, a compressed-size ratio, and temporal variability.',
'',
'| tier | order | species polar. | trait polar. | aggregation | Moran I | fill factor | corr. length | Shannon div. | Simpson div. | evenness | total bits | compress. | LZ-76 c(n) | LZ norm. | temporal cx. |',
'| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
    ...TIER_DEFS.map((t) => '| ' + [t.name, ...phase2(t.idx)].join(' | ') + ' |'),
'',
  );

  const macro = (i: number): string[] => [
    avg(i, (r) => r.macroState.spatialStructure).toFixed(3),
    avg(i, (r) => r.macroState.coordination).toFixed(3),
    avg(i, (r) => r.macroState.rigidity).toFixed(3),
    avg(i, (r) => r.macroState.persistence).toFixed(3),
    avg(i, (r) => r.macroState.organization).toFixed(3),
    avg(i, (r) => r.macroState.macroOrder).toFixed(3),
    avg(i, (r) => r.macroState.agentOrder).toFixed(3),
    avg(i, (r) => r.macroState.divergence).toFixed(3),
    avg(i, (r) => r.macroState.vitality).toFixed(3),
  ];

  lines.push(
    '## Macro-state detector (population level, not agent level)',
    '',
    'A second instrument, deliberately distinct from the metric axes above. Those read individual agents: which species each one is, where it sits, what its traits and energy are. This one never touches an agent. It reads only population aggregates per tick (alive fraction, species count, mean energy, donation ratio, meme entropy), the coarse occupancy lattice, and the quantized macro-state sequence, then places the run in one of five stages:',
    '',
    '- **random** — no macroscopic structure; coarse occupancy near uniform.',
    '- **clustered** — the population condenses in space while macro states are still fluid.',
    '- **organized** — spatial structure plus coordination: donations and a settled cultural field.',
    '- **specialized** — spatial structure *and* temporal rigidity: the macro-state sequence collapses onto a few recurrent states.',
    '- **collapsed** — the population cannot hold its own median level of alive fraction, species count or mean energy. Judged on trailing-window levels so the spawn burst cannot masquerade as normal, and not absorbing, because these populations do recover.',
    '',
    'The last two columns are the point of the instrument: `macroOrder` is spatial order read at the population scale, `agentOrder` is the agent-scale order blend, and `divergence` is how far the two levels of description disagree.',
    '',
    '| tier | structure | coordination | rigidity | persistence | organization | macroOrder | agentOrder | divergence | vitality |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
    ...TIER_DEFS.map((t) => '| ' + [t.name, ...macro(t.idx)].join(' | ') + ' |'),
    '',
    '### Progression by tier (distinct stages in order of first appearance)',
    '',
    '| tier | dominant | final | progression | collapsed worlds |',
    '| --- | --- | --- | --- | ---: |',
    ...TIER_DEFS.map((t) => {
      const rows = byTier(t.idx);
      const seen = new Set<string>();
      for (const r of rows) for (const g of r.macroState.progression) seen.add(g);
      const doms = [...new Set(rows.map((r) => r.macroState.dominant))].sort();
      const fins = [...new Set(rows.map((r) => r.macroState.final))].sort();
      const collapsed = rows.filter((r) => r.macroState.firstCollapseTick >= 0).length;
      const prog = [...seen].join(' > ') || 'n/a';
      return `| ${t.name} | ${doms.join(', ')} | ${fins.join(', ')} | ${prog} | ${collapsed}/${rows.length} |`;
    }),
    '',
  );

  lines.push(
    '## Detail — per world',
    '',
    '| tier | capacity | seed | index | verdict | micro | macro | complexity | S.O. | persist. | EI sync | EI pred | determin. |',
    '| --- | ---: | --- | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |',
    ...report.rows.map(
      (r) =>
        `| ${r.world.tierName} | ${r.world.capacity} | \`${r.world.seed}\` | ${r.emergenceIndex.toFixed(3)} | ${r.verdict} | ${axisCell(r.axes.microInfo)} | ${axisCell(r.axes.macroInfo)} | ${axisCell(r.axes.complexity)} | ${axisCell(r.axes.selfOrganization)} | ${axisCell(r.axes.temporalPersistence)} | ${fmtB(r.emergentInformation.sync)} | ${fmtB(r.emergentInformation.predictive)} | ${r.deterministic ? '✓' : '✗'} |`,
    ),
    '',
  );

  const md = lines.join('\n') + '\n';

  const json = JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      name: 'emergence-measurement',
      mode: report.mode,
      ticks: report.ticks,
      spawn: report.spawn,
      capacities: capacities(report),
      tiers: TIER_DEFS.map((t) => ({ idx: t.idx, name: t.name, faculty: t.faculty })),
      verdictThresholds: { partial: VERDICT_PARTIAL, emergent: VERDICT_EMERGENT },
      pass: report.pass,
      worlds: report.rows,
    },
    null,
    2,
  ) + '\n';

  const csv = [
    'tier,capacity,seed,emergenceIndex,verdict,microInfoRaw,microInfoNorm,macroInfoRaw,macroInfoNorm,complexityRaw,complexityNorm,selfOrgRaw,selfOrgNorm,persistenceRaw,persistenceNorm,eiSync,eiPredictive,mOrder,mSpeciesPolar,mTraitPolar,mAggregation,mMoranI,mFillFactor,mCorrLen,mShannonDiv,mSimpsonDiv,mEvenness,mTotalBits,mCompressibility,mLZc,mLZnorm,mTemporalCx,macroRegime,macroFinal,macroProgression,macroTransitions,macroStructure,macroCoordination,macroRigidity,macroPersistence,macroOrganization,macroPeakAlive,macroRefAlive,macroTerminalAlive,macroVitality,macroFirstCollapseTick,macroOrder,macroAgentOrder,macroDivergence,deterministic',
    ...report.rows.map((r) =>
      [
        r.world.tier,
        r.world.capacity,
        r.world.seed,
        r.emergenceIndex,
        r.verdict,
        r.axes.microInfo.raw,
        r.axes.microInfo.norm,
        r.axes.macroInfo.raw,
        r.axes.macroInfo.norm,
        r.axes.complexity.raw,
        r.axes.complexity.norm,
        r.axes.selfOrganization.raw,
        r.axes.selfOrganization.norm,
        r.axes.temporalPersistence.raw,
        r.axes.temporalPersistence.norm,
        r.emergentInformation.sync,
        r.emergentInformation.predictive,
        r.metrics.orderPolarization.order,
        r.metrics.orderPolarization.speciesPolarization,
        r.metrics.orderPolarization.traitPolarization,
        r.metrics.spatialClustering.aggregationIndex,
        r.metrics.spatialClustering.moranI,
        r.metrics.spatialClustering.fillFactor,
        r.metrics.spatialClustering.correlationLength,
        r.metrics.diversity.shannonDiversity,
        r.metrics.diversity.simpsonDiversity,
        r.metrics.diversity.evenness,
        r.metrics.information.totalBits,
        r.metrics.complexity.compressibility,
        r.metrics.complexity.lzComplexity,
        r.metrics.complexity.lzComplexityNormalized,
        r.metrics.complexity.temporalComplexity,
        r.macroState.dominant,
        r.macroState.final,
        r.macroState.progression.join('>'),
        r.macroState.transitions,
        r.macroState.spatialStructure,
        r.macroState.coordination,
        r.macroState.rigidity,
        r.macroState.persistence,
        r.macroState.organization,
        r.macroState.peakAliveFrac,
        r.macroState.referenceAliveFrac,
        r.macroState.terminalAliveFrac,
        r.macroState.vitality,
        r.macroState.firstCollapseTick,
        r.macroState.macroOrder,
        r.macroState.agentOrder,
        r.macroState.divergence,
        r.deterministic,
      ]
        .map(String)
        .join(','),
    ),
  ].join('\n');

  return { md, json, csv };
}

function capacities(report: EmergenceReport): number[] {
  return [...new Set(report.rows.map((r) => r.world.capacity))].sort((a, b) => a - b);
}

// ---------------------------------------------------------------------------
// SVG — ladder bars + exemplar trace
// ---------------------------------------------------------------------------

export function renderEmergenceSvg(report: EmergenceReport): string {
  const W = 1080;
  const H = 920;
  const padL = 72;
  const padT = 48;
  const panelGap = 64;
  const right = 40;

  const byTier = (idx: number): EmergenceRow[] => report.rows.filter((r) => r.world.tier === idx);
  const avg = (idx: number, pick: (r: EmergenceRow) => number) => {
    const xs = byTier(idx).map(pick);
    return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
  };

  const blockW = W - padL - right;
  const barsH = 320;
  const yBotBars = padT + barsH;
  const yTopBars = padT + 30;

  const axesKeys = ['microInfo', 'macroInfo', 'complexity', 'selfOrganization', 'temporalPersistence'] as const;
  const colors = ['#e05252', '#f2a33c', '#f2cf5b', '#59a14f', '#4e79a7'];
  const tierCnt = TIER_DEFS.length;
  const slot = blockW / tierCnt;
  const groupW = slot * 0.72;
  const barW = groupW / axesKeys.length;

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" font-family="ui-monospace,Menlo,Consolas,monospace">\n  <rect width="${W}" height="${H}" fill="#15171b"/>\n`;

  // panel A — normalised axes grouped by tier
  svg += `<text x="${padL}" y="${yTopBars - 12}" font-size="14" fill="#e4e6ea" font-weight="bold">emergence axes (normalised 0–1) — T0 simple → T3 systems</text>\n`;
  axesKeys.forEach((k, ai) => {
    for (let ti = 0; ti < tierCnt; ti++) {
      const v = avg(ti, (r) => r.axes[k].norm);
      const x = padL + slot * (ti + 0.5) - groupW / 2 + ai * barW;
      const barTop = yBotBars - v * (barsH - 26);
      svg += `<rect x="${x.toFixed(1)}" y="${barTop.toFixed(1)}" width="${(barW - 3).toFixed(1)}" height="${(yBotBars - barTop).toFixed(1)}" fill="${colors[ai]}" opacity="0.88"/>\n`;
    }
  });
  TIER_DEFS.forEach((t, ti) => {
    const x = padL + slot * ti + slot / 2;
    svg += `<line x1="${x.toFixed(1)}" y1="${yBotBars}" x2="${x.toFixed(1)}" y2="${yTopBars}" stroke="#262a31"/>\n`;
    svg += `<text x="${x.toFixed(1)}" y="${yBotBars + 16}" font-size="12" text-anchor="middle" fill="#e4e6ea">${t.name.split('·')[0]!.trim()}</text>\n`;
  });
  axesKeys.forEach((k, ai) => {
    const ly = yTopBars + 14 + ai * 16;
    svg += `<circle cx="${W - 24}" cy="${ly}" r="4" fill="${colors[ai]}"/>\n<text x="${W - right + 12}" y="${ly + 4}" font-size="11" fill="#cfd3da">${k}</text>\n`;
  });

  // panel B — emergence index line + verdict band
  const yTopIdx = yBotBars + panelGap;
  const yBotIdx = yTopIdx + 150;
  const plotY = (v: number) => yBotIdx - v * 130;
  TIER_DEFS.map((t) => avg(t.idx, (r) => r.emergenceIndex)).forEach((v, ti) => {
    const x = padL + slot * (ti + 0.5);
    svg += `<circle cx="${x.toFixed(1)}" cy="${plotY(v).toFixed(1)}" r="5" fill="#61dafb"/>\n`;
    svg += `<text x="${x.toFixed(1)}" y="${(plotY(v) + 18).toFixed(1)}" font-size="11" text-anchor="middle" fill="#9adcff">${v.toFixed(3)}</text>\n`;
  });
  const poly = TIER_DEFS.map((t, ti) => {
    const x = padL + slot * ti + slot / 2;
    return `${x.toFixed(1)},${plotY(avg(t.idx, (r) => r.emergenceIndex)).toFixed(1)}`;
  }).join(' ');
  svg += `<polyline points="${poly}" fill="none" stroke="#61dafb" stroke-width="2"/>\n`;
  svg += `<text x="${padL}" y="${yTopIdx - 8}" font-size="14" fill="#e4e6ea" font-weight="bold">emergence index (mean of 5 normalised axes) — ABSENT → PARTIAL → EMERGENT</text>\n`;
  svg += `<line x1="${padL}" x2="${padL}" y1="${yTopIdx}" y2="${yBotIdx}" stroke="#444"/>\n`;

  // panel C — exemplar trace (richest tier, baseline capacity)
  const exemplar = report.measurements['T3:150:archetypes.s1'];
  if (exemplar) {
    const yTopT = yBotIdx + panelGap;
    const yBotT = yTopT + 240;
    const traceW = W - padL - right;
    const { trace } = exemplar;
    const maxV = Math.max(...trace.map((p) => p.microInfo), 1);
    const series = (pick: (p: EmergenceTracePoint) => number, color: string, label: string) => {
      const pts = trace.map((p, i) => `${(padL + (i / (trace.length - 1)) * traceW).toFixed(1)},${(yBotT - (Math.min(1, pick(p) / maxV) * 200)).toFixed(1)}`).join(' ');
      svg += `<polyline points="${pts}" fill="none" stroke="${color}" stroke-width="1.6"/>\n`;
      svg += `<circle cx="${W - right + 8}" cy="${yTopT + 4 + label.length * 0}" r="4" fill="${color}"/>\n`;
      svg += `<text x="${W - right + 16}" y="${yTopT + 8}" font-size="11" fill="#cfd3da">${label}</text>\n`;
    };
    series((p) => p.microInfo, '#f2a33c', 'microInfo');
    series((p) => p.complexity, '#4e79a7', 'complexity (LMC)');
    series((p) => p.aggregation, '#59a14f', 'aggregation order');
    svg += `<text x="${padL}" y="${yTopT - 8}" font-size="14" fill="#e4e6ea" font-weight="bold">exemplar trace — T3 · systems, capacity 150 · seed archetypes.s1 (240 ticks)</text>\n`;
  }

  svg += `  <text x="${W - right}" y="${H - 10}" text-anchor="end" font-size="11" fill="#7d828b">emergence measurement layer · every world double-run deterministic: ${report.pass ? 'true' : 'false'}</text>\n</svg>\n`;
  return svg;
}

export function writeEmergenceReport(report: EmergenceReport): string {
  const { md, json, csv } = renderEmergenceReport(report);
  mkdirSync(plotsDir, { recursive: true });
  writeFileSync(join(outputDir, 'emergence.md'), md);
  writeFileSync(join(outputDir, 'emergence.json'), json);
  writeFileSync(join(outputDir, 'emergence.csv'), csv);
  writeFileSync(join(plotsDir, 'emergence.svg'), renderEmergenceSvg(report));
  return join(outputDir, 'emergence.md');
}

export function summarizeEmergence(report: EmergenceReport): void {
  const byTier = (idx: number): EmergenceRow[] => report.rows.filter((r) => r.world.tier === idx);
  const avg = (idx: number, pick: (r: EmergenceRow) => number) => {
    const xs = byTier(idx).map(pick);
    return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
  };
  console.log(`emergence index (T0→T3): ${TIER_DEFS.map((t) => avg(t.idx, (r) => r.emergenceIndex).toFixed(3)).join(' → ')}`);
  console.log(`  microInfo (bits)      ${TIER_DEFS.map((t) => avg(t.idx, (r) => r.axes.microInfo.raw).toFixed(2)).join(' → ')}`);
  console.log(`  macroInfo (bits)      ${TIER_DEFS.map((t) => avg(t.idx, (r) => r.axes.macroInfo.raw).toFixed(2)).join(' → ')}`);
  console.log(`  complexity (LMC)      ${TIER_DEFS.map((t) => avg(t.idx, (r) => r.axes.complexity.raw).toFixed(3)).join(' → ')}`);
  console.log(`  selfOrganization      ${TIER_DEFS.map((t) => avg(t.idx, (r) => r.axes.selfOrganization.raw).toFixed(3)).join(' → ')}`);
  console.log(`  persistence           ${TIER_DEFS.map((t) => avg(t.idx, (r) => r.axes.temporalPersistence.raw).toFixed(3)).join(' → ')}`);
  console.log(`  EI sync / predictive  ${TIER_DEFS.map((t) => `${avg(t.idx, (r) => r.emergentInformation.sync).toFixed(2)}/${avg(t.idx, (r) => r.emergentInformation.predictive).toFixed(2)}`).join(' → ')}`);
  console.log(`  verdicts              ${TIER_DEFS.map((t) => byTier(t.idx).map((r) => r.verdict).join('|')).join(' → ')}`);
  console.log(`determinism: ${report.pass ? 'PASS' : 'FAIL'} (${report.rows.length} worlds)`);
}

if (process.argv[1]?.endsWith('emergence.ts')) {
  const mode = process.argv.includes('--quick') ? 'quick' : 'full';
  console.log(`[emergence-lab ${mode}] tier ladder · ${mode === 'quick' ? 'capacity 150 only' : 'capacities ' + EMERGENCE_CAPACITIES.join('/')} · ${EMERGENCE_TICKS} ticks`);
  const report = runEmergenceLadder(mode);
  const file = writeEmergenceReport(report);
  summarizeEmergence(report);
  console.log(`\n# written: ${file}`);
}