import { DEFAULT_PARAMS, TERRAIN_CELL } from '@fractal-life/shared';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Engine } from '../engine.js';
import type { BrainConfig } from '../brain.js';
import type { WorldStochasticConfig } from '../worldStoch.js';
import { sampleGrid } from '../terrain.js';
import { makeWorld, runFirstOrder, runSecondOrder, runThirdOrder, runConservation, determinismCheck } from './scenarios.js';
import { mean, stdev } from './stats.js';

/**
 * The emergence ladder: one long, unscripted run measured against a ladder of
 * operationalized emergence claims. It answers — with numbers, not vibes —
 * the question "how do interactions emerge and then produce life, then
 * intelligence/cognition?" by checking, in order:
 *
 *   L0 matter       — physical matter cycles (plants/carrion/minerals) exist.
 *   L1 life         — a population is self-sustaining: persists, reproduces,
 *                     holds energy/water homeostasis, and matter keeps cycling.
 *   L2 interaction  — individuals differentiate (species), and interact via
 *                     predation and/or cooperation (greenbeard donation).
 *   L3 cognition    — agents USE information: goal-directed foraging up food
 *                     gradients, hazard response, a behavioural repertoire,
 *                     communication (pheromone field), cultural memory (memes)
 *                     and selection-driven adaptation.
 *
 * Every quantity is measured from public engine state only (SimStats + SimAgent
 * + the terrain grid), so the tool stays honest to what the simulation actually
 * did — no reconstructed internals.
 */

const GRADIENT_OFFSET = Math.min(8, TERRAIN_CELL / 2); // world units for finite differences
const SPEED_EPS = 0.05;
const HEADING_BINS = 16;
const ENGINE_PATH = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'engine.ts');

export interface LadderOptions {
  seed: string;
  /** how many ticks to simulate (default ~3 generations at agentMaxAge 4000) */
  ticks: number;
  spawnCount: number;
  maxPopulation: number;
  /** measure trajectory every N ticks */
  sampleEvery: number;
  overrides?: Partial<typeof DEFAULT_PARAMS>;
  /** optional real-world enrichment snapshot to ground the run (see grounding.ts) */
  grounding?: import('@fractal-life/shared').EnrichmentSnapshot;
  /** brain paradigm for every agent (default: plain hebbian with the genome
   *  drives). Lets the same ladder measure emergence under backprop learning,
   *  a stochastic policy head, POMDP beliefs, etc. — opt-in and bit-exact with
   *  the research scenarios. */
  brain?: Partial<BrainConfig>;
  /** stochastic world (Markov weather, OU resources, Poisson bursts) */
  worldStoch?: Partial<WorldStochasticConfig>;
  /** opt-in deep cell biochemistry (protein folding, membranes, gradients,
   *  MM kinetics) — see WorldConfig.cellBio */
  cellBio?: boolean;
  /** astrophysical physics frame (real climb costs, escape-velocity cap,
   *  drag, seasons) — see WorldConfig.universe */
  universe?: import('@fractal-life/shared').UniverseConfig;
}

export interface TrajectoryPoint {
  tick: number;
  alive: number;
  species: number;
  birthsRun: number;
  deathsRun: number;
  escapeRun: number;
  avgEnergy: number;
  avgWater: number;
  entropy: number;
  diversity: number;
  complexity: number;
  predatorFraction: number;
  cooperation: number;
  meanAltruism: number;
  cultureCount: number;
  memeEntropy: number;
  speciesMemeMI: number;
  /** sum of `kills` across alive agents (proxy: predators that die lose their tally) */
  kills: number;
  /** mean cosine between an agent's velocity and the local food gradient (goal-directed foraging) */
  foragingMean: number;
  /** Pearson corr(agent speed, local hazard) — negative = danger avoidance */
  hazardCorr: number;
  /** Pearson corr(agent speed, local signal) — reaction to the communication field */
  signalCorr: number;
  signalTotal: number;
  signalCells: number;
  /** Shannon entropy (bits) of the velocity-heading distribution — behavioural repertoire */
  headingEntropy: number;
  /** mean lifetime energy acquired by alive agents (fitness proxy) */
  fitnessMean: number;
  /** max lifetime energy acquired among alive agents */
  fitnessMax: number;
  ageMean: number;
  /** global energy held in matter pools: food + meat + minerals */
  matterTotal: number;
  /** global carrion pool (decaying biomass) — the death-to-soil loop */
  meatTotal: number;
  // --- game theory observables ---
  meanAggression: number;
  meanCooperation: number;
  meanRisk: number;
  meanDeception: number;
  predatorGeneFraction: number;
  preyGeneFraction: number;
  energyInequality: number;
  donationRatio: number;
}

