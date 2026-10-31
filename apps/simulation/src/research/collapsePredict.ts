/**
 * Experiment D - can early structure predict collapse on conditions the model
 * has never seen?
 *
 * Question: can the collapse of an emergent colony be predicted from the first
 * 100 ticks of its trajectory, before the collapse is visible, and does that
 * prediction generalise across rules and parameters?
 *
 * Design (pre-registered in docs/CLAIMS.md, D-PRED-01..05):
 *   - 3 rules x 8 parameter regimes = 24 conditions on the agent engine.
 *     Rule  = mutation supply (clonal x0 / legacy x1 / elevated x4).
 *     Params = basal metabolism x food regeneration.
 *   - Training conditions: clonal/legacy x P0,P1,P2,P6,P7 (10 conditions).
 *   - Test conditions: elevated x all 8 (unseen rule) plus clonal/legacy x
 *     P3,P4,P5 (unseen parameter regimes) = 14 conditions.
 *   - Training seeds and test seeds are disjoint (d.c0..d.c7 vs d.c8..d.c15),
 *     so no world is shared between fit and evaluation.
 *   - Early window: ticks 40..140. Outcome window: ticks 500..599. A run is a
 *     collapse if its late mean alive count is below 10, a persistence if it is
 *     at least 30, and ambiguous in between (excluded from fit and scoring).
 *   - Features: population level/trend/fluctuation/autocorrelation, species and
 *     spatial entropy, Moran's I, clustering, occupancy, largest connected
 *     component, radius of gyration, and mean energy. No condition label and no
 *     late-window observation is used as a predictor.
 *
 * The model is an L2-regularised logistic regression (lambda fixed at 0.1,
 * features standardised on the training split). Baselines: training base rate,
 * population size + trend, temporal-only, entropy-only, and structure-only.
 *
 * This module is self-contained under research/: it calls the agent engine but
 * does not alter its dynamics. The only engine-side choice is dead retention 0
 * (dead agents are retained solely for lineage; they are never read by the
 * dynamics), which keeps 192 sequential runs inside a small memory budget.
 */
import {
  WORLD_SIZE,
  coefficientOfVariation,
  flickering,
  lag1Autocorrelation,
  mean,
  rocAuc,
} from '@fractal-life/shared';
import { Engine } from '../engine.js';
import { makeWorld } from './scenarios.js';
import { mulberry32, quantile } from './stats.js';

/* ------------------------------------------------------------------ design -- */

export const CP_TICKS = 600;
export const CP_EARLY_FROM = 40;
export const CP_EARLY_TO = 140;
export const CP_EARLY_STEP = 5;
export const CP_LATE_FROM = 500;
export const CP_LATE_TO = 600;
export const CP_COLLAPSE_MAX = 10;
export const CP_PERSIST_MIN = 30;
export const CP_SPAWN = 300;
export const CP_MAX_POP = 500;
export const CP_SPATIAL_BINS = 16;
export const CP_LAMBDA = 0.1;
export const CP_BOOTSTRAP = 1000;
export const CP_ECE_BINS = 5;
/** Label gate fixed before the confirmatory run. */
export const CP_MIN_LABELLED = 8;
export const CP_MIN_CLASS = 3;

export const CP_TRAIN_SEEDS = Array.from({ length: 8 }, (_, i) => `d.c${i}`);
export const CP_TEST_SEEDS = Array.from({ length: 8 }, (_, i) => `d.c${i + 8}`);
export const CP_SEEDS = [...CP_TRAIN_SEEDS, ...CP_TEST_SEEDS];

export type CollapseRule = 'clonal' | 'legacy' | 'elevated';
export type CollapseSplit = 'train' | 'test';
export type CollapseUnseen = 'none' | 'rule' | 'parameter' | 'both';
export type CollapseOutcome = 'collapse' | 'persist' | 'ambiguous';
export type Verdict = 'supported' | 'refuted' | 'inconclusive';

export interface CollapseParam {
  readonly id: string;
  readonly metabolismBase: number;
  readonly foodRegenRate: number;
}

export interface CollapseRuleSpec {
  readonly id: CollapseRule;
  readonly mutationScale: number;
  readonly description: string;
}

/** Parameter grid: persistence at the top left, collapse at the bottom right. */
export const CP_PARAMS: readonly CollapseParam[] = [
  { id: 'P0', metabolismBase: 6, foodRegenRate: 0.0027 },
  { id: 'P1', metabolismBase: 8, foodRegenRate: 0.0027 },
  { id: 'P2', metabolismBase: 10, foodRegenRate: 0.0027 },
  { id: 'P3', metabolismBase: 12, foodRegenRate: 0.0027 },
  { id: 'P4', metabolismBase: 8, foodRegenRate: 0.0018 },
  { id: 'P5', metabolismBase: 10, foodRegenRate: 0.0018 },
  { id: 'P6', metabolismBase: 12, foodRegenRate: 0.0018 },
  { id: 'P7', metabolismBase: 16, foodRegenRate: 0.0018 },
];

export const CP_RULES: readonly CollapseRuleSpec[] = [
  { id: 'clonal', mutationScale: 0, description: 'mutation supply x0' },
  { id: 'legacy', mutationScale: 1, description: 'mutation supply x1' },
  { id: 'elevated', mutationScale: 4, description: 'mutation supply x4' },
];

/** Training parmeters: the two ends of the stress axis plus a middle point. */
export const CP_TRAIN_PARAMS = ['P0', 'P1', 'P2', 'P6', 'P7'] as const;
/** Held-out parameter regimes, interpolated between the training regimes. */
export const CP_TEST_PARAMS = ['P3', 'P4', 'P5'] as const;
export const CP_TRAIN_RULES: readonly CollapseRule[] = ['clonal', 'legacy'];
export const CP_TEST_RULE: CollapseRule = 'elevated';

export interface CollapseCondition {
  readonly id: string;
  readonly rule: CollapseRule;
  readonly mutationScale: number;
  readonly param: string;
  readonly metabolismBase: number;
  readonly foodRegenRate: number;
  readonly split: CollapseSplit;
  readonly unseen: CollapseUnseen;
}

function buildConditions(): CollapseCondition[] {
  const out: CollapseCondition[] = [];
  for (const rule of CP_RULES) {
    for (const param of CP_PARAMS) {
      const ruleSeen = CP_TRAIN_RULES.includes(rule.id);
      const paramSeen = (CP_TRAIN_PARAMS as readonly string[]).includes(param.id);
      const train = ruleSeen && paramSeen;
      const unseen: CollapseUnseen = !ruleSeen && !paramSeen ? 'both' : !ruleSeen ? 'rule' : !paramSeen ? 'parameter' : 'none';
      out.push({
        id: `${rule.id}.${param.id}`,
        rule: rule.id,
        mutationScale: rule.mutationScale,
        param: param.id,
        metabolismBase: param.metabolismBase,
        foodRegenRate: param.foodRegenRate,
        split: train ? 'train' : 'test',
        unseen,
      });
    }
  }
  return out;
}

export const CP_CONDITIONS: readonly CollapseCondition[] = buildConditions();
export const CP_TRAIN_CONDITIONS = CP_CONDITIONS.filter((c) => c.split === 'train');
export const CP_TEST_CONDITIONS = CP_CONDITIONS.filter((c) => c.split === 'test');

/* ----------------------------------------------------------------- features -- */

export const CP_FEATURES = [
  'logMeanPop',
  'popTrend',
  'popCV',
  'ar1',
  'flicker',
  'popTrough',
  'speciesEntropy',
  'spatialEntropy',
  'moranI',
  'clusterFrac',
  'occupancy',
  'largestComponentFrac',
  'radiusGyration',
  'meanEnergy',
] as const;

