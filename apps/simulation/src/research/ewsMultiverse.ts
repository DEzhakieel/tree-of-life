/**
 * Q5 multiverse: how much of the AUC-vs-tau calibration failure is a property of
 * the *analysis* rather than of the ecology?
 *
 * The registered analysis (`ews.ts`) fixes one path through a large space of
 * defensible choices: one detrender, one analysis window, one order parameter,
 * one baseline estimator, one detection threshold. A single specification can
 * always be criticised as arbitrary, so the honest test is to enumerate the
 * space, hold the *data* fixed, and report the distribution of the statistic
 * instead of one number.
 *
 * This module imports no engine: it operates on stored population and stress
 * series, so a re-analysis costs seconds instead of the ~35 minutes a
 * re-simulation costs. `multiverseRun.ts` does the simulating and caching.
 *
 * Two slopes are computed because the thesis states the calibration failure in
 * two units, and they have different dependence structures:
 *
 *   - AUC vs tau        depends only on (order parameter, window, detrender).
 *                       The detection rule cannot touch it: AUC is a rank
 *                       statistic over windows, not a threshold crossing.
 *   - lead(stress) vs tau additionally depends on (baseline, k, sustain).
 *
 * That asymmetry is a result, not an inconvenience: the AUC half of the failure
 * is robust to the detection rule *by construction*, so only the lead half needs
 * the detection-rule multiverse to be credible.
 */

import {
  aucByDistance,
  coefficientOfVariation,
  EWS_INDICATORS,
  flickering,
  indicatorDirection,
  indicatorValue,
  lag1Autocorrelation,
  mean,
  movingAverage,
  recoveryRate,
  sampleSd,
  skewness,
  variance,
  type CollapseEvent,
  type EwsIndicator,
  type EwsPoint,
} from '@fractal-life/shared';

/* ------------------------------------------------------------------ axes -- */

export type OrderParam = 'pop' | 'log' | 'sqrt' | 'cv';
export const ORDER_PARAMS: OrderParam[] = ['pop', 'log', 'sqrt', 'cv'];

export type Detrender = 'none' | 'ma10' | 'ma25' | 'ma50' | 'gauss10' | 'gauss25' | 'median11' | 'linear';
export const DETRENDERS: Detrender[] = ['none', 'ma10', 'ma25', 'ma50', 'gauss10', 'gauss25', 'median11', 'linear'];

export type Baseline = 'preramp' | 'preramp-long' | 'ewma' | 'stress-band';
export const BASELINES: Baseline[] = ['preramp', 'preramp-long', 'ewma', 'stress-band'];

/** smoothing width in ticks; a smoother wider than the analysis window is not a usable specification */
export function detrenderWidth(d: Detrender): number {
  switch (d) {
    case 'none':
    case 'linear':
      return 0;
    case 'ma10':
      return 10;
    case 'ma25':
      return 25;
    case 'ma50':
      return 50;
    case 'gauss10':
      return 21;
    case 'gauss25':
      return 51;
    case 'median11':
      return 11;
  }
}

export interface MultiverseSpec {
  order: OrderParam;
  window: number;
  step: number;
  detrender: Detrender;
  baseline: Baseline;
  k: number;
  sustain: number;
}

export const WINDOWS = [40, 60, 90];
export const KS = [1, 1.5, 2];
export const SUSTAIN = 0.7;
export const STEP = 15;

export function specId(s: MultiverseSpec): string {
  return `${s.order}|w${s.window}|${s.detrender}|${s.baseline}|k${s.k}`;
}

/**
 * Full cross product, minus specifications that cannot be evaluated honestly: a
 * 50-tick moving average inside a 40-tick window is not a detrender, it is a
 * cumulative mean that flattens the residual to zero and manufactures AUC 0.5.
 */
export function multiverseSpecs(): MultiverseSpec[] {
  const out: MultiverseSpec[] = [];
  for (const order of ORDER_PARAMS) {
    for (const window of WINDOWS) {
      for (const detrender of DETRENDERS) {
        if (detrenderWidth(detrender) > window) continue;
        for (const baseline of BASELINES) {
          for (const k of KS) {
            out.push({ order, window, step: STEP, detrender, baseline, k, sustain: SUSTAIN });
          }
        }
      }
    }
  }
  return out;
}

