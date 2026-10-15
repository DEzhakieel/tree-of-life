/**
 * Causal analysis over an event log + aligned stats series.
 *
 * Two methods, kept deliberately separate in the report:
 *
 *  - **Observational, always on.** For every event type that fires often
 *    enough but not everywhere, measure each metric's windowed mean before
 *    and after every occurrence (paired effect size, Cohen's d_z + paired
 *    t), and correlate the event's impulse train with the metric at lags
 *    −L..+L after linearly detrending both (so shared trends do not read as
 *    correlation). Descriptive only: windows from nearby occurrences
 *    overlap, occurrences are not randomized, and no multiple-comparison
 *    correction is applied — the report says so.
 *
 *  - **Interventional, behind --interventional.** Same-seed paired worlds:
 *    treatment applies the planted interventions, baseline runs the same
 *    seed without them. The arms are verified bit-identical up to the first
 *    plant (deterministic replay), which is what makes the post-plant delta
 *    attributable to the intervention within this world configuration.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { EventType, SimEvent } from '@fractal-life/shared';
import { mean, pairedT, sd } from './statistics.js';
import {
  ANALYSIS_METRICS,
  census,
  occurrenceTicks,
  type EventCapture,
  type MetricKey,
  type PlantRecord,
  type SeriesPoint,
  type TypeCensus,
} from './eventLog.js';

// ---------------------------------------------------------------------------
// Observational: pre/post windows + lag correlation
// ---------------------------------------------------------------------------

export interface ObsOptions {
  /** pre/post window length in ticks on each side of the occurrence */
  window: number;
  /** max lag (± ticks) searched by the impulse/metric correlation */
  lag: number;
  /** minimum unique occurrence ticks required to analyze a type */
  minOccurrences: number;
  /** max share of ticks a type may fire on before windows stop being
   *  meaningful (the event would sit inside its own pre-window) */
  maxDensity: number;
  metrics: readonly string[];
}

export const DEFAULT_OBS: ObsOptions = {
  window: 10,
  lag: 10,
  minOccurrences: 5,
  maxDensity: 0.3,
  metrics: ANALYSIS_METRICS,
};

export interface AttributionRow {
  type: EventType;
  metric: string;
  /** occurrence ticks with a complete window on both sides */
  n: number;
  preMean: number;
  postMean: number;
  meanDelta: number;
  cohensDz: number;
  p: number;
  /** peak |r| of detrended impulse vs metric over lags ±lag */
  peakR: number;
  /** lag at which peakR occurred; event leads metric at positive lags */
  peakLag: number;
  significant: boolean;
}

export interface SkippedType {
  type: EventType;
  reason: string;
}

export interface ObservationalReport {
  window: number;
  lag: number;
  totalTicks: number;
  rows: AttributionRow[];
  skipped: SkippedType[];
}

export function analyzeObservational(
  events: readonly SimEvent[],
  series: readonly SeriesPoint[],
  opts: Partial<ObsOptions> = {},
): ObservationalReport {
  const o: ObsOptions = { ...DEFAULT_OBS, ...opts };
  const T = series.length > 0 ? series.length : maxTickOf(events) + 1;
  const censuses = census(events, T);
  const rows: AttributionRow[] = [];
  const skipped: SkippedType[] = [];
  for (const c of censuses) {
    if (c.ticks < o.minOccurrences) {
      skipped.push({ type: c.type, reason: `only ${c.ticks} occurrence tick(s), below the minimum of ${o.minOccurrences}` });
      continue;
    }
    const density = T > 0 ? c.ticks / T : 1;
    if (density > o.maxDensity) {
      skipped.push({
        type: c.type,
        reason: `fires on ${(density * 100).toFixed(0)}% of ticks; pre/post windows would contain the event itself`,
      });
      continue;
    }
    if (series.length === 0) continue;
    const occ = occurrenceTicks(events, c.type);
    const impulse = new Float64Array(T);
    for (const t of occ) if (t >= 0 && t < T) impulse[t] = 1;
    for (const metric of o.metrics) {
      const values = series.map((p) => p.values[metric] ?? 0);
      const pre: number[] = [];
      const post: number[] = [];
      for (const t of occ) {
        if (t - o.window < 0 || t + o.window - 1 >= T) continue;
        pre.push(mean(values.slice(t - o.window, t)));
        post.push(mean(values.slice(t, t + o.window)));
      }
      if (pre.length < o.minOccurrences) continue;
      // pairedT(a, b) reports a − b; post − pre is the "the metric moved
      // after the event" direction the report shows.
      const pt = pairedT(post, pre);
      const { peakR, peakLag } = lagCorrelation(impulse, values, o.lag);
      rows.push({
        type: c.type,
        metric,
        n: pre.length,
        preMean: mean(pre),
        postMean: mean(post),
        meanDelta: pt.meanDiff,
        cohensDz: pt.cohensDz,
        p: pt.p,
        peakR,
        peakLag,
        significant: pt.p < 0.05,
      });
    }
  }
  rows.sort((a, b) => Math.abs(b.cohensDz) - Math.abs(a.cohensDz) || a.type.localeCompare(b.type));
  return { window: o.window, lag: o.lag, totalTicks: T, rows, skipped };
}

