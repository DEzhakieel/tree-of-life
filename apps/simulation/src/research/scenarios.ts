import {
  DEFAULT_PARAMS,
  GENOME_SIZE,
  DRIVE_OFFSET,
  DRIVES,
  TERRAIN_CELL,
  fnv1a32,
  type WorldConfig,
  type EnvironmentPreset,
  type WorldTopology,
} from '@fractal-life/shared';
import { createHash } from 'node:crypto';
import { Engine } from '../engine.js';
import type { BrainConfig } from '../brain.js';

/**
 * Research-grade scenario definitions, used by BOTH the emergence test suite and
 * the reproducibility harness (`src/research/cli.ts`). Keeping them in one place
 * means the claims under statistical test are exactly the code under test.
 *
 * Every scenario is deterministic: no Math.random, no iteration-order hazards,
 * agents iterate in ascending id order and all stochastic draws come from the
 * seed stream. Agents are placed exactly on grid corners so bilinear sampling
 * degenerates to the cell itself.
 */

export const FIRST_ORDER_TICKS = 60;
export const SECOND_ORDER_WINDOW = 2000;
export const THIRD_ORDER_TICKS = 60;
export const PREY_ENERGY = 30;
export const AGENT_START_ENERGY = 15;
/** stochastic-scenario run length and founder cohort */
export const STOCH_TICKS = 180;
export const STOCH_SPAWN = 10;

/**
 * Each seed samples a DIFFERENT region of the fractal: the seed string hashes
 * to a deterministic offset of the sampled complex-plane window. A fixed map
 * would make every "replicate" identical (mandelbrot terrain ignores the seed),
 * which would collapse the bootstrap/permutation statistics to n = 1.
 */
const HABITAT_JITTER = 0.6; // max offset, as a fraction of worldScale

export function makeWorld(
  seed: string,
  spawnCount: number,
  overrides: Partial<typeof DEFAULT_PARAMS> = {},
  environment?: EnvironmentPreset,
  topology?: WorldTopology,
): WorldConfig {
  const h = fnv1a32(seed);
  const u1 = (h >>> 0) / 4294967296;
  const h2 = Math.imul(h, 1103515245) + 12345;
  const u2 = (h2 >>> 0) / 4294967296;
  const jx = (u1 - 0.5) * 2 * HABITAT_JITTER * DEFAULT_PARAMS.worldScale;
  const jy = (u2 - 0.5) * 2 * HABITAT_JITTER * DEFAULT_PARAMS.worldScale;
  return {
    id: `emergence-${seed}`,
    seed,
    fractalType: 'mandelbrot',
    params: {
      ...DEFAULT_PARAMS,
      spawnCount,
      centerX: DEFAULT_PARAMS.centerX + jx,
      centerY: DEFAULT_PARAMS.centerY + jy,
      ...overrides,
    },
    createdAt: 0,
    currentTick: 0,
    environment,
    topology,
  };
}

/**
 * Calm, bounded genome (c = 0, never escapes) with the brain off and only the
 * `eat`/`hunt`/`repro` bias genes set. Zero brain output and zero drives mean
 * thrust = 0: an agent stays exactly where it is placed, so food availability
 * is controlled purely by which grid cell it sits on.
 */
export function feedGenome(opts: { diet: number; repro?: number }): Float32Array {
  const g = new Float32Array(GENOME_SIZE);
  g[0] = 1 / 3; // c = 0: bounded, survives
  g[2] = 1; // metabolism 0.25 (accelerates the energy ledger so a few ticks are decisive)
  g[6] = -1; // size 0.5
  g[7] = opts.diet; // -1 herbivore, +1 carnivore
  g[9] = 1; // longevity 1.5
  g[10] = -1; // mutability 0.25
  g[105] = 5; // eat on
  g[106] = opts.repro ?? -5; // repro off by default
  g[107] = opts.diet > 0 ? 5 : -5; // hunt on for carnivores
  g[108] = -5; // signal off
  for (const key of Object.keys(DRIVES) as (keyof typeof DRIVES)[]) {
    // drives decode as 0..1 weights (circulation is signed, so neutral = 0);
    // every drive set to neutral keeps thrust purely from the (zeroed) brain
    g[DRIVE_OFFSET + DRIVES[key]] = key === 'CIRCULATION' ? 0 : -1;
  }
  return g;
}

