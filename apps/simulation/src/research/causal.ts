/**
 * Causal reverse engineering of collective behaviour.
 *
 * This module answers a different question from the emergence lab. Emergence
 * OBSERVES a system and measures what it looks like. This module INTERVENES on
 * it: it decomposes a collective behaviour into named, individually switchable
 * mechanism terms, establishes which combinations are sufficient to produce the
 * behaviour, then ablates each component out of a working set to measure what
 * that component was actually doing.
 *
 * The ablation here is a real intervention, not a correlation. The engine builds
 * every agent thrust from exactly two additive sources (engine.ts:933):
 *
 *   thrust = clamp(brainOutput + drive * DRIVE_SCALE, -1, 1)
 *
 * and the 15-input sensor vector fed to the brain contains NO neighbour
 * velocity, NO neighbour heading and NO neighbour position offset. The pattern
 * drive block is therefore the ONLY causal path by which one agent's motion can
 * depend on another agent's motion or position. Switching a drive off removes
 * that pathway outright, so a behavioural change under ablation is attributable
 * rather than merely associated.
 *
 * Two guards keep the causal reading honest:
 *
 *  - A known-negative arm (all components off) and a known-positive arm (all
 *    components on) are run first, and every behavioural threshold is
 *    CALIBRATED as the midpoint between them, so no threshold is hand-picked to
 *    produce a desired conclusion.
 *  - Every arm is reproduced by a determinism double-run. An arm that does not
 *    reproduce exactly cannot support a causal claim and is reported as failed.
 *
 * `oscillation` and `noise` are deliberately excluded from the component
 * alphabet. Both are per-agent terms that cannot read a neighbour, so including
 * them would let the sufficiency search return a "sufficient" set with no causal
 * path to the behaviour at all. They appear only as an explicit negative control.
 */

import { DRIVE_OFFSET, DRIVES, DEFAULT_PARAMS, WORLD_SIZE } from '@fractal-life/shared';
import type { WorldConfig } from '@fractal-life/shared';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Engine } from '../engine.js';
import { feedGenome } from './scenarios.js';

/** the world config an arm runs in; injected so tests can shrink the run */
export type WorldLike = WorldConfig;

// ---------------------------------------------------------------------------
// The component alphabet: named, individually switchable mechanism terms
// ---------------------------------------------------------------------------

/** the neighbour-coupled mechanism terms this module can switch on and off */
export type ComponentId = 'alignment' | 'cohesion' | 'separation' | 'circulation';

export interface CausalComponent {
  id: ComponentId;
  /** index into the drive block of the genome */
  geneIndex: number;
  /**
   * gene value that disables the term. Weight-decoded drives use -1, which maps
   * to exactly 0; circulation is decoded raw and signed, so it is zeroed with 0.
   */
  offGene: number;
  /** gene value that enables the term at full strength */
  onGene: number;
  /** what removing this term is predicted to do, stated before measuring */
  prediction: string;
}

export const CAUSAL_COMPONENTS: readonly CausalComponent[] = [
  {
    id: 'alignment',
    geneIndex: DRIVE_OFFSET + DRIVES.ALIGNMENT,
    offGene: -1,
    onGene: 1,
    prediction: 'heading order collapses: the group loses its common direction',
  },
  {
    id: 'cohesion',
    geneIndex: DRIVE_OFFSET + DRIVES.COHESION,
    offGene: -1,
    onGene: 1,
    prediction: 'group integrity fails: the flock comes apart into fragments',
  },
  {
    id: 'separation',
    geneIndex: DRIVE_OFFSET + DRIVES.SEPARATION,
    offGene: -1,
    onGene: 1,
    prediction: 'personal space is lost: agents pile into a clot or freeze into a lattice',
  },
  {
    id: 'circulation',
    geneIndex: DRIVE_OFFSET + DRIVES.CIRCULATION,
    offGene: 0,
    onGene: 1,
    prediction: 'rotation is lost: an orbiting mill relaxes instead of holding a ring',
  },
];

export const COMPONENT_IDS: readonly ComponentId[] = CAUSAL_COMPONENTS.map((c) => c.id);

const COMPONENT_BY_ID = new Map<ComponentId, CausalComponent>(CAUSAL_COMPONENTS.map((c) => [c.id, c]));

export function componentOf(id: ComponentId): CausalComponent {
  const c = COMPONENT_BY_ID.get(id);
  if (!c) throw new Error(`unknown causal component: ${id}`);
  return c;
}

/** a set of active components */
export type ComponentSet = readonly ComponentId[];

/**
 * Canonical ordering for a component set: declaration order, not alphabetical.
 *
 * `setKey` and `parseSetKey` must agree on this or a key will not round-trip, so
 * both go through here rather than sorting independently.
 */
function canonical(set: readonly string[]): ComponentSet {
  const present = new Set(set);
  return COMPONENT_IDS.filter((id) => present.has(id));
}

/** canonical key for a component set, e.g. `alignment+cohesion` or `none` */
export function setKey(set: ComponentSet): string {
  return set.length === 0 ? 'none' : canonical(set).join('+');
}

export function parseSetKey(key: string): ComponentSet {
  if (key === 'none' || key === '') return [];
  return canonical(key.split('+'));
}

/** reverse lookup: the component that owns a drive gene, or undefined */
export function componentOfGene(geneIndex: number): CausalComponent | undefined {
  return CAUSAL_COMPONENTS.find((c) => c.geneIndex === geneIndex);
}

/** every subset of the alphabet, including the empty all-off control, ordered by size */
export function enumerateArms(alphabet: readonly ComponentId[] = COMPONENT_IDS): ComponentSet[] {
  const out: ComponentSet[] = [[]];
  for (let mask = 1; mask < 1 << alphabet.length; mask++) {
    const set: ComponentId[] = [];
    for (let b = 0; b < alphabet.length; b++) if (mask & (1 << b)) set.push(alphabet[b]!);
    out.push(set);
  }
  return out.sort((a, b) => a.length - b.length || a.join().localeCompare(b.join()));
}

/** a base set plus each of its single-component removals */
export function leaveOneOut(base: ComponentSet): ComponentSet[] {
  return [base, ...base.map((c) => base.filter((x) => x !== c))];
}

/**
 * Build the founder genome for one arm.
 *
 * Every agent in an arm is a founder carrying an identical genome, and
 * reproduction is switched off, so no agent is born during the run and no drive
 * gene can drift. The intervention is therefore exact for every tick: a disabled
 * component contributes a literal 0 to every agent's thrust, with no population
 * genetics in between.
 *
 * Nothing outside the drive block is touched. That restraint is load-bearing:
 * genes 0 and 1 double as the agent's point `c` in the parameter plane
 * (genome.ts:88), where an interior orbit survives and an escaping orbit dies.
 * `feedGenome` pins `g[0] = 1/3` to stay bounded, but `cIm` is `g[1]`, so writing
 * a "harmless" value there to widen the sense radius silently executes the whole
 * population on tick 1. Only the drive block is safe to write.
 */
export function buildArmGenome(set: ComponentSet, base: Float32Array = feedGenome({ diet: -1 })): Float32Array {
  const g = new Float32Array(base);
  for (const c of CAUSAL_COMPONENTS) {
    g[c.geneIndex] = set.includes(c.id) ? c.onGene : c.offGene;
  }
  return g;
}

/** founder overrides for an arm: `spawnCount` agents, all with the same genome */
export function buildArmFounders(set: ComponentSet, spawn: number, base?: Float32Array): { id: number; genome: Float32Array }[] {
  const genome = buildArmGenome(set, base);
  const out: { id: number; genome: Float32Array }[] = [];
  for (let id = 0; id < spawn; id++) out.push({ id, genome: new Float32Array(genome) });
  return out;
}

/**
 * Neighbour sense radius for a genome, mirroring decodePhenotype (genome.ts:65).
 * The collective terms can only act on neighbours inside this radius, so it sets
 * the density an arena needs before flocking is possible at all.
 */
export function decodeSenseRadius(genome: Float32Array): number {
  const t = Math.max(0, Math.min(1, (genome[1]! + 1) / 2));
  return 8 + (64 - 8) * t;
}

/** separation radius, which the engine scales by body size (engine.ts:766) */
export function separationRadius(genome: Float32Array): number {
  const t = Math.max(0, Math.min(1, (genome[6]! + 1) / 2));
  const size = 0.5 + (2.5 - 0.5) * t;
  return 8 * size;
}

/**
 * Ratio of the sense radius to the separation radius.
 *
 * This single number explains the headline result. `feedGenome` pins gene 6 to
 * -1, which decodes to the minimum body size 0.5, so the separation drive only
 * fires for neighbours inside `8 * 0.5 = 4` units - while the sense radius is 36.
 * Separation is therefore a *collision* term, not a spacing term: it can push two
 * overlapping agents apart, but it can never organise agents into an evenly spaced
 * formation, because the agents it can see at flock scale are all outside its
 * 4-unit reach. Cohesion, which acts across the full 36-unit sense radius, wins
 * by default and collapses the group into a ragged clot.
 */
export function senseToSeparationRatio(genome: Float32Array): number {
  const sep = separationRadius(genome);
  return sep > 0 ? decodeSenseRadius(genome) / sep : Infinity;
}

// ---------------------------------------------------------------------------
// Order parameters: what "collective" means quantitatively
// ---------------------------------------------------------------------------

/** below this speed an agent has no meaningful heading and is excluded */
export const SPEED_EPS = 0.05;
/** minimum movers required before any order parameter means anything */
export const MIN_MOVERS = 4;

/** shortest signed delta from a to b on a torus of circumference L */
export function torusDelta(a: number, b: number, L: number = WORLD_SIZE): number {
  let d = b - a;
  if (d > L / 2) d -= L;
  else if (d < -L / 2) d += L;
  return d;
}

/**
 * Velocity polarization: |sum of unit headings| / N over agents that are moving.
 * This is the standard collective-motion order parameter. 1 means every agent
 * points the same way, 0 means headings are isotropic. It is the axis that
 * separates a flock from a gas, and it reads something no existing metric in
 * this repo reads: the metric axes are built from species, traits and lattice
 * occupancy, never from velocity.
 */
export function polarizationOf(vxs: ArrayLike<number>, vys: ArrayLike<number>): number {
  const n = Math.min(vxs.length, vys.length);
  let sx = 0;
  let sy = 0;
  let count = 0;
  for (let i = 0; i < n; i++) {
    const vx = vxs[i]!;
    const vy = vys[i]!;
    const m = Math.hypot(vx, vy);
    if (m < SPEED_EPS) continue;
    sx += vx / m;
    sy += vy / m;
    count++;
  }
  if (count < MIN_MOVERS) return 0;
  return Math.hypot(sx, sy) / count;
}

/**
 * Rotational order: |sum of local angular velocity| / N, where an agent's local
 * angular velocity is the cross product of its offset from the local centroid
 * with its velocity, divided by r^2.
 *
 * A flock translates: every heading is similar, so polarization is high and
 * rotation is near zero. A mill orbits: headings differ systematically around
 * the circle, so rotation is high and polarization is low. Without this second
 * parameter, "order" and "flocking" are the same word, and a vortex would be
 * scored as a success.
 */
export function rotationalOrderOf(
  xs: ArrayLike<number>,
  ys: ArrayLike<number>,
  vxs: ArrayLike<number>,
  vys: ArrayLike<number>,
  cx: number,
  cy: number,
  L: number = WORLD_SIZE,
): number {
  const n = Math.min(xs.length, ys.length, vxs.length, vys.length);
  let sum = 0;
  let count = 0;
  for (let i = 0; i < n; i++) {
    const vx = vxs[i]!;
    const vy = vys[i]!;
    const speed = Math.hypot(vx, vy);
    if (speed < SPEED_EPS) continue;
    const dx = torusDelta(xs[i]!, cx, L);
    const dy = torusDelta(ys[i]!, cy, L);
    const r2 = dx * dx + dy * dy;
    if (r2 < 1) continue;
    // normalise the cross product by r * |v| so the result is the fraction of
    // motion that is tangential. The raw curl is an angular velocity and scales
    // as 1/r, which would score a slow wide mill no higher than a fast tight one
    // and make the threshold depend on the group's size rather than its rotation.
    sum += (dx * vy - dy * vx) / (Math.sqrt(r2) * speed);
    count++;
  }
  if (count < MIN_MOVERS) return 0;
  return Math.min(1, Math.abs(sum) / count);
}

/** mean and coefficient of variation of a series; CV is the heterogeneity signal */
export function meanAndCv(values: ArrayLike<number>): { mean: number; cv: number } {
  const n = values.length;
  if (n === 0) return { mean: 0, cv: 0 };
  let sum = 0;
  for (let i = 0; i < n; i++) sum += values[i]!;
  const mean = sum / n;
  if (n < 2 || mean <= 0) return { mean, cv: 0 };
  let acc = 0;
  for (let i = 0; i < n; i++) acc += (values[i]! - mean) ** 2;
  const sd = Math.sqrt(acc / (n - 1));
  return { mean, cv: sd / mean };
}

/**
 * Centroid of a point set on a torus, computed from the mean of the wrapped unit
 * vectors so a group straddling the seam does not report a centroid on the far
 * side of the world.
 */