/** the registered analysis, expressed as a spec, for side-by-side comparison */
export const REGISTERED_SPEC: MultiverseSpec = {
  order: 'pop',
  window: 60,
  step: 15,
  detrender: 'ma25',
  baseline: 'preramp',
  k: 1.5,
  sustain: 0.7,
};

/* ------------------------------------------------------ series transforms -- */

export function transformOrder(pop: number[], order: OrderParam, window: number): number[] {
  switch (order) {
    case 'pop':
      return pop.slice();
    case 'log':
      return pop.map((v) => Math.log1p(Math.max(0, v)));
    case 'sqrt':
      return pop.map((v) => Math.sqrt(Math.max(0, v)));
    case 'cv':
      return rollingCv(pop, window);
  }
}

/** causal trailing coefficient of variation: the state variable when `order === 'cv'` */
export function rollingCv(xs: number[], w: number): number[] {
  const out = new Array<number>(xs.length);
  for (let i = 0; i < xs.length; i++) {
    const from = Math.max(0, i - w + 1);
    const slice = xs.slice(from, i + 1);
    const m = mean(slice);
    out[i] = m === 0 ? 0 : sampleSd(slice) / Math.abs(m);
  }
  return out;
}

function gaussianSmooth(xs: number[], radius: number): number[] {
  const sigma = Math.max(1, radius / 2);
  const w: number[] = [];
  let norm = 0;
  for (let k = -radius; k <= radius; k++) {
    const g = Math.exp(-(k * k) / (2 * sigma * sigma));
    w.push(g);
    norm += g;
  }
  const out = new Array<number>(xs.length);
  for (let i = 0; i < xs.length; i++) {
    let s = 0;
    for (let k = -radius; k <= radius; k++) {
      s += xs[Math.min(xs.length - 1, Math.max(0, i + k))] * w[k + radius];
    }
    out[i] = s / norm;
  }
  return out;
}

function medianFilter(xs: number[], width: number): number[] {
  const r = Math.floor(width / 2);
  const out = new Array<number>(xs.length);
  for (let i = 0; i < xs.length; i++) {
    const slice: number[] = [];
    for (let k = -r; k <= r; k++) slice.push(xs[Math.min(xs.length - 1, Math.max(0, i + k))]);
    slice.sort((a, b) => a - b);
    const mid = slice.length >> 1;
    out[i] = slice.length % 2 ? slice[mid] : (slice[mid - 1] + slice[mid]) / 2;
  }
  return out;
}

function olsLine(xs: number[]): number[] {
  const n = xs.length;
  const mx = (n - 1) / 2;
  const my = mean(xs);
  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < n; i++) {
    const dx = i - mx;
    sxx += dx * dx;
    sxy += dx * (xs[i] - my);
  }
  const slope = sxx === 0 ? 0 : sxy / sxx;
  return xs.map((_v, i) => my + slope * (i - mx));
}

function smoothWindow(xs: number[], d: Detrender): number[] {
  switch (d) {
    case 'none':
      return xs;
    case 'linear':
      return olsLine(xs);
    case 'ma10':
      return movingAverage(xs, Math.min(10, xs.length));
    case 'ma25':
      return movingAverage(xs, Math.min(25, xs.length));
    case 'ma50':
      return movingAverage(xs, Math.min(50, xs.length));
    case 'gauss10':
      return gaussianSmooth(xs, 10);
    case 'gauss25':
      return gaussianSmooth(xs, 25);
    case 'median11':
      return medianFilter(xs, Math.min(11, xs.length));
  }
}

/* -------------------------------------------------------------- EWS path -- */

export function windowStats(xs: number[], detrender: Detrender): Omit<EwsPoint, 'tick' | 'center'> {
  // `none` means "analyse the series as it is", not "subtract the series from itself"
  const resid = detrender === 'none' ? xs.slice() : (() => {
    const smooth = smoothWindow(xs, detrender);
    return xs.map((v, i) => v - smooth[i]);
  })();
  const ar1 = lag1Autocorrelation(resid);
  return {
    mean: mean(xs),
    variance: variance(resid),
    ar1,
    recovery: recoveryRate(ar1),
    cv: coefficientOfVariation(xs),
    skewness: skewness(xs),
    flicker: flickering(xs),
  };
}

