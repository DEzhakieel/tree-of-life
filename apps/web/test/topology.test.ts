import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type * as THREE from 'three';
import { TOPOLOGY_DEFS, WORLD_SIZE, worldToComplex, type WorldConfig, type WorldTopology } from '@fractal-life/shared';
import {
  EDGE_COLOR,
  EDGE_CSS,
  TopologyOverlay,
  drawTopology2D,
  effectiveTopology,
  topologyEdges,
  topologySegments,
  worldRect,
  type EdgeKind,
} from '../src/render/topology.js';

const params = { centerX: -0.4, centerY: 0.2, worldScale: 1.6 };

function world(topology: WorldTopology = 'torus', substrate?: WorldConfig['substrate']): WorldConfig {
  return { topology, substrate, params, id: 'test' } as unknown as WorldConfig;
}

describe('topology annotation', () => {
  it('mirrors the engine boundary rules for every topology', () => {
    const expected: Record<WorldTopology, { x: EdgeKind; y: EdgeKind; wrapsY: boolean }> = {
      torus: { x: 'wrap', y: 'wrap', wrapsY: true },
      cylinder: { x: 'wrap', y: 'reflect', wrapsY: false },
      sphere: { x: 'wrap', y: 'reflect', wrapsY: false },
      mobius: { x: 'wrap', y: 'twist', wrapsY: false },
      kleinBottle: { x: 'wrap', y: 'twistWrap', wrapsY: true },
    };
    assert.deepEqual(Object.keys(expected).sort(), (Object.keys(TOPOLOGY_DEFS) as WorldTopology[]).sort());
    for (const t of Object.keys(expected) as WorldTopology[]) {
      const want = expected[t];
      const info = topologyEdges(t);
      assert.equal(info.x, want.x, `${t} x edge`);
      assert.equal(info.y, want.y, `${t} y edge`);
      assert.equal(info.desc, TOPOLOGY_DEFS[t].desc, `${t} desc matches shared defs`);
      assert.equal(TOPOLOGY_DEFS[t].wrapsY, want.wrapsY, `${t} wrapsY matches glyph kind`);
      assert.ok(info.label.length > 0);
    }
  });

  it('defaults to the torus when no topology is set', () => {
    for (const t of [undefined, null]) {
      const info = topologyEdges(t);
      assert.equal(info.x, 'wrap');
      assert.equal(info.y, 'wrap');
    }
  });

  it('phase topologies do not apply to substrate worlds', () => {
    assert.equal(effectiveTopology(world('cylinder')), 'cylinder');
    assert.equal(effectiveTopology(world('cylinder', { kind: 'lattice' })), undefined);
    assert.equal(effectiveTopology(null), undefined);
    assert.equal(effectiveTopology(undefined), undefined);
  });

  it('world rect spans the configured window in complex coordinates', () => {
    const r = worldRect(params);
    const a = worldToComplex(params, 0, 0);
    const b = worldToComplex(params, WORLD_SIZE, WORLD_SIZE);
    assert.equal(r.x0, Math.min(a.re, b.re));
    assert.equal(r.y0, Math.min(a.im, b.im));
    assert.equal(r.x1, Math.max(a.re, b.re));
    assert.equal(r.y1, Math.max(a.im, b.im));
    assert.ok(r.x1 > r.x0 && r.y1 > r.y0);
  });

  it('draws four finite, correctly classified edge glyphs', () => {
    for (const t of Object.keys(TOPOLOGY_DEFS) as WorldTopology[]) {
      const info = topologyEdges(t);
      const segs = topologySegments(worldRect(params), info);
      assert.equal(segs.length, 4);
      assert.deepEqual(
        segs.map((s) => s.kind),
        [info.x, info.x, info.y, info.y],
        `${t} edge order`,
      );
      for (const s of segs) {
        assert.equal(s.pts.length % 6, 0, `${t} positions are 3-component vertices`);
        assert.ok(s.pts.length >= 18, `${t} edge has a base line + three marks`);
        for (const v of s.pts) assert.ok(Number.isFinite(v), `${t} finite vertex`);
      }
      for (const kind of [info.x, info.y]) {
        assert.equal(typeof EDGE_COLOR[kind], 'number');
        assert.match(EDGE_CSS[kind], /^rgba\(/);
      }
    }
  });

  it('webgl overlay rebuilds on world change and emits finite vertices', () => {
    const overlay = new TopologyOverlay();
    overlay.update(null);
    assert.equal(overlay.group.visible, false);
    assert.equal(overlay.group.children.length, 0);

    overlay.update(world('mobius'));
    assert.equal(overlay.group.children.length, 4);
    assert.equal(overlay.group.visible, true);
    for (const child of overlay.group.children) {
      const mesh = child as THREE.LineSegments;
      assert.equal(mesh.isLineSegments, true);
      const pos = mesh.geometry.getAttribute('position');
      for (let i = 0; i < pos.count; i++) {
        assert.ok(Number.isFinite(pos.getX(i)));
        assert.ok(Number.isFinite(pos.getY(i)));
        assert.ok(Number.isFinite(pos.getZ(i)));
      }
    }

    overlay.setVisible(false);
    assert.equal(overlay.group.visible, false);
    overlay.setVisible(true);
    assert.equal(overlay.group.visible, true);

    overlay.update(world('kleinBottle'));
    assert.equal(overlay.group.children.length, 4);
    overlay.dispose();
    assert.equal(overlay.group.children.length, 0);
  });

  it('2d overlay strokes every edge without touching undefined state', () => {
    const calls: string[] = [];
    const ctx = new Proxy(
      {},
      {
        get: (_target, key) =>
          typeof key === 'string'
            ? (...args: unknown[]) => {
                calls.push(args.length > 0 ? `${key}:${String(args[0])}` : key);
              }
            : undefined,
        set: () => true,
      },
    ) as unknown as CanvasRenderingContext2D;
    for (const t of Object.keys(TOPOLOGY_DEFS) as WorldTopology[]) {
      calls.length = 0;
      drawTopology2D(ctx, { x: 0, y: 0, w: 100, h: 60 }, topologyEdges(t));
      assert.ok(calls.includes('save'));
      assert.ok(calls.includes('restore'));
      assert.ok(calls.filter((c) => c === 'stroke').length >= 8, `${t} strokes base + marks`);
      assert.ok(calls.some((c) => c.startsWith('moveTo:')));
    }
  });
});
