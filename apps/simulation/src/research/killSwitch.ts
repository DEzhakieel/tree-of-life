/**
 * Experiment C - the kill-switch map.
 *
 * Question: which directed perturbation most effectively destroys an emergent
 * colony, and is the correlational importance score (division participation)
 * a valid proxy for causal necessity?
 *
 * Model (self-contained; nothing here touches the agent engine). A colony on a
 * 48x48 torus. Every occupied cell contributes to a colony-level public good
 * in proportion to how crowded it is: production = (n/4)^2 with n the number of
 * occupied 4-neighbours. The good is well mixed inside each connected
 * component, decays, and gates birth at a quorum threshold S_MIN. Births also
 * consume a global nutrient pool, which sets the colony's size. Death rises
 * when the public good is low and when a cell is exposed (few neighbours).
 *
 * This produces two regimes. Above the quorum the colony is self-sustaining;
 * below it no cell can divide and the colony decays to extinction. The
 * experiment maps which lesions push a colony across that threshold.
 *
 * Perturbations are directed, not random flips: remove the densest cells, the
 * most participatory cells, the rim, or a matched random set; seal the
 * core-periphery interface; pause a region; and sweep the lesion location.
 *
 * Pre-registered claims are in `docs/CLAIMS.md` (C-KILL-01..05).
 */
import { fnv1a32 } from '@fractal-life/shared';
import { bootstrapCI, mean, median, mulberry32, stdev } from './stats.js';

export const KS_SIZE = 48;
export const KS_CELLS = KS_SIZE * KS_SIZE;
export const KS_TICKS = 750;
export const KS_BURN = 250;
export const KS_POST = KS_TICKS - KS_BURN;
export const KS_SEED_RADIUS = 6;

/** Birth probability scale once the quorum gate is open. */
export const KS_BIRTH = 1.0;
/** Base death probability at zero public good. */
export const KS_DEATH = 0.10;
/** Public-good production per crowded cell: (n/4)^KS_PROD_EXP. */
export const KS_PROD = 1.0;
export const KS_PROD_EXP = 2;
/** Public-good decay per tick. */
export const KS_DECAY = 0.15;
export const KS_S_MAX = 8;
/** Quorum gate: no birth in a component whose public good is below this. */
export const KS_S_MIN = 3.0;
/** Death suppression by the public good. */
export const KS_S_KILL = 3.0;
/** Extra death for exposed cells. */
export const KS_EXPOSE = 0.5;
/** Global nutrient: regeneration per tick and cost per birth. */
export const KS_RES_REGEN = 0.08;
export const KS_RES_COST = 0.012;
export const KS_RES_MAX = 1;

/** Default lesion size, as a fraction of the colony. */
export const KS_LESION = 0.4;
/** Duration of the pause perturbation. */
export const KS_DELAY = 100;
/** Probability-unit decision floor (3 of 10 paired runs). */
export const KS_FLOOR_PROB = 0.3;
/** Loss floor in between-seed SDs. */
export const KS_FLOOR_SD = 2;
/** Destruction: final population below this fraction of the pre-lesion count. */
export const KS_DESTROY_FRAC = 0.05;
/** A run counts as dipped if it falls below this fraction of its pre-lesion count. */
export const KS_DIP_FRAC = 0.9;
/** Assay viability: control destruction at most this, and this fraction at or above 0.5. */
export const KS_VIABILITY_MAX_DESTRUCTION = 0.2;
export const KS_VIABILITY_MIN_RATIO = 0.5;
export const KS_VIABILITY_MIN_FRACTION = 0.7;
/** Absolute loss floor, in population fraction, in addition to the 2-SD floor. */
export const KS_FLOOR_LOSS_ABS = 0.1;
/** Births are counted over this many final ticks. */
export const KS_LATE_WINDOW = 100;

const NBR: number[][] = [];
for (let y = 0; y < KS_SIZE; y++) {
  for (let x = 0; x < KS_SIZE; x++) {
    NBR.push([
      y * KS_SIZE + ((x + 1) % KS_SIZE),
      y * KS_SIZE + ((x + KS_SIZE - 1) % KS_SIZE),
      ((y + 1) % KS_SIZE) * KS_SIZE + x,
      ((y + KS_SIZE - 1) % KS_SIZE) * KS_SIZE + x,
    ]);
  }
}

export type Verdict = 'supported' | 'refuted' | 'inconclusive';

export interface ConditionSpec {
  readonly name: string;
  readonly kind: 'control' | 'remove' | 'seal' | 'delay';
  readonly target: 'none' | 'core' | 'rim' | 'participation' | 'matched' | 'ageMatched' | 'random';
  readonly fraction: number;
}

/**
 * The twelve registered conditions. `core` and `rim` remove equal numbers of cells
 * by distance from the colony centroid; `participation` removes the cells with
 * the most lifetime divisions; `matched` is a density-matched random control
 * for participation; `seal` cuts the public-good interface; `delay` pauses a
 * region without killing it.
 */
export const KS_CONDITIONS: readonly ConditionSpec[] = [
  { name: 'control', kind: 'control', target: 'none', fraction: 0 },
  { name: 'core', kind: 'remove', target: 'core', fraction: KS_LESION },
  { name: 'rim', kind: 'remove', target: 'rim', fraction: KS_LESION },
  { name: 'participation', kind: 'remove', target: 'participation', fraction: KS_LESION },
  { name: 'matched', kind: 'remove', target: 'matched', fraction: KS_LESION },
  { name: 'ageMatched', kind: 'remove', target: 'ageMatched', fraction: KS_LESION },
  { name: 'random', kind: 'remove', target: 'random', fraction: KS_LESION },
  { name: 'seal', kind: 'seal', target: 'none', fraction: 0 },
  { name: 'randomEdges', kind: 'seal', target: 'none', fraction: 0 },
  { name: 'delayCore', kind: 'delay', target: 'core', fraction: KS_LESION },
  { name: 'delayRim', kind: 'delay', target: 'rim', fraction: KS_LESION },
  { name: 'delayParticipation', kind: 'delay', target: 'participation', fraction: KS_LESION },
];

