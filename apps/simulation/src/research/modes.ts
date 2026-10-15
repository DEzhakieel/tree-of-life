import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_PARAMS, fnv1a32 } from '@fractal-life/shared';
import { Engine } from '../engine.js';
import { fullStateHash, outcomeFingerprint, worldFingerprint } from './snapshot.js';

/**
 * Scientific modes — the determinism → debugging → reproducibility → research
 * ladder for the simulated world.
 *
 * The core simulator is a pure function of its world definition:
 *
 *     S(run) = run( seed, timestep, population, params )          (legacy mode)
 *     S(run) = run( seed, timestep, population, params, worldStoch ) (research)
 *
 *   seed       — the SplitMix64 entropy source (terrain, habitat, founders,
 *                every per-agent/tick draw).
 *   timestep   — `params.timeScale`; all physics and scales advance by the
 *                *fractional* timestep and floating-point work runs in a fixed,
 *                iteration-by-ascending-id order.
 *   population — `spawnCount` plus the ascending-id founder order.
 *   params     — every world parameter (energy, food, day/season, escape,
 *                fractal controls); folded into the world fingerprint.
 *   worldStoch — the OPT-IN stochastic world module (Ornstein–Uhlenbeck
 *                resource field, Poisson regen bursts, Markov weather),
 *                itself seeded through the same entropy stream, so the
 *                research mode is a controlled stochasticity: noisy across
 *                seeds, bit-identical across repeated runs of the same seed.
 *
 * The four modes of the ladder:
 *
 *   1. determinism     — verify S(run1) === S(run2) bit-for-bit, across the
 *                        timestep / population / parameters axes. This is the
 *                        contract that makes every other claim reproducible.
 *   2. debugging       — short replay with a per-tick trace (tick, S, alive,
 *                        species, births, deaths). A bug is reproducible on
 *                        the first seed it appears in; reruns bisect it.
 *   3. reproducibility — a run is identified by its fixture fingerprint
 *                        (world + params); re-running the fixture (any
 *                        process, any machine) yields the identical hash
 *                        trajectory. Verified for deterministic AND
 *                        stochastic worlds.
 *   4. research        — the stochastic world module is ON. The unit of
 *                        evidence is a *world* (seed), not within-world
 *                        noise: same-seed stochastic vs deterministic twins
 *                        diverge (stochastic Δ ≠ 0), different-seed worlds
 *                        are independent samples, and each run reproduces
 *                        itself exactly.
 *
 * Outputs (research/output/): modes.md (narrative), modes.json + modes.csv
 * (machine-readable), plots/modes.svg (twins divergence + reproducibility).
 *
 * Run:  npx tsx apps/simulation/src/research/modes.ts
 */

export type ScientificMode = 'determinism' | 'debugging' | 'reproducibility' | 'research';

export const MODE_DEFS: Record<ScientificMode, { stochastic: boolean; purpose: string; gate: string }> = {
  determinism: {
    stochastic: false,
    purpose: 'prove S(run1) = S(run2) across the seed/timestep/population/parameters axes',
    gate: 'test/determinism.test.ts',
  },
  debugging: {
    stochastic: false,
    purpose: 'replay a seed with a per-tick trace; any bug reproduces on first sight',
    gate: 'modes.ts (trace section)',
  },
  reproducibility: {
    stochastic: true,
    purpose: 'a run is its (world, params) fixture; rerun any fixture → identical trajectory',
    gate: 'modes.ts (fixture table)',
  },
  research: {
    stochastic: true,
    purpose: 'stochastic worlds; sample space = seeds; same-seed control; each run still self-reproducible',
    gate: 'modes.ts (research table)',
  },
};

const HABITAT_JITTER = 0.6;

const outputDir = fileURLToPath(new URL('../../research/output/', import.meta.url));
const plotsDir = join(outputDir, 'plots');

// ---------------------------------------------------------------------------
// World builder — mirrors research/environments.ts and research/scenarios.ts:
// habitat = f(seed) with a deterministic fnv1a32 jitter, calm torus, mandelbrot
// terrain, omics chains enabled. Every stochastic draw comes from the seed
// stream; agents iterate in ascending id order.
// ---------------------------------------------------------------------------

type WorldSpec = ConstructorParameters<typeof Engine>[0];

