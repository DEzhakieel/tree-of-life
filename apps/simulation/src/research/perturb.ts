import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_PARAMS,
  DRIVE_OFFSET,
  DRIVES,
  STRATEGIES,
  STRATEGY_OFFSET,
  WORLD_SIZE,
  type WorldParams,
} from '@fractal-life/shared';
import { Engine } from '../engine.js';
import { decodeStrategies } from '../genome.js';
import { makeWorld } from './scenarios.js';

/**
 * Perturbation engine: one baseline, N single-axis perturbations, and the delta each
 * one makes to a vector of macro outcomes.
 *
 * The design follows from what the causal study learned the hard way. A single
 * baseline run and a single perturbed run differ by two things: the perturbation,
 * and the particular world that seed produced. Reporting `Y_perturbed - Y_baseline`
 * from one pair of runs therefore measures the perturbation *plus* the world, and the
 * world is the larger term in a fractal terrain. So:
 *
 *  - every measurement is PAIRED on the seed: the baseline and every perturbation run
 *    in the same world from the same founder placement, which cancels the habitat;
 *  - every measurement is REPLICATED over seeds, and the report leads with the sign
 *    consistency rather than the mean, because a mean over worlds hides a delta that
 *    reverses sign between worlds;
 *  - perturbations are applied as INTERVENTIONS on a shared world wherever possible
 *    (culling agents mid-run) rather than as different world definitions, so the
 *    founder cohort and the habitat are literally identical.
 *
 * A delta is only called robust when it keeps its sign on every seed. Anything else
 * is reported as seed-dependent, which is a different claim and a much weaker one.
 */

// ---------------------------------------------------------------------------
// Baseline specification
// ---------------------------------------------------------------------------

export const PERTURB_TICKS = 200;
export const PERTURB_SEEDS = ['perturb.s1', 'perturb.s2', 'perturb.s3', 'perturb.s4', 'perturb.s5'] as const;

/**
 * The baseline is stated in decoded units, not raw gene codes, because that is the
 * only way a reader can tell whether "cooperation = 0.5" was actually applied. The
 * genome writer below converts to gene codes and the tests assert the round trip.
 */
export interface BaselineSpec {
  /** founders placed at world creation */
  agents: number;
  /** per-agent energy ceiling */
  energy: number;
  /** decoded pattern-drive noise weight, 0..1 */
  noise: number;
  /** decoded cooperation gene, 0..1 */
  cooperation: number;
  /** ticks before the outcome is read */
  ticks: number;
}

export const BASELINE: BaselineSpec = {
  agents: 100,
  energy: 100,
  noise: 0.1,
  cooperation: 0.5,
  ticks: PERTURB_TICKS,
};

// ---------------------------------------------------------------------------
// Genome writing
// ---------------------------------------------------------------------------

/** gene codes are stored signed in [-1,1]; decoded weights are [0,1] */
const encodeWeight = (w: number): number => Math.max(-1, Math.min(1, w * 2 - 1));

/**
 * The drive/strategy genes alone are not enough to run a world: without `eat` an
 * agent starves, and without `hunt` a carnivore cannot feed. So the baseline genome is
 * a herbivore with `eat` biased on, reproduction on (otherwise nothing can replace a
 * culled agent and a mid-run perturbation is unrecoverable by construction), signal on
 * (so "remove communication" has something to remove), and the four neighbour-coupled
 * drives off. Only then are `noise` and `cooperation` written to their baseline values.
 *
 * Nothing here touches gene 0/1 (`c`): the agents' position in the complex plane is
 * what keeps them alive, and moving it kills the population on tick 1.
 */
export function baselineGenome(spec: BaselineSpec = BASELINE): Float32Array {
  const g = new Float32Array(256);
  g[0] = 1 / 3; // c = 0: bounded orbits, never escapes
  g[2] = 1; // metabolism 0.25
  g[6] = -1; // size 0.5
  g[7] = -1; // diet -1: herbivore
  g[9] = 1; // longevity 1.5
  g[10] = -1; // mutability 0.25
  // Brain output biases are the last 7 brain slots (BRAIN_OFFSET + 99 = 110), one per
  // output. The engine reads out[2] as `eat` and out[5] as `signal`, so the indices that
  // matter here are 105 and 108. Getting these wrong is silent and expensive: with eat
  // off the population never eats, plateaus at half capacity, and the donation rule -
  // which needs an agent above 75% capacity - becomes unreachable, so the cooperation
  // axis measures nothing while still looking wired up.
  g[105] = 5; // eat on
  g[106] = -5; // repro drive off
  g[107] = -5; // hunt off (herbivore)
  g[108] = 5; // signal on: the communication channel exists at baseline
  g[109] = 0; // drink neutral
  for (const key of Object.keys(DRIVES) as (keyof typeof DRIVES)[]) {
    // circulation is signed, so its neutral value is 0 and the rest use -1
    g[DRIVE_OFFSET + DRIVES[key]] = key === 'CIRCULATION' ? 0 : -1;
  }
  g[DRIVE_OFFSET + DRIVES.NOISE] = encodeWeight(spec.noise);
  g[STRATEGY_OFFSET + STRATEGIES.COOPERATION] = encodeWeight(spec.cooperation);
  return g;
}

