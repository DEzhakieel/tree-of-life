/**
 * Experiment B - Self-replication that attacks itself.
 *
 * Question: can a first-level structure reproduce while its own offspring
 * destroy the second-level reproduction mechanism?
 *
 * The model is a probabilistic birth-death process on a 40x40 torus with two
 * explicit scales of reproduction.
 *
 *   scale 1 (local)   a cell divides into a nearby empty site. Heritable traits
 *                     `build` (0..2, investment in the scale-2 organ) and
 *                     `fec` (1..3, local fecundity) set its birth rate directly.
 *   scale 2 (collective) a NEST is a persistent site-level individual. Builders
 *                     sharing a lineage tag initiate it; it decays unless local
 *                     builders maintain it, gives its lineage a birth bonus,
 *                     and when charged releases a propagule at dispersal range.
 *                     The propagule carries the nest's CURRENT modal genotype.
 *
 * The self-attack is structural: a nest is a club good for its tag. A
 * non-builder mutant of that tag keeps the benefit, skips the build cost and
 * divides faster. It dilutes the local builder fraction, the nest loses
 * integrity, stops reproducing, and dies. The propagule route transmits the
 * defector genotype onward, so the hierarchy decays while local cells persist.
 *
 * Interventions act on three distinct links:
 *   cost      small structure   fast local reproduction pays extra per birth
 *   boundary  cross-scale       the propagule carries the founding build
 *                               genotype (germline sequestration)
 *   signal    inter-scale       nests emit a field that halves defector births
 *                               nearby, at a cost to their own charge rate
 *
 * Nothing here touches the agent engine. `docs/CLAIMS.md` (B-SELF-01..04)
 * holds the pre-registered analysis.
 */
import { fnv1a32 } from '@fractal-life/shared';
import { bootstrapCI, mean, median, mulberry32, quantile, stdev } from './stats.js';

/* --------------------------------------------------------------- parameters -- */

export const SA_SIZE = 40;
export const SA_CELLS = SA_SIZE * SA_SIZE;
export const SA_TICKS = 1200;
export const SA_BURN = 120;
export const SA_FOUNDERS = 30;

/** Per-tick baseline birth probability. */
export const SA_BIRTH = 0.06;
/** Birth multiplier per fecundity step away from 2. */
export const SA_FEC_GAIN = 0.25;
/** Fractional birth penalty per unit of `build`. */
export const SA_BUILD_BURDEN = 0.25;
export const SA_DEATH_BASE = 0.012;
export const SA_DEATH_CROWD = 0.16;
/** A dead site cannot be recolonised for this many ticks. */
export const SA_BARREN = 25;
/** Per-birth probability of a trait mutation. */
export const SA_MUTATION = 0.03;

export const SA_NEST_QUORUM = 4;
/** Chebyshev exclusion radius between nest centres. */
export const SA_NEST_SPACING = 2;
export const SA_NEST_MAINTAIN = 0.06;
export const SA_NEST_DECAY = 0.02;
export const SA_NEST_BONUS = 0.60;
export const SA_NEST_CHARGE = 0.03;
export const SA_NEST_MIN_INTEGRITY = 0.40;
export const SA_NEST_COOLDOWN = 40;
export const SA_DISPERSAL_MIN = 6;
export const SA_DISPERSAL_SPAN = 6;

export const SA_COST_FAST = 0.20;
export const SA_SIGNAL_COST = 0.60;
export const SA_SIGNAL_DECAY = 0.80;
export const SA_SIGNAL_SPREAD = 0.50;
export const SA_SIGNAL_THRESHOLD = 0.35;
export const SA_SIGNAL_SUPPRESSION = 0.50;

/** Early window: [BURN + 50, BURN + 200). */
export const SA_EARLY_FROM = SA_BURN + 50;
export const SA_EARLY_TO = SA_BURN + 200;
/** Late window: the final 150 ticks. */
export const SA_LATE_SPAN = 150;
/** Rolling window and sustained run used for collapse times. */
export const SA_SMOOTH = 25;
export const SA_SUSTAIN = 50;

/** Between-seed floor, in units of the control late propagule rate. */
export const SA_FLOOR_SD = 2;

/* ------------------------------------------------------------------- types -- */

export interface Interventions {
  readonly cost: boolean;
  readonly boundary: boolean;
  readonly signal: boolean;
}

export type InterventionKey = keyof Interventions;

export interface SelfAttackConfig {
  readonly seed: string;
  readonly interventions: Interventions;
  readonly ticks?: number;
  readonly burnIn?: number;
}

export interface SelfAttackSeries {
  pop: number[];
  births: number[];
  deaths: number[];
  build: number[];
  fec: number[];
  defectors: number[];
  nests: number[];
  propagules: number[];
  localBuild: number[];
}

export interface SelfAttackRun {
  readonly seed: string;
  readonly interventions: Interventions;
  readonly ticks: number;
  readonly burnIn: number;
  readonly series: SelfAttackSeries;
  readonly nestLifetimes: number[];
  readonly propagulesTotal: number;
  /** Scale-2 lineages with at least one living cell at the final tick. */
  readonly aliveScale2: number;
  /** Scale-2 lineages that released a propagule in the final window. */
  readonly reproducingScale2: number;
  /** Deepest scale-2 genealogical chain in the final population. */
  readonly maxDepth: number;
  /** Build trait carried by every propagule, in birth order. */
  readonly propaguleBuilds: number[];
}

