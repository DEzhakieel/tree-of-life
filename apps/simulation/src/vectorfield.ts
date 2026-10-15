/**
 * Vector field analysis — gradient, curl, and divergence of the simulation's
 * resource and velocity fields.
 *
 * Given a scalar field f(x,y) on the terrain grid, we compute:
 *   gradient:  ∇f = (∂f/∂x, ∂f/∂y)         — direction of steepest ascent
 *   laplacian: ∇²f = ∂²f/∂x² + ∂²f/∂y²     — diffusion / curvature
 *
 * Given a 2D vector field V = (Vx, Vy) defined at agent positions, we compute:
 *   divergence: div V = ∂Vx/∂x + ∂Vy/∂y     — source/sink strength
 *   curl:       curl V = ∂Vy/∂x - ∂Vx/∂y     — rotation / circulation
 *
 * These are discretised on the terrain grid using central finite differences
 * with toroidal boundary conditions (matching the world topology).
 *
 * The output fields are used as:
 *   - additional MLP sensors (agents can "sense" the flow structure)
 *   - observables for the emergence ladder (is the world self-organising?)
 *   - terrain modifiers (divergence = resource sources/sinks)
 */

import type { TerrainGrid } from './terrain.js';
import type { SimAgent } from './agent.js';

export interface VectorFieldResult {
  /** ∂f/∂x for the food field */
  foodGradX: Float32Array;
  /** ∂f/∂y for the food field */
  foodGradY: Float32Array;
  /** ∂f/∂x for the signal field */
  signalGradX: Float32Array;
  /** ∂f/∂y for the signal field */
  signalGradY: Float32Array;
  /** laplacian of food field (∇²food) */
  foodLaplacian: Float32Array;
  /** laplacian of signal field (∇²signal) */
  signalLaplacian: Float32Array;
  /** divergence of agent velocity field (accumulated per cell) */
  velocityDiv: Float32Array;
  /** curl of agent velocity field (accumulated per cell) */
  velocityCurl: Float32Array;
  /** total agent count per cell (for normalisation) */
  cellAgentCount: Int32Array;
  /** grid size (cells per axis) */
  size: number;
  /** global observables */
  globals: {
    /** mean gradient magnitude of food field */
    foodGradMagMean: number;
    /** max gradient magnitude of food field */
    foodGradMagMax: number;
    /** mean laplacian of food (positive = source-dominated) */
    foodLapMean: number;
    /** mean signal gradient magnitude */
    signalGradMagMean: number;
    /** global divergence (positive = net source, negative = net sink) */
    velocityDivMean: number;
    /** global curl (nonzero = net circulation) */
    velocityCurlMean: number;
    /** curl magnitude mean (rotation intensity) */
    velocityCurlMagMean: number;
  };
}

export function createVectorField(size: number): VectorFieldResult {
  const n = size * size;
  return {
    foodGradX: new Float32Array(n),
    foodGradY: new Float32Array(n),
    signalGradX: new Float32Array(n),
    signalGradY: new Float32Array(n),
    foodLaplacian: new Float32Array(n),
    signalLaplacian: new Float32Array(n),
    velocityDiv: new Float32Array(n),
    velocityCurl: new Float32Array(n),
    cellAgentCount: new Int32Array(n),
    size,
    globals: {
      foodGradMagMean: 0,
      foodGradMagMax: 0,
      foodLapMean: 0,
      signalGradMagMean: 0,
      velocityDivMean: 0,
      velocityCurlMean: 0,
      velocityCurlMagMean: 0,
    },
  };
}

/**
 * Compute gradient, laplacian, and agent velocity fields on the terrain grid.
 * Uses central finite differences with toroidal wrapping.
 */