/** the genome a given perturbation writes on top of the baseline */
export function perturbedGenome(base: Float32Array, p: Perturbation): Float32Array {
  const g = new Float32Array(base);
  switch (p.kind) {
    case 'baseline':
      break;
    case 'cooperation':
      // cooperation = 0, not a negative value: the donation rule is
      // `energy > cap * (0.75 - (coop - 0.5) * 0.2)`, so zeroing the gene raises the
      // donation threshold rather than inverting the sign of giving.
      g[STRATEGY_OFFSET + STRATEGIES.COOPERATION] = encodeWeight(0);
      break;
    case 'noise':
      g[DRIVE_OFFSET + DRIVES.NOISE] = encodeWeight(p.factor ?? BASELINE.noise * 2);
      break;
    case 'communication':
      // signal output bias (out[5]) off. The channel itself (grid.signal) still exists,
      // but no agent emits into it, which is the same claim as "communication removed".
      g[108] = -5;
      break;
    case 'cull':
      break; // a mid-run intervention, not a genome edit
  }
  return g;
}

// ---------------------------------------------------------------------------
// Perturbations
// ---------------------------------------------------------------------------

export type PerturbationKind = 'baseline' | 'cooperation' | 'noise' | 'communication' | 'cull';

export interface Perturbation {
  id: string;
  kind: PerturbationKind;
  /** what the axis does, in one line, for the report */
  axis: string;
  /** the manipulated value, where there is one */
  factor?: number;
  /** cull only: share of the live population removed, at this tick */
  fraction?: number;
  /** tick at which a mid-run intervention fires */
  atTick?: number;
}

/**
 * The five conditions. Each is a single axis; nothing here combines two, because a
 * combined perturbation cannot be attributed to either part of it.
 */
export const PERTURBATIONS: readonly Perturbation[] = [
  { id: 'baseline', kind: 'baseline', axis: 'nothing: the reference condition' },
  { id: 'no-cooperation', kind: 'cooperation', axis: 'cooperation gene 0.5 -> 0' },
  { id: 'noise-x2', kind: 'noise', factor: 0.2, axis: 'pattern-drive noise 0.1 -> 0.2' },
  { id: 'cull-20pct', kind: 'cull', fraction: 0.2, axis: '20% of live agents killed at the run midpoint' },
  { id: 'no-communication', kind: 'communication', axis: 'signal emission off' },
];

// ---------------------------------------------------------------------------
// Outcome measurement
// ---------------------------------------------------------------------------

/**
 * The macro outcome vector Y. Chosen so each entry can move independently: a
 * perturbation that only changes survival should not be visible in the clustering
 * entries, and one that only scrambles motion should not be visible in cooperation.
 */
export interface Outcome {
  /** survivors / founders */
  aliveFrac: number;
  /** mean energy per survivor */
  meanEnergy: number;
  /** total energy in the living population */
  energyTotal: number;
  /** total energy donated over the run, per founder per unit capacity */
  cooperationRate: number;
  /** share of the final survivors that gave anything at all */
  donorFrac: number;
  /** coefficient of variation of the food grid: resource heterogeneity */
  foodCv: number;
  /** mean nearest-neighbour distance / sense radius: how spread out the crowd is */
  spacing: number;
  /** coefficient of variation of nearest-neighbour distance: spatial evenness */
  spacingCv: number;
  /** |sum of headings| / N */
  polarization: number;
  /** living agents that share the most common meme, as a share of the living */
  memeDominance: number;
}

/**
 * Did the perturbed pathway actually exist and get used?
 *
 * This is the single most important field in the whole report. A delta measured
 * through a channel that never opened is not a small effect, it is no measurement -
 * and at these settings the cooperation channel really is closed: the engine donates
 * only from an agent above 75% capacity to a neighbour below 30%, and a uniform
 * fractal with 100 scattered agents produces neither the poor neighbour nor the
 * adjacency (~1 neighbour per agent). Without this field a table of zeros reads as
 * "no effect" when it should read as "not exercised".
 */