export type CollapseFeature = (typeof CP_FEATURES)[number];
export type FeatureVector = Record<CollapseFeature, number>;

export const CP_POPULATION_FEATURES: readonly CollapseFeature[] = ['logMeanPop', 'popTrend'];
export const CP_TEMPORAL_FEATURES: readonly CollapseFeature[] = [
  'logMeanPop',
  'popTrend',
  'popCV',
  'ar1',
  'flicker',
  'popTrough',
];
export const CP_ENTROPY_FEATURES: readonly CollapseFeature[] = ['speciesEntropy', 'spatialEntropy'];
export const CP_STRUCTURE_FEATURES: readonly CollapseFeature[] = [
  'moranI',
  'clusterFrac',
  'occupancy',
  'largestComponentFrac',
  'radiusGyration',
];

export interface EarlySample {
  readonly tick: number;
  readonly population: number;
  readonly speciesEntropy: number;
  readonly spatialEntropy: number;
  readonly moranI: number;
  readonly clusterFrac: number;
  readonly occupancy: number;
  readonly largestComponentFrac: number;
  readonly radiusGyration: number;
  readonly meanEnergy: number;
}

export interface SpatialStats {
  readonly entropy: number;
  readonly moranI: number;
  readonly clusterFrac: number;
  readonly occupancy: number;
  readonly largestComponentFrac: number;
}

/** Shannon entropy in bits of a non-negative count vector. */
export function shannonBits(counts: Iterable<number>): number {
  let total = 0;
  for (const c of counts) total += c;
  if (total <= 0) return 0;
  let h = 0;
  for (const c of counts) {
    if (c <= 0) continue;
    const p = c / total;
    h -= p * Math.log2(p);
  }
  return h;
}

/** Spatial statistics on a square torus with rook (4-neighbour) adjacency. */
export function spatialStats(counts: Int32Array, bins: number): SpatialStats {
  const cells = bins * bins;
  let total = 0;
  let occupied = 0;
  let sum = 0;
  for (let i = 0; i < cells; i++) {
    const c = counts[i]!;
    total += c;
    if (c > 0) occupied++;
    sum += c;
  }
  if (total <= 0) {
    return { entropy: 0, moranI: 0, clusterFrac: 0, occupancy: 0, largestComponentFrac: 0 };
  }
  const m = sum / cells;
  let h = 0;
  let den = 0;
  for (let i = 0; i < cells; i++) {
    const c = counts[i]!;
    if (c > 0) {
      const p = c / total;
      h -= p * Math.log2(p);
    }
    const z = c - m;
    den += z * z;
  }
  const entropy = h / Math.log2(cells);

  // Moran's I with row-unstandardised rook weights on the torus:
  // I = (N / S0) * sum_ij w_ij z_i z_j / sum_i z_i^2, S0 = 4N.
  let cross = 0;
  let neighbourSum = 0;
  for (let y = 0; y < bins; y++) {
    for (let x = 0; x < bins; x++) {
      const i = y * bins + x;
      const zi = counts[i]! - m;
      const east = y * bins + ((x + 1) % bins);
      const west = y * bins + ((x + bins - 1) % bins);
      const north = ((y + 1) % bins) * bins + x;
      const south = ((y + bins - 1) % bins) * bins + x;
      for (const j of [east, west, north, south]) {
        cross += zi * (counts[j]! - m);
      }
    }
  }
  const moranI = den > 0 ? cross / (4 * den) : 0;

  let cluster = 0;
  for (let y = 0; y < bins; y++) {
    for (let x = 0; x < bins; x++) {
      const i = y * bins + x;
      if (counts[i]! <= 0) continue;
      const east = y * bins + ((x + 1) % bins);
      const west = y * bins + ((x + bins - 1) % bins);
      const north = ((y + 1) % bins) * bins + x;
      const south = ((y + bins - 1) % bins) * bins + x;
      let n = 0;
      for (const j of [east, west, north, south]) if (counts[j]! > 0) n++;
      cluster += n / 4;
      neighbourSum++;
    }
  }
  const clusterFrac = neighbourSum > 0 ? cluster / neighbourSum : 0;

  // Largest 4-connected occupied component, as a fraction of occupied bins.
  const visited = new Uint8Array(cells);
  const stack: number[] = [];
  let largest = 0;
  for (let start = 0; start < cells; start++) {
    if (visited[start] || counts[start]! <= 0) continue;
    visited[start] = 1;
    stack.push(start);
    let size = 0;
    while (stack.length) {
      const i = stack.pop()!;
      size++;
      const x = i % bins;
      const y = (i - x) / bins;
      const east = y * bins + ((x + 1) % bins);
      const west = y * bins + ((x + bins - 1) % bins);
      const north = ((y + 1) % bins) * bins + x;
      const south = ((y + bins - 1) % bins) * bins + x;
      for (const j of [east, west, north, south]) {
        if (!visited[j] && counts[j]! > 0) {
          visited[j] = 1;
          stack.push(j);
        }
      }
    }
    if (size > largest) largest = size;
  }

  return {
    entropy,
    moranI,
    clusterFrac,
    occupancy: occupied / cells,
    largestComponentFrac: occupied > 0 ? largest / occupied : 0,
  };
}

/** Radius of gyration around the circular (torus) centroid, as a fraction of world size. */
export function radiusOfGyration(xs: readonly number[], ys: readonly number[], worldSize = WORLD_SIZE): number {
  const n = Math.min(xs.length, ys.length);
  if (n < 2 || worldSize <= 0) return 0;
  let sinX = 0;
  let cosX = 0;
  let sinY = 0;
  let cosY = 0;
  for (let i = 0; i < n; i++) {
    const ax = (2 * Math.PI * xs[i]!) / worldSize;
    const ay = (2 * Math.PI * ys[i]!) / worldSize;
    sinX += Math.sin(ax);
    cosX += Math.cos(ax);
    sinY += Math.sin(ay);
    cosY += Math.cos(ay);
  }
  const cx = (((Math.atan2(sinX / n, cosX / n) / (2 * Math.PI)) * worldSize) % worldSize + worldSize) % worldSize;
  const cy = (((Math.atan2(sinY / n, cosY / n) / (2 * Math.PI)) * worldSize) % worldSize + worldSize) % worldSize;
  const wrap = (d: number): number => ((d + worldSize / 2) % worldSize + worldSize) % worldSize - worldSize / 2;
  let ss = 0;
  for (let i = 0; i < n; i++) {
    const dx = wrap(xs[i]! - cx);
    const dy = wrap(ys[i]! - cy);
    ss += dx * dx + dy * dy;
  }
  return Math.sqrt(ss / n) / worldSize;
}

/** Observe one early-window sample without touching the engine's dynamics. */
export function observeEarly(engine: Engine, tick: number, bins = CP_SPATIAL_BINS): EarlySample {
  const counts = new Int32Array(bins * bins);
  const species = new Map<number, number>();
  const xs: number[] = [];
  const ys: number[] = [];
  let energySum = 0;
  let population = 0;
  for (const a of engine.agents.values()) {
    if (!a.alive) continue;
    population++;
    species.set(a.species, (species.get(a.species) ?? 0) + 1);
    xs.push(a.x);
    ys.push(a.y);
    energySum += a.energy;
    const bx = Math.floor((a.x / WORLD_SIZE) * bins) % bins;
    const by = Math.floor((a.y / WORLD_SIZE) * bins) % bins;
    counts[by * bins + bx] = counts[by * bins + bx]! + 1;
  }
  const sp = spatialStats(counts, bins);
  return {
    tick,
    population,
    speciesEntropy: shannonBits(species.values()),
    spatialEntropy: sp.entropy,
    moranI: sp.moranI,
    clusterFrac: sp.clusterFrac,
    occupancy: sp.occupancy,
    largestComponentFrac: sp.largestComponentFrac,
    radiusGyration: radiusOfGyration(xs, ys),
    meanEnergy: population > 0 ? energySum / population / Math.max(1, engine.params.energyCapacity) : 0,
  };
}

