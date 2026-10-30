/**
 * Experiment A - Evolutionary doomsday.
 *
 * Question: can a system that evolves to maximise reproduction become *more*
 * fragile? The model is a Life-like cellular automaton on a 32x32 torus. The
 * heritable unit is the rule (18 bits: birth counts B0..B8, survival counts
 * S0..S8, B0 forbidden), not the individual cell: a rule's "offspring count" is
 * the number of 0 -> 1 transitions it produces.
 *
 * Pipeline:
 *   1. sample a viable ancestor rule (Conway + 1..3 bit flips, viability-gated);
 *   2. evolve a population of 16 rules for 24 generations in a *fixed*
 *      environment, selecting on births counted after a warm-up (so a rule that
 *      fills the lattice once and then freezes scores 0, not infinity);
 *   3. run a paired control lineage from the same ancestor with **no
 *      reproduction-based selection** (a viability-filtered neutral walk);
 *   4. assay the ancestor and the endpoint under three sudden shocks:
 *      per-cell noise, a one-off mortality pulse, and a compute budget that
 *      updates only a fraction of cells per tick;
 *   5. report the reproduction/robustness trade-off curve and the conditions
 *      under which it does or does not appear.
 *
 * Nothing here touches the agent engine. This is a self-contained research
 * model; `docs/CLAIMS.md` (A-DOOM-01..04) holds the pre-registered analysis.
 */
import { fnv1a32 } from '@fractal-life/shared';
import { bootstrapCI, mean, median, mulberry32, quantile } from './stats.js';

/* ------------------------------------------------------------------ rules -- */

export const RULE_BITS = 18;
export const ALL_RULE_BITS = (1 << RULE_BITS) - 1;
/** B0 is forbidden: a dead cell with no neighbours must not be born. */
export const LEGAL_RULE_MASK = ALL_RULE_BITS & ~1;
/** Conway B3/S23, the canonical reference rule. */
export const CONWAY = (1 << 3) | (1 << (9 + 2)) | (1 << (9 + 3));

export function birthsAt(rule: number, n: number): boolean {
  return (rule & (1 << n)) !== 0;
}

export function survivesAt(rule: number, n: number): boolean {
  return (rule & (1 << (9 + n))) !== 0;
}

/** Human-readable B/S notation, e.g. `B3/S23`. */
export function ruleLabel(rule: number): string {
  let b = '';
  let s = '';
  for (let n = 0; n <= 8; n++) {
    if (birthsAt(rule, n)) b += String(n);
    if (survivesAt(rule, n)) s += String(n);
  }
  return `B${b || '-'}/S${s || '-'}`;
}

export function hamming(a: number, b: number): number {
  let x = (a ^ b) & ALL_RULE_BITS;
  let n = 0;
  while (x) {
    x &= x - 1;
    n++;
  }
  return n;
}

/** Flip each bit with probability `p`; B0 is forced off. */
export function mutateRule(rule: number, rng: () => number, p = 1 / RULE_BITS): number {
  let out = rule;
  for (let i = 0; i < RULE_BITS; i++) {
    if (i === 0) continue;
    if (rng() < p) out ^= 1 << i;
  }
  // a mutation that flips nothing is not a mutation: flip one random legal bit
  if (out === rule) out ^= 1 << (1 + Math.floor(rng() * (RULE_BITS - 1)));
  return out & LEGAL_RULE_MASK;
}

/* -------------------------------------------------------------------- CA --- */

export interface StepOptions {
  /** per-cell flip probability applied after the rule */
  noise?: number;
  /** fraction of cells updated per tick (1 = fully synchronous) */
  partial?: number;
  /** required when noise > 0 or partial < 1 */
  rng?: () => number;
}

export interface StepCounts {
  births: number;
  deaths: number;
  alive: number;
}

/** A square toroidal Life-like CA with reusable buffers. */
export class LifeCA {
  readonly size: number;
  readonly total: number;
  private buf: Uint8Array;
  private alt: Uint8Array;
  private readonly nbr: Int32Array;

  constructor(size: number) {
    this.size = size;
    this.total = size * size;
    this.buf = new Uint8Array(this.total);
    this.alt = new Uint8Array(this.total);
    this.nbr = buildNeighbourTable(size);
  }

  get state(): Uint8Array {
    return this.buf;
  }

  /** The state before the most recent `step` (used to detect births). */
  get previous(): Uint8Array {
    return this.alt;
  }

  load(state: Uint8Array): void {
    if (state.length !== this.total) throw new RangeError(`state length ${state.length} != ${this.total}`);
    this.buf.set(state);
  }

  snapshot(): Uint8Array {
    return this.buf.slice();
  }

  /** Deterministic soup with the requested density. */
  setSoup(seed: number, density = 0.3): void {
    const rng = mulberry32(seed);
    for (let i = 0; i < this.total; i++) this.buf[i] = rng() < density ? 1 : 0;
  }

  alive(): number {
    let n = 0;
    for (let i = 0; i < this.total; i++) n += this.buf[i];
    return n;
  }

  /** Kill each alive cell independently with probability `m`; returns the count. */
  killFraction(m: number, rng: () => number): number {
    let killed = 0;
    if (m <= 0) return 0;
    if (m >= 1) {
      killed = this.alive();
      this.buf.fill(0);
      return killed;
    }
    const c = this.buf;
    for (let i = 0; i < this.total; i++) {
      if (c[i] && rng() < m) {
        c[i] = 0;
        killed++;
      }
    }
    return killed;
  }

  step(rule: number, opts: StepOptions = {}): StepCounts {
    const noise = opts.noise ?? 0;
    const partial = opts.partial ?? 1;
    if (noise <= 0 && partial >= 1) return this.stepPlain(rule);
    return this.stepShocked(rule, noise, partial, opts.rng);
  }

