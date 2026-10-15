/**
 * Unified claims ledger.
 *
 * The project produces evidence in several incompatible shapes: a frequentist
 * ledger keyed by model family, a Bayesian ledger keyed by hypothesis id, a
 * harness scorecard keyed by model, a known-systems report keyed by system, and
 * an AI loop ledger keyed by proposal. None of them can be read together, so no
 * single statement like "how much of what we claim is supported?" was ever
 * answerable.
 *
 * This module maps every one of those shapes onto the pre-registered claim ids
 * declared in `scope.ts`, producing one ledger where each row is a claim, its
 * falsifiability criterion, the statistic that tests it, and a status. Nothing
 * here creates a claim: a verdict can only be attached to an id that the scope
 * declared in advance, which is what makes the ledger a record of tests rather
 * than a post-hoc narrative.
 */

import type { BenchScorecard } from './benchmarks/types.js';
import type { KnownReport } from './benchmarks/knownSystems/types.js';
import type { ClaimStatus, FalsifiabilityCriterion, ResearchScope, EvidenceBasis, ClaimKind } from './scope.js';

export interface EvidenceStat {
  /** observed engine value, where a single number is at issue */
  observed?: number;
  /** published / declared reference value */
  target?: number;
  /** band the source supports */
  band?: [number, number];
  ci?: [number, number];
  mean?: number;
  sd?: number;
  n?: number;
  t?: number;
  pTwo?: number;
  pOne?: number;
  /** multiplicity-adjusted p */
  adjustedP?: number;
  bayesFactor?: number;
  /** gated checks passed / total */
  fidelity?: number;
  /** parsimony context, when a comparison was involved */
  freeParams?: number;
  aic?: number;
  bic?: number;
  deltaAic?: number;
}

export interface ClaimVerdict {
  claimId: string;
  question: string;
  kind: ClaimKind;
  basis: EvidenceBasis;
  /** verbatim pre-registered falsifiability statement */
  criterion: FalsifiabilityCriterion;
  /** the numeric gate rendered for the report, when the criterion has one */
  test: string | null;
  status: ClaimStatus;
  statistic: EvidenceStat | null;
  detail: string;
  /** module that produced the evidence */
  source: string;
  artifacts: string[];
}

export interface ClaimsLedger {
  generatedAt: string;
  scopeVersion: string;
  method: string;
  summary: { total: number; supported: number; refuted: number; inconclusive: number };
  byQuestion: { question: string; total: number; supported: number; refuted: number; inconclusive: number }[];
  verdicts: ClaimVerdict[];
}

function renderTest(c: FalsifiabilityCriterion): string | null {
  if (!c.test) return null;
  switch (c.test) {
    case 'range':
      return `range [${c.lo}, ${c.hi}]`;
    case 'eqAbs':
      return `= ${c.value} (±tol)`;
    default:
      return `${c.test} ${c.value}`;
  }
}

function claimMeta(scope: ResearchScope, claimId: string) {
  const c = scope.claims.find((x) => x.id === claimId);
  if (!c) return undefined;
  return c;
}

function verdict(
  scope: ResearchScope,
  claimId: string,
  status: ClaimStatus,
  detail: string,
  source: string,
  statistic: EvidenceStat | null = null,
): ClaimVerdict | undefined {
  const c = claimMeta(scope, claimId);
  if (!c) return undefined;
  return {
    claimId,
    question: c.question,
    kind: c.kind,
    basis: c.evidence,
    criterion: c.falsifiability,
    test: renderTest(c.falsifiability),
    status,
    statistic,
    detail,
    source,
    artifacts: c.artifacts,
  };
}

/* ------------------------------------------------------------------ *
 * evidence sources → claim verdicts
 * ------------------------------------------------------------------ */