/** OLS slope of y on x, per unit of x. */
export function slope(xs: readonly number[], ys: readonly number[]): number {
  const n = Math.min(xs.length, ys.length);
  if (n < 2) return 0;
  const mx = mean([...xs.slice(0, n)]);
  const my = mean([...ys.slice(0, n)]);
  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i]! - mx;
    sxx += dx * dx;
    sxy += dx * (ys[i]! - my);
  }
  return sxx > 0 ? sxy / sxx : 0;
}

export function extractFeatures(early: readonly EarlySample[]): FeatureVector {
  if (early.length === 0) {
    return Object.fromEntries(CP_FEATURES.map((f) => [f, 0])) as FeatureVector;
  }
  const pop = early.map((s) => s.population);
  const logPop = pop.map((p) => Math.log1p(p));
  const times = early.map((_, i) => i * CP_EARLY_STEP);
  const m = mean(pop);
  return {
    logMeanPop: Math.log1p(m),
    // per 100 ticks, on the log scale
    popTrend: slope(times, logPop) * 100,
    popCV: coefficientOfVariation(pop),
    ar1: lag1Autocorrelation(pop),
    flicker: flickering(pop),
    popTrough: m > 0 ? Math.min(...pop) / m : 0,
    speciesEntropy: mean(early.map((s) => s.speciesEntropy)),
    spatialEntropy: mean(early.map((s) => s.spatialEntropy)),
    moranI: mean(early.map((s) => s.moranI)),
    clusterFrac: mean(early.map((s) => s.clusterFrac)),
    occupancy: mean(early.map((s) => s.occupancy)),
    largestComponentFrac: mean(early.map((s) => s.largestComponentFrac)),
    radiusGyration: mean(early.map((s) => s.radiusGyration)),
    meanEnergy: mean(early.map((s) => s.meanEnergy)),
  };
}

/* --------------------------------------------------------------- simulation -- */

export interface CollapseRun {
  readonly condition: string;
  readonly rule: CollapseRule;
  readonly param: string;
  readonly split: CollapseSplit;
  readonly unseen: CollapseUnseen;
  readonly seed: string;
  readonly ticks: number;
  readonly earlyFrom: number;
  readonly earlyTo: number;
  readonly lateFrom: number;
  readonly lateTo: number;
  readonly features: FeatureVector;
  readonly outcome: CollapseOutcome;
  readonly earlyMean: number;
  readonly lateMean: number;
  readonly lateMin: number;
  readonly lateRatio: number;
  readonly final: number;
  readonly peak: number;
  readonly earlySamples: EarlySample[];
  /** population sampled every 10 ticks, for the artifact only */
  readonly popSeries: number[];
}

export function classifyOutcome(lateMean: number): CollapseOutcome {
  if (lateMean < CP_COLLAPSE_MAX) return 'collapse';
  if (lateMean >= CP_PERSIST_MIN) return 'persist';
  return 'ambiguous';
}

/** Mean of a tick-indexed series over ticks [from, to). alive[t - 1] is tick t. */
export function windowMean(alive: readonly number[], from: number, to: number): number {
  const lo = Math.max(0, from - 1);
  const hi = Math.min(alive.length, to - 1);
  if (hi <= lo) return 0;
  return mean(alive.slice(lo, hi));
}

export function runCollapseCondition(
  condition: CollapseCondition,
  seed: string,
  ticks = CP_TICKS,
): CollapseRun {
  const world = makeWorld(seed, CP_SPAWN, {
    maxPopulation: CP_MAX_POP,
    foodRegenRate: condition.foodRegenRate,
    metabolismBase: condition.metabolismBase,
  });
  world.mutationScale = condition.mutationScale;
  // Dead retention 0: dead agents are kept only for lineage and are never read
  // by the update equations, so this is dynamics-preserving and keeps the
  // 192-run campaign inside the memory budget.
  const engine = new Engine(world, undefined, 0);
  const alive: number[] = [];
  const earlySamples: EarlySample[] = [];
  const popSeries: number[] = [];
  for (let tick = 1; tick <= ticks; tick++) {
    engine.tick();
    const pop = engine.aliveCount();
    alive.push(pop);
    if (tick % 10 === 0) popSeries.push(pop);
    if (tick >= CP_EARLY_FROM && tick <= CP_EARLY_TO && (tick - CP_EARLY_FROM) % CP_EARLY_STEP === 0) {
      earlySamples.push(observeEarly(engine, tick));
    }
  }
  const earlyMean = windowMean(alive, 100, 200);
  const lateMean = windowMean(alive, CP_LATE_FROM, CP_LATE_TO);
  const lateSlice = alive.slice(CP_LATE_FROM - 1, CP_LATE_TO - 1);
  const lateMin = lateSlice.length ? Math.min(...lateSlice) : 0;
  return {
    condition: condition.id,
    rule: condition.rule,
    param: condition.param,
    split: condition.split,
    unseen: condition.unseen,
    seed,
    ticks,
    earlyFrom: CP_EARLY_FROM,
    earlyTo: CP_EARLY_TO,
    lateFrom: CP_LATE_FROM,
    lateTo: CP_LATE_TO,
    features: extractFeatures(earlySamples),
    outcome: classifyOutcome(lateMean),
    earlyMean,
    lateMean,
    lateMin,
    lateRatio: lateMean / Math.max(1, earlyMean),
    final: alive.length ? alive[alive.length - 1]! : 0,
    peak: alive.length ? Math.max(...alive) : 0,
    earlySamples,
    popSeries,
  };
}

/* ------------------------------------------------------------------- model -- */

export interface Standardizer {
  readonly mean: number[];
  readonly sd: number[];
}

export interface LogisticModel {
  readonly features: readonly CollapseFeature[];
  readonly standardizer: Standardizer;
  readonly weights: number[];
  readonly intercept: number;
  readonly baseRate: number;
  readonly n: number;
  readonly positives: number;
}

function sigmoid(z: number): number {
  if (z >= 0) {
    const e = Math.exp(-z);
    return 1 / (1 + e);
  }
  const e = Math.exp(z);
  return e / (1 + e);
}

function solveLinear(a: number[][], b: number[]): number[] {
  const n = b.length;
  const m = a.map((row) => [...row]);
  const x = [...b];
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(m[row]![col]!) > Math.abs(m[pivot]![col]!)) pivot = row;
    }
    if (Math.abs(m[pivot]![col]!) < 1e-14) continue;
    if (pivot !== col) {
      const tmpRow = m[pivot]!;
      m[pivot] = m[col]!;
      m[col] = tmpRow;
      const tmpX = x[pivot]!;
      x[pivot] = x[col]!;
      x[col] = tmpX;
    }
    const pv = m[col]![col]!;
    for (let row = col + 1; row < n; row++) {
      const f = m[row]![col]! / pv;
      if (f === 0) continue;
      for (let k = col; k < n; k++) m[row]![k] = m[row]![k]! - f * m[col]![k]!;
      x[row] = x[row]! - f * x[col]!;
    }
  }
  for (let row = n - 1; row >= 0; row--) {
    let s = x[row]!;
    for (let col = row + 1; col < n; col++) s -= m[row]![col]! * x[col]!;
    const pv = m[row]![row]!;
    x[row] = Math.abs(pv) < 1e-14 ? 0 : s / pv;
  }
  return x;
}

