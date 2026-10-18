import * as THREE from 'three';
import {
  WORLD_SIZE,
  complexToWorld,
  type WorldConfig,
  type Intervention,
} from '@fractal-life/shared';
import type { AgentBuffer } from '../net/agentBuffer.js';
import { useStore } from '../store/useStore.js';
import { frameSuspended } from './frameBudget.js';
import { EvolvedTerrain } from './evolvedTerrain.js';
import { AgentsMesh } from './agents.js';
import { GraphView, LatticeView } from './graphLattice.js';
import { createEffects } from './effects.js';
import { Minimap } from './minimap.js';
import { pickAgent, pickRadius, CLICK_SLOP_PX } from './pick.js';

export interface WorldRendererOptions {
  canvas: HTMLCanvasElement;
  minimapCanvas: HTMLCanvasElement;
  agents: AgentBuffer;
  onPaint: (iv: Omit<Intervention, 'sequence'>) => void;
  onZoomChange: (zoom: number) => void;
  onPick?: (agentId: number, worldX: number, worldY: number) => void;
}

const PAINT_INTERVAL_MS = 140;

/**
 * Top-down 3D world view. Everything lives in complex-plane coordinates. The
 * ground is the live evolved set (see EvolvedTerrain) — no analytic fractal
 * shader is rendered anymore. Agents are an InstancedMesh and a bloom pass
 * gives the population an energy glow.
 */
export class WorldRenderer {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.OrthographicCamera;
  private terrain: EvolvedTerrain | null = null;
  private lastGroundLayer = 'set';
  private agentsMesh: AgentsMesh | null = null;
  private graphView: GraphView | null = null;
  private latticeView: LatticeView | null = null;
  private lastRepresentation = '';
  private effects: ReturnType<typeof createEffects> | null = null;
  private minimap: Minimap;
  private container: HTMLElement;
  private canvas: HTMLCanvasElement;
  private rafHandle = 0;
  private disposed = false;
  private frame = 0;

  private camX = 0;
  private camY = 0;
  private span = 4;
  private world: WorldConfig | null = null;
  private lastWorldId = '';

  // interaction state
  private panning = false;
  private painting = false;
  private lastX = 0;
  private lastY = 0;
  private downX = 0;
  private downY = 0;
  private lastPaint = 0;
  private brush: THREE.Mesh;

  private brushRingGeo = new THREE.RingGeometry(0.9, 1, 48);

  constructor(private opts: WorldRendererOptions) {
    this.container = opts.canvas.parentElement ?? document.body;
    this.canvas = opts.canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas: opts.canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
    this.renderer.toneMapping = THREE.NoToneMapping;

    this.scene.background = new THREE.Color(0x03040c);

    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -1000, 1000);
    this.camera.position.set(0, 0, 500);
    this.camera.up.set(0, 1, 0);
    this.updateCamera();

    this.effects = createEffects(this.renderer, this.scene, this.camera, {
      w: this.container.clientWidth,
      h: this.container.clientHeight,
    });

    this.minimap = new Minimap(opts.minimapCanvas);

    const brushMat = new THREE.MeshBasicMaterial({
      color: 0x4dffd0,
      transparent: true,
      opacity: 0.55,
      depthTest: false,
      side: THREE.DoubleSide,
    });
    this.brush = new THREE.Mesh(this.brushRingGeo, brushMat);
    this.brush.visible = false;
    this.scene.add(this.brush);

