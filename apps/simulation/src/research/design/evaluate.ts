/** Evaluate candidates by running ladder (optionally multi-seed) and scoring. */
import { runLadder, type LadderOptions, type LadderResult } from "../ladder.js";
import type { Candidate } from "./candidate.js";
import { type Objective, scoreMulti, meetsThresholds } from "./objectives.js";

export interface EvalOptions {
  seeds?: string[];
  ladder: LadderOptions;
  objectives: Objective[];
}

export interface EvalResult {
  candidate: Candidate;
  results: LadderResult[];
  meanScore: number;
  stdScore: number;
  allPass: boolean;
  scores: number[];
}

export async function evaluateCandidate(c: Candidate, opts: EvalOptions): Promise<EvalResult> {
  const seeds = opts.seeds ?? ["ladder-seed-0001"];
  const results: LadderResult[] = [];
  for (const seed of seeds) {
    const o = { ...opts.ladder, seed };
    if (c.brain) o.brain = { ...(o.brain ?? {}), ...c.brain };
    if (c.worldStoch) o.worldStoch = { ...(o.worldStoch ?? {}), ...c.worldStoch };
    if (c.cellBio !== undefined) o.cellBio = c.cellBio;
    if (c.universe !== undefined && c.universe !== null) o.universe = c.universe;
    if (c.spawnCount !== undefined) o.spawnCount = c.spawnCount;
    results.push(await runLadder(o));
  }
  const scores = results.map((r) => scoreMulti(opts.objectives, r).total);
  const mean = scores.reduce((a, b) => a + b, 0) / Math.max(1, scores.length);
  const varv = scores.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, scores.length);
  const stdScore = Math.sqrt(varv);
  const allPass = results.every((r) => meetsThresholds(opts.objectives, r));
  return { candidate: c, results, meanScore: mean, stdScore, allPass, scores };
}