  private stepPlain(rule: number): StepCounts {
    const c = this.buf;
    const n = this.alt;
    const nb = this.nbr;
    const total = this.total;
    for (let i = 0; i < total; i++) {
      const b = i << 3;
      const k =
        c[nb[b]] + c[nb[b + 1]] + c[nb[b + 2]] + c[nb[b + 3]] +
        c[nb[b + 4]] + c[nb[b + 5]] + c[nb[b + 6]] + c[nb[b + 7]];
      n[i] = c[i] ? (rule >>> (9 + k)) & 1 : (rule >>> k) & 1;
    }
    let births = 0;
    let deaths = 0;
    let alive = 0;
    for (let i = 0; i < total; i++) {
      const a = c[i];
      const v = n[i];
      if (a !== v) {
        if (v) births++;
        else deaths++;
      }
      alive += v;
    }
    this.buf = n;
    this.alt = c;
    return { births, deaths, alive };
  }

  private stepShocked(rule: number, noise: number, partial: number, rng?: () => number): StepCounts {
    if (!rng) throw new RangeError('LifeCA.step: noise/partial requires an rng');
    const c = this.buf;
    const n = this.alt;
    const nb = this.nbr;
    const total = this.total;
    const full = partial >= 1;
    let births = 0;
    let deaths = 0;
    let alive = 0;
    for (let i = 0; i < total; i++) {
      if (!full && rng() >= partial) {
        n[i] = c[i];
        alive += c[i];
        continue;
      }
      const b = i << 3;
      const k =
        c[nb[b]] + c[nb[b + 1]] + c[nb[b + 2]] + c[nb[b + 3]] +
        c[nb[b + 4]] + c[nb[b + 5]] + c[nb[b + 6]] + c[nb[b + 7]];
      let v = c[i] ? (rule >>> (9 + k)) & 1 : (rule >>> k) & 1;
      if (noise > 0 && rng() < noise) v ^= 1;
      n[i] = v;
      const a = c[i];
      if (a !== v) {
        if (v) births++;
        else deaths++;
      }
      alive += v;
    }
    this.buf = n;
    this.alt = c;
    return { births, deaths, alive };
  }
}

function buildNeighbourTable(size: number): Int32Array {
  const total = size * size;
  const out = new Int32Array(total * 8);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let k = (y * size + x) * 8;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const xx = (x + dx + size) % size;
          const yy = (y + dy + size) % size;
          out[k++] = yy * size + xx;
        }
      }
    }
  }
  return out;
}

/* ------------------------------------------------------------- model knobs -- */

export const DD_SIZE = 32;
export const DD_CELLS = DD_SIZE * DD_SIZE;
export const DD_SOUP_DENSITY = 0.3;
/** ticks run before births are counted (the rule must reach an attractor) */
export const DD_BURN = 60;
/** birth-counting window: the reproduction score is counted over these ticks */
export const DD_TRAIN = 80;
/**
 * A birth counts as an offspring only if the cell is still alive this many
 * ticks later. Without this, selection converges on the period-2 rule that
 * flips the whole lattice (40,960 raw births = the hard ceiling) and the
 * reproduction axis saturates; the pilot run that discovered this is recorded
 * in docs/CLAIMS.md. Surviving offspring is also the more literal reading of
 * "maximise the number of descendants".
 */
export const DD_MATURITY = 5;
export const DD_POP = 14;
export const DD_GENS = 20;
export const DD_LINEAGES = 8;
export const DD_MUTATION = 1 / RULE_BITS;

export const DD_TRAIN_SEEDS = 2;
export const DD_HELD_SEEDS = 2;
export const DD_ASSAY_REPLICATES = 3;

/** assay: warm-up, shock duration, and the tail averaged for the endpoint */
export const DD_WARM = 100;
export const DD_SHOCK_TICKS = 150;
export const DD_TAIL = 30;
/**
 * Minimum live population before the shock for a retention ratio to be
 * defined. Below ~32 cells the pre-shock population is a handful of cells and
 * the ratio is dominated by stochastic amplification: a 3-cell ancestor can
 * score a "retention" of 9.7 by growing after the pulse. Those replicates are
 * dropped rather than allowed to set the scale of the robustness axis.
 */
export const DD_MIN_PREPOP = 32;

export type Arm = 'drift' | 'weak' | 'moderate' | 'strong';
export type Family = 'noise' | 'death' | 'compute';
/**
 * What selection maximises. `births` is the literal offspring count (0 -> 1
 * transitions); `established` counts only newborn cells that survive
 * `DD_MATURITY` ticks. The first is the primary endpoint; the second is a
 * definitional robustness check, because raw births saturate at the period-2
 * flipper.
 */
export type FitnessMode = 'births' | 'established';

/** Minimum retention cost that counts as a meaningful fragility effect. */
export const DD_MEANINGFUL_COST = 0.1;

export interface ArmDef {
  id: Arm;
  label: string;
  /** fraction of the population retained per generation; 0 = no selection */
  top: number;
}

export const ARMS: readonly ArmDef[] = [
  { id: 'drift', label: 'drift (no selection)', top: 0 },
  { id: 'weak', label: 'weak (top 50%)', top: 0.5 },
  { id: 'moderate', label: 'moderate (top 25%)', top: 0.25 },
  { id: 'strong', label: 'strong (top 12.5%)', top: 0.125 },
];

export const DOSE: Record<Arm, number> = { drift: 0, weak: 1, moderate: 2, strong: 3 };

export const SHOCKS: Readonly<Record<Family, readonly number[]>> = {
  noise: [0.002, 0.01, 0.05],
  death: [0.2, 0.5, 0.8],
  compute: [0.5, 0.25, 0.1],
};

export const FAMILIES: readonly Family[] = ['noise', 'death', 'compute'];

/* ------------------------------------------------------------------ score -- */

export interface Score {
  /** total 0 -> 1 transitions in the counted window (raw births) */
  births: number;
  /** births that were still alive `maturity` ticks later (the selection score) */
  established: number;
  deaths: number;
  /** mean live cells during the counted window */
  meanAlive: number;
  birthsPerCellTick: number;
  establishedPerCellTick: number;
  turnoverPerCellTick: number;
  /** survives the warm-up and produces at least one birth */
  viable: boolean;
}

export interface ReproductionOptions {
  burn?: number;
  train?: number;
  maturity?: number;
}

