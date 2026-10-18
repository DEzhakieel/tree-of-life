export type EwsIndicator = 'variance' | 'ar1' | 'recovery' | 'cv' | 'skewness' | 'flicker';

export const EWS_INDICATORS: EwsIndicator[] = ['variance', 'ar1', 'recovery', 'cv', 'skewness', 'flicker'];

export interface EwsConfig {
  window: number;
  step: number;
  detrend: number;
}

export interface EwsPoint {
  tick: number;
  center: number;
  mean: number;
  variance: number;
  ar1: number;
  recovery: number;
  cv: number;
  skewness: number;
  flicker: number;
}

export interface EwsWindowStats {
  mean: number;
  variance: number;
  ar1: number;
  recovery: number;
  cv: number;
  skewness: number;
  flicker: number;
}

export interface CollapseEvent {
  tick: number;
  plateau: number;
  threshold: number;
  tol: number;
  minAfter: number;
}

export interface CollapseQuery {
  burnIn: number;
  plateauFrom: number;
  plateauTo: number;
  fraction: number;
  hold?: number;
}

export interface LeadQuery {
  baselineFrom: number;
  baselineTo: number;
  horizon: number;
  k?: number;
  sustain?: number;
}

export interface LeadTime {
  tick: number;
  center: number;
  leadTicks: number;
  leadParam: number;
  value: number;
  baselineMean: number;
  baselineSd: number;
}

export function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  let s = 0;
  for (let i = 0; i < xs.length; i++) s += xs[i];
  return s / xs.length;
}

export function variance(xs: number[], sample = false): number {
  const n = xs.length;
  if (n < 2) return 0;
  const m = mean(xs);
  let s = 0;
  for (let i = 0; i < n; i++) s += (xs[i] - m) ** 2;
  return s / (sample ? n - 1 : n);
}

export function sampleSd(xs: number[]): number {
  return Math.sqrt(variance(xs, true));
}

export function skewness(xs: number[]): number {
  const n = xs.length;
  if (n < 2) return 0;
  const m = mean(xs);
  const v = variance(xs);
  if (v <= 0) return 0;
  let s = 0;
  for (let i = 0; i < n; i++) s += (xs[i] - m) ** 3;
  return s / n / Math.pow(v, 1.5);
}

export function coefficientOfVariation(xs: number[]): number {
  const m = mean(xs);
  if (m === 0) return 0;
  return sampleSd(xs) / Math.abs(m);
}

export function movingAverage(xs: number[], w: number): number[] {
  const out = new Array<number>(xs.length);
  let s = 0;
  for (let i = 0; i < xs.length; i++) {
    s += xs[i];
    if (i >= w) s -= xs[i - w];
    out[i] = s / Math.min(i + 1, w);
  }
  return out;
}

export function detrendResiduals(xs: number[], w: number): number[] {
  const m = movingAverage(xs, w);
  const out = new Array<number>(xs.length);
  for (let i = 0; i < xs.length; i++) out[i] = xs[i] - m[i];
  return out;
}

export function lag1Autocorrelation(xs: number[]): number {
  const n = xs.length;
  if (n < 3) return 0;
  const m = mean(xs);
  let num = 0;
  let den = 0;
  for (let i = 1; i < n; i++) num += (xs[i] - m) * (xs[i - 1] - m);
  for (let i = 0; i < n; i++) den += (xs[i] - m) ** 2;
  if (den <= 0) return 0;
  return num / den;
}

export function recoveryRate(ar1: number): number {
  const a = Math.max(1e-6, Math.min(1 - 1e-6, ar1));
  return -Math.log(a);
}

export function flickering(xs: number[]): number {
  const n = xs.length;
  if (n < 2) return 0;
  const m = mean(xs);
  let crossings = 0;
  let prev = xs[0] - m;
  for (let i = 1; i < n; i++) {
    const cur = xs[i] - m;
    if (prev === 0) prev = cur;
    else if ((prev < 0 && cur >= 0) || (prev > 0 && cur <= 0)) {
      crossings++;
      prev = cur;
    }
  }
  return crossings / (n - 1);
}

export function kendallTau(xs: number[]): number {
  const n = xs.length;
  if (n < 2) return 0;
  let concordant = 0;
  let discordant = 0;
  let tiedY = 0;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const dy = xs[j] - xs[i];
      if (dy > 0) concordant++;
      else if (dy < 0) discordant++;
      else tiedY++;
    }
  }
  const n0 = (n * (n - 1)) / 2;
  const denom = Math.sqrt(n0 * (n0 - tiedY));
  if (denom <= 0) return 0;
  return (concordant - discordant) / denom;
}

export function rocAuc(labels: boolean[], scores: number[]): number {
  const pos: number[] = [];
  const neg: number[] = [];
  for (let i = 0; i < labels.length; i++) (labels[i] ? pos : neg).push(scores[i]);
  const np = pos.length;
  const nn = neg.length;
  if (np === 0 || nn === 0) return 0.5;
  const all = scores.map((s, i) => ({ s, l: labels[i] })).sort((a, b) => a.s - b.s);
  const ranks = new Array<number>(all.length);
  let i = 0;
  while (i < all.length) {
    let j = i;
    while (j + 1 < all.length && all[j + 1].s === all[i].s) j++;
    const rank = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) ranks[k] = rank;
    i = j + 1;
  }
  let rankSumPos = 0;
  for (let k = 0; k < all.length; k++) if (all[k].l) rankSumPos += ranks[k];
  return (rankSumPos - (np * (np + 1)) / 2) / (np * nn);
}

