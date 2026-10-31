import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_PARAMS, WORLD_SIZE, worldToComplex, type WorldParams } from '@fractal-life/shared';
import { AgentBuffer } from '../src/net/agentBuffer.js';
import { GroundPainter, GROUND_SIZE } from '../src/render/groundPainter.js';
import type { SetMap } from '../src/store/useStore.js';

function emptySetMap(size = 128): SetMap {
  return { tick: 0, size, depth: new Uint8Array(size * size), escape: new Uint8Array(size * size) };
}

function painted(data: Uint8Array): number {
  let n = 0;
  for (let i = 3; i < data.length; i += 4) if (data[i]! > 0) n++;
  return n;
}

function pixel(data: Uint8Array, x: number, y: number): [number, number, number, number] {
  const o = (y * GROUND_SIZE + x) * 4;
  return [data[o]!, data[o + 1]!, data[o + 2]!, data[o + 3]!];
}

function cellFor(params: WorldParams, wx: number, wy: number): { x: number; y: number } {
  const w = worldToComplex(params, wx, wy);
  const reMin = params.centerX - params.worldScale / 2;
  const imMin = params.centerY - params.worldScale / 2;
  const cell = params.worldScale / GROUND_SIZE;
  return { x: Math.floor((w.re - reMin) / cell), y: Math.floor((w.im - imMin) / cell) };
}

describe('ground painter', () => {
  it('paints the evolved set and lets escape scars win', () => {
    const painter = new GroundPainter(DEFAULT_PARAMS);
    const map = emptySetMap();
    map.depth.fill(128);

    painter.paint(map, new AgentBuffer(), 'set');
    assert.ok(painted(painter.data) > 1000, 'set window overlaps the world and paints');

    map.escape.fill(200);
    painter.paint(map, new AgentBuffer(), 'escape');
    let found: [number, number, number, number] | null = null;
    for (let y = 0; y < GROUND_SIZE && !found; y++) {
      for (let x = 0; x < GROUND_SIZE; x++) {
        const px = pixel(painter.data, x, y);
        if (px[3] === 255) {
          found = px;
          break;
        }
      }
    }
    assert.deepEqual(found, [255, 140, 30, 255]);
  });

  it('paints a spatial layer at the agent cell and clears stale ground', () => {
    const painter = new GroundPainter(DEFAULT_PARAMS);
    const map = emptySetMap();
    map.depth.fill(100);
    map.escape.fill(100);
    const agents = new AgentBuffer();
    agents.push(1, WORLD_SIZE / 2, WORLD_SIZE / 2, 0.8, 7, 0, 0.3);

    // Leave a full ground from a previous layer, then paint density.
    painter.paint(map, new AgentBuffer(), 'set');
    assert.ok(painted(painter.data) > 1000);
    painter.paint(map, agents, 'density');

    const cell = cellFor(DEFAULT_PARAMS, WORLD_SIZE / 2, WORLD_SIZE / 2);
    assert.deepEqual(cell, { x: 64, y: 64 });
    assert.equal(pixel(painter.data, cell.x, cell.y)[3], 255);
    assert.equal(pixel(painter.data, 0, 0)[3], 0, 'cells without agents are cleared');
  });

  it('covers every layer and is deterministic', () => {
    const map = emptySetMap();
    map.depth.fill(50);
    map.escape.fill(100);
    const agents = new AgentBuffer();
    agents.push(1, WORLD_SIZE / 2, WORLD_SIZE / 2, 0.8, 7, 0, 0.3);
    const a = new GroundPainter(DEFAULT_PARAMS);
    const b = new GroundPainter(DEFAULT_PARAMS);

    for (const layer of ['set', 'escape', 'density', 'energy', 'culture', 'gene'] as const) {
      a.paint(map, agents, layer);
      assert.ok(painted(a.data) > 0, `${layer} paints something`);
    }

    a.paint(map, agents, 'culture');
    b.paint(map, agents, 'culture');
    assert.deepEqual(a.data, b.data);
  });
});
