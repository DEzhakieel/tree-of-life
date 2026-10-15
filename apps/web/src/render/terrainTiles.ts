import * as THREE from 'three';
import { TERRAIN_VERT, TERRAIN_FRAG, computeReferenceOrbit } from '@fractal-life/shaders';
import { fnv1a32, type WorldParams, type FractalType } from '@fractal-life/shared';

export interface TerrainConfig {
  params: WorldParams;
  fractalType: FractalType;
  seed: string;
}

const TILES_PER_SIDE = 8;

/**
 * LOD tile cache for the fractal terrain. Tiles are PlaneGeometry quads
 * rendered with the shared GLSL terrain shader (which computes the fractal in
 * the fragment stage from world/complex coordinates). Tiles are rebuilt when
 * the zoom tier changes (view span) or the world config changes. Deep zoom
 * switches the shader to perturbation-theory rendering with a CPU-computed
 * reference orbit.
 */
export class TerrainTiles {
  group = new THREE.Group();
  private material: THREE.RawShaderMaterial;
  private tiles: THREE.Mesh[] = [];
  private config: TerrainConfig;
  private segs = 32;
  private referenceTex: THREE.DataTexture | null = null;

  constructor(config: TerrainConfig) {
    this.config = config;
    const p = config.params;
    this.material = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: TERRAIN_VERT,
      fragmentShader: TERRAIN_FRAG,
      uniforms: {
        uCenterX: { value: p.centerX },
        uCenterY: { value: p.centerY },
        uScale: { value: p.worldScale },
        uMaxIter: { value: p.maxIter },
        uEscapeRadius: { value: p.escapeRadius },
        uFractalType: { value: fractalId(config.fractalType) },
        uCReal: { value: p.cReal },
        uCImag: { value: p.cImag },
        uPerlinSeed: { value: fnv1a32(config.seed) | 0 },
        uLayerMode: { value: 0 },
        uLayerMix: { value: 0.6 },
        uPerturb: { value: 0 },
        uReference: { value: null },
        uRefCount: { value: 1 },
        uRefEsc: { value: p.escapeRadius * p.escapeRadius },
      },
      side: THREE.DoubleSide,
    });
    this.build();
  }

  dispose(): void {
    for (const t of this.tiles) {
      t.geometry.dispose();
      this.group.remove(t);
    }
    this.tiles = [];
    this.material.dispose();
    this.referenceTex?.dispose();
    this.referenceTex = null;
  }

  setConfig(config: TerrainConfig): void {
    this.config = config;
    const p = config.params;
    const u = this.material.uniforms;
    u.uCenterX.value = p.centerX;
    u.uCenterY.value = p.centerY;
    u.uScale.value = p.worldScale;
    u.uMaxIter.value = p.maxIter;
    u.uEscapeRadius.value = p.escapeRadius;
    u.uFractalType.value = fractalId(config.fractalType);
    u.uCReal.value = p.cReal;
    u.uCImag.value = p.cImag;
    u.uPerlinSeed.value = fnv1a32(config.seed) | 0;
    u.uRefEsc.value = p.escapeRadius * p.escapeRadius;
    this.build();
  }

  setLayer(mode: number, mix: number): void {
    this.material.uniforms.uLayerMode.value = mode;
    this.material.uniforms.uLayerMix.value = mix;
  }

  /** Drive LOD + perturbation switching from the current camera view span. */
  updateView(camRe: number, camIm: number, viewSpan: number): void {
    const zoom = this.config.params.worldScale / Math.max(viewSpan, 1e-9);
    let segs = 28;
    if (zoom > 200) segs = 48;
    if (zoom > 5000) segs = 72;
    if (zoom > 200000) segs = 96;
    if (zoom > 2e6) segs = 128;
    if (segs !== this.segs) {
      this.segs = segs;
      this.build();
    }
    const usePerturb = zoom > 4e6;
    const u = this.material.uniforms;
    if (usePerturb !== (u.uPerturb.value === 1)) {
      u.uPerturb.value = usePerturb ? 1 : 0;
      if (usePerturb) this.updateReference(camRe, camIm);
    }
    if (usePerturb) this.updateReference(camRe, camIm);
  }

  /** Recompute the double-precision reference orbit for perturbation mode. */
  updateReference(camRe: number, camIm: number): void {
    const p = this.config.params;
    const { data, count } = computeReferenceOrbit({
      centerX: camRe,
      centerY: camIm,
      cReal: p.cReal,
      cImag: p.cImag,
      maxIter: p.maxIter,
      escapeRadius: p.escapeRadius,
      fractalType: this.config.fractalType,
    });
    if (this.referenceTex) this.referenceTex.dispose();
    this.referenceTex = new THREE.DataTexture(data.buffer as ArrayBuffer, p.maxIter, 1, THREE.RGBAFormat, THREE.FloatType);
    this.referenceTex.minFilter = THREE.NearestFilter;
    this.referenceTex.magFilter = THREE.NearestFilter;
    this.referenceTex.wrapS = THREE.ClampToEdgeWrapping;
    this.referenceTex.wrapT = THREE.ClampToEdgeWrapping;
    this.referenceTex.needsUpdate = true;
    this.material.uniforms.uReference.value = this.referenceTex;
    this.material.uniforms.uRefCount.value = Math.max(1, count);
  }

  private build(): void {
    for (const t of this.tiles) {
      t.geometry.dispose();
      this.group.remove(t);
    }
    this.tiles = [];
    const p = this.config.params;
    const w = p.worldScale;
    const half = w / 2;
    const tile = w / TILES_PER_SIDE;
    const geo = new THREE.PlaneGeometry(tile, tile, this.segs, this.segs);
    for (let tx = 0; tx < TILES_PER_SIDE; tx++) {
      for (let ty = 0; ty < TILES_PER_SIDE; ty++) {
        const cx = p.centerX - half + tile * (tx + 0.5);
        const cy = p.centerY - half + tile * (ty + 0.5);
        const mesh = new THREE.Mesh(geo, this.material);
        mesh.position.set(cx, cy, 0);
        mesh.matrixAutoUpdate = true;
        this.group.add(mesh);
        this.tiles.push(mesh);
      }
    }
  }
}

function fractalId(t: FractalType): number {
  return t === 'julia' ? 1 : t === 'perlin' ? 2 : 0;
}
