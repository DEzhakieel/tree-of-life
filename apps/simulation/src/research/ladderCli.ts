import { writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runLadder, type LadderResult } from './ladder.js';
import type { BrainConfig } from '../brain.js';
import { loadEnrichmentRaw } from '../grounding/index.js';
import { forecastSeries, type ForecastResult } from '../forecast.js';
import { fmt } from './stats.js';
import { UNIVERSE_EARTH_LIKE, UNIVERSE_LUNA, UNIVERSE_MARS, type UniverseConfig } from '@fractal-life/shared';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..', '..', '..');
const DEFAULT_OUT = resolve(ROOT, 'apps', 'simulation', 'research', 'ladder');

const UNIVERSE_PRESETS: Record<'off' | 'earth' | 'moon' | 'mars', UniverseConfig | undefined> = {
  off: undefined,
  earth: UNIVERSE_EARTH_LIKE,
  moon: UNIVERSE_LUNA,
  mars: UNIVERSE_MARS,
};

interface CliOptions {
  seed: string;
  ticks: number;
  spawn: number;
  maxPop: number;
  sampleEvery: number;
  outDir: string;
  json: boolean;
  csv: boolean;
  md: boolean;
  ground: boolean;
  /** horizon steps to neural-forecast the trajectory (0 = off) */
  forecast: number;
  forecastSeries: string[];
  /** brain paradigm — see ladder.ts LadderOptions.brain */
  brain?: Partial<BrainConfig>;
  /** stochastic world — see ladder.ts LadderOptions.worldStoch */
  worldStoch?: boolean;
  /** deep cell biochemistry (WorldConfig.cellBio) */
  cellBio?: boolean;
  /** physics frame preset (WorldConfig.universe) */
  universe?: 'off' | 'earth' | 'moon' | 'mars';
  /** Gaussian policy tunables (used with --policy) */
  sigma?: number;
  sigmaMin?: number;
  annealTicks?: number;
}

function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = {
    seed: 'ladder-seed-0001',
    ticks: 12000,
    spawn: 150,
    maxPop: 1000,
    sampleEvery: 30,
    outDir: DEFAULT_OUT,
    json: true,
    csv: true,
    md: true,
    ground: false,
    cellBio: false,
    universe: 'off',
    forecast: 0,
    forecastSeries: ['alive', 'avgEnergy', 'complexity', 'entropy'],
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
      case '--forecast':
        opts.forecast = parseInt(next(), 10);
        break;
      case '--forecast-series':
        opts.forecastSeries = next().split(',').map((s) => s.trim()).filter(Boolean);
        break;
      case '--out':
      case '-o':
        opts.outDir = resolve(next());
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
      case '--ground':
        opts.ground = true;
        break;
      case '--learn': {
        const v = next();
        if (v !== 'hebbian' && v !== 'backprop') {
          console.error(`invalid --learn value: ${v} (expected 'hebbian' | 'backprop')`);
          process.exit(2);
        }
        opts.brain = { enabled: true, learn: v };
        break;
      }
      case '--policy':
        opts.brain = { ...opts.brain, enabled: true, policy: { mode: 'gaussian', sigma: 0.35, sigmaMin: 0.05, annealTicks: 0 } };
        break;
      case '--pomdp':
        opts.brain = { ...opts.brain, enabled: true, pomdp: { enabled: true } };
        break;
      case '--dropout':
        opts.brain = { ...opts.brain, enabled: true, dropout: parseFloat(next()) };
        break;
      case '--grad-noise':
        opts.brain = { ...opts.brain, enabled: true, gradNoise: parseFloat(next()) };
        break;
      case '--entropy':
        opts.brain = { ...opts.brain, enabled: true, entropy: parseFloat(next()) };
        break;
      case '--sigma':
        opts.sigma = parseFloat(next());
        break;
      case '--sigma-min':
        opts.sigmaMin = parseFloat(next());
        break;
      case '--anneal-ticks':
        opts.annealTicks = parseInt(next(), 10);
        break;
      case '--world-stoch':
        opts.worldStoch = true;
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
      case '--help':
      case '-h':
        console.log(help());
        process.exit(0);
      default:
        console.error(`unknown option: ${a}`);
        process.exit(2);
    }
  }
  if (opts.brain?.policy) {
    opts.brain.policy.sigma = opts.sigma ?? 0.35;
    opts.brain.policy.sigmaMin = opts.sigmaMin ?? 0.05;
    opts.brain.policy.annealTicks = opts.annealTicks ?? opts.ticks;
  }
  return opts;
}

