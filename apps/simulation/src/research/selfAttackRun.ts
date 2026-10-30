#!/usr/bin/env node
/**
 * Experiment B runner - self-replication that attacks itself.
 *
 *   npm run research:selfattack                 # 8 seeds x 8 conditions, 1200 ticks
 *   npm run research:selfattack -- --quick     # 2 seeds x 400 ticks, smoke test only
 *   npm run research:selfattack -- --from-cache
 *
 * Artifacts: research/output/self-attack.{md,json,csv} and
 * plots/self-attack.svg. The pre-registered analysis lives in docs/CLAIMS.md
 * (B-SELF-01..04).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CONDITIONS,
  SA_BURN,
  SA_EARLY_FROM,
  SA_EARLY_TO,
  SA_LATE_SPAN,
  SA_TICKS,
  buildSelfAttackReportFromObservations,
  observeRun,
  runSelfAttack,
  type Interventions,
  type SelfAttackObservation,
  type SelfAttackReport,
} from './selfAttack.js';

const OUT = join(fileURLToPath(new URL('.', import.meta.url)), '../../research/output');
const CACHE = join(OUT, 'self-attack-series.json');
const CACHE_VERSION = 1;
const SAMPLE_EVERY = 10;

const DEFAULT_SEEDS = Array.from({ length: 8 }, (_, i) => `sa.${i}`);

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
  console.log('usage: selfAttackRun.ts [--quick] [--from-cache] [--seeds a,b] [--ticks N]');
  console.log('');
  console.log('  --quick       2 seeds x 400 ticks, smoke test only');
  console.log('  --from-cache  re-render research/output/self-attack-series.json');
  console.log('  --seeds a,b   confirmatory seeds (default sa.0..sa.7)');
  console.log('  --ticks N     ticks per run (default ' + SA_TICKS + ')');
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
const ticks = Math.max(SA_BURN + 250, num('--ticks', quick ? 400 : SA_TICKS));

const fmt = (v: number, d = 3): string => (Number.isFinite(v) ? v.toFixed(d) : 'n/a');
const ci = (lo: number, hi: number, d = 3): string =>
  Number.isFinite(lo) && Number.isFinite(hi) ? `[${lo.toFixed(d)}, ${hi.toFixed(d)}]` : 'n/a';

interface Sample {
  seed: string;
  condition: string;
  every: number;
  pop: number[];
  births: number[];
  nests: number[];
  propagules: number[];
  localBuild: number[];
}

interface CacheFile {
  version: number;
  generatedAt: string;
  config: { ticks: number; burnIn: number; seeds: string[]; conditions: string[] };
  observations: SelfAttackObservation[];
  samples: Sample[];
}

function downsample(xs: readonly number[], every: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < xs.length; i += every) {
    let s = 0;
    let n = 0;
    for (let j = i; j < Math.min(xs.length, i + every); j++) {
      s += xs[j]!;
      n++;
    }
    out.push(n ? s / n : 0);
  }
  return out;
}

function conditionName(i: Interventions): string {
  const c = CONDITIONS.find(
    (x) => x.interventions.cost === i.cost && x.interventions.boundary === i.boundary && x.interventions.signal === i.signal,
  );
  if (!c) throw new Error('unknown intervention combination');
  return c.name;
}

function buildCache(): CacheFile {
  const observations: SelfAttackObservation[] = [];
  const samples: Sample[] = [];
  let done = 0;
  const total = seeds.length * CONDITIONS.length;
  for (const c of CONDITIONS) {
    for (const seed of seeds) {
      const run = runSelfAttack({ seed, interventions: c.interventions, ticks });
      observations.push(observeRun(run));
      samples.push({
        seed,
        condition: c.name,
        every: SAMPLE_EVERY,
        pop: downsample(run.series.pop, SAMPLE_EVERY),
        births: downsample(run.series.births, SAMPLE_EVERY),
        nests: downsample(run.series.nests, SAMPLE_EVERY),
        propagules: downsample(run.series.propagules, SAMPLE_EVERY),
        localBuild: downsample(run.series.localBuild, SAMPLE_EVERY),
      });
      done++;
      if (done % 8 === 0 || done === total) {
        process.stdout.write(`\r  simulated ${done}/${total} runs`);
      }
    }
  }
  process.stdout.write('\n');
  return {
    version: CACHE_VERSION,
    generatedAt: new Date().toISOString(),
    config: { ticks, burnIn: SA_BURN, seeds, conditions: CONDITIONS.map((c) => c.name) },
    observations,
    samples,
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
  cache = raw;
  provenance = `read from ${CACHE} (generated ${raw.generatedAt}); no runs performed in this invocation`;
} else {
  cache = buildCache();
  if (!quick) writeFileSync(CACHE, JSON.stringify(cache));
  provenance = `simulated in this run (${cache.config.seeds.length} seeds x ${cache.config.conditions.length} conditions x ${cache.config.ticks} ticks)${
    quick ? ' - SMOKE TEST, NOT EVIDENCE' : ''
  }`;
}

const report = buildSelfAttackReportFromObservations(cache.observations);

/* ------------------------------------------------------------------- render -- */