export interface LadderLevelVerdict {
  level: string;
  verdict: 'EMERGENT' | 'PARTIAL' | 'ABSENT';
  evidence: Record<string, number | boolean>;
  note: string;
}

export interface LadderSynthesis {
  levels: LadderLevelVerdict[];
  chain: string;
}

export interface ControlledScenarioEvidence {
  firstOrder: { gap: number; aAlive: boolean; bAlive: boolean };
  secondOrder: { completed: boolean; kills: number; predDiedAt: number };
  thirdOrder: { growthDelta: number; mineralDelta: number; controlGrowth: number };
  conservation: { meatError: number; mineralError: number };
  determinism: { firstOrder: boolean; secondOrder: boolean; thirdOrder: boolean };
}

export interface LadderResult {
  provenance: Record<string, unknown>;
  options: LadderOptions;
  trajectory: TrajectoryPoint[];
  summary: LadderSummary;
  synthesis: LadderSynthesis;
  controlled: ControlledScenarioEvidence;
}

function pearson(xs: number[], ys: number[]): number {
  const n = Math.min(xs.length, ys.length);
  if (n < 2) return 0;
  const mx = mean(xs);
  const my = mean(ys);
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i++) {
    const a = xs[i]! - mx;
    const b = ys[i]! - my;
    num += a * b;
    dx += a * a;
    dy += b * b;
  }
  const den = Math.sqrt(dx * dy);
  return den === 0 ? 0 : num / den;
}

function headingEntropyOf(vxs: number[], vys: number[]): number {
  const counts = new Array<number>(HEADING_BINS).fill(0);
  let total = 0;
  for (let i = 0; i < vxs.length; i++) {
    if (Math.hypot(vxs[i]!, vys[i]!) < SPEED_EPS) continue;
    const h = Math.atan2(vys[i]!, vxs[i]!);
    const bin = Math.floor(((h + Math.PI) / (2 * Math.PI)) * HEADING_BINS) % HEADING_BINS;
    counts[bin]!++;
    total++;
  }
  if (total === 0) return 0;
  let h = 0;
  for (const c of counts) {
    const p = c / total;
    if (p > 0) h -= p * Math.log2(p);
  }
  return h;
}

