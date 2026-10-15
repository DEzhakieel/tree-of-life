import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { WorldManager } from '../src/worldManager.js';
import { config } from '../src/config.js';
import { GroundingService } from '../src/data/groundingService.js';
import type { Gateway, WsClient } from '../src/gateway/types.js';
import type { Storage, StoredSnapshot, AgentRecord } from '../src/store/interface.js';
import type { WorldConfig, SimEvent } from '@fractal-life/shared';

class StubGateway implements Gateway {
  readonly kind = 'ws' as const;
  onConnect(_cb: (client: WsClient) => void): void {}
  onMessage(_cb: (client: WsClient, data: Uint8Array | string) => void): void {}
  onDisconnect(_cb: (client: WsClient) => void): void {}
  async start(): Promise<void> {}
  async stop(): Promise<void> {}
}

/** Records every saveEvents call as a batch so the test can assert on the
 *  write pattern, not just the totals. */
class RecordingStorage implements Storage {
  readonly batches: SimEvent[][] = [];
  private worlds = new Map<string, WorldConfig>();

  get totalEvents(): number {
    return this.batches.reduce((a, b) => a + b.length, 0);
  }

  async saveWorld(world: WorldConfig): Promise<void> {
    this.worlds.set(world.id, world);
  }
  async updateWorldTick(_worldId: string, _tick: number): Promise<void> {}
  async saveSnapshot(_worldId: string, _snap: StoredSnapshot): Promise<void> {}
  async getSnapshot(_worldId: string, _tick: number): Promise<StoredSnapshot | null> {
    return null;
  }
  async getLatestSnapshot(_worldId: string): Promise<StoredSnapshot | null> {
    return null;
  }
  async listWorlds(): Promise<WorldConfig[]> {
    return [...this.worlds.values()];
  }
  async getWorld(worldId: string): Promise<WorldConfig | null> {
    return this.worlds.get(worldId) ?? null;
  }
  async saveEvents(_worldId: string, events: SimEvent[]): Promise<void> {
    this.batches.push(events);
  }
  async listEvents(_worldId: string): Promise<SimEvent[]> {
    return [];
  }
  async saveAgents(_worldId: string, _agents: AgentRecord[]): Promise<void> {}
  async listAgents(_worldId: string): Promise<AgentRecord[]> {
    return [];
  }
}

describe('worldManager event persistence', () => {
  it('buffers per-tick events into batched storage writes', async () => {
    const store = new RecordingStorage();
    const wm = new WorldManager(new StubGateway(), store, config, new GroundingService());
    const world = await wm.createWorld({ seed: 'event-batching', params: { spawnCount: 5 } });
    const rt = wm.getRuntime(world.id);
    assert.ok(rt, 'runtime exists');
    const step = (wm as unknown as { step(rt: unknown, manual?: boolean): void }).step.bind(wm) as (
      rt: unknown,
      manual?: boolean,
    ) => void;

    // every intervention logs exactly one intervention event on the next tick;
    // 105 manual steps exceed the 100-event flush threshold
    for (let i = 0; i < 105; i++) {
      rt.engine.applyIntervention({ type: 'meteor', x: 512, y: 512, radius: 128, sequence: i });
      step(rt, true);
    }
    await wm.flushAllEvents();

    assert.ok(
      store.totalEvents >= 105,
      `expected at least one event per intervention (got ${store.totalEvents})`,
    );
    assert.ok(
      store.batches.length <= 4,
      `expected batched writes, got ${store.batches.length} calls for ${store.totalEvents} events`,
    );
    // every write before the final drain must be a full size-triggered batch;
    // the old per-event code produced one call per event
    for (let i = 0; i < store.batches.length - 1; i++) {
      assert.ok(
        store.batches[i]!.length >= 100,
        `write ${i} had ${store.batches[i]!.length} events, expected >= 100`,
      );
    }

    await wm.destroyWorld(world.id);
  });

  it('destroyWorld drains a small buffer that never hit the size threshold', async () => {
    const store = new RecordingStorage();
    const wm = new WorldManager(new StubGateway(), store, config, new GroundingService());
    const world = await wm.createWorld({ seed: 'event-drain', params: { spawnCount: 5 } });
    const rt = wm.getRuntime(world.id)!;
    const step = (wm as unknown as { step(rt: unknown, manual?: boolean): void }).step.bind(wm) as (
      rt: unknown,
      manual?: boolean,
    ) => void;

    rt.engine.applyIntervention({ type: 'seedFood', x: 100, y: 100, amount: 5, sequence: 0 });
    step(rt, true);
    rt.engine.applyIntervention({ type: 'seedFood', x: 200, y: 200, amount: 5, sequence: 1 });
    step(rt, true);
    assert.equal(store.batches.length, 0, 'small buffers must stay buffered');

    await wm.destroyWorld(world.id);
    assert.equal(store.batches.length, 1, 'destroyWorld must flush');
    assert.ok(store.batches[0]!.length >= 2, 'both intervention events must survive');
    const interventions = store.batches[0]!.filter((e) => e.type === 'intervention');
    assert.equal(interventions.length, 2, 'both seedFood interventions must be in the drained buffer');
  });
});
