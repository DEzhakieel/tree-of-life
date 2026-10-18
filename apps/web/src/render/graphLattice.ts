import * as THREE from 'three';
import { worldToComplex, type WorldParams, type LineageNode } from '@fractal-life/shared';
import type { AgentBuffer } from '../net/agentBuffer.js';
import {
  buildEdges,
  buildLineageEdges,
  buildLattice,
  lineageParents,
  latticeCellSize,
  type Edge,
} from './representation.js';

const GOLDEN = 0.6180339887498949;

/**
 * Network view: one point per agent, edges between near neighbours and between
 * parent/child lineages. Rebuilds geometry each update — the edge set is
 * small and capped, so this stays cheap enough for an interactive view.
 */
export class GraphView {
  group = new THREE.Group();
  private points: THREE.Points;
  private lines: THREE.LineSegments;
  private maxAgents: number;
  private maxEdges = 4000;

  constructor(maxAgents: number, private proximityRadius: number) {
    this.maxAgents = maxAgents;

    const pGeo = new THREE.BufferGeometry();
    pGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(maxAgents * 3), 3));
    pGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(maxAgents * 3), 3));
    const pMat = new THREE.PointsMaterial({ size: 0.02, vertexColors: true, transparent: true, opacity: 0.95 });
    this.points = new THREE.Points(pGeo, pMat);
    this.points.frustumCulled = false;

    const lGeo = new THREE.BufferGeometry();
    lGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.maxEdges * 2 * 3), 3));
    lGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(this.maxEdges * 2 * 3), 3));
    const lMat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.35 });
    this.lines = new THREE.LineSegments(lGeo, lMat);
    this.lines.frustumCulled = false;

    this.group.add(this.lines);
    this.group.add(this.points);
  }

  update(
    params: WorldParams,
    agents: AgentBuffer,
    lineage: readonly LineageNode[] | null,
    showCulture: boolean,
  ): void {
    const n = Math.min(agents.count, this.maxAgents);
    const pPos = this.points.geometry.getAttribute('position') as THREE.BufferAttribute;
    const pCol = this.points.geometry.getAttribute('color') as THREE.BufferAttribute;
    const color = new THREE.Color();

    for (let i = 0; i < n; i++) {
      const w = worldToComplex(params, agents.x[i]!, agents.y[i]!);
      pPos.setXYZ(i, w.re, w.im, 0.05);
      const hue = showCulture ? agents.meme[i]! : (agents.species[i]! * GOLDEN) % 1;
      const energy = agents.energy[i]!;
      color.setHSL(hue % 1, 0.8, 0.25 + energy * energy * 0.55);
      pCol.setXYZ(i, color.r, color.g, color.b);
    }
    pPos.needsUpdate = true;
    pCol.needsUpdate = true;
    (this.points.geometry as THREE.BufferGeometry).setDrawRange(0, n);

    const prox = buildEdges(agents, this.proximityRadius, this.maxEdges);
    const lin = buildLineageEdges(agents, lineageParents(lineage));
    const all: Edge[] = lin.concat(prox);

    const lPos = this.lines.geometry.getAttribute('position') as THREE.BufferAttribute;
    const lCol = this.lines.geometry.getAttribute('color') as THREE.BufferAttribute;
    let e = 0;
    for (const edge of all) {
      if (e >= this.maxEdges) break;
      const wa = worldToComplex(params, agents.x[edge.a]!, agents.y[edge.a]!);
      const wb = worldToComplex(params, agents.x[edge.b]!, agents.y[edge.b]!);
      lPos.setXYZ(e * 2, wa.re, wa.im, 0.02);
      lPos.setXYZ(e * 2 + 1, wb.re, wb.im, 0.02);
      if (edge.kind === 'lineage') color.setRGB(0.55, 0.75, 1);
      else color.setRGB(0.35, 0.45, 0.55);
      lCol.setXYZ(e * 2, color.r, color.g, color.b);
      lCol.setXYZ(e * 2 + 1, color.r, color.g, color.b);
      e++;
    }
    lPos.needsUpdate = true;
    lCol.needsUpdate = true;
    (this.lines.geometry as THREE.BufferGeometry).setDrawRange(0, e * 2);
  }

  setVisible(v: boolean): void {
    this.group.visible = v;
  }

  dispose(): void {
    this.points.geometry.dispose();
    (this.points.material as THREE.Material).dispose();
    this.lines.geometry.dispose();
    (this.lines.material as THREE.Material).dispose();
  }
}

/**
 * Lattice view: a flat grid of cells tinted by population density, with the
 * agents themselves hidden. Reads as a heat map of where life actually is.
 */
export class LatticeView {
  group = new THREE.Group();
  private texture: THREE.DataTexture;
  private data: Uint8Array<ArrayBuffer>;
  private worldScale: number;
  private centerX: number;
  private centerY: number;

  constructor(worldScale: number, centerX: number, centerY: number, private worldSize: number) {
    this.worldScale = worldScale;
    this.centerX = centerX;
    this.centerY = centerY;
    // Fixed 48x48 so the texture size never changes and the camera maths stays
    // put; only the colourisation updates per frame.
    const N = 48;
    this.data = new Uint8Array(new ArrayBuffer(N * N * 4));
    this.texture = new THREE.DataTexture(this.data, N, N, THREE.RGBAFormat, THREE.UnsignedByteType);
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.flipY = false;
    this.texture.needsUpdate = true;
    const material = new THREE.MeshBasicMaterial({ map: this.texture, transparent: true, depthWrite: false });
    const geo = new THREE.PlaneGeometry(worldScale, worldScale);
    const mesh = new THREE.Mesh(geo, material);
    mesh.position.set(centerX, centerY, -0.5);
    this.group.add(mesh);
  }

  update(agents: AgentBuffer, showCulture: boolean): void {
    const cell = latticeCellSize(this.worldSize);
    const grid = buildLattice(agents, this.worldSize, cell);
    const N = grid.cols;
    let maxCount = 1;
    for (let i = 0; i < grid.count.length; i++) if (grid.count[i]! > maxCount) maxCount = grid.count[i]!;

    const px = this.data;
    px.fill(0);
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const idx = y * N + x;
        const c = grid.count[idx]!;
        if (c === 0) continue;
        const t = c / maxCount;
        const o = idx * 4;
        if (showCulture) {
          const hue = (grid.meme[idx]! / c) * 360;
          const rgb = hslToRgb(hue, 0.7, 0.2 + t * 0.55);
          px[o] = rgb[0]; px[o + 1] = rgb[1]; px[o + 2] = rgb[2];
        } else {
          // deep blue -> cyan -> white as density climbs
          px[o] = Math.round(20 + t * 200);
          px[o + 1] = Math.round(60 + t * 180);
          px[o + 2] = Math.round(120 + t * 135);
        }
        px[o + 3] = Math.round(60 + t * 195);
      }
    }
    this.texture.needsUpdate = true;
  }

  setVisible(v: boolean): void {
    this.group.visible = v;
  }

  dispose(): void {
    this.group.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.geometry.dispose();
        (obj.material as THREE.Material).dispose();
      }
    });
    this.texture.dispose();
  }
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = ((h % 360) + 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0, g = 0, b = 0;
  if (hp < 1) [r, g, b] = [c, x, 0];
  else if (hp < 2) [r, g, b] = [x, c, 0];
  else if (hp < 3) [r, g, b] = [0, c, x];
  else if (hp < 4) [r, g, b] = [0, x, c];
  else if (hp < 5) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const m = l - c / 2;
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}
