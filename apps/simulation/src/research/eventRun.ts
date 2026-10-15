#!/usr/bin/env node
/**
 * Event causality CLI.
 *
 * Runs a world (or loads an NDJSON/JSON event file), then writes
 * research/output/events.{md,json,csv} plus plots/events.svg:
 *
 *  - census always (counts, rates, interarrival gaps);
 *  - observational pre/post attribution + lag correlation when a stats
 *    series exists (in-process runs);
 *  - same-seed paired interventional deltas behind --interventional.
 */
import {
  analyzeObservational,
  pairInterventional,
  writeEventReport,
  type EventReportInput,
} from './eventCausal.js';
import {
  census,
  defaultPlants,
  loadEventLog,
  runWithEvents,
  type EventCapture,
} from './eventLog.js';

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
  console.log('usage: eventRun.ts [--ticks N] [--spawn N] [--seeds a,b,c] [--window N] [--lag N] [--min-occurrences N] [--log path] [--interventional] [--no-plants] [--strict]');
  console.log('');
  console.log('  --ticks N            run length for the in-process world (default 400)');
  console.log('  --spawn N            founders in the in-process world (default 100)');
  console.log('  --seeds a,b,c        replication seeds (default event.s1; event.s1..s3 with --interventional)');
  console.log('  --window N           pre/post window in ticks on each side of an occurrence (default 10)');
  console.log('  --lag N              lag search half-width for impulse/metric correlation (default 10)');
  console.log('  --min-occurrences N  unique occurrence ticks required to analyze a type (default 5)');
  console.log('  --log path           analyze an NDJSON/JSON event file instead of running;');
  console.log('                       census only (no stats series => no pre/post, no replay)');
  console.log('  --interventional     also run same-seed paired baselines against planted interventions');
  console.log('  --no-plants          do not plant interventions (census + observational only)');
  console.log('  --strict             exit non-zero when nothing was analyzed');
  console.log('');
  console.log('Writes research/output/events.{md,json,csv} and research/output/plots/events.svg.');
  process.exit(0);
}

const ticks = num('--ticks', 400);
const spawn = num('--spawn', 100);
const window = num('--window', 10);
const lag = num('--lag', 10);
const minOccurrences = num('--min-occurrences', 5);
const maxDensity = num('--max-density', 0.3);
const interventional = argv.includes('--interventional');
const noPlants = argv.includes('--no-plants');
const strict = argv.includes('--strict');
const logPath = str('--log', '');
const seedsArg = str('--seeds', '');

let input: EventReportInput;

if (logPath.length > 0) {
  if (interventional) {
    fail('--interventional replays this machine\'s own worlds and cannot replay a foreign log; drop --log or --interventional');
  }
  if (seedsArg.length > 0) {
    fail('--seeds has no meaning for --log (the log\'s world is fixed)');
  }
  const { events, invalid } = loadEventLog(logPath);
  let maxTick = 0;
  for (const e of events) if (e.tick > maxTick) maxTick = e.tick;
  const totalTicks = events.length > 0 ? maxTick + 1 : 0;
  if (events.length === 0 && strict) {
    fail(`event log ${logPath} contained no valid events (${invalid} invalid line(s))`);
  }
  input = {
    source: { mode: 'file', file: logPath, seeds: [], ticks: totalTicks, spawn: 0, invalidLines: invalid, totalEvents: events.length },
    window,
    lag,
    censuses: census(events, totalTicks),
    observational: null,
    interventional: null,
    plants: [],
  };
} else {
  const seeds = seedsArg.length > 0
    ? seedsArg.split(',').map((s) => s.trim()).filter((s) => s.length > 0)
    : interventional
      ? ['event.s1', 'event.s2', 'event.s3']
      : ['event.s1'];
  if (seeds.length < 1) fail('--seeds produced an empty seed list');
  if (interventional && seeds.length < 2) fail('--interventional needs at least 2 seeds (--seeds a,b,c) for a paired test');

  const plants = noPlants ? [] : defaultPlants(ticks);
  console.log(
    `running ${seeds.length} seed(s), ${ticks} ticks, spawn ${spawn}, ${plants.length} planted intervention(s)${interventional ? ', paired baselines on' : ''}...`,
  );
  const treatments: EventCapture[] = seeds.map((seed) => runWithEvents({ seed, ticks, spawn, plants }));
  const baselines: EventCapture[] = interventional ? seeds.map((seed) => runWithEvents({ seed, ticks, spawn, plants: [] })) : [];
  const first = treatments[0]!;

  const observational = analyzeObservational(first.events, first.series, { window, lag, minOccurrences, maxDensity });
  const interventionalReport = interventional ? pairInterventional(treatments, baselines, { window }) : null;

  input = {
    source: { mode: 'in-process', seeds, ticks, spawn, invalidLines: 0, totalEvents: first.events.length },
    window,
    lag,
    censuses: census(first.events, first.series.length),
    observational,
    interventional: interventionalReport,
    plants,
  };
}

const dir = writeEventReport(input);

console.log('');
console.log(`census: ${input.censuses.map((c) => `${c.type}=${c.ticks}`).join(' ')}`);
const obs = input.observational;
if (obs) {
  console.log(`observational: ${obs.rows.length} analyzed pairs, ${obs.skipped.length} type(s) skipped`);
  for (const r of obs.rows.slice(0, 5)) {
    console.log(
      `  - ${r.type} -> ${r.metric}: delta ${r.meanDelta >= 0 ? '+' : ''}${r.meanDelta.toFixed(3)}, d_z ${r.cohensDz.toFixed(2)}, p ${Number.isNaN(r.p) ? 'n/a' : r.p.toFixed(3)}, peak r ${r.peakR.toFixed(2)} @ ${r.peakLag >= 0 ? '+' : ''}${r.peakLag}`,
    );
  }
  if (strict && obs.rows.length === 0 && input.source.mode === 'in-process') {
    fail('strict: no event type met the analysis minimum; nothing was attributed');
  }
} else if (input.source.mode === 'file') {
  console.log('file mode: census only (no stats series for pre/post; no replay for interventional)');
}
const inter = input.interventional;
if (inter) {
  console.log(
    `interventional: arms identical up to tick ${inter.equivalentUpToTick}, ${inter.plants.length} plant(s), ${inter.rows.length} analyzed pairs`,
  );
  for (const r of inter.rows.slice(0, 5)) {
    console.log(
      `  - ${r.itype} -> ${r.metric}: delta ${r.meanDelta >= 0 ? '+' : ''}${r.meanDelta.toFixed(3)}, d_z ${r.cohensDz.toFixed(2)}, sign ${r.signConsistent ? 'consistent' : 'reverses'}`,
    );
  }
  if (strict && inter.rows.length === 0) {
    fail('strict: interventional mode produced no measurable pairs');
  }
}
console.log('');
console.log(`written to ${dir}`);