/**
 * Reproduction score of a rule on one initial condition: warm up, then count
 * births that survive to maturity. A rule that freezes after filling the
 * lattice scores 0, and so does a period-2 global flipper: neither leaves
 * descendants behind.
 */
export function reproductionScore(
  rule: number,
  seed: string,
  ca: LifeCA,
  opts: ReproductionOptions = {},
): Score {
  const burn = opts.burn ?? DD_BURN;
  const train = opts.train ?? DD_TRAIN;
  const maturity = opts.maturity ?? DD_MATURITY;
  ca.setSoup(fnv1a32(`${seed}:soup`), DD_SOUP_DENSITY);
  for (let t = 0; t < burn; t++) ca.step(rule);
  if (ca.alive() === 0) {
    return {
      births: 0,
      established: 0,
      deaths: 0,
      meanAlive: 0,
      birthsPerCellTick: 0,
      establishedPerCellTick: 0,
      turnoverPerCellTick: 0,
      viable: false,
    };
  }
  let births = 0;
  let established = 0;
  let deaths = 0;
  let aliveSum = 0;
  const birthTick = new Int32Array(ca.total).fill(-1);
  for (let t = 0; t < train + maturity; t++) {
    const s = ca.step(rule);
    const cur = ca.state;
    const prev = ca.previous;
    for (let i = 0; i < ca.total; i++) {
      if (!cur[i]) {
        birthTick[i] = -1;
        continue;
      }
      if (!prev[i]) birthTick[i] = t;
      const born = birthTick[i]!;
      if (born >= 0 && born < train && t - born === maturity) {
        established++;
        birthTick[i] = -1;
      }
    }
    if (t < train) {
      births += s.births;
      deaths += s.deaths;
      aliveSum += s.alive;
    }
  }
  const meanAlive = aliveSum / train;
  return {
    births,
    established,
    deaths,
    meanAlive,
    birthsPerCellTick: births / (train * ca.total),
    establishedPerCellTick: established / (train * ca.total),
    turnoverPerCellTick: (births + deaths) / (train * ca.total),
    viable: births > 0 && meanAlive > 0,
  };
}

/** Mean reproduction score over several initial conditions. */
export function scoreRule(rule: number, seeds: readonly string[], ca: LifeCA): Score {
  if (seeds.length === 0) throw new RangeError('scoreRule: need >= 1 seed');
  const parts = seeds.map((s) => reproductionScore(rule, s, ca));
  return {
    births: mean(parts.map((p) => p.births)),
    established: mean(parts.map((p) => p.established)),
    deaths: mean(parts.map((p) => p.deaths)),
    meanAlive: mean(parts.map((p) => p.meanAlive)),
    birthsPerCellTick: mean(parts.map((p) => p.birthsPerCellTick)),
    establishedPerCellTick: mean(parts.map((p) => p.establishedPerCellTick)),
    turnoverPerCellTick: mean(parts.map((p) => p.turnoverPerCellTick)),
    viable: parts.every((p) => p.viable),
  };
}

/* --------------------------------------------------------------- ancestor -- */

/**
 * The ancestor pool is Conway plus 1-3 random bit flips, rejection-sampled for
 * viability. Starting from a rule that already reproduces is deliberate: the
 * experiment is about what selection does to a working replicator, not about
 * whether selection can find life from a random rule table.
 */
export function sampleAncestor(seed: string, ca: LifeCA): number {
  const rng = mulberry32(fnv1a32(`${seed}:ancestor`));
  for (let attempt = 0; attempt < 512; attempt++) {
    const flips = 1 + Math.floor(rng() * 3);
    let rule = CONWAY;
    for (let j = 0; j < flips; j++) {
      const bit = 1 << (1 + Math.floor(rng() * (RULE_BITS - 1)));
      rule ^= bit;
    }
    rule &= LEGAL_RULE_MASK;
    const s = reproductionScore(rule, `${seed}:viability`, ca);
    if (s.viable) return rule;
  }
  return CONWAY;
}

/* ------------------------------------------------------------- generations -- */

export interface GenerationPoint {
  gen: number;
  bestFitness: number;
  meanFitness: number;
  bestRule: number;
  /** mean Hamming distance of the population from the ancestor */
  meanDistance: number;
}

export interface LineageResult {
  id: string;
  seed: string;
  arm: Arm;
  dose: number;
  fitness: FitnessMode;
  ancestor: number;
  final: number;
  distance: number;
  generations: GenerationPoint[];
  trainAncestor: Score;
  trainFinal: Score;
  heldAncestor: Score;
  heldFinal: Score;
  /** mean realised selection differential (selected parents minus population) */
  selectionDifferential: number;
  assays: { ancestor: RuleRobustness; final: RuleRobustness };
}

function seededRng(seed: string): () => number {
  return mulberry32(fnv1a32(seed));
}

function trainSeeds(lineageSeed: string): string[] {
  return Array.from({ length: DD_TRAIN_SEEDS }, (_, i) => `${lineageSeed}:train:${i}`);
}

function heldSeeds(lineageSeed: string): string[] {
  return Array.from({ length: DD_HELD_SEEDS }, (_, i) => `${lineageSeed}:held:${i}`);
}

function pickUniform<T>(xs: readonly T[], n: number, rng: () => number): T[] {
  const out: T[] = [];
  for (let i = 0; i < n; i++) out.push(xs[Math.floor(rng() * xs.length)]);
  return out;
}

export interface EvolveOptions {
  gens?: number;
  pop?: number;
  size?: number;
  /** what selection maximises: raw births (default) or surviving offspring */
  fitness?: FitnessMode;
  /** skip the assay (used by unit tests that only exercise the GA) */
  assay?: boolean;
  assayReplicates?: number;
}

