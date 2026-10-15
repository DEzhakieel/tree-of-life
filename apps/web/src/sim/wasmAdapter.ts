import {
  encodeSnapshot,
  encodeSetMap,
  encodeStats,
  emptySimStats,
  computePrimitives,
  type WorldConfig,
  type Intervention,
  type SimStats,
  type SimEvent,
  type AgentState,
  type AgentSummary,
  type WorldStatus,
  type LineageNode,
  type RadarAgent,
  type RadarSample,
  type RadarTerrain,
} from '@fractal-life/shared';
import { initSync, WasmEngine as RawWasmEngine } from './wasm_glue.js';

export interface WasmTickResult {
  tick(): number;
  delta_count(): number;
  delta_bytes(): Uint8Array;
  stats_json(): unknown;
  events_json(): unknown;
}

export interface TickResult {
  tick: number;
  delta: Uint8Array;
  deltaCount: number;
  stats: SimStats;
  events: SimEvent[];
}

/** BrainConfig passthrough for the Rust engine — structurally the same option
 *  set as the TS `BrainConfig`, so both engine backends take the same object. */
export interface BrainConfigLike {
  enabled?: boolean;
  lr?: number;
  gamma?: number;
  lambda?: number;
  inherit?: number;
  learn?: 'hebbian' | 'backprop';
  pomdp?: {
    enabled: boolean;
    noise?: number;
    gain?: number;
    weight?: number;
    hidden?: number[];
  };
  policy?: {
    mode: 'deterministic' | 'gaussian';
    sigma: number;
    sigmaMin: number;
    annealTicks: number;
  };
  dropout?: number;
  gradNoise?: number;
  entropy?: number;
}

/** Stochastic world-process config passthrough (weather / OU field / Poisson
 *  burst pulses). `null` disables the processes (the headless default). */
export interface WorldStochLike {
  enabled?: boolean;
  poissonRate?: number;
  ouTheta?: number;
  ouSigma?: number;
  ouBand?: number;
  weather?: number[][] | null;
}

interface RecordedIntervention {
  tick: number;
  intervention: Intervention;
}

let wasmInitialized = false;

async function ensureWasm(wasmBinaryUrl?: string): Promise<void> {
  if (wasmInitialized) return;
  const url = wasmBinaryUrl ?? new URL('/wasm/fractal_life_wasm_bg.wasm', self.location.origin).href;
  const response = await fetch(url);
  const bytes = await response.arrayBuffer();
  const module = await WebAssembly.compile(bytes);
  initSync({ module });
  wasmInitialized = true;
}

export async function createWasmSimEngine(
  config: WorldConfig,
  wasmBinaryUrl?: string,
): Promise<WasmSimEngine> {
  await ensureWasm(wasmBinaryUrl);
  return new WasmSimEngine(config);
}

function parseStats(json: unknown): SimStats {
  return JSON.parse(JSON.stringify(json)) as SimStats;
}

function parseEvents(json: unknown): SimEvent[] {
  return JSON.parse(JSON.stringify(json)) as SimEvent[];
}

interface RawTerrainGrid {
  size: number;
  cell: number;
  food: number[];
  meat: number[];
  minerals: number[];
  signal: number[];
}

interface RawAgentSummary {
  id: number;
  parentId: number;
  bornAtTick: number;
  diedAtTick: number;
  alive: boolean;
  species: number;
  finalFitness: number;
  x: number;
  y: number;
  energy: number;
  age: number;
  genome: number[];
}

export class WasmSimEngine {
  private engine: RawWasmEngine;
  readonly config: WorldConfig;
  private interventionLog: RecordedIntervention[] = [];
  private lastStats: SimStats | null = null;
  private prevPos = new Map<number, { x: number; y: number; tick: number }>();

  private readTerrainGrid(): RawTerrainGrid {
    const raw = JSON.parse(JSON.stringify(this.engine.terrain_grid_json()));
    return raw as RawTerrainGrid;
  }