/** Doses used by the dose-response sweep (fraction of the pre-lesion colony). */
export const KS_DOSES: readonly number[] = [0.05, 0.1, 0.15, 0.2, 0.3, 0.4];
/** Targets compared across doses. */
export const KS_DOSE_TARGETS = ['participation', 'matched', 'ageMatched', 'random'] as const;

/** Location sweep: centre, eight mid-radius azimuths, one rim point. */
export const KS_SWEEP: readonly { label: string; angle: number; radiusFrac: number }[] = [
  { label: 'centre', angle: 0, radiusFrac: 0 },
  ...Array.from({ length: 8 }, (_, i) => ({
    label: `mid-${i}`,
    angle: (i * Math.PI) / 4,
    radiusFrac: 0.5,
  })),
  { label: 'rim', angle: 0, radiusFrac: 0.9 },
];

export interface KillSwitchConfig {
  readonly seed: string;
  readonly condition?: string;
  readonly ticks?: number;
  /** Override the condition's target/fraction (used by the dose and sweep arms). */
  readonly target?: ConditionSpec['target'];
  readonly fraction?: number;
  /** Sweep lesion point, relative to the colony centroid at the burn tick. */
  readonly lesion?: { angle: number; radiusFrac: number };
  /** Label carried into the observation; defaults to the condition name. */
  readonly label?: string;
}

interface State {
  occ: Uint8Array;
  age: Uint16Array;
  div: Uint16Array;
  wallE: Uint8Array;
  wallS: Uint8Array;
  s: Float32Array;
  res: number;
  frozen: Uint8Array | null;
}

function wallBetween(st: State, i: number, j: number): boolean {
  const x = i % KS_SIZE;
  const y = (i - x) / KS_SIZE;
  const jx = j % KS_SIZE;
  const jy = (j - jx) / KS_SIZE;
  if (jx === (x + 1) % KS_SIZE && jy === y) return st.wallE[i] === 1;
  if (jx === (x + KS_SIZE - 1) % KS_SIZE && jy === y) return st.wallE[j] === 1;
  if (jy === (y + 1) % KS_SIZE && jx === x) return st.wallS[i] === 1;
  if (jy === (y + KS_SIZE - 1) % KS_SIZE && jx === x) return st.wallS[j] === 1;
  return true;
}

function density(st: State, i: number): number {
  let n = 0;
  for (const j of NBR[i]!) {
    if (wallBetween(st, i, j)) continue;
    if (st.occ[j]) n++;
  }
  return n;
}

function initialState(): State {
  const st: State = {
    occ: new Uint8Array(KS_CELLS),
    age: new Uint16Array(KS_CELLS),
    div: new Uint16Array(KS_CELLS),
    wallE: new Uint8Array(KS_CELLS),
    wallS: new Uint8Array(KS_CELLS),
    s: new Float32Array(KS_CELLS),
    res: 1,
    frozen: null,
  };
  const c = KS_SIZE / 2;
  for (let y = 0; y < KS_SIZE; y++) {
    for (let x = 0; x < KS_SIZE; x++) {
      if (Math.hypot(x - c, y - c) <= KS_SEED_RADIUS) {
        const i = y * KS_SIZE + x;
        st.occ[i] = 1;
        st.s[i] = 4;
      }
    }
  }
  return st;
}

function components(st: State): { comp: Int32Array; cells: number[]; prod: number[]; sumS: number[] } {
  const comp = new Int32Array(KS_CELLS).fill(-1);
  const cells: number[] = [];
  const prod: number[] = [];
  const sumS: number[] = [];
  const stack: number[] = [];
  for (let i = 0; i < KS_CELLS; i++) {
    if (!st.occ[i] || comp[i]! >= 0) continue;
    const id = cells.length;
    cells.push(0);
    prod.push(0);
    sumS.push(0);
    comp[i] = id;
    stack.push(i);
    while (stack.length) {
      const c = stack.pop()!;
      cells[id] = cells[id]! + 1;
      sumS[id] = sumS[id]! + st.s[c]!;
      // A paused cell is metabolically paused: it neither produces nor consumes.
      if (!(st.frozen && st.frozen[c])) prod[id] = prod[id]! + (density(st, c) / 4) ** KS_PROD_EXP;
      for (const j of NBR[c]!) {
        if (!st.occ[j] || comp[j]! >= 0) continue;
        if (wallBetween(st, c, j)) continue;
        comp[j] = id;
        stack.push(j);
      }
    }
  }
  return { comp, cells, prod, sumS };
}

function step(st: State, rng: () => number): { births: number; deaths: number } {
  st.res = Math.min(KS_RES_MAX, st.res + KS_RES_REGEN * (1 - st.res));
  const { comp, cells, prod, sumS } = components(st);
  const sComp: number[] = [];
  for (let id = 0; id < cells.length; id++) {
    const prev = cells[id] ? sumS[id]! / cells[id]! : 0;
    const f = cells[id] ? prod[id]! / cells[id]! : 0;
    sComp[id] = Math.max(0, Math.min(KS_S_MAX, prev + KS_PROD * f - KS_DECAY * prev));
  }
  for (let i = 0; i < KS_CELLS; i++) {
    if (comp[i]! >= 0 && !(st.frozen && st.frozen[i])) st.s[i] = sComp[comp[i]!]!;
  }

  const list: number[] = [];
  for (let i = 0; i < KS_CELLS; i++) {
    if (st.occ[i] && !(st.frozen && st.frozen[i])) list.push(i);
  }
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const t = list[i]!;
    list[i] = list[j]!;
    list[j] = t;
  }

  let births = 0;
  for (const i of list) {
    if (!st.occ[i]) continue;
    if (st.s[i]! < KS_S_MIN) continue;
    const n = density(st, i);
    if (n >= 4) continue;
    const empties: number[] = [];
    for (const j of NBR[i]!) {
      if (wallBetween(st, i, j)) continue;
      if (!st.occ[j]) empties.push(j);
    }
    if (!empties.length) continue;
    const support = empties.reduce((acc, j) => acc + (density(st, j) > 0 ? 1 : 0), 0);
    if (st.res < KS_RES_COST) break;
    if (rng() < KS_BIRTH * (support / 4)) {
      const j = empties[Math.floor(rng() * empties.length)]!;
      st.occ[j] = 1;
      st.age[j] = 0;
      st.div[j] = 0;
      st.s[j] = st.s[i]!;
      st.age[i] = 0;
      st.div[i] = st.div[i]! + 1;
      st.res -= KS_RES_COST;
      births++;
    }
  }

  let deaths = 0;
  for (const i of list) {
    if (!st.occ[i]) continue;
    const n = density(st, i);
    const d = (KS_DEATH / (1 + KS_S_KILL * st.s[i]!)) * (1 + (KS_EXPOSE * (4 - n)) / 4);
    if (rng() < d) {
      st.occ[i] = 0;
      st.age[i] = 0;
      deaths++;
    }
  }
  for (const i of list) {
    if (st.occ[i] && st.age[i]! < 60000) st.age[i] = st.age[i]! + 1;
  }
  return { births, deaths };
}