export function evolveLineage(
  seed: string,
  arm: Arm,
  ancestor: number,
  opts: EvolveOptions = {},
): LineageResult {
  const gens = opts.gens ?? DD_GENS;
  const popSize = opts.pop ?? DD_POP;
  const mode: FitnessMode = opts.fitness ?? 'births';
  const ca = new LifeCA(opts.size ?? DD_SIZE);
  const rng = seededRng(`${seed}:${arm}:${mode}:evo`);
  const train = trainSeeds(seed);
  const cache = new Map<number, Score>();

  const score = (rule: number): Score => {
    const hit = cache.get(rule);
    if (hit) return hit;
    const s = scoreRule(rule, train, ca);
    cache.set(rule, s);
    return s;
  };
  /** the quantity selection maximises */
  const fit = (s: Score): number => (mode === 'births' ? s.births : s.established);
  /** the viability floor: a rule must still reproduce under its own score */
  const reproduces = (s: Score): boolean => (mode === 'births' ? s.births > 0 : s.established > 0);

  const ancestorScore = score(ancestor);
  let population: number[] = [ancestor];
  for (let i = 1; i < popSize; i++) population.push(mutateRule(ancestor, rng));

  const def = ARMS.find((a) => a.id === arm);
  if (!def) throw new RangeError(`unknown arm ${arm}`);
  const top = def.top;

  const generations: GenerationPoint[] = [];
  let diffs: number[] = [];

  for (let g = 0; g < gens; g++) {
    const scored = population.map((rule) => ({ rule, s: score(rule) }));
    scored.sort((a, b) => fit(b.s) - fit(a.s));
    const best = scored[0]!;
    generations.push({
      gen: g,
      bestFitness: fit(best.s),
      meanFitness: mean(scored.map((x) => fit(x.s))),
      bestRule: best.rule,
      meanDistance: mean(population.map((r) => hamming(r, ancestor))),
    });
    if (g === gens - 1) break;

    let parents: number[];
    if (top <= 0) {
      // no selection: parents are a uniform sample of the current population
      parents = pickUniform(population, popSize, rng);
      diffs.push(0);
    } else {
      const k = Math.max(1, Math.round(popSize * top));
      const survivors = scored.slice(0, k);
      const survivorMean = mean(survivors.map((x) => fit(x.s)));
      diffs.push(survivorMean - mean(scored.map((x) => fit(x.s))));
      // elitism: the best survivor is carried over unchanged
      parents = [survivors[0]!.rule, ...pickUniform(survivors.map((x) => x.rule), popSize - 1, rng)];
    }

    const next: number[] = [];
    for (let i = 0; i < popSize; i++) {
      const parent = parents[i]!;
      if (top > 0 && i === 0) {
        next.push(parent);
        continue;
      }
      let child = mutateRule(parent, rng);
      if (top <= 0) {
        // drift control: neutral walk with a viability floor, never a fitness bias
        let accepted = reproduces(score(child));
        for (let attempt = 0; attempt < 4 && !accepted; attempt++) {
          child = mutateRule(parent, rng);
          accepted = reproduces(score(child));
        }
        if (!accepted) child = parent;
      }
      next.push(child);
    }
    population = next;
  }

  const final = top > 0 ? generations[generations.length - 1]!.bestRule : population[Math.floor(rng() * population.length)]!;
  const held = heldSeeds(seed);
  const trainAncestor = ancestorScore;
  const trainFinal = score(final);
  const heldAncestor = scoreRule(ancestor, held, ca);
  const heldFinal = scoreRule(final, held, ca);

  const result: LineageResult = {
    id: `${arm}:${seed}`,
    seed,
    arm,
    dose: DOSE[arm],
    fitness: mode,
    ancestor,
    final,
    distance: hamming(final, ancestor),
    generations,
    trainAncestor,
    trainFinal,
    heldAncestor,
    heldFinal,
    selectionDifferential: diffs.length ? mean(diffs) : 0,
    assays: {
      ancestor: emptyRobustness(ancestor),
      final: emptyRobustness(final),
    },
  };

  if (opts.assay !== false) {
    const reps = opts.assayReplicates ?? DD_ASSAY_REPLICATES;
    result.assays.ancestor = assayRule(ancestor, seed, { replicates: reps, size: opts.size });
    result.assays.final = assayRule(final, seed, { replicates: reps, size: opts.size });
  }
  return result;
}

/* ------------------------------------------------------------------ assay -- */

export interface ShockPoint {
  family: Family;
  level: number;
  replicate: number;
  prePop: number;
  postPop: number;
  retention: number;
  collapsed: boolean;
  preTurnover: number;
}

export interface FamilySummary {
  retention: number;
  collapseRate: number;
  n: number;
}

export interface RuleRobustness {
  rule: number;
  points: ShockPoint[];
  byFamily: Record<Family, FamilySummary>;
  /** fraction of replicates whose benign warm-up left >= DD_MIN_PREPOP live cells */
  benignViability: number;
  prePop: number;
  preTurnover: number;
}

export interface AssayOptions {
  replicates?: number;
  size?: number;
  warm?: number;
  shockTicks?: number;
  tail?: number;
}

function emptyFamily(): FamilySummary {
  return { retention: Number.NaN, collapseRate: Number.NaN, n: 0 };
}

export function emptyRobustness(rule: number): RuleRobustness {
  return {
    rule,
    points: [],
    byFamily: { noise: emptyFamily(), death: emptyFamily(), compute: emptyFamily() },
    benignViability: 0,
    prePop: 0,
    preTurnover: 0,
  };
}

/**
 * Robustness assay. For each replicate the same post-warm-up state is used for
 * every shock level, so families are paired and retention is measured against
 * the same pre-shock population.
 */
