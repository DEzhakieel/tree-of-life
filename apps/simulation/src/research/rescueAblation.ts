/**
 * M4: evolutionary rescue.
 *
 * The Q3/Q5 result is that the warning lead in control-parameter units shrinks
 * as the fold is approached more slowly. One candidate mechanism (M4) is that
 * selection buffers the stress: under a slow ramp there is more time for
 * lineages to adapt, so the population is never as close to the fold as the
 * ramp schedule says, and the measured lead shrinks.
 *
 * The test is a dose–response in the mutation supply, because that is the
 * cheapest way to move the engine's capacity to adapt without touching the
 * ramp schedule (which would change the thing being measured):
 *
 *   clonal      mutationScale = 0   no de-novo mutation, no lateral transfer
 *   registered  mutationScale = 1   the world every other result was run on
 *   elevated    mutationScale = 4   four times the mutation supply
 *
 * Two things make this an ablation rather than a correlation. First, `default`
 * is simulated again and must reproduce the cached Q5 series bit-for-bit; if it
 * does not, the new lever changed the baseline and the comparison is void.
 * Second, the mutation supply is *counted*, not inferred: every locus changed at
 * birth is tallied against the post-recombination genome, so sexual crossover is
 * not mistaken for mutation. Standing genetic variance is reported as context
 * but cannot serve as the check, because it is founder-dominated for hundreds of
 * ticks (a 12-run smoke test showed it barely separates ×0 from ×1).
 *
 * The honest limitation is stated with the result: mutation-off removes the
 * *supply* of new variation, not selection on the standing variation of the 300
 * founders. A null result therefore bounds one component of M4, not all of it.
 *
 * Pre-registered decision rule (CLAIMS.md E-EWS-12), fixed before the run:
 *
 *   1. The clonal arm must be estimable: ≥ 50% of its runs collapse and at
 *      least 4 collapsed runs reach the registered analysis.
 *   2. The manipulation must bite: mutation supply, measured directly as loci
 *      changed per birth, must be zero in the clonal arm and at least 1.5× the
 *      registered arm in the elevated arm.
 *   3. M4 is *supported* if the clonal arm retains < 50% of the registered
 *      lead slope and its seed-bootstrap interval contains zero; it is
 *      *refuted* if it retains ≥ 50%; otherwise *unresolved*.
 *
 * A slope is only read when the arm collapsed often enough to estimate it, its
 * registered detection rate is at least 20%, and the seed bootstrap produced at
 * least 100 resamples. An arm that fails this gate is reported as `n/a`, not as
 * a number: `mean([])` is 0, so a ramp with no detections injects a zero into
 * the regression rather than dropping out.
 *
 * The dose–response (|slope| non-decreasing in mutationScale) is reported as
 * supporting evidence but is not part of the verdict: with 8 seeds it is too
 * noisy to carry a decision on its own.
 */

import { mean, type EwsIndicator } from '@fractal-life/shared';
import {
  buildReport,
  REGISTERED_SPEC,
  specId,
  type MultiverseReport,
  type RunSeries,
  type SlopeBootstrap,
  type SpecOutcome,
} from './ewsMultiverse.js';

/* ---------------------------------------------------------------- design -- */

export type RescueCondition = 'clonal' | 'baseline' | 'elevated';

export interface ConditionDef {
  id: RescueCondition;
  label: string;
  mutationScale: number;
  note: string;
}

export const CONDITIONS: ConditionDef[] = [
  {
    id: 'clonal',
    label: 'clonal',
    mutationScale: 0,
    note: 'no de-novo mutation and no lateral gene transfer',
  },
  {
    id: 'baseline',
    label: 'registered',
    mutationScale: 1,
    note: 'the registered world; re-simulated to prove the lever is inert at ×1',
  },
  {
    id: 'elevated',
    label: 'elevated',
    mutationScale: 4,
    note: 'four times the mutation supply (positive control)',
  },
];

export function conditionById(id: RescueCondition): ConditionDef {
  const c = CONDITIONS.find((x) => x.id === id);
  if (!c) throw new Error(`unknown condition ${id}`);
  return c;
}

/** landmarks in ticks, in absolute time; the ramp starts at burn-in */
export const GENETIC_WINDOWS = {
  founder: [0, 120] as const,
  plateau: [280, 350] as const,
};

