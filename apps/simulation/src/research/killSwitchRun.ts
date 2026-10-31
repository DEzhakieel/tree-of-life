#!/usr/bin/env node
/**
 * Experiment C runner - the kill-switch map.
 *
 *   npm run research:killswitch                 # 16 seeds, full design
 *   npm run research:killswitch -- --quick      # smoke test only
 *   npm run research:killswitch -- --from-cache
 *   npm run research:killswitch -- --seeds ck.0,ck.1
 *
 * Design: 12 conditions, a 4-target x 6-dose response, and a 10-point
 * location sweep. Artifacts: research/output/kill-switch.{md,json,csv} and
 * plots/kill-switch.svg. Pre-registered claims live in docs/CLAIMS.md
 * (C-KILL-01..05).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  KS_BURN,
  KS_CONDITIONS,
  KS_DOSES,
  KS_DOSE_TARGETS,
  KS_SWEEP,
  KS_TICKS,
  buildKillSwitchReport,
  observeRun,
  runKillSwitch,
  type KillSwitchObservation,
  type KillSwitchReport,
} from './killSwitch.js';

const OUT = join(fileURLToPath(new URL('.', import.meta.url)), '../../research/output');
const CACHE = join(OUT, 'kill-switch-series.json');
const CACHE_VERSION = 1;

const DEFAULT_SEEDS = Array.from({ length: 16 }, (_, i) => `ck.${i}`);

const argv = process.argv.slice(2);
const has = (n: string): boolean => argv.includes(n);
const str = (n: string, fallback: string): string => {
  const i = argv.indexOf(n);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1]! : fallback;
};
const num = (n: string, fallback: number): number => {
  const raw = str(n, '');
  if (raw.trim() === '') return fallback;
  const v = Number(raw);
  return Number.isFinite(v) ? v : fallback;
};

if (has('--help')) {
  console.log('usage: killSwitchRun.ts [--quick] [--from-cache] [--seeds a,b] [--ticks N]');
  console.log('');
  console.log('  --quick       2 seeds x 400 ticks, smoke test only');
  console.log('  --from-cache  re-render research/output/kill-switch-series.json');
  console.log('  --seeds a,b   confirmatory seeds (default ck.0..ck.15)');
  console.log('  --ticks N     ticks per run (default ' + KS_TICKS + ')');
  process.exit(0);
}

const quick = has('--quick');
const fromCache = has('--from-cache');
const seedsArg = str('--seeds', '');
const seeds = seedsArg
  ? seedsArg.split(',').map((s) => s.trim()).filter(Boolean)
  : quick
    ? ['quick.a', 'quick.b']
    : DEFAULT_SEEDS;
const ticks = Math.max(KS_BURN + 100, num('--ticks', quick ? 400 : KS_TICKS));

const fmt = (v: number, d = 3): string => (Number.isFinite(v) ? v.toFixed(d) : 'n/a');
const pct = (v: number): string => (Number.isFinite(v) ? `${(v * 100).toFixed(0)}%` : 'n/a');

interface CacheFile {
  version: number;
  generatedAt: string;
  config: {
    ticks: number;
    burnIn: number;
    seeds: string[];
    conditions: string[];
    doses: number[];
    doseTargets: string[];
    sweep: string[];
  };
  observations: KillSwitchObservation[];
}

function buildCache(): CacheFile {
  const observations: KillSwitchObservation[] = [];
  const total = seeds.length * (KS_CONDITIONS.length + KS_DOSE_TARGETS.length * KS_DOSES.length + KS_SWEEP.length);
  let done = 0;
  const tick = (): void => {
    done++;
    if (done % 16 === 0 || done === total) process.stdout.write(`\r  simulated ${done}/${total} runs`);
  };

  for (const seed of seeds) {
    for (const spec of KS_CONDITIONS) {
      const run = runKillSwitch({ seed, condition: spec.name, ticks });
      observations.push(observeRun(run, { task: 'condition' }));
      tick();
    }
    for (const target of KS_DOSE_TARGETS) {
      for (const fraction of KS_DOSES) {
        const run = runKillSwitch({ seed, condition: target, target, fraction, ticks });
        observations.push(observeRun(run, { task: 'dose', fraction, radiusFrac: 0, angle: 0 }));
        tick();
      }
    }
    for (let i = 0; i < KS_SWEEP.length; i++) {
      const point = KS_SWEEP[i]!;
      const run = runKillSwitch({ seed, condition: 'core', target: 'none', lesion: point, ticks });
      observations.push(
        observeRun(run, {
          task: 'sweep',
          sweepIndex: i,
          fraction: 0.4,
          radiusFrac: point.radiusFrac,
          angle: point.angle,
        }),
      );
      tick();
    }
  }
  process.stdout.write('\n');
  return {
    version: CACHE_VERSION,
    generatedAt: new Date().toISOString(),
    config: {
      ticks,
      burnIn: KS_BURN,
      seeds,
      conditions: KS_CONDITIONS.map((c) => c.name),
      doses: [...KS_DOSES],
      doseTargets: [...KS_DOSE_TARGETS],
      sweep: KS_SWEEP.map((p) => p.label),
    },
    observations,
  };
}

let cache: CacheFile;
let provenance: string;
if (fromCache) {
  if (!existsSync(CACHE)) throw new Error(`no cache at ${CACHE}; run without --from-cache first`);
  const raw = JSON.parse(readFileSync(CACHE, 'utf8')) as CacheFile;
  if (raw.version !== CACHE_VERSION) {
    throw new Error(`cache version ${raw.version} != ${CACHE_VERSION}; rerun without --from-cache`);
  }
  const expect = {
    ticks,
    seeds: seeds.join(','),
    conditions: KS_CONDITIONS.map((c) => c.name).join(','),
    doses: KS_DOSES.join(','),
    doseTargets: KS_DOSE_TARGETS.join(','),
    sweep: KS_SWEEP.map((p) => p.label).join(','),
  };
  const got = {
    ticks: raw.config.ticks,
    seeds: raw.config.seeds.join(','),
    conditions: raw.config.conditions.join(','),
    doses: raw.config.doses.join(','),
    doseTargets: raw.config.doseTargets.join(','),
    sweep: raw.config.sweep.join(','),
  };
  for (const key of Object.keys(expect) as (keyof typeof expect)[]) {
    if (expect[key] !== got[key]) {
      throw new Error(`cache ${key} mismatch (${got[key]} != ${expect[key]}); rerun without --from-cache`);
    }
  }
  cache = raw;
  provenance = `read from ${CACHE} (generated ${raw.generatedAt}); no runs performed in this invocation`;
} else {
  cache = buildCache();
  if (!quick) writeFileSync(CACHE, JSON.stringify(cache));
  provenance = `simulated in this run (${cache.config.seeds.length} seeds x ${cache.observations.length / cache.config.seeds.length} runs/seed x ${cache.config.ticks} ticks)${
    quick ? ' - SMOKE TEST, NOT EVIDENCE' : ''
  }`;
}

const report = buildKillSwitchReport(cache.observations);

/* ------------------------------------------------------------------- render -- */

