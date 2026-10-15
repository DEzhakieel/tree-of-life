#!/usr/bin/env node
/**
 * Emergence-radar CLI.
 *
 * Runs the WASM world, reads it through the shared primitive detectors into the
 * L0..L10 capability ladder, validates every detector by ablation, and writes
 * research/output/radar.{md,json,csv} plus plots/radar.svg.
 *
 * `--strict` exits non-zero unless every level's detector is ablation-validated
 * (levels with no wired ablation faculty are reported `pending` and fail).
 */
import { LEVELS } from '@fractal-life/shared';
import { RADAR_SEEDS, RADAR_SPAWN, RADAR_TICKS, runRadarReport, writeRadarReport } from './emergenceRadar.js';

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
  return argv[i + 1]!;
};

if (argv.includes('--help')) {
  console.log('usage: radarRun.ts [--ticks N] [--spawn N] [--seeds a,b,c] [--quick] [--strict]');
  console.log('');
  console.log('  --ticks N       run length per seed (default ' + RADAR_TICKS + ')');
  console.log('  --spawn N       founders per seed (default ' + RADAR_SPAWN + ')');
  console.log('  --seeds a,b,c   seeds to map (default ' + RADAR_SEEDS.join(',') + ')');
  console.log('  --quick         1 seed, 120 ticks, 20 founders');
  console.log('  --strict        exit non-zero unless every detector is ablation-validated');
  console.log('');
  console.log('Writes research/output/radar.{md,json,csv} and research/output/plots/radar.svg.');
  process.exit(0);
}

const quick = argv.includes('--quick');
const strict = argv.includes('--strict');
const seedsArg = str('--seeds', '');
const seeds = quick
  ? ['radar.quick']
  : seedsArg.length > 0
    ? seedsArg.split(',').map((s) => s.trim()).filter((s) => s.length > 0)
    : RADAR_SEEDS;
const ticks = quick ? 120 : num('--ticks', RADAR_TICKS);
const spawn = quick ? 20 : num('--spawn', RADAR_SPAWN);

console.log(`running ${seeds.length} seed(s), ${ticks} ticks, spawn ${spawn}, sampling every 10...`);
const report = runRadarReport({ seeds, ticks, spawn });

console.log('');
console.log('  level  cap                    status           onset   peak');
for (const def of LEVELS) {
  const peaks = report.baseline.map((r) => r.summary.levels[def.index]!.peakScore);
  const peak = peaks.reduce((a, b) => a + b, 0) / Math.max(1, peaks.length);
  const onsets = report.baseline.map((r) => r.summary.levels[def.index]!.onset).filter((t): t is number => t !== null);
  const statuses = report.baseline.map((r) => r.summary.levels[def.index]!.status).join('/');
  console.log(
    `  ${def.id.padEnd(6)} ${def.name.padEnd(22)} ${statuses.padEnd(16)} ${(onsets.length ? String(Math.min(...onsets)) : '-').padStart(5)}   ${peak.toFixed(2)}`,
  );
}
console.log('');
console.log('  ablation validation:');
for (const v of report.verdicts) {
  const tag = v.validated ? 'VALID ' : v.wired ? 'reject' : 'pending';
  console.log(
    `  ${v.id.padEnd(6)} ${tag}  base ${v.baselinePeak.toFixed(2)} -> abl ${
      Number.isFinite(v.ablatedPeak) ? v.ablatedPeak.toFixed(2) : '  n/a'
    }  (${v.ablation})`,
  );
}

const dir = writeRadarReport(report);
console.log('');
console.log(`written to ${dir} (radar.md, radar.json, radar.csv, plots/radar.svg)`);
console.log(`strict: ${report.pass ? 'PASS' : 'FAIL'}`);

if (strict && !report.pass) {
  console.error('FAIL: not every detector is ablation-validated');
  process.exit(1);
}
