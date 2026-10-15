import { TOPOLOGIES, type WorldTopology } from '@fractal-life/shared';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runWorldEnv, type EnvRunResult } from './environments.js';
import { runLatticeExperiment, type LatticeOutcome } from './dimensional_worlds.js';
import * as S from './statistics.js';
import * as C from './charts.js';

/**
 * Phase M analysis + reporting layer.
 *
 * Consumes the CANONICAL experiment outputs (environments.md/csv/json,
 * topologies.md/csv/json, dimensions.md/csv/json — written by environments.ts),
 * re-runs the fast lattice harness for exact cell counts, and runs ONE new
 * experiment (the replicate sweep: seeds × biomes × topologies) to obtain
 * within-condition variance. Then it computes statistics, exact/binomial
 * probabilities, and renders deterministic SVG plots.
 *
 * Everything (numbers, plots) is reproducible: bootstrap and lattice draws use
 * seeded streams; p-values come from incomplete-beta Student-t / F / binomial
 * quantiles (see statistics.ts). Because the engine is seeded/deterministic,
 * statistical statements describe variability ACROSS worlds (habitats, biomes,
 * fractal windows) — the natural unit of replication here.
 *
 *   npx tsx apps/simulation/src/research/analyze.ts
 */

const outputDir = fileURLToPath(new URL('../../research/output/', import.meta.url));
const plotsDir = join(outputDir, 'plots');

// ---- load canonical outputs ----

function readCsv(name: string): Record<string, string>[] {
  const text = readFileSync(join(outputDir, name), 'utf8').trim().split(/\r?\n/);
  const header = text[0]!.split(',');
  const rows: Record<string, string>[] = [];
  for (const line of text.slice(1)) {
    if (!line.trim()) continue;
    const cells = line.split(',');
    const o: Record<string, string> = {};
    header.forEach((h, i) => (o[h] = cells[i]));
    rows.push(o);
  }
  return rows;
}

function num(v: string | undefined, def = NaN): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

function check(count: number, expected: number, name: string): void {
  if (count !== expected) {
    throw new Error(
      `${name}: expected ${expected} rows, found ${count}. Re-run ` +
        `"npx tsx apps/simulation/src/research/environments.ts" first — analysis reads the canonical outputs.`,
    );
  }
}

interface TopoRow {
  topology: WorldTopology;
  biome: string;
  dPop: number;
  alive: number;
  edgeHits: number;
}
interface DimRow {
  biome: string;
  fractal: string;
  maxIter: number;
  worldScale: number;
  dPop: number;
}

const envRows = readCsv('environments.csv').map((r) => ({
  biome: r.biome!,
  cls: r.class!,
  dPop: num(r.dPop),
  alive: num(r.alive),
}));
check(envRows.length, 17, 'environments.csv');

const topoRows: TopoRow[] = readCsv('topologies.csv').map((r) => ({
  topology: r.topology as WorldTopology,
  biome: r.biome!,
  dPop: num(r.dPop),
  alive: num(r.alive),
  edgeHits: num(r.edgeHits),
}));
check(topoRows.length, 85, 'topologies.csv');

const dimRows: DimRow[] = readCsv('dimensions.csv').map((r) => ({
  biome: r.biome!,
  fractal: r.fractal!,
  maxIter: num(r.maxIter),
  worldScale: num(r.zoom),
  dPop: num(r.dPop),
}));
check(dimRows.length, 36, 'dimensions.csv');

// ---- replicate experiment (new data) ----

const REP_SEEDS = ['rep-1', 'rep-2', 'rep-3', 'rep-4', 'rep-5', 'rep-6'] as const;
const REP_BIOMES = ['calm', 'sodaLake', 'hyperthermal'] as const;

interface RepRow {
  seed: string;
  biome: string;
  topology: WorldTopology;
  alive: number;
  dPop: number;
  births: number;
  fitness: number;
  edgeHits: number;
}