/* --------------------------------------------------------------- genetics -- */

export interface GeneticSample {
  tick: number;
  n: number;
  /** mean over genome loci of the across-agent variance: standing variation */
  locusVariance: number;
  /** across-agent variance of the decoded basal metabolic rate: the selectable trait */
  basalVariance: number;
  /** mean decoded basal metabolic rate */
  meanBasal: number;
  /** cumulative loci changed by mutation / lateral transfer at birth */
  mutationLoci: number;
  /** cumulative births */
  births: number;
  /** mutation supply made direct: changed loci per birth, cumulative */
  lociPerBirth: number;
}

export interface AblationRun extends RunSeries {
  condition: RescueCondition;
  genetic: GeneticSample[];
}

export interface GeneticSummary {
  runs: number;
  /** mean locus variance early in the run (founder diversity) */
  founderVar: number;
  /** mean locus variance on the pre-ramp plateau */
  plateauVar: number;
  /** plateau / founder: how much variation selection and drift removed */
  retention: number;
  /** mean locus variance at the final sample of each run */
  finalVar: number;
  /** mean across-agent variance of basal metabolic rate on the plateau */
  basalVariance: number;
  /** plateau mean basal rate */
  meanBasal: number;
  /** plateau mutation supply: changed loci per birth */
  lociPerBirth: number;
  /** final mutation supply: changed loci per birth */
  finalLociPerBirth: number;
  /** number of runs that contributed a plateau sample */
  plateauRuns: number;
}

export function geneticSummary(runs: AblationRun[]): GeneticSummary {
  const inWindow = (s: GeneticSample, w: readonly [number, number]): boolean => s.tick >= w[0] && s.tick < w[1];
  const founder: number[] = [];
  const plateau: number[] = [];
  const final: number[] = [];
  const basal: number[] = [];
  const meanBasal: number[] = [];
  const rates: number[] = [];
  const finalRates: number[] = [];
  const plateauRuns = new Set<string>();

  for (const run of runs) {
    for (const s of run.genetic) {
      if (inWindow(s, GENETIC_WINDOWS.founder)) founder.push(s.locusVariance);
      if (inWindow(s, GENETIC_WINDOWS.plateau)) {
        plateau.push(s.locusVariance);
        basal.push(s.basalVariance);
        meanBasal.push(s.meanBasal);
        rates.push(s.lociPerBirth);
        plateauRuns.add(`${run.seed}@${run.ramp}`);
      }
    }
    const last = run.genetic[run.genetic.length - 1];
    if (last) {
      final.push(last.locusVariance);
      finalRates.push(last.lociPerBirth);
    }
  }

  const founderVar = mean(founder);
  const plateauVar = mean(plateau);
  return {
    runs: runs.length,
    founderVar,
    plateauVar,
    retention: founderVar === 0 ? 0 : plateauVar / founderVar,
    finalVar: mean(final),
    basalVariance: mean(basal),
    meanBasal: mean(meanBasal),
    lociPerBirth: mean(rates),
    finalLociPerBirth: mean(finalRates),
    plateauRuns: plateauRuns.size,
  };
}

/* -------------------------------------------------------------- analysis -- */

export interface ConditionOutcome {
  condition: RescueCondition;
  label: string;
  mutationScale: number;
  runs: number;
  collapsed: number;
  collapseFraction: number;
  /** false when too few runs collapse for a slope to mean anything */
  estimable: boolean;
  /** registered variance detection rate: the slope is only readable above MIN_DETECTION */
  detectionRate: number;
  /** estimable AND enough detections/bootstrap resamples to interpret the slope */
  slopeReliable: boolean;
  registered: SpecOutcome | null;
  aucSlope: number;
  aucR2: number;
  leadSlope: number;
  leadR2: number;
  aucBootstrap: SlopeBootstrap | null;
  leadBootstrap: SlopeBootstrap | null;
  multiverse: {
    specs: number;
    aucMedian: number;
    aucQ05: number;
    aucQ95: number;
    aucShareNegative: number;
    leadMedian: number;
    leadQ05: number;
    leadQ95: number;
    leadShareNegative: number;
  };
  genetic: GeneticSummary;
}

