import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { WorldConfig } from '@fractal-life/shared';
import { DEFAULT_PARAMS, decodeServerFrame, type SetMapMessage } from '@fractal-life/shared';
import { Engine } from '../src/engine.js';
import { fractalGenes } from '../src/genome.js';

function makeWorld(seed: string, spawnCount = 120, overrides: Partial<typeof DEFAULT_PARAMS> = {}): WorldConfig {
  return {
    id: `fractal-${seed}`,
    seed,
    fractalType: 'mandelbrot',
    params: { ...DEFAULT_PARAMS, spawnCount, ...overrides },
    createdAt: 0,
    currentTick: 0,
  };
}

function decodeSet(bytes: Uint8Array): SetMapMessage {
  const frame = decodeServerFrame(bytes);
  assert.equal(frame.kind, 'set');
  return frame.msg;
}

describe('fractal-as-system', () => {
  it('maps every genome to a parameter c inside the fractal window', () => {
    for (let i = 0; i < 200; i++) {
      const g = new Float32Array(128).fill(0);
      g[0] = Math.random() * 2 - 1;
      g[1] = Math.random() * 2 - 1;
      const c = fractalGenes(g);
      assert.ok(c.cRe >= -2 && c.cRe <= 1, 'cRe in window');
      assert.ok(c.cIm >= -1.25 && c.cIm <= 1.25, 'cIm in window');
    }
  });

  it('escape deaths accumulate: exterior lineages diverge and go extinct', () => {
    const engine = new Engine(makeWorld('escape-run', 200));
    let totalEscaped = 0;
    for (let i = 0; i < 600; i++) {
      const r = engine.tick();
      totalEscaped += r.stats.escapeDeaths;
    }
    assert.ok(totalEscaped > 0, `expected some escape deaths, got ${totalEscaped}`);
  });

  it('the evolved set covers every alive lineage and shows escape scars', () => {
    const engine = new Engine(makeWorld('set-run', 200));
    let escaped = 0;
    for (let i = 0; i < 300; i++) escaped += engine.tick().stats.escapeDeaths;

    const map = decodeSet(engine.encodeSetMapMessage());
    assert.equal(map.size, 128);
    let liveCells = 0;
    for (const a of engine.agents.values()) {
      if (!a.alive) continue;
      const c = fractalGenes(a.genome);
      const ix = Math.min(127, Math.max(0, Math.floor(((c.cRe + 2) / 3) * map.size)));
      const iy = Math.min(127, Math.max(0, Math.floor(((c.cIm + 1.25) / 2.5) * map.size)));
      const depth = map.depth[iy * map.size + ix]!;
      assert.ok(depth > 0, `alive lineage at (${c.cRe},${c.cIm}) must light its cell`);
      liveCells++;
    }
    assert.ok(liveCells > 0);
    if (escaped > 0) {
      const scars = Array.from(map.escape).filter((v) => v > 0).length;
      assert.ok(scars > 0, `expected escape scars after ${escaped} escapes`);
    }
  });

  it('produces identical evolved sets for identical seeds', () => {
    const a = new Engine(makeWorld('set-det'));
    const b = new Engine(makeWorld('set-det'));
    for (let i = 0; i < 200; i++) {
      a.tick();
      b.tick();
    }
    assert.deepEqual(Array.from(decodeSet(a.encodeSetMapMessage()).depth), Array.from(decodeSet(b.encodeSetMapMessage()).depth));
  });
});