function occupied(st: State): number[] {
  const out: number[] = [];
  for (let i = 0; i < KS_CELLS; i++) if (st.occ[i]) out.push(i);
  return out;
}

function centroid(st: State): { x: number; y: number; radius: number; n: number } {
  const list = occupied(st);
  let sx = 0;
  let sy = 0;
  for (const i of list) {
    sx += i % KS_SIZE;
    sy += Math.floor(i / KS_SIZE);
  }
  const n = list.length;
  const x = sx / Math.max(1, n);
  const y = sy / Math.max(1, n);
  let ss = 0;
  for (const i of list) {
    const dx = (i % KS_SIZE) - x;
    const dy = Math.floor(i / KS_SIZE) - y;
    ss += dx * dx + dy * dy;
  }
  return { x, y, radius: Math.sqrt(ss / Math.max(1, n)), n };
}

function torusDist(ax: number, ay: number, bx: number, by: number): number {
  let dx = Math.abs(ax - bx);
  let dy = Math.abs(ay - by);
  dx = Math.min(dx, KS_SIZE - dx);
  dy = Math.min(dy, KS_SIZE - dy);
  return Math.hypot(dx, dy);
}

function cellDist(i: number, x: number, y: number): number {
  return torusDist(i % KS_SIZE, Math.floor(i / KS_SIZE), x, y);
}

function removeCells(st: State, cells: readonly number[], k: number): number {
  let removed = 0;
  for (const i of cells) {
    if (removed >= k) break;
    if (!st.occ[i]) continue;
    st.occ[i] = 0;
    st.age[i] = 0;
    removed++;
  }
  return removed;
}

function sortedBy<T>(list: number[], key: (i: number) => T, cmp: (a: T, b: T) => number, rng: () => number): number[] {
  // Shuffle first so ties resolve randomly, not by lattice index.
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const t = list[i]!;
    list[i] = list[j]!;
    list[j] = t;
  }
  return list.sort((a, b) => cmp(key(a), key(b)));
}

function wallCircle(st: State, x: number, y: number, radius: number): number {
  let count = 0;
  for (let yy = 0; yy < KS_SIZE; yy++) {
    for (let xx = 0; xx < KS_SIZE; xx++) {
      const i = yy * KS_SIZE + xx;
      const d0 = torusDist(xx, yy, x, y);
      const ex = (xx + 1) % KS_SIZE;
      const d1 = torusDist(ex, yy, x, y);
      if (d0 !== d1 && (d0 - radius) * (d1 - radius) <= 0 && !st.wallE[i]) {
        st.wallE[i] = 1;
        count++;
      }
      const sy = (yy + 1) % KS_SIZE;
      const d2 = torusDist(xx, sy, x, y);
      if (d0 !== d2 && (d0 - radius) * (d2 - radius) <= 0 && !st.wallS[i]) {
        st.wallS[i] = 1;
        count++;
      }
    }
  }
  return count;
}

function wallRandom(st: State, k: number, rng: () => number): number {
  const edges: { i: number; dir: 'E' | 'S' }[] = [];
  for (let y = 0; y < KS_SIZE; y++) {
    for (let x = 0; x < KS_SIZE; x++) {
      const i = y * KS_SIZE + x;
      if (!st.occ[i]) continue;
      const e = y * KS_SIZE + ((x + 1) % KS_SIZE);
      if (st.occ[e]) edges.push({ i, dir: 'E' });
      const s = ((y + 1) % KS_SIZE) * KS_SIZE + x;
      if (st.occ[s]) edges.push({ i, dir: 'S' });
    }
  }
  let count = 0;
  for (let n = 0; n < Math.min(k, edges.length); n++) {
    const idx = Math.floor(rng() * edges.length);
    const e = edges[idx]!;
    edges[idx] = edges[edges.length - 1]!;
    edges.pop();
    if (e.dir === 'E') st.wallE[e.i] = 1;
    else st.wallS[e.i] = 1;
    count++;
  }
  return count;
}

export interface PerturbationRecord {
  readonly kind: string;
  readonly target: string;
  readonly removed: number;
  readonly edges: number;
  readonly frozen: number;
  readonly radiusFrac: number;
  readonly angle: number;
  /** Number of connected components immediately after the perturbation. */
  readonly components: number;
  /** Largest connected component as a fraction of surviving cells. */
  readonly largestFrac: number;
}