export function ewsPoints(series: number[], window: number, step: number, detrender: Detrender): EwsPoint[] {
  const points: EwsPoint[] = [];
  if (series.length < window) return points;
  for (let start = 0; start + window <= series.length; start += step) {
    const w = windowStats(series.slice(start, start + window), detrender);
    points.push({ tick: start, center: start + window / 2, ...w });
  }
  return points;
}

export interface PointsKey {
  order: OrderParam;
  window: number;
  step: number;
  detrender: Detrender;
}

export function pointsKey(k: PointsKey): string {
  return `${k.order}|w${k.window}|s${k.step}|${k.detrender}`;
}

/** the distinct point sets a spec set needs, so the simulation is re-analysed, not re-run */
export function requiredPointSets(specs: MultiverseSpec[]): PointsKey[] {
  const seen = new Set<string>();
  const out: PointsKey[] = [];
  for (const s of specs) {
    const k = { order: s.order, window: s.window, step: s.step, detrender: s.detrender };
    const id = pointsKey(k);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(k);
  }
  return out;
}

/* ------------------------------------------------------------ detections -- */

export interface RunSeries {
  seed: string;
  ramp: number;
  pop: number[];
  stress: number[];
  collapse: CollapseEvent | null;
  collapseStress: number | null;
}

export interface LeadOptions {
  baseline: Baseline;
  k: number;
  sustain: number;
  baselineFrom: number;
  baselineTo: number;
  horizon: number;
  stressBand: number;
  ewmaSpan: number;
}

export const DEFAULT_LEAD: Omit<LeadOptions, 'baseline' | 'k' | 'sustain'> = {
  baselineFrom: 150,
  baselineTo: 310,
  horizon: 1150,
  stressBand: 1.5,
  ewmaSpan: 20,
};

export interface Detection {
  tick: number;
  center: number;
  leadTicks: number;
  bar: number;
}

function medianMad(xs: number[]): { mu: number; sd: number } {
  const sorted = xs.slice().sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  const med = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  const dev = xs.map((v) => Math.abs(v - med)).sort((a, b) => a - b);
  const mad = dev.length % 2 ? dev[dev.length >> 1] : (dev[(dev.length >> 1) - 1] + dev[dev.length >> 1]) / 2;
  return { mu: med, sd: 1.4826 * mad };
}

/**
 * First warning time under a chosen detection rule.
 *
 * The sustain rule ("the indicator must stay past the bar for at least `sustain`
 * of the remaining pre-collapse windows") is evaluated with suffix counts, so
 * this is O(n) per indicator instead of the O(n^2) scan in `leadTime`. The
 * semantics are identical: a multiverse must not silently change the rule it is
 * supposed to be varying around.
 */
export function detectWarning(
  points: EwsPoint[],
  ind: EwsIndicator,
  collapseTick: number,
  stress: number[],
  opts: LeadOptions,
): Detection | null {
  const dir = indicatorDirection(ind);
  const pre = points.filter((p) => p.center < collapseTick);
  if (pre.length < 4) return null;

  if (opts.baseline === 'ewma') {
    // causal exponentially weighted mean/variance: no look-ahead
    const alpha = 2 / (opts.ewmaSpan + 1);
    let mu = indicatorValue(pre[0], ind);
    let va = 0;
    const hit = pre.map((p, i) => {
      const v = indicatorValue(p, ind);
      if (i === 0) return false;
      const sd = Math.sqrt(Math.max(0, va));
      const bar = mu + dir * opts.k * sd;
      const above = dir > 0 ? v >= bar : v <= bar;
      const d = v - mu;
      mu += alpha * d;
      va = (1 - alpha) * (va + alpha * d * d);
      return above;
    });
    return firstSustained(pre, hit, opts.sustain, collapseTick, opts.horizon, Number.NaN);
  }

  const long = opts.baseline === 'preramp-long';
  const band = opts.baseline === 'stress-band';
  const from = long ? opts.baselineFrom - 200 : opts.baselineFrom;
  const base = points.filter((p) => {
    if (p.center < from || p.center > opts.baselineTo) return false;
    if (band) return (stress[Math.min(p.center | 0, stress.length - 1)] ?? 0) <= opts.stressBand;
    return true;
  });
  if (base.length < 4) return null;

  const vals = base.map((p) => indicatorValue(p, ind));
  const { mu, sd } = band ? medianMad(vals) : { mu: mean(vals), sd: sampleSd(vals) };
  if (!(sd > 0)) return null;
  const threshold = mu + dir * opts.k * sd;
  const hit = pre.map((p) => {
    const v = indicatorValue(p, ind);
    return dir > 0 ? v >= threshold : v <= threshold;
  });
  return firstSustained(pre, hit, opts.sustain, collapseTick, opts.horizon, threshold);
}

