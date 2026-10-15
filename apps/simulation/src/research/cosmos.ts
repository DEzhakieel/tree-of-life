import {
  DEFAULT_PARAMS,
  ENV_PROFILES,
  fnv1a32,
  UNIVERSE_EARTH_LIKE,
  UNIVERSE_LUNA,
  UNIVERSE_MARS,
  type EnvironmentPreset,
  type Intervention,
  type UniverseConfig,
  type WorldTopology,
} from '@fractal-life/shared';
import { Engine } from '../engine.js';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Phase M+ cosmos harness. Sweeps the axes that define a WORLD rather than its
 * terrain: universe constants (escape window, time, day length, world scale),
 * energy levels (metabolism, bank), constraints (founders, population cap),
 * physical laws (real gravity / atmosphere / insolation vs legacy), supply and
 * destruction (food regen), and treatment / black-swan events (meteor, famine,
 * toxin storm, nutrient bounty, total nuke) with a recovery readout. A set of
 * "equilibria" runs tracks the full population time-series to measure whether —
 * and how stably — the colony settles.
 *
 * Determinism: identical construction rules to `environments.ts` — the habitat
 * window depends only on (seed, biome), every draw comes from the seed stream,
 * agents iterate in ascending id order, and interventions fire at a fixed tick.
 */

const HABITAT_JITTER = 0.6;
const TICKS = 240;
const SPAWN = 40;
const SEED = 'env-experiment';
const EVENT_AT = 80;
const SWAN_TICKS = 300;

const outputDir = fileURLToPath(new URL('../../research/output/', import.meta.url));

export type CosmosAxis =
  | 'universeConstants'
  | 'energy'
  | 'constraints'
  | 'laws'
  | 'supply'
  | 'blackswan'
  | 'controls'
  | 'equilibria';

export type CosmosEvent = 'none' | 'meteor' | 'famine' | 'storm' | 'bounty' | 'nuke';

export interface CosmosOutcome {
  axis: CosmosAxis;
  knob: string;
  value: string;
  replicate: string;
  environment: EnvironmentPreset;
  topology: WorldTopology;
  ticks: number;
  spawn: number;
  alive: number;
  growth: number;
  species: number;
  births: number;
  deaths: number;
  escapeDeaths: number;
  meanFitness: number;
  meanATP: number;
  terrainO2: number;
  terrainPH: number;
  terrainToxin: number;
  entropy: number;
  diversity: number;
  complexity: number;
  endFood: number;
  /** alive-count time-series (n = ticks + 1 samples, pre-tick each step). */
  series: number[];
  seriesCv: number;
  lateCv: number;
  /** linear-trend slope (alive per tick) over the final 40% of the run. */
  settleSlope: number;
  event: CosmosEvent;
  eventAt: number;
  aliveAtEvent: number;
  minAliveAfter: number;
  /** alive(final) / alive(event) — the recovery readout (0 if no event). */
  recoveryFrac: number;
  /** ticks from event to ≥ 50% of aliveAtEvent, or -1 if not reached. */
  recoveryTick: number;
}

export interface CosmosSpec {
  axis: CosmosAxis;
  knob: string;
  value: string;
  environment?: EnvironmentPreset;
  topology?: WorldTopology;
  overrides?: Partial<typeof DEFAULT_PARAMS>;
  universe?: UniverseConfig;
  seed?: string;
  replicate?: string;
  ticks?: number;
  spawn?: number;
  /** Black-swan event applied after `at` ticks have already run. */
  event?: { type: Exclude<CosmosEvent, 'none'>; at: number; radius?: number; amount?: number };
}

function cv(xs: number[]): number {
  const m = xs.reduce((s, v) => s + v, 0) / xs.length;
  if (m <= 1e-9) return Number.NaN;
  const v = Math.sqrt(xs.reduce((s, x) => s + (x - m) * (x - m), 0) / xs.length);
  return v / m;
}

