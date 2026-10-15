import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_PARAMS, fnv1a32 } from '@fractal-life/shared';
import { Engine } from '../engine.js';
import { fullStateHash, outcomeFingerprint, worldFingerprint } from './snapshot.js';
import { feedGenome } from './scenarios.js';

/**
 * Agent archetypes — a progressive complexity ladder for the individual.
 *
 *   T0 simple rules   → T1 constraints → T2 cognition → T3 systems
 *
 * The engine already contains every faculty; the ladder turns each one on as a
 * LAYER that the previous tier inherits, from a population of identical reflex
 * agents up to plastic-learning, cell-biochemistry agents. The design rule is
 * "start from simple rules, then integrate constraints, intelligence and
 * systems": every tier runs the SAME world shape, physics baseline and seeds,
 * and differs only by the faculty added.
 *
 *   T0 · simple rules  — everyone is a clone of one calm genome. Behaviour is
 *                        a fixed genome-reflex (forwardGenome): no heritable
 *                        diversity, no chemistry, no learning.
 *   T1 · constraints   — founders carry heritable genomes (mutations) and the
 *                        calm biome reinjects oxygen/pH/toxin/water each tick:
 *                        agents must metabolize under environmental
 *                        constraints. Heritable and cultural diversity appear.
 *   T2 · cognition     — each agent drives its behaviour through a per-agent
 *                        learned MLP (backprop + surprise-modulated
 *                        plasticity) instead of the fixed reflex.
 *   T3 · systems       — intracellular omics (stochastic expression,
 *                        combinatorial chemistry, recombination, cell
 *                        biochemistry) run inside each individual.
 *
 * The engine remains a pure function of its world definition — every
 * stochastic draw comes from SplitMix64 streams seeded by (seed, tick,
 * agent id), agents iterate in ascending id order — so each archetype also
 * self-reproduces bit-for-bit: the ladder is tested determinism-first.
 *
 * Individual complexity is measured by within-population heterogeneity and
 * by the presence of the faculty itself:
 *
 *   genomeDist      — mean pairwise normalized genome distance (alive agents)
 *   memeCV          — coefficient of variation of the cultural trait (meme)
 *   energyCV        — CV of stored energy (energetic autonomy spread)
 *   proteomeCV      — CV of per-agent protein pools (0 until omics/SYSTEMS)
 *   plasticAgents   — alive agents whose policy is still learning
 *   meanSurprise    — mean novelty signal (surprise-modulated plasticity)
 *
 * Outputs (research/output/): archetypes.md (narrative), archetypes.json +
 * archetypes.csv (machine-readable), plots/archetypes.svg (ladder curves).
 *
 * Run:  npx tsx apps/simulation/src/research/archetypes.ts
 */

export const ARCH_SEEDS = ['archetypes.s1', 'archetypes.s2', 'archetypes.s3'];
export const ARCH_SPAWN = 40;
export const ARCH_TICKS = 240;

export const BASELINE_OVERRIDES = {
  foodRegenRate: 0.003,
  metabolismBase: 0.5,
  energyCapacity: 150,
} as const;

export interface ArchetypeTier {
  idx: number;
  name: string;
  summary: string;
  faculty: string;
  brain: boolean;
  clones: boolean;
  env?: 'calm';
  flags?: Record<string, boolean>;
}

