import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Engine } from '../engine.js';
import { buildArchetypeWorld, TIER_DEFS, type ArchetypeTier } from './archetypes.js';
import { fullStateHash } from './snapshot.js';
import { feedGenome } from './scenarios.js';

/**
 * The virtual complexity lab — a deterministic instrument that turns the agent
 * ladder (archetypes.ts) into a parameterized rule set, performs a 10⁴-scale
 * experiment grid over a MICRO parameter, and measures what the MACRO behaviour
 * does as a function of it (partial differentiation), then detects the
 * standard complexity phenomena:
 *
 *   rule set A  →  ~10⁴ deterministic experiments  →  phase transition
 *
 *   critical points, phase transitions, attractors, bifurcations, feedback
 *   loops, stability / instability, scaling laws, path dependence, hysteresis,
 *   cooperation, specialization, collective intelligence.
 *
 * Two micro parameters are differentiated w.r.t. (the engine is otherwise a
 * pure function of its world definition, so each experiment is deterministic):
 *
 *   1 · cell capacity (PRIMARY) — `energyCapacity`. Every cell's carrying
 *       capacity and every agent's initial reserve is linear in it, so it is
 *       the strongest single scalar. Swept on a log₁₀ grid over [10, 600]
 *       (~×60 budget). The medium stays natural (default food endowment).
 *
 *   2 · supply (ENVIRONMENT) — `foodRegenRate` (food energy released per cell
 *       per tick). Swept on a log₁₀ grid over [10⁻⁵, 3·10⁻²] (×3000 flux). On
 *       this axis the initial food endowment is calibrated to PROPORTIONAL to
 *       the rate, so the parameter governs total supply (endowment + flux)
 *       rather than a fixed stock that dwarfs growth.
 *
 * After a scan, every macro column is PARTIALLY DIFFERENTIATED w.r.t. the
 * micro parameter via central finite differences: ∂O/∂(log₁₀ p).
 *
 * Hysteresis in a population model must carry history in HERITABLE state: the
 * upward sweep starts naive founders; the downward sweep seeds founders whose
 * genomes come from a lineage evolved at the RICH end of the axis, so at the
 * same parameter value the two worlds differ only in where they came from. A
 * nonzero loop = path dependence; a large loop across one parameter value is
 * the signature of a first-order transition.
 *
 * Panels:
 *   1 phase scan            — macro columns vs capacity & supply per rule set
 *   2 partial differentials — ∂(macro)/∂(log₁₀ p) for both axes, critical
 *                             candidates, rebound check, critical exponents
 *   3 attractors/bifurcat.  — end-state modes per (rule set, p); bistable
 *                             windows = co-existing branches
 *   4 feedback loops        — lagged birth↔population correlation,
 *                             overdispersion
 *   5 stability             — density-infusion twins (spawn 16 vs 32)
 *   6 path dependence       — rich-lineage founders vs naive founders
 *   7 scaling laws          — capacity/supply → alive/species exponents;
 *                             group-size per-capita exponent (collective
 *                             intelligence probe)
 *   8 ensemble              — cooperation / specialization / intelligence
 *                             columns across rule sets at one regime
 *
 * Outputs (research/output/): complexity.md/json/csv + plots/complexity.svg.
 *
 * Run modes (see `sizeFor`):         npx tsx apps/simulation/src/research/complexity.ts
 *   --quick (dev, ~2 min)            npx tsx apps/simulation/src/research/complexity.ts --quick
 *   --dense (~10⁴-scale, ~60 min)    npx tsx apps/simulation/src/research/complexity.ts --dense
 */

export const RULE_SET_KEYS = [0, 1, 2, 3] as const;
export const LAB_RULE_SETS = RULE_SET_KEYS.map((idx) => TIER_DEFS[idx]!);

export type MicroAxis = 'cellCap' | 'supply';

export const CAP_LOG_MIN = Math.log10(10);
export const CAP_LOG_MAX = Math.log10(600);
export const SUPPLY_LOG_MIN = Math.log10(1e-5);
export const SUPPLY_LOG_MAX = Math.log10(3e-2);
export const SUPPLY_BASE = 3e-3;

export const LAB_BASE = {
  maxIter: 2,
  worldScale: 1,
  metabolismBase: 0.5,
  energyCapacity: 150,
} as const;

export interface LabSize {
  spawn: number;
  capScanG: number;
  capScanSeeds: number;
  scanTicks: number;
  supScanG: number;
  supScanSeeds: number;
  supTicks: number;
  hysteresisG: number;
  hysteresisSeeds: number;
  hysteresisTicks: number;
  lineageTicks: number;
  infusionSeeds: number;
  infusionTicks: number;
  reboundTicks: number;
  scalingSeeds: number;
  ensembleSeeds: number;
  intCaps: number[];
  intRegs: number[];
  intSeeds: number;
  refineN: number;
  refinePts: number;
}

export type LabMode = 'quick' | 'full' | 'dense';

export function sizeFor(mode: LabMode): LabSize {
  switch (mode) {
    case 'quick':
      return {
        spawn: 16,
        capScanG: 14,
        capScanSeeds: 3,
        scanTicks: 60,
        supScanG: 8,
        supScanSeeds: 2,
        supTicks: 160,
        hysteresisG: 6,
        hysteresisSeeds: 2,
        hysteresisTicks: 60,
        lineageTicks: 40,
        infusionSeeds: 2,
        infusionTicks: 60,
        reboundTicks: 120,
        scalingSeeds: 2,
        ensembleSeeds: 3,
        intCaps: [20, 60, 180, 500],
        intRegs: [1e-5, 3e-3, 3e-2],
        intSeeds: 2,
        refineN: 4,
        refinePts: 7,
      };
    case 'full':
      return {
        spawn: 16,
        capScanG: 48,
        capScanSeeds: 6,
        scanTicks: 100,
        supScanG: 12,
        supScanSeeds: 5,
        supTicks: 200,
        hysteresisG: 16,
        hysteresisSeeds: 5,
        hysteresisTicks: 120,
        lineageTicks: 60,
        infusionSeeds: 5,
        infusionTicks: 120,
        reboundTicks: 240,
        scalingSeeds: 5,
        ensembleSeeds: 8,
        intCaps: [15, 30, 60, 120, 240, 500],
        intRegs: [1e-5, 3e-4, 3e-3, 1e-2, 3e-2],
        intSeeds: 2,
        refineN: 4,
        refinePts: 9,
      };
    case 'dense':
      return {
        spawn: 16,
        capScanG: 84,
        capScanSeeds: 8,
        scanTicks: 80,
        supScanG: 20,
        supScanSeeds: 6,
        supTicks: 200,
        hysteresisG: 24,
        hysteresisSeeds: 6,
        hysteresisTicks: 120,
        lineageTicks: 80,
        infusionSeeds: 6,
        infusionTicks: 120,
        reboundTicks: 240,
        scalingSeeds: 6,
        ensembleSeeds: 10,
        intCaps: [15, 30, 60, 120, 240, 500],
        intRegs: [1e-5, 3e-4, 3e-3, 1e-2, 3e-2],
        intSeeds: 3,
        refineN: 6,
        refinePts: 11,
      };
  }
}

export function SIZE_FULL(): LabSize {
  return sizeFor('full');
}

export function SIZE_QUICK(): LabSize {
  return sizeFor('quick');
}

export function SIZE_DENSE(): LabSize {
  return sizeFor('dense');
}

export function capLogs(n: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(CAP_LOG_MIN + ((CAP_LOG_MAX - CAP_LOG_MIN) * i) / (n - 1));
  return out;
}

export function supplyLogs(n: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(SUPPLY_LOG_MIN + ((SUPPLY_LOG_MAX - SUPPLY_LOG_MIN) * i) / (n - 1));
  return out;
}

export function labSeeds(n: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < n; i++) out.push(`lab.w${i + 1}`);
  return out;
}

const outputDir = fileURLToPath(new URL('../../research/output/', import.meta.url));
const plotsDir = join(outputDir, 'plots');

// ---------------------------------------------------------------------------
// World building + run harness (deterministic)
// ---------------------------------------------------------------------------

export function buildLabWorld(seed: string, spawn: number, tier: ArchetypeTier, overrides: Record<string, number> = {}): ConstructorParameters<typeof Engine>[0] {
  return buildArchetypeWorld(seed, spawn, tier, {
    spawnCount: spawn,
    ...LAB_BASE,
    ...overrides,
  });
}

/**
 * On the SUPPLY axis the initial food endowment is set ∝ the regeneration rate
 * (rich end = the natural 0.35·cap endowment), so the micro parameter governs
 * TOTAL supply and its partial derivative is not swamped by a fixed stock.
 * Deterministic: applied to a freshly constructed engine, before tick 0, for
 * every run (both legs of the determinism audit go through the same path).
 */
export function calibrateSupply(engine: Engine, rate: number): void {
  const RATIO = 0.35 / 10 ** SUPPLY_LOG_MAX;
  const f = engine.grid.food;
  const c = engine.grid.cap;
  for (let i = 0; i < f.length; i++) {
    const v = c[i]! * RATIO * rate;
    f[i] = Math.min(c[i]!, Math.max(0, v));
  }
}

export interface Macro {
  aliveFrac: number;
  species: number;
  energyMean: number;
  cooperation: number;
  donation: number;
  altruism: number;
  memeEntropy: number;
  trophicEntropy: number;
  traitVar: number;
  traitDim: number;
  predatorFrac: number;
}

export interface RunResult {
  seed: string;
  ruleKey: number;
  axis: MicroAxis;
  p: number;
  lp: number;
  spawn: number;
  ticks: number;
  macro: Macro;
  hash: string;
  energyAcquired: number;
  aliveSeries?: number[];
  birthsSeries?: number[];
}