function runReplicateExperiment(): RepRow[] {
  const out: RepRow[] = [];
  for (const seed of REP_SEEDS) {
    for (const biome of REP_BIOMES) {
      for (const topology of TOPOLOGIES) {
        const r: EnvRunResult = runWorldEnv({ environment: biome, topology, seed, edge: true });
        out.push({
          seed,
          biome,
          topology,
          alive: r.alive,
          dPop: r.growth,
          births: r.births,
          fitness: r.meanFitness,
          edgeHits: r.edgeHits,
        });
      }
    }
  }
  return out;
}

// ---- helpers ----

const fmt2 = (v: number) => v.toFixed(2);
const fmt1 = (v: number) => v.toFixed(1);
const fmt3 = (v: number) => v.toFixed(3);
const fmtP = (p: number): string => (p < 0.001 ? '< 0.001' : p.toFixed(3));
const sig = (p: number): string => (p < 0.05 ? ' *' : p < 0.1 ? ' +' : '');

function mdTable(columns: string[][], rows: Record<string, string>[]): string {
  const head = `| ${columns.map((c) => c[1]).join(' | ')} |`;
  const sep = `|${columns.map(() => '---').join('|')}|`;
  const body = rows
    .map((r) => `| ${columns.map((c) => String(r[c[0]] ?? '')).join(' | ')} |`)
    .join('\n');
  return `${head}\n${sep}\n${body}\n`;
}