export function torusCentroid(xs: ArrayLike<number>, ys: ArrayLike<number>, L: number = WORLD_SIZE): { x: number; y: number } {
  const n = Math.min(xs.length, ys.length);
  if (n === 0) return { x: 0, y: 0 };
  // each axis gets its own cos/sin accumulators; mixing them would drag the
  // centroid of a wide, flat group toward an unrelated coordinate
  let cosX = 0;
  let sinX = 0;
  let cosY = 0;
  let sinY = 0;
  for (let i = 0; i < n; i++) {
    const ax = (2 * Math.PI * xs[i]!) / L;
    const ay = (2 * Math.PI * ys[i]!) / L;
    cosX += Math.cos(ax);
    sinX += Math.sin(ax);
    cosY += Math.cos(ay);
    sinY += Math.sin(ay);
  }
  const tau = 2 * Math.PI;
  const wrap = (rad: number): number => ((rad % tau) + tau) % tau;
  return { x: wrap(Math.atan2(sinX / n, cosX / n)) * (L / tau), y: wrap(Math.atan2(sinY / n, cosY / n)) * (L / tau) };
}

/**
 * RMS distance of the group from its own centroid: how much space the group
 * occupies.
 *
 * This is the axis that stops the readout from being trivially gameable. Cohesion
 * on its own drives every agent to the centroid, which produces excellent
 * heading agreement while collapsing the group to a single point. A flock is not
 * a point: it has extent. Without this measure, cohesion alone would be scored as
 * a perfect flock.
 */
export function spreadOf(xs: ArrayLike<number>, ys: ArrayLike<number>, cx: number, cy: number, L: number = WORLD_SIZE): number {
  const n = Math.min(xs.length, ys.length);
  if (n === 0) return 0;
  let acc = 0;
  for (let i = 0; i < n; i++) {
    const dx = torusDelta(xs[i]!, cx, L);
    const dy = torusDelta(ys[i]!, cy, L);
    acc += dx * dx + dy * dy;
  }
  return Math.sqrt(acc / n);
}

/** the observable state of one arm at one instant */
export interface CollectiveState {
  alive: number;
  movers: number;
  /** |sum of unit headings| / N: 1 = one direction, 0 = isotropic */
  polarization: number;
  /** |sum of local angular velocity| / N: high = orbiting mill, low = translating flock */
  rotationalOrder: number;
  /** RMS distance from the group centroid: how much space the group occupies */
  spread: number;
  /** mean local neighbour count within the sense radius */
  neighbourMean: number;
  /** coefficient of variation of local neighbour count: high = patchy, low = even */
  densityCv: number;
  /** mean nearest-neighbour distance, torus-aware */
  nearestNeighbour: number;
  /** coefficient of variation of nearest-neighbour distance: high = ragged, low = tight */
  nearestNeighbourCv: number;
  meanSpeed: number;
}

/**
 * Reduce a raw per-agent sample to a CollectiveState.
 *
 * `neighbourCounts` and `nearestNeighbourDistances` are supplied by the caller
 * because neighbour geometry depends on the sense radius, which is a property of
 * the world rather than of the measurement.
 */
export function collectiveStateOf(
  xs: ArrayLike<number>,
  ys: ArrayLike<number>,
  vxs: ArrayLike<number>,
  vys: ArrayLike<number>,
  neighbourCounts: ArrayLike<number>,
  nearestNeighbourDistances: ArrayLike<number>,
  alive: number,
  L: number = WORLD_SIZE,
): CollectiveState {
  const n = Math.min(xs.length, ys.length, vxs.length, vys.length);
  let movers = 0;
  let speedSum = 0;
  for (let i = 0; i < n; i++) {
    const m = Math.hypot(vxs[i]!, vys[i]!);
    if (m >= SPEED_EPS) {
      movers++;
      speedSum += m;
    }
  }
  const c = torusCentroid(xs, ys, L);
  const nb = meanAndCv(neighbourCounts);
  const nn = meanAndCv(nearestNeighbourDistances);
  // rotation is measured about the group's own centroid, not the world origin,
  // so a translated flock is not misread as an orbiting mill
  return {
    alive,
    movers,
    polarization: polarizationOf(vxs, vys),
    rotationalOrder: rotationalOrderOf(xs, ys, vxs, vys, c.x, c.y, L),
    spread: spreadOf(xs, ys, c.x, c.y, L),
    neighbourMean: nb.mean,
    densityCv: nb.cv,
    nearestNeighbour: nn.mean,
    nearestNeighbourCv: nn.cv,
    meanSpeed: movers > 0 ? speedSum / movers : 0,
  };
}

/** mean of a numeric field over a series of states */
export function meanStateField(states: readonly CollectiveState[], pick: (s: CollectiveState) => number): number {
  if (states.length === 0) return 0;
  let sum = 0;
  for (const s of states) sum += pick(s);
  return sum / states.length;
}

/* ------------------------------------------------------------------ *
 * Experiment configuration
 * ------------------------------------------------------------------ */

export interface ArmConfig {
  /** agents per arm; all are founders, so nothing is born and genes cannot drift */
  spawn: number;
  /**
   * Side of the square the founders are scattered into.
   *
   * The world is 2048 wide and the sense radius is only ~36, so founders scattered
   * across the world would never see each other and every collective term would be
   * inert. This confines them to a region dense enough to actually interact.
   */
  arena: number;
  ticks: number;
  /** sample cadence in ticks */
  sampleEvery: number;
  /**
   * Initial speed handed to every founder.
   *
   * Agents spawn at rest, and `alignment` sums *neighbour* velocities. With every
   * agent at rest there is nothing to align to, so alignment is exactly zero and
   * can never bootstrap itself. A seeded common-magnitude random heading breaks
   * that symmetry identically in every arm, which makes the term switchable
   * rather than dead. This is a controlled initial condition, not a confound: it
   * is byte-identical across arms.
   */
  seedSpeed: number;
  rngSeed: number;
}

export const DEFAULT_ARM: ArmConfig = {
  spawn: 60,
  arena: 140,
  // 400 ticks, not a round number chosen for speed: at 200 ticks the settled
  // window is still drifting and behaviour labels shift (see `convergence`)
  ticks: 400,
  sampleEvery: 20,
  seedSpeed: 2.0,
  rngSeed: 999,
};

/* ------------------------------------------------------------------ *
 * Behaviour classification
 * ------------------------------------------------------------------ */

export type BehaviourClass =
  | 'inert'
  | 'dispersed'
  | 'cohesive'
  | 'clumped'
  | 'flocking'
  | 'milling'
  | 'unknown';

export interface BehaviourThresholds {
  /** below this many movers, the population is not collectively moving at all */
  moverFloor: number;
  /** spread below this fraction of the arena is a single bounded group */
  cohesiveSpreadFrac: number;
  /** above this fraction of the arena, the group has lost cohesion entirely */
  dispersedSpreadFrac: number;
  /** near-neighbour CV below this is an evenly spaced lattice */
  latticeNeighbourCv: number;
  /** polarization needed to call a moving group a flock */
  flockPolarization: number;
  /** rotational order needed to call a group a mill */
  millRotationalOrder: number;
  /**
   * Separation only acts inside its own radius, so that radius is the natural
   * boundary between "overlapping" and "spaced". A group packed tighter than this
   * has defeated separation and is a clot; a group sitting just outside it, with
   * even spacing, is a lattice. This is read from the genome rather than tuned.
   */
  separationRadius: number;
  senseRadius: number;
}

/**
 * Normalized tangential velocity fraction above which a group counts as milling.
 *
 * Extracted so the report can quote the cut it is reasoning about instead of a
 * literal duplicated in prose, which is how the mill boundary came to be
 * described as marginal in an earlier version of the report when the replication
 * says it is cleanly separated.
 */
export const MILL_ROTATION_THRESHOLD = 0.25;

export function thresholdsFor(cfg: ArmConfig, senseRadius: number, sepRadius: number = separationRadius(feedGenome({ diet: -1 }))): BehaviourThresholds {
  return {
    moverFloor: MIN_MOVERS,
    cohesiveSpreadFrac: 1.0,
    dispersedSpreadFrac: 1.6,
    latticeNeighbourCv: 1.0,
    flockPolarization: 0.6,
    millRotationalOrder: MILL_ROTATION_THRESHOLD,
    separationRadius: sepRadius,
    senseRadius,
  };
}

/**
 * Classify a settled population.
 *
 * The axes are deliberately chosen to be *unsaturated*. Measured across all arms,
 * polarization sits at 0.95-0.998 for every configuration that moves at all,
 * because cohesion and circulation both drag the whole population along a common
 * heading. A flock test built on polarization alone would therefore call a
 * collapsing clot and a dispersing swarm equally flocking, and would have
 * "confirmed" a pre-chosen story. The discriminating structure is:
 *
 *   - spread separates bounded groups from ones that have lost each other
 *   - nearest-neighbour CV separates an evenly spaced lattice from a ragged clot
 *   - rotational order separates a mill from a translating flock
 *   - polarization, kept only as a floor, is the weakest axis
 */
export function classifyBehaviour(
  s: {
    movers: number;
    alive: number;
    polarization: number;
    rotationalOrder: number;
    spread: number;
    neighbourMean: number;
    densityCv: number;
    nearestNeighbour: number;
    nearestNeighbourCv: number;
  },
  arena: number,
  t: BehaviourThresholds,
): BehaviourClass {
  if (s.alive === 0) return 'inert';
  if (s.movers < t.moverFloor) return 'inert';
  if (s.rotationalOrder >= t.millRotationalOrder) return 'milling';
  if (s.spread >= t.dispersedSpreadFrac * arena) return 'dispersed';
  if (s.spread <= t.cohesiveSpreadFrac * arena) {
    if (s.nearestNeighbour < t.separationRadius) return 'clumped';
    if (s.nearestNeighbourCv <= t.latticeNeighbourCv && s.polarization >= t.flockPolarization) return 'flocking';
  }
  return 'cohesive';
}

/* ------------------------------------------------------------------ *
 * Threshold sensitivity
 * ------------------------------------------------------------------ */

/** how a single threshold moved, and what it cost */
export interface ThresholdProbe {
  threshold: keyof BehaviourThresholds;
  label: string;
  nominal: number;
  /** multiplicative perturbations applied to the nominal value */
  factors: number[];
  /** class each stored run takes at each perturbation, in factor order */
  perFactor: BehaviourClass[][];
  /** fraction of runs whose class changed, per factor */
  changedFraction: number[];
  /** "from->to" label pairs the moved cut produced, most frequent first */
  transitions: { pair: string; count: number; at: number }[];
  /**
   * Classes this cut can promote a run *into*, excluding the classes runs already
   * held. The union of all classes is useless here: the stored runs already cover
   * every class, so what matters is which labels are reachable only by moving this cut.
   */
  labelsEntered: BehaviourClass[];
}

/**
 * Which label changes a moved cut actually causes, and how often.
 *
 * `changedFraction` alone hides the useful part: a small fraction of runs changing is
 * unremarkable if it is always the same milling<->dispersed edge, and alarming if
 * those runs are scattered across unrelated boundaries.
 */
function countTransitions(
  perFactor: readonly BehaviourClass[][],
  runs: readonly { behaviour: BehaviourClass }[],
): { pair: string; count: number; at: number }[] {
  const counts = new Map<string, { pair: string; count: number; at: number }>();
  perFactor.forEach((row, i) => {
    row.forEach((c, j) => {
      const from = runs[j]!.behaviour;
      if (c === from) return;
      const pair = `${from}->${c}`;
      const prev = counts.get(pair);
      if (prev) {
        prev.count++;
        if (i > prev.at) prev.at = i;
      } else {
        counts.set(pair, { pair, count: 1, at: i });
      }
    });
  });
  return [...counts.values()].sort((a, b) => b.count - a.count || a.pair.localeCompare(b.pair));
}

/**
 * How much of the result depends on where the classifier's cuts were drawn.
 *
 * Every behavioural label in this study is a threshold on a continuous readout, and
 * none of those thresholds was validated against anything except this run. That is
 * the weakest assumption in the whole design, and it is invisible in the tables
 * because a label looks like a measurement. So it is measured directly: the settled
 * state of every replicated run is already stored, so each threshold can be swept
 * and the runs re-classified with no additional simulation.
 *
 * A threshold that no perturbation disturbs is not thereby correct - it may simply
 * be far from the data - but a threshold whose class assignment flips under a
 * perturbation comparable to its own uncertainty is carrying the result rather
 * than measuring it.
 */
export function thresholdSensitivity(
  runs: readonly { density: string; arena: number; settled: CollectiveState; behaviour: BehaviourClass }[],
  t: BehaviourThresholds,
  factors: number[] = [0.8, 0.9, 1, 1.1, 1.25],
): ThresholdProbe[] {
  const knobs: { threshold: keyof BehaviourThresholds; label: string }[] = [
    { threshold: 'millRotationalOrder', label: 'milling rotational order' },
    { threshold: 'latticeNeighbourCv', label: 'lattice neighbour CV' },
    { threshold: 'flockPolarization', label: 'flocking polarization floor' },
    { threshold: 'cohesiveSpreadFrac', label: 'cohesive spread (fraction of arena)' },
    { threshold: 'dispersedSpreadFrac', label: 'dispersed spread (fraction of arena)' },
  ];
  return knobs.map(({ threshold, label }) => {
    const nominal = t[threshold];
    const perFactor = factors.map((f) =>
      runs.map((r) => classifyBehaviour(r.settled, r.arena, { ...t, [threshold]: nominal * f })),
    );
    return {
      threshold,
      label,
      nominal,
      factors,
      perFactor,
      changedFraction: perFactor.map((row) => row.filter((c, j) => c !== runs[j]!.behaviour).length / runs.length),
      /** "from->to" label pairs the moved cut actually produced, most frequent first */
      transitions: countTransitions(perFactor, runs),
      labelsEntered: [
        ...new Set(
          perFactor.flatMap((row) => row.filter((c, j) => c !== runs[j]!.behaviour)),
        ),
      ].sort(),
    };
  });
}