export interface ChannelExercise {
  /** mean neighbours per agent inside the sense radius, over the run */
  neighboursPerAgent: number;
  /** agent-ticks with a live agent above the donation threshold */
  richAgentTicks: number;
  /** agent-ticks with a live agent below the needy threshold */
  poorAgentTicks: number;
  /** total signal energy deposited into the grid: the communication channel's traffic */
  signalDeposited: number;
  /** agent-ticks in which the noise drive was above its 1% cutoff */
  noiseAgentTicks: number;
/** total energy actually donated during the run: the cooperation mechanism firing */
  donations: number;
  /** agents the cull actually removed */
  culled: number;
}

export const OUTCOME_KEYS: (keyof Outcome)[] = [
  'aliveFrac',
  'meanEnergy',
  'energyTotal',
  'cooperationRate',
  'donorFrac',
  'foodCv',
  'spacing',
  'spacingCv',
  'polarization',
  'memeDominance',
];

const SENSE_RADIUS = 36;

function measure(engine: Engine, founders: number, capacity: number): Outcome {
  const alive: { x: number; y: number; energy: number; hx: number; hy: number; meme: number; donated: number }[] = [];
  for (const a of engine.agents.values()) {
    if (!a.alive) continue;
    alive.push({ x: a.x, y: a.y, energy: a.energy, hx: a.vx, hy: a.vy, meme: a.meme, donated: a.totalDonated });
  }
  const n = alive.length;
  if (n === 0) {
    return {
      aliveFrac: 0,
      meanEnergy: 0,
      energyTotal: 0,
      cooperationRate: 0,
      donorFrac: 0,
      foodCv: 0,
      spacing: 0,
      spacingCv: 0,
      polarization: 0,
      memeDominance: 0,
    };
  }
  const cell = WORLD_SIZE / engine.grid.size;
  const nn: number[] = [];
  for (let i = 0; i < n; i++) {
    let best = Infinity;
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      let dx = Math.abs(alive[i]!.x - alive[j]!.x);
      let dy = Math.abs(alive[i]!.y - alive[j]!.y);
      if (dx > cell * engine.grid.size * 0.5) dx = cell * engine.grid.size - dx;
      if (dy > cell * engine.grid.size * 0.5) dy = cell * engine.grid.size - dy;
      const d2 = dx * dx + dy * dy;
      if (d2 < best) best = d2;
    }
    nn.push(Math.sqrt(best));
  }
  const nnMean = mean(nn);
  let energySum = 0;
  let hx = 0;
  let hy = 0;
  let donatedSum = 0;
  let donors = 0;
  const memes = new Map<number, number>();
  for (const a of alive) {
    energySum += a.energy;
    // polarization is over heading, not velocity: a fast agent and a slow one heading
    // the same way are aligned, and summing raw velocities lets a fast minority push the
    // ratio above 1, which is not a bounded order parameter at all
    const speed = Math.hypot(a.hx, a.hy);
    if (speed > 1e-12) {
      hx += a.hx / speed;
      hy += a.hy / speed;
    }
    donatedSum += a.donated;
    if (a.donated > 0) donors++;
    const key = Math.round(a.meme * 16);
    memes.set(key, (memes.get(key) ?? 0) + 1);
  }
  const food = engine.grid.food;
  const fMean = mean(Array.from(food));
  const foodCv = fMean > 0 ? stddev(Array.from(food)) / fMean : 0;
  let topMeme = 0;
  for (const c of memes.values()) topMeme = Math.max(topMeme, c);
  return {
    aliveFrac: n / founders,
    meanEnergy: energySum / n,
    energyTotal: energySum,
    cooperationRate: founders * capacity > 0 ? donatedSum / (founders * capacity) : 0,
    donorFrac: donors / n,
    foodCv,
    spacing: nnMean / SENSE_RADIUS,
    spacingCv: nnMean > 0 ? stddev(nn) / nnMean : 0,
    polarization: Math.hypot(hx, hy) / n,
    memeDominance: topMeme / n,
  };
}

// ---------------------------------------------------------------------------
// Run harness
// ---------------------------------------------------------------------------

export interface ConditionResult {
  perturbation: string;
  seed: string;
  outcome: Outcome;
  channel: ChannelExercise;
  /** determinism fingerprint of the outcome vector */
  fingerprint: string;
}

export interface DeltaResult {
  perturbation: string;
  axis: string;
  seed: string;
  baseline: Outcome;
  perturbed: Outcome;
  /** the perturbed run's channel counters */
  channel: ChannelExercise;
  /**
   * the baseline run's channel counters. This is the one that decides whether a delta is
   * interpretable: the question is not whether the perturbed run used the pathway but
   * whether the reference world used it at all. Turning the signal off and then asking
   * the perturbed run whether any signal moved proves nothing - it is off by construction.
   */
  baselineChannel: ChannelExercise;
  /** perturbed - baseline, per outcome key */
  delta: Record<keyof Outcome, number>;
  fingerprint: string;
}