export function firstSustained(
  pre: EwsPoint[],
  hit: boolean[],
  sustain: number,
  collapseTick: number,
  horizon: number,
  bar: number,
): Detection | null {
  const n = pre.length;
  const suffix = new Array<number>(n + 1).fill(0);
  for (let i = n - 1; i >= 0; i--) suffix[i] = suffix[i + 1] + (hit[i] ? 1 : 0);
  for (let i = 0; i < n; i++) {
    if (!hit[i]) continue;
    if (suffix[i] / (n - i) < sustain) continue;
    const leadTicks = collapseTick - pre[i].tick;
    // the original rule rejects (does not skip past) a warning that is too early
    if (leadTicks > horizon) return null;
    return { tick: pre[i].tick, center: pre[i].center, leadTicks, bar };
  }
  return null;
}

/* -------------------------------------------------------------- analysis -- */

export interface Fit {
  slope: number;
  intercept: number;
  r2: number;
}

export function ols(xs: number[], ys: number[]): Fit {
  const n = Math.min(xs.length, ys.length);
  if (n < 2) return { slope: 0, intercept: ys[0] ?? 0, r2: 0 };
  const mx = mean(xs.slice(0, n));
  const my = mean(ys.slice(0, n));
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx;
    const dy = ys[i] - my;
    sxx += dx * dx;
    sxy += dx * dy;
    syy += dy * dy;
  }
  const slope = sxx === 0 ? 0 : sxy / sxx;
  return { slope, intercept: my - slope * mx, r2: syy === 0 ? 0 : (sxy * sxy) / (sxx * syy) };
}

export interface SpecOutcome {
  spec: MultiverseSpec;
  id: string;
  runs: number;
  collapsed: number;
  pooledAuc: Record<EwsIndicator, number>;
  aucSlope: Record<EwsIndicator, Fit>;
  leadParamSlope: Record<EwsIndicator, Fit>;
  leadTicksSlope: Record<EwsIndicator, Fit>;
  detect: Record<EwsIndicator, number>;
  meanLeadParam: Record<EwsIndicator, number>;
  /** [indicator][ramp][seedIndex] — aligned to the seed list for the bootstrap */
  aucBySeed: Record<EwsIndicator, Record<number, (number | null)[]>>;
  leadBySeed: Record<EwsIndicator, Record<number, (number | null)[]>>;
}

export interface AnalyzeOptions {
  seeds: string[];
  ramps: number[];
  lead?: Partial<Omit<LeadOptions, 'baseline' | 'k' | 'sustain'>>;
  /** bootstrap replicates for the registered specification */
  reps?: number;
}

const EARLY_UNTIL = 290; // burn-in 350 minus 60: this is data, not an analysis choice

function emptyIndArrays(): Record<EwsIndicator, number[]> {
  const out = {} as Record<EwsIndicator, number[]>;
  for (const ind of EWS_INDICATORS) out[ind] = [];
  return out;
}