export interface RunMetrics {
  popEarly: number;
  popLate: number;
  birthEarly: number;
  birthLate: number;
  buildEarly: number;
  buildLate: number;
  defectorEarly: number;
  defectorLate: number;
  nestEarly: number;
  nestLate: number;
  propEarly: number;
  propLate: number;
  lbEarly: number;
  lbLate: number;
  /** late / early per run; NA-safe (0/0 -> 0). */
  birthRetention: number;
  propRetention: number;
  buildRetention: number;
  /** first sustained tick below half the early level, -1 if never. */
  tBuildCollapse: number;
  tPropCollapse: number;
  /** first tick where scale-2 output is below 25% of early while local births
   *  stay above 80% of early: the persistence/decoupling point. -1 if never. */
  tDecouple: number;
  nestLifeMedian: number;
  propagulesTotal: number;
  aliveScale2: number;
  reproducingScale2: number;
  maxDepth: number;
}

export interface MetricSummary {
  values: number[];
  mean: number;
  median: number;
  lo: number;
  hi: number;
}

export interface ConditionSummary {
  name: string;
  interventions: Interventions;
  n: number;
  metrics: Record<string, MetricSummary>;
  buildCollapseFraction: number;
  propCollapseFraction: number;
  decoupleFraction: number;
  tDecoupleMedian: number;
}

export type Verdict = 'supported' | 'refuted' | 'inconclusive';

export interface ClaimVerdict {
  id: string;
  claim: string;
  verdict: Verdict;
  detail: string;
  numbers: Record<string, number>;
}

export interface BottleneckCheck {
  rhoBuild: number;
  rhoBuildLo: number;
  rhoBuildHi: number;
  rhoBirth: number;
  rhoBirthLo: number;
  rhoBirthHi: number;
}

export interface SelfAttackReport {
  generatedAt: string;
  ticks: number;
  burnIn: number;
  seeds: string[];
  rescueFloor: number;
  interactionFloor: number;
  conditions: ConditionSummary[];
  bottleneck: BottleneckCheck;
  claims: ClaimVerdict[];
}

/* ------------------------------------------------------------ neighbourhood -- */

const NBR = new Int32Array(SA_CELLS * 8);
const NEAR = new Int32Array(SA_CELLS * 16);
for (let y = 0; y < SA_SIZE; y++) {
  for (let x = 0; x < SA_SIZE; x++) {
    let k = (y * SA_SIZE + x) * 8;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        NBR[k++] = ((y + dy + SA_SIZE) % SA_SIZE) * SA_SIZE + ((x + dx + SA_SIZE) % SA_SIZE);
      }
    }
    let q = (y * SA_SIZE + x) * 16;
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        if (Math.abs(dx) < 2 && Math.abs(dy) < 2) continue;
        NEAR[q++] = ((y + dy + SA_SIZE) % SA_SIZE) * SA_SIZE + ((x + dx + SA_SIZE) % SA_SIZE);
      }
    }
  }
}

const SIGNATURE = (i: Interventions): string => `${i.cost ? 1 : 0}${i.boundary ? 1 : 0}${i.signal ? 1 : 0}`;

export const CONDITION_NAMES: readonly string[] = [
  'control',
  'cost',
  'boundary',
  'signal',
  'cost+boundary',
  'cost+signal',
  'boundary+signal',
  'all',
];

export const CONDITIONS: readonly { name: string; interventions: Interventions }[] = [
  [false, false, false],
  [true, false, false],
  [false, true, false],
  [false, false, true],
  [true, true, false],
  [true, false, true],
  [false, true, true],
  [true, true, true],
].map(([cost, boundary, signal]) => {
  const active = [cost && 'cost', boundary && 'boundary', signal && 'signal'].filter(Boolean) as string[];
  const name = active.length === 0 ? 'control' : active.length === 3 ? 'all' : active.join('+');
  return {
    name,
    interventions: { cost: cost!, boundary: boundary!, signal: signal! },
  };
});

export function conditionByName(name: string): Interventions {
  const found = CONDITIONS.find((c) => c.name === name);
  if (!found) throw new Error(`unknown condition: ${name}`);
  return found.interventions;
}

/* -------------------------------------------------------------------- model -- */

export interface MutableState {
  occ: Uint8Array;
  build: Uint8Array;
  fec: Uint8Array;
  tag: Int32Array;
  blocked: Int32Array;
  sig: Float32Array;
  nest: Uint8Array;
  nestTag: Int32Array;
  nestInt: Float32Array;
  nestCharge: Float32Array;
  nestCool: Int32Array;
  nestFounderBuild: Uint8Array;
}

const tmp = new Float32Array(SA_CELLS);
const bonus = new Float32Array(SA_CELLS);
const tally = new Int32Array(16);
const tallyKeys: number[] = [];

