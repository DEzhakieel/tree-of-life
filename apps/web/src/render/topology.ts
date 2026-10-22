import * as THREE from 'three';
import { WORLD_SIZE, worldToComplex, type WorldConfig, type WorldTopology } from '@fractal-life/shared';

/**
 * Boundary-condition annotation for the world rectangle.
 *
 * The engine identifies world edges when an agent reaches them
 * (crates/simulation/src/physics.rs): x (longitude) wraps in every
 * topology, while y (latitude) wraps, reflects, or reflects with a
 * half-twist. This module draws that identification so the chosen
 * topology is visible instead of inferred — indigo = periodic wrap,
 * amber = specular reflect, fuchsia = twist.
 */

export type EdgeKind = 'wrap' | 'reflect' | 'twist';

export interface TopologyInfo {
  /** identification applied to the two vertical (x) edges */
  x: EdgeKind;
  /** identification applied to the two horizontal (y) edges */
  y: EdgeKind;
  label: string;
  desc: string;
}

export function topologyEdges(t: WorldTopology | null | undefined): TopologyInfo {
  switch (t) {
    case 'cylinder':
      return { x: 'wrap', y: 'reflect', label: 'cylinder', desc: 'longitude wraps · polar caps reflect' };
    case 'sphere':
      return { x: 'wrap', y: 'reflect', label: 'sphere', desc: 'longitude wraps · poles reflect' };
    case 'mobius':
      return { x: 'wrap', y: 'twist', label: 'möbius', desc: 'longitude wraps · caps reflect with a half-twist' };
    case 'kleinBottle':
      return { x: 'wrap', y: 'wrap', label: 'klein bottle', desc: 'longitude wraps · latitude loops flipped' };
    default:
      return { x: 'wrap', y: 'wrap', label: 'torus', desc: 'both axes wrap' };
  }
}

export const EDGE_COLOR: Record<EdgeKind, number> = {
  wrap: 0x5b7cfa,
  reflect: 0xf0a83c,
  twist: 0xd964e8,
};

export const EDGE_CSS: Record<EdgeKind, string> = {
  wrap: 'rgba(91,124,250,0.60)',
  reflect: 'rgba(240,168,60,0.80)',
  twist: 'rgba(217,100,232,0.80)',
};

/** Axis-aligned bounding rectangle of the world in complex coordinates. */
export interface WorldRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export function worldRect(params: Pick<WorldConfig['params'], 'centerX' | 'centerY' | 'worldScale'>): WorldRect {
  const a = worldToComplex(params, 0, 0);
  const b = worldToComplex(params, WORLD_SIZE, WORLD_SIZE);
  return {
    x0: Math.min(a.re, b.re),
    y0: Math.min(a.im, b.im),
    x1: Math.max(a.re, b.re),
    y1: Math.max(a.im, b.im),
  };
}

/** Effective topology of a world: substrate kernels are torus-only, so they
 *  report torus even if the WorldConfig carries a Phase-M topology. */
export function effectiveTopology(world: Pick<WorldConfig, 'topology' | 'substrate'> | null | undefined): WorldTopology | undefined {
  if (!world || world.substrate) return undefined;
  return world.topology;
}

function pushLine(pts: number[], ax: number, ay: number, bx: number, by: number): void {
  // LineSegments positions are 3-component vertices: two vertices per line
  pts.push(ax, ay, 0, bx, by, 0);
}

/** Shared glyph layout: base edge + identification marks along it. */
function edgeSegments(
  kind: EdgeKind,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  tick: number,
  flip: boolean,
): number[] {
  const pts: number[] = [];
  pushLine(pts, x0, y0, x1, y1);
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.hypot(dx, dy) || 1;
  // inward normal (into the rectangle); flip inverts it for the far edge
  let nx = dy / len;
  let ny = -dx / len;
  if (flip) { nx = -nx; ny = -ny; }
  for (const t of [0.25, 0.5, 0.75]) {
    const px = x0 + dx * t;
    const py = y0 + dy * t;
    if (kind === 'wrap') {
      // periodic identification: perpendicular ticks
      pushLine(pts, px - nx * tick * 0.5, py - ny * tick * 0.5, px + nx * tick, py + ny * tick);
    } else if (kind === 'reflect') {
      // specular identification: inward chevron
      const ax = px + nx * tick;
      const ay = py + ny * tick;
      pushLine(pts, ax, ay, px - dx / len * tick * 0.6, py - dy / len * tick * 0.6);
      pushLine(pts, ax, ay, px + dx / len * tick * 0.6, py + dy / len * tick * 0.6);
    } else {
      // half-twist: tick + a cross bar (the identification reverses orientation)
      pushLine(pts, px, py, px + nx * tick, py + ny * tick);
      pushLine(pts, px - tick * 0.15, py - tick * 0.15, px + tick * 0.15, py + tick * 0.15);
    }
  }
  return pts;
}

