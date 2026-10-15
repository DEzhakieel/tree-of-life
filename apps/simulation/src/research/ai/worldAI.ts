import { parseJsonLoose } from './client.js';
import { clampOverrides } from './knobs.js';
import { worldDirectivePrompt } from './prompts.js';
import type { ChatOptions, ChatResult, Llm } from './types.js';

/** One-line per-species strategy the world-mind issues. */
export interface SpeciesStrategy {
  name: string;
  strategy: string;
  note: string;
}

/**
 * The LLM's collective steering decision: an objective, a human-readable
 * rationale, a whitelisted+clamped set of `WorldParams` overrides, and a
 * strategy line per species. `overrides` is always safe to spread into
 * `makeWorld(...)`.
 */
export interface WorldDirective {
  objective: string;
  rationale: string;
  overrides: Record<string, number>;
  species: SpeciesStrategy[];
}

export function directiveFromObject(obj: Record<string, unknown>): WorldDirective {
  const overrides = clampOverrides((obj.overrides as Record<string, unknown> | undefined) ?? {});
  const rawSpecies = Array.isArray(obj.species) ? obj.species : [];
  const species = rawSpecies.map((s) => {
    const o = (s ?? {}) as Record<string, unknown>;
    return {
      name: String(o.name ?? 'unknown'),
      strategy: String(o.strategy ?? 'explore'),
      note: String(o.note ?? ''),
    };
  });
  return {
    objective: String(obj.objective ?? ''),
    rationale: String(obj.rationale ?? ''),
    overrides,
    species,
  };
}

export function parseDirective(raw: string): WorldDirective {
  return directiveFromObject(parseJsonLoose<Record<string, unknown>>(raw));
}

export async function directWorld(
  llm: Llm,
  context: string,
  opts: ChatOptions = {},
): Promise<{ directive: WorldDirective; result: ChatResult }> {
  const { data, result } = await llm.chatJson<Record<string, unknown>>(worldDirectivePrompt(context), opts);
  return { directive: directiveFromObject(data), result };
}