export interface AblationOptions {
  seeds: string[];
  ramps: number[];
  reps?: number;
  target?: EwsIndicator;
}

function headlineRow(report: MultiverseReport, which: 'auc' | 'lead', indicator: EwsIndicator) {
  const rows = which === 'auc' ? report.aucHeadline : report.leadHeadline;
  return rows.find((r) => r.indicator === indicator) ?? null;
}

/**
 * Analyse one condition with the *registered* specification and with the full
 * multiverse. Both are needed: the registered score answers "what happened to
 * the headline number", the multiverse answers "is that number inside the
 * analysis space at all".
 */
export function analyseCondition(
  runs: AblationRun[],
  def: ConditionDef,
  opts: AblationOptions,
): ConditionOutcome {
  const report = buildReport(runs, {
    seeds: opts.seeds,
    ramps: opts.ramps,
    target: opts.target ?? 'variance',
    reps: opts.reps ?? 1000,
  });
  const target = opts.target ?? 'variance';
  const aucRow = headlineRow(report, 'auc', target);
  const leadRow = headlineRow(report, 'lead', target);
  const reg = report.registered;
  const collapsed = runs.filter((r) => r.collapse).length;
  const collapseFraction = runs.length ? collapsed / runs.length : 0;
  const detectionRate = reg?.detect[target] ?? 0;
  const estimable = collapseFraction >= MIN_COLLAPSE_FRACTION && collapsed >= 4;
  const leadBootstrap = report.bootstrap?.leadParam ?? null;

  return {
    condition: def.id,
    label: def.label,
    mutationScale: def.mutationScale,
    runs: runs.length,
    collapsed,
    collapseFraction,
    estimable,
    detectionRate,
    slopeReliable:
      estimable &&
      detectionRate >= MIN_DETECTION &&
      (leadBootstrap?.reps ?? 0) >= MIN_BOOTSTRAP_REPS,
    registered: reg,
    aucSlope: reg?.aucSlope[target].slope ?? 0,
    aucR2: reg?.aucSlope[target].r2 ?? 0,
    leadSlope: reg?.leadParamSlope[target].slope ?? 0,
    leadR2: reg?.leadParamSlope[target].r2 ?? 0,
    aucBootstrap: report.bootstrap?.auc ?? null,
    leadBootstrap,
    multiverse: {
      specs: report.specs,
      aucMedian: aucRow?.median ?? 0,
      aucQ05: aucRow?.q05 ?? 0,
      aucQ95: aucRow?.q95 ?? 0,
      aucShareNegative: aucRow?.shareNegative ?? 0,
      leadMedian: leadRow?.median ?? 0,
      leadQ05: leadRow?.q05 ?? 0,
      leadQ95: leadRow?.q95 ?? 0,
      leadShareNegative: leadRow?.shareNegative ?? 0,
    },
    genetic: geneticSummary(runs),
  };
}

/* --------------------------------------------------------------- verdict -- */

export const MIN_COLLAPSE_FRACTION = 0.5;
export const MIN_GENETIC_CONTRAST = 1.5;
export const RETENTION_BAR = 0.5;
/** A slope fitted below this detection rate is dominated by runs that never collapsed. */
export const MIN_DETECTION = 0.2;
/** Too few bootstrap resamples means the interval is not a distribution at all. */
export const MIN_BOOTSTRAP_REPS = 100;

function logFactorial(n: number): number {
  let s = 0;
  for (let i = 2; i <= n; i++) s += Math.log(i);
  return s;
}

function logChoose(n: number, k: number): number {
  if (k < 0 || k > n) return Number.NEGATIVE_INFINITY;
  return logFactorial(n) - logFactorial(k) - logFactorial(n - k);
}

/**
 * Fisher's exact test, two-sided, on the 2×2 table
 *
 *     [ a  b ]
 *     [ c  d ]
 *
 * The two-sided p is the sum of the probabilities of every table no more likely
 * than the observed one. Used for the collapse contrast, where the counts are
 * small enough that a χ² approximation would be indefensible.
 */
