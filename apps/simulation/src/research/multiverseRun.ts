#!/usr/bin/env node
/**
 * Q5 multiverse runner.
 *
 * One simulation, many analyses. The expensive part (the ecology) runs once and
 * is cached to disk; every specification then re-analyses the same stored series.
 * That is the whole point of the multiverse: analytic choices vary, the data do
 * not.
 *
 *   npm run research:multiverse                 # full grid, ~35 min
 *   npm run research:multiverse -- --quick      # 2 seeds x 2 ramps, ~3 min
 *   npm run research:multiverse -- --from-cache # re-analysis only, seconds
 *
 * Writes research/output/ews-multiverse.{md,json,csv} and plots/ews-multiverse.svg.
 * It never overwrites the registered `ews.*` artifacts.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EWS_INDICATORS, type EwsIndicator } from '@fractal-life/shared';
import { EW_BURN, EW_RAMPS, EW_SEEDS, EW_TAIL, runOne } from './ews.js';
import {
  AXES,
  REGISTERED_SPEC,
  buildReport,
  quantile,
  specId,
  type Axis,
  type MultiverseReport,
  type RunSeries,
  type SpecOutcome,
} from './ewsMultiverse.js';

const OUT = join(fileURLToPath(new URL('.', import.meta.url)), '../../research/output');
const CACHE = join(OUT, 'ews-multiverse-series.json');

const argv = process.argv.slice(2);
const flag = (name: string): boolean => argv.includes(name);
const str = (name: string, fallback: string): string => {
  const i = argv.indexOf(name);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : fallback;
};
const num = (name: string, fallback: number): number => {
  const v = Number(str(name, ''));
  return Number.isFinite(v) ? v : fallback;
};

if (flag('--help')) {
  console.log('usage: multiverseRun.ts [--seeds a,b,c] [--ramps 500,900] [--quick] [--from-cache] [--reps 1000]');
  console.log('');
  console.log('  --seeds a,b,c    replicate seeds (default ' + EW_SEEDS.join(',') + ')');
  console.log('  --ramps a,b,c    ramp durations in ticks (default ' + EW_RAMPS.join(',') + ')');
  console.log('  --quick          2 seeds, ramps 300,900');
  console.log('  --from-cache     skip simulation; re-analyse the cached series (seconds)');
  console.log('  --reps N         bootstrap replicates (default 1000)');
  console.log('  --no-cache       do not write the series cache');
  console.log('');
  console.log('Enumerates 4 order parameters x 3 windows x 8 detrenders x 4 baselines x 3 thresholds,');
  console.log('skipping smoother widths that exceed the analysis window.');
  process.exit(0);
}

const quick = flag('--quick');
const seedsArg = str('--seeds', '');
const rampsArg = str('--ramps', '');
const seeds = quick ? ['ews.a', 'ews.b'] : seedsArg ? seedsArg.split(',').map((s) => s.trim()).filter(Boolean) : EW_SEEDS;
const ramps = quick
  ? [300, 900]
  : rampsArg
    ? rampsArg
        .split(',')
        .map((s) => Number(s.trim()))
        .filter((n) => Number.isFinite(n) && n > 0)
    : EW_RAMPS;
const reps = num('--reps', 1000);

/* ------------------------------------------------------------- simulate -- */

interface Cache {
  version: 1;
  seeds: string[];
  ramps: number[];
  burn: number;
  runs: RunSeries[];
}

function simulate(): RunSeries[] {
  const runs: RunSeries[] = [];
  const total = seeds.length * ramps.length;
  const t0 = Date.now();
  let done = 0;
  for (const seed of seeds) {
    for (const ramp of ramps) {
      const ticks = EW_BURN + ramp + EW_TAIL;
      const r = runOne({ seed, ramp, burn: EW_BURN, ticks });
      runs.push({
        seed,
        ramp,
        pop: r.pop,
        stress: r.stress,
        collapse: r.collapse,
        collapseStress: r.collapseStress,
      });
      done++;
      const el = (Date.now() - t0) / 1000;
      const eta = (el / done) * (total - done);
      console.log(
        `[${String(done).padStart(String(total).length)}/${total}] ${seed} tau=${ramp}  ` +
          `${r.collapse ? `collapse@${r.collapse.tick}` : 'survives'}  ` +
          `${el.toFixed(0)}s elapsed, ~${eta.toFixed(0)}s left`,
      );
    }
  }
  return runs;
}

