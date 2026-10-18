#!/usr/bin/env node
import { EW_RAMPS, EW_SEEDS, runEwsReport, writeEwsReport } from './ews.js';
import { EWS_INDICATORS } from '@fractal-life/shared';

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
  console.log('usage: ewsRun.ts [--seeds a,b,c] [--ramps 500,900,1300] [--quick]');
  console.log('');
  console.log('  --seeds a,b,c   replicate seeds (default ' + EW_SEEDS.join(',') + ')');
  console.log('  --ramps a,b,c   ramp durations in ticks (default ' + EW_RAMPS.join(',') + ')');
  console.log('  --quick         2 seeds, ramps 350,600');
  console.log('');
  console.log('Writes research/output/ews.{md,json,csv} and research/output/plots/ews.svg.');
  process.exit(0);
}

const quick = argv.includes('--quick');
const seedsArg = str('--seeds', '');
const rampsArg = str('--ramps', '');
const seeds = quick ? ['ews.a', 'ews.b'] : seedsArg ? seedsArg.split(',').map((s) => s.trim()).filter(Boolean) : EW_SEEDS;
const ramps = quick
  ? [350, 600]
  : rampsArg
    ? rampsArg.split(',').map((s) => Number(s.trim())).filter((n) => Number.isFinite(n) && n > 0)
    : EW_RAMPS;

console.log(`running ${seeds.length} seed(s) x ${ramps.length} ramp(s) [${ramps.join(', ')}]...`);
const t0 = Date.now();
const report = runEwsReport({ seeds, ramps });
const dt = (Date.now() - t0) / 1000;

console.log('');
console.log('tau   collapse%   plateau   meanTick   ' + EWS_INDICATORS.map((i) => i.padStart(9)).join(''));
for (const s of report.summary) {
  console.log(
    `${String(s.ramp).padEnd(6)}${(s.collapseFrac * 100).toFixed(0).padStart(6)}%   ${s.meanPlateau.toFixed(0).padStart(6)}     ${s.meanCollapseTick.toFixed(0).padStart(6)}   ` +
      EWS_INDICATORS.map((i) => s.auc[i].toFixed(2).padStart(9)).join(''),
  );
}
console.log('');
console.log('AUC by indicator above (0.5 = chance). Lead times per tau:');
for (const s of report.summary) {
  const parts = EWS_INDICATORS.map((i) => `${i}:${s.leads[i].meanTicks.toFixed(0)}t/${s.leads[i].meanParam.toFixed(1)}m`).join('  ');
  console.log(`  tau=${s.ramp}  ${parts}`);
}
const ctrlFinal = report.control.reduce((a, c) => a + c.finalPop, 0) / Math.max(1, report.control.length);
const ctrlSurvived = report.control.filter((c) => c.finalPop > 0).length;
console.log('');
console.log(`no-ramp control: mean final pop ${ctrlFinal.toFixed(0)}, survived ${ctrlSurvived}/${report.control.length}`);

const dir = writeEwsReport(report);
console.log('');
console.log(`ran ${(report.seeds.length * report.ramps.length).toString()} runs in ${dt.toFixed(1)}s; written to ${dir}`);
