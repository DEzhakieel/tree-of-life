import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import {
  EWS_INDICATORS,
  aucByDistance,
  detectCollapse,
  ewsSeries,
  kendallTau,
  indicatorValue,
  leadTime,
  mean,
  sampleSd,
  type CollapseEvent,
  type EwsConfig,
  type EwsIndicator,
  type EwsPoint,
  type LeadTime,
} from '@fractal-life/shared';
import { Engine } from '../engine.js';
import { makeWorld } from './scenarios.js';

export const EW_SEEDS = ['ews.a', 'ews.b', 'ews.c', 'ews.d', 'ews.e', 'ews.f', 'ews.g', 'ews.h'];
export const EW_SPAWN = 300;
export const EW_MAX_POP = 500;
export const EW_FOOD = 0.0018;
export const EW_M0 = 1;
export const EW_MMAX = 40;
export const EW_BURN = 350;
export const EW_RAMPS = [300, 450, 600, 750, 900, 1050];
export const EW_TAIL = 300;
export const EW_EWS: EwsConfig = { window: 60, step: 15, detrend: 25 };
export const EW_COLLAPSE = {
  burnIn: EW_BURN + 40,
  plateauFrom: EW_BURN - 150,
  plateauTo: EW_BURN - 10,
  fraction: 0.25,
  hold: 20,
};

export function stressAt(tick: number, burn: number, ramp: number): number {
  if (tick < burn) return EW_M0;
  if (tick < burn + ramp) return EW_M0 + (EW_MMAX - EW_M0) * ((tick - burn) / ramp);
  return EW_MMAX;
}

export interface EwsRunSpec {
  seed: string;
  ramp: number;
  burn: number;
  ticks: number;
}

export interface EwsRun {
  spec: EwsRunSpec;
  pop: number[];
  stress: number[];
  points: EwsPoint[];
  collapse: CollapseEvent | null;
  collapseStress: number | null;
  leads: Record<EwsIndicator, LeadTime | null>;
  auc: Record<EwsIndicator, number>;
  tau: Record<EwsIndicator, number>;
}

export interface EwsRampSummary {
  ramp: number;
  n: number;
  collapseFrac: number;
  meanCollapseTick: number;
  meanCollapseStress: number;
  meanPlateau: number;
  leads: Record<EwsIndicator, { detectFrac: number; meanTicks: number; sdTicks: number; meanParam: number; sdParam: number }>;
  auc: Record<EwsIndicator, number>;
  aucSd: Record<EwsIndicator, number>;
  tau: Record<EwsIndicator, number>;
}

export interface EwsTrend {
  slope: number;
  intercept: number;
  r2: number;
}

export interface EwsPooled {
  n: number;
  collapsed: number;
  auc: Record<EwsIndicator, number>;
  leads: Record<EwsIndicator, { detectFrac: number; meanTicks: number; meanParam: number }>;
}

export interface EwsReport {
  seeds: string[];
  ramps: number[];
  spawn: number;
  maxPop: number;
  food: number;
  m0: number;
  mMax: number;
  burn: number;
  ews: EwsConfig;
  runs: EwsRun[];
  control: EwsControl[];
  summary: EwsRampSummary[];
  trends: Record<EwsIndicator, { param: EwsTrend; ticks: EwsTrend; auc: EwsTrend }>;
  pooled: EwsPooled;
}

export interface EwsControl {
  seed: string;
  finalPop: number;
  minPop: number;
}

export function runEwsControl(seeds: string[], ticks: number, onSeed?: (seed: string, index: number) => void): EwsControl[] {
  const out: EwsControl[] = [];
  for (let i = 0; i < seeds.length; i++) {
    const seed = seeds[i]!;
    const world = makeWorld(seed, EW_SPAWN, { maxPopulation: EW_MAX_POP, foodRegenRate: EW_FOOD, metabolismBase: EW_M0 });
    const engine = new Engine(world);
    let minPop = Infinity;
    for (let t = 0; t < ticks; t++) {
      engine.params.metabolismBase = EW_M0;
      engine.tick();
      minPop = Math.min(minPop, engine.aliveCount());
    }
    out.push({ seed, finalPop: engine.aliveCount(), minPop });
    onSeed?.(seed, i);
  }
  return out;
}