function loadCache(): Cache {
  const raw = JSON.parse(readFileSync(CACHE, 'utf8')) as Cache;
  if (raw.version !== 1) throw new Error(`unsupported cache version ${String(raw.version)}`);
  return raw;
}

let runs: RunSeries[];
let seedsUsed = seeds;
let rampsUsed = ramps;
let provenance: string;

if (flag('--from-cache')) {
  const cache = loadCache();
  runs = cache.runs;
  seedsUsed = cache.seeds;
  rampsUsed = cache.ramps;
  provenance = 're-analysed from `ews-multiverse-series.json` (no simulation in this run)';
  console.log(`loaded ${runs.length} cached runs (${seedsUsed.length} seeds x ${rampsUsed.length} ramps)`);
} else {
  console.log(`simulating ${seeds.length} seed(s) x ${ramps.length} ramp(s) [${ramps.join(', ')}] ...`);
  runs = simulate();
  provenance = 'simulated in this run (TypeScript reference engine)';
  if (!flag('--no-cache')) {
    mkdirSync(OUT, { recursive: true });
    const cache: Cache = { version: 1, seeds, ramps, burn: EW_BURN, runs };
    writeFileSync(CACHE, JSON.stringify(cache));
    console.log(`series cached to ${CACHE}`);
  }
}

/* --------------------------------------------------------------- analyse -- */

const t1 = Date.now();
const report = buildReport(runs, { seeds: seedsUsed, ramps: rampsUsed, target: 'variance', reps });
console.log(`analysed ${report.specs} specifications in ${((Date.now() - t1) / 1000).toFixed(1)}s`);

/* ---------------------------------------------------------------- render -- */

const IND_LABEL: Record<EwsIndicator, string> = {
  variance: 'variance',
  ar1: 'AR(1)',
  recovery: 'recovery',
  cv: 'CV',
  skewness: 'skewness',
  flicker: 'flicker',
};

const fmt = (v: number, d = 4): string => (Number.isFinite(v) ? v.toFixed(d) : '—');
const pct = (v: number): string => `${(v * 100).toFixed(0)}%`;

/**
 * Identifiability check for M1 as originally stated. If the pre-ramp series are
 * bit-identical across ramp durations (they should be: the ramp starts at the
 * end of burn-in), then a slow ramp cannot inflate the pre-ramp baseline, and
 * "threshold drift" must mean something else.
 */
function prerampIdentical(): { seedsIdentical: number; seeds: number } {
  let identical = 0;
  for (const seed of seedsUsed) {
    const rows = runs.filter((r) => r.seed === seed).sort((a, b) => a.ramp - b.ramp);
    if (rows.length < 2) continue;
    const cut = Math.min(EW_BURN, ...rows.map((r) => r.pop.length));
    const ref = rows[0].pop.slice(0, cut);
    const same = rows.every((r) => {
      for (let i = 0; i < cut; i++) if (r.pop[i] !== ref[i]) return false;
      return true;
    });
    if (same) identical++;
  }
  return { seedsIdentical: identical, seeds: seedsUsed.length };
}

