import { parseJsonLoose } from './client.js';
import { phaseAnalysisPrompt } from './prompts.js';
import type { ChatOptions, ChatResult, Llm } from './types.js';

/** One order parameter's sharpest measured transition. */
export interface PhaseLocus {
  axis: string;
  locus: string;
  sharp: boolean;
  note: string;
}

export interface PhaseRefinement {
  axis: string;
  around: number;
}

/** The LLM's interpretation of a measured phase sweep. */
export interface PhaseAnalysis {
  loci: PhaseLocus[];
  recommendation: string;
  refine: PhaseRefinement[];
}

export function analysisFromObject(obj: Record<string, unknown>): PhaseAnalysis {
  const rawLoci = Array.isArray(obj.loci) ? obj.loci : [];
  const loci = rawLoci.map((l) => {
    const o = (l ?? {}) as Record<string, unknown>;
    return {
      axis: String(o.axis ?? ''),
      locus: String(o.locus ?? ''),
      sharp: Boolean(o.sharp),
      note: String(o.note ?? ''),
    };
  });
  const rawRefine = Array.isArray(obj.refine) ? obj.refine : [];
  const refine = rawRefine
    .map((r) => {
      const o = (r ?? {}) as Record<string, unknown>;
      const around = Number(o.around);
      return { axis: String(o.axis ?? ''), around };
    })
    .filter((r) => Number.isFinite(r.around));
  return {
    loci,
    recommendation: String(obj.recommendation ?? ''),
    refine,
  };
}

export function parseAnalysis(raw: string): PhaseAnalysis {
  return analysisFromObject(parseJsonLoose<Record<string, unknown>>(raw));
}

export async function analysePhases(
  llm: Llm,
  context: string,
  opts: ChatOptions = {},
): Promise<{ analysis: PhaseAnalysis; result: ChatResult }> {
  const { data, result } = await llm.chatJson<Record<string, unknown>>(phaseAnalysisPrompt(context), opts);
  return { analysis: analysisFromObject(data), result };
}
