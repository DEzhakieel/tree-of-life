import { WORLD_SIZE, complexToWorld, worldToComplex, type WorldConfig, type Intervention } from '@fractal-life/shared';
import type { AgentBuffer } from '../net/agentBuffer.js';
import { useStore, type GroundLayer, type SetMap } from '../store/useStore.js';
import { frameSuspended } from './frameBudget.js';
import { pickAgent, pickRadius, CLICK_SLOP_PX } from './pick.js';
import { topologyEdges, effectiveTopology, worldRect, drawTopology2D } from './topology.js';
import { GroundPainter, GROUND_SIZE } from './groundPainter.js';
import {
  buildEdges,
  buildLineageEdges,
  buildLattice,
  lineageParents,
  latticeCellSize,
} from './representation.js';

const GOLDEN = 0.6180339887498949;
const BG = '#03040c';
const PAINT_INTERVAL_MS = 140;

/** Hue is quantised so the sprite cache stays small (one canvas per bucket)
 *  while still reading as a continuous colour ramp. */
const HUE_BUCKETS = 36;
const SPRITE_SIZE = 48;

/**
 * Soft gaussian-ish mote, pre-rendered once per hue bucket and blitted with
 * additive blending. The wide low-alpha skirt is what gives the population
 * the Lenia look: neighbouring motes melt into each other instead of reading
 * as separate dots.
 */
const spriteCache = new Map<number, HTMLCanvasElement>();

function moteSprite(hue: number): HTMLCanvasElement {
  const bucket = ((Math.round((hue % 1) * HUE_BUCKETS) % HUE_BUCKETS) + HUE_BUCKETS) % HUE_BUCKETS;
  const hit = spriteCache.get(bucket);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = SPRITE_SIZE;
  c.height = SPRITE_SIZE;
  const g = c.getContext('2d')!;
  const r = SPRITE_SIZE / 2;
  const grad = g.createRadialGradient(r, r, 0, r, r, r);
  const deg = (bucket / HUE_BUCKETS) * 360;
  // hot core -> mid body -> long soft skirt; the falloff sells the glow
  grad.addColorStop(0, `hsla(${deg}, 95%, 78%, 1)`);
  grad.addColorStop(0.22, `hsla(${deg}, 90%, 60%, 0.75)`);
  grad.addColorStop(0.6, `hsla(${deg}, 85%, 50%, 0.22)`);
  grad.addColorStop(1, `hsla(${deg}, 80%, 45%, 0)`);
  g.fillStyle = grad;
  g.fillRect(0, 0, SPRITE_SIZE, SPRITE_SIZE);
  spriteCache.set(bucket, c);
  return c;
}