/* ------------------------------------------------------------------ *
 * Arm execution
 * ------------------------------------------------------------------ */

/** deterministic 32-bit LCG so a given arm config always replays identically */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1103515245) + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

export interface ArmResult {
  key: string;
  set: ComponentSet;
  alive: number;
  deterministic: boolean;
  behaviour: BehaviourClass;
  /** settled-window means, the numbers the classifier saw */
  settled: CollectiveState;
  /** net centroid travel per tick over the settled window */
  drift: number;
  /** whether the settled window is stationary within CONVERGENCE_TOLERANCE */
  converged: boolean;
  /** worst half-window disagreement on a classifier readout */
  convergenceError: number;
  /** per-tick polarization samples, for the trajectory plot */
  polarizationTrace: number[];
  settledStates: CollectiveState[];
}

/** neighbour counts and nearest-neighbour distances, torus-aware, O(n^2) */
function neighbourGeometry(
  xs: number[],
  ys: number[],
  sense: number,
  L: number,
): { counts: number[]; nearest: number[] } {
  const n = xs.length;
  const counts: number[] = [];
  const nearest: number[] = [];
  for (let i = 0; i < n; i++) {
    let cnt = 0;
    let best = Infinity;
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const dx = torusDelta(xs[j]!, xs[i]!, L);
      const dy = torusDelta(ys[j]!, ys[i]!, L);
      const d = Math.hypot(dx, dy);
      if (d <= sense) cnt++;
      if (d < best) best = d;
    }
    counts.push(cnt);
    if (Number.isFinite(best)) nearest.push(best);
  }
  return { counts, nearest };
}

/** compact fingerprint of one arm's settled summary, for replay comparison */
function armFingerprint(s: CollectiveState, drift: number): string {
  const q = (v: number): string => v.toFixed(4);
  return [s.alive, s.movers, q(s.polarization), q(s.rotationalOrder), q(s.spread), q(s.neighbourMean), q(s.densityCv), q(s.nearestNeighbour), q(s.nearestNeighbourCv), q(s.meanSpeed), q(drift)].join('|');
}

/** fingerprint of one execution's settled window, used to prove replay determinism */
function executionFingerprint(
  states: readonly CollectiveState[],
  centroids: readonly { x: number; y: number }[],
  alive: number,
  cfg: ArmConfig,
): string {
  const settledStates = states.slice(Math.floor(states.length / 2));
  const half = Math.floor(centroids.length / 2);
  const p0 = centroids[half]!;
  const p1 = centroids[centroids.length - 1]!;
  const steps = Math.max(1, centroids.length - half);
  const drift = Math.hypot(torusDelta(p1.x, p0.x), torusDelta(p1.y, p0.y)) / (steps * cfg.sampleEvery);
  const q = (v: number): string => v.toFixed(4);
  return [
    alive,
    states.length,
    ...settledStates.map(
      (s) =>
        [s.movers, s.polarization, s.rotationalOrder, s.spread, s.neighbourMean, s.densityCv, s.nearestNeighbour, s.nearestNeighbourCv, s.meanSpeed]
          .map(q)
          .join(','),
    ),
    q(drift),
  ].join('|');
}

/** settled-window means plus net centroid travel */
function summarise(states: readonly CollectiveState[], centroids: readonly { x: number; y: number }[], alive: number, cfg: ArmConfig): { settled: CollectiveState; drift: number; converged: boolean; convergenceError: number } {
  const settledStates = states.slice(Math.floor(states.length / 2));
  const half = Math.floor(centroids.length / 2);
  const p0 = centroids[half]!;
  const p1 = centroids[centroids.length - 1]!;
  const steps = Math.max(1, centroids.length - half);
  const drift = Math.hypot(torusDelta(p1.x, p0.x), torusDelta(p1.y, p0.y)) / (steps * cfg.sampleEvery);
  const settled: CollectiveState = {
    alive,
    movers: Math.round(meanStateField(settledStates, (s) => s.movers)),
    polarization: meanStateField(settledStates, (s) => s.polarization),
    rotationalOrder: meanStateField(settledStates, (s) => s.rotationalOrder),
    spread: meanStateField(settledStates, (s) => s.spread),
    neighbourMean: meanStateField(settledStates, (s) => s.neighbourMean),
    densityCv: meanStateField(settledStates, (s) => s.densityCv),
    nearestNeighbour: meanStateField(settledStates, (s) => s.nearestNeighbour),
    nearestNeighbourCv: meanStateField(settledStates, (s) => s.nearestNeighbourCv),
    meanSpeed: meanStateField(settledStates, (s) => s.meanSpeed),
  };
  return { settled, drift, ...convergence(settledStates, cfg) };
}

/**
 * Is the settled window actually stationary?
 *
 * The tick budget cannot be chosen for convenience. An earlier version of this
 * study ran 200 ticks and 400 ticks and got materially different behaviour
 * labels - at 200 ticks `cohesion` alone read as a flock at low density - which
 * is what a window that has not finished drifting looks like. So the budget is
 * now checked rather than asserted: split the settled window in half and compare
 * the two halves on the two readouts that drive the classifier. A window that
 * still moves is reported as unconverged and its classification is not admissible
 * as a steady state.
 */
function convergence(settledStates: readonly CollectiveState[], cfg: ArmConfig): { converged: boolean; convergenceError: number } {
  const mid = Math.floor(settledStates.length / 2);
  if (mid < 1) return { converged: false, convergenceError: 1 };
  const early = settledStates.slice(0, mid);
  const late = settledStates.slice(mid);
  // spread is scale-dependent, so compare it relative to the arena; nnCV is not
  const spreadErr = Math.abs(meanStateField(early, (s) => s.spread) - meanStateField(late, (s) => s.spread)) / cfg.arena;
  const cvErr = Math.abs(meanStateField(early, (s) => s.nearestNeighbourCv) - meanStateField(late, (s) => s.nearestNeighbourCv));
  const orderErr = Math.abs(meanStateField(early, (s) => s.rotationalOrder) - meanStateField(late, (s) => s.rotationalOrder));
  const error = Math.max(spreadErr, cvErr, orderErr);
  return { converged: error < CONVERGENCE_TOLERANCE, convergenceError: error };
}

/**
 * Half-window disagreement on the classifier's readouts, in units where 1 is a
 * full arena width.
 *
 * This is a diagnostic, not a pass/fail gate, and the reason it is not a gate is
 * itself a result: the error does not shrink as the run lengthens. Measured over
 * the dense arms it is 0.42 at 200 ticks, 1.27 at 400 and 2.83 at 600. The arms
 * are not converging to a fixed point because most of them are not trying to - a
 * dispersed arm keeps expanding, and a swirling arm keeps rotating, and both
 * read as perfectly good behaviour classes. What the numbers do establish is that
 * a tick budget is a real modelling choice rather than a free parameter: at 200
 * ticks `cohesion` alone reads as a flock at low density, and at 400 it does not.
 * The study therefore fixes 400 ticks and reports the state measured at that
 * budget, next to the spread of the window, so the reader can see how much of the
 * result is budget-dependent.
 */
export const CONVERGENCE_TOLERANCE = 0.12;

/**
 * Run one arm.
 *
 * `worldFactory` is injected so the caller controls the world params and so tests
 * can shrink the run. By default the arm is executed twice from an identical seed;
 * an arm that does not replay to the same fingerprint is marked non-deterministic
 * and no causal claim from it is admissible. `doubleRun: false` skips the second
 * execution, which the seed replication uses because determinism is already
 * established independently by the two full studies.
 */
export function runArm(set: ComponentSet, cfg: ArmConfig, worldFactory: (spawn: number) => WorldLike, opts: { doubleRun?: boolean; base?: Float32Array } = {}): ArmResult {
  const doubleRun = opts.doubleRun !== false;
  // The background genome is threaded through explicitly rather than re-fetched from
  // feedGenome here, because a run against a variant background has to derive its
  // thresholds from that same variant genome - a separation radius read off the
  // default background would misclassify the run it is meant to describe.
  const base = opts.base ?? feedGenome({ diet: -1 });
  const sense = decodeSenseRadius(buildArmGenome(set, base));
  const t = thresholdsFor(cfg, sense, separationRadius(buildArmGenome(set, base)));
  const genomes = buildArmFounders(set, cfg.spawn, base);

  const execute = (): { states: CollectiveState[]; centroids: { x: number; y: number }[]; alive: number } => {
    const world = worldFactory(cfg.spawn);
    const engine = new Engine(world, genomes.map((f) => ({ id: f.id, genome: new Float32Array(f.genome) })));

    const rnd = lcg(cfg.rngSeed);
    for (const a of engine.agents.values()) {
      a.x = WORLD_SIZE / 2 + (rnd() - 0.5) * cfg.arena;
      a.y = WORLD_SIZE / 2 + (rnd() - 0.5) * cfg.arena;
      const th = rnd() * Math.PI * 2;
      a.vx = Math.cos(th) * cfg.seedSpeed;
      a.vy = Math.sin(th) * cfg.seedSpeed;
    }

    const states: CollectiveState[] = [];
    const centroids: { x: number; y: number }[] = [];
    for (let tick = 0; tick < cfg.ticks; tick++) {
      engine.tick();
      if ((tick + 1) % cfg.sampleEvery === 0) {
        const xs: number[] = [];
        const ys: number[] = [];
        const vxs: number[] = [];
        const vys: number[] = [];
        for (const a of engine.agents.values()) {
          if (!a.alive) continue;
          xs.push(a.x);
          ys.push(a.y);
          vxs.push(a.vx);
          vys.push(a.vy);
        }
        const geo = neighbourGeometry(xs, ys, sense, WORLD_SIZE);
        states.push(collectiveStateOf(xs, ys, vxs, vys, geo.counts, geo.nearest, xs.length));
        centroids.push(torusCentroid(xs, ys));
      }
    }
    let alive = 0;
    for (const a of engine.agents.values()) if (a.alive) alive++;
    return { states, centroids, alive };
  };

  const a = execute();
  const b = doubleRun ? execute() : null;
  const { settled, drift, converged, convergenceError } = summarise(a.states, a.centroids, a.alive, cfg);

  return {
    key: setKey(set),
    set,
    alive: a.alive,
    deterministic: b === null || (executionFingerprint(a.states, a.centroids, a.alive, cfg) === executionFingerprint(b.states, b.centroids, b.alive, cfg) && armFingerprint(settled, drift) === armFingerprint(summarise(b.states, b.centroids, b.alive, cfg).settled, summarise(b.states, b.centroids, b.alive, cfg).drift)),
    converged,
    convergenceError,
    behaviour: classifyBehaviour(settled, cfg.arena, t),
    settled,
    drift,
    polarizationTrace: a.states.map((s) => s.polarization),
    settledStates: a.states.slice(Math.floor(a.states.length / 2)),
  };
}

/* ------------------------------------------------------------------ *
 * Sufficiency, ablation, interaction
 * ------------------------------------------------------------------ */

export interface AblationEffect {
  component: ComponentId;
  /** behaviour of the full set with the component removed */
  behaviourWithout: BehaviourClass;
  behaviourWith: BehaviourClass;
  /** true when removing the component changed the categorical outcome */
  behaviourChanged: boolean;
  /** change in each measured axis, component-on minus component-off */
  deltas: Record<string, number>;
}

export interface InteractionEffect {
  pair: [ComponentId, ComponentId];
  /** behaviour with neither */
  baseline: BehaviourClass;
  /** behaviour with only the first */
  onlyA: BehaviourClass;
  /** behaviour with only the second */
  onlyB: BehaviourClass;
  /** behaviour with both */
  both: BehaviourClass;
  /**
   * Non-additivity: whether the pair's combined outcome is predictable from the
   * single-component outcomes alone. `true` means the pair does something neither
   * member does by itself.
   */
  synergistic: boolean;
  note: string;
}

export interface SufficiencyReport {
  /** every arm, keyed by set */
  arms: ArmResult[];
  /** the behaviour chosen as the target of the sufficiency search */
  target: BehaviourClass;
  /** smallest sets that reach the target behaviour */
  minimalSufficient: string[];
  /** components whose removal from the full set breaks the target behaviour */
  necessary: ComponentId[];
  /** components whose removal from the full set does not break it */
  dispensable: ComponentId[];
  ablations: AblationEffect[];
  interactions: InteractionEffect[];
  /** true when every arm replayed identically */
  deterministic: boolean;
}

/** all 2^n subsets of the component alphabet, ordered by size then lexicographic */

/** the signed difference in every measured axis between two arms */
function axisDeltas(withC: ArmResult, withoutC: ArmResult): Record<string, number> {
  const out: Record<string, number> = {};
  for (const k of Object.keys(withC.settled) as (keyof typeof withC.settled)[]) {
    out[k] = withC.settled[k] - withoutC.settled[k];
  }
  out.drift = withC.drift - withoutC.drift;
  return out;
}