export function cellCorner(gx: number, gy: number): { x: number; y: number } {
  return { x: gx * TERRAIN_CELL, y: gy * TERRAIN_CELL };
}

export function cellGxGy(idx: number, size: number): { gx: number; gy: number } {
  return { gx: idx % size, gy: Math.floor(idx / size) };
}

/** Index of the cell with the maximum cap among those with moisture >= minMoisture. */
export function richestWetCell(engine: Engine, minMoisture: number): number {
  let best = -1;
  let bestCap = -1;
  const { cap, moisture } = engine.grid;
  for (let i = 0; i < cap.length; i++) {
    if (moisture[i]! >= minMoisture && cap[i]! > bestCap) {
      bestCap = cap[i]!;
      best = i;
    }
  }
  if (best < 0) throw new Error(`expected a wet cell with cap > 0 (moisture >= ${minMoisture})`);
  return best;
}

/** Index of the cell with the minimum cap among those with moisture >= minMoisture. */
export function poorestWetCell(engine: Engine, minMoisture: number): number {
  let best = -1;
  let bestCap = Number.POSITIVE_INFINITY;
  const { cap, moisture } = engine.grid;
  for (let i = 0; i < cap.length; i++) {
    if (moisture[i]! >= minMoisture && cap[i]! < bestCap) {
      bestCap = cap[i]!;
      best = i;
    }
  }
  if (best < 0) throw new Error(`expected a wet cell (moisture >= ${minMoisture})`);
  return best;
}

/** Position the first `positions.length / 2` agents at the given x/y pairs and still them. */
export function placeAgentsAt(engine: Engine, positions: number[]): void {
  const cap = engine.params.energyCapacity;
  let i = 0;
  for (const a of engine.agents.values()) {
    if (i >= positions.length) break;
    a.x = positions[i]!;
    a.y = positions[i + 1]!;
    a.vx = 0;
    a.vy = 0;
    a.water = cap * 0.5;
    i += 2;
  }
}

export interface FirstOrderResult {
  seed: string;
  aEnergy: number;
  bEnergy: number;
  aAlive: boolean;
  bAlive: boolean;
  /** aEnergy - bEnergy (the resource-loop differential) */
  gap: number;
  richCap: number;
  poorCap: number;
  richFood: number;
  poorFood: number;
  /** whole-world sha256 fingerprint after the final tick */
  fingerprint: string;
}

export function runFirstOrder(seed: string): FirstOrderResult {
  const engine = new Engine(makeWorld(seed, 2), [
    { id: 0, genome: feedGenome({ diet: -1 }) },
    { id: 1, genome: feedGenome({ diet: -1 }) },
  ]);
  const rich = richestWetCell(engine, 0.5);
  const poor = poorestWetCell(engine, 0.5);
  const { gx: rgx, gy: rgy } = cellGxGy(rich, engine.grid.size);
  const { gx: pgx, gy: pgy } = cellGxGy(poor, engine.grid.size);
  const richPos = cellCorner(rgx, rgy);
  const poorPos = cellCorner(pgx, pgy);

  const A = engine.agents.get(0)!;
  const B = engine.agents.get(1)!;
  A.x = richPos.x;
  A.y = richPos.y;
  B.x = poorPos.x;
  B.y = poorPos.y;
  A.energy = B.energy = AGENT_START_ENERGY;
  A.water = B.water = engine.params.energyCapacity * 0.5;
  A.vx = A.vy = B.vx = B.vy = 0;

  for (let t = 0; t < FIRST_ORDER_TICKS; t++) engine.tick();

  return {
    seed,
    aEnergy: A.energy,
    bEnergy: B.energy,
    aAlive: A.alive,
    bAlive: B.alive,
    gap: A.energy - B.energy,
    richCap: engine.grid.cap[rich]!,
    poorCap: engine.grid.cap[poor]!,
    richFood: engine.grid.food[rich]!,
    poorFood: engine.grid.food[poor]!,
    fingerprint: worldFingerprint(engine),
  };
}

export interface SecondOrderResult {
  seed: string;
  window: number;
  kills: number;
  prey1Alive: boolean;
  prey2Alive: boolean;
  predAlive: boolean;
  prey1DiedAt: number;
  prey2DiedAt: number;
  predDiedAt: number;
  /** tick at which the boom/bust completed (kills >= 1, both prey dead, pred dead) */
  completedAt: number;
  /** full boom/bust: predator killed >= 1, both prey dead, predator dead after its prey */
  completed: boolean;
  cellCap: number;
  cellHazard: number;
  /** whole-world sha256 fingerprint after the final tick */
  fingerprint: string;
}

