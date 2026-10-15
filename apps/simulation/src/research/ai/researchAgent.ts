import { countFreeParams, informationCriteria, relativeSse } from '../benchmarks/parsimony.js';
import { parseJsonLoose } from './client.js';
import { researchProposalPrompt } from './prompts.js';
import { stableStringify } from './hash.js';
import type { ChatOptions, ChatResult, Llm } from './types.js';

/** A falsifiable experiment the agent wants to run over the benchmark suite. */
export interface ExperimentProposal {
  id: string;
  model: string;
  hypothesis: string;
  params: Record<string, number>;
  expected: string;
}

export type ProposalVerdict = 'supported' | 'refuted' | 'inconclusive';

/**
 * Information-criteria score attached to a proposal, so a proposal that retunes
 * five knobs cannot beat a two-parameter proposal on residual error alone.
 */
export interface ProposalParsimony {
  /** free parameters: params differing from the model default */
  k: number;
  /** residual observations (reference keys used) */
  n: number;
  sse: number;
  aic: number;
  bic: number;
  /** ΔAIC within the round; 0 for the round's best */
  deltaAic?: number;
  akaikeWeight?: number;
  evidence?: 'substantial' | 'considerably-less' | 'none';
}

export interface ProposalOutcome {
  proposal: ExperimentProposal;
  verdict: ProposalVerdict;
  detail: string;
  parsimony?: ProposalParsimony;
}

/** Evaluates a proposal against the real benchmark harness. */
export type ProposalEvaluator = (
  proposal: ExperimentProposal,
) => Promise<Omit<ProposalOutcome, 'proposal'>> | Omit<ProposalOutcome, 'proposal'>;

export interface LoopRound {
  round: number;
  /** proposals the model put forward this round, after dedup */
  proposals: ExperimentProposal[];
  records: ProposalOutcome[];
  proposeResult: ChatResult;
}

/** A ledger row: one proposal, one verdict, stable across re-runs. */
export interface LedgerEntry {
  key: string;
  id: string;
  model: string;
  hypothesis: string;
  params: Record<string, number>;
  expected: string;
  verdict: ProposalVerdict;
  detail: string;
  round: number;
  parsimony?: ProposalParsimony;
}

export interface LoopResult {
  rounds: LoopRound[];
  /** every evaluated proposal, in order */
  records: ProposalOutcome[];
  /** deduplicated, deterministic ledger over `records` */
  ledger: LedgerEntry[];
  roundsUsed: number;
}

export interface ResearchLoopOptions {
  /** hard cap on proposal rounds (default 3) */
  maxRounds?: number;
  chat?: ChatOptions;
}

export function proposalsFromObject(obj: Record<string, unknown>): ExperimentProposal[] {
  const raw = Array.isArray(obj.proposals) ? obj.proposals : [];
  return raw.map((p, i) => {
    const o = (p ?? {}) as Record<string, unknown>;
    const params: Record<string, number> = {};
    const paramsRaw = (o.params ?? {}) as Record<string, unknown>;
    for (const [k, v] of Object.entries(paramsRaw)) {
      const n = Number(v);
      if (Number.isFinite(n)) params[k] = n;
    }
    return {
      id: String(o.id ?? `p${i + 1}`),
      model: String(o.model ?? ''),
      hypothesis: String(o.hypothesis ?? ''),
      params,
      expected: String(o.expected ?? ''),
    };
  });
}

export function parseProposals(raw: string): ExperimentProposal[] {
  return proposalsFromObject(parseJsonLoose<Record<string, unknown>>(raw));
}

/** Stable identity for dedup: two proposals matching this have already been run. */
export function proposalKey(p: ExperimentProposal): string {
  return `${p.id}|${p.model}|${stableStringify(p.params)}|${p.hypothesis}`;
}

/**
 * Score one proposal on accuracy-per-complexity against the model's declared
 * reference values. `reference` should be the model's `analytic` map when it has
 * one (closed-form ground truth); otherwise fall back to the empirical targets'
 * published values. Returns undefined when no reference values are available,
 * since an SSE against nothing would be fiction.
 */
export function scoreProposalParsimony(
  proposal: ExperimentProposal,
  observed: Record<string, number>,
  reference: Record<string, number> | undefined,
  defaults: Record<string, number> | undefined,
): ProposalParsimony | undefined {
  if (!reference || Object.keys(reference).length === 0) return undefined;
  const { sse, n } = relativeSse(observed, reference);
  if (n === 0) return undefined;
  const k = countFreeParams(proposal.params, defaults);
  const { aic, bic } = informationCriteria(k, sse, n);
  return { k, n, sse, aic, bic };
}

