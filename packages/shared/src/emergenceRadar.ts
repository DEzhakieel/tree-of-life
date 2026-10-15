/**
 * Emergence radar: reads a run's raw observables into a vector of
 * first-principles *primitives*, then composes those primitives into an
 * ordered ladder of capability *levels* (L0 Particle ... L10 Artificial
 * ecosystem).
 *
 * Design (see METHOD): the levels are NOT hard-coded outcomes and are NOT
 * flags an engine sets about itself. Each level is a pure conjunction of
 * lower-level primitives:
 *
 *     primitives (measured) ──compose──> level score ∈ [0,1] ──threshold──> status
 *
 * Nothing about a level is asserted unless the measurement substrate actually
 * carries it (a grid with no signal field cannot report communication — the
 * level reads DORMANT, not ABSENT). This is what makes the radar a detector
 * rather than a scoreboard.
 *
 * Two disciplines are carried over from the emergence atlas so the numbers
 * stay honest:
 *
 *   - Run-relative stretching. Absolute scales saturate in practice, so each
 *     primitive is min-max stretched across *this run's own envelope*, with a
 *     relative floor that keeps a dead/constant sensor from steering a level.
 *     Compare trajectory shapes and onsets, not absolute scores across runs.
 *   - Hysteresis. Onset is when a level crosses ON and stays there; it only
 *     falls back below OFF, so a single noisy frame cannot flicker a level.
 *
 * `noveltyResidual` is the escape hatch: an online surprisal of change across
 * all measured primitives, so a perceivable change that no detector names
 * still registers. It is deliberately run-relative (a jump is judged against
 * the run's own typical jumps).
 *
 * Pure math, shared by the live web panel and the research CLI so both draw
 * the same ladder for the same seed.
 */

import type { SimStats } from './types.js';

/** First-principles capabilities an engine world can exhibit. */
export type PrimitiveId =
  | 'matterFlux'
  | 'homeostasis'
  | 'feedback'
  | 'memoryUpdate'
  | 'heredity'
  | 'selection'
  | 'copyFidelity'
  | 'infoTransfer'
  | 'culture'
  | 'integration'
  | 'novelty'
  | 'richness';

export type LevelId = 'L0' | 'L1' | 'L2' | 'L3' | 'L4' | 'L5' | 'L6' | 'L7' | 'L8' | 'L9' | 'L10';

export type LevelStatus = 'EMERGENT' | 'PARTIAL' | 'ABSENT' | 'DORMANT';

export const PRIMITIVE_IDS: readonly PrimitiveId[] = [
  'matterFlux',
  'homeostasis',
  'feedback',
  'memoryUpdate',
  'heredity',
  'selection',
  'copyFidelity',
  'infoTransfer',
  'culture',
  'integration',
  'novelty',
  'richness',
];

/** Human-facing primitive catalogue (labels / one-line rationale for the UI). */
export const PRIMITIVES: Record<PrimitiveId, { label: string; description: string }> = {
  matterFlux: { label: 'Matter & energy flux', description: 'throughput of food, meat and mineral matter' },
  homeostasis: { label: 'Homeostasis', description: 'self-maintained internal energy/water budget' },
  feedback: { label: 'State→action feedback', description: 'movement is steered by the sensed environment' },
  memoryUpdate: { label: 'Within-lifetime memory', description: 'synapses drift from the genome template (learning)' },
  heredity: { label: 'Heredity', description: 'heritable trait variation transmitted to offspring' },
  selection: { label: 'Differential reproduction', description: 'Price-equation selection on heritable traits' },
  copyFidelity: { label: 'Copy fidelity', description: 'DNA integrity surviving replication' },
  infoTransfer: { label: 'Information transfer', description: 'signal matter deposited and read between agents' },
  culture: { label: 'Non-genetic transmission', description: 'meme-tag diversity and meme↔species mutual information' },
  integration: { label: 'Super-additivity', description: 'collective coupling beyond independent agents' },
  novelty: { label: 'Open-ended novelty', description: 'new species/discoveries keep appearing' },
  richness: { label: 'Ecological richness', description: 'coexisting niches / biodiversity' },
};

/** A level is a conjunction of primitives, with named dependencies for display. */
export interface LevelDef {
  id: LevelId;
  index: number;
  name: string;
  rationale: string;
  primitives: PrimitiveId[];
  deps: LevelId[];
  /** faculty whose removal must collapse this detector (ablation key). */
  ablation: string;
}