function runOne(spec: EwsRunSpec): EwsRun {
  const world = makeWorld(spec.seed, EW_SPAWN, {
    maxPopulation: EW_MAX_POP,
    foodRegenRate: EW_FOOD,
    metabolismBase: EW_M0,
  });
  const engine = new Engine(world);
  const pop: number[] = [];
  const stress: number[] = [];
  for (let tick = 0; tick < spec.ticks; tick++) {
    const m = stressAt(tick, spec.burn, spec.ramp);
    engine.params.metabolismBase = m;
    engine.tick();
    pop.push(engine.aliveCount());
    stress.push(m);
  }

  const points = ewsSeries(pop, EW_EWS);
  const collapse = detectCollapse(pop, EW_COLLAPSE);
  const collapseStress = collapse ? stress[collapse.tick] : null;

  const leads = {} as Record<EwsIndicator, LeadTime | null>;
  const auc = {} as Record<EwsIndicator, number>;
  const tau = {} as Record<EwsIndicator, number>;
  const baseFrom = spec.burn - 200;
  const baseTo = spec.burn - 40;
  const horizon = spec.ramp + 150;
  const earlyUntil = spec.burn - 60;

  for (const ind of EWS_INDICATORS) {
    if (!collapse) {
      leads[ind] = null;
      auc[ind] = 0.5;
      tau[ind] = 0;
      continue;
    }
    const lead = leadTime(points, ind, collapse.tick, { baselineFrom: baseFrom, baselineTo: baseTo, horizon, k: 1.5, sustain: 0.7 });
    if (lead && collapseStress !== null) {
      const mAtWarn = stress[Math.min(lead.tick, stress.length - 1)];
      lead.leadParam = collapseStress - mAtWarn;
    }
    leads[ind] = lead;
    auc[ind] = aucByDistance(points, ind, collapse.tick, 40, 250, earlyUntil).auc;
    const pre = points.filter((p) => p.center >= baseFrom && p.center <= collapse.tick);
    tau[ind] = kendallTau(pre.map((p) => indicatorValue(p, ind)));
  }

  return { spec, pop, stress, points, collapse, collapseStress, leads, auc, tau };
}

export interface EwsReportOptions {
  seeds: string[];
  ramps: number[];
  /** streamed as each seed x ramp finishes, then each no-ramp control */
  onProgress?: (p: { done: number; total: number; label: string }) => void;
}