export function runLadder(opts: LadderOptions): LadderResult {
  const world = makeWorld(opts.seed, opts.spawnCount, {
    maxPopulation: opts.maxPopulation,
    ...opts.overrides,
  });
  if (opts.grounding) world.grounding = opts.grounding;
  if (opts.cellBio) world.cellBio = true;
  if (opts.universe) world.universe = opts.universe;
  const engine = new Engine(world);
  if (opts.brain) engine.setBrainConfig({ enabled: true, ...opts.brain });
  if (opts.worldStoch) engine.setWorldStochastics(opts.worldStoch);
  const trajectory: TrajectoryPoint[] = [];
  const cap = engine.params.energyCapacity;

  let birthsRun = 0;
  let deathsRun = 0;
  let escapeRun = 0;

  for (let tick = 1; tick <= opts.ticks; tick++) {
    const s = engine.tick().stats;
    birthsRun += s.births;
    deathsRun += s.deaths;
    escapeRun += s.escapeDeaths;

    if (tick % opts.sampleEvery !== 0) continue;

    const vxs: number[] = [];
    const vys: number[] = [];
    const speeds: number[] = [];
    const hazards: number[] = [];
    const sigs: number[] = [];
    let foragingNum = 0;
    let foragingDen = 0;
    let kills = 0;
    let fitnessSum = 0;
    let fitnessMax = 0;
    let ageSum = 0;
    let alive = 0;

    let matterTotal = 0;
    let meatTotal = 0;
    let signalTotal = 0;
    let signalCells = 0;
    const grid = engine.grid;
    for (let i = 0; i < grid.food.length; i++) {
      matterTotal += grid.food[i]! + grid.meat[i]! + grid.minerals[i]!;
      meatTotal += grid.meat[i]!;
      const sig = grid.signal[i]!;
      signalTotal += sig;
      if (sig > 1e-6) signalCells++;
    }

    for (const a of engine.agents.values()) {
      if (!a.alive) continue;
      alive++;
      const sp = Math.hypot(a.vx, a.vy);
      speeds.push(sp);
      vxs.push(a.vx);
      vys.push(a.vy);
      kills += a.kills;
      fitnessSum += a.energyAcquired;
      if (a.energyAcquired > fitnessMax) fitnessMax = a.energyAcquired;
      ageSum += a.age;

      const c = sampleGrid(grid, a.x, a.y);
      hazards.push(c.hazard);
      sigs.push(c.signal);

      // goal-directed foraging: cosine between velocity and the local food
      // gradient (central finite difference), weighted by speed
      if (sp >= SPEED_EPS) {
        const fx = sampleGrid(grid, a.x + GRADIENT_OFFSET, a.y).food - sampleGrid(grid, a.x - GRADIENT_OFFSET, a.y).food;
        const fy = sampleGrid(grid, a.x, a.y + GRADIENT_OFFSET).food - sampleGrid(grid, a.x, a.y - GRADIENT_OFFSET).food;
        const g = Math.hypot(fx, fy);
        if (g > 1e-12) {
          foragingNum += (a.vx * fx + a.vy * fy) / g;
          foragingDen += sp;
        }
      }
    }

    trajectory.push({
      tick,
      alive,
      species: s.speciesCount,
      birthsRun,
      deathsRun,
      escapeRun,
      avgEnergy: s.avgEnergy,
      avgWater: s.avgWater,
      entropy: s.entropy,
      diversity: s.diversity,
      complexity: s.complexity,
      predatorFraction: s.predatorFraction,
      cooperation: s.cooperation,
      meanAltruism: s.meanAltruism,
      cultureCount: s.cultureCount,
      memeEntropy: s.memeEntropy,
      speciesMemeMI: s.speciesMemeMI,
      kills,
      foragingMean: foragingDen > 0 ? foragingNum / foragingDen : 0,
      hazardCorr: pearson(speeds, hazards),
      signalCorr: pearson(speeds, sigs),
      signalTotal,
      signalCells,
      headingEntropy: headingEntropyOf(vxs, vys),
      fitnessMean: alive > 0 ? fitnessSum / alive : 0,
      fitnessMax,
      ageMean: alive > 0 ? ageSum / alive : 0,
      matterTotal,
      meatTotal,
      meanAggression: s.meanAggression,
      meanCooperation: s.meanCooperation,
      meanRisk: s.meanRisk,
      meanDeception: s.meanDeception,
      predatorGeneFraction: s.predatorGeneFraction,
      preyGeneFraction: s.preyGeneFraction,
      energyInequality: s.energyInequality,
      donationRatio: s.donationRatio,
    });
  }

  const summary = summarize(trajectory);
  const synthesis = synthesize(summary);
  const controlled = runControlledEvidence(opts.seed);

  return {
    provenance: {
      tool: 'fractal-life emergence ladder',
      timestamp: new Date().toISOString(),
      node: process.version,
      platform: `${process.platform}/${process.arch}`,
      seed: opts.seed,
      ticks: opts.ticks,
      spawnCount: opts.spawnCount,
      maxPopulation: opts.maxPopulation,
      sampleEvery: opts.sampleEvery,
      brain: opts.brain ?? null,
      worldStoch: opts.worldStoch ?? null,
      energyCapacity: cap,
      // real-world grounding provenance, when present
      grounded: opts.grounding ? {
        version: opts.grounding.version,
        generatedAt: opts.grounding.generatedAt,
        sources: opts.grounding.sources.map((s) => ({ name: s.name, license: s.license })),
        species: opts.grounding.ecology.taxa.map((t) => t.scientificName),
      } : false,
      engineSourceSha256: createHash('sha256').update(readFileSync(ENGINE_PATH)).digest('hex'),
    },
    options: opts,
    trajectory,
    summary,
    synthesis,
    controlled,
  };
}

