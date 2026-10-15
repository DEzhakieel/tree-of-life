import type { TerrainGrid } from './terrain.js';
import { sampleHeight } from './terrain.js';
import type { WorldPhysics, WorldTopology } from '@fractal-life/shared';

/**
 * Deterministic momentum + terrain physics.
 *
 * Brain outputs are a desired thrust (acceleration) in [-1,1]; velocity is
 * integrated with linear drag so motion carries momentum. Terrain slope
 * modulates thrust (climbs labour, descents get a gravity assist) and adds a
 * climb tax. Chemical energy is never created here: climbing spends chemical
 * energy (metered as heat by the engine) and descending never credits any back
 * — the potential paid on the way up is dissipated by friction, so the engine's
 * energy ledger stays conservative.
 *
 * When a `WorldPhysics` frame is present, the climb energy cost is derived from
 * real gravitational potential (Joules scaled to engine units) and velocities
 * are capped at the escape speed; otherwise the legacy constants apply.
 */

export const DRAG = 0.86;
/** per unit height gained: thrust is reduced by this much (labouring uphill) */
const SLOPE_TAX = 0.4;
/** per unit height dropped: thrust is boosted by this much (gravity assist) */
const SLOPE_BOOST = 0.5;
const SLOPE_CAP = 1.6;
/** chemical energy spent per unit height climbed, scaled by body size */
export const CLIMB_COST = 4;

export interface MoveResult {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** wrapped displacement this step (world units) */
  distance: number;
  /** height gained this step (>0 = climbing) */
  dh: number;
  /** chemical energy spent on the climb tax (size-scaled) */
  climbCost: number;
  /** Phase M observability: a y-cap crossing handled by the topology */
  edgeHit: boolean;
}

export function stepMovement(opts: {
  x: number;
  y: number;
  vx: number;
  vy: number;
  thrustX: number;
  thrustY: number;
  speed: number;
  size: number;
  ts: number;
  waterFrac: number;
  hazard: number;
  grid: TerrainGrid;
  worldPhysics?: WorldPhysics;
  /** Phase M world topology: boundary condition applied on movement. Absent =
   *  legacy torus (both axes wrap, bit-identical). */
  topology?: WorldTopology;
}): MoveResult {
  const { x, y, vx, vy, thrustX, thrustY, speed, size, ts, waterFrac, hazard, grid, worldPhysics, topology = 'torus' } = opts;
  const world = grid.size * grid.cell;
  const wrap = (v: number) => (v < 0 ? v + world : v >= world ? v - world : v);

  // Phase M edge identification: longitude always wraps; the latitude rule
  // depends on the topology (wrap / reflect / loop-with-flip). The case runs on
  // RAW coordinates FIRST (a cap crossing arrives with y < 0 or y >= world;
  // wrapping beforehand would erase it), then longitude/latitude are
  // re-normalized into [0, world). `hit` flags a y-cap crossing handled by the
  // topology (contrast: longitude wraps are a continuous seam on every
  // topology, so they never count).
  const boundary = (bx: number, by: number, bvx: number, bvy: number): { nx: number; ny: number; nvx: number; nvy: number; hit: boolean } => {
    let nx = bx;
    let ny = by;
    let nvx = bvx;
    let nvy = bvy;
    let hit = false;
    switch (topology) {
      case 'torus':
        break;
      case 'cylinder':
      case 'sphere':
        if (by < 0) {
          ny = -by;
          nvy = -bvy;
          hit = true;
        } else if (by >= world) {
          ny = 2 * world - by;
          nvy = -bvy;
          hit = true;
        }
        break;
      case 'mobius':
        if (by < 0 || by >= world) {
          ny = by < 0 ? -by : 2 * world - by;
          nvy = -bvy;
          nx = world - bx;
          hit = true;
        }
        break;
      case 'kleinBottle':
        if (by < 0 || by >= world) {
          nx = world - bx;
          hit = true;
        }
        break;
    }
    nx = wrap(nx);
    ny = wrap(ny);
    return { nx, ny, nvx, nvy, hit };
  };

  // atmospheric drag scales with the environment's momentum retention
  // (1.0 = legacy/vacuum → unchanged DRAG; denser air erodes momentum faster).
  // thrust scale is re-derived so steady-state velocity stays ≈ phenotype speed.
  const retention = worldPhysics?.conservationLaws.momentumRetention ?? 1;
  const drag = Math.pow(DRAG, 1 / Math.max(retention, 1e-2));
  const thrustScale = (1 - drag) / drag;

  // terrain resistance: rough ground + bulk slow an agent down
  const resist = (1 + hazard * 1.2) * (1 + (size - 1) * 0.4);
  const throttle = (waterFrac < 0.2 ? 0.6 : 1) / resist;

  // preview the next step (unmodulated thrust) to learn the terrain gradient
  const pvx = (vx + thrustX * speed * thrustScale * throttle) * drag;
  const pvy = (vy + thrustY * speed * thrustScale * throttle) * drag;
  const { nx: px, ny: py } = boundary(x + pvx * ts, y + pvy * ts, pvx, pvy);
  const hOld = sampleHeight(grid, x, y);
  const hNew = sampleHeight(grid, px, py);
  const dh = hNew - hOld;

  // slope modulates thrust: climbs labour, descents get a gravity assist
  let thrustMod = 1;
  if (dh > 0) thrustMod = Math.max(0.25, 1 - SLOPE_TAX * dh);
  else if (dh < 0) thrustMod = Math.min(SLOPE_CAP, 1 - SLOPE_BOOST * dh);

  const ax = thrustX * speed * thrustScale * thrustMod * throttle;
  const ay = thrustY * speed * thrustScale * thrustMod * throttle;
  let nvx = (vx + ax) * drag;
  let nvy = (vy + ay) * drag;

  // when a physics frame is present, cap velocity at the local escape speed
  // (derived in world-units per tick by the shared universe module)
  if (worldPhysics && worldPhysics.escapeVelocityWorldUnits < Infinity) {
    const maxV = worldPhysics.escapeVelocityWorldUnits;
    const vMag = Math.sqrt(nvx * nvx + nvy * nvy);
    if (vMag > maxV) {
      const scale = maxV / vMag;
      nvx *= scale;
      nvy *= scale;
    }
  }

  const points = boundary(x + nvx * ts, y + nvy * ts, nvx, nvy);
  const nx = points.nx;
  const ny = points.ny;
  nvx = points.nvx;
  nvy = points.nvy;
  const edgeHit = points.hit;

  let dx = nx - x;
  let dy = ny - y;
  // correct for wrap-around displacement only on the axes that loop:
  // longitude wraps everywhere; latitude loops only on torus / klein
  if (dx > world / 2) dx -= world;
  else if (dx < -world / 2) dx += world;
  if (topology === 'torus' || topology === 'kleinBottle') {
    if (dy > world / 2) dy -= world;
    else if (dy < -world / 2) dy += world;
  }
  const distance = Math.sqrt(dx * dx + dy * dy);

  // real gravitational climb cost when universe is present, legacy otherwise
  const climbCostPerUnit = worldPhysics?.climbCostScale ?? CLIMB_COST;

  return {
    x: nx,
    y: ny,
    vx: nvx,
    vy: nvy,
    distance,
    dh,
    climbCost: dh > 0 ? dh * climbCostPerUnit * size : 0,
    /** Phase M observability: a y-cap crossing handled by the topology. */
    edgeHit,
  };
}