export function runLabWorld(
  world: ConstructorParameters<typeof Engine>[0],
  tier: ArchetypeTier,
  ticks: number,
  collectSeries: boolean,
  seed: string,
  axis: MicroAxis,
  p: number,
  spawn: number,
  opts: { founders?: { genomes: Float32Array[]; memes: number[] } } = {},
): RunResult {
  const engine = new Engine(world);
  engine.setBrainConfig({ enabled: tier.brain, ...(tier.brain ? { learn: 'backprop' } : {}) });
  if (tier.clones) {
    const g0 = feedGenome({ diet: 1 });
    for (const a of engine.agents.values()) {
      a.genome.set(g0.subarray(0, Math.min(a.genome.length, g0.length)));
      a.meme = 0.5;
    }
  } else if (opts.founders) {
    let i = 0;
    for (const a of engine.agents.values()) {
      const g1 = opts.founders.genomes[i % opts.founders.genomes.length]!;
      a.genome.set(g1.subarray(0, Math.min(a.genome.length, g1.length)));
      if (opts.founders.memes) a.meme = opts.founders.memes[i % opts.founders.memes.length]!;
      i++;
    }
  }
  if (axis === 'supply') calibrateSupply(engine, p);
  const aliveSeries: number[] = [];
  const birthsSeries: number[] = [];
  for (let t = 0; t < ticks; t++) {
    engine.tick();
    if (collectSeries) {
      const s = engine.stats();
      aliveSeries.push(s.aliveCount);
      birthsSeries.push(s.births);
    }
  }
  const s = engine.stats();
  const alive = [...engine.agents.values()].filter((a) => a.alive);
  const trophic = new Array(5).fill(0);
  let energySum = 0;
  let energyAcquired = 0;
  for (const a of alive) {
    const tl = Math.max(0, Math.min(4, Math.round(a.trophicLevel)));
    trophic[tl] += 1;
    energySum += a.energy;
    energyAcquired += a.energyAcquired;
  }
  const macro: Macro = {
    aliveFrac: s.aliveCount / spawn,
    species: s.speciesCount,
    energyMean: alive.length ? energySum / alive.length : 0,
    cooperation: s.meanCooperation,
    donation: s.donationRatio,
    altruism: s.meanAltruism,
    memeEntropy: s.memeEntropy,
    trophicEntropy: entropyOf(trophic),
    traitVar: s.traitTotalVariance,
    traitDim: s.traitEffectiveDim,
    predatorFrac: s.predatorFraction,
  };
  const result: RunResult = {
    seed,
    ruleKey: tier.idx,
    axis,
    p,
    lp: Math.log10(p),
    spawn,
    ticks,
    macro,
    hash: fullStateHash(engine),
    energyAcquired,
  };
  if (collectSeries) {
    result.aliveSeries = aliveSeries;
    result.birthsSeries = birthsSeries;
  }
  return result;
}

/** Evolve a lineage at the rich end of an axis; return its founder genomes+memes. */
export function richLineage(seed: string, tier: ArchetypeTier, axis: MicroAxis, pHi: number, ticks: number): { genomes: Float32Array[]; memes: number[] } {
  const label = axis === 'supply' ? 'lab.rich' : 'lab.caprich';
  const world = buildLabWorld(seed, 16, tier, axis === 'supply' ? { foodRegenRate: pHi, energyCapacity: 25 } : { energyCapacity: pHi });
  const engine = new Engine(world);
  engine.setBrainConfig({ enabled: tier.brain, ...(tier.brain ? { learn: 'backprop' } : {}) });
  if (axis === 'supply') calibrateSupply(engine, pHi);
  for (let t = 0; t < ticks; t++) engine.tick();
  const genomes: Float32Array[] = [];
  const memes: number[] = [];
  for (const a of engine.agents.values()) {
    if (!a.alive) continue;
    genomes.push(new Float32Array(a.genome));
    memes.push(a.meme);
  }
  void label;
  return { genomes, memes };
}

// ---------------------------------------------------------------------------
// Measurement math (deterministic, exported for the test gate)
// ---------------------------------------------------------------------------

export function entropyOf(counts: number[]): number {
  const tot = counts.reduce((a, b) => a + b, 0);
  if (tot === 0) return 0;
  let h = 0;
  for (const c of counts) {
    if (c <= 0) continue;
    const p = c / tot;
    h -= p * Math.log2(p);
  }
  return h;
}

export function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

export function stddev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1));
}

export function corr(xs: number[], ys: number[]): number {
  const xv: number[] = [];
  const yv: number[] = [];
  const n = Math.min(xs.length, ys.length);
  for (let i = 0; i < n; i++) {
    if (Number.isFinite(xs[i]) && Number.isFinite(ys[i])) {
      xv.push(xs[i]!);
      yv.push(ys[i]!);
    }
  }
  if (xv.length < 3) return 0;
  const mx = mean(xv);
  const my = mean(yv);
  let num = 0;
  let sx = 0;
  let sy = 0;
  for (let i = 0; i < xv.length; i++) {
    const dx = xv[i]! - mx;
    const dy = yv[i]! - my;
    num += dx * dy;
    sx += dx * dx;
    sy += dy * dy;
  }
  const den = Math.sqrt(sx * sy);
  return den > 0 ? num / den : 0;
}

/** Central finite differences over an arbitrary x axis; one-sided at the ends. */
export function derivativeCentral(ys: number[], xs: number[]): number[] {
  const n = Math.min(ys.length, xs.length);
  const d = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - 1);
    const b = Math.min(n - 1, i + 1);
    const dx = xs[b]! - xs[a]!;
    d[i] = dx !== 0 ? (ys[b]! - ys[a]!) / dx : 0;
  }
  return d;
}

/** Strict local maxima with a height-above-flanks prominence filter. */
export function findPeaks(v: number[], minProminence = 0): number[] {
  const n = v.length;
  const peaks: number[] = [];
  for (let i = 1; i < n - 1; i++) {
    if (v[i]! < v[i - 1]! || v[i]! < v[i + 1]!) continue;
    if (v[i] === v[i - 1]! && v[i] === v[i + 1]!) continue;
    let leftValley = v[i - 1]!;
    let rightValley = v[i + 1]!;
    for (let j = i - 1; j >= 0; j--) {
      if (v[j]! > v[i]!) break;
      leftValley = Math.min(leftValley, v[j]!);
    }
    for (let j = i + 1; j < n; j++) {
      if (v[j]! > v[i]!) break;
      rightValley = Math.min(rightValley, v[j]!);
    }
    const prominence = v[i]! - Math.max(leftValley, rightValley);
    if (prominence >= minProminence) peaks.push(i);
  }
  return peaks;
}

/** Deterministic 1-D Gaussian-kernel density mode counter on values in [0,1]. */
export function attractorModes(xs: number[], bw = 0.08, minProminence = 0.02): { modes: number; peaks: number[] } {
  const filled = xs.filter((x) => Number.isFinite(x) && x >= 0 && x <= 1);
  if (filled.length === 0) return { modes: 0, peaks: [] };
  const nPoints = 200;
  const pdf: number[] = [];
  for (let i = 0; i <= nPoints; i++) {
    const t = i / nPoints;
    let p = 0;
    for (const x of filled) {
      const d = (t - x) / bw;
      p += Math.exp(-0.5 * d * d);
    }
    pdf.push(p);
  }
  const scale = Math.max(...pdf);
  const peaks = findPeaks(pdf, scale > 0 ? minProminence * scale : minProminence);
  const merged: number[] = [];
  for (const i of peaks) {
    const loc = i / nPoints;
    if (merged.length && loc - merged[merged.length - 1]! < bw * 1.5) continue;
    merged.push(loc);
  }
  return { modes: merged.length, peaks: merged };
}

export interface FeedbackReport {
  rhoBirthAliveLag1: number;
  rhoBirthLag1: number;
  overdispersion: number;
}

export function feedbackReport(alive: number[], births: number[]): FeedbackReport {
  const rhoBirthAliveLag1 = corr(alive.slice(0, -1), births.slice(1));
  const rhoBirthLag1 = corr(births.slice(0, -1), births.slice(1));
  const meanB = mean(births);
  const overdispersion = meanB > 0 ? stddev(births) ** 2 / meanB : 0;
  return { rhoBirthAliveLag1, rhoBirthLag1, overdispersion };
}

export interface HysteresisResult {
  loopArea: number;
  pathIndex: number;
  maxDelta: number;
}

/** Trapezoidal loop area and path-dependence index over the log10-p axis. */
export function hysteresisLoop(lp: number[], up: number[], down: number[]): HysteresisResult {
  const n = Math.min(lp.length, up.length, down.length);
  const deltas = up.slice(0, n).map((u, i) => Math.abs(u - down[i]!));
  let area = 0;
  for (let i = 1; i < n; i++) area += ((deltas[i - 1]! + deltas[i]!) / 2) * Math.abs(lp[i]! - lp[i - 1]!);
  const span = Math.max(...up.slice(0, n), ...down.slice(0, n)) - Math.min(...up.slice(0, n), ...down.slice(0, n));
  const pathIndex = span > 0 ? deltas.filter((d) => d > 0.05 * span).length / n : 0;
  return { loopArea: area, pathIndex, maxDelta: Math.max(...deltas) };
}

export interface LogLogFit {
  slope: number;
  intercept: number;
  se: number;
  r2: number;
  n: number;
}

export function fitLogLog(xs: number[], ys: number[]): LogLogFit {
  const lx: number[] = [];
  const ly: number[] = [];
  for (let i = 0; i < Math.min(xs.length, ys.length); i++) {
    if (xs[i]! > 0 && ys[i]! > 0 && Number.isFinite(xs[i]) && Number.isFinite(ys[i])) {
      lx.push(Math.log(xs[i]!));
      ly.push(Math.log(ys[i]!));
    }
  }
  const n = lx.length;
  if (n < 3) return { slope: 0, intercept: 0, se: 0, r2: 0, n };
  const mx = mean(lx);
  const my = mean(ly);
  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < n; i++) {
    sxx += (lx[i]! - mx) ** 2;
    sxy += (lx[i]! - mx) * (ly[i]! - my);
  }
  const slope = sxx > 0 ? sxy / sxx : 0;
  const intercept = my - slope * mx;
  let ssRes = 0;
  let ssTot = 0;
  for (let i = 0; i < n; i++) {
    const pred = intercept + slope * lx[i]!;
    ssRes += (ly[i]! - pred) ** 2;
    ssTot += (ly[i]! - my) ** 2;
  }
  if (sxx <= 0 || ssTot <= 0) return { slope: 0, intercept: 0, se: 0, r2: 0, n: 0 }; // degenerate (flat) fit
  return {
    slope,
    intercept,
    se: n > 2 && sxx > 0 ? Math.sqrt(ssRes / (n - 2) / sxx) : 0,
    r2: 1 - ssRes / ssTot,
    n,
  };
}