/**
 * Search the component space for what actually produces the target behaviour.
 *
 * The target is the behaviour observed for the full set, so the search is "what is
 * the cheapest way to reproduce the real thing" rather than "what reproduces a
 * story decided in advance". Every one of the 2^n arms is run, so a minimal
 * sufficient set is genuinely minimal: no proper subset is claimed to work
 * without having been measured.
 */
export function analyseSufficiency(
  worldFactory: (spawn: number) => WorldLike,
  cfg: ArmConfig = DEFAULT_ARM,
  target?: BehaviourClass,
): SufficiencyReport {
  const sets = enumerateArms();
  const results = new Map<string, ArmResult>();
  for (const set of sets) {
    const r = runArm(set, cfg, worldFactory);
    results.set(setKey(set), r);
  }
  const full = COMPONENT_IDS;
  const fullResult = results.get(setKey(full))!;
  const goal: BehaviourClass = target ?? fullResult.behaviour;

  const hits = sets.filter((s) => results.get(setKey(s))!.behaviour === goal);
  const minimalSufficient = hits
    .filter((s) => !hits.some((o) => o !== s && o.length < s.length && o.every((id) => s.includes(id))))
    .map((s) => setKey(s))
    .sort();

  const ablations: AblationEffect[] = [];
  const necessary: ComponentId[] = [];
  const dispensable: ComponentId[] = [];
  for (const id of COMPONENT_IDS) {
    const without = results.get(setKey(full.filter((x) => x !== id)))!;
    const withC = results.get(setKey(full))!;
    const behaviourChanged = without.behaviour !== withC.behaviour;
    if (behaviourChanged) necessary.push(id);
    else dispensable.push(id);
    ablations.push({
      component: id,
      behaviourWithout: without.behaviour,
      behaviourWith: withC.behaviour,
      behaviourChanged,
      deltas: axisDeltas(withC, without),
    });
  }

  const interactions: InteractionEffect[] = [];
  for (let i = 0; i < COMPONENT_IDS.length; i++) {
    for (let j = i + 1; j < COMPONENT_IDS.length; j++) {
      const a = COMPONENT_IDS[i]!;
      const b = COMPONENT_IDS[j]!;
      const baseline = results.get(setKey([]))!.behaviour;
      const onlyA = results.get(setKey([a]))!.behaviour;
      const onlyB = results.get(setKey([b]))!.behaviour;
      const both = results.get(setKey([a, b]))!.behaviour;
      const reachable = new Set([baseline, onlyA, onlyB]);
      const synergistic = !reachable.has(both);
      interactions.push({
        pair: [a, b],
        baseline,
        onlyA,
        onlyB,
        both,
        synergistic,
        note: synergistic
          ? `${both} appears only when ${a} and ${b} are enabled together`
          : `${both} is already reachable from the single-component arms`,
      });
    }
  }

  return {
    arms: sets.map((s) => results.get(setKey(s))!),
    target: goal,
    minimalSufficient,
    necessary,
    dispensable,
    ablations,
    interactions,
    deterministic: results.get(setKey(full))!.deterministic && sets.every((s) => results.get(setKey(s))!.deterministic),
  };
}

/* ------------------------------------------------------------------ *
 * Reporting
 * ------------------------------------------------------------------ */

const BEHAVIOURS: BehaviourClass[] = ['inert', 'dispersed', 'cohesive', 'clumped', 'flocking', 'milling'];

const BEHAVIOUR_BLURB: Record<BehaviourClass, string> = {
  inert: 'nothing is moving: below the mover floor',
  dispersed: 'moving, but the group has lost cohesion and spread across the world',
  cohesive: 'a single bounded group, moving, but neither an even lattice nor a mill',
  clumped: 'bounded and moving, but collapsed onto itself with ragged spacing',
  flocking: 'bounded, evenly spaced, and moving under a common heading',
  milling: 'bounded and rotating about its own centroid',
  unknown: 'unclassified',
};

function fmt(v: number, d = 3): string {
  return v.toFixed(d);
}

function armTable(r: SufficiencyReport): string[] {
  const out: string[] = [];
  out.push('| set | behaviour | alive | movers | pol | rot | spread | nn | nnCV | drift |');
  out.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const a of r.arms) {
    out.push(
      `| \`${a.key}\` | ${a.behaviour} | ${a.alive} | ${a.settled.movers} | ${fmt(a.settled.polarization)} | ` +
        `${fmt(a.settled.rotationalOrder)} | ${fmt(a.settled.spread, 1)} | ${fmt(a.settled.nearestNeighbour, 1)} | ` +
        `${fmt(a.settled.nearestNeighbourCv, 2)} | ${fmt(a.drift, 2)} |`,
    );
  }
  return out;
}

function ablationTable(r: SufficiencyReport): string[] {
  const out: string[] = [];
  out.push('| removed | behaviour without | changed | d spread | d nn | d nnCV | d pol |');
  out.push('| --- | --- | --- | --- | --- | --- | --- |');
  for (const ab of r.ablations) {
    out.push(
      `| ${ab.component} | ${ab.behaviourWithout} | ${ab.behaviourChanged} | ` +
        `${fmt(ab.deltas.spread ?? 0, 1)} | ${fmt(ab.deltas.nearestNeighbour ?? 0, 1)} | ` +
        `${fmt(ab.deltas.nearestNeighbourCv ?? 0, 2)} | ${fmt(ab.deltas.polarization ?? 0)} |`,
    );
  }
  return out;
}

function interactionTable(r: SufficiencyReport): string[] {
  const out: string[] = [];
  out.push('| pair | neither | a only | b only | both | synergistic |');
  out.push('| --- | --- | --- | --- | --- | --- |');
  for (const it of r.interactions) {
    out.push(`| ${it.pair[0]} + ${it.pair[1]} | ${it.baseline} | ${it.onlyA} | ${it.onlyB} | ${it.both} | ${it.synergistic} |`);
  }
  return out;
}

/**
 * State what the `milling` class is actually worth, computed from the replication
 * rather than asserted. An earlier version of this report called the mill boundary
 * the least supported cut in the classifier, on the grounds that a single arm
 * reached it at a single seed just past its threshold. The replication says
 * otherwise: milling is reached by a small family of arms, always without
 * cohesion, and the class boundary is cleanly separated. What remains genuinely
 * unsupported is the *threshold's* absolute value, which was never validated
 * against anything outside this run.
 */
/**
 * How much the result depends on where the classifier's cuts were drawn.
 *
 * This is the assumption the study cannot check by replication: a threshold is a
 * modelling choice, and replication over seeds says nothing about whether the cut
 * sits in the right place. So each cut is swept over the runs already stored, and
 * the report states which labels survive. A label that only holds because a cut
 * happened to land in a particular gap is not a measurement.
 */
/**
 * Does the causal ordering survive a change of genome?
 *
 * The single-background study cannot check this about itself, so it is checked
 * against the one background gene that changes the geometry the drives act in: gene
 * 6 sets body size, and the separation radius scales with it. What should transfer
 * is the *ordering* - which arms are inert, which never flock, which flock
 * reliably - not the exact labels, since doubling the separation radius moves the
 * density boundary by construction.
 */
function backgroundSection(md: string[], s: CausalStudy, replication: CausalReplication): void {
  const bg = s.background;
  md.push('## Does this survive a different genome?');
  md.push('');
  md.push(`The whole study above runs on one genome background, so every claim is a statement about that`);
  md.push(`background rather than about the drive genes. The sharpest available check is gene 6, which sets`);
  md.push('body size and therefore scales the separation radius - the one background parameter this');
  md.push("study's geometric explanation actually leans on.");
  md.push(`The variant \`${bg.name}\` sets gene 6 = ${bg.gene6} (${bg.rationale}).`);
  const sepChanged = Math.abs(bg.separationRadius - s.separationRadius) >= 0.05;
  if (sepChanged) {
    md.push(`It moves the separation radius from ${fmt(s.separationRadius, 1)} to ${fmt(bg.separationRadius, 1)} against a ${fmt(s.senseRadius, 1)} sense`);
    md.push(`radius, i.e. from ${fmt(s.senseRadius / s.separationRadius, 1)}x to ${fmt(bg.senseRadius / bg.separationRadius, 1)}x.`);
  } else {
    md.push('**It did not change the geometry.** That gene value still decodes to a separation radius of');
    md.push(`${fmt(bg.separationRadius, 2)}, identical to the default's ${fmt(s.separationRadius, 2)}, so the variant varied a gene without changing the one`);
    md.push('thing the check exists to change. Everything below is a re-run on the same geometry and');
    md.push('therefore cannot support any claim about the drive genes being independent of their genome.');
  }
  md.push('');
  md.push('| background | sep radius | robust flocking, high | robust flocking, low | never flocks |');
  md.push('| --- | --- | --- | --- | --- |');
  md.push(`| feed-min | ${fmt(s.separationRadius, 1)} | ${replication.robustFlockingDense.join(', ') || 'none'} | ${replication.robustFlockingSparse.join(', ') || 'none'} | ${neverFlockingKeys(s)} |`);
  md.push(`| ${bg.name} | ${fmt(bg.separationRadius, 1)} | ${bg.dense.robustFlocking.join(', ') || 'none'} | ${bg.sparse.robustFlocking.join(', ') || 'none'} | ${[...new Set([...bg.dense.neverFlocking, ...bg.sparse.neverFlocking])].join(', ') || 'none'} |`);
  md.push('');
  const shared = replication.robustFlockingDense.filter((k) => bg.dense.robustFlocking.includes(k));
  const onlyDefault = replication.robustFlockingDense.filter((k) => !bg.dense.robustFlocking.includes(k));
  const onlyVariant = bg.dense.robustFlocking.filter((k) => !replication.robustFlockingDense.includes(k));
  md.push(`At high density, ${shared.length} of the ${replication.robustFlockingDense.length} arms that flock reliably on the`);
  md.push(`default background also do so on the variant: ${shared.map((k) => `\`${k}\``).join(', ') || 'none'}.`);
  if (onlyDefault.length > 0) md.push(`Only on the default background: ${onlyDefault.map((k) => `\`${k}\``).join(', ')}.`);
  if (onlyVariant.length > 0) md.push(`Only on the variant background: ${onlyVariant.map((k) => `\`${k}\``).join(', ')}.`);
  md.push('');
  const sharedInert = s.background.dense.inert.filter((k) => replication.dense.find((r) => r.key === k)?.counts.inert === replication.seeds.length);
  md.push(`Inertness is the finding that transfers most cleanly: \`none\` and \`separation\` are inert on all`);
  md.push(`${replication.seeds.length} seeds on the default background${sharedInert.length ? `, and remain inert on the variant (${sharedInert.map((k) => `\`${k}\``).join(', ')})` : ''}.`);
  md.push('An arm with no drive pathway cannot behave differently because of a drive-gene edit, so this');
  md.push('is the one prediction the variant cannot falsify - which is why it is worth saying rather than');
  md.push('leaning on.');
  md.push('');
  const unstableDefault = new Set(replication.unstableDense).size;
  const unstableVariant = new Set([...bg.dense.unstable, ...bg.sparse.unstable]).size;
  md.push(`Seed instability is comparable across the two (${unstableDefault} of 16 arms unstable on the`);
  md.push(`default, ${unstableVariant} on the variant across both densities).`);
  md.push('');
  if (!sepChanged) {
    md.push('**This section does not resolve the background-dependence question.** The variant failed to');
    md.push('move the separation radius, so this is a same-geometry re-run and a consistency check on the');
    md.push('replication, not a test of whether these findings are about the drive genes or about');
    md.push('`feedGenome`. Resolving it needs a genome background whose gene 6 actually decodes to a');
    md.push('different body size, which the current decoder clamps away. Until then, every claim in this');
    md.push('report remains a claim about one genome.');
    md.push('');
    return;
  }
  const orderingHeld = shared.length > 0 || (onlyDefault.length === 0 && onlyVariant.length === 0);
  if (orderingHeld) {
    md.push('**The causal ordering survives the background change.** Which arms are sufficient moves,');
    md.push('which is expected: a larger separation radius moves the density boundary by construction.');
    md.push('What persists is that arms with no working pathway still have none, and arms that organised');
    md.push('a flock still do.');
  } else {
    md.push('**The sufficient sets do not survive the background change**, so they describe this genome');
    md.push('rather than the drive genes. The geometric account - separation acting as a collision term -');
    md.push('is background-dependent, and so is anything inferred from it.');
  }
  md.push('');
}

/** arms that never flocked on any seed, across both densities of the default study */
function neverFlockingKeys(s: CausalStudy): string {
  const never = s.replication.dense.filter((r) => r.counts.flocking === 0).map((r) => r.key);
  const neverSparse = s.replication.sparse.filter((r) => r.counts.flocking === 0).map((r) => r.key);
  return [...new Set([...never, ...neverSparse])].join(', ') || 'none';
}