function conditionTable(): string {
  const head =
    '| condition | n | destroyed | final / pre | loss vs control | median recovery | censored | no dip | components | largest | removed |';
  const sep = '|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|';
  const rows = report.conditions.map(
    (c) =>
      `| ${c.name} | ${c.n} | ${pct(c.destruction)} | ${fmt(c.meanFinalRatio, 2)} | ${fmt(c.meanLoss, 2)} | ${
        Number.isFinite(c.medianRecovery) ? c.medianRecovery.toFixed(0) : 'n/a'
      } | ${c.censored} | ${c.noDip} | ${fmt(c.meanComponents, 0)} | ${fmt(c.meanLargestFrac, 2)} | ${fmt(c.meanRemoved, 0)} |`,
  );
  return [head, sep, ...rows].join('\n');
}

function doseTable(): string {
  const head = `| dose | ${KS_DOSE_TARGETS.join(' | ')} |`;
  const sep = `|---:${KS_DOSE_TARGETS.map(() => '|---:').join('')}|`;
  const rows = KS_DOSES.map((fraction) => {
    const cells = KS_DOSE_TARGETS.map((target) => {
      const d = report.doses.find((x) => x.target === target && Math.abs(x.fraction - fraction) < 1e-9);
      return d ? `${pct(d.destruction)} / ${fmt(d.meanLoss, 2)}` : 'n/a';
    });
    return `| ${fraction.toFixed(2)} | ${cells.join(' | ')} |`;
  });
  return [head, sep, ...rows].join('\n');
}