function renderMd(rep: MultiverseReport): string {
  const md: string[] = [];
  const reg = rep.registered;
  const id = prerampIdentical();

  md.push('# Q5 multiverse: is the calibration failure an artefact of the analysis?');
  md.push('');
  md.push(
    `One simulated dataset, ${rep.specs} defensible analyses. Data: ${rep.seeds.length} seeds x ${rep.ramps.length} ` +
      `ramp durations = ${rep.runs} runs (${rep.collapsed} collapsed). Provenance: ${provenance}.`,
  );
  md.push('');
  md.push(
    'Every specification re-analyses the *same* stored population series. Collapse detection, ' +
      'window labelling (40-250 ticks before collapse vs early-stationary), and the early cutoff ' +
      'are held fixed: they are properties of the data, not of the analysis.',
  );
  md.push('');

  if (reg) {
    md.push('## Registered specification');
    md.push('');
    md.push(
      `\`${specId(REGISTERED_SPEC)}\` reproduces the headline analysis: AUC slope ` +
        `${fmt(reg.aucSlope.variance.slope, 4)} (R2 ${fmt(reg.aucSlope.variance.r2, 2)}), ` +
        `lead(stress) slope ${fmt(reg.leadParamSlope.variance.slope, 4)} (R2 ${fmt(reg.leadParamSlope.variance.r2, 2)}).`,
    );
    md.push('');
    if (rep.bootstrap) {
      md.push(
        `Hierarchical-by-seed bootstrap (${rep.bootstrap.auc.reps} replicates): AUC slope ` +
          `[${fmt(rep.bootstrap.auc.lo, 4)}, ${fmt(rep.bootstrap.auc.hi, 4)}] median ` +
          `${fmt(rep.bootstrap.auc.median, 4)}, ${pct(rep.bootstrap.auc.shareNegative)} of resamples negative. ` +
          `Lead(stress) slope [${fmt(rep.bootstrap.leadParam.lo, 4)}, ${fmt(rep.bootstrap.leadParam.hi, 4)}], ` +
          `${pct(rep.bootstrap.leadParam.shareNegative)} negative.`,
      );
      md.push('');
    }
  }

  md.push('## Does the decline survive the analysis space?');
  md.push('');
  md.push('| indicator | registered AUC slope | multiverse median | 5-95% | share negative | specs |');
  md.push('| :-- | ---: | ---: | :--: | ---: | ---: |');
  for (const row of rep.aucHeadline) {
    md.push(
      `| ${IND_LABEL[row.indicator]} | ${fmt(row.registered, 4)} | ${fmt(row.median, 4)} | ` +
        `${fmt(row.q05, 4)} to ${fmt(row.q95, 4)} | ${pct(row.shareNegative)} | ${row.n} |`,
    );
  }
  md.push('');
  md.push('Lead in control-parameter (stress) units vs ramp duration:');
  md.push('');
  md.push('| indicator | registered slope | multiverse median | 5-95% | share negative | specs |');
  md.push('| :-- | ---: | ---: | :--: | ---: | ---: |');
  for (const row of rep.leadHeadline) {
    md.push(
      `| ${IND_LABEL[row.indicator]} | ${fmt(row.registered, 4)} | ${fmt(row.median, 4)} | ` +
        `${fmt(row.q05, 4)} to ${fmt(row.q95, 4)} | ${pct(row.shareNegative)} | ${row.n} |`,
    );
  }
  md.push('');

  const axisTitle: Record<Axis, string> = {
    order: 'order parameter (M3)',
    window: 'analysis window',
    detrender: 'detrender (M2)',
    baseline: 'baseline estimator (M1)',
    k: 'detection threshold k',
  };

  for (const metric of ['auc', 'leadParam'] as const) {
    const axes = metric === 'auc' ? rep.aucAxes : rep.leadAxes;
    md.push(`## By analysis axis: ${metric === 'auc' ? 'AUC vs tau' : 'lead(stress) vs tau'} (${IND_LABEL[rep.target]})`);
    md.push('');
    md.push('| axis | level | specs | median slope | 10-90% | share negative | reduction | flattened | verdict |');
    md.push('| :-- | :-- | ---: | ---: | :--: | ---: | ---: | ---: | :-- |');
    for (const axis of AXES) {
      for (const row of axes[axis]) {
        md.push(
          `| ${axisTitle[axis]} | ${row.level} | ${row.n} | ${fmt(row.median, 5)} | ` +
            `${fmt(row.q10, 5)} to ${fmt(row.q90, 5)} | ${pct(row.shareNegative)} | ` +
            `${row.reduction >= 0 ? pct(row.reduction) : 'worse'} | ${pct(row.shareFlattened)} | ${row.verdict} |`,
        );
      }
    }
    md.push('');
  }

  md.push('## Decision rule');
  md.push('');
  md.push(
    'Pre-registered (`docs/CLAIMS.md`, E-EWS-11): a level of an analysis axis explains the failure only if ' +
      '(a) its median slope removes at least half of the registered slope and (b) at least 90% of its ' +
      'specifications are flattened to within half the registered magnitude. Anything less keeps the ' +
      'mechanism open.',
  );
  md.push('');
  const supported: string[] = [];
  for (const axis of AXES) {
    for (const row of rep.leadAxes[axis]) {
      if (row.verdict === 'supported') supported.push(`${axis}=${row.level}`);
    }
  }
  if (supported.length === 0) {
    md.push(
      '**No level of any axis meets both bars for the lead-in-stress slope.** The calibration failure is not ' +
        'rescued by a plausible change of analysis, which is what makes it a result about the ecology rather ' +
        'than about one specification.',
    );
  } else {
    md.push(`Levels meeting both bars: ${supported.join(', ')}. The mechanism is **not** closed: treat these as the next hypothesis.`);
  }
  md.push('');

  md.push('## Identifiability of M1 as stated');
  md.push('');
  md.push(
    `The pre-ramp population series is bit-identical across ramp durations for ${id.seedsIdentical}/${id.seeds} seeds: ` +
      'the ramp begins at the end of burn-in, and the baseline window ends before it. A *slow ramp therefore ' +
      'cannot inflate the pre-ramp baseline*, so M1 cannot operate through the mechanism originally stated. ' +
      'The baseline axis tests the remaining version: a detection bar whose scale is fixed while the number of ' +
      'pre-collapse windows grows with tau ("bar rigidity").',
  );
  md.push('');

  md.push('## What this licenses');
  md.push('');
  md.push(
    '- The AUC-vs-tau decline is a property of the *analysis shape* (order parameter, window, detrender), not of ' +
      'the detection rule; by construction the detection rule cannot affect it.',
  );
  md.push(
    '- The lead-in-stress decline additionally depends on the detection rule. The table above says how much of it ' +
      'is rule-dependent; if the median stays negative across levels, the failure is not a threshold artefact.',
  );
  md.push(
    '- It does **not** identify the biological mechanism. M2 (detrending) is the axis to read first, because a ' +
      'detrender that removes slow variance growth removes the signal the theory predicts.',
  );
  md.push('');
  md.push('## Reproduce');
  md.push('');
  md.push('```bash');
  md.push('npm run research:multiverse                # simulate + analyse (~35 min)');
  md.push('npm run research:multiverse -- --from-cache # re-analyse stored series (seconds)');
  md.push('```');
  md.push('');
  return md.join('\n');
}

