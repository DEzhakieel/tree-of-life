import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import {
  runFirstOrder,
  runSecondOrder,
  runThirdOrder,
  runConservation,
  runStochastic,
  determinismCheck,
  FIRST_ORDER_TICKS,
  SECOND_ORDER_WINDOW,
  THIRD_ORDER_TICKS,
  STOCH_TICKS,
  STOCH_SPAWN,
} from './scenarios.js';
import {
  mean,
  stdev,
  median,
  quantile,
  bootstrapCI,
  permutationP,
  cohensD,
  wilsonCI,
  fmt,
  fmtP,
  effectLabel,
} from './stats.js';
import { TrendForecaster, type ForecastResult } from '../forecast.js';
import { runLadder } from './ladder.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..', '..', '..');
const ENGINE_PATH = resolve(ROOT, 'apps', 'simulation', 'src', 'engine.ts');
const PACKAGE_PATH = resolve(ROOT, 'apps', 'simulation', 'package.json');

export interface CliOptions {
  seeds: string[];
  scenarios: string[];
  outDir: string;
  bootstrapSamples: number;
  permutations: number;
  determinismSeeds: number;
  json: boolean;
  csv: boolean;
  md: boolean;
  /** neural-forecast horizon over one unscripted ladder trajectory (0 = off) */
  forecast: number;
  forecastSeries: string[];
}

export function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = {
    seeds: [],
    scenarios: ['first-order', 'second-order', 'third-order', 'conservation', 'stochastic'],
    outDir: resolve(ROOT, 'apps', 'simulation', 'research', 'output'),
    bootstrapSamples: 2000,
    permutations: 10000,
    determinismSeeds: 3,
    json: true,
    csv: true,
    md: true,
    forecast: 0,
    forecastSeries: ['alive', 'avgEnergy', 'complexity', 'entropy'],
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    const next = () => argv[++i]!;
    switch (a) {
      case '--seeds':
      case '-n':
        opts.seeds = defaultSeeds(parseInt(next(), 10));
        break;
      case '--seed-file':
        opts.seeds = readFileSync(next(), 'utf8')
          .split(/\r?\n/)
          .map((s) => s.trim())
          .filter((s) => s.length > 0 && !s.startsWith('#'));
        break;
      case '--seed':
        opts.seeds.push(next());
        break;
      case '--scenarios':
      case '-s':
        opts.scenarios = next().split(',').map((s) => s.trim()).filter(Boolean);
        break;
      case '--out':
      case '-o':
        opts.outDir = resolve(next());
        break;
      case '--bootstrap-samples':
        opts.bootstrapSamples = parseInt(next(), 10);
        break;
      case '--permutations':
        opts.permutations = parseInt(next(), 10);
        break;
      case '--determinism-seeds':
        opts.determinismSeeds = parseInt(next(), 10);
        break;
      case '--forecast':
        opts.forecast = parseInt(next(), 10);
        break;
      case '--forecast-series':
        opts.forecastSeries = next().split(',').map((s) => s.trim()).filter(Boolean);
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
      case '--help':
      case '-h':
        console.log(help());
        process.exit(0);
      default:
        console.error(`unknown option: ${a}`);
        process.exit(2);
    }
  }
  if (opts.seeds.length === 0) opts.seeds = defaultSeeds(24);
  return opts;
}

function defaultSeeds(n: number): string[] {
  return Array.from({ length: n }, (_, i) => `research-seed-${String(i + 1).padStart(4, '0')}`);
}