function slope(xs: number[]): number {
  const n = xs.length;
  if (n < 3) return 0;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < n; i++) {
    sxy += (i - mx) * xs[i]!;
    sxx += (i - mx) * (i - mx);
  }
  return sxx > 0 ? sxy / sxx : 0;
}

/** Live centroid of the alive agents (deterministic: ascending id order). */
function centroid(engine: Engine): { x: number; y: number } {
  let n = 0;
  let sx = 0;
  let sy = 0;
  for (const a of engine.agents.values()) {
    if (!a.alive) continue;
    sx += a.x;
    sy += a.y;
    n++;
  }
  return n > 0 ? { x: sx / n, y: sy / n } : { x: 0, y: 0 };
}

export function runCosmos(spec: CosmosSpec): CosmosOutcome {
  const seed = spec.seed ?? SEED;
  const ticks = spec.ticks ?? (spec.event ? SWAN_TICKS : TICKS);
  const spawn = spec.spawn ?? SPAWN;
  // habitat = f(seed, effective biome) exactly like environments.ts, so a
  // baseline cosmos run is bit-identical to the canonical calm environment run.
  const environment = spec.environment ?? 'calm';
  const parts = [seed, environment];
  const h = fnv1a32(parts.join(':'));
  const u1 = (h >>> 0) / 4294967296;
  const h2 = Math.imul(h, 1103515245) + 12345;
  const u2 = (h2 >>> 0) / 4294967296;
  const jx = (u1 - 0.5) * 2 * HABITAT_JITTER * DEFAULT_PARAMS.worldScale;
  const jy = (u2 - 0.5) * 2 * HABITAT_JITTER * DEFAULT_PARAMS.worldScale;
  const topology = spec.topology ?? 'torus';
  const world: ConstructorParameters<typeof Engine>[0] = {
    id: `cosmos-${spec.axis}-${spec.knob}${spec.replicate ? '-' + spec.replicate : ''}`,
    seed,
    fractalType: 'mandelbrot',
    params: {
      ...DEFAULT_PARAMS,
      spawnCount: spawn,
      centerX: DEFAULT_PARAMS.centerX + jx,
      centerY: DEFAULT_PARAMS.centerY + jy,
      ...spec.overrides,
    },
    createdAt: 0,
    currentTick: 0,
    omics: true,
    omicsStochastic: true,
    combinatorial: true,
    topology,
    environment,
  };
if (spec.universe) world.universe = spec.universe;
  const engine = new Engine(world);
  const series: number[] = [];
  const event = spec.event ? { ...spec.event } : undefined;

  let stats: ReturnType<Engine['tick']> | undefined;
  for (let i = 0; i < ticks; i++) {
    series.push(engine.aliveCount());
    if (event && i === event.at) {
      const t = engine.currentTick;
      switch (event.type) {
        case 'meteor': {
          const c = centroid(engine);
          engine.applyIntervention({ type: 'meteor', x: c.x, y: c.y, radius: event.radius ?? 250, sequence: t });
          break;
        }
        case 'nuke':
          engine.applyIntervention({ type: 'nuke', sequence: t });
          break;
        case 'bounty':
          engine.applyIntervention({ type: 'seedFood', x: centroid(engine).x, y: centroid(engine).y, radius: event.radius ?? 400, amount: event.amount ?? 50, sequence: t });
          break;
        case 'famine':
          for (let g = 0; g < engine.grid.food.length; g++) engine.grid.food[g] = engine.grid.food[g]! * 0.05;
          break;
        case 'storm':
          for (let g = 0; g < engine.chemTerrain.toxin.length; g++) engine.chemTerrain.toxin[g] = 0.92;
          break;
      }
    }
    stats = engine.tick();
  }
  series.push(engine.aliveCount());

  const alive = series[series.length - 1]!;
  const s = stats!.stats;
  const aliveAtEvent = event ? series[event.at] ?? 0 : 0;
  const after = event ? series.slice(event.at + 1) : [];
  const minAliveAfter = after.length ? Math.min(...after) : 0;
  const target = aliveAtEvent * 0.5;
  let recoveryTick = -1;
  if (event) {
    for (let j = 0; j < after.length; j++) {
      if (after[j]! >= target) {
        recoveryTick = j + 1;
        break;
      }
    }
  }
  const late = series.slice(Math.floor(series.length * 0.75));
  const endFood = engine.grid.food.reduce((a, b) => a + b, 0) / engine.grid.food.length;

  return {
    axis: spec.axis,
    knob: spec.knob,
    value: spec.value,
    replicate: spec.replicate ?? '-',
    environment,
    topology,
    ticks,
    spawn,
    alive,
    growth: alive - spawn,
    species: s.speciesCount,
    births: s.births,
    deaths: s.deaths,
    escapeDeaths: s.escapeDeaths,
    meanFitness: s.meanFitness,
    meanATP: s.meanATP,
    terrainO2: s.terrainOxygen,
    terrainPH: s.terrainPH,
    terrainToxin: s.terrainToxin,
    entropy: s.entropy,
    diversity: s.diversity,
    complexity: s.complexity,
    endFood,
    series,
    seriesCv: cv(series),
    lateCv: cv(late),
    settleSlope: slope(late),
    event: event?.type ?? 'none',
    eventAt: event?.at ?? 0,
    aliveAtEvent,
    minAliveAfter,
    recoveryFrac: event && aliveAtEvent > 0 ? alive / aliveAtEvent : 0,
    recoveryTick,
  };
}

