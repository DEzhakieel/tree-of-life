/**
 * Life-organization detector: reads a run's `SimStats` stream into the ordered
 * ladder of biological organization the world is asked to exhibit —
 *
 *     O0 subatomic/quantum ─▶ O1 atomic ─▶ O2 molecular ─▶ O3 macromolecular
 *     (DNA/protein) ─▶ O4 organellar ─▶ O5 cellular ─▶ O6 tissue/specialization
 *     ─▶ O7 organ ─▶ O8 organ system (loop/feedback) ─▶ O9 organism
 *
 * where the user's phrasing is "simple to complex". It is the biological twin of
 * the capability radar (`emergenceRadar.ts`) and keeps the same three
 * disciplines so the numbers stay honest:
 *
 *   - A level is NOT a flag the engine sets about itself. It is a pure
 *     composition of *measured observables* (SimStats fields). Nothing about a
 *     level is asserted unless its substrate is actually wired.
 *   - Run-relative stretching. Each observable is min-max stretched across this
 *     run's own envelope; compare trajectory shapes / onsets, not absolute
 *     scores across runs.
 *   - Hysteresis. A level turns ON when it crosses 0.6 and only falls below when
 *     it drops under 0.4, so a single noisy frame cannot flicker it.
 *
 * Substrate discipline: a channel whose observable is never expressed across
 * the whole run (all-zero, i.e. its subsystem is switched off — the Phase E–I
 * omics fields are opt-in via `WorldConfig.omics`) is excluded, and a level whose
 * live-channel coverage falls under `MIN_COVERAGE` reads DORMANT, not ABSENT.
 * So a legacy run honestly reports "subatomic/organ-system substrate not wired"
 * rather than scoring it zero as if it had been tested and failed.
 *
 * Pure math, shared by any caller (web panel, research CLI, tests) so both draw
 * the same ladder for the same stream of stats.
 */

import type { SimStats } from './types.js';

/** Biological levels of organization, simple → complex. */
export type LifeLevelId = 'O0' | 'O1' | 'O2' | 'O3' | 'O4' | 'O5' | 'O6' | 'O7' | 'O8' | 'O9';

export type LifeStatus = 'EMERGENT' | 'PARTIAL' | 'ABSENT' | 'DORMANT';

/** One measured observable: exactly one numeric `SimStats` field. */
export interface LifeChannel {
  field: keyof SimStats;
  /** optional human label; defaults to the field name in reports */
  label?: string;
}

export interface LifeLevelDef {
  id: LifeLevelId;
  index: number;
  name: string;
  /** characteristic spatial scale (display only) */
  scale: string;
  rationale: string;
  channels: LifeChannel[];
  deps: LifeLevelId[];
}

const ch = (...fields: (keyof SimStats)[]): LifeChannel[] => fields.map((field) => ({ field }));

/**
 * O0..O9 in the user's required order. Each level's channels are the measured
 * observables that, together, evidence that scale of organization. Several
 * observables intentionally recur (e.g. `meanATP` at the molecular, organellar
 * and cellular tiers) because the same quantity is load-bearing at more than one
 * scale — the radar lets levels overlap their primitives the same way.
 */
