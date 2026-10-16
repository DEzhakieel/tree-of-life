/** Black swan analysis: rare, high-impact events. */
import { Engine } from "../engine.js";
import type { WorldConfig } from "@fractal-life/shared";

export interface BlackSwanDef {
  id: string;
  detect(eng: Engine, tick: number): boolean;
  impact(eng: Engine): number;
  baseRate?: number;
}

export interface BlackSwanObs {
  id: string;
  tick: number;
  impact: number;
  pHat: number;
  surprise: number;
}

export interface BlackSwanResult {
  obs: BlackSwanObs[];
  rares: BlackSwanObs[];
}

function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0;
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

export function surpriseScore(impact: number, pHat: number): number {
  const p = clamp01(pHat);
  const s = impact * (1 - p) / (p + 1e-6);
  return clamp01(s);
}

export function blackSwanSuite(): BlackSwanDef[] {
  return [
    {
      id: "extinction",
      detect(e, t) {
        const s = e.stats();
        return s.aliveCount === 0 && t > 150;
      },
      impact() { return 1.0; },
      baseRate: 5e-4,
    },
    {
      id: "complexity-collapse",
      detect(e) {
        const s = e.stats();
        return s.complexity < 0.001 && s.aliveCount > 5;
      },
      impact(e) { const s = e.stats(); return clamp01(1 - s.diversity); },
      baseRate: 5e-3,
    },
    {
      id: "cooperation-drop",
      detect(e) {
        const s = e.stats();
        return s.predatorFraction > 0.65 && s.aliveCount > 20;
      },
      impact(e) { const s = e.stats(); return clamp01(s.predatorFraction); },
      baseRate: 2e-2,
    },
    {
      id: "culture-loss",
      detect(e) {
        const s = e.stats();
        return s.cultureCount < 2 && s.aliveCount > 10;
      },
      impact(e) { const s = e.stats(); return 1 - clamp01(s.speciesCount / 60); },
      baseRate: 2e-2,
    },
  ];
}

export function runBlackSwans(config: WorldConfig, ticks = 3000): BlackSwanResult {
  const e = new Engine(config);
  const suite = blackSwanSuite();
  const obs: BlackSwanObs[] = [];
  for (let t = 1; t <= ticks; t++) {
    e.tick();
    for (const d of suite) {
      if (obs.find(o => o.id === d.id && o.tick === t)) continue;
      if (d.detect(e, t)) {
        const imp = d.impact(e);
        const p = d.baseRate ?? 1e-2;
        obs.push({ id: d.id, tick: t, impact: imp, pHat: p, surprise: surpriseScore(imp, p) });
      }
    }
  }
  const rares = obs.slice().sort((a, b) => b.surprise - a.surprise);
  return { obs, rares };
}