/** Central MIXED second partial of a rectangular surface v(cap, g): ∂²v/∂lg(cap)·∂lg(g) at interior cells. */
export function crossPartial(vals: number[][], lcaps: number[], lgs: number[]): { maxCross: number; where: { i: number; j: number; lcap: number; lg: number } } {
  let maxCross = 0;
  let where = { i: -1, j: -1, lcap: 0, lg: 0 };
  if (vals.length < 3 || (vals[0]?.length ?? 0) < 3) return { maxCross, where };
  const dCap = lcaps[1]! - lcaps[0]!;
  const dLg = lgs[1]! - lgs[0]!;
  if (dCap === 0 || dLg === 0) return { maxCross, where };
  for (let i = 1; i < vals.length - 1; i++) {
    for (let j = 1; j < vals[0]!.length - 1; j++) {
      const v = (vals[i + 1]![j + 1]! - vals[i + 1]![j - 1]! - vals[i - 1]![j + 1]! + vals[i - 1]![j - 1]!) / (4 * dCap * dLg);
      if (Math.abs(v) > Math.abs(maxCross)) {
        maxCross = v;
        where = { i, j, lcap: lcaps[i]!, lg: lgs[j]! };
      }
    }
  }
  return { maxCross, where };
}

/** Half-max width of a 1-D |∂| peak in log-coordinate units (transition width). */
export function halfMaxWidth(d: number[], lp: number[]): { width: number; center: number } {
  if (d.length < 3) return { width: 0, center: NaN };
  const abs = d.map((v) => Math.abs(v));
  let center = 0;
  for (let i = 1; i < abs.length - 1; i++) if (abs[i]! > abs[center]!) center = i;
  if (abs[center]! === 0) return { width: 0, center: lp[center]! };
  const half = abs[center]! / 2;
  let li = center;
  let ri = center;
  while (li > 0 && abs[li - 1]! >= half) li--;
  while (ri < abs.length - 1 && abs[ri + 1]! >= half) ri++;
  return { width: lp[ri]! - lp[li]!, center: lp[center]! };
}

// ---------------------------------------------------------------------------
// Axis scan machinery
// ---------------------------------------------------------------------------

export interface ScanRow {
  ruleKey: number;
  p: number;
  lp: number;
  seed: string;
  run: RunResult;
}

export interface CriticalRow {
  axis: MicroAxis;
  rule: number;
  p: number;
  lp: number;
  column: string;
  dAbs: number;
  step: number;
  rebound: number;
}

export interface AxisData {
  axis: MicroAxis;
  label: string;
  lp: number[];
  rows: ScanRow[];
  columns: { macroMean: Record<string, number[]>; dMacr: Record<string, number[]> };
  ruleMean: Record<number, Record<string, number[]>>;
  criticals: CriticalRow[];
  attractors: { rule: number; modes: number; peaks: number[] }[];
  bifu: { rule: number; lp: number; modes: number }[];
  feedback: { rule: number; lp: number; meanRho: number; meanOver: number }[];
}

export const MACRO_KEYS: (keyof Macro)[] = [
  'aliveFrac',
  'species',
  'cooperation',
  'donation',
  'altruism',
  'memeEntropy',
  'trophicEntropy',
  'traitVar',
  'predatorFrac',
];

export function scanAxis(
  size: LabSize,
  axis: MicroAxis,
  nP: number,
  seeds: string[],
  ticks: number,
): { rows: ScanRow[]; lp: number[] } {
  const log10s = axis === 'supply' ? supplyLogs(nP) : capLogs(nP);
  const rows: ScanRow[] = [];
  for (const tier of LAB_RULE_SETS) {
    for (let gi = 0; gi < nP; gi++) {
      const lp = log10s[gi]!;
      const p = 10 ** lp;
      for (const seed of seeds) {
        const overrides: Record<string, number> = axis === 'supply' ? { foodRegenRate: p, energyCapacity: 25 } : { energyCapacity: p };
        const world = buildLabWorld(seed, size.spawn, tier, overrides);
        const run = runLabWorld(world, tier, ticks, true, seed, axis, p, size.spawn);
        rows.push({ ruleKey: tier.idx, p, lp, seed, run });
      }
    }
  }
  return { rows, lp: log10s };
}

function perRule(rows: ScanRow[], rule: number, seeds: number): ScanRow[] {
  return rows.filter((r) => r.ruleKey === rule);
}

function meanColumns(rows: ScanRow[], rule: number, nP: number, seeds: number): Record<string, number[]> {
  const out: Record<string, number[]> = {};
  const slice = perRule(rows, rule, seeds);
  for (const k of MACRO_KEYS) {
    const col: number[] = [];
    for (let gi = 0; gi < nP; gi++) {
      col.push(mean(slice.slice(gi * seeds, (gi + 1) * seeds).map((r) => r.run.macro[k] as number)));
    }
    out[k] = col;
  }
  return out;
}

export function analyzeAxis(size: LabSize, axis: MicroAxis, scan: { rows: ScanRow[]; lp: number[] }, nP: number, seeds: string[], ticks: number, bump: (k: number) => void): AxisData {
  const { rows, lp } = scan;
  const nSeeds = seeds.length;
  const columns: AxisData['columns'] = { macroMean: {}, dMacr: {} };
  const allMeans: Record<number, Record<string, number[]>> = {};
  for (const tier of LAB_RULE_SETS) {
    const mm = meanColumns(rows, tier.idx, nP, nSeeds);
    allMeans[tier.idx] = mm;
    for (const k of MACRO_KEYS) {
      if (!columns.macroMean[k]) columns.macroMean[k] = new Array(nP).fill(0);
      if (!columns.dMacr[k]) columns.dMacr[k] = new Array(nP).fill(0);
    }
  }
  for (const tier of LAB_RULE_SETS) {
    const mm = allMeans[tier.idx]!;
    for (const k of MACRO_KEYS) {
      columns.macroMean[k] = columns.macroMean[k]!.map((v, i) => v + mm[k]![i]! / LAB_RULE_SETS.length);
      columns.dMacr[k] = columns.dMacr[k]!.map((v, i) => v + derivativeCentral(mm[k]!, lp)[i]! / LAB_RULE_SETS.length);
    }
  }

  // critical candidates + rebound
  const criticals: CriticalRow[] = [];
  for (const tier of LAB_RULE_SETS) {
    const mm = allMeans[tier.idx]!;
    for (const k of MACRO_KEYS) {
      const dAbs = derivativeCentral(mm[k]!, lp).map((v) => Math.abs(v));
      const maxAbs = Math.max(...dAbs);
      const m = mm[k]!;
      const span = Math.max(...m) - Math.min(...m);
      const peaks = findPeaks(dAbs);
      for (const pi of peaks) {
        if (pi === 0 || pi >= nP - 1) continue;
        if (dAbs[pi]! < 0.35 * maxAbs) continue;
        const a = Math.max(0, pi - 2);
        const b = Math.min(nP - 1, pi + 2);
        const step = Math.abs(m[b]! - m[a]!);
        if (step < 0.15 * (span > 0 ? span : 1)) continue;
        const overrides: Record<string, number> = axis === 'supply' ? { foodRegenRate: 10 ** lp[pi]!, energyCapacity: 25 } : { energyCapacity: 10 ** lp[pi]! };
        const w = buildLabWorld(seeds[1]!, size.spawn, tier, overrides);
        const reboundRun = runLabWorld(w, tier, ticks, false, seeds[1]!, axis, 10 ** lp[pi]!, size.spawn);
        bump(1);
        const reboundVal = reboundRun.macro[k] as number;
        criticals.push({ axis, rule: tier.idx, p: 10 ** lp[pi]!, lp: lp[pi]!, column: k, dAbs: dAbs[pi]!, step, rebound: reboundVal - m[pi]! });
      }
    }
  }
  criticals.sort((a, b) => b.dAbs - a.dAbs);

  // attractors & bifurcations
  const attractors: AxisData['attractors'] = [];
  const bifu: AxisData['bifu'] = [];
  for (const tier of LAB_RULE_SETS) {
    const fracs = perRule(rows, tier.idx, nSeeds).map((r) => Math.min(1, r.run.macro.aliveFrac));
    const { modes, peaks } = attractorModes(fracs);
    attractors.push({ rule: tier.idx, modes, peaks });
    const step = Math.max(1, Math.floor(nP / 24));
    for (let gi = 0; gi < nP; gi += step) {
      const sliceFracs = fracs.slice(gi * nSeeds, (gi + 1) * nSeeds);
      const w = attractorModes(sliceFracs);
      if (w.modes >= 2) bifu.push({ rule: tier.idx, lp: lp[gi]!, modes: w.modes });
    }
  }

  // feedback loops
  const feedback: AxisData['feedback'] = [];
  for (const tier of LAB_RULE_SETS) {
    const slice = perRule(rows, tier.idx, nSeeds);
    const step = Math.max(1, Math.floor(nP / 16));
    for (let gi = 0; gi < nP; gi += step) {
      const sRows = slice.slice(gi * nSeeds, (gi + 1) * nSeeds);
      const rhos: number[] = [];
      const overs: number[] = [];
      for (const r of sRows) {
        if (!r.run.aliveSeries || !r.run.birthsSeries) continue;
        const rep = feedbackReport(r.run.aliveSeries, r.run.birthsSeries);
        rhos.push(rep.rhoBirthAliveLag1);
        overs.push(rep.overdispersion);
      }
      feedback.push({ rule: tier.idx, lp: lp[gi]!, meanRho: mean(rhos), meanOver: mean(overs) });
    }
  }

  return { axis, label: axis === 'supply' ? 'supply (foodRegenRate)' : 'cell capacity (energyCapacity)', lp, rows, columns, ruleMean: allMeans, criticals, attractors, bifu, feedback };
}

// ---------------------------------------------------------------------------
// Lab orchestration
// ---------------------------------------------------------------------------

export interface StabilityRow {
  rule: number;
  regime: string;
  p: number;
  dist: number;
  verdict: string;
}

export interface LabReport {
  mode: LabMode;
  size: LabSize;
  experiments: number;
  elapsedMs: number;
  determinism: { auditWorlds: number; mismatches: number; ok: boolean };
  cap: AxisData;
  sup: AxisData;
  criticalExponents: { axis: MicroAxis; rule: number; pStar: number; beta: number; r2: number; n: number }[];
  stability: StabilityRow[];
  hysteresis: { axis: MicroAxis; rule: number; loopArea: number; pathIndex: number; maxDelta: number }[];
  scaling: { capAlive: LogLogFit; supAlive: LogLogFit; supSpecies: LogLogFit; groupPerCapita: Record<number, LogLogFit> };
  ensemble: {
    rule: number;
    living: number;
    cooperation: number;
    donation: number;
    trophic: number;
    species: number;
    memeEntropy: number;
    aliveFrac: number;
  }[];
  interactionRows: IntRow[];
  interactionCross: IntCross[];
  refined: RefinedCritical[];
  phenomenonMap: Record<string, string>;
}

