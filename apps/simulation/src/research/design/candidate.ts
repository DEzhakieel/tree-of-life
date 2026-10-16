/** Candidate encoding + parameterization for emergence engineering. */
import type { BrainConfig } from "../../brain.js";
import type { UniverseConfig } from "@fractal-life/shared";

export interface DesignParam {
  key: string;
  min: number;
  max: number;
  integer?: boolean;
  center?: number;
}

export interface Candidate {
  id: string;
  params: Record<string, number | string | boolean | null>;
  brain?: Partial<BrainConfig>;
  worldStoch?: any;
  cellBio?: boolean;
  universe?: UniverseConfig | null;
  spawnCount?: number;
}

export function randomCandidate(params: DesignParam[], seed = 12345): Candidate {
  let s = seed >>> 0;
  const next = () => {
    s += 0x6d2b79f5;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const p: Record<string, number> = {};
  for (const dp of params) {
    const r = next();
    let v = dp.min + r * (dp.max - dp.min);
    if (dp.integer) v = Math.round(v);
    p[dp.key] = v;
  }
  return { id: `cand-${seed.toString(36)}-${(Date.now() % 10000).toString(36)}`, params: p };
}