// ----------------------------------------------------------------------------
// Experiment definitions (breadth = one sampled habitat; low n, high coverage)
// ----------------------------------------------------------------------------

interface BreadthDef {
  axis: CosmosAxis;
  knob: string;
  value: string;
  overrides?: Partial<typeof DEFAULT_PARAMS>;
  universe?: UniverseConfig;
  environment?: EnvironmentPreset;
  topology?: WorldTopology;
}

export const BREADTH_DEFS: BreadthDef[] = [
  // universe constants
  { axis: 'universeConstants', knob: 'escape.small', value: 'escapeRadius=4096', overrides: { escapeRadius: 4096 } },
  { axis: 'universeConstants', knob: 'escape.large', value: 'escapeRadius=16777216', overrides: { escapeRadius: 2 ** 24 } },
  { axis: 'universeConstants', knob: 'time.slow', value: 'timeScale=0.5', overrides: { timeScale: 0.5 } },
  { axis: 'universeConstants', knob: 'time.fast', value: 'timeScale=2', overrides: { timeScale: 2 } },
  { axis: 'universeConstants', knob: 'day.short', value: 'dayLength=600', overrides: { dayLength: 600 } },
  { axis: 'universeConstants', knob: 'day.long', value: 'dayLength=9600', overrides: { dayLength: 9600 } },
  { axis: 'universeConstants', knob: 'world.small', value: 'worldScale=2', overrides: { worldScale: 2 } },
  { axis: 'universeConstants', knob: 'world.big', value: 'worldScale=12', overrides: { worldScale: 12 } },
  // energy levels
  { axis: 'energy', knob: 'meta.low', value: 'metabolismBase=0.5', overrides: { metabolismBase: 0.5 } },
  { axis: 'energy', knob: 'meta.high', value: 'metabolismBase=1.5', overrides: { metabolismBase: 1.5 } },
  { axis: 'energy', knob: 'meta.extreme', value: 'metabolismBase=2.5', overrides: { metabolismBase: 2.5 } },
  { axis: 'energy', knob: 'bank.small', value: 'energyCapacity=25', overrides: { energyCapacity: 25 } },
  { axis: 'energy', knob: 'bank.huge', value: 'energyCapacity=400', overrides: { energyCapacity: 400 } },
  // constraints
  { axis: 'constraints', knob: 'founders.few', value: 'spawnCount=10', overrides: { spawnCount: 10 } },
  { axis: 'constraints', knob: 'founders.many', value: 'spawnCount=160', overrides: { spawnCount: 160 } },
  { axis: 'constraints', knob: 'pop.cap', value: 'maxPopulation=350', overrides: { maxPopulation: 350 } },
  // physical laws
  { axis: 'laws', knob: 'law.earth', value: 'gravity=Earth 9.81 m/s²', universe: UNIVERSE_EARTH_LIKE },
  { axis: 'laws', knob: 'law.mars', value: 'gravity=Mars 3.71 m/s²', universe: UNIVERSE_MARS },
  { axis: 'laws', knob: 'law.moon', value: 'gravity=Luna 1.62 m/s²', universe: UNIVERSE_LUNA },
  // supply and destruction
  { axis: 'supply', knob: 'supply.low', value: 'foodRegenRate=3e-5', overrides: { foodRegenRate: 0.00003 } },
  { axis: 'supply', knob: 'supply.high', value: 'foodRegenRate=3e-3', overrides: { foodRegenRate: 0.003 } },
];

