import { WORLD_SIZE, TERRAIN_GRID, TERRAIN_CELL } from '@fractal-life/shared';
import type { WorldParams, FractalType } from '@fractal-life/shared';
import { worldToComplex } from '@fractal-life/shared';

/**
 * Deterministic terrain. The JS grid below and the GLSL shaders in
 * packages/shaders use the SAME escape-time formulas, so rendered terrain and
 * simulated biology agree exactly.
 */

// Module-local aliases of exported constants: reading exported module
// bindings inside hot loops defeats V8 constant folding.
const CELL = TERRAIN_CELL;
const GRID = TERRAIN_GRID;

export interface FractalSample {
  /** smooth iteration count (logarithmic escape time) */
  nu: number;
  /** raw iteration count */
  it: number;
  /** phase of the final iterate (radians) — deterministic soil-chemistry axis */
  phase: number;
}

function escapeTime(re: number, im: number, p: WorldParams, fractalType: FractalType, perlinSeed: number): FractalSample {
  if (p.maxIter <= 0) return { nu: 0, it: 0, phase: 0 };
  if (fractalType === 'perlin') return perlinEscape(re, im, p, perlinSeed);
  const B = p.escapeRadius;
  const B2 = B * B;
  let zre = fractalType === 'julia' ? re : 0;
  let zim = fractalType === 'julia' ? im : 0;
  const cre = fractalType === 'julia' ? p.cReal : re;
  const cim = fractalType === 'julia' ? p.cImag : im;
  let it = 0;
  let zre2 = zre * zre;
  let zim2 = zim * zim;
  while (it < p.maxIter && zre2 + zim2 < B2) {
    const nextRe = zre2 - zim2 + cre;
    const nextIm = 2 * zre * zim + cim;
    zre = nextRe;
    zim = nextIm;
    zre2 = zre * zre;
    zim2 = zim * zim;
    it++;
  }
  const mag2 = zre2 + zim2;
  if (it >= p.maxIter || mag2 <= 1) {
    return { nu: p.maxIter, it, phase: Math.atan2(zim, zre) };
  }
  // smooth coloring: nu = it + 1 - log2( ln(|z|^2) / ln(B) )
  const nu = it + 1 - Math.log2(Math.log(mag2) / Math.log(B));
  return { nu: Math.max(0, Math.min(nu, p.maxIter)), it, phase: Math.atan2(zim, zre) };
}

// ---------------------------------------------------------------------------
// Perlin / simplex mode: value-noise fbm (deterministic from world seed)
// ---------------------------------------------------------------------------

/**
 * Integer hash used by the perlin mode. MUST match the GLSL `hash2i` in
 * packages/shaders (uint32 semantics, same constants).
 */
export function hash2i(x: number, y: number, seed: number): number {
  let h = ((seed | 0) ^ Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0x5bd1e995) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return h >>> 0;
}

function noise2(gx: number, gy: number, seed: number): number {
  const h = hash2i(gx, gy, seed);
  return (h & 0x7fffffff) * (2 / 2147483647) - 1;
}

const smooth = (t: number) => t * t * (3 - 2 * t);

function noiseAt(x: number, y: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = smooth(fx);
  const uy = smooth(fy);
  const a = noise2(ix, iy, seed);
  const b = noise2(ix + 1, iy, seed);
  const c = noise2(ix, iy + 1, seed);
  const d = noise2(ix + 1, iy + 1, seed);
  const ab = a + (b - a) * ux;
  const cd = c + (d - c) * ux;
  return ab + (cd - ab) * uy;
}