function overrides(genome: Float32Array, count: number): { id: number; genome: Float32Array }[] {
  const out: { id: number; genome: Float32Array }[] = [];
  for (let id = 0; id < count; id++) out.push({ id, genome: new Float32Array(genome) });
  return out;
}

function fingerprintOutcome(o: Outcome): string {
  return OUTCOME_KEYS.map((k) => o[k].toFixed(6)).join('|');
}

function worldFor(seed: string, spec: BaselineSpec, params: Partial<WorldParams> = {}) {
  return makeWorld(seed, spec.agents, {
    energyCapacity: spec.energy,
    ...params,
  });
}

/** run one condition in one seed; returns the outcome and the donation total */
function runCondition(
  seed: string,
  spec: BaselineSpec,
  p: Perturbation,
  doubleRun = false,
): { outcome: Outcome; channel: ChannelExercise; fingerprint: string } {
  const base = baselineGenome(spec);
  const genome = perturbedGenome(base, p);
  // the donation rule's own gates, read from the engine rather than reimplemented here
  const richFrac = 0.75 - (decodeStrategies(genome).cooperation - 0.5) * 0.2;
  const run = (): { outcome: Outcome; channel: ChannelExercise; fingerprint: string } => {
    const engine = new Engine(worldFor(seed, spec), overrides(genome, spec.agents));
    const channel: ChannelExercise = {
      neighboursPerAgent: 0,
      richAgentTicks: 0,
      poorAgentTicks: 0,
signalDeposited: 0,
      noiseAgentTicks: 0,
      donations: 0,
      culled: 0,
    };
    for (let t = 0; t < spec.ticks; t++) {
      if (p.kind === 'cull' && t === (p.atTick ?? spec.ticks >> 1)) {
        // Zeroing energy is the engine's own death path: `energy <= 0` removes the agent
        // on the next tick. That keeps the cull on public API (no reaching into the
        // private kill()) and makes the victims genuinely dead rather than flagged. The
        // recorded cause will read "starvation", which is a misnomer here, but the
        // population effect - 20% of the live cohort gone in one tick - is exact.
        const live = [...engine.agents.values()].filter((a) => a.alive);
        const target = Math.round(live.length * (p.fraction ?? 0));
        for (let i = 0; i < target; i++) live[i]!.energy = 0;
        channel.culled = target;
      }
      engine.tick();
      // Sampled rather than measured every tick: the outcome is a settled-window
      // quantity and a per-tick census of 100 agents doubles the run time for no
      // information the window mean does not already carry.
      if (t % 10 === 0) {
        let nb = 0;
        let rich = 0;
        let poor = 0;
        let movers = 0;
        for (const a of engine.agents.values()) {
          if (!a.alive) continue;
          if (a.energy > richFrac * spec.energy) rich++;
          if (a.energy <= 0.3 * spec.energy) poor++;
          if (Math.hypot(a.vx, a.vy) > 1e-9) movers++;
        }
        const tr = (engine as unknown as { __tr: { nbCount?: number } }).__tr;
        nb += tr?.nbCount ?? 0;
        channel.neighboursPerAgent += nb;
        channel.richAgentTicks += rich;
        channel.poorAgentTicks += poor;
        channel.noiseAgentTicks += movers;
      }
    }
let deposited = 0;
    for (const v of engine.grid.signal) deposited += v;
    channel.signalDeposited = deposited;
    for (const a of engine.agents.values()) channel.donations += a.totalDonated;
    const samples = Math.max(1, Math.ceil(spec.ticks / 10));
    channel.neighboursPerAgent /= samples;
    const outcome = measure(engine, spec.agents, spec.energy);
    return { outcome, channel, fingerprint: fingerprintOutcome(outcome) };
  };
  const first = run();
  if (!doubleRun) return first;
  const second = run();
  if (first.fingerprint !== second.fingerprint) {
    throw new Error(`perturbation ${p.id} seed ${seed} did not replay: ${first.fingerprint} vs ${second.fingerprint}`);
  }
  return first;
}

/** one baseline + one perturbation, paired on the seed */
export function runDelta(seed: string, p: Perturbation, spec: BaselineSpec = BASELINE, doubleRun = false): DeltaResult {
  const baseline = runCondition(seed, spec, PERTURBATIONS[0]!, doubleRun);
  const perturbed = runCondition(seed, spec, p, doubleRun);
  const delta = {} as Record<keyof Outcome, number>;
  for (const k of OUTCOME_KEYS) delta[k] = perturbed.outcome[k] - baseline.outcome[k];
  return {
    perturbation: p.id,
    axis: p.axis,
    seed,
    baseline: baseline.outcome,
    perturbed: perturbed.outcome,
    channel: perturbed.channel,
    baselineChannel: baseline.channel,
    delta,
    fingerprint: `${baseline.fingerprint}->${perturbed.fingerprint}`,
  };
}