function maxTickOf(events: readonly SimEvent[]): number {
  let m = -1;
  for (const e of events) if (e.tick > m) m = e.tick;
  return m;
}

/** least-squares line removed from a series (shared trends must not read as
 *  correlation between the impulse train and the metric). */
export function linDetrend(xs: Float64Array | readonly number[]): number[] {
  const src = Array.from(xs);
  const n = src.length;
  if (n < 2) return src;
  const mx = (n - 1) / 2;
  const my = mean(src);
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    const dx = i - mx;
    num += dx * (src[i]! - my);
    den += dx * dx;
  }
  const b = den === 0 ? 0 : num / den;
  return src.map((y, i) => y - (my + b * (i - mx)));
}

function pearson(a: number[], b: number[]): number {
  const ma = mean(a);
  const mb = mean(b);
  let sa = 0;
  let sb = 0;
  let sab = 0;
  for (let i = 0; i < a.length; i++) {
    const da = a[i]! - ma;
    const db = b[i]! - mb;
    sa += da * da;
    sb += db * db;
    sab += da * db;
  }
  if (sa <= 0 || sb <= 0) return 0;
  return sab / Math.sqrt(sa * sb);
}

export interface LagCorrelation {
  peakR: number;
  peakLag: number;
  /** r(k) for k = −maxLag … +maxLag, in order */
  atLag: number[];
}

/** r(k) = corr(I(t), M(t+k)) over the valid overlap, both series detrended.
 *  Ties keep the neutral lag 0 rather than an arbitrary search edge. */
export function lagCorrelation(
  impulse: Float64Array | readonly number[],
  metric: readonly number[],
  maxLag: number,
): LagCorrelation {
  const di = linDetrend(impulse);
  const dm = linDetrend(metric);
  const atLag: number[] = [];
  let peakR = 0;
  let peakLag = 0;
  for (let k = -maxLag; k <= maxLag; k++) {
    const a: number[] = [];
    const b: number[] = [];
    for (let t = 0; t < dm.length; t++) {
      const j = t + k;
      if (j < 0 || j >= dm.length) continue;
      a.push(di[t]!);
      b.push(dm[j]!);
    }
    const r = a.length >= 3 ? pearson(a, b) : 0;
    atLag.push(r);
    if (Math.abs(r) > Math.abs(peakR) + 1e-9) {
      peakR = r;
      peakLag = k;
    }
  }
  return { peakR, peakLag, atLag };
}

// ---------------------------------------------------------------------------
// Interventional: same-seed paired runs
// ---------------------------------------------------------------------------

export interface InterventionalRow {
  itype: string;
  metric: string;
  plants: number;
  nSeeds: number;
  baseMean: number;
  treatMean: number;
  meanDelta: number;
  sdDelta: number;
  p: number;
  cohensDz: number;
  signConsistent: boolean;
}

export interface InterventionalReport {
  seeds: string[];
  window: number;
  /** first tick at which the arms may differ; everything before it was
   *  verified identical, which is the replay-validity claim */
  equivalentUpToTick: number;
  rows: InterventionalRow[];
  plants: { tick: number; itype: string }[];
}

/**
 * Pair treatment captures (plants applied) against baselines (same seeds, no
 * plants). Throws when the arms diverge before the first plant — without
 * identical pre-intervention histories the delta is not attributable.
 */