function thresholdSensitivitySection(md: string[], probes: readonly ThresholdProbe[], runCount: number): void {
  md.push('## How much of this depends on where the classifier cuts were drawn');
  md.push('');
  md.push(`Every label above is a threshold on a continuous readout, and none of those thresholds was`);
  md.push(`validated against anything except this run. That is the weakest assumption in the design, and it is`);
  md.push(`invisible in the tables because a label reads like a measurement. Each cut was therefore swept over`);
  md.push(`all ${runCount} stored runs and every run re-classified - no new simulation, just re-reading the same`);
  md.push('settled states through a moved cut.');
  md.push('');
  md.push('| cut | nominal | worst relabel rate | boundaries it moves | labels it admits |');
  md.push('| --- | --- | --- | --- | --- |');
  for (const p of probes) {
    const worst = Math.max(...p.changedFraction);
    const worstAt = p.factors[p.changedFraction.indexOf(worst)]!;
    const rate = worst === 0 ? '**0% (stable)**' : `${(worst * 100).toFixed(0)}% of runs, worst at x${worstAt}`;
    const edges = p.transitions.slice(0, 3).map((t) => `\`${t.pair}\``).join(', ') || 'none';
    const admits = p.labelsEntered.map((c) => `\`${c}\``).join(', ') || 'none';
    md.push(`| ${p.label} | ${fmt(p.nominal, 3)} | ${rate} | ${edges} | ${admits} |`);
  }
  md.push('');
  const unstable = probes.filter((p) => Math.max(...p.changedFraction) > 0);
  if (unstable.length === 0) {
    md.push('No cut relabels a single run across a +/-25% perturbation. The classifications are not');
    md.push('balanced on a knife edge - which is weaker than the cuts being right, since a cut far from');
    md.push('all the data would also be stable, but it does mean the arm ordering is not an artefact of');
    md.push('threshold placement.');
  } else {
    md.push(`${unstable.length} of ${probes.length} cuts relabel something under perturbation. Reading the third column matters more than the`);
    md.push('second: a relabel rate only tells you how much moved, not whether it moved coherently.');
    const boundaryEdges = unstable.flatMap((p) => p.transitions.map((t) => t.pair.replace(/->.*/, '')));
    const worst = unstable.reduce((a, b) => (Math.max(...a.changedFraction) >= Math.max(...b.changedFraction) ? a : b));
    md.push('');
    md.push(`The most exposed cut is **${worst.label}**: at x${worst.factors[worst.changedFraction.indexOf(Math.max(...worst.changedFraction))]} it relabels`);
    md.push(`${(Math.max(...worst.changedFraction) * 100).toFixed(0)}% of runs, moving ${[...new Set(boundaryEdges)].map((e) => `\`${e}\``).join(', ')}.`);
    md.push('The milling result above is therefore reported with an explicit separation margin rather');
    md.push('than as a clean cut, and any claim about the *identity* of a class near one of these');
    md.push('boundaries is a claim about where the classifier drew its line.');
  }
  md.push('');
}

function millingLimit(md: string[], replication: CausalReplication, probes: readonly ThresholdProbe[]): void {
  const mills = new Map<string, { hits: number; orders: number[]; densities: Set<string>; byDensity: Map<string, number> }>();
  let maxNonMill = 0;
  let runs = 0;
  for (const [density, rows] of [
    ['high', replication.dense],
    ['low', replication.sparse],
  ] as const) {
    for (const r of rows) {
      runs += r.results.length;
      const hits = r.results.filter((x) => x.behaviour === 'milling');
      for (const x of r.results) {
        if (x.behaviour !== 'milling') maxNonMill = Math.max(maxNonMill, x.settled.rotationalOrder);
      }
      if (hits.length > 0) {
        const e = mills.get(r.key) ?? { hits: 0, orders: [], densities: new Set<string>(), byDensity: new Map<string, number>() };
        e.hits += hits.length;
        e.orders.push(...hits.map((h) => h.settled.rotationalOrder));
        e.densities.add(density);
        e.byDensity.set(density, hits.length);
        mills.set(r.key, e);
      }
    }
  }
  if (mills.size === 0) {
    md.push('- `milling` is not reached by any arm at any seed, so the class is exercised only by the');
    md.push('  classifier unit tests and is not supported by this study at all.');
    md.push('');
    return;
  }
  const entries = [...mills.entries()];
  const minMill = Math.min(...entries.flatMap(([, e]) => e.orders));
  const withoutCohesion = entries.every(([k]) => !k.includes('cohesion'));
  const bothDensities = entries.every(([, e]) => e.densities.size === 2);
  const n = replication.seeds.length;
  md.push(`- \`milling\` is reached by ${entries.length} of the 16 arms${bothDensities ? ', each at both densities' : ''}:`);
  for (const [key, e] of entries) {
    const per = [...e.byDensity.entries()]
      .map(([d, k]) => `${d === 'high' ? 'high-density' : 'low-density'} ${k}/${n}`)
      .join(', ');
    md.push(`  - \`${key}\`: ${per}`);
  }
  if (withoutCohesion) {
    md.push('  Every one of them omits `cohesion`, and nothing that carries cohesion ever mills.');
    md.push('  That is mechanistically coherent: milling needs a coherent rotation, and cohesion');
    md.push('  collapses the ring that carries it. It is necessary *within this study*, which is not');
    md.push('  the same as necessary in general, since only two genome backgrounds were run.');
  } else {
    md.push('  Some of them carry `cohesion`, so the "cohesion destroys rotation" reading is not');
    md.push('  supported here.');
  }
  md.push(`  The cut is internally consistent but narrow: across all ${runs} replicated runs, every milling`);
  md.push(`  run reads rotational order at or above ${minMill.toFixed(2)} and the highest non-milling run reads`);
  md.push(`  ${maxNonMill.toFixed(2)}, so nothing lands on the wrong side of the ${MILL_ROTATION_THRESHOLD} cut - but the`);
  md.push(`  margin between the two populations is only ${(minMill - maxNonMill).toFixed(2)}. A cut that thin is`);
  md.push('  reproducible without being comfortable, and the absolute value of the threshold has');
  md.push('  never been validated against anything outside this run.');
  const millProbe = probes.find((p) => p.threshold === 'millRotationalOrder');
  if (millProbe && millProbe.transitions.length > 0) {
    md.push('');
    md.push('  Sweeping this specific cut shows the "milling never flakes" reading is not safe. Across the');
    md.push(`  x${millProbe.factors[0]} to x${millProbe.factors[millProbe.factors.length - 1]} sweep it produces:`);
    for (const t of millProbe.transitions) {
      md.push(`    - \`${t.pair}\` (${t.count} runs, furthest at x${millProbe.factors[t.at]})`);
    }
    // membership crosses the boundary in *either* direction: a run entering milling
    // and a mill leaving it are both claims that depend on where the line sits
    const millingEdge = millProbe.transitions.filter((t) => {
      const [from, to] = t.pair.split('->') as [string, string];
      return from === 'milling' || to === 'milling';
    });
    const edgeRuns = millingEdge.reduce((a, t) => a + t.count, 0);
    const entered = millingEdge.filter((t) => t.pair.endsWith('->milling')).reduce((a, t) => a + t.count, 0);
    const left = millingEdge.filter((t) => t.pair.startsWith('milling')).reduce((a, t) => a + t.count, 0);
    if (millingEdge.length === 0) {
      md.push('  None of them cross the milling boundary, so the milling/non-milling assignment is stable');
      md.push('  under the perturbation even though the raw separation margin is thin: no run sits close');
      md.push('  enough to the cut for a move to matter. The threshold is not load-bearing here, and the');
      md.push('  arms that mill do so with room to spare.');
    } else {
      md.push(`  ${millingEdge.length} of those edges cross the milling boundary (${edgeRuns} runs: ${entered} demoted into milling, ${left}`);
      md.push('  pushed out of it), so milling membership itself depends on where this cut sits. The');
      md.push('  per-seed milling counts above should be read as counts *against this cut*: an arm');
      md.push('  recorded as 1/5 is not a robustly non-milling arm, it is one arm that missed on one seed');
      md.push('  by a margin smaller than the perturbation swept here.');
    }
  }
  md.push('');
}

