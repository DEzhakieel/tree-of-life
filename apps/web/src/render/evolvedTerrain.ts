import * as THREE from 'three';
import { worldToComplex, type WorldParams } from '@fractal-life/shared';
import type { SetMap, GroundLayer } from '../store/useStore.js';
import type { AgentBuffer } from '../net/agentBuffer.js';

const SIZE = 128;
/** parameter-plane window: cRe in [-2, 1], cIm in [-1.25, 1.25] */
const CRE_MIN = -2;
const CRE_RANGE = 3;
const CIM_MIN = -1.25;
const CIM_RANGE = 2.5;

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = h / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0;
  let g = 0;
  let b = 0;
  if (hp < 1) [r, g, b] = [c, x, 0];
  else if (hp < 2) [r, g, b] = [x, c, 0];
  else if (hp < 3) [r, g, b] = [0, c, x];
  else if (hp < 4) [r, g, b] = [0, x, c];
  else if (hp < 5) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const m = l - c / 2;
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}

/**
 * The ground of the world. One plane spanning the whole world window whose
 * 128x128 texture is repainted from live population data. Every layer is the
 * system itself — nothing is painted by analytic math:
 *
 *   'set'      the evolved set: violet = lineage persistence in that parameter
 *              niche, red scars = lineages that diverged and escaped. Starts
 *              dark and materialises only where life is actually bounded.
 *   'escape'   escape scars only.
 *   'density'  where the population clusters, spatially.
 *   'energy'   where energy is stored (green = rich, amber = depleted).
 *   'culture'  which memes dominate where (hue = culture tag).
 *   'gene'     which species genomes dominate where (hue = species).
 */
export class EvolvedTerrain {
  group = new THREE.Group();
  private texture: THREE.DataTexture;
  private data: Uint8Array<ArrayBuffer>;
  private params: WorldParams;
  /** complex-space origin of the world window (reMin, imMin) and cell size. */
  private reMin: number;
  private imMin: number;
  private cell: number;
  private acc = new Float32Array(SIZE * SIZE * 3);
  private spKey = new Int32Array(SIZE * SIZE * 8);
  private spCnt = new Int32Array(SIZE * SIZE * 8);
  private spLen = new Int32Array(SIZE * SIZE);

  constructor(params: WorldParams) {
    this.params = params;
    this.reMin = params.centerX - params.worldScale / 2;
    this.imMin = params.centerY - params.worldScale / 2;
    this.cell = params.worldScale / SIZE;
    this.data = new Uint8Array(new ArrayBuffer(SIZE * SIZE * 4));
    this.texture = new THREE.DataTexture(this.data, SIZE, SIZE, THREE.RGBAFormat, THREE.UnsignedByteType);
    this.texture.minFilter = THREE.NearestFilter;
    this.texture.magFilter = THREE.NearestFilter;
    this.texture.flipY = false;
    this.texture.needsUpdate = true;
    const material = new THREE.MeshBasicMaterial({
      map: this.texture,
      transparent: true,
      depthWrite: false,
    });
    const geo = new THREE.PlaneGeometry(params.worldScale, params.worldScale);
    const mesh = new THREE.Mesh(geo, material);
    mesh.position.set(params.centerX, params.centerY, -1);
    this.group.add(mesh);
  }

  /** Repaint the ground for the given layer from fresh data. */
  update(map: SetMap | null, agents: AgentBuffer, layer: GroundLayer): void {
    const px = this.data;
    px.fill(0);
    if (layer === 'set' || layer === 'escape') {
      if (map) this.drawSet(map, layer, px);
    } else {
      this.drawSpatial(agents, layer, px);
    }
    this.texture.needsUpdate = true;
  }