export function runBroadthSweep(): CosmosOutcome[] {
  const baseline: BreadthDef = { axis: 'universeConstants', knob: 'baseline', value: 'defaults' };
  return [baseline, ...BREADTH_DEFS].map((d) =>
    runCosmos({
      axis: d.axis,
      knob: d.knob,
      value: d.value,
      environment: d.environment,
      topology: d.topology,
      overrides: d.overrides,
      universe: d.universe,
    }),
  );
}

// ----------------------------------------------------------------------------
// Replicate families — paired across seeds, same habitat per seed, only the
// knob differs. These give n = 4 per contrast for the Bayesian updates.
// ----------------------------------------------------------------------------

export const REPLICATE_SEEDS = ['rep-1', 'rep-2', 'rep-3', 'rep-4'];

export interface RepFamily {
  axis: CosmosAxis;
  knob: string;
  value: string;
  overrides?: Partial<typeof DEFAULT_PARAMS>;
  universe?: UniverseConfig;
}

export const REP_FAMILIES: RepFamily[] = [
  { axis: 'energy', knob: 'meta.high', value: 'metabolismBase=1.5', overrides: { metabolismBase: 1.5 } },
  { axis: 'energy', knob: 'bank.small', value: 'energyCapacity=25', overrides: { energyCapacity: 25 } },
  { axis: 'supply', knob: 'supply.low', value: 'foodRegenRate=3e-5', overrides: { foodRegenRate: 0.00003 } },
  { axis: 'supply', knob: 'supply.high', value: 'foodRegenRate=3e-3', overrides: { foodRegenRate: 0.003 } },
  { axis: 'laws', knob: 'law.earth', value: 'gravity=Earth 9.81 m/s²', universe: UNIVERSE_EARTH_LIKE },
  { axis: 'universeConstants', knob: 'escape.small', value: 'escapeRadius=4096', overrides: { escapeRadius: 4096 } },
];

export function runCosmosReplicates(): CosmosOutcome[] {
  const out: CosmosOutcome[] = [];
  for (const seed of REPLICATE_SEEDS) {
    // control: same seed, no knob
    out.push(
      runCosmos({
        axis: 'controls',
        knob: 'control',
        value: 'defaults',
        seed,
        replicate: seed,
      }),
    );
    for (const f of REP_FAMILIES) {
      out.push(
        runCosmos({
          axis: f.axis,
          knob: f.knob,
          value: f.value,
          seed,
          replicate: seed,
          overrides: f.overrides,
          universe: f.universe,
        }),
      );
    }
  }
  return out;
}

