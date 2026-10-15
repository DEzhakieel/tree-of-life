/**
 * Scope CLI — the pre-registration report.
 *
 * Validates the research scope, gathers evidence from every layer that can
 * produce it, maps that evidence onto the pre-registered claim ids, and writes:
 *
 *   research/SCOPE.md            human-readable scope + claim ledger
 *   research/output/claims.json  machine-readable ledger
 *
 * The point of the tool is negative capability: it will tell you a claim is
 * refuted, and it will tell you which claims have no evidence at all. A claim
 * that no experiment tests is reported as untested rather than quietly omitted.
 *
 *   scopeRun.ts                 quick scale (default)
 *   scopeRun.ts --full          full scale
 *   scopeRun.ts --determinism-seeds 3
 */

import fs from 'node:fs';
import path from 'node:path';
import { OUTPUT_DIR } from './ai/paths.js';
import { BENCHMARK_MODELS } from './benchmarks/models/index.js';
import { runAllBenchmarks } from './benchmarks/harness.js';
import { buildKnownReport } from './benchmarks/knownSystems/index.js';
import { runValidation } from './benchmarks/rigor/validation.js';
import { runAblation } from './benchmarks/rigor/ablation.js';
import { runSignificance } from './benchmarks/rigor/significance.js';
import { runNovelty } from './benchmarks/rigor/novelty.js';
import { determinismCheck } from './scenarios.js';
import { assembleScope, validateScope, scopeIsSound, type ResearchScope } from './scope.js';
import {
  buildClaimsLedger,
  untestedClaims,
  verdictFromWorldControl,
  verdictsFromBenchScorecard,
  verdictsFromDeterminism,
  verdictsFromKnownReport,
  verdictsFromLoop,
  verdictsFromRigor,
  type ClaimVerdict,
  type ClaimsLedger,
} from './claims.js';
import type { BenchmarkScale } from './benchmarks/types.js';

const SCOPE_MD = path.resolve('C:/Users/LENOVO/Downloads/fractallife2/apps/simulation/research/SCOPE.md');

function readJson<T>(file: string): T | undefined {
  try {
    return JSON.parse(fs.readFileSync(path.join(OUTPUT_DIR, file), 'utf8')) as T;
  } catch {
    return undefined;
  }
}

interface LoopLedgerFile {
  harnessScored?: number;
  harnessRuns?: number;
  ledger?: { verdict: string }[];
}
interface WorldFile {
  control: { aliveCount: number; population: number; speciesCount: number };
  final: { aliveCount: number; population: number; speciesCount: number };
}

/** determinism across the four scenario families */
function determinismEvidence(seeds: string[]): { name: string; pass: boolean }[] {
  const scenarios = ['first-order', 'third-order', 'stochastic'] as const;
  const out: { name: string; pass: boolean }[] = [];
  for (const scenario of scenarios) {
    let pass = true;
    for (const seed of seeds) {
      try {
        if (!determinismCheck(scenario, seed).matched) pass = false;
      } catch {
        pass = false;
      }
    }
    out.push({ name: `${scenario}×${seeds.length}`, pass });
  }
  return out;
}

export interface ScopeRunOptions {
  scale: BenchmarkScale;
  determinismSeeds: string[];
}

export interface ScopeRunResult {
  scope: ResearchScope;
  ledger: ClaimsLedger;
  untested: string[];
  issues: ReturnType<typeof validateScope>;
  mdPath: string;
  jsonPath: string;
}

export function runScope(opts: ScopeRunOptions): ScopeRunResult {
  const scope = assembleScope();
  const issues = validateScope(scope);
  const blocking = issues.filter((i) => i.severity === 'error');
  if (blocking.length > 0) {
    throw new Error(`scope is not sound: ${blocking.map((i) => `${i.id}: ${i.detail}`).join('; ')}`);
  }

  // --- evidence ---------------------------------------------------------
  const card = runAllBenchmarks(BENCHMARK_MODELS, { scale: opts.scale, determinismCheck: true });
  const known = buildKnownReport(opts.scale);
  const rigorSections = [runValidation(opts.scale), runAblation(opts.scale), runSignificance(opts.scale, { write: false }), runNovelty(opts.scale)];
  const detReports = determinismEvidence(opts.determinismSeeds);

  const loopFile = readJson<LoopLedgerFile>('ai-loop-ledger.json');
  const worldFile = readJson<WorldFile>('ai-world.json');

  const verdicts: ClaimVerdict[] = [
    ...verdictsFromBenchScorecard(card, scope),
    ...verdictsFromKnownReport(known, scope),
    ...verdictsFromRigor(rigorSections, scope),
    ...verdictsFromDeterminism(detReports, scope),
  ];
  if (loopFile?.ledger && typeof loopFile.harnessScored === 'number') {
    verdicts.push(...verdictsFromLoop(loopFile.ledger, loopFile.harnessScored, scope, loopFile.harnessRuns));
  }
  if (worldFile) verdicts.push(...verdictFromWorldControl(worldFile, scope));

  const ledger = buildClaimsLedger(verdicts, scope);
  const untested = untestedClaims(scope, ledger);

  // --- write ------------------------------------------------------------
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const jsonPath = path.join(OUTPUT_DIR, 'claims.json');
  const payload = {
    ...ledger,
    untested,
    issues,
  };
  fs.writeFileSync(jsonPath, JSON.stringify(payload, null, 2));
  fs.mkdirSync(path.dirname(SCOPE_MD), { recursive: true });
  fs.writeFileSync(SCOPE_MD, renderScopeMd(scope, ledger, untested, issues));

  return { scope, ledger, untested, issues, mdPath: SCOPE_MD, jsonPath };
}