function initialState(rng: () => number): MutableState {
  const s: MutableState = {
    occ: new Uint8Array(SA_CELLS),
    build: new Uint8Array(SA_CELLS),
    fec: new Uint8Array(SA_CELLS),
    tag: new Int32Array(SA_CELLS).fill(-1),
    blocked: new Int32Array(SA_CELLS).fill(-1),
    sig: new Float32Array(SA_CELLS),
    nest: new Uint8Array(SA_CELLS),
    nestTag: new Int32Array(SA_CELLS).fill(-1),
    nestInt: new Float32Array(SA_CELLS),
    nestCharge: new Float32Array(SA_CELLS),
    nestCool: new Int32Array(SA_CELLS),
    nestFounderBuild: new Uint8Array(SA_CELLS),
  };
  for (let f = 0; f < SA_FOUNDERS; f++) {
    const i = Math.floor(rng() * SA_CELLS);
    if (s.occ[i]) {
      f--;
      continue;
    }
    s.occ[i] = 1;
    s.build[i] = 1;
    s.fec[i] = 2;
    s.tag[i] = f; // one tag per founder: scale-2 lineages start at 0..n-1
  }
  return s;
}

function occupiedNeighbours(st: MutableState, i: number): number {
  let n = 0;
  for (let k = 0; k < 8; k++) if (st.occ[NBR[i * 8 + k]]) n++;
  return n;
}

function hasNestWithin(st: MutableState, i: number, radius: number): boolean {
  const y0 = (i / SA_SIZE) | 0;
  const x0 = i % SA_SIZE;
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const y = (y0 + dy + SA_SIZE) % SA_SIZE;
      const x = (x0 + dx + SA_SIZE) % SA_SIZE;
      if (st.nest[y * SA_SIZE + x]) return true;
    }
  }
  return false;
}