export const LIFE_LEVELS: readonly LifeLevelDef[] = [
  {
    id: 'O0',
    index: 0,
    name: 'Subatomic / quantum',
    scale: '1e-18–1e-10 m',
    rationale: 'the folded-matter substrate reads out as quantum/subatomic structure (bosons, tunneling, coherence, confinement)',
    channels: ch(
      'bosonFieldIntensity',
      'photonTransport',
      'gluonConfinement',
      'strongCoupling',
      'weakBosonMass',
      'higgsMassFloor',
      'leptonMobility',
      'electronChannel',
      'quarkFlavorPopulation',
      'upDownAsymmetry',
      'protonStability',
      'coherenceLifetime',
      'tunnelingRate',
      'superpositionEntropy',
      'entanglementEntropy',
      'quantumFidelity',
      'coherenceLength',
    ),
    deps: [],
  },
  {
    id: 'O1',
    index: 1,
    name: 'Atomic / ionic',
    scale: '1e-10 m',
    rationale: 'elements and ions are distributed and buffered — the chemical elements have differentiated',
    channels: ch('chemicalDiversity', 'meanPH', 'terrainOxygen', 'terrainPH', 'terrainToxin'),
    deps: ['O0'],
  },
  {
    id: 'O2',
    index: 2,
    name: 'Molecular',
    scale: '1e-9 m',
    rationale: 'small molecules (glucose, ATP) and catalysts (enzymes) are synthesised and consumed on a metabolising budget',
    channels: ch(
      'meanGlucose',
      'meanATP',
      'meanEnzyme',
      'meanToxin',
      'meanProtein',
      'bondEnergy',
      'reactionEnthalpy',
      'activeSynthesisFraction',
    ),
    deps: ['O1'],
  },
  {
    id: 'O3',
    index: 3,
    name: 'Macromolecular (DNA/protein)',
    scale: '1e-9–1e-7 m',
    rationale: 'a heritable polymer (DNA integrity) is transcribed and translated into a folded proteome',
    channels: ch(
      'meanDNAIntegrity',
      'expressionEntropy',
      'transcriptActivity',
      'proteinDiversity',
      'proteomeLoad',
      'pathwayFlux',
      'fluxDiversity',
      'regulationGating',
      'nativeFraction',
      'foldStability',
      'libraryDiversity',
    ),
    deps: ['O2'],
  },
  {
    id: 'O4',
    index: 4,
    name: 'Organellar',
    scale: '1e-8–1e-6 m',
    rationale: 'compartmentalised machinery — a membrane potential, an ATP engine, and chaperone-managed folding',
    channels: ch(
      'meanMembranePot',
      'meanATP',
      'chaperoneLoad',
      'foldFidelity',
      'proteotoxicity',
      'enginePower',
      'heatWaste',
    ),
    deps: ['O3'],
  },
  {
    id: 'O5',
    index: 5,
    name: 'Cellular',
    scale: '1e-5 m',
    rationale: 'a bounded cell maintains itself and progresses a division cycle',
    channels: ch('meanDivisionProgress', 'meanMembranePot', 'activeSynthesisFraction', 'meanATP'),
    deps: ['O4'],
  },
  {
    id: 'O6',
    index: 6,
    name: 'Tissue / specialization',
    scale: '1e-3 m',
    rationale: 'cells differentiate into coexisting roles (trophic levels, species, spatial clusters)',
    channels: ch(
      'speciesCount',
      'biodiversityIndex',
      'meanTrophicLevel',
      'entropy',
      'diversity',
      'traitEffectiveDim',
      'symbioticIndex',
      'clusterCount',
      'clusterOrder',
    ),
    deps: ['O5'],
  },
  {
    id: 'O7',
    index: 7,
    name: 'Organ',
    scale: '1e-2 m',
    rationale: 'specialised cell groups form coherent, ordered anatomical aggregates',
    channels: ch('orgIndex', 'clusterOrder', 'rotationalOrder', 'metabolicRate'),
    deps: ['O6'],
  },
  {
    id: 'O8',
    index: 8,
    name: 'Organ system (loop/feedback)',
    scale: '1e-1 m',
    rationale: 'integrated subsystems — circulation, respiration, digestion, clearance, immunity, neural and endocrine signalling — each a closed loop',
    channels: ch(
      'cardiovascularPump',
      'respirationEfficiency',
      'digestiveThroughput',
      'excretoryClearance',
      'immuneSurveillance',
      'neuralConductance',
      'musculoskeletalOutput',
      'endocrineSignaling',
      'thermoregulationControl',
      'fluidHomeostasis',
      'sensoryPerception',
    ),
    deps: ['O7'],
  },
  {
    id: 'O9',
    index: 9,
    name: 'Organism',
    scale: '1 m',
    rationale: 'the subsystems integrate into one self-maintaining, reproducing, behaving whole',
    channels: ch(
      'growthReplication',
      'meanFitness',
      'cooperation',
      'speciesMemeMI',
      'meanPlasticity',
      'meanSurprise',
    ),
    deps: ['O8'],
  },
];

export const LIFE_LEVEL_IDS: readonly LifeLevelId[] = LIFE_LEVELS.map((l) => l.id);

// ---------------------------------------------------------------------------
// Raw input → ladder over time
// ---------------------------------------------------------------------------

/** One stats sample: the whole `SimStats` row at a tick. */
export interface LifeRaw {
  tick: number;
  stats: SimStats;
}

export interface LifePoint {
  tick: number;
  scores: Record<LifeLevelId, number>;
  status: Record<LifeLevelId, LifeStatus>;
  /** fraction of the level's channels whose substrate was live this run [0,1] */
  coverage: Record<LifeLevelId, number>;
  prereqsMet: Record<LifeLevelId, boolean>;
  /** online surprisal of change across all live channels (escape hatch) */
  novelty: number;
}

