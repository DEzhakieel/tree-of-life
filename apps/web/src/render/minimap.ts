import { WORLD_SIZE } from '@fractal-life/shared';
import type { AgentBuffer } from '../net/agentBuffer.js';

const GOLDEN = 0.6180339887498949;

/** Lightweight 2D canvas minimap of the world in [0, WORLD_SIZE]^2. */
export class Minimap {
  private ctx: CanvasRenderingContext2D;
  private rafHandle = 0;
  private w = 0;
  private h = 0;

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
    this.resize();
  }

  resize(): void {
    const size = Math.min(200, Math.max(120, window.innerHeight * 0.28));
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = Math.round(size * dpr);
    this.canvas.height = Math.round(size * dpr);
    this.canvas.style.width = `${size}px`;
    this.canvas.style.height = `${size}px`;
    this.w = this.canvas.width;
    this.h = this.canvas.height;
  }

  draw(agents: AgentBuffer, paused: boolean): void {
    cancelAnimationFrame(this.rafHandle);
    this.rafHandle = requestAnimationFrame(() => this.render(agents));
  }

  private render(agents: AgentBuffer): void {
    const { ctx, w, h } = this;
    ctx.fillStyle = 'rgba(2, 4, 12, 0.92)';
    ctx.fillRect(0, 0, w, h);
    const sx = w / WORLD_SIZE;
    const sy = h / WORLD_SIZE;
    ctx.fillStyle = 'rgba(120, 220, 255, 0.35)';
    ctx.strokeRect(1, 1, w - 2, h - 2);
    const n = Math.min(agents.count, 12000);
    for (let i = 0; i < n; i++) {
      const hue = (agents.species[i]! * GOLDEN) % 1;
      const l = 0.3 + agents.energy[i]! * 0.5;
      ctx.fillStyle = `hsl(${Math.round(hue * 360)}, 85%, ${Math.round(l * 100)}%)`;
      ctx.fillRect(agents.x[i]! * sx, agents.y[i]! * sy, 2, 2);
    }
  }
}