export function runSecondOrder(seed: string, window: number = SECOND_ORDER_WINDOW): SecondOrderResult {
  const engine = new Engine(makeWorld(seed, 3), [
    { id: 0, genome: feedGenome({ diet: -1 }) }, // prey 1
    { id: 1, genome: feedGenome({ diet: -1 }) }, // prey 2
    { id: 2, genome: feedGenome({ diet: 1 }) }, // predator
  ]);
  // A food-barren patch (cap ~0, plants ~0): prey cannot self-heal from bites,
  // so the predator — not the soil — decides the prey's fate.
  const cell = poorestWetCell(engine, 0.5);
  const { gx, gy } = cellGxGy(cell, engine.grid.size);
  const pos = cellCorner(gx, gy);

  const prey1 = engine.agents.get(0)!;
  const prey2 = engine.agents.get(1)!;
  const pred = engine.agents.get(2)!;
  placeAgentsAt(engine, [pos.x, pos.y, pos.x, pos.y, pos.x, pos.y]);
  prey1.energy = prey2.energy = PREY_ENERGY;
  pred.energy = engine.params.energyCapacity * 0.5; // hungry: below the 0.85 hunger line, hunts from the first tick

  let t = 0;
  for (; t < window; t++) {
    engine.tick();
    if (pred.kills >= 1 && !prey1.alive && !prey2.alive && !pred.alive) break;
  }

  const completed =
    pred.kills >= 1 &&
    !prey1.alive &&
    !prey2.alive &&
    !pred.alive &&
    prey1.diedAtTick >= 0 &&
    prey2.diedAtTick >= 0 &&
    pred.diedAtTick >= 0 &&
    prey1.diedAtTick < pred.diedAtTick &&
    prey2.diedAtTick < pred.diedAtTick &&
    pred.diedAtTick <= window;

  return {
    seed,
    window,
    kills: pred.kills,
    prey1Alive: prey1.alive,
    prey2Alive: prey2.alive,
    predAlive: pred.alive,
    prey1DiedAt: prey1.diedAtTick,
    prey2DiedAt: prey2.diedAtTick,
    predDiedAt: pred.diedAtTick,
    completedAt: completed ? t + 1 : -1,
    completed,
    cellCap: engine.grid.cap[cell]!,
    cellHazard: engine.grid.hazard[cell]!,
    fingerprint: worldFingerprint(engine),
  };
}

export interface ThirdOrderResult {
  seed: string;
  /** cellCap of the sampled patch (terrain richness at the richest wet cell) */
  cellCap: number;
  controlGrowth: number;
  carrionGrowth: number;
  /** carrionGrowth - controlGrowth (the decomposition-fed growth surplus) */
  growthDelta: number;
  controlMinerals: number;
  carrionMinerals: number;
  /** carrionMinerals - controlMinerals (the soil enrichment) */
  mineralDelta: number;
  /** whole-world sha256 fingerprint of the carrion world after the final tick */
  fingerprint: string;
}

export function runThirdOrder(seed: string): ThirdOrderResult {
  const mk = () => new Engine(makeWorld(seed, 0));
  const control = mk();
  const withMeat = mk();
  const cell = richestWetCell(control, 0);

  const startFood = control.grid.food[cell]!;
  // zero the soil in both so the only difference is the injected carrion
  control.grid.meat[cell] = 0;
  withMeat.grid.meat[cell] = control.grid.cap[cell]! * 0.5;
  control.grid.minerals[cell] = 0;
  withMeat.grid.minerals[cell] = 0;

  for (let t = 0; t < THIRD_ORDER_TICKS; t++) {
    control.tick();
    withMeat.tick();
  }

  const growthA = control.grid.food[cell]! - startFood;
  const growthB = withMeat.grid.food[cell]! - startFood;
  return {
    seed,
    cellCap: control.grid.cap[cell]!,
    controlGrowth: growthA,
    carrionGrowth: growthB,
    growthDelta: growthB - growthA,
    controlMinerals: control.grid.minerals[cell]!,
    carrionMinerals: withMeat.grid.minerals[cell]!,
    mineralDelta: withMeat.grid.minerals[cell]! - control.grid.minerals[cell]!,
    fingerprint: worldFingerprint(withMeat),
  };
}