export function analyzeSpec(
  runs: RunSeries[],
  pointsByRun: Map<string, Map<string, EwsPoint[]>>,
  spec: MultiverseSpec,
  opts: AnalyzeOptions,
): SpecOutcome {
  const leadOpts: LeadOptions = {
    ...DEFAULT_LEAD,
    ...opts.lead,
    baseline: spec.baseline,
    k: spec.k,
    sustain: spec.sustain,
  };
  const key = pointsKey({ order: spec.order, window: spec.window, step: spec.step, detrender: spec.detrender });

  const pooledAucVals = emptyIndArrays();
  const leadVals = emptyIndArrays();
  const leadTickVals = emptyIndArrays();
  const perRampAuc = new Map<number, Record<EwsIndicator, number[]>>();
  const perRampLead = new Map<number, Record<EwsIndicator, number[]>>();
  const perRampLeadTicks = new Map<number, Record<EwsIndicator, number[]>>();
  for (const ramp of opts.ramps) {
    perRampAuc.set(ramp, emptyIndArrays());
    perRampLead.set(ramp, emptyIndArrays());
    perRampLeadTicks.set(ramp, emptyIndArrays());
  }

  const aucBySeed = {} as Record<EwsIndicator, Record<number, (number | null)[]>>;
  const leadBySeed = {} as Record<EwsIndicator, Record<number, (number | null)[]>>;
  for (const ind of EWS_INDICATORS) {
    aucBySeed[ind] = {};
    leadBySeed[ind] = {};
    for (const ramp of opts.ramps) {
      aucBySeed[ind][ramp] = opts.seeds.map(() => null);
      leadBySeed[ind][ramp] = opts.seeds.map(() => null);
    }
  }

  let collapsed = 0;
  for (const run of runs) {
    if (!run.collapse) continue;
    const points = pointsByRun.get(runKey(run))?.get(key);
    if (!points) continue;
    collapsed++;
    const collapseTick = run.collapse.tick;
    const si = opts.seeds.indexOf(run.seed);
    for (const ind of EWS_INDICATORS) {
      const auc = aucByDistance(points, ind, collapseTick, 40, 250, EARLY_UNTIL).auc;
      pooledAucVals[ind].push(auc);
      perRampAuc.get(run.ramp)![ind].push(auc);
      if (si >= 0) aucBySeed[ind][run.ramp][si] = auc;

      const det = detectWarning(points, ind, collapseTick, run.stress, leadOpts);
      if (det && run.collapseStress !== null) {
        const at = Math.min(Math.max(det.tick, 0), run.stress.length - 1);
        const lp = run.collapseStress - run.stress[at];
        leadVals[ind].push(lp);
        leadTickVals[ind].push(det.leadTicks);
        perRampLead.get(run.ramp)![ind].push(lp);
        perRampLeadTicks.get(run.ramp)![ind].push(det.leadTicks);
        if (si >= 0) leadBySeed[ind][run.ramp][si] = lp;
      }
    }
  }

  const aucSlope = {} as Record<EwsIndicator, Fit>;
  const leadParamSlope = {} as Record<EwsIndicator, Fit>;
  const leadTicksSlope = {} as Record<EwsIndicator, Fit>;
  const detect = {} as Record<EwsIndicator, number>;
  const meanLeadParam = {} as Record<EwsIndicator, number>;
  const pooledAuc = {} as Record<EwsIndicator, number>;

  for (const ind of EWS_INDICATORS) {
    aucSlope[ind] = ols(
      opts.ramps,
      opts.ramps.map((r) => mean(perRampAuc.get(r)![ind])),
    );
    leadParamSlope[ind] = ols(
      opts.ramps,
      opts.ramps.map((r) => mean(perRampLead.get(r)![ind])),
    );
    leadTicksSlope[ind] = ols(
      opts.ramps,
      opts.ramps.map((r) => mean(perRampLeadTicks.get(r)![ind])),
    );
    pooledAuc[ind] = mean(pooledAucVals[ind]);
    detect[ind] = collapsed ? leadVals[ind].length / collapsed : 0;
    meanLeadParam[ind] = mean(leadVals[ind]);
  }

  return {
    spec,
    id: specId(spec),
    runs: runs.length,
    collapsed,
    pooledAuc,
    aucSlope,
    leadParamSlope,
    leadTicksSlope,
    detect,
    meanLeadParam,
    aucBySeed,
    leadBySeed,
  };
}

export function runKey(r: RunSeries): string {
  return `${r.seed}@${r.ramp}`;
}

export function buildPoints(runs: RunSeries[], keys: PointsKey[]): Map<string, Map<string, EwsPoint[]>> {
  const out = new Map<string, Map<string, EwsPoint[]>>();
  for (const run of runs) {
    const perRun = new Map<string, EwsPoint[]>();
    for (const k of keys) {
      perRun.set(pointsKey(k), ewsPoints(transformOrder(run.pop, k.order, k.window), k.window, k.step, k.detrender));
    }
    out.set(runKey(run), perRun);
  }
  return out;
}