function applyPerturbation(
  st: State,
  spec: ConditionSpec,
  rng: () => number,
  opts: { target?: ConditionSpec['target']; fraction?: number; lesion?: { angle: number; radiusFrac: number } },
): PerturbationRecord {
  const c = centroid(st);
  const list = occupied(st);
  const target = opts.target ?? spec.target;
  const fraction = opts.fraction ?? spec.fraction;
  const k = Math.round(c.n * fraction);
  const angle = opts.lesion ? opts.lesion.angle : 0;
  const radiusFrac = opts.lesion ? opts.lesion.radiusFrac : 0;
  let removed = 0;
  let edges = 0;
  let frozen = 0;

  if (spec.kind === 'remove') {
    if (target === 'core') {
      removed = removeCells(st, sortedBy([...list], (i) => cellDist(i, c.x, c.y), (a, b) => a - b, rng), k);
    } else if (target === 'rim') {
      removed = removeCells(st, sortedBy([...list], (i) => cellDist(i, c.x, c.y), (a, b) => b - a, rng), k);
    } else if (target === 'participation') {
      removed = removeCells(st, sortedBy([...list], (i) => st.div[i]!, (a, b) => b - a, rng), k);
    } else if (target === 'matched') {
      const top = sortedBy([...list], (i) => st.div[i]!, (a, b) => b - a, rng).slice(0, k);
      const want = top.map((i) => density(st, i));
      const buckets: number[][] = [[], [], [], [], []];
      for (const i of list) buckets[density(st, i)]!.push(i);
      for (const d of want) {
        const bucket = buckets[d]!;
        if (!bucket.length) continue;
        const idx = Math.floor(rng() * bucket.length);
        const cell = bucket[idx]!;
        bucket[idx] = bucket[bucket.length - 1]!;
        bucket.pop();
        if (st.occ[cell]) {
          st.occ[cell] = 0;
          removed++;
        }
      }
    } else if (target === 'ageMatched') {
      // Control for the age distribution of the participation target, without
      // preserving its spatial clustering: same ages, random locations.
      const top = sortedBy([...list], (i) => st.div[i]!, (a, b) => b - a, rng).slice(0, k);
      const topSet = new Set(top);
      const bins = new Map<number, number[]>();
      const width = 5;
      for (const i of list) {
        if (topSet.has(i)) continue;
        const b = Math.floor(st.age[i]! / width);
        const bucket = bins.get(b) ?? [];
        bucket.push(i);
        bins.set(b, bucket);
      }
      const used = new Set<number>();
      for (const i of top) {
        const b = Math.floor(st.age[i]! / width);
        const bucket = bins.get(b) ?? [];
        let cell = -1;
        while (bucket.length) {
          const idx = Math.floor(rng() * bucket.length);
          const cand = bucket[idx]!;
          bucket[idx] = bucket[bucket.length - 1]!;
          bucket.pop();
          if (!used.has(cand) && st.occ[cand]) {
            cell = cand;
            break;
          }
        }
        if (cell >= 0) {
          used.add(cell);
          st.occ[cell] = 0;
          removed++;
        }
      }
    } else if (target === 'random') {
      removed = removeCells(st, sortedBy([...list], () => rng(), (a, b) => a - b, rng), k);
    } else if (opts.lesion) {
      const x = c.x + Math.cos(angle) * c.radius * radiusFrac;
      const y = c.y + Math.sin(angle) * c.radius * radiusFrac;
      removed = removeCells(st, sortedBy([...list], (i) => cellDist(i, x, y), (a, b) => a - b, rng), k);
    }
  } else if (spec.kind === 'seal') {
    if (spec.name === 'seal') {
      edges = wallCircle(st, c.x, c.y, c.radius * 0.6);
    } else {
      const sealEdges = wallCircle(st, c.x, c.y, c.radius * 0.6);
      st.wallE.fill(0);
      st.wallS.fill(0);
      edges = wallRandom(st, sealEdges, rng);
    }
  } else if (spec.kind === 'delay') {
    st.frozen = new Uint8Array(KS_CELLS);
    let ordered: number[];
    if (target === 'participation') {
      ordered = sortedBy([...list], (i) => st.div[i]!, (a, b) => b - a, rng);
    } else if (target === 'core') {
      ordered = sortedBy([...list], (i) => cellDist(i, c.x, c.y), (a, b) => a - b, rng);
    } else {
      ordered = sortedBy([...list], (i) => cellDist(i, c.x, c.y), (a, b) => b - a, rng);
    }
    for (const i of ordered.slice(0, k)) {
      st.frozen[i] = 1;
      frozen++;
    }
  }

  const post = components(st);
  let largest = 0;
  for (const n of post.cells) if (n > largest) largest = n;
  const surviving = post.cells.reduce((a, b) => a + b, 0);

  return {
    kind: spec.kind,
    target,
    removed,
    edges,
    frozen,
    radiusFrac,
    angle,
    components: post.cells.length,
    largestFrac: surviving ? largest / surviving : 0,
  };
}

export interface NamedSeries {
  readonly pop: number[];
  readonly f: number[];
  readonly s: number[];
}

export interface KillSwitchRun {
  readonly seed: string;
  readonly condition: string;
  readonly label: string;
  readonly ticks: number;
  readonly burn: number;
  readonly pop0: number;
  readonly finalPop: number;
  readonly minPop: number;
  readonly destruction: boolean;
  readonly dipped: boolean;
  readonly recoveryTick: number;
  readonly lateBirths: number;
  readonly birthsTotal: number;
  readonly deathsTotal: number;
  readonly perturbation: PerturbationRecord;
  readonly series: NamedSeries;
  readonly sampleEvery: number;
}

function observe(st: State): { pop: number; f: number; s: number } {
  const list = occupied(st);
  let prod = 0;
  for (const i of list) prod += (density(st, i) / 4) ** KS_PROD_EXP;
  const { comp, cells } = components(st);
  let best = -1;
  let bestCells = 0;
  for (let id = 0; id < cells.length; id++) {
    if (cells[id]! > bestCells) {
      bestCells = cells[id]!;
      best = id;
    }
  }
  let s = 0;
  if (best >= 0) {
    for (let i = 0; i < KS_CELLS; i++) {
      if (comp[i] === best) {
        s = st.s[i]!;
        break;
      }
    }
  }
  return { pop: list.length, f: prod / Math.max(1, list.length), s };
}

/**
 * One run. Determinism: the seed alone drives the warm-up, so every condition
 * shares the same pre-perturbation trajectory for a given seed.
 */
