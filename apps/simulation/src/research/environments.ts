import {
  DEFAULT_PARAMS,
  ENV_PROFILES,
  TOPOLOGIES,
  TOPOLOGY_DEFS,
  fnv1a32,
  type EnvironmentPreset,
  type WorldTopology,
  type FractalType,
} from '@fractal-life/shared';
import { Engine } from '../engine.js';
import { placeAgentsAt } from './scenarios.js';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Phase M environmental research harness. Runs the identical founder world
 * under every biome preset, every topological space (torus / cylinder / sphere
 * / möbius / klein), and every fractal-dimension regime (fractal type ×
 * escape-time resolution × zoom), then writes MD + CSV + JSON reports to
 * `apps/simulation/research/output`.
 *
 * Deterministic per (seed, preset, topology, overrides): no Math.random; every
 * stochastic draw comes from the seed stream. Agents iterate in ascending id
 * order. To keep a comparison a pure test of one knob, the sampled habitat
 * region is jittered only on the knob under test and held fixed on the others.
 */

const HABITAT_JITTER = 0.6;
const TICKS = 240;
const SPAWN = 40;
const SEED = 'env-experiment';

const outputDir = fileURLToPath(new URL('../../research/output/', import.meta.url));

export type BiomeClass = 'control' | 'extreme' | 'underrated';

export const EXTREME_PRESETS: EnvironmentPreset[] = [
  'anoxicTrench',
  'hyperthermal',
  'hypersaline',
  'acidicCrater',
  'sodaLake',
  'cryoFrozen',
  'irradiated',
  'toxicSump',
];

export function biomeClass(preset: EnvironmentPreset): BiomeClass {
  if (preset === 'calm') return 'control';
  return EXTREME_PRESETS.includes(preset) ? 'extreme' : 'underrated';
}

export interface EnvRunResult {
  preset: EnvironmentPreset;
  topology: WorldTopology;
  class: BiomeClass;
  desc: string;
  alive: number;
  species: number;
  births: number;
  deaths: number;
  meanFitness: number;
  meanATP: number;
  terrainO2: number;
  terrainPH: number;
  terrainToxin: number;
  growth: number; // alive(TICKS) - spawn
  /** y-cap crossings handled by the topology (0 unless the run was edge-seeded). */
  edgeHits: number;
  edge?: boolean;
  label?: string;
  fractalType?: FractalType;
  maxIter?: number;
  worldScale?: number;
}

export interface RunSpec {
  environment?: EnvironmentPreset;
  topology?: WorldTopology;
  fractalType?: FractalType;
  overrides?: Partial<typeof DEFAULT_PARAMS>;
  seed?: string;
  ticks?: number;
  spawn?: number;
  /** Seed the founders just below the northern latitude cap so the boundary
   *  condition actually engages within a short horizon. */
  edge?: boolean;
  label?: string;
}

