#!/usr/bin/env node
/**
 * Perturbation engine CLI.
 *
 * Establishes a baseline world (100 agents, capacity 100, noise 0.1, cooperation 0.5)
 * and then removes exactly one axis at a time, measuring every macro outcome as
 * deltaY = Yperturbed - Y_baseline on paired seeds. Writes
 * perturbation.md / perturbation.json / perturbation.csv / plots/perturbation.svg.
 *
 * The point of the channel verdict is that a delta measured through a pathway that never
 * opened is not a null result. This CLI reports that distinction loudly and can refuse to
 * exit clean when an axis was unexercised, so an unmeasured axis cannot pass for an
 * inert one.
 */
import {
  BASELINE,
  OUTCOME_KEYS,
  PERTURBATIONS,
  PERTURB_SEEDS,
  runPerturbationReport,
  writePerturbationReport
} from './perturb.js';

const argv = process.argv.slice(2);

if (argv.includes('--help')) {
  console.log('usage: perturbRun.ts [--ticks N] [--seeds a,b,c] [--double-run] [--strict]');
  console.log('');
  console.log('  --ticks N       run length for every condition (default ' + BASELINE.ticks + ')');
  console.log('  --seeds a,b,c   replication seeds (default ' + PERTURB_SEEDS.join(', ') + ')');
  console.log('  --double-run    replay every condition and fail on any mismatch');
  console.log('  --strict        exit non-zero if any perturbation\'s channel never opened');
  console.log('');
  console.log('Perturbations: ' + PERTURBATIONS.map((p) => p.id).join(', '));
  console.log('Outcomes: ' + OUTCOME_KEYS.join(', '));
  process.exit(0);
}

const ticksArg = argv.indexOf('--ticks');
const parsedTicks = ticksArg >= 0 && ticksArg + 1 < argv.length ? Number(argv[ticksArg + 1]) : NaN;
const ticks = Number.isFinite(parsedTicks) ? parsedTicks : BASELINE.ticks;

const seedArg = argv.indexOf('--seeds');
const seeds =
  seedArg >= 0 && seedArg + 1 < argv.length
    ? argv[seedArg + 1]!.split(',').map((s) => s.trim()).filter((s) => s.length > 0)
    : PERTURB_SEEDS;

if (seeds.length < 2) {
  console.error('FAIL: at least two seeds are required; a single world cannot show whether a delta is stable');
  process.exit(1);
}

console.log(
  `baseline: ${BASELINE.agents} agents, capacity ${BASELINE.energy}, noise ${BASELINE.noise}, ` +
    `cooperation ${BASELINE.cooperation}, ${ticks} ticks`,
);
console.log(`seeds: ${seeds.join(', ')} (paired: baseline and perturbation share a world)`);

const report = runPerturbationReport({ ...BASELINE, ticks }, seeds, argv.includes('--double-run'));

console.log('');
for (const s of report.summaries) {
  const top = s.robust[0];
  console.log(
    `${s.perturbation.padEnd(18)} channel=${s.channel.padEnd(9)} ` +
      (top
        ? `largest robust move: ${top.key} ${top.meanDelta >= 0 ? '+' : ''}${top.meanDelta.toFixed(4)} (sd ${top.stdDelta.toFixed(4)})`
        : 'no outcome moved'),
  );
}

console.log('');
console.log(`wrote ${writePerturbationReport(report)}`);

const unexercised = report.summaries.filter((s) => s.channel !== 'exercised');
if (unexercised.length > 0) {
  console.warn('');
  console.warn(`WARN: ${unexercised.length} of ${report.summaries.length} axes did not have a live pathway in this baseline:`);
  for (const s of unexercised) console.warn(`  ${s.perturbation}: ${s.channelEvidence}`);
  console.warn('Their deltas are uninterpretable - see the channel verdicts in the report.');
  if (argv.includes('--strict')) {
    console.error('FAIL: --strict and at least one axis was unexercised');
    process.exit(2);
  }
}
