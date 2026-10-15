import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_PARAMS, fnv1a32 } from '@fractal-life/shared';
import { buildTerrainGrid, sampleGrid, type TerrainGrid } from '../src/terrain.js';
import { stepMovement, DRAG, CLIMB_COST, type MoveResult } from '../src/physics.js';

function makeGrid(): TerrainGrid {
  return buildTerrainGrid({ ...DEFAULT_PARAMS }, 'mandelbrot', fnv1a32('physics-test'));
}

function base(x: number, y: number, thrustX: number, thrustY: number): {
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
} {
  return {
    x,
    y,
    vx: 0,
    vy: 0,
    thrustX,
    thrustY,
    speed: 2,
    size: 1,
    ts: 1,
    waterFrac: 1,
    hazard: 0,
    grid: makeGrid(),
  };
}

describe('stepMovement', () => {
  it('is deterministic for identical inputs', () => {
    const a = stepMovement(base(500, 500, 0.5, -0.3));
    const b = stepMovement(base(500, 500, 0.5, -0.3));
    assert.equal(a.x, b.x);
    assert.equal(a.y, b.y);
    assert.equal(a.vx, b.vx);
    assert.equal(a.vy, b.vy);
    assert.equal(a.dh, b.dh);
    assert.equal(a.climbCost, b.climbCost);
  });

  it('applies drag to momentum: velocity decays, position keeps moving', () => {
    const grid = makeGrid();
    const opts = base(512, 512, 0, 0);
    const first = stepMovement({ ...opts, vx: 2, vy: 0 });
    assert.equal(first.vx, 2 * DRAG);
    assert.ok(first.x !== 512, 'position advanced from carried momentum');
    const second = stepMovement({ ...opts, vx: first.vx, vy: 0 });
    assert.ok(Math.abs(second.vx) < Math.abs(first.vx), 'drag keeps decaying velocity');
  });

  it('reaches steady-state velocity ~= thrust * speed on flat ground', () => {
    const grid = makeGrid();
    let vx = 0;
    let vy = 0;
    let x = 512;
    let y = 512;
    // push far from cliffs so slope modulation is negligible
    let flat = false;
    for (let i = 0; i < 500 && !flat; i++) {
      const sx = (i * 211) % 2048;
      const sy = (i * 349) % 2048;
      const s = sampleGrid(grid, sx, sy);
      const e = 4;
      const hx = sampleGrid(grid, sx + e, sy).height - s.height;
      const hy = sampleGrid(grid, sx, sy + e).height - s.height;
      if (Math.abs(hx) + Math.abs(hy) < 0.002) {
        x = sx;
        y = sy;
        flat = true;
      }
    }
    assert.ok(flat, 'found a flat sample point');
    for (let i = 0; i < 300; i++) {
      const r = stepMovement({ ...base(x, y, 1, 0), vx, vy });
      x = r.x;
      y = r.y;
      vx = r.vx;
      vy = r.vy;
    }
    assert.ok(Math.abs(vx - 2) < 0.3, `steady-state vx=${vx} should approach thrust*speed=2`);
  });

  it('climbing costs chemical energy; descending never credits any back', () => {
    const grid = makeGrid();
    let spot: { x: number; y: number; hx: number; hy: number } | undefined;
    for (let i = 0; i < 800 && !spot; i++) {
      const sx = (i * 211) % 2048;
      const sy = (i * 349) % 2048;
      const s = sampleGrid(grid, sx, sy);
      const e = 4;
      const hx = sampleGrid(grid, sx + e, sy).height - s.height;
      const hy = sampleGrid(grid, sx, sy + e).height - s.height;
      if (Math.abs(hx) + Math.abs(hy) > 0.02) spot = { x: sx, y: sy, hx, hy };
    }
    assert.ok(spot, 'found a sloped sample point');

    const run = (thrustX: number, thrustY: number) => {
      let a = { x: spot!.x, y: spot!.y, vx: 0, vy: 0 };
      let cost = 0;
      let distance = 0;
      for (let i = 0; i < 24; i++) {
        const s = sampleGrid(grid, a.x, a.y);
        const r = stepMovement({
          ...base(a.x, a.y, thrustX, thrustY),
          vx: a.vx,
          vy: a.vy,
          hazard: s.hazard,
        });
        a = { x: r.x, y: r.y, vx: r.vx, vy: r.vy };
        cost += r.climbCost;
        distance += r.distance;
      }
      return { cost, distance };
    };

    const up = run(spot.hx >= 0 ? 1 : -1, spot.hy >= 0 ? 1 : -1);
    assert.ok(up.cost > 0, `upslope run should spend climb energy (cost=${up.cost})`);
    assert.ok(up.distance > 0, 'upslope run still moves');

    const down = run(spot.hx < 0 ? 1 : -1, spot.hy < 0 ? 1 : -1);
    assert.equal(down.cost, 0, 'descending must never credit energy back');
    assert.ok(down.distance > 0, 'downslope run moves');

    // the climb tax is exactly dh * CLIMB_COST * size — unit-check on one step
    const r = stepMovement(base(spot.x, spot.y, spot.hx >= 0 ? 1 : -1, spot.hy >= 0 ? 1 : -1));
    if (r.dh > 0) assert.equal(r.climbCost, r.dh * CLIMB_COST * 1);
  });
});
