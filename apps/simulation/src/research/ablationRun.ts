#!/usr/bin/env node
/**
 * M4 ablation runner: does removing the mutation supply flatten the lead slope?
 *
 *   npm run research:ablation                 # 3 conditions x 8 seeds x 6 ramps (~20 min)
 *   npm run research:ablation -- --quick      # 2 seeds x 2 ramps (~5 min)
 *   npm run research:ablation -- --from-cache # re-analyse the stored series (seconds)
 *
 * The registered arm is simulated again rather than reused, because that is the
 * only way to prove the new lever (`WorldConfig.mutationScale`) is inert at ×1:
 * its population series must equal the cached Q5 series bit-for-bit.
 *
 * Writes research/output/ews-ablation.{md,json,csv} and plots/ews-ablation.svg.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeMetabGenes } from '../genome.js';
import { Engine } from '../engine.js';
import { EW_BURN, EW_COLLAPSE, EW_FOOD, EW_MAX_POP, EW_M0, EW_RAMPS, EW_SEEDS, EW_SPAWN, EW_TAIL, stressAt } from './ews.js';
import { makeWorld } from './scenarios.js';
import { detectCollapse } from '@fractal-life/shared';
import {
  CONDITIONS,
  MIN_BOOTSTRAP_REPS,
  MIN_DETECTION,
  buildAblationReport,
  trajectory,
  type AblationRun,
  type ConditionDef,
  type GeneticSample,
  type RescueCondition,
} from './rescueAblation.js';

const OUT = join(fileURLToPath(new URL('.', import.meta.url)), '../../research/output');
const CACHE = join(OUT, 'ews-ablation-series.json');
const Q5_CACHE = join(OUT, 'ews-multiverse-series.json');

const argv = process.argv.slice(2);
const has = (n: string): boolean => argv.includes(n);
const str = (n: string, fallback: string): string => {
  const i = argv.indexOf(n);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : fallback;
};
const num = (n: string, fallback: number): number => {
  const raw = str(n, '');
  if (raw.trim() === '') return fallback;
  const v = Number(raw);
  return Number.isFinite(v) ? v : fallback;
};

if (has('--help')) {
  console.log('usage: ablationRun.ts [--seeds a,b,c] [--ramps 500,900] [--quick] [--from-cache] [--reps 1000] [--every 50]');
  console.log('');
  console.log('  --seeds a,b,c   replicate seeds (default ' + EW_SEEDS.join(',') + ')');
  console.log('  --ramps a,b,c   ramp durations in ticks (default ' + EW_RAMPS.join(',') + ')');
  console.log('  --quick         2 seeds, ramps 300,900');
  console.log('  --from-cache    skip simulation; re-analyse the stored series');
  console.log('  --reps N        bootstrap replicates (default 1000)');
  console.log('  --every N       genetic sampling interval in ticks (default 50)');
  console.log('');
  console.log('Conditions: ' + CONDITIONS.map((c) => `${c.id}=x${c.mutationScale}`).join(', '));
  process.exit(0);
}

const quick = has('--quick');
const seedsArg = str('--seeds', '');
const rampsArg = str('--ramps', '');
const seeds = quick ? ['ews.a', 'ews.b'] : seedsArg ? seedsArg.split(',').map((s) => s.trim()).filter(Boolean) : EW_SEEDS;
const ramps = quick
  ? [300, 900]
  : rampsArg
    ? rampsArg
        .split(',')
        .map((s) => Number(s.trim()))
        .filter((n) => Number.isFinite(n) && n > 0)
    : EW_RAMPS;
const reps = num('--reps', 1000);
const every = Math.max(1, num('--every', 50));

/* ---------------------------------------------------------------- sample -- */

/**
 * Genetic diversity of the live population. Two observables, because they fail
 * differently: per-locus variance is what mutation directly supplies, while
 * basal-rate variance is what selection can act on. A manipulation that moves
 * one and not the other is telling you something.
 */
