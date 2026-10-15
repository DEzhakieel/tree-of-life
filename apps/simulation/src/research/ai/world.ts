import { Engine } from '../../engine.js';
import type { WorldConfig } from '@fractal-life/shared';
import { WORLD_KNOBS } from './knobs.js';

/** A compact, comparable snapshot of the world at a point in time. */
export interface WorldSample {
  tick: number;
  population: number;
  aliveCount: number;
  speciesCount: number;
  avgEnergy: number;
  cooperation: number;
  caComplexity: number;
  traitEffectiveDim: number;
  traitTotalVariance: number;
}

export function pickSample(engine: Engine): WorldSample {
  const s = engine.stats();
  return {
    tick: s.tick,
    population: s.population,
    aliveCount: s.aliveCount,
    speciesCount: s.speciesCount,
    avgEnergy: s.avgEnergy,
    cooperation: s.cooperation,
    caComplexity: s.caComplexity,
    traitEffectiveDim: s.traitEffectiveDim,
    traitTotalVariance: s.traitTotalVariance,
  };
}

/**
 * Write clamped overrides into a RUNNING engine. Construction-only knobs
 * (`spawnCount`) are skipped: they are only read at world build, so writing
 * them mid-run would silently do nothing and mislead the controller.
 * Returns exactly the knobs that were actuated.
 */
export function applyWorldOverrides(
  engine: Engine,
  overrides: Record<string, number>,
): Record<string, number> {
  const applied: Record<string, number> = {};
  for (const [key, value] of Object.entries(overrides)) {
    const knob = WORLD_KNOBS.find((k) => k.key === key);
    if (!knob || knob.constructionOnly) continue;
    (engine.params as unknown as Record<string, number>)[key] = value;
    applied[key] = value;
  }
  return applied;
}

/** Fresh engine, run `ticks`, snapshot. Used for unsteered control runs. */
export function runWorld(world: WorldConfig, ticks: number): WorldSample {
  const engine = new Engine(world);
  for (let i = 0; i < ticks; i++) engine.tick();
  return pickSample(engine);
}

export function fmtSample(s: WorldSample): string {
  return (
    `tick=${s.tick} pop=${s.population} alive=${s.aliveCount} species=${s.speciesCount} ` +
    `energy=${s.avgEnergy.toFixed(1)} coop=${s.cooperation.toFixed(3)} ` +
    `caComplexity=${s.caComplexity.toFixed(3)} effDim=${s.traitEffectiveDim.toFixed(1)}`
  );
}

/** `a → b` for every numeric metric, for one-line trajectory summaries. */
export function deltaLine(a: WorldSample, b: WorldSample): string {
  return (Object.keys(b) as (keyof WorldSample)[])
    .map((k) => `${k}: ${a[k]} → ${b[k]}`)
    .join('; ');
}