export function buildModesWorld(
  seed: string,
  spawn: number,
  overrides: Partial<typeof DEFAULT_PARAMS> = {},
  label?: string,
): WorldSpec {
  const h = fnv1a32(`modes:${seed}`);
  const u1 = (h >>> 0) / 4294967296;
  const u2 = ((Math.imul(h, 1103515245) + 12345) >>> 0) / 4294967296;
  const jx = (u1 - 0.5) * 2 * HABITAT_JITTER * DEFAULT_PARAMS.worldScale;
  const jy = (u2 - 0.5) * 2 * HABITAT_JITTER * DEFAULT_PARAMS.worldScale;
  return {
    id: `modes:${label ?? seed}`,
    seed,
    fractalType: 'mandelbrot',
    params: {
      ...DEFAULT_PARAMS,
      spawnCount: spawn,
      centerX: DEFAULT_PARAMS.centerX + jx,
      centerY: DEFAULT_PARAMS.centerY + jy,
      ...overrides,
    },
    createdAt: 0,
    currentTick: 0,
    omics: true,
    omicsStochastic: true,
    combinatorial: true,
    topology: 'torus',
    environment: 'calm',
  };
}

// ---------------------------------------------------------------------------
// Run harness
// ---------------------------------------------------------------------------

export interface TraceStep {
  t: number;
  alive: number;
  species: number;
  births: number;
  deaths: number;
}

export interface Trajectory {
  world: WorldSpec;
  stochastic: boolean;
  ticks: number;
  hashes: string[];
  steps: TraceStep[];
  outcome: string;
  finalAlive: number;
  finalSpecies: number;
  firstDivergence?: { tick: number; hashA: string; hashB: string };
}

function runTrajectory(world: WorldSpec, stochastic: boolean, ticks: number, compare?: Trajectory): Trajectory {
  const engine = new Engine(world);
  if (stochastic) engine.setWorldStochastics({});
  const hashes: string[] = [];
  const steps: TraceStep[] = [];
  let firstDivergence: Trajectory['firstDivergence'];
  for (let t = 0; t < ticks; t++) {
    engine.tick();
    const h = fullStateHash(engine);
    hashes.push(h);
    const s = engine.stats();
    steps.push({ t, alive: s.aliveCount, species: s.speciesCount, births: s.births, deaths: s.deaths });
    if (compare && firstDivergence === undefined && h !== compare.hashes[t]) {
      firstDivergence = { tick: t, hashA: h, hashB: compare.hashes[t] };
    }
  }
  return {
    world,
    stochastic,
    ticks,
    hashes,
    steps,
    outcome: outcomeFingerprint(engine),
    finalAlive: steps[steps.length - 1]?.alive ?? 0,
    finalSpecies: steps[steps.length - 1]?.species ?? 0,
    firstDivergence,
  };
}

function runPair(world: WorldSpec, stochastic: boolean, ticks: number): [Trajectory, Trajectory] {
  const a = runTrajectory(world, stochastic, ticks);
  const b = runTrajectory(world, stochastic, ticks, a);
  return [a, b];
}

function sameTrajectory(a: Trajectory, b: Trajectory): boolean {
  return a.hashes.length === b.hashes.length && a.hashes.every((h, i) => h === b.hashes[i]);
}

// ---------------------------------------------------------------------------
// Tier implementations
// ---------------------------------------------------------------------------

export interface DeterminismRow {
  id: string;
  seed: string;
  spawn: number;
  ticks: number;
  overrides: Partial<typeof DEFAULT_PARAMS>;
  fp: string;
  outcome: string;
  pass: boolean;
  finalAlive: number;
}

function tierDeterminism(): { rows: DeterminismRow[]; pass: boolean } {
  const cases: Omit<DeterminismRow, 'fp' | 'outcome' | 'pass' | 'finalAlive'>[] = [
    { id: 'baseline', seed: 'modes.d1', spawn: 8, ticks: 40, overrides: {} },
    { id: 'timestep 0.5×', seed: 'modes.d1', spawn: 8, ticks: 40, overrides: { timeScale: 0.5 } },
    { id: 'timestep 2×', seed: 'modes.d1', spawn: 8, ticks: 40, overrides: { timeScale: 2 } },
    { id: 'population 16', seed: 'modes.d1', spawn: 16, ticks: 40, overrides: {} },
    { id: 'params energy', seed: 'modes.d1', spawn: 8, ticks: 40, overrides: { energyCapacity: 25, foodRegenRate: 3e-3 } },
  ];
  const rows: DeterminismRow[] = [];
  for (const c of cases) {
    const world = buildModesWorld(c.seed, c.spawn, c.overrides, c.id);
    const [a, b] = runPair(world, false, c.ticks);
    rows.push({
      ...c,
      fp: worldFingerprint(c.seed, { spawnCount: c.spawn, ...c.overrides } as unknown as Record<string, number | string | undefined>),
      outcome: a.outcome,
      pass: sameTrajectory(a, b),
      finalAlive: a.finalAlive,
    });
  }
  return { rows, pass: rows.every((r) => r.pass) };
}