export function runEwsReport(opts: EwsReportOptions): EwsReport {
  const runs: EwsRun[] = [];
  const total = opts.seeds.length * opts.ramps.length + opts.seeds.length;
  let done = 0;
  for (const seed of opts.seeds) {
    for (const ramp of opts.ramps) {
      runs.push(runOne({ seed, ramp, burn: EW_BURN, ticks: EW_BURN + ramp + EW_TAIL }));
      opts.onProgress?.({ done: ++done, total, label: `${seed} tau=${ramp}` });
    }
  }
  const summary: EwsRampSummary[] = opts.ramps.map((ramp) => {
    const rs = runs.filter((r) => r.spec.ramp === ramp);
    const withCollapse = rs.filter((r) => r.collapse !== null);
    const leads = {} as EwsRampSummary['leads'];
    const auc = {} as Record<EwsIndicator, number>;
    const aucSd = {} as Record<EwsIndicator, number>;
    const tau = {} as Record<EwsIndicator, number>;
    for (const ind of EWS_INDICATORS) {
      const lt = withCollapse.map((r) => r.leads[ind]).filter((l): l is LeadTime => l !== null);
      const ticksArr = lt.map((l) => l.leadTicks);
      const paramArr = lt.map((l) => l.leadParam);
      leads[ind] = {
        detectFrac: rs.length ? lt.length / rs.length : 0,
        meanTicks: mean(ticksArr),
        sdTicks: sampleSd(ticksArr),
        meanParam: mean(paramArr),
        sdParam: sampleSd(paramArr),
      };
      auc[ind] = mean(withCollapse.map((r) => r.auc[ind]));
      aucSd[ind] = sampleSd(withCollapse.map((r) => r.auc[ind]));
      tau[ind] = mean(withCollapse.map((r) => r.tau[ind]));
    }
    const collapseTicks = withCollapse.map((r) => r.collapse!.tick);
    const collapseStress = withCollapse.map((r) => r.collapseStress!).filter((v) => v !== null);
    return {
      ramp,
      n: rs.length,
      collapseFrac: rs.length ? withCollapse.length / rs.length : 0,
      meanCollapseTick: mean(collapseTicks),
      meanCollapseStress: mean(collapseStress),
      meanPlateau: mean(withCollapse.map((r) => r.collapse!.plateau)),
      leads,
      auc,
      aucSd,
      tau,
    };
  });
  const xs = summary.map((s) => s.ramp);
  const trends = {} as EwsReport['trends'];
  for (const ind of EWS_INDICATORS) {
    trends[ind] = {
      param: linfit(xs, summary.map((s) => s.leads[ind].meanParam)),
      ticks: linfit(xs, summary.map((s) => s.leads[ind].meanTicks)),
      auc: linfit(xs, summary.map((s) => s.auc[ind])),
    };
  }
  return {
    seeds: opts.seeds,
    ramps: opts.ramps,
    spawn: EW_SPAWN,
    maxPop: EW_MAX_POP,
    food: EW_FOOD,
    m0: EW_M0,
    mMax: EW_MMAX,
    burn: EW_BURN,
    ews: EW_EWS,
    runs,
    control: runEwsControl(opts.seeds, EW_BURN + Math.max(...opts.ramps) + EW_TAIL, (_seed, i) =>
      opts.onProgress?.({ done: ++done, total, label: `control ${opts.seeds[i] ?? ''}` }),
    ),
    summary,
    trends,
    pooled: poolRuns(runs),
  };
}

function linfit(xs: number[], ys: number[]): EwsTrend {
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
  return {
    slope,
    intercept: my - slope * mx,
    r2: syy === 0 ? 0 : (sxy * sxy) / (sxx * syy),
  };
}

function poolRuns(runs: EwsRun[]): EwsPooled {
  const withCollapse = runs.filter((r) => r.collapse !== null);
  const auc = {} as Record<EwsIndicator, number>;
  const leads = {} as EwsPooled['leads'];
  for (const ind of EWS_INDICATORS) {
    auc[ind] = mean(withCollapse.map((r) => r.auc[ind]));
    const lt = withCollapse.map((r) => r.leads[ind]).filter((l): l is LeadTime => l !== null);
    leads[ind] = {
      detectFrac: withCollapse.length ? lt.length / withCollapse.length : 0,
      meanTicks: mean(lt.map((l) => l.leadTicks)),
      meanParam: mean(lt.map((l) => l.leadParam)),
    };
  }
  return { n: runs.length, collapsed: withCollapse.length, auc, leads };
}

const IND_LABEL: Record<EwsIndicator, string> = {
  variance: 'variance',
  ar1: 'AR(1)',
  recovery: 'recovery rate',
  cv: 'CV',
  skewness: 'skewness',
  flicker: 'flicker',
};