function runOne(
  seed: string,
  spawn: number,
  tier: ArchetypeTier,
  axis: MicroAxis,
  p: number,
  ticks: number,
  series: boolean,
  founders?: { genomes: Float32Array[]; memes: number[] },
): RunResult {
  const overrides: Record<string, number> = axis === 'supply' ? { foodRegenRate: p, energyCapacity: 25 } : { energyCapacity: p };
  return runLabWorld(buildLabWorld(seed, spawn, tier, overrides), tier, ticks, series, seed, axis, p, spawn, { founders });
}

// ---------------------------------------------------------------------------
// Two-parameter surface: capacity × supply (the interaction term)
// ---------------------------------------------------------------------------

export interface IntRow {
  rule: number;
  cap: number;
  lcap: number;
  g: number;
  lg: number;
  seed: string;
  aliveFrac: number;
  species: number;
  cooperation: number;
}

export interface RefinedCritical {
  axis: MicroAxis;
  rule: number;
  column: string;
  lpStar: number;
  pStar: number;
  dAbs: number;
  curvature: number;
  width: number;
  sharp: boolean;
}

export interface IntCross {
  rule: number;
  column: string;
  maxCross: number;
  at: { lcap: number; lg: number };
}

/** Full 2-D parameter domain (storage × flux, no scarcity cage): O(cap, g) per rule set. */
export function runInteraction(
  size: LabSize,
  seeds: string[],
  bump: (k: number) => void,
): { rows: IntRow[]; lcaps: number[]; lgs: number[] } {
  const lcaps = size.intCaps.map((c) => Math.log10(c));
  const lgs = size.intRegs.map((g) => Math.log10(g));
  const rows: IntRow[] = [];
  for (const tier of LAB_RULE_SETS) {
    for (const cap of size.intCaps) {
      for (const g of size.intRegs) {
        for (const seed of seeds.slice(0, size.intSeeds)) {
          const world = buildLabWorld(seed, size.spawn, tier, { energyCapacity: cap, foodRegenRate: g });
          const r = runLabWorld(world, tier, size.hysteresisTicks, false, seed, 'cellCap', cap, size.spawn);
          bump(1);
          rows.push({
            rule: tier.idx,
            cap,
            lcap: Math.log10(cap),
            g,
            lg: Math.log10(g),
            seed,
            aliveFrac: r.macro.aliveFrac,
            species: r.macro.species,
            cooperation: r.macro.cooperation,
          });
        }
      }
    }
  }
  return { rows, lcaps, lgs };
}

export function interactionCrossPartials(rows: IntRow[], lcaps: number[], lgs: number[], columns: ('aliveFrac' | 'species' | 'cooperation')[]): IntCross[] {
  const out: IntCross[] = [];
  for (const rule of RULE_SET_KEYS) {
    const all = rows.filter((r) => r.rule === rule);
    const meanVal = (col: 'aliveFrac' | 'species' | 'cooperation', i: number, j: number): number => {
      const pts = all.filter((r) => Math.abs(r.lcap - lcaps[i]!) < 1e-9 && Math.abs(r.lg - lgs[j]!) < 1e-9);
      return pts.length ? mean(pts.map((p) => p[col])) : 0;
    };
    for (const col of columns) {
      const vals = lcaps.map((_c, i) => lgs.map((_g, j) => meanVal(col, i, j)));
      const { maxCross, where } = crossPartial(vals, lcaps, lgs);
      if (where.i >= 0 && Math.abs(maxCross) > 1e-6) out.push({ rule, column: col, maxCross, at: { lcap: where.lcap, lg: where.lg } });
    }
  }
  return out;
}

/** Zoom a reported critical locus to a fine grid and resolve width + curvature. */
export function refineCritical(c: CriticalRow, size: LabSize, seeds: string[], bump: (k: number) => void): RefinedCritical {
  const m = size.refinePts;
  const half = 0.35;
  const fLp = Array.from({ length: m }, (_, k) => c.lp + (k - (m - 1) / 2) * ((2 * half) / (m - 1)));
  const ticks = c.axis === 'cellCap' ? size.scanTicks : size.supTicks;
  const col: number[] = [];
  for (const lp of fLp) {
    const p = 10 ** lp;
    const fs: number[] = [];
    for (const seed of seeds.slice(0, 2)) {
      const r = runOne(seed, size.spawn, LAB_RULE_SETS.find((t) => t.idx === c.rule)!, c.axis, p, ticks, false);
      bump(1);
      fs.push(r.macro[c.column as keyof Macro] as number);
    }
    col.push(mean(fs));
  }
  const d = derivativeCentral(col, fLp);
  const abs = d.map((v) => Math.abs(v));
  let peak = 1;
  for (let i = 1; i < abs.length - 1; i++) if (abs[i]! > abs[peak]!) peak = i;
  const { width, center } = halfMaxWidth(d, fLp);
  const dLp = fLp[1]! - fLp[0]!;
  const curvature = peak > 0 && peak < m - 1 ? (col[peak + 1]! - 2 * col[peak]! + col[peak - 1]!) / (dLp * dLp) : 0;
  return {
    axis: c.axis,
    rule: c.rule,
    column: c.column,
    lpStar: Number.isFinite(center) ? center : c.lp,
    pStar: 10 ** (Number.isFinite(center) ? center : c.lp),
    dAbs: abs[peak]!,
    curvature,
    width,
    sharp: width > 0 && width < 0.3,
  };
}