/** harness scorecard → per-model claims, the suite-level claim, and C-DET-02 */
export function verdictsFromBenchScorecard(card: BenchScorecard, scope: ResearchScope): ClaimVerdict[] {
  const out: ClaimVerdict[] = [];

  for (const r of card.results) {
    const id = `C-BENCH-${r.id}`;
    const statistic: EvidenceStat = { fidelity: r.fidelity, observed: r.fidelity, target: 1, n: r.seeds };
    out.push(
      verdict(
        scope,
        id,
        r.verdict === 'PASS' ? 'supported' : 'refuted',
        `${r.verdict}: fidelity ${r.fidelity.toFixed(3)} over ${r.checks.filter((c) => c.gate).length} gating checks, ${r.seeds} seed(s)${r.determinism ? ', deterministic' : ', DETERMINISM BROKEN'}`,
        'benchmarks/harness',
        statistic,
      )!,
    );

    const detId = `C-DET-02`;
    out.push(
      verdict(
        scope,
        detId,
        r.determinism ? 'supported' : 'refuted',
        `model ${r.id} double-run fingerprint ${r.determinism ? 'matched' : 'MISMATCHED'}`,
        'benchmarks/harness',
        { observed: r.determinism ? 1 : 0, target: 1 },
      )!,
    );
  }

  const allPass = card.results.every((r) => r.verdict === 'PASS');
  const detAll = card.results.every((r) => r.determinism);
  out.push(
    verdict(
      scope,
      'C-BENCH-ALL',
      allPass ? 'supported' : 'refuted',
      `${card.results.filter((r) => r.verdict === 'PASS').length}/${card.results.length} models passed at ${card.scale} scale`,
      'benchmarks/benchRun',
      { fidelity: allPass ? 1 : card.results.filter((r) => r.verdict === 'PASS').length / card.results.length, observed: card.results.filter((r) => r.verdict === 'PASS').length, target: card.results.length },
    )!,
  );
  // collapse the per-model determinism rows into one claim
  const detRows = out.filter((v) => v.claimId === 'C-DET-02');
  for (const row of detRows.slice(1)) {
    const i = out.indexOf(row);
    if (i >= 0) out.splice(i, 1);
  }
  if (detRows[0]) {
    detRows[0].status = detAll ? 'supported' : 'refuted';
    detRows[0].detail = `${card.results.filter((r) => r.determinism).length}/${card.results.length} models reproduced their fingerprint bit-for-bit across two runs`;
  }

  return out;
}

/** known-systems report → per-system empirical claims and the aggregate claim */
export function verdictsFromKnownReport(report: KnownReport, scope: ResearchScope): ClaimVerdict[] {
  const out: ClaimVerdict[] = [];
  for (const e of report.entries) {
    const t = e.targetAssessment;
    if (!t) continue;
    const id = `C-EMP-${e.id.toUpperCase().replace(/-/g, '_')}`;

    if (t.strictTotal === 0) {
      // every declared target for this system is qualitative, so there is no
      // published number to reproduce — reported, not silently dropped
      out.push(
        verdict(
          scope,
          id,
          'inconclusive',
          `linked to ${e.name} (bench ${t.benchId}, gated fidelity ${e.fidelity?.toFixed(3) ?? 'n/a'}) but the source reports only qualitative targets (${t.total} expected, 0 measured/derived) — no numeric reference to reproduce`,
          'benchmarks/knownSystems/targets',
          { fidelity: e.fidelity, observed: t.hits, target: t.total },
        )!,
      );
      continue;
    }

    const worst = t.scores
      .filter((s) => s.kind !== 'expected' && !s.withinBand)
      .sort((a, b) => b.relErr - a.relErr)
      .slice(0, 2)
      .map((s) => `${s.key} obs=${s.observed.toPrecision(4)} vs ${s.target}`);
    out.push(
      verdict(
        scope,
        id,
        t.strictHits === t.strictTotal ? 'supported' : 'refuted',
        `${t.strictHits}/${t.strictTotal} measured/derived targets inside the published band${worst.length ? `; missed: ${worst.join('; ')}` : ''} (gated fidelity ${e.fidelity?.toFixed(3) ?? 'n/a'})`,
        'benchmarks/knownSystems/targets',
        { fidelity: t.fidelity, observed: t.strictHits, target: t.strictTotal },
      )!,
    );
  }

  const ok = report.empiricalTotal > 0 && report.empiricalHits === report.empiricalTotal;
  out.push(
    verdict(
      scope,
      'C-EMP-AGG',
      ok ? 'supported' : 'refuted',
      `${report.empiricalHits}/${report.empiricalTotal} measured or derivable literature targets reproduced across ${report.assessed} quantified systems (aggregate fidelity ${report.empiricalFidelity.toFixed(3)})`,
      'benchmarks/rigor/validation',
      { fidelity: report.empiricalFidelity, observed: report.empiricalHits, target: report.empiricalTotal },
    )!,
  );
  return out;
}

