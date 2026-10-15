import { sha256Hex } from './hash.js';
import type { LlmMessage } from './types.js';

/**
 * Deterministic offline backend. Every call is a pure function of the prompt:
 * it reads the `TASK:` tag the prompt builders emit and returns a well-formed
 * response for that task. This is what tests and CI use, so the whole AI layer
 * can be exercised with no model server and no network.
 */
export function mockGenerate(messages: LlmMessage[], opts: { json?: boolean } = {}): string {
  const text = messages.map((m) => m.content).join('\n');
  const task = taskOf(messages);
  const seed = parseInt(sha256Hex(JSON.stringify(messages)).slice(0, 8), 16);
  const r1 = (seed % 1000) / 1000; // deterministic pseudo-random in [0,1)
  const r2 = ((seed >>> 10) % 1000) / 1000;

  switch (task) {
    case 'world-directive': {
      // react to the latest observation so the controller has a real feedback loop
      const observations = [...text.matchAll(/observation at tick \d+: pop=\d+ alive=(\d+)/g)];
      const alive = observations.length ? Number(observations[observations.length - 1]![1]) : 50;
      const hungry = alive < 200;
      const crowded = alive > 500;
      return JSON.stringify({
        objective: hungry
          ? 'recover the population after a lean window'
          : crowded
            ? 'hold the population near its healthy band'
            : 'sustain a diverse, energy-rich population',
        rationale: `mock world-mind sees alive=${alive}: ${hungry ? 'push food up and metabolism down' : crowded ? 'ease off the food supply' : 'hold a balanced supply'}`,
        overrides: {
          foodRegenRate: hungry ? 0.0009 : crowded ? 0.00012 : 0.0004 * (1 + r1),
          metabolismBase: hungry ? 0.5 : 1 * (0.9 + 0.2 * r2),
          energyCapacity: Math.round(hungry ? 350 : 150 + 100 * r1),
        },
        species: [
          { name: 'herbivores', strategy: hungry ? 'expand' : 'conserve', note: 'track the food supply' },
          { name: 'carnivores', strategy: 'compete', note: 'follow the prey base' },
        ],
      });
    }

    case 'phase-analysis':
      return JSON.stringify({
        loci: [
          { axis: 'capacity', locus: 'aliveFrac', sharp: r1 > 0.5, note: `mock reading at locus ${(1.5 + r2).toFixed(2)}` },
        ],
        recommendation: 'refine around the apparent order step; verify the peak survives higher resolution',
        refine: [{ axis: 'capacity', around: Number((1.5 + r2).toFixed(2)) }],
      });

    case 'research-proposal': {
      // round-aware pool: each round of the loop explores different models
      const roundMatch = text.match(/^round:\s*(\d+)/mi);
      const round = roundMatch ? Number(roundMatch[1]) : 1;
      const pools: ExperimentLike[][] = [
        [
          { id: 'mock-p1', model: 'A', hypothesis: 'raising the per-step move scale keeps the MSD exponent near 1', params: {}, expected: 'alpha within [0.98, 1.02]' },
          { id: 'mock-p2', model: 'B', hypothesis: 'a small alignment gain should preserve polar order', params: {}, expected: 'alignment stays high' },
          { id: 'mock-p3', model: 'F', hypothesis: 'a richer feed should keep Gray-Scott in the patterned regime', params: {}, expected: 'in-regime occupancy stays in [0.15, 0.6]' },
        ],
        [
          { id: 'mock-p4', model: 'C', hypothesis: 'a higher fill fraction keeps Life out of the ordered regime', params: {}, expected: 'pulsar still period 3' },
          { id: 'mock-p5', model: 'D', hypothesis: 'a slightly higher prey birth rate still yields limit cycles', params: {}, expected: 'period matches 2pi/sqrt(a*g)' },
          { id: 'mock-p6', model: 'H', hypothesis: 'a near-tie in R* should produce coexistence', params: {}, expected: 'both fractions in (0.1, 0.9)' },
        ],
        [
          { id: 'mock-p7', model: 'E', hypothesis: 'a finer grid keeps the diffusion constant accurate', params: {}, expected: 'L2 error below 1e-3' },
          { id: 'mock-p8', model: 'G', hypothesis: 'a higher benefit keeps cooperation fixed in the IPD', params: {}, expected: 'cooperation above 0.90' },
          { id: 'mock-p9', model: 'J', hypothesis: 'the composite still self-organises under a milder season', params: {}, expected: 'selfOrgGain above 0.05' },
        ],
      ];
      const pool = pools[Math.min(round - 1, pools.length - 1)]!;
      return JSON.stringify({ proposals: pool });
    }

    default:
      return opts.json ? '{}' : `mock(${task}): deterministic offline response`;
  }
}

interface ExperimentLike {
  id: string;
  model: string;
  hypothesis: string;
  params: Record<string, number>;
  expected: string;
}

function taskOf(messages: LlmMessage[]): string {
  for (const m of messages) {
    const match = m.content.match(/^TASK:\s*([a-z0-9-]+)\s*$/im);
    if (match) return match[1]!.toLowerCase();
  }
  return 'generic';
}
