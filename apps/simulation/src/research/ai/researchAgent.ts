import { parseJsonLoose } from './client.js';
import { researchProposalPrompt } from './prompts.js';
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

export interface ProposalOutcome {
  proposal: ExperimentProposal;
  verdict: ProposalVerdict;
  detail: string;
}

/** Evaluates a proposal against the real benchmark harness. */
export type ProposalEvaluator = (
  proposal: ExperimentProposal,
) => Promise<Omit<ProposalOutcome, 'proposal'>> | Omit<ProposalOutcome, 'proposal'>;

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

export async function proposeExperiments(
  llm: Llm,
  context: string,
  opts: ChatOptions = {},
): Promise<{ proposals: ExperimentProposal[]; result: ChatResult }> {
  const { data, result } = await llm.chatJson<Record<string, unknown>>(researchProposalPrompt(context), opts);
  return { proposals: proposalsFromObject(data), result };
}

/**
 * The closed loop: propose → evaluate against the harness → record. The LLM is
 * consulted only for proposals; every verdict comes from the deterministic
 * benchmark code, so the loop's scientific output is grounded, not generated.
 */
export async function runResearchLoop(
  llm: Llm,
  context: string,
  evaluate: ProposalEvaluator,
  opts: ChatOptions = {},
): Promise<{ proposals: ExperimentProposal[]; records: ProposalOutcome[]; proposeResult: ChatResult }> {
  const { proposals, result } = await proposeExperiments(llm, context, opts);
  const records: ProposalOutcome[] = [];
  for (const proposal of proposals) {
    const outcome = await evaluate(proposal);
    records.push({ proposal, ...outcome });
  }
  return { proposals, records, proposeResult: result };
}
