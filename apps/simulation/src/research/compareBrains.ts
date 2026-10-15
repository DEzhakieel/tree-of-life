import { writeFileSync, readFileSync, appendFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runLadder, type LadderResult } from './ladder.js';
import type { BrainConfig } from '../brain.js';
import type { WorldStochasticConfig } from '../worldStoch.js';
import { fmt } from './stats.js';
import { UNIVERSE_EARTH_LIKE, UNIVERSE_LUNA, UNIVERSE_MARS, type UniverseConfig } from '@fractal-life/shared';

/** Physics-frame presets; 'off' → legacy (no universe). */
const UNIVERSE_OPTIONS: Record<'off' | 'earth' | 'moon' | 'mars', UniverseConfig | undefined> = {
  off: undefined,
  earth: UNIVERSE_EARTH_LIKE,
  moon: UNIVERSE_LUNA,
  mars: UNIVERSE_MARS,
};

/**
 * Emergence ladder × brain paradigm sweep.
 *
 * Runs the same emergence ladder under several brain paradigms (plain hebbian,
 * backprop, backprop+stochastic policy, and the full stack with POMDP beliefs
 * on a stochastic world) across a number of deterministic seeds (or a single
 * one), then prints the cognition/interaction/life metrics side by side.
 *
 * Results are appended to a JSONL file after every run, so an interrupted
 * sweep keeps everything completed so far. A separate `--report-only` pass
 * re-reads the data and prints the comparison table (run any subset of seeds,
 * then report once all are in).
 */

export interface BrainConfigSpec {
  name: string;
  brain?: Partial<BrainConfig>;
  worldStoch?: Partial<WorldStochasticConfig>;
}

export const BRAIN_CONFIGS = (ticks: number): BrainConfigSpec[] => [
  { name: 'hebbian' },
  { name: 'backprop', brain: { enabled: true, learn: 'backprop' } },
  {
    name: 'backprop+policy',
    brain: {
      enabled: true,
      learn: 'backprop',
      policy: { mode: 'gaussian', sigma: 0.35, sigmaMin: 0.05, annealTicks: ticks },
    },
  },
  {
    name: 'backprop+policy+pomdp+stoch',
    brain: {
      enabled: true,
      learn: 'backprop',
      policy: { mode: 'gaussian', sigma: 0.35, sigmaMin: 0.05, annealTicks: ticks },
      pomdp: { enabled: true },
    },
    worldStoch: { enabled: true, poissonRate: 60, ouTheta: 0.01, ouSigma: 0.03, ouBand: 0.3 },
  },
];

interface CompareOptions {
  seed: string;
  ticks: number;
  spawn: number;
  maxPop: number;
  sampleEvery: number;
  outDir: string;
  reportOnly: boolean;
  configs: string[];
  /** deep cell biochemistry (WorldConfig.cellBio) */
  cellBio: boolean;
  /** physics frame preset (WorldConfig.universe) */
  universe: 'off' | 'earth' | 'moon' | 'mars';
  help: boolean;
}

function parseArgs(argv: string[]): CompareOptions {
  const opts: CompareOptions = {
    seed: 'ladder-seed-0001',
    ticks: 3000,
    spawn: 100,
    maxPop: 600,
    sampleEvery: 50,
    outDir: resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'research', 'compare-brain'),
    reportOnly: false,
    configs: [],
    cellBio: false,
    universe: 'off',
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    const next = () => argv[++i]!;
    switch (a) {
      case '--seed':
        opts.seed = next();
        break;
      case '--ticks':
        opts.ticks = parseInt(next(), 10);
        break;
      case '--spawn':
        opts.spawn = parseInt(next(), 10);
        break;
      case '--max-pop':
        opts.maxPop = parseInt(next(), 10);
        break;
      case '--sample-every':
        opts.sampleEvery = parseInt(next(), 10);
        break;
      case '--report-only':
        opts.reportOnly = true;
        break;
      case '--configs':
        opts.configs = next().split(',').map((s) => s.trim()).filter(Boolean);
        break;
      case '--cell-bio':
        opts.cellBio = true;
        break;
      case '--universe': {
        const v = next();
        if (v !== 'off' && v !== 'earth' && v !== 'moon' && v !== 'mars') {
          console.error(`invalid --universe value: ${v} (expected 'off' | 'earth' | 'moon' | 'mars')`);
          process.exit(2);
        }
        opts.universe = v;
        break;
      }
      case '-o':
        opts.outDir = resolve(next());
        break;
      case '-h':
      case '--help':
        opts.help = true;
        break;
      default:
        console.error(`unknown option: ${a}`);
        process.exit(2);
    }
  }
  return opts;
}

