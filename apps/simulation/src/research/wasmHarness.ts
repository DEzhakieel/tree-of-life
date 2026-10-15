/**
 * Node WASM harness for the emergence radar.
 *
 * The radar is standardised on the Rust/WASM engine (the TS reference engine
 * zeros the discovery/novelty observables, and the radar must see the same
 * world the web client runs). This module owns the wasm lifecycle and turns a
 * world run into a stream of shared `RadarSample`s:
 *
 *   WorldConfig ──WasmEngine.tick──> stats + terrain_grid + agent_summaries
 *                                          │
 *                          (positions diffed into velocity)
 *                                          ▼
 *                               computePrimitives(...)  [shared]
 *
 * Velocity is not exposed by the cheap snapshots, so it is reconstructed from
 * the previous sample's positions — a first-principles finite difference over
 * the radar cadence, not a hidden engine read. `agent_summaries_json` supplies
 * genomes (for heredity) and lineage ids; `terrain_grid_json` supplies the
 * matter and signal fields.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  computePrimitives,
  emptySimStats,
  type RadarAgent,
  type RadarSample,
  type RadarTerrain,
  type SimStats,
  type WorldConfig,
} from '@fractal-life/shared';
import { initSync, WasmEngine } from '../../../../crates/wasm/pkg/fractal_life_wasm.js';

/** Structural twin of the server's BrainConfig passthrough. */
export interface WasmBrainConfig {
  enabled?: boolean;
  lr?: number;
  gamma?: number;
  lambda?: number;
  inherit?: number;
  learn?: 'hebbian' | 'backprop';
  dropout?: number;
  gradNoise?: number;
  entropy?: number;
  policy?: { mode: 'deterministic' | 'gaussian'; sigma: number; sigmaMin: number; annealTicks: number };
}

/** Structural twin of the server's WorldStoch passthrough. */
export interface WasmWorldStoch {
  enabled?: boolean;
  poissonRate?: number;
  ouTheta?: number;
  ouSigma?: number;
  ouBand?: number;
  weather?: number[][] | null;
}

export interface WasmRunSpec {
  config: WorldConfig;
  brain?: WasmBrainConfig | null;
  worldStoch?: WasmWorldStoch | null;
}

export interface WasmRadarRun {
  samples: RadarSample[];
  finalStats: SimStats;
}

export interface RunWasmRadarOptions extends WasmRunSpec {
  ticks: number;
  /** capture a radar sample every N ticks (>= 1) */
  sampleEvery: number;
}

let wasmInitialized = false;

function ensureWasm(): void {
  if (wasmInitialized) return;
  const here = dirname(fileURLToPath(import.meta.url));
  const wasmPath = join(here, '..', '..', '..', '..', 'crates', 'wasm', 'pkg', 'fractal_life_wasm_bg.wasm');
  const bytes = readFileSync(wasmPath);
  const module = new (globalThis as { WebAssembly: typeof WebAssembly }).WebAssembly.Module(bytes);
  initSync({ module });
  wasmInitialized = true;
}

function parse<T>(json: unknown): T {
  return JSON.parse(JSON.stringify(json)) as T;
}

interface RawTerrain {
  size: number;
  /** world units per grid cell (agents live in world units) */
  cell: number;
  food: number[];
  meat: number[];
  minerals: number[];
  signal: number[];
}

interface RawAgentSummary {
  id: number;
  parentId: number;
  alive: boolean;
  species: number;
  x: number;
  y: number;
  genome: number[];
}

/**
 * Run a world on the WASM engine and return the radar primitive samples.
 * Deterministic: identical `spec` + `seed` reproduce the same sample stream.
 */
export function runWasmRadar(opts: RunWasmRadarOptions): WasmRadarRun {
  ensureWasm();
  const engine = new WasmEngine(JSON.stringify(opts.config));
  engine.set_record_delta(false);
  if (opts.brain) engine.set_brain_json(JSON.stringify(opts.brain));
  if (opts.worldStoch) engine.set_world_stoch_json(JSON.stringify(opts.worldStoch));

  const samples: RadarSample[] = [];
  const prevPos = new Map<number, { x: number; y: number; tick: number }>();
  const sampleEvery = Math.max(1, Math.floor(opts.sampleEvery));
  // the engine has no stats until it ticks; before that it is a zero-row
  let finalStats = emptySimStats(engine.current_tick(), opts.config.params.timeScale);

  const readAgents = (tick: number): { cell: number; terrain: RadarTerrain; agents: RadarAgent[] } => {
    const grid = parse<RawTerrain>(engine.terrain_grid_json());
    const cell = grid.cell > 0 ? grid.cell : 1;
    const summaries = parse<RawAgentSummary[]>(engine.agent_summaries_json());
    const agents: RadarAgent[] = [];
    for (const a of summaries) {
      // positions are world units; the terrain gradient is indexed in cells
      const cx = a.x / cell;
      const cy = a.y / cell;
      const prev = prevPos.get(a.id);
      const dt = prev ? tick - prev.tick : 0;
      const agent: RadarAgent = {
        id: a.id,
        x: cx,
        y: cy,
        species: a.species,
        alive: a.alive,
        parentId: a.parentId,
        genome: a.genome,
      };
      // velocity is only meaningful for the living; dead summaries are kept so
      // detectors that link a child to an already-dead parent (copy fidelity)
      // can still resolve the pair.
      if (a.alive && prev && dt > 0) {
        agent.vx = (cx - prev.x) / dt;
        agent.vy = (cy - prev.y) / dt;
      }
      agents.push(agent);
      prevPos.set(a.id, { x: cx, y: cy, tick });
    }
    return { cell, terrain: { food: grid.food, meat: grid.meat, minerals: grid.minerals, signal: grid.signal }, agents };
  };

  // seed positions at tick 0 (no sample): velocity needs a previous position,
  // so the first emitted sample must already have a predecessor
  readAgents(0);

  for (let t = 0; t < opts.ticks; t++) {
    const res = engine.tick();
    finalStats = parse<SimStats>(res.stats_json());
    const tick = res.tick();
    if (tick % sampleEvery === 0) {
      const { terrain, agents } = readAgents(tick);
      samples.push(computePrimitives({ tick, stats: finalStats, terrain, agents }));
    }
  }

  return { samples, finalStats };
}
