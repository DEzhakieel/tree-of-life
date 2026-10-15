import { WORLD_SIZE, complexToWorld, worldToComplex, type WorldConfig, type Intervention } from '@fractal-life/shared';
import type { AgentBuffer } from '../net/agentBuffer.js';
import { useStore } from '../store/useStore.js';
import { frameSuspended } from './frameBudget.js';
import { pickAgent, pickRadius, CLICK_SLOP_PX } from './pick.js';

const GOLDEN = 0.6180339887498949;
const BG = '#03040c';
const PAINT_INTERVAL_MS = 140;

export interface Canvas2DRendererOptions {
  canvas: HTMLCanvasElement;
  minimapCanvas: HTMLCanvasElement;
  agents: AgentBuffer;
  onPaint: (iv: Omit<Intervention, 'sequence'>) => void;
  onZoomChange: (zoom: number) => void;
  onPick?: (agentId: number, worldX: number, worldY: number) => void;
}

/**
 * Pure Canvas 2D fallback renderer for environments without WebGL.
 * Renders agents as coloured dots on a dark background with pan/zoom support.
 */
export class Canvas2DRenderer {
  private ctx: CanvasRenderingContext2D;
  private container: HTMLElement;
  private canvas: HTMLCanvasElement;
  private minimapCanvas: HTMLCanvasElement;
  private rafHandle = 0;
  private disposed = false;
  private frame = 0;

  private camX = 0;
  private camY = 0;
  private span = 4;
  private world: WorldConfig | null = null;
  private lastWorldId = '';

  private panning = false;
  private painting = false;
  private lastX = 0;
  private lastY = 0;
  private downX = 0;
  private downY = 0;
  private lastPaint = 0;

  private minimapCtx: CanvasRenderingContext2D;
  private minimapW = 0;
  private minimapH = 0;

  constructor(private opts: Canvas2DRendererOptions) {
    this.container = opts.canvas.parentElement ?? document.body;
    this.canvas = opts.canvas;
    this.minimapCanvas = opts.minimapCanvas;
    this.ctx = opts.canvas.getContext('2d')!;
    this.minimapCtx = opts.minimapCanvas.getContext('2d')!;
    this.resize();
    this.bindEvents();
    this.loop();
  }

  private resize(): void {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const ms = Math.min(200, Math.max(120, window.innerHeight * 0.28));
    this.minimapCanvas.width = Math.round(ms * dpr);
    this.minimapCanvas.height = Math.round(ms * dpr);
    this.minimapCanvas.style.width = `${ms}px`;
    this.minimapCanvas.style.height = `${ms}px`;
    this.minimapCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.minimapW = ms;
    this.minimapH = ms;
  }

  setWorld(world: WorldConfig | null): void {
    this.world = world;
    if (!world) return;
    this.camX = world.params.centerX;
    this.camY = world.params.centerY;
    this.span = world.params.worldScale * 1.05;
    this.opts.onZoomChange(world.params.worldScale / this.span);
  }

  // ---------------------------------------------------------------------------
  // Interaction
  // ---------------------------------------------------------------------------

  private bindEvents(): void {
    const c = this.canvas;
    c.addEventListener('pointerdown', this.onPointerDown);
    c.addEventListener('pointermove', this.onPointerMove);
    c.addEventListener('pointerup', this.onPointerUp);
    c.addEventListener('pointerleave', this.onPointerLeave);
    c.addEventListener('wheel', this.onWheel, { passive: false });
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('resize', () => this.resize());
  }

  private screenToComplex(clientX: number, clientY: number): { re: number; im: number } {
    const rect = this.canvas.getBoundingClientRect();
    const nx = ((clientX - rect.left) / rect.width) * 2 - 1;
    const ny = -(((clientY - rect.top) / rect.height) * 2 - 1);
    return { re: this.camX + (nx * this.span) / 2, im: this.camY - (ny * this.span) / 2 };
  }

