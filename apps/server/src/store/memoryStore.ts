import type { WorldConfig, SimEvent } from '@fractal-life/shared';
import type { AgentRecord, Storage, StoredSnapshot } from './interface.js';

/**
 * In-memory store (MVP / no-Postgres environments). Deterministic snapshots are
 * held as binary frames so replay from seed + intervention log stays the
 * source of truth.
 */

/** Hard cap on retained events per world (keep-earliest). The event log's
 *  authoritative home is Postgres; this bound keeps no-database runs finite. */
const MAX_EVENTS_PER_WORLD = 5000;

export class MemoryStore implements Storage {
  private worlds = new Map<string, WorldConfig>();
  private snapshots = new Map<string, Map<number, StoredSnapshot>>();
  private events = new Map<string, SimEvent[]>();
  private agents = new Map<string, AgentRecord[]>();

  async saveWorld(world: WorldConfig): Promise<void> {
    this.worlds.set(world.id, world);
  }

  async updateWorldTick(_worldId: string, _tick: number): Promise<void> {
    // no-op: in-memory worlds keep config as created; tick lives in the engine
  }

  async saveSnapshot(worldId: string, snap: StoredSnapshot): Promise<void> {
    let bucket = this.snapshots.get(worldId);
    if (!bucket) {
      bucket = new Map();
      this.snapshots.set(worldId, bucket);
    }
    bucket.set(snap.tick, snap);
  }

  async getSnapshot(worldId: string, tick: number): Promise<StoredSnapshot | null> {
    return this.snapshots.get(worldId)?.get(tick) ?? null;
  }

  async getLatestSnapshot(worldId: string): Promise<StoredSnapshot | null> {
    const bucket = this.snapshots.get(worldId);
    if (!bucket || bucket.size === 0) return null;
    let best: StoredSnapshot | null = null;
    for (const s of bucket.values()) {
      if (!best || s.tick > best.tick) best = s;
    }
    return best;
  }

  async listWorlds(): Promise<WorldConfig[]> {
    return [...this.worlds.values()];
  }

  async getWorld(worldId: string): Promise<WorldConfig | null> {
    return this.worlds.get(worldId) ?? null;
  }

  async saveEvents(worldId: string, events: SimEvent[]): Promise<void> {
    const bucket = this.events.get(worldId) ?? [];
    for (const e of events) bucket.push(e);
    if (bucket.length > MAX_EVENTS_PER_WORLD) {
      bucket.splice(0, bucket.length - MAX_EVENTS_PER_WORLD);
    }
    this.events.set(worldId, bucket);
  }

  async listEvents(worldId: string): Promise<SimEvent[]> {
    return (this.events.get(worldId) ?? []).slice();
  }

  async saveAgents(worldId: string, agents: AgentRecord[]): Promise<void> {
    const bucket = this.agents.get(worldId) ?? [];
    bucket.push(...agents);
    this.agents.set(worldId, bucket);
  }

  async listAgents(worldId: string): Promise<AgentRecord[]> {
    return this.agents.get(worldId) ?? [];
  }

  async deleteWorld(worldId: string): Promise<void> {
    this.worlds.delete(worldId);
    this.snapshots.delete(worldId);
    this.events.delete(worldId);
    this.agents.delete(worldId);
  }
}