// Black-swan treatments evaluated on the replicate seeds (n = 4 per treatment).
export const SWAN_EVENTS: { knob: string; value: string; type: Exclude<CosmosEvent, 'none'>; radius?: number; amount?: number }[] = [
  { knob: 'swan.meteor', value: 'meteor r=250 at colony', type: 'meteor', radius: 250 },
  { knob: 'swan.famine', value: 'food ×0.05', type: 'famine' },
  { knob: 'swan.storm', value: 'toxin → 0.92', type: 'storm' },
  { knob: 'swan.bounty', value: 'food +50 r=400', type: 'bounty', radius: 400, amount: 50 },
  { knob: 'swan.nuke', value: 'total cull', type: 'nuke' },
];

export function runBlackSwanSweep(): CosmosOutcome[] {
  const out: CosmosOutcome[] = [];
  for (const seed of REPLICATE_SEEDS) {
    out.push(
      runCosmos({
        axis: 'blackswan',
        knob: 'swan.none',
        value: 'no event',
        seed,
        replicate: seed,
        ticks: SWAN_TICKS,
      }),
    );
    for (const e of SWAN_EVENTS) {
      out.push(
        runCosmos({
          axis: 'blackswan',
          knob: e.knob,
          value: e.value,
          seed,
          replicate: seed,
          ticks: SWAN_TICKS,
          event: { type: e.type, at: EVENT_AT, radius: e.radius, amount: e.amount },
        }),
      );
    }
  }
  return out;
}

// ----------------------------------------------------------------------------
// Equilibria / stability: longer single runs with full time-series.
// ----------------------------------------------------------------------------

const EQ_TICKS = 480;

interface EquilibriumDef {
  knob: string;
  value: string;
  environment: EnvironmentPreset;
  topology: WorldTopology;
}

export function runEquilibriumSweep(): CosmosOutcome[] {
  const defs: EquilibriumDef[] = [
    { knob: 'eq.calmTorus', value: 'calm torus 480t', environment: 'calm', topology: 'torus' },
    { knob: 'eq.calmKlein', value: 'calm kleinBottle 480t', environment: 'calm', topology: 'kleinBottle' },
    { knob: 'eq.hyperthermal', value: 'hyperthermal 480t', environment: 'hyperthermal', topology: 'torus' },
    { knob: 'eq.cryoFrozen', value: 'cryoFrozen 480t', environment: 'cryoFrozen', topology: 'torus' },
  ];
  return defs.map((d) =>
    runCosmos({
      axis: 'equilibria',
      knob: d.knob,
      value: d.value,
      environment: d.environment,
      topology: d.topology,
      ticks: EQ_TICKS,
    }),
  );
}

// ----------------------------------------------------------------------------
// Output rendering (md + csv + json), mirroring environments.ts
// ----------------------------------------------------------------------------

const col = <K extends keyof CosmosOutcome>(key: K, label: string, digits?: number) => ({
  key,
  label,
  fmt: digits !== undefined ? (v: unknown) => (typeof v === 'number' ? v.toFixed(digits) : String(v ?? '')) : undefined,
});

function renderMd(title: string, meta: string[], columns: ReturnType<typeof col>[], rows: Record<string, unknown>[]): string {
  const head = `| ${columns.map((c) => c.label).join(' | ')} |`;
  const sep = `|${columns.map(() => '---').join('|')}|`;
  const body = rows
    .map((r) => `| ${columns.map((c) => (c.fmt ? c.fmt(r[c.key]) : String(r[c.key] ?? ''))).join(' | ')} |`)
    .join('\n');
  return `# ${title}\n\n${meta.join('\n')}\n\n${head}\n${sep}\n${body}\n`;
}

function renderCsv(columns: ReturnType<typeof col>[], rows: Record<string, unknown>[]): string {
  const header = columns.map((c) => c.label).join(',');
  const body = rows.map((r) => columns.map((c) => String(r[c.key] ?? '')).join(','));
  return [header, ...body].join('\n') + '\n';
}