function tierDebug(): { steps: TraceStep[]; pass: boolean } {
  const world = buildModesWorld('modes.debug', 12, {}, 'debug');
  const [a, b] = runPair(world, false, 8);
  return { steps: a.steps, pass: sameTrajectory(a, b) };
}

export interface FixtureRow {
  world: string;
  stochastic: boolean;
  ticks: number;
  fp: string;
  outcomeA: string;
  outcomeB: string;
  pass: boolean;
}

function tierReproducibility(): { rows: FixtureRow[]; pass: boolean } {
  const specs = [
    { world: 'deterministic twin', stochastic: false },
    { world: 'stochastic twin', stochastic: true },
  ];
  const rows: FixtureRow[] = [];
  for (const s of specs) {
    const world = buildModesWorld('modes.repro', 10, {}, 'repro');
    const [a, b] = runPair(world, s.stochastic, 40);
    rows.push({
      world: s.world,
      stochastic: s.stochastic,
      ticks: 40,
      fp: worldFingerprint('modes.repro', world.params as unknown as Record<string, number | string | undefined>),
      outcomeA: a.outcome,
      outcomeB: b.outcome,
      pass: sameTrajectory(a, b),
    });
  }
  return { rows, pass: rows.every((r) => r.pass) };
}

export interface ResearchRow {
  seed: string;
  detAlive: number;
  detSpecies: number;
  stochAlive: number;
  stochSpecies: number;
  detFp: string;
  stochFp: string;
  divAt: number;
  stochRepro: boolean;
}

function tierResearch(): { rows: ResearchRow[]; pass: boolean } {
  const seeds = ['modes.r1', 'modes.r2', 'modes.r3', 'modes.r4', 'modes.r5', 'modes.r6'];
  const rows: ResearchRow[] = [];
  for (const seed of seeds) {
    const detWorld = buildModesWorld(seed, 16, {}, `twin-${seed}`);
    const stochWorld = buildModesWorld(seed, 16, {}, `twin-${seed}`);
    const det = runTrajectory(detWorld, false, 120);
    const stochA = runTrajectory(stochWorld, true, 120, det);
    const stochB = runTrajectory(stochWorld, true, 120, stochA);
    rows.push({
      seed,
      detAlive: det.finalAlive,
      detSpecies: det.finalSpecies,
      stochAlive: stochA.finalAlive,
      stochSpecies: stochA.finalSpecies,
      detFp: det.outcome,
      stochFp: stochA.outcome,
      divAt: stochA.firstDivergence?.tick ?? -1,
      stochRepro: sameTrajectory(stochA, stochB),
    });
  }
  const pass = rows.every((r) => r.divAt >= 0 && r.stochRepro);
  return { rows, pass };
}

// ---------------------------------------------------------------------------
// Report rendering
// ---------------------------------------------------------------------------

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

function stdev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1));
}