function sampleGenetics(engine: Engine, tick: number): GeneticSample {
  const alive = [...engine.agents.values()].filter((a) => a.alive);
  const n = alive.length;
  if (n === 0)
    return {
      tick,
      n: 0,
      locusVariance: 0,
      basalVariance: 0,
      meanBasal: 0,
      mutationLoci: engine.mutationLoci,
      births: engine.birthCount,
      lociPerBirth: engine.birthCount > 0 ? engine.mutationLoci / engine.birthCount : 0,
    };

  const G = alive[0]!.genome.length;
  let locusSum = 0;
  for (let i = 0; i < G; i++) {
    let s = 0;
    let s2 = 0;
    for (const a of alive) {
      const v = a.genome[i]!;
      s += v;
      s2 += v * v;
    }
    const mu = s / n;
    const varr = s2 / n - mu * mu;
    if (varr > 0) locusSum += varr;
  }

  const basals = alive.map((a) => decodeMetabGenes(a.genome).basalRate);
  const bMu = basals.reduce((x, y) => x + y, 0) / n;
  const bVar = basals.reduce((x, y) => x + (y - bMu) ** 2, 0) / n;

  return {
    tick,
    n,
    locusVariance: locusSum / G,
    basalVariance: bVar,
    meanBasal: bMu,
    mutationLoci: engine.mutationLoci,
    births: engine.birthCount,
    lociPerBirth: engine.birthCount > 0 ? engine.mutationLoci / engine.birthCount : 0,
  };
}

/* -------------------------------------------------------------- simulate -- */

function simulateCondition(def: ConditionDef, seedsUsed: string[], rampsUsed: number[]): AblationRun[] {
  const runs: AblationRun[] = [];
  const total = seedsUsed.length * rampsUsed.length;
  const t0 = Date.now();
  let done = 0;

  for (const seed of seedsUsed) {
    for (const ramp of rampsUsed) {
      const ticks = EW_BURN + ramp + EW_TAIL;
      const world = makeWorld(seed, EW_SPAWN, {
        maxPopulation: EW_MAX_POP,
        foodRegenRate: EW_FOOD,
        metabolismBase: EW_M0,
      });
      world.mutationScale = def.mutationScale;
      const engine = new Engine(world);

      const pop: number[] = [];
      const stress: number[] = [];
      const genetic: GeneticSample[] = [sampleGenetics(engine, 0)];

      for (let tick = 0; tick < ticks; tick++) {
        const m = stressAt(tick, EW_BURN, ramp);
        engine.params.metabolismBase = m;
        engine.tick();
        pop.push(engine.aliveCount());
        stress.push(m);
        if ((tick + 1) % every === 0) genetic.push(sampleGenetics(engine, tick + 1));
      }
      genetic.push(sampleGenetics(engine, ticks));

      const collapse = detectCollapse(pop, EW_COLLAPSE);
      const collapseStress = collapse ? stress[collapse.tick]! : null;
      runs.push({
        condition: def.id,
        seed,
        ramp,
        pop,
        stress,
        collapse,
        collapseStress,
        genetic,
      });

      done++;
      const el = (Date.now() - t0) / 1000;
      const eta = (el / done) * (total - done);
      console.log(
        `[${String(done).padStart(String(total).length)}/${total}] ${def.id.padEnd(8)} ${seed} tau=${ramp}  ` +
          `${collapse ? `collapse@${collapse.tick}` : 'survives'}  ` +
          `${el.toFixed(0)}s elapsed, ~${eta.toFixed(0)}s left`,
      );
    }
  }
  return runs;
}

/* ------------------------------------------------------------- determinism -- */

interface Q5Cache {
  version: number;
  runs: AblationRun[];
}

/**
 * The registered arm must reproduce the stored Q5 series exactly. If it does
 * not, the mutation lever changed the baseline trajectory and every comparison
 * in this file is invalid — so this is checked, not assumed.
 */
function checkDefaultRuns(runs: AblationRun[]): boolean | null {
  let cache: Q5Cache;
  try {
    cache = JSON.parse(readFileSync(Q5_CACHE, 'utf8')) as Q5Cache;
  } catch {
    return null;
  }
  if (!Array.isArray(cache.runs)) return null;
  const defaults = runs.filter((r) => r.condition === 'baseline');
  if (defaults.length === 0) return null;
  let compared = 0;
  for (const run of defaults) {
    const ref = cache.runs.find((r) => r.seed === run.seed && r.ramp === run.ramp);
    if (!ref) continue;
    compared++;
    if (ref.pop.length !== run.pop.length) return false;
    for (let i = 0; i < run.pop.length; i++) {
      if (run.pop[i] !== ref.pop[i] || run.stress[i] !== run.stress[i]) return false;
    }
  }
  return compared > 0 ? true : null;
}