function help(): string {
  return `fractal-life emergence ladder

Runs one long, unscripted simulation and measures — with public engine state
only — how far up the emergence ladder it climbs:

  L1 life         self-sustaining population, reproduction, matter cycling
  L2 interaction  speciation + predation / cooperation
  L3 cognition    gradient foraging, hazard response, communication, culture,
                  selection-driven adaptation

Also re-runs the validated controlled scenarios (first/second/third-order,
conservation, determinism) for the same seed as mechanistic evidence.

Usage:
  tsx src/research/ladderCli.ts [options]

Options:
      --seed S            world seed (default ladder-seed-0001)
      --ticks N           simulation length in ticks (default 12000)
      --spawn N           founder population (default 150)
      --max-pop N         population cap (default 1000)
      --sample-every N    trajectory sampling interval (default 30)
      --ground            ground the run with real data from data/enrichment.json
                          (PubChem molecules, GBIF ecology, Kazusa codon usage)
      --forecast N        neural-forecast the trajectory N ticks ahead (default off)
      --forecast-series L comma-separated observables to forecast (default
                          alive,avgEnergy,complexity,entropy)

  Brain paradigm (default: plain hebbian, the historical baseline):
      --learn L           'hebbian' | 'backprop' (gradient descent on the TD error)
      --policy            stochastic Gaussian policy head (anneals sigma -> sigma-min
                          over the run; overridable via --sigma/--sigma-min/--anneal-ticks)
      --pomdp             partially-observable sensor model with belief blending
      --dropout N         backprop hidden-unit dropout probability (0..1)
      --grad-noise N      std of gradient noise added to backprop updates
      --entropy N         entropy bonus on the policy's motor heads
      --sigma N           initial policy noise (default 0.35)
      --sigma-min N       annealed noise floor (default 0.05)
      --anneal-ticks N    sigma annealing length (default: full run)
      --world-stoch       stochastic world: Markov weather, OU resources,
                          Poisson batch bursts (scenarios defaults 60/0.01/0.03/0.3)

  World chemistry & physics:
      --cell-bio          opt-in deep cell biochemistry: protein folding,
                          membranes, concentration gradients, MM kinetics
      --universe U        physics frame preset: 'off' (legacy) | 'earth' | 'moon' |
                          'mars' — real climb costs, escape-velocity cap, drag,
                          seasons derived from the chosen body

  -o, --out DIR           output directory (default apps/simulation/research/ladder)
      --no-json/--no-csv/--no-md
  -h, --help
`;
}

function rowsToCsv(traj: LadderResult['trajectory']): string {
  const headers = Object.keys(traj[0] ?? {});
  const lines = [headers.join(',')];
  for (const row of traj) {
    lines.push(headers.map((h) => (typeof row[h as keyof typeof row] === 'number' ? (row[h as keyof typeof row] as number).toString() : String(row[h as keyof typeof row]))).join(','));
  }
  return lines.join('\n') + '\n';
}