  private readAgentSummariesInternal(): RawAgentSummary[] {
    const raw = JSON.parse(JSON.stringify(this.engine.agent_summaries_json()));
    return raw as RawAgentSummary[];
  }

  constructor(config: WorldConfig) {
    this.engine = new RawWasmEngine(JSON.stringify(config));
    this.config = config;
  }

  get currentTick(): number {
    return this.engine.current_tick();
  }

  tick(): TickResult {
    const t = this.engine.tick();
    const stats = parseStats(t.stats_json());
    const events = parseEvents(t.events_json());
    this.lastStats = stats;
    return {
      tick: t.tick(),
      delta: t.delta_bytes(),
      deltaCount: t.delta_count(),
      stats,
      events,
    };
  }

  stats(): SimStats {
    if (this.lastStats) return this.lastStats;
    return emptySimStats(this.currentTick, this.config.params.timeScale, {
      population: this.engine.alive_count(),
      aliveCount: this.engine.alive_count(),
    });
  }

  terrainGrid(): { size: number; cell: number; terrain: RadarTerrain } {
    const grid = this.readTerrainGrid();
    const cell = grid.cell > 0 ? grid.cell : 1;
    return {
      size: grid.size,
      cell,
      terrain: {
        food: grid.food,
        meat: grid.meat,
        minerals: grid.minerals,
        signal: grid.signal,
      },
    };
  }

  radarSample(): RadarSample {
    const tick = this.engine.current_tick();
    const stats = this.stats();
    const grid = this.readTerrainGrid();
    const cell = grid.cell > 0 ? grid.cell : 1;
    const summaries = this.readAgentSummariesInternal();
    const agents: RadarAgent[] = [];
    for (const a of summaries) {
      if (!a.alive) continue;
      const cx = a.x / cell;
      const cy = a.y / cell;
      const prev = this.prevPos.get(a.id);
      const dt = prev ? tick - prev.tick : 0;
      const agent: RadarAgent = {
        id: a.id,
        x: cx,
        y: cy,
        species: a.species,
        alive: true,
        parentId: a.parentId,
        genome: a.genome,
      };
      if (prev && dt > 0) {
        agent.vx = (cx - prev.x) / dt;
        agent.vy = (cy - prev.y) / dt;
      }
      agents.push(agent);
      this.prevPos.set(a.id, { x: cx, y: cy, tick });
    }
    return computePrimitives({
      tick,
      stats,
      terrain: {
        food: grid.food,
        meat: grid.meat,
        minerals: grid.minerals,
        signal: grid.signal,
      },
      agents,
    });
  }

  encodeSnapshotMessage(): Uint8Array {
    const tick = this.engine.current_tick();
    const rawJson = JSON.stringify(this.engine.all_agent_states_json());
    const agents: AgentState[] = JSON.parse(rawJson);
    return encodeSnapshot(
      tick,
      this.config.params.timeScale,
      new Set(agents.map((a) => a.species)).size,
      agents.length,
      agents,
    );
  }

  encodeStatsMessage(): Uint8Array {
    return encodeStats(this.stats());
  }

  encodeSetMapMessage(): Uint8Array {
    const raw: { tick: number; size: number; depth: number[]; escape: number[] } = JSON.parse(
      JSON.stringify(this.engine.set_map_json()),
    );
    return encodeSetMap(raw.tick, raw.size, new Uint8Array(raw.depth), new Uint8Array(raw.escape));
  }

  worldStatus(paused: boolean): WorldStatus {
    return JSON.parse(JSON.stringify(this.engine.world_status_json(paused)));
  }

  applyIntervention(iv: Intervention): void {
    const serializable = {
      ...iv,
      genome: iv.genome ? Array.from(iv.genome) : undefined,
    };
    this.engine.apply_intervention_json(JSON.stringify(serializable));
    this.interventionLog.push({ tick: this.currentTick, intervention: iv });
  }

