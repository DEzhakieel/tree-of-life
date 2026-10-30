#!/usr/bin/env node
/**
 * Experiment A runner - evolutionary doomsday.
 *
 *   npm run research:doomsday                 # 4 arms x 8 lineages, two fitness modes
 *   npm run research:doomsday -- --quick     # 2 lineages x 4 generations, ~10 s
 *   npm run research:doomsday -- --from-cache
 *
 * Two fitness definitions are run over the *same* ancestors:
 *   births       - literal 0 -> 1 transitions (primary; the question as asked)
 *   established  - newborn cells still alive DD_MATURITY ticks later (definitional
 *                  check; raw births saturate at the period-2 global flipper)
 *
 * Artifacts: research/output/doomsday.{md,json,csv} and plots/doomsday.svg.
 * The pre-registered analysis lives in docs/CLAIMS.md (A-DOOM-01..04).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ARMS,
  DD_ASSAY_REPLICATES,
  DD_GENS,
  DD_LINEAGES,
  DD_MATURITY,
  DD_MEANINGFUL_COST,
  DD_MIN_PREPOP,
  DD_POP,
  DD_SIZE,
  FAMILIES,
  LifeCA,
  CONWAY,
  assayRule,
  buildDoomsdayReport,
  evolveLineage,
  ruleLabel,
  sampleAncestor,
  scoreRule,
  type DoomsdayReport,
  type Family,
  type FitnessMode,
  type LineageResult,
  type RuleRobustness,
  type Score,
} from './doomsday.js';

const OUT = join(fileURLToPath(new URL('.', import.meta.url)), '../../research/output');
const CACHE = join(OUT, 'doomsday-series.json');
const MODES: readonly FitnessMode[] = ['births', 'established'];

const argv = process.argv.slice(2);
const has = (n: string): boolean => argv.includes(n);
const str = (n: string, fallback: string): string => {
  const i = argv.indexOf(n);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1]! : fallback;
};
const num = (n: string, fallback: number): number => {
  const raw = str(n, '');
  if (raw.trim() === '') return fallback;
  const v = Number(raw);
  return Number.isFinite(v) ? v : fallback;
};

if (has('--help')) {
  console.log('usage: doomsdayRun.ts [--quick] [--from-cache] [--seeds a,b] [--gens N] [--pop N] [--reps N]');
  console.log('');
  console.log('  --quick       2 seeds x 4 generations x 8 rules, 1 assay replicate');
  console.log('  --from-cache  re-analyse research/output/doomsday-series.json');
  console.log('  --seeds a,b   lineage seeds (default dd.a..dd.h)');
  console.log('  --gens N      generations per lineage (default ' + DD_GENS + ')');
  console.log('  --pop N       rules per generation (default ' + DD_POP + ')');
  console.log('  --reps N      assay replicates (default ' + DD_ASSAY_REPLICATES + ')');
  process.exit(0);
}

const quick = has('--quick');
const seedsArg = str('--seeds', '');
const defaultSeeds = Array.from({ length: DD_LINEAGES }, (_, i) => `dd.${String.fromCharCode(97 + i)}`);
const seeds = seedsArg
  ? seedsArg.split(',').map((s) => s.trim()).filter(Boolean)
  : quick
    ? ['dd.a', 'dd.b']
    : defaultSeeds;
const gens = Math.max(1, num('--gens', quick ? 4 : DD_GENS));
const pop = Math.max(4, num('--pop', quick ? 8 : DD_POP));
const reps = Math.max(1, num('--reps', quick ? 1 : DD_ASSAY_REPLICATES));

const fmt = (v: number, d = 3): string => (Number.isFinite(v) ? v.toFixed(d) : 'n/a');
const pct = (v: number): string => (Number.isFinite(v) ? `${(v * 100).toFixed(0)}%` : 'n/a');
const ci = (lo: number, hi: number, d = 3): string =>
  Number.isFinite(lo) && Number.isFinite(hi) ? `[${lo.toFixed(d)}, ${hi.toFixed(d)}]` : 'n/a';
const signed = (v: number, d = 3): string => (Number.isFinite(v) ? (v >= 0 ? `+${v.toFixed(d)}` : v.toFixed(d)) : 'n/a');

function mergeRobustness(rule: number, parts: RuleRobustness[]): RuleRobustness {
  const points = parts.flatMap((p) => p.points);
  const byFamily = {
    noise: { retention: Number.NaN, collapseRate: Number.NaN, n: 0 },
    death: { retention: Number.NaN, collapseRate: Number.NaN, n: 0 },
    compute: { retention: Number.NaN, collapseRate: Number.NaN, n: 0 },
  };
  for (const f of FAMILIES) {
    const pts = points.filter((p) => p.family === f && Number.isFinite(p.retention));
    byFamily[f] = {
      retention: pts.length ? pts.reduce((s, p) => s + p.retention, 0) / pts.length : Number.NaN,
      collapseRate: pts.length ? pts.filter((p) => p.collapsed).length / pts.length : Number.NaN,
      n: pts.length,
    };
  }
  return {
    rule,
    points,
    byFamily,
    benignViability: parts.length ? parts.reduce((s, p) => s + p.benignViability, 0) / parts.length : 0,
    prePop: parts.length ? parts.reduce((s, p) => s + p.prePop, 0) / parts.length : 0,
    preTurnover: parts.length ? parts.reduce((s, p) => s + p.preTurnover, 0) / parts.length : 0,
  };
}

interface Cache {
  version: number;
  seeds: string[];
  size: number;
  gens: number;
  pop: number;
  assayReplicates: number;
  runs: Record<FitnessMode, LineageResult[]>;
  conway: { rule: number; score: Score; robustness: RuleRobustness };
}

let cache: Cache;

if (has('--from-cache')) {
  cache = JSON.parse(readFileSync(CACHE, 'utf8')) as Cache;
  if (cache.version !== 2) {
    throw new Error(`cache version ${cache.version} is not the two-mode v2 format; rerun without --from-cache`);
  }
  console.log(
    `loaded ${MODES.map((m) => `${m} ${cache.runs[m].length}`).join(' / ')} lineages from cache ` +
      `(${cache.seeds.length} seeds x ${cache.gens} generations, size ${cache.size})`,
  );
} else {
  const size = DD_SIZE;
  const ca = new LifeCA(size);
  const runs: Record<FitnessMode, LineageResult[]> = { births: [], established: [] };
  console.log(
    `evolving ${ARMS.length} arms x ${seeds.length} lineages x ${gens} generations x ${MODES.length} fitness modes ` +
      `(population ${pop}, ${size}x${size} torus) ...`,
  );
  for (const seed of seeds) {
    // one ancestor per seed, shared by every arm and both fitness modes
    const ancestor = sampleAncestor(seed, ca);
    for (const mode of MODES) {
      for (const arm of ARMS) {
        const t0 = Date.now();
        const lineage = evolveLineage(seed, arm.id, ancestor, {
          gens,
          pop,
          size,
          fitness: mode,
          assayReplicates: reps,
        });
        runs[mode].push(lineage);
        const fitAncestor = mode === 'births' ? lineage.heldAncestor.births : lineage.heldAncestor.established;
        const fitFinal = mode === 'births' ? lineage.heldFinal.births : lineage.heldFinal.established;
        console.log(
          `  ${mode.padEnd(11)} ${arm.id.padEnd(8)} ${seed}  ancestor ${ruleLabel(ancestor).padEnd(12)} -> ` +
            `${ruleLabel(lineage.final).padEnd(15)} held ${fitAncestor.toFixed(0)} -> ${fitFinal.toFixed(0)}` +
            `  (${((Date.now() - t0) / 1000).toFixed(1)}s)`,
        );
      }
    }
  }

  const heldSeeds = seeds.flatMap((s) => [`${s}:held:0`, `${s}:held:1`]);
  const conwayScore = scoreRule(CONWAY, heldSeeds, ca);
  const conwayParts = seeds.map((s) => assayRule(CONWAY, `${s}:conway`, { replicates: reps, size }));
  const robustness = mergeRobustness(CONWAY, conwayParts);

  cache = {
    version: 2,
    seeds,
    size,
    gens,
    pop,
    assayReplicates: reps,
    runs,
    conway: { rule: CONWAY, score: conwayScore, robustness },
  };
  mkdirSync(OUT, { recursive: true });
  writeFileSync(CACHE, JSON.stringify(cache));
  console.log(`series cached to ${CACHE}`);
}

const provenance = has('--from-cache')
  ? 're-analysed from `doomsday-series.json` (no simulation in this run)'
  : 'simulated in this run (TypeScript, Life-like CA research model)';

const reports: Record<FitnessMode, DoomsdayReport> = {
  births: buildDoomsdayReport(cache.runs.births, {
    provenance,
    conway: cache.conway.robustness,
    conwayScore: cache.conway.score,
    fitness: 'births',
    population: cache.pop,
    generations: cache.gens,
    lineagesPerArm: cache.seeds.length,
  }),
  established: buildDoomsdayReport(cache.runs.established, {
    provenance,
    conway: cache.conway.robustness,
    conwayScore: cache.conway.score,
    fitness: 'established',
    population: cache.pop,
    generations: cache.gens,
    lineagesPerArm: cache.seeds.length,
  }),
};
const report = reports.births;
const secondary = reports.established;

/* ------------------------------------------------------------------ render -- */