function reportToMd(r: LadderResult): string {
  const s = r.summary;
  const lines: string[] = [];
  const p = r.provenance;

  lines.push('# How does life, then intelligence, emerge?', '');
  lines.push(
    `_Evidence from one deterministic run_ — seed \`${r.options.seed}\`, ${r.options.ticks} ticks, ` +
      `${r.options.spawnCount} founders, max population ${r.options.maxPopulation}, sampled every ${r.options.sampleEvery} ticks. ` +
      `engine \`${String(p.engineSourceSha256).slice(0, 12)}…\`, node ${String(p.node)} (${String(p.platform)}), ${String(p.timestamp)}.`,
  );

  const brain = r.options.brain;
  if (brain && brain.learn !== undefined) {
    const parts: string[] = [brain.learn ?? 'hebbian'];
    if (brain.policy) parts.push(`policy σ=${brain.policy.sigma}→${brain.policy.sigmaMin} over ${brain.policy.annealTicks}t`);
    if (brain.pomdp) parts.push('pomdp');
    if (brain.dropout) parts.push(`dropout ${brain.dropout}`);
    if (brain.entropy) parts.push(`entropy ${brain.entropy}`);
    if (brain.gradNoise) parts.push(`grad-noise ${brain.gradNoise}`);
    lines.push(`_Brain paradigm: **${parts.join(' + ')}**_${r.options.worldStoch ? ' on a **stochastic world** (Markov weather, OU resources, Poisson bursts)' : ''}.`);
    lines.push('');
  }

  const worldMods: string[] = [];
  if (r.options.cellBio) worldMods.push('**deep cell biochemistry**');
  if (r.options.universe) {
    const g = r.options.universe.localGravity;
    worldMods.push(`physics frame ${g !== undefined ? `**${g.toFixed(2)} g**` : '**custom**'}`);
  }
  if (worldMods.length > 0) {
    lines.push(`_World chemistry/physics_: ${worldMods.join(' + ')}.`);
    lines.push('');
  }

  lines.push('');
  const ground = p.grounded as { sources: { name: string; license?: string }[]; species: string[] } | undefined;
  if (ground) {
    lines.push(
      '**Grounded with real open data** — ' +
        ground.sources.map((s) => s.name).join(' + ') +
        `. Community priors from: ${ground.species.join(', ')}.`,
      '',
    );
  }

  // L0
  lines.push('## Level 0 — matter exists and cycles', '');
  lines.push(
    `The world is a closed material box: plants (food), carrion (meat) and soil minerals move matter between pools. ` +
      `The conservation scenario proves the accounting is exact: ` +
      `decayed carrion matched its theoretical value to within ${fmt(r.controlled.conservation.meatError)} (minerals to within ${fmt(r.controlled.conservation.mineralError)}). ` +
      `In the open run, global matter (food+meat+minerals) varied with coefficient of variation ${fmt(s.life.matterCV)} — ` +
      `${s.life.cycling ? 'the pools demonstrably flowed' : 'the pools barely moved'}.`,
  );
  lines.push('');

  // L1
  lines.push('## Level 1 — life: a self-sustaining subsystem', '');
  lines.push(
    `A population is "alive" here if it persists, reproduces, holds energy/water homeostasis, and keeps matter flowing through it. ` +
      `In this run: final population ${s.life.finalAlive} (min ${s.life.minAlive}, max ${s.life.maxAlive}), ` +
      `${s.life.totalBirths} births vs ${s.life.totalDeaths} deaths (net ${s.life.netBirths}), reproduction rate ${fmt(s.life.reproductionRate)}. ` +
      `Mean energy ${fmt(s.life.avgEnergyMean)} with CV ${fmt(s.life.avgEnergyCV)}. ` +
      `Carrion (the death→soil loop) was present: ${s.life.carrionLoop}.`,
  );
  lines.push('');
  lines.push(`**${synthesisLine(r.synthesis.levels[0])}**`, '');

  // L2
  lines.push('## Level 2 — interaction: individuals become an ecology', '');
  lines.push(
    `Agents act on local sensory information (they cannot see the world state). Differentiation and interaction are the emergent result: ` +
      `up to ${s.interaction.maxSpecies} species coexisted (final ${s.interaction.finalSpecies}), ` +
      `carnivore share reached ${fmt(s.interaction.maxPredatorFraction)} and cooperation (greenbeard donation) reached ${fmt(s.interaction.maxCooperation)} of energy flow. ` +
      `The controlled scenarios isolate the mechanisms: a predator hunts and starves in a boom/bust (kills ${r.controlled.secondOrder.kills}, completed ${r.controlled.secondOrder.completed}), ` +
      `and a rich-vs-poor habitat pair shows the energy gap (${fmt(r.controlled.firstOrder.gap)} energy units) that lets differentiated niches form.`,
  );
  lines.push('');
  lines.push(`**${synthesisLine(r.synthesis.levels[1])}**`, '');

  // L3
  lines.push('## Level 3 — cognition: information processing for survival', '');
  lines.push(
    `Each agent runs a 15-sensor → MLP → 7-output brain. "Cognition" is measured behaviourally, not by fiat:`,
  );
  lines.push('');
  lines.push(`- **Goal-directed foraging** — mean cosine between velocity and the food gradient: ${fmt(r.summary.cognition.foragingMean)} (positive in ${fmt(r.summary.cognition.foragingPositiveFrac)} of samples).`);
  lines.push(`- **Hazard response** — corr(speed, local hazard): ${fmt(r.summary.cognition.hazardCorr)} (negative = danger avoidance).`);
  lines.push(`- **Reaction to signals** — corr(speed, local pheromone): ${fmt(r.summary.cognition.signalCorr)}.`);
  lines.push(`- **Behavioural repertoire** — entropy of the velocity-heading distribution: ${fmt(r.summary.cognition.headingEntropyMean)} bits.`);
  lines.push(`- **Communication field** — mean pheromone energy ${fmt(r.summary.cognition.signalTotalMean)}, up to ${r.summary.cognition.signalCellsMax} cells holding signal.`);
  lines.push(`- **Cultural memory** — up to ${r.summary.cognition.cultureCountMax} meme tags (meme entropy ${fmt(r.summary.cognition.memeEntropyMax)} bits), tied to lineage at MI ${fmt(r.summary.cognition.speciesMemeMIMax)}.`);
  lines.push(`- **Adaptation** — mean lifetime energy acquired rose from ${fmt(r.summary.cognition.fitnessFirstQ)} (first quarter) to ${fmt(r.summary.cognition.fitnessLastQ)} (last quarter): ${fmt(r.summary.cognition.adaptationFrac * 100)}%.`);
  lines.push('');
  lines.push(`**${synthesisLine(r.synthesis.levels[2])}**`, '');

  // chain
  lines.push('## The causal chain', '');
  lines.push(r.synthesis.chain, '');
  lines.push('', '## Full trajectory', '');
  lines.push('| tick | alive | species | births | deaths | entropy | complexity | foraging | hazardCorr | signalCorr | fitness |', '');
  lines.push('|---|---|---|---|---|---|---|---|---|---|---|');
  for (const t of r.trajectory) {
    lines.push(
      `| ${t.tick} | ${t.alive} | ${t.species} | ${t.birthsRun} | ${t.deathsRun} | ${fmt(t.entropy, 2)} | ${fmt(t.complexity, 2)} | ${fmt(t.foragingMean, 3)} | ${fmt(t.hazardCorr, 2)} | ${fmt(t.signalCorr, 2)} | ${fmt(t.fitnessMean, 1)} |`,
    );
  }
  lines.push('');
  return lines.join('\n');
}