export interface LifeLevelSummary {
  id: LifeLevelId;
  name: string;
  scale: string;
  status: LifeStatus;
  finalScore: number;
  peakScore: number;
  coverage: number;
  /** first tick the level went EMERGENT (hysteretic), or null */
  onset: number | null;
  everEmergent: boolean;
  everMeasured: boolean;
}

export interface LifeSummary {
  n: number;
  levels: LifeLevelSummary[];
  /** highest-peaking EMERGENT level, else highest-peaking measured level */
  dominant: LifeLevelId | null;
  /** highest level ever EMERGENT (the run's "ceiling of organization") */
  ceiling: LifeLevelId | null;
  noveltyMean: number;
  noveltyPeak: { tick: number; value: number } | null;
}

// ---------------------------------------------------------------------------
// Thresholds & normalization
// ---------------------------------------------------------------------------

/** relative floor: a series whose span is < this share of its scale is "dead". */
const REL_FLOOR = 1e-3;
/** absolute floor: |value| at or below this everywhere means the channel is off. */
const ZERO_FLOOR = 1e-6;
/** a level needs this share of its channels wired before it is assayed at all. */
const MIN_COVERAGE = 0.25;

const ON = 0.6;
const OFF = 0.4;
const PARTIAL = 0.2;

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

interface ChanNorm {
  /** true when the observable's substrate is wired this run */
  live: boolean;
  /** per-sample normalized value, length = n (0 where not live) */
  norm: number[];
}