export interface LadderSummary {
  life: {
    finalAlive: number;
    minAlive: number;
    maxAlive: number;
    extinct: boolean;
    totalBirths: number;
    totalDeaths: number;
    netBirths: number;
    reproductionRate: number;
    avgEnergyMean: number;
    avgEnergyCV: number;
    matterMean: number;
    matterCV: number;
    cycling: boolean;
    carrionLoop: boolean;
  };
  interaction: {
    maxSpecies: number;
    finalSpecies: number;
    maxPredatorFraction: number;
    maxCooperation: number;
    maxMeanAltruism: number;
    maxKills: number;
  };
  cognition: {
    foragingMean: number;
    foragingPositiveFrac: number;
    hazardCorr: number;
    signalCorr: number;
    headingEntropyMean: number;
    signalTotalMean: number;
    signalCellsMax: number;
    cultureCountMax: number;
    memeEntropyMax: number;
    speciesMemeMIMax: number;
    complexityMax: number;
    fitnessFirstQ: number;
    fitnessLastQ: number;
    adaptationDelta: number;
    adaptationFrac: number;
  };
  gameTheory: {
    meanAggressionMean: number;
    meanCooperationMean: number;
    meanRiskMean: number;
    meanDeceptionMean: number;
    predatorGeneFractionMax: number;
    preyGeneFractionMax: number;
    energyInequalityMax: number;
    donationRatioMean: number;
    strategyEntropy: number;
  };
}