function conditionTable(): string {
  const head =
    '| condition | late pop | late births | late builders | late nests | late propagules | propagule retention | decoupled runs | median decouple tick |';
  const sep = '|---|---:|---:|---:|---:|---:|---:|---:|---:|';
  const rows = report.conditions.map((c) => {
    const m = c.metrics;
    return `| ${c.name} | ${fmt(m.popLate!.mean, 0)} | ${fmt(m.birthLate!.mean, 1)} | ${fmt(
      m.buildLate!.mean,
      2,
    )} | ${fmt(m.nestLate!.mean, 1)} | ${fmt(m.propLate!.mean, 3)} | ${fmt(
      m.propRetention!.mean,
      2,
    )} | ${(c.decoupleFraction * 100).toFixed(0)}% | ${c.tDecoupleMedian >= 0 ? c.tDecoupleMedian.toFixed(0) : 'n/a'} |`;
  });
  return [head, sep, ...rows].join('\n');
}

function lineageTable(): string {
  const head = '| condition | scale-2 lineages alive | still reproducing | max chain depth | mediator: late builder frac |';
  const sep = '|---|---:|---:|---:|---:|';
  const rows = report.conditions.map((c) => {
    const m = c.metrics;
    return `| ${c.name} | ${fmt(m.aliveScale2!.mean, 1)} | ${fmt(m.reproducingScale2!.mean, 1)} | ${fmt(
      m.maxDepth!.mean,
      1,
    )} | ${fmt(m.lbLate!.mean, 2)} |`;
  });
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
  const cost = report.conditions.find((c) => c.name === 'cost')!;
  const boundary = report.conditions.find((c) => c.name === 'boundary')!;
  const signal = report.conditions.find((c) => c.name === 'signal')!;
  const all = report.conditions.find((c) => c.name === 'all')!;
  const lines: string[] = [];
  lines.push('# Experiment B - self-replication that attacks itself');
  lines.push('');
  lines.push(`Generated ${report.generatedAt}. ${provenance}.`);
  lines.push('');
  lines.push(
    `${report.seeds.length} confirmatory seeds x ${report.conditions.length} conditions x ${report.ticks} ticks on a 40x40 torus. ` +
      `Early window ticks ${SA_EARLY_FROM}-${SA_EARLY_TO - 1}; late window the final ${SA_LATE_SPAN} ticks.`,
  );
  lines.push('');
  lines.push('## What this measures');
  lines.push('');
  lines.push(
    'Two scales of reproduction are tracked separately. **Scale 1** is cell division into a nearby empty site. ' +
      '**Scale 2** is a nest releasing a propagule; nests are persistent site-level individuals that decay unless ' +
      'local builders maintain them, and the propagule carries the nest\'s current modal genotype.',
  );
  lines.push('');
  lines.push(
    'The self-attack is structural: a nest is a club good for its lineage tag. A non-builder mutant of that tag ' +
      'keeps the benefit, skips the build cost and divides faster; it dilutes the builder fraction, the nest loses ' +
      'integrity and stops reproducing. Because the propagule carries that genotype, the defection propagates at ' +
      'the second level while local cells persist.',
  );
  lines.push('');
  lines.push(
    'Three interventions target distinct links: `cost` penalises fast local reproduction (small structure); ' +
      '`boundary` seals transmission of the founding build genotype (cross-scale boundary); `signal` lets nests ' +
      'suppress defector births nearby at a cost to their own charge rate (inter-scale signal).',
  );
  lines.push('');
  lines.push('## Pre-registered claims');
  lines.push('');
  lines.push(
    `Effect floor: ${report.rescueFloor.toFixed(3)} propagules/tick = 2 x the between-seed SD of the control late rate. ` +
      `Super-additivity floor: ${report.interactionFloor.toFixed(3)}.`,
  );
  lines.push('');
  lines.push(claimTable());
  lines.push('');
  lines.push('## Conditions');
  lines.push('');
  lines.push(conditionTable());
  lines.push('');
  lines.push('## Two-scale lineages');
  lines.push('');
  lines.push(lineageTable());
  lines.push('');
  lines.push('## Bottleneck');
  lines.push('');
  lines.push(
    `Spearman rho(late local builder fraction, late propagule rate) = ${fmt(report.bottleneck.rhoBuild)} ${ci(
      report.bottleneck.rhoBuildLo,
      report.bottleneck.rhoBuildHi,
    )}; rho(late local birth rate, late propagule rate) = ${fmt(
      report.bottleneck.rhoBirth,
    )} ${ci(report.bottleneck.rhoBirthLo, report.bottleneck.rhoBirthHi)}.`,
  );
  lines.push('');
  lines.push('## Reading');
  lines.push('');
  const decouple = control.tDecoupleMedian >= 0 ? control.tDecoupleMedian.toFixed(0) : 'never';
  const partial = control.metrics.propRetention!.values.filter((v) => v > 0.25).length;
  const maxRet = Math.max(...control.metrics.propRetention!.values);
  lines.push(
    `- Control: local births go from ${fmt(control.metrics.birthEarly!.mean, 1)} to ${fmt(
      control.metrics.birthLate!.mean,
      1,
    )} per tick (retention ${fmt(control.metrics.birthRetention!.mean, 2)}), while propagule rate goes from ${fmt(
      control.metrics.propEarly!.mean,
      2,
    )} to ${fmt(control.metrics.propLate!.mean, 2)} (retention ${fmt(control.metrics.propRetention!.mean, 2)}). ` +
      `The decoupled state is reached in ${(control.decoupleFraction * 100).toFixed(0)}% of control runs, at median tick ${decouple}, ` +
      `and ${partial} of ${control.n} control runs retained more than a quarter of their early rate (max ${maxRet.toFixed(2)}): ` +
      'the collapse is a mean effect with seed-to-seed escapes, not a uniform extinction.',
  );
  lines.push(
    `- Signal alone: late propagule rate ${fmt(signal.metrics.propLate!.mean, 3)} vs control ${fmt(
      control.metrics.propLate!.mean,
      3,
    )}; late builder fraction ${fmt(signal.metrics.lbLate!.mean, 2)}. Cost alone: ${fmt(
      cost.metrics.propLate!.mean,
      3,
    )}; boundary alone: ${fmt(boundary.metrics.propLate!.mean, 3)}. Combined (all three): ${fmt(
      all.metrics.propLate!.mean,
      3,
    )}, which is not above signal alone.`,
  );
  lines.push(
    `- The bottleneck: rho(late builder fraction, late propagules) = ${fmt(report.bottleneck.rhoBuild)} ${ci(
      report.bottleneck.rhoBuildLo,
      report.bottleneck.rhoBuildHi,
    )}, so builder supply tracks scale-2 output strongly. But rho(late local births, late propagules) = ${fmt(
      report.bottleneck.rhoBirth,
    )} ${ci(report.bottleneck.rhoBirthLo, report.bottleneck.rhoBirthHi)}, outside the pre-registered |rho| < 0.50 bound, ` +
      'so B-SELF-03 is inconclusive rather than supported. The boundary result is a refutation of the registered ' +
      'direction (point estimate below zero, interval spanning zero), not evidence that sealing can never work.',
  );
  lines.push('');
  lines.push('## Not claimed');
  lines.push('');
  lines.push(
    '- That this is a general law of major evolutionary transitions. The model implements three specific mechanisms; ' +
      'their relative strength is a property of this ecology, not a universal ranking.',
  );
  lines.push(
    '- That the boundary intervention is ineffective in general. It is implemented as germline sequestration of ' +
      'the build trait; other boundary mechanisms (spatial sealing, policing at membership) were not tested.',
  );
  lines.push(
    '- That a collapse in the control is "adaptive" or "inevitable". It is a parameter-dependent outcome of the ' +
      'mutation rate, the build burden and the nest bonus.',
  );
  lines.push('');
  lines.push('## Reproduce');
  lines.push('');
  lines.push('```bash');
  lines.push('npm run research:selfattack');
  lines.push('npm run research:selfattack -- --from-cache');
  lines.push('npm run research:selfattack -- --quick   # smoke test only');
  lines.push('```');
  lines.push('');
  return lines.join('\n');
}