    this.bindEvents();
    this.loop();
  }

  // ---------------------------------------------------------------------------
  // World binding
  // ---------------------------------------------------------------------------

  setWorld(world: WorldConfig | null): void {
    this.world = world;
    if (!world) {
      this.disposeViews();
      return;
    }
    this.disposeViews();
    this.terrain = new EvolvedTerrain(world.params);
    this.scene.add(this.terrain.group);
    const maxCount = Math.min(world.params.maxPopulation, 12000);
    this.agentsMesh = new AgentsMesh(maxCount);
    this.scene.add(this.agentsMesh.mesh);
    this.graphView = new GraphView(maxCount, world.params.worldScale / 60);
    this.scene.add(this.graphView.group);
    this.latticeView = new LatticeView(
      world.params.worldScale,
      world.params.centerX,
      world.params.centerY,
      WORLD_SIZE,
    );
    this.scene.add(this.latticeView.group);

    // reset the view over the whole world
    this.camX = world.params.centerX;
    this.camY = world.params.centerY;
    this.span = world.params.worldScale * 1.05;
    this.updateCamera();
  }

  /** Drop every per-world view. Called on world change and on destroy. */
  private disposeViews(): void {
    if (this.terrain) {
      this.scene.remove(this.terrain.group);
      this.terrain.dispose();
      this.terrain = null;
    }
    if (this.agentsMesh) {
      this.scene.remove(this.agentsMesh.mesh);
      this.agentsMesh.dispose();
      this.agentsMesh = null;
    }
    if (this.graphView) {
      this.scene.remove(this.graphView.group);
      this.graphView.dispose();
      this.graphView = null;
    }
    if (this.latticeView) {
      this.scene.remove(this.latticeView.group);
      this.latticeView.dispose();
      this.latticeView = null;
    }
    this.lastRepresentation = '';
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
    window.addEventListener('resize', this.onResize);
  }

  private screenToComplex(clientX: number, clientY: number): { re: number; im: number } {
    const rect = this.canvas.getBoundingClientRect();
    const nx = ((clientX - rect.left) / rect.width) * 2 - 1;
    const ny = -(((clientY - rect.top) / rect.height) * 2 - 1);
    return { re: this.camX + (nx * this.span) / 2, im: this.camY - (ny * this.span) / 2 };
  }

  private onPointerDown = (e: PointerEvent): void => {
    try {
      this.canvas.setPointerCapture(e.pointerId);
    } catch {
      /* synthetic / automation events don't have an active pointer */
    }
    this.lastX = e.clientX;
    this.lastY = e.clientY;
    this.downX = e.clientX;
    this.downY = e.clientY;
    const st = useStore.getState();
    if (e.button === 1 || e.button === 2) {
      this.panning = true;
      return;
    }
    if (e.button === 0 && st.tool !== 'none' && this.world) {
      this.painting = true;
      this.paintAt(e.clientX, e.clientY, true);
    } else if (e.button === 0) {
      this.panning = true;
    }
  };

  private onPointerMove = (e: PointerEvent): void => {
    const st = useStore.getState();
    if (this.painting) {
      this.paintAt(e.clientX, e.clientY, false);
      this.showBrush(e.clientX, e.clientY);
      this.lastX = e.clientX;
      this.lastY = e.clientY;
      return;
    }
    if (this.panning) {
      const rect = this.canvas.getBoundingClientRect();
      const unit = this.span / rect.height;
      this.camX -= (e.clientX - this.lastX) * unit;
      this.camY += (e.clientY - this.lastY) * unit;
      this.updateCamera();
      this.lastX = e.clientX;
      this.lastY = e.clientY;
    }
    if (st.tool !== 'none' && this.world) {
      this.showBrush(e.clientX, e.clientY);
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
    this.opts.onPick!(this.opts.agents.id[idx]!, w.x, w.y);
  };

  private onPointerLeave = (): void => {
    this.brush.visible = false;
  };

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    const before = this.screenToComplex(e.clientX, e.clientY);
    const factor = Math.exp(e.deltaY * 0.0015);
    this.span = THREE.MathUtils.clamp(this.span * factor, 1e-8, 64);
    this.updateCamera();
    const after = this.screenToComplex(e.clientX, e.clientY);
    this.camX += before.re - after.re;
    this.camY += before.im - after.im;
    this.updateCamera();
  };

  private onResize = (): void => {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    this.renderer.setSize(w, h);
    this.effects?.setSize(w, h);
    this.minimap.resize();
  };

  private showBrush(clientX: number, clientY: number): void {
    if (!this.world) return;
    const p = this.screenToComplex(clientX, clientY);
    const brushWorld = useStore.getState().brushSize;
    const complexRadius = (brushWorld * this.world.params.worldScale) / WORLD_SIZE;
    this.brush.scale.setScalar(complexRadius);
    this.brush.position.set(p.re, p.im, 0.05);
    this.brush.visible = true;
  }

  private paintAt(clientX: number, clientY: number, force: boolean): void {
    if (!this.world) return;
    const now = performance.now();
    if (!force && now - this.lastPaint < PAINT_INTERVAL_MS) return;
    this.lastPaint = now;
    const st = useStore.getState();
    if (st.tool === 'none') return;
    const p = this.screenToComplex(clientX, clientY);
    const w = complexToWorld(this.world.params, p.re, p.im);
    const x = Math.max(0, Math.min(WORLD_SIZE, w.x));
    const y = Math.max(0, Math.min(WORLD_SIZE, w.y));
    const iv: Omit<Intervention, 'sequence'> = {
      type: st.tool,
      x,
      y,
      radius: st.brushSize,
    };
    if (st.tool === 'seedFood') iv.amount = Math.max(1, Math.round(st.brushSize * 1.2));
    if (st.tool === 'pauseRegion') iv.ticks = 90;
    if (st.tool === 'spawnAgent' && st.designGenome) iv.genome = st.designGenome;
    this.opts.onPaint(iv);
  }

  // ---------------------------------------------------------------------------
  // Frame loop
  // ---------------------------------------------------------------------------

  private updateCamera(): void {
    const half = this.span / 2;
    this.camera.left = -half;
    this.camera.right = half;
    this.camera.top = half;
    this.camera.bottom = -half;
    this.camera.position.set(this.camX, this.camY, 500);
    this.camera.lookAt(this.camX, this.camY, 0);
    this.camera.updateProjectionMatrix();
    this.opts.onZoomChange(this.world ? this.world.params.worldScale / this.span : 1);
  }

  private loop = (): void => {
    if (this.disposed) return;
    this.rafHandle = requestAnimationFrame(this.loop);
    const st = useStore.getState();
    // Headless suspends drawing: the worker sends no frames, so re-drawing the
    // stale snapshot would burn exactly the CPU headless is meant to free. The
    // RAF above is already scheduled, so the loop revives on its own when
    // headless switches off — no resume path is needed here.
    if (frameSuspended()) return;

    // world change detection
    if (st.world?.id !== this.lastWorldId) {
      this.lastWorldId = st.world?.id ?? '';
      this.setWorld(st.world);
    }
    if (!this.world) return;

    const p = this.world.params;
    const rep = st.representation;

    // ground: repaint from live data on an interval, or immediately on layer
    // change. The fractal view leans on the terrain so it stays live there too.
    if (this.terrain) {
      const layerChanged = st.groundLayer !== this.lastGroundLayer;
      if (layerChanged) this.lastGroundLayer = st.groundLayer;
      if (layerChanged || this.frame % 8 === 0) {
        this.terrain.update(st.setMap, this.opts.agents, st.groundLayer);
      }
      // Fractal view foregrounds the terrain; the others drop it back unless
      // the user explicitly asked for the ground overlay.
      this.terrain.setVisible(rep === 'fractal' ? true : st.showTerrain);
    }

    // Agents: particle and fractal draw them; graph/lattice replace them.
    if (this.agentsMesh) {
      const showAgents = (rep === 'particle' || rep === 'fractal') && st.showAgents;
      this.agentsMesh.setVisible(showAgents);
      if (showAgents) {
        // In the fractal view the terrain is the subject, so agents shrink to
        // markers and stop swamping it.
        const scale = (p.worldScale * 3.2) / WORLD_SIZE * (rep === 'fractal' ? 0.45 : 1);
        this.agentsMesh.update(p, this.opts.agents, scale, st.showCulture);
      }
    }

    if (this.graphView) {
      const on = rep === 'graph';
      this.graphView.setVisible(on);
      if (on && (this.frame % 4 === 0 || this.lastRepresentation !== rep)) {
        this.graphView.update(p, this.opts.agents, st.lineage, st.showCulture);
      }
    }

    if (this.latticeView) {
      const on = rep === 'lattice';
      this.latticeView.setVisible(on);
      if (on && (this.frame % 4 === 0 || this.lastRepresentation !== rep)) {
        this.latticeView.update(this.opts.agents, st.showCulture);
      }
    }

    this.lastRepresentation = rep;

    this.frame++;
    if (this.frame % 4 === 0 && st.showMinimap) {
      this.minimap.draw(this.opts.agents, st.paused);
    }

    if (this.effects) {
      this.effects.composer.render();
    } else {
      this.renderer.render(this.scene, this.camera);
    }
  };

  destroy(): void {
    this.disposed = true;
    cancelAnimationFrame(this.rafHandle);
    const c = this.canvas;
    c.removeEventListener('pointerdown', this.onPointerDown);
    c.removeEventListener('pointermove', this.onPointerMove);
    c.removeEventListener('pointerup', this.onPointerUp);
    c.removeEventListener('pointerleave', this.onPointerLeave);
    c.removeEventListener('wheel', this.onWheel);
    window.removeEventListener('resize', this.onResize);
    this.disposeViews();
    this.effects?.dispose();
    this.renderer.dispose();
  }
}