/**
 * L2-regularised logistic regression by Newton-Raphson / IRLS. The intercept is
 * not penalised. Deterministic, no random initialisation.
 */
export function fitLogistic(
  runs: readonly CollapseRun[],
  features: readonly CollapseFeature[],
  lambda = CP_LAMBDA,
): LogisticModel {
  const rows = runs.filter((r) => r.outcome !== 'ambiguous');
  const n = rows.length;
  const positives = rows.filter((r) => r.outcome === 'collapse').length;
  const baseRate = n > 0 ? positives / n : 0.5;
  const d = features.length;
  const means = features.map((f) => mean(rows.map((r) => r.features[f])));
  const sds = features.map((f, j) => {
    if (n < 2) return 1;
    let s = 0;
    for (const r of rows) s += (r.features[f] - means[j]!) ** 2;
    return Math.sqrt(s / (n - 1)) || 1;
  });
  if (n === 0 || positives === 0 || positives === n) {
    return {
      features,
      standardizer: { mean: means, sd: sds },
      weights: new Array(d).fill(0),
      intercept: positives === n ? 20 : positives === 0 ? -20 : Math.log(baseRate / (1 - baseRate)),
      baseRate,
      n,
      positives,
    };
  }
  const x: number[][] = rows.map((r) => features.map((f, j) => (r.features[f] - means[j]!) / sds[j]!));
  const y: number[] = rows.map((r) => (r.outcome === 'collapse' ? 1 : 0));
  // beta[0] = intercept, beta[1..d] = weights
  const beta = new Array<number>(d + 1).fill(0);
  for (let iter = 0; iter < 60; iter++) {
    const grad = new Array<number>(d + 1).fill(0);
    const hess = Array.from({ length: d + 1 }, () => new Array<number>(d + 1).fill(0));
    for (let i = 0; i < n; i++) {
      let z = beta[0]!;
      for (let j = 0; j < d; j++) z += beta[j + 1]! * x[i]![j]!;
      const p = sigmoid(z);
      const w = Math.max(1e-8, p * (1 - p));
      const r = y[i]! - p;
      grad[0] = grad[0]! + r;
      hess[0]![0] = hess[0]![0]! + w;
      for (let j = 0; j < d; j++) {
        grad[j + 1] = grad[j + 1]! + x[i]![j]! * r;
        hess[0]![j + 1] = hess[0]![j + 1]! + w * x[i]![j]!;
        hess[j + 1]![0] = hess[j + 1]![0]! + w * x[i]![j]!;
        for (let k = 0; k < d; k++) {
          hess[j + 1]![k + 1] = hess[j + 1]![k + 1]! + w * x[i]![j]! * x[i]![k]!;
        }
      }
    }
    for (let j = 0; j < d; j++) {
      grad[j + 1] = grad[j + 1]! - lambda * beta[j + 1]!;
      hess[j + 1]![j + 1] = hess[j + 1]![j + 1]! + lambda;
    }
    const step = solveLinear(hess, grad);
    let maxStep = 0;
    for (let j = 0; j <= d; j++) {
      beta[j] = beta[j]! + step[j]!;
      maxStep = Math.max(maxStep, Math.abs(step[j]!));
    }
    if (maxStep < 1e-9) break;
  }
  return {
    features,
    standardizer: { mean: means, sd: sds },
    weights: beta.slice(1),
    intercept: beta[0]!,
    baseRate,
    n,
    positives,
  };
}

export function predictLogistic(model: LogisticModel, run: CollapseRun): number {
  let z = model.intercept;
  for (let j = 0; j < model.features.length; j++) {
    const f = model.features[j]!;
    z += model.weights[j]! * ((run.features[f] - model.standardizer.mean[j]!) / model.standardizer.sd[j]!);
  }
  return sigmoid(z);
}

export function logit(p: number): number {
  const q = Math.min(1 - 1e-9, Math.max(1e-9, p));
  return Math.log(q / (1 - q));
}

/* ----------------------------------------------------------------- metrics -- */

export interface ReliabilityBin {
  readonly lo: number;
  readonly hi: number;
  readonly n: number;
  readonly meanPredicted: number;
  readonly observed: number;
}

export interface ModelMetrics {
  readonly n: number;
  readonly positives: number;
  readonly negatives: number;
  readonly baseRate: number;
  readonly auc: number;
  readonly brier: number;
  readonly brierBase: number;
  readonly brierSkill: number;
  readonly logLoss: number;
  readonly ece: number;
  readonly calibrationSlope: number;
  readonly calibrationIntercept: number;
  readonly bins: ReliabilityBin[];
}

export function probabilityBins(preds: readonly number[], labels: readonly boolean[], bins = CP_ECE_BINS): ReliabilityBin[] {
  const out: ReliabilityBin[] = [];
  for (let b = 0; b < bins; b++) {
    const lo = b / bins;
    const hi = (b + 1) / bins;
    let n = 0;
    let sp = 0;
    let sy = 0;
    for (let i = 0; i < preds.length; i++) {
      const p = preds[i]!;
      if (p < lo || (b < bins - 1 && p >= hi)) continue;
      n++;
      sp += p;
      sy += labels[i] ? 1 : 0;
    }
    out.push({ lo, hi, n, meanPredicted: n ? sp / n : 0, observed: n ? sy / n : 0 });
  }
  return out;
}

export function calibrationCoefficients(
  preds: readonly number[],
  labels: readonly boolean[],
): { slope: number; intercept: number } {
  const rows = preds.map((p, i) => ({ p, y: labels[i] ? 1 : 0 }));
  if (rows.length < 4 || rows.every((r) => r.y === rows[0]!.y)) return { slope: Number.NaN, intercept: Number.NaN };
  // 1-D logistic calibration with a tiny ridge; intercept unpenalised.
  let a = 0;
  let b = 1;
  for (let iter = 0; iter < 40; iter++) {
    let g0 = 0;
    let g1 = 0;
    let h00 = 0;
    let h01 = 0;
    let h11 = 0;
    for (const r of rows) {
      const z = logit(r.p);
      const p = sigmoid(a + b * z);
      const w = Math.max(1e-8, p * (1 - p));
      const res = r.y - p;
      g0 += res;
      g1 += z * res - 1e-6 * b;
      h00 += w;
      h01 += w * z;
      h11 += w * z * z + 1e-6;
    }
    const det = h00 * h11 - h01 * h01;
    if (Math.abs(det) < 1e-14) break;
    const da = (h11 * g0 - h01 * g1) / det;
    const db = (h00 * g1 - h01 * g0) / det;
    a += da;
    b += db;
    if (Math.max(Math.abs(da), Math.abs(db)) < 1e-9) break;
  }
  return { slope: b, intercept: a };
}