function dataFile(outDir: string): string {
  return resolve(outDir, 'compare-raw.jsonl');
}

interface RunEntry {
  config: string;
  seed: string;
  /** deep cell biochemistry on/off for this run */
  cellBio: boolean;
  /** physics-frame preset label for this run ('off' | 'earth' | 'moon' | 'mars') */
  universe: string;
  result: LadderResult;
}

const COLS: { label: string; get: (r: LadderResult) => number }[] = [
  { label: 'spp(max)', get: (r) => r.summary.interaction.maxSpecies },
  { label: 'predFr(max)', get: (r) => r.summary.interaction.maxPredatorFraction },
  { label: 'coop(max)', get: (r) => r.summary.interaction.maxCooperation },
  { label: 'foraging', get: (r) => r.summary.cognition.foragingMean },
  { label: 'foraging+', get: (r) => r.summary.cognition.foragingPositiveFrac },
  { label: 'hazard', get: (r) => r.summary.cognition.hazardCorr },
  { label: 'signal', get: (r) => r.summary.cognition.signalCorr },
  { label: 'headingEnt', get: (r) => r.summary.cognition.headingEntropyMean },
  { label: 'culture', get: (r) => r.summary.cognition.cultureCountMax },
  { label: 'memeEnt', get: (r) => r.summary.cognition.memeEntropyMax },
  { label: 'MI(sp,meme)', get: (r) => r.summary.cognition.speciesMemeMIMax },
  { label: 'complexity', get: (r) => r.summary.cognition.complexityMax },
  { label: 'fitFirst', get: (r) => r.summary.cognition.fitnessFirstQ },
  { label: 'fitLast', get: (r) => r.summary.cognition.fitnessLastQ },
  { label: 'adapt%', get: (r) => r.summary.cognition.adaptationFrac * 100 },
  { label: 'L3', get: (r) => (r.synthesis.levels[2]!.verdict === 'EMERGENT' ? 1 : 0) },
];

export function runSeed(opts: CompareOptions): void {
  const file = dataFile(opts.outDir);
  mkdirSync(opts.outDir, { recursive: true });
  const all = BRAIN_CONFIGS(opts.ticks);
  const cfgFilter = opts.configs.length ? opts.configs : all.map((c) => c.name);
  const unknown = cfgFilter.filter((n) => !all.some((c) => c.name === n));
  if (unknown.length) {
    console.error(`unknown --configs: ${unknown.join(', ')} (known: ${all.map((c) => c.name).join(', ')})`);
    process.exit(2);
  }
  const configs = all.filter((c) => cfgFilter.includes(c.name));
  const t0 = Date.now();

  for (const cfg of configs) {
    const r = runLadder({
      seed: opts.seed,
      ticks: opts.ticks,
      spawnCount: opts.spawn,
      maxPopulation: opts.maxPop,
      sampleEvery: opts.sampleEvery,
      brain: cfg.brain,
      worldStoch: cfg.worldStoch,
      cellBio: opts.cellBio,
      universe: UNIVERSE_OPTIONS[opts.universe],
    });
    appendFileSync(
      file,
      `${JSON.stringify({ config: cfg.name, seed: opts.seed, cellBio: opts.cellBio, universe: opts.universe, result: r } satisfies RunEntry)}\n`,
    );
    const el = Date.now() - t0;
    const c = r.summary.cognition;
    const world = `${opts.cellBio ? 'cB ' : ''}${opts.universe !== 'off' ? opts.universe : ''}`.trim();
    console.log(
      `[${cfg.name.padEnd(30)} seed=${opts.seed}${world ? ` ${world}` : ''}] L3=${r.synthesis.levels[2]!.verdict} ` +
        `fit ${fmt(c.fitnessFirstQ, 1)}→${fmt(c.fitnessLastQ, 1)} spp=${r.summary.interaction.maxSpecies} ` +
        `hazard=${fmt(c.hazardCorr, 3)} ent=${fmt(c.headingEntropyMean, 2)} (${fmt(el / 1000, 0)}s)`,
    );
  }
  console.log(`appended ${configs.length} runs for seed ${opts.seed} to ${file}`);
}

function comboKey(e: RunEntry): string {
  return `cellBio=${e.cellBio ? 'on' : 'off'}, universe=${e.universe}`;
}

