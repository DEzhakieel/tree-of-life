import { u32hex, fnv1a32 } from '@fractal-life/shared';
import type { Engine } from '../engine.js';
import type { SimAgent } from '../agent.js';

/**
 * Strict, bit-exact state hashing for the determinism / reproducibility /
 * research tiers (research/modes.ts).
 *
 * `fullStateHash` folds EVERY live datum that can differ between two runs into
 * one u32 (rendered as 8 hex chars):
 *   - terrain grid: height, energy, moisture, hazard, chem, baseMinerals,
 *     minerals, food, meat, signal, cap (raw float32 bits, not quantised);
 *   - chemistry terrain: O2, pH, toxin, minerals;
 *   - the stochastic world state (OU resource field + Markov weather) when the
 *     research mode is enabled;
 *   - every agent (ascending id): position, velocity, energy, water, meme,
 *     orbit state, age, pause state, and the full plastic brain (weights,
 *     recurrent memory, critic value, last reward);
 *   - the tick number.
 *
 * Hashing is done over the raw memory of each Float32Array via a Uint32Array
 * view (object-array indices, little-endian), so a 16k-cell grid field hashes
 * in ~0.03 ms and two runs agree if and only if every float that participates
 * in the trajectory is bit-identical. This is the `S(run)` in
 * "S(run1) = S(run2)".
 */

const FNV_PRIME = 0x01000193;

function mix(h: number, v: number): number {
  h ^= v;
  return Math.imul(h, FNV_PRIME) >>> 0;
}

function view(arr: Float32Array): Uint32Array {
  return new Uint32Array(arr.buffer, arr.byteOffset, arr.length);
}

function mixArray(h: number, arr: Float32Array): number {
  const u = view(arr);
  for (let i = 0; i < u.length; i++) h = mix(h, u[i]);
  return h;
}

function mixNumbers(h: number, values: number[]): number {
  const f = new Float32Array(values);
  return mixArray(h, f);
}

const GRID_FIELDS = [
  'height',
  'energy',
  'moisture',
  'hazard',
  'chem',
  'baseMinerals',
  'minerals',
  'food',
  'meat',
  'signal',
  'cap',
] as const;

const CHEM_FIELDS = ['O2', 'pH', 'toxin', 'minerals'] as const;

type WithStoch = unknown & {
  worldStochState?: { ouMul: Float32Array; weather: number; weatherMoisture: number; weatherGrowth: number } | undefined;
};

export function fullStateHash(engine: Engine): string {
  let h = 0x811c9dc5;

  const grid = engine.grid as unknown as Record<string, Float32Array>;
  for (const f of GRID_FIELDS) h = mixArray(h, grid[f]);

  const ct = engine.chemTerrain as unknown as Record<string, Float32Array>;
  for (const f of CHEM_FIELDS) h = mixArray(h, ct[f]);

  const wst = (engine as unknown as WithStoch).worldStochState;
  if (wst) {
    h = mixArray(h, wst.ouMul);
    h = mixNumbers(h, [wst.weather, wst.weatherMoisture, wst.weatherGrowth]);
  }

  const ids = [...engine.agents.keys()].sort((a, b) => a - b);
  for (const id of ids) {
    const a = engine.agents.get(id) as SimAgent;
    h = mixNumbers(
      h,
      [a.id, a.x, a.y, a.vx, a.vy, a.energy, a.water, a.meme, a.zRe, a.zIm, a.orbitDepth, a.age, a.bornAtTick, a.pausedTicks],
    );
    h = mixArray(h, a.brain.w);
    h = mixArray(h, a.brain.h);
    h = mixNumbers(h, [a.brain.v, a.brain.lastReward, a.brain.cb]);
  }

  h = mix(h, engine.currentTick);
  return u32hex(h);
}

/**
 * Outcome-level fingerprint from the engine's own `stats()` — masks the same
 * telemetry the experiments report (alive, species, births, deaths, evolved
 * math-module values). Cheap: no grid hashing. Used for report tables and for
 * asserting "the same run ends in the same observable world".
 */
export function outcomeFingerprint(engine: Engine): string {
  const s = engine.stats();
  return u32hex(
    fnv1a32(
      [
        s.aliveCount,
        s.speciesCount,
        s.births,
        s.deaths,
        s.escapeDeaths,
        s.energySum,
        s.selectionEntropy,
        s.fixationIndex,
        s.lyapunovExponent,
        s.caAliveFraction,
        s.traitTotalVariance,
        s.aliveCount === 0 ? -1 : s.avgEnergy,
      ]
        .map((v) => v.toFixed(1))
        .join('|'),
    ),
  );
}

/**
 * World-definition fingerprint: the seed plus every parameter that enters the
 * world identity (habitat jitter, timestep, spawn/population limits, energy
 * capacity, food regen, day/season length, escape radius, fractal controls).
 * Two worlds are the same world iff (seed, fingerprint) match.
 */
export function worldFingerprint(seed: string, params: Record<string, number | string | undefined>): string {
  const keys = Object.keys(params).sort();
  const parts = keys.map((k) => `${k}=${params[k]}`);
  return u32hex(fnv1a32(`world|${seed}|${parts.join(';')}`));
}