export function assayRule(rule: number, seed: string, opts: AssayOptions = {}): RuleRobustness {
  const reps = opts.replicates ?? DD_ASSAY_REPLICATES;
  const warm = opts.warm ?? DD_WARM;
  const shockTicks = opts.shockTicks ?? DD_SHOCK_TICKS;
  const tail = opts.tail ?? DD_TAIL;
  const ca = new LifeCA(opts.size ?? DD_SIZE);
  const points: ShockPoint[] = [];
  let viableReps = 0;
  let prePopSum = 0;
  let preTurnoverSum = 0;

  for (let rep = 0; rep < reps; rep++) {
    ca.setSoup(fnv1a32(`${seed}:assay:${rep}`), DD_SOUP_DENSITY);
    let warmBirths = 0;
    let warmDeaths = 0;
    for (let t = 0; t < warm; t++) {
      const s = ca.step(rule);
      if (t >= warm - 20) {
        warmBirths += s.births;
        warmDeaths += s.deaths;
      }
    }
    const prePop = ca.alive();
    prePopSum += prePop;
    preTurnoverSum += (warmBirths + warmDeaths) / (20 * ca.total);
    if (prePop < DD_MIN_PREPOP) continue;
    viableReps++;
    const snapshot = ca.snapshot();

    for (const family of FAMILIES) {
      for (const level of SHOCKS[family]) {
        ca.load(snapshot);
        const rng = mulberry32(fnv1a32(`${seed}:shock:${family}:${level}:${rep}`));
        if (family === 'death') ca.killFraction(level, rng);
        let aliveSum = 0;
        for (let t = 0; t < shockTicks; t++) {
          const s =
            family === 'noise'
              ? ca.step(rule, { noise: level, rng })
              : family === 'compute'
                ? ca.step(rule, { partial: level, rng })
                : ca.step(rule);
          if (t >= shockTicks - tail) aliveSum += s.alive;
        }
        const postPop = aliveSum / tail;
        const retention = postPop / prePop;
        points.push({
          family,
          level,
          replicate: rep,
          prePop,
          postPop,
          retention,
          collapsed: postPop < 0.1 * prePop,
          preTurnover: (warmBirths + warmDeaths) / (20 * ca.total),
        });
      }
    }
  }

  const byFamily = { noise: emptyFamily(), death: emptyFamily(), compute: emptyFamily() };
  for (const family of FAMILIES) {
    const pts = points.filter((p) => p.family === family && Number.isFinite(p.retention));
    byFamily[family] = {
      retention: pts.length ? mean(pts.map((p) => p.retention)) : Number.NaN,
      collapseRate: pts.length ? pts.filter((p) => p.collapsed).length / pts.length : Number.NaN,
      n: pts.length,
    };
  }

  return {
    rule,
    points,
    byFamily,
    benignViability: reps > 0 ? viableReps / reps : 0,
    prePop: reps > 0 ? prePopSum / reps : 0,
    preTurnover: reps > 0 ? preTurnoverSum / reps : 0,
  };
}

/* -------------------------------------------------------------- statistics -- */

function ranks(xs: readonly number[]): number[] {
  const idx = xs.map((x, i) => ({ x, i })).sort((a, b) => a.x - b.x);
  const out = new Array<number>(xs.length);
  let i = 0;
  while (i < idx.length) {
    let j = i + 1;
    while (j < idx.length && idx[j]!.x === idx[i]!.x) j++;
    const r = (i + j - 1) / 2 + 1;
    for (let k = i; k < j; k++) out[idx[k]!.i] = r;
    i = j;
  }
  return out;
}

/** Spearman rank correlation with average ranks for ties. */
export function spearman(xs: readonly number[], ys: readonly number[]): number {
  if (xs.length !== ys.length || xs.length < 3) return Number.NaN;
  const rx = ranks(xs);
  const ry = ranks(ys);
  const mx = mean(rx);
  const my = mean(ry);
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < rx.length; i++) {
    const a = rx[i]! - mx;
    const b = ry[i]! - my;
    num += a * b;
    dx += a * a;
    dy += b * b;
  }
  if (dx === 0 || dy === 0) return Number.NaN;
  return num / Math.sqrt(dx * dy);
}

export interface SpearmanCI {
  rho: number;
  lo: number;
  hi: number;
  n: number;
}

export function spearmanCI(
  xs: readonly number[],
  ys: readonly number[],
  opts: { r: number; samples?: number },
): SpearmanCI {
  const paired = xs
    .map((x, i) => ({ x, y: ys[i]! }))
    .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  const x = paired.map((p) => p.x);
  const y = paired.map((p) => p.y);
  const rho = spearman(x, y);
  const rng = mulberry32(opts.r);
  const samples = opts.samples ?? 2000;
  const boot: number[] = [];
  for (let b = 0; b < samples; b++) {
    const bx: number[] = [];
    const by: number[] = [];
    for (let i = 0; i < x.length; i++) {
      const j = Math.floor(rng() * x.length);
      bx.push(x[j]!);
      by.push(y[j]!);
    }
    const r = spearman(bx, by);
    if (Number.isFinite(r)) boot.push(r);
  }
  return {
    rho,
    lo: boot.length ? quantile(boot, 0.025) : Number.NaN,
    hi: boot.length ? quantile(boot, 0.975) : Number.NaN,
    n: x.length,
  };
}

export interface PairedCI {
  median: number;
  lo: number;
  hi: number;
  n: number;
  /** fraction of bootstrap medians on the positive side of zero */
  positive: number;
}

/** Paired bootstrap over lineages: resample the *differences*, not the levels. */
export function pairedCI(diffs: readonly number[], opts: { r: number; samples?: number }): PairedCI {
  const xs = diffs.filter((d) => Number.isFinite(d));
  const rng = mulberry32(opts.r);
  const samples = opts.samples ?? 4000;
  const boot: number[] = [];
  for (let b = 0; b < samples; b++) {
    const draw: number[] = [];
    for (let i = 0; i < xs.length; i++) draw.push(xs[Math.floor(rng() * xs.length)]!);
    boot.push(median(draw));
  }
  let positive = 0;
  for (const v of boot) if (v > 0) positive++;
  return {
    median: median(xs),
    lo: boot.length ? quantile(boot, 0.025) : Number.NaN,
    hi: boot.length ? quantile(boot, 0.975) : Number.NaN,
    n: xs.length,
    positive: boot.length ? positive / boot.length : Number.NaN,
  };
}

export interface OlsRow {
  y: number;
  x1: number;
  x2: number;
  x3: number;
}

export interface OlsFit {
  intercept: number;
  b1: number;
  b2: number;
  b3: number;
  n: number;
}