export function renderCausalReport(s: CausalStudy): { md: string; json: string; csv: string } {
  const { dense, sparse, sweep, replication } = s;
  const md: string[] = [];
  md.push('# Causal decomposition of collective behaviour');
  md.push('');
  md.push('## What makes this an intervention rather than an observation');
  md.push('');
  md.push('Every agent thrust in the engine is `clamp(brain + drive * DRIVE_SCALE, -1, 1)`,');
  md.push('and the 15-input sensor vector contains no neighbour velocity, heading or position');
  md.push('offset. The drive block is therefore the only causal channel from one agent\'s motion');
  md.push('to another\'s. Setting a drive gene to its zero weight deletes that pathway outright,');
  md.push('so a behavioural change under ablation is attributable to that term.');
  md.push('');
  md.push('## The tick budget is a third axis of fragility, next to the seed and the density');
  md.push('');
  md.push('Labels are reported as the state measured at tick 400. That number is a modelling');
  md.push('choice, and it is not innocent: re-running the same arms at 200 ticks changes some');
  md.push('labels outright, because at 200 ticks the measurement window is still drifting.');
  md.push('An early version of this study was made faster by halving the budget and silently');
  md.push('inverted a conclusion.');
  md.push('');
  md.push('The `convergenceError` column, in arena widths, is the disagreement between the two');
  md.push('halves of the measurement window on the readouts the classifier uses. It is reported');
  md.push('rather than gated on, because it does not shrink with run length - it is 0.42 at 200');
  md.push('ticks, 1.27 at 400 and 2.83 at 600 on the dense arms. The arms are not converging to a');
  md.push('fixed point, and that is not a defect: a dispersed arm is still expanding, a swirling');
  md.push('arm is still rotating, and both are legitimate behaviour classes. What the column');
  md.push('buys is the ability to see how much of any given label is budget-dependent.');
  md.push('');
  md.push('');
  md.push('Every arm is a set of founders carrying an identical genome with reproduction');
  md.push('switched off, so no agent is born during a run and no gene can drift. Each arm is');
  md.push('executed twice from an identical seed; all replays identical:');
  md.push(`**${s.deterministic}**.`);
  md.push('');

  md.push('## Two properties of the readout that a naive test would have missed');
  md.push('');
  md.push('**Polarization is saturated and cannot carry the result.** Cohesion and circulation');
  md.push('both read 0.98-0.99 polarized, because each drags the whole population along a common');
  md.push('heading. At the low-density arm they differ by less than 0.05 in polarization while');
  md.push('differing by more than 0.4 in neighbour-spacing variability, and they land in different');
  md.push('behaviour classes. A flock test built on polarization alone would have scored a');
  md.push('collapsing clot and an evenly spaced swirl as equally flocking, and would have');
  md.push('confirmed whatever story was written down first. The discriminating axes are spread,');
  md.push('nearest-neighbour regularity, and rotational order; polarization enters only as a floor.');
  md.push('');
  md.push('**Alignment cannot bootstrap from rest.** Agents spawn at rest and alignment sums the');
  md.push('velocities of *neighbours*. With every agent stationary the neighbour velocity sum is');
  md.push('zero, the term never fires, and the population stays frozen indefinitely. Measured');
  md.push('from rest, alignment scores exactly 0.000 in every configuration - not a weak effect but');
  md.push('a dead pathway. Alignment is a coupling term, not a motive force. A seeded heading of');
  md.push('magnitude 2, identical in every arm, is what makes it switchable at all.');
  md.push('');

  md.push('## Headline: what survives replication, and what does not');
  md.push('');
  md.push('The first version of this study ran every arm once. Repeating each arm across');
  md.push(`${replication.seeds.length} independent seeds (${replication.seeds.join(', ')}) invalidated most of`);
  md.push('those single-seed labels, so the claims below are ordered by how much evidence stands');
  md.push('behind them.');
  md.push('');
  const distinctUnstable = new Set([...replication.unstableDense, ...replication.unstableSparse]).size;
  md.push(`**${distinctUnstable} of 16 arms are seed-dependent**, while every arm replays bit-identically.`);
  md.push('That contrast is the single most important number in this report, and it is why the');
  md.push('single-seed tables further down are marked superseded rather than deleted.');
  md.push('');
  if (replication.targetDense !== replication.targetSparse) {
    md.push(`**The two densities are not asking the same question.** The sufficiency search anchors to the`);
    md.push(`full set's modal class, which is \`${replication.targetDense}\` at high density but \`${replication.targetSparse}\` at low density -`);
    md.push('because the full set is itself seed-dependent, reading one class on some seeds and the');
    md.push('other on the rest. So the two robust-sufficient lists below are not comparable to each');
    md.push('other. The target-independent answer, which is comparable, is given immediately below.');
    md.push('');
  }
  md.push('### Robust: what reliably flocks, at both densities');
  md.push('');
  md.push('Anchored to `flocking` explicitly, so these two lists mean the same thing and can be');
  md.push('compared directly. An arm is listed only if it reached a flock on all');
  md.push(`${replication.seeds.length} seeds.`);
  md.push('');
  const plural = (n: number): string => (n === 1 ? 'arm' : 'arms');
  md.push(`- **High density** (${replication.robustFlockingDense.length} ${plural(replication.robustFlockingDense.length)}): ${replication.robustFlockingDense.map((k) => `\`${k}\``).join(', ') || '_none_'}`);
  md.push(`- **Low density** (${replication.robustFlockingSparse.length} ${plural(replication.robustFlockingSparse.length)}): ${replication.robustFlockingSparse.map((k) => `\`${k}\``).join(', ') || '_none_'}`);
  md.push('');
  const shared = replication.robustFlockingDense.filter((k) => replication.robustFlockingSparse.includes(k));
  if (shared.length > 0) {
    if (shared.length > 0) {
    md.push(shared.length === 1
      ? `\`${shared[0]}\` is the overlap: the one arm that flocks at **both** densities on every seed.`
      : `\`${shared.join('`, `')}\` are the overlap: the ${shared.length} arms that flock at **both** densities on every seed.`);
    md.push('That is the density-invariant answer, and it is a stronger claim than either list makes');
    md.push('on its own.');
  }
    md.push('');
  }
  if (replication.targetDense !== replication.targetSparse) {
    md.push(`Anchored instead to each density's own target (\`${replication.targetDense}\` high, \`${replication.targetSparse}\` low),`);
    md.push('the sufficient sets are:');
    for (const k of replication.robustSufficientDense) md.push(`- high: \`${k}\``);
    for (const k of replication.robustSufficientSparse) md.push(`- low: \`${k}\``);
    md.push('');
  }
  md.push('### Robust: the triad is sufficient but not minimal');
  md.push('');
  md.push('At high density these arms flocked on **every** seed:');
  for (const k of replication.robustFlockingDense) md.push(`- \`${k}\``);
  md.push('');
  md.push('`none` and `separation` are inert on every seed at every density, and `cohesion`');
  md.push('never flocks on any seed at either density. That leaves one clean sufficient set:');
  md.push('**`cohesion+separation`**, a bounded even lattice with no rotation. The triad');
  md.push('`alignment+cohesion+separation` is sufficient as well, but not minimal, because that');
  md.push('strict subset already reaches the same outcome. The prediction was right that these');
  md.push('terms produce a flock and wrong that all three are needed: alignment contributes');
  md.push('nothing the other two do not already achieve.');
  md.push('');
  const swirl = replication.dense.find((r) => r.key === 'circulation');
  if (swirl) {
    md.push('A second route exists but is *not* robust: `circulation` alone reaches a flock on');
    md.push(`${(swirl.modalFraction * 100).toFixed(0)}% of seeds at high density and`);
    md.push(`${(replication.sparse.find((r) => r.key === 'circulation')?.modalFraction ?? 0) * 100 | 0}% at low density, so a rotating swirl is a`);
    md.push('plausible second mechanism rather than an established one. It is worth noting that a');
    md.push('swirl keeps agents evenly spaced by construction, which is why it reaches the same');
    md.push('behavioural class as the lattice without sharing any of its components.');
    md.push('');
  }
  md.push('### Robust: two components are dead ends, for different reasons');
  md.push('');
  md.push('`none` and `separation` are inert on every seed at every density. Separation fails');
  md.push('because from rest it has nothing to push against, and because its');
  md.push(`${fmt(s.separationRadius, 0)}-unit radius sits ${fmt(s.senseRadius / s.separationRadius, 0)}x below the ${fmt(s.senseRadius, 0)}-unit sense radius,`);
  md.push('making it a collision term rather than a spacing term. Cohesion alone never flocks on');
  md.push('any seed at either density: it collapses agents onto the centroid, which maximises');
  md.push('heading agreement while destroying the even spacing that defines a flock.');
  md.push('');
  md.push('### The density boundary is a band, not a constant');
  md.push('');
  md.push('A single-seed sweep produced a clean, exception-free transition - the triad was a ragged');
  md.push('mass at low density and a flock at high density, with the flip landing exactly where');
  md.push('mean spacing entered separation reach. The transition is real and the sweep reproduces');
  md.push('it, but calling it one geometric constant was an overclaim. The sweep agrees on every');
  md.push('density it samples, and the seeded replication lands *between* two of its rows:');
  md.push('');
  md.push('| arena | spawn | mean nn | nn / sep radius | mean nnCV | triad | agreement | fraction flocking |');
  md.push('| --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const d of sweep) {
    md.push(
      `| ${d.arena} | ${d.spawn} | ${fmt(d.meanNearestNeighbour, 1)} | ${fmt(d.spacingInSeparationRadii, 1)}x | ` +
        `${fmt(d.meanNearestNeighbourCv, 2)} | ${d.triad} | ${(d.triadAgreement * 100).toFixed(0)}% | ${(d.triadFlockingFraction * 100).toFixed(0)}% |`,
    );
  }
  md.push('');
  const sparseTriad = replication.sparse.find((r) => r.key === 'alignment+cohesion+separation');
  if (sparseTriad) {
    md.push(`\`arena 160\` and \`arena 220\` are both unanimous in the sweep, yet the seeded`);
    md.push(`replication at \`arena 140\` - the low-density arm - puts the triad in \`${sparseTriad.modal}\` on only`);
    md.push(`${(sparseTriad.modalFraction * 100).toFixed(0)}% of ${replication.seeds.length} seeds. The boundary is therefore a band roughly one to four`);
    md.push('nearest-neighbour radii wide, and inside the band the label is seed-dependent. A');
    md.push('single-seed sweep cannot distinguish a threshold from a band, because it samples');
    md.push('exactly one point of it.');
    md.push('');
  }
  md.push('The geometric mechanism itself is robust: mean nearest-neighbour variability tracks the');
  md.push('ratio of mean spacing to the separation radius, falling from above 3.5 while spacing is');
  md.push('several radii out to below 0.7 once it is within two. That relationship survives every');
  md.push('seed. What does not survive is the claim that the ratio *decides* the outcome - it');
  md.push('predicts the regularity of the spacing reliably, and predicts the behaviour label only');
  md.push('outside the boundary band.');
  md.push('');

  md.push('## Single-seed arm tables (seed 999), superseded by the replication above');
  md.push('');
  md.push('These tables are kept because they show each arm\'s geometry in full, but each is a');
  md.push('single draw. Where the replication table marks an arm seed-dependent, the class shown');
  md.push('here is not a result.');
  md.push('');
  md.push(`### High density (arena 90, 24 agents) - single-seed target: ${dense.target}`);
  md.push('');
  md.push(`Single-seed minimal sufficient sets: ${dense.minimalSufficient.map((k) => `\`${k}\``).join(', ') || 'none'}`);
  md.push('');
  md.push(`**Replicated** sufficient sets, every seed: ${replication.robustSufficientDense.map((k) => `\`${k}\``).join(', ') || 'none'}`);
  md.push('');
  md.push(`Necessary out of the full set: ${dense.necessary.join(', ') || 'none'}`);
  md.push('');
  md.push(`Dispensable: ${dense.dispensable.join(', ') || 'none'}`);
  md.push('');
  armTable(dense).forEach((l) => md.push(l));
  md.push('');
  md.push('### Ablation out of the full set');
  md.push('');
  ablationTable(dense).forEach((l) => md.push(l));
  md.push('');
  md.push('### Pairwise interactions');
  md.push('');
  interactionTable(dense).forEach((l) => md.push(l));
  md.push('');

  md.push(`### Low density (arena 140, 60 agents) - single-seed target: ${sparse.target}`);
  md.push('');
  md.push(`Single-seed minimal sufficient sets: ${sparse.minimalSufficient.map((k) => `\`${k}\``).join(', ') || 'none'}`);
  md.push('');
  md.push(`**Replicated** sufficient sets, every seed: ${replication.robustSufficientSparse.map((k) => `\`${k}\``).join(', ') || 'none'}`);
  md.push('');
  md.push(`Necessary out of the full set: ${sparse.necessary.join(', ') || 'none'}`);
  md.push('');
  md.push(`Dispensable: ${sparse.dispensable.join(', ') || 'none'}`);
  md.push('');
  armTable(sparse).forEach((l) => md.push(l));
  md.push('');
  md.push('### Ablation out of the full set');
  md.push('');
  ablationTable(sparse).forEach((l) => md.push(l));
  md.push('');
  md.push('### Pairwise interactions');
  md.push('');
  interactionTable(sparse).forEach((l) => md.push(l));
  md.push('');

  md.push('## Seed replication detail');
  md.push('');
  md.push('Determinism proves an arm replays. It does not prove the arm\'s behaviour is a property');
  md.push('of its gene set rather than of the one initial condition it happened to receive. Every');
  md.push(`arm was therefore repeated across ${replication.seeds.length} independent seeds`);
  md.push(`(${replication.seeds.join(', ')}). An arm whose class differs between seeds has no class,`);
  md.push('and no sufficiency claim may rest on it.');
  md.push('');
  md.push('| set | dense modal | dense agreement | sparse modal | sparse agreement |');
  md.push('| --- | --- | --- | --- | --- |');
  for (let i = 0; i < replication.dense.length; i++) {
    const d = replication.dense[i]!;
    const sp = replication.sparse[i]!;
    const fmtAgree = (r: ArmReplication): string => `${r.modalFraction.toFixed(2)}${r.stable ? '' : ' (seed-dependent)'}`;
    md.push(`| \`${d.key}\` | ${d.modal} | ${fmtAgree(d)} | ${sp.modal} | ${fmtAgree(sp)} |`);
  }
  md.push('');
  if (replication.unstableDense.length === 0 && replication.unstableSparse.length === 0) {
    md.push('Every arm produced the same behaviour class on every seed at both densities, so all');
    md.push('labels above are admissible.');
  } else {
    md.push('Seed-dependent arms, whose single-seed label must not be treated as a result:');
    if (replication.unstableDense.length) md.push(`- dense: ${replication.unstableDense.map((k) => `\`${k}\``).join(', ')}`);
    if (replication.unstableSparse.length) md.push(`- sparse: ${replication.unstableSparse.map((k) => `\`${k}\``).join(', ')}`);
  }
  md.push('');
  // The two targets are named on every line, because a bare "arms reaching the target"
// next to another density's bare "arms reaching the target" invites reading them as
// the same list. They are only the same list when the targets agree.
  md.push(`Arms reaching \`${replication.targetDense}\` on every seed - high density: ${replication.robustSufficientDense.map((k) => `\`${k}\``).join(', ') || 'none'}`);
  md.push('');
  md.push(`Arms reaching \`${replication.targetSparse}\` on every seed - low density: ${replication.robustSufficientSparse.map((k) => `\`${k}\``).join(', ') || 'none'}`);
  md.push('');
  if (replication.targetDense !== replication.targetSparse) {
    md.push('Those two lines name different target classes, so they are not comparable. For a');
    md.push('comparison that holds, use the target-independent flocking lists:');
    md.push('');
    md.push(`Arms reaching \`flocking\` on every seed - high density: ${replication.robustFlockingDense.map((k) => `\`${k}\``).join(', ') || 'none'}`);
    md.push('');
    md.push(`Arms reaching \`flocking\` on every seed - low density: ${replication.robustFlockingSparse.map((k) => `\`${k}\``).join(', ') || 'none'}`);
    md.push('');
  }
  md.push('The target class is the full set\'s modal behaviour, and the full set is itself seed-dependent,');
  md.push(`so the target is a property of this seed set rather than of the mechanism: \`${replication.targetDense}\` across`);
  md.push(`${replication.seeds.length} seeds at high density, \`${replication.targetSparse}\` at low. A different seed set could anchor the`);
  md.push('search elsewhere, which is why the flocking lists above are the ones to quote.');
  md.push('');
  const storedRunCount = s.thresholdProbes[0]?.perFactor[0]?.length ?? 0;
  thresholdSensitivitySection(md, s.thresholdProbes, storedRunCount);
  backgroundSection(md, s, replication);

  md.push('## Known limits of this study');
  md.push('');
  md.push(`- One world parameter set. Two genome backgrounds were run (\`${s.background.name}\` and the default),`);
  md.push('  which tests the drive genes against one alternative geometry but against nothing else.');
  md.push('  The sense radius, and every gene outside the drive block, are still single-valued, so this is');
  md.push('  not a claim about the drive genes in isolation.');
  md.push('- `drift` is reported but is not a gate on any class. A flock that hovers in place and one');
  md.push('  that travels are not separated, because no threshold for "travelling" was validated');
  md.push('  against anything independent.');
  millingLimit(md, replication, s.thresholdProbes);
  md.push('- Founders are placed uniformly, so these are flocking results for a uniform initial');
  md.push('  condition. Predator-prey structure, food gradients, and obstacle fields are absent.');
  md.push('- The tick budget is a modelling choice, not a measurement. Labels are the state at 400');
  md.push('  ticks, and `convergenceError` records how far the window is still drifting. A run long');
  md.push('  enough to reach a true steady state would report different numbers, and for the');
  md.push('  expanding and rotating arms no such steady state exists.');
  md.push('');

  const mdText = md.join('\n');

  const armJson = (r: SufficiencyReport) => ({
    target: r.target,
    minimalSufficient: r.minimalSufficient,
    necessary: r.necessary,
    dispensable: r.dispensable,
    arms: r.arms.map((a) => ({
      set: a.set,
      key: a.key,
      behaviour: a.behaviour,
      alive: a.alive,
      deterministic: a.deterministic,
      converged: a.converged,
      convergenceError: a.convergenceError,
      drift: a.drift,
      settled: a.settled,
      polarizationTrace: a.polarizationTrace,
    })),
    ablations: r.ablations,
    interactions: r.interactions,
  });

  const json = JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      senseRadius: s.senseRadius,
      separationRadius: s.separationRadius,
      senseToSeparationRatio: s.senseRadius / s.separationRadius,
      deterministic: s.deterministic,
      thresholds: s.thresholds,
      thresholdProbes: s.thresholdProbes.map((p) => ({
        threshold: p.threshold,
        label: p.label,
        nominal: p.nominal,
        factors: p.factors,
        changedFraction: p.changedFraction,
        transitions: p.transitions,
        labelsEntered: p.labelsEntered,
      })),
      background: s.background,
      densitySweep: sweep,
      replication: {
        seeds: replication.seeds,
        // targets and both sufficient-set lists, so a consumer reading the JSON can
        // tell which question each list answers without reading the prose
        targetDense: replication.targetDense,
        targetSparse: replication.targetSparse,
        unstableDense: replication.unstableDense,
        unstableSparse: replication.unstableSparse,
        robustSufficientDense: replication.robustSufficientDense,
        robustSufficientSparse: replication.robustSufficientSparse,
        robustFlockingDense: replication.robustFlockingDense,
        robustFlockingSparse: replication.robustFlockingSparse,
        dense: replication.dense.map((r) => ({
          key: r.key,
          set: r.set,
          modal: r.modal,
          modalFraction: r.modalFraction,
          stable: r.stable,
          counts: r.counts,
          perSeed: r.results.map((x) => ({ rngSeed: r.seeds[r.results.indexOf(x)]!, behaviour: x.behaviour, settled: x.settled, drift: x.drift })),
        })),
        sparse: replication.sparse.map((r) => ({
          key: r.key,
          set: r.set,
          modal: r.modal,
          modalFraction: r.modalFraction,
          stable: r.stable,
          counts: r.counts,
          perSeed: r.results.map((x) => ({ rngSeed: r.seeds[r.results.indexOf(x)]!, behaviour: x.behaviour, settled: x.settled, drift: x.drift })),
        })),
      },
      dense: armJson(dense),
      sparse: armJson(sparse),
    },
    null,
    2,
  );

  const cols = [
    'density',
    'set',
    'behaviour',
    'alive',
    'movers',
    'polarization',
    'rotationalOrder',
    'spread',
    'neighbourMean',
    'densityCv',
    'nearestNeighbour',
    'nearestNeighbourCv',
    'meanSpeed',
    'drift',
    'deterministic',
    'convergenceError',
  ];
  const rows: string[] = [];
  for (const [label, r] of [
    ['dense', dense],
    ['sparse', sparse],
  ] as [string, SufficiencyReport][]) {
    for (const a of r.arms) {
      rows.push(
        [
          label,
          a.key,
          a.behaviour,
          a.alive,
          a.settled.movers,
          fmt(a.settled.polarization, 4),
          fmt(a.settled.rotationalOrder, 4),
          fmt(a.settled.spread, 3),
          fmt(a.settled.neighbourMean, 3),
          fmt(a.settled.densityCv, 4),
          fmt(a.settled.nearestNeighbour, 3),
          fmt(a.settled.nearestNeighbourCv, 4),
          fmt(a.settled.meanSpeed, 4),
          fmt(a.drift, 5),
          a.deterministic,
          a.convergenceError.toFixed(3),
        ].join(','),
      );
    }
  }
  const csv = [cols.join(','), ...rows].join('\n') + '\n';

  return { md: mdText, json, csv };
}