function renderJson(rep: MultiverseReport): string {
  return JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      provenance,
      design: { seeds: rep.seeds, ramps: rep.ramps, runs: rep.runs, collapsed: rep.collapsed, specs: rep.specs },
      registeredSpec: REGISTERED_SPEC,
      registered: rep.registered
        ? {
            id: rep.registered.id,
            aucSlope: rep.registered.aucSlope,
            leadParamSlope: rep.registered.leadParamSlope,
            leadTicksSlope: rep.registered.leadTicksSlope,
            pooledAuc: rep.registered.pooledAuc,
            detect: rep.registered.detect,
          }
        : null,
      bootstrap: rep.bootstrap,
      aucHeadline: rep.aucHeadline,
      leadHeadline: rep.leadHeadline,
      aucAxes: rep.aucAxes,
      leadAxes: rep.leadAxes,
      prerampIdentical: prerampIdentical(),
      // The 1,056 per-specification rows live in ews-multiverse.csv; duplicating
      // them here made the JSON 2.3 MB for no analytical gain.
      specRows: 'see ews-multiverse.csv',
    },
    null,
    2,
  );
}

function renderCsv(rep: MultiverseReport): string {
  const head = [
    'id',
    'order',
    'window',
    'detrender',
    'baseline',
    'k',
    ...EWS_INDICATORS.map((i) => `auc_slope_${i}`),
    ...EWS_INDICATORS.map((i) => `auc_r2_${i}`),
    ...EWS_INDICATORS.map((i) => `lead_slope_${i}`),
    ...EWS_INDICATORS.map((i) => `lead_r2_${i}`),
    ...EWS_INDICATORS.map((i) => `detect_${i}`),
  ];
  const rows = rep.outcomes.map((o: SpecOutcome) =>
    [
      o.id,
      o.spec.order,
      o.spec.window,
      o.spec.detrender,
      o.spec.baseline,
      o.spec.k,
      ...EWS_INDICATORS.map((i) => o.aucSlope[i].slope.toFixed(6)),
      ...EWS_INDICATORS.map((i) => o.aucSlope[i].r2.toFixed(4)),
      ...EWS_INDICATORS.map((i) => o.leadParamSlope[i].slope.toFixed(6)),
      ...EWS_INDICATORS.map((i) => o.leadParamSlope[i].r2.toFixed(4)),
      ...EWS_INDICATORS.map((i) => o.detect[i].toFixed(3)),
    ].join(','),
  );
  return [head.join(','), ...rows].join('\n');
}