export function evaluatePredictions(
  preds: readonly number[],
  labels: readonly boolean[],
  trainBaseRate: number,
  bins = CP_ECE_BINS,
): ModelMetrics {
  const n = labels.length;
  const positives = labels.filter(Boolean).length;
  const negatives = n - positives;
  const baseRate = n ? positives / n : 0;
  const auc = rocAuc([...labels], [...preds]);
  let brier = 0;
  let brierBase = 0;
  let logLoss = 0;
  for (let i = 0; i < n; i++) {
    const p = Math.min(1 - 1e-12, Math.max(1e-12, preds[i]!));
    const y = labels[i] ? 1 : 0;
    brier += (p - y) ** 2;
    brierBase += (trainBaseRate - y) ** 2;
    logLoss -= y * Math.log(p) + (1 - y) * Math.log(1 - p);
  }
  brier /= Math.max(1, n);
  brierBase /= Math.max(1, n);
  logLoss /= Math.max(1, n);
  const rb = probabilityBins(preds, labels, bins);
  let ece = 0;
  for (const b of rb) ece += (b.n / Math.max(1, n)) * Math.abs(b.meanPredicted - b.observed);
  const cal = calibrationCoefficients(preds, labels);
  return {
    n,
    positives,
    negatives,
    baseRate,
    auc,
    brier,
    brierBase,
    brierSkill: brierBase > 0 ? 1 - brier / brierBase : 0,
    logLoss,
    ece,
    calibrationSlope: cal.slope,
    calibrationIntercept: cal.intercept,
    bins: rb,
  };
}

export function evaluateModel(model: LogisticModel, runs: readonly CollapseRun[]): ModelMetrics {
  const rows = runs.filter((r) => r.outcome !== 'ambiguous');
  return evaluatePredictions(
    rows.map((r) => predictLogistic(model, r)),
    rows.map((r) => r.outcome === 'collapse'),
    model.baseRate,
  );
}

export interface BootstrapCi {
  readonly lo: number;
  readonly hi: number;
  readonly median: number;
}

export function clusterBootstrap(
  runs: readonly CollapseRun[],
  metric: (sample: readonly CollapseRun[]) => number,
  reps = CP_BOOTSTRAP,
  seed = 0x5eed,
): BootstrapCi {
  const groups = new Map<string, CollapseRun[]>();
  for (const r of runs) {
    const list = groups.get(r.condition) ?? [];
    list.push(r);
    groups.set(r.condition, list);
  }
  const ids = [...groups.keys()].sort();
  const rng = mulberry32(seed);
  const values: number[] = [];
  for (let b = 0; b < reps; b++) {
    const sample: CollapseRun[] = [];
    for (let i = 0; i < ids.length; i++) {
      const id = ids[Math.floor(rng() * ids.length)]!;
      sample.push(...groups.get(id)!);
    }
    values.push(metric(sample));
  }
  return { lo: quantile(values, 0.025), hi: quantile(values, 0.975), median: quantile(values, 0.5) };
}

/* ------------------------------------------------------------------ report -- */

export interface ConditionSummary {
  readonly id: string;
  readonly rule: CollapseRule;
  readonly param: string;
  readonly split: CollapseSplit;
  readonly unseen: CollapseUnseen;
  readonly n: number;
  readonly collapse: number;
  readonly persist: number;
  readonly ambiguous: number;
  readonly meanPredicted: number;
  readonly observedCollapse: number;
  readonly meanEarly: number;
  readonly meanLate: number;
  readonly meanLateRatio: number;
}

export interface FamilyMetrics {
  readonly name: string;
  readonly features: readonly CollapseFeature[];
  readonly metrics: ModelMetrics;
  readonly aucCi: BootstrapCi;
}

export interface ClaimVerdict {
  readonly id: string;
  readonly claim: string;
  readonly verdict: Verdict;
  readonly detail: string;
  readonly numbers: Readonly<Record<string, number>>;
}

export interface ValidityGate {
  readonly passed: boolean;
  readonly reasons: readonly string[];
  readonly trainLabelled: number;
  readonly testLabelled: number;
  readonly trainPositives: number;
  readonly trainNegatives: number;
  readonly testPositives: number;
  readonly testNegatives: number;
}

export interface CollapseReport {
  readonly generatedAt: string;
  readonly design: {
    ticks: number;
    earlyFrom: number;
    earlyTo: number;
    lateFrom: number;
    lateTo: number;
    collapseMax: number;
    persistMin: number;
    spawn: number;
    maxPop: number;
    bins: number;
    lambda: number;
    bootstrap: number;
    trainSeeds: string[];
    testSeeds: string[];
    sharedSeeds: string[];
  };
  readonly conditions: readonly CollapseCondition[];
  readonly runs: readonly CollapseRun[];
  readonly conditionSummaries: readonly ConditionSummary[];
  readonly train: {
    n: number;
    positives: number;
    negatives: number;
    ambiguous: number;
    baseRate: number;
  };
  readonly test: {
    n: number;
    positives: number;
    negatives: number;
    ambiguous: number;
    baseRate: number;
  };
  readonly models: readonly FamilyMetrics[];
  readonly claims: readonly ClaimVerdict[];
  readonly validity: ValidityGate;
  readonly univariate: readonly { feature: CollapseFeature; trainAuc: number; testAuc: number; testDirection: string }[];
}

function summarizeConditions(
  runs: readonly CollapseRun[],
  predictions: ReadonlyMap<string, number>,
): ConditionSummary[] {
  const groups = new Map<string, CollapseRun[]>();
  for (const r of runs) {
    const list = groups.get(r.condition) ?? [];
    list.push(r);
    groups.set(r.condition, list);
  }
  return [...groups.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([id, rs]) => {
      const first = rs[0]!;
      const collapse = rs.filter((r) => r.outcome === 'collapse').length;
      const persist = rs.filter((r) => r.outcome === 'persist').length;
      const ambiguous = rs.length - collapse - persist;
      const labelled = rs.filter((r) => r.outcome !== 'ambiguous');
      return {
        id,
        rule: first.rule,
        param: first.param,
        split: first.split,
        unseen: first.unseen,
        n: rs.length,
        collapse,
        persist,
        ambiguous,
        meanPredicted: labelled.length ? mean(labelled.map((r) => predictions.get(`${r.condition}|${r.seed}`) ?? 0)) : 0,
        observedCollapse: labelled.length ? collapse / labelled.length : 0,
        meanEarly: mean(rs.map((r) => r.earlyMean)),
        meanLate: mean(rs.map((r) => r.lateMean)),
        meanLateRatio: mean(rs.map((r) => r.lateRatio)),
      };
    });
}

function metricFor(
  name: string,
  features: readonly CollapseFeature[],
  trainRuns: readonly CollapseRun[],
  testRuns: readonly CollapseRun[],
): FamilyMetrics {
  const model = fitLogistic(trainRuns, features);
  const metrics = evaluateModel(model, testRuns);
  const labelled = testRuns.filter((r) => r.outcome !== 'ambiguous');
  const aucCi = clusterBootstrap(labelled, (sample) =>
    rocAuc(
      sample.map((r) => r.outcome === 'collapse'),
      sample.map((r) => predictLogistic(model, r)),
    ),
  );
  return { name, features, metrics, aucCi };
}

function claimStatus(
  id: string,
  claim: string,
  supported: boolean,
  refuted: boolean,
  detail: string,
  numbers: Record<string, number>,
): ClaimVerdict {
  return {
    id,
    claim,
    verdict: supported ? 'supported' : refuted ? 'refuted' : 'inconclusive',
    detail,
    numbers,
  };
}