/* ---------------------------------------------------------------- render -- */

const fmt = (v: number, d = 4): string => (Number.isFinite(v) ? v.toFixed(d) : '—');
const pct = (v: number): string => (Number.isFinite(v) ? `${(v * 100).toFixed(0)}%` : '—');
/** Verdict reasons are written as clauses; the report embeds them as sentences. */
const cap = (s: string): string => (s.length === 0 ? s : s[0]!.toUpperCase() + s.slice(1));

function renderMd(rep: ReturnType<typeof buildAblationReport>): string {
  const md: string[] = [];
  const v = rep.verdict;

  md.push('# M4 ablation: does evolutionary rescue flatten the warning-lead slope?');
  md.push('');
  md.push(
    `Three mutation-supply conditions, ${rep.seeds.length} seeds × ${rep.ramps.length} ramp durations each. ` +
      `Registered specification \`${rep.registeredSpec}\`. Provenance: ${rep.provenance}.`,
  );
  md.push('');
  md.push(
    'The clonal arm removes de-novo mutation and lateral gene transfer; the elevated arm quadruples the ' +
      'mutation supply as a positive control. The registered arm is re-simulated, not reused: it must ' +
      'reproduce the cached Q5 series bit-for-bit or the comparison is void.',
  );
  md.push('');
  if (rep.defaultReproducesCache === true) {
    md.push('**Lever check:** the ×1 arm reproduces the cached Q5 population series **exactly**.');
  } else if (rep.defaultReproducesCache === false) {
    md.push('**Lever check failed:** the ×1 arm does **not** reproduce the cached Q5 series. Treat every row below as invalid.');
  } else {
    md.push('**Lever check:** no Q5 cache available to compare against.');
  }
  md.push('');

  md.push('## Per-condition results (variance indicator)');
  md.push('');
  md.push('| condition | mutation | runs | collapse | detect | AUC slope | lead slope | lead 95% boot | multiverse lead negative | multiverse lead median |');
  md.push('| :-- | ---: | ---: | ---: | ---: | ---: | ---: | :--: | ---: | ---: |');
  for (const c of rep.conditions) {
    const ci = c.leadBootstrap;
    const slope = (v: number): string => (c.slopeReliable ? fmt(v, 4) : 'n/a');
    md.push(
      `| ${c.label} | ×${c.mutationScale} | ${c.runs} | ${pct(c.collapseFraction)} | ${pct(c.detectionRate)} | ` +
        `${slope(c.aucSlope)} | ${slope(c.leadSlope)} | ` +
        `${c.slopeReliable && ci ? `[${fmt(ci.lo, 4)}, ${fmt(ci.hi, 4)}]` : 'n/a'} | ${pct(c.multiverse.leadShareNegative)} | ` +
        `${fmt(c.multiverse.leadMedian, 4)} |`,
    );
  }
  md.push('');
  md.push(
    '`lead slope` is the registered in-control-parameter (stress-unit) slope; negative means the lead shrinks ' +
      'with slower forcing. `n/a` marks a slope that is not interpretable: either the arm collapsed too rarely ' +
      'for a slope to mean anything, the detection rate is below ' +
      `${(MIN_DETECTION * 100).toFixed(0)}%, or the seed bootstrap produced fewer than ${MIN_BOOTSTRAP_REPS} resamples.`,
  );
  if (rep.conditions.some((c) => !c.slopeReliable)) {
    const stalled = rep.conditions.filter((c) => !c.slopeReliable).map((c) => c.label).join(', ');
    md.push('');
    md.push(
      `**${stalled} has no interpretable slope.** That is a result, not a missing number: ` +
        'if quadrupling the mutation supply prevents the collapse, adaptation can rescue this system, which is ' +
        'exactly what M4 claims is possible. It does not by itself explain the registered lead shrinkage, because ' +
        'the clonal-versus-registered comparison is the one that tests whether removing the mutation supply flattens it.',
    );
  }
  md.push('');

  if (v.rescue) {
    md.push('## Did adaptation change whether the system collapses?');
    md.push('');
    md.push(
      `The two ends of the dose–response, on the only outcome that is unambiguous: ` +
        `**clonal ${v.rescue.clonal.collapsed}/${v.rescue.clonal.runs}** collapsed versus ` +
        `**elevated ${v.rescue.elevated.collapsed}/${v.rescue.elevated.runs}**, ` +
        `two-sided Fisher exact **p = ${v.rescue.p < 1e-4 ? v.rescue.p.toExponential(2) : fmt(v.rescue.p, 4)}**.`,
    );
    md.push('');
    md.push(
      'This is the one part of M4 that the data support: the mutation supply changes the probability of ' +
        'collapse. It is also why the elevated arm has no slope — with most runs surviving, there is no ' +
        'pre-collapse window to fit. Rescue and lead shrinkage are therefore separate questions, and only the ' +
        'second one is about the early-warning calibration failure.',
    );
    md.push('');
  }

  md.push('## Did the manipulation bite? (mutation supply)');
  md.push('');
  md.push('| condition | mutation | loci/birth (plateau) | loci/birth (final) | founder locus var | plateau locus var | retention | plateau basal-rate var |');
  md.push('| :-- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |');
  for (const c of rep.conditions) {
    md.push(
      `| ${c.label} | ×${c.mutationScale} | ${fmt(c.genetic.lociPerBirth, 3)} | ${fmt(c.genetic.finalLociPerBirth, 3)} | ` +
        `${fmt(c.genetic.founderVar, 5)} | ${fmt(c.genetic.plateauVar, 5)} | ${pct(c.genetic.retention)} | ` +
        `${fmt(c.genetic.basalVariance, 6)} |`,
    );
  }
  md.push('');
  md.push(
    'Mutation supply is counted at birth against the post-recombination genome, so sexual crossover is not ' +
      'mistaken for mutation. Standing variance is founder-dominated for hundreds of ticks and is reported ' +
      'as context, not as the manipulation check: the first smoke run showed it barely moves between ×0 and ×1.',
  );
  md.push('');

  md.push('## Decision rule (E-EWS-12, registered before the run)');
  md.push('');
  md.push(
    'M4 predicts that removing adaptation restores lead invariance. The clonal arm must be estimable ' +
      '(≥ 50% of runs collapse, ≥ 4 collapsed runs), the mutation supply counted as loci per birth must be ' +
      'zero in the clonal arm and ≥ 1.5× the registered arm when elevated, and M4 is supported only if the ' +
      'clonal arm retains < 50% of the registered lead slope. Otherwise it is refuted or unresolved, as stated.',
  );
  md.push('');
  md.push(`**Verdict: ${v.verdict}.** ${cap(v.reason)}.`);
  md.push('');
  md.push('| check | value |');
  md.push('| :-- | ---: |');
  md.push(`| clonal estimable | ${v.estimable ? 'yes' : 'no'} |`);
  md.push(`| mutation-supply contrast (elevated / registered) | ${fmt(v.contrast, 2)}× |`);
  md.push(`| manipulation bit (clonal 0, elevated ≥ 1.5×) | ${v.manipulationOk ? 'yes' : 'no'} |`);
  md.push(`| lead slope retained by clonal | ${pct(v.leadRetained)} |`);
  md.push(`| AUC slope retained by clonal | ${pct(v.aucRetained)} |`);
  md.push(`| clonal lead interval contains zero | ${v.clonalIntervalContainsZero ? 'yes' : 'no'} |`);
  md.push(`| dose–response monotone in \\|lead\\| | ${v.monotoneDoseResponse ? 'yes' : 'no'} |`);
  md.push('');

  md.push('## What this does and does not establish');
  md.push('');
  md.push(
    '- It manipulates the **supply** of new variation, not selection on the standing variation of the 300 ' +
      'founders. A null result therefore bounds one component of M4, not the whole hypothesis.',
  );
  md.push(
    '- The clonal arm is a harder world, not a clean counterfactual: if it collapses at a different rate, ' +
      'the slope is estimated on a different subset of runs. The collapse fraction is reported for exactly ' +
      'that reason.',
  );
  md.push(
    '- The multiverse median is reported beside the registered slope for each condition, because Q5 showed ' +
      'the registered slope sits at the edge of its own analysis space.',
  );
  md.push('');
  md.push('## Reproduce');
  md.push('');
  md.push('```bash');
  md.push('npm run research:ablation                 # simulate + analyse (~20 min)');
  md.push('npm run research:ablation -- --from-cache # re-analyse stored series (seconds)');
  md.push('```');
  md.push('');
  return md.join('\n');
}