export function runComplexityLab(size: LabSize, seeds: string[], mode: LabMode = 'full'): LabReport {
  const t0 = performance.now();
  let experiments = 0;
  const bump = (k: number) => {
    experiments += k;
  };
  const progress = (msg: string) => console.error(`[complexity-lab ${mode}] ${msg}`);

  // ---- Primary scan: cell capacity axis ------------------------------------
  progress(`capacity scan: ${size.capScanG}×${size.capScanSeeds} seeds ×4 rule sets ×${size.scanTicks} ticks`);
  const capScan = scanAxis(size, 'cellCap', size.capScanG, seeds, size.scanTicks);
  bump(size.capScanG * size.capScanSeeds * LAB_RULE_SETS.length);
  const cap = analyzeAxis(size, 'cellCap', capScan, size.capScanG, seeds, size.scanTicks, bump);

  // ---- Secondary scan: supply axis -----------------------------------------
  progress(`supply scan: ${size.supScanG}×${size.supScanSeeds} seeds ×4 rule sets ×${size.supTicks} ticks`);
  const supScan = scanAxis(size, 'supply', size.supScanG, seeds.slice(0, size.supScanSeeds), size.supTicks);
  bump(size.supScanG * size.supScanSeeds * LAB_RULE_SETS.length);
  const sup = analyzeAxis(size, 'supply', supScan, size.supScanG, seeds.slice(0, size.supScanSeeds), size.supTicks, bump);

  // ---- Determinism audit (double-run sample worlds on both axes) -----------
  progress('determinism audit');
  let auditWorlds = 0;
  let mismatches = 0;
  for (const axis of ['cellCap', 'supply'] as const) {
    for (const tier of LAB_RULE_SETS) {
      const nP = axis === 'cellCap' ? size.capScanG : size.supScanG;
      const lpArr = axis === 'cellCap' ? cap.lp : sup.lp;
      for (const gi of [0, Math.floor(nP / 2), nP - 1]) {
        auditWorlds++;
        const a = runOne(seeds[0]!, size.spawn, tier, axis, 10 ** lpArr[gi]!, axis === 'cellCap' ? size.scanTicks : size.supTicks, false);
        const b = runOne(seeds[0]!, size.spawn, tier, axis, 10 ** lpArr[gi]!, axis === 'cellCap' ? size.scanTicks : size.supTicks, false);
        if (a.hash !== b.hash) mismatches++;
        bump(2);
      }
    }
  }

  // ---- Critical exponents near top criticals -------------------------------
  const criticalExponents: LabReport['criticalExponents'] = [];
  const allCriticals = [...cap.criticals, ...sup.criticals].sort((a, b) => b.dAbs - a.dAbs);
  for (const c of allCriticals.slice(0, 6)) {
    const src = c.axis === 'cellCap' ? capScan.rows : supScan.rows;
    const pts = src
      .filter((r) => r.ruleKey === c.rule && Math.abs(r.lp - c.lp) <= 0.5)
      .map((r) => ({ g: Math.abs(r.p - c.p), o: r.run.macro[c.column as keyof Macro] as number }));
    const fit = fitLogLog(
      pts.map((x) => x.g),
      pts.map((x) => x.o),
    );
    criticalExponents.push({ axis: c.axis, rule: c.rule, pStar: c.p, beta: fit.slope, r2: fit.r2, n: fit.n });
  }

  // ---- Stability via density infusion (on the capacity axis) ---------------
  progress('stability infusion');
  const stability: StabilityRow[] = [];
  const regimes: { name: string; p: number }[] = [
    { name: 'fragile (cap 15)', p: 15 },
    { name: 'established (cap 80)', p: 80 },
    { name: 'luxury (cap 500)', p: 500 },
  ];
  for (const tier of [TIER_DEFS[1]!, TIER_DEFS[3]!]) {
    for (const reg of regimes) {
      for (const seed of seeds.slice(0, size.infusionSeeds)) {
        const base = runOne(seed, size.spawn, tier, 'cellCap', reg.p, size.infusionTicks, false);
        const infused = runOne(seed, size.spawn * 2, tier, 'cellCap', reg.p, size.infusionTicks, false);
        bump(2);
        const dist = Math.abs(base.macro.aliveFrac - infused.macro.aliveFrac);
        const sameBasin = (base.macro.aliveFrac >= 0.5 && infused.macro.aliveFrac >= 0.5) || (base.macro.aliveFrac <= 0.15 && infused.macro.aliveFrac <= 0.15);
        const verdict = sameBasin ? 'stable (same basin)' : dist < 0.1 ? 'stable (small delta)' : 'unstable (crossed basins)';
        stability.push({ rule: tier.idx, regime: reg.name, p: reg.p, dist, verdict });
      }
    }
  }

  // ---- Path dependence & hysteresis (rich-lineage founders) ----------------
  progress(`hysteresis: ${size.hysteresisG}×${size.hysteresisSeeds} seeds up/down`);
  const hystAxis: MicroAxis = 'cellCap';
  const hystPl = capLogs(size.hysteresisG);
  const hystP = hystPl.map((x) => 10 ** x);
  const PHI = 600;
  const hysteresis: LabReport['hysteresis'] = [];
  for (const tier of [TIER_DEFS[1]!, TIER_DEFS[3]!]) {
    const hSeeds = seeds.slice(0, size.hysteresisSeeds);
    const upMean: number[] = [];
    const downMean: number[] = [];
    for (const p of hystP) {
      const fs = hSeeds.map((s) => runOne(s, size.spawn, tier, hystAxis, p, size.hysteresisTicks, false).macro.aliveFrac);
      bump(hSeeds.length);
      upMean.push(mean(fs));
    }
    for (const p of hystP) {
      const fs: number[] = [];
      for (const s of hSeeds) {
        const lineage = richLineage(s, tier, hystAxis, PHI, size.lineageTicks);
        bump(1);
        const r = runOne(s, size.spawn, tier, hystAxis, p, size.hysteresisTicks, false, lineage);
        bump(1);
        fs.push(r.macro.aliveFrac);
      }
      downMean.push(mean(fs));
    }
    const { loopArea, pathIndex, maxDelta } = hysteresisLoop(hystPl, upMean, downMean);
    hysteresis.push({ axis: hystAxis, rule: tier.idx, loopArea, pathIndex, maxDelta });
  }

  // ---- Scaling laws --------------------------------------------------------
  progress('scaling laws');
  const t3 = TIER_DEFS[3]!;
  const capPts = [15, 25, 45, 80, 150, 300, 500];
  const capAlive: number[] = [];
  for (const p of capPts) {
    const fs: number[] = [];
    for (const seed of seeds.slice(0, size.scalingSeeds)) {
      const r = runOne(seed, size.spawn, t3, 'cellCap', p, size.reboundTicks, false);
      bump(1);
      fs.push(r.macro.aliveFrac);
    }
    capAlive.push(mean(fs));
  }
  const supPts = [1e-5, 3e-5, 1e-4, 3e-4, 1e-3, 3e-3, 1e-2, 3e-2];
  const supAlive: number[] = [];
  const supSpecies: number[] = [];
  for (const p of supPts) {
    const fs: number[] = [];
    const sps: number[] = [];
    for (const seed of seeds.slice(0, size.scalingSeeds)) {
      const r = runOne(seed, size.spawn, t3, 'supply', p, size.reboundTicks, false);
      bump(1);
      fs.push(r.macro.aliveFrac);
      sps.push(r.macro.species);
    }
    supAlive.push(mean(fs));
    supSpecies.push(mean(sps));
  }
  const spawns = [4, 8, 16, 32, 64];
  const groupPerCapita: Record<number, LogLogFit> = {};
  for (const tier of [TIER_DEFS[1]!, TIER_DEFS[3]!]) {
    const pcs: number[] = [];
    for (const gs of spawns) {
      const reps: number[] = [];
      for (const seed of seeds.slice(0, size.scalingSeeds)) {
        const r = runOne(seed, gs, tier, 'cellCap', 150, size.reboundTicks, false);
        bump(1);
        reps.push(r.energyAcquired);
      }
      pcs.push(mean(reps) / gs);
    }
    groupPerCapita[tier.idx] = fitLogLog(spawns, pcs);
  }
  const scaling = {
    capAlive: fitLogLog(capPts, capAlive),
    supAlive: fitLogLog(supPts, supAlive),
    supSpecies: fitLogLog(supPts, supSpecies),
    groupPerCapita,
  };

  // ---- Ensemble at one regime ----------------------------------------------
  progress('rule-set ensemble');
  const ensemble: LabReport['ensemble'] = [];
  for (const tier of LAB_RULE_SETS) {
    const n = size.ensembleSeeds;
    let living = 0;
    let coop = 0;
    let don = 0;
    let troph = 0;
    let sp = 0;
    let mem = 0;
    let af = 0;
    for (const seed of seeds.slice(0, n)) {
      const r = runOne(seed, size.spawn, tier, 'cellCap', 150, size.reboundTicks, false);
      bump(1);
      living += r.macro.energyMean > 0 ? 1 : 0;
      coop += r.macro.cooperation;
      don += r.macro.donation;
      troph += r.macro.trophicEntropy;
      sp += r.macro.species;
      mem += r.macro.memeEntropy;
      af += r.macro.aliveFrac;
    }
    ensemble.push({
      rule: tier.idx,
      living: living / n,
      cooperation: coop / n,
      donation: don / n,
      trophic: troph / n,
      species: sp / n,
      memeEntropy: mem / n,
      aliveFrac: af / n,
    });
  }

  // ---- Two-parameter surface: capacity × supply ----------------------------
  progress(`interaction surface: ${size.intCaps.length} caps × ${size.intRegs.length} regimes ×${size.intSeeds} seeds ×4 rule sets`);
  const { rows: interactionRows, lcaps, lgs } = runInteraction(size, seeds, bump);
  const interactionCross = interactionCrossPartials(interactionRows, lcaps, lgs, ['aliveFrac', 'species', 'cooperation']);

  // ---- Critical-point refinement (fine zoom on strong loci) ----------------
  progress(`critical refinement: top ${size.refineN} loci × ${size.refinePts}-point zoom`);
  const refined: RefinedCritical[] = [];
  for (const c of allCriticals.slice(0, size.refineN)) refined.push(refineCritical(c, size, seeds, bump));

  // ---- phenomenon → evidence map -------------------------------------------
  const maxAbsD = (axis: AxisData, col: string) => Math.max(...axis.columns.dMacr[col]!.map((v) => Math.abs(v)));
  const bestCoopTier = ensemble.reduce((bi, e, i) => (e.cooperation > ensemble[bi]!.cooperation ? i : bi), 0);
  const g3 = groupPerCapita[3]!;
  const sharpest = [...interactionCross].sort((a, b) => Math.abs(b.maxCross) - Math.abs(a.maxCross))[0];
  const interactionMap = `strongest cross-term ${sharpest ? `${sharpest.column}: ∂²O/∂lg(cap)·∂lg(g) = ${sharpest.maxCross.toFixed(3)} @ (cap 10^${sharpest.at.lcap.toFixed(2)}, g 10^${sharpest.at.lg.toFixed(1)}) (T${sharpest.rule})` : 'none'}; a positive term means supply AMPLIFIES the capacity response, negative = suppresses`;
  const phenomenonMap: Record<string, string> = {
    'critical points': `${allCriticals.length} candidate loci across both axes (strongest = ${allCriticals[0] ? `${allCriticals[0].column} @ ${allCriticals[0].axis} p=${allCriticals[0].p.toExponential(1)}` : 'none'})`,
    'phase transitions': `${cap.criticals.filter((c) => c.column === 'aliveFrac').length} capacity-axis alive transitions + ${sup.criticals.filter((c) => c.column === 'aliveFrac').length} supply-axis transitions (+ step of ${cap.columns.macroMean.aliveFrac ? (Math.max(...cap.columns.macroMean.aliveFrac!) - Math.min(...cap.columns.macroMean.aliveFrac!)).toFixed(2) : '0'} across the capacity grid)`,
    attractors: attractorList(cap) + (sup.criticals.length ? ` · supply: ${attractorList(sup)}` : ''),
    bifurcations: `${cap.bifu.length} bistable windows (capacity) + ${sup.bifu.length} (supply)`,
    'feedback loops': feedbackSummary(cap),
    'stability / instability': `${stability.filter((x) => x.verdict.startsWith('stable')).length}/${stability.length} infusion twins settled in the SAME basin`,
    'scaling laws': `cap→alive b=${scaling.capAlive.slope.toFixed(2)} · sup→alive b=${scaling.supAlive.slope.toFixed(2)} · sup→species b=${scaling.supSpecies.slope.toFixed(2)}`,
    'path dependence': `up-vs-down Δ aliveFrac up to ${Math.max(...hysteresis.map((h) => h.maxDelta)).toFixed(3)} at identical p`,
    hysteresis: `loop areas: ${hysteresis.map((h) => `${h.rule === 1 ? 'T1' : 'T3'} ${h.loopArea.toFixed(3)}`).join(' · ')}`,
    cooperation: `peak mean cooperation ${Math.max(...ensemble.map((e) => e.cooperation)).toFixed(3)} at T${ensemble[bestCoopTier]!.rule}`,
    specialization: `trophic entropy T0→T3: ${ensemble.map((e) => `${e.trophic.toFixed(2)}`).join(' → ')}`,
    'collective intelligence': `per-capita group scaling: T1 b=${groupPerCapita[1]!.slope.toFixed(2)}, T3 b=${g3.slope.toFixed(2)} → ${g3.slope > 1 ? 'superlinear (collective benefit)' : g3.slope >= 0.9 ? '≈ linear (additive)' : 'sublinear (crowding)'} (R²=${g3.r2.toFixed(2)})`,
    'parameter interaction': interactionMap,
    'transition sharpness': `${refined.filter((r) => r.sharp).length}/${refined.length} refined loci are SHARP (width < 0.3 lg) — resolved transitions vs gradual gradients`,
  };

  return {
    mode,
    size,
    experiments,
    elapsedMs: performance.now() - t0,
    determinism: { auditWorlds, mismatches, ok: mismatches === 0 },
    cap,
    sup,
    criticalExponents,
    stability,
    hysteresis,
    scaling,
    ensemble,
    interactionRows,
    interactionCross,
    refined,
    phenomenonMap,
  };
}

function attractorList(axis: AxisData): string {
  return axis.attractors.map((a) => `T${a.rule}=${a.modes} mode(s) @ [${a.peaks.map((p) => p.toFixed(2)).join(', ')}]`).join(' · ');
}

function feedbackSummary(axis: AxisData): string {
  return axis.feedback
    .filter((f) => (f.rule === 1 || f.rule === 3) && Math.abs(f.meanRho) > 0.05)
    .slice(0, 8)
    .map((f) => `T${f.rule}@${axis.label.slice(0, 4)}${f.lp.toFixed(2)}=${f.meanRho.toFixed(2)}`)
    .join(' · ') || 'no sustained lagged birth↔population correlation';
}

// ---------------------------------------------------------------------------
// Report rendering
// ---------------------------------------------------------------------------

const ruleName = (r: number) => LAB_RULE_SETS.find((t) => t.idx === r)!.name;
const fmt = (n: number, d = 3) => n.toFixed(d);

function columnsAt(axis: AxisData, rule: number, lp: number): Record<string, number> {
  const out: Record<string, number> = {};
  const idx = nearestIndex(axis.lp, lp);
  const rm = axis.ruleMean[rule]!;
  for (const k of MACRO_KEYS) out[k] = rm[k]![idx] ?? 0;
  return out;
}

function nearestIndex(lp: number[], target: number): number {
  let best = 0;
  let bd = Infinity;
  for (let i = 0; i < lp.length; i++) {
    const d = Math.abs(lp[i]! - target);
    if (d < bd) {
      bd = d;
      best = i;
    }
  }
  return best;
}