/** One reproductive tick. Returns counts for the caller's series. */
export function stepSelfAttack(
  st: MutableState,
  rng: () => number,
  intv: Interventions,
  tick: number,
  nextTag: { value: number },
  tagParent: Map<number, number>,
  propaguleBirth: number[],
  propaguleBuilds: number[],
): { births: number; deaths: number; propagules: number } {
  bonus.fill(0);

  // 1. signal field: decay plus max-of-neighbours spread
  if (intv.signal) {
    for (let i = 0; i < SA_CELLS; i++) {
      let v = st.sig[i]! * SA_SIGNAL_DECAY;
      for (let k = 0; k < 8; k++) {
        const w = st.sig[NBR[i * 8 + k]!]! * SA_SIGNAL_SPREAD;
        if (w > v) v = w;
      }
      tmp[i] = v;
    }
    st.sig.set(tmp);
  }

  // 2. nests: integrity, club good, reproduction
  let propagules = 0;
  for (let c = 0; c < SA_CELLS; c++) {
    if (!st.nest[c]) continue;
    let cells = 0;
    let builders = 0;
    for (let k = -1; k < 8; k++) {
      const j = k < 0 ? c : NBR[c * 8 + k]!;
      if (!st.occ[j]) continue;
      cells++;
      if (st.build[j]! >= 1 && st.tag[j] === st.nestTag[c]) builders++;
    }
    const lb = cells ? builders / cells : 0;
    st.nestInt[c] = Math.min(1, st.nestInt[c]! + SA_NEST_MAINTAIN * lb - SA_NEST_DECAY);
    if (st.nestInt[c]! <= 0) {
      st.nest[c] = 0;
      st.nestTag[c] = -1;
      st.nestCool[c] = tick + SA_NEST_COOLDOWN;
      continue;
    }
    if (intv.signal) st.sig[c] = 1;
    let rate = SA_NEST_CHARGE * lb;
    if (intv.signal) rate *= 1 - SA_SIGNAL_COST;
    st.nestCharge[c] = st.nestCharge[c]! + rate;
    const b = SA_NEST_BONUS * st.nestInt[c]! * lb;
    for (let k = -1; k < 8; k++) {
      const j = k < 0 ? c : NBR[c * 8 + k]!;
      if (!st.occ[j]) continue;
      if (st.tag[j] !== st.nestTag[c]) continue;
      if (b > bonus[j]!) bonus[j] = b;
    }
    if (st.nestCharge[c]! >= 1 && st.nestInt[c]! >= SA_NEST_MIN_INTEGRITY) {
      tally.fill(0);
      tallyKeys.length = 0;
      for (let k = -1; k < 8; k++) {
        const j = k < 0 ? c : NBR[c * 8 + k]!;
        if (!st.occ[j] || st.tag[j] !== st.nestTag[c]) continue;
        const g = st.build[j]! * 4 + st.fec[j]!;
        if (tally[g] === 0) tallyKeys.push(g);
        tally[g] = tally[g]! + 1;
      }
      let best = -1;
      let bestN = 0;
      for (const g of tallyKeys) {
        if (tally[g]! > bestN) {
          bestN = tally[g]!;
          best = g;
        }
      }
      if (best >= 0) {
        // boundary ON seals transmission of the cooperative trait only
        const gb = intv.boundary ? st.nestFounderBuild[c]! : (best / 4) | 0;
        const gf = best % 4;
        const y0 = (c / SA_SIZE) | 0;
        const x0 = c % SA_SIZE;
        for (let attempt = 0; attempt < 30; attempt++) {
          const ang = rng() * Math.PI * 2;
          const d = SA_DISPERSAL_MIN + rng() * SA_DISPERSAL_SPAN;
          const y = (y0 + Math.round(Math.sin(ang) * d) + SA_SIZE) % SA_SIZE;
          const x = (x0 + Math.round(Math.cos(ang) * d) + SA_SIZE) % SA_SIZE;
          const q = y * SA_SIZE + x;
          if (st.occ[q] || st.blocked[q]! > tick) continue;
          const id = nextTag.value++;
          tagParent.set(id, st.nestTag[c]!);
          propaguleBirth.push(tick);
          propaguleBuilds.push(gb);
          st.occ[q] = 1;
          st.build[q] = gb;
          st.fec[q] = gf;
          st.tag[q] = id;
          propagules++;
          st.nestCharge[c] = 0;
          break;
        }
      }
    }
  }

  // 3. nest initiation
  for (let i = 0; i < SA_CELLS; i++) {
    if (!st.occ[i] || st.nest[i] || st.build[i]! < 1 || st.nestCool[i]! > tick) continue;
    let quorum = 0;
    for (let k = 0; k < 8; k++) {
      const j = NBR[i * 8 + k]!;
      if (st.occ[j] && st.build[j]! >= 1 && st.tag[j] === st.tag[i]) quorum++;
    }
    if (quorum < SA_NEST_QUORUM) continue;
    if (hasNestWithin(st, i, SA_NEST_SPACING)) continue;
    let b1 = st.build[i] === 1 ? 1 : 0;
    let b2 = st.build[i]! >= 2 ? 1 : 0;
    for (let k = 0; k < 8; k++) {
      const j = NBR[i * 8 + k]!;
      if (!st.occ[j] || st.tag[j] !== st.tag[i]) continue;
      if (st.build[j] === 1) b1++;
      else if (st.build[j]! >= 2) b2++;
    }
    st.nest[i] = 1;
    st.nestTag[i] = st.tag[i]!;
    st.nestInt[i] = 0.5;
    st.nestCharge[i] = 0;
    st.nestFounderBuild[i] = b1 >= b2 ? 1 : 2;
  }

  // 4. births
  let births = 0;
  const offset = Math.floor(rng() * SA_CELLS);
  for (let ii = 0; ii < SA_CELLS; ii++) {
    const i = (ii + offset) % SA_CELLS;
    if (!st.occ[i]) continue;
    let p =
      SA_BIRTH *
      (1 + SA_FEC_GAIN * (st.fec[i]! - 2)) *
      (1 - SA_BUILD_BURDEN * st.build[i]!) *
      (1 + bonus[i]!);
    if (intv.cost) p *= 1 - SA_COST_FAST * (st.fec[i]! - 1);
    if (intv.signal && st.build[i] === 0 && st.sig[i]! > SA_SIGNAL_THRESHOLD) {
      p *= 1 - SA_SIGNAL_SUPPRESSION;
    }
    if (p <= 0 || rng() >= p) continue;
    let target = -1;
    const start = Math.floor(rng() * 8);
    for (let k = 0; k < 8; k++) {
      const j = NBR[i * 8 + ((start + k) % 8)]!;
      if (!st.occ[j] && st.blocked[j]! <= tick) {
        target = j;
        break;
      }
    }
    if (target < 0) {
      const s2 = Math.floor(rng() * 16);
      for (let k = 0; k < 16; k++) {
        const j = NEAR[i * 16 + ((s2 + k) % 16)]!;
        if (!st.occ[j] && st.blocked[j]! <= tick) {
          target = j;
          break;
        }
      }
    }
    if (target < 0) continue;
    st.occ[target] = 1;
    st.build[target] = st.build[i]!;
    st.fec[target] = st.fec[i]!;
    st.tag[target] = st.tag[i]!;
    if (rng() < SA_MUTATION) {
      if (rng() < 0.5) {
        st.build[target] = Math.max(0, Math.min(2, st.build[target]! + (rng() < 0.5 ? -1 : 1)));
      } else {
        st.fec[target] = Math.max(1, Math.min(3, st.fec[target]! + (rng() < 0.5 ? -1 : 1)));
      }
    }
    births++;
  }

  // 5. deaths (crowding-driven, with a barren period)
  let deaths = 0;
  for (let i = 0; i < SA_CELLS; i++) {
    if (!st.occ[i]) continue;
    const n = occupiedNeighbours(st, i);
    const pd = SA_DEATH_BASE + SA_DEATH_CROWD * (n / 8) * (n / 8);
    if (rng() < pd) {
      st.occ[i] = 0;
      st.blocked[i] = tick + SA_BARREN;
      deaths++;
    }
  }

  return { births, deaths, propagules };
}

/* --------------------------------------------------------------------- run -- */