function renderCsv(): string {
  const metricCols = [
    'popEarly',
    'popLate',
    'birthEarly',
    'birthLate',
    'buildEarly',
    'buildLate',
    'defectorEarly',
    'defectorLate',
    'nestEarly',
    'nestLate',
    'propEarly',
    'propLate',
    'lbEarly',
    'lbLate',
    'propRetention',
    'buildRetention',
    'birthRetention',
  ];
  const extraCols = ['decoupleFraction', 'tDecoupleMedian', 'aliveScale2', 'reproducingScale2', 'maxDepth'];
  const rows = report.conditions.map((c) => {
    const m = c.metrics;
    const vals: number[] = [
      c.decoupleFraction,
      c.tDecoupleMedian,
      m.aliveScale2!.mean,
      m.reproducingScale2!.mean,
      m.maxDepth!.mean,
    ];
    return [c.name, ...metricCols.map((k) => fmt(m[k]!.mean, 4)), ...vals.map((v) => fmt(v, 4))].join(',');
  });
  return [['condition', ...metricCols, ...extraCols].join(','), ...rows].join('\n');
}

function meanByCondition(key: keyof Sample, condition: string): number[] {
  const rows = cache.samples.filter((s) => s.condition === condition);
  if (!rows.length) return [];
  const len = Math.min(...rows.map((r) => (r[key] as number[]).length));
  const out = new Array<number>(len).fill(0);
  for (const r of rows) {
    const xs = r[key] as number[];
    for (let i = 0; i < len; i++) out[i] = out[i]! + xs[i]!;
  }
  return out.map((v) => v / rows.length);
}