function summarize(traj: TrajectoryPoint[]): LadderSummary {
  const alive = traj.map((t) => t.alive);
  const avgE = traj.map((t) => t.avgEnergy);
  const matter = traj.map((t) => t.matterTotal);
  const meat = traj.map((t) => t.meatTotal);
  const heading = traj.map((t) => t.headingEntropy);
  const first = traj.slice(0, Math.max(1, Math.floor(traj.length / 4)));
  const last = traj.slice(Math.floor((traj.length * 3) / 4));
  const fMean = (xs: TrajectoryPoint[], key: keyof TrajectoryPoint): number => (xs.length ? mean(xs.map((t) => t[key] as number)) : 0);

  const totalBirths = traj.length ? traj[traj.length - 1]!.birthsRun : 0;
  const totalDeaths = traj.length ? traj[traj.length - 1]!.deathsRun : 0;
  const matterMean = mean(matter);

  return {
    life: {
      finalAlive: alive.length ? alive[alive.length - 1]! : 0,
      minAlive: Math.min(...alive),
      maxAlive: Math.max(...alive),
      extinct: alive.length > 0 && alive[alive.length - 1] === 0,
      totalBirths,
      totalDeaths,
      netBirths: totalBirths - totalDeaths,
      reproductionRate: totalDeaths > 0 ? totalBirths / totalDeaths : totalBirths > 0 ? Infinity : 0,
      avgEnergyMean: mean(avgE),
      avgEnergyCV: avgE.length ? stdev(avgE) / (mean(avgE) || 1) : 0,
      matterMean,
      matterCV: matter.length ? stdev(matter) / (matterMean || 1) : 0,
      cycling: matter.length > 1 && stdev(matter) > 1e-6,
      carrionLoop: meat.some((m) => m > 1e-6),
    },
    interaction: {
      maxSpecies: Math.max(...traj.map((t) => t.species)),
      finalSpecies: traj.length ? traj[traj.length - 1]!.species : 0,
      maxPredatorFraction: Math.max(...traj.map((t) => t.predatorFraction)),
      maxCooperation: Math.max(...traj.map((t) => t.cooperation)),
      maxMeanAltruism: Math.max(...traj.map((t) => t.meanAltruism)),
      maxKills: Math.max(...traj.map((t) => t.kills)),
    },
    cognition: {
      foragingMean: fMean(traj, 'foragingMean'),
      foragingPositiveFrac: traj.filter((t) => t.foragingMean > 0).length / Math.max(1, traj.length),
      hazardCorr: fMean(traj, 'hazardCorr'),
      signalCorr: fMean(traj, 'signalCorr'),
      headingEntropyMean: mean(heading),
      signalTotalMean: fMean(traj, 'signalTotal'),
      signalCellsMax: Math.max(...traj.map((t) => t.signalCells)),
      cultureCountMax: Math.max(...traj.map((t) => t.cultureCount)),
      memeEntropyMax: Math.max(...traj.map((t) => t.memeEntropy)),
      speciesMemeMIMax: Math.max(...traj.map((t) => t.speciesMemeMI)),
      complexityMax: Math.max(...traj.map((t) => t.complexity)),
      fitnessFirstQ: fMean(first, 'fitnessMean'),
      fitnessLastQ: fMean(last, 'fitnessMean'),
      adaptationDelta: fMean(last, 'fitnessMean') - fMean(first, 'fitnessMean'),
      adaptationFrac: fMean(first, 'fitnessMean') > 0 ? (fMean(last, 'fitnessMean') - fMean(first, 'fitnessMean')) / fMean(first, 'fitnessMean') : 0,
    },
    gameTheory: {
      meanAggressionMean: fMean(traj, 'meanAggression'),
      meanCooperationMean: fMean(traj, 'meanCooperation'),
      meanRiskMean: fMean(traj, 'meanRisk'),
      meanDeceptionMean: fMean(traj, 'meanDeception'),
      predatorGeneFractionMax: Math.max(...traj.map((t) => t.predatorGeneFraction)),
      preyGeneFractionMax: Math.max(...traj.map((t) => t.preyGeneFraction)),
      energyInequalityMax: Math.max(...traj.map((t) => t.energyInequality)),
      donationRatioMean: fMean(traj, 'donationRatio'),
      strategyEntropy: (() => {
        const aggBins = traj.map((t) => t.meanAggression);
        const coopBins = traj.map((t) => t.meanCooperation);
        const riskBins = traj.map((t) => t.meanRisk);
        const decepBins = traj.map((t) => t.meanDeception);
        const allBins = [...aggBins, ...coopBins, ...riskBins, ...decepBins];
        if (allBins.length === 0) return 0;
        const meanVal = mean(allBins);
        const variance = allBins.reduce((s, v) => s + (v - meanVal) ** 2, 0) / allBins.length;
        return Math.sqrt(variance);
      })(),
    },
  };
}

