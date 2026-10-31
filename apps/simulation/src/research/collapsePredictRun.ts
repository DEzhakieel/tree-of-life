#!/usr/bin/env node
/**
 * Experiment D runner - collapse prediction on unseen rules and parameters.
 *
 *   npm run research:collapse                 # 24 conditions, 192 runs, ~25 min
 *   npm run research:collapse -- --quick     # 4 conditions, 2 runs, smoke only
 *   npm run research:collapse -- --from-cache
 *   npm run research:collapse -- --seeds d.p0,d.p1 --conditions all
 *
 * The cache is append-only JSONL, so an interrupted campaign resumes with the
 * same command instead of starting over. `--fresh` discards it.
 *
 * Artifacts: research/output/collapse-predict.{md,json,csv} and
 * research/output/collapse-predict-cache.jsonl. Pre-registered claims live in
 * docs/CLAIMS.md (D-PRED-01..05).
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CP_CONDITIONS,
  CP_EARLY_FROM,
  CP_EARLY_TO,
  CP_LATE_FROM,
  CP_LATE_TO,
  CP_TICKS,
  CP_TRAIN_SEEDS,
  CP_TEST_SEEDS,
  buildCollapseReport,
  renderCollapseMarkdown,
  reportToCsv,
  runCollapseCondition,
  type CollapseCondition,
  type CollapseRun,
  type CollapseReport,
} from './collapsePredict.js';

const OUT = join(fileURLToPath(new URL('.', import.meta.url)), '../../research/output');
const CACHE_VERSION = 1;

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
const list = (raw: string): string[] => raw.split(',').map((s) => s.trim()).filter(Boolean);

if (has('--help')) {
  console.log('usage: collapsePredictRun.ts [--quick] [--pilot] [--from-cache] [--fresh] [--seeds a,b] [--train-seeds a,b] [--test-seeds a,b] [--conditions train|test|all] [--ticks N]');
  console.log('');
  console.log('  --quick        4 conditions x 1 seed, smoke test only');
  console.log('  --pilot        all conditions on pilot seeds d.p0..d.p2, exploratory only');
  console.log('  --from-cache   re-render the selected cache');
  console.log('  --fresh        delete the cache and start the campaign over');
  console.log('  --seeds a,b    use the same seeds on both splits (pilot only)');
  console.log('  --train-seeds  default ' + CP_TRAIN_SEEDS.join(','));
  console.log('  --test-seeds   default ' + CP_TEST_SEEDS.join(','));
  console.log('  --conditions   train | test | all (default all)');
  console.log('  --ticks N      ticks per run (default ' + CP_TICKS + ')');
  process.exit(0);
}

const quick = has('--quick');
const pilot = has('--pilot');
const fromCache = has('--from-cache');
const fresh = has('--fresh');
// A smoke run must never contaminate (or be mistaken for) the registered
// campaign, so it gets its own append-only cache and its own artifacts. The
// same applies to exploratory pilot runs.
const CACHE = join(
  OUT,
  quick
    ? 'collapse-predict-quick-cache.jsonl'
    : pilot
      ? 'collapse-predict-pilot-cache.jsonl'
      : 'collapse-predict-cache.jsonl',
);
const SUFFIX = quick ? '-quick' : pilot ? '-pilot' : '';
const ticks = Math.max(CP_LATE_TO, num('--ticks', CP_TICKS));
const seedOverride = str('--seeds', '');
const quickTrain = ['d.q0'];
const quickTest = ['d.q1'];
const pilotSeeds = ['d.p0', 'd.p1', 'd.p2'];
const trainSeeds = seedOverride
  ? list(seedOverride)
  : quick
    ? quickTrain
    : pilot
      ? pilotSeeds
      : list(str('--train-seeds', CP_TRAIN_SEEDS.join(',')));
const testSeeds = seedOverride
  ? list(seedOverride)
  : quick
    ? quickTest
    : pilot
      ? pilotSeeds
      : list(str('--test-seeds', CP_TEST_SEEDS.join(',')));
const which = str('--conditions', 'all');

const quickConditions = ['clonal.P0', 'legacy.P6', 'elevated.P0', 'clonal.P3'];
const allConditions = CP_CONDITIONS.filter((c) =>
  which === 'all' ? true : which === 'train' ? c.split === 'train' : c.split === 'test',
);
const conditions: CollapseCondition[] = quick
  ? CP_CONDITIONS.filter((c) => quickConditions.includes(c.id)).map((c) => ({
      ...c,
      // quick uses one fresh seed on each split; the condition split is unchanged
      split: quickConditions.indexOf(c.id) < 2 ? 'train' : 'test',
    }))
  : allConditions;

const config = {
  version: CACHE_VERSION,
  ticks,
  earlyFrom: CP_EARLY_FROM,
  earlyTo: CP_EARLY_TO,
  lateFrom: CP_LATE_FROM,
  lateTo: CP_LATE_TO,
  trainSeeds,
  testSeeds,
  conditions: conditions.map((c) => c.id),
};

interface CacheHeader {
  kind: 'config';
  generatedAt: string;
  config: typeof config;
}
interface CacheRun {
  kind: 'run';
  run: CollapseRun;
}

function loadCache(): { header: CacheHeader; runs: CollapseRun[] } | null {
  if (!existsSync(CACHE)) return null;
  const lines = readFileSync(CACHE, 'utf8').split('\n').filter(Boolean);
  if (lines.length === 0) return null;
  let header: CacheHeader | null = null;
  const runs: CollapseRun[] = [];
  for (const line of lines) {
    const rec = JSON.parse(line) as CacheHeader | CacheRun;
    if (rec.kind === 'config') header = rec;
    else if (rec.kind === 'run') runs.push(rec.run);
  }
  if (!header) return null;
  const same = JSON.stringify(header.config) === JSON.stringify(config);
  if (!same) {
    throw new Error(
      `cache config does not match this invocation; use --fresh to discard it or match the original seeds/conditions/ticks\n` +
        `  cache: ${JSON.stringify(header.config)}\n  now:   ${JSON.stringify(config)}`,
    );
  }
  return { header, runs };
}

function writeArtifacts(report: CollapseReport, suffix = ''): string[] {
  mkdirSync(OUT, { recursive: true });
  const base = join(OUT, `collapse-predict${suffix}`);
  const banner =
    suffix === '-quick'
      ? '> **SMOKE TEST, NOT EVIDENCE.** Four runs on two smoke seeds; the model is not fitted to a usable sample.\n\n'
      : suffix === '-pilot'
        ? '> **EXPLORATORY PILOT, NOT EVIDENCE.** Pilot seeds were used to choose the grid; the confirmatory split uses fresh seeds.\n\n'
        : '';
  writeFileSync(`${base}.json`, JSON.stringify({ ...report, evidence: suffix === '' }, null, 2));
  writeFileSync(`${base}.csv`, reportToCsv(report));
  writeFileSync(`${base}.md`, banner + renderCollapseMarkdown(report));
  return [`${base}.json`, `${base}.csv`, `${base}.md`];
}

function printSummary(report: CollapseReport): void {
  const full = report.models.find((m) => m.name === 'full')!;
  const pop = report.models.find((m) => m.name === 'population')!;
  const entropy = report.models.find((m) => m.name === 'entropy')!;
  const fmt = (v: number, d = 3): string => (Number.isFinite(v) ? v.toFixed(d) : 'n/a');
  console.log('');
  console.log(
    `full AUC ${fmt(full.metrics.auc)} [${fmt(full.aucCi.lo)}, ${fmt(full.aucCi.hi)}]  ` +
      `population ${fmt(pop.metrics.auc)}  entropy ${fmt(entropy.metrics.auc)}  ` +
      `Brier skill ${fmt(full.metrics.brierSkill)}  ECE ${fmt(full.metrics.ece)}`,
  );
  for (const c of report.claims) console.log(`${c.id}  ${c.verdict.padEnd(12)} ${c.detail}`);
}

let header: CacheHeader;
let runs: CollapseRun[];

if (fromCache) {
  const cache = loadCache();
  if (!cache) throw new Error(`no cache at ${CACHE}; run without --from-cache first`);
  header = cache.header;
  runs = cache.runs;
  console.log(`read ${runs.length} runs from ${CACHE} (generated ${header.generatedAt}); no runs performed in this invocation`);
  const report = buildCollapseReport(runs);
  const files = writeArtifacts(report, SUFFIX);
  printSummary(report);
  const label =
    quick ? 'SMOKE TEST, NOT EVIDENCE.' : pilot ? 'EXPLORATORY PILOT, NOT EVIDENCE.' : '';
  console.log(`${label ? label + ' ' : ''}written: ${files.join(', ')}`);
} else {
  if (fresh && existsSync(CACHE)) {
    writeFileSync(CACHE, '');
  }
  const cache = existsSync(CACHE) ? loadCache() : null;
  if (cache) {
    header = cache.header;
    runs = cache.runs;
    console.log(`resumed ${runs.length} cached runs; remaining runs simulated in this invocation`);
  } else {
    header = { kind: 'config', generatedAt: new Date().toISOString(), config };
    runs = [];
    mkdirSync(OUT, { recursive: true });
    writeFileSync(CACHE, JSON.stringify(header) + '\n');
  }

  const done = new Set(runs.map((r) => `${r.condition}|${r.seed}`));
  const plan: { condition: CollapseCondition; seed: string }[] = [];
  for (const condition of conditions) {
    const seeds = condition.split === 'train' ? trainSeeds : testSeeds;
    for (const seed of seeds) {
      if (!done.has(`${condition.id}|${seed}`)) plan.push({ condition, seed });
    }
  }
  const total = conditions.reduce(
    (sum, c) => sum + (c.split === 'train' ? trainSeeds.length : testSeeds.length),
    0,
  );
  let index = 0;
  const t0 = Date.now();
  for (const job of plan) {
    const run = runCollapseCondition(job.condition, job.seed, ticks);
    runs.push(run);
    appendFileSync(CACHE, JSON.stringify({ kind: 'run', run } satisfies CacheRun) + '\n');
    index++;
    if (index % 4 === 0 || index === plan.length) {
      const elapsed = (Date.now() - t0) / 1000;
      const rate = index / Math.max(1e-9, elapsed);
      const remaining = plan.length - index;
      process.stdout.write(
        `\r  simulated ${index}/${plan.length} (${runs.length}/${total} recorded, ${rate.toFixed(2)} runs/s, ~${Math.ceil(remaining / Math.max(1e-9, rate))}s left)   `,
      );
    }
  }
  if (plan.length) process.stdout.write('\n');
  if (quick) {
    // A smoke run must never overwrite the registered artifacts.
    const report = buildCollapseReport(runs);
    const files = writeArtifacts(report, SUFFIX);
    printSummary(report);
    console.log(`SMOKE TEST, NOT EVIDENCE. written: ${files.join(', ')}`);
  } else {
    const report = buildCollapseReport(runs);
    const files = writeArtifacts(report, SUFFIX);
    printSummary(report);
    const label = pilot ? 'EXPLORATORY PILOT, NOT EVIDENCE. ' : '';
    console.log(`${label}written: ${files.join(', ')}`);
  }
}