function fbm(x: number, y: number, seed: number): number {
  let amp = 1;
  let freq = 1;
  let sum = 0;
  let norm = 0;
  for (let o = 0; o < 4; o++) {
    sum += amp * noiseAt(x * freq, y * freq, seed);
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm; // [-1,1]
}

function perlinEscape(re: number, im: number, p: WorldParams, seed: number): FractalSample {
  const v = fbm(re * 1.5, im * 1.5, seed);
  const nu = (v * 0.5 + 0.5) * p.maxIter;
  return { nu, it: Math.round(nu), phase: v * Math.PI };
}

// ---------------------------------------------------------------------------
// Terrain grid
// ---------------------------------------------------------------------------

export interface TerrainGrid {
  size: number;
  cell: number;
  height: Float32Array<ArrayBuffer>;
  energy: Float32Array<ArrayBuffer>;
  moisture: Float32Array<ArrayBuffer>;
  hazard: Float32Array<ArrayBuffer>;
  /** static soil-chemistry axis in [0,1] (fractal phase) — modulates metabolism */
  chem: Float32Array<ArrayBuffer>;
  /** static mineral richness in [0,1] (escape-time gradient magnitude) */
  baseMinerals: Float32Array<ArrayBuffer>;
  /** current available soil nutrients (energy units, dynamic) */
  minerals: Float32Array<ArrayBuffer>;
  /** current plant food energy per cell */
  food: Float32Array<ArrayBuffer>;
  /** current meat (carrion + corpses) energy per cell */
  meat: Float32Array<ArrayBuffer>;
  /** pheromone field (agents deposit, engine diffuses/decays each tick) */
  signal: Float32Array<ArrayBuffer>;
  /** carrying capacity per cell */
  cap: Float32Array<ArrayBuffer>;
}

export function buildTerrainGrid(p: WorldParams, fractalType: FractalType, perlinSeed = 0): TerrainGrid {
  const ps = perlinSeed;
  const size = GRID;
  const cell = CELL;
  const n = size * size;
  const grid: TerrainGrid = {
    size,
    cell,
    height: new Float32Array(n),
    energy: new Float32Array(n),
    moisture: new Float32Array(n),
    hazard: new Float32Array(n),
    chem: new Float32Array(n),
    baseMinerals: new Float32Array(n),
    minerals: new Float32Array(n),
    food: new Float32Array(n),
    meat: new Float32Array(n),
    signal: new Float32Array(n),
    cap: new Float32Array(n),
  };
  const deltaComplex = p.worldScale / size; // complex offset per world cell

  for (let gy = 0; gy < size; gy++) {
    for (let gx = 0; gx < size; gx++) {
      const wx = (gx + 0.5) * cell;
      const wy = (gy + 0.5) * cell;
      const idx = gy * size + gx;
      const c = worldToComplex(p, wx, wy);
      const s0 = escapeTime(c.re, c.im, p, fractalType, ps);

      // moisture = |d(nu)/dx| via central difference
      const cp = worldToComplex(p, wx + cell, wy);
      const cm = worldToComplex(p, wx - cell, wy);
      const nuP = escapeTime(cp.re, cp.im, p, fractalType, ps).nu;
      const nuM = escapeTime(cm.re, cm.im, p, fractalType, ps).nu;
      const moisture = Math.min(1, Math.abs(nuP - nuM) * 3);

      // mineral richness = |grad(nu)| (analytic distortion ~ |z'|): veins of
      // nutrients concentrate along fractal boundary ridges.
      const cq = worldToComplex(p, wx, wy + cell);
      const cr = worldToComplex(p, wx, wy - cell);
      const nuQ = escapeTime(cq.re, cq.im, p, fractalType, ps).nu;
      const nuR = escapeTime(cr.re, cr.im, p, fractalType, ps).nu;
      const baseMinerals = Math.min(1, (Math.abs(nuP - nuM) + Math.abs(nuQ - nuR)) * 6);

      // hazard = spread of iteration counts around the cell
      const d1 = worldToComplex(p, wx + cell, wy + cell);
      const d2 = worldToComplex(p, wx - cell, wy + cell);
      const d3 = worldToComplex(p, wx + cell, wy - cell);
      const d4 = worldToComplex(p, wx - cell, wy - cell);
      const others = [
        escapeTime(d1.re, d1.im, p, fractalType, ps).it,
        escapeTime(d2.re, d2.im, p, fractalType, ps).it,
        escapeTime(d3.re, d3.im, p, fractalType, ps).it,
        escapeTime(d4.re, d4.im, p, fractalType, ps).it,
      ];
      let mean = 0;
      for (const o of others) mean += o;
      mean /= others.length;
      let vari = 0;
      for (const o of others) vari += (o - mean) * (o - mean);
      vari /= others.length;
      const hazard = Math.min(1, (Math.sqrt(vari) / p.maxIter) * 10);

      const height = s0.nu / p.maxIter;
      // stability ~ smooth phase: energy zones where nu is near-integer
      const energy = 0.5 + 0.5 * Math.cos(s0.nu * Math.PI * 2);
      const cellCap = energy * p.energyCapacity * 4;
      const chem = (s0.phase / Math.PI + 1) / 2; // fractal phase -> [0,1]

      grid.height[idx] = height;
      grid.energy[idx] = energy;
      grid.moisture[idx] = moisture;
      grid.hazard[idx] = hazard;
      grid.chem[idx] = chem;
      grid.baseMinerals[idx] = baseMinerals;
      grid.minerals[idx] = baseMinerals * cellCap * 0.3;
      grid.cap[idx] = cellCap;
      grid.food[idx] = cellCap * 0.35;
    }
  }
  return grid;
}

// ---------------------------------------------------------------------------
// Bilinear sampling
// ---------------------------------------------------------------------------

export interface GridSample {
  height: number;
  energy: number;
  moisture: number;
  hazard: number;
  food: number;
  meat: number;
  signal: number;
  cap: number;
  /** soil chemistry in [0,1] */
  chem: number;
  /** available soil nutrients (energy units) */
  minerals: number;
}

function bilinear(grid: Float32Array, size: number, wx: number, wy: number): number {
  const gx = wx / CELL;
  const gy = wy / CELL;
  const ix = Math.min(size - 1, Math.max(0, Math.floor(gx)));
  const iy = Math.min(size - 1, Math.max(0, Math.floor(gy)));
  const fx = Math.min(1, Math.max(0, gx - ix));
  const fy = Math.min(1, Math.max(0, gy - iy));
  const x1 = Math.min(size - 1, ix + 1);
  const y1 = Math.min(size - 1, iy + 1);
  const a = grid[iy * size + ix]!;
  const b = grid[iy * size + x1]!;
  const c = grid[y1 * size + ix]!;
  const d = grid[y1 * size + x1]!;
  return a + (b - a) * fx + (c - a) * fy + (d - b - c + a) * fx * fy;
}

export function sampleGrid(grid: TerrainGrid, wx: number, wy: number): GridSample {
  const s = grid.size;
  return {
    height: bilinear(grid.height, s, wx, wy),
    energy: bilinear(grid.energy, s, wx, wy),
    moisture: bilinear(grid.moisture, s, wx, wy),
    hazard: bilinear(grid.hazard, s, wx, wy),
    food: bilinear(grid.food, s, wx, wy),
    meat: bilinear(grid.meat, s, wx, wy),
    signal: bilinear(grid.signal, s, wx, wy),
    cap: bilinear(grid.cap, s, wx, wy),
    chem: bilinear(grid.chem, s, wx, wy),
    minerals: bilinear(grid.minerals, s, wx, wy),
  };
}

/** Allocation-free height sample for the physics hot loop. */
export function sampleHeight(grid: TerrainGrid, wx: number, wy: number): number {
  const size = grid.size;
  const gx = wx / CELL;
  const gy = wy / CELL;
  const ix = Math.min(size - 1, Math.max(0, Math.floor(gx)));
  const iy = Math.min(size - 1, Math.max(0, Math.floor(gy)));
  const fx = Math.min(1, Math.max(0, gx - ix));
  const fy = Math.min(1, Math.max(0, gy - iy));
  const x1 = Math.min(size - 1, ix + 1);
  const y1 = Math.min(size - 1, iy + 1);
  const a = grid.height[iy * size + ix]!;
  const b = grid.height[iy * size + x1]!;
  const c = grid.height[y1 * size + ix]!;
  const d = grid.height[y1 * size + x1]!;
  return a + (b - a) * fx + (c - a) * fy + (d - b - c + a) * fx * fy;
}

/** Allocation-free variant for the simulation hot loop. */
export function sampleGridInto(grid: TerrainGrid, wx: number, wy: number, out: GridSample): void {
  const size = grid.size;
  const gx = wx / CELL;
  const gy = wy / CELL;
  const ix = Math.min(size - 1, Math.max(0, Math.floor(gx)));
  const iy = Math.min(size - 1, Math.max(0, Math.floor(gy)));
  const fx = Math.min(1, Math.max(0, gx - ix));
  const fy = Math.min(1, Math.max(0, gy - iy));
  const x1 = Math.min(size - 1, ix + 1);
  const y1 = Math.min(size - 1, iy + 1);
  const i00 = iy * size + ix;
  const i10 = iy * size + x1;
  const i01 = y1 * size + ix;
  const i11 = y1 * size + x1;
  const w00 = (1 - fx) * (1 - fy);
  const w10 = fx * (1 - fy);
  const w01 = (1 - fx) * fy;
  const w11 = fx * fy;
  out.height = grid.height[i00]! * w00 + grid.height[i10]! * w10 + grid.height[i01]! * w01 + grid.height[i11]! * w11;
  out.energy = grid.energy[i00]! * w00 + grid.energy[i10]! * w10 + grid.energy[i01]! * w01 + grid.energy[i11]! * w11;
  out.moisture = grid.moisture[i00]! * w00 + grid.moisture[i10]! * w10 + grid.moisture[i01]! * w01 + grid.moisture[i11]! * w11;
  out.hazard = grid.hazard[i00]! * w00 + grid.hazard[i10]! * w10 + grid.hazard[i01]! * w01 + grid.hazard[i11]! * w11;
  out.food = grid.food[i00]! * w00 + grid.food[i10]! * w10 + grid.food[i01]! * w01 + grid.food[i11]! * w11;
  out.meat = grid.meat[i00]! * w00 + grid.meat[i10]! * w10 + grid.meat[i01]! * w01 + grid.meat[i11]! * w11;
  out.signal = grid.signal[i00]! * w00 + grid.signal[i10]! * w10 + grid.signal[i01]! * w01 + grid.signal[i11]! * w11;
  out.cap = grid.cap[i00]! * w00 + grid.cap[i10]! * w10 + grid.cap[i01]! * w01 + grid.cap[i11]! * w11;
  out.chem = grid.chem[i00]! * w00 + grid.chem[i10]! * w10 + grid.chem[i01]! * w01 + grid.chem[i11]! * w11;
  out.minerals = grid.minerals[i00]! * w00 + grid.minerals[i10]! * w10 + grid.minerals[i01]! * w01 + grid.minerals[i11]! * w11;
}

export { WORLD_SIZE };
