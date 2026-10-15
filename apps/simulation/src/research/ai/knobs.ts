/**
 * The whitelist of world parameters an LLM world-mind may steer, with hard
 * clamps. Anything outside this list (or outside its range) is dropped, so a
 * model can never inject an unknown or unsafe knob into the engine.
 */
export interface WorldKnob {
  key: string;
  label: string;
  min: number;
  max: number;
  note: string;
  /**
   * Only read when the world is built (e.g. founders). Writing it into a
   * running engine has no effect, so the controller reports it as advisory
   * instead of actuating it.
   */
  constructionOnly?: boolean;
}

export const WORLD_KNOBS: WorldKnob[] = [
  { key: 'metabolismBase', label: 'metabolic rate', min: 0.2, max: 3, note: 'per-tick energy burn multiplier; higher = harsher' },
  { key: 'foodRegenRate', label: 'food regen', min: 0.00002, max: 0.01, note: 'plant regrowth per tick; higher = richer' },
  { key: 'energyCapacity', label: 'energy capacity', min: 20, max: 600, note: 'per-cell energy ceiling; sets body/bank size' },
  { key: 'maxPopulation', label: 'population cap', min: 200, max: 8000, note: 'ceiling on living agents' },
  { key: 'agentMaxAge', label: 'lifespan', min: 500, max: 8000, note: 'ticks before senescence kills' },
  { key: 'dayLength', label: 'day length', min: 200, max: 4800, note: 'ticks per day/night cycle' },
  { key: 'seasonLength', label: 'season length', min: 2000, max: 40000, note: 'ticks per seasonal boom/bust cycle' },
  { key: 'spawnCount', label: 'founders', min: 50, max: 1000, note: 'initial population; construction-only', constructionOnly: true },
];

const KNOB_BY_KEY = new Map(WORLD_KNOBS.map((k) => [k.key, k]));

/** Clamp an override bag to the declared knobs + ranges; drop everything else. */
export function clampOverrides(raw: Record<string, unknown>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(raw)) {
    const knob = KNOB_BY_KEY.get(key);
    if (!knob) continue;
    const n = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(n)) continue;
    out[key] = Math.min(knob.max, Math.max(knob.min, n));
  }
  return out;
}
