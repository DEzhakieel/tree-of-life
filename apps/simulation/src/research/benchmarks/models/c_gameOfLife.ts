/**
 * Benchmark C — Conway's Game of Life (Conway 1970).
 *
 * Reuses the engine's cell-automaton kernel (`gameoflife.ts`) as the source of
 * truth for the classic exact results: the glider translates (1,1) every four
 * generations, the blinker has period 2, the block is a still life (period 1),
 * the pulsar has period 3, and the Gosper glider gun has period 30. These are
 * exact integer facts, so the acceptance checks are exact (tol 0).
 *
 * (The R-pentomino's famous 116-cell stabilisation needs an infinite plane;
 * on a finite torus its escaping gliders wrap, so it is reported as an
 * informational value only, not gated.)
 */

import { createGameOfLife, stepGameOfLife, type GameOfLifeState } from '../../../gameoflife.js';
import { gridsEqual, sha256OfNumbers } from '../signatures.js';
import type { BenchmarkModel, BenchmarkScale, BenchParams, RunOutput } from '../types.js';

type Cells = [number, number][];

const GLIDER: Cells = [
  [1, 0],
  [2, 1],
  [0, 2],
  [1, 2],
  [2, 2],
];

const PULSAR: Cells = [
  [2, 0], [3, 0], [4, 0], [8, 0], [9, 0], [10, 0],
  [0, 2], [5, 2], [7, 2], [12, 2],
  [0, 3], [5, 3], [7, 3], [12, 3],
  [0, 4], [5, 4], [7, 4], [12, 4],
  [2, 5], [3, 5], [4, 5], [8, 5], [9, 5], [10, 5],
  [2, 7], [3, 7], [4, 7], [8, 7], [9, 7], [10, 7],
  [0, 8], [5, 8], [7, 8], [12, 8],
  [0, 9], [5, 9], [7, 9], [12, 9],
  [0, 10], [5, 10], [7, 10], [12, 10],
  [2, 12], [3, 12], [4, 12], [8, 12], [9, 12], [10, 12],
];

const GOSPER_GUN: Cells = [
  [0, 4], [0, 5], [1, 4], [1, 5],
  [10, 4], [10, 5], [10, 6], [11, 3], [11, 7], [12, 2], [12, 8],
  [13, 2], [13, 8], [14, 5], [15, 3], [15, 7], [16, 4], [16, 5], [16, 6], [17, 5],
  [20, 2], [20, 3], [20, 4], [21, 2], [21, 3], [21, 4], [22, 1], [22, 5],
  [24, 0], [24, 1], [24, 5], [24, 6],
  [34, 2], [34, 3], [35, 2], [35, 3],
];

const R_PENTOMINO: Cells = [
  [1, 0],
  [2, 0],
  [0, 1],
  [1, 1],
  [1, 2],
];

function make(size: number, cells: Cells, ox = 0, oy = 0): GameOfLifeState {
  const s = createGameOfLife(size);
  for (const [x, y] of cells) {
    const gx = (x + ox + size) % size;
    const gy = (y + oy + size) % size;
    s.current[gy * size + gx] = 1;
  }
  return s;
}

interface Bbox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  count: number;
}