function help(): string {
  return `fractal-life research harness

Usage:
  tsx src/research/cli.ts [options]

Options:
  -n, --seeds N              number of auto-generated seeds (default 24)
      --seed-file FILE       read one seed per line (overrides --seeds)
      --seed S               add a single seed (repeatable)
  -s, --scenarios LIST       comma-separated: first-order,second-order,third-order,conservation,stochastic
  -o, --out DIR              output directory (default apps/simulation/research/output)
      --bootstrap-samples N  bootstrap resamples (default 2000)
      --permutations N       permutation-test resamples (default 10000)
      --determinism-seeds N  seeds to run the bit-for-bit determinism check on (default 3)
      --forecast N           neural-forecast an unscripted ladder trajectory N ticks
                             ahead (default off): the net trains on the first 3/4 of
                             the run and its error is measured against the held-out
                             last quarter (proper ML evaluation, no hindsight)
      --forecast-series L    comma-separated observables to forecast (default
                             alive,avgEnergy,complexity,entropy)
      --no-json / --no-csv / --no-md   disable individual report formats
  -h, --help                 this help

The 'stochastic' scenario runs each seed twice (deterministic backprop control
vs. a treatment with annealed Gaussian policies, world weather/OU/Poisson
processes and SGD dropout + gradient noise) and reports the paired differences
in survival, productivity, plasticity and resource heterogeneity.
`;
}

// ---------------------------------------------------------------------------
// Provenance
// ---------------------------------------------------------------------------