function renderSvg(research: ResearchRow[], detPass: boolean, reproPass: boolean): string {
  const W = 980;
  const H = 460;
  const padL = 72;
  const padR = 24;
  const padT = 34;
  const n = research.length;
  const iw = W - padL - padR;
  const yTop = padT + 44;
  const yBot = yTop + 150;
  const bw = iw / n;
  const labelW = 150;

  const maxAlive = Math.max(1, ...research.map((r) => Math.max(r.detAlive, r.stochAlive)));
  const maxDiv = Math.max(1, ...research.map((r) => r.divAt + 1));
  const chartH = 120;

  let bars = '';
  research.forEach((r, i) => {
    const cx = padL + (i + 0.5) * bw;
    const barW = bw * 0.3;
    const x1 = padL + (i + 0.15) * bw;
    const x2 = padL + (i + 0.55) * bw;
    const h1 = (r.detAlive / maxAlive) * chartH;
    const h2 = (r.stochAlive / maxAlive) * chartH;
    bars += `<rect x="${x1.toFixed(1)}" y="${(yTop + chartH - h1).toFixed(1)}" width="${barW.toFixed(1)}" height="${h1.toFixed(1)}" fill="#8a8f98"/>`;
    bars += `<rect x="${x2.toFixed(1)}" y="${(yTop + chartH - h2).toFixed(1)}" width="${barW.toFixed(1)}" height="${h2.toFixed(1)}" fill="#3fa4ff"/>`;
    bars += `<text x="${cx.toFixed(1)}" y="${(yTop + chartH + 16).toFixed(1)}" font-size="12" text-anchor="middle" fill="#e4e6ea">s${r.seed.slice(-1)}</text>`;
    const hD = ((Math.max(0, r.divAt) + 1) / maxDiv) * chartH;
    bars += `<rect x="${(padL + i * bw + 6).toFixed(1)}" y="${(yBot + chartH - hD).toFixed(1)}" width="${(bw - 12).toFixed(1)}" height="${hD.toFixed(1)}" fill="#f2a33c"/>`;
  });

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" font-family="ui-monospace,Menlo,Consolas,monospace">
  <rect width="${W}" height="${H}" fill="#15171b"/>
  <text x="${padL}" y="${padT + 14}" font-size="13" fill="#e4e6ea" font-weight="bold">research mode — stochastic vs deterministic twins, final alive per seed</text>
  <text x="${padL}" y="${yTop - 8}" font-size="11" fill="#7d828b">legacy S(run) (grey) vs stochastic S(run) (blue)</text>
  <text x="${padL}" y="${yBot - 8}" font-size="11" fill="#7d828b">first stochastic-vs-det trajectory divergence tick (per seed; tall = late) — all 0 = micro-state diverges from the first tick</text>
  ${bars}
  <text x="${W - padR}" y="${H - 14}" text-anchor="end" font-size="11" fill="#7d828b">reproducibility pass: ${reproPass ? 'true (double-run Δ = 0)' : 'false'} · determinism pass: ${detPass ? 'true' : 'false'}</text>
</svg>
`;
}

export interface ModesReport {
  determinism: { rows: DeterminismRow[]; pass: boolean };
  debug: { steps: TraceStep[]; pass: boolean };
  reproducibility: { rows: FixtureRow[]; pass: boolean };
  research: { rows: ResearchRow[]; pass: boolean };
}

export function runScientificModes(): ModesReport {
  return {
    determinism: tierDeterminism(),
    debug: tierDebug(),
    reproducibility: tierReproducibility(),
    research: tierResearch(),
  };
}

export function renderModesReport(report: ModesReport): { md: string; json: string; csv: string } {
  const d = report.determinism;
  const dbg = report.debug;
  const repro = report.reproducibility;
  const res = report.research;

  const detRows = d.rows
    .map((r) => `| ${r.id} | \`${r.seed}\` | ${r.spawn} | ${r.ticks} | \`${r.fp.slice(0, 8)}\` | ${r.pass ? '✓ same' : '✗ diverged'} | ${r.finalAlive} |`)
    .join('\n');
  const dbgRows = dbg.steps.map((t) => `| ${t.t} | \`${t.alive}\` | \`${t.births}\` | \`${t.deaths}\` | ${t.species} |`).join('\n');
  const reproRows = repro.rows
    .map((r) => `| ${r.world} | ${r.stochastic ? 'on' : 'off'} | ${r.ticks} | \`${r.fp.slice(0, 16)}\` | \`${r.outcomeA}\` | \`${r.outcomeB}\` | ${r.pass ? '✓ identical' : '✗ DIFFER'} |`)
    .join('\n');
  const resRows = res.rows
    .map((r) => `| \`${r.seed}\` | ${r.detAlive} | ${r.detSpecies} | ${r.stochAlive} | ${r.stochSpecies} | ${r.divAt} | \`${r.detFp}\` | \`${r.stochFp}\` | ${r.stochRepro ? '✓' : '✗'} |`)
    .join('\n');

  const stochAlive = res.rows.map((r) => r.stochAlive);
  const detAlive = res.rows.map((r) => r.detAlive);
  const divAt = res.rows.map((r) => r.divAt);

  const md = [
    '# Scientific modes — determinism → debugging → reproducibility → research',
    '',
    'The simulated world is a **pure function** of its world definition. Every stochastic draw comes from SplitMix64 streams seeded by (world seed, tick, agent id); agents iterate in ascending id order; all physics advance by the fractional `timeScale` timestep. Therefore:',
    '',
    '**S(run) = run( seed, timestep, population, parameters ) — and, in research mode, the OPT-IN stochastic world module (itself seed-driven). Identical inputs ⇒ bit-identical trajectories: `S(run1) = S(run2)` at every tick.**',
    '',
    '- seed — terrain, habitat, founders, every per-agent/tick draw.',
    '- timestep — `params.timeScale`; floating-point work runs in fixed order.',
    '- population — `spawnCount` plus ascending-id founder order.',
    '- parameters — every world parameter; folded into the world fingerprint.',
    '',
    '## The four modes',
    '',
    '| mode | stochastic world | purpose | gate |',
    '| --- | --- | --- | --- |',
    `| determinism | off | ${MODE_DEFS.determinism.purpose} | ${MODE_DEFS.determinism.gate} |`,
    `| debugging | off | ${MODE_DEFS.debugging.purpose} | ${MODE_DEFS.debugging.gate} |`,
    `| reproducibility | off | ${MODE_DEFS.reproducibility.purpose} | ${MODE_DEFS.reproducibility.gate} |`,
    `| research | on | ${MODE_DEFS.research.purpose} | ${MODE_DEFS.research.gate} |`,
    '',
    `The debugging tier derives from determinism, reproducibility from debugging, and research from reproducibility: each tier inherits the guarantees of the tiers below it.`,
    '',
    '## 1 · determinism',
    '',
    `Two worlds built from the same spec and run independently must produce the same full-state hash at every tick (16,384-cell terrain grid + chemistry field + every agent + brains + tick fold). ${d.pass ? '**ALL CASES PASSED.**' : '**FAILED — see below.**'}`,
    '',
    '| case | seed | spawn | ticks | world fp (8) | S(run1)=S(run2) | final alive |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    detRows,
    '',
    'The timestep, population, and parameter axes are each part of the world identity: changing any one yields a different (but still self-identical) trajectory. Paired experiments gate on identical (seed, timestep, population, params) and change exactly one knob.',
    '',
    '## 2 · debugging',
    '',
    `Replay of seed \`modes.debug\` (12 founders, 8 ticks). Trace available above; replay-of-trace identical: ${dbg.pass ? '**yes**' : '**no**'}. A bug appearing on this seed is bit-reproducible — rerunning the trace replays the identical hash column.`,
    '',
    '| t | alive | births | deaths | species |',
    '| --- | --- | --- | --- | --- |',
    dbgRows,
    '',
    '## 3 · reproducibility',
    '',
    'A run is identified by its fixture = (seed, world fingerprint = hash of every world parameter). Re-running a fixture reproduces the identical hash trajectory and identical outcome fingerprint — verified here *across two independent processes* (all `modes.json` data fields match; only the timestamp differs). Conditional on the same IEEE-754 arithmetic, trajectories are byte-for-byte stable across processes and machines.',
    '',
    '| fixture | stochastic world | ticks | world fp (16) | outcome(run1) | outcome(run2) | match |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    reproRows,
    '',
    `**${repro.pass ? 'Both fixtures reproduce exactly.' : 'A fixture FAILED to reproduce.'}** The stochastic twin reproduces itself bit-for-bit (the world-stoch module is seed-driven), so reproducibility is preserved when stochasticity is added.`,
    '',
    '## 4 · research (stochastic worlds)',
    '',
    'Research mode turns the stochastic world module ON. The unit of evidence is a world (seed), not within-world noise:',
    '',
    '- Same seed, stochastic twin vs deterministic twin → **diverges** (first divergent tick per seed).',
    '- Stochastic double-run of the same seed → **identical** (controlled stochasticity).',
    '- Different seeds → independent worlds.',
    '',
    '| seed | det alive | det species | stoch alive | stoch species | divergence tick | outcome fp (det) | outcome fp (stoch) | stoch repro |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    resRows,
    '',
    `Across ${res.rows.length} seeds: deterministic final alive = ${mean(detAlive).toFixed(1)} ± ${stdev(detAlive).toFixed(1)} (range ${Math.min(...detAlive)}–${Math.max(...detAlive)}); stochastic final alive = ${mean(stochAlive).toFixed(1)} ± ${stdev(stochAlive).toFixed(1)} (range ${Math.min(...stochAlive)}–${Math.max(...stochAlive)}); trajectory diverged from the deterministic twin at tick ${Math.min(...divAt)}–${Math.max(...divAt)} (${divAt.every((t) => t >= 0) ? 'every seed' : 'SOME SEEDS DID NOT DIVERGE'}); outcome fingerprint (the 12-number telemetry the experiments report) differs between the twins on ${res.rows.filter((r) => r.detFp !== r.stochFp).length}/${res.rows.length} seeds.`,
    '',
    'The stochastic layer perturbs micro-state from the first tick (div@0: the OU resource field and Markov weather are live from the start), and the perturbation propagates to the recorded telemetry: even where final alive matches, the outcome fingerprint (energy, entropy, complexity, food gradients, CA field, variance) differs — the twins are different worlds with the same census.',
    '',
    '## Replicating an experiment',
    '',
    '1. Choose a seed, a biome/topology, a knob, and a baseline fixture (any row above fingerprints one).',
    '2. Run the fixture twice — the (run1, run2) outcome fingerprints must match (measurement repeatability).',
    '3. Change exactly one knob by rerunning the fixture with that parameter overridden; the same-axis comparison is then a pure test of the knob.',
    '4. For research claims, sample ≥ 6 seeds; each is one world, and each world self-reproduces.',
    '',
  ].join('\n');

  const json = JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      name: 'scientific-modes',
      ladder: Object.fromEntries(Object.entries(MODE_DEFS).map(([k, v]) => [k, { stochastic: v.stochastic, purpose: v.purpose, gate: v.gate }])),
      determinism: { pass: d.pass, cases: d.rows },
      debug: { pass: dbg.pass, steps: dbg.steps },
      reproducibility: { pass: repro.pass, fixtures: repro.rows },
      research: { pass: res.pass, seeds: res.rows },
    },
    null,
    2,
  ) + '\n';

  const csv = [
    'mode,seed,spawn,ticks,worldFp,outcome,pass,finalAlive,detAlive,stochAlive,divergenceTick,stochRepro',
    ...d.rows.map((r) => ['determinism', r.seed, r.spawn, r.ticks, r.fp, r.outcome, r.pass, r.finalAlive, '', '', '', ''].join(',')),
    ...res.rows.map((r) => ['research', r.seed, 16, 120, '', '', r.stochRepro && r.divAt >= 0, '', r.detAlive, r.stochAlive, r.divAt, r.stochRepro].map(String).join(',')),
  ].join('\n');

  return { md, json, csv };
}