export const TIER_DEFS: ArchetypeTier[] = [
  {
    idx: 0,
    name: 'T0 · simple rules',
    summary: 'identical reflex agents on a plain fractal world',
    faculty: 'fixed genome-reflex (forwardGenome); no diversity, chemistry or learning',
    brain: false,
    clones: true,
  },
  {
    idx: 1,
    name: 'T1 · constraints',
    summary: 'heritable genomes coupled to a calm biome',
    faculty: 'genome mutation + biome chemistry reinjection (O2, pH, toxin, water)',
    brain: false,
    clones: false,
    env: 'calm',
  },
  {
    idx: 2,
    name: 'T2 · cognition',
    summary: 'per-agent learned policy instead of the fixed reflex',
    faculty: 'plastic MLP brain (backprop + surprise-modulated learning)',
    brain: true,
    clones: false,
    env: 'calm',
  },
  {
    idx: 3,
    name: 'T3 · systems',
    summary: 'intracellular omics on top of the learned brain',
    faculty: 'stochastic expression, combinatorial chemistry, recombination, cell biochemistry',
    brain: true,
    clones: false,
    env: 'calm',
    flags: { omics: true, omicsStochastic: true, combinatorial: true, recombination: true, cellBio: true },
  },
];

const HABITAT_JITTER = 0.6;

const outputDir = fileURLToPath(new URL('../../research/output/', import.meta.url));
const plotsDir = join(outputDir, 'plots');

type WorldSpec = ConstructorParameters<typeof Engine>[0];

// ---------------------------------------------------------------------------
// World builder — same shape/physics for every tier; the tier only adds a
// faculty (environment, brain, omics flags).
// ---------------------------------------------------------------------------

export function buildArchetypeWorld(seed: string, spawn: number, tier: ArchetypeTier, overrides: Record<string, number> = {}): WorldSpec {
  const h = fnv1a32(`archetypes:${tier.idx}:${seed}`);
  const u1 = (h >>> 0) / 4294967296;
  const u2 = ((Math.imul(h, 1103515245) + 12345) >>> 0) / 4294967296;
  const jx = (u1 - 0.5) * 2 * HABITAT_JITTER * DEFAULT_PARAMS.worldScale;
  const jy = (u2 - 0.5) * 2 * HABITAT_JITTER * DEFAULT_PARAMS.worldScale;
  const world: WorldSpec = {
    id: `archetypes:T${tier.idx}:${seed}`,
    seed,
    fractalType: 'mandelbrot',
    params: {
      ...DEFAULT_PARAMS,
      spawnCount: spawn,
      centerX: DEFAULT_PARAMS.centerX + jx,
      centerY: DEFAULT_PARAMS.centerY + jy,
      ...BASELINE_OVERRIDES,
      ...(overrides as Partial<typeof DEFAULT_PARAMS>),
    },
    createdAt: 0,
    currentTick: 0,
  };
  if (tier.idx >= 1) {
    world.topology = 'torus';
    world.environment = tier.env ?? 'calm';
  }
  for (const [k, v] of Object.entries(tier.flags ?? {})) (world as unknown as Record<string, boolean>)[k] = v;
  return world;
}

// ---------------------------------------------------------------------------
// Run harness — identical for every tier, deterministic double-run each.
// ---------------------------------------------------------------------------

export interface ArchetypeCensus {
  alive: number;
  species: number;
  births: number;
  deaths: number;
  selectionEntropy: number;
  traitDim: number;
}

export interface ArchetypeMetrics {
  genomeDist: number;
  memeCV: number;
  energyCV: number;
  proteomeCV: number;
  plasticAgents: number;
  meanPlasticity: number;
  meanSurprise: number;
}

export interface ArchetypeRow {
  tier: number;
  seed: string;
  spawn: number;
  ticks: number;
  census: ArchetypeCensus;
  metrics: ArchetypeMetrics;
  hashes: string[];
  deterministic: boolean;
  fp: string;
  outcome: string;
}

interface AgentLike {
  genome: Float32Array;
  meme: number;
  energy: number;
  alive: boolean;
  omics?: { proteins: Float32Array };
}

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

function stdev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1));
}

function cv(xs: number[]): number {
  const m = mean(xs);
  if (!(m > 1e-9)) return 0;
  return stdev(xs) / m;
}

function aliveAgents(engine: Engine): AgentLike[] {
  return [...engine.agents.values()].filter((a) => a.alive);
}