export function runKillSwitch(config: KillSwitchConfig): KillSwitchRun {
  const spec = KS_CONDITIONS.find((c) => c.name === (config.condition ?? 'control'));
  if (!spec) throw new Error(`unknown condition: ${config.condition}`);
  const ticks = Math.max(KS_BURN + 50, config.ticks ?? KS_TICKS);
  const st = initialState();
  // Dynamics and perturbation choices use independent streams: the perturbed
  // arm must not shift the noise sequence that the control sees.
  const rng = mulberry32(fnv1a32(`killswitch:dyn:${config.seed}`));
  const pertRng = mulberry32(fnv1a32(`killswitch:pert:${config.seed}`));

  const series: NamedSeries = { pop: [], f: [], s: [] };
  const sampleEvery = 5;
  const lateWindow = Math.min(KS_LATE_WINDOW, ticks - KS_BURN);
  const lateFrom = ticks - lateWindow;
  let birthsTotal = 0;
  let deathsTotal = 0;
  let pop0 = 0;
  let minPop = 0;
  let destruction = false;
  let dipped = false;
  let recoveryTick = -1;
  let lateBirths = 0;
  let perturbation: PerturbationRecord = {
    kind: 'none',
    target: 'none',
    removed: 0,
    edges: 0,
    frozen: 0,
    radiusFrac: 0,
    angle: 0,
    components: 0,
    largestFrac: 1,
  };

  for (let t = 0; t < ticks; t++) {
    if (t === KS_BURN) {
      pop0 = occupied(st).length;
      perturbation = applyPerturbation(st, spec, pertRng, {
        target: config.target,
        fraction: config.fraction,
        lesion: config.lesion,
      });
      // A delay is lifted after KS_DELAY ticks.
      minPop = pop0;
    }
    if (st.frozen && t === KS_BURN + KS_DELAY) st.frozen = null;

    const { births, deaths } = step(st, rng);
    birthsTotal += births;
    deathsTotal += deaths;
    const pop = occupied(st).length;
    if (t >= KS_BURN) {
      if (pop < minPop) minPop = pop;
      if (pop < KS_DIP_FRAC * pop0) dipped = true;
      if (dipped && recoveryTick < 0 && pop >= KS_DIP_FRAC * pop0) recoveryTick = t - KS_BURN;
      if (t >= lateFrom) lateBirths += births;
    }
    if (t % sampleEvery === sampleEvery - 1) {
      const o = observe(st);
      series.pop.push(o.pop);
      series.f.push(o.f);
      series.s.push(o.s);
    }
  }

  const finalPop = occupied(st).length;
  destruction = finalPop < KS_DESTROY_FRAC * pop0;
  if (destruction) recoveryTick = -1;

  return {
    seed: config.seed,
    condition: spec.name,
    label: config.label ?? spec.name,
    ticks,
    burn: KS_BURN,
    pop0,
    finalPop,
    minPop,
    destruction,
    dipped,
    recoveryTick,
    lateBirths: lateBirths / Math.max(1, lateWindow),
    birthsTotal,
    deathsTotal,
    perturbation,
    series,
    sampleEvery,
  };
}

export interface KillSwitchObservation {
  readonly seed: string;
  readonly task: 'condition' | 'dose' | 'sweep';
  readonly condition: string;
  readonly label: string;
  readonly target: string;
  readonly fraction: number;
  readonly sweepIndex: number;
  readonly radiusFrac: number;
  readonly angle: number;
  readonly ticks: number;
  readonly pop0: number;
  readonly finalPop: number;
  readonly minPop: number;
  readonly destruction: boolean;
  readonly dipped: boolean;
  readonly recoveryTick: number;
  readonly lateBirths: number;
  readonly removed: number;
  readonly edges: number;
  readonly frozen: number;
  readonly components: number;
  readonly largestFrac: number;
  readonly series: NamedSeries;
}

export function observeRun(
  run: KillSwitchRun,
  meta: { task: KillSwitchObservation['task']; sweepIndex?: number; fraction?: number; radiusFrac?: number; angle?: number },
): KillSwitchObservation {
  return {
    seed: run.seed,
    task: meta.task,
    condition: run.condition,
    label: run.label,
    target: run.perturbation.target,
    fraction: meta.fraction ?? run.perturbation.removed / Math.max(1, run.pop0),
    sweepIndex: meta.sweepIndex ?? -1,
    radiusFrac: meta.radiusFrac ?? run.perturbation.radiusFrac,
    angle: meta.angle ?? run.perturbation.angle,
    ticks: run.ticks,
    pop0: run.pop0,
    finalPop: run.finalPop,
    minPop: run.minPop,
    destruction: run.destruction,
    dipped: run.dipped,
    recoveryTick: run.recoveryTick,
    lateBirths: run.lateBirths,
    removed: run.perturbation.removed,
    edges: run.perturbation.edges,
    frozen: run.perturbation.frozen,
    components: run.perturbation.components,
    largestFrac: run.perturbation.largestFrac,
    series: run.series,
  };
}

export interface ConditionSummary {
  readonly name: string;
  readonly n: number;
  readonly destruction: number;
  readonly meanFinalRatio: number;
  readonly meanLoss: number;
  readonly medianRecovery: number;
  readonly recovered: number;
  readonly censored: number;
  readonly noDip: number;
  readonly meanLateBirths: number;
  readonly meanRemoved: number;
  readonly meanComponents: number;
  readonly meanLargestFrac: number;
}

export interface DosePoint {
  readonly target: string;
  readonly fraction: number;
  readonly n: number;
  readonly destruction: number;
  readonly meanFinalRatio: number;
  readonly meanLoss: number;
}

export interface SweepPoint {
  readonly label: string;
  readonly radiusFrac: number;
  readonly n: number;
  readonly destruction: number;
  readonly meanLoss: number;
}

export interface ClaimVerdict {
  readonly id: string;
  readonly claim: string;
  readonly verdict: Verdict;
  readonly detail: string;
  readonly numbers: Readonly<Record<string, number>>;
}