function renderAnalysis(rep: DoomsdayReport, heading: string, note: string): string[] {
  const md: string[] = [];
  const v = rep.verdict;
  md.push(`## ${heading}`);
  md.push('');
  md.push(note);
  md.push('');
  md.push('### Manipulation and viability');
  md.push('');
  md.push('| arm | lineages | held-out reproduction gain | turnover gain | retention delta (noise) | viable endpoints | mean distance from ancestor |');
  md.push('| :-- | ---: | ---: | ---: | ---: | ---: | ---: |');
  for (const a of rep.byArm) {
    const l = rep.lineages.filter((x) => x.arm === a.arm);
    const turnoverGain = l.reduce((s, x) => s + x.turnoverGain, 0) / Math.max(1, l.length);
    md.push(
      `| ${a.arm} | ${a.n} | ${signed(a.reproGain, 1)} | ${signed(turnoverGain, 4)} | ` +
        `${signed(a.retentionDelta.noise)} | ${pct(a.viability)} | ${fmt(a.distance, 2)} |`,
    );
  }
  md.push('');
  md.push(
    `Manipulation gate: **${v.manipulationOk ? 'passed' : 'failed'}**. Reproduction is scored on two held-out ` +
      'initial conditions, never on the training seeds, so a rule that memorised a single soup does not look selected. ' +
      `Viability gate: **${v.viabilityOk ? 'passed' : 'failed'}**.`,
  );
  md.push('');
  md.push(
    `Retention delta in the table is the median over lineages; a mean is dominated by ancestors that are nearly ` +
      `empty before the shock (a 3-cell ancestor can score a retention of 9.7 by regrowing). Replicates whose ` +
      `pre-shock population is below ${rep.config.minPrePop} cells are excluded from retention: below that floor ` +
      'the ratio is stochastic amplification, not robustness. Excluded lineages contribute no delta and are dropped ' +
      'from every paired statistic.',
  );
  md.push('');
  md.push('### Trade-off curve (primary family: noise)');
  md.push('');
  md.push('| family | rho(repro gain, retention change) | selected - drift delta | drift delta | selected delta | dose trend | rho(turnover gain, retention change) |');
  md.push('| :-- | :--: | :--: | :--: | :--: | :--: | :--: |');
  for (const f of rep.byFamily) {
    md.push(
      `| ${f.family} | ${fmt(f.rhoGain.rho)} ${ci(f.rhoGain.lo, f.rhoGain.hi)} | ` +
        `${signed(f.selectedMinusDrift.median)} ${ci(f.selectedMinusDrift.lo, f.selectedMinusDrift.hi)} | ` +
        `${signed(f.driftAncestorDelta.median)} ${ci(f.driftAncestorDelta.lo, f.driftAncestorDelta.hi)} | ` +
        `${signed(f.selectedAncestorDelta.median)} ${ci(f.selectedAncestorDelta.lo, f.selectedAncestorDelta.hi)} | ` +
        `${fmt(f.doseRho, 2)} (p=${fmt(f.doseP, 3)}) | ` +
        `${fmt(f.rhoTurnover.rho)} ${ci(f.rhoTurnover.lo, f.rhoTurnover.hi)} |`,
    );
  }
  md.push('');
  md.push(
    'A negative rho means lineages that gained more reproduction lost more retention, i.e. a trade-off. A ' +
      'positive rho means the better replicators were also the more robust ones. The drift control starts from ' +
      'the same ancestor and is viability-filtered but never selected on reproduction, so a selected-drift ' +
      'difference cannot be explained by distance from the ancestor alone.',
  );
  md.push('');
  md.push('### Mediation: is the loss explained by turnover?');
  md.push('');
  md.push('| family | turnover slope (Theil-Sen) | selected - drift (raw) | selected - drift (turnover-adjusted) |');
  md.push('| :-- | ---: | ---: | ---: |');
  for (const f of FAMILIES) {
    const m = rep.mediation[f];
    md.push(`| ${f} | ${fmt(m.slope)} | ${signed(m.armBefore)} | ${signed(m.armAfter)} |`);
  }
  md.push('');
  md.push(
    'The adjustment subtracts `slope x turnoverGain` from every lineage\'s retention change, then re-takes the ' +
      'median selected-minus-drift contrast with the same by-seed pairing as the trade-off table, so the raw ' +
      'column equals `selected - drift delta` above. A robust slope is used because three lineages have ancestors ' +
      'that regrow from a few dozen cells after the shock, and least squares would be set by them. Attenuation ' +
      'toward zero is the mediator signature; persistence means the contrast is not simply churn.',
  );
  md.push('');
  md.push('### Conway reference (descriptive, not an arm)');
  md.push('');
  md.push(
    `\`${rep.conway.label}\`: ${fmt(rep.conway.reproduction, 0)} ${rep.config.fitness === 'births' ? 'raw births' : 'established offspring'} ` +
      `on the held-out soups, turnover ${fmt(rep.conway.turnover, 4)}/cell/tick, retention ` +
      `${FAMILIES.map((f) => `${f} ${fmt(rep.conway.retention[f])}`).join(', ')}, viability ` +
      `${pct(rep.conway.viability)}.`,
  );
  md.push('');
  md.push('### Decision rule (registered before the run)');
  md.push('');
  md.push('| claim | test | verdict |');
  md.push('| :-- | :-- | :-- |');
  const c1 = v.rho <= -0.3 && v.rhoHi < 0;
  const c1opp = v.rho >= 0.3 && v.rhoLo > 0;
  const primaryStat = rep.byFamily.find((f) => f.family === v.primaryFamily)!;
  const c2 =
    v.selectedMinusDrift <= -rep.config.meaningfulCost &&
    v.selectedMinusDriftHi < 0 &&
    primaryStat.selectedAncestorDelta.hi < 0;
  const c3 = v.doseRho <= -0.8 && v.doseP < 0.05;
  const c4 = v.turnoverRho <= -0.3 && v.turnoverHi < 0 && Math.abs(v.armAfter) < Math.abs(v.armBefore) / 2;
  md.push(`| A-DOOM-01 trade-off | rho <= -0.3 and 95% CI excludes 0 | ${c1 ? 'supported' : c1opp ? 'opposite' : 'not supported'} |`);
  md.push(`| A-DOOM-02 selection vs drift | selected - drift <= -${rep.config.meaningfulCost.toFixed(2)}, selected < ancestor, both CIs exclude 0 | ${c2 ? 'supported' : 'not supported'} |`);
  md.push(`| A-DOOM-03 dose-response | dose rho <= -0.8 and permutation p < 0.05 | ${c3 ? 'supported' : 'not supported'} |`);
  md.push(`| A-DOOM-04 turnover mediation | turnover rho <= -0.3, CI excludes 0, adjusted contrast halves | ${c4 ? 'supported' : 'not supported'} |`);
  md.push('');
  md.push(`**Verdict: ${v.verdict}.** ${v.reason[0]!.toUpperCase()}${v.reason.slice(1)}.`);
  md.push('');
  return md;
}