/** Ordinary least squares on three predictors via normal equations (4x4). */
export function ols3(rows: readonly OlsRow[]): OlsFit {
  const n = rows.length;
  if (n < 5) return { intercept: Number.NaN, b1: Number.NaN, b2: Number.NaN, b3: Number.NaN, n };
  const X = rows.map((r) => [1, r.x1, r.x2, r.x3]);
  const y = rows.map((r) => r.y);
  const A: number[][] = Array.from({ length: 4 }, () => new Array<number>(4).fill(0));
  const b = new Array<number>(4).fill(0);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < 4; j++) {
      b[j] += X[i]![j]! * y[i]!;
      for (let k = 0; k < 4; k++) A[j]![k] += X[i]![j]! * X[i]![k]!;
    }
  }
  const sol = solve4(A, b);
  return { intercept: sol[0]!, b1: sol[1]!, b2: sol[2]!, b3: sol[3]!, n };
}

function solve4(A: number[][], b: number[]): number[] {
  const m = A.map((row, i) => [...row, b[i]!]);
  for (let c = 0; c < 4; c++) {
    let piv = c;
    for (let r = c + 1; r < 4; r++) if (Math.abs(m[r]![c]!) > Math.abs(m[piv]![c]!)) piv = r;
    if (Math.abs(m[piv]![c]!) < 1e-12) return [Number.NaN, Number.NaN, Number.NaN, Number.NaN];
    [m[c], m[piv]] = [m[piv]!, m[c]!];
    const p = m[c]![c]!;
    for (let k = c; k < 5; k++) m[c]![k] = m[c]![k]! / p;
    for (let r = 0; r < 4; r++) {
      if (r === c) continue;
      const f = m[r]![c]!;
      if (f === 0) continue;
      for (let k = c; k < 5; k++) m[r]![k] = m[r]![k]! - f * m[c]![k]!;
    }
  }
  return [m[0]![4]!, m[1]![4]!, m[2]![4]!, m[3]![4]!];
}

/* ----------------------------------------------------------------- report -- */

export interface LineageAnalysis {
  id: string;
  arm: Arm;
  dose: number;
  seed: string;
  ancestorLabel: string;
  finalLabel: string;
  distance: number;
  viability: number;
  reproAncestor: number;
  reproFinal: number;
  reproGain: number;
  heldReproAncestor: number;
  heldReproFinal: number;
  heldReproGain: number;
  turnoverAncestor: number;
  turnoverFinal: number;
  turnoverGain: number;
  retentionAncestor: Record<Family, number>;
  retentionFinal: Record<Family, number>;
  retentionDelta: Record<Family, number>;
  collapseAncestor: Record<Family, number>;
  collapseFinal: Record<Family, number>;
}

export interface FamilyStat {
  family: Family;
  /** paired Spearman between reproduction gain and retention change */
  rhoGain: SpearmanCI;
  /** cross-sectional Spearman between endpoint reproduction and retention */
  rhoLevel: SpearmanCI;
  /** median retention change of selected lineages minus drift lineages */
  selectedMinusDrift: PairedCI;
  /** median retention change over all lineages */
  meanDelta: PairedCI;
  /** median retention of selected endpoints vs their ancestors */
  selectedAncestorDelta: PairedCI;
  /** median retention of drift endpoints vs their ancestors */
  driftAncestorDelta: PairedCI;
  /** dose trend over lineages (0 drift .. 3 strong) */
  doseRho: number;
  doseP: number;
  /** Spearman between turnover gain and retention change */
  rhoTurnover: SpearmanCI;
}

export interface MediationFit {
  /** Theil-Sen slope of retentionDelta on turnoverGain, pooled over lineages */
  slope: number;
  /** median(selected delta) - median(drift delta), before adjustment */
  armBefore: number;
  /** same contrast after subtracting slope * turnoverGain from every delta */
  armAfter: number;
}

/**
 * Robust simple slope: the median of all pairwise slopes. Unlike OLS it is not
 * dominated by the handful of lineages whose ancestor regrows after the shock
 * (retention ratios of 2-5), which is why it is used for the turnover
 * adjustment rather than a three-predictor least-squares fit.
 */
export function theilSen(xs: readonly number[], ys: readonly number[]): number {
  const pts = xs
    .map((x, i) => ({ x, y: ys[i]! }))
    .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  const slopes: number[] = [];
  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) {
      const dx = pts[j]!.x - pts[i]!.x;
      if (Math.abs(dx) < 1e-12) continue;
      slopes.push((pts[j]!.y - pts[i]!.y) / dx);
    }
  }
  return slopes.length ? median(slopes) : Number.NaN;
}

export interface DoseRow {
  arm: Arm;
  n: number;
  reproGain: number;
  heldReproGain: number;
  retentionDelta: Record<Family, number>;
  viability: number;
  distance: number;
}

export interface DoomsdayVerdict {
  verdict: 'supported' | 'refuted' | 'no-trade-off' | 'unresolved';
  reason: string;
  manipulationOk: boolean;
  viabilityOk: boolean;
  primaryFamily: Family;
  rho: number;
  rhoLo: number;
  rhoHi: number;
  selectedMinusDrift: number;
  selectedMinusDriftLo: number;
  selectedMinusDriftHi: number;
  doseRho: number;
  doseP: number;
  turnoverRho: number;
  turnoverLo: number;
  turnoverHi: number;
  armBefore: number;
  armAfter: number;
}

export interface DoomsdayReport {
  version: number;
  generatedAt: string;
  provenance: string;
  config: {
    size: number;
    cells: number;
    population: number;
    generations: number;
    lineagesPerArm: number;
    fitness: FitnessMode;
    meaningfulCost: number;
    arms: ArmDef[];
    shocks: Record<Family, readonly number[]>;
    burn: number;
    train: number;
    maturity: number;
    warm: number;
    shockTicks: number;
    tail: number;
    minPrePop: number;
    assayReplicates: number;
  };
  lineages: LineageAnalysis[];
  conway: {
    label: string;
    reproduction: number;
    turnover: number;
    retention: Record<Family, number>;
    collapse: Record<Family, number>;
    viability: number;
  };
  byFamily: FamilyStat[];
  byArm: DoseRow[];
  mediation: Record<Family, MediationFit>;
  verdict: DoomsdayVerdict;
}