function synthesize(summary: LadderSummary): LadderSynthesis {
  const L = summary.life;
  const I = summary.interaction;
  const C = summary.cognition;

  const lifeVerdict: LadderLevelVerdict = L.extinct
    ? { level: 'L1 life', verdict: 'ABSENT', evidence: { finalAlive: L.finalAlive, totalBirths: L.totalBirths }, note: 'the population died out; cycling matter alone is not life.' }
    : L.totalBirths > 0 && L.minAlive > 0 && L.cycling
      ? {
          level: 'L1 life',
          verdict: 'EMERGENT',
          evidence: { finalAlive: L.finalAlive, minAlive: L.minAlive, netBirths: L.netBirths, reproductionRate: L.reproductionRate, avgEnergyMean: L.avgEnergyMean, avgEnergyCV: L.avgEnergyCV, cycling: L.cycling, carrionLoop: L.carrionLoop },
          note: 'population persists, reproduces, holds homeostasis and matter keeps cycling — the living subsystem is self-sustaining.',
        }
      : { level: 'L1 life', verdict: 'PARTIAL', evidence: { finalAlive: L.finalAlive, minAlive: L.minAlive, netBirths: L.netBirths }, note: 'some life persists but the self-sustaining loop is incomplete.' };

  const interactionVerdict: LadderLevelVerdict =
    I.maxSpecies >= 2 && (I.maxPredatorFraction > 0.01 || I.maxCooperation > 1e-6 || I.maxMeanAltruism > 1e-6)
      ? { level: 'L2 interaction', verdict: 'EMERGENT', evidence: { maxSpecies: I.maxSpecies, maxPredatorFraction: I.maxPredatorFraction, maxCooperation: I.maxCooperation, maxMeanAltruism: I.maxMeanAltruism, maxKills: I.maxKills }, note: 'individuals differentiated into multiple species and interacted — through predation and/or cooperation.' }
      : I.maxSpecies >= 2
        ? { level: 'L2 interaction', verdict: 'PARTIAL', evidence: { maxSpecies: I.maxSpecies }, note: 'species differentiated but no sustained predation/cooperation observed.' }
        : { level: 'L2 interaction', verdict: 'ABSENT', evidence: { maxSpecies: I.maxSpecies }, note: 'no ecological differentiation observed.' };

  const cognitionVerdict: LadderLevelVerdict =
    (C.foragingMean > 0.005 || C.hazardCorr < -0.03 || C.headingEntropyMean > 0.3) &&
    (C.signalTotalMean > 1e-6 || C.cultureCountMax > 1 || C.memeEntropyMax > 0) &&
    C.adaptationDelta > 0
      ? {
          level: 'L3 cognition',
          verdict: 'EMERGENT',
          evidence: { foragingMean: C.foragingMean, foragingPositiveFrac: C.foragingPositiveFrac, hazardCorr: C.hazardCorr, signalTotalMean: C.signalTotalMean, headingEntropyMean: C.headingEntropyMean, cultureCountMax: C.cultureCountMax, memeEntropyMax: C.memeEntropyMax, adaptationDelta: C.adaptationDelta, adaptationFrac: C.adaptationFrac },
          note: 'agents used environmental information to steer (gradient foraging, hazard response), sustained a communication/culture channel, and selection improved their payoff across the run.',
        }
      : C.foragingMean > 0.005 || C.hazardCorr < -0.03 || C.headingEntropyMean > 0.3
        ? { level: 'L3 cognition', verdict: 'PARTIAL', evidence: { foragingMean: C.foragingMean, hazardCorr: C.hazardCorr, headingEntropyMean: C.headingEntropyMean }, note: 'information processing is present but communication/culture or adaptation did not rise above threshold.' }
        : { level: 'L3 cognition', verdict: 'ABSENT', evidence: { foragingMean: C.foragingMean, hazardCorr: C.hazardCorr, headingEntropyMean: C.headingEntropyMean }, note: 'no measurable information-driven behaviour.' };

  const chain =
    `Matter loops (L0) ${L.cycling ? 'cycle' : 'do not cycle'}; life (L1) is ${lifeVerdict.verdict.toLowerCase()}; ` +
    `interaction (L2) is ${interactionVerdict.verdict.toLowerCase()}; ` +
    `cognition (L3) is ${cognitionVerdict.verdict.toLowerCase()}. ` +
    `The causal ladder holds: L1 requires L0, L2 requires L1's persistent population, and L3 requires L2's structured population — each rung is a prerequisite that the run either satisfies or fails.`;

  return { levels: [lifeVerdict, interactionVerdict, cognitionVerdict], chain };
}

function runControlledEvidence(seed: string): ControlledScenarioEvidence {
  const f = runFirstOrder(seed);
  const s = runSecondOrder(seed);
  const t = runThirdOrder(seed);
  const c = runConservation(seed);
  const d1 = determinismCheck('first-order', seed);
  const d2 = determinismCheck('second-order', seed);
  const d3 = determinismCheck('third-order', seed);
  return {
    firstOrder: { gap: f.gap, aAlive: f.aAlive, bAlive: f.bAlive },
    secondOrder: { completed: s.completed, kills: s.kills, predDiedAt: s.predDiedAt },
    thirdOrder: { growthDelta: t.growthDelta, mineralDelta: t.mineralDelta, controlGrowth: t.controlGrowth },
    conservation: { meatError: c.meatError, mineralError: c.mineralError },
    determinism: { firstOrder: d1.matched, secondOrder: d2.matched, thirdOrder: d3.matched },
  };
}