export function runSelfAttack(config: SelfAttackConfig): SelfAttackRun {
  const ticks = config.ticks ?? SA_TICKS;
  const burnIn = config.burnIn ?? SA_BURN;
  const rng = mulberry32(fnv1a32(`${config.seed}|${SIGNATURE(config.interventions)}`));
  const st = initialState(rng);

  const series: SelfAttackSeries = {
    pop: [],
    births: [],
    deaths: [],
    build: [],
    fec: [],
    defectors: [],
    nests: [],
    propagules: [],
    localBuild: [],
  };
  const tagParent = new Map<number, number>();
  const propaguleBirth: number[] = [];
  const propaguleBuilds: number[] = [];
  const nestLifetimes: number[] = [];
  const nextTag = { value: SA_FOUNDERS };
  for (let f = 0; f < SA_FOUNDERS; f++) tagParent.set(f, -1);

  const nestBirthTick = new Int32Array(SA_CELLS).fill(-1);

  for (let t = 0; t < ticks; t++) {
    // nest deaths need a lifetime; snapshot which nests are alive before the step
    const aliveBefore = new Uint8Array(SA_CELLS);
    for (let c = 0; c < SA_CELLS; c++) if (st.nest[c]) aliveBefore[c] = 1;

    const counts = stepSelfAttack(st, rng, config.interventions, t, nextTag, tagParent, propaguleBirth, propaguleBuilds);

    for (let c = 0; c < SA_CELLS; c++) {
      if (aliveBefore[c] && !st.nest[c] && nestBirthTick[c]! >= 0) {
        nestLifetimes.push(t - nestBirthTick[c]!);
        nestBirthTick[c] = -1;
      }
      if (st.nest[c] && nestBirthTick[c]! < 0) nestBirthTick[c] = t;
    }

    let pop = 0;
    let bsum = 0;
    let fsum = 0;
    let def = 0;
    let nests = 0;
    let lbSum = 0;
    let lbN = 0;
    for (let i = 0; i < SA_CELLS; i++) {
      if (!st.occ[i]) continue;
      pop++;
      bsum += st.build[i]!;
      fsum += st.fec[i]!;
      if (st.build[i] === 0) def++;
    }
    for (let c = 0; c < SA_CELLS; c++) {
      if (!st.nest[c]) continue;
      nests++;
      let cells = 0;
      let builders = 0;
      for (let k = -1; k < 8; k++) {
        const j = k < 0 ? c : NBR[c * 8 + k]!;
        if (!st.occ[j]) continue;
        cells++;
        if (st.build[j]! >= 1 && st.tag[j] === st.nestTag[c]) builders++;
      }
      if (cells) {
        lbSum += builders / cells;
        lbN++;
      }
    }
    series.pop.push(pop);
    series.births.push(counts.births);
    series.deaths.push(counts.deaths);
    series.build.push(pop ? bsum / pop : 0);
    series.fec.push(pop ? fsum / pop : 0);
    series.defectors.push(pop ? def / pop : 0);
    series.nests.push(nests);
    series.propagules.push(propaguleBirth.length); // cumulative; differenced below
    series.localBuild.push(lbN ? lbSum / lbN : 0);
  }

  // series.propagules holds cumulative totals; convert to per-tick counts
  for (let i = series.propagules.length - 1; i > 0; i--) {
    series.propagules[i] = series.propagules[i]! - series.propagules[i - 1]!;
  }

  // scale-2 lineages at the final tick
  const rootOf = (id: number): number => {
    let x = id;
    let guard = 0;
    while ((tagParent.get(x) ?? -1) >= 0 && guard < 1e6) {
      x = tagParent.get(x)!;
      guard++;
    }
    return x;
  };
  const aliveTags = new Set<number>();
  for (let i = 0; i < SA_CELLS; i++) if (st.occ[i] && st.tag[i]! >= 0) aliveTags.add(st.tag[i]!);
  const aliveRoots = new Set<number>();
  let maxDepth = 0;
  for (const id of aliveTags) {
    aliveRoots.add(rootOf(id));
    let d = 0;
    let x = id;
    while ((tagParent.get(x) ?? -1) >= 0 && d < 1e6) {
      x = tagParent.get(x)!;
      d++;
    }
    if (d > maxDepth) maxDepth = d;
  }
  const latePropRoots = new Set<number>();
  for (let id = 0; id < propaguleBirth.length; id++) {
    if (propaguleBirth[id]! >= ticks - SA_LATE_SPAN) latePropRoots.add(rootOf(id));
  }

  return {
    seed: config.seed,
    interventions: config.interventions,
    ticks,
    burnIn,
    series,
    nestLifetimes,
    propagulesTotal: propaguleBirth.length,
    aliveScale2: aliveRoots.size,
    reproducingScale2: latePropRoots.size,
    maxDepth,
    propaguleBuilds,
  };
}

/* ----------------------------------------------------------------- metrics -- */

export function windowMean(xs: readonly number[], from: number, to: number): number {
  let s = 0;
  let n = 0;
  for (let i = Math.max(0, from); i < Math.min(to, xs.length); i++) {
    s += xs[i]!;
    n++;
  }
  return n ? s / n : 0;
}

export function rollingMean(xs: readonly number[], w: number): number[] {
  const out = new Array<number>(xs.length);
  let s = 0;
  for (let i = 0; i < xs.length; i++) {
    s += xs[i]!;
    if (i >= w) s -= xs[i - w]!;
    out[i] = s / Math.min(i + 1, w);
  }
  return out;
}

/** First tick at or after `from` whose rolling value stays below `frac` of the
 *  early mean for `sustain` consecutive ticks; -1 if it never does. */
export function sustainedCross(series: readonly number[], from: number, frac: number, sustain: number): number {
  const early = windowMean(series, SA_EARLY_FROM, SA_EARLY_TO);
  if (early <= 0) return -1;
  const bar = early * frac;
  const smooth = rollingMean(series, SA_SMOOTH);
  let run = 0;
  for (let i = from; i < series.length; i++) {
    if (smooth[i]! < bar) {
      run++;
      if (run >= sustain) return i - sustain + 1;
    } else {
      run = 0;
    }
  }
  return -1;
}