export function pairInterventional(
  treatments: readonly EventCapture[],
  baselines: readonly EventCapture[],
  opts: { window: number; metrics?: readonly string[] },
): InterventionalReport {
  if (treatments.length !== baselines.length) throw new Error('pairInterventional: arm size mismatch');
  const metrics = opts.metrics ?? ANALYSIS_METRICS;
  const W = opts.window;
  if (treatments.length === 0) throw new Error('pairInterventional: no captures');

  let equivalentUpToTick = -1;
  for (let i = 0; i < treatments.length; i++) {
    const t = treatments[i]!;
    const b = baselines[i]!;
    const firstPlant = t.plants.length > 0 ? t.plants[0]!.tick : t.ticks;
    for (let k = 0; k < t.series.length && k < firstPlant; k++) {
      const ts = t.series[k]!;
      const bs = b.series[k];
      if (!bs || bs.tick !== ts.tick) throw new Error(`pairInterventional: arms diverge at tick ${ts.tick} (seed ${t.seed})`);
      for (const m of metrics) {
        if ((ts.values[m] ?? 0) !== (bs.values[m] ?? 0)) {
          throw new Error(`pairInterventional: arms diverge at tick ${ts.tick} metric ${m} (seed ${t.seed})`);
        }
      }
    }
    if (i === 0) equivalentUpToTick = firstPlant;
  }

  const plants = treatments[0]!.plants.map((p) => ({ tick: p.tick, itype: p.intervention.type }));
  const rows: InterventionalRow[] = [];
  const itypes = [...new Set(plants.map((p) => p.itype))];
  for (const itype of itypes) {
    const dueBySeed = treatments.map((t) =>
      t.plants.filter((p) => p.intervention.type === itype && p.tick + W <= t.series.length),
    );
    const plantCount = dueBySeed[0]?.length ?? 0;
    if (dueBySeed.every((d) => d.length === 0)) continue;
    for (const metric of metrics) {
      const baseM: number[] = [];
      const treatM: number[] = [];
      for (let i = 0; i < treatments.length; i++) {
        const due = dueBySeed[i]!;
        if (due.length === 0) continue;
        let bv = 0;
        let tv = 0;
        for (const p of due) {
          bv += rangeMean(baselines[i]!.series, p.tick, W, metric);
          tv += rangeMean(treatments[i]!.series, p.tick, W, metric);
        }
        baseM.push(bv / due.length);
        treatM.push(tv / due.length);
      }
      if (baseM.length === 0) continue;
      const deltas = treatM.map((v, i) => v - baseM[i]!);
      const pt = baseM.length >= 2 ? pairedT(treatM, baseM) : null;
      const pos = deltas.filter((d) => d > 0).length;
      const neg = deltas.filter((d) => d < 0).length;
      rows.push({
        itype,
        metric,
        plants: plantCount,
        nSeeds: baseM.length,
        baseMean: mean(baseM),
        treatMean: mean(treatM),
        meanDelta: pt ? pt.meanDiff : deltas[0]!,
        sdDelta: sd(deltas),
        p: pt ? pt.p : NaN,
        cohensDz: pt ? pt.cohensDz : deltas[0] === 0 ? 0 : Math.sign(deltas[0]!) * Infinity,
        signConsistent: (pos === 0 || neg === 0) && pos + neg === deltas.length,
      });
    }
  }
  rows.sort((a, b) => Math.abs(b.cohensDz) - Math.abs(a.cohensDz) || a.itype.localeCompare(b.itype));
  return {
    seeds: treatments.map((t) => t.seed),
    window: W,
    equivalentUpToTick,
    rows,
    plants,
  };
}

