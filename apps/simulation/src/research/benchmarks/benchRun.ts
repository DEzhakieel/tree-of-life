/**
 * Benchmark-suite CLI.
 *
 *   npx tsx apps/simulation/src/research/benchmarks/benchRun.ts [--quick]
 *
 * Runs the canonical A–J models over the fixed seed cohort, applies the
 * literature-defined acceptance checks with bootstrap-CI gating, and writes
 * research/output/bench.{md,json,csv} + plots/bench.svg. Follows the same
 * report conventions as radarRun/atlasRun: deterministic, self-contained,
 * provenance-stamped.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { barChartCI, colorFor } from '../charts.js';
import { BENCH_SEEDS, runAllBenchmarks } from './harness.js';
import { BENCHMARK_MODELS } from './models/index.js';
import type { BenchmarkScale, BenchResult, BenchScorecard } from './types.js';

const outputDir = fileURLToPath(new URL('../../../research/output/', import.meta.url));
const plotsDir = join(outputDir, 'plots');

interface CliOptions {
  scale: BenchmarkScale;
  seeds: string[];
  outDir: string;
  json: boolean;
  csv: boolean;
  md: boolean;
}

function help(): string {
  return `fractal-life benchmark suite (A–J)

Usage:
  tsx src/research/benchmarks/benchRun.ts [options]

Options:
  --quick              smaller model budgets (fast dev run; looser by design)
  -n, --seeds N        use the first N canonical seeds (default all)
      --seed S         add a single seed (repeatable)
  -o, --out DIR        output directory (default apps/simulation/research/output)
      --no-json / --no-csv / --no-md   disable individual report formats
  -h, --help           this help

Models: ${BENCHMARK_MODELS.map((m) => `${m.id}=${m.name}`).join(', ')}
`;
}

function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = {
    scale: 'full',
    seeds: [...BENCH_SEEDS],
    outDir: outputDir,
    json: true,
    csv: true,
    md: true,
  };
  const custom: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    const next = (): string => argv[++i]!;
    switch (a) {
      case '--quick':
        opts.scale = 'quick';
        break;
      case '-n':
      case '--seeds':
        opts.seeds = BENCH_SEEDS.slice(0, parseInt(next(), 10));
        break;
      case '--seed':
        custom.push(next());
        break;
      case '-o':
      case '--out':
        opts.outDir = next();
        break;
      case '--no-json':
        opts.json = false;
        break;
      case '--no-csv':
        opts.csv = false;
        break;
      case '--no-md':
        opts.md = false;
        break;
      case '-h':
      case '--help':
        console.log(help());
        process.exit(0);
        break;
      default:
        console.error(`unknown option: ${a}`);
        process.exit(2);
    }
  }
  if (custom.length) opts.seeds = custom;
  return opts;
}

function fmt(x: number): string {
  if (Number.isNaN(x)) return 'NaN';
  if (!Number.isFinite(x)) return x > 0 ? 'inf' : '-inf';
  return x.toFixed(3);
}

function checkCell(r: BenchResult): string {
  return r.checks
    .map((c) => `${c.gate ? '' : '~'}${c.key}:${c.pass ? 'ok' : 'X'}(${fmt(c.observed)})`)
    .join(' ');
}

export function renderBenchReport(card: BenchScorecard): { md: string; json: string; csv: string } {
  const sigKeys = [...new Set(card.results.flatMap((r) => Object.keys(r.signature)))];
  const lines: string[] = [
    '# Benchmark suite — canonical A-Life signatures',
    '',
    `Mode: **${card.scale}** · seeds: ${card.seeds.length} (${card.seeds.join(', ')}) · overall: **${card.pass ? 'PASS' : 'FAIL'}** · ${card.totalMs} ms`,
    '',
    'Each benchmark is a self-contained deterministic micro-model validated against a literature-defined signature. Gated checks are CI-bound across seeds for stochastic models (a "should happen" check requires the CI lower bound to clear the threshold; a "should not happen" check the upper bound). `~` marks informational checks.',
    '',
    '| ID | model | family | verdict | fidelity | determinism | seeds | ms |',
    '| --- | --- | --- | --- | ---: | --- | ---: | ---: |',
  ];
  for (const r of card.results) {
    lines.push(
      `| ${r.id} | ${r.name} | ${r.family} | ${r.verdict} | ${r.fidelity.toFixed(2)} | ${r.determinism ? 'PASS' : 'FAIL'} | ${r.seeds} | ${r.elapsedMs} |`,
    );
  }
  lines.push('', '## Signatures', '', '| ID | ' + sigKeys.join(' | ') + ' |', '| --- |' + sigKeys.map(() => ' ---:').join('') + ' |');
  for (const r of card.results) {
    lines.push(`| ${r.id} | ` + sigKeys.map((k) => fmt(r.signature[k] ?? NaN)).join(' | ') + ' |');
  }
  lines.push('', '## Checks', '');
  for (const r of card.results) {
    lines.push(`### ${r.id} — ${r.name} (${r.verdict})`, '', '| check | test | threshold | observed | ci95 | pass | note |', '| --- | --- | --- | ---: | --- | --- | --- |');
    for (const c of r.checks) {
      const thr = Array.isArray(c.threshold) ? `[${fmt(c.threshold[0])}, ${fmt(c.threshold[1])}]` : fmt(c.threshold);
      lines.push(
        `| ${c.gate ? '' : '~'}${c.key} | ${c.test} | ${thr} | ${fmt(c.observed)} | [${fmt(c.ci[0])}, ${fmt(c.ci[1])}] | ${c.pass ? 'yes' : 'no'} | ${c.note} |`,
      );
    }
    lines.push('');
  }
  lines.push('## Provenance', '', `- node: \`${process.version}\` (\`${process.platform}/${process.arch}\`)`, `- timestamp: \`${new Date().toISOString()}\``, '');
  return { md: lines.join('\n'), json: JSON.stringify(card, null, 2), csv: benchToCsv(card, sigKeys) };
}

function benchToCsv(card: BenchScorecard, sigKeys: string[]): string {
  const headers = ['id', 'name', 'family', 'stochastic', 'seeds', 'verdict', 'determinism', 'fidelity', 'elapsedMs', ...sigKeys.map((k) => `sig.${k}`)];
  const rows = [headers.join(',')];
  for (const r of card.results) {
    rows.push(
      [
        r.id,
        `"${r.name}"`,
        `"${r.family}"`,
        r.stochastic ? 1 : 0,
        r.seeds,
        r.verdict,
        r.determinism ? 1 : 0,
        r.fidelity,
        r.elapsedMs,
        ...sigKeys.map((k) => (r.signature[k] ?? '')),
      ].join(','),
    );
  }
  return rows.join('\n') + '\n';
}

export function renderBenchSvg(card: BenchScorecard): string {
  const labels = card.results.map((r) => r.id);
  const means = card.results.map((r) => r.fidelity);
  return barChartCI({
    title: 'Benchmark fidelity by model (gated checks passed)',
    labels,
    means,
    los: means,
    his: means,
    colors: card.results.map((r) => colorFor(r.family, r.id.charCodeAt(0))),
    yLabel: 'fidelity',
    height: 320,
  });
}

export function summarize(card: BenchScorecard): void {
  for (const r of card.results) {
    const failed = r.checks.filter((c) => c.gate && !c.pass).map((c) => c.key);
    console.log(
      `[${r.id}] ${r.verdict.padEnd(4)} fidelity=${r.fidelity.toFixed(2)} det=${r.determinism ? 'PASS' : 'FAIL'} ${failed.length ? `failed: ${failed.join(',')}` : ''} (${r.elapsedMs}ms)`,
    );
  }
  console.log(`overall: ${card.pass ? 'PASS' : 'FAIL'} in ${card.totalMs}ms`);
}

function main(): void {
  const opts = parseArgs(process.argv.slice(2));
  const card = runAllBenchmarks(BENCHMARK_MODELS, { scale: opts.scale, seeds: opts.seeds });
  mkdirSync(opts.outDir, { recursive: true });
  const { md, json, csv } = renderBenchReport(card);
  if (opts.md) writeFileSync(join(opts.outDir, 'bench.md'), md);
  if (opts.json) writeFileSync(join(opts.outDir, 'bench.json'), json);
  if (opts.csv) writeFileSync(join(opts.outDir, 'bench.csv'), csv);
  mkdirSync(plotsDir, { recursive: true });
  writeFileSync(join(plotsDir, 'bench.svg'), renderBenchSvg(card));
  summarize(card);
  console.log(`\nwrote bench.{md,json,csv} + plots/bench.svg to ${opts.outDir}`);
  if (!card.pass) process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('benchRun.ts')) {
  main();
}