export function renderEwsReport(report: EwsReport): { md: string; json: string; csv: string } {
  const md: string[] = [];
  md.push('# Early-warning signals for critical transitions');
  md.push('');
  md.push(
    `Engine: TS reference. Control parameter: metabolismBase ramped ${report.m0} -> ${report.mMax} after a ${report.burn}-tick burn-in. ` +
      `Order parameter: population (spawn ${report.spawn}, cap ${report.maxPop}, food ${report.food}).`,
  );
  md.push('');
  md.push(
    `EWS: rolling window ${report.ews.window} ticks (step ${report.ews.step}, detrend ${report.ews.detrend}). ` +
      `Ramp duration tau in ticks sets how slowly the bifurcation is approached.`,
  );
  md.push('');
  md.push('## Collapse');
  md.push('');
  md.push('| tau | runs | collapsed | mean collapse tick | mean stress at collapse | mean plateau |');
  md.push('| ---: | ---: | ---: | ---: | ---: | ---: |');
  for (const s of report.summary) {
    md.push(
      `| ${s.ramp} | ${s.n} | ${(s.collapseFrac * 100).toFixed(0)}% | ${s.meanCollapseTick.toFixed(0)} | ${s.meanCollapseStress.toFixed(2)} | ${s.meanPlateau.toFixed(0)} |`,
    );
  }
  md.push('');
  md.push('## No-ramp control');
  md.push('');
  const ctrlFinal = mean(report.control.map((c) => c.finalPop));
  const ctrlSurvived = report.control.filter((c) => c.finalPop > 0).length;
  md.push(
    `With metabolismBase held at ${report.m0} (no ramp) for the same tick budget, mean final population is ${ctrlFinal.toFixed(0)} ` +
      `and ${ctrlSurvived}/${report.control.length} worlds survive. The collapse is therefore caused by the ramp, not the environment.`,
  );
  md.push('');
  md.push('## Pooled headline (all ramps)');
  md.push('');
  md.push(`${report.pooled.collapsed}/${report.pooled.n} runs crossed the collapse threshold.`);
  md.push('');
  md.push('| indicator | AUC | detect | mean lead (ticks) | mean lead (stress) |');
  md.push('| :-- | ---: | ---: | ---: | ---: |');
  for (const ind of EWS_INDICATORS) {
    const l = report.pooled.leads[ind];
    md.push(
      `| ${IND_LABEL[ind]} | ${report.pooled.auc[ind].toFixed(3)} | ${(l.detectFrac * 100).toFixed(0)}% | ${l.meanTicks.toFixed(0)} | ${l.meanParam.toFixed(2)} |`,
    );
  }
  md.push('');
  md.push('## Indicator performance (per tau)');
  md.push('');
  md.push('| tau | indicator | detect | lead (ticks) | lead (stress) | AUC | trend tau |');
  md.push('| ---: | :-- | ---: | ---: | ---: | ---: | ---: |');
  for (const s of report.summary) {
    for (const ind of EWS_INDICATORS) {
      const l = s.leads[ind];
      md.push(
        `| ${s.ramp} | ${IND_LABEL[ind]} | ${(l.detectFrac * 100).toFixed(0)}% | ` +
          `${l.meanTicks.toFixed(0)} ± ${l.sdTicks.toFixed(0)} | ${l.meanParam.toFixed(2)} ± ${l.sdParam.toFixed(2)} | ` +
          `${s.auc[ind].toFixed(3)} ± ${s.aucSd[ind].toFixed(3)} | ${s.tau[ind].toFixed(2)} |`,
      );
    }
  }
  md.push('');
  md.push('## H3: does the warning track distance-to-bifurcation?');
  md.push('');
  md.push(
    `Linear fit of each metric against ramp duration tau across the grid ` +
      `(${report.ramps.join(', ')} ticks; ${report.seeds.length} replicates each). ` +
      `A fixed distance-to-bifurcation would give lead(stress) slope ~ 0 with lead(ticks) slope > 0.`,
  );
  md.push('');
  md.push('| indicator | lead (stress) slope | R2 | lead (ticks) slope | R2 | AUC slope | R2 |');
  md.push('| :-- | ---: | ---: | ---: | ---: | ---: | ---: |');
  for (const ind of EWS_INDICATORS) {
    const t = report.trends[ind];
    md.push(
      `| ${IND_LABEL[ind]} | ${t.param.slope.toFixed(4)} | ${t.param.r2.toFixed(2)} | ` +
        `${t.ticks.slope.toFixed(3)} | ${t.ticks.r2.toFixed(2)} | ` +
        `${t.auc.slope.toFixed(4)} | ${t.auc.r2.toFixed(2)} |`,
    );
  }
  md.push('');
  md.push('## Reading the table');
  md.push('');
  md.push(
    '- detect = fraction of runs where the indicator crossed mean+1.5SD of its pre-ramp baseline and stayed there (>=70% of the remaining pre-collapse windows).',
  );
  md.push('- lead (ticks) = ticks between the warning and the collapse; lead (stress) = the same interval in metabolismBase units (distance-to-bifurcation).');
  md.push('- AUC = per-run ROC area separating windows 40-250 ticks before collapse from early-stationary windows, averaged over runs.');
  md.push('- trend tau = Kendall tau of the indicator over [baseline, collapse]; +1 is a monotone rise toward the transition.');
  md.push('');
  md.push('If early warning is real, lead (stress) should be roughly constant across tau while lead (ticks) grows with tau, and AUC should exceed 0.5.');
  md.push('');

  const json = JSON.stringify(
    {
      ...report,
      runs: report.runs.map(({ pop: _p, stress: _s, points: _pts, ...rest }) => rest),
    },
    null,
    2,
  );

  const csv: string[] = [];
  csv.push('seed,ramp,collapse_tick,collapse_stress,' + EWS_INDICATORS.map((i) => `lead_${i}`).join(','));
  for (const r of report.runs) {
    csv.push(
      [
        r.spec.seed,
        r.spec.ramp,
        r.collapse ? r.collapse.tick : '',
        r.collapseStress !== null ? r.collapseStress.toFixed(3) : '',
        ...EWS_INDICATORS.map((i) => (r.leads[i] ? r.leads[i]!.leadTicks : '')),
      ].join(','),
    );
  }
  return { md: md.join('\n'), json, csv: csv.join('\n') };
}