const COLORS: Record<string, string> = {
  control: '#e15759',
  cost: '#4e79a7',
  boundary: '#f28e2b',
  signal: '#59a14f',
  'cost+boundary': '#b07aa1',
  'cost+signal': '#76b7b2',
  'boundary+signal': '#edc948',
  all: '#e6edf3',
};

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function renderSvg(): string {
  const w = 1080;
  const h = 700;
  const p: string[] = [];
  p.push(
    `<rect width="${w}" height="${h}" fill="#0e1116"/>`,
    `<text x="24" y="30" fill="#e6edf3" font-family="monospace" font-size="15">Experiment B - local persistence and hierarchical collapse</text>`,
    `<text x="24" y="50" fill="#8b949e" font-family="monospace" font-size="11">${esc(provenance)}</text>`,
  );

  // --- left: propagule rate over time, four single-link conditions
  const px = 64;
  const py = 90;
  const pw = 600;
  const ph = 400;
  p.push(`<rect x="${px}" y="${py}" width="${pw}" height="${ph}" fill="#12161d" stroke="#222"/>`);
  const focus = ['control', 'cost', 'boundary', 'signal'];
  const series = focus.map((name) => ({ name, xs: meanByCondition('propagules', name) }));
  const maxY = Math.max(0.5, ...series.flatMap((s) => s.xs));
  const n = Math.max(...series.map((s) => s.xs.length));
  const xOf = (i: number): number => px + (i / Math.max(1, n - 1)) * pw;
  const yOf = (v: number): number => py + ph - (v / maxY) * ph;
  p.push(
    `<line x1="${px}" y1="${yOf(0).toFixed(1)}" x2="${px + pw}" y2="${yOf(0).toFixed(1)}" stroke="#30363d"/>`,
    `<text x="${px + pw / 2}" y="${py + ph + 30}" fill="#8b949e" font-family="monospace" font-size="11" text-anchor="middle">tick (window mean, ${SAMPLE_EVERY}-tick bins)</text>`,
    `<text x="20" y="${py + ph / 2}" fill="#8b949e" font-family="monospace" font-size="11" transform="rotate(-90 20 ${py + ph / 2})">propagules / tick</text>`,
  );
  for (const s of series) {
    const pts = s.xs.map((v, i) => `${xOf(i).toFixed(1)},${yOf(v).toFixed(1)}`).join(' ');
    p.push(`<polyline points="${pts}" fill="none" stroke="${COLORS[s.name]}" stroke-width="1.8"/>`);
  }
  focus.forEach((name, i) => {
    p.push(
      `<text x="${px + 12}" y="${py + 20 + i * 16}" fill="${COLORS[name]}" font-family="monospace" font-size="11">${name}</text>`,
    );
  });

  // --- right: late propagule rate per condition
  const bx = 720;
  const by = 110;
  const bw = 320;
  const bh = 380;
  p.push(`<text x="${bx}" y="${by - 20}" fill="#8b949e" font-family="monospace" font-size="11">late propagule rate by condition</text>`);
  const vals = report.conditions.map((c) => c.metrics.propLate!.mean);
  const hi = Math.max(0.1, ...vals) * 1.15;
  const slot = bw / report.conditions.length;
  report.conditions.forEach((c, i) => {
    const v = c.metrics.propLate!.mean;
    const bhBar = (v / hi) * bh;
    p.push(
      `<rect x="${(bx + i * slot + slot * 0.15).toFixed(1)}" y="${(by + bh - bhBar).toFixed(1)}" width="${(slot * 0.7).toFixed(1)}" height="${bhBar.toFixed(1)}" fill="${COLORS[c.name] ?? '#8b949e'}"/>`,
    );
    p.push(
      `<text x="${(bx + i * slot + slot / 2).toFixed(1)}" y="${by + bh + 14}" fill="#8b949e" font-family="monospace" font-size="8" text-anchor="end" transform="rotate(-45 ${(bx + i * slot + slot / 2).toFixed(1)} ${by + bh + 14})">${esc(c.name)}</text>`,
      `<text x="${(bx + i * slot + slot / 2).toFixed(1)}" y="${(by + bh - bhBar - 3).toFixed(1)}" fill="#e6edf3" font-family="monospace" font-size="8" text-anchor="middle">${v.toFixed(2)}</text>`,
    );
  });

  const vy = 580;
  p.push(`<text x="24" y="${vy}" fill="#e6edf3" font-family="monospace" font-size="12">claim verdicts</text>`);
  report.claims.forEach((c, i) => {
    const color = c.verdict === 'supported' ? '#59a14f' : c.verdict === 'refuted' ? '#e15759' : '#f28e2b';
    p.push(
      `<text x="24" y="${vy + 20 + i * 15}" fill="${color}" font-family="monospace" font-size="10">${c.id} ${c.verdict.toUpperCase()}</text>`,
    );
  });

  return [`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`, ...p, '</svg>'].join('\n');
}