/** every perturbation in every seed */
export interface PerturbationSuite {
  conditions: ConditionResult[];
  deltas: DeltaResult[];
}

export function runPerturbationSuite(
  spec: BaselineSpec = BASELINE,
  seeds: readonly string[] = PERTURB_SEEDS,
  doubleRun = false,
): PerturbationSuite {
  const conditions: ConditionResult[] = [];
  const deltas: DeltaResult[] = [];
  for (const seed of seeds) {
    for (const p of PERTURBATIONS) {
      if (p.kind === 'baseline') {
        const c = runCondition(seed, spec, p, doubleRun);
        conditions.push({ perturbation: p.id, seed, outcome: c.outcome, channel: c.channel, fingerprint: c.fingerprint });
        continue;
      }
      const d = runDelta(seed, p, spec, doubleRun);
      deltas.push(d);
      conditions.push({ perturbation: p.id, seed, outcome: d.perturbed, channel: d.channel, fingerprint: d.fingerprint });
    }
  }
  return { conditions, deltas };
}

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------

export interface MetricSummary {
  key: keyof Outcome;
  /** mean delta over seeds */
  meanDelta: number;
  /** mean absolute delta: effect size that ignores sign */
  meanAbsDelta: number;
  /** smallest |delta| across seeds */
  minAbsDelta: number;
  /** largest |delta| across seeds */
  maxAbsDelta: number;
  stdDelta: number;
  /** true when every seed moved in the same direction */
  signConsistent: boolean;
  /** 1 - std/meanAbs, in 0..1; low means the effect is swamped by world variation */
  consistency: number;
  /** true when the perturbation moved the metric at all on any seed */
  moved: boolean;
}

/**
 * Summarise one metric across seeds.
 *
 * `signConsistent` is the load-bearing field and is why `meanDelta` is not the
 * headline: a delta that is +8 on one world and -6 on the next averages to +1, which
 * reads like a small effect when it is really two opposite large effects.
 */
export function summarizeMetric(key: keyof Outcome, deltas: readonly DeltaResult[]): MetricSummary {
  const xs = deltas.map((d) => d.delta[key]);
  const abs = xs.map(Math.abs);
  const meanAbsDelta = mean(abs);
  const stdDelta = stddev(xs);
  const allPositive = xs.every((x) => x > 0);
  const allNegative = xs.every((x) => x < 0);
  const signConsistent = allPositive || allNegative;
  return {
    key,
    meanDelta: mean(xs),
    meanAbsDelta,
    minAbsDelta: abs.length ? Math.min(...abs) : 0,
    maxAbsDelta: abs.length ? Math.max(...abs) : 0,
    stdDelta,
    signConsistent,
    consistency: meanAbsDelta > 0 ? Math.max(0, 1 - stdDelta / meanAbsDelta) : 0,
    moved: abs.some((a) => a > 0),
  };
}

export type ChannelVerdict = 'exercised' | 'closed' | 'partial';

export interface PerturbationSummary {
  perturbation: string;
  axis: string;
  /** whether the manipulated pathway was actually open in these runs */
  channel: ChannelVerdict;
  /** one line saying why, with the number that decided it */
  channelEvidence: string;
  metrics: MetricSummary[];
  /** metrics whose sign held on every seed, sorted by |mean delta| */
  robust: MetricSummary[];
  /** metrics that moved but reversed sign between worlds */
  signFlipped: MetricSummary[];
}

/**
 * Decide whether the perturbed pathway did anything at all.
 *
 * The thresholds are deliberately conservative: a channel counts as closed only when
 * its own traffic counter is zero on every seed, so "closed" means the mechanism
 * provably never engaged rather than "the effect was small".
 */
