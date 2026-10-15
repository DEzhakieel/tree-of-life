/**
 * Known-systems registry CLI.
 *
 *   npx tsx apps/simulation/src/research/benchmarks/knownRun.ts [--quick]
 *
 * Re-runs every linked benchmark to compute replication fidelity, then writes
 * research/output/known.{md,json} + plots/known.svg. Documents the canonical
 * scientific and platform models the fractal-life engine is measured against.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { barChartCI, colorFor } from '../charts.js';
import type { BenchmarkScale } from './types.js';
import { buildKnownReport } from './knownSystems/index.js';
import type { KnownReport } from './knownSystems/types.js';

const outputDir = fileURLToPath(new URL('../../../research/output/', import.meta.url));
const plotsDir = join(outputDir, 'plots');

interface CliOptions {
  scale: BenchmarkScale;
  outDir: string;
  json: boolean;
  md: boolean;
}

function help(): string {
  return `fractal-life known-systems registry

Usage:
  tsx src/research/benchmarks/knownRun.ts [options]

Options:
  --quick              smaller benchmark budgets for the fidelity re-runs
  -o, --out DIR        output directory (default apps/simulation/research/output)
      --no-json / --no-md   disable individual report formats
  -h, --help           this help
`;
}

function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = { scale: 'full', outDir: outputDir, json: true, md: true };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    const next = (): string => argv[++i]!;
    switch (a) {
      case '--quick':
        opts.scale = 'quick';
        break;
      case '-o':
      case '--out':
        opts.outDir = next();
        break;
      case '--no-json':
        opts.json = false;
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
  return opts;
}

function frac(x: number | undefined): string {
  return x === undefined ? '—' : x.toFixed(2);
}

export function renderKnownReport(report: KnownReport): { md: string; json: string } {
  const lines: string[] = [
    '# Known-systems reverse-engineering registry',
    '',
    `Mode: **${report.scale}** · ${report.scientific} scientific + ${report.platforms} platform systems · ${report.replicated} replicated · mean fidelity **${frac(report.meanFidelity)}** · ${report.totalMs} ms`,
    '',
    'Canonical artificial-life / complex-systems models from the literature and the major ABM platforms, mapped to the executable fractal-life replications. Fidelity is the gated-check pass rate of the linked benchmark; `documented` entries are catalogued but not yet instrumented.',
    '',
    '| id | system | domain | framework | year | status | fidelity | bench |',
    '| --- | --- | --- | --- | ---: | --- | ---: | --- |',
  ];
  for (const e of report.entries) {
    lines.push(
      `| ${e.id} | ${e.name} | ${e.domain} | ${e.framework ?? '—'} | ${e.year} | ${e.status} | ${frac(e.fidelity)} | ${e.benchId ?? '—'} |`,
    );
  }
  for (const domain of ['scientific', 'platform'] as const) {
    lines.push('', `## ${domain === 'scientific' ? 'Scientific' : 'Platform'} systems`, '');
    for (const e of report.entries.filter((x) => x.domain === domain)) {
      lines.push(
        `### ${e.name} — ${e.author} (${e.year})`,
        '',
        `- **demonstrates:** ${e.demonstrates}`,
        `- **reference:** ${e.reference}`,
        `- **replication:** ${e.replication}`,
        `- **notes:** ${e.notes}`,
        '',
      );
    }
  }
  lines.push('## Provenance', '', `- node: \`${process.version}\` (\`${process.platform}/${process.arch}\`)`, `- timestamp: \`${new Date().toISOString()}\``, '');
  return { md: lines.join('\n'), json: JSON.stringify(report, null, 2) };
}

export function renderKnownSvg(report: KnownReport): string {
  const rows = report.entries.filter((e) => e.fidelity !== undefined);
  const labels = rows.map((e) => e.id);
  const means = rows.map((e) => e.fidelity!);
  return barChartCI({
    title: 'Replication fidelity of known systems',
    labels,
    means,
    los: means,
    his: means,
    colors: rows.map((e, i) => colorFor(e.domain + (e.framework ?? ''), e.id.charCodeAt(0) + i)),
    yLabel: 'fidelity',
    height: 300,
  });
}

function main(): void {
  const opts = parseArgs(process.argv.slice(2));
  const report = buildKnownReport(opts.scale);
  mkdirSync(opts.outDir, { recursive: true });
  const { md, json } = renderKnownReport(report);
  if (opts.md) writeFileSync(join(opts.outDir, 'known.md'), md);
  if (opts.json) writeFileSync(join(opts.outDir, 'known.json'), json);
  mkdirSync(plotsDir, { recursive: true });
  writeFileSync(join(plotsDir, 'known.svg'), renderKnownSvg(report));

  for (const e of report.entries) {
    const tag = e.status === 'documented' ? 'documented' : `${e.status} fidelity=${frac(e.fidelity)}`;
    console.log(`[known] ${e.id.padEnd(24)} ${e.domain.padEnd(10)} ${tag}`);
  }
  console.log(`\n${report.replicated}/${report.entries.length} replicated · mean fidelity ${frac(report.meanFidelity)} · ${report.totalMs}ms`);
  console.log(`wrote known.{md,json} + plots/known.svg to ${opts.outDir}`);
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('knownRun.ts')) {
  main();
}