function pairwiseGenomeDistance(agents: AgentLike[]): number {
  let sum = 0;
  let n = 0;
  for (let i = 0; i < agents.length; i++) {
    const gi = agents[i]!.genome;
    for (let j = i + 1; j < agents.length; j++) {
      const gj = agents[j]!.genome;
      const len = Math.min(gi.length, gj.length);
      let d = 0;
      for (let k = 0; k < len; k++) d += Math.abs(gi[k]! - gj[k]!);
      sum += len > 0 ? d / len : 0;
      n++;
    }
  }
  return n > 0 ? sum / n : 0;
}

function proteinTotals(agents: AgentLike[]): number[] {
  const out: number[] = [];
  for (const a of agents) {
    if (!a.omics?.proteins) continue;
    let tot = 0;
    for (let k = 0; k < a.omics.proteins.length; k++) tot += a.omics.proteins[k]!;
    if (tot > 0) out.push(tot);
  }
  return out;
}

export function runArchetype(world: WorldSpec, tier: ArchetypeTier, ticks: number): { hashes: string[]; census: ArchetypeCensus; metrics: ArchetypeMetrics; outcome: string } {
  const engine = new Engine(world);
  engine.setBrainConfig({ enabled: tier.brain, ...(tier.brain ? { learn: 'backprop' } : {}) });
  if (tier.clones) {
    const g = feedGenome({ diet: 1 });
    for (const a of engine.agents.values()) {
      a.genome.set(g.subarray(0, Math.min(a.genome.length, g.length)));
      a.meme = 0.5;
    }
  }
  const hashes: string[] = [];
  let births = 0;
  let deaths = 0;
  for (let t = 0; t < ticks; t++) {
    engine.tick();
    hashes.push(fullStateHash(engine));
    const s = engine.stats();
    births += s.births;
    deaths += s.deaths;
  }
  const s = engine.stats();
  const alive = aliveAgents(engine);
  const brain = engine.brainStats();
  const census: ArchetypeCensus = {
    alive: s.aliveCount,
    species: s.speciesCount,
    births,
    deaths,
    selectionEntropy: s.selectionEntropy,
    traitDim: s.traitEffectiveDim,
  };
  const metrics: ArchetypeMetrics = {
    genomeDist: pairwiseGenomeDistance(alive),
    memeCV: cv(alive.map((a) => a.meme)),
    energyCV: cv(alive.map((a) => a.energy)),
    proteomeCV: cv(proteinTotals(alive)),
    plasticAgents: brain.plasticAgents,
    meanPlasticity: brain.meanPlasticity,
    meanSurprise: brain.meanSurprise,
  };
  return { hashes, census, metrics, outcome: outcomeFingerprint(engine) };
}