function sweepTable(): string {
  const head = '| point | radius / colony radius | n | destroyed | loss vs control |';
  const sep = '|---|---:|---:|---:|---:|';
  const rows = report.sweep.map(
    (s) => `| ${s.label} | ${fmt(s.radiusFrac, 2)} | ${s.n} | ${pct(s.destruction)} | ${fmt(s.meanLoss, 3)} |`,
  );
  return [head, sep, ...rows].join('\n');
}

function claimTable(): string {
  const head = '| claim | verdict | result |';
  const sep = '|---|---|---|';
  const rows = report.claims.map((c) => `| ${c.id} | **${c.verdict}** | ${c.detail} |`);
  return [head, sep, ...rows].join('\n');
}

function renderMd(): string {
  const control = report.conditions.find((c) => c.name === 'control')!;
  const participation = report.conditions.find((c) => c.name === 'participation')!;
  const random = report.conditions.find((c) => c.name === 'random')!;
  const lines: string[] = [];
  lines.push('# Experiment C - the kill-switch map');
  lines.push('');
  lines.push(`Generated ${cache.generatedAt}. ${provenance}.`);
  lines.push('');
  lines.push(
    `${report.seeds.length} seeds x (${KS_CONDITIONS.length} conditions + ${KS_DOSE_TARGETS.length} dose curves x ${KS_DOSES.length} doses + ${KS_SWEEP.length} locations) on a ${48}x${48} torus, ${report.ticks} ticks per run, perturbation at tick ${report.burn}.`,
  );
  lines.push('');
  lines.push('## What this measures');
  lines.push('');
  lines.push(
    'A colony of cells on a torus. Each occupied cell contributes to a colony-level public good in proportion to ' +
      'its local crowding, `(n/4)^2`; the good is well mixed inside a connected component, decays, and gates birth ' +
      'at the quorum threshold `S_MIN`. Births consume a global nutrient pool. Death rises when the good is low ' +
      'and when a cell is exposed. The colony is a self-sustaining emergent structure: above the quorum it replaces ' +
      'itself, below it no cell can divide and it decays.',
  );
  lines.push('');
  lines.push(
    'The map asks which directed perturbation actually breaks that structure. Conditions remove a fixed fraction ' +
      'of the pre-lesion colony by different rules (geometric core, rim, lifetime divisions, age-matched random, ' +
      'density-matched random, uniform random), seal the core-periphery interface, cut the same number of random ' +
      'internal links, or pause a region for 100 ticks. The dose response repeats the removal rule at 5-40%. The ' +
      'location sweep moves a compact 40% lesion from the centroid through eight mid-radius azimuths to the rim.',
  );
  lines.push('');
  lines.push(
    '**Destruction** is final population below 5% of the pre-lesion count. **Recovery** is the first tick after a ' +
      'dip below 90% of the pre-lesion count at which the population is back to 90%; runs that never dip are ' +
      'reported separately, and runs still below that level at the end are censored. **Loss** is `1 - final / control ' +
      'final` at the same seed. **Fragmentation** is measured immediately after the perturbation: number of ' +
      'connected components and the largest component as a fraction of surviving cells.',
  );
  lines.push('');
  lines.push('## Viability gate');
  lines.push('');
  lines.push(
    `Control: destruction ${pct(control.destruction)}, mean final / pre ${fmt(control.meanFinalRatio, 2)}, ` +
      `minimum ${fmt(report.viability.minFinalRatio, 2)}. ${report.viability.valid ? 'The assay is valid.' : '**The assay is invalid; all claims are reported as inconclusive.**'} ${report.viability.note}.`,
  );
  lines.push('');
  lines.push('## Pre-registered claims');
  lines.push('');
  lines.push(
    `Effect floor for a destruction difference: ${report.floorProb.toFixed(2)}. ` +
      `Seal loss floor: max(2 x between-seed SD of random-edge loss, ${fmt(0.1, 2)}) = ${fmt(report.floorLoss, 3)}. ` +
      'Location equivalence margin: 0.15 in loss. Decision rule: supported requires the point estimate to clear ' +
      'the floor and the paired bootstrap interval to lie on the required side; refuted requires the registered ' +
      'falsifier to fire; otherwise inconclusive.',
  );
  lines.push('');
  lines.push(claimTable());
  lines.push('');
  lines.push('## Conditions (40% lesion unless noted)');
  lines.push('');
  lines.push(conditionTable());
  lines.push('');
  lines.push(
    `The headline contrast is participation ${pct(participation.destruction)} destroyed vs random ${pct(
      random.destruction,
    )} destroyed (difference ${fmt(participation.destruction - random.destruction, 2)}).`,
  );
  lines.push('');
  lines.push('## Dose response');
  lines.push('');
  lines.push('Cells show destruction / loss vs control. Participation is the top-division rule; matched and ageMatched are the controls.');
  lines.push('');
  lines.push(doseTable());
  lines.push('');
  lines.push(
    `Smallest dose reaching 50% destruction: participation ${Number.isFinite(report.minKillDose) ? report.minKillDose.toFixed(2) : 'n/a'}, random ${Number.isFinite(report.randomDose) ? report.randomDose.toFixed(2) : 'n/a'}.`,
  );
  lines.push('');
  lines.push('## Location sweep');
  lines.push('');
  lines.push(sweepTable());
  lines.push('');
  lines.push('## Model assumptions and limits');
  lines.push('');
  lines.push(
    '- The public good is well mixed within a connected component. The model therefore tests colony-level quorum ' +
      'maintenance, not local diffusion or spatial signalling.',
  );
  lines.push(
    '- A cell\'s lifetime division count is a marker, not a mechanism: it is not read by birth or death. Any ' +
      'difference between the participation and matched arms is therefore a spatial/demographic effect, not a ' +
      'direct cost of dividing.',
  );
  lines.push(
    '- The interface seal is a ring of blocked edges. It tests one boundary mechanism; it does not test policing, ' +
      'adhesion or active transport.',
  );
  lines.push(
    '- A pause freezes birth, death and public-good production in the paused cells for 100 ticks. It is not a ' +
      'model of quiescence with maintenance.',
  );
  lines.push(
    '- Destruction is an extinction threshold. A colony that loses function but stays above 5% is not counted as ' +
      'destroyed; the loss and recovery columns carry that information.',
  );
  lines.push('');
  lines.push('## Reproduce');
  lines.push('');
  lines.push('```');
  lines.push('npm run research:killswitch');
  lines.push('npm run research:killswitch -- --from-cache');
  lines.push('```');
  lines.push('');
  return lines.join('\n');
}

