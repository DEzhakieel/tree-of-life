import { randomUUID } from 'node:crypto';
import {
  CreateWorldSchema,
  InterventionSchema,
  DEFAULT_PARAMS,
  encodeAck,
  encodeEvent,
  encodeStats,
  encodeWorld,
  type WorldConfig,
  type WorldParams,
  type WorldStatus,
  type Intervention,
  type UniverseConfig,
  type SimEvent,
  type EnrichmentSnapshot as EnrichmentSnapshotType,
} from '@fractal-life/shared';
import { createEngine, replayEngine, type EngineLike } from './engine/index.js';
import type { Gateway, WsClient } from './gateway/types.js';
import type { Storage } from './store/interface.js';
import type { ServerConfig } from './config.js';
import type { GroundingService } from './data/groundingService.js';

interface WorldRuntime {
  config: WorldConfig;
  engine: EngineLike;
  clients: Set<WsClient>;
  paused: boolean;
  /** ticks per second this world targets (client-adjustable via the rate slider) */
  tps: number;
  ticker: ReturnType<typeof setInterval> | null;
  lastTickMs: number;
  /** rolling window of tick durations for the tickRate stat */
  tickWindow: number[];
  /** per-world authoritative intervention sequence */
  sequence: number;
  /** rolling window of observables for the neural-forecast endpoint */
  statsRing: Array<{ tick: number; values: Record<string, number> }>;
  /** events buffered for the next batched storage write (bounded by flush cadence) */
  eventBuf: SimEvent[];
}

/** Events are persisted in batches of this size (plus a stats-cadence flush)
 *  instead of one INSERT per event. */
const EVENT_FLUSH_SIZE = 100;

/**
 * Owns all live worlds. Each world runs its own deterministic Engine on a
 * setInterval; the DELTA frame produced by every tick is broadcast to the
 * room of connected clients. Interventions are recorded (they are the only
 * source of non-determinism beyond the seed) so any tick can be replayed.
 */
export class WorldManager {
  private worlds = new Map<string, WorldRuntime>();

  constructor(
    private gateway: Gateway,
    private storage: Storage,
    private config: ServerConfig,
    private grounding: GroundingService,
  ) {
    gateway.onMessage((client, data) => void this.handleMessage(client, data));
    gateway.onDisconnect((client) => this.handleDisconnect(client));
  }

  // ---------------------------------------------------------------------------
  // World lifecycle
  // ---------------------------------------------------------------------------

  async createWorld(input: {
    seed?: string;
    fractalType?: 'mandelbrot' | 'julia' | 'perlin';
    params?: Partial<WorldParams>;
    cellBio?: boolean;
    biophysics?: boolean;
    omics?: boolean;
    omicsStochastic?: boolean;
    combinatorial?: boolean;
    recombination?: boolean;
    universe?: UniverseConfig;
    grounding?: EnrichmentSnapshotType;
  }): Promise<WorldConfig> {
    if (this.worlds.size >= this.config.maxWorlds) {
      throw new Error(`world limit reached (${this.config.maxWorlds})`);
    }
    const parsed = CreateWorldSchema.parse(input.seed !== undefined && input.seed.trim().length === 0 ? { ...input, seed: undefined } : input);
    const world: WorldConfig = {
      id: randomUUID(),
      seed: parsed.seed ?? randomUUID(),
      fractalType: parsed.fractalType ?? 'mandelbrot',
      params: { ...DEFAULT_PARAMS, ...(parsed.params ?? {}) },
      createdAt: Date.now(),
      currentTick: 0,
    };
    if (parsed.cellBio !== undefined) world.cellBio = parsed.cellBio;
    if (parsed.biophysics !== undefined) world.biophysics = parsed.biophysics;
    if (parsed.omics !== undefined) world.omics = parsed.omics;
    if (parsed.omicsStochastic !== undefined) world.omicsStochastic = parsed.omicsStochastic;
    if (parsed.combinatorial !== undefined) world.combinatorial = parsed.combinatorial;
    if (parsed.recombination !== undefined) world.recombination = parsed.recombination;
    if (parsed.universe !== undefined) world.universe = parsed.universe;
    if (parsed.grounding !== undefined) world.grounding = parsed.grounding;
    const engine = await createEngine(world, this.groundingJsonFor(world));
    const runtime: WorldRuntime = {
      config: world,
      engine,
      clients: new Set(),
      paused: false,
      tps: this.config.tickRate,
      ticker: null,
      lastTickMs: 0,
      tickWindow: [],
      sequence: 0,
      statsRing: [],
      eventBuf: [],
    };
    this.worlds.set(world.id, runtime);
    await this.storage.saveWorld(world);
    // The ticker starts on the first join; idle worlds must not burn CPU.
    return world;
  }