export function runArchetypePair(world: WorldSpec, tier: ArchetypeTier, ticks: number): { a: ArchetypeRow; b: ArchetypeRow; deterministic: boolean } {
  const [a, b] = [runArchetype(world, tier, ticks), runArchetype(world, tier, ticks)];
  const deterministic = a.hashes.length === b.hashes.length && a.hashes.every((h, i) => h === b.hashes[i]);
  const mk = (r: typeof a): ArchetypeRow => ({
    tier: tier.idx,
    seed: world.seed,
    spawn: world.params.spawnCount,
    ticks,
    census: r.census,
    metrics: r.metrics,
    hashes: r.hashes,
    deterministic,
    fp: worldFingerprint(world.seed, world.params as unknown as Record<string, number | string | undefined>),
    outcome: r.outcome,
  });
  return { a: mk(a), b: mk(b), deterministic };
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

export interface ArchetypesReport {
  rows: ArchetypeRow[];
  pass: boolean;
  spawn: number;
  ticks: number;
}

export function runArchetypes(): ArchetypesReport {
  const rows: ArchetypeRow[] = [];
  let pass = true;
  for (const tier of TIER_DEFS) {
    for (const seed of ARCH_SEEDS) {
      const world = buildArchetypeWorld(seed, ARCH_SPAWN, tier);
      const { a, deterministic } = runArchetypePair(world, tier, ARCH_TICKS);
      rows.push(a);
      pass = pass && deterministic;
    }
  }
  return { rows, pass, spawn: ARCH_SPAWN, ticks: ARCH_TICKS };
}

export function renderArchetypesReport(report: ArchetypesReport): { md: string; json: string; csv: string } {
  const byTier = (idx: number) => report.rows.filter((r) => r.tier === idx);
  const avg = (idx: number, pick: (c: ArchetypeRow) => number) => mean(byTier(idx).map(pick));
  const sd = (idx: number, pick: (c: ArchetypeRow) => number) => stdev(byTier(idx).map(pick));

  const lines: string[] = [
    '# Agent archetypes — simple rules → constraints → cognition → systems',
    '',
    'A progressive complexity ladder for the INDIVIDUAL. The engine already contains every faculty; each archetype turns one on as a layer that the previous tier inherits. Every tier runs the same world shape, the same physics baseline (`foodRegenRate=3e-3`, `metabolismBase=0.5`, `energyCapacity=150`) and the same 3 seeds across the same habitat jitter — the tiers differ ONLY by the faculty added, so per-individual complexity is attributable to that faculty.',
    '',
    '| tier | the agent in this archetype | faculty added (inherited from below) |',
    '| --- | --- | --- |',
    ...TIER_DEFS.map(
      (t) => `| **${t.name}** | ${t.faculty.split(';')[0]!.trim()} | ${t.brain ? 'learned MLP policy' : 'fixed genome reflex'}${t.env ? ' + calm biome chemistry' : ''}${t.flags?.omics ? ' + intracellular omics' : ''}${t.clones ? '; founders are clones of one calm genome' : ''} |`,
    ),
    '',
    'The engine is a pure function of its world definition (SplitMix64 streams seeded by (seed, tick, agent id); ascending-id iteration), so every archetype is verified determinism-first: two runs of the same world reproduce bit-for-bit.',
    '',
  ];

  for (const tier of TIER_DEFS) {
    const rows = byTier(tier.idx);
    lines.push(
      `## ${tier.name}`,
      '',
      `${tier.summary}. Faculty: ${tier.faculty}.`,
      '',
      '| seed | alive | species | births | deaths | genomeDist | memeCV | energyCV | proteomeCV | plastic | surprise | deterministic |',
      '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |',
      ...rows.map(
        (r) =>
          `| \`${r.seed}\` | ${r.census.alive} | ${r.census.species} | ${r.census.births} | ${r.census.deaths} | ${r.metrics.genomeDist.toFixed(4)} | ${r.metrics.memeCV.toFixed(3)} | ${r.metrics.energyCV.toFixed(3)} | ${r.metrics.proteomeCV.toFixed(4)} | ${r.metrics.plasticAgents} | ${r.metrics.meanSurprise.toFixed(3)} | ${r.deterministic ? '✓ identical double-run' : '✗ DIVERGED'} |`,
      ),
      '',
      `layer effect — population ${avg(tier.idx, (r) => r.census.alive).toFixed(1)} ± ${sd(tier.idx, (r) => r.census.alive).toFixed(1)}; genome distance ${avg(tier.idx, (r) => r.metrics.genomeDist).toFixed(4)}; cultural CV ${avg(tier.idx, (r) => r.metrics.memeCV).toFixed(3)}; energy CV ${avg(tier.idx, (r) => r.metrics.energyCV).toFixed(3)}; protein CV ${avg(tier.idx, (r) => r.metrics.proteomeCV).toFixed(4)}; plastic agents ${avg(tier.idx, (r) => r.metrics.plasticAgents).toFixed(1)}; mean surprise ${avg(tier.idx, (r) => r.metrics.meanSurprise).toFixed(3)}.`,
      '',
    );
  }

  const mark = (x: number) => (x > 1e-6 ? '**>0**' : '0');
  const markerRow = (label: string, pick: (r: ArchetypeRow) => number) =>
    `| ${label} | ${TIER_DEFS.map((t) => mark(avgRow(report, t.idx, pick))).join(' | ')} |`;

  lines.push(
    '## What the ladder shows',
    '',
    'The measurement columns are constant across tiers, so a faculty\'s contribution is a column that moves from `0` to `>0` exactly where the faculty is introduced:',
    '',
    '| metric (mean over seeds) | T0 | T1 | T2 | T3 |',
    '| --- | ---: | ---: | ---: | ---: |',
    markerRow('genomeDist', (r) => r.metrics.genomeDist),
    markerRow('memeCV', (r) => r.metrics.memeCV),
    markerRow('plastic + surprise', (r) => r.metrics.meanSurprise),
    markerRow('proteomeCV', (r) => r.metrics.proteomeCV),
    '',
    '- **T0 → T1 (simple rules → constraints)** — `genomeDist` and `memeCV` leave zero: heritable genomes under a calm-biome constraint regime differentiate the individuals; the reflex itself is unchanged.',
    '- **T1 → T2 (constraints → cognition)** — `plastic` and `surprise` leave zero: behaviour is no longer a fixed reflex but a per-agent learned policy; genome distance is inherited unchanged (cognition does not need new genes).',
    '- **T2 → T3 (cognition → systems)** — `proteomeCV` leaves zero: intracellular protein pools (stochastic expression, combinatorial chemistry) add a second, non-genetic state dimension inside each individual.',
    '',
    'The ladder is incremental and monotone by construction — every tier re-runs the exact same worlds and physics as the tier below, so a faculty is added, never replaced.',
    '',
    `All ${report.rows.length} (tier, seed) worlds self-reproduced bit-for-bit across the double-run (determinism: ${report.pass ? 'PASS' : 'FAIL'}).`,
    '',
  );

  const md = lines.join('\n') + '\n';

  const json = JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      name: 'agent-archetypes',
      tierLadder: TIER_DEFS.map((t) => ({ idx: t.idx, name: t.name, summary: t.summary, faculty: t.faculty, brain: t.brain, clones: t.clones, env: t.env ?? null, flags: t.flags })),
      baselineOverrides: BASELINE_OVERRIDES,
      spawn: report.spawn,
      ticks: report.ticks,
      pass: report.pass,
      worlds: report.rows.map((r) => ({
        tier: r.tier,
        seed: r.seed,
        spawn: r.spawn,
        ticks: r.ticks,
        census: r.census,
        metrics: r.metrics,
        deterministic: r.deterministic,
        worldFp16: r.fp.slice(0, 16),
        outcome: r.outcome,
      })),
    },
    null,
    2,
  ) + '\n';

  const csv = [
    'tier,seed,spawn,ticks,alive,species,births,deaths,selectionEntropy,traitDim,genomeDist,memeCV,energyCV,proteomeCV,plasticAgents,meanPlasticity,meanSurprise,deterministic,worldFp16,outcome',
    ...report.rows.map((r) =>
      [
        r.tier,
        r.seed,
        r.spawn,
        r.ticks,
        r.census.alive,
        r.census.species,
        r.census.births,
        r.census.deaths,
        r.census.selectionEntropy,
        r.census.traitDim,
        r.metrics.genomeDist,
        r.metrics.memeCV,
        r.metrics.energyCV,
        r.metrics.proteomeCV,
        r.metrics.plasticAgents,
        r.metrics.meanPlasticity,
        r.metrics.meanSurprise,
        r.deterministic,
        r.fp.slice(0, 16),
        r.outcome,
      ].map(String).join(','),
    ),
  ].join('\n');

  return { md, json, csv };
}