export function buildCollapseReport(runs: readonly CollapseRun[], generatedAt = new Date().toISOString()): CollapseReport {
  const trainRuns = runs.filter((r) => r.split === 'train');
  const testRuns = runs.filter((r) => r.split === 'test');
  const trainLabelled = trainRuns.filter((r) => r.outcome !== 'ambiguous');
  const testLabelled = testRuns.filter((r) => r.outcome !== 'ambiguous');
  const uniqueSeeds = (rs: readonly CollapseRun[]): string[] => [...new Set(rs.map((r) => r.seed))].sort();
  const trainSeedsUsed = uniqueSeeds(trainRuns);
  const testSeedsUsed = uniqueSeeds(testRuns);
  const sharedSeeds = trainSeedsUsed.filter((s) => testSeedsUsed.includes(s));
  const models = [
    metricFor('full', CP_FEATURES, trainRuns, testRuns),
    metricFor('population', CP_POPULATION_FEATURES, trainRuns, testRuns),
    metricFor('temporal', CP_TEMPORAL_FEATURES, trainRuns, testRuns),
    metricFor('entropy', CP_ENTROPY_FEATURES, trainRuns, testRuns),
    metricFor('structure', CP_STRUCTURE_FEATURES, trainRuns, testRuns),
    metricFor(
      'noEntropy',
      CP_FEATURES.filter((f) => !CP_ENTROPY_FEATURES.includes(f)),
      trainRuns,
      testRuns,
    ),
    metricFor(
      'noStructure',
      CP_FEATURES.filter((f) => !CP_STRUCTURE_FEATURES.includes(f)),
      trainRuns,
      testRuns,
    ),
  ];
  const byName = new Map(models.map((m) => [m.name, m]));
  const full = byName.get('full')!;
  const pop = byName.get('population')!;
  const temporal = byName.get('temporal')!;
  const entropy = byName.get('entropy')!;

  const fullModel = fitLogistic(trainRuns, CP_FEATURES);
  const predictions = new Map<string, number>();
  for (const r of runs) predictions.set(`${r.condition}|${r.seed}`, predictLogistic(fullModel, r));

  const deltaAuc = full.metrics.auc - pop.metrics.auc;
  const deltaCi = clusterBootstrap(testLabelled, (sample) => {
    const f = evaluateModel(fullModel, sample);
    const pModel = fitLogistic(trainRuns, CP_POPULATION_FEATURES);
    const p = evaluateModel(pModel, sample);
    return f.auc - p.auc;
  });
  const temporalDelta = full.metrics.auc - temporal.metrics.auc;
  const temporalDeltaCi = clusterBootstrap(testLabelled, (sample) => {
    const f = evaluateModel(fullModel, sample);
    const tModel = fitLogistic(trainRuns, CP_TEMPORAL_FEATURES);
    const t = evaluateModel(tModel, sample);
    return f.auc - t.auc;
  });
  const entropyDelta = full.metrics.auc - entropy.metrics.auc;
  const entropyDeltaCi = clusterBootstrap(testLabelled, (sample) => {
    const f = evaluateModel(fullModel, sample);
    const eModel = fitLogistic(trainRuns, CP_ENTROPY_FEATURES);
    const e = evaluateModel(eModel, sample);
    return f.auc - e.auc;
  });

  const trainBase = trainLabelled.length ? trainLabelled.filter((r) => r.outcome === 'collapse').length / trainLabelled.length : 0.5;
  const trainPositives = trainLabelled.filter((r) => r.outcome === 'collapse').length;
  const testPositives = testLabelled.filter((r) => r.outcome === 'collapse').length;
  const trainNegatives = trainLabelled.length - trainPositives;
  const testNegatives = testLabelled.length - testPositives;
  const gateReasons: string[] = [];
  if (trainLabelled.length < CP_MIN_LABELLED) gateReasons.push(`training labels ${trainLabelled.length} < ${CP_MIN_LABELLED}`);
  if (testLabelled.length < CP_MIN_LABELLED) gateReasons.push(`test labels ${testLabelled.length} < ${CP_MIN_LABELLED}`);
  if (trainPositives < CP_MIN_CLASS) gateReasons.push(`training collapses ${trainPositives} < ${CP_MIN_CLASS}`);
  if (trainNegatives < CP_MIN_CLASS) gateReasons.push(`training persistences ${trainNegatives} < ${CP_MIN_CLASS}`);
  if (testPositives < CP_MIN_CLASS) gateReasons.push(`test collapses ${testPositives} < ${CP_MIN_CLASS}`);
  if (testNegatives < CP_MIN_CLASS) gateReasons.push(`test persistences ${testNegatives} < ${CP_MIN_CLASS}`);
  const validity: ValidityGate = {
    passed: gateReasons.length === 0,
    reasons: gateReasons,
    trainLabelled: trainLabelled.length,
    testLabelled: testLabelled.length,
    trainPositives,
    trainNegatives,
    testPositives,
    testNegatives,
  };

  const rawClaims: ClaimVerdict[] = [
    claimStatus(
      'D-PRED-01',
      'The full early-window model discriminates collapse from persistence on unseen conditions (test AUC >= 0.70, cluster-bootstrap lower bound > 0.50).',
      full.metrics.auc >= 0.7 && full.aucCi.lo > 0.5,
      full.metrics.auc <= 0.5,
      `test AUC ${full.metrics.auc.toFixed(3)} [${full.aucCi.lo.toFixed(3)}, ${full.aucCi.hi.toFixed(3)}] on ${full.metrics.n} labelled runs (${full.metrics.positives} collapses).`,
      { auc: full.metrics.auc, aucLo: full.aucCi.lo, aucHi: full.aucCi.hi, n: full.metrics.n, positives: full.metrics.positives },
    ),
    claimStatus(
      'D-PRED-02',
      'The full model beats the population-size-plus-trend baseline by at least 0.05 AUC and has Brier skill >= 0.10.',
      deltaAuc >= 0.05 && deltaCi.lo > 0 && full.metrics.brierSkill >= 0.1,
      deltaAuc <= 0,
      `delta AUC ${deltaAuc.toFixed(3)} [${deltaCi.lo.toFixed(3)}, ${deltaCi.hi.toFixed(3)}]; Brier skill ${full.metrics.brierSkill.toFixed(3)} (population AUC ${pop.metrics.auc.toFixed(3)}).`,
      { deltaAuc, deltaLo: deltaCi.lo, deltaHi: deltaCi.hi, brierSkill: full.metrics.brierSkill, populationAuc: pop.metrics.auc },
    ),
    claimStatus(
      'D-PRED-03',
      'The full model remains calibrated on unseen conditions (ECE <= 0.10 and calibration slope in [0.5, 1.5]).',
      full.metrics.ece <= 0.1 && full.metrics.calibrationSlope >= 0.5 && full.metrics.calibrationSlope <= 1.5,
      full.metrics.ece > 0.2 || !(full.metrics.calibrationSlope >= 0 && full.metrics.calibrationSlope <= 2),
      `ECE ${full.metrics.ece.toFixed(3)}; calibration slope ${full.metrics.calibrationSlope.toFixed(3)}, intercept ${full.metrics.calibrationIntercept.toFixed(3)}; Brier ${full.metrics.brier.toFixed(3)} vs base ${full.metrics.brierBase.toFixed(3)}.`,
      {
        ece: full.metrics.ece,
        slope: full.metrics.calibrationSlope,
        intercept: full.metrics.calibrationIntercept,
        brier: full.metrics.brier,
        brierBase: full.metrics.brierBase,
      },
    ),
    claimStatus(
      'D-PRED-04',
      'Entropy alone is not a universal collapse indicator: the entropy-only model fails the same discrimination bar (AUC < 0.70).',
      entropy.metrics.auc < 0.7,
      entropy.metrics.auc >= 0.7 && entropy.aucCi.lo > 0.5,
      `entropy-only test AUC ${entropy.metrics.auc.toFixed(3)} [${entropy.aucCi.lo.toFixed(3)}, ${entropy.aucCi.hi.toFixed(3)}]; full minus entropy delta ${entropyDelta.toFixed(3)} [${entropyDeltaCi.lo.toFixed(3)}, ${entropyDeltaCi.hi.toFixed(3)}].`,
      { entropyAuc: entropy.metrics.auc, entropyLo: entropy.aucCi.lo, entropyHi: entropy.aucCi.hi, entropyDelta, entropyDeltaLo: entropyDeltaCi.lo },
    ),
    claimStatus(
      'D-PRED-05',
      'Spatial structure adds predictive value beyond population and temporal features (full minus temporal AUC >= 0.05, bootstrap lower bound > 0).',
      temporalDelta >= 0.05 && temporalDeltaCi.lo > 0,
      temporalDelta <= 0,
      `full minus temporal delta AUC ${temporalDelta.toFixed(3)} [${temporalDeltaCi.lo.toFixed(3)}, ${temporalDeltaCi.hi.toFixed(3)}] (temporal AUC ${temporal.metrics.auc.toFixed(3)}).`,
      { temporalDelta, temporalDeltaLo: temporalDeltaCi.lo, temporalDeltaHi: temporalDeltaCi.hi, temporalAuc: temporal.metrics.auc },
    ),
  ];

  // Pre-registered label gate: with too few labelled runs, or with a class
  // missing from either split, discrimination and calibration are not
  // estimable. No claim may be supported or refuted in that state.
  const claims: ClaimVerdict[] = validity.passed
    ? rawClaims
    : rawClaims.map((c) => ({
        ...c,
        verdict: 'inconclusive' as Verdict,
        detail: `Label gate failed (${gateReasons.join('; ')}). ${c.detail}`,
      }));

  const univariate = CP_FEATURES.map((feature) => {
    const trainAuc = rocAuc(
      trainLabelled.map((r) => r.outcome === 'collapse'),
      trainLabelled.map((r) => r.features[feature]),
    );
    const testAuc = rocAuc(
      testLabelled.map((r) => r.outcome === 'collapse'),
      testLabelled.map((r) => r.features[feature]),
    );
    return {
      feature,
      trainAuc,
      testAuc,
      testDirection: testAuc >= 0.5 ? 'higher in collapse' : 'lower in collapse',
    };
  });

  const conditionSummaries = summarizeConditions(runs, predictions);

  return {
    generatedAt,
    design: {
      ticks: CP_TICKS,
      earlyFrom: CP_EARLY_FROM,
      earlyTo: CP_EARLY_TO,
      lateFrom: CP_LATE_FROM,
      lateTo: CP_LATE_TO,
      collapseMax: CP_COLLAPSE_MAX,
      persistMin: CP_PERSIST_MIN,
      spawn: CP_SPAWN,
      maxPop: CP_MAX_POP,
      bins: CP_SPATIAL_BINS,
      lambda: CP_LAMBDA,
      bootstrap: CP_BOOTSTRAP,
      trainSeeds: trainSeedsUsed,
      testSeeds: testSeedsUsed,
      sharedSeeds,
    },
    conditions: CP_CONDITIONS,
    runs,
    conditionSummaries,
    train: {
      n: trainLabelled.length,
      positives: trainLabelled.filter((r) => r.outcome === 'collapse').length,
      negatives: trainLabelled.filter((r) => r.outcome === 'persist').length,
      ambiguous: trainRuns.length - trainLabelled.length,
      baseRate: trainBase,
    },
    test: {
      n: testLabelled.length,
      positives: testLabelled.filter((r) => r.outcome === 'collapse').length,
      negatives: testLabelled.filter((r) => r.outcome === 'persist').length,
      ambiguous: testRuns.length - testLabelled.length,
      baseRate: testLabelled.length ? testLabelled.filter((r) => r.outcome === 'collapse').length / testLabelled.length : 0,
    },
    models,
    claims,
    validity,
    univariate,
  };
}