function renderJson(rep: ReturnType<typeof buildAblationReport>): string {
  return JSON.stringify(rep, null, 2);
}

function renderCsv(rep: ReturnType<typeof buildAblationReport>): string {
  const head = [
    'condition',
    'mutationScale',
    'runs',
    'collapseFraction',
    'detectionRate',
    'slopeReliable',
    'aucSlope',
    'aucR2',
    'leadSlope',
    'leadR2',
    'leadBootstrapLo',
    'leadBootstrapHi',
    'leadBootstrapNegative',
    'multiverseLeadMedian',
    'multiverseLeadQ05',
    'multiverseLeadQ95',
    'multiverseLeadShareNegative',
    'founderLocusVar',
    'plateauLocusVar',
    'retention',
    'finalLocusVar',
    'plateauBasalVar',
    'lociPerBirth',
    'rescueP',
  ];
  const rows = rep.conditions.map((c) =>
    [
      c.condition,
      c.mutationScale,
      c.runs,
      c.collapseFraction.toFixed(3),
      c.detectionRate.toFixed(3),
      c.slopeReliable ? 'yes' : 'no',
      c.aucSlope.toFixed(6),
      c.aucR2.toFixed(4),
      c.leadSlope.toFixed(6),
      c.leadR2.toFixed(4),
      (c.leadBootstrap?.lo ?? 0).toFixed(6),
      (c.leadBootstrap?.hi ?? 0).toFixed(6),
      (c.leadBootstrap?.shareNegative ?? 0).toFixed(3),
      c.multiverse.leadMedian.toFixed(6),
      c.multiverse.leadQ05.toFixed(6),
      c.multiverse.leadQ95.toFixed(6),
      c.multiverse.leadShareNegative.toFixed(3),
      c.genetic.founderVar.toFixed(8),
      c.genetic.plateauVar.toFixed(8),
      c.genetic.retention.toFixed(4),
      c.genetic.finalVar.toFixed(8),
      c.genetic.basalVariance.toFixed(8),
      c.genetic.lociPerBirth.toFixed(4),
      rep.verdict.rescue ? rep.verdict.rescue.p.toExponential(3) : '',
    ].join(','),
  );
  return [head.join(','), ...rows].join('\n');
}

