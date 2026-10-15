/**
 * Conway's Game of Life — cellular automaton overlay on the terrain grid.
 *
 * Each terrain cell is alive (1) or dead (0). The standard rules apply:
 *   - Birth: dead cell with exactly 3 live neighbours → alive
 *   - Survival: live cell with 2 or 3 live neighbours → alive
 *   - Death: otherwise → dead
 *
 * The CA state is seeded from agent density (cells with agents above a
 * threshold become alive) and evolves independently. The CA then feeds
 * back into the world as:
 *   - A terrain modifier: live cells slightly boost food regeneration
 *   - A sensor: agents can detect CA activity
 *   - An observable: CA complexity (alive fraction, still life count, oscillator
 *     detection) measures emergent computation
 *
 * This creates a layered system: the agents influence the CA (by seeding it),
 * the CA influences the terrain (by modulating resources), and the terrain
 * influences the agents — a self-referential loop that can generate
 * unexpected emergent patterns.
 *
 * The CA grid uses the same resolution as the terrain grid (128×128) and
 * toroidal boundary conditions.
 */

import type { SimAgent } from './agent.js';

export interface GameOfLifeState {
  /** current CA grid: 0 = dead, 1 = alive */
  current: Uint8Array;
  /** double-buffer for next generation */
  next: Uint8Array;
  /** grid size (cells per axis) */
  size: number;
  /** generation counter */
  generation: number;
  /** global observables */
  globals: {
    /** fraction of cells that are alive */
    aliveFraction: number;
    /** number of still-life blocks detected (2×2 alive patterns) */
    stillLifeCount: number;
    /** number of oscillator patterns detected (3-cell lines) */
    oscillatorCount: number;
    /** CA complexity: alive fraction × entropy of neighbourhood distribution */
    complexity: number;
    /** total births this generation */
    births: number;
    /** total deaths this generation */
    deaths: number;
  };
}

/**
 * Count alive neighbours (toroidal wrapping) using a 3×3 stencil.
 */
function countNeighbours(grid: Uint8Array, size: number, x: number, y: number): number {
  let count = 0;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      const nx = (x + dx + size) % size;
      const ny = (y + dy + size) % size;
      count += grid[ny * size + nx]!;
    }
  }
  return count;
}

/**
 * Run one generation of Conway's Game of Life (toroidal).
 */
export function stepGameOfLife(state: GameOfLifeState): void {
  const { current, next, size } = state;
  let births = 0;
  let deaths = 0;
  let aliveCount = 0;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const n = countNeighbours(current, size, x, y);
      const alive = current[i]!;
      let newAlive: number;

      if (alive) {
        // Survival: exactly 2 or 3 neighbours
        newAlive = (n === 2 || n === 3) ? 1 : 0;
      } else {
        // Birth: exactly 3 neighbours
        newAlive = n === 3 ? 1 : 0;
      }

      next[i] = newAlive;
      if (newAlive) aliveCount++;
      if (alive && !newAlive) deaths++;
      if (!alive && newAlive) births++;
    }
  }

  // Swap buffers
  const tmp = state.current;
  state.current = next;
  state.next = tmp;
  state.generation++;

  // Compute observables
  const total = size * size;
  const aliveFraction = aliveCount / total;

  // Still life detection: count 2×2 blocks where all 4 cells are alive
  let stillLife = 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const r = y * size + ((x + 1) % size);
      const d = ((y + 1) % size) * size + x;
      const dr = ((y + 1) % size) * size + ((x + 1) % size);
      if (current[i] && current[r] && current[d] && current[dr]) {
        stillLife++;
      }
    }
  }

  // Oscillator detection: count 3-cell horizontal lines
  let oscillators = 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size - 2; x++) {
      const i = y * size + x;
      if (current[i] && current[i + 1] && current[i + 2] &&
          !((x > 0 && current[i - 1]) || (x + 3 < size && current[i + 3]))) {
        oscillators++;
      }
    }
  }

  // Neighbourhood distribution entropy
  const nbCounts = new Uint32Array(9);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const n = countNeighbours(current, size, x, y);
      nbCounts[n]++;
    }
  }
  let nbEntropy = 0;
  for (let k = 0; k < 9; k++) {
    const p = nbCounts[k]! / total;
    if (p > 0) nbEntropy -= p * Math.log2(p);
  }

  state.globals = {
    aliveFraction,
    stillLifeCount: stillLife,
    oscillatorCount: oscillators,
    complexity: aliveFraction * nbEntropy,
    births,
    deaths,
  };
}

/**
 * Seed the CA from agent positions. Cells with at least `threshold` agents
 * become alive. This connects the agent population to the CA dynamics.
 */
export function seedFromAgents(
  state: GameOfLifeState,
  agents: Map<number, SimAgent>,
  threshold: number,
  terrainCell: number,
): void {
  // Temporarily clear the grid
  state.current.fill(0);

  for (const a of agents.values()) {
    if (!a.alive) continue;
    const cx = Math.floor(a.x / terrainCell) % state.size;
    const cy = Math.floor(a.y / terrainCell) % state.size;
    state.current[cy * state.size + cx] = 1;
  }
}

/**
 * Create a fresh Game of Life state.
 */
export function createGameOfLife(size: number): GameOfLifeState {
  return {
    current: new Uint8Array(size * size),
    next: new Uint8Array(size * size),
    size,
    generation: 0,
    globals: {
      aliveFraction: 0,
      stillLifeCount: 0,
      oscillatorCount: 0,
      complexity: 0,
      births: 0,
      deaths: 0,
    },
  };
}