  /** Write set cells that fall inside the parameter-plane rect. */
  private drawSet(map: SetMap, layer: GroundLayer, px: Uint8Array): void {
    const n = Math.min(SIZE, map.size);
    const escapeOnly = layer === 'escape';
    for (let y = 0; y < SIZE; y++) {
      const im = this.imMin + (y + 0.5) * this.cell;
      if (im < CIM_MIN || im >= CIM_MIN + CIM_RANGE) continue;
      const my = Math.min(n - 1, Math.max(0, Math.floor(((im - CIM_MIN) / CIM_RANGE) * n)));
      for (let x = 0; x < SIZE; x++) {
        const re = this.reMin + (x + 0.5) * this.cell;
        if (re < CRE_MIN || re >= CRE_MIN + CRE_RANGE) continue;
        const mx = Math.min(n - 1, Math.max(0, Math.floor(((re - CRE_MIN) / CRE_RANGE) * n)));
        const i = my * n + mx;
        const o = (y * SIZE + x) * 4;
        const esc = map.escape[i] ?? 0;
        const depth = map.depth[i] ?? 0;
        if (esc > 0) {
          px[o] = 255;
          px[o + 1] = Math.min(255, 40 + esc * 0.5);
          px[o + 2] = 30;
          px[o + 3] = 255;
        } else if (!escapeOnly && depth > 0) {
          const t = depth / 255;
          const [r, g, b] = hslToRgb(275 - t * 55, 0.75 + t * 0.2, 0.16 + t * 0.55);
          px[o] = r;
          px[o + 1] = g;
          px[o + 2] = b;
          px[o + 3] = 255;
        }
      }
    }
  }

  /** Accumulate population stats per cell, then colourise. */
  private drawSpatial(agents: AgentBuffer, layer: GroundLayer, px: Uint8Array): void {
    const acc = this.acc;
    acc.fill(0);
    this.spLen.fill(0);
    const { reMin, imMin, cell, params } = this;
    const wantGene = layer === 'gene';
    for (let i = 0; i < agents.count; i++) {
      const w = worldToComplex(params, agents.x[i]!, agents.y[i]!);
      const x = Math.floor((w.re - reMin) / cell);
      const y = Math.floor((w.im - imMin) / cell);
      if (x < 0 || x >= SIZE || y < 0 || y >= SIZE) continue;
      const cellIdx = y * SIZE + x;
      const idx = cellIdx * 3;
      acc[idx] += 1;
      acc[idx + 1] += agents.energy[i]!;
      acc[idx + 2] += agents.meme[i]!;
      if (wantGene) {
        // plurality tally of species within this cell (up to 8 slots)
        const sp = agents.species[i]!;
        const base = cellIdx * 8;
        const len = this.spLen[cellIdx];
        let found = -1;
        for (let k = 0; k < len; k++) {
          if (this.spKey[base + k] === sp) {
            found = k;
            break;
          }
        }
        if (found >= 0) this.spCnt[base + found]++;
        else if (len < 8) {
          this.spKey[base + len] = sp;
          this.spCnt[base + len] = 1;
          this.spLen[cellIdx] = len + 1;
        }
      }
    }

    let maxCount = 1;
    let maxEnergy = 1;
    for (let i = 0; i < SIZE * SIZE; i++) {
      const c = acc[i * 3];
      if (c === 0) continue;
      if (c > maxCount) maxCount = c;
      const avg = acc[i * 3 + 1] / c;
      if (avg > maxEnergy) maxEnergy = avg;
    }

    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        const cellIdx = y * SIZE + x;
        const idx = cellIdx * 3;
        const c = acc[idx];
        if (c === 0) continue;
        const o = (y * SIZE + x) * 4;
        const countT = c / maxCount;
        let r: number;
        let g: number;
        let b: number;
        if (layer === 'energy') {
          const t = acc[idx + 1] / c / maxEnergy;
          [r, g, b] = hslToRgb(105 - t * 65, 0.85, 0.1 + t * 0.7);
        } else if (layer === 'culture') {
          const avgMeme = acc[idx + 2] / c;
          [r, g, b] = hslToRgb(avgMeme * 360, 0.7, 0.28 + countT * 0.5);
        } else if (layer === 'gene') {
          // dominant species in this cell
          const base = cellIdx * 8;
          const len = this.spLen[cellIdx];
          let best = 0;
          let bestVotes = -1;
          for (let k = 0; k < len; k++) {
            if (this.spCnt[base + k] > bestVotes) {
              bestVotes = this.spCnt[base + k];
              best = this.spKey[base + k];
            }
          }
          const hue = ((best * 0.6180339887498949) % 1) * 360;
          [r, g, b] = hslToRgb(hue, 0.8, 0.28 + countT * 0.5);
        } else {
          [r, g, b] = hslToRgb(215 - countT * 35, 0.85, 0.1 + countT * 0.75);
        }
        px[o] = r;
        px[o + 1] = g;
        px[o + 2] = b;
        px[o + 3] = 255;
      }
    }
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