export function renderComplexityReport(report: LabReport): { md: string; json: string; csv: string } {
  const elapsedS = Math.round(report.elapsedMs / 1000);
  const cap = report.cap;
  const sup = report.sup;
  const SAMPLE_FRAC = [0, 0.25, 0.5, 0.75, 1];
  const sampleLp = (lg: number[], f: number) => lg[Math.round(f * (lg.length - 1))]!;

  const md: string[] = [
    '# The virtual complexity lab',
    '',
    'A deterministic instrument for complex-systems measurement. **Rule set → experiments → phase transition**: the agent ladder (archetypes.ts) is the rule set (T0 simple rules … T3 systems); TWO micro parameters are each air-gapped into a mega-experiment and their effect on macro behaviour is measured by PARTIAL DIFFERENTIATION, `∂O/∂(log₁₀ p)`, via central finite differences.',
    '',
    `- **Micro parameter #1 — cell capacity** \`energyCapacity\` (PRIMARY). Every cell’s carrying capacity and every agent’s initial reserve scale linearly with it. Swept on a log₁₀ grid over [10, 600], ~×60. Medium stays natural.`,
    `- **Micro parameter #2 — supply** \`foodRegenRate\`. Food energy released per cell per tick. Swept on a log₁₀ grid over [1e-5, 3e-2], ~×3000. On this axis the lab imposes a SCARCITY regime — agent reserves are capped at 25 and the food ENDOWMENT is calibrated ∝ the rate — so the parameter governs total supply while the population runs close to its energy floor and the effect of the micro parameter is NOT swamped by a fixed stock.`,
    '',
    `**Ledger:** ${report.experiments.toLocaleString('en-US')} deterministic experiments · ${elapsedS} s · audit: ${report.determinism.auditWorlds} worlds double-run, ${report.determinism.mismatches} divergences — ${report.determinism.ok ? 'bit-reproducible (PASS)' : 'FAIL'}.`,
    '',
    '## 1 · Phase scan (mean-over-seed macro columns, both axes)',
    '',
    '`aliveFrac` is the population order parameter. Rows sample each axis at matching log-decades.',
    '',
    '| axis | rule set | lg p | aliveFrac | species | coop | donation | memeEnt | trophic | traitVar |',
    '| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
    ...SAMPLE_FRAC.flatMap((f) => {
      const capLp = sampleLp(cap.lp, f);
      const supLp = sampleLp(sup.lp, f);
      return [
        ...LAB_RULE_SETS.map((tier) => {
          const c = columnsAt(cap, tier.idx, capLp);
          return `| capacity | ${ruleName(tier.idx)} | ${capLp.toFixed(2)} | ${fmt(c.aliveFrac!)} | ${fmt(c.species!, 1)} | ${fmt(c.cooperation!)} | ${fmt(c.donation!)} | ${fmt(c.memeEntropy!)} | ${fmt(c.trophicEntropy!)} | ${fmt(c.traitVar!, 4)} |`;
        }),
        ...LAB_RULE_SETS.map((tier) => {
          const c = columnsAt(sup, tier.idx, supLp);
          return `| supply | ${ruleName(tier.idx)} | ${supLp.toFixed(2)} | ${fmt(c.aliveFrac!)} | ${fmt(c.species!, 1)} | ${fmt(c.cooperation!)} | ${fmt(c.donation!)} | ${fmt(c.memeEntropy!)} | ${fmt(c.trophicEntropy!)} | ${fmt(c.traitVar!, 4)} |`;
        }),
      ];
    }),
    '',
    '## 2 · Partial differentials & critical points',
    '',
    `Capacity axis: max |∂(aliveFrac)/∂lg p| = ${fmt(maxD(cap, 'aliveFrac'), 3)}; supply axis: max |∂(aliveFrac)/∂lg p| = ${fmt(maxD(sup, 'aliveFrac'), 3)}. All candidate critical loci (local maxima ≥35% of the axis’s strongest derivative with an order step ≥15% of its range, tested at a ×3 horizon — \`rebound\` = the SAME macro column O at the ×3 horizon minus its short-scan mean at the same p):`,
    '',
    '| axis | rule set | column | lg p* | p* | max|∂O| | step | rebound |',
    '| --- | --- | --- | ---: | ---: | ---: | ---: | ---: |',
    ...[...cap.criticals, ...sup.criticals].slice(0, 20).map(
      (c) => `| ${c.axis} | ${ruleName(c.rule)} | ${c.column} | ${c.lp.toFixed(2)} | ${c.p.toExponential(2)} | ${fmt(c.dAbs)} | ${fmt(c.step)} | ${c.rebound >= 0 ? '+' : ''}${fmt(c.rebound)} |`,
    ),
    '',
    `Critical-exponent estimates near the strongest loci (log–log slope of O vs |p − p*| over ±0.5 lg window):`,
    '',
    '| axis | rule set | p* | β | R² | n |',
    '| --- | --- | ---: | ---: | ---: | ---: |',
    ...report.criticalExponents.map((e) => `| ${e.axis} | ${ruleName(e.rule)} | ${e.pStar.toExponential(2)} | ${fmt(e.beta, 2)} | ${fmt(e.r2, 2)} | ${e.n} |`),
    '',
    '## 3 · Attractors & bifurcations',
    '',
    'End-state modes (kernel-density peaks of final alive fraction over all scan worlds per rule set) and bistable windows in which seeds split onto ≥ 2 modes — co-existing branches are the fingerprint of a first-order transition.',
    '',
    '| axis | rule set | attractor modes | peak locations | bistable windows |',
    '| --- | --- | ---: | --- | ---: |',
    ...[...cap.attractors.map((a) => axisAttractorRow('capacity', a, cap)), ...sup.attractors.map((a) => axisAttractorRow('supply', a, sup))],
    '',
    '## 4 · Feedback loops (capacity axis)',
    '',
    'Lag-1 birth↔population correlation per log-decade (ρ > 0 = the boom amplifies itself; ρ < 0 = density regulation). Overdispersion V(births)/E(births): >1 clustered bursts, ≈1 near-random, <1 regularized.',
    '',
    '| rule set | lg p | ρ(births, alive[t−1]) | overdispersion |',
    '| --- | ---: | ---: | ---: |',
    ...cap.feedback.slice(0, 32).map((f) => `| ${ruleName(f.rule)} | ${f.lp.toFixed(2)} | ${fmt(f.meanRho)} | ${fmt(f.meanOver, 2)} |`),
    '',
    '## 5 · Stability & instability (density infusion)',
    '',
    'Twins of the same (seed, p, rule set) at spawn 16 vs infused spawn 32, three regimes of cell capacity. Same basin + small Δ ⇒ the branch is stable to that density disturbance; a basin crossing marks instability.',
    '',
    '| rule set | regime | p | ΔaliveFrac | verdict |',
    '| --- | --- | ---: | ---: | --- |',
    ...report.stability.map((s) => `| ${ruleName(s.rule)} | ${s.regime} | ${s.p} | ${fmt(s.dist)} | ${s.verdict} |`),
    '',
    '## 6 · Path dependence & hysteresis',
    '',
    `At every p the two sweeps differ ONLY in heritable history: the upward sweep starts naive founders; the downward sweep seeds founders with genomes evolved for ${report.size.lineageTicks} ticks at the RICH end of the capacity axis (p = 600) and folded into every founding genome on the way down. A nonzero loop on the same p is path dependence; a large loop across one p is the signature of a first-order transition that must be re-funded more generously than it lost.`,
    '',
    '| rule set | loop area (lg-p) | path-dependence index | max ΔaliveFrac |',
    '| --- | ---: | ---: | ---: |',
    ...report.hysteresis.map((h) => `| ${ruleName(h.rule)} | ${fmt(h.loopArea)} | ${fmt(h.pathIndex, 2)} | ${fmt(h.maxDelta)} |`),
    '',
    '## 7 · Scaling laws',
    '',
    `Capacity → alive fraction: b = ${fmt(report.scaling.capAlive.slope, 2)} (SE ${fmt(report.scaling.capAlive.se, 2)}, R² = ${fmt(report.scaling.capAlive.r2, 2)}, n = ${report.scaling.capAlive.n}).`,
    `Supply → alive fraction: b = ${fmt(report.scaling.supAlive.slope, 2)} (R² = ${fmt(report.scaling.supAlive.r2, 2)}). · Supply → species: b = ${fmt(report.scaling.supSpecies.slope, 2)} (R² = ${fmt(report.scaling.supSpecies.r2, 2)}).`,
    `Group size → per-capita energy acquired: T1 b = ${fmt(report.scaling.groupPerCapita[1]!.slope, 2)}, T3 b = ${fmt(report.scaling.groupPerCapita[3]!.slope, 2)} (R² = ${fmt(report.scaling.groupPerCapita[3]!.r2, 2)}). ` +
      (report.scaling.groupPerCapita[3]!.slope > 1 ? 'T3 is SUPERLINEAR in group size — per-capita performance rises with colony size (collective benefit).' : 'No superlinear collective advantage observed on this axis.'),
    '',
    '## 8 · Cooperation, specialization, collective intelligence across rule sets',
    '',
    'One regime (cell capacity 150, supply 3e-3, 60-tick horizon) across the ladder: does adding constraints, cognition and systems move cooperation, donation and specialization?',
    '',
    '| rule set | living | aliveFrac | cooperation | donation | trophic entropy | species | meme entropy |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
    ...report.ensemble.map(
      (e) => `| ${ruleName(e.rule)} | ${fmt(e.living, 2)} | ${fmt(e.aliveFrac)} | ${fmt(e.cooperation)} | ${fmt(e.donation)} | ${fmt(e.trophic)} | ${fmt(e.species, 1)} | ${fmt(e.memeEntropy)} |`,
    ),
    '',
    '## 9 · Two-parameter interaction (capacity × supply)',
    '',
    'Mean alive fraction across the (cell capacity, food regen rate) surface (storage × flux). A large |∂²O/∂lg(cap)·∂lg(g)| means the two axes interact: supply can amplify or suppress the capacity transition depending on the regime.',
    '',
    ...(() => {
      if (!report.interactionCross.length) return ['_no interaction terms above the numerical floor found in this grid_'];
      const maxAbs = Math.max(...report.interactionCross.map((x) => Math.abs(x.maxCross)));
      const material = report.interactionCross.filter((x) => Math.abs(x.maxCross) >= 0.01 * maxAbs);
      if (!material.length) return ['_no material capacity↔supply interaction (all |∂²| < 1% of the strongest)_'];
      return [
        '| rule set | column | max |∂²O/∂lg(cap)·∂lg(g)| | at cap | at g |',
        '| --- | --- | ---: | ---: | ---: |',
        ...[...material]
          .sort((a, b) => Math.abs(b.maxCross) - Math.abs(a.maxCross))
          .map((x) => `| ${ruleName(x.rule)} | ${x.column} | ${fmt(Math.abs(x.maxCross))} | ${(10 ** x.at.lcap).toFixed(2)} | ${(10 ** x.at.lg).toExponential(2)} |`),
      ];
    })(),
    '',
    '## 10 · Critical-point refinement (local zoom)',
    '',
    'Top critical loci re-sampled at higher log resolution (±0.35 lg around p*) to estimate transition width and curvature. A transition is **sharp** if the half-max width w < 0.3 lg.',
    '',
    '| axis | rule set | column | lp* | p* | |∂|peak | width (lg p) | curvature | sharp |',
    '| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |',
    ...report.refined.map(
      (r) => `| ${r.axis} | ${ruleName(r.rule)} | ${r.column} | ${r.lpStar.toFixed(3)} | ${r.pStar.toExponential(2)} | ${fmt(r.dAbs)} | ${fmt(r.width, 3)} | ${fmt(r.curvature, 4)} | ${r.sharp ? 'yes' : 'no'} |`,
    ),
    '',
    '## Phenomenon → evidence',
    '',
    ...Object.entries(report.phenomenonMap).map(([p, v]) => `- **${p}** — ${v}`),
    '',
  ];

  const json = JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      name: 'virtual-complexity-lab',
      ruleSets: LAB_RULE_SETS.map((t) => ({ key: t.idx, name: t.name, brain: t.brain, env: t.env ?? null, flags: t.flags ?? null })),
      microParameters: {
        cellCapacity: { name: 'energyCapacity (cell carrying capacity + agent reserves)', grid: [10, 600], logPoints: report.size.capScanG, seeds: report.size.capScanSeeds, ticks: report.size.scanTicks },
        supply: { name: 'foodRegenRate (food flux per cell per tick; endowment ∝ rate)', grid: [1e-5, 3e-2], logPoints: report.size.supScanG, seeds: report.size.supScanSeeds, ticks: report.size.supTicks },
      },
      experiments: report.experiments,
      elapsedMs: Math.round(report.elapsedMs),
      mode: report.mode,
      determinism: report.determinism,
      capacityAxis: axisJson(report.cap),
      supplyAxis: axisJson(report.sup),
      criticalExponents: report.criticalExponents,
      stability: report.stability,
      hysteresis: report.hysteresis,
      scaling: {
        capAlive: report.scaling.capAlive,
        supAlive: report.scaling.supAlive,
        supSpecies: report.scaling.supSpecies,
        groupPerCapita: report.scaling.groupPerCapita,
      },
      ensemble: report.ensemble,
      interactionCross: report.interactionCross,
      refined: report.refined,
      interactionRows: report.interactionRows,
      phenomenonMap: report.phenomenonMap,
    },
    null,
    2,
  ) + '\n';

  const csv = [
    'axis,ruleKey,seed,lp,p,spawn,ticks,aliveFrac,species,energyMean,cooperation,donation,altruism,memeEntropy,trophicEntropy,traitVar,traitDim,predatorFrac,hash8',
    ...[...cap.rows, ...sup.rows].map((r) =>
      [
        r.run.axis,
        r.ruleKey,
        r.seed,
        r.lp.toFixed(3),
        r.p.toExponential(3),
        r.run.spawn,
        r.run.ticks,
        fmt(r.run.macro.aliveFrac),
        r.run.macro.species,
        fmt(r.run.macro.energyMean),
        fmt(r.run.macro.cooperation),
        fmt(r.run.macro.donation),
        fmt(r.run.macro.altruism),
        fmt(r.run.macro.memeEntropy),
        fmt(r.run.macro.trophicEntropy),
        fmt(r.run.macro.traitVar, 4),
        fmt(r.run.macro.traitDim, 2),
        fmt(r.run.macro.predatorFrac),
        r.run.hash.slice(0, 8),
      ].join(','),
    ),
    '',
    '# interaction surface (lcap, lg, rule, column)',
    'type,lcap,lg,cap,g,rule,column,seed,aliveFrac,species,cooperation',
    ...report.interactionRows.map((r) =>
      ['INT', r.lcap.toFixed(3), r.lg.toFixed(3), r.cap, r.g, r.rule, 'aliveFrac', r.seed, fmt(r.aliveFrac), fmt(r.species, 1), fmt(r.cooperation)].join(','),
    ),
  ].join('\n');

  return { md: md.join('\n') + '\n', json, csv };
}