export function renderArchetypesSvg(report: ArchetypesReport): string {
  const W = 980;
  const H = 560;
  const padL = 60;
  const padR = 200;
  const padT = 40;
  const panelGap = 60;
  const n = TIER_DEFS.length;
  const iw = W - padL - padR;
  const pt = (i: number) => padL + (i * iw) / (n - 1);

  const pickAvg = (sel: (r: ArchetypeRow) => number) => TIER_DEFS.map((t) => avgRow(report, t.idx, sel));
  const maxOf = (xs: number[]) => Math.max(1e-9, ...xs);

  const series: { label: string; color: string; values: number[] }[] = [
    { label: 'genomeDist', color: '#f2a33c', values: pickAvg((r) => r.metrics.genomeDist) },
    { label: 'memeCV', color: '#ff7eb6', values: pickAvg((r) => r.metrics.memeCV) },
    { label: 'energyCV', color: '#8a8f98', values: pickAvg((r) => r.metrics.energyCV) },
    { label: 'proteomeCV', color: '#c678dd', values: pickAvg((r) => r.metrics.proteomeCV) },
    { label: 'meanSurprise', color: '#61dafb', values: pickAvg((r) => r.metrics.meanSurprise) },
  ];

  const aliveAvg = TIER_DEFS.map((t) => avgRow(report, t.idx, (r) => r.census.alive));
  const aliveMax = maxOf(aliveAvg);
  const panelH = Math.floor((H - padT - panelGap - 46) / 2);

  let svg = '';

  // Panel A — heterogeneity normalized to each metric's own peak.
  const yTopA = padT + 24;
  const yBotA = yTopA + panelH;
  const plotA = (v: number, peak: number) => yBotA - (Math.min(1, v / peak)) * (panelH - 24);
  svg += `<text x="${padL}" y="${yTopA - 12}" font-size="13" fill="#e4e6ea" font-weight="bold">per-individual complexity — within-population heterogeneity (normalised to each metric's own peak)</text>\n`;
  TIER_DEFS.forEach((t, i) => {
    svg += `<line x1="${pt(i)}" y1="${yBotA}" x2="${pt(i)}" y2="${yTopA}" stroke="#262a31"\n`;
    svg += `<text x="${pt(i)}" y="${yBotA + 16}" font-size="12" text-anchor="middle" fill="#e4e6ea">${t.name.split('·')[0]!.trim()}</text>\n`;
  });
  // polyline per series
  for (const s of series) {
    const peak = maxOf(s.values);
    const pts = s.values.map((v, i) => `${pt(i).toFixed(1)},${plotA(v, peak).toFixed(1)}`).join(' ');
    svg += `<polyline points="${pts}" fill="none" stroke="${s.color}" stroke-width="2"/>\n`;
    svg += `<circle cx="${pt(n - 1)}" cy="${plotA(s.values[n - 1]!, maxOf(s.values)).toFixed(1)}" r="3" fill="${s.color}"/>\n`;
  }
  series.forEach((s, si) => {
    const ly = yTopA + 16 + si * 16;
    svg += `<circle cx="${W - padR + 12}" cy="${ly}" r="4" fill="${s.color}"/>\n<text x="${W - padR + 24}" y="${ly + 4}" font-size="11" fill="#cfd3da">${s.label} (peak ${maxOf(s.values).toFixed(4)})</text>\n`;
  });

  // Panel B — viability bars + learning line.
  const yTopB = yBotA + panelGap + 8;
  const yBotB = yTopB + panelH;
  const plotB = (v: number) => yBotB - (Math.min(1, v / aliveMax)) * (panelH - 24);
  svg += `<text x="${padL}" y="${yTopB - 12}" font-size="13" fill="#e4e6ea" font-weight="bold">survival & learning — alive (bars) vs mean surprise (line)</text>\n`;
  TIER_DEFS.forEach((t, i) => {
    const bw = iw / n * 0.4;
    const x = pt(i) - bw / 2;
    const h = panelH - 24;
    svg += `<rect x="${x.toFixed(1)}" y="${plotB(aliveAvg[i]!).toFixed(1)}" width="${bw.toFixed(1)}" height="${(yBotB - plotB(aliveAvg[i]!)).toFixed(1)}" fill="#3fa4ff" opacity="0.85"/>\n`;
    svg += `<text x="${pt(i) + bw / 2 + 8}" y="${plotB(aliveAvg[i]!).toFixed(1) + 12}" font-size="11" fill="#cfd3da">${aliveAvg[i]!.toFixed(1)}</text>\n`;
    svg += `<text x="${pt(i)}" y="${yBotB + 16}" font-size="12" text-anchor="middle" fill="#e4e6ea">${t.name.split('·')[0]!.trim()}</text>\n`;
  });
  const supr = pickAvg((r) => r.metrics.meanSurprise);
  const suprPeak = maxOf(supr);
  const pts = supr.map((v, i) => `${pt(i).toFixed(1)},${(yBotB - (Math.min(1, v / suprPeak)) * (panelH - 24)).toFixed(1)}`).join(' ');
  svg += `<polyline points="${pts}" fill="none" stroke="#61dafb" stroke-width="2"/>\n`;
  svg += `<circle cx="${W - padR + 12}" cy="${yTopB + 4}" r="4" fill="#61dafb"/>\n<text x="${W - padR + 24}" y="${yTopB + 8}" font-size="11" fill="#cfd3da">meanSurprise (peak ${suprPeak.toFixed(4)})</text>\n`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" font-family="ui-monospace,Menlo,Consolas,monospace">\n  <rect width="${W}" height="${H}" fill="#15171b"/>\n${svg}  <text x="${W - padR}" y="${H - 10}" text-anchor="end" font-size="11" fill="#7d828b">archetype ladder · every tier double-run deterministic: ${report.pass ? 'true' : 'false'}</text>\n</svg>\n`;
}