/** attach ΔAIC and Akaike weights across a round's scored proposals */
export function rankRoundParsimony(outcomes: readonly ProposalOutcome[]): void {
  const scored = outcomes.filter((o) => o.parsimony && Number.isFinite(o.parsimony.aic));
  if (scored.length < 2) return;
  const best = Math.min(...scored.map((o) => o.parsimony!.aic));
  const weights = scored.map((o) => Math.exp(-0.5 * (o.parsimony!.aic - best)));
  const sum = weights.reduce((a, b) => a + b, 0);
  scored.forEach((o, i) => {
    o.parsimony!.deltaAic = o.parsimony!.aic - best;
    o.parsimony!.akaikeWeight = weights[i]! / sum;
    o.parsimony!.evidence = o.parsimony!.deltaAic <= 2 ? 'substantial' : o.parsimony!.deltaAic <= 6 ? 'considerably-less' : 'none';
  });
}

export async function proposeExperiments(
  llm: Llm,
  context: string,
  opts: ChatOptions = {},
): Promise<{ proposals: ExperimentProposal[]; result: ChatResult }> {
  const { data, result } = await llm.chatJson<Record<string, unknown>>(researchProposalPrompt(context), opts);
  return { proposals: proposalsFromObject(data), result };
}

/**
 * The iterative research loop: propose → evaluate against the harness → feed the
 * verdicts back into the next round's prompt → repeat.
 *
 * The LLM only ever supplies candidates; every verdict comes from the
 * deterministic benchmark code, so the loop's scientific output is grounded, not
 * generated. Rounds stop early when a round yields nothing new or nothing
 * conclusive. Re-running the loop replays cached model output, so the ledger is
 * fully derived and idempotent.
 */
export async function runResearchLoop(
  llm: Llm,
  context: string | ((history: ProposalOutcome[]) => string),
  evaluate: ProposalEvaluator,
  options: ResearchLoopOptions = {},
): Promise<LoopResult> {
  const maxRounds = Math.max(1, options.maxRounds ?? 3);
  const history: ProposalOutcome[] = [];
  const rounds: LoopRound[] = [];
  const seen = new Set<string>();

  for (let round = 1; round <= maxRounds; round++) {
    const body = typeof context === 'function' ? context(history) : context;
    const prompt = renderRoundContext(round, maxRounds, body, history);
    const { proposals, result } = await proposeExperiments(llm, prompt, options.chat);

    const fresh: ExperimentProposal[] = [];
    for (const p of proposals) {
      const key = proposalKey(p);
      if (seen.has(key)) continue;
      seen.add(key);
      fresh.push(p);
    }

    const records: ProposalOutcome[] = [];
    for (const proposal of fresh) {
      const outcome = await evaluate(proposal);
      const record = { proposal, ...outcome };
      records.push(record);
      history.push(record);
    }
    rankRoundParsimony(records);
    rounds.push({ round, proposals: fresh, records, proposeResult: result });

    if (fresh.length === 0) break; // nothing new proposed
    if (records.every((r) => r.verdict === 'inconclusive')) break; // nothing learnable
  }

  return { rounds, records: history, ledger: buildLedger(rounds), roundsUsed: rounds.length };
}

function renderRoundContext(
  round: number,
  maxRounds: number,
  body: string,
  history: ProposalOutcome[],
): string {
  const lines = [`round: ${round} of ${maxRounds}`, body];
  if (history.length > 0) {
    lines.push('', 'already run (do not repeat):');
    for (const h of history) {
      lines.push(
        `  [${h.verdict}] ${h.proposal.id} on model ${h.proposal.model} — ${h.proposal.hypothesis} (${h.detail})`,
      );
    }
  }
  return lines.join('\n');
}

function buildLedger(rounds: LoopRound[]): LedgerEntry[] {
  return rounds.flatMap((r) =>
    r.records.map((rec) => ({
      key: proposalKey(rec.proposal),
      id: rec.proposal.id,
      model: rec.proposal.model,
      hypothesis: rec.proposal.hypothesis,
      params: rec.proposal.params,
      expected: rec.proposal.expected,
      verdict: rec.verdict,
      detail: rec.detail,
      round: r.round,
      parsimony: rec.parsimony,
    })),
  );
}