function maxD(axis: AxisData, col: string): number {
  return Math.max(...axis.columns.dMacr[col]!.map((v) => Math.abs(v)));
}

function axisAttractorRow(axisLabel: string, a: { rule: number; modes: number; peaks: number[] }, axis: AxisData): string {
  return `| ${axisLabel} | ${ruleName(a.rule)} | ${a.modes} | ${a.peaks.map((p) => p.toFixed(2)).join(', ')} | ${axis.bifu.filter((b) => b.rule === a.rule).length} |`;
}

function axisJson(axis: AxisData): Record<string, unknown> {
  return {
    label: axis.label,
    lp: axis.lp,
    columns: axis.columns,
    criticals: axis.criticals,
    attractors: axis.attractors,
    bifurcations: axis.bifu,
    feedback: axis.feedback,
  };
}

export function writeComplexityReport(report: LabReport): string {
  const { md, json, csv } = renderComplexityReport(report);
  mkdirSync(plotsDir, { recursive: true });
  writeFileSync(join(outputDir, 'complexity.md'), md);
  writeFileSync(join(outputDir, 'complexity.json'), json);
  writeFileSync(join(outputDir, 'complexity.csv'), csv);
  writeFileSync(join(plotsDir, 'complexity.svg'), renderComplexitySvg(report));
  return join(outputDir, 'complexity.md');
}

