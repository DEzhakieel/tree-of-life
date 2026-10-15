#!/usr/bin/env node
/**
 * Emergence-atlas CLI.
 *
 * Runs one or more worlds, maps each run's stats series into the
 * order <-> complexity <-> chaos phase plane (shared coordinate math with
 * the web panel) and writes research/output/atlas.{md,json} plus
 * plots/atlas.svg — one overlaid trajectory per seed.
 */
import { buildAtlasRun, writeAtlasReport, type AtlasReportInput } from './emergenceAtlas.js';
import { runWithEvents } from './eventLog.js';

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

const fail = (msg: string): never => {
  console.error('FAIL: ' + msg);
  process.exit(1);
};

if (argv.includes('--help')) {
  console.log('usage: atlasRun.ts [--ticks N] [--spawn N] [--seeds a,b,c] [--strict]');
  console.log('');
  console.log('  --ticks N   run length per seed (default 400)');
  console.log('  --spawn N   founders per seed (default 100)');
  console.log('  --seeds a,b,c   seeds to map (default atlas.s1,atlas.s2,atlas.s3)');
  console.log('  --strict    exit non-zero when no stats were captured');
  console.log('');
  console.log('Writes research/output/atlas.{md,json} and research/output/plots/atlas.svg.');
  process.exit(0);
}

const ticks = num('--ticks', 400);
const spawn = num('--spawn', 100);
const strict = argv.includes('--strict');
const seedsArg = str('--seeds', '');
const seeds = seedsArg.length > 0
  ? seedsArg.split(',').map((s) => s.trim()).filter((s) => s.length > 0)
  : ['atlas.s1', 'atlas.s2', 'atlas.s3'];
if (seeds.length < 1) fail('--seeds produced an empty seed list');

console.log(`running ${seeds.length} seed(s), ${ticks} ticks, spawn ${spawn}...`);
const input: AtlasReportInput = {
  seeds,
  ticks,
  spawn,
  runs: seeds.map((seed) => buildAtlasRun(seed, runWithEvents({ seed, ticks, spawn }))),
};

const totalPoints = input.runs.reduce((a, r) => a + r.summary.n, 0);
if (strict && totalPoints === 0) {
  fail('strict: no stats points were captured; nothing was mapped');
}

const dir = writeAtlasReport(input);

console.log('');
for (const r of input.runs) {
  const s = r.summary;
  console.log(
    `  ${r.seed}: n=${s.n} ord ${Math.round(s.residence.order * 100)}% / edge ${Math.round(s.residence.edge * 100)}% / cha ${Math.round(s.residence.chaos * 100)}%` +
      ` · dominant ${s.dominant ?? 'n/a'} · peak y ${s.peak ? s.peak.y.toFixed(2) + ' @ t' + s.peak.tick : 'n/a'}` +
      ` · end (${s.end ? s.end.x.toFixed(2) + ',' + s.end.y.toFixed(2) : 'n/a'}) ${s.end?.regime ?? ''}`,
  );
}
console.log('');
console.log(`written to ${dir} (atlas.md, atlas.json, plots/atlas.svg)`);
