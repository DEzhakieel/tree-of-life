import * as THREE from 'three';
import type { WorldParams } from '@fractal-life/shared';
import type { SetMap, GroundLayer } from '../store/useStore.js';
import type { AgentBuffer } from '../net/agentBuffer.js';
import { GroundPainter, GROUND_SIZE } from './groundPainter.js';

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
 *
 * The colour maths lives in GroundPainter so the Canvas 2D fallback paints
 * the same ground; this class only owns the Three.js mesh and texture.
 */
export class EvolvedTerrain {
  group = new THREE.Group();
  private texture: THREE.DataTexture;
  private painter: GroundPainter;

  constructor(params: WorldParams) {
    this.painter = new GroundPainter(params);
    this.texture = new THREE.DataTexture(
      this.painter.data,
      GROUND_SIZE,
      GROUND_SIZE,
      THREE.RGBAFormat,
      THREE.UnsignedByteType,
    );
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
    this.painter.paint(map, agents, layer);
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