export interface StochasticResult {
  seed: string;
  ticks: number;
  controlAlive: number;
  stochAlive: number;
  /** stochAlive - controlAlive (the stochastic-treatment surplus/deficit) */
  deltaAlive: number;
  controlEnergy: number;
  stochEnergy: number;
  deltaEnergy: number;
  controlPlasticity: number;
  stochPlasticity: number;
  deltaPlasticity: number;
  controlSurprise: number;
  stochSurprise: number;
  deltaSurprise: number;
  controlFoodCv: number;
  stochFoodCv: number;
  deltaFoodCv: number;
  /** fraction of policy ticks where the sampled action diverged from the mean */
  stochExploreFrac: number;
  /** fraction of ticks not in the clear weather state (rain/drought/heat) */
  stochWeatherFrac: number;
  controlFingerprint: string;
  stochFingerprint: string;
  /** = stochFingerprint; the reproducibility fingerprint of the treatment run */
  fingerprint: string;
}

/**
 * Paired experiment on the stochastic-process features. Per seed the SAME world
 * runs twice with otherwise-identical backprop brains:
 *   control = deterministic policy, no world stochasticity
 *   stoch   = gaussian annealed policy + entropy bonus, SGD dropout + gradient
 *             noise, and a stochastic world (weather/OU/Poisson bursts).
 * The difference between the two isolates the effect of the added stochasticity
 * on population survival, productivity, learned plasticity and resource
 * heterogeneity, and the treatment run additionally reports how much the noise
 * was actually exercised (exploration + weather non-clear fractions).
 */
export function runStochastic(seed: string, ticks: number = STOCH_TICKS): StochasticResult {
  const runOne = (cfg: BrainConfig, worldStoch: boolean) => {
    const engine = new Engine(makeWorld(seed, STOCH_SPAWN));
    engine.setBrainConfig(cfg);
    if (worldStoch) engine.setWorldStochastics({ poissonRate: 60, ouTheta: 0.01, ouSigma: 0.03, ouBand: 0.3 });
    let policyTicks = 0;
    let explore = 0;
    let nonClear = 0;
    for (let t = 0; t < ticks; t++) {
      engine.tick();
      const tr = (engine as unknown as { __tr: Record<string, unknown> }).__tr;
      if (worldStoch && tr.weatherId !== 0) nonClear++;
      if (cfg.policy?.mode === 'gaussian') {
        policyTicks++;
        const act = tr.act as number[] | undefined;
        const out = tr.out as number[] | undefined;
        if (act && out && (Math.abs(act[0]! - out[0]!) > 1e-9 || Math.abs(act[1]! - out[1]!) > 1e-9)) explore++;
      }
    }
    let energy = 0;
    let alive = 0;
    for (const a of engine.agents.values()) {
      if (!a.alive) continue;
      alive++;
      energy += a.energy;
    }
    const stats = engine.brainStats();
    const food = engine.grid.food;
    const fm = food.reduce((s, v) => s + v, 0) / food.length;
    const fv = Math.sqrt(food.reduce((s, v) => s + (v - fm) * (v - fm), 0) / food.length);
    return {
      alive,
      energy,
      plasticity: stats.meanPlasticity,
      surprise: stats.meanSurprise,
      foodCv: fm > 0 ? fv / fm : 0,
      exploreFrac: policyTicks > 0 ? explore / policyTicks : 0,
      weatherFrac: nonClear / ticks,
      fingerprint: worldFingerprint(engine),
    };
  };

  const control = runOne({ enabled: true, learn: 'backprop' }, false);
  const stoch = runOne(
    {
      enabled: true,
      learn: 'backprop',
      policy: { mode: 'gaussian', sigma: 0.35, sigmaMin: 0.05, annealTicks: ticks },
      dropout: 0.2,
      gradNoise: 0.005,
      entropy: 0.2,
    },
    true,
  );

  return {
    seed,
    ticks,
    controlAlive: control.alive,
    stochAlive: stoch.alive,
    deltaAlive: stoch.alive - control.alive,
    controlEnergy: control.energy,
    stochEnergy: stoch.energy,
    deltaEnergy: stoch.energy - control.energy,
    controlPlasticity: control.plasticity,
    stochPlasticity: stoch.plasticity,
    deltaPlasticity: stoch.plasticity - control.plasticity,
    controlSurprise: control.surprise,
    stochSurprise: stoch.surprise,
    deltaSurprise: stoch.surprise - control.surprise,
    controlFoodCv: control.foodCv,
    stochFoodCv: stoch.foodCv,
    deltaFoodCv: stoch.foodCv - control.foodCv,
    stochExploreFrac: stoch.exploreFrac,
    stochWeatherFrac: stoch.weatherFrac,
    controlFingerprint: control.fingerprint,
    stochFingerprint: stoch.fingerprint,
    fingerprint: stoch.fingerprint,
  };
}