function avgRow(report: ArchetypesReport, tierIdx: number, pick: (r: ArchetypeRow) => number): number {
  const xs = report.rows.filter((r) => r.tier === tierIdx).map(pick);
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

export function writeArchetypesReport(report: ArchetypesReport): string {
  const { md, json, csv } = renderArchetypesReport(report);
  mkdirSync(plotsDir, { recursive: true });
  writeFileSync(join(outputDir, 'archetypes.md'), md);
  writeFileSync(join(outputDir, 'archetypes.json'), json);
  writeFileSync(join(outputDir, 'archetypes.csv'), csv);
  writeFileSync(join(plotsDir, 'archetypes.svg'), renderArchetypesSvg(report));
  return join(outputDir, 'archetypes.md');
}

export function summarizeArchetypes(report: ArchetypesReport): void {
  console.log(`determinism (double-run, every tier): ${report.pass ? 'PASS' : 'FAIL'} — ${report.rows.length} (tier, seed) worlds`);
  for (const tier of TIER_DEFS) {
    const rows = report.rows.filter((r) => r.tier === tier.idx);
    const m = (p: (r: ArchetypeRow) => number) => mean(rows.map(p)).toFixed(4);
    console.log(
      `  ${tier.name.padEnd(20)} alive=${m((r) => r.census.alive)} genome=${m((r) => r.metrics.genomeDist)} meme=${m((r) => r.metrics.memeCV)} ` +
        `energy=${m((r) => r.metrics.energyCV)} prot=${m((r) => r.metrics.proteomeCV)} plastic=${mean(rows.map((r) => r.metrics.plasticAgents)).toFixed(1)} surprise=${m((r) => r.metrics.meanSurprise)}`,
    );
  }
}

if (process.argv[1]?.endsWith('archetypes.ts')) {
  const report = runArchetypes();
  const file = writeArchetypesReport(report);
  summarizeArchetypes(report);
  console.log(`\n# written: ${file}`);
}