import { eq, desc, inArray } from 'drizzle-orm';
import type { WorldConfig, SimEvent } from '@fractal-life/shared';
import { getDb } from '../db/index.js';
import { worlds, snapshots, events, worldAgents } from '../db/drizzleSchema.js';
import type { AgentRecord, Storage, StoredSnapshot } from './interface.js';

function toBase64(data: Uint8Array): string {
  return Buffer.from(data).toString('base64');
}

function fromBase64(b64: string): Uint8Array {
  return new Uint8Array(Buffer.from(b64, 'base64'));
}

/** Postgres-backed storage via Drizzle ORM. Requires DATABASE_URL. */
export class PostgresStore implements Storage {
  private db = getDb();

  async saveWorld(world: WorldConfig): Promise<void> {
    await this.db.insert(worlds).values({
      id: world.id,
      seed: world.seed,
      fractalType: world.fractalType,
      params: world.params as unknown as object,
      currentTick: world.currentTick,
    }).onConflictDoUpdate({
      target: worlds.id,
      set: { seed: world.seed, fractalType: world.fractalType, params: world.params as unknown as object },
    });
  }

  async updateWorldTick(worldId: string, tick: number): Promise<void> {
    await this.db.update(worlds).set({ currentTick: tick }).where(eq(worlds.id, worldId));
  }

  async saveSnapshot(worldId: string, snap: StoredSnapshot): Promise<void> {
    await this.db.insert(snapshots).values({
      worldId,
      tick: snap.tick,
      stateHash: snap.stateHash,
      data: toBase64(snap.data),
    });
  }

  async getSnapshot(worldId: string, tick: number): Promise<StoredSnapshot | null> {
    // Nearest snapshot at-or-before the requested tick, replayed deterministically
    // by the engine from seed + intervention log when the exact tick is missing.
    const rows = await this.db
      .select()
      .from(snapshots)
      .where(eq(snapshots.worldId, worldId) as never)
      .orderBy(desc(snapshots.tick))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return { tick: row.tick, stateHash: row.stateHash, data: fromBase64(row.data) };
  }

  async getLatestSnapshot(worldId: string): Promise<StoredSnapshot | null> {
    const rows = await this.db.select().from(snapshots)
      .where(eq(snapshots.worldId, worldId) as never)
      .orderBy(desc(snapshots.tick))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return { tick: row.tick, stateHash: row.stateHash, data: fromBase64(row.data) };
  }

  async listWorlds(): Promise<WorldConfig[]> {
    const rows = await this.db.select().from(worlds);
    return rows.map((w) => ({
      id: w.id,
      seed: w.seed,
      fractalType: w.fractalType as WorldConfig['fractalType'],
      params: w.params as unknown as WorldConfig['params'],
      createdAt: w.createdAt.getTime(),
      currentTick: w.currentTick,
    }));
  }

  async getWorld(worldId: string): Promise<WorldConfig | null> {
    const rows = await this.db.select().from(worlds).where(eq(worlds.id, worldId));
    const w = rows[0];
    if (!w) return null;
    return {
      id: w.id,
      seed: w.seed,
      fractalType: w.fractalType as WorldConfig['fractalType'],
      params: w.params as unknown as WorldConfig['params'],
      createdAt: w.createdAt.getTime(),
      currentTick: w.currentTick,
    };
  }

  async saveEvents(worldId: string, eventsIn: SimEvent[]): Promise<void> {
    if (eventsIn.length === 0) return;
    await this.db.insert(events).values(
      eventsIn.map((e) => ({
        worldId,
        tick: e.tick,
        type: e.type,
        significance: e.significance,
        data: e.data as unknown as object,
      })),
    );
  }

  async listEvents(worldId: string): Promise<SimEvent[]> {
    const rows = await this.db.select().from(events)
      .where(eq(events.worldId, worldId) as never)
      .orderBy(events.tick);
    return rows.map((r) => ({
      worldId: r.worldId,
      tick: r.tick,
      type: r.type as SimEvent['type'],
      significance: r.significance,
      data: (r.data ?? {}) as Record<string, unknown>,
    }) as SimEvent);
  }

  async saveAgents(worldId: string, agentsIn: AgentRecord[]): Promise<void> {
    if (agentsIn.length === 0) return;
    const db = this.db;
    await db.insert(worldAgents).values(
      agentsIn.map((a) => ({
        id: `${worldId}-${a.simId}`,
        worldId,
        simId: a.simId,
        parentSimId: a.parentSimId,
        genome: Array.from(a.genome),
        bornAtTick: a.bornAtTick,
        diedAtTick: a.diedAtTick,
        finalFitness: a.finalFitness,
        alive: a.alive,
      })),
    );
  }

  async listAgents(worldId: string): Promise<AgentRecord[]> {
    const rows = await this.db.select().from(worldAgents)
      .where(eq(worldAgents.worldId, worldId) as never);
    return rows.map((r) => ({
      simId: r.simId,
      parentSimId: r.parentSimId,
      genome: new Float32Array(r.genome),
      bornAtTick: r.bornAtTick,
      diedAtTick: r.diedAtTick,
      finalFitness: r.finalFitness,
      alive: r.alive,
    }));
  }

  async deleteWorld(worldId: string): Promise<void> {
    const db = this.db;
    await db.delete(snapshots).where(eq(snapshots.worldId, worldId) as never);
    await db.delete(events).where(eq(events.worldId, worldId) as never);
    await db.delete(worldAgents).where(eq(worldAgents.worldId, worldId) as never);
    await db.delete(worlds).where(eq(worlds.id, worldId) as never);
  }
}