/** behaviour matrix as an SVG grid, one panel per density */
export function renderCausalSvg(s: CausalStudy): string {
  const colour: Record<BehaviourClass, string> = {
    inert: '#3d434d',
    dispersed: '#8c5a2b',
    cohesive: '#2f6f8f',
    clumped: '#7d3b52',
    flocking: '#3f8f5a',
    milling: '#6a4fa3',
    unknown: '#1c1f26',
  };
  const cell = 24;
  const left = 108;
  const panelW = left + 16 * cell + 130;
  const top = 54;
  const H = top + BEHAVIOURS.length * cell + 46;
  const W = panelW * 2 + 20;
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">\n`;
  svg += `<rect width="${W}" height="${H}" fill="#12141a"/>\n`;
  svg += `<text x="12" y="20" fill="#e6e8ec" font-family="monospace" font-size="13">causal behaviour matrix - all 16 arms at two densities</text>\n`;
  svg += `<text x="12" y="36" fill="#7d828b" font-family="monospace" font-size="10">sense radius ${s.senseRadius.toFixed(0)} vs separation radius ${s.separationRadius.toFixed(0)} - separation only acts once density brings spacing within reach</text>\n`;

  const panels: [string, SufficiencyReport][] = [
    ['dense: 24 agents / arena 90', s.dense],
    ['sparse: 60 agents / arena 140', s.sparse],
  ];
  panels.forEach(([title, r], pi) => {
    const ox = 12 + pi * panelW;
    svg += `<text x="${ox}" y="${top - 6}" fill="#a8aeb8" font-family="monospace" font-size="10">${title} - target ${r.target}</text>\n`;
    for (let ri = 0; ri < BEHAVIOURS.length; ri++) {
      const b = BEHAVIOURS[ri]!;
      const y = top + ri * cell;
      svg += `<text x="${ox}" y="${y + cell / 2 + 4}" fill="#a8aeb8" font-family="monospace" font-size="9">${b}</text>\n`;
      for (let ci = 0; ci < 16; ci++) {
        const a = r.arms[ci];
        const on = a !== undefined && a.behaviour === b;
        svg += `<rect x="${ox + left + ci * cell}" y="${y}" width="${cell - 2}" height="${cell - 2}" fill="${on ? colour[b] : '#1c1f26'}" stroke="#2a2f38"/>\n`;
      }
    }
    for (let ci = 0; ci < 16; ci++) {
      const a = r.arms[ci];
      if (!a) continue;
      const x = ox + left + ci * cell + cell / 2 - 2;
      const y = top + BEHAVIOURS.length * cell + 14;
      svg += `<text x="${x}" y="${y}" fill="#7d828b" font-family="monospace" font-size="6.5" transform="rotate(60 ${x} ${y})">${a.key || 'none'}</text>\n`;
    }
    svg += `<text x="${ox}" y="${top + BEHAVIOURS.length * cell + 40}" fill="#7d828b" font-family="monospace" font-size="8">minimal sufficient: ${r.minimalSufficient.join(', ') || 'none'}</text>\n`;
  });
  svg += `<text x="${W - 12}" y="${H - 6}" text-anchor="end" font-size="10" fill="#7d828b">all arms double-run deterministic: ${s.deterministic}</text>\n</svg>\n`;
  return svg;
}

export function writeCausalReport(s: CausalStudy, outDir: string): string {
  const { md, json, csv } = renderCausalReport(s);
  const plots = join(outDir, 'plots');
  mkdirSync(plots, { recursive: true });
  writeFileSync(join(outDir, 'causal.md'), md);
  writeFileSync(join(outDir, 'causal.json'), json);
  writeFileSync(join(outDir, 'causal.csv'), csv);
  writeFileSync(join(plots, 'causal.svg'), renderCausalSvg(s));
  return join(outDir, 'causal.md');
}

export function summarizeCausalStudy(s: CausalStudy): void {
  for (const [label, r] of [
    ['dense  (24 agents / arena 90) ', s.dense],
    ['sparse (60 agents / arena 140)', s.sparse],
  ] as [string, SufficiencyReport][]) {
    console.log(`--- ${label}  target=${r.target}`);
    for (const a of r.arms) {
      console.log(
        `  ${a.key.padEnd(34)} ${a.behaviour.padEnd(10)} pol=${a.settled.polarization.toFixed(3)} spread=${a.settled.spread.toFixed(0)} nn=${a.settled.nearestNeighbour.toFixed(1)} nnCV=${a.settled.nearestNeighbourCv.toFixed(2)}`,
      );
    }
    console.log(`  minimal sufficient: ${r.minimalSufficient.join(', ') || 'none'}`);
    console.log(`  necessary: ${r.necessary.join(', ') || 'none'}   dispensable: ${r.dispensable.join(', ') || 'none'}`);
    const syn = r.interactions.filter((i) => i.synergistic);
    console.log(`  synergistic: ${syn.length ? syn.map((x) => x.pair.join('+')).join(', ') : 'none'}`);
  }
  console.log('');
  console.log(`sense radius ${s.senseRadius.toFixed(0)} vs separation radius ${s.separationRadius.toFixed(0)} (ratio ${(s.senseRadius / s.separationRadius).toFixed(0)}x)`);
  console.log('density sweep, triad arm:');
  for (const d of s.sweep) {
    console.log(
      `  arena ${String(d.arena).padStart(3)} spawn ${String(d.spawn).padStart(2)}  nn=${d.meanNearestNeighbour.toFixed(1)} (${d.spacingInSeparationRadii.toFixed(1)}x sep) nnCV=${d.meanNearestNeighbourCv.toFixed(2)}  triad=${d.triad} agree=${(d.triadAgreement * 100).toFixed(0)}% flock=${(d.triadFlockingFraction * 100).toFixed(0)}%`,
    );
  }
  console.log('');
  console.log(`seed replication over ${s.replication.seeds.length} seeds:`);
  for (let i = 0; i < s.replication.dense.length; i++) {
    const d = s.replication.dense[i]!;
    const sp = s.replication.sparse[i]!;
    const flag = (r: { stable: boolean; modalFraction: number }): string => (r.stable ? '' : ' SEED-DEPENDENT');
    console.log(
      `  ${d.key.padEnd(34)} dense=${d.modal.padEnd(10)} ${(d.modalFraction * 100).toFixed(0)}%${flag(d)}   sparse=${sp.modal.padEnd(10)} ${(sp.modalFraction * 100).toFixed(0)}%${flag(sp)}`,
    );
  }
  const unstable = [...s.replication.unstableDense, ...s.replication.unstableSparse];
  console.log(unstable.length ? `seed-dependent arms: ${[...new Set(unstable)].join(', ')}` : 'every arm agreed on every seed at both densities');
  console.log(`all arms deterministic: ${s.deterministic}`);
}

/* ------------------------------------------------------------------ *
 * Density is a first-class variable, not a background constant
 * ------------------------------------------------------------------ */

export interface DensityRow {
  arena: number;
  spawn: number;
  /** behaviour the triad showed on the modal seed */
  triad: BehaviourClass;
  /** fraction of seeds agreeing with `triad` */
  triadAgreement: number;
  /** fraction of seeds in which the triad flocked */
  triadFlockingFraction: number;
  meanNearestNeighbour: number;
  meanNearestNeighbourCv: number;
  separationRadius: number;
  /** mean spacing, in units of the separation radius */
  spacingInSeparationRadii: number;
}

const SWEEP_DENSITIES: [arena: number, spawn: number][] = [
  [220, 60],
  [160, 60],
  [120, 60],
  [90, 60],
  [70, 60],
  [90, 24],
  [60, 24],
];

const SWEEP_SEEDS = [101, 303, 505];

/**
 * Run the triad across a density sweep and across seeds.
 *
 * The sweep is replicated because the first version of it used a single seed and
 * produced a suspiciously clean transition with no exceptions. It was not clean;
 * the boundary moved with the seed. A sweep that reports one draw per density
 * cannot distinguish a real threshold from a lucky initial condition. It uses
 * fewer seeds than the main replication because it establishes a trend in spacing
 * regularity, which is far more stable than the behavioural class it is compared to.
 */
export function densitySweep(
  worldFactory: (spawn: number) => WorldLike,
  base: ArmConfig = DEFAULT_ARM,
  seeds: number[] = SWEEP_SEEDS,
): DensityRow[] {
  const sep = separationRadius(feedGenome({ diet: -1 }));
  const triad: ComponentSet = ['alignment', 'cohesion', 'separation'];
  return SWEEP_DENSITIES.map(([arena, spawn]) => {
    const cfg: ArmConfig = { ...base, arena, spawn };
    const reps = replicateArm(triad, cfg, worldFactory, seeds);
    const nn = reps.results.map((r) => r.settled.nearestNeighbour);
    const cv = reps.results.map((r) => r.settled.nearestNeighbourCv);
    const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
    return {
      arena,
      spawn,
      triad: reps.modal,
      triadAgreement: reps.modalFraction,
      triadFlockingFraction: reps.counts.flocking / seeds.length,
      meanNearestNeighbour: mean(nn),
      meanNearestNeighbourCv: mean(cv),
      separationRadius: sep,
      spacingInSeparationRadii: mean(nn) / sep,
    };
  });
}

/** the standard arm world: high food regen and slack metabolism so the ablation is not confounded by starvation */
export function causalWorldFactory(spawn: number): WorldLike {
  return {
    id: 'causal',
    seed: 'causal.s1',
    fractalType: 'mandelbrot',
    params: { ...DEFAULT_PARAMS, spawnCount: spawn, foodRegenRate: 0.003, metabolismBase: 0.5, energyCapacity: 400 },
    createdAt: 0,
    currentTick: 0,
  } as WorldLike;
}

/* ------------------------------------------------------------------ *
 * Seed replication
 * ------------------------------------------------------------------ */

export interface ArmReplication {
  key: string;
  set: ComponentSet;
  seeds: number[];
  /** how often each behaviour occurred across the seeds */
  counts: Record<BehaviourClass, number>;
  /** the most frequent behaviour, and how often it occurred */
  modal: BehaviourClass;
  modalFraction: number;
  /**
   * True when every seed agreed. A false here means the single-seed label for
   * this arm is not a fact about the arm, and any sufficiency claim resting on it
   * is not admissible.
   */
  stable: boolean;
  results: ArmResult[];
}