export function report(opts: CompareOptions): void {
  const file = dataFile(opts.outDir);
  if (!existsSync(file)) {
    console.error(`no data at ${file} — run the sweep first`);
    process.exit(1);
  }
  const entries: RunEntry[] = readFileSync(file, 'utf8')
    .split('\n')
    .filter((l) => l.trim() !== '')
    .map((l) => JSON.parse(l) as RunEntry);
  const configNames = BRAIN_CONFIGS(4000).map((c) => c.name);
  const combos = [...new Set(entries.map(comboKey))].sort();

  const lines: string[] = [];
  lines.push('# Emergence ladder x brain paradigm', '');
  lines.push(
    `_${entries.length} runs, raw data in \`compare-raw.jsonl\`. ` +
      `Every config shares the identical unscripted simulation for its seed._`,
    '',
  );
  if (combos.length > 1) {
    lines.push(`_Separate tables below per world-chemistry/physics settings: ${combos.join('; ')}._`, '');
  }

  let totalTables = 0;
  for (const combo of combos) {
    const comboEntries = entries.filter((e) => comboKey(e) === combo);
    const configs = configNames
      .filter((n) => comboEntries.some((e) => e.config === n))
      .filter((n) => (opts.configs.length ? opts.configs.includes(n) : true));
    const seeds = [...new Set(comboEntries.map((e) => e.seed))].sort();
    if (configs.length === 0) continue;

    if (combos.length > 1) {
      lines.push(`## ${combo}`, '');
      lines.push(`_${comboEntries.length} runs (${configs.length} configs x ${seeds.length} seeds: ${seeds.join(', ')})_`, '');
    }
    lines.push('| metric | ' + configs.join(' | ') + ' |');
    lines.push('|---|---' + configs.map(() => '---').join('|') + '|');
    for (const col of COLS) {
      const cells = configs.map((name) => {
        const runs = comboEntries.filter((e) => e.config === name).map((e) => e.result);
        if (col.label === 'L3') {
          const em = runs.filter((r) => r.synthesis.levels[2]!.verdict === 'EMERGENT').length;
          const ext = runs.filter((r) => r.summary.life.extinct).length;
          return `${em}/${runs.length}${ext ? ` (${ext} extinct)` : ''}`;
        }
        const values = runs.map(col.get);
        const mean = values.reduce((s, v) => s + v, 0) / values.length;
        const sd = values.length > 1 ? Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / (values.length - 1)) : 0;
        return values.length === 1 ? fmt(mean, 4) : `${fmt(mean, 4)} (+-${fmt(sd, 4)})`;
      });
      lines.push(`| ${col.label} | ${cells.join(' | ')} |`);
    }
    lines.push('');
    totalTables++;
  }

  if (totalTables === 0) {
    console.error('no matching runs in the data file');
    process.exit(1);
  }

  mkdirSync(opts.outDir, { recursive: true });
  writeFileSync(resolve(opts.outDir, 'compare-report.md'), lines.join('\n') + '\n');

  console.log(`\n${entries.length} runs (${totalTables} table${totalTables > 1 ? 's' : ''}) from ${file}\n`);
  for (const l of lines) console.log(l);
  console.log(`wrote ${resolve(opts.outDir, 'compare-report.md')}`);
}

function help(): string {
  return `fractal-life brain-paradigm ladder comparison

Runs the emergence ladder under several brain paradigms on one deterministic
seed (append --seed again per seed), then reports the averaged metrics.

Usage:
  tsx src/research/compareBrains.ts [--seed S] [--ticks N] [--spawn N]
      [--max-pop N] [--sample-every N] [--configs L] [-o DIR]
  tsx src/research/compareBrains.ts --report-only [--configs L] [-o DIR]

--configs L  comma-separated subset of configs to run/report
             (hebbian, backprop, backprop+policy, backprop+policy+pomdp+stoch)

World chemistry & physics (applied uniformly to every run of this sweep):
  --cell-bio      opt-in deep cell biochemistry (folding, membranes, gradients,
                  MM kinetics)
  --universe U    physics frame preset: 'off' (legacy) | 'earth' | 'moon' | 'mars'

Every run is appended to DIR/compare-raw.jsonl (tagged with its settings), so run
as many seeds as you want in any order and finish with --report-only. Mixing
runs with different --cell-bio/--universe settings yields a separate table per
settings combo.
`;
}

if (typeof require !== 'undefined' || process.argv[1]?.endsWith('compareBrains.ts')) {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log(help());
    process.exit(0);
  }
  try {
    if (opts.reportOnly) report(opts);
    else runSeed(opts);
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }
}