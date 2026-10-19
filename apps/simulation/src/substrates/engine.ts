import type {
  AgentState,
  AgentSummary,
  Intervention,
  LineageNode,
  RadarSample,
  SimEvent,
  SimStats,
  WorldConfig,
  WorldParams,
  WorldStatus,
} from '@fractal-life/shared';
import { WORLD_SIZE, emptySimStats, encodeDelta, encodeSetMap, encodeSnapshot, substrateKind } from '@fractal-life/shared';
import { GraphSubstrate } from './graph.js';
import { LatticeSubstrate } from './lattice.js';
import { ParticleSubstrate } from './particles.js';
import type { SubstrateKernel } from './types.js';

/** Pick the pure-TS kernel for the world's substrate (null for 'agents'). */
export function createSubstrateKernel(world: WorldConfig): SubstrateKernel | null {
  switch (substrateKind(world)) {
    case 'particles':
      return new ParticleSubstrate(world);
    case 'lattice':
      return new LatticeSubstrate(world);
    case 'graph':
      return new GraphSubstrate(world);
    default:
      return null;
  }
}

/**
 * Adapter exposing a {@link SubstrateKernel} through the same duck-typed
 * surface the web worker uses on the WASM engine: binary frame encoders,
 * stats, world status and interventions. Frames are the shared wire codecs, so
 * the renderer, stats pipeline and terminal cannot tell which engine produced
 * them — only time travel (snapshot to a past tick) is unavailable, because
 * substrate states are not replayed.
 */
export class SubstrateEngine {
  readonly config: WorldConfig;
  private readonly kernel: SubstrateKernel;
  private readonly rows: AgentState[] = [];
  private interventions = 0;
  private recordDelta = true;
  private pendingInterventions: SimEvent[] = [];

  constructor(world: WorldConfig) {
    const kernel = createSubstrateKernel(world);
    if (!kernel) {
      throw new Error(`world ${world.id} has no substrate kernel (kind=${substrateKind(world)})`);
    }
    this.config = world;
    this.kernel = kernel;
  }

  get params(): WorldParams {
    return this.config.params;
  }

  get currentTick(): number {
    return this.kernel.currentTick;
  }

  get kind(): string {
    return this.kernel.kind;
  }

  /** Advance one tick. The delta is a shared MT_DELTA frame (empty when the
   *  host suppressed rendering); events carry this tick's kernel events plus
   *  any interventions applied since the last tick. */
  tick(): { delta: Uint8Array; events: SimEvent[] } {
    const events = this.pendingInterventions;
    this.pendingInterventions = [];
    for (const ev of this.kernel.step()) events.push(ev);
    let delta: Uint8Array = new Uint8Array(0);
    if (this.recordDelta) {
      this.kernel.writeRows(this.rows);
      delta = encodeDelta(this.kernel.currentTick, this.rows);
    }
    return { delta, events };
  }

  stats(): SimStats {
    const s = emptySimStats(this.kernel.currentTick, this.params.timeScale);
    this.kernel.writeStats(s);
    return s;
  }

  encodeSnapshotMessage(): Uint8Array {
    this.kernel.writeRows(this.rows);
    return encodeSnapshot(
      this.kernel.currentTick,
      this.params.timeScale,
      this.kernel.speciesCount,
      this.kernel.population,
      this.rows,
    );
  }

  encodeSetMapMessage(): Uint8Array {
    const fields = this.kernel.setMapFields();
    if (!fields) return new Uint8Array(0);
    return encodeSetMap(this.kernel.currentTick, fields.size, fields.depth, fields.escape);
  }

  worldStatus(paused: boolean): WorldStatus {
    return {
      id: this.config.id,
      seed: this.config.seed,
      fractalType: this.config.fractalType,
      params: this.params,
      currentTick: this.kernel.currentTick,
      population: this.kernel.population,
      aliveCount: this.kernel.population,
      speciesCount: this.kernel.speciesCount,
      createdAt: this.config.createdAt,
      interventions: this.interventions,
      paused,
    };
  }

  /** Substrates have no terrain-orbit lineage to sample — emit a neutral row
   *  so the radar panel keeps its cadence without inventing primitives. */
  radarSample(): RadarSample {
    return { tick: this.kernel.currentTick, primitives: {}, measured: [] };
  }

  applyIntervention(iv: Intervention): void {
    const x = iv.x ?? WORLD_SIZE / 2;
    const y = iv.y ?? WORLD_SIZE / 2;
    switch (iv.type) {
      case 'spawnAgent':
        this.kernel.spawn(x, y);
        break;
      case 'nuke':
        this.kernel.kill(x, y, iv.radius ?? 120);
        break;
      case 'meteor':
        this.kernel.kill(x, y, iv.radius ?? 160);
        break;
      case 'seedFood':
        this.kernel.feed(x, y, iv.amount ?? 100);
        break;
      case 'setTimeScale':
        this.kernel.setTimeScale(iv.timeScale ?? this.params.timeScale);
        break;
      default:
        // pauseRegion / setGene are agent-engine concepts; no-ops here
        break;
    }
    this.interventions++;
    this.pendingInterventions.push({
      worldId: this.config.id,
      tick: this.kernel.currentTick,
      significance: 0.6,
      type: 'intervention',
      data: { itype: iv.type, x, y },
    } as SimEvent);
  }

  setRecordDelta(on: boolean): void {
    this.recordDelta = on;
  }

  /** Agent-engine tuning knobs — accepted and ignored so the worker's init
   *  path stays identical for both engines. */
  setBrainConfig(_cfg: unknown): void {}
  setWorldStochastics(_stoch: unknown): void {}

  getInterventionLog(): Intervention[] {
    return [];
  }

  buildLineage(): LineageNode[] {
    return [];
  }

  agentSummaries(): AgentSummary[] {
    this.kernel.writeRows(this.rows);
    return this.rows.map((r) => ({
      id: r.id,
      parentId: -1,
      genome: new Float32Array(0),
      x: r.x,
      y: r.y,
      energy: r.energy,
      age: 0,
      alive: true,
      species: r.species,
      bornAtTick: 0,
      diedAtTick: 0,
      finalFitness: 0,
    }));
  }
}