function writeOutput(name: string, title: string, meta: string[], columns: ReturnType<typeof col>[], rows: Record<string, unknown>[]): string {
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(join(outputDir, `${name}.md`), renderMd(title, meta, columns, rows));
  writeFileSync(join(outputDir, `${name}.csv`), renderCsv(columns, rows));
  writeFileSync(
    join(outputDir, `${name}.json`),
    JSON.stringify({ generatedAt: new Date().toISOString(), meta, columns: columns.map((c) => c.label), runs: rows }, null, 2) + '\n',
  );
  return join(outputDir, `${name}.md`);
}

const COSMOS_COLUMNS: ReturnType<typeof col>[] = [
  col('axis', 'axis'),
  col('knob', 'knob'),
  col('value', 'value'),
  col('replicate', 'rep'),
  col('environment', 'biome'),
  col('topology', 'topology'),
  col('ticks', 'ticks'),
  col('alive', 'alive'),
  col('growth', 'dPop'),
  col('species', 'species'),
  col('births', 'births'),
  col('deaths', 'deaths'),
  col('escapeDeaths', 'escapes'),
  col('meanATP', 'ATP', 3),
  col('entropy', 'H', 2),
  col('diversity', 'Simpson', 3),
  col('complexity', 'LMC', 3),
  col('endFood', 'food', 2),
  col('seriesCv', 'CV', 3),
  col('lateCv', 'lateCV', 3),
  col('settleSlope', 'slope', 3),
  col('event', 'event'),
  col('eventAt', 'at'),
  col('aliveAtEvent', 'alive@E'),
  col('minAliveAfter', 'minAfter'),
  col('recoveryFrac', 'recover'),
  col('recoveryTick', 'recoveryT'),
];

function summarizeConsole(rows: CosmosOutcome[]): void {
  for (const axis of [...new Set(rows.map((r) => r.axis))]) {
    const rs = rows.filter((r) => r.axis === axis);
    console.log(`\n## ${axis} (${rs.length} runs)`);
    for (const r of rs) {
      const rec = r.event !== 'none' ? ` rec=${r.recoveryFrac.toFixed(2)}@${r.recoveryTick >= 0 ? r.recoveryTick : 'never'}` : '';
      console.log(`  ${r.knob.padEnd(20)} Δpop=${r.growth > 0 ? '+' : ''}${r.growth.toFixed(1).padStart(6)} alive=${r.alive} births=${r.births} deaths=${r.deaths} esc=${r.escapeDeaths} CV=${(r.seriesCv || 0).toFixed(2)}${rec}`);
    }
  }
}

export function runCosmosMain(only?: string): void {
  const meta = [
    'Cosmos experiments — world-definition axes (universe constants, energy levels, constraints, physical laws, supply/destruction, black-swan treatments, equilibria).',
    `Habitat = f(seed, biome) only; ${HABITAT_JITTER}-scale jitter. Baseline = calm torus, ${TICKS} ticks, ${SPAWN} founders.`,
    `${REPLICATE_SEEDS.length} replicate seeds for the paired families (n = 4 per contrast); black swans fire at tick ${EVENT_AT} of ${SWAN_TICKS}; equilibria runs are ${EQ_TICKS} ticks with full time-series.`,
  ];
  const rows: CosmosOutcome[] = [];

  if (!only || only === 'breadth') rows.push(...runBroadthSweep());
  if (!only || only === 'replicates') rows.push(...runCosmosReplicates());
  if (!only || only === 'equilibrium') rows.push(...runEquilibriumSweep());
  if (!only || only === 'blackswan') rows.push(...runBlackSwanSweep());

  const file = writeOutput('cosmos', `Cosmos experiments (${rows.length} runs)`, meta, COSMOS_COLUMNS, rows as unknown as Record<string, unknown>[]);
  summarizeConsole(rows);
  console.log(`\n# written: ${file}`);
}

if (process.argv[1]?.endsWith('cosmos.ts')) {
  runCosmosMain(process.argv[2]);
}