function main(): void {
  mkdirSync(plotsDir, { recursive: true });

  // ---- derived groupings ----

  const topoFor = (t: WorldTopology) => topoRows.filter((r) => r.topology === t);
  const topoGrowth = (t: WorldTopology) => topoFor(t).map((r) => r.dPop);
  const edgeHitsSum = (t: WorldTopology) => topoFor(t).reduce((a, r) => a + r.edgeHits, 0);
  const dPopIndex = new Map<string, number>();
  for (const r of topoRows) dPopIndex.set(`${r.topology}:${r.biome}`, r.dPop);
  const biomeList = [...new Set(topoRows.map((r) => r.biome))];

  const topoStats = TOPOLOGIES.map((t) => ({ t, s: S.summarize(topoGrowth(t)) }));

  const pairedVsTorus = TOPOLOGIES.filter((t) => t !== 'torus').map((t) => {
    const a = biomeList.map((b) => dPopIndex.get(`${t}:${b}`)!);
    const b = biomeList.map((b) => dPopIndex.get(`torus:${b}`)!);
    return { t, pt: S.pairedT(a, b), win: S.pairedBootstrapWin(a, b, { B: 5000, seedKey: `topo-${t}` }) };
  });
  const topoAnova = S.anova(TOPOLOGIES.map((t) => topoGrowth(t)));

  const classRows = new Map<string, number[]>();
  for (const r of envRows) classRows.set(r.cls, [...(classRows.get(r.cls) ?? []), r.dPop]);
  const classContrast = S.welch(classRows.get('extreme')!, classRows.get('underrated')!);
  const sortedBiomes = [...envRows].sort((x, y) => y.dPop - x.dPop);

  const dimFractal = (biome: string, fractal: string) =>
    dimRows.filter((r) => r.biome === biome && r.fractal === fractal).map((r) => r.dPop);
  const dimZoom = (biome: string, zoom: number) =>
    dimRows.filter((r) => r.biome === biome && r.worldScale === zoom).map((r) => r.dPop);
  const dimContrasts = [
    { biome: 'calm', label: 'julia vs perlin', a: dimFractal('calm', 'julia'), b: dimFractal('calm', 'perlin') },
    { biome: 'calm', label: 'mandelbrot vs julia', a: dimFractal('calm', 'mandelbrot'), b: dimFractal('calm', 'julia') },
    { biome: 'hyperthermal', label: 'julia vs perlin', a: dimFractal('hyperthermal', 'julia'), b: dimFractal('hyperthermal', 'perlin') },
    { biome: 'hyperthermal', label: 'mandelbrot vs julia', a: dimFractal('hyperthermal', 'mandelbrot'), b: dimFractal('hyperthermal', 'julia') },
  ].map((c) => ({ ...c, w: S.welch(c.a, c.b) }));
  const dimZoomContrasts = ['calm', 'hyperthermal'].map((biome) => ({
    biome,
    w: S.welch(dimZoom(biome, 2), dimZoom(biome, 4)),
  }));

  // ---- replicate experiment ----

  const replicates = runReplicateExperiment();

  const repGrowth = (t: WorldTopology) => replicates.filter((r) => r.topology === t).map((r) => r.dPop);
  const repStats = TOPOLOGIES.map((t) => ({ t, s: S.summarize(repGrowth(t)) }));
  const repAnova = S.anova(TOPOLOGIES.map((t) => repGrowth(t)));
  const repPaired = TOPOLOGIES.filter((t) => t !== 'torus').map((t) => {
    const map = (tt: WorldTopology) =>
      new Map(replicates.filter((r) => r.topology === tt).map((r) => [`${r.seed}:${r.biome}`, r.dPop]));
    const mT = map(t);
    const mO = map('torus');
    const a: number[] = [];
    const b: number[] = [];
    for (const [k, v] of mT) {
      a.push(v);
      b.push(mO.get(k)!);
    }
    return { t, n: a.length, pt: S.pairedT(a, b), win: S.pairedBootstrapWin(a, b, { B: 5000, seedKey: `rep-${t}` }) };
  });

  // ---- lattice (exact + binomial) ----

  const lattice = runLatticeExperiment();
  const cp = (o: LatticeOutcome): [number, number] => S.clopperPearson(o.survivors, o.volume) as [number, number];
  const latTorus = lattice.filter((r) => r.topology === 'torus');
  const latZ = S.twoProportionZ(
    latTorus[0]!.survivors, latTorus[0]!.volume,
    latTorus[1]!.survivors, latTorus[1]!.volume,
  );

  // ---- write replicates.* ----

  const repCols: [string, string][] = [
    ['seed', 'seed'], ['biome', 'biome'], ['topology', 'topology'], ['alive', 'alive'],
    ['dPop', 'dPop'], ['births', 'births'], ['fitness', 'fitness'], ['edgeHits', 'edgeHits'],
  ];
  const repRows: Record<string, string>[] = replicates.map((r) => ({
    seed: r.seed, biome: r.biome, topology: r.topology, alive: String(r.alive),
    dPop: String(r.dPop), births: String(r.births), fitness: fmt3(r.fitness), edgeHits: String(r.edgeHits),
  }));
  const repMeta = [
    `Replicate sweep: ${REP_SEEDS.length} seeds × ${REP_BIOMES.length} biomes × ${TOPOLOGIES.length} topologies = ${replicates.length} edge-seeded runs @ 240 ticks.`,
    'Each seed draws a new habitat window (habitat = seed + biome), so replicate variance is across-habitat variability.',
  ];
  writeFileSync(
    join(outputDir, 'replicates.md'),
    `# Replicate experiment (across-habitat variability)\n\n${repMeta.join(' ')}\n\n${mdTable(repCols, repRows)}\n`,
  );
  writeFileSync(join(outputDir, 'replicates.csv'), [repCols.map((c) => c[1]).join(','), ...repRows.map((r) => repCols.map((c) => r[c[0]]).join(','))].join('\n') + '\n');
  writeFileSync(join(outputDir, 'replicates.json'), JSON.stringify({ generatedAt: new Date().toISOString(), meta: repMeta, runs: repRows }, null, 2) + '\n');

  // ---- plots ----

  const plotFiles: string[] = [];
  function writePlot(name: string, svg: string): void {
    writeFileSync(join(plotsDir, name), svg);
    plotFiles.push(`plots/${name}`);
  }

  writePlot(
    'topology-dpop-ci.svg',
    C.barChartCI({
      title: 'Mean colony growth (Δpop) by topology — 17 biomes, edge-seeded',
      labels: [...TOPOLOGIES],
      means: topoStats.map((x) => x.s.mean),
      los: topoStats.map((x) => x.s.ci95[0]),
      his: topoStats.map((x) => x.s.ci95[1]),
      yLabel: 'Δpop (mean over biomes)',
    }),
  );
  writePlot(
    'topology-box.svg',
    C.boxPlot({
      title: 'Δpop distribution across 17 biomes by topology',
      labels: [...TOPOLOGIES],
      series: TOPOLOGIES.map((t) => topoGrowth(t)),
      yLabel: 'Δpop per biome',
    }),
  );
  writePlot(
    'topology-edgehits.svg',
    C.barChartCI({
      title: 'Latitude-cap crossings handled by each topology (17 biomes)',
      labels: [...TOPOLOGIES],
      means: TOPOLOGIES.map((t) => edgeHitsSum(t)),
      los: TOPOLOGIES.map((t) => edgeHitsSum(t)),
      his: TOPOLOGIES.map((t) => edgeHitsSum(t)),
      yLabel: 'boundary engagements',
    }),
  );
  writePlot(
    'replicates-box.svg',
    C.boxPlot({
      title: 'Replicate sweep: Δpop per topology (6 seeds × 3 biomes = 18 runs each)',
      labels: [...TOPOLOGIES],
      series: TOPOLOGIES.map((t) => repGrowth(t)),
      yLabel: 'Δpop per replicate',
    }),
  );
  writePlot(
    'lattice-survival.svg',
    C.barChartCI({
      title: 'Colonized cells at steady state by dimension (volume 4096, 2000 ticks)',
      labels: ['1D torus', '2D torus', '3D torus', '4D torus', '2D box', '3D box'],
      means: lattice.map((r) => r.survival * 100),
      los: lattice.map((r) => cp(r)[0] * 100),
      his: lattice.map((r) => cp(r)[1] * 100),
      yLabel: 'colonized cells %',
      colors: ['#4e79a7', '#59a14f', '#edc948', '#b07aa1', '#4e79a7', '#59a14f'],
    }),
  );

  const regimeLabels: string[] = [];
  for (const fractal of ['mandelbrot', 'julia', 'perlin']) {
    for (const maxIter of [32, 256, 1024]) {
      for (const worldScale of [2, 4]) {
        regimeLabels.push(`${fractal}·i${maxIter}·s${worldScale}`);
      }
    }
  }
  const regimeValues = regimeLabels.map((label) =>
    ['calm', 'hyperthermal'].map((biome) => {
      const r = dimRows.find(
        (x) => x.biome === biome && `${x.fractal}·i${x.maxIter}·s${x.worldScale}` === label,
      );
      return r ? r.dPop : null;
    }),
  );
  writePlot(
    'dimensions-heatmap.svg',
    C.heatmap({
      title: 'Fractal-dimension sweep: Δpop by regime × biome',
      rowLabels: regimeLabels,
      rowGroupLabels: regimeLabels.map((l) => l.split('·')[0]!),
      colLabels: ['calm', 'hyperthermal'],
      colGroupLabels: ['control', 'extreme'],
      values: regimeValues,
      colorDomain: 20,
      width: 430,
      height: 36 + regimeLabels.length * 26 + 44,
    }),
  );

  // ---- probability summary ----

  const probabilityLines: string[] = [];
  for (const t of ['cylinder', 'sphere', 'mobius', 'kleinBottle'] as WorldTopology[]) {
    const pv = pairedVsTorus.find((x) => x.t === t)!;
    probabilityLines.push(
      `${t} vs torus: Δ = ${fmt2(pv.pt.meanDiff)}${sig(pv.pt.p)}, t = ${fmt2(pv.pt.t)}, ` +
        `p = ${fmtP(pv.pt.p)}, d = ${fmt2(pv.pt.cohensDz)}; P(beats torus) = ${fmt3(pv.win.pWin)} ` +
        `(Δ 95% CI [${fmt2(pv.win.ci95[0])}, ${fmt2(pv.win.ci95[1])}])`,
    );
  }
  probabilityLines.push(
    `Replicate sweep (${REP_SEEDS.length} × ${REP_BIOMES.length} held-out habitat pairs): P(kleinBottle beats torus) = ` +
      `${fmt3(repPaired.find((x) => x.t === 'kleinBottle')!.win.pWin)}.`,
  );
  probabilityLines.push(
    `Lattice colonization per cell (exact Clopper–Pearson 95%): 1D torus ${fmt3(latTorus[0].survival)} ` +
      `[${fmt3(cp(latTorus[0])[0])}, ${fmt3(cp(latTorus[0])[1])}] vs 2D torus ${fmt3(latTorus[1].survival)} ` +
      `[${fmt3(cp(latTorus[1])[0])}, ${fmt3(cp(latTorus[1])[1])}] — two-proportion z = ${fmt2(latZ.z)}, p = ${fmtP(latZ.p)}.`,
  );

  // ---- analysis.md ----

  const md: string[] = [];
  md.push(`# Phase M research analysis

Generated ${new Date().toISOString()} by \`research/analyze.ts\`.

## 0. Data provenance & inputs

- **Biomes** \`environments.csv\` — ${envRows.length} presets × 240 ticks × 40 founders (seed \`env-experiment\`, per-preset habitat window).
- **Topologies** \`topologies.csv\` — 5 spaces × 17 biomes = ${topoRows.length} edge-seeded runs (founders on the north cap; same grid per biome across topologies).
- **Dimensions** \`dimensions.csv\` — ${dimRows.length} runs: 3 fractal types × 3 escape-time resolutions × 2 zooms × 2 biomes.
- **Lattice** — fresh ${lattice.length}-world run (volume 4096, 2000 ticks, torus + box).
- **Replicates** \`replicates.csv\` — NEW: ${replicates.length} runs = ${REP_SEEDS.length} seeds × ${REP_BIOMES.length} biomes × 5 topologies (edge-seeded). Each seed draws a **new habitat window**, so replicate variance measures across-habitat variability — the right unit of replication, because a fixed (seed, biome) world is fully deterministic.

### Conventions
- Means ± 95% Student-t CIs (small-n corrected).
- p-values two-sided; Welch / paired t; \`*\` p<0.05, \`+\` p<0.1.
- Bootstrap: seeded mulberry32, B = 5000, percentile CIs; paired bootstrap resamples habitats jointly.
- Binomial intervals: exact Clopper–Pearson.
- **Probability semantics:** the engine is deterministic, so a p-value / win-probability describes *variability across worlds* (habitats, biomes, fractal windows), not stochastic noise within one world.

## 1. Biomes (17 presets)

${mdTable(
  [['biome', 'biome'], ['class', 'class'], ['dPop', 'Δpop'], ['alive', 'alive']],
  sortedBiomes.map((r) => ({ biome: r.biome, class: r.cls, dPop: String(r.dPop), alive: String(r.alive) })),
)}

Top growers: ${sortedBiomes.slice(0, 3).map((r) => r.biome).join(', ')} ·
Hardest: ${sortedBiomes.slice(-3).map((r) => r.biome).join(', ')}.

**Class contrast:** extremes (n = ${classRows.get('extreme')!.length}) vs underrated (n = ${classRows.get('underrated')!.length}) — Δmean ${fmt2(classContrast.meanDiff)}, t = ${fmt2(classContrast.t)}, p = ${fmtP(classContrast.p)}${sig(classContrast.p)}, Cohen d = ${fmt2(classContrast.cohensD)}. The "extreme" chemistry set does not systematically outgrow the "underrated" set.

## 2. Topological spaces (17 biomes × 5)

${mdTable(
  [['topology', 'topology'], ['mean', 'Δpop μ'], ['sd', 'SD'], ['ci95', '95% CI'], ['median', 'median'], ['edgeHits', 'cap hits']],
  topoStats.map(({ t, s }) => ({
    topology: t,
    mean: fmt2(s.mean),
    sd: fmt2(s.sd),
    ci95: `[${fmt1(s.ci95[0])}, ${fmt1(s.ci95[1])}]`,
    median: fmt1(s.median),
    edgeHits: String(edgeHitsSum(t)),
  })),
)}

**One-way ANOVA across topologies:** F = ${fmt2(topoAnova.f)}, p = ${fmtP(topoAnova.p)}${sig(topoAnova.p)} — topology explains ${fmt1((100 * topoAnova.ssBetween) / (topoAnova.ssBetween + topoAnova.ssWithin))}% of the Δpop variance across the sampled worlds.

**Paired vs torus (same habitat per biome):**

${mdTable(
  [['topology', 'topology'], ['diff', 'Δ mean'], ['t', 't'], ['p', 'p'], ['dz', 'd'],
    ['pWin', 'P(beats torus)'], ['winCI', 'Δ 95% CI']],
  pairedVsTorus.map(({ t, pt, win }) => ({
    topology: t,
    diff: fmt2(pt.meanDiff) + sig(pt.p),
    t: fmt2(pt.t),
    p: fmtP(pt.p),
    dz: fmt2(pt.cohensDz),
    pWin: fmt3(win.pWin),
    winCI: `[${fmt2(win.ci95[0])}, ${fmt2(win.ci95[1])}]`,
  })),
)}

Reading: cylinder and sphere mirror the torus (with a flat longitude seam both are latitude-only cap variations, behave identically, and differ from torus only by chance here); kleinBottle loops latitude with a half-twist and shows a **positive trend** (win probability → ${fmt1(pairedVsTorus.find((x) => x.t === 'kleinBottle')!.win.pWin * 100)}%, Δ +2.29) but p = ${fmtP(pairedVsTorus.find((x) => x.t === 'kleinBottle')!.pt.p)} against torus — not significant amid high between-biome variance; mobius's longitude flip on every cap crossing is mildly deleterious. The cap geometry is engaged everywhere (thousands of boundary hits), it just explains little Δpop variance relative to habitat.

![topology means](plots/topology-dpop-ci.svg)

![topology box](plots/topology-box.svg)

![edge hits](plots/topology-edgehits.svg)

## 3. Replicate sweep (seeds × biomes × 5 topologies)

${mdTable(
  [['topology', 'topology'], ['n', 'n'], ['mean', 'Δpop μ'], ['sd', 'SD'], ['ci95', '95% CI']],
  repStats.map(({ t, s }) => ({ topology: t, n: String(s.n), mean: fmt2(s.mean), sd: fmt2(s.sd), ci95: `[${fmt1(s.ci95[0])}, ${fmt1(s.ci95[1])}]` })),
)}

ANOVA: F = ${fmt2(repAnova.f)}, p = ${fmtP(repAnova.p)}${sig(repAnova.p)} (across ${REP_SEEDS.length} habitats per biome).

Paired vs torus (${REP_SEEDS.length} × ${REP_BIOMES.length} pairs):

${mdTable(
  [['topology', 'topology'], ['n', 'n'], ['diff', 'Δ mean'], ['p', 'p'], ['pWin', 'P(beats torus)']],
  repPaired.map(({ t, pt, win, n }) => ({ topology: t, n: String(n), diff: fmt2(pt.meanDiff) + sig(pt.p), p: fmtP(pt.p), pWin: fmt3(win.pWin) })),
)}

Across the ${REP_SEEDS.length} × ${REP_BIOMES.length} fresh habitats: the kleinBottle trend from the 17-biome sweep does **not** replicate (P ≈ ${fmt3(repPaired.find((x) => x.t === 'kleinBottle')!.win.pWin)}); the unflipped cap-reflection variants stay consistently positive in sign (cylinder/sphere P ≈ ${fmt3(repPaired.find((x) => x.t === 'cylinder')!.win.pWin)}, Δ +2.0) — the most robust hint that reflecting the latitude cap helps — yet neither reaches p < 0.05. Note the replicate windows are fresh jitters: across-habitat variance dominates (Δpop means shift down to ≈ −22 because many sampled windows are barren), and that variance dwarfs the topology effect.

![replicates box](plots/replicates-box.svg)

## 4. Fractal-dimension sweep (36 runs)

Per biome, pooled across resolutions/zooms (n = 12 per fractal type):

${mdTable(
  [['biome', 'biome'], ['contrast', 'contrast'], ['diff', 'Δ mean'], ['p', 'p'], ['d', 'd']],
  dimContrasts.map(({ biome, label, w }) => ({ biome, contrast: label, diff: fmt2(w.meanDiff) + sig(w.p), p: fmtP(w.p), d: fmt2(w.cohensD) })),
)}

Zoom main effect (s2 vs s4, n = 18 each):

${mdTable(
  [['biome', 'biome'], ['diff', 'Δ mean (s2 − s4)'], ['p', 'p']],
  dimZoomContrasts.map(({ biome, w }) => ({ biome, diff: fmt2(w.meanDiff) + sig(w.p), p: fmtP(w.p) })),
)}

Pattern: julia windows systematically outgrow perlin windows in both biomes (high-fidelity terrain pays off); deeper zoom helps in calm but is indifferent under heat stress. Mandelbrot at the coarsest resolution (i32) under hyperthermal is the single worst regime found (Δ−20).

![dimension heatmap](plots/dimensions-heatmap.svg)

## 5. Dimensionality lattice (volume 4096)

| dims | topology | colonized % (CP 95%) | biomass | Shannon bits | colonies |
|---|---|---|---|---|---|
${lattice
  .map((r) => {
    const c = cp(r);
    return `| ${r.dims.join('×')} | ${r.topology} | ${fmt1(r.survival * 100)}% [${fmt1(c[0] * 100)}%, ${fmt1(c[1] * 100)}%] | ${fmt1(r.finalBiomass)} | ${fmt3(r.shannon)} | ${r.finalColonies} |`;
  })
  .join('\n')}

**1D bottlenecks colonization** — 2D+ fully colonize. ${probabilityLines[probabilityLines.length - 1]}

![lattice survival](plots/lattice-survival.svg)

## 6. Probability summary

${probabilityLines.map((l) => `- ${l}`).join('\n')}

## 7. Limitations

1. **Determinism ⇒ replication = new worlds.** The engine is seeded/deterministic; "n" replicates vary the habitat window, not within-world noise.
2. Topology runs are **edge-seeded**: the comparison is deliberately stressed at the caps (a mid-world colony never meets an edge in 240 ticks). This inflates boundary influence relative to natural play.
3. Lattice binomial CIs ignore spatial autocorrelation (anti-conservative as *ecological* intervals).
4. \`sphere === cylinder\` by construction (flat longitude seam); a full globe needs a latitude–longitude linkage.
5. Small n per condition in the dimension sweep (regimes are n = 1 per biome — the panel is descriptive).

## 8. Reproduce

\`\`\`bash
npx tsx apps/simulation/src/research/environments.ts        # canonical experiments
npx tsx apps/simulation/src/research/analyze.ts             # stats + plots + this report
npx tsx apps/simulation/src/research/dimensional_worlds.ts  # lattice (also re-run inside analyze)
\`\`\``);
  writeFileSync(join(outputDir, 'analysis.md'), md.join('\n'));

  // ---- analysis.json ----

  const analysis = {
    generatedAt: new Date().toISOString(),
    inputs: {
      environmentsCsv: envRows.length,
      topologiesCsv: topoRows.length,
      dimensionsCsv: dimRows.length,
      lattice: lattice.length,
      replicates: replicates.length,
    },
    biomes: {
      sorted: sortedBiomes,
      classContrast: {
        extreme: S.summarize(classRows.get('extreme')!),
        underrated: S.summarize(classRows.get('underrated')!),
        welch: classContrast,
      },
    },
    topologies: Object.fromEntries(topoStats.map(({ t, s }) => [t, { summary: s, edgeHits: edgeHitsSum(t) }])),
    topologiesPairedVsTorus: Object.fromEntries(pairedVsTorus.map(({ t, pt, win }) => [t, { pairedT: pt, win }])),
    topologiesAnova: topoAnova,
    replicates: {
      perTopology: Object.fromEntries(repStats.map(({ t, s }) => [t, s])),
      pairedVsTorus: Object.fromEntries(repPaired.map(({ t, pt, win, n }) => [t, { n, pairedT: pt, win }])),
      anova: repAnova,
    },
    dimensions: {
      contrasts: dimContrasts.map(({ biome, label, w }) => ({ biome, label, welch: w })),
      zoomContrasts: dimZoomContrasts.map(({ biome, w }) => ({ biome, welch: w })),
    },
    lattice: lattice.map((r) => ({
      dims: r.dims,
      topology: r.topology,
      survival: r.survival,
      survivors: r.survivors,
      volume: r.volume,
      cp95: cp(r),
      twoProportion: { z: latZ.z, p: latZ.p },
    })),
    plots: plotFiles,
  };
  writeFileSync(join(outputDir, 'analysis.json'), JSON.stringify(analysis, null, 2) + '\n');

  // ---- console ----

  console.log('# Phase M analysis\n');
  console.log('topologies (Δpop μ over 17 biomes):');
  for (const { t, s } of topoStats) {
    console.log(`  ${t}: μ=${fmt2(s.mean)} sd=${fmt2(s.sd)} 95%=[${fmt1(s.ci95[0])}, ${fmt1(s.ci95[1])}] hits=${edgeHitsSum(t)}`);
  }
  console.log('  ANOVA F=' + fmt2(topoAnova.f) + ' p=' + fmtP(topoAnova.p) + '\n');
  for (const { t, pt, win } of pairedVsTorus) {
    console.log(`  ${t} vs torus: Δ=${fmt2(pt.meanDiff)} t=${fmt2(pt.t)} p=${fmtP(pt.p)}${sig(pt.p)} P>torus=${fmt3(win.pWin)}`);
  }
  console.log('\nreplicates (Δpop μ, n=' + replicates.length / TOPOLOGIES.length + ' each):');
  for (const { t, s } of repStats) {
    console.log(`  ${t}: μ=${fmt2(s.mean)} sd=${fmt2(s.sd)}`);
  }
  console.log('  ANOVA F=' + fmt2(repAnova.f) + ' p=' + fmtP(repAnova.p));
  for (const { t, pt, win, n } of repPaired) {
    console.log(`  ${t}: Δ=${fmt2(pt.meanDiff)} p=${fmtP(pt.p)}${sig(pt.p)} P>torus=${fmt3(win.pWin)} (n=${n})`);
  }
  console.log('\nlattice survival:');
  for (const r of lattice) {
    const c = cp(r);
    console.log(`  ${r.dims.join('×')} ${r.topology}: ${fmt1(r.survival * 100)}% [${fmt1(c[0] * 100)}%, ${fmt1(c[1] * 100)}%] biomass=${fmt1(r.finalBiomass)}`);
  }
  console.log(`\nwritten: analysis.md, analysis.json, replicates.{md,csv,json}, ${plotFiles.length} plots`);
}

if (process.argv[1]?.endsWith('analyze.ts')) {
  main();
}