export function fisherExact(a: number, b: number, c: number, d: number): number {
  const r1 = a + b;
  const r2 = c + d;
  const c1 = a + c;
  const n = r1 + r2;
  const observed = Math.exp(logChoose(r1, a) + logChoose(r2, c) - logChoose(n, c1));
  const lo = Math.max(0, c1 - r2);
  const hi = Math.min(r1, c1);
  let p = 0;
  for (let k = lo; k <= hi; k++) {
    const pk = Math.exp(logChoose(r1, k) + logChoose(r2, c1 - k) - logChoose(n, c1));
    if (pk <= observed * (1 + 1e-9)) p += pk;
  }
  return Math.min(1, p);
}

/**
 * Collapse contrast between the two endpoints of the dose–response. This is a
 * separate question from the slope: it says whether adaptation changed *whether*
 * the system collapses, not whether it changed the warning lead.
 */
export interface RescueEffect {
  clonal: { collapsed: number; runs: number };
  elevated: { collapsed: number; runs: number };
  /** two-sided Fisher exact p on the collapse table */
  p: number;
}

export interface RescueVerdict {
  estimable: boolean;
  contrast: number;
  manipulationOk: boolean;
  /** |lead slope(clonal)| / |lead slope(baseline)|| */
  leadRetained: number;
  aucRetained: number;
  clonalIntervalContainsZero: boolean;
  monotoneDoseResponse: boolean;
  /** collapse contrast across the dose–response, with an exact test */
  rescue: RescueEffect | null;
  verdict: 'supported' | 'refuted' | 'unresolved';
  reason: string;
}

export function decideM4(outcomes: ConditionOutcome[]): RescueVerdict {
  const by = (id: RescueCondition): ConditionOutcome | undefined => outcomes.find((o) => o.condition === id);
  const clonal = by('clonal');
  const baseline = by('baseline');
  const elevated = by('elevated');
  const zero = { median: 0, lo: 0, hi: 0, reps: 0, shareNegative: 0 };

  if (!clonal || !baseline) {
    return {
      estimable: false,
      contrast: 0,
      manipulationOk: false,
      leadRetained: NaN,
      aucRetained: NaN,
      clonalIntervalContainsZero: false,
      monotoneDoseResponse: false,
      rescue: null,
      verdict: 'unresolved',
      reason: 'the clonal and registered arms must both be present',
    };
  }

  const estimable = clonal.estimable;

  // The manipulation is measured directly: loci changed per birth. Standing
  // variance is founder-dominated for hundreds of ticks, so it cannot tell a
  // clonal world from a mutating one (the first smoke run made that plain).
  const clonalSupply = clonal.genetic.lociPerBirth;
  const baseSupply = baseline.genetic.lociPerBirth;
  const elevSupply = elevated?.genetic.lociPerBirth ?? 0;
  const contrast = baseSupply === 0 ? (elevSupply > 0 ? Number.POSITIVE_INFINITY : 1) : elevSupply / baseSupply;
  const manipulationOk =
    clonalSupply < 0.01 && baseSupply > 0.01 && elevSupply >= MIN_GENETIC_CONTRAST * baseSupply;

  const baseLead = Math.abs(baseline.leadSlope);
  const leadRetained = baseLead === 0 ? (clonal.leadSlope === 0 ? 0 : Number.POSITIVE_INFINITY) : Math.abs(clonal.leadSlope) / baseLead;
  const baseAuc = Math.abs(baseline.aucSlope);
  const aucRetained = baseAuc === 0 ? (clonal.aucSlope === 0 ? 0 : Number.POSITIVE_INFINITY) : Math.abs(clonal.aucSlope) / baseAuc;

  const ci = clonal.leadBootstrap ?? zero;
  const clonalIntervalContainsZero = ci.lo <= 0 && ci.hi >= 0;

  const order = (o: ConditionOutcome): number => Math.abs(o.leadSlope);
  const monotoneDoseResponse =
    !!elevated && elevated.slopeReliable && baseline.slopeReliable && clonal.slopeReliable &&
    order(clonal) <= order(baseline) && order(baseline) <= order(elevated);

  const rescue: RescueEffect | null = elevated
    ? {
        clonal: { collapsed: clonal.collapsed, runs: clonal.runs },
        elevated: { collapsed: elevated.collapsed, runs: elevated.runs },
        p: fisherExact(
          clonal.collapsed,
          clonal.runs - clonal.collapsed,
          elevated.collapsed,
          elevated.runs - elevated.collapsed,
        ),
      }
    : null;

  const base = {
    estimable,
    contrast,
    manipulationOk,
    leadRetained,
    aucRetained,
    clonalIntervalContainsZero,
    monotoneDoseResponse,
    rescue,
  };

  if (!estimable) {
    return {
      ...base,
      verdict: 'unresolved',
      reason: `the clonal arm collapsed in ${(clonal.collapseFraction * 100).toFixed(0)}% of runs (need ≥ ${(MIN_COLLAPSE_FRACTION * 100).toFixed(0)}% and ≥ 4 runs)`,
    };
  }
  if (!clonal.slopeReliable || !baseline.slopeReliable) {
    const weak = [!clonal.slopeReliable ? 'clonal' : null, !baseline.slopeReliable ? 'registered' : null]
      .filter(Boolean)
      .join(' and ');
    return {
      ...base,
      verdict: 'unresolved',
      reason:
        `the ${weak} slope rests on ${(clonal.slopeReliable ? baseline.detectionRate : clonal.detectionRate).toFixed(0)} ` +
        `detections or too few bootstrap resamples (need ≥ ${(MIN_DETECTION * 100).toFixed(0)}% and ≥ ${MIN_BOOTSTRAP_REPS}): ` +
        'the ratio of two unreliable slopes is not a measurement',
    };
  }
  if (!manipulationOk) {
    return {
      ...base,
      verdict: 'unresolved',
      reason: `mutation supply is ${clonalSupply.toFixed(3)} loci/birth in the clonal arm and ${contrast.toFixed(2)}× the registered arm when elevated (need 0 and ≥ ${MIN_GENETIC_CONTRAST}×): the manipulation did not bite`,
    };
  }
  if (leadRetained < RETENTION_BAR) {
    return {
      ...base,
      verdict: 'supported',
      reason: `the clonal arm retains ${(leadRetained * 100).toFixed(0)}% of the registered lead slope (bar ${(RETENTION_BAR * 100).toFixed(0)}%)`,
    };
  }
  return {
    ...base,
    verdict: 'refuted',
    reason: `the clonal arm retains ${(leadRetained * 100).toFixed(0)}% of the registered lead slope, so removing the mutation supply does not flatten it`,
  };
}

