#!/usr/bin/env node
/**
 * Causal reverse-engineering CLI.
 *
 * Runs every one of the 2^n component arms at two densities, double-runs each for
 * determinism, sweeps density to find where the outcome changes, searches for
 * minimal sufficient sets, ablates each component out of the full set, and writes
 * causal.md / causal.json / causal.csv / plots/causal.svg.
 */
import {
  runCausalStudy,
  summarizeCausalStudy,
  resolveDensityEndpoints,
  DEFAULT_ARM,
  DENSE_ARM,
  SPARSE_ARM,
  REPLICATION_SEEDS,
  type ArmConfig,
} from './causal.js';

const argv = process.argv.slice(2);
const num = (flag: string, fallback: number): number => {
  const i = argv.indexOf(flag);
  if (i < 0 || i + 1 >= argv.length) return fallback;
  const v = Number(argv[i + 1]);
  return Number.isFinite(v) ? v : fallback;
};
/** undefined when the flag was not passed, so the study's own endpoints are kept */
const opt = (flag: string): number | undefined => {
  const i = argv.indexOf(flag);
  if (i < 0 || i + 1 >= argv.length) return undefined;
  const v = Number(argv[i + 1]);
  return Number.isFinite(v) ? v : undefined;
};

if (argv.includes('--help')) {
  console.log('usage: causalRun.ts [--arena N] [--spawn N] [--ticks N] [--sample-every N] [--seed-speed N] [--seed N] [--strict]');
  console.log('');
  console.log('  --arena N     high-density arena size (default ' + DENSE_ARM.arena + '). The low endpoint is scaled by');
  console.log('                the default pair\'s own ratios, landing on ' + SPARSE_ARM.arena + '/' + SPARSE_ARM.spawn + '.');
  console.log('  --spawn N     founders at the high-density endpoint (default ' + DENSE_ARM.spawn + ')');
  console.log('  --ticks N     run length; labels are the state at this tick (default ' + DEFAULT_ARM.ticks + ')');
  console.log('  --seed N      seed for the single-seed tables (default ' + DEFAULT_ARM.rngSeed + ')');
  console.log('  --strict      exit non-zero if any arm is seed-dependent');
  console.log('');
  console.log('Note: the tick budget is a modelling choice, not a runtime knob. Halving it changes');
  console.log('behaviour labels; see the tick-budget section of research/output/causal.md.');
  console.log('Seed replication always uses seeds [' + REPLICATION_SEEDS.join(', ') + '] regardless of --seed.');
  process.exit(0);
}

const arena = opt('--arena');
const spawn = opt('--spawn');

const cfg: ArmConfig = {
  spawn: spawn ?? DEFAULT_ARM.spawn,
  arena: arena ?? DEFAULT_ARM.arena,
  ticks: num('--ticks', DEFAULT_ARM.ticks),
  sampleEvery: num('--sample-every', DEFAULT_ARM.sampleEvery),
  seedSpeed: num('--seed-speed', DEFAULT_ARM.seedSpeed),
  rngSeed: num('--seed', DEFAULT_ARM.rngSeed),
};

const endpoints = resolveDensityEndpoints({ arena, spawn });
console.log(
  `densities: high ${endpoints.dense.arena}/${endpoints.dense.spawn}, low ${endpoints.sparse.arena}/${endpoints.sparse.spawn}, ${cfg.ticks} ticks`,
);
if (arena !== undefined || spawn !== undefined) {
  console.log('note: --arena/--spawn set the high-density endpoint; the low one was scaled by the default pair\'s own ratios');
}

const study = runCausalStudy(cfg, { arena, spawn });
summarizeCausalStudy(study);
if (!study.deterministic) {
  console.error('FAIL: at least one arm failed to replay identically; no causal claim is admissible');
  process.exit(1);
}

const unstable = [...study.replication.unstableDense, ...study.replication.unstableSparse];
if (unstable.length > 0) {
  console.warn(
    `WARN: ${new Set(unstable).size} of 16 arms are seed-dependent across ${study.replication.seeds.length} seeds; ` +
      'their labels are distributions, not outcomes. See the seed replication section of the report.',
  );
  if (argv.includes('--strict')) {
    console.error('FAIL: --strict and at least one arm is seed-dependent');
    process.exit(2);
  }
}
