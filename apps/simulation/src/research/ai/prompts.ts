import { WORLD_KNOBS } from './knobs.js';
import type { LlmMessage } from './types.js';

/**
 * Prompt builders. Each emits a `TASK: <id>` line so the deterministic mock
 * backend (and any log reader) can route without parsing the whole prompt.
 */

export function worldDirectivePrompt(context: string): LlmMessage[] {
  const knobTable = WORLD_KNOBS.map(
    (k) => `- ${k.key} (${k.label}) in [${k.min}, ${k.max}] — ${k.note}`,
  ).join('\n');
  return [
    {
      role: 'system',
      content:
        'You are the collective "world mind" of an artificial-life simulation. ' +
        'You do not control individuals; you steer population-level pressures. ' +
        'Reply with STRICT JSON only, no prose, no markdown fences.',
    },
    {
      role: 'user',
      content: `TASK: world-directive

Choose a small set of world-parameter overrides that steer the world toward the objective, plus a one-line strategy per species.

Allowed knobs:
${knobTable}

World context:
${context}

Reply with exactly this JSON shape:
{"objective": string, "rationale": string, "overrides": {"<knob>": number}, "species": [{"name": string, "strategy": "expand"|"conserve"|"cooperate"|"compete"|"explore", "note": string}]}`,
    },
  ];
}

export function phaseAnalysisPrompt(context: string): LlmMessage[] {
  return [
    {
      role: 'system',
      content:
        'You are a complexity scientist analysing phase transitions in an artificial-life model. ' +
        'Interpret the measured order parameters near their sharpest changes. ' +
        'Reply with STRICT JSON only, no prose, no markdown fences.',
    },
    {
      role: 'user',
      content: `TASK: phase-analysis

A parameter sweep revealed order parameters with the following sharpest loci (largest change between adjacent parameter values). Interpret them and recommend refinements.

Sweep data:
${context}

Reply with exactly this JSON shape:
{"loci": [{"axis": string, "locus": string, "sharp": boolean, "note": string}], "recommendation": string, "refine": [{"axis": string, "around": number}]}`,
    },
  ];
}

export function researchProposalPrompt(context: string): LlmMessage[] {
  return [
    {
      role: 'system',
      content:
        'You are an automated research agent improving a benchmark suite for a multi-agent simulation. ' +
        'Propose concrete, falsifiable experiments over the existing benchmark models. ' +
        'Reply with STRICT JSON only, no prose, no markdown fences.',
    },
    {
      role: 'user',
      content: `TASK: research-proposal

Current benchmark coverage and recent results:
${context}

Propose up to 3 experiments. Reply with exactly this JSON shape:
{"proposals": [{"id": string, "model": string, "hypothesis": string, "params": object, "expected": string}]}`,
    },
  ];
}