/* ---------------------------------------------------------------- report -- */

export interface AblationReport {
  generatedAt: string;
  provenance: string;
  seeds: string[];
  ramps: number[];
  target: EwsIndicator;
  registeredSpec: string;
  conditions: ConditionOutcome[];
  verdict: RescueVerdict;
  defaultReproducesCache: boolean | null;
}

export function buildAblationReport(
  runs: AblationRun[],
  opts: AblationOptions & { provenance: string; defaultReproducesCache: boolean | null },
): AblationReport {
  const outcomes = CONDITIONS.map((def) =>
    analyseCondition(
      runs.filter((r) => r.condition === def.id),
      def,
      opts,
    ),
  );
  return {
    generatedAt: new Date().toISOString(),
    provenance: opts.provenance,
    seeds: opts.seeds,
    ramps: opts.ramps,
    target: opts.target ?? 'variance',
    registeredSpec: specId(REGISTERED_SPEC),
    conditions: outcomes,
    verdict: decideM4(outcomes),
    defaultReproducesCache: opts.defaultReproducesCache,
  };
}

/** convenience: pooled genetic trajectory by tick bucket, for the plot */
export function trajectory(
  runs: AblationRun[],
  condition: RescueCondition,
  bucket = 50,
): { tick: number; locusVariance: number; basalVariance: number; n: number }[] {
  const buckets = new Map<number, { locus: number[]; basal: number[] }>();
  for (const run of runs) {
    if (run.condition !== condition) continue;
    for (const s of run.genetic) {
      const key = Math.floor(s.tick / bucket) * bucket;
      const b = buckets.get(key) ?? { locus: [], basal: [] };
      b.locus.push(s.locusVariance);
      b.basal.push(s.basalVariance);
      buckets.set(key, b);
    }
  }
  return [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([tick, b]) => ({
      tick,
      locusVariance: mean(b.locus),
      basalVariance: mean(b.basal),
      n: b.locus.length,
    }));
}
