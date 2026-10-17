#!/usr/bin/env node
/**
 * Life-organization CLI.
 *
 * Runs the TS reference engine in a legacy arm and a full-substrate arm, reads
 * each through the shared O0..O9 organization detector, and writes
 * research/output/lifeorg.{md,json,csv} plus plots/lifeorg.svg.
 */
import { LIFE_LEVELS } from '@fractal-life/shared';
import {
  LIFE_SEEDS,
  LIFE_SPAWN,
  LIFE_TICKS,
  LIFE_SAMPLE_EVERY,
  runLifeReport,
  writeLifeReport,
  type LifeReport,
} from './lifeOrganization.js';

const argv = process.argv.slice(2);

const num = (flag: string, fallback: number): number => {
  const i = argv.indexOf(flag);
  if (i < 0 || i + 1 >= argv.length) return fallback;
  const v = Number(argv[i + 1]);
  return Number.isFinite(v) ? v : fallback;
};

const str = (flag: string, fallback: string): string => {
  const i = argv.indexOf(flag);
  if (i < 0 || i + 1 >= argv.length) return fallback;
  return argv[i + 1];
};

if (argv.includes('--help')) {
  console.log('usage: lifeRun.ts [--ticks N] [--spawn N] [--seeds a,b,c] [--every N] [--quick]');
  console.log('');
  console.log('  --ticks N       run length per seed (default ' + LIFE_TICKS + ')');
  console.log('  --spawn N       founders per seed (default ' + LIFE_SPAWN + ')');
  console.log('  --seeds a,b,c   seeds to map (default ' + LIFE_SEEDS.join(',') + ')');
  console.log('  --every N       sample period in ticks (default ' + LIFE_SAMPLE_EVERY + ')');
  console.log('  --quick         1 seed, 160 ticks, 40 founders');
  console.log('');
  console.log('Writes research/output/lifeorg.{md,json,csv} and research/output/plots/lifeorg.svg.');
  process.exit(0);
}

const quick = argv.includes('--quick');
const seedsArg = str('--seeds', '');
const seeds = quick
  ? ['life.quick']
  : seedsArg.length > 0
    ? seedsArg.split(',').map((s) => s.trim()).filter((s) => s.length > 0)
    : LIFE_SEEDS;
const ticks = quick ? 160 : num('--ticks', LIFE_TICKS);
const spawn = quick ? 40 : num('--spawn', LIFE_SPAWN);
const every = num('--every', LIFE_SAMPLE_EVERY);

console.log(`running ${seeds.length} seed(s) x legacy/full, ${ticks} ticks, spawn ${spawn}, sampling every ${every}...`);
const report: LifeReport = runLifeReport({ seeds, ticks, spawn, sampleEvery: every });

for (const profile of ['legacy', 'full'] as const) {
  console.log('');
  console.log(`  ${profile} arm`);
  console.log('  level  organization             status           onset   peak  cov');
  for (const def of LIFE_LEVELS) {
    const runs = report.runs.filter((r) => r.profile === profile);
    const peaks = runs.map((r) => r.summary.levels[def.index].peakScore);
    const peak = peaks.reduce((a, b) => a + b, 0) / Math.max(1, peaks.length);
    const cov =
      runs.reduce((a, b) => a + b.summary.levels[def.index].coverage, 0) / Math.max(1, runs.length);
    const onsets = runs
      .map((r) => r.summary.levels[def.index].onset)
      .filter((t): t is number => t !== null);
    const statuses = runs.map((r) => r.summary.levels[def.index].status).join('/');
    console.log(
      `  ${def.id.padEnd(6)} ${def.name.padEnd(26)} ${statuses.padEnd(16)} ${(onsets.length ? String(Math.min(...onsets)) : '-').padStart(5)}   ${peak.toFixed(2)}  ${cov.toFixed(2)}`,
    );
  }
}

const dir = writeLifeReport(report);
console.log('');
console.log(`written to ${dir} (lifeorg.md, lifeorg.json, lifeorg.csv, plots/lifeorg.svg)`);