export function runWorldEnv(spec: RunSpec = {}): EnvRunResult {
  const seed = spec.seed ?? SEED;
  const ticks = spec.ticks ?? TICKS;
  const spawn = spec.spawn ?? SPAWN;
  // habitat is a function of seed + biome ONLY, so every experiment axis is
  // isolated: environment runs sample a distinct fractal window per preset,
  // while topology / fractal-regime runs keep the exact same window and change
  // only the boundary condition or terrain generator under test.
  const parts = [seed];
  if (spec.environment) parts.push(spec.environment);
  const jkey = parts.join(':');
  const h = fnv1a32(jkey);
  const u1 = (h >>> 0) / 4294967296;
  const h2 = Math.imul(h, 1103515245) + 12345;
  const u2 = (h2 >>> 0) / 4294967296;
  const jx = (u1 - 0.5) * 2 * HABITAT_JITTER * DEFAULT_PARAMS.worldScale;
  const jy = (u2 - 0.5) * 2 * HABITAT_JITTER * DEFAULT_PARAMS.worldScale;
  const environment = spec.environment ?? 'calm';
  const topology = spec.topology ?? 'torus';
  const world: ConstructorParameters<typeof Engine>[0] = {
    id: `env-${environment}-${topology}${spec.label ? '-' + spec.label : ''}`,
    seed,
    fractalType: spec.fractalType ?? 'mandelbrot',
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
  const engine = new Engine(world);
  if (spec.edge) {
    // founders line up along the northern cap (cell row 0) with a northward
    // nudge: torus wraps them to the south, cylinder/sphere/möbius reflect
    // them back, klein loops-with-flip. Same seed stream → same world/grid;
    // only the boundary differs.
    const w = engine.grid.size * engine.grid.cell;
    const pos: number[] = [];
    for (let i = 0; i < spawn; i++) {
      pos.push(((i + 0.5) * w) / spawn, 0.5);
    }
    placeAgentsAt(engine, pos);
    for (const a of engine.agents.values()) a.vy = -0.5;
  }
  let last: ReturnType<Engine['tick']> = engine.tick();
  for (let i = 1; i < ticks; i++) {
    last = engine.tick();
  }
  const s = last.stats;
  return {
    preset: environment,
    topology,
    class: biomeClass(environment),
    desc: ENV_PROFILES[environment].desc,
    alive: s.aliveCount,
    species: s.speciesCount,
    births: s.births,
    deaths: s.deaths,
    meanFitness: s.meanFitness,
    meanATP: s.meanATP,
    terrainO2: s.terrainOxygen,
    terrainPH: s.terrainPH,
    terrainToxin: s.terrainToxin,
    growth: s.aliveCount - spawn,
    edgeHits: engine.topologyEdgeHits,
    edge: spec.edge ?? false,
    label: spec.label,
    fractalType: spec.fractalType,
    maxIter: spec.overrides?.maxIter,
    worldScale: spec.overrides?.worldScale,
  };
}

export function runEnvPreset(environment: EnvironmentPreset): EnvRunResult {
  return runWorldEnv({ environment });
}

export function allEnvPresets(): EnvironmentPreset[] {
  return Object.keys(ENV_PROFILES) as EnvironmentPreset[];
}

export const ALL_ENV_PRESETS: EnvironmentPreset[] = allEnvPresets();

export function runEnvironmentExperiment(): EnvRunResult[] {
  return allEnvPresets().map(runEnvPreset);
}

/** Full cross of every biome preset × every topological space (85 runs).
 *  Founders are edge-seeded at the northern cap so the boundary condition
 *  actually engages within the standard short horizon (a mid-world seed never
 *  reaches the edge before the colony collapses, making every topology
 *  observably identical). */
export function runTopologyExperiment(): EnvRunResult[] {
  const out: EnvRunResult[] = [];
  for (const environment of allEnvPresets()) {
    for (const topology of TOPOLOGIES) {
      out.push(runWorldEnv({ environment, topology, edge: true }));
    }
  }
  return out;
}

const DIM_BIOMES: EnvironmentPreset[] = ['calm', 'hyperthermal'];
const DIM_FRACTALS: FractalType[] = ['mandelbrot', 'julia', 'perlin'];
const DIM_ITERS = [32, 256, 1024] as const;
const DIM_SCALES = [2, 4] as const;
// same habitat per biome as the baseline environment experiment, so the fractal
// regime effects show up against a living control rather than a barren window
const DIM_SEED = SEED;

/** Fractal-dimension / terrain-complexity sweep (fractal type × escape-time
 *  resolution × zoom) across a benign and an extreme biome. */
export function runDimensionExperiment(): EnvRunResult[] {
  const out: EnvRunResult[] = [];
  for (const environment of DIM_BIOMES) {
    for (const fractalType of DIM_FRACTALS) {
      for (const maxIter of DIM_ITERS) {
        for (const worldScale of DIM_SCALES) {
          out.push(
            runWorldEnv({
              environment,
              fractalType,
              overrides: { maxIter, worldScale },
              label: `${fractalType}-i${maxIter}-s${worldScale}`,
              seed: DIM_SEED,
            }),
          );
        }
      }
    }
  }
  return out;
}

interface Column<T> {
  key: keyof T;
  label: string;
  fmt?: (v: unknown) => string;
}

function fmtNum(digits: number) {
  return (v: unknown) => (typeof v === 'number' ? v.toFixed(digits) : String(v ?? ''));
}

function renderMd(title: string, meta: string[], columns: Column<Record<string, unknown>>[], rows: Record<string, unknown>[]) {
  const head = `| ${columns.map((c) => c.label).join(' | ')} |`;
  const sep = `|${columns.map(() => '---').join('|')}|`;
  const body = rows
    .map((r) => {
      const cells = columns.map((c) => c.fmt?.(r[c.key]) ?? String(r[c.key] ?? ''));
      return `| ${cells.join(' | ')} |`;
    })
    .join('\n');
  return `# ${title}\n\n${meta.join('\n')}\n\n${head}\n${sep}\n${body}\n`;
}

function renderCsv(columns: Column<Record<string, unknown>>[], rows: Record<string, unknown>[]) {
  const header = columns.map((c) => c.label).join(',');
  const body = rows.map((r) => columns.map((c) => String(r[c.key] ?? '')).join(','));
  return [header, ...body].join('\n') + '\n';
}

function writeOutput(name: string, title: string, meta: string[], columns: Column<Record<string, unknown>>[], rows: Record<string, unknown>[]) {
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(join(outputDir, `${name}.md`), renderMd(title, meta, columns, rows));
  writeFileSync(join(outputDir, `${name}.csv`), renderCsv(columns, rows));
  const doc = {
    generatedAt: new Date().toISOString(),
    meta,
    columns: columns.map((c) => c.label),
    runs: rows,
  };
  writeFileSync(join(outputDir, `${name}.json`), JSON.stringify(doc, null, 2) + '\n');
  return join(outputDir, `${name}.md`);
}

const envColumns = (): Column<Record<string, unknown>>[] => [
  { key: 'preset', label: 'biome' },
  { key: 'class', label: 'class' },
  { key: 'alive', label: 'alive' },
  { key: 'growth', label: 'dPop', fmt: (v) => (typeof v === 'number' && v > 0 ? `+${v}` : String(v)) },
  { key: 'species', label: 'species' },
  { key: 'births', label: 'births' },
  { key: 'meanFitness', label: 'fitness', fmt: fmtNum(3) },
  { key: 'meanATP', label: 'ATP', fmt: fmtNum(3) },
  { key: 'terrainO2', label: 'O2', fmt: fmtNum(3) },
  { key: 'terrainPH', label: 'pH', fmt: fmtNum(2) },
  { key: 'terrainToxin', label: 'toxin', fmt: fmtNum(3) },
];

function runAndWrite(only?: string) {
  const out: string[] = [];

  // 1) biomes — the benign control vs the extreme vs the underrated
  if (!only || only === 'environments') {
    const envRows = runEnvironmentExperiment();
    const envFile = writeOutput('environments', `Environment experiment (${TICKS} ticks, ${SPAWN} founders, seed "${SEED}")`, ['Phase M biome presets — same seed stream, per-preset habitat jitter.'], envColumns(), envRows as unknown as Record<string, unknown>[]);
    out.push(envFile);
    for (const r of envRows) {
      console.log(`## ${r.preset} (${r.class}) — ${r.desc}`);
      console.log(`alive=${r.alive} Δpop=${r.growth > 0 ? '+' : ''}${r.growth} species=${r.species} births=${r.births} deaths=${r.deaths}`);
      console.log(`fitness=${r.meanFitness.toFixed(3)} ATP=${r.meanATP.toFixed(3)} | terrain O₂=${r.terrainO2.toFixed(3)} pH=${r.terrainPH.toFixed(2)} toxin=${r.terrainToxin.toFixed(3)}\n`);
    }
  }

  // 2) topological spaces — every biome × every boundary condition
  const topoRows = only && only !== 'topologies' ? null : runTopologyExperiment();
  const topoCols = [
    { key: 'topology', label: 'topology' },
    ...envColumns(),
    { key: 'edgeHits', label: 'edgeHits' },
  ] as Column<Record<string, unknown>>[];
  const topoMeta = [
    `Biome × topology full cross (${TOPOLOGIES.length * ALL_ENV_PRESETS.length} runs @ ${TICKS} ticks). Founders edge-seeded at the northern cap; same world/grid per (seed, environment); only the edge-identification differs. edgeHits = y-cap crossings handled by the topology.`,
    ...TOPOLOGIES.map((t) => `- **${t}** — ${TOPOLOGY_DEFS[t].desc}`),
  ];
  if (topoRows) {
    const topoFile = writeOutput('topologies', `Topological spaces experiment (${TOPOLOGIES.length} topologies × ${ALL_ENV_PRESETS.length} biomes)`, topoMeta, topoCols, topoRows as unknown as Record<string, unknown>[]);
    out.push(topoFile);
  }

  // per-topology aggregates for the console summary
  const topoAgg =
    topoRows ? TOPOLOGIES.map((t) => {
      const rs = topoRows.filter((r) => r.topology === t);
      const n = rs.length;
      const mean = (f: (r: EnvRunResult) => number) => rs.reduce((a, r) => a + f(r), 0) / n;
      const best = [...rs].sort((a, b) => b.growth - a.growth)[0];
      const worst = [...rs].sort((a, b) => a.growth - b.growth)[0];
      return { t, meanGrowth: mean((r) => r.growth), meanAlive: mean((r) => r.alive), meanSpecies: mean((r) => r.species), best, worst };
    }) : [];
  if (topoAgg.length) {
    console.log('\n## topologies — mean colony outcome across all 17 biomes (edge-seeded)\n');
    for (const a of topoAgg) {
      const rs = topoRows!.filter((r) => r.topology === a.t);
      const hits = rs.reduce((x, r) => x + r.edgeHits, 0);
      console.log(`### ${a.t} — Δpop μ=${a.meanGrowth.toFixed(2)} alive μ=${a.meanAlive.toFixed(1)} species μ=${a.meanSpecies.toFixed(1)} edgeHits=${hits}`);
      console.log(`best: ${a.best.preset} (Δ${a.best.growth > 0 ? '+' : ''}${a.best.growth}) | worst: ${a.worst.preset} (Δ${a.worst.growth > 0 ? '+' : ''}${a.worst.growth})`);
    }
  }

  // 3) fractal dimensions — terrain complexity regime sweep
  if (!only || only === 'dimensions') {
    const dimRows = runDimensionExperiment();
    const dimCols = [
      { key: 'preset', label: 'biome' },
      { key: 'fractalType', label: 'fractal' },
      { key: 'maxIter', label: 'maxIter' },
      { key: 'worldScale', label: 'zoom' },
      ...envColumns().filter((c) => c.key !== 'preset'),
    ] as Column<Record<string, unknown>>[];
    const dimMeta = [
      `Fractal-dimension sweep: ${DIM_FRACTALS.length} fractal types × ${DIM_ITERS.length} escape-time resolutions × ${DIM_SCALES.length} zooms × ${DIM_BIOMES.length} biomes (= ${dimRows.length} runs). Same habitat within a biome; only the fractal regime differs.`,
    ];
    const dimFile = writeOutput('dimensions', `Fractal-dimension experiment (${DIM_FRACTALS.length}×${DIM_ITERS.length}×${DIM_SCALES.length} grid, ${DIM_BIOMES.length} biomes)`, dimMeta, dimCols, dimRows as unknown as Record<string, unknown>[]);
    out.push(dimFile);
    console.log('\n## fractal dimensions — mean Δpop per biome × regime\n');
    const dimAgg = new Map<string, number[]>();
    for (const r of dimRows) {
      const k = `${r.preset} | ${r.fractalType}·i${r.maxIter}·s${r.worldScale}`;
      dimAgg.set(k, [...(dimAgg.get(k) ?? []), r.growth]);
    }
    for (const [k, g] of [...dimAgg.entries()].sort()) {
      const mu = g.reduce((a, b) => a + b, 0) / g.length;
      console.log(`${k}: Δpop μ=${mu.toFixed(2)} (n=${g.length})`);
    }
  }

  console.log(`\n# Environment experiments — ${TICKS} ticks, ${SPAWN} founders\n`);
  console.log('## written\n');
  for (const f of out) {
    console.log(`- ${f}`);
  }
}

if (process.argv[1]?.endsWith('environments.ts')) {
  const only = process.argv[2];
  runAndWrite(only);
}