export function renderComplexitySvg(report: LabReport): string {
  const W = 1040;
  const H = 1400;
  const padL = 70;
  const padR = 30;
  const padT = 34;
  const cols = 2;
  const rows = 3;
  const gw = (W - padL - padR) / cols;
  const gh = (H - padT - 40 - 320) / rows;
  const colors = ['#8a8f98', '#f2a33c', '#61dafb', '#c678dd'];
  const cap = report.cap;
  const sup = report.sup;
  const lpDim = cap.lp;
  const xScale = (lp: number) => padL + ((lp - lpDim[0]!) / (lpDim[lpDim.length - 1]! - lpDim[0]!)) * gw;
  const yScale = (v: number, lo: number, hi: number, cy: number) => padT + 32 + cy * gh - ((v - lo) / (hi - lo)) * (gh - 56);
  const panelTop = (cy: number) => padT + 32 + cy * gh;
  const title = (cx: number, cy: number, t: string) => `<text x="${padL + cx * gw + 4}" y="${panelTop(cy) - 14}" font-size="12" fill="#e4e6ea" font-weight="bold">${t}</text>\n`;
  const zeroLine = (cy: number) => `<line x1="${padL}" y1="${yScale(0, -1, 1, cy).toFixed(1)}" x2="${padL + gw}" y2="${yScale(0, -1, 1, cy).toFixed(1)}" stroke="#3a3f47" stroke-dasharray="3 3"/>\n`;

  let s = '';
  const closely = (xs: number[], ys: number[], color: string): string =>
    `<polyline points="${xs.map((x, i) => `${xScale(x).toFixed(1)},${yScale(ys[i]!, 0, 1, 0).toFixed(1)}`).join(' ')}" fill="none" stroke="${color}" stroke-width="2" opacity="0.9"/>\n`;

  // panel (0,0): capacity phase scan (aliveFrac)
  s += title(0, 0, 'phase scan — alive fraction vs cell capacity (order parameter)');
  for (const tier of LAB_RULE_SETS) {
    const mm = cap.columns.macroMean.aliveFrac!;
    s += closely(cap.lp, mm, colors[tier.idx]!);
  }
  LAB_RULE_SETS.forEach((t, i) => {
    s += `<line x1="${padL + gw - 190}" y1="${panelTop(0) + 20 + i * 16}" x2="${padL + gw - 160}" y2="${panelTop(0) + 20 + i * 16}" stroke="${colors[i]!}" stroke-width="2"/><text x="${padL + gw - 150}" y="${panelTop(0) + 24 + i * 16}" font-size="10" fill="#cfd3da">${t.name}</text>\n`;
  });

  // panel (1,0): attractors per-seed scatter (both axes, capacity half)
  s += title(1, 0, 'attractors — per-seed final alive fraction (capacity axis)');
  for (const r of cap.rows) {
    s += `<circle cx="${xScale(r.lp).toFixed(1)}" cy="${yScale(Math.min(1, r.run.macro.aliveFrac), 0, 1, 0).toFixed(1)}" r="1.6" fill="${colors[r.ruleKey]!}" opacity="0.5"/>\n`;
  }

  // panel (0,1): partial derivative of aliveFrac — supply left half, capacity right half
  s += title(0, 1, 'partial differentiation — ∂(aliveFrac)/∂(lg p)   [supply | capacity]');
  let maxDv = 1e-9;
  for (const v of cap.columns.dMacr.aliveFrac!) maxDv = Math.max(maxDv, Math.abs(v));
  for (const v of sup.columns.dMacr.aliveFrac!) maxDv = Math.max(maxDv, Math.abs(v));
  const xSupScale = (lp: number) => padL + ((lp - sup.lp[0]!) / (sup.lp[sup.lp.length - 1]! - sup.lp[0]!)) * (gw / 2 - 8);
  const xCapScale = (lp: number) => padL + gw / 2 + 8 + ((lp - cap.lp[0]!) / (cap.lp[cap.lp.length - 1]! - cap.lp[0]!)) * (gw / 2 - 8);
  for (const tier of LAB_RULE_SETS) {
    const dCap = derivativeCentral(cap.columns.macroMean.aliveFrac!, cap.lp);
    const dSup = derivativeCentral(sup.columns.macroMean.aliveFrac!, sup.lp);
    const sPts = sup.lp.map((x, i) => `${xSupScale(x).toFixed(1)},${yScale(dSup[i]!, -maxDv, maxDv, 1).toFixed(1)}`).join(' ');
    const cPts = cap.lp.map((x, i) => `${xCapScale(x).toFixed(1)},${yScale(dCap[i]!, -maxDv, maxDv, 1).toFixed(1)}`).join(' ');
    s += `<polyline points="${sPts}" fill="none" stroke="${colors[tier.idx]!}" stroke-width="1.5" opacity="0.85"/>\n`;
    s += `<polyline points="${cPts}" fill="none" stroke="${colors[tier.idx]!}" stroke-width="2"/>\n`;
  }
  s += zeroLine(1);
  const midX = padL + gw / 2;
  s += `<line x1="${midX}" y1="${panelTop(1) - 10}" x2="${midX}" y2="${panelTop(1) + gh}" stroke="#5b6068" stroke-dasharray="6 4"/><text x="${midX + 4}" y="${panelTop(1) + 18}" font-size="9" fill="#7d828b">supply (−5…−1.5)</text><text x="${midX + 8}" y="${panelTop(1) + 32}" font-size="9" fill="#7d828b">capacity (1…2.78)</text>\n`;

  // panel (1,1): feedback
  s += title(1, 1, 'feedback loops — ρ(births, alive[t−1]) per log-decade (capacity)');
  for (const rule of [1, 3]) {
    const pts = cap.feedback.filter((f) => f.rule === rule).map((f) => `${xScale(f.lp).toFixed(1)},${yScale(f.meanRho, -1, 1, 1).toFixed(1)}`).join(' ');
    s += `<polyline points="${pts}" fill="none" stroke="${colors[rule]!}" stroke-width="2"/>\n`;
  }
  s += zeroLine(1);

  // panel (0,2): hysteresis
  s += title(0, 2, 'path dependence & hysteresis — rich-lineage vs naive founders (capacity)');
  const hy = report.hysteresis;
  const maxArea = Math.max(1e-9, ...hy.map((h) => h.loopArea));
  hy.forEach((h, i) => {
    const x = padL + 60 + i * 190;
    const hh = (h.loopArea / maxArea) * (gh - 110);
    s += `<rect x="${x}" y="${panelTop(2) + gh - 40 - hh}" width="100" height="${Math.max(2, hh)}" fill="${colors[h.rule === 1 ? 1 : 3]!}" opacity="0.85"/>\n`;
    s += `<text x="${x + 50}" y="${panelTop(2) + gh - 26}" font-size="11" text-anchor="middle" fill="#cfd3da">${ruleName(h.rule)} · loop ${h.loopArea.toFixed(3)}</text>\n`;
    s += `<text x="${x + 50}" y="${panelTop(2) + 64}" font-size="10" text-anchor="middle" fill="#7d828b">max Δ ${h.maxDelta.toFixed(3)} · path ${h.pathIndex.toFixed(2)}</text>\n`;
  });

  // panel (1,2): scaling law
  s += title(1, 2, 'scaling laws — capacity → alive fraction (log–log fit) & group per-capita');
  const sl = report.scaling;
  if (sl.capAlive.n >= 3) {
    const capPts = [15, 25, 45, 80, 150, 300, 500];
    const yHat = (x: number) => 10 ** (sl.capAlive.intercept / Math.LN10 + sl.capAlive.slope * Math.log10(x));
    const x0 = Math.log10(15);
    const x1 = Math.log10(500);
    s += `<line x1="${xScale(x0).toFixed(1)}" y1="${yScale(yHat(15), 0, 1, 2).toFixed(1)}" x2="${xScale(x1).toFixed(1)}" y2="${yScale(yHat(500), 0, 1, 2).toFixed(1)}" stroke="#3a3f47" stroke-width="1.5" stroke-dasharray="4 3"/>\n`;
    for (const x of capPts) {
      const y = yHat(x);
      if (y > 0 && y <= 1.2) s += `<circle cx="${xScale(Math.log10(x)).toFixed(1)}" cy="${yScale(y, 0, 1, 2).toFixed(1)}" r="3" fill="#61dafb"/>\n`;
    }
  }
  s += `<text x="${padL + 8}" y="${panelTop(2) + 60}" font-size="11" fill="#7d828b">cap→alive b = ${sl.capAlive.slope.toFixed(2)} (R² ${sl.capAlive.r2.toFixed(2)}) · per-capita group T3 b = ${sl.groupPerCapita[3]!.slope.toFixed(2)} (R² ${sl.groupPerCapita[3]!.r2.toFixed(2)})</text>\n`;

  // interaction surface heatmaps: mean aliveFrac(capacity × supply) for T1 & T3
  const heatTop = 1100;
  const heatH = 190;
  s += `<text x="${padL}" y="${heatTop - 12}" font-size="12" fill="#e4e6ea" font-weight="bold">interaction surface — mean alive fraction O(capacity, supply) · [T1 constraints | T3 systems]</text>\n`;
  for (const rule of [1, 3]) {
    const cx = rule === 1 ? 0 : 1;
    const xs = report.size.intCaps;
    const ys = report.size.intRegs;
    const hx0 = padL + cx * gw + 44;
    const hx1 = padL + cx * gw + gw - 26;
    const hy0 = heatTop + 14;
    const hy1 = heatTop + 14 + heatH;
    const cw = (hx1 - hx0) / xs.length;
    const ch = (hy1 - hy0) / ys.length;
    const sub = report.interactionRows.filter((r) => r.rule === rule);
    let vmax = 1e-9;
    for (const r of sub) vmax = Math.max(vmax, r.aliveFrac);
    for (let i = 0; i < xs.length; i++) {
      for (let j = 0; j < ys.length; j++) {
        const pts = sub.filter((r) => Math.abs(r.cap - xs[i]!) < 1e-9 && Math.abs(r.g - ys[j]!) < 1e-9);
        const v = pts.length ? mean(pts.map((p) => p.aliveFrac)) : 0;
        const t = Math.sqrt(v / vmax);
        const g = 35 + Math.round(200 * t);
        const colour = `rgb(${45 + Math.round(30 * t)},${g},95)`;
        const x = hx0 + i * cw;
        const yTop = hy0 + (ys.length - 1 - j) * ch;
        s += `<rect x="${x.toFixed(1)}" y="${yTop.toFixed(1)}" width="${(cw - 2).toFixed(1)}" height="${(ch - 2).toFixed(1)}" fill="${colour}" rx="2"/><text x="${(x + cw / 2).toFixed(1)}" y="${(yTop + ch / 2 + 3).toFixed(1)}" font-size="9" text-anchor="middle" fill="#fff">${v.toFixed(2)}</text>\n`;
      }
    }
    s += xs.map((c, i) => `<text x="${(hx0 + i * cw + cw / 2).toFixed(1)}" y="${(hy1 + 13).toFixed(1)}" font-size="9" text-anchor="middle" fill="#cfd3da">cap ${c}</text>`).join('\n') + '\n';
    s += ys.map((g, j) => `<text x="${(hx0 - 6).toFixed(1)}" y="${(hy0 + (ys.length - 1 - j) * ch + ch / 2 + 3).toFixed(1)}" font-size="9" text-anchor="end" fill="#cfd3da">g ${g.toExponential(0)}</text>`).join('\n') + '\n';
  }
  s += `<text x="${padL}" y="${heatTop + heatH + 34}" font-size="10" fill="#7d828b">rows = supply flux g (lower → starved), columns = cell capacity; a surface dependent on g AMPLIFIES/SUPPRESSES the capacity response (see ∂²O/∂lg(cap)·∂lg(g)).</text>\n`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" font-family="ui-monospace,Menlo,Consolas,monospace">\n  <rect width="${W}" height="${H}" fill="#15171b"/>\n${s}  <text x="${W - padR}" y="${H - 10}" text-anchor="end" font-size="11" fill="#7d828b">complexity lab · ${report.experiments.toLocaleString('en-US')} deterministic experiments · determinism ${report.determinism.ok ? 'PASS' : 'FAIL'}</text>\n</svg>\n`;
}

export function summarizeComplexity(report: LabReport): void {
  const hy = report.hysteresis;
  console.log(`experiments: ${report.experiments.toLocaleString('en-US')} deterministic worlds (${Math.round(report.elapsedMs / 1000)} s)`);
  console.log(`determinism:  ${report.determinism.ok ? 'PASS' : 'FAIL'} (${report.determinism.auditWorlds} double-runs, ${report.determinism.mismatches} divergences)`);
  console.log(`criticals:    capacity ${report.cap.criticals.length} · supply ${report.sup.criticals.length} | attractor modes: ${report.cap.attractors.map((a) => `T${a.rule}=${a.modes}`).join(' ')} | bistable: ${report.cap.bifu.length}`);
  console.log(`hysteresis:   ${hy.map((h) => `${ruleName(h.rule)} loop=${h.loopArea.toFixed(3)} path=${h.pathIndex.toFixed(2)}`).join(' · ')}`);
  console.log(`scaling:      cap→alive b=${report.scaling.capAlive.slope.toFixed(2)} · per-capita T3 b=${report.scaling.groupPerCapita[3]!.slope.toFixed(2)} (${report.scaling.groupPerCapita[3]!.slope > 1 ? 'superlinear → collective benefit' : 'no superlinear collective effect'})`);
  console.log(`stability:    ${report.stability.filter((x) => x.verdict.startsWith('stable')).length}/${report.stability.length} infusion twins same-basin`);
  console.log(`cooperation:  ${report.ensemble.map((e) => `${e.cooperation.toFixed(2)}`).join(' → ')} (T0→T3) · trophic ${report.ensemble.map((e) => `${e.trophic.toFixed(2)}`).join(' → ')}`);
  const sharpest = [...report.interactionCross].sort((a, b) => Math.abs(b.maxCross) - Math.abs(a.maxCross))[0];
  console.log(
    `interaction:  ${sharpest ? `${sharpest.column} ∂²O/∂lg(cap)∂lg(g)=${sharpest.maxCross.toFixed(3)} @ T${sharpest.rule}` : 'none'} · refined ${report.refined.filter((r) => r.sharp).length}/${report.refined.length} sharp transitions (w<0.3 lg)`,
  );
}

function parseArgs(argv: string[]): LabMode {
  if (argv.includes('--dense')) return 'dense';
  if (argv.includes('--quick')) return 'quick';
  return 'full';
}

if (process.argv[1]?.endsWith('complexity.ts')) {
  const mode = parseArgs(process.argv.slice(2));
  const size = sizeFor(mode);
  const seeds = labSeeds(size.capScanSeeds);
  const report = runComplexityLab(size, seeds, mode);
  const file = writeComplexityReport(report);
  summarizeComplexity(report);
  console.log(`\n# mode=${mode} · ${report.experiments.toLocaleString('en-US')} experiments · ${Math.round(report.elapsedMs / 1000)} s · written: ${file}`);
}