/* ------------------------------------------------------------------ *
 * rendering
 * ------------------------------------------------------------------ */

function statusGlyph(s: string): string {
  return s === 'supported' ? 'supported' : s === 'refuted' ? '**REFUTED**' : 'inconclusive';
}

function renderScopeMd(
  scope: ResearchScope,
  ledger: ClaimsLedger,
  untested: string[],
  issues: ReturnType<typeof validateScope>,
): string {
  const L: string[] = [];
  const s = ledger.summary;
  L.push(`# ${scope.title}`);
  L.push('');
  L.push(`Scope version: ${scope.version}`);
  L.push(`Generated: ${ledger.generatedAt}`);
  L.push(`Claims: ${s.total} tested — ${s.supported} supported, ${s.refuted} refuted, ${s.inconclusive} inconclusive; ${untested.length} undefined-but-untested`);
  L.push('');
  L.push('> This document is generated from `research/scope.ts` and the evidence artifacts.');
  L.push('> Claim ids and their falsifiability criteria are fixed in the source, not here.');
  L.push('');
  L.push('## Purpose');
  L.push('');
  L.push(scope.purpose);
  L.push('');

  L.push('## Research questions');
  L.push('');
  L.push('| id | question | method | status | claims |');
  L.push('|---|---|---|---|---|');
  for (const q of scope.questions) {
    const qc = ledger.byQuestion.find((x) => x.question === q.id);
    L.push(`| ${q.id} | ${q.question} | ${q.method} | ${q.status} | ${qc ? `${qc.supported}/${qc.total} supported` : '—'} |`);
  }
  L.push('');

  L.push('## Scope boundaries');
  L.push('');
  L.push('| id | area | decision | rationale |');
  L.push('|---|---|---|---|');
  for (const b of scope.boundaries) L.push(`| ${b.id} | ${b.area} | ${b.decision} | ${b.rationale} |`);
  L.push('');

  L.push('## Method commitments');
  L.push('');
  for (const m of scope.methods) {
    L.push(`- **${m.name}** (${m.id}) — ${m.commitment}`);
  }
  L.push('');

  L.push('## Claim ledger');
  L.push('');
  L.push('Every claim below was fixed in `scope.ts` before the experiment. A refuted claim is reported, not hidden.');
  L.push('');
  L.push('| id | RQ | status | claim | falsifier | evidence |');
  L.push('|---|---|---|---|---|---|');
  for (const v of ledger.verdicts) {
    const claim = scope.claims.find((c) => c.id === v.claimId);
    const text = claim?.claim ?? '';
    L.push(`| ${v.claimId} | ${v.question} | ${statusGlyph(v.status)} | ${text} | ${v.criterion.statement} | ${v.detail.replace(/\|/g, '/')} |`);
  }
  L.push('');

  if (untested.length > 0) {
    L.push('## Defined but untested this run');
    L.push('');
    L.push('These claims exist in the scope but no evidence was produced for them in this run:');
    L.push('');
    for (const id of untested) L.push(`- ${id}`);
    L.push('');
  }

  if (issues.length > 0) {
    L.push('## Scope integrity');
    L.push('');
    for (const i of issues) L.push(`- [${i.severity}] ${i.id}: ${i.detail}`);
    L.push('');
  }

  return L.join('\n');
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('scopeRun.ts')) {
  const full = process.argv.includes('--full');
  const seedArgIdx = process.argv.indexOf('--determinism-seeds');
  const seedCount = seedArgIdx >= 0 ? Number(process.argv[seedArgIdx + 1]) || 2 : 2;
  const seeds = Array.from({ length: Math.max(1, seedCount) }, (_, i) => `scope-det-00${i + 1}`);
  const res = runScope({ scale: full ? 'full' : 'quick', determinismSeeds: seeds });
  const s = res.ledger.summary;
  console.log(
    `scope: ${s.supported}/${s.total} claims supported, ${s.refuted} refuted, ${s.inconclusive} inconclusive, ${res.untested.length} untested; wrote ${res.mdPath}`,
  );
}