const IND_HEX: Record<EwsIndicator, string> = {
  variance: '#4e79a7',
  ar1: '#e15759',
  recovery: '#59a14f',
  cv: '#f28e2b',
  skewness: '#b07aa1',
  flicker: '#76b7b2',
};

function esc(s: string): string {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function renderEwsSvg(report: EwsReport): string {
  const w = 1000;
  const h = 620;
  const parts: string[] = [];
  parts.push(
    `<rect width="${w}" height="${h}" fill="#0e1116"/>`,
    `<text x="24" y="34" fill="#e6edf3" font-family="monospace" font-size="15">critical transitions: early-warning signals</text>`,
    `<text x="24" y="54" fill="#8b949e" font-family="monospace" font-size="11">metabolismBase ${report.m0}-&gt;${report.mMax} ramp - population collapses to extinction - rolling EWS</text>`,
  );

  const run = report.runs.find((r) => r.spec.ramp === report.ramps[Math.min(1, report.ramps.length - 1)] && r.collapse) ?? report.runs[0];
  const px = 70;
  const py = 90;
  const pw = w - px - 40;
  const ph = 240;
  if (run) {
    const n = run.pop.length;
    const maxPop = Math.max(1, ...run.pop);
    const line = run.pop
      .map((v, i) => `${(px + (i / (n - 1)) * pw).toFixed(1)},${(py + ph - (v / maxPop) * ph).toFixed(1)}`)
      .join(' ');
    parts.push(
      `<rect x="${px}" y="${py}" width="${pw}" height="${ph}" fill="#12161d" stroke="#222"/>`,
      `<polyline points="${line}" fill="none" stroke="#e6edf3" stroke-width="1.3"/>`,
      `<text x="${px}" y="${py - 6}" fill="#8b949e" font-family="monospace" font-size="10">population (${esc(run.spec.seed)}, tau=${run.spec.ramp}) -> max ${maxPop}</text>`,
    );
    if (run.collapse) {
      const cx = px + (run.collapse.tick / (n - 1)) * pw;
      parts.push(
        `<line x1="${cx.toFixed(1)}" x2="${cx.toFixed(1)}" y1="${py}" y2="${py + ph}" stroke="#e15759" stroke-dasharray="3 3"/>`,
        `<text x="${(cx + 4).toFixed(1)}" y="${py + 12}" fill="#e15759" font-family="monospace" font-size="10">collapse @${run.collapse.tick}</text>`,
      );
    }
    const warn = run.leads.variance;
    if (warn) {
      const wx = px + (warn.tick / (n - 1)) * pw;
      parts.push(
        `<line x1="${wx.toFixed(1)}" x2="${wx.toFixed(1)}" y1="${py}" y2="${py + ph}" stroke="#4e79a7" stroke-dasharray="2 3"/>`,
        `<text x="${(wx + 4).toFixed(1)}" y="${py + 26}" fill="#4e79a7" font-family="monospace" font-size="10">variance warns</text>`,
      );
    }
  }

  const by = 400;
  const bh = 60;
  const ramps = report.ramps;
  const gw = pw / ramps.length;
  const maxLead = Math.max(10, ...report.summary.flatMap((s) => EWS_INDICATORS.map((i) => s.leads[i].meanTicks)));
  parts.push(`<text x="24" y="${by - 8}" fill="#8b949e" font-family="monospace" font-size="11">mean lead time (ticks) by ramp duration - grouped by indicator</text>`);
  const indsShown: EwsIndicator[] = ['variance', 'ar1', 'recovery', 'cv'];
  const barW = Math.min(14, gw / (indsShown.length + 1));
  ramps.forEach((ramp, gi) => {
    const s = report.summary.find((x) => x.ramp === ramp)!;
    const gx = px + gi * gw;
    indsShown.forEach((ind, k) => {
      const v = s.leads[ind].meanTicks;
      const barH = (v / maxLead) * bh;
      const x = gx + 10 + k * (barW + 3);
      parts.push(
        `<rect x="${x.toFixed(1)}" y="${(by + bh - barH).toFixed(1)}" width="${barW.toFixed(1)}" height="${Math.max(1, barH).toFixed(1)}" fill="${IND_HEX[ind]}" rx="2"/>`,
      );
    });
    parts.push(`<text x="${(gx + 10).toFixed(1)}" y="${by + bh + 16}" fill="#8b949e" font-family="monospace" font-size="10">tau=${ramp}</text>`);
  });
  indsShown.forEach((ind, k) => {
    parts.push(
      `<rect x="${(px + k * 110).toFixed(1)}" y="${by + bh + 34}" width="10" height="10" fill="${IND_HEX[ind]}"/>`,
      `<text x="${(px + k * 110 + 14).toFixed(1)}" y="${by + bh + 43}" fill="#8b949e" font-family="monospace" font-size="10">${IND_LABEL[ind]}</text>`,
    );
  });

  return [`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`, ...parts, '</svg>'].join('\n');
}

export function writeEwsReport(report: EwsReport): string {
  const dir = join(fileURLToPath(new URL('.', import.meta.url)), '../../research/output');
  mkdirSync(dir, { recursive: true });
  mkdirSync(join(dir, 'plots'), { recursive: true });
  const { md, json, csv } = renderEwsReport(report);
  writeFileSync(join(dir, 'ews.md'), md);
  writeFileSync(join(dir, 'ews.json'), json);
  writeFileSync(join(dir, 'ews.csv'), csv);
  writeFileSync(join(dir, 'plots', 'ews.svg'), renderEwsSvg(report));
  return dir;
}