interface RigorCheckLike {
  key: string;
  label: string;
  outcome: string;
  value: number | string | boolean;
  detail: string;
}
interface RigorSectionLike {
  id: string;
  checks: RigorCheckLike[];
}

/** rigor sections → the ablation, significance and novelty claims */
export function verdictsFromRigor(sections: readonly RigorSectionLike[], scope: ResearchScope): ClaimVerdict[] {
  const out: ClaimVerdict[] = [];
  const find = (id: string) => sections.find((s) => s.id === id);

  const ablation = find('ablation');
  if (ablation) {
    const directional = ablation.checks.filter((c) => /^[A-J]-/.test(c.key));
    const passed = directional.filter((c) => c.outcome === 'PASS').length;
    out.push(
      verdict(
        scope,
        'C-ABL-01',
        directional.length === 0 ? 'inconclusive' : passed === directional.length ? 'supported' : 'refuted',
        directional.length === 0 ? 'no directional interventions declared' : `${passed}/${directional.length} declared interventions moved their target key in the predicted direction`,
        'benchmarks/rigor/ablation',
        { observed: passed, target: directional.length },
      )!,
    );
  }

  const significance = find('significance');
  if (significance) {
    const claims = significance.checks.filter((c) => c.key.startsWith('sig-') && !c.key.endsWith('-consistency'));
    const passed = claims.filter((c) => c.outcome === 'PASS').length;
    out.push(
      verdict(
        scope,
        'C-SIG-01',
        claims.length === 0 ? 'inconclusive' : passed === claims.length ? 'supported' : 'refuted',
        claims.length === 0 ? 'no directional gating claims to test' : `${passed}/${claims.length} directional claims survived Holm–Bonferroni FWER 0.05`,
        'benchmarks/rigor/significance',
        { observed: passed, target: claims.length },
      )!,
    );
  }

  const novelty = find('novelty');
  if (novelty) {
    const disc = novelty.checks.find((c) => c.key === 'novel-disc');
    const cov = novelty.checks.find((c) => c.key === 'novel-coverage');
    const discVal = typeof disc?.value === 'number' ? disc.value : Number(disc?.value ?? NaN);
    const covVal = typeof cov?.value === 'number' ? cov.value : Number(cov?.value ?? NaN);
    const ok = discVal >= 0.6 && covVal >= 0.9;
    out.push(
      verdict(
        scope,
        'C-NOV-01',
        Number.isFinite(discVal) && Number.isFinite(covVal) ? (ok ? 'supported' : 'refuted') : 'inconclusive',
        `discrimination ${Number.isFinite(discVal) ? discVal.toFixed(2) : 'n/a'} (≥0.6), coverage ${Number.isFinite(covVal) ? covVal.toFixed(2) : 'n/a'} (≥0.9)`,
        'benchmarks/rigor/novelty',
        { observed: discVal, target: 0.6 },
      )!,
    );
  }

  return out;
}

interface LoopRow {
  verdict: string;
}

/**
 * AI loop ledger → the two AI-loop claims.
 *
 * `harnessScored` is supplied by the caller (aiRun) as a count of proposals the
 * harness actually evaluated; a verdict with no harness run behind it is what
 * would refute C-AI-01.
 */
export function verdictsFromLoop(
  rows: readonly LoopRow[],
  harnessScored: number,
  scope: ResearchScope,
  harnessRuns?: number,
): ClaimVerdict[] {
  const out: ClaimVerdict[] = [];
  const scored = harnessScored === rows.length && rows.length > 0;
  const runsNote = typeof harnessRuns === 'number' ? ` (${harnessRuns} by an actual benchmark run; the rest resolved to no model)` : '';
  out.push(
    verdict(
      scope,
      'C-AI-01',
      rows.length === 0 ? 'inconclusive' : scored ? 'supported' : 'refuted',
      `${harnessScored}/${rows.length} loop verdicts adjudicated by deterministic code${runsNote}; the model proposed but never adjudicated`,
      'ai/researchAgent',
      { observed: harnessScored, target: rows.length },
    )!,
  );
  const supported = rows.filter((r) => r.verdict === 'supported').length;
  out.push(
    verdict(
      scope,
      'C-AI-02',
      rows.length === 0 ? 'inconclusive' : supported > 0 ? 'supported' : 'refuted',
      `${supported}/${rows.length} harness-scored proposals supported across the loop`,
      'aiRun',
      { observed: supported, target: rows.length },
    )!,
  );
  return out;
}