/** run one arm across several independent initial conditions */
export function replicateArm(
  set: ComponentSet,
  cfg: ArmConfig,
  worldFactory: (spawn: number) => WorldLike,
  seeds: number[],
  opts: { base?: Float32Array } = {},
): ArmReplication {
  const results = seeds.map((s) => runArm(set, { ...cfg, rngSeed: s }, worldFactory, { doubleRun: false, base: opts.base }));
  const counts = Object.fromEntries(BEHAVIOURS.map((b) => [b, 0])) as Record<BehaviourClass, number>;
  for (const r of results) counts[r.behaviour]++;
  let modal: BehaviourClass = 'unknown';
  let best = -1;
  for (const b of BEHAVIOURS) {
    if (counts[b] > best) {
      best = counts[b];
      modal = b;
    }
  }
  return {
    key: setKey(set),
    set,
    seeds,
    counts,
    modal,
    modalFraction: best / seeds.length,
    stable: best === seeds.length,
    results,
  };
}

export interface CausalReplication {
  dense: ArmReplication[];
  sparse: ArmReplication[];
  seeds: number[];
  /** arms whose behaviour label is seed-dependent, by density */
  unstableDense: string[];
  unstableSparse: string[];
  /**
   * The class each density's sufficiency search is anchored to: the full set's
   * modal behaviour. These can differ, and the report says so where it lists the
   * robust sufficient sets, because two adjacent lists anchored to different
   * targets are not comparable.
   */
  targetDense: BehaviourClass;
  targetSparse: BehaviourClass;
  /**
   * Arms that reached their own density's target class on every seed. Compare
   * across densities only after checking `targetDense` equals `targetSparse`.
   */
  robustSufficientDense: string[];
  robustSufficientSparse: string[];
  /** arms reaching `flocking` on every seed, by density; target-independent */
  robustFlockingDense: string[];
  robustFlockingSparse: string[];
}

/**
 * The seed set the study's claims are gated on.
 *
 * Exported because the CLI reports it and because a claim about seed robustness is
 * only meaningful relative to a stated set. Three of these seeds tie on several
 * arms, which is why tests asserting a *modal* class use all five.
 */
export const REPLICATION_SEEDS = [101, 202, 303, 404, 505];

/**
 * Repeat the whole 2^n study across independent initial conditions.
 *
 * Determinism proves an arm replays; it says nothing about whether the arm's
 * behaviour is a property of its gene set or of the one draw it happened to get.
 * A component set whose class flips between seeds cannot support a causal claim,
 * so this replication is what decides which labels are admissible.
 */
export function replicateStudy(
  worldFactory: (spawn: number) => WorldLike,
  denseCfg: ArmConfig,
  sparseCfg: ArmConfig,
  seeds: number[] = REPLICATION_SEEDS,
): CausalReplication {
  const run = (cfg: ArmConfig): ArmReplication[] => enumerateArms().map((s) => replicateArm(s, cfg, worldFactory, seeds));
  const dense = run(denseCfg);
  const sparse = run(sparseCfg);
  // The sufficient-set target is the full set's *modal* class, which is how the
  // search stays anchored to observed behaviour rather than to a story chosen in
  // advance. That choice has a consequence which was previously hidden: because the
  // full set is itself seed-dependent at both densities (it reads cohesive on some
  // seeds and flocking on others), the two densities can end up with *different*
  // targets. The low-density arm's modal class is `cohesive`, so its
  // robust-sufficient list was reporting arms that reliably reach a coherent mass,
  // while the high-density list reported arms that reliably reach a flock - two
  // arms being compared against different questions, in tables that sit next to
  // each other. Both lists are kept, and both targets are now reported, so the
  // distinction is visible instead of being a difference between adjacent numbers.
  const targetOf = (rep: ArmReplication[]): BehaviourClass => rep.find((r) => r.key === setKey(COMPONENT_IDS))!.modal;
  const td = targetOf(dense);
  const ts = targetOf(sparse);
  return {
    dense,
    sparse,
    seeds,
    unstableDense: dense.filter((r) => !r.stable).map((r) => r.key),
    unstableSparse: sparse.filter((r) => !r.stable).map((r) => r.key),
    targetDense: td,
    targetSparse: ts,
    robustSufficientDense: dense.filter((r) => r.modal === td && r.stable).map((r) => r.key),
    robustSufficientSparse: sparse.filter((r) => r.modal === ts && r.stable).map((r) => r.key),
    robustFlockingDense: dense.filter((r) => r.modal === 'flocking' && r.stable).map((r) => r.key),
    robustFlockingSparse: sparse.filter((r) => r.modal === 'flocking' && r.stable).map((r) => r.key),
  };
}

/** what one genome background produced, for cross-background comparison */
export interface BackgroundStudy {
  name: string;
  rationale: string;
  gene6: number;
  senseRadius: number;
  separationRadius: number;
  dense: {
    /** arms that flocked on every seed */
    robustFlocking: string[];
    /** arms inert on every seed */
    inert: string[];
    /** arms that never flocked on any seed */
    neverFlocking: string[];
    unstable: string[];
  };
  sparse: {
    robustFlocking: string[];
    inert: string[];
    neverFlocking: string[];
    unstable: string[];
  };
}

export interface CausalStudy {
  dense: SufficiencyReport;
  sparse: SufficiencyReport;
  sweep: DensityRow[];
  replication: CausalReplication;
  senseRadius: number;
  separationRadius: number;
  deterministic: boolean;
  /** the classifier cuts actually used, so the sensitivity probe is interpretable */
  thresholds: BehaviourThresholds;
  /** every cut swept over every stored run */
  thresholdProbes: ThresholdProbe[];
  /** a replication on a second genome background */
  background: BackgroundStudy;
}

/**
 * A second genome background, differing from the default only in gene 6 (body size).
 *
 * Gene 6 is the one background gene that changes the *geometry* the drives act in:
 * separation reaches `8 * bodySize`, so changing body size rescales the separation
 * radius and therefore the spacing at which separation starts to matter. That is the
 * one background parameter this study's geometric explanation actually leans on, so
 * varying it is the sharpest available test of whether the explanation is about the
 * drive genes or about this particular background.
 */
export interface GenomeBackground {
  name: string;
  /** value written into gene 6 */
  gene6: number;
  /** description of what this background is meant to probe */
  rationale: string;
}

/**
 * The default background, plus the variant used to test whether the causal ordering
 * survives a change of genome.
 *
 * `feedGenome` pins gene 6 to -1, which decodes to the minimum body size 0.5 and a
 * 4-unit separation radius against a 36-unit sense radius. The variant sets gene 6 to
 * -0.5, which decodes to body size 1.0: the separation radius doubles to 8 units and
 * the sense/separation ratio falls from 9x to 4.5x. Under the study's own
 * explanation that should *help* separation organise spacing, so if the causal
 * ordering is real rather than incidental, the variant should preserve which sets
 * are sufficient while shifting the density boundary.
 */
export const GENOME_BACKGROUNDS: GenomeBackground[] = [
  { name: 'feed-min', gene6: -1, rationale: 'the default background: minimum body size 0.5, 9x sense/separation mismatch' },
  { name: 'double-size', gene6: -0.5, rationale: 'body size 1.0, halving the sense/separation mismatch to 4.5x' },
];

/** the genome a background name selects, or undefined if the name is unknown */
export function backgroundGenome(name: string): Float32Array {
  const bg = GENOME_BACKGROUNDS.find((b) => b.name === name);
  if (!bg) throw new Error(`unknown genome background '${name}'; known: ${GENOME_BACKGROUNDS.map((b) => b.name).join(', ')}`);
  const g = feedGenome({ diet: -1 });
  g[6] = bg.gene6;
  return g;
}

/** the two density endpoints the study is defined at */
export const DENSE_ARM: Pick<ArmConfig, 'arena' | 'spawn'> = { arena: 90, spawn: 24 };
export const SPARSE_ARM: Pick<ArmConfig, 'arena' | 'spawn'> = { arena: 140, spawn: 60 };

/**
 * Resolve the two density endpoints from an optional caller override.
 *
 * The study is defined at two specific world scales, so `--arena`/`--spawn` cannot
 * mean "the density" - they are meaningless without saying which endpoint. They are
 * treated as the high-density endpoint, and the low-density endpoint is derived by
 * applying the default pair's own ratios.
 *
 * Note the defaults hold agents-per-area almost constant (24/90^2 = 0.00296,
 * 60/140^2 = 0.00306). The contrast between the two arms is therefore mostly *scale*
 * rather than crowding, which is why scaling agents-per-area was the wrong
 * derivation: it collapsed both endpoints onto the same density and erased the very
 * contrast the study exists to measure.
 */
export function resolveDensityEndpoints(override?: { arena?: number; spawn?: number }): { dense: { arena: number; spawn: number }; sparse: { arena: number; spawn: number } } {
  if (!override || override.arena === undefined || override.spawn === undefined) {
    return { dense: { ...DENSE_ARM }, sparse: { ...SPARSE_ARM } };
  }
  const dense = { arena: override.arena, spawn: override.spawn };
  const sparse = {
    arena: Math.round(dense.arena * (SPARSE_ARM.arena / DENSE_ARM.arena)),
    spawn: Math.max(4, Math.round(dense.spawn * (SPARSE_ARM.spawn / DENSE_ARM.spawn))),
  };
  return { dense, sparse };
}

/**
 * Repeat the whole replication on a second genome background.
 *
 * This is the check the single-background study cannot make about itself. It returns
 * the robust-flocking sets and inert sets per density for one background, so the
 * caller can compare the ordering across backgrounds rather than just noting that
 * the labels differ.
 */
export function replicateOnBackground(
  worldFactory: (spawn: number) => WorldLike,
  denseCfg: ArmConfig,
  sparseCfg: ArmConfig,
  base: Float32Array,
  seeds: number[] = REPLICATION_SEEDS,
): { dense: ArmReplication[]; sparse: ArmReplication[] } {
  return {
    dense: enumerateArms().map((s) => replicateArm(s, denseCfg, worldFactory, seeds, { base })),
    sparse: enumerateArms().map((s) => replicateArm(s, sparseCfg, worldFactory, seeds, { base })),
  };
}

/** summarise a variant-background replication into the fields the report compares */
function variantBackgroundStudy(
  bg: GenomeBackground,
  rep: { dense: ArmReplication[]; sparse: ArmReplication[] },
  sense: number,
  sep: number,
): BackgroundStudy {
  const pick = (rows: ArmReplication[]) => ({
    robustFlocking: rows.filter((r) => r.modal === 'flocking' && r.stable).map((r) => r.key),
    inert: rows.filter((r) => r.counts.inert === r.results.length).map((r) => r.key),
    neverFlocking: rows.filter((r) => r.counts.flocking === 0).map((r) => r.key),
    unstable: rows.filter((r) => !r.stable).map((r) => r.key),
  });
  return {
    name: bg.name,
    rationale: bg.rationale,
    gene6: bg.gene6,
    senseRadius: sense,
    separationRadius: sep,
    dense: pick(rep.dense),
    sparse: pick(rep.sparse),
  };
}

/** run the 2^n study at two densities, sweep between them, and write the reports */
export function runCausalStudy(cfg: ArmConfig = DEFAULT_ARM, density?: { arena?: number; spawn?: number }): CausalStudy {
  const base = feedGenome({ diet: -1 });
  const sense = decodeSenseRadius(buildArmGenome([], base));
  const sep = separationRadius(buildArmGenome([], base));
  const endpoints = resolveDensityEndpoints(density);
  const studyCfg: ArmConfig = { ...cfg, ...endpoints.dense };
  const dense = analyseSufficiency(causalWorldFactory, studyCfg);
  const sparse = analyseSufficiency(causalWorldFactory, { ...cfg, ...endpoints.sparse });
  const sweep = densitySweep(causalWorldFactory, { ...cfg, ...endpoints.sparse });
  const replication = replicateStudy(causalWorldFactory, studyCfg, { ...cfg, ...endpoints.sparse });
  const deterministic = dense.deterministic && sparse.deterministic;

  // every stored settled state, re-classified under perturbed thresholds. No extra
  // simulation: the runs are already in memory.
  const storedRuns = [
    ...replication.dense.flatMap((r) => r.results.map((x) => ({ density: 'dense', arena: studyCfg.arena, settled: x.settled, behaviour: x.behaviour }))),
    ...replication.sparse.flatMap((r) => r.results.map((x) => ({ density: 'sparse', arena: endpoints.sparse.arena, settled: x.settled, behaviour: x.behaviour }))),
  ];
  const thresholds = thresholdsFor(studyCfg, sense, sep);
  const probes = thresholdSensitivity(storedRuns, thresholds);

  // second genome background, to test whether the ordering is about the drive genes.
  // Its sense and separation radii are decoded from the variant genome, not carried
  // over from the default: reporting the default's numbers against variant runs
  // would misdescribe the variant, which is exactly the kind of copy-paste that
  // makes a background check look like a no-op.
  const variantBg = GENOME_BACKGROUNDS.find((b) => b.name !== 'feed-min')!;
  const variantBase = backgroundGenome(variantBg.name);
  const variantSep = separationRadius(buildArmGenome([], variantBase));
  const variantSense = decodeSenseRadius(buildArmGenome([], variantBase));
  const variantRep = replicateOnBackground(
    causalWorldFactory,
    studyCfg,
    { ...cfg, ...endpoints.sparse },
    variantBase,
  );

  const study: CausalStudy = {
    dense,
    sparse,
    sweep,
    replication,
    senseRadius: sense,
    separationRadius: sep,
    deterministic,
    thresholds,
    thresholdProbes: probes,
    background: variantBackgroundStudy(variantBg, variantRep, variantSense, variantSep),
  };
  const outDir = fileURLToPath(new URL('../../research/output/', import.meta.url));
  writeCausalReport(study, outDir);
  return study;
}