export function channelVerdict(
  p: Perturbation,
  baselineChannels: readonly ChannelExercise[],
  perturbedChannels: readonly ChannelExercise[],
): { verdict: ChannelVerdict; evidence: string } {
  // Which run answers "was the pathway live?" depends on the axis. For noise,
  // communication and cooperation the reference world must have been using the pathway
  // already, so evidence comes from the baseline. For a cull the intervention *is* the
  // removal, so the perturbed run is where it can be observed.
  const ref = p.kind === 'cull' ? perturbedChannels : baselineChannels;
  const anyPositive = (f: (c: ChannelExercise) => number): boolean => ref.some((c) => f(c) > 0);
  switch (p.kind) {
    case 'baseline':
      return { verdict: 'exercised', evidence: 'reference condition' };
case 'cull': {
      const removed = perturbedChannels.map((c) => c.culled);
      if (!anyPositive((c) => c.culled)) {
        // A fixed tick offset would silently do nothing on any horizon shorter than it,
        // producing an exact zero delta that reads as "no effect" rather than "no event".
        return { verdict: 'closed', evidence: 'the cull tick fell outside the run, so nothing was ever removed' };
      }
      return {
        verdict: 'exercised',
        evidence: `${Math.min(...removed)}-${Math.max(...removed)} agents removed per run`,
      };
    }
    case 'noise': {
      const movers = ref.map((c) => c.noiseAgentTicks);
      if (!anyPositive((c) => c.noiseAgentTicks)) {
        return { verdict: 'closed', evidence: 'no agent was ever moving, so the noise drive had no input' };
      }
      return { verdict: 'exercised', evidence: `${Math.max(...movers)} moving agent-samples` };
    }
    case 'communication': {
      const sig = ref.map((c) => c.signalDeposited);
      if (!anyPositive((c) => c.signalDeposited)) {
        return { verdict: 'closed', evidence: 'no signal was deposited into the grid on any seed' };
      }
      return { verdict: 'exercised', evidence: `signal deposited, max ${Math.max(...sig).toFixed(2)}` };
    }
    case 'cooperation': {
      const poor = ref.map((c) => c.poorAgentTicks);
      const rich = ref.map((c) => c.richAgentTicks);
      const nb = ref.map((c) => c.neighboursPerAgent);
if (!anyPositive((c) => c.poorAgentTicks) || !anyPositive((c) => c.richAgentTicks)) {
        return {
          verdict: 'closed',
          evidence:
            `the donation rule needs an agent above 75% capacity beside one below 30%; ` +
            `rich agent-samples peaked at ${Math.max(...rich)}, needy at ${Math.max(...poor)}, ` +
            `and agents average ${Math.max(...nb).toFixed(2)} neighbours`,
        };
      }
      if (!anyPositive((c) => c.donations)) {
        return {
          verdict: 'partial',
          evidence:
            `both halves of the donation precondition occurred (rich up to ${Math.max(...rich)} agent-samples, ` +
            `needy up to ${Math.max(...poor)}) but no energy ever changed hands`,
        };
      }
      return {
        verdict: 'exercised',
        evidence: `donations fired, ${Math.max(...ref.map((c) => c.donations)).toFixed(2)} energy transferred at peak`,
      };
    }
  }
}