  /** Grounding JSON for a world: its own snapshot when present (client-supplied
   *  or loaded from storage), otherwise the server-global enrichment snapshot. */
  private groundingJsonFor(world: WorldConfig): string | undefined {
    if (world.grounding) return JSON.stringify(world.grounding);
    return this.grounding.snapshotJsonString() ?? undefined;
  }

  async loadPersistedWorlds(): Promise<void> {
    const existing = await this.storage.listWorlds();
    for (const world of existing) {
      const engine = await createEngine(world, this.groundingJsonFor(world));
      const runtime: WorldRuntime = {
        config: world,
        engine,
        clients: new Set(),
        paused: false,
        tps: this.config.tickRate,
        ticker: null,
        lastTickMs: 0,
        tickWindow: [],
        sequence: 0,
        statsRing: [],
        eventBuf: [],
      };
      this.worlds.set(world.id, runtime);
      // persisted worlds start paused and tick only after a client joins
    }
  }

  getWorldConfig(id: string): WorldConfig | undefined {
    return this.worlds.get(id)?.config;
  }

  listWorlds(): WorldStatus[] {
    const out: WorldStatus[] = [];
    for (const rt of this.worlds.values()) out.push(rt.engine.worldStatus(rt.paused));
    return out;
  }

  async destroyWorld(id: string): Promise<void> {
    const rt = this.worlds.get(id);
    if (!rt) return;
    if (rt.ticker) clearInterval(rt.ticker);
    this.flushEvents(rt);
    for (const c of rt.clients) c.close();
    this.worlds.delete(id);
  }

  /** Persist a world's buffered events as a single storage call. */
  private flushEvents(rt: WorldRuntime): void {
    if (rt.eventBuf.length === 0) return;
    const batch = rt.eventBuf;
    rt.eventBuf = [];
    void this.storage
      .saveEvents(rt.config.id, batch)
      .catch((err) => console.warn('[worldManager] event batch save failed:', (err as Error).message));
  }

