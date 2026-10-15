import { sha256Hex } from './hash.js';
import type { LlmMessage } from './types.js';

/**
 * Deterministic offline backend. Every call is a pure function of the prompt:
 * it reads the `TASK:` tag the prompt builders emit and returns a well-formed
 * response for that task. This is what tests and CI use, so the whole AI layer
 * can be exercised with no model server and no network.
 */
export function mockGenerate(messages: LlmMessage[], opts: { json?: boolean } = {}): string {
  const task = taskOf(messages);
  const seed = parseInt(sha256Hex(JSON.stringify(messages)).slice(0, 8), 16);
  const r1 = (seed % 1000) / 1000; // deterministic pseudo-random in [0,1)
  const r2 = ((seed >>> 10) % 1000) / 1000;

  switch (task) {
    case 'world-directive':
      return JSON.stringify({
        objective: 'sustain a diverse, energy-rich population',
        rationale: `mock world-mind (seed ${seed % 997}) nudges food up and metabolism down to grow the population`,
        overrides: {
          foodRegenRate: 0.0003 * (1.5 + r1),
          metabolismBase: 1 * (0.8 + 0.4 * r2),
          energyCapacity: Math.round(100 + 100 * r1),
        },
        species: [
          { name: 'herbivores', strategy: 'expand', note: 'colonise the new richness' },
          { name: 'carnivores', strategy: 'compete', note: 'exploit the larger prey base' },
        ],
      });

    case 'phase-analysis':
      return JSON.stringify({
        loci: [
          { axis: 'capacity', locus: 'aliveFrac', sharp: r1 > 0.5, note: `mock reading at locus ${(1.5 + r2).toFixed(2)}` },
        ],
        recommendation: 'refine around the apparent order step; verify the peak survives higher resolution',
        refine: [{ axis: 'capacity', around: Number((1.5 + r2).toFixed(2)) }],
      });

    case 'research-proposal':
      return JSON.stringify({
        proposals: [
          {
            id: 'mock-p1',
            model: 'A',
            hypothesis: 'raising the per-step move scale keeps the MSD exponent near 1',
            params: {},
            expected: 'alpha within [0.98, 1.02]',
          },
          {
            id: 'mock-p2',
            model: 'H',
            hypothesis: 'a near-tie in R* should produce coexistence',
            params: {},
            expected: 'winnerCorrect false and both fractions in (0.1, 0.9)',
          },
        ],
      });

    default:
      return opts.json ? '{}' : `mock(${task}): deterministic offline response`;
  }
}

function taskOf(messages: LlmMessage[]): string {
  for (const m of messages) {
    const match = m.content.match(/^TASK:\s*([a-z0-9-]+)\s*$/im);
    if (match) return match[1]!.toLowerCase();
  }
  return 'generic';
}