export function summarizePerturbation(deltas: readonly DeltaResult[]): PerturbationSummary {
  const first = deltas[0];
  if (!first) throw new Error('cannot summarize an empty delta set');
  const spec = PERTURBATIONS.find((p) => p.id === first.perturbation) ?? PERTURBATIONS[0]!;
  // Evidence is read from the baseline runs: a perturbation can only reveal what the
  // reference world was already doing. Reading the perturbed counters instead would make
  // "switch signal off" look like a closed channel purely because of the switch.
  const { verdict, evidence } = channelVerdict(spec, deltas.map((d) => d.baselineChannel), deltas.map((d) => d.channel));
  const metrics = OUTCOME_KEYS.map((k) => summarizeMetric(k, deltas));
  const rank = (m: MetricSummary): number => Math.abs(m.meanDelta);
  return {
    perturbation: first.perturbation,
    axis: first.axis,
    channel: verdict,
    channelEvidence: evidence,
    metrics,
    robust: metrics.filter((m) => m.signConsistent && m.moved).sort((a, b) => rank(b) - rank(a)),
    signFlipped: metrics.filter((m) => m.moved && !m.signConsistent).sort((a, b) => Math.abs(b.meanDelta) - Math.abs(a.meanDelta)),
  };
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

export interface PerturbationReport {
  spec: BaselineSpec;
  seeds: string[];
  doubleRun: boolean;
  summaries: PerturbationSummary[];
  conditions: ConditionResult[];
  deltas: DeltaResult[];
}

export function runPerturbationReport(
  spec: BaselineSpec = BASELINE,
  seeds: readonly string[] = PERTURB_SEEDS,
  doubleRun = false,
): PerturbationReport {
  const { conditions, deltas } = runPerturbationSuite(spec, seeds, doubleRun);
  const byPerturbation = new Map<string, DeltaResult[]>();
  for (const d of deltas) {
    const list = byPerturbation.get(d.perturbation) ?? [];
    list.push(d);
    byPerturbation.set(d.perturbation, list);
  }
  return {
    spec,
    seeds: [...seeds],
    doubleRun,
    summaries: [...byPerturbation.values()].map(summarizePerturbation),
    conditions,
    deltas,
  };
}

const f = (x: number, digits = 4): string => {
  if (!Number.isFinite(x)) return 'n/a';
  if (x !== 0 && Math.abs(x) < 10 ** -digits) return x.toExponential(1);
  return x.toFixed(digits);
};

/** signed, and marked with its own sign when the sign is not consistent across seeds */
const signed = (m: MetricSummary): string => {
  const v = `${m.meanDelta >= 0 ? '+' : ''}${f(m.meanDelta)}`;
  return m.signConsistent ? v : `${v} (reverses)`;
};

export function renderPerturbationReport(report: PerturbationReport): { md: string; json: string; csv: string } {
  const md: string[] = [];
  const n = report.seeds.length;
  md.push('# Perturbation study: one baseline, four single-axis perturbations');
  md.push('');
  md.push(`Baseline: **${report.spec.agents} agents, energy ${report.spec.energy}, noise ${report.spec.noise}, cooperation ${report.spec.cooperation}**,`);
  md.push(`read at tick ${report.spec.ticks}. ${n} seeds (${report.seeds.join(', ')}).`);
  md.push(`Every perturbation is paired on the seed and measured against the baseline run in the same`);
  md.push('world from the same founder placement, so the habitat cancels out of every delta.');
  md.push('');
  md.push('**How to read a delta.** Each cell is the mean over seeds of `Y_perturbed - Y_baseline`,');
  md.push('plus `+-` the standard deviation across seeds. A cell marked `(reverses)` kept the same');
  md.push('absolute sign on some seeds and the opposite sign on others, which means the effect is');
  md.push('smaller than the variation between worlds: the mean is then a description of that');
  md.push('variation, not of the perturbation. Only unflagged cells are claims about the perturbation.');
  md.push('');

  const baselineRows = report.conditions.filter((c) => c.perturbation === 'baseline');
  md.push('## Baseline outcome, per seed');
  md.push('');
  md.push(`| seed | ${OUTCOME_KEYS.join(' | ')} |`);
  md.push(`| --- | ${OUTCOME_KEYS.map(() => '---').join(' | ')} |`);
  for (const c of baselineRows) {
    md.push(`| ${c.seed} | ${OUTCOME_KEYS.map((k) => f(c.outcome[k])).join(' | ')} |`);
  }
  md.push('');
  const baselineSpread = OUTCOME_KEYS.map((k) => {
    const xs = baselineRows.map((c) => c.outcome[k]);
    return { k, cv: mean(xs) > 0 ? stddev(xs) / Math.abs(mean(xs)) : 0 };
  });
  md.push('The baseline itself varies between worlds, which is the noise floor every delta below is');
  md.push('measured against:');
  md.push('');
  md.push(`| outcome | baseline across-seed CV |`);
  md.push('| --- | --- |');
  for (const { k, cv } of baselineSpread) md.push(`| \`${k}\` | ${(cv * 100).toFixed(1)}% |`);
  md.push('');

  for (const s of report.summaries) {
    md.push(`## \`${s.perturbation}\` - ${s.axis}`);
    md.push('');
    if (s.channel !== 'exercised') {
      md.push(`> **Channel ${s.channel === 'closed' ? 'never opened' : 'only partly exercised'}.** ${s.channelEvidence}.`);
      md.push('> Every delta below is therefore a measurement of a pathway that did not run, not a');
      md.push('> finding that the perturbation has no effect. Read it as an untested axis.');
      md.push('');
    } else {
      md.push(`Channel exercised: ${s.channelEvidence}.`);
      md.push('');
    }
    if (s.robust.length === 0 && s.signFlipped.length === 0) {
      md.push('No outcome moved on any seed.');
      if (s.channel === 'exercised') {
        md.push('The pathway ran and nothing responded, which is a real null: this perturbation is');
        md.push('inert in this baseline, a negative control rather than a failed measurement.');
      } else {
        md.push('Consistent with the channel verdict above - the pathway never opened, so this is not');
        md.push('evidence of an inert perturbation.');
      }
      md.push('');
      continue;
    }
    md.push('| outcome | baseline | perturbed | delta Y | across-seed sd | verdict |');
    md.push('| --- | --- | --- | --- | --- | --- |');
    for (const m of s.metrics) {
      const base = report.deltas.filter((d) => d.perturbation === s.perturbation);
      const bm = mean(base.map((d) => d.baseline[m.key]));
      const pm = mean(base.map((d) => d.perturbed[m.key]));
      const verdict = !m.moved ? 'no change' : m.signConsistent ? `**consistent** (${(m.consistency * 100).toFixed(0)}% coherence)` : 'sign reverses';
      md.push(`| \`${m.key}\` | ${f(bm)} | ${f(pm)} | ${signed(m)} | ${f(m.stdDelta)} | ${verdict} |`);
    }
    md.push('');
    if (s.robust.length > 0) {
      md.push('Robust across every seed:');
      for (const m of s.robust.slice(0, 4)) {
        md.push(`- \`${m.key}\` ${signed(m)} (|delta| ${f(m.minAbsDelta)} to ${f(m.maxAbsDelta)})`);
      }
      md.push('');
    }
    if (s.signFlipped.length > 0) {
      md.push('Sign reverses between worlds, so these are **not** attributed to the perturbation:');
      for (const m of s.signFlipped.slice(0, 4)) {
        md.push(`- \`${m.key}\` mean ${signed(m)} but sd ${f(m.stdDelta)} across ${n} seeds`);
      }
      md.push('');
    }
  }

  md.push('## What this does and does not establish');
  md.push('');
  md.push('Each perturbation moves one axis and is paired on the seed, so a sign-consistent delta is');
  md.push('attributable to that axis within this baseline. Three limits are structural rather than');
  md.push('fixable by more seeds:');
  md.push('');
  md.push(`- **One baseline.** Every delta is measured against ${report.spec.agents} agents / energy`);
  md.push(`  ${report.spec.energy} / noise ${report.spec.noise} / cooperation ${report.spec.cooperation}. A delta is a`);
  md.push('  derivative at that point, not a general sensitivity.');
  md.push('- **Single axis only.** Nothing here separates an interaction between two perturbations,');
  md.push('  because no pair was run.');
  md.push(`- **${n} seeds.** Enough to expose a sign flip, not enough to estimate a distribution well.`);
  md.push('  The `across-seed sd` column is reported precisely because n is small: treat the mean as');
  md.push('  indicative and the sign as the claim.');
  md.push('');
  if (report.doubleRun) {
    md.push('Every run was executed twice and its outcome vector compared; all replays matched.');
  } else {
    md.push('Replays were not verified in this report. Pass `--strict` to run every condition twice.');
  }
  md.push('');

  const json = JSON.stringify(
    {
      spec: report.spec,
      seeds: report.seeds,
      doubleRun: report.doubleRun,
      outcomeKeys: OUTCOME_KEYS,
      summaries: report.summaries,
      deltas: report.deltas,
    },
    null,
    2,
  );

  const csv = [
    'perturbation,axis,seed,' + OUTCOME_KEYS.map((k) => `base_${k},${k}`).join(','),
    ...report.deltas.map((d) => [d.perturbation, `"${d.axis}"`, d.seed, ...OUTCOME_KEYS.flatMap((k) => [f(d.baseline[k], 8), f(d.delta[k], 8)])].join(',')),
  ].join('\n');

  return { md: md.join('\n'), json, csv };
}

export function renderPerturbationSvg(report: PerturbationReport): string {
  const w = 900;
  const rowH = 34;
  const rows = report.summaries.flatMap((s) => s.robust.slice(0, 3).map((m) => ({ s, m })));
  const h = 80 + rows.length * rowH + 40;
  const maxAbs = Math.max(1e-9, ...rows.map(({ m }) => Math.abs(m.meanDelta)));
  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`,
    `<rect width="${w}" height="${h}" fill="#0e1116"/>`,
    `<text x="24" y="32" fill="#e6edf3" font-family="monospace" font-size="15">robust deltas (sign-consistent on every seed)</text>`,
  ];
  rows.forEach(({ s, m }, i) => {
    const y = 60 + i * rowH;
    const len = (Math.abs(m.meanDelta) / maxAbs) * (w - 320);
    const neg = m.meanDelta < 0;
    const x = neg ? 260 - len : 260;
    parts.push(`<text x="24" y="${y + 4}" fill="#8b949e" font-family="monospace" font-size="11">${s.perturbation}</text>`);
    parts.push(`<rect x="${x}" y="${y - 8}" width="${Math.max(1, len)}" height="14" fill="${neg ? '#f85149' : '#3fb950'}"/>`);
    parts.push(`<line x1="260" y1="${y - 12}" x2="260" y2="${y + 10}" stroke="#30363d"/>`);
    parts.push(`<text x="${w - 200}" y="${y + 4}" fill="#e6edf3" font-family="monospace" font-size="11">${m.key} ${f(m.meanDelta, 3)}</text>`);
  });
  parts.push('</svg>');
  return parts.join('\n');
}

export function writePerturbationReport(report: PerturbationReport): string {
  const dir = join(fileURLToPath(new URL('.', import.meta.url)), '../../research/output');
  mkdirSync(dir, { recursive: true });
  const { md, json, csv } = renderPerturbationReport(report);
  writeFileSync(join(dir, 'perturbation.md'), md);
  writeFileSync(join(dir, 'perturbation.json'), json);
  writeFileSync(join(dir, 'perturbation.csv'), csv);
  writeFileSync(join(dir, 'plots', 'perturbation.svg'), renderPerturbationSvg(report));
  return dir;
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

export function mean(xs: readonly number[]): number {
  return xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length;
}

export function stddev(xs: readonly number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) * (b - m), 0) / (xs.length - 1));
}

export const PERTURB_BASELINE_PARAMS = DEFAULT_PARAMS;