/** Four annotated edge segments for a world rectangle. */
export function topologySegments(rect: WorldRect, info: TopologyInfo): { kind: EdgeKind; pts: number[] }[] {
  const { x0, y0, x1, y1 } = rect;
  const tick = Math.min(x1 - x0, y1 - y0) * 0.03;
  return [
    { kind: info.x, pts: edgeSegments(info.x, x0, y0, x0, y1, tick, true) },
    { kind: info.x, pts: edgeSegments(info.x, x1, y0, x1, y1, tick, false) },
    { kind: info.y, pts: edgeSegments(info.y, x0, y0, x1, y0, tick, false) },
    { kind: info.y, pts: edgeSegments(info.y, x0, y1, x1, y1, tick, true) },
  ];
}

/**
 * WebGL overlay: rebuilt only when the world params or topology change.
 * Added to the scene as a childless group with depth-test off so the
 * boundary stays readable above terrain and glow sprites.
 */
export class TopologyOverlay {
  readonly group = new THREE.Group();
  private meshes: THREE.LineSegments[] = [];
  private key = '';
  private visible = true;

  constructor() {
    this.group.name = 'topology-overlay';
    this.group.renderOrder = 99;
    this.group.visible = false;
  }

  update(world: WorldConfig | null): void {
    const info = topologyEdges(effectiveTopology(world));
    const key = world
      ? `${world.params.centerX},${world.params.centerY},${world.params.worldScale},${info.x},${info.y}`
      : 'none';
    if (key === this.key) return;
    this.key = key;
    this.clear();
    if (!world) return;
    const rect = worldRect(world.params);
    for (const { kind, pts } of topologySegments(rect, info)) {
      if (pts.length === 0) continue;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
      const mat = new THREE.LineBasicMaterial({
        color: EDGE_COLOR[kind],
        transparent: true,
        opacity: 0.85,
        depthTest: false,
        depthWrite: false,
      });
      const mesh = new THREE.LineSegments(geo, mat);
      mesh.renderOrder = 99;
      this.meshes.push(mesh);
      this.group.add(mesh);
    }
    this.group.visible = this.visible;
  }

  setVisible(v: boolean): void {
    this.visible = v;
    this.group.visible = v && this.meshes.length > 0;
  }

  private clear(): void {
    for (const m of this.meshes) {
      this.group.remove(m);
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    }
    this.meshes = [];
  }

  dispose(): void {
    this.clear();
    this.key = '';
  }
}

/**
 * Canvas-2D mirror of the WebGL overlay, drawn in screen space.
 * `rect` is the screen-space bounding box of the world rectangle.
 */
export function drawTopology2D(
  ctx: CanvasRenderingContext2D,
  rect: { x: number; y: number; w: number; h: number },
  info: TopologyInfo,
): void {
  const edges: { kind: EdgeKind; ax: number; ay: number; bx: number; by: number; flip: boolean }[] = [
    { kind: info.x, ax: rect.x, ay: rect.y, bx: rect.x, by: rect.y + rect.h, flip: true },
    { kind: info.x, ax: rect.x + rect.w, ay: rect.y, bx: rect.x + rect.w, by: rect.y + rect.h, flip: false },
    { kind: info.y, ax: rect.x, ay: rect.y + rect.h, bx: rect.x + rect.w, by: rect.y + rect.h, flip: false },
    { kind: info.y, ax: rect.x, ay: rect.y, bx: rect.x + rect.w, by: rect.y, flip: true },
  ];
  const tick = Math.min(rect.w, rect.h) * 0.03;
  ctx.save();
  ctx.lineWidth = 1.5;
  ctx.setLineDash([]);
  for (const e of edges) {
    ctx.strokeStyle = EDGE_CSS[e.kind];
    const dx = e.bx - e.ax;
    const dy = e.by - e.ay;
    const len = Math.hypot(dx, dy) || 1;
    let nx = dy / len;
    let ny = -dx / len;
    if (e.flip) { nx = -nx; ny = -ny; }
    ctx.beginPath();
    ctx.moveTo(e.ax, e.ay);
    ctx.lineTo(e.bx, e.by);
    ctx.stroke();
    for (const t of [0.25, 0.5, 0.75]) {
      const px = e.ax + dx * t;
      const py = e.ay + dy * t;
      ctx.beginPath();
      if (e.kind === 'wrap') {
        ctx.moveTo(px - nx * tick * 0.5, py - ny * tick * 0.5);
        ctx.lineTo(px + nx * tick, py + ny * tick);
      } else if (e.kind === 'reflect') {
        const ix = px + nx * tick;
        const iy = py + ny * tick;
        ctx.moveTo(ix, iy);
        ctx.lineTo(px - (dx / len) * tick * 0.6, py - (dy / len) * tick * 0.6);
        ctx.moveTo(ix, iy);
        ctx.lineTo(px + (dx / len) * tick * 0.6, py + (dy / len) * tick * 0.6);
      } else {
        ctx.moveTo(px, py);
        ctx.lineTo(px + nx * tick, py + ny * tick);
        ctx.moveTo(px - tick * 0.15, py - tick * 0.15);
        ctx.lineTo(px + tick * 0.15, py + tick * 0.15);
      }
      ctx.stroke();
    }
  }
  ctx.restore();
}