function synthesisLine(v: LadderResult['synthesis']['levels'][number]): string {
  return `Verdict: **${v.verdict}** — ${v.note}`;
}

function fmtMetric(v: number): string {
  if (Math.abs(v) < 0.01 && v !== 0) return fmt(v, 6);
  return fmt(v);
}

export function run(opts: CliOptions): void {
  const t0 = Date.now();
  mkdirSync(opts.outDir, { recursive: true });
  const grounding = opts.ground ? loadEnrichmentRaw() : undefined;
  if (opts.ground && !grounding) {
    console.error('--ground requested but enrichment snapshot missing/invalid. Run `npm run enrich` first.');
    process.exit(1);
  }
  const result = runLadder({
    seed: opts.seed,
    ticks: opts.ticks,
    spawnCount: opts.spawn,
    maxPopulation: opts.maxPop,
    sampleEvery: opts.sampleEvery,
    grounding: grounding ?? undefined,
    brain: opts.brain,
    cellBio: opts.cellBio,
    universe: UNIVERSE_PRESETS[opts.universe ?? 'off'],
    worldStoch: opts.worldStoch
      ? { enabled: true, poissonRate: 60, ouTheta: 0.01, ouSigma: 0.03, ouBand: 0.3 }
      : undefined,
  });
  const elapsed = Date.now() - t0;

  if (opts.json) writeFileSync(join(opts.outDir, 'ladder-report.json'), JSON.stringify(result, null, 2));
  if (opts.csv) writeFileSync(join(opts.outDir, 'ladder-trajectory.csv'), rowsToCsv(result.trajectory));
  if (opts.md) writeFileSync(join(opts.outDir, 'ladder-report.md'), reportToMd(result));

  console.log(`ran ${opts.ticks} ticks in ${elapsed}ms (${(elapsed / opts.ticks).toFixed(2)} ms/tick)`);
  for (const v of result.synthesis.levels) {
    console.log(`  ${v.level}: ${v.verdict}`);
  }
  console.log(`  chain: ${result.synthesis.chain}`);
  console.log(`  fitness ${fmtMetric(result.summary.cognition.fitnessFirstQ)} -> ${fmtMetric(result.summary.cognition.fitnessLastQ)} (adaptation ${fmt(result.summary.cognition.adaptationFrac * 100, 1)}%)`);

  if (opts.forecast > 0) {
    const series = opts.forecastSeries.filter((s) => s in (result.trajectory[0] ?? {}));
    const fc = forecastSeries(
      result.trajectory.map((p) => ({ ...p })),
      series,
      { horizon: opts.forecast, seed: 0x5eed },
    );
    if (opts.json) writeFileSync(join(opts.outDir, 'forecast.json'), JSON.stringify(fc, null, 2));
    console.log(`  forecast ${opts.forecast} ticks ahead (series: ${series.join(', ')}), norm-mse ${fmt(fc.loss)}:`);
    for (const [s, b] of Object.entries(fc.bands)) {
      console.log(`    ${s}: ${fmt(b.lo)} .. ${fmt(b.hi)} (trend ${fmt(b.trend)})`);
    }
  }

  console.log(`wrote outputs to ${opts.outDir}`);
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('ladderCli.ts')) {
  try {
    run(parseArgs(process.argv.slice(2)));
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }
}