function sha256OfFile(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function gitCommit(root: string): string | null {
  try {
    return readFileSync(join(root, '.git', 'HEAD'), 'utf8').trim();
  } catch {
    return null;
  }
}

function provenance(opts: CliOptions): Record<string, unknown> {
  const pkg = JSON.parse(readFileSync(PACKAGE_PATH, 'utf8')) as { name: string; version: string };
  return {
    tool: 'fractal-life research harness',
    timestamp: new Date().toISOString(),
    node: process.version,
    platform: `${process.platform}/${process.arch}`,
    simulationPackage: `${pkg.name}@${pkg.version}`,
    engineSource: { path: ENGINE_PATH, sha256: sha256OfFile(ENGINE_PATH) },
    git: gitCommit(ROOT),
    params: {
      firstOrderTicks: FIRST_ORDER_TICKS,
      secondOrderWindow: SECOND_ORDER_WINDOW,
      thirdOrderTicks: THIRD_ORDER_TICKS,
      stochTicks: STOCH_TICKS,
      stochSpawn: STOCH_SPAWN,
      bootstrapSamples: opts.bootstrapSamples,
      permutations: opts.permutations,
      analysisSeed: 0xc0ffee,
      // each seed samples a different complex-plane window of the (fixed)
      // mandelbrot map; max jitter is 0.6 * worldScale per axis (scenarios.ts)
      terrainSampling: { jitterFractionOfWorldScale: 0.6, perAxis: true },
    },
    seeds: opts.seeds,
    scenarios: opts.scenarios,
  };
}

// ---------------------------------------------------------------------------
// Scenario registry
// ---------------------------------------------------------------------------

type Row = Record<string, number | boolean | string>;

interface ScenarioDef {
  name: string;
  run: (seed: string) => Row;
  /** named analyses over the collected samples */
  analyse: (samples: Record<string, number>[], opts: CliOptions, r: number) => Record<string, unknown>;
}

function pairedAnalysis(
  rows: Record<string, number>[],
  key: string,
  aPick: (s: Record<string, number>) => number,
  bPick: (s: Record<string, number>) => number,
  opts: CliOptions,
  r: number,
): Record<string, unknown> {
  const a = rows.map(aPick);
  const b = rows.map(bPick);
  const diff = rows.map((_, i) => a[i]! - b[i]!);
  const ci = bootstrapCI(diff, { r, samples: opts.bootstrapSamples });
  const p = permutationP(a, b, { r: r + 1, permutations: opts.permutations });
  const dz = cohensD(diff, diff.map(() => 0));
  const fracPos = diff.filter((d) => d > 0).length / diff.length;
  return {
    [`${key}_mean`]: mean(diff),
    [`${key}_sd`]: stdev(diff),
    [`${key}_median`]: median(diff),
    [`${key}_ci95`]: [ci.lo, ci.hi],
    [`${key}_se`]: ci.se,
    [`${key}_p_permutation`]: p,
    [`${key}_cohens_d`]: dz,
    [`${key}_effect`]: effectLabel(dz),
    [`${key}_frac_positive`]: fracPos,
  };
}

const SCENARIOS: Record<string, ScenarioDef> = {
  'first-order': {
    name: 'first-order',
    run: (seed) => {
      const r = runFirstOrder(seed);
      return {
        seed,
        a_energy: r.aEnergy,
        b_energy: r.bEnergy,
        gap: r.gap,
        a_alive: r.aAlive ? 1 : 0,
        b_alive: r.bAlive ? 1 : 0,
        rich_cap: r.richCap,
        poor_cap: r.poorCap,
      };
    },
    analyse: (rows, opts, r) => {
      const gaps = rows.map((s) => s.gap);
      const ci = bootstrapCI(gaps, { r, samples: opts.bootstrapSamples });
      const p = permutationP(rows.map((s) => s.a_energy), rows.map((s) => s.b_energy), { r: r + 1, permutations: opts.permutations });
      const dz = cohensD(gaps, gaps.map(() => 0));
      const w = wilsonCI(rows.filter((s) => s.gap > 0).length, rows.length);
      return {
        gap_mean: mean(gaps),
        gap_sd: stdev(gaps),
        gap_median: median(gaps),
        gap_ci95: [ci.lo, ci.hi],
        gap_se: ci.se,
        gap_p_permutation: p,
        gap_cohens_d: dz,
        gap_effect: effectLabel(dz),
        gap_frac_positive: w.p,
        gap_positive_ci95: [w.lo, w.hi],
      };
    },
  },
  'second-order': {
    name: 'second-order',
    run: (seed) => {
      const r = runSecondOrder(seed);
      return {
        seed,
        completed: r.completed ? 1 : 0,
        kills: r.kills,
        completed_at: r.completedAt,
        prey1_alive: r.prey1Alive ? 1 : 0,
        prey2_alive: r.prey2Alive ? 1 : 0,
        pred_alive: r.predAlive ? 1 : 0,
        cell_cap: r.cellCap,
      };
    },
    analyse: (rows, opts, r) => {
      const n = rows.length;
      const k = rows.filter((s) => s.completed === 1).length;
      const w = wilsonCI(k, n);
      const times = rows.map((s) => s.completed_at).filter((t) => t !== null && t !== undefined);
      const kills = rows.map((s) => s.kills);
      const tCI = bootstrapCI(times, { r, samples: opts.bootstrapSamples });
      return {
        completion_rate: k / n,
        completion_ci95: [w.lo, w.hi],
        completion_k: k,
        completion_n: n,
        completion_mean_tick: times.length ? mean(times) : null,
        completion_median_tick: times.length ? median(times) : null,
        completion_tick_ci95: times.length ? [tCI.lo, tCI.hi] : null,
        kills_mean: mean(kills),
        kills_median: median(kills),
      };
    },
  },
  'third-order': {
    name: 'third-order',
    run: (seed) => {
      const r = runThirdOrder(seed);
      return {
        seed,
        control_growth: r.controlGrowth,
        carrion_growth: r.carrionGrowth,
        growth_delta: r.growthDelta,
        control_minerals: r.controlMinerals,
        carrion_minerals: r.carrionMinerals,
        mineral_delta: r.mineralDelta,
        cell_cap: r.cellCap,
      };
    },
    analyse: (rows, opts, r) => {
      const growth = pairedAnalysis(rows, 'growth', (s) => s.carrion_growth, (s) => s.control_growth, opts, r);
      const minerals = pairedAnalysis(rows, 'minerals', (s) => s.carrion_minerals, (s) => s.control_minerals, opts, r);
      return { ...growth, ...minerals };
    },
  },
  conservation: {
    name: 'conservation',
    run: (seed) => {
      const r = runConservation(seed);
      return {
        seed,
        injected: r.injected,
        meat_decayed: r.meatDecayed,
        expected_decay: r.expectedDecay,
        mineral_gained: r.mineralGained,
        expected_mineral_gain: r.expectedMineralGain,
        meat_error: r.meatError,
        mineral_error: r.mineralError,
      };
    },
    analyse: (rows, opts, r) => {
      const meatErr = bootstrapCI(rows.map((s) => s.meat_error), { r, samples: opts.bootstrapSamples });
      const minErr = bootstrapCI(rows.map((s) => s.mineral_error), { r: r + 1, samples: opts.bootstrapSamples });
      const maxMeatErr = Math.max(...rows.map((s) => Math.abs(s.meat_error)));
      const maxMinErr = Math.max(...rows.map((s) => Math.abs(s.mineral_error)));
      return {
        meat_error_mean: meatErr.mean,
        meat_error_ci95: [meatErr.lo, meatErr.hi],
        meat_error_max_abs: maxMeatErr,
        mineral_error_mean: minErr.mean,
        mineral_error_ci95: [minErr.lo, minErr.hi],
        mineral_error_max_abs: maxMinErr,
      };
    },
  },
  stochastic: {
    name: 'stochastic',
    run: (seed) => {
      const r = runStochastic(seed);
      return {
        seed,
        n_ticks: r.ticks,
        control_alive: r.controlAlive,
        stoch_alive: r.stochAlive,
        delta_alive: r.deltaAlive,
        control_energy: r.controlEnergy,
        stoch_energy: r.stochEnergy,
        delta_energy: r.deltaEnergy,
        control_plasticity: r.controlPlasticity,
        stoch_plasticity: r.stochPlasticity,
        delta_plasticity: r.deltaPlasticity,
        control_surprise: r.controlSurprise,
        stoch_surprise: r.stochSurprise,
        delta_surprise: r.deltaSurprise,
        control_food_cv: r.controlFoodCv,
        stoch_food_cv: r.stochFoodCv,
        delta_food_cv: r.deltaFoodCv,
        stoch_explore: r.stochExploreFrac,
        stoch_weather: r.stochWeatherFrac,
      };
    },
    analyse: (rows, opts, r) => {
      const alive = pairedAnalysis(rows, 'alive', (s) => s.stoch_alive, (s) => s.control_alive, opts, r);
      const energy = pairedAnalysis(rows, 'energy', (s) => s.stoch_energy, (s) => s.control_energy, opts, r + 1);
      const plasticity = pairedAnalysis(rows, 'plasticity', (s) => s.stoch_plasticity, (s) => s.control_plasticity, opts, r + 2);
      const food = pairedAnalysis(rows, 'food_cv', (s) => s.stoch_food_cv, (s) => s.control_food_cv, opts, r + 3);
      const explore = rows.map((s) => s.stoch_explore);
      const weather = rows.map((s) => s.stoch_weather);
      return {
        ...alive,
        ...energy,
        ...plasticity,
        ...food,
        explore_frac_mean: mean(explore),
        explore_frac_min: Math.min(...explore),
        explore_frac_max: Math.max(...explore),
        weather_frac_mean: mean(weather),
        weather_frac_min: Math.min(...weather),
        weather_frac_max: Math.max(...weather),
      };
    },
  },
};

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

export function run(opts: CliOptions): void {
  const prov = provenance(opts);
  const started = Date.now();
  const report: { provenance: Record<string, unknown>; determinism?: Record<string, { seed: string; matched: boolean; hash: string }[]>; scenarios: Record<string, { n: number; elapsedMs: number; avgMsPerSeed: number; stats: Record<string, unknown> }>; totalMs: number } = {
    provenance: prov,
    scenarios: {},
    totalMs: 0,
  };
  mkdirSync(opts.outDir, { recursive: true });

  // determinism fingerprints first (whole-world bit-for-bit on a fresh engine)
  const determinism: Record<string, { seed: string; matched: boolean; hash: string }[]> = {};
  for (const name of opts.scenarios) {
    if (!(name in SCENARIOS)) throw new Error(`unknown scenario: ${name}`);
    if (name === 'conservation') continue;
    determinism[name] = opts.seeds.slice(0, opts.determinismSeeds).map((seed) => {
      const d = determinismCheck(name as 'first-order' | 'second-order' | 'third-order' | 'stochastic', seed);
      return { seed, matched: d.matched, hash: d.hash };
    });
  }
  report.determinism = determinism;

  // one csv file per scenario: header from union of columns
  for (const name of opts.scenarios) {
    const def = SCENARIOS[name]!;
    const rows: Row[] = [];
    const t0 = Date.now();
    for (const seed of opts.seeds) {
      const row = def.run(seed);
      rows.push({ scenario: name, ...row });
    }
    const elapsed = Date.now() - t0;
    const numeric = rows.map((row) => Object.fromEntries(Object.entries(row).filter(([k]) => k !== 'seed' && k !== 'scenario')) as Record<string, number>);
    const stats = def.analyse(numeric, opts, 0xC0FFEE);

    report.scenarios[name] = {
      n: rows.length,
      elapsedMs: elapsed,
      avgMsPerSeed: elapsed / rows.length,
      stats,
    };

    if (opts.json) {
      writeFileSync(
        join(opts.outDir, `${name}.json`),
        JSON.stringify({ provenance: prov, rows, stats }, null, 2),
      );
    }
    if (opts.csv) {
      writeFileSync(join(opts.outDir, `${name}.csv`), rowsToCsv(rows));
    }
    if (opts.md) {
      writeFileSync(join(opts.outDir, `${name}.md`), rowsToMd(name, rows, stats));
    }

    console.log(`[${name}] ${rows.length} seeds in ${elapsed}ms (${(elapsed / rows.length).toFixed(1)}ms/seed)`);
  }

  const totalMs = Date.now() - started;
  report.totalMs = totalMs;
  if (opts.json) writeFileSync(join(opts.outDir, 'report.json'), JSON.stringify(report, null, 2));
  if (opts.md) writeFileSync(join(opts.outDir, 'README.md'), reportToMd(report));

  if (opts.forecast > 0) {
    const forecast = runForecast(opts);
    if (opts.json) writeFileSync(join(opts.outDir, 'forecast.json'), JSON.stringify(forecast, null, 2));
    console.log(`\n[forecast] ${opts.forecast} ticks ahead over ${forecast.series.join(', ')} — trained on first 3/4, held-out error:`);
    for (const [s, b] of Object.entries(forecast.bands)) {
      const ev = forecast.eval?.[s];
      console.log(`  ${s}: trend ${fmt(b.trend)} (lo ${fmt(b.lo)}, hi ${fmt(b.hi)})${ev ? ` | held-out MAE ${fmt(ev.mae, 4)}` : ''}`);
    }
  }

  console.log(`\nwrote ${opts.json ? 'report.json, ' : ''}${opts.csv ? 'csv per scenario, ' : ''}${opts.md ? 'README.md + per-scenario .md, ' : ''}to ${opts.outDir}`);
  console.log(`total ${totalMs}ms`);
}

// ---------------------------------------------------------------------------
// Neural forecast with held-out evaluation
// ---------------------------------------------------------------------------

/**
 * Runs one unscripted ladder trajectory, trains the forecast network on the
 * first 3/4 of it, then extrapolates the remaining `horizon` ticks and compares
 * against the held-out ground truth. Returns the forecasted bands plus the
 * mean-absolute-error per series over the hold-out window.
 */
function runForecast(opts: CliOptions): ForecastResult & { eval?: Record<string, { mae: number }> } {
  const horizon = opts.forecast;
  const ticks = Math.max(400, horizon * 40);
  const traj = runLadder({
    seed: opts.seeds[0] ?? 'research-seed-0001',
    ticks,
    spawnCount: 120,
    maxPopulation: 800,
    sampleEvery: 1,
  }).trajectory.map((p) => ({ ...p }));

  const series = opts.forecastSeries.filter((s) => s in (traj[0] ?? {}));
  const split = Math.floor((traj.length * 3) / 4);
  const train = traj.slice(0, split);
  const holdout = traj.slice(split);

  const fc = new TrendForecaster({
    series,
    window: Math.min(24, Math.max(3, split - 1)),
    hidden: 12,
    lr: 0.05,
    horizon,
    seed: 0x5eed,
  });
  for (const row of train) fc.observe(row.tick, row);
  const forecast = fc.forecast();

  // score the last `horizon` held-out points against the network's rolling
  // predictions (refit-free: pure extrapolation quality check)
  const evalBySeries: Record<string, { mae: number }> = {};
  for (const s of series) {
    const preds = forecast.steps.map((st) => st.values[s]!);
    const actuals = holdout.slice(0, Math.min(horizon, holdout.length)).map((r) => (r as unknown as Record<string, number>)[s] ?? 0);
    const n = Math.min(preds.length, actuals.length);
    const mae = n > 0 ? actuals.slice(0, n).reduce((acc, v, i) => acc + Math.abs(v - preds[i]!), 0) / n : 0;
    evalBySeries[s] = { mae };
  }

  return { ...forecast, eval: evalBySeries };
}

function rowsToCsv(rows: Row[]): string {
  const headers = Object.keys(rows[0] ?? {});
  const lines = [headers.join(',')];
  for (const row of rows) {
    lines.push(headers.map((h) => csvCell(row[h])).join(','));
  }
  return lines.join('\n') + '\n';
}

function csvCell(v: unknown): string {
  if (typeof v === 'boolean') return v ? '1' : '0';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '';
  return String(v);
}

function rowsToMd(name: string, rows: Row[], stats: Record<string, unknown>): string {
  const headers = Object.keys(rows[0] ?? {});
  const lines: string[] = [`# ${name}`, '', '| ' + headers.join(' | ') + ' |', '|' + headers.map(() => '---').join('|') + '|'];
  for (const row of rows) {
    lines.push('| ' + headers.map((h) => fmtCell(row[h])).join(' | ') + ' |');
  }
  lines.push('', '## Summary', '', '```json', JSON.stringify(stats, null, 2), '```', '');
  return lines.join('\n');
}

function fmtCell(v: unknown): string {
  if (typeof v === 'boolean') return v ? '1' : '0';
  if (typeof v === 'number') return Number.isFinite(v) ? fmt(v) : '—';
  return String(v);
}

function reportToMd(report: Record<string, unknown>): string {
  const prov = report.provenance as Record<string, unknown>;
  const lines: string[] = [
    '# Fractal Life — research report',
    '',
    `- tool: \`${prov.tool}\``,
    `- timestamp: \`${prov.timestamp}\``,
    `- node: \`${prov.node}\` (\`${prov.platform}\`)`,
    `- package: \`${prov.simulationPackage}\``,
    `- engine sha256: \`${(prov.engineSource as { sha256: string }).sha256.slice(0, 16)}…\``,
    `- git: \`${prov.git ?? 'n/a (no repo)'}\``,
    `- seeds: ${(prov.seeds as string[]).length}`,
    `- scenarios: ${(prov.scenarios as string[]).join(', ')}`,
    '',
  ];
  const determinism = report.determinism as Record<string, { matched: boolean; hash: string }[]>;
  for (const [name, runs] of Object.entries(determinism)) {
    const ok = runs.every((r) => r.matched);
    lines.push(`## Determinism: ${name}`, '', `All ${runs.length} seeds reproduced identical world fingerprints: **${ok ? 'PASS' : 'FAIL'}**.`, '');
  }
  const scenarios = report.scenarios as Record<string, { n: number; avgMsPerSeed: number; stats: Record<string, unknown> }>;
  for (const [name, s] of Object.entries(scenarios)) {
    lines.push(`## ${name}`, '', `n = ${s.n} seeds, avg ${s.avgMsPerSeed.toFixed(1)} ms/seed`, '', '```json', JSON.stringify(s.stats, null, 2), '```', '');
  }
  lines.push(`## Total`, '', `${(report.totalMs as number)} ms`, '');
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Entrypoint
// ---------------------------------------------------------------------------

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('cli.ts')) {
  try {
    run(parseArgs(process.argv.slice(2)));
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }
}