  private onPointerDown = (e: PointerEvent): void => {
    try { this.canvas.setPointerCapture(e.pointerId); } catch { /* */ }
    this.lastX = e.clientX;
    this.lastY = e.clientY;
    this.downX = e.clientX;
    this.downY = e.clientY;
    const st = useStore.getState();
    if (e.button === 1 || e.button === 2) { this.panning = true; return; }
    if (e.button === 0 && st.tool !== 'none' && this.world) {
      this.painting = true;
      this.paintAt(e.clientX, e.clientY, true);
    } else if (e.button === 0) {
      this.panning = true;
    }
  };

  private onPointerMove = (e: PointerEvent): void => {
    if (this.panning) {
      const rect = this.canvas.getBoundingClientRect();
      const unit = this.span / rect.height;
      this.camX -= (e.clientX - this.lastX) * unit;
      this.camY += (e.clientY - this.lastY) * unit;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
    }
    const st = useStore.getState();
    if (this.painting) {
      this.paintAt(e.clientX, e.clientY, false);
      this.lastX = e.clientX;
      this.lastY = e.clientY;
    }
    if (st.tool !== 'none' && this.world) {
      this.opts.onZoomChange(this.world.params.worldScale / this.span);
    }
  };

  private onPointerUp = (e: PointerEvent): void => {
    const wasPanning = this.panning;
    this.panning = false;
    this.painting = false;
    // A left-button up with the pan tool that barely moved is a click → inspect.
    if (
      e.button === 0 &&
      wasPanning &&
      Math.hypot(e.clientX - this.downX, e.clientY - this.downY) < CLICK_SLOP_PX &&
      this.world &&
      this.opts.onPick
    ) {
      this.pickAt(e.clientX, e.clientY);
    }
  };