/**
 * L0..L10 in the user's required display order. Prerequisites are reported
 * from evidence per-detector; they are not enforced by the numbering.
 */
export const LEVELS: readonly LevelDef[] = [
  {
    id: 'L0',
    index: 0,
    name: 'Particle',
    rationale: 'matter and energy exist and move through the world',
    primitives: ['matterFlux'],
    deps: [],
    ablation: 'world',
  },
  {
    id: 'L1',
    index: 1,
    name: 'Agent',
    rationale: 'an individual maintains itself against the flux',
    primitives: ['matterFlux', 'homeostasis'],
    deps: ['L0'],
    ablation: 'spawn',
  },
  {
    id: 'L2',
    index: 2,
    name: 'Adaptive agent',
    rationale: 'the agent senses its environment and acts back on it',
    primitives: ['homeostasis', 'feedback'],
    deps: ['L1'],
    ablation: 'reflex',
  },
  {
    id: 'L3',
    index: 3,
    name: 'Learning agent',
    rationale: 'within a lifetime, memory changes the mapping from state to action',
    primitives: ['feedback', 'memoryUpdate'],
    deps: ['L2'],
    ablation: 'brain',
  },
  {
    id: 'L4',
    index: 4,
    name: 'Ecosystem',
    rationale: 'many self-maintaining agents, ecologically differentiated, selected among',
    primitives: ['homeostasis', 'richness', 'selection'],
    deps: ['L1'],
    ablation: 'monoculture',
  },
  {
    id: 'L5',
    index: 5,
    name: 'Evolution',
    rationale: 'heritable variation is differentially reproduced',
    primitives: ['heredity', 'selection'],
    deps: ['L4'],
    ablation: 'clonal',
  },
  {
    id: 'L6',
    index: 6,
    name: 'Self-replication',
    rationale: 'the heritable machinery copies itself with controlled fidelity',
    primitives: ['heredity', 'copyFidelity'],
    deps: ['L5'],
    ablation: 'no-birth',
  },
  {
    id: 'L7',
    index: 7,
    name: 'Communication',
    rationale: 'information deposited by one agent is available to another',
    primitives: ['infoTransfer'],
    deps: ['L2'],
    ablation: 'signal-zero',
  },
  {
    id: 'L8',
    index: 8,
    name: 'Culture',
    rationale: 'non-genetic tags spread and correlate with lineages',
    primitives: ['culture', 'infoTransfer'],
    deps: ['L7'],
    ablation: 'meme-zero',
  },
  {
    id: 'L9',
    index: 9,
    name: 'Collective intelligence',
    rationale: 'group behaviour is super-additive: integration beyond independent agents',
    primitives: ['integration', 'feedback'],
    deps: ['L7'],
    ablation: 'group-scaling',
  },
  {
    id: 'L10',
    index: 10,
    name: 'Artificial ecosystem',
    rationale: 'matter cycles through a rich world that keeps producing novelty',
    primitives: ['matterFlux', 'richness', 'novelty'],
    deps: ['L4', 'L6'],
    ablation: 'open-ended',
  },
];

export const LEVEL_IDS: readonly LevelId[] = LEVELS.map((l) => l.id);

// ---------------------------------------------------------------------------
// Raw input: what an engine (WASM or TS) can hand the detector at each sample.
// Every field is optional; a missing substrate makes the levels that depend on
// it read DORMANT rather than ABSENT.
// ---------------------------------------------------------------------------

export interface RadarTerrain {
  /** per-cell fields, row-major, length = size * size */
  food: ArrayLike<number>;
  meat: ArrayLike<number>;
  minerals: ArrayLike<number>;
  signal: ArrayLike<number>;
}

export interface RadarAgent {
  id: number;
  x: number;
  y: number;
  species: number;
  alive: boolean;
  /** velocity, when the engine exposes it (enables state→action feedback) */
  vx?: number;
  vy?: number;
  /** lineage linkage, when available */
  parentId?: number;
  /** heritable genome, when available */
  genome?: ArrayLike<number>;
  /** cultural tag */
  meme?: number;
}

export interface RadarRaw {
  tick: number;
  stats: SimStats;
  terrain?: RadarTerrain;
  agents?: readonly RadarAgent[];
}