export function runMetrics(run: SelfAttackRun): RunMetrics {
  const lat = run.ticks - SA_LATE_SPAN;
  const s = run.series;
  const e = (k: keyof SelfAttackSeries) => windowMean(s[k], SA_EARLY_FROM, SA_EARLY_TO);
  const l = (k: keyof SelfAttackSeries) => windowMean(s[k], lat, run.ticks);
  const birthEarly = e('births');
  const birthLate = l('births');
  const propEarly = e('propagules');
  const propLate = l('propagules');
  const buildEarly = e('build');
  const buildLate = l('build');
  const ratio = (a: number, b: number) => (b > 0 ? a / b : 0);

  // decoupling: scale-2 output down sharply while local births stay up
  const propSmooth = rollingMean(s.propagules, SA_SMOOTH);
  const birthSmooth = rollingMean(s.births, SA_SMOOTH);
  const propBar = propEarly * 0.25;
  const birthBar = birthEarly * 0.8;
  let tDecouple = -1;
  let streak = 0;
  for (let i = SA_BURN; i < run.ticks; i++) {
    if (propSmooth[i]! < propBar && birthSmooth[i]! >= birthBar) {
      streak++;
      if (streak >= 100) {
        tDecouple = i - 99;
        break;
      }
    } else {
      streak = 0;
    }
  }

  return {
    popEarly: e('pop'),
    popLate: l('pop'),
    birthEarly,
    birthLate,
    buildEarly,
    buildLate,
    defectorEarly: e('defectors'),
    defectorLate: l('defectors'),
    nestEarly: e('nests'),
    nestLate: l('nests'),
    propEarly,
    propLate,
    lbEarly: e('localBuild'),
    lbLate: l('localBuild'),
    birthRetention: ratio(birthLate, birthEarly),
    propRetention: ratio(propLate, propEarly),
    buildRetention: ratio(buildLate, buildEarly),
    tBuildCollapse: sustainedCross(s.localBuild, SA_BURN, 0.5, SA_SUSTAIN),
    tPropCollapse: sustainedCross(s.propagules, SA_BURN, 0.5, SA_SUSTAIN),
    tDecouple,
    nestLifeMedian: run.nestLifetimes.length ? median(run.nestLifetimes) : -1,
    propagulesTotal: run.propagulesTotal,
    aliveScale2: run.aliveScale2,
    reproducingScale2: run.reproducingScale2,
    maxDepth: run.maxDepth,
  };
}

/* --------------------------------------------------------------- statistics -- */

export function spearman(xs: readonly number[], ys: readonly number[]): number {
  const n = Math.min(xs.length, ys.length);
  if (n < 2) return 0;
  const rank = (v: readonly number[]) => {
    const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => v[a]! - v[b]!);
    const r = new Array<number>(n);
    for (let i = 0; i < n; ) {
      let j = i;
      while (j + 1 < n && v[order[j + 1]!] === v[order[i]!]) j++;
      const avg = (i + j) / 2 + 1;
      for (let k = i; k <= j; k++) r[order[k]!] = avg;
      i = j + 1;
    }
    return r;
  };
  const rx = rank(xs);
  const ry = rank(ys);
  const mx = mean(rx);
  const my = mean(ry);
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i++) {
    const a = rx[i]! - mx;
    const b = ry[i]! - my;
    num += a * b;
    dx += a * a;
    dy += b * b;
  }
  return dx > 0 && dy > 0 ? num / Math.sqrt(dx * dy) : 0;
}

export function spearmanCI(
  xs: readonly number[],
  ys: readonly number[],
  opts: { r: number; samples?: number },
): { rho: number; lo: number; hi: number } {
  const n = Math.min(xs.length, ys.length);
  const rho = spearman(xs, ys);
  const samples = opts.samples ?? 2000;
  const rng = mulberry32(opts.r);
  const boot = new Array<number>(samples);
  for (let b = 0; b < samples; b++) {
    const bx = new Array<number>(n);
    const by = new Array<number>(n);
    for (let i = 0; i < n; i++) {
      const k = Math.floor(rng() * n);
      bx[i] = xs[k]!;
      by[i] = ys[k]!;
    }
    boot[b] = spearman(bx, by);
  }
  return { rho, lo: quantile(boot, 0.025), hi: quantile(boot, 0.975) };
}

function summarise(values: number[], r: number): MetricSummary {
  const ci = values.length ? bootstrapCI(values, { r }) : { mean: 0, lo: 0, hi: 0 };
  return {
    values,
    mean: values.length ? mean(values) : 0,
    median: values.length ? median(values) : 0,
    lo: ci.lo,
    hi: ci.hi,
  };
}

const METRIC_KEYS: readonly (keyof RunMetrics)[] = [
  'popEarly',
  'popLate',
  'birthEarly',
  'birthLate',
  'buildEarly',
  'buildLate',
  'defectorEarly',
  'defectorLate',
  'nestEarly',
  'nestLate',
  'propEarly',
  'propLate',
  'lbEarly',
  'lbLate',
  'birthRetention',
  'propRetention',
  'buildRetention',
  'tBuildCollapse',
  'tPropCollapse',
  'tDecouple',
  'nestLifeMedian',
  'propagulesTotal',
  'aliveScale2',
  'reproducingScale2',
  'maxDepth',
];

