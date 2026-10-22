/**
 * Species presets for the Spawn tool — curated "life engineering" templates.
 *
 * Each preset starts from a random base genome and overrides a handful of
 * decoded genes at well-known indices (see packages/shared/src/constants.ts),
 * so the Drop-any-genome Spawn tool can inject an archetype into the world.
 *
 * Override semantics: genes are stored signed in [-1,1]; a decoded weight is
 * clamp01((g+1)/2), so writing a target weight w means g = w*2-1.
 */
import { GENOME_SIZE } from '@fractal-life/shared';

/** Signed-encode a decoded weight w in [0,1] back to genome space. */
export function encodeWeight(w: number): number {
  return Math.max(-1, Math.min(1, w * 2 - 1));
}

/** Clone a signed value into a fresh genome's gene slot. */
function override(genome: Float32Array, index: number, weight: number): void {
  genome[index] = encodeWeight(weight);
}

/** Uniform random base genome (same convention as the designer's random roll). */
export function randomGenome(): Float32Array {
  const g = new Float32Array(GENOME_SIZE);
  for (let i = 0; i < GENOME_SIZE; i++) g[i] = Math.random() * 2 - 1;
  return g;
}

// Gene indices (from shared constants): phenotype [0..10], drives [110..115],
// strategies [116..119].
const G = {
  speed: 0,
  size: 6,
  diet: 7,
  fertility: 8,
  longevity: 9,
  mutability: 10,
  alignment: 110,
  cohesion: 111,
  separation: 112,
  circulation: 113,
  oscillation: 114,
  noise: 115,
  aggression: 116,
  cooperation: 117,
  risk: 118,
  deception: 119,
} as const;

export interface SpeciesPreset {
  id: string;
  label: string;
  hint: string;
  /** short engineering note shown on hover */
  notes: string;
  build: () => Float32Array;
}

function makePreset(
  id: string,
  label: string,
  hint: string,
  notes: string,
  tweaks: Partial<Record<keyof typeof G, number>> | null,
): SpeciesPreset {
  return {
    id,
    label,
    hint,
    notes,
    build: () => {
      const g = randomGenome();
      if (tweaks) for (const [key, w] of Object.entries(tweaks)) override(g, G[key as keyof typeof G]!, w);
      return g;
    },
  };
}

export const SPECIES_PRESETS: SpeciesPreset[] = [
  makePreset('grazer', '🌱 Grazer', 'herbivore generalist',
    'low diet, low aggression, high cooperation — flocks and farms algae', {
    speed: 0.45, size: 1.0, diet: 0.15, fertility: 1.1, longevity: 1.2, mutability: 0.7,
    alignment: 0.6, cohesion: 0.6, separation: 0.3,
    aggression: 0.2, cooperation: 0.65, risk: 0.35, deception: 0.25,
  }),
  makePreset('predator', '🐺 Predator', 'apex carnivore',
    'high diet + aggression, big body — hunts other agents', {
    speed: 0.7, size: 1.9, diet: 0.92, fertility: 0.7, longevity: 1.0, mutability: 0.6,
    alignment: 0.3, cohesion: 0.3, separation: 0.5,
    aggression: 0.85, cooperation: 0.2, risk: 0.6, deception: 0.5,
  }),
  makePreset('altruist', '🤝 Altruist', 'greenbeard donor',
    'near-max cooperation, generous and docile, long-lived', {
    speed: 0.4, size: 0.9, diet: 0.35, fertility: 1.5, longevity: 1.3, mutability: 0.5,
    alignment: 0.5, cohesion: 0.7, separation: 0.2,
    aggression: 0.15, cooperation: 0.95, risk: 0.3, deception: 0.15,
  }),
  makePreset('swarm', '🐝 Swarm', 'cohesive flock',
    'strong alignment/cohesion with spacing — forms travelling clumps', {
    speed: 0.6, size: 0.8, diet: 0.45, fertility: 1.2, longevity: 0.9, mutability: 0.7,
    alignment: 0.75, cohesion: 0.65, separation: 0.85, oscillation: 0.6,
    aggression: 0.3, cooperation: 0.5, risk: 0.4, deception: 0.2,
  }),
  makePreset('drifter', '🍃 Drifter', 'passive explorer',
    'weak drives, high noise — random-walks the map edge-to-edge', {
    speed: 0.55, size: 0.7, diet: 0.5, fertility: 0.9, longevity: 1.4, mutability: 0.9,
    alignment: 0.1, cohesion: 0.1, separation: 0.1, circulation: 0.0, oscillation: 0.0, noise: 0.9,
    aggression: 0.25, cooperation: 0.3, risk: 0.7, deception: 0.1,
  }),
  makePreset('burster', '🎆 Burster', 'r-strategist ephemeral',
    'high mutation + fertility, short life — colonises and diversifies fast', {
    speed: 0.5, size: 0.6, diet: 0.3, fertility: 1.9, longevity: 0.2, mutability: 0.9,
    aggression: 0.35, cooperation: 0.35, risk: 0.9, deception: 0.3,
  }),
];