export interface BuildOptions {
  provenance: string;
  conway: RuleRobustness;
  conwayScore: Score;
  bootstrapSamples?: number;
  primaryFamily?: Family;
  /** which score the lineages were selected on; defaults to the lineages' own mode */
  fitness?: FitnessMode;
  /** actual run dimensions, so a quick run does not report the defaults */
  population?: number;
  generations?: number;
  lineagesPerArm?: number;
}

function finiteMean(xs: readonly number[]): number {
  const v = xs.filter((x) => Number.isFinite(x));
  return v.length ? mean(v) : Number.NaN;
}

function finiteMedian(xs: readonly number[]): number {
  const v = xs.filter((x) => Number.isFinite(x));
  return v.length ? median(v) : Number.NaN;
}

function familyMap<T>(fn: (f: Family) => T): Record<Family, T> {
  return { noise: fn('noise'), death: fn('death'), compute: fn('compute') };
}

/** JSON round-trips NaN as null; coerce back so `--from-cache` cannot read null as 0. */
function num(x: unknown): number {
  return typeof x === 'number' && Number.isFinite(x) ? x : Number.NaN;
}

export function analyseLineage(l: LineageResult): LineageAnalysis {
  const ra = l.assays.ancestor;
  const rf = l.assays.final;
  const fit = (s: Score): number => (l.fitness === 'births' ? s.births : s.established);
  const reproAncestor = fit(l.heldAncestor);
  const reproFinal = fit(l.heldFinal);
  return {
    id: l.id,
    arm: l.arm,
    dose: l.dose,
    seed: l.seed,
    ancestorLabel: ruleLabel(l.ancestor),
    finalLabel: ruleLabel(l.final),
    distance: l.distance,
    viability: num(rf.benignViability),
    reproAncestor,
    reproFinal,
    reproGain: reproFinal - reproAncestor,
    heldReproAncestor: reproAncestor,
    heldReproFinal: reproFinal,
    heldReproGain: reproFinal - reproAncestor,
    turnoverAncestor: num(ra.preTurnover),
    turnoverFinal: num(rf.preTurnover),
    turnoverGain: num(rf.preTurnover) - num(ra.preTurnover),
    retentionAncestor: familyMap((f) => num(ra.byFamily[f].retention)),
    retentionFinal: familyMap((f) => num(rf.byFamily[f].retention)),
    retentionDelta: familyMap((f) => num(rf.byFamily[f].retention) - num(ra.byFamily[f].retention)),
    collapseAncestor: familyMap((f) => num(ra.byFamily[f].collapseRate)),
    collapseFinal: familyMap((f) => num(rf.byFamily[f].collapseRate)),
  };
}