/** One sample's measured primitives. `measured` records which were available. */
export interface RadarSample {
  tick: number;
  primitives: Partial<Record<PrimitiveId, number>>;
  measured: PrimitiveId[];
}

export interface RadarPoint {
  tick: number;
  scores: Record<LevelId, number>;
  status: Record<LevelId, LevelStatus>;
  prereqsMet: Record<LevelId, boolean>;
  novelty: number;
}

export interface LevelSummary {
  id: LevelId;
  name: string;
  /** status at the end of the run */
  status: LevelStatus;
  finalScore: number;
  peakScore: number;
  /** first tick the level went EMERGENT (hysteretic), or null */
  onset: number | null;
  everEmergent: boolean;
  everMeasured: boolean;
}

export interface RadarSummary {
  n: number;
  levels: LevelSummary[];
  /** highest-peaking level that ever went EMERGENT, else highest-peaking overall */
  dominant: LevelId | null;
  noveltyMean: number;
  noveltyPeak: { tick: number; value: number } | null;
}

// ---------------------------------------------------------------------------
// Thresholds & normalization
// ---------------------------------------------------------------------------

/**
 * Relative floor: a series whose span is < this share of its scale is treated as
 * a dead sensor (constant substrate). Set at 0.1% so a merely near-constant
 * background (e.g. an agent-less world's slowly settling terrain) reads dead,
 * while genuine within-run dynamics stay live — this is what lets substrate
 * ablations collapse their detector instead of self-normalizing to full range.
 */
const REL_FLOOR = 1e-3;