export interface ControlViability {
  readonly n: number;
  readonly destruction: number;
  readonly meanFinalRatio: number;
  readonly minFinalRatio: number;
  readonly valid: boolean;
  readonly note: string;
}

export interface KillSwitchReport {
  readonly seeds: string[];
  readonly ticks: number;
  readonly burn: number;
  readonly lesionFraction: number;
  readonly conditions: ConditionSummary[];
  readonly doses: DosePoint[];
  readonly sweep: SweepPoint[];
  readonly claims: ClaimVerdict[];
  readonly viability: ControlViability;
  readonly floorProb: number;
  readonly floorLoss: number;
  readonly minKillDose: number;
  readonly randomDose: number;
}

export function spearman(xs: readonly number[], ys: readonly number[]): number {
  const n = Math.min(xs.length, ys.length);
  if (n < 3) return NaN;
  const rank = (v: readonly number[]): number[] => {
    const idx = v.map((_, i) => i).sort((a, b) => v[a]! - v[b]!);
    const r = new Array<number>(n).fill(0);
    let i = 0;
    while (i < n) {
      let j = i;
      while (j + 1 < n && v[idx[j + 1]!]! === v[idx[i]!]!) j++;
      const avg = (i + j) / 2 + 1;
      for (let k = i; k <= j; k++) r[idx[k]!] = avg;
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
    num += (rx[i]! - mx) * (ry[i]! - my);
    dx += (rx[i]! - mx) ** 2;
    dy += (ry[i]! - my) ** 2;
  }
  return dx > 0 && dy > 0 ? num / Math.sqrt(dx * dy) : 0;
}

function pairedDiff(values: readonly number[], control: readonly number[]): number[] {
  return values.map((v, i) => v - (control[i] ?? 0));
}

function summariseCondition(
  obs: readonly KillSwitchObservation[],
  controlFinal: Map<string, number>,
  name: string,
  key: (o: KillSwitchObservation) => boolean,
): ConditionSummary {
  const rows = obs.filter((o) => o.task === 'condition' && key(o));
  const sorted = [...rows].sort((a, b) => a.seed.localeCompare(b.seed));
  const losses = sorted.map((o) => {
    const base = controlFinal.get(o.seed) ?? o.finalPop;
    return 1 - o.finalPop / Math.max(1, base);
  });
  const rec = sorted.filter((o) => o.dipped && o.recoveryTick >= 0).map((o) => o.recoveryTick);
  const dippedRows = sorted.filter((o) => o.dipped);
  return {
    name,
    n: rows.length,
    destruction: mean(rows.map((o) => (o.destruction ? 1 : 0))),
    meanFinalRatio: mean(rows.map((o) => o.finalPop / Math.max(1, o.pop0))),
    meanLoss: mean(losses),
    medianRecovery: rec.length ? median(rec) : NaN,
    recovered: rec.length,
    censored: dippedRows.length - rec.length,
    noDip: rows.length - dippedRows.length,
    meanLateBirths: mean(rows.map((o) => o.lateBirths)),
    meanRemoved: mean(rows.map((o) => o.removed)),
    meanComponents: mean(rows.map((o) => o.components)),
    meanLargestFrac: mean(rows.map((o) => o.largestFrac)),
  };
}

/**
 * Claims are evaluated only from observations. The decision rule and every
 * threshold here were registered before the confirmatory seeds were run.
 */
export function buildKillSwitchReport(obs: readonly KillSwitchObservation[]): KillSwitchReport {
  const seeds = [...new Set(obs.map((o) => o.seed))].sort();
  const controlRows = obs.filter((o) => o.task === 'condition' && o.condition === 'control');
  const controlFinal = new Map(controlRows.map((o) => [o.seed, o.finalPop]));
  const byName = (name: string) => (o: KillSwitchObservation) => o.condition === name;

  const controlRatio = controlRows.map((o) => o.finalPop / Math.max(1, o.pop0));
  const controlDestruction = mean(controlRows.map((o) => (o.destruction ? 1 : 0)));
  const controlMeanRatio = mean(controlRatio);
  const controlMinRatio = controlRatio.length ? Math.min(...controlRatio) : NaN;
  const controlStable = controlRatio.filter((r) => r >= KS_VIABILITY_MIN_RATIO).length;
  const viable =
    controlRows.length >= 5 &&
    controlDestruction <= KS_VIABILITY_MAX_DESTRUCTION &&
    controlStable >= KS_VIABILITY_MIN_FRACTION * controlRows.length;
  const viability: ControlViability = {
    n: controlRows.length,
    destruction: controlDestruction,
    meanFinalRatio: controlMeanRatio,
    minFinalRatio: controlMinRatio,
    valid: viable,
    note: viable
      ? 'control stays above the viability gate'
      : `control failed the viability gate (n=${controlRows.length}, destruction=${controlDestruction.toFixed(2)}, mean final ratio=${controlMeanRatio.toFixed(2)}, stable=${controlStable}/${controlRows.length})`,
  };

  const conditions: ConditionSummary[] = KS_CONDITIONS.map((c) =>
    summariseCondition(obs, controlFinal, c.name, byName(c.name)),
  );

  const doseRows = obs.filter((o) => o.task === 'dose');
  const doses: DosePoint[] = [];
  for (const target of KS_DOSE_TARGETS) {
    for (const fraction of KS_DOSES) {
      const rows = doseRows.filter((o) => o.target === target && Math.abs(o.fraction - fraction) < 1e-9);
      if (!rows.length) continue;
      doses.push({
        target,
        fraction,
        n: rows.length,
        destruction: mean(rows.map((o) => (o.destruction ? 1 : 0))),
        meanFinalRatio: mean(rows.map((o) => o.finalPop / Math.max(1, o.pop0))),
        meanLoss: mean(
          rows.map((o) => 1 - o.finalPop / Math.max(1, controlFinal.get(o.seed) ?? o.finalPop)),
        ),
      });
    }
  }

  const sweepRows = obs.filter((o) => o.task === 'sweep');
  const sweep: SweepPoint[] = [];
  for (let i = 0; i < KS_SWEEP.length; i++) {
    const rows = sweepRows.filter((o) => o.sweepIndex === i);
    if (!rows.length) continue;
    sweep.push({
      label: KS_SWEEP[i]!.label,
      radiusFrac: KS_SWEEP[i]!.radiusFrac,
      n: rows.length,
      destruction: mean(rows.map((o) => (o.destruction ? 1 : 0))),
      meanLoss: mean(
        rows.map((o) => 1 - o.finalPop / Math.max(1, controlFinal.get(o.seed) ?? o.finalPop)),
      ),
    });
  }

  // Paired destruction differences, ordered by seed.
  const paired = (a: string, b: string): { diffs: number[]; mean: number; lo: number; hi: number } => {
    const rowsA = obs
      .filter((o) => o.task === 'condition' && o.condition === a)
      .sort((x, y) => x.seed.localeCompare(y.seed));
    const rowsB = obs
      .filter((o) => o.task === 'condition' && o.condition === b)
      .sort((x, y) => x.seed.localeCompare(y.seed));
    const diffs = rowsA.map((o, i) => (o.destruction ? 1 : 0) - (rowsB[i]?.destruction ? 1 : 0));
    const ci = bootstrapCI(diffs, { r: fnv1a32(`paired:${a}:${b}`) % 0x7fffffff });
    return { diffs, mean: mean(diffs), lo: ci.lo, hi: ci.hi };
  };

  const partRandom = paired('participation', 'random');
  const partMatched = paired('participation', 'matched');
  const partAge = paired('participation', 'ageMatched');

  const seal = conditions.find((c) => c.name === 'seal')!;
  const sealLossDiffs = obs
    .filter((o) => o.task === 'condition' && o.condition === 'seal')
    .sort((a, b) => a.seed.localeCompare(b.seed))
    .map((o) => {
      const base = controlFinal.get(o.seed) ?? o.finalPop;
      return 1 - o.finalPop / Math.max(1, base);
    });
  const randLoss = obs
    .filter((o) => o.task === 'condition' && o.condition === 'randomEdges')
    .sort((a, b) => a.seed.localeCompare(b.seed))
    .map((o) => {
      const base = controlFinal.get(o.seed) ?? o.finalPop;
      return 1 - o.finalPop / Math.max(1, base);
    });
  const sealDiffs = pairedDiff(sealLossDiffs, randLoss);
  const sealCI = bootstrapCI(sealDiffs, { r: 0x5ea1 });
  const floorLoss = Math.max(KS_FLOOR_SD * stdev(randLoss), KS_FLOOR_LOSS_ABS);

  const participation = conditions.find((c) => c.name === 'participation')!;
  const delayPart = conditions.find((c) => c.name === 'delayParticipation')!;
  const delayRows = obs.filter((o) => o.task === 'condition' && o.condition === 'delayParticipation');
  const delayRecovered =
    delayRows.filter((o) => o.finalPop >= 0.9 * (controlFinal.get(o.seed) ?? o.finalPop)).length /
    Math.max(1, delayRows.length);

  // Location equivalence: paired centre-minus-rim loss across seeds.
  const lossBySeed = (condition: string): Map<string, number> => {
    const out = new Map<string, number>();
    for (const o of obs) {
      if (o.task !== 'sweep') continue;
      if (o.sweepIndex !== 0 && o.sweepIndex !== KS_SWEEP.length - 1) continue;
      const isCentre = o.sweepIndex === 0;
      if (condition === 'centre' && !isCentre) continue;
      if (condition === 'rim' && isCentre) continue;
      const base = controlFinal.get(o.seed) ?? o.finalPop;
      out.set(o.seed, 1 - o.finalPop / Math.max(1, base));
    }
    return out;
  };
  const centreLoss = lossBySeed('centre');
  const rimLoss = lossBySeed('rim');
  const locationDiffs = [...centreLoss.keys()]
    .sort()
    .map((seed) => (centreLoss.get(seed) ?? 0) - (rimLoss.get(seed) ?? 0));
  const locationCI = bootstrapCI(locationDiffs, { r: 0x10c });
  const locationMean = mean(locationDiffs);

  const sweepPoints = sweepRows.map((o) => ({
    r: o.radiusFrac,
    loss: 1 - o.finalPop / Math.max(1, controlFinal.get(o.seed) ?? o.finalPop),
    seed: o.seed,
  }));
  const rho = spearman(
    sweepPoints.map((p) => p.r),
    sweepPoints.map((p) => p.loss),
  );
  // Seed-level bootstrap for the sweep correlation.
  const perSeed = new Map<string, { r: number; loss: number }[]>();
  for (const p of sweepPoints) {
    const list = perSeed.get(p.seed) ?? [];
    list.push({ r: p.r, loss: p.loss });
    perSeed.set(p.seed, list);
  }
  const seedList = [...perSeed.keys()].sort();
  const rhoRng = mulberry32(0x5eed);
  let rhoLo = rho;
  let rhoHi = rho;
  const boot: number[] = [];
  for (let b = 0; b < 2000; b++) {
    const xs: number[] = [];
    const ys: number[] = [];
    for (let i = 0; i < seedList.length; i++) {
      const s = seedList[Math.floor(rhoRng() * seedList.length)]!;
      for (const p of perSeed.get(s)!) {
        xs.push(p.r);
        ys.push(p.loss);
      }
    }
    boot.push(spearman(xs, ys));
  }
  boot.sort((a, b) => a - b);
  rhoLo = boot[Math.floor(0.025 * boot.length)] ?? rho;
  rhoHi = boot[Math.floor(0.975 * boot.length)] ?? rho;

  const minKill = doses
    .filter((d) => d.target === 'participation' && d.destruction >= 0.5)
    .sort((a, b) => a.fraction - b.fraction)[0];
  const randomKill = doses
    .filter((d) => d.target === 'random' && d.destruction >= 0.5)
    .sort((a, b) => a.fraction - b.fraction)[0];

  const claims: ClaimVerdict[] = [];

  const c1sup = partRandom.mean >= KS_FLOOR_PROB && partRandom.lo > 0;
  const c1ref = partRandom.mean <= 0;
  claims.push({
    id: 'C-KILL-01',
    claim:
      'Removing the 40% most participatory cells destroys the colony at least 0.30 more often than removing a uniform random 40%, with a paired 95% interval above zero.',
    verdict: c1sup ? 'supported' : c1ref ? 'refuted' : 'inconclusive',
    detail: `participation ${participation.destruction.toFixed(2)} vs random ${conditions.find((c) => c.name === 'random')!.destruction.toFixed(2)}; difference ${partRandom.mean.toFixed(2)} [${partRandom.lo.toFixed(2)}, ${partRandom.hi.toFixed(2)}]; floor ${KS_FLOOR_PROB.toFixed(2)}.`,
    numbers: { difference: partRandom.mean, lo: partRandom.lo, hi: partRandom.hi, floor: KS_FLOOR_PROB },
  });

  const c2sup =
    partAge.mean >= KS_FLOOR_PROB &&
    partAge.lo > 0 &&
    partMatched.mean >= KS_FLOOR_PROB &&
    partMatched.lo > 0;
  const c2ref = partAge.mean <= 0 || partMatched.mean <= 0;
  claims.push({
    id: 'C-KILL-02',
    claim:
      'Participation is not merely age or density: removing the 40% most participatory cells destroys the colony at least 0.30 more often than either an age-matched random set or a density-matched random set, with paired intervals above zero.',
    verdict: c2sup ? 'supported' : c2ref ? 'refuted' : 'inconclusive',
    detail: `participation - ageMatched ${partAge.mean.toFixed(2)} [${partAge.lo.toFixed(2)}, ${partAge.hi.toFixed(2)}]; participation - densityMatched ${partMatched.mean.toFixed(2)} [${partMatched.lo.toFixed(2)}, ${partMatched.hi.toFixed(2)}]; floor ${KS_FLOOR_PROB.toFixed(2)}.`,
    numbers: {
      participationVsAge: partAge.mean,
      ageLo: partAge.lo,
      participationVsDensity: partMatched.mean,
      densityLo: partMatched.lo,
      floor: KS_FLOOR_PROB,
    },
  });

  const c3sup = sealCI.mean >= floorLoss && sealCI.lo > 0 && seal.destruction < 0.5;
  const c3ref = sealCI.mean <= 0 || seal.destruction >= 0.5;
  claims.push({
    id: 'C-KILL-03',
    claim:
      'The interface is a partial kill switch: sealing the core-periphery boundary damages the colony more than cutting the same number of random internal links, but leaves the core alive (destruction below 0.50).',
    verdict: c3sup ? 'supported' : c3ref ? 'refuted' : 'inconclusive',
    detail: `seal - randomEdges loss ${sealCI.mean.toFixed(3)} [${sealCI.lo.toFixed(3)}, ${sealCI.hi.toFixed(3)}]; floor ${floorLoss.toFixed(3)}; seal destruction ${seal.destruction.toFixed(2)}.`,
    numbers: { difference: sealCI.mean, lo: sealCI.lo, hi: sealCI.hi, floor: floorLoss, destruction: seal.destruction },
  });

  const c4sup = delayPart.destruction <= participation.destruction - KS_FLOOR_PROB && delayRecovered >= 0.5;
  const c4ref = delayPart.destruction >= participation.destruction || delayRecovered < 0.3;
  claims.push({
    id: 'C-KILL-04',
    claim:
      'A pause is weaker than a lesion: a 100-tick pause of the most participatory cells destroys the colony at least 0.30 less often than permanent removal, and at least half of paused runs end at 90% or more of the contemporaneous control final population.',
    verdict: c4sup ? 'supported' : c4ref ? 'refuted' : 'inconclusive',
    detail: `pause ${delayPart.destruction.toFixed(2)} vs removal ${participation.destruction.toFixed(2)}; at least 90% of control ${delayRecovered.toFixed(2)}.`,
    numbers: {
      pauseDestruction: delayPart.destruction,
      removalDestruction: participation.destruction,
      recovered: delayRecovered,
    },
  });

  // Equivalence margin: 0.15 in loss. Support means the interval lies inside
  // +/-0.15; refuted means it lies entirely outside.
  const locSup = Math.abs(locationMean) <= 0.15 && locationCI.hi <= 0.15 && locationCI.lo >= -0.15;
  const locRef = locationCI.lo > 0.15 || locationCI.hi < -0.15;
  claims.push({
    id: 'C-KILL-05',
    claim:
      'Compact-lesion location is not a major determinant: centre-minus-rim loss is smaller than 0.15 in absolute value, with the paired 95% interval inside +/-0.15.',
    verdict: locSup ? 'supported' : locRef ? 'refuted' : 'inconclusive',
    detail: `centre - rim loss ${locationMean.toFixed(3)} [${locationCI.lo.toFixed(3)}, ${locationCI.hi.toFixed(3)}]; sweep rho(distance, loss) ${rho.toFixed(2)} [${rhoLo.toFixed(2)}, ${rhoHi.toFixed(2)}].`,
    numbers: {
      difference: locationMean,
      lo: locationCI.lo,
      hi: locationCI.hi,
      rho,
      rhoLo,
      rhoHi,
    },
  });

  const gatedClaims = claims.map((c) =>
    viable
      ? c
      : {
          ...c,
          verdict: 'inconclusive' as Verdict,
          detail: `assay invalid: ${viability.note}. ${c.detail}`,
        },
  );

  return {
    seeds,
    ticks: obs.length ? Math.max(...obs.map((o) => o.ticks)) : KS_TICKS,
    burn: KS_BURN,
    lesionFraction: KS_LESION,
    conditions,
    doses,
    sweep,
    claims: gatedClaims,
    viability,
    floorProb: KS_FLOOR_PROB,
    floorLoss,
    minKillDose: minKill ? minKill.fraction : NaN,
    randomDose: randomKill ? randomKill.fraction : NaN,
  };
}