export function computeVectorFields(
  vf: VectorFieldResult,
  grid: TerrainGrid,
  agents: Map<number, SimAgent>,
): void {
  const size = grid.size;
  const lastRow = (size - 1) * size;

  // --- Scalar field gradients (food, signal) via central differences ---
  let foodGradMagSum = 0;
  let foodGradMagMax = 0;
  let foodLapSum = 0;
  let signalGradMagSum = 0;

  for (let y = 0; y < size; y++) {
    const row = y * size;
    const up = y > 0 ? row - size : lastRow;
    const dn = y < size - 1 ? row + size : 0;

    for (let x = 0; x < size; x++) {
      const i = row + x;
      const l = x > 0 ? i - 1 : row + size - 1;
      const r = x < size - 1 ? i + 1 : row;

      // Food gradient
      const fgx = (grid.food[r]! - grid.food[l]!) * 0.5;
      const fgy = (grid.food[dn + x]! - grid.food[up + x]!) * 0.5;
      vf.foodGradX[i] = fgx;
      vf.foodGradY[i] = fgy;
      const fmag = Math.sqrt(fgx * fgx + fgy * fgy);
      foodGradMagSum += fmag;
      if (fmag > foodGradMagMax) foodGradMagMax = fmag;

      // Food laplacian: ∇²f = f(l) + f(r) + f(u) + f(d) - 4*f(c)
      const foodLap = grid.food[l]! + grid.food[r]! + grid.food[up + x]! + grid.food[dn + x]! - 4 * grid.food[i]!;
      vf.foodLaplacian[i] = foodLap;
      foodLapSum += foodLap;

      // Signal gradient
      const sgx = (grid.signal[r]! - grid.signal[l]!) * 0.5;
      const sgy = (grid.signal[dn + x]! - grid.signal[up + x]!) * 0.5;
      vf.signalGradX[i] = sgx;
      vf.signalGradY[i] = sgy;
      signalGradMagSum += Math.sqrt(sgx * sgx + sgy * sgy);

      // Signal laplacian
      vf.signalLaplacian[i] = grid.signal[l]! + grid.signal[r]! + grid.signal[up + x]! + grid.signal[dn + x]! - 4 * grid.signal[i]!;
    }
  }

  // --- Agent velocity field: accumulate vx, vy per cell, then compute div/curl ---
  vf.velocityDiv.fill(0);
  vf.velocityCurl.fill(0);
  vf.cellAgentCount.fill(0);

  for (const a of agents.values()) {
    if (!a.alive) continue;
    const cx = Math.floor(a.x / 16) % size; // TERRAIN_CELL = 16
    const cy = Math.floor(a.y / 16) % size;
    const ci = cy * size + cx;
    vf.velocityDiv[ci] += a.vx;
    vf.velocityCurl[ci] += a.vy;
    vf.cellAgentCount[ci]++;
  }

  // Normalise velocity field and compute div/curl via finite differences
  let divSum = 0;
  let curlSum = 0;
  let curlMagSum = 0;
  let agentCells = 0;

  // Build normalised velocity arrays
  const vxField = new Float32Array(size * size);
  const vyField = new Float32Array(size * size);
  for (let i = 0; i < size * size; i++) {
    const n = vf.cellAgentCount[i]!;
    if (n > 0) {
      vxField[i] = vf.velocityDiv[i] / n;  // reuse buffer: now holds mean vx
      vyField[i] = vf.velocityCurl[i] / n; // reuse buffer: now holds mean vy
      agentCells++;
    }
  }

  // Compute div and curl on cells with agents
  for (let y = 0; y < size; y++) {
    const row = y * size;
    const up = y > 0 ? row - size : lastRow;
    const dn = y < size - 1 ? row + size : 0;
    for (let x = 0; x < size; x++) {
      const i = row + x;
      const l = x > 0 ? i - 1 : row + size - 1;
      const r = x < size - 1 ? i + 1 : row;

      // ∂Vx/∂x and ∂Vy/∂y
      const dvxdx = (vxField[r]! - vxField[l]!) * 0.5;
      const dvydy = (vyField[dn + x]! - vyField[up + x]!) * 0.5;
      vf.velocityDiv[i] = dvxdx + dvydy;
      divSum += dvxdx + dvydy;

      // curl = ∂Vy/∂x - ∂Vx/∂y
      const dvydx = (vyField[r]! - vyField[l]!) * 0.5;
      const dvxdy = (vxField[dn + x]! - vxField[up + x]!) * 0.5;
      const curl = dvydx - dvxdy;
      vf.velocityCurl[i] = curl;
      curlSum += curl;
      curlMagSum += Math.abs(curl);
    }
  }

  const n = size * size;
  vf.globals = {
    foodGradMagMean: foodGradMagSum / n,
    foodGradMagMax,
    foodLapMean: foodLapSum / n,
    signalGradMagMean: signalGradMagSum / n,
    velocityDivMean: agentCells > 0 ? divSum / agentCells : 0,
    velocityCurlMean: agentCells > 0 ? curlSum / agentCells : 0,
    velocityCurlMagMean: agentCells > 0 ? curlMagSum / agentCells : 0,
  };
}