/* ------------------------------------------------------------------ render -- */

const FEATURE_LABEL: Record<CollapseFeature, string> = {
  logMeanPop: 'log mean population',
  popTrend: 'population trend (per 100 ticks)',
  popCV: 'population CV',
  ar1: 'population AR(1)',
  flicker: 'population flicker',
  popTrough: 'population trough / mean',
  speciesEntropy: 'species entropy (bits)',
  spatialEntropy: 'spatial entropy (normalised)',
  moranI: "Moran's I",
  clusterFrac: 'occupied-neighbour fraction',
  occupancy: 'occupied bins',
  largestComponentFrac: 'largest component / occupied',
  radiusGyration: 'radius of gyration / world',
  meanEnergy: 'mean energy / capacity',
};

export function renderCollapseMarkdown(report: CollapseReport): string {
  const md: string[] = [];
  const pct = (v: number): string => `${(100 * v).toFixed(1)}%`;
  const num = (v: number, d = 3): string => (Number.isFinite(v) ? v.toFixed(d) : 'n/a');
  const byName = new Map(report.models.map((m) => [m.name, m]));
  const full = byName.get('full')!;
  const seedRange = (seeds: readonly string[]): string =>
    seeds.length === 0 ? 'none' : seeds.length === 1 ? seeds[0]! : `${seeds[0]}..${seeds.at(-1)} (${seeds.length})`;

  md.push('# Experiment D - predicting collapse before it is visible');
  md.push('');
  md.push(
    `Generated ${report.generatedAt}. ${report.design.ticks}-tick agent-engine runs; features from ticks ${report.design.earlyFrom}-${report.design.earlyTo}; ` +
      `outcome from ticks ${report.design.lateFrom}-${report.design.lateTo}. Collapse: late mean alive < ${report.design.collapseMax}; ` +
      `persistence: late mean alive >= ${report.design.persistMin}; the interval between is reported as ambiguous and excluded from fit and scoring.`,
  );
  md.push('');
  md.push('## Design');
  md.push('');
  md.push(
    `24 conditions = 3 rules (clonal x0, legacy x1, elevated x4 mutation supply) x 8 parameter regimes (metabolismBase, foodRegenRate). ` +
      `Training: clonal/legacy x P0,P1,P2,P6,P7 (${report.conditions.filter((c) => c.split === 'train').length} conditions, seeds ${seedRange(report.design.trainSeeds)}). ` +
      `Test: elevated x all 8 (unseen rule) plus clonal/legacy x P3,P4,P5 (unseen parameter regimes) (${report.conditions.filter((c) => c.split === 'test').length} conditions, seeds ${seedRange(report.design.testSeeds)}). ` +
      (report.design.sharedSeeds.length === 0
        ? 'No seed and no condition is shared between training and test.'
        : `Exploratory reuse: ${report.design.sharedSeeds.length} seed(s) appear on both sides (${report.design.sharedSeeds.join(', ')}); this artifact is not the registered split.`),
  );
  md.push('');
  md.push('| regime | metabolismBase | foodRegenRate | split |');
  md.push('| :-- | ---: | ---: | :-- |');
  for (const p of CP_PARAMS) {
    const train = (CP_TRAIN_PARAMS as readonly string[]).includes(p.id);
    md.push(`| ${p.id} | ${p.metabolismBase} | ${p.foodRegenRate} | ${train ? 'train' : 'test (unseen parameter)'} |`);
  }
  md.push('');
  md.push('## Features');
  md.push('');
  md.push(
    'All predictors are computed inside the early window only. Population features: level, log trend, CV, lag-1 autocorrelation, ' +
      'mean-crossing rate, trough/mean. Entropy: species Shannon entropy and normalised spatial entropy on a 16 x 16 torus grid. ' +
      "Spatial structure: Moran's I with rook weights, occupied-neighbour fraction, occupancy, largest 4-connected component, " +
      'radius of gyration around the circular centroid. Energy: mean energy / capacity. No condition label or late-window value is a predictor.',
  );
  md.push('');
  md.push('| feature | family |');
  md.push('| :-- | :-- |');
  for (const f of CP_FEATURES) {
    const family = CP_ENTROPY_FEATURES.includes(f)
      ? 'entropy'
      : CP_STRUCTURE_FEATURES.includes(f)
        ? 'spatial structure'
        : f === 'meanEnergy'
          ? 'energy'
          : 'population / temporal';
    md.push(`| ${FEATURE_LABEL[f]} | ${family} |`);
  }
  md.push('');
  md.push('## Training and test labels');
  md.push('');
  md.push(
    `Training: ${report.train.n} labelled runs (${report.train.positives} collapse, ${report.train.negatives} persist, ${report.train.ambiguous} ambiguous); ` +
      `training base rate ${pct(report.train.baseRate)}. Test: ${report.test.n} labelled runs (${report.test.positives} collapse, ` +
      `${report.test.negatives} persist, ${report.test.ambiguous} ambiguous); test base rate ${pct(report.test.baseRate)}.`,
  );
  md.push('');
  md.push('## Label gate');
  md.push('');
  if (report.validity.passed) {
    md.push(
      `**Passed.** Training ${report.validity.trainLabelled} labelled (${report.validity.trainPositives} collapse / ` +
        `${report.validity.trainNegatives} persist); test ${report.validity.testLabelled} labelled ` +
        `(${report.validity.testPositives} collapse / ${report.validity.testNegatives} persist). ` +
        `The gate requires at least ${CP_MIN_LABELLED} labelled runs and at least ${CP_MIN_CLASS} of each class in both splits.`,
    );
  } else {
    md.push(
      `**Failed.** ${report.validity.reasons.join('; ')}. The gate requires at least ${CP_MIN_LABELLED} labelled runs ` +
        `and at least ${CP_MIN_CLASS} of each class in both splits. Every claim is reported **inconclusive**; no verdict is issued.`,
    );
  }
  md.push('');
  md.push('## Held-out performance');
  md.push('');
  md.push('| model | features | AUC | 95% cluster CI | Brier | Brier skill | ECE | slope |');
  md.push('| :-- | ---: | ---: | :--: | ---: | ---: | ---: | ---: |');
  for (const m of report.models) {
    md.push(
      `| ${m.name} | ${m.features.length} | ${num(m.metrics.auc)} | [${num(m.aucCi.lo)}, ${num(m.aucCi.hi)}] | ` +
        `${num(m.metrics.brier)} | ${num(m.metrics.brierSkill)} | ${num(m.metrics.ece)} | ${num(m.metrics.calibrationSlope)} |`,
    );
  }
  md.push('');
  md.push('## Pre-registered claims');
  md.push('');
  md.push('| ID | claim | verdict | result |');
  md.push('| :-- | :-- | :-- | :-- |');
  for (const c of report.claims) {
    md.push(`| ${c.id} | ${c.claim} | **${c.verdict}** | ${c.detail} |`);
  }
  md.push('');
  md.push('## Reliability (full model)');
  md.push('');
  md.push('| predicted bin | n | mean predicted | observed collapse |');
  md.push('| :-- | ---: | ---: | ---: |');
  for (const b of full.metrics.bins) {
    md.push(`| ${b.lo.toFixed(1)}-${b.hi.toFixed(1)} | ${b.n} | ${num(b.meanPredicted)} | ${pct(b.observed)} |`);
  }
  md.push('');
  md.push('## Conditions');
  md.push('');
  md.push('| condition | split | unseen | n | collapse | persist | ambiguous | mean predicted | observed | early alive | late alive | late / early |');
  md.push('| :-- | :-- | :-- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |');
  for (const c of report.conditionSummaries) {
    md.push(
      `| ${c.id} | ${c.split} | ${c.unseen} | ${c.n} | ${c.collapse} | ${c.persist} | ${c.ambiguous} | ` +
        `${num(c.meanPredicted)} | ${pct(c.observedCollapse)} | ${num(c.meanEarly, 1)} | ${num(c.meanLate, 1)} | ${num(c.meanLateRatio, 2)} |`,
    );
  }
  md.push('');
  md.push('## Univariate test AUCs (descriptive, not the model)');
  md.push('');
  md.push('| feature | train AUC | test AUC | test direction |');
  md.push('| :-- | ---: | ---: | :-- |');
  for (const u of report.univariate) {
    md.push(`| ${FEATURE_LABEL[u.feature]} | ${num(u.trainAuc)} | ${num(u.testAuc)} | ${u.testDirection} |`);
  }
  md.push('');
  md.push('## Reading the table');
  md.push('');
  md.push(
    '- AUC is the probability that a randomly chosen collapse run scores above a randomly chosen persistence run; 0.5 is chance. ' +
      'The 95% interval is a cluster bootstrap over test conditions, not over runs, because runs within a condition are not independent.',
  );
  md.push(
    '- Brier skill is 1 - Brier(model) / Brier(training base rate on the same test runs); positive means the model beats always predicting the training collapse rate. ' +
      'ECE is the weighted gap between predicted and observed collapse frequency over five probability bins.',
  );
  md.push(
    '- Calibration slope comes from a logistic fit of outcome on the model logit on the test split; 1 is perfect, below 1 means predictions are too extreme, above 1 too timid.',
  );
  md.push('');
  md.push('## Honest reading');
  md.push('');
  md.push(
    'The run-level labels are noisy by construction: the same condition can persist or collapse on different seeds, and that seed-to-seed variation is exactly what the early features have to anticipate. ' +
      'The test split also changes the base rate and the mutation rule, so a model that only memorises condition-level stress will lose calibration even if its ranking survives. ' +
      'A positive result is therefore about transportable early structure, not about a deterministic forecast. ' +
      'An ambiguous label is not a hidden success: those runs are excluded and counted above.',
  );
  md.push('');
  md.push('## Pilot disclosure (exploratory, not evidence)');
  md.push('');
  md.push(
    'The condition grid and the 10/30 alive outcome thresholds were chosen after 3 pilot seeds (`d.p0`..`d.p2`) and a small number of single-seed grids. ' +
      'Those runs are not reused here: the confirmatory seeds `d.c0`..`d.c15` are fresh, and the split was frozen before they were opened. ' +
      'The pilot showed that constant high metabolism alone does not guarantee collapse within 600 ticks (some worlds settle at a low but nonzero population), which is why the outcome is an absolute late-window alive count rather than a ratio to the founder peak.',
  );
  md.push('');
  md.push('## Artifacts');
  md.push('');
  md.push('`research/output/collapse-predict.{md,json,csv}` and `research/output/collapse-predict-cache.jsonl`. ' +
    'Reproduce with `npm run research:collapse` (from `apps/simulation`) or `-- --from-cache` to re-render without simulating.');
  md.push('');
  return md.join('\n');
}

export function reportToCsv(report: CollapseReport): string {
  const head = [
    'condition',
    'rule',
    'param',
    'split',
    'unseen',
    'seed',
    'outcome',
    'earlyMean',
    'lateMean',
    'lateRatio',
    ...CP_FEATURES,
  ];
  const lines = [head.join(',')];
  for (const r of report.runs) {
    lines.push(
      [
        r.condition,
        r.rule,
        r.param,
        r.split,
        r.unseen,
        r.seed,
        r.outcome,
        r.earlyMean.toFixed(3),
        r.lateMean.toFixed(3),
        r.lateRatio.toFixed(3),
        ...CP_FEATURES.map((f) => r.features[f].toFixed(6)),
      ].join(','),
    );
  }
  return lines.join('\n');
}

/** Public helper for tests / scripts that only need one condition by id. */
export function conditionById(id: string): CollapseCondition {
  const c = CP_CONDITIONS.find((x) => x.id === id);
  if (!c) throw new Error(`unknown condition: ${id}`);
  return c;
}