export interface ConservationResult {
  seed: string;
  injected: number;
  meatDecayed: number;
  /** expected decay = injected * MEAT_DECAY * ts */
  expectedDecay: number;
  mineralGained: number;
  /** expected mineral gain = decay * DECOMP_FRACTION */
  expectedMineralGain: number;
  meatError: number;
  mineralError: number;
}

/** Exact conservation check: decayed carrion == mineral gain at DECOMP_FRACTION. */
export function runConservation(seed: string, injected = 50): ConservationResult {
  const mk = () => new Engine(makeWorld(seed, 0));
  const control = mk();
  const withMeat = mk();
  const cell = richestWetCell(control, 0);

  // full plant beds in both: no growth draws on minerals during the tick
  control.grid.food[cell] = control.grid.cap[cell]!;
  withMeat.grid.food[cell] = withMeat.grid.cap[cell]!;
  control.grid.meat[cell] = 0;
  withMeat.grid.meat[cell] = injected;
  control.grid.minerals[cell] = 0;
  withMeat.grid.minerals[cell] = 0;

  control.tick();
  withMeat.tick();

  const decayed = injected * 0.002; // MEAT_DECAY * timeScale(1)
  const mineralDelta = withMeat.grid.minerals[cell]! - control.grid.minerals[cell]!;
  const meatDelta = injected - withMeat.grid.meat[cell]!;
  return {
    seed,
    injected,
    meatDecayed: meatDelta,
    expectedDecay: decayed,
    mineralGained: mineralDelta,
    expectedMineralGain: decayed * 0.5,
    meatError: meatDelta - decayed,
    mineralError: mineralDelta - decayed * 0.5,
  };
}

/**
 * A reproducibility fingerprint of the full world state (grid + alive agents),
 * so a re-run of a scenario can be verified bit-for-bit identical, not just on
 * the handful of values the scenario returns.
 */
export function worldFingerprint(engine: Engine): string {
  const g = engine.grid;
  const cells = (a: Float32Array<ArrayBuffer>) => Array.from(a).map((v) => Math.round(v * 1e9));
  const agents = [...engine.agents.values()]
    .filter((a) => a.alive)
    .sort((a, b) => a.id - b.id)
    .map((a) => ({
      id: a.id,
      x: Math.round(a.x * 1e6),
      y: Math.round(a.y * 1e6),
      vx: Math.round(a.vx * 1e6),
      vy: Math.round(a.vy * 1e6),
      e: Math.round(a.energy * 1e6),
      w: Math.round(a.water * 1e6),
      kills: a.kills,
    }));
  const state = {
    tick: engine.currentTick,
    food: cells(g.food),
    meat: cells(g.meat),
    minerals: cells(g.minerals),
    signal: cells(g.signal),
    cap: cells(g.cap),
    moisture: cells(g.moisture),
    hazard: cells(g.hazard),
    agents,
  };
  return createHash('sha256').update(JSON.stringify(state)).digest('hex');
}

/** Run a scenario twice on the same seed and report whether the world fingerprint matched. */
export function determinismCheck(scenario: 'first-order' | 'second-order' | 'third-order' | 'stochastic', seed: string): { matched: boolean; hash: string } {
  const run = (): string => {
    switch (scenario) {
      case 'first-order':
        return runFirstOrder(seed).fingerprint;
      case 'second-order':
        return runSecondOrder(seed).fingerprint;
      case 'third-order':
        return runThirdOrder(seed).fingerprint;
      case 'stochastic':
        return runStochastic(seed).fingerprint;
    }
  };
  const h1 = run();
  const h2 = run();
  return { matched: h1 === h2, hash: h1 };
}