function renderCsv(): string {
  const head = [
    'seed',
    'task',
    'condition',
    'label',
    'target',
    'fraction',
    'sweep_index',
    'radius_frac',
    'angle',
    'ticks',
    'pop0',
    'final_pop',
    'min_pop',
    'destruction',
    'dipped',
    'recovery_tick',
    'late_births',
    'removed',
    'edges',
    'frozen',
    'components',
    'largest_frac',
  ];
  const numCell = (v: number): string => (Number.isFinite(v) ? String(Number(v.toFixed(6))) : '');
  const rows = cache.observations.map((o) =>
    [
      o.seed,
      o.task,
      o.condition,
      o.label,
      o.target,
      numCell(o.fraction),
      String(o.sweepIndex),
      numCell(o.radiusFrac),
      numCell(o.angle),
      String(o.ticks),
      String(o.pop0),
      String(o.finalPop),
      String(o.minPop),
      o.destruction ? '1' : '0',
      o.dipped ? '1' : '0',
      String(o.recoveryTick),
      numCell(o.lateBirths),
      String(o.removed),
      String(o.edges),
      String(o.frozen),
      String(o.components),
      numCell(o.largestFrac),
    ].join(','),
  );
  return [head.join(','), ...rows].join('\n');
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function renderSvg(): string {
  const W = 1120;
  const H = 980;
  const P = 70;
  const panelW = W - 2 * P;
  const colors: Record<string, string> = {
    participation: '#c0392b',
    matched: '#e67e22',
    ageMatched: '#8e44ad',
    random: '#2c3e50',
  };
  const lines: string[] = [];
  lines.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`);
  lines.push('<rect width="100%" height="100%" fill="#ffffff"/>');
  lines.push(
    '<style>text{font-family:system-ui,-apple-system,Segoe UI,sans-serif;fill:#1f2937} .t{font-size:15px;font-weight:600} .s{font-size:12px} .a{font-size:11px;fill:#6b7280}</style>',
  );

  // Panel 1: condition destruction.
  const top = 60;
  const p1h = 380;
  lines.push(`<text x="${P}" y="${top - 22}" class="t">A. Destruction by condition (40% lesion, ${report.seeds.length} seeds)</text>`);
  const conds = [...report.conditions].sort((a, b) => b.destruction - a.destruction);
  const barH = 24;
  const gap = 5;
  const maxBars = conds.length;
  const barMax = Math.min(1, Math.max(0.5, ...conds.map((c) => c.destruction)));
  for (let i = 0; i < maxBars; i++) {
    const c = conds[i]!;
    const y = top + i * (barH + gap);
    const w = (panelW * 0.55 * c.destruction) / barMax;
    lines.push(`<text x="${P}" y="${y + 16}" class="s">${esc(c.name)}</text>`);
    lines.push(`<rect x="${P + 190}" y="${y}" width="${Math.max(0, w)}" height="${barH}" fill="#c0392b" opacity="0.8"/>`);
    lines.push(
      `<text x="${P + 200 + Math.max(0, w)}" y="${y + 16}" class="a">${pct(c.destruction)} (n=${c.n})</text>`,
    );
  }
  lines.push(`<line x1="${P + 190}" y1="${top}" x2="${P + 190}" y2="${top + maxBars * (barH + gap)}" stroke="#d1d5db"/>`);

  // Panel 2: dose response.
  const p2 = top + p1h;
  lines.push(`<text x="${P}" y="${p2 - 18}" class="t">B. Dose response: destruction vs fraction removed</text>`);
  const chartX = P + 80;
  const chartY = p2;
  const chartW = panelW - 120;
  const chartH = 250;
  lines.push(`<rect x="${chartX}" y="${chartY}" width="${chartW}" height="${chartH}" fill="#f9fafb" stroke="#e5e7eb"/>`);
  for (let i = 0; i <= 5; i++) {
    const y = chartY + (chartH * i) / 5;
    lines.push(`<line x1="${chartX}" y1="${y}" x2="${chartX + chartW}" y2="${y}" stroke="#e5e7eb"/>`);
    lines.push(`<text x="${chartX - 34}" y="${y + 4}" class="a">${(1 - i / 5).toFixed(1)}</text>`);
  }
  const maxDose = Math.max(...KS_DOSES);
  for (const target of KS_DOSE_TARGETS) {
    const pts: string[] = [];
    for (const d of report.doses.filter((x) => x.target === target)) {
      const x = chartX + (chartW * d.fraction) / maxDose;
      const y = chartY + chartH * (1 - Math.min(1, d.destruction));
      pts.push(`${x.toFixed(1)},${y.toFixed(1)}`);
      lines.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3.5" fill="${colors[target] ?? '#374151'}"/>`);
    }
    if (pts.length > 1) {
      lines.push(`<polyline points="${pts.join(' ')}" fill="none" stroke="${colors[target] ?? '#374151'}" stroke-width="2"/>`);
    }
    const li = KS_DOSE_TARGETS.indexOf(target);
    const lx = chartX + 12 + li * 160;
    lines.push(`<rect x="${lx}" y="${chartY + chartH + 16}" width="12" height="12" fill="${colors[target] ?? '#374151'}"/>`);
    lines.push(`<text x="${lx + 18}" y="${chartY + chartH + 27}" class="a">${esc(target)}</text>`);
  }
  for (const f of KS_DOSES) {
    const x = chartX + (chartW * f) / maxDose;
    lines.push(`<text x="${x - 12}" y="${chartY + chartH + 48}" class="a">${f.toFixed(2)}</text>`);
  }
  lines.push(`<text x="${chartX + chartW / 2 - 20}" y="${chartY + chartH + 68}" class="a">fraction removed</text>`);

  // Panel 3: location sweep.
  const p3 = p2 + 380;
  lines.push(`<text x="${P}" y="${p3 - 18}" class="t">C. Compact 40% lesion: loss vs distance from centroid</text>`);
  const sX = P + 80;
  const sY = p3;
  const sW = panelW - 120;
  const sH = 220;
  lines.push(`<rect x="${sX}" y="${sY}" width="${sW}" height="${sH}" fill="#f9fafb" stroke="#e5e7eb"/>`);
  const maxLoss = Math.max(0.15, ...report.sweep.map((s) => s.meanLoss));
  for (let i = 0; i <= 4; i++) {
    const y = sY + (sH * i) / 4;
    lines.push(`<line x1="${sX}" y1="${y}" x2="${sX + sW}" y2="${y}" stroke="#e5e7eb"/>`);
    lines.push(`<text x="${sX - 34}" y="${y + 4}" class="a">${((maxLoss * (1 - i / 4)) * 100).toFixed(0)}%</text>`);
  }
  const pts: string[] = [];
  for (const s of report.sweep) {
    const x = sX + sW * Math.min(1, s.radiusFrac / 0.9);
    const y = sY + sH * (1 - Math.max(0, s.meanLoss) / maxLoss);
    pts.push(`${x.toFixed(1)},${y.toFixed(1)}`);
    lines.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3.5" fill="#2563eb"/>`);
  }
  if (pts.length > 1) lines.push(`<polyline points="${pts.join(' ')}" fill="none" stroke="#2563eb" stroke-width="2"/>`);
  lines.push(`<text x="${sX + sW / 2 - 30}" y="${sY + sH + 28}" class="a">radius / colony radius</text>`);
  lines.push(`<text x="${sX + 8}" y="${sY + 18}" class="a">mean loss</text>`);

  lines.push('</svg>');
  return lines.join('\n');
}