function normalize(vals: readonly number[]): ChanNorm {
  const dead = (): ChanNorm => ({ live: false, norm: vals.map(() => 0) });
  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  let count = 0;
  for (const v of vals) {
    if (!Number.isFinite(v)) continue;
    count++;
    sum += v;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (count === 0) return dead();
  const absMax = Math.max(Math.abs(min), Math.abs(max));
  if (absMax <= ZERO_FLOOR) return dead();
  const span = max - min;
  if (span <= REL_FLOOR * (Math.abs(min) + Math.abs(max)) + 1e-12) {
    // constant but present: the substrate is wired, just static this run
    return { live: true, norm: vals.map(() => 1) };
  }
  return { live: true, norm: vals.map((v) => (Number.isFinite(v) ? clamp01((v - min) / span) : 0)) };
}

function nextStatus(score: number | null, prev: LifeStatus): LifeStatus {
  if (score === null) return 'DORMANT';
  if (prev === 'EMERGENT') return score >= OFF ? 'EMERGENT' : score >= PARTIAL ? 'PARTIAL' : 'ABSENT';
  if (score >= ON) return 'EMERGENT';
  if (score >= PARTIAL) return 'PARTIAL';
  return 'ABSENT';
}

function median(vals: readonly number[]): number {
  if (vals.length === 0) return 0;
  const sorted = [...vals].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function mean(vals: readonly number[]): number {
  if (vals.length === 0) return 0;
  let s = 0;
  for (const v of vals) s += v;
  return s / vals.length;
}

/** online surprisal of change across every live channel (run-relative). */
function noveltySeries(norms: readonly number[][], n: number): number[] {
  if (n === 0) return [];
  if (norms.length === 0) return new Array(n).fill(0);
  const zs: number[][] = norms.map((raw) => {
    const d = raw.map((v, i) => (i === 0 ? 0 : v - raw[i - 1]));
    const abs = d.map((v) => Math.abs(v));
    const scale = median(abs) || mean(abs);
    return abs.map((v) => (scale > 0 ? v / scale : 0));
  });
  const K = 3;
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    let ss = 0;
    for (const z of zs) ss += z[i] * z[i];
    out.push(clamp01(Math.sqrt(ss / norms.length) / K));
  }
  return out;
}

/**
 * Map a run of `SimStats` samples into the organization ladder over time.
 * Deterministic and pure: identical input streams give identical ladders.
 */
export function lifeSeries(raws: readonly LifeRaw[]): LifePoint[] {
  const n = raws.length;
  const fields = new Set<keyof SimStats>();
  for (const def of LIFE_LEVELS) for (const c of def.channels) fields.add(c.field);

  const norm = new Map<keyof SimStats, ChanNorm>();
  for (const f of fields) {
    norm.set(f, normalize(raws.map((r) => r.stats[f])));
  }
  const liveNorms: number[][] = [];
  for (const f of fields) {
    const cn = norm.get(f)!;
    if (cn.live) liveNorms.push(cn.norm);
  }
  const novelty = noveltySeries(liveNorms, n);

  const prev = new Map<LifeLevelId, LifeStatus>();
  const points: LifePoint[] = [];
  for (let i = 0; i < n; i++) {
    const scores = {} as Record<LifeLevelId, number>;
    const status = {} as Record<LifeLevelId, LifeStatus>;
    const coverage = {} as Record<LifeLevelId, number>;
    const prereqsMet = {} as Record<LifeLevelId, boolean>;

    for (const def of LIFE_LEVELS) {
      let sum = 0;
      let live = 0;
      for (const c of def.channels) {
        const cn = norm.get(c.field)!;
        if (cn.live) {
          sum += cn.norm[i];
          live++;
        }
      }
      const cov = def.channels.length > 0 ? live / def.channels.length : 0;
      coverage[def.id] = cov;
      const score = live > 0 && cov >= MIN_COVERAGE ? sum / live : null;
      scores[def.id] = score ?? 0;
      const st = nextStatus(score, prev.get(def.id) ?? 'ABSENT');
      status[def.id] = st;
      prev.set(def.id, st);
    }

    for (const def of LIFE_LEVELS) {
      prereqsMet[def.id] = def.deps.every((d) => status[d] === 'EMERGENT' || status[d] === 'PARTIAL');
    }

    points.push({ tick: raws[i].tick, scores, status, coverage, prereqsMet, novelty: novelty[i] });
  }
  return points;
}

/** Onsets, peaks, coverage and the run's dominant level / organization ceiling. */
export function summarizeLife(points: readonly LifePoint[]): LifeSummary {
  const n = points.length;
  const levels: LifeLevelSummary[] = LIFE_LEVELS.map((def) => ({
    id: def.id,
    name: def.name,
    scale: def.scale,
    status: 'ABSENT' as LifeStatus,
    finalScore: 0,
    peakScore: 0,
    coverage: 0,
    onset: null,
    everEmergent: false,
    everMeasured: false,
  }));
  const byId = new Map(levels.map((l) => [l.id, l]));

  let noveltySum = 0;
  let noveltyPeak: { tick: number; value: number } | null = null;

  for (const p of points) {
    for (const def of LIFE_LEVELS) {
      const l = byId.get(def.id)!;
      const s = p.scores[def.id];
      const st = p.status[def.id];
      l.finalScore = s;
      l.status = st;
      l.coverage = p.coverage[def.id];
      if (s > l.peakScore) l.peakScore = s;
      if (st !== 'DORMANT') l.everMeasured = true;
      if (st === 'EMERGENT') {
        l.everEmergent = true;
        if (l.onset === null) l.onset = p.tick;
      }
    }
    noveltySum += p.novelty;
    if (noveltyPeak === null || p.novelty > noveltyPeak.value) {
      noveltyPeak = { tick: p.tick, value: p.novelty };
    }
  }

  // dominant / ceiling prefer well-assayed levels: a level whose substrate is
  // only 1-of-N channels wired may peak from a single observable, so it must not
  // out-rank a genuinely multi-channel level. Fall back progressively so a run
  // still names *something*.
  let dominant: LifeLevelId | null = null;
  let best = -Infinity;
  let ceiling: LifeLevelId | null = null;
  if (n > 0) {
    for (const l of levels) {
      if (!l.everEmergent || l.coverage < 0.5) continue;
      ceiling = l.id;
      if (l.peakScore > best) {
        best = l.peakScore;
        dominant = l.id;
      }
    }
    if (dominant === null) {
      for (const l of levels) {
        if (!l.everEmergent) continue;
        ceiling = l.id;
        if (l.peakScore > best) {
          best = l.peakScore;
          dominant = l.id;
        }
      }
    }
    if (dominant === null) {
      for (const l of levels) {
        if (l.peakScore > best) {
          best = l.peakScore;
          dominant = l.id;
        }
      }
    }
  }

  return {
    n,
    levels,
    dominant,
    ceiling,
    noveltyMean: n > 0 ? noveltySum / n : 0,
    noveltyPeak,
  };
}

export { MIN_COVERAGE as LIFE_MIN_COVERAGE, ON as LIFE_ON, OFF as LIFE_OFF, PARTIAL as LIFE_PARTIAL };