/** Diameter of a mote in screen px for the current zoom (world-anchored). */
function moteDia(worldScale: number, diaFraction: number, span: number, viewH: number): number {
  return ((worldScale * diaFraction) / span) * viewH;
}

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

  private ground: GroundPainter | null = null;
  private groundCanvas: HTMLCanvasElement;
  private groundCtx: CanvasRenderingContext2D;
  private groundImage: ImageData;
  private lastGroundLayer = '';

  constructor(private opts: Canvas2DRendererOptions) {
    this.container = opts.canvas.parentElement ?? document.body;
    this.canvas = opts.canvas;
    this.minimapCanvas = opts.minimapCanvas;
    this.ctx = opts.canvas.getContext('2d')!;
    this.minimapCtx = opts.minimapCanvas.getContext('2d')!;
    this.groundCanvas = document.createElement('canvas');
    this.groundCanvas.width = GROUND_SIZE;
    this.groundCanvas.height = GROUND_SIZE;
    this.groundCtx = this.groundCanvas.getContext('2d')!;
    this.groundImage = this.groundCtx.createImageData(GROUND_SIZE, GROUND_SIZE);
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
    if (!world) {
      this.ground = null;
      return;
    }
    this.ground = new GroundPainter(world.params);
    this.lastGroundLayer = '';
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
    const rep = st.representation;

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

    // Ground: the fractal representation always shows it; the other views
    // show it only when the Display panel's Ground switch is on. This mirrors
    // the WebGL renderer so the 2D fallback is not missing a layer.
    if (rep === 'fractal' || st.showTerrain) {
      this.drawGround(cw, ch, st.setMap, st.groundLayer);
    }

    // draw agents
    if (st.showAgents && (rep === 'particle' || rep === 'fractal')) {
      const agents = this.opts.agents;
      const n = agents.count;
      const worldScale = this.world.params.worldScale;
      // Particle: Lenia-style additive glow field. Fractal: the terrain is
      // the subject, so agents become small crisp markers on top of it.
      const marker = rep === 'fractal';
      ctx.globalCompositeOperation = marker ? 'source-over' : 'lighter';
      for (let i = 0; i < n; i++) {
        const ax = agents.x[i]!;
        const ay = agents.y[i]!;
        const c = worldToComplex(this.world.params, ax, ay);
        const { sx, sy } = this.worldToScreen(c.re, c.im, cw, ch);

        const energy = agents.energy[i]!;
        const fed = energy * energy;
        // world-anchored diameter, matched to the WebGL field: ~1% (starved)
        // to ~6% (fed) of the default full-world view
        const dia = moteDia(
          worldScale,
          marker ? 0.005 + fed * 0.018 : 0.012 + fed * 0.05,
          this.span,
          ch,
        );
        if (sx < -dia || sx > cw + dia || sy < -dia || sy > ch + dia) continue;

        const species = agents.species[i]!;
        const hue = st.showCulture ? agents.meme[i]! : (species * GOLDEN) % 1;
        if (marker) {
          ctx.globalAlpha = 0.9;
          ctx.fillStyle = `hsl(${Math.round((hue % 1) * 360)}, 80%, ${Math.round(35 + fed * 25)}%)`;
          ctx.beginPath();
          ctx.arc(sx, sy, Math.max(1.2, dia / 2), 0, Math.PI * 2);
          ctx.fill();
        } else {
          ctx.globalAlpha = 0.4 + fed * 0.6;
          const d = Math.max(2, dia);
          ctx.drawImage(moteSprite(hue), sx - d / 2, sy - d / 2, d, d);
        }
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }

    if (rep === 'graph') this.drawGraph(cw, ch, st.showCulture);
    if (rep === 'lattice') this.drawLattice(cw, ch, st.showCulture);

    if (st.showBoundary) {
      const r = worldRect(this.world.params);
      // screen y is flipped, so the max-im corner is the visual top-left
      const a = this.worldToScreen(r.x0, r.y1, cw, ch);
      const b = this.worldToScreen(r.x1, r.y0, cw, ch);
      drawTopology2D(
        ctx,
        {
          x: Math.min(a.sx, b.sx),
          y: Math.min(a.sy, b.sy),
          w: Math.abs(b.sx - a.sx),
          h: Math.abs(b.sy - a.sy),
        },
        topologyEdges(effectiveTopology(this.world)),
      );
    }

    this.frame++;

    // minimap every 4 frames
    if (this.frame % 4 === 0 && st.showMinimap) {
      this.drawMinimap();
    }
  };

  /**
   * Blit the live ground texture under the agents. The painter writes row 0 at
   * the world's minimum imaginary coordinate (the visual bottom), so the canvas
   * blit flips vertically to match the WebGL plane's orientation.
   */
  private drawGround(cw: number, ch: number, setMap: SetMap | null, layer: GroundLayer): void {
    if (!this.world || !this.ground) return;
    const layerChanged = layer !== this.lastGroundLayer;
    if (layerChanged) this.lastGroundLayer = layer;
    if (layerChanged || this.frame % 8 === 0) {
      this.ground.paint(setMap, this.opts.agents, layer);
      this.groundImage.data.set(this.ground.data);
      this.groundCtx.putImageData(this.groundImage, 0, 0);
    }

    const r = worldRect(this.world.params);
    const a = this.worldToScreen(r.x0, r.y1, cw, ch);
    const b = this.worldToScreen(r.x1, r.y0, cw, ch);
    const left = Math.min(a.sx, b.sx);
    const right = Math.max(a.sx, b.sx);
    const top = Math.min(a.sy, b.sy);
    const bottom = Math.max(a.sy, b.sy);

    const ctx = this.ctx;
    ctx.save();
    ctx.translate(left, bottom);
    ctx.scale(1, -1);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.groundCanvas, 0, 0, right - left, bottom - top);
    ctx.restore();
  }

  /** Network view: proximity + lineage edges, then agents as nodes. */
  private drawGraph(cw: number, ch: number, showCulture: boolean): void {
    if (!this.world) return;
    const ctx = this.ctx;
    const agents = this.opts.agents;
    const st = useStore.getState();
    const toScreen = (row: number): { sx: number; sy: number } => {
      const c = worldToComplex(this.world!.params, agents.x[row]!, agents.y[row]!);
      return this.worldToScreen(c.re, c.im, cw, ch);
    };

    const prox = buildEdges(agents, this.world.params.worldScale / 60, 2500);
    const lin = buildLineageEdges(agents, lineageParents(st.showLineage ? st.lineage : null));

    ctx.lineWidth = 1;
    for (const e of prox) {
      const a = toScreen(e.a);
      const b = toScreen(e.b);
      ctx.strokeStyle = 'rgba(120,160,200,0.32)';
      ctx.beginPath(); ctx.moveTo(a.sx, a.sy); ctx.lineTo(b.sx, b.sy); ctx.stroke();
    }
    for (const e of lin) {
      const a = toScreen(e.a);
      const b = toScreen(e.b);
      ctx.strokeStyle = 'rgba(140,190,255,0.7)';
      ctx.beginPath(); ctx.moveTo(a.sx, a.sy); ctx.lineTo(b.sx, b.sy); ctx.stroke();
    }

    const n = agents.count;
    const worldScale = this.world.params.worldScale;
    ctx.globalCompositeOperation = 'source-over';
    for (let i = 0; i < n; i++) {
      const { sx, sy } = toScreen(i);
      const energy = agents.energy[i]!;
      const fed = energy * energy;
      // crisp nodes read against the wire — deliberately unlike the particle
      // field's soft additive blobs
      const dia = Math.max(3, moteDia(worldScale, 0.010 + fed * 0.035, this.span, ch));
      if (sx < -dia || sx > cw + dia || sy < -dia || sy > ch + dia) continue;
      const hue = showCulture ? agents.meme[i]! : (agents.species[i]! * GOLDEN) % 1;
      ctx.globalAlpha = 0.75 + fed * 0.25;
      ctx.fillStyle = `hsl(${Math.round((hue % 1) * 360)}, 85%, ${Math.round(50 + fed * 30)}%)`;
      ctx.beginPath();
      ctx.arc(sx, sy, dia / 2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  /** Lattice view: agents binned into a grid, cell brightness = density. */
  private drawLattice(cw: number, ch: number, showCulture: boolean): void {
    if (!this.world) return;
    const ctx = this.ctx;
    const agents = this.opts.agents;
    const cell = latticeCellSize(WORLD_SIZE);
    const grid = buildLattice(agents, WORLD_SIZE, cell);
    let maxCount = 1;
    for (let i = 0; i < grid.count.length; i++) if (grid.count[i]! > maxCount) maxCount = grid.count[i]!;

    const params = this.world.params;
    for (let y = 0; y < grid.rows; y++) {
      for (let x = 0; x < grid.cols; x++) {
        const idx = y * grid.cols + x;
        const c = grid.count[idx]!;
        if (c === 0) continue;
        const wx = (x + 0.5) * cell;
        const wy = (y + 0.5) * cell;
        const comp = worldToComplex(params, wx, wy);
        const { sx, sy } = this.worldToScreen(comp.re, comp.im, cw, ch);
        const px = Math.max(2, Math.round(cw / grid.cols));
        const t = c / maxCount;
        ctx.globalAlpha = 0.35 + t * 0.65;
        if (showCulture) {
          ctx.fillStyle = `hsl(${Math.round((grid.meme[idx]! / c) * 360)}, 70%, ${Math.round(15 + t * 60)}%)`;
        } else {
          // near-black indigo -> electric blue -> white, matched to the WebGL view
          ctx.fillStyle = `rgb(${Math.round(8 + t * 215)}, ${Math.round(30 + t * 200)}, ${Math.round(90 + t * 145)})`;
        }
        // snapped to the pixel grid so cells stay chunky squares, not blurs
        ctx.fillRect(Math.round(sx - px / 2), Math.round(sy - px / 2), px, px);
      }
    }
    ctx.globalAlpha = 1;
  }

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
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < n; i++) {
      const energy = agents.energy[i]!;
      const hue = (agents.species[i]! * GOLDEN) % 1;
      // Alpha tracks energy so dead weight dims out and the live population
      // is what the minimap actually reads as.
      ctx.globalAlpha = 0.3 + energy * energy * 0.7;
      ctx.drawImage(moteSprite(hue), agents.x[i]! * sx - 1.5, agents.y[i]! * sy - 1.5, 3, 3);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
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