mkdirSync(join(OUT, 'plots'), { recursive: true });
writeFileSync(join(OUT, 'kill-switch.md'), renderMd());
writeFileSync(join(OUT, 'kill-switch.csv'), renderCsv());
writeFileSync(
  join(OUT, 'kill-switch.json'),
  JSON.stringify(
    {
      version: CACHE_VERSION,
      generatedAt: cache.generatedAt,
      provenance,
      config: cache.config,
      report,
      observations: cache.observations,
    },
    null,
    2,
  ),
);
writeFileSync(join(OUT, 'plots', 'kill-switch.svg'), renderSvg());

/* ------------------------------------------------------------------ console -- */

console.log('');
console.log(`Experiment C - kill-switch map (${report.seeds.length} seeds, ${report.ticks} ticks)`);
console.log(`viability: ${report.viability.valid ? 'VALID' : 'INVALID'} - ${report.viability.note}`);
for (const c of report.conditions) {
  console.log(
    `  ${c.name.padEnd(18)} destroyed ${pct(c.destruction).padStart(4)}  final/pre ${fmt(c.meanFinalRatio, 2)}  loss ${fmt(
      c.meanLoss,
      2,
    )}  comp ${fmt(c.meanComponents, 0)}  largest ${fmt(c.meanLargestFrac, 2)}`,
  );
}
console.log('dose thresholds: participation ' + (Number.isFinite(report.minKillDose) ? report.minKillDose : 'n/a') + ', random ' + (Number.isFinite(report.randomDose) ? report.randomDose : 'n/a'));
for (const c of report.claims) console.log(`  ${c.id} ${c.verdict}: ${c.detail}`);
console.log(`artifacts: ${join(OUT, 'kill-switch.md')}, .json, .csv, plots/kill-switch.svg`);
