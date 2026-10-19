import * as THREE from 'three';
import { worldToComplex, type WorldParams } from '@fractal-life/shared';
import type { AgentBuffer } from '../net/agentBuffer.js';
import { GlowMotes } from './glowMotes.js';

const GOLDEN = 0.6180339887498949;

/**
 * Lenia-style population field: gaussian motes sized in world units (they
 * grow and shrink with zoom like everything else) and blended additively so
 * neighbouring agents fuse into continuous glowing masses rather than reading
 * as separate hard dots. The fractal view reuses the same path with shrunken,
 * sharper motes so the evolved-set terrain stays the subject.
 */
export class AgentsMesh {
  readonly mesh: THREE.Mesh;
  private g: GlowMotes;
  private color = new THREE.Color();

  constructor(maxCount: number) {
    this.g = new GlowMotes(maxCount, 1.5);
    this.mesh = this.g.mesh;
  }

  update(params: WorldParams, agents: AgentBuffer, culture: boolean, marker: boolean): void {
    const count = Math.min(agents.count, this.g.max);
    const off = this.g.attr('aOffset');
    const col = this.g.attr('aColor');
    const size = this.g.attr('aSize');
    const alpha = this.g.attr('aAlpha');
    const color = this.color;
    this.g.setSharpness(marker ? 3.2 : 1.5);
    for (let i = 0; i < count; i++) {
      const w = worldToComplex(params, agents.x[i]!, agents.y[i]!);
      const energy = agents.energy[i]!;
      const species = agents.species[i]!;
      // Quadratic ramp so starving agents shrink toward specks while a
      // well-fed one swells and overlaps its neighbours into the field.
      const fed = energy * energy;
      off.setXYZ(i, w.re, w.im, 0.05);
      // World-anchored diameter: roughly 1% (starved) to 6% (fed) of the
      // default full-world view, so a dense population fuses into a
      // continuous Lenia-like sheet instead of a starfield.
      size.setX(i, params.worldScale * (marker ? 0.005 + fed * 0.018 : 0.012 + fed * 0.05));
      const hue = culture ? agents.meme[i]! : (species * GOLDEN) % 1;
      color.setHSL(
        hue % 1,
        culture ? 0.6 : 0.85,
        marker ? 0.35 + fed * 0.25 : 0.42 + fed * 0.3,
      );
      col.setXYZ(i, color.r, color.g, color.b);
      alpha.setX(i, marker ? 0.9 : 0.55 + fed * 0.45);
    }
    this.g.commit(count);
  }

  setVisible(v: boolean): void {
    this.g.setVisible(v);
  }

  dispose(): void {
    this.g.dispose();
  }
}