function rangeMean(series: readonly SeriesPoint[], start: number, len: number, metric: string): number {
  const vals: number[] = [];
  for (let i = start; i < start + len && i < series.length; i++) vals.push(series[i]!.values[metric] ?? 0);
  return vals.length > 0 ? mean(vals) : 0;
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

export interface EventReportInput {
  source: {
    mode: 'in-process' | 'file';
    file?: string;
    seeds: string[];
    ticks: number;
    spawn: number;
    invalidLines: number;
    totalEvents: number;
  };
  window: number;
  lag: number;
  censuses: TypeCensus[];
  observational: ObservationalReport | null;
  interventional: InterventionalReport | null;
  plants: PlantRecord[];
}

const f = (x: number, digits = 4): string => {
  if (Number.isNaN(x)) return 'n/a';
  if (!Number.isFinite(x)) return x > 0 ? '+inf' : '-inf';
  if (x !== 0 && Math.abs(x) < 10 ** -digits) return x.toExponential(1);
  return x.toFixed(digits);
};

const fmtP = (p: number): string => {
  if (Number.isNaN(p)) return 'n/a';
  if (p < 0.001) return '<0.001';
  return p.toFixed(3);
};

const fmtR = (r: number): string => r.toFixed(3);

export function renderEventReport(input: EventReportInput): { md: string; json: string; csv: string } {
  const md: string[] = [];
  md.push('# Event causality report');
  md.push('');
  if (input.source.mode === 'file') {
    md.push(`Source: event file \`${input.source.file}\` — ${input.source.totalEvents} events` +
      (input.source.invalidLines > 0 ? `, ${input.source.invalidLines} invalid line(s) dropped` : '') + '.');
    md.push('An external log carries events only, so this report is census-level: the pre/post and');
    md.push('interventional sections need a stats series from a run we control.');
  } else {
    md.push(`Source: in-process run, seeds ${input.source.seeds.join(', ')}, ${input.source.ticks} ticks, spawn ${input.source.spawn}.`);
    md.push(`${input.source.totalEvents} events; windows are ${input.window} ticks either side of each occurrence;`);
    md.push(`lag correlation searched ±${input.lag} ticks.`);
  }
  md.push('');

  // census
  md.push('## Event census');
  md.push('');
  md.push('Occurrence ticks collapse same-tick events (per-agent types like birth/death emit many');
  md.push('events on one tick) — that collapsed count is the windowed sample size below.');
  md.push('');
  md.push('| type | events | occurrence ticks | per 100 ticks | mean significance | median gap |');
  md.push('| --- | --- | --- | --- | --- | --- |');
  for (const c of input.censuses) {
    md.push(`| \`${c.type}\` | ${c.count} | ${c.ticks} | ${c.ratePer100.toFixed(1)} | ${f(c.meanSignificance, 2)} | ${c.medianGap ?? 'n/a'} |`);
  }
  md.push('');

  // observational
  const obs = input.observational;
  if (obs) {
    md.push('## Observational pre/post attribution');
    md.push('');
    md.push('For each occurrence the metric\'s windowed mean before (`pre`) and after (`post`) is');
    md.push('paired, so every occurrence is its own control; `d_z` is the paired Cohen\'s effect and');
    md.push('`p` a paired t-test over occurrences. `peak r @ lag` correlates the event\'s impulse train');
    md.push('with the metric (both linearly detrended) across ±' + obs.lag + ' ticks — the event leads the');
    md.push('metric at positive lags. Rows are sorted by |d_z|.');
    md.push('');
    if (obs.rows.length === 0) {
      md.push('No event type met the occurrence minimum with usable windows — nothing to attribute.');
      md.push('');
    } else {
      md.push('| event | metric | n | pre | post | delta | d_z | p | peak r @ lag |');
      md.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- |');
      for (const r of obs.rows.slice(0, 30)) {
        const sig = r.significant ? '**' : '';
        md.push(
          `| \`${r.type}\` | \`${r.metric}\` | ${r.n} | ${f(r.preMean, 3)} | ${f(r.postMean, 3)} | ` +
            `${sig}${f(r.meanDelta, 3)}${sig} | ${f(r.cohensDz, 2)} | ${fmtP(r.p)} | ${fmtR(r.peakR)} @ ${r.peakLag} |`,
        );
      }
      if (obs.rows.length > 30) md.push(`Showing 30 of ${obs.rows.length} rows — every pair is in \`events.csv\`.`);
      md.push('');
    }
    if (obs.skipped.length > 0) {
      md.push('Not analyzed (kept in the census):');
      for (const s of obs.skipped) md.push(`- \`${s.type}\` — ${s.reason}`);
      md.push('');
    }
  }

  // interventional
  const inter = input.interventional;
  if (inter) {
    md.push('## Interventional: same-seed paired runs');
    md.push('');
    md.push(`Treatment arms applied ${inter.plants.length} planted intervention(s); baseline arms ran the`);
    md.push('same seeds without them. Both arms were verified **bit-identical up to tick ' +
      `${inter.equivalentUpToTick}` + '** — deterministic replay — so every delta below is measured');
    md.push('after an identical history and is attributable to the intervention in this configuration.');
    md.push('Each cell pairs the windowed means over the same ' + `${inter.window}` + '-tick window after each plant.');
    md.push('');
    if (inter.rows.length === 0) {
      md.push('No intervention produced a measurable window on any seed.');
      md.push('');
    } else {
      md.push('| intervention | metric | plants | seeds | baseline | treated | delta | d_z | p | sign-consistent |');
      md.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
      for (const r of inter.rows.slice(0, 30)) {
        const sig = !Number.isNaN(r.p) && r.p < 0.05 ? '**' : '';
        md.push(
          `| \`${r.itype}\` | \`${r.metric}\` | ${r.plants} | ${r.nSeeds} | ${f(r.baseMean, 3)} | ${f(r.treatMean, 3)} | ` +
            `${sig}${f(r.meanDelta, 3)}${sig} | ${f(r.cohensDz, 2)} | ${fmtP(r.p)} | ${r.signConsistent ? 'yes' : 'reverses'} |`,
        );
      }
      if (inter.rows.length > 30) md.push(`Showing 30 of ${inter.rows.length} rows — every pair is in \`events.csv\`.`);
      md.push('');
    }
  }

  // limits
  md.push('## What this does and does not establish');
  md.push('');
  if (obs) {
    md.push('- **Observational rows are associations inside one world.** Occurrences are not');
    md.push('  randomized; events are endpoints of the same dynamics that move the metrics. Nearby');
    md.push('  occurrences share window ticks, the metric is autocorrelated (which inflates r), and');
    md.push('  no multiple-comparison correction is applied across the metric grid. Read a large d_z');
    md.push('  with a consistent lag as a *candidate* mechanism, not a proven one.');
  }
  if (inter) {
    md.push('- **Interventional deltas are causal within this configuration only.** Same-seed pairing');
    md.push('  plus verified pre-plant identity removes seed and history confounds, but the claim');
    md.push('  covers exactly the planted schedule at the planted locations, at this spawn and tick');
    md.push('  budget — a derivative at one point, not a general law.');
    md.push(`- **n = ${inter.seeds.length} seeds.** Enough to expose a sign reversal, not enough to`);
    md.push('  estimate a distribution; the sign-consistency column exists precisely because n is small.');
  }
  if (input.source.mode === 'file') {
    md.push('- **External logs cannot be replayed:** their world configuration is unknown, so no');
    md.push('  interventional arm exists for this report.');
  }
  md.push('');
  if (input.source.mode === 'in-process' && input.plants.length === 0) {
    md.push('No interventions were planted (`--no-plants`), so the interventional section was skipped.');
    md.push('');
  }

  const json = JSON.stringify(
    {
      source: input.source,
      window: input.window,
      lag: input.lag,
      censuses: input.censuses,
      observational: obs,
      interventional: inter,
      plants: input.plants.map((p) => ({ tick: p.tick, type: p.intervention.type })),
    },
    null,
    2,
  );

  const csvRows: string[] = [
    'scope,type,metric,n,mean_pre_base,mean_post_treated,mean_delta,cohens_dz,p,peak_r,peak_lag,sign_consistent',
  ];
  if (obs) {
    for (const r of obs.rows) {
      csvRows.push(
        ['obs', r.type, r.metric, r.n, f(r.preMean, 8), f(r.postMean, 8), f(r.meanDelta, 8), f(r.cohensDz, 8), f(r.p, 8), f(r.peakR, 8), r.peakLag, ''].join(','),
      );
    }
  }
  if (inter) {
    for (const r of inter.rows) {
      csvRows.push(
        ['inter', r.itype, r.metric, r.nSeeds, f(r.baseMean, 8), f(r.treatMean, 8), f(r.meanDelta, 8), f(r.cohensDz, 8), f(r.p, 8), '', '', r.signConsistent ? 'yes' : 'no'].join(','),
      );
    }
  }

  return { md: md.join('\n'), json, csv: csvRows.join('\n') };
}

export function renderEventSvg(input: EventReportInput): string {
  const w = 960;
  const sections: string[] = [];
  type BarRow = { label: string; value: number; text: string };
  const sectionsSpec: { title: string; rows: BarRow[]; bipolar: boolean }[] = [];

  const obs = input.observational;
  if (obs && obs.rows.length > 0) {
    sectionsSpec.push({
      title: 'observational attribution: paired Cohen d_z (pre -> post)',
      bipolar: true,
      rows: obs.rows.slice(0, 12).map((r) => ({
        label: `${r.type} -> ${r.metric}`,
        value: Math.max(-2.5, Math.min(2.5, r.cohensDz)),
        text: `${f(r.cohensDz, 2)}${r.significant ? '*' : ''}`,
      })),
    });
  }
  const inter = input.interventional;
  if (inter && inter.rows.length > 0) {
    sectionsSpec.push({
      title: 'interventional: paired same-seed delta (treated - baseline)',
      bipolar: true,
      rows: inter.rows.slice(0, 10).map((r) => ({
        label: `${r.itype} -> ${r.metric}`,
        value: Math.max(-2.5, Math.min(2.5, r.cohensDz)),
        text: `${f(r.cohensDz, 2)}${!Number.isNaN(r.p) && r.p < 0.05 ? '*' : ''}`,
      })),
    });
  }
  sectionsSpec.push({
    title: 'event census: occurrence ticks per type',
    bipolar: false,
    rows: input.censuses.slice(0, 12).map((c) => ({
      label: c.type,
      value: c.ticks,
      text: `${c.ticks} (${c.count} events)`,
    })),
  });

  const rowH = 24;
  let y = 70;
  for (const spec of sectionsSpec) {
    const top = y;
    sections.push(
      `<text x="24" y="${y}" fill="#e6edf3" font-family="monospace" font-size="13" font-weight="600">${esc(spec.title)}</text>`,
    );
    y += 22;
    const maxAbs = spec.bipolar ? Math.max(1e-9, ...spec.rows.map((r) => Math.abs(r.value))) : Math.max(1e-9, ...spec.rows.map((r) => r.value));
    for (const r of spec.rows) {
      const labelX = 24;
      const barStart = spec.bipolar ? 560 : 420;
      const span = spec.bipolar ? 200 : 340;
      const len = (Math.abs(r.value) / maxAbs) * span;
      const neg = r.value < 0;
      const x = spec.bipolar && neg ? barStart - len : barStart;
      sections.push(
        `<text x="${labelX}" y="${y + 4}" fill="#8b949e" font-family="monospace" font-size="11">${esc(r.label)}</text>`,
      );
      if (spec.bipolar) {
        sections.push(`<line x1="${barStart}" y1="${y - 8}" x2="${barStart}" y2="${y + 8}" stroke="#30363d"/>`);
      }
      sections.push(
        `<rect x="${x}" y="${y - 7}" width="${Math.max(1, len).toFixed(1)}" height="13" fill="${neg ? '#f85149' : '#3fb950'}" opacity="0.9" rx="2"/>`,
      );
      sections.push(
        `<text x="${w - 24}" y="${y + 4}" text-anchor="end" fill="#e6edf3" font-family="monospace" font-size="11">${esc(r.text)}</text>`,
      );
      y += rowH;
    }
    y += 28;
  }
  const h = Math.round(y);
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`,
    `<rect width="${w}" height="${h}" fill="#0e1116"/>`,
    `<text x="24" y="34" fill="#e6edf3" font-family="monospace" font-size="15">event causality: ${input.source.mode === 'file' ? esc(input.source.file ?? 'file') : esc(input.source.seeds.join(', '))}</text>`,
    `<text x="24" y="54" fill="#8b949e" font-family="monospace" font-size="11">${input.source.totalEvents} events, window ${input.window} ticks, lag ±${input.lag} (* p&lt;0.05; d_z clamped to ±2.5 for drawing)</text>`,
    ...sections,
    '</svg>',
  ].join('\n');
}

function esc(s: string): string {
  // text nodes only need & and < escaped; escaping '>' would mangle "a -> b" labels
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
}

export function writeEventReport(input: EventReportInput): string {
  const dir = join(fileURLToPath(new URL('.', import.meta.url)), '../../research/output');
  mkdirSync(dir, { recursive: true });
  mkdirSync(join(dir, 'plots'), { recursive: true });
  const { md, json, csv } = renderEventReport(input);
  writeFileSync(join(dir, 'events.md'), md);
  writeFileSync(join(dir, 'events.json'), json);
  writeFileSync(join(dir, 'events.csv'), csv);
  writeFileSync(join(dir, 'plots', 'events.svg'), renderEventSvg(input));
  return dir;
}

// re-exported for callers that only import this module
export { ANALYSIS_METRICS, type MetricKey };