function renderMd(): string {
  const md: string[] = [];
  md.push('# Experiment A - Evolutionary doomsday');
  md.push('');
  md.push(
    'Can a system that evolves to maximise reproduction become more fragile? A Life-like cellular automaton ' +
      '(32x32 torus, B0 forbidden) is the world; the heritable unit is the 18-bit rule. A rule\'s offspring ' +
      'count is the number of 0 -> 1 transitions it produces after a warm-up. Four arms share each ancestor: ' +
      'a reproduction-selected lineage at three truncation intensities, and a no-selection (drift) control.',
  );
  md.push('');
  md.push(
    'The primary endpoint counts **raw births**, exactly as the question is posed. A second endpoint counts ' +
      `**established offspring** - newborn cells still alive ${DD_MATURITY} ticks later - because a raw count has ` +
      'a known failure mode: it saturates at the period-2 rule that flips the whole 1,024-cell lattice (40,960 ' +
      'births, the hard ceiling), so every selected lineage converges to the same endpoint and the dose axis ' +
      'disappears. That pilot is recorded as a design revision in `docs/CLAIMS.md`; it is not hidden. Both ' +
      'definitions are run over the same ancestors and reported below, so the verdict cannot rest on the metric choice.',
  );
  md.push('');
  md.push(`Provenance: ${provenance}.`);
  md.push('');
  md.push(
    'The environment is fixed for all generations. The shock is applied only afterwards, suddenly: per-cell ' +
      'noise (0.2% / 1% / 5%), a one-off mortality pulse (20% / 50% / 80% of live cells), or a compute budget ' +
      'that updates only 50% / 25% / 10% of cells per tick. Endpoint: mean population over the last 30 of 150 ' +
      'post-shock ticks, divided by the pre-shock population. The same post-warm-up state is used for every ' +
      'shock level, so the comparison is paired.',
  );
  md.push('');
  md.push('## Registered prediction');
  md.push('');
  md.push(
    'A-DOOM-02 asks for a *doomsday*: selected endpoints must retain at least ' +
      `${DD_MEANINGFUL_COST.toFixed(2)} less than their own drift controls (about twice the median ` +
      'between-replicate SD of the family mean, 0.05) **and** less than their own ancestors, with intervals ' +
      'excluding zero. A statistically nonzero contrast smaller than that floor is reported, but it is not a ' +
      'doomsday.',
  );
  md.push('');
  md.push(...renderAnalysis(
    report,
    'A1. Primary endpoint: raw births',
    'Selection maximises the literal 0 -> 1 transition count on two training soups; reported gains are on two held-out soups. This is the direct test of the stated hypothesis.',
  ));
  md.push(...renderAnalysis(
    secondary,
    'A2. Definitional check: established offspring',
    `Selection maximises newborn cells that survive ${DD_MATURITY} ticks. This removes the period-2 flipper and makes the reproduction axis graded, but it partly conflates reproduction with survival: a rule that keeps its children alive longer scores higher. It is a check on whether the A1 verdict is an artefact of the raw metric.`,
  ));
  md.push('## What this does and does not establish');
  md.push('');
  md.push(
    '- It tests a Life-like CA, not the agent ecology. A trade-off here is a statement about this class of ' +
      'replicators; it does not transfer to the Tree of Life engine without its own run.',
  );
  md.push(
    '- The ancestor pool is Conway plus 1-3 bit flips, viability-gated. It is not a uniform sample of rule ' +
      'space, so the result is conditional on starting from a working replicator.',
  );
  md.push(
    '- The drift control is a viability-filtered neutral walk. "No selection" here means no selection on ' +
      'reproduction; the viability floor is a constraint, and it is why drift rules are assayable at all.',
  );
  md.push(
    '- `retention` is relative to the pre-shock population. A rule can lose 80% of a large population and ' +
      'still score 0.2; absolute recovery is in the JSON (`prePop`, `postPop`).',
  );
  md.push('');
  md.push('## Reproduce');
  md.push('');
  md.push('```bash');
  md.push('npm run research:doomsday                  # simulate + analyse');
  md.push('npm run research:doomsday -- --quick      # smoke');
  md.push('npm run research:doomsday -- --from-cache # re-analyse only');
  md.push('```');
  md.push('');
  return md.join('\n');
}

