import { MAX_AGENTS } from '@fractal-life/shared';

/**
 * Double-buffered typed-array agent state consumed by the renderer.
 * Filled by the frame decoder; read (write-once per frame) by the Three.js
 * instance meshes. All values are in *world* units; the renderer converts to
 * complex coordinates via worldToComplex.
 */
export class AgentBuffer {
  id = new Uint32Array(MAX_AGENTS);
  x = new Float32Array(MAX_AGENTS);
  y = new Float32Array(MAX_AGENTS);
  energy = new Float32Array(MAX_AGENTS);
  species = new Uint32Array(MAX_AGENTS);
  state = new Uint8Array(MAX_AGENTS);
  meme = new Float32Array(MAX_AGENTS);
  count = 0;

  reset(limit = MAX_AGENTS): void {
    this.count = 0;
    if (limit !== MAX_AGENTS) {
      // shrink-on-demand to bound memory for small worlds
      if (this.x.length !== limit) {
        this.id = new Uint32Array(limit);
        this.x = new Float32Array(limit);
        this.y = new Float32Array(limit);
        this.energy = new Float32Array(limit);
        this.species = new Uint32Array(limit);
        this.state = new Uint8Array(limit);
        this.meme = new Float32Array(limit);
      }
    }
  }

  push(id: number, x: number, y: number, energy: number, species: number, state: number, meme: number): void {
    if (this.count >= this.id.length) return;
    const i = this.count++;
    this.id[i] = id;
    this.x[i] = x;
    this.y[i] = y;
    this.energy[i] = energy;
    this.species[i] = species;
    this.state[i] = state;
    this.meme[i] = meme;
  }

  /** Row index of a currently-alive agent by id, or -1 if not in this frame. */
  indexOf(id: number): number {
    for (let i = 0; i < this.count; i++) if (this.id[i] === id) return i;
    return -1;
  }
}