export function ewsWindow(series: number[], detrend: number): EwsWindowStats {
  const resid = detrendResiduals(series, detrend);
  const ar1 = lag1Autocorrelation(resid);
  return {
    mean: mean(series),
    variance: variance(resid),
    ar1,
    recovery: recoveryRate(ar1),
    cv: coefficientOfVariation(series),
    skewness: skewness(series),
    flicker: flickering(series),
  };
}

export function ewsSeries(series: number[], config: EwsConfig): EwsPoint[] {
  const { window, step, detrend } = config;
  const points: EwsPoint[] = [];
  if (series.length < window) return points;
  for (let start = 0; start + window <= series.length; start += step) {
    const slice = series.slice(start, start + window);
    const w = ewsWindow(slice, detrend);
    points.push({
      tick: start,
      center: start + window / 2,
      mean: w.mean,
      variance: w.variance,
      ar1: w.ar1,
      recovery: w.recovery,
      cv: w.cv,
      skewness: w.skewness,
      flicker: w.flicker,
    });
  }
  return points;
}

export function detectCollapse(series: number[], q: CollapseQuery): CollapseEvent | null {
  const hold = q.hold ?? 20;
  if (series.length <= q.plateauTo) return null;
  const plateau = mean(series.slice(q.plateauFrom, q.plateauTo));
  const threshold = q.fraction * plateau;
  const start = Math.max(q.burnIn, q.plateauTo);
  for (let i = start; i + hold <= series.length; i++) {
    let ok = true;
    for (let j = i; j < i + hold; j++) {
      if (series[j] >= threshold) {
        ok = false;
        break;
      }
    }
    if (ok) {
      let minAfter = Infinity;
      for (let j = i; j < series.length; j++) minAfter = Math.min(minAfter, series[j]);
      return { tick: i, plateau, threshold, tol: q.fraction, minAfter };
    }
  }
  return null;
}

export function indicatorValue(p: EwsPoint, ind: EwsIndicator): number {
  switch (ind) {
    case 'variance':
      return p.variance;
    case 'ar1':
      return p.ar1;
    case 'recovery':
      return p.recovery;
    case 'cv':
      return p.cv;
    case 'skewness':
      return p.skewness;
    case 'flicker':
      return p.flicker;
  }
}

export function indicatorDirection(ind: EwsIndicator): 1 | -1 {
  return ind === 'recovery' ? -1 : 1;
}

export function leadTime(
  points: EwsPoint[],
  ind: EwsIndicator,
  collapseTick: number,
  q: LeadQuery,
): LeadTime | null {
  const k = q.k ?? 2;
  const sustain = q.sustain ?? 0.7;
  const dir = indicatorDirection(ind);
  const base =
    q.baselineTo > q.baselineFrom
      ? points.filter((p) => p.center >= q.baselineFrom && p.center <= q.baselineTo).map((p) => indicatorValue(p, ind))
      : [];
  if (base.length < 4) return null;
  const bm = mean(base);
  const bsd = sampleSd(base);
  if (bsd <= 0) return null;
  const threshold = bm + dir * k * bsd;
  const pre = points.filter((p) => p.center < collapseTick);
  let warnIdx = -1;
  for (let i = 0; i < pre.length; i++) {
    const v = indicatorValue(pre[i], ind);
    const above = dir > 0 ? v >= threshold : v <= threshold;
    if (!above) continue;
    let hits = 0;
    for (let j = i; j < pre.length; j++) {
      const vv = indicatorValue(pre[j], ind);
      if (dir > 0 ? vv >= threshold : vv <= threshold) hits++;
    }
    if (hits / (pre.length - i) >= sustain) {
      warnIdx = i;
      break;
    }
  }
  if (warnIdx < 0) return null;
  const p = pre[warnIdx];
  if (collapseTick - p.center > q.horizon) return null;
  return {
    tick: p.tick,
    center: p.center,
    leadTicks: collapseTick - p.tick,
    leadParam: 0,
    value: indicatorValue(p, ind),
    baselineMean: bm,
    baselineSd: bsd,
  };
}

export function aucByDistance(
  points: EwsPoint[],
  ind: EwsIndicator,
  collapseTick: number,
  nearFrom: number,
  nearTo: number,
  earlyUntil: number,
): { auc: number; positive: number; negative: number } {
  const labels: boolean[] = [];
  const scores: number[] = [];
  const dir = indicatorDirection(ind);
  for (const p of points) {
    const dt = collapseTick - p.center;
    if (dt > nearFrom && dt <= nearTo) {
      labels.push(true);
      scores.push(dir * indicatorValue(p, ind));
    } else if (p.center <= earlyUntil) {
      labels.push(false);
      scores.push(dir * indicatorValue(p, ind));
    }
  }
  return { auc: rocAuc(labels, scores), positive: labels.filter(Boolean).length, negative: labels.filter((l) => !l).length };
}