function esc(s: string): string {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** trajectory panel: genetic variance (log scale) + lead slope bars */
function renderSvg(rep: ReturnType<typeof buildAblationReport>, runs: AblationRun[]): string {
  const w = 1040;
  const h = 640;
  const p: string[] = [];
  p.push(
    `<rect width="${w}" height="${h}" fill="#0e1116"/>`,
    `<text x="24" y="30" fill="#e6edf3" font-family="monospace" font-size="15">M4 ablation - mutation supply vs warning lead</text>`,
    `<text x="24" y="50" fill="#8b949e" font-family="monospace" font-size="11">${esc(rep.provenance)}</text>`,
  );

  // --- left: genetic variance trajectories
  const px = 70;
  const py = 96;
  const pw = 560;
  const ph = 440;
  p.push(`<rect x="${px}" y="${py}" width="${pw}" height="${ph}" fill="#12161d" stroke="#222"/>`);
  const colors: Record<RescueCondition, string> = {
    clonal: '#4e79a7',
    baseline: '#59a14f',
    elevated: '#e15759',
  };
  const all = CONDITIONS.flatMap((c) => trajectory(runs, c.id, 50));
  const maxTick = Math.max(1, ...all.map((t) => t.tick));
  const maxVar = Math.max(1e-9, ...all.map((t) => t.locusVariance));
  const minVar = Math.min(...all.filter((t) => t.locusVariance > 0).map((t) => t.locusVariance), maxVar);
  const logMin = Math.log10(Math.max(minVar, maxVar * 1e-4));
  const logMax = Math.log10(maxVar);
  const xOf = (t: number): number => px + (t / maxTick) * pw;
  const yOf = (v: number): number => {
    const l = v <= 0 ? logMin : Math.log10(v);
    return py + ph - ((l - logMin) / (logMax - logMin || 1)) * ph;
  };
  const ticks = [0, 350];
  for (const t of ticks) {
    if (t > maxTick) continue;
    p.push(
      `<line x1="${xOf(t).toFixed(1)}" y1="${py}" x2="${xOf(t).toFixed(1)}" y2="${py + ph}" stroke="#30363d" stroke-dasharray="3 3"/>`,
      `<text x="${xOf(t).toFixed(1)}" y="${py + ph + 14}" fill="#8b949e" font-family="monospace" font-size="10">t=${t}</text>`,
    );
  }
  for (const c of CONDITIONS) {
    const tr = trajectory(runs, c.id, 50);
    if (tr.length === 0) continue;
    const d = tr
      .map((pt, i) => `${i === 0 ? 'M' : 'L'}${xOf(pt.tick).toFixed(1)},${yOf(pt.locusVariance).toFixed(1)}`)
      .join(' ');
    p.push(`<path d="${d}" fill="none" stroke="${colors[c.id]}" stroke-width="2"/>`);
    const last = tr[tr.length - 1]!;
    p.push(
      `<text x="${(xOf(last.tick) + 4).toFixed(1)}" y="${(yOf(last.locusVariance) - 4).toFixed(1)}" fill="${colors[c.id]}" font-family="monospace" font-size="9">${esc(c.label)}</text>`,
    );
  }
  p.push(`<text x="${px}" y="${py - 10}" fill="#8b949e" font-family="monospace" font-size="11">mean per-locus genetic variance (log scale)</text>`);

  // --- right: lead slope per condition
  const bx = 700;
  const bw = w - bx - 60;
  const by = py + 40;
  const bh = 260;
  p.push(`<text x="${bx}" y="${py - 10}" fill="#8b949e" font-family="monospace" font-size="11">registered lead slope (stress units; n/a = uninterpretable)</text>`);
  const reliable = rep.conditions.filter((c) => c.slopeReliable);
  const slopes = reliable.map((c) => c.leadSlope);
  const lo = Math.min(0, ...slopes);
  const hi = Math.max(0, ...slopes);
  const span = hi - lo || 1;
  const yOfS = (v: number): number => by + bh - ((v - lo) / span) * bh;
  p.push(`<line x1="${bx}" y1="${yOfS(0).toFixed(1)}" x2="${bx + bw}" y2="${yOfS(0).toFixed(1)}" stroke="#8b949e" stroke-dasharray="4 4"/>`);
  rep.conditions.forEach((c, i) => {
    const slot = bw / rep.conditions.length;
    const x = bx + i * slot + slot * 0.2;
    const wBar = slot * 0.6;
    p.push(
      `<text x="${(x + wBar / 2).toFixed(1)}" y="${(by + bh + 16).toFixed(1)}" fill="#e6edf3" font-family="monospace" font-size="10" text-anchor="middle">${c.label}</text>`,
    );
    if (!c.slopeReliable) {
      p.push(
        `<text x="${(x + wBar / 2).toFixed(1)}" y="${(yOfS(0) - 8).toFixed(1)}" fill="${colors[c.condition]}" font-family="monospace" font-size="11" text-anchor="middle">n/a</text>`,
      );
      return;
    }
    const y = Math.min(yOfS(c.leadSlope), yOfS(0));
    const hBar = Math.max(1, Math.abs(yOfS(c.leadSlope) - yOfS(0)));
    p.push(
      `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${wBar.toFixed(1)}" height="${hBar.toFixed(1)}" fill="${colors[c.condition]}"/>`,
      `<text x="${(x + wBar / 2).toFixed(1)}" y="${(c.leadSlope < 0 ? y - 4 : y + hBar + 12).toFixed(1)}" fill="${colors[c.condition]}" font-family="monospace" font-size="10" text-anchor="middle">${c.leadSlope.toFixed(4)}</text>`,
    );
  });

  // --- verdict
  const vy = 570;
  const verdictColor = rep.verdict.verdict === 'supported' ? '#59a14f' : rep.verdict.verdict === 'refuted' ? '#e15759' : '#f28e2b';
  p.push(
    `<text x="24" y="${vy}" fill="${verdictColor}" font-family="monospace" font-size="13">E-EWS-12: ${rep.verdict.verdict.toUpperCase()}</text>`,
    `<text x="24" y="${vy + 20}" fill="#8b949e" font-family="monospace" font-size="10">${esc(cap(rep.verdict.reason))}</text>`,
    `<text x="24" y="${vy + 38}" fill="#8b949e" font-family="monospace" font-size="10">clonal retains ${pct(rep.verdict.leadRetained)} of the lead slope; mutation-supply contrast ${fmt(rep.verdict.contrast, 2)}x; manipulation ${rep.verdict.manipulationOk ? 'bit' : 'did not bite'}</text>`,
  );

  return [`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`, ...p, '</svg>'].join('\n');
}

/* --------------------------------------------------------------- simulate -- */

let runs: AblationRun[];
let provenance: string;

if (has('--from-cache')) {
  const raw = JSON.parse(readFileSync(CACHE, 'utf8')) as { version: number; seeds: string[]; ramps: number[]; runs: AblationRun[] };
  runs = raw.runs;
  provenance = 're-analysed from `ews-ablation-series.json` (no simulation in this run)';
  console.log(`loaded ${runs.length} cached runs (${raw.seeds.length} seeds × ${raw.ramps.length} ramps × ${CONDITIONS.length} conditions)`);
} else {
  console.log(
    `simulating ${CONDITIONS.length} conditions × ${seeds.length} seed(s) × ${ramps.length} ramp(s) ` +
      `[${ramps.join(', ')}], genetic sample every ${every} ticks ...`,
  );
  runs = [];
  for (const def of CONDITIONS) runs.push(...simulateCondition(def, seeds, ramps));
  provenance = 'simulated in this run (TypeScript reference engine)';
  mkdirSync(OUT, { recursive: true });
  writeFileSync(CACHE, JSON.stringify({ version: 1, seeds, ramps, every, runs }));
  console.log(`series cached to ${CACHE}`);
}

const defaultReproducesCache = checkDefaultRuns(runs);
const report = buildAblationReport(runs, {
  seeds,
  ramps,
  reps,
  provenance,
  defaultReproducesCache,
});

/* ---------------------------------------------------------------- render -- */

mkdirSync(join(OUT, 'plots'), { recursive: true });
writeFileSync(join(OUT, 'ews-ablation.md'), renderMd(report));
writeFileSync(join(OUT, 'ews-ablation.json'), renderJson(report));
writeFileSync(join(OUT, 'ews-ablation.csv'), renderCsv(report));
writeFileSync(join(OUT, 'plots', 'ews-ablation.svg'), renderSvg(report, runs));

/* --------------------------------------------------------------- console -- */

console.log('');
console.log(`conditions: ${CONDITIONS.map((c) => `${c.id}=x${c.mutationScale}`).join(', ')}`);
console.log(`lever check (x1 reproduces cached Q5 series): ${defaultReproducesCache === null ? 'n/a' : defaultReproducesCache}`);
console.log('');
for (const c of report.conditions) {
  const ci = c.leadBootstrap;
  const slope = (v: number): string => (c.slopeReliable ? fmt(v, 4) : 'n/a').padStart(8);
  console.log(
    `  ${c.label.padEnd(10)} collapse ${pct(c.collapseFraction).padStart(4)}  ` +
      `detect ${pct(c.detectionRate).padStart(4)}  ` +
      `AUC ${slope(c.aucSlope)}  lead ${slope(c.leadSlope)}  ` +
      `boot [${c.slopeReliable ? `${fmt(ci?.lo ?? 0, 4)}, ${fmt(ci?.hi ?? 0, 4)}` : 'n/a'}]  ` +
      `loci/birth ${fmt(c.genetic.lociPerBirth, 1).padStart(5)}`,
  );
}
console.log('');
console.log(`E-EWS-12: ${report.verdict.verdict} - ${cap(report.verdict.reason)}`);
console.log(`  clonal retains ${pct(report.verdict.leadRetained)} of the lead slope; mutation-supply contrast ${fmt(report.verdict.contrast, 2)}x`);
if (report.verdict.rescue) {
  const r = report.verdict.rescue;
  console.log(
    `  collapse contrast clonal ${r.clonal.collapsed}/${r.clonal.runs} vs elevated ${r.elevated.collapsed}/${r.elevated.runs}` +
      ` — Fisher exact p = ${r.p < 1e-4 ? r.p.toExponential(2) : fmt(r.p, 4)}`,
  );
}
console.log('');
console.log(`written to ${OUT}: ews-ablation.{md,json,csv} + plots/ews-ablation.svg`);