  /** Drain every world's buffered events and await the writes (shutdown/tests). */
  async flushAllEvents(): Promise<void> {
    for (const rt of this.worlds.values()) {
      if (rt.eventBuf.length === 0) continue;
      const batch = rt.eventBuf;
      rt.eventBuf = [];
      try {
        await this.storage.saveEvents(rt.config.id, batch);
      } catch (err) {
        console.warn('[worldManager] event batch save failed:', (err as Error).message);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Tick loop
  // ---------------------------------------------------------------------------

  private startTicker(rt: WorldRuntime): void {
    if (rt.ticker) return;
    rt.ticker = setInterval(() => this.step(rt), 1000 / rt.tps);
  }

  private stopTicker(rt: WorldRuntime): void {
    if (rt.ticker) {
      clearInterval(rt.ticker);
      rt.ticker = null;
    }
    // an idle world must not strand its buffered events
    this.flushEvents(rt);
  }

  /** Adjust a world's target tick rate (1..120 tps); a live ticker is restarted. */
  setTickRate(worldId: string, tps: number): void {
    const rt = this.worlds.get(worldId);
    if (!rt) return;
    rt.tps = Math.max(1, Math.min(120, Math.round(Number.isFinite(tps) ? tps : this.config.tickRate)));
    if (rt.ticker) {
      clearInterval(rt.ticker);
      rt.ticker = setInterval(() => this.step(rt), 1000 / rt.tps);
    }
    // the rolling window would otherwise hide the new cadence for minutes
    rt.tickWindow.length = 0;
  }

  private step(rt: WorldRuntime, manual = false): void {
    if (rt.paused && !manual) return;
    const t0 = performance.now();
    const result = rt.engine.tick();
    const dt = performance.now() - t0;
    rt.lastTickMs = dt;
    rt.tickWindow.push(dt);
    if (rt.tickWindow.length > 120) rt.tickWindow.shift();

    this.broadcast(rt, result.delta);

    if (result.events.length > 0) {
      for (const e of result.events) this.broadcast(rt, encodeEvent(e));
      rt.eventBuf.push(...result.events);
      if (rt.eventBuf.length >= EVENT_FLUSH_SIZE) this.flushEvents(rt);
    }

    if (manual || result.tick % this.config.statsEveryTicks === 0) {
      const stats = rt.engine.stats();
      const avg = rt.tickWindow.reduce((a, b) => a + b, 0) / Math.max(1, rt.tickWindow.length);
      stats.tickRate = avg > 0 ? 1000 / avg : this.config.tickRate;
      this.broadcast(rt, encodeStats(stats));
      void this.storage.updateWorldTick(rt.config.id, result.tick);
      // manual steps keep buffering (they are sparse); the live ticker flushes
      // on this same cadence so persisted logs trail by at most statsEveryTicks
      if (!manual) this.flushEvents(rt);
      // rolling observables for the neural-forecast endpoint
      rt.statsRing.push({ tick: result.tick, values: {
        aliveCount: stats.aliveCount,
        speciesCount: stats.speciesCount,
        avgEnergy: stats.avgEnergy,
        entropy: stats.entropy,
        complexity: stats.complexity,
        diversity: stats.diversity,
        predatorFraction: stats.predatorFraction,
        meanPlasticity: stats.meanPlasticity,
        meanSurprise: stats.meanSurprise,
      } });
      if (rt.statsRing.length > 512) rt.statsRing.shift();
    }

    if (result.tick % this.config.snapshotEveryTicks === 0) {
      const frame = rt.engine.encodeSnapshotMessage();
      const snap = { tick: result.tick, stateHash: rt.engine.computeStateHash(), data: frame };
      void this.storage.saveSnapshot(rt.config.id, snap);
      void this.storage.saveAgents(rt.config.id, rt.engine.agentSummaries().map((a) => ({
        simId: a.id,
        parentSimId: a.parentId,
        genome: a.genome,
        bornAtTick: a.bornAtTick,
        diedAtTick: a.alive ? null : a.diedAtTick,
        finalFitness: a.finalFitness,
        alive: a.alive,
      })));
      // the evolved set rides along with each snapshot cadence
      this.broadcast(rt, rt.engine.encodeSetMapMessage());
    }
  }

  // ---------------------------------------------------------------------------
  // Client messaging
  // ---------------------------------------------------------------------------

  private handleMessage(client: WsClient, data: Uint8Array | string): void {
    let msg: Record<string, unknown>;
    try {
      msg = typeof data === 'string' ? JSON.parse(data) : JSON.parse(new TextDecoder().decode(data));
    } catch {
      return; // ignore malformed frames
    }
    switch (msg.op) {
      case 'join':
        void this.handleJoin(client, msg.worldId as string);
        break;
      case 'intervene':
        void this.handleIntervene(client, msg);
        break;
      case 'play':
        this.setPaused(msg.worldId as string, false);
        break;
      case 'pause':
        this.setPaused(msg.worldId as string, true);
        break;
      case 'step': {
        const rt = this.worlds.get(msg.worldId as string);
        if (rt) this.step(rt, true);
        break;
      }
      case 'rate':
        this.setTickRate(msg.worldId as string, msg.tps as number);
        break;
      case 'ping':
        client.send(JSON.stringify({ op: 'pong' }));
        break;
      case 'snapshot':
        void this.handleSnapshot(client, msg);
        break;
      default:
        break;
    }
  }

  private handleDisconnect(client: WsClient): void {
    for (const rt of this.worlds.values()) {
      if (rt.clients.delete(client) && rt.clients.size === 0) {
        // last viewer left: stop the tick loop so idle worlds don't consume CPU
        this.stopTicker(rt);
      }
    }
  }

  private handleJoin(client: WsClient, worldId: string): void {
    const rt = this.worlds.get(worldId);
    if (!rt) {
      // no world: notify on the event channel with a zeroed, schema-valid payload
      client.send(encodeEvent({ worldId, tick: 0, type: 'extinction', significance: 0, data: { from: 0, to: 0 } }));
      client.close();
      return;
    }
    rt.clients.add(client);
    this.startTicker(rt);
    client.send(encodeWorld(rt.config, rt.engine.worldStatus(rt.paused)));
    client.send(rt.engine.encodeSnapshotMessage());
    client.send(rt.engine.encodeStatsMessage());
    client.send(rt.engine.encodeSetMapMessage());
  }

  private async handleIntervene(client: WsClient, msg: Record<string, unknown>): Promise<void> {
    const worldId = msg.worldId as string;
    const rt = this.worlds.get(worldId);
    if (!rt) return;
    try {
      const iv = InterventionSchema.parse({
        ...(msg.intervention as object),
        sequence: rt.sequence++,
      }) as unknown as Intervention;
      rt.engine.applyIntervention(iv);
      client.send(encodeAck(iv.sequence));
      // Persist a deterministic restore point after state-changing interventions.
      const frame = rt.engine.encodeSnapshotMessage();
      await this.storage.saveSnapshot(worldId, {
        tick: rt.engine.currentTick,
        stateHash: rt.engine.computeStateHash(),
        data: frame,
      });
    } catch (err) {
      console.warn('[worldManager] invalid intervention:', (err as Error).message);
      /* invalid intervention */
    }
  }

  private async handleSnapshot(client: WsClient, msg: Record<string, unknown>): Promise<void> {
    const worldId = msg.worldId as string;
    const rt = this.worlds.get(worldId);
    if (!rt) return;
    const tick = typeof msg.tick === 'number' && Number.isFinite(msg.tick) ? msg.tick : undefined;
    let frame: Uint8Array<ArrayBufferLike>;
    if (tick === undefined || tick >= rt.engine.currentTick) {
      frame = rt.engine.encodeSnapshotMessage();
    } else {
      const log = rt.engine.getInterventionLog();
      const replay = await replayEngine(rt.config, log, tick, this.groundingJsonFor(rt.config));
      frame = replay.encodeSnapshotMessage();
    }
    client.send(frame);
  }

  // ---------------------------------------------------------------------------

  /** Rolling observables of a live world's statistics, for neural forecasting. */
  statsRing(id: string): Array<{ tick: number; values: Record<string, number> }> {
    return this.worlds.get(id)?.statsRing ?? [];
  }

  private setPaused(worldId: string, paused: boolean): void {
    const rt = this.worlds.get(worldId);
    if (rt) {
      rt.paused = paused;
      this.broadcast(rt, encodeWorld(rt.config, rt.engine.worldStatus(rt.paused)));
    }
  }

  private broadcast(rt: WorldRuntime, data: Uint8Array<ArrayBufferLike>): void {
    for (const c of rt.clients) c.send(data);
  }

  getRuntime(id: string): WorldRuntime | undefined {
    return this.worlds.get(id);
  }
}