/* ------------------------------------------------------------- summaries -- */

export type Axis = 'order' | 'window' | 'detrender' | 'baseline' | 'k';
export const AXES: Axis[] = ['order', 'window', 'detrender', 'baseline', 'k'];

export function axisLevels(axis: Axis): string[] {
  switch (axis) {
    case 'order':
      return ORDER_PARAMS;
    case 'window':
      return WINDOWS.map(String);
    case 'detrender':
      return DETRENDERS;
    case 'baseline':
      return BASELINES;
    case 'k':
      return KS.map(String);
  }
}

export function specAxis(spec: MultiverseSpec, axis: Axis): string {
  return String(spec[axis]);
}

export function quantile(xs: number[], q: number): number {
  if (xs.length === 0) return 0;
  const s = xs.slice().sort((a, b) => a - b);
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return s[lo];
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}

export interface AxisRow {
  level: string;
  n: number;
  median: number;
  q10: number;
  q90: number;
  shareNegative: number;
  /** fraction of |registered slope| removed by the median specification at this level */
  reduction: number;
  /** fraction of specs whose slope is within half of the registered magnitude */
  shareFlattened: number;
  verdict: 'supported' | 'partial' | 'not-supported';
}

/**
 * Pre-registered multiverse decision rule (CLAIMS.md E-EWS-11): a level of an
 * analysis axis explains the failure only if its median slope removes at least
 * half of the registered slope AND at least 90% of its specifications are
 * flattened to within half the registered magnitude.
 */
export const REDUCTION_BAR = 0.5;
export const CONSISTENCY_BAR = 0.9;

export function axisRows(
  outcomes: SpecOutcome[],
  axis: Axis,
  indicator: EwsIndicator,
  metric: 'auc' | 'leadParam',
  registeredSlope: number,
): AxisRow[] {
  const out: AxisRow[] = [];
  const mag = Math.abs(registeredSlope);
  for (const level of axisLevels(axis)) {
    const rows = outcomes.filter((o) => specAxis(o.spec, axis) === level);
    if (rows.length === 0) continue;
    const slopes = rows.map((o) => (metric === 'auc' ? o.aucSlope[indicator].slope : o.leadParamSlope[indicator].slope));
    const med = quantile(slopes, 0.5);
    const reduction = mag === 0 ? 0 : 1 - Math.abs(med) / mag;
    const shareFlattened = mag === 0 ? 1 : slopes.filter((s) => Math.abs(s) < REDUCTION_BAR * mag).length / slopes.length;
    const verdict: AxisRow['verdict'] =
      reduction >= REDUCTION_BAR && shareFlattened >= CONSISTENCY_BAR
        ? 'supported'
        : reduction >= REDUCTION_BAR
          ? 'partial'
          : 'not-supported';
    out.push({
      level,
      n: rows.length,
      median: med,
      q10: quantile(slopes, 0.1),
      q90: quantile(slopes, 0.9),
      shareNegative: slopes.filter((s) => s < 0).length / slopes.length,
      reduction,
      shareFlattened,
      verdict,
    });
  }
  return out;
}

export interface HeadlineRow {
  indicator: EwsIndicator;
  median: number;
  q05: number;
  q95: number;
  shareNegative: number;
  registered: number;
  n: number;
}

export function headlines(
  outcomes: SpecOutcome[],
  metric: 'auc' | 'leadParam',
  registered: Record<EwsIndicator, number>,
): HeadlineRow[] {
  return EWS_INDICATORS.map((ind) => {
    const slopes = outcomes.map((o) => (metric === 'auc' ? o.aucSlope[ind].slope : o.leadParamSlope[ind].slope));
    return {
      indicator: ind,
      median: quantile(slopes, 0.5),
      q05: quantile(slopes, 0.05),
      q95: quantile(slopes, 0.95),
      shareNegative: slopes.filter((s) => s < 0).length / slopes.length,
      registered: registered[ind],
      n: slopes.length,
    };
  });
}

/* ------------------------------------------------------------- bootstrap -- */

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface SlopeBootstrap {
  median: number;
  lo: number;
  hi: number;
  reps: number;
  shareNegative: number;
}

/**
 * Hierarchical-by-seed bootstrap: a seed is the independent unit, so seeds are
 * resampled with replacement and their runs across all ramp durations move
 * together. Resampling windows (the common but wrong choice) would shrink the
 * interval by pretending windows inside a run are independent.
 */
