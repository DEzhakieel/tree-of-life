/** Emergence engineering objectives. */
import type { LadderResult, LadderLevelVerdict } from "../ladder.js";

export interface Objective {
  id: string;
  name: string;
  value(r: LadderResult): number;
  threshold?: number;
  weight?: number;
}

function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0;
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

function verdictScore(v: LadderLevelVerdict["verdict"]): number {
  if (v === "EMERGENT") return 1;
  if (v === "PARTIAL") return 0.5;
  return 0;
}

/** ladder levels are named 'L1 life' / 'L2 interaction' / 'L3 cognition' */
function levelVerdict(r: LadderResult, prefix: string): LadderLevelVerdict["verdict"] {
  return r.synthesis.levels.find((l) => l.level.startsWith(prefix))?.verdict ?? "ABSENT";
}

export const objectives = {
  l1Emergent(): Objective {
    return { id: "l1-emergent", name: "L1 emergent", value(r) { return verdictScore(levelVerdict(r, "L1")); }, threshold: 1, weight: 1 };
  },
  l2Emergent(): Objective {
    return { id: "l2-emergent", name: "L2 emergent", value(r) { return verdictScore(levelVerdict(r, "L2")); }, threshold: 1, weight: 1 };
  },
  l3Emergent(): Objective {
    return { id: "l3-emergent", name: "L3 emergent", value(r) { return verdictScore(levelVerdict(r, "L3")); }, threshold: 1, weight: 1 };
  },
  adaptation(min = 0): Objective {
    return { id: "adaptation", name: "Adaptation (%)", value(r) { return Math.max(0, r.summary.cognition.adaptationFrac * 100); }, threshold: min, weight: 1 };
  },
  lifeSteady(): Objective {
    return { id: "life-steady", name: "Life steady-state", value(r) { return Math.max(0, r.summary.life.finalAlive) / Math.max(1, r.options.maxPopulation); }, weight: 0.5 };
  },
  speciation(min = 0): Objective {
    return { id: "speciation", name: "Species richness", value(r) { return Math.max(0, r.summary.interaction.maxSpecies); }, threshold: min, weight: 0.5 };
  },
  hazardAvoidance(): Objective {
    return { id: "hazard-avoidance", name: "Hazard avoidance (|corr|)", value(r) { return clamp01(Math.abs(r.summary.cognition.hazardCorr)); }, weight: 0.3 };
  },
  signalUse(): Objective {
    return { id: "signal-use", name: "Signal correlation", value(r) { return clamp01(Math.abs(r.summary.cognition.signalCorr)); }, weight: 0.3 };
  },
  cultureMemeMI(): Objective {
    return { id: "culture-mi", name: "Culture�species MI", value(r) { return clamp01(r.summary.cognition.speciesMemeMIMax); }, weight: 0.4 };
  },
};

export function scoreMulti(objList: Objective[], r: LadderResult): { total: number; breakdown: Record<string, number> } {
  let total = 0;
  const breakdown: Record<string, number> = {};
  for (const o of objList) {
    const v = o.value(r);
    const w = o.weight ?? 1;
    breakdown[o.id] = v * w;
    total += breakdown[o.id];
  }
  return { total, breakdown };
}

export function meetsThresholds(objList: Objective[], r: LadderResult): boolean {
  return objList.every((o) => o.threshold === undefined || o.value(r) >= o.threshold);
}