function bbox(s: GameOfLifeState): Bbox {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let count = 0;
  for (let y = 0; y < s.size; y++) {
    for (let x = 0; x < s.size; x++) {
      if (s.current[y * s.size + x]) {
        count++;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  return { minX, minY, maxX, maxY, count };
}

/** smallest p in [1,maxPeriod] whose tail is p-periodic for `repeats` cycles; -1 if none. */
function detectPeriod(
  s: GameOfLifeState,
  maxPeriod: number,
  maxSteps: number,
  warmup: number,
  repeats: number,
): number {
  const hist: Uint8Array[] = [];
  for (let t = 0; t < maxSteps; t++) {
    stepGameOfLife(s);
    hist.push(s.current.slice());
    if (hist.length >= warmup + maxPeriod * (repeats + 1)) break;
  }
  const n = hist.length;
  if (n === 0) return -1;
  for (let p = 1; p <= maxPeriod; p++) {
    if (n - 1 - p * (repeats + 1) < 0) continue;
    let ok = true;
    for (let r = 0; r < repeats; r++) {
      const a = hist[n - 1 - r * p]!;
      const b = hist[n - 1 - (r + 1) * p]!;
      if (!gridsEqual(a, b)) {
        ok = false;
        break;
      }
    }
    if (ok) return p;
  }
  return -1;
}

/** glider translation over `periods` four-generation steps: returns total (dx, dy). */
function gliderShift(periods: number): { dx: number; dy: number; ok: boolean } {
  const s = make(64, GLIDER, 10, 10);
  const start = bbox(s);
  let ok = true;
  for (let k = 0; k < periods * 4; k++) {
    stepGameOfLife(s);
    if ((k + 1) % 4 === 0) {
      const b = bbox(s);
      if (b.count !== 5 || b.maxX - b.minX !== 2 || b.maxY - b.minY !== 2) ok = false;
    }
  }
  const end = bbox(s);
  return { dx: end.minX - start.minX, dy: end.minY - start.minY, ok };
}

function population(s: GameOfLifeState): number {
  let c = 0;
  for (let k = 0; k < s.current.length; k++) c += s.current[k]!;
  return c;
}

/**
 * The Gosper gun is not grid-periodic (each emitted glider drifts away on the
 * torus), but its emission rate is exact: once in steady state the population
 * grows by exactly 5 live cells (one glider) every 30 generations.
 */
function gunEmission(scale: BenchmarkScale): { delta: number; spread: number } {
  const warmup = 60;
  const window = 30;
  const windows = scale === 'quick' ? 4 : 6;
  const s = make(128, GOSPER_GUN, 10, 10);
  const pops: number[] = [];
  for (let t = 1; t <= warmup + window * windows; t++) {
    stepGameOfLife(s);
    if (t % window === 0 && t >= warmup) pops.push(population(s));
  }
  const deltas: number[] = [];
  for (let i = 1; i < pops.length; i++) deltas.push(pops[i]! - pops[i - 1]!);
  if (deltas.length === 0) return { delta: NaN, spread: NaN };
  return {
    delta: deltas[deltas.length - 1]!,
    spread: Math.max(...deltas) - Math.min(...deltas),
  };
}

export const gameOfLifeBenchmark: BenchmarkModel = {
  id: 'C',
  name: 'Game of Life',
  family: 'cellular automaton',
  stochastic: false,
  reference:
    'Conway (1970): glider translates (+1,+1)/4 gens, blinker period 2, block period 1, pulsar period 3, Gosper gun period 30.',
  run(_seed: string, scale: BenchmarkScale, _params: BenchParams = {}): RunOutput {
    const g = gliderShift(10);

    const blinker = make(16, [[10, 10], [11, 10], [12, 10]]);
    const blinkerPeriod = detectPeriod(blinker, 4, 40, 0, 3);

    const block = make(16, [[10, 10], [11, 10], [10, 11], [11, 11]]);
    const blockPeriod = detectPeriod(block, 4, 40, 0, 3);

    const pulsar = make(24, PULSAR, 4, 4);
    const pulsarPeriod = detectPeriod(pulsar, 6, 60, 0, 3);

    // the gun emits one glider (5 live cells) every 30 generations
    const gun = gunEmission(scale);
    const gunPeriod = gun.delta === 5 && gun.spread === 0 ? 30 : -1;

    // informational only (needs an infinite plane for the exact 116-cell result)
    const rp = make(128, R_PENTOMINO, 60, 60);
    for (let t = 0; t < 120; t++) stepGameOfLife(rp);
    const rpAlive = bbox(rp).count;

    return {
      signature: {
        gliderShiftX: g.ok ? g.dx : -1,
        gliderShiftY: g.dy, // informational; must also be 10
        blinkerPeriod,
        blockPeriod,
        pulsarPeriod,
        gunPeriod,
        gunDelta: gun.delta,
        gunDeltaSpread: gun.spread,
        rpAlive,
      },
      fingerprint: sha256OfNumbers(
        Float64Array.from([
          g.dx, g.dy, blinkerPeriod, blockPeriod, pulsarPeriod, gunPeriod, gun.delta, rpAlive,
        ]),
      ),
    };
  },
  checks: [
    {
      key: 'gliderShiftX',
      test: 'eqAbs',
      value: 10,
      tol: 0,
      note: 'glider translates (+1,+1) every 4 generations: +10 cells over 10 periods.',
      gate: true,
      referenceKind: 'exact',
      citation: 'Conway (1970)',
    },
    { key: 'blinkerPeriod', test: 'eqAbs', value: 2, tol: 0, note: 'blinker has period 2.', gate: true, referenceKind: 'exact', citation: 'Conway (1970)' },
    { key: 'blockPeriod', test: 'eqAbs', value: 1, tol: 0, note: 'block is a still life (period 1).', gate: true, referenceKind: 'exact', citation: 'Conway (1970)' },
    { key: 'pulsarPeriod', test: 'eqAbs', value: 3, tol: 0, note: 'pulsar has period 3.', gate: true, referenceKind: 'exact', citation: 'Conway (1970)' },
    {
      key: 'gunPeriod',
      test: 'eqAbs',
      value: 30,
      tol: 0,
      note: 'Gosper gun emits one glider (+5 cells) every 30 generations.',
      gate: true,
      referenceKind: 'exact',
      citation: 'Gosper (1970)',
    },
    {
      key: 'gunDeltaSpread',
      test: 'eqAbs',
      value: 0,
      tol: 0,
      note: 'glider emission rate is perfectly regular (all 30-generation deltas equal).',
      gate: true,
      referenceKind: 'exact',
      citation: 'Gosper (1970)',
    },
    {
      key: 'rpAlive',
      test: 'gte',
      value: 1,
      note: 'R-pentomino survives 120 generations (informational; exact 116 needs an infinite plane).',
      gate: false,
      referenceKind: 'empirical',
      citation: 'Conway (1970)',
    },
  ],
  analytic: { gliderShiftX: 10, blinkerPeriod: 2, blockPeriod: 1, pulsarPeriod: 3, gunPeriod: 30, gunDeltaSpread: 0 },
  empirical: {
    systemId: 'conway-life',
    claim: 'Life’s canonical oscillator/glider/gun facts: glider +1/+1 per 4 gens, pulsar p3, Gosper gun p30.',
  },
};