function esc(s: string): string {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** specification curve: every analysis, sorted by its lead(stress) slope */
function renderSvg(rep: MultiverseReport): string {
  const w = 1040;
  const h = 660;
  const p: string[] = [];
  const px = 70;
  const py = 96;
  const pw = w - px - 50;
  const ph = 300;

  const slopes = rep.outcomes
    .map((o) => ({ id: o.id, v: o.leadParamSlope[rep.target].slope }))
    .sort((a, b) => a.v - b.v);
  const regSlope = rep.registered?.leadParamSlope[rep.target].slope ?? 0;
  const lo = Math.min(0, ...slopes.map((s) => s.v));
  const hi = Math.max(0, ...slopes.map((s) => s.v));
  const span = hi - lo || 1;
  const yOf = (v: number): number => py + ph - ((v - lo) / span) * ph;

  p.push(
    `<rect width="${w}" height="${h}" fill="#0e1116"/>`,
    `<text x="24" y="30" fill="#e6edf3" font-family="monospace" font-size="15">Q5 multiverse - specification curve</text>`,
    `<text x="24" y="50" fill="#8b949e" font-family="monospace" font-size="11">${rep.specs} analyses of one dataset: lead(${IND_LABEL[rep.target]}, stress units) vs tau slope, sorted</text>`,
    `<text x="24" y="68" fill="#8b949e" font-family="monospace" font-size="11">negative = warning lead shrinks as the fold is approached more slowly (the registered failure)</text>`,
  );
  p.push(`<rect x="${px}" y="${py}" width="${pw}" height="${ph}" fill="#12161d" stroke="#222"/>`);
  p.push(`<line x1="${px}" y1="${yOf(0).toFixed(1)}" x2="${px + pw}" y2="${yOf(0).toFixed(1)}" stroke="#8b949e" stroke-dasharray="4 4"/>`);
  p.push(`<text x="${px + pw + 4}" y="${(yOf(0) + 4).toFixed(1)}" fill="#8b949e" font-family="monospace" font-size="10">0</text>`);
  const bw = pw / Math.max(1, slopes.length);
  slopes.forEach((s, i) => {
    const y = Math.min(yOf(s.v), yOf(0));
    const hgt = Math.max(1, Math.abs(yOf(s.v) - yOf(0)));
    const neg = s.v < 0;
    p.push(
      `<rect x="${(px + i * bw).toFixed(2)}" y="${y.toFixed(1)}" width="${Math.max(1, bw).toFixed(2)}" height="${hgt.toFixed(1)}" fill="${neg ? '#4e79a7' : '#e15759'}"/>`,
    );
  });
  const yReg = yOf(regSlope);
  p.push(
    `<line x1="${px}" y1="${yReg.toFixed(1)}" x2="${px + pw}" y2="${yReg.toFixed(1)}" stroke="#f28e2b" stroke-width="1.5"/>`,
    `<text x="${px + 6}" y="${(yReg - 6).toFixed(1)}" fill="#f28e2b" font-family="monospace" font-size="10">registered spec ${regSlope.toFixed(5)}</text>`,
  );

  // axis summary panel
  const ay = 440;
  p.push(`<text x="24" y="${ay - 12}" fill="#8b949e" font-family="monospace" font-size="11">median slope by axis level (whiskers = 10-90% of specifications)</text>`);
  const items: { label: string; med: number; q10: number; q90: number }[] = [];
  for (const axis of AXES) {
    for (const row of rep.leadAxes[axis]) {
      items.push({ label: `${axis}:${row.level}`, med: row.median, q10: row.q10, q90: row.q90 });
    }
  }
  const rowH = 13;
  const ax = 210;
  const aw = w - ax - 60;
  const aLo = Math.min(lo, ...items.map((i) => i.q10));
  const aHi = Math.max(hi, ...items.map((i) => i.q90));
  const aSpan = aHi - aLo || 1;
  const xOf = (v: number): number => ax + ((v - aLo) / aSpan) * aw;
  p.push(`<line x1="${xOf(0).toFixed(1)}" y1="${ay - 4}" x2="${xOf(0).toFixed(1)}" y2="${ay + items.length * rowH + 4}" stroke="#8b949e" stroke-dasharray="3 3"/>`);
  items.slice(0, 21).forEach((it, i) => {
    const y = ay + i * rowH;
    p.push(
      `<line x1="${xOf(it.q10).toFixed(1)}" y1="${y}" x2="${xOf(it.q90).toFixed(1)}" y2="${y}" stroke="#30363d"/>`,
      `<circle cx="${xOf(it.med).toFixed(1)}" cy="${y}" r="2.6" fill="${it.med < 0 ? '#4e79a7' : '#e15759'}"/>`,
      `<text x="24" y="${y + 3}" fill="#8b949e" font-family="monospace" font-size="9">${esc(it.label)}</text>`,
    );
  });
  p.push(`<text x="${ax}" y="${ay + items.length * rowH + 20}" fill="#8b949e" font-family="monospace" font-size="10">${esc(`multiverse median ${quantile(slopes.map((s) => s.v), 0.5).toFixed(5)}, 5-95% ${quantile(slopes.map((s) => s.v), 0.05).toFixed(5)} to ${quantile(slopes.map((s) => s.v), 0.95).toFixed(5)}`)}</text>`);

  return [`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`, ...p, '</svg>'].join('\n');
}

const md = renderMd(report);
const json = renderJson(report);
const csv = renderCsv(report);
const svg = renderSvg(report);

mkdirSync(join(OUT, 'plots'), { recursive: true });
writeFileSync(join(OUT, 'ews-multiverse.md'), md);
writeFileSync(join(OUT, 'ews-multiverse.json'), json);
writeFileSync(join(OUT, 'ews-multiverse.csv'), csv);
writeFileSync(join(OUT, 'plots', 'ews-multiverse.svg'), svg);

/* ------------------------------------------------------------ console -- */

const reg = report.registered;
console.log('');
console.log(`specs analysed: ${report.specs}   runs: ${report.runs}   collapsed: ${report.collapsed}`);
if (reg) {
  console.log(
    `registered (${specId(REGISTERED_SPEC)}): AUC slope ${reg.aucSlope.variance.slope.toFixed(4)}, ` +
      `lead(stress) slope ${reg.leadParamSlope.variance.slope.toFixed(4)}`,
  );
}
if (report.bootstrap) {
  console.log(
    `bootstrap AUC slope [${report.bootstrap.auc.lo.toFixed(4)}, ${report.bootstrap.auc.hi.toFixed(4)}]  ` +
      `lead [${report.bootstrap.leadParam.lo.toFixed(4)}, ${report.bootstrap.leadParam.hi.toFixed(4)}]`,
  );
}
console.log('');
for (const row of report.leadHeadline) {
  console.log(
    `  lead ${IND_LABEL[row.indicator].padEnd(9)} registered ${row.registered.toFixed(4).padStart(9)}  ` +
      `median ${row.median.toFixed(4).padStart(9)}  5-95% [${row.q05.toFixed(4)}, ${row.q95.toFixed(4)}]  ` +
      `${(row.shareNegative * 100).toFixed(0)}% negative`,
  );
}
console.log('');
for (const axis of AXES) {
  const rows = report.leadAxes[axis];
  const best = rows.slice().sort((a, b) => b.reduction - a.reduction)[0];
  if (best) {
    console.log(`  ${axis.padEnd(10)} strongest level ${best.level.padEnd(10)} reduction ${(best.reduction * 100).toFixed(0)}%  ${best.verdict}`);
  }
}
const m1 = prerampIdentical();
console.log('');
console.log(`identifiability: pre-ramp series identical across tau for ${m1.seedsIdentical}/${m1.seeds} seeds (M1 as stated is excluded)`);
console.log('');
console.log(`written to ${OUT}: ews-multiverse.{md,json,csv} + plots/ews-multiverse.svg`);