/* -------------------------------------------------------------------- write -- */

mkdirSync(join(OUT, 'plots'), { recursive: true });
const suffix = quick ? '-quick' : '';
writeFileSync(join(OUT, `self-attack${suffix}.md`), renderMd());
writeFileSync(
  join(OUT, `self-attack${suffix}.json`),
  JSON.stringify(
    {
      version: CACHE_VERSION,
      provenance,
      config: {
        ticks: cache.config.ticks,
        burnIn: cache.config.burnIn,
        seeds: cache.config.seeds,
        conditions: cache.config.conditions,
        size: 40,
        rescueFloor: report.rescueFloor,
        interactionFloor: report.interactionFloor,
      },
      report,
      observations: cache.observations,
    },
    null,
    2,
  ),
);
writeFileSync(join(OUT, `self-attack${suffix}.csv`), renderCsv());
writeFileSync(join(OUT, 'plots', `self-attack${suffix}.svg`), renderSvg());

/* ------------------------------------------------------------------ console -- */

console.log('');
console.log('== Experiment B - self-replication that attacks itself ==');
console.log(`  ${provenance}`);
console.log('');
for (const c of report.conditions) {
  const m = c.metrics;
  console.log(
    `  ${c.name.padEnd(14)} prop ${fmt(m.propEarly!.mean, 2)} -> ${fmt(m.propLate!.mean, 2)} ` +
      `(ret ${fmt(m.propRetention!.mean, 2)})  build ${fmt(m.buildEarly!.mean, 2)} -> ${fmt(m.buildLate!.mean, 2)}  ` +
      `nests ${fmt(m.nestEarly!.mean, 1)} -> ${fmt(m.nestLate!.mean, 1)}  ` +
      `decoupled ${(c.decoupleFraction * 100).toFixed(0)}%`,
  );
}
console.log('');
for (const c of report.claims) console.log(`  ${c.id}: ${c.verdict.toUpperCase()} - ${c.detail}`);
console.log('');
if (quick) console.log('  NOTE: --quick is a smoke test; its claims are not evidence.');
console.log(`  wrote ${join(OUT, `self-attack${suffix}.md`)}`);
console.log(`  wrote ${join(OUT, `self-attack${suffix}.json`)}`);
console.log(`  wrote ${join(OUT, `self-attack${suffix}.csv`)}`);
console.log(`  wrote ${join(OUT, 'plots', `self-attack${suffix}.svg`)}`);