const ON = 0.6;
const OFF = 0.4;
const PARTIAL = 0.2;

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** min-max stretch across a run's own envelope; null when the sensor is dead. */
function stretch(vals: readonly number[]): number[] | null {
  let min = Infinity;
  let max = -Infinity;
  for (const v of vals) {
    if (!Number.isFinite(v)) continue;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (!Number.isFinite(min)) return null;
  const span = max - min;
  if (span <= REL_FLOOR * (Math.abs(min) + Math.abs(max)) + 1e-12) return null;
  return vals.map((v) => (Number.isFinite(v) ? clamp01((v - min) / span) : 0));
}

// ---------------------------------------------------------------------------
// Primitive extraction
// ---------------------------------------------------------------------------

function sumField(field: ArrayLike<number> | undefined): number {
  if (!field) return 0;
  let s = 0;
  for (let i = 0; i < field.length; i++) {
    const v = field[i]!;
    if (Number.isFinite(v)) s += v;
  }
  return s;
}

function hasField(field: ArrayLike<number> | undefined): boolean {
  return field !== undefined && field.length > 0;
}

/** mean cosine between agent velocity and the local food gradient (foraging). */
function feedbackScore(terrain: RadarTerrain, agents: readonly RadarAgent[]): number | undefined {
  const n = terrain.food.length;
  const size = Math.round(Math.sqrt(n));
  if (size < 2 || size * size !== n) return undefined;
  let acc = 0;
  let count = 0;
  for (const a of agents) {
    if (!a.alive) continue;
    if (!Number.isFinite(a.vx) || !Number.isFinite(a.vy)) continue;
    const speed = Math.hypot(a.vx!, a.vy!);
    if (speed < 1e-6) continue;
    const gx = Math.floor(a.x);
    const gy = Math.floor(a.y);
    if (gx < 1 || gy < 1 || gx >= size - 1 || gy >= size - 1) continue;
    const idx = (x: number, y: number) => y * size + x;
    const gdx = terrain.food[idx(gx + 1, gy)]! - terrain.food[idx(gx - 1, gy)]!;
    const gdy = terrain.food[idx(gx, gy + 1)]! - terrain.food[idx(gx, gy - 1)]!;
    const gmag = Math.hypot(gdx, gdy);
    if (gmag < 1e-9) continue;
    acc += (a.vx! * gdx + a.vy! * gdy) / (speed * gmag);
    count += 1;
  }
  return count > 0 ? acc / count : undefined;
}

/** mean pairwise normalized L1 genome distance (heritable variation). */
function heredityScore(agents: readonly RadarAgent[]): number | undefined {
  const genomes: ArrayLike<number>[] = [];
  for (const a of agents) {
    if (!a.alive || !a.genome || a.genome.length === 0) continue;
    genomes.push(a.genome);
  }
  if (genomes.length < 2) return undefined;
  let acc = 0;
  let pairs = 0;
  const cap = 64; // keep the primitive O(cap^2) at radar cadence
  const m = Math.min(genomes.length, cap);
  for (let i = 0; i < m; i++) {
    const gi = genomes[i]!;
    for (let j = i + 1; j < m; j++) {
      const gj = genomes[j]!;
      const len = Math.min(gi.length, gj.length);
      let d = 0;
      for (let k = 0; k < len; k++) d += Math.abs(gi[k]! - gj[k]!);
      acc += len > 0 ? d / len : 0;
      pairs += 1;
    }
  }
  return pairs > 0 ? acc / pairs : undefined;
}

/**
 * Mean parent→child genome similarity (1 - normalized L1 distance) over every
 * agent whose parent is present. High when replication copies faithfully; low
 * when mutation scrambles offspring. Used to measure copy fidelity on engines
 * that do not expose a DNA-integrity stat. Before any replication has occurred
 * the template is pristine, so a live-but-childless population reads 1 (which
 * keeps the primitive measurable and lets a no-birth ablation make it constant).
 */
function copyFidelityScore(agents: readonly RadarAgent[]): number | undefined {
  const byId = new Map<number, ArrayLike<number>>();
  for (const a of agents) {
    if (a.genome && a.genome.length > 0) byId.set(a.id, a.genome);
  }
  let acc = 0;
  let pairs = 0;
  for (const a of agents) {
    if (a.parentId === undefined || a.parentId === null || a.parentId < 0) continue;
    const g = a.genome;
    const p = byId.get(a.parentId);
    if (!g || !p || g.length === 0 || p.length === 0) continue;
    const len = Math.min(g.length, p.length);
    if (len === 0) continue;
    let d = 0;
    for (let k = 0; k < len; k++) d += Math.abs(g[k]! - p[k]!);
    acc += 1 - d / len;
    pairs += 1;
  }
  if (pairs > 0) return acc / pairs;
  return agents.some((a) => a.alive) ? 1 : undefined;
}

/** Extract the primitive vector for one raw sample. */
export function computePrimitives(raw: RadarRaw): RadarSample {
  const stats = raw.stats;
  const terrain = raw.terrain;
  const agents = raw.agents ?? [];
  const primitives: Partial<Record<PrimitiveId, number>> = {};
  const measured: PrimitiveId[] = [];

  const put = (id: PrimitiveId, value: number | undefined): void => {
    if (value === undefined || !Number.isFinite(value)) return;
    primitives[id] = value;
    measured.push(id);
  };

  // P1 matter & energy flux — total matter present (food + meat + minerals).
  if (terrain && (hasField(terrain.food) || hasField(terrain.meat) || hasField(terrain.minerals))) {
    put('matterFlux', sumField(terrain.food) + sumField(terrain.meat) + sumField(terrain.minerals));
  }

  // P2 homeostasis — self-maintained internal budget. Measured from stats even
  // when the population is dead (a dead world reads 0 → ABSENT, not DORMANT).
  if (Number.isFinite(stats.avgEnergy) && Number.isFinite(stats.avgWater)) {
    put('homeostasis', Math.max(0, stats.avgEnergy) + Math.max(0, stats.avgWater));
  }

  // P3 state→action feedback — movement tracks the sensed food gradient.
  if (terrain && agents.length > 0) {
    put('feedback', feedbackScore(terrain, agents));
  }

  // P4 within-lifetime memory — plastic-brain drift from the genome template.
  if (Number.isFinite(stats.meanPlasticity) && Number.isFinite(stats.meanSurprise)) {
    put(
      'memoryUpdate',
      Math.max(0, stats.meanPlasticity) + Math.max(0, stats.meanSurprise) + Math.max(0, stats.plasticAgents),
    );
  }

  // P5 heredity — heritable trait variation among the living.
  if (agents.length > 0) {
    put('heredity', heredityScore(agents));
  }

  // P6 differential reproduction — strength of selection on heritable traits.
  // The Price-equation term is 0 on the WASM path, so the live fitness
  // inequality (Gini of acquired energy) carries the signal.
  {
    let sel = 0;
    let got = false;
    if (Number.isFinite(stats.priceEquationSelection)) {
      sel += Math.abs(stats.priceEquationSelection);
      got = true;
    }
    if (Number.isFinite(stats.energyInequality)) {
      sel = Math.max(sel, Math.max(0, stats.energyInequality));
      got = true;
    }
    if (got) put('selection', sel);
  }

  // P7 copy fidelity — DNA integrity surviving replication, or (when the engine
  // does not expose it) the parent→child genome similarity of the living.
  {
    let fidelity: number | undefined;
    if (Number.isFinite(stats.meanDNAIntegrity) && stats.meanDNAIntegrity > 0) {
      fidelity = stats.meanDNAIntegrity;
    } else {
      fidelity = copyFidelityScore(agents);
    }
    put('copyFidelity', fidelity);
  }

  // P8 information transfer — signal matter deposited into the field.
  if (terrain && hasField(terrain.signal)) {
    put('infoTransfer', sumField(terrain.signal));
  }

  // P9 non-genetic transmission — cultural tags and their lineage coupling.
  if (Number.isFinite(stats.cultureCount) && Number.isFinite(stats.memeEntropy) && Number.isFinite(stats.speciesMemeMI)) {
    put('culture', Math.max(0, stats.cultureCount) + Math.max(0, stats.memeEntropy) + Math.max(0, stats.speciesMemeMI));
  }

  // P10 integration — collective coupling beyond independent agents.
  if (Number.isFinite(stats.cooperation) && Number.isFinite(stats.speciesMemeMI)) {
    put('integration', Math.max(0, stats.cooperation) + Math.max(0, stats.speciesMemeMI));
  }

  // P11 open-ended novelty — new species/discoveries keep appearing. The
  // speciation counter is 0 on the WASM path, so the live discovery novelty
  // (noveltyMean) carries the term when the discovery subsystem is enabled.
  {
    let nov = 0;
    let got = false;
    if (Number.isFinite(stats.speciationRate)) {
      nov += Math.max(0, stats.speciationRate);
      got = true;
    }
    if (Number.isFinite(stats.discoveryRate)) {
      nov += Math.max(0, stats.discoveryRate);
      got = true;
    }
    if (Number.isFinite(stats.noveltyMean)) {
      nov += Math.max(0, stats.noveltyMean);
      got = true;
    }
    if (got) put('novelty', nov);
  }

  // Ecological richness — coexisting niches. speciesCount alone is thin, so add
  // the live abundance-diversity terms (entropy / Simpson) alongside biodiversity.
  {
    let rich: number | undefined;
    if (Number.isFinite(stats.speciesCount)) {
      rich = Math.max(0, stats.speciesCount);
      if (Number.isFinite(stats.entropy)) rich += Math.max(0, stats.entropy);
      if (Number.isFinite(stats.diversity)) rich += Math.max(0, stats.diversity);
      if (Number.isFinite(stats.biodiversityIndex)) rich += Math.max(0, stats.biodiversityIndex);
    }
    put('richness', rich);
  }

  return { tick: raw.tick, primitives, measured };
}

// ---------------------------------------------------------------------------
// Series → radar points
// ---------------------------------------------------------------------------

interface NormContext {
  norm: Partial<Record<PrimitiveId, number[]>>;
  available: Set<PrimitiveId>;
}

function buildContext(samples: readonly RadarSample[]): NormContext {
  const available = new Set<PrimitiveId>();
  for (const p of PRIMITIVE_IDS) {
    if (
      samples.length > 0 &&
      samples.every((s) => s.measured.includes(p) && Number.isFinite(s.primitives[p]))
    ) {
      available.add(p);
    }
  }
  const norm: Partial<Record<PrimitiveId, number[]>> = {};
  for (const p of available) {
    const vals = samples.map((s) => s.primitives[p]!);
    norm[p] = stretch(vals) ?? vals.map(() => 0);
  }
  return { norm, available };
}

function levelScore(def: LevelDef, i: number, ctx: NormContext): number | null {
  let sum = 0;
  for (const p of def.primitives) {
    if (!ctx.available.has(p)) return null;
    sum += ctx.norm[p]![i]!;
  }
  return sum / def.primitives.length;
}

function nextStatus(score: number | null, prev: LevelStatus): LevelStatus {
  if (score === null) return 'DORMANT';
  if (prev === 'EMERGENT') return score >= OFF ? 'EMERGENT' : score >= PARTIAL ? 'PARTIAL' : 'ABSENT';
  if (score >= ON) return 'EMERGENT';
  if (score >= PARTIAL) return 'PARTIAL';
  return 'ABSENT';
}

/**
 * Online surprisal of change across all primitives common to the run: the
 * absolute first difference, robustly scaled (MAD), root-mean-squared across
 * primitives and clamped. A feature distribution shift that no level detector
 * names still raises this — the radar's escape hatch. Run-relative by design.
 */
export function noveltyResidual(samples: readonly RadarSample[]): number[] {
  const n = samples.length;
  if (n === 0) return [];
  const feats = PRIMITIVE_IDS.filter((p) =>
    samples.every((s) => s.measured.includes(p) && Number.isFinite(s.primitives[p])),
  );
  if (feats.length === 0) return new Array(n).fill(0);

  const zs: number[][] = feats.map((p) => {
    const raw = samples.map((s) => s.primitives[p]!);
    const d = raw.map((v, i) => (i === 0 ? 0 : v - raw[i - 1]!));
    const abs = d.map((v) => Math.abs(v));
    // robust scale, with a mean fallback for stepped data (median collapses
    // to 0 when most consecutive samples are unchanged, hiding the jump)
    const scale = median(abs) || mean(abs);
    return abs.map((v) => (scale > 0 ? v / scale : 0));
  });

  const K = 3;
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    let ss = 0;
    for (const z of zs) {
      const v = z[i]!;
      ss += v * v;
    }
    out.push(clamp01(Math.sqrt(ss / feats.length) / K));
  }
  return out;
}

