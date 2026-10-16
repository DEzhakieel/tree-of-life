/** Joint/event-set probability modeling for multiple co-occurring events. */
import type { BlackSwanObs } from "./blackSwans.js";

export interface EventSet {
  events: string[];
}

export interface EventSetProb {
  set: EventSet;
  /** Simple independence estimate P(e1,...,en)=? P(ei). */
  pIndep: number;
  /** Upper bound (union approx) and lower bound. */
  pBounds: { min: number; max: number };
  count: number;
}

/** Build joint probability estimate from observations (empirical base rates). */
export function probEventSet(observations: BlackSwanObs[], set: EventSet): EventSetProb {
  const seen: Record<string, number> = {};
  for (const o of observations) seen[o.id] = (seen[o.id] ?? 0) + 1;
  const total = observations.length || 1;
  const rates: Record<string, number> = {};
  for (const id of set.events) rates[id] = (seen[id] ?? 0) / total;
  let pIndep = 1;
  for (const id of set.events) pIndep *= rates[id];
  let min = 0;
  let max = 0;
  for (const id of set.events) max += rates[id];
  max = Math.min(1, max);
  min = Math.max(0, set.events.length === 1 ? rates[set.events[0]] : 0);
  return { set, pIndep, pBounds: { min, max }, count: observations.filter(o => set.events.includes(o.id)).length };
}

export function jointSurprise(observations: BlackSwanObs[], set: EventSet): number {
  const ps = probEventSet(observations, set);
  const meanImp = observations.filter(o => set.events.includes(o.id)).reduce((a, b) => a + b.impact, 0) / Math.max(1, ps.count);
  return meanImp * (1 - Math.min(1, ps.pIndep + 1e-6)) / (ps.pIndep + 1e-6);
}
