import * as THREE from 'three';
import { worldToComplex, type WorldParams } from '@fractal-life/shared';
import type { AgentBuffer } from '../net/agentBuffer.js';

const GOLDEN = 0.6180339887498949;

/**
 * InstancedMesh population: one small octahedron per agent, positioned on the
 * complex plane, coloured by deterministic species hue and brightness by
 * energy. Additive-ish glow is provided by the bloom pass.
 */
export class AgentsMesh {
  mesh: THREE.InstancedMesh;
  private dummy = new THREE.Object3D();
  private color = new THREE.Color();
  private tmp = new THREE.Color();
  private maxCount: number;

  constructor(maxCount: number) {
    this.maxCount = maxCount;
    const geo = new THREE.OctahedronGeometry(1, 0);
    const mat = new THREE.MeshBasicMaterial({ vertexColors: false });
    const mesh = new THREE.InstancedMesh(geo, mat, maxCount);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(maxCount * 3), 3);
    mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    this.mesh = mesh;
    this.color = new THREE.Color();
  }

  update(params: WorldParams, agents: AgentBuffer, scale: number, culture: boolean): void {
    const count = Math.min(agents.count, this.maxCount);
    const { dummy, mesh, color, tmp } = this;
    mesh.count = count;
    for (let i = 0; i < count; i++) {
      const w = worldToComplex(params, agents.x[i]!, agents.y[i]!);
      const energy = agents.energy[i]!;
      const species = agents.species[i]!;
      // Quadratic ramp so starving agents shrink to near-nothing while a
      // well-fed agent stays clearly larger than the pack.
      const fed = energy * energy;
      const size = (0.28 + fed * 2.1) * scale;
      dummy.position.set(w.re, w.im, 0.03 + energy * 0.1);
      // Flatter when starved, taller when fed: a live agent reads as a mote of
      // light, a starving one as a dim speck.
      dummy.scale.set(size, size, size * (0.5 + energy * 0.9));
      dummy.rotation.set(0, 0, (species * 0.37) % (Math.PI * 2));
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      const hue = culture ? agents.meme[i]! : (species * GOLDEN) % 1;
      // Wide lightness spread so low-energy agents fall toward the background
      // instead of clustering at a mid grey.
      color.setHSL(hue % 1, culture ? 0.55 : 0.8, 0.12 + fed * 0.62);
      tmp.copy(color);
      mesh.setColorAt(i, tmp);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }

  setVisible(v: boolean): void {
    this.mesh.visible = v;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
