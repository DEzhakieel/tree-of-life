import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  encodeSnapshot,
  encodeStats,
  encodeSetMap,
  emptySimStats,
  type SimStats,
  type SimEvent,
  type AgentState,
  type WorldConfig,
  type WorldStatus,
  type Intervention,
  type AgentSummary,
  type LineageNode,
} from '@fractal-life/shared';
import { initSync, WasmEngine as RawWasmEngine } from '../../../../crates/wasm/pkg/fractal_life_wasm.js';

// Stats are only computed by tick(); before the first tick the engine has no
// stats to report, so the fallback is a neutral zero-row (same shape the
// browser adapter emits) instead of an engine call that cannot exist yet.
const EngineWithStats = RawWasmEngine;

/** Newer wasm exports (set_brain_json / brain_stats_json) land on the engine
 *  but postdate the generated TS bindings — bridged with a cast until the
 *  wasm-pack build regenerates the glue (same pattern as stats_json above). */
const EngineWithBrain = RawWasmEngine as unknown as {
  set_brain_json(json: string): void;
  brain_stats_json(): unknown;
  set_world_stoch_json(json: string): void;
};

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

export interface TickResult {
  tick: number;
  delta: Uint8Array;
  deltaCount: number;
  stats: SimStats;
  events: SimEvent[];
}

interface RecordedIntervention {
  tick: number;
  intervention: Intervention;
}

let wasmInitialized = false;

function ensureWasmSync(): void {
  if (wasmInitialized) return;
  const here = dirname(fileURLToPath(import.meta.url));
  const wasmPath = join(here, '..', '..', '..', '..', 'crates', 'wasm', 'pkg', 'fractal_life_wasm_bg.wasm');
  const bytes = readFileSync(wasmPath);
  const module = new (globalThis as any).WebAssembly.Module(bytes);
  initSync({ module });
  wasmInitialized = true;
}

function parseStats(json: unknown): SimStats {
  return JSON.parse(JSON.stringify(json)) as SimStats;
}

function parseEvents(json: unknown): SimEvent[] {
  return JSON.parse(JSON.stringify(json)) as SimEvent[];
}

export class WasmSimEngine {
  private engine: RawWasmEngine;
  readonly config: WorldConfig;
  private interventionLog: RecordedIntervention[] = [];
  private lastStats: SimStats | null = null;

  constructor(config: WorldConfig) {
    ensureWasmSync();
    this.engine = new EngineWithStats(JSON.stringify(config));
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
    // No tick has run yet on a freshly created world: real observables only
    // materialise from tick(), so synth a zero-row rather than mutating the
    // engine just to answer a status probe. Alive population is available.
    const alive = this.engine.alive_count();
    return emptySimStats(this.currentTick, this.config.params.timeScale, {
      population: alive,
      aliveCount: alive,
    });
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

  computeStateHash(): number {
    return this.engine.compute_state_hash();
  }

  encodeSnapshotMessage(): Uint8Array {
    const tick = this.engine.current_tick();
    const agents: AgentState[] = JSON.parse(JSON.stringify(this.engine.all_agent_states_json()));
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

  getInterventionLog(): RecordedIntervention[] {
    return this.interventionLog.map((r) => ({
      tick: r.tick,
      intervention: { ...r.intervention },
    }));
  }

  setGrounding(enrichmentJson: string): void {
    this.engine.set_reality_json(enrichmentJson);
  }

  /** BrainConfig is `{ enabled?, lr?, gamma?, lambda?, inherit?, learn?,
   *  pomdp?, policy?, dropout?, gradNoise?, entropy? }` — omitting a field
   *  keeps the per-agent heritable gene (or the default off-state for the
   *  opt-in features). Must run before the first tick. */
  setBrainConfig(cfg: BrainConfigLike): void {
    (this.engine as unknown as typeof EngineWithBrain).set_brain_json(JSON.stringify(cfg));
  }

  /** Enable/configure the stochastic world processes. `null` (or
   *  `{ enabled: false }`) disables them. Must run before the first tick. */
  setWorldStochastics(cfg: Partial<WorldStochLike> | null): void {
    (this.engine as unknown as typeof EngineWithBrain).set_world_stoch_json(cfg === null ? 'null' : JSON.stringify(cfg));
  }

  brainStats(): { enabled: boolean; meanPlasticity: number; meanSurprise: number; plasticAgents: number } {
    return JSON.parse(JSON.stringify((this.engine as unknown as typeof EngineWithBrain).brain_stats_json()));
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