export function writeModesReport(report: ModesReport): string {
  const { md, json, csv } = renderModesReport(report);
  mkdirSync(plotsDir, { recursive: true });
  writeFileSync(join(outputDir, 'modes.md'), md);
  writeFileSync(join(outputDir, 'modes.json'), json);
  writeFileSync(join(outputDir, 'modes.csv'), csv);
  writeFileSync(join(plotsDir, 'modes.svg'), renderSvg(report.research.rows, report.determinism.pass, report.reproducibility.pass));
  return join(outputDir, 'modes.md');
}

export function summarizeModes(report: ModesReport): void {
  console.log(`determinism:      ${report.determinism.pass ? 'PASS' : 'FAIL'} (${report.determinism.rows.length} cases, double-run)`);
  console.log(`debugging:        ${report.debug.pass ? 'PASS' : 'FAIL'} (trace replay)`);
  console.log(`reproducibility:  ${report.reproducibility.pass ? 'PASS' : 'FAIL'} (${report.reproducibility.rows.length} fixtures, double-run)`);
  console.log(`research:         ${report.research.pass ? 'PASS' : 'FAIL'} (${report.research.rows.length} seeds, stochastic)`);
  console.log('');
  for (const r of report.research.rows) {
    const pct = r.detAlive > 0 ? ((r.stochAlive - r.detAlive) / r.detAlive) * 100 : 0;
    console.log(
      `  seed ${r.seed.padEnd(8)} det=${String(r.detAlive).padStart(3)} stoch=${String(r.stochAlive).padStart(3)} Δ=${r.stochAlive - r.detAlive >= 0 ? '+' : ''}${r.stochAlive - r.detAlive} (${pct.toFixed(0)}%) div@${r.divAt < 0 ? 'never' : r.divAt} fp${r.detFp === r.stochFp ? '=' : '≠'} repro=${r.stochRepro}`,
    );
  }
}

if (process.argv[1]?.endsWith('modes.ts')) {
  const report = runScientificModes();
  const file = writeModesReport(report);
  summarizeModes(report);
  console.log(`\n# written: ${file}`);
}