export function summariseCondition(
  name: string,
  interventions: Interventions,
  runs: readonly SelfAttackObservation[],
): ConditionSummary {
  const rows = runs.map((o) => o.metrics);
  const metrics: Record<string, MetricSummary> = {};
  for (const k of METRIC_KEYS) {
    metrics[k] = summarise(rows.map((r) => r[k]), fnv1a32(`${name}:${k}`) % 0x7fffffff);
  }
  const collapsed = (k: 'tBuildCollapse' | 'tPropCollapse' | 'tDecouple') =>
    rows.filter((r) => r[k] >= 0).length / Math.max(1, rows.length);
  const decoupleTimes = rows.map((r) => r.tDecouple).filter((v) => v >= 0);
  return {
    name,
    interventions,
    n: runs.length,
    metrics,
    buildCollapseFraction: collapsed('tBuildCollapse'),
    propCollapseFraction: collapsed('tPropCollapse'),
    decoupleFraction: collapsed('tDecouple'),
    tDecoupleMedian: decoupleTimes.length ? median(decoupleTimes) : -1,
  };
}

function pairedDelta(
  values: readonly number[],
  control: readonly number[],
  key: string,
): { mean: number; lo: number; hi: number } {
  const diffs = values.map((v, i) => v - (control[i] ?? 0));
  const ci = bootstrapCI(diffs, { r: fnv1a32(`paired:${key}`) % 0x7fffffff });
  return { mean: mean(diffs), lo: ci.lo, hi: ci.hi };
}

/** Point estimate met / not met, with CI ambiguity. */
function meets(ok: boolean, violates: boolean): 'met' | 'violated' | 'ambiguous' {
  if (ok) return 'met';
  if (violates) return 'violated';
  return 'ambiguous';
}

export interface SelfAttackObservation {
  seed: string;
  interventions: Interventions;
  ticks: number;
  burnIn: number;
  metrics: RunMetrics;
}

export function observeRun(run: SelfAttackRun): SelfAttackObservation {
  return {
    seed: run.seed,
    interventions: run.interventions,
    ticks: run.ticks,
    burnIn: run.burnIn,
    metrics: runMetrics(run),
  };
}