  getInterventionLog(): RecordedIntervention[] {
    return this.interventionLog.map((r) => ({
      tick: r.tick,
      intervention: { ...r.intervention },
    }));
  }

  /** Apply a stored world-grounding snapshot so a fresh engine reproduces the
   *  grounded headworld. Must run before the first tick. */
  setGrounding(enrichmentJson: string): void {
    this.engine.set_reality_json(enrichmentJson);
  }

  /** BrainConfig is `{ enabled?, lr?, gamma?, lambda?, inherit?, learn?,
   *  pomdp?, policy?, dropout?, gradNoise?, entropy? }` — omitting a field
   *  keeps the per-agent heritable gene (or the default off-state for the
   *  opt-in features). Must run before the first tick. */
  setBrainConfig(cfg: BrainConfigLike): void {
    this.engine.set_brain_json(JSON.stringify(cfg));
  }

  /** Enable/configure the stochastic world processes. `null` (or
   *  `{ enabled: false }`) disables them. Must run before the first tick. */
  setWorldStochastics(cfg: Partial<WorldStochLike> | null): void {
    this.engine.set_world_stoch_json(cfg === null ? 'null' : JSON.stringify(cfg));
  }

  /** Control whether `tick` builds the MT_DELTA render frame. Default true.
   *  Setting false yields the identical trajectory with no frame, which is how
   *  a headless run avoids render work entirely. */
  setRecordDelta(on: boolean): void {
    this.engine.set_record_delta(on);
  }

  brainStats(): { enabled: boolean; meanPlasticity: number; meanSurprise: number; plasticAgents: number } {
    return JSON.parse(JSON.stringify(this.engine.brain_stats_json()));
  }

  buildLineage(): LineageNode[] {
    const flat: Array<LineageNode & { children: LineageNode[] }> = JSON.parse(
      JSON.stringify(this.engine.build_lineage_json()),
    );
    const nodes = new Map<number, LineageNode & { children: LineageNode[] }>();
    for (const n of flat) {
      n.children = [];
      nodes.set(n.id, n);
    }
    const roots: (LineageNode & { children: LineageNode[] })[] = [];
    for (const node of nodes.values()) {
      const parent = node.parentId >= 0 ? nodes.get(node.parentId) : undefined;
      if (parent) parent.children.push(node);
      else roots.push(node);
    }
    return roots;
  }

  /** Full agent summaries including genomes — used by the genome inspector. */
  agentSummaries(): AgentSummary[] {
    const raw: Array<{
      id: number;
      parentId: number;
      bornAtTick: number;
      diedAtTick: number;
      alive: boolean;
      species: number;
      finalFitness: number;
      x: number;
      y: number;
      energy: number;
      age: number;
      genome: number[];
    }> = JSON.parse(JSON.stringify(this.engine.agent_summaries_json()));
    return raw.map((a) => ({
      id: a.id,
      parentId: a.parentId,
      genome: new Float32Array(a.genome),
      x: a.x,
      y: a.y,
      energy: a.energy,
      age: a.age,
      alive: a.alive,
      species: a.species,
      bornAtTick: a.bornAtTick,
      diedAtTick: a.diedAtTick,
      finalFitness: a.finalFitness,
    }));
  }

  static replay(
    config: WorldConfig,
    log: RecordedIntervention[],
    targetTick: number,
    groundingJson?: string,
  ): WasmSimEngine {
    const engine = new WasmSimEngine(config);
    if (groundingJson) engine.setGrounding(groundingJson);
    const byTick = new Map<number, Intervention[]>();
    for (const rec of log) {
      if (rec.tick > targetTick) break;
      const arr = byTick.get(rec.tick) ?? [];
      arr.push(rec.intervention);
      byTick.set(rec.tick, arr);
    }
    while (engine.currentTick < targetTick) {
      const atTick = byTick.get(engine.currentTick);
      if (atTick) for (const iv of atTick) engine.applyIntervention(iv);
      engine.tick();
    }
    return engine;
  }
}
