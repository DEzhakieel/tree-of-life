/** Simple search strategies for emergence engineering. */
import { type DesignParam, type Candidate, randomCandidate } from "./candidate.js";
import { evaluateCandidate, type EvalOptions, type EvalResult } from "./evaluate.js";

export interface SearchOptions extends EvalOptions {
  budget: number;
  elite: number;
}

export async function randomSearch(params: DesignParam[], opts: SearchOptions): Promise<EvalResult[]> {
  const out: EvalResult[] = [];
  let s = 42;
  for (let i = 0; i < opts.budget; i++) {
    const c = randomCandidate(params, (s++ * 131542391) >>> 0);
    out.push(await evaluateCandidate(c, opts));
  }
  out.sort((a, b) => b.meanScore - a.meanScore);
  return out.slice(0, opts.elite);
}