  /** Hit-test the agent buffer at a screen position and emit onPick (inspector). */
  private pickAt(clientX: number, clientY: number): void {
    if (!this.world) return;
    const rect = this.canvas.getBoundingClientRect();
    const p = this.screenToComplex(clientX, clientY);
    const w = complexToWorld(this.world.params, p.re, p.im);
    const idx = pickAgent(
      this.opts.agents,
      w.x,
      w.y,
      // span is in complex-plane units; the agent buffer lives in world units
      pickRadius((this.span * WORLD_SIZE) / this.world.params.worldScale, rect.height),
    );
    if (idx < 0) return;
    const a = this.opts.agents;
    this.opts.onPick!(a.id[idx]!, w.x, w.y);
  };
  private onPointerLeave = (): void => { /* */ };

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    const before = this.screenToComplex(e.clientX, e.clientY);
    const factor = Math.exp(e.deltaY * 0.0015);
    this.span = Math.max(1e-8, Math.min(64, this.span * factor));
    const after = this.screenToComplex(e.clientX, e.clientY);
    this.camX += before.re - after.re;
    this.camY += before.im - after.im;
    this.opts.onZoomChange(this.world ? this.world.params.worldScale / this.span : 1);
  };

  private paintAt(clientX: number, clientY: number, force: boolean): void {
    if (!this.world) return;
    const now = performance.now();
    if (!force && now - this.lastPaint < PAINT_INTERVAL_MS) return;
    this.lastPaint = now;
    const st = useStore.getState();
    if (st.tool === 'none') return;
    const p = this.screenToComplex(clientX, clientY);
    const w = complexToWorld(this.world.params, p.re, p.im);
    const iv: Omit<Intervention, 'sequence'> = {
      type: st.tool,
      x: Math.max(0, Math.min(WORLD_SIZE, w.x)),
      y: Math.max(0, Math.min(WORLD_SIZE, w.y)),
      radius: st.brushSize,
    };
    if (st.tool === 'seedFood') iv.amount = Math.max(1, Math.round(st.brushSize * 1.2));
    if (st.tool === 'pauseRegion') iv.ticks = 90;
    if (st.tool === 'spawnAgent' && st.designGenome) iv.genome = st.designGenome;
    this.opts.onPaint(iv);
  }

  // ---------------------------------------------------------------------------
  // Render loop
  // ---------------------------------------------------------------------------

  private worldToScreen(wx: number, wy: number, w: number, h: number): { sx: number; sy: number } {
    const half = this.span / 2;
    const sx = ((wx - this.camX) / half) * (w / 2) + w / 2;
    const sy = -((wy - this.camY) / half) * (h / 2) + h / 2;
    return { sx, sy };
  }

  private loop = (): void => {
    if (this.disposed) return;
    this.rafHandle = requestAnimationFrame(this.loop);
    const st = useStore.getState();
    // Headless suspends drawing; the RAF above keeps the loop alive so it
    // resumes by itself on the next frame after headless is switched off.
    if (frameSuspended()) return;

    if (st.world?.id !== this.lastWorldId) {
      this.lastWorldId = st.world?.id ?? '';
      this.setWorld(st.world);
    }
    if (!this.world) return;

    const cw = this.container.clientWidth;
    const ch = this.container.clientHeight;
    const ctx = this.ctx;

    // clear
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, cw, ch);

    // draw grid lines
    const half = this.span / 2;
    ctx.strokeStyle = 'rgba(255,255,255,0.04)';
    ctx.lineWidth = 1;
    const worldHalf = this.world.params.worldScale / 2;
    for (let gx = -worldHalf; gx <= worldHalf; gx += worldHalf / 4) {
      const { sx } = this.worldToScreen(gx, 0, cw, ch);
      ctx.beginPath(); ctx.moveTo(sx, 0); ctx.lineTo(sx, ch); ctx.stroke();
    }
    for (let gy = -worldHalf; gy <= worldHalf; gy += worldHalf / 4) {
      const { sy } = this.worldToScreen(0, gy, cw, ch);
      ctx.beginPath(); ctx.moveTo(0, sy); ctx.lineTo(cw, sy); ctx.stroke();
    }

    // draw agents
    if (st.showAgents) {
      const agents = this.opts.agents;
      const n = agents.count;
      for (let i = 0; i < n; i++) {
        const ax = agents.x[i]!;
        const ay = agents.y[i]!;
        const c = worldToComplex(this.world.params, ax, ay);
        const { sx, sy } = this.worldToScreen(c.re, c.im, cw, ch);
        if (sx < -10 || sx > cw + 10 || sy < -10 || sy > ch + 10) continue;

        const energy = agents.energy[i]!;
        const species = agents.species[i]!;
        const hue = st.showCulture ? agents.meme[i]! : (species * GOLDEN) % 1;
        const l = 30 + energy * 50;
        const size = 1.5 + energy * 3;

        ctx.beginPath();
        ctx.arc(sx, sy, size, 0, Math.PI * 2);
        ctx.fillStyle = `hsl(${Math.round((hue % 1) * 360)}, ${st.showCulture ? 60 : 85}%, ${Math.round(l)}%)`;
        ctx.fill();
      }
    }

    this.frame++;

    // minimap every 4 frames
    if (this.frame % 4 === 0 && st.showMinimap) {
      this.drawMinimap();
    }
  };

  private drawMinimap(): void {
    const ctx = this.minimapCtx;
    const w = this.minimapW;
    const h = this.minimapH;
    ctx.fillStyle = 'rgba(2, 4, 12, 0.92)';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(120, 220, 255, 0.35)';
    ctx.strokeRect(1, 1, w - 2, h - 2);
    const agents = this.opts.agents;
    const sx = w / WORLD_SIZE;
    const sy = h / WORLD_SIZE;
    const n = Math.min(agents.count, 12000);
    for (let i = 0; i < n; i++) {
      const hue = (agents.species[i]! * GOLDEN) % 1;
      const l = 30 + agents.energy[i]! * 50;
      ctx.fillStyle = `hsl(${Math.round(hue * 360)}, 85%, ${Math.round(l)}%)`;
      ctx.fillRect(agents.x[i]! * sx, agents.y[i]! * sy, 2, 2);
    }
  }

  destroy(): void {
    this.disposed = true;
    cancelAnimationFrame(this.rafHandle);
    const c = this.canvas;
    c.removeEventListener('pointerdown', this.onPointerDown);
    c.removeEventListener('pointermove', this.onPointerMove);
    c.removeEventListener('pointerup', this.onPointerUp);
    c.removeEventListener('pointerleave', this.onPointerLeave);
    c.removeEventListener('wheel', this.onWheel);
  }
}