interface WorldControlLike {
  control: { aliveCount: number; population: number; speciesCount: number };
  final: { aliveCount: number; population: number; speciesCount: number };
}

/** world-controller run → the steering claim */
export function verdictFromWorldControl(run: WorldControlLike, scope: ResearchScope): ClaimVerdict[] {
  const delta = run.final.aliveCount - run.control.aliveCount;
  return [
    verdict(
      scope,
      'C-AI-03',
      delta > 0 ? 'supported' : 'refuted',
      `steered aliveCount ${run.final.aliveCount} vs unsteered control ${run.control.aliveCount} (Δ ${delta > 0 ? '+' : ''}${delta}); population ${run.control.population} → ${run.final.population}, species ${run.control.speciesCount} → ${run.final.speciesCount}`,
      'ai/controller',
      { observed: run.final.aliveCount, target: run.control.aliveCount },
    )!,
  ].filter((v): v is ClaimVerdict => v !== undefined);
}

/** determinism reports → the bit-reproducibility claim */
export function verdictsFromDeterminism(
  reports: readonly { name: string; pass: boolean }[],
  scope: ResearchScope,
): ClaimVerdict[] {
  if (reports.length === 0) return [];
  const passed = reports.filter((r) => r.pass).length;
  return [
    verdict(
      scope,
      'C-DET-01',
      passed === reports.length ? 'supported' : 'refuted',
      `${passed}/${reports.length} seeded experiment families reproduced bit-for-bit: ${reports.map((r) => `${r.name} ${r.pass ? 'ok' : 'MISMATCH'}`).join(', ')}`,
      'modes',
      { observed: passed, target: reports.length },
    )!,
  ].filter((v): v is ClaimVerdict => v !== undefined);
}

/* ------------------------------------------------------------------ *
 * ledger assembly
 * ------------------------------------------------------------------ */

export function buildClaimsLedger(verdicts: readonly ClaimVerdict[], scope: ResearchScope): ClaimsLedger {
  // one row per claim id; later evidence for the same id does not duplicate it
  const byId = new Map<string, ClaimVerdict>();
  for (const v of verdicts) {
    if (!scope.claims.some((c) => c.id === v.claimId)) continue; // unknown id is not a claim
    if (!byId.has(v.claimId)) byId.set(v.claimId, v);
  }
  const rows = [...byId.values()].sort((a, b) => a.claimId.localeCompare(b.claimId));

  const tally = (vs: readonly ClaimVerdict[]) => ({
    total: vs.length,
    supported: vs.filter((v) => v.status === 'supported').length,
    refuted: vs.filter((v) => v.status === 'refuted').length,
    inconclusive: vs.filter((v) => v.status === 'inconclusive').length,
  });

  const byQuestion = scope.questions.map((q) => ({
    question: q.id,
    ...tally(rows.filter((v) => v.question === q.id)),
  }));

  return {
    generatedAt: new Date().toISOString(),
    scopeVersion: scope.version,
    method:
      'Each claim is pre-registered in research/scope.ts with a falsifiability criterion fixed before the experiment. ' +
      'Evidence is mapped from the harness scorecard, the known-systems target assessment, the rigor modules, the ' +
      'significance ledger and the AI loop ledger onto those claim ids; a verdict can only be attached to an id that ' +
      'already existed, so the ledger records tests rather than post-hoc narratives.',
    summary: tally(rows),
    byQuestion,
    verdicts: rows,
  };
}

/** claims defined in the scope but for which no evidence was produced this run */
export function untestedClaims(scope: ResearchScope, ledger: ClaimsLedger): string[] {
  const tested = new Set(ledger.verdicts.map((v) => v.claimId));
  return scope.claims.filter((c) => !tested.has(c.id)).map((c) => c.id);
}