export function buildSelfAttackReportFromObservations(obs: readonly SelfAttackObservation[]): SelfAttackReport {
  if (!obs.length) throw new Error('self-attack report needs at least one run');
  const byCondition = new Map<string, SelfAttackObservation[]>();
  for (const o of obs) {
    const key = CONDITION_NAMES.find((n) => {
      const i = conditionByName(n);
      return i.cost === o.interventions.cost && i.boundary === o.interventions.boundary && i.signal === o.interventions.signal;
    });
    if (!key) throw new Error('run has an unknown intervention combination');
    const list = byCondition.get(key) ?? [];
    list.push(o);
    byCondition.set(key, list);
  }
  const seeds = [...new Set(obs.map((o) => o.seed))];
  const conditions = CONDITION_NAMES.map((name) =>
    summariseCondition(name, conditionByName(name), byCondition.get(name) ?? []),
  );
  const control = conditions.find((c) => c.name === 'control')!;
  const rescueFloor = Math.max(1e-9, SA_FLOOR_SD * stdev(control.metrics.propLate!.values));
  const interactionFloor = Math.max(1e-9, SA_FLOOR_SD * stdev(control.metrics.propLate!.values));

  // --- B-SELF-03: is scale-2 output gated by local builder supply? ---
  const allRows = obs.map((o) => o.metrics);
  const lb = allRows.map((r) => r.lbLate);
  const prop = allRows.map((r) => r.propLate);
  const birth = allRows.map((r) => r.birthLate);
  const rhoBuild = spearmanCI(lb, prop, { r: 1337 });
  const rhoBirth = spearmanCI(birth, prop, { r: 4242 });

  const claims: ClaimVerdict[] = [];

  // --- B-SELF-01 ---
  {
    const persist = control.metrics.birthRetention!;
    const propRet = control.metrics.propRetention!;
    const buildRet = control.metrics.buildRetention!;
    const a = meets(persist.mean >= 0.8 && persist.lo > 0.5, persist.mean < 0.5 || persist.hi <= 0.5);
    const b = meets(propRet.mean <= 0.25 && propRet.hi < 0.5, propRet.mean > 0.5 || propRet.lo >= 0.25);
    const c = meets(buildRet.mean <= 0.5 && buildRet.hi < 0.75, buildRet.mean > 0.75 || buildRet.lo >= 0.5);
    const verdict: Verdict =
      a === 'met' && b === 'met' && c === 'met'
        ? 'supported'
        : a === 'violated' || b === 'violated' || c === 'violated'
          ? 'refuted'
          : 'inconclusive';
    claims.push({
      id: 'B-SELF-01',
      claim:
        'In the unmanaged control, local reproduction persists at the end of the run while scale-2 reproduction collapses and the builder fraction is more than halved.',
      verdict,
      detail: `local birth retention ${persist.mean.toFixed(3)} [${persist.lo.toFixed(3)}, ${persist.hi.toFixed(3)}] (need >= 0.80, lo > 0.50); propagule retention ${propRet.mean.toFixed(3)} [${propRet.lo.toFixed(3)}, ${propRet.hi.toFixed(3)}] (need <= 0.25, hi < 0.50); builder retention ${buildRet.mean.toFixed(3)} [${buildRet.lo.toFixed(3)}, ${buildRet.hi.toFixed(3)}] (need <= 0.50, hi < 0.75).`,
      numbers: {
        birthRetention: persist.mean,
        birthRetentionLo: persist.lo,
        propRetention: propRet.mean,
        propRetentionHi: propRet.hi,
        buildRetention: buildRet.mean,
        buildRetentionHi: buildRet.hi,
      },
    });
  }

  // --- B-SELF-02a/b/c: single-link rescues ---
  const singles: { id: string; name: string; key: InterventionKey }[] = [
    { id: 'B-SELF-02a', name: 'cost', key: 'cost' },
    { id: 'B-SELF-02b', name: 'boundary', key: 'boundary' },
    { id: 'B-SELF-02c', name: 'signal', key: 'signal' },
  ];
  for (const s of singles) {
    const cond = conditions.find((c) => c.name === s.name)!;
    const d = pairedDelta(cond.metrics.propLate!.values, control.metrics.propLate!.values, s.name);
    const verdict: Verdict = d.mean >= rescueFloor && d.lo > 0 ? 'supported' : d.mean < 0 ? 'refuted' : 'inconclusive';
    claims.push({
      id: s.id,
      claim: `Intervening on the ${s.key} link alone raises late-window scale-2 reproduction above the control by at least ${rescueFloor.toFixed(3)} propagules/tick (2 between-seed SD of the control), with a paired 95% interval above zero.`,
      verdict,
      detail: `delta ${d.mean.toFixed(3)} [${d.lo.toFixed(3)}, ${d.hi.toFixed(3)}]; floor ${rescueFloor.toFixed(3)}.`,
      numbers: { delta: d.mean, lo: d.lo, hi: d.hi, floor: rescueFloor },
    });
  }

  // --- B-SELF-03: bottleneck is builder supply, not local births ---
  {
    const a = meets(rhoBuild.rho >= 0.7 && rhoBuild.lo > 0.5, rhoBuild.rho < 0.5);
    const b = meets(Math.abs(rhoBirth.rho) < 0.5, Math.abs(rhoBirth.rho) >= 0.7);
    const verdict: Verdict = a === 'met' && b === 'met' ? 'supported' : a === 'violated' || b === 'violated' ? 'refuted' : 'inconclusive';
    claims.push({
      id: 'B-SELF-03',
      claim:
        'Across all runs, late scale-2 reproduction is gated by the local builder fraction (Spearman rho >= 0.70) and not by the late local birth rate (|rho| < 0.50): the bottleneck separating local from hierarchical reproduction is the collective\'s builder supply.',
      verdict,
      detail: `rho(localBuild, propagules) = ${rhoBuild.rho.toFixed(3)} [${rhoBuild.lo.toFixed(3)}, ${rhoBuild.hi.toFixed(3)}]; rho(births, propagules) = ${rhoBirth.rho.toFixed(3)} [${rhoBirth.lo.toFixed(3)}, ${rhoBirth.hi.toFixed(3)}]; n = ${allRows.length}.`,
      numbers: {
        rhoBuild: rhoBuild.rho,
        rhoBuildLo: rhoBuild.lo,
        rhoBuildHi: rhoBuild.hi,
        rhoBirth: rhoBirth.rho,
        absRhoBirth: Math.abs(rhoBirth.rho),
        rhoBirthLo: rhoBirth.lo,
        rhoBirthHi: rhoBirth.hi,
        n: allRows.length,
      },
    });
  }

  // --- B-SELF-04: super-additivity of the combined intervention ---
  {
    const all = conditions.find((c) => c.name === 'all')!;
    const cost = conditions.find((c) => c.name === 'cost')!;
    const boundary = conditions.find((c) => c.name === 'boundary')!;
    const signal = conditions.find((c) => c.name === 'signal')!;
    const n = all.metrics.propLate!.values.length;
    const inter: number[] = [];
    for (let i = 0; i < n; i++) {
      inter.push(
        all.metrics.propLate!.values[i]! -
          cost.metrics.propLate!.values[i]! -
          boundary.metrics.propLate!.values[i]! -
          signal.metrics.propLate!.values[i]! +
          2 * control.metrics.propLate!.values[i]!,
      );
    }
    const ci = bootstrapCI(inter, { r: 9001 });
    const interaction = mean(inter);
    const verdict: Verdict = interaction >= interactionFloor && ci.lo > 0 ? 'supported' : interaction < 0 ? 'refuted' : 'inconclusive';
    claims.push({
      id: 'B-SELF-04',
      claim:
        'The three interventions are super-additive: applying all three exceeds the sum of the three single-link gains over control by at least the between-seed floor, with a paired 95% interval above zero.',
      verdict,
      detail: `interaction ${interaction.toFixed(3)} [${ci.lo.toFixed(3)}, ${ci.hi.toFixed(3)}]; floor ${interactionFloor.toFixed(3)}.`,
      numbers: { interaction, lo: ci.lo, hi: ci.hi, floor: interactionFloor },
    });
  }

  return {
    generatedAt: new Date().toISOString(),
    ticks: obs[0]!.ticks,
    burnIn: obs[0]!.burnIn,
    seeds,
    rescueFloor,
    interactionFloor,
    conditions,
    bottleneck: {
      rhoBuild: rhoBuild.rho,
      rhoBuildLo: rhoBuild.lo,
      rhoBuildHi: rhoBuild.hi,
      rhoBirth: rhoBirth.rho,
      rhoBirthLo: rhoBirth.lo,
      rhoBirthHi: rhoBirth.hi,
    },
    claims,
  };
}

/** Convenience wrapper for tests and ad-hoc analysis. */
export function buildSelfAttackReport(runs: readonly SelfAttackRun[]): SelfAttackReport {
  return buildSelfAttackReportFromObservations(runs.map(observeRun));
}