function median(vals: readonly number[]): number {
  if (vals.length === 0) return 0;
  const sorted = [...vals].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function mean(vals: readonly number[]): number {
  if (vals.length === 0) return 0;
  let s = 0;
  for (const v of vals) s += v;
  return s / vals.length;
}

/** Map a run of primitive samples into the capability ladder over time. */
export function radarSeries(samples: readonly RadarSample[]): RadarPoint[] {
  const ctx = buildContext(samples);
  const novelty = noveltyResidual(samples);
  const prev = new Map<LevelId, LevelStatus>();
  const points: RadarPoint[] = [];

  for (let i = 0; i < samples.length; i++) {
    const scores = {} as Record<LevelId, number>;
    const status = {} as Record<LevelId, LevelStatus>;
    const prereqsMet = {} as Record<LevelId, boolean>;

    for (const def of LEVELS) {
      const s = levelScore(def, i, ctx);
      scores[def.id] = s ?? 0;
      const st = nextStatus(s, prev.get(def.id) ?? 'ABSENT');
      status[def.id] = st;
      prev.set(def.id, st);
    }

    // prerequisites are reported from the *previously computed* statuses
    for (const def of LEVELS) {
      prereqsMet[def.id] = def.deps.every((d) => {
        const st = status[d];
        return st === 'EMERGENT' || st === 'PARTIAL';
      });
    }

    points.push({ tick: samples[i]!.tick, scores, status, prereqsMet, novelty: novelty[i]! });
  }
  return points;
}

/** Onsets, peaks and the run's dominant capability. */
export function summarizeRadar(points: readonly RadarPoint[]): RadarSummary {
  const n = points.length;
  const levels: LevelSummary[] = LEVELS.map((def) => ({
    id: def.id,
    name: def.name,
    status: 'ABSENT' as LevelStatus,
    finalScore: 0,
    peakScore: 0,
    onset: null,
    everEmergent: false,
    everMeasured: false,
  }));
  const byId = new Map(levels.map((l) => [l.id, l]));

  let noveltySum = 0;
  let noveltyPeak: { tick: number; value: number } | null = null;

  for (const p of points) {
    for (const def of LEVELS) {
      const l = byId.get(def.id)!;
      const s = p.scores[def.id];
      const st = p.status[def.id];
      l.finalScore = s;
      l.status = st;
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

  let dominant: LevelId | null = null;
  let best = -Infinity;
  if (n > 0) {
    for (const l of levels) {
      if (!l.everEmergent) continue;
      if (l.peakScore > best) {
        best = l.peakScore;
        dominant = l.id;
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
    noveltyMean: n > 0 ? noveltySum / n : 0,
    noveltyPeak,
  };
}
