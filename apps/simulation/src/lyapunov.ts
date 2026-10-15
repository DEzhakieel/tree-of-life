/**
 * Largest Lyapunov exponent — the hallmark of chaos.
 *
 * Measures exponential divergence of nearby trajectories in phase space.
 * λ > 0  → chaos (butterfly effect: small perturbations grow exponentially)
 * λ = 0  → marginal / quasi-periodic
 * λ < 0  → stable fixed point or limit cycle
 *
 * Algorithm: Rosenstein et al. (1993) adapted for agent-based simulation.
 * We track state-space distances between agent pairs that start close together
 * and measure how fast they diverge, averaged over many pairs and time steps.
 *
 * The state vector is 4D: (x, y, vx, vy) normalised to [0,1] over the world.
 */

import type { SimAgent } from './agent.js';

/** Number of time steps over which divergence is tracked. */
const HORIZON = 60;
/** Maximum number of agent pairs sampled per measurement. */
const MAX_PAIRS = 128;
/** Minimum state-space distance to consider two agents "close". */
const MIN_DIST = 0;
/** Maximum state-space distance to consider two agents "close". */
const MAX_DIST = 0.05;
/** Re-normalisation interval (ticks between renorms). */
const RENORM_INTERVAL = 10;

export interface LyapunovState {
  /** running sum of log-divergence rates */
  logDivSum: number;
  /** number of divergence samples accumulated */
  sampleCount: number;
  /** snapshot of agent states from the previous measurement window */
  prevStates: Float32Array;
  prevIds: Int32Array;
  prevCount: number;
  /** measurement window counter */
  windowTick: number;
  /** latest computed exponent */
  exponent: number;
}

export function createLyapunovState(): LyapunovState {
  return {
    logDivSum: 0,
    sampleCount: 0,
    prevStates: new Float32Array(MAX_PAIRS * 4),
    prevIds: new Int32Array(MAX_PAIRS),
    prevCount: 0,
    windowTick: 0,
    exponent: 0,
  };
}

/** Pack agent (x, y, vx, vy) into a normalised 4D state vector. */
function packState(a: SimAgent, worldSize: number): [number, number, number, number] {
  const inv = 1 / worldSize;
  return [
    a.x * inv,
    a.y * inv,
    (a.vx + 5) / 10,  // vx in [-5,5] → [0,1]
    (a.vy + 5) / 10,
  ];
}

/** Euclidean distance in 4D normalised state space. */
function dist4(a: Float32Array, b: number, worldSize: number): number {
  const inv = 1 / worldSize;
  let sum = 0;
  for (let k = 0; k < 4; k++) {
    const d = a[b + k]! - a[b + k]!;
    sum += d * d;
  }
  return Math.sqrt(sum);
}

function dist4states(
  ax: number, ay: number, avx: number, avy: number,
  bx: number, by: number, bvx: number, bvy: number,
  worldSize: number,
): number {
  const inv = 1 / worldSize;
  let sum = 0;
  let d = (ax - bx) * inv; sum += d * d;
  d = (ay - by) * inv; sum += d * d;
  d = ((avx - bvx)) / 10; sum += d * d;
  d = ((avy - bvy)) / 10; sum += d * d;
  return Math.sqrt(sum);
}

/**
 * Update the Lyapunov estimator. Call once per tick.
 * Returns the current best estimate of the largest Lyapunov exponent.
 */
export function updateLyapunov(
  ls: LyapunovState,
  agents: Map<number, SimAgent>,
  worldSize: number,
  dt: number,
): number {
  // Collect alive agent states
  const states: { id: number; x: number; y: number; vx: number; vy: number }[] = [];
  for (const a of agents.values()) {
    if (!a.alive) continue;
    states.push({ id: a.id, x: a.x, y: a.y, vx: a.vx, vy: a.vy });
  }

  if (states.length < 2) {
    ls.windowTick++;
    return ls.exponent;
  }

  // Every RENORM_INTERVAL ticks, snapshot the states and find close pairs
  if (ls.windowTick % RENORM_INTERVAL === 0) {
    // Snapshot current states
    let count = 0;
    for (let i = 0; i < states.length && count < MAX_PAIRS; i++) {
      const s = states[i]!;
      const off = count * 4;
      ls.prevStates[off] = s.x;
      ls.prevStates[off + 1] = s.y;
      ls.prevStates[off + 2] = s.vx;
      ls.prevStates[off + 3] = s.vy;
      ls.prevIds[count] = s.id;
      count++;
    }
    ls.prevCount = count;
  } else if (ls.prevCount >= 2) {
    // Compute divergence from snapshot to current for matching agents
    let logDivAccum = 0;
    let pairs = 0;

    for (let i = 0; i < ls.prevCount; i++) {
      const prevId = ls.prevIds[i]!;
      const curr = agents.get(prevId);
      if (!curr || !curr.alive) continue;

      const prevOff = i * 4;
      const px = ls.prevStates[prevOff]!;
      const py = ls.prevStates[prevOff + 1]!;
      const pvx = ls.prevStates[prevOff + 2]!;
      const pvy = ls.prevStates[prevOff + 3]!;

      // Find nearest other agent in the snapshot that's still alive
      let minD = Infinity;
      let nearestJ = -1;
      for (let j = 0; j < ls.prevCount; j++) {
        if (j === i) continue;
        const jId = ls.prevIds[j]!;
        const jCurr = agents.get(jId);
        if (!jCurr || !jCurr.alive) continue;

        const d = dist4states(px, py, pvx, pvy, ls.prevStates[j * 4]!, ls.prevStates[j * 4 + 1]!, ls.prevStates[j * 4 + 2]!, ls.prevStates[j * 4 + 3]!, worldSize);
        if (d < minD) {
          minD = d;
          nearestJ = j;
        }
      }

      if (nearestJ < 0) continue;

      // Initial distance
      const d0 = minD;
      if (d0 < 1e-10 || d0 > MAX_DIST) continue;

      // Current distance between the same pair
      const jCurr = agents.get(ls.prevIds[nearestJ]!)!;
      if (!jCurr.alive) continue;
      const d1 = dist4states(curr.x, curr.y, curr.vx, curr.vy, jCurr.x, jCurr.y, jCurr.vx, jCurr.vy, worldSize);

      if (d1 > 0 && d0 > 0) {
        logDivAccum += Math.log(d1 / d0);
        pairs++;
      }
    }

    if (pairs > 0) {
      const elapsed = RENORM_INTERVAL * dt;
      const localExponent = logDivAccum / (pairs * elapsed);
      ls.logDivSum += logDivAccum;
      ls.sampleCount += pairs;
      // Exponential moving average for stability
      ls.exponent = ls.exponent === 0
        ? localExponent
        : ls.exponent * 0.95 + localExponent * 0.05;
    }
  }

  ls.windowTick++;
  return ls.exponent;
}

/**
 * Reset the Lyapunov estimator (e.g. on world reset).
 */
export function resetLyapunov(ls: LyapunovState): void {
  ls.logDivSum = 0;
  ls.sampleCount = 0;
  ls.prevCount = 0;
  ls.windowTick = 0;
  ls.exponent = 0;
}