function renderCsv(): string {
  const n = (v: number, d: number): string => (Number.isFinite(v) ? v.toFixed(d) : '');
  const head = [
    'fitness', 'id', 'arm', 'dose', 'seed', 'ancestor', 'final', 'distance', 'viability',
    'repro_ancestor', 'repro_final', 'repro_gain',
    'turnover_ancestor', 'turnover_final', 'turnover_gain',
    'retention_ancestor_noise', 'retention_final_noise', 'retention_delta_noise',
    'retention_ancestor_death', 'retention_final_death', 'retention_delta_death',
    'retention_ancestor_compute', 'retention_final_compute', 'retention_delta_compute',
  ];
  const rows = MODES.flatMap((mode) =>
    reports[mode].lineages.map((l) =>
      [
        mode, l.id, l.arm, l.dose, l.seed, l.ancestorLabel, l.finalLabel, l.distance, n(l.viability, 3),
        n(l.reproAncestor, 1), n(l.reproFinal, 1), n(l.reproGain, 1),
        n(l.turnoverAncestor, 5), n(l.turnoverFinal, 5), n(l.turnoverGain, 5),
        n(l.retentionAncestor.noise, 4), n(l.retentionFinal.noise, 4), n(l.retentionDelta.noise, 4),
        n(l.retentionAncestor.death, 4), n(l.retentionFinal.death, 4), n(l.retentionDelta.death, 4),
        n(l.retentionAncestor.compute, 4), n(l.retentionFinal.compute, 4), n(l.retentionDelta.compute, 4),
      ].join(','),
    ),
  );
  return [head.join(','), ...rows].join('\n');
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const ARM_COLOR: Record<string, string> = {
  drift: '#8b949e',
  weak: '#4e79a7',
  moderate: '#f28e2b',
  strong: '#e15759',
};

function renderSvg(rep: DoomsdayReport, label: string): string {
  const w = 1040;
  const h = 660;
  const p: string[] = [];
  p.push(
    `<rect width="${w}" height="${h}" fill="#0e1116"/>`,
    `<text x="24" y="30" fill="#e6edf3" font-family="monospace" font-size="15">Experiment A - reproduction gain vs robustness loss (${esc(label)})</text>`,
    `<text x="24" y="50" fill="#8b949e" font-family="monospace" font-size="11">${esc(rep.provenance)}</text>`,
  );

  // --- scatter: reproduction gain vs retention change (noise)
  const px = 70;
  const py = 96;
  const pw = 560;
  const ph = 420;
  p.push(`<rect x="${px}" y="${py}" width="${pw}" height="${ph}" fill="#12161d" stroke="#222"/>`);
  const xs = rep.lineages.map((l) => l.reproGain).filter(Number.isFinite);
  const ys = rep.lineages.map((l) => l.retentionDelta.noise).filter(Number.isFinite);
  const x0 = Math.min(0, ...xs);
  const x1 = Math.max(1, ...xs);
  const y0 = Math.min(-0.2, ...ys);
  const y1 = Math.max(0.2, ...ys);
  const xOf = (v: number): number => px + ((v - x0) / (x1 - x0 || 1)) * pw;
  const yOf = (v: number): number => py + ph - ((v - y0) / (y1 - y0 || 1)) * ph;
  p.push(
    `<line x1="${px}" y1="${yOf(0).toFixed(1)}" x2="${px + pw}" y2="${yOf(0).toFixed(1)}" stroke="#30363d" stroke-dasharray="4 4"/>`,
    `<line x1="${xOf(0).toFixed(1)}" y1="${py}" x2="${xOf(0).toFixed(1)}" y2="${py + ph}" stroke="#30363d" stroke-dasharray="4 4"/>`,
    `<text x="${px + pw / 2}" y="${py + ph + 32}" fill="#8b949e" font-family="monospace" font-size="11" text-anchor="middle">held-out reproduction gained (final - ancestor)</text>`,
    `<text x="20" y="${py + ph / 2}" fill="#8b949e" font-family="monospace" font-size="11" transform="rotate(-90 20 ${py + ph / 2})">retention change under noise</text>`,
  );
  for (const l of rep.lineages) {
    if (!Number.isFinite(l.reproGain) || !Number.isFinite(l.retentionDelta.noise)) continue;
    p.push(
      `<circle cx="${xOf(l.reproGain).toFixed(1)}" cy="${yOf(l.retentionDelta.noise).toFixed(1)}" r="4" fill="${ARM_COLOR[l.arm]}" opacity="0.9"/>`,
    );
  }
  const stat = rep.byFamily.find((f) => f.family === 'noise')!;
  p.push(
    `<text x="${px + 12}" y="${py + 20}" fill="#e6edf3" font-family="monospace" font-size="11">rho ${fmt(stat.rhoGain.rho)} ${ci(stat.rhoGain.lo, stat.rhoGain.hi)}</text>`,
    `<text x="${px + 12}" y="${py + 36}" fill="#8b949e" font-family="monospace" font-size="10">selected - drift ${signed(stat.selectedMinusDrift.median)} ${ci(stat.selectedMinusDrift.lo, stat.selectedMinusDrift.hi)}</text>`,
  );

  // --- bars: retention delta per family per arm
  const bx = 700;
  const by = py + 20;
  const bw = w - bx - 60;
  const bh = 300;
  p.push(`<text x="${bx}" y="${py - 10}" fill="#8b949e" font-family="monospace" font-size="11">retention change by arm and shock</text>`);
  const allDelta = rep.byArm.flatMap((a) => FAMILIES.map((f) => a.retentionDelta[f])).filter(Number.isFinite);
  const lo = Math.min(-0.1, ...allDelta);
  const hi = Math.max(0.1, ...allDelta);
  const yB = (v: number): number => by + bh - ((v - lo) / (hi - lo || 1)) * bh;
  p.push(`<line x1="${bx}" y1="${yB(0).toFixed(1)}" x2="${bx + bw}" y2="${yB(0).toFixed(1)}" stroke="#8b949e" stroke-dasharray="4 4"/>`);
  const slot = bw / (rep.byArm.length * FAMILIES.length);
  rep.byArm.forEach((a, ai) => {
    FAMILIES.forEach((f, fi) => {
      const x = bx + (ai * FAMILIES.length + fi) * slot;
      const v = a.retentionDelta[f];
      if (!Number.isFinite(v)) return;
      const y = Math.min(yB(v), yB(0));
      const bhBar = Math.max(1, Math.abs(yB(v) - yB(0)));
      const color = f === 'noise' ? '#4e79a7' : f === 'death' ? '#59a14f' : '#b07aa1';
      p.push(`<rect x="${(x + slot * 0.15).toFixed(1)}" y="${y.toFixed(1)}" width="${(slot * 0.7).toFixed(1)}" height="${bhBar.toFixed(1)}" fill="${color}"/>`);
    });
    p.push(
      `<text x="${(bx + (ai * FAMILIES.length + 1.5) * slot).toFixed(1)}" y="${by + bh + 16}" fill="#e6edf3" font-family="monospace" font-size="9" text-anchor="middle">${a.arm}</text>`,
    );
  });
  p.push(
    `<text x="${bx}" y="${by + bh + 34}" fill="#8b949e" font-family="monospace" font-size="10">blue noise / green death / purple compute</text>`,
  );

  // --- verdict
  const vy = 590;
  const vc = rep.verdict.verdict === 'supported' ? '#e15759' : rep.verdict.verdict === 'refuted' ? '#59a14f' : '#f28e2b';
  p.push(
    `<text x="24" y="${vy}" fill="${vc}" font-family="monospace" font-size="13">A-DOOM: ${rep.verdict.verdict.toUpperCase()} (${esc(label)})</text>`,
    `<text x="24" y="${vy + 20}" fill="#8b949e" font-family="monospace" font-size="10">manipulation ${rep.verdict.manipulationOk ? 'passed' : 'failed'}; viability ${rep.verdict.viabilityOk ? 'passed' : 'failed'}</text>`,
    `<text x="24" y="${vy + 38}" fill="#8b949e" font-family="monospace" font-size="10">${esc(rep.verdict.reason.slice(0, 150))}</text>`,
  );

  return [`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`, ...p, '</svg>'].join('\n');
}

mkdirSync(join(OUT, 'plots'), { recursive: true });
writeFileSync(join(OUT, 'doomsday.md'), renderMd());
writeFileSync(
  join(OUT, 'doomsday.json'),
  JSON.stringify(
    {
      version: 2,
      generatedAt: new Date().toISOString(),
      provenance,
      config: {
        seeds: cache.seeds,
        size: cache.size,
        generations: cache.gens,
        population: cache.pop,
        assayReplicates: cache.assayReplicates,
        maturity: DD_MATURITY,
        meaningfulCost: DD_MEANINGFUL_COST,
        minPrePop: DD_MIN_PREPOP,
      },
      primary: report,
      secondary,
    },
    null,
    2,
  ) + '\n',
);
writeFileSync(join(OUT, 'doomsday.csv'), renderCsv());
writeFileSync(join(OUT, 'plots', 'doomsday.svg'), renderSvg(report, 'primary: raw births'));

/* ----------------------------------------------------------------- console -- */

for (const mode of MODES) {
  const rep = reports[mode];
  const title = mode === 'births' ? 'A1 primary: raw births' : 'A2 check: established offspring';
  console.log('');
  console.log(`== ${title} ==`);
  for (const a of rep.byArm) {
    console.log(
      `  ${a.arm.padEnd(8)} n=${String(a.n).padStart(2)}  repro gain ${signed(a.reproGain, 1).padStart(8)}  ` +
        `dNoise ${signed(a.retentionDelta.noise).padStart(7)}  dDeath ${signed(a.retentionDelta.death).padStart(7)}  ` +
        `dCompute ${signed(a.retentionDelta.compute).padStart(7)}  viable ${pct(a.viability).padStart(4)}`,
    );
  }
  for (const f of rep.byFamily) {
    console.log(
      `  ${f.family.padEnd(8)} rho(gain, dRet) ${fmt(f.rhoGain.rho).padStart(7)} ${ci(f.rhoGain.lo, f.rhoGain.hi)}  ` +
        `sel-drift ${signed(f.selectedMinusDrift.median)} ${ci(f.selectedMinusDrift.lo, f.selectedMinusDrift.hi)}  ` +
        `dose rho ${fmt(f.doseRho, 2)} p=${fmt(f.doseP, 3)}`,
    );
  }
  console.log(`  A-DOOM: ${rep.verdict.verdict} - ${rep.verdict.reason}`);
}
console.log('');
console.log(`  wrote ${join(OUT, 'doomsday.md')}`);