export function bootstrapSlope(
  ramps: number[],
  valuesByRamp: Record<number, (number | null)[]>,
  reps = 1000,
  seed = 20261029,
): SlopeBootstrap {
  const rand = mulberry32(seed);
  const nSeeds = Math.max(0, ...ramps.map((r) => (valuesByRamp[r] ?? []).length));
  if (nSeeds === 0 || ramps.length < 2) return { median: 0, lo: 0, hi: 0, reps, shareNegative: 0 };
  const slopes: number[] = [];
  for (let b = 0; b < reps; b++) {
    const draw: number[] = [];
    for (let i = 0; i < nSeeds; i++) draw.push(Math.floor(rand() * nSeeds));
    const means: number[] = [];
    for (const ramp of ramps) {
      const col = valuesByRamp[ramp] ?? [];
      const vals: number[] = [];
      for (const i of draw) {
        const v = col[i];
        if (v !== null && v !== undefined && Number.isFinite(v)) vals.push(v);
      }
      means.push(vals.length ? mean(vals) : Number.NaN);
    }
    if (means.some((m) => !Number.isFinite(m))) continue;
    slopes.push(ols(ramps, means).slope);
  }
  if (slopes.length === 0) return { median: 0, lo: 0, hi: 0, reps: 0, shareNegative: 0 };
  return {
    median: quantile(slopes, 0.5),
    lo: quantile(slopes, 0.025),
    hi: quantile(slopes, 0.975),
    reps: slopes.length,
    shareNegative: slopes.filter((s) => s < 0).length / slopes.length,
  };
}

/* ----------------------------------------------------------------- report -- */

export interface MultiverseReport {
  seeds: string[];
  ramps: number[];
  specs: number;
  runs: number;
  collapsed: number;
  outcomes: SpecOutcome[];
  registered: SpecOutcome | null;
  aucHeadline: HeadlineRow[];
  leadHeadline: HeadlineRow[];
  aucAxes: Record<Axis, AxisRow[]>;
  leadAxes: Record<Axis, AxisRow[]>;
  bootstrap: { auc: SlopeBootstrap; leadParam: SlopeBootstrap } | null;
  target: EwsIndicator;
}

export function buildReport(runs: RunSeries[], opts: AnalyzeOptions & { target?: EwsIndicator }): MultiverseReport {
  const specs = multiverseSpecs();
  const points = buildPoints(runs, requiredPointSets(specs));
  const outcomes = specs.map((s) => analyzeSpec(runs, points, s, opts));
  const target = opts.target ?? 'variance';
  const registered = outcomes.find((o) => o.id === specId(REGISTERED_SPEC)) ?? null;

  const registeredAuc = {} as Record<EwsIndicator, number>;
  const registeredLead = {} as Record<EwsIndicator, number>;
  for (const ind of EWS_INDICATORS) {
    registeredAuc[ind] = registered?.aucSlope[ind].slope ?? 0;
    registeredLead[ind] = registered?.leadParamSlope[ind].slope ?? 0;
  }

  const aucAxes = {} as Record<Axis, AxisRow[]>;
  const leadAxes = {} as Record<Axis, AxisRow[]>;
  for (const axis of AXES) {
    aucAxes[axis] = axisRows(outcomes, axis, target, 'auc', registeredAuc[target]);
    leadAxes[axis] = axisRows(outcomes, axis, target, 'leadParam', registeredLead[target]);
  }

  return {
    seeds: opts.seeds,
    ramps: opts.ramps,
    specs: outcomes.length,
    runs: runs.length,
    collapsed: runs.filter((r) => r.collapse).length,
    outcomes,
    registered,
    aucHeadline: headlines(outcomes, 'auc', registeredAuc),
    leadHeadline: headlines(outcomes, 'leadParam', registeredLead),
    aucAxes,
    leadAxes,
    bootstrap: registered
      ? {
          auc: bootstrapSlope(opts.ramps, registered.aucBySeed[target], opts.reps ?? 1000),
          leadParam: bootstrapSlope(opts.ramps, registered.leadBySeed[target], opts.reps ?? 1000),
        }
      : null,
    target,
  };
}