export function buildDoomsdayReport(
  lineages: readonly LineageResult[],
  opts: BuildOptions,
): DoomsdayReport {
  const rows = lineages.map(analyseLineage);
  const samples = opts.bootstrapSamples ?? 4000;
  const primary: Family = opts.primaryFamily ?? 'noise';
  const mode: FitnessMode = opts.fitness ?? lineages[0]?.fitness ?? 'births';
  const fitScore = (s: Score): number => (mode === 'births' ? s.births : s.established);

  const byFamily: FamilyStat[] = FAMILIES.map((family) => {
    const valid = rows.filter((r) => Number.isFinite(r.retentionDelta[family]));
    const x = valid.map((r) => r.reproGain);
    const y = valid.map((r) => r.retentionDelta[family]);
    const lvlX = valid.map((r) => r.reproFinal);
    const lvlY = valid.map((r) => r.retentionFinal[family]);

    const sel = valid.filter((r) => r.arm !== 'drift');
    const dr = valid.filter((r) => r.arm === 'drift');
    // pair selected and drift lineages by their ancestor seed (same starting rule)
    const paired: number[] = [];
    for (const s of sel) {
      const d = dr.find((x) => x.seed === s.seed);
      if (d) paired.push(s.retentionDelta[family] - d.retentionDelta[family]);
    }

    const doseRho = spearman(
      valid.map((r) => r.dose),
      valid.map((r) => r.retentionDelta[family]),
    );

    return {
      family,
      rhoGain: spearmanCI(x, y, { r: 0x51ab + family.length, samples }),
      rhoLevel: spearmanCI(lvlX, lvlY, { r: 0x7c3d + family.length, samples }),
      selectedMinusDrift: pairedCI(paired, { r: 0x2f11 + family.length, samples }),
      meanDelta: pairedCI(valid.map((r) => r.retentionDelta[family]), { r: 0x1d07 + family.length, samples }),
      selectedAncestorDelta: pairedCI(
        sel.map((r) => r.retentionDelta[family]),
        { r: 0x3b29 + family.length, samples },
      ),
      driftAncestorDelta: pairedCI(
        dr.map((r) => r.retentionDelta[family]),
        { r: 0x4c17 + family.length, samples },
      ),
      doseRho,
      doseP: dosePermutationP(valid.map((r) => r.dose), valid.map((r) => r.retentionDelta[family])),
      rhoTurnover: spearmanCI(
        valid.map((r) => r.turnoverGain),
        valid.map((r) => r.retentionDelta[family]),
        { r: 0x6a2b + family.length, samples },
      ),
    };
  });
  const fam = (f: Family): FamilyStat => byFamily.find((x) => x.family === f)!;

  const byArm: DoseRow[] = ARMS.map((a) => {
    const rs = rows.filter((r) => r.arm === a.id);
    return {
      arm: a.id,
      n: rs.length,
      reproGain: finiteMean(rs.map((r) => r.reproGain)),
      heldReproGain: finiteMean(rs.map((r) => r.heldReproGain)),
      retentionDelta: familyMap((f) => finiteMedian(rs.map((r) => r.retentionDelta[f]))),
      viability: finiteMean(rs.map((r) => r.viability)),
      distance: finiteMean(rs.map((r) => r.distance)),
    };
  });

  const mediation = familyMap((f) => {
    const valid = rows.filter((r) => Number.isFinite(r.retentionDelta[f]));
    const slope = theilSen(valid.map((r) => r.turnoverGain), valid.map((r) => r.retentionDelta[f]));
    const sel = valid.filter((r) => r.arm !== 'drift');
    const dr = valid.filter((r) => r.arm === 'drift');
    // same by-seed pairing as the headline contrast, so armBefore equals selectedMinusDrift
    const pairedMedian = (value: (r: LineageAnalysis) => number): number => {
      const diffs: number[] = [];
      for (const s of sel) {
        const d = dr.find((x) => x.seed === s.seed);
        if (d) diffs.push(value(s) - value(d));
      }
      return finiteMedian(diffs);
    };
    return {
      slope,
      armBefore: pairedMedian((r) => r.retentionDelta[f]),
      armAfter: pairedMedian((r) => r.retentionDelta[f] - slope * r.turnoverGain),
    } as MediationFit;
  });

  const p = fam(primary);
  const selectedRows = rows.filter((r) => r.arm !== 'drift');
  const driftRows = rows.filter((r) => r.arm === 'drift');
  const selectedGain = finiteMedian(selectedRows.map((r) => r.reproGain));
  const driftGain = finiteMedian(driftRows.map((r) => r.reproGain));
  const manipulationOk = selectedGain > 0 && selectedGain > driftGain;
  const viabilityOk =
    rows.filter((r) => r.arm !== 'drift' && r.viability >= 0.5).length >=
    Math.ceil(rows.filter((r) => r.arm !== 'drift').length * 0.6);

  let verdict: DoomsdayVerdict['verdict'] = 'unresolved';
  let reason = '';
  if (!manipulationOk) {
    reason =
      'selection did not increase held-out reproduction above the drift control, so there is no treatment to attribute a robustness change to';
  } else if (!viabilityOk) {
    reason =
      'fewer than 60% of selected endpoints survive the benign assay, so the endpoint is not a functioning replicator and the trade-off is not identifiable';
  } else if (
    p.rhoGain.rho <= -0.3 &&
    p.rhoGain.hi < 0 &&
    p.selectedMinusDrift.median <= -DD_MEANINGFUL_COST &&
    p.selectedMinusDrift.hi < 0 &&
    p.selectedAncestorDelta.hi < 0
  ) {
    verdict = 'supported';
    reason =
      'lineages that gained more reproduction lost more retention under the primary shock; selected endpoints retain less than their own ancestors and at least ' +
      DD_MEANINGFUL_COST.toFixed(2) +
      ' less than their drift controls';
  } else if (p.rhoGain.rho >= 0.3 && p.rhoGain.lo > 0) {
    verdict = 'refuted';
    reason =
      'reproduction gain is positively associated with retention under the primary shock: in this model the better replicators are the more robust ones';
  } else if (p.rhoGain.rho <= -0.3) {
    verdict = 'no-trade-off';
    reason =
      'the point estimate is negative but the interval includes zero, the drift contrast is smaller than the ' +
      DD_MEANINGFUL_COST.toFixed(2) +
      ' retention floor, or selected endpoints did not fall below their own ancestors, so no doomsday is claimed';
  } else {
    verdict = 'no-trade-off';
    reason = 'reproduction gain and retention change are not negatively associated under the primary shock';
  }

  const mediationPrimary = mediation[primary];
  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    provenance: opts.provenance,
    config: {
      size: DD_SIZE,
      cells: DD_CELLS,
      population: opts.population ?? DD_POP,
      generations: opts.generations ?? DD_GENS,
      lineagesPerArm: opts.lineagesPerArm ?? DD_LINEAGES,
      fitness: mode,
      meaningfulCost: DD_MEANINGFUL_COST,
      arms: [...ARMS],
      shocks: SHOCKS,
      burn: DD_BURN,
      train: DD_TRAIN,
      maturity: DD_MATURITY,
      warm: DD_WARM,
      shockTicks: DD_SHOCK_TICKS,
      tail: DD_TAIL,
      minPrePop: DD_MIN_PREPOP,
      assayReplicates: DD_ASSAY_REPLICATES,
    },
    lineages: rows,
    conway: {
      label: ruleLabel(CONWAY),
      reproduction: fitScore(opts.conwayScore),
      turnover: opts.conwayScore.turnoverPerCellTick,
      retention: familyMap((f) => opts.conway.byFamily[f].retention),
      collapse: familyMap((f) => opts.conway.byFamily[f].collapseRate),
      viability: opts.conway.benignViability,
    },
    byFamily,
    byArm,
    mediation,
    verdict: {
      verdict,
      reason,
      manipulationOk,
      viabilityOk,
      primaryFamily: primary,
      rho: p.rhoGain.rho,
      rhoLo: p.rhoGain.lo,
      rhoHi: p.rhoGain.hi,
      selectedMinusDrift: p.selectedMinusDrift.median,
      selectedMinusDriftLo: p.selectedMinusDrift.lo,
      selectedMinusDriftHi: p.selectedMinusDrift.hi,
      doseRho: p.doseRho,
      doseP: p.doseP,
      turnoverRho: p.rhoTurnover.rho,
      turnoverLo: p.rhoTurnover.lo,
      turnoverHi: p.rhoTurnover.hi,
      armBefore: mediationPrimary.armBefore,
      armAfter: mediationPrimary.armAfter,
    },
  };
}

/**
 * Permutation p-value for a Spearman trend. The predictor labels are shuffled,
 * so the null is "no monotone association with dose".
 */
export function dosePermutationP(dose: readonly number[], y: readonly number[]): number {
  const paired = dose
    .map((d, i) => ({ d, y: y[i]! }))
    .filter((p) => Number.isFinite(p.d) && Number.isFinite(p.y));
  const ds = paired.map((p) => p.d);
  const ys = paired.map((p) => p.y);
  const obs = Math.abs(spearman(ds, ys));
  if (!Number.isFinite(obs) || obs === 0) return 1;
  const rng = mulberry32(0x9e37);
  const permutations = 4000;
  let count = 0;
  for (let p = 0; p < permutations; p++) {
    for (let i = ys.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const t = ys[i]!;
      ys[i] = ys[j]!;
      ys[j] = t;
    }
    const r = Math.abs(spearman(ds, ys));
    if (r >= obs) count++;
  }
  return (count + 1) / (permutations + 1);
}
