import { describe, it, before, after } from 'node:test';
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

class StubStorage implements Storage {
  private worlds: Record<string, WorldConfig> = {};
  async saveWorld(world: WorldConfig): Promise<void> {
    this.worlds[world.id] = world;
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
    return Object.values(this.worlds);
  }
  async getWorld(worldId: string): Promise<WorldConfig | null> {
    return this.worlds[worldId] ?? null;
  }
  async saveEvents(_worldId: string, _events: SimEvent[]): Promise<void> {}
  async listEvents(_worldId: string): Promise<SimEvent[]> {
    return [];
  }
  async saveAgents(_worldId: string, _agents: AgentRecord[]): Promise<void> {}
  async listAgents(_worldId: string): Promise<AgentRecord[]> {
    return [];
  }
  async deleteWorld(_worldId: string): Promise<void> {}
}

describe('WorldManager.createWorld config forwarding', () => {
  let wm: WorldManager;
  let storage: StubStorage;
  const created: string[] = [];

  before(async () => {
    storage = new StubStorage();
    wm = new WorldManager(new StubGateway(), storage, config, new GroundingService());
  });

  after(async () => {
    for (const id of created) await wm.destroyWorld(id);
  });

  it('forwards cellBio from the client into the stored WorldConfig', async () => {
    const world = await wm.createWorld({ seed: 'cellbio-on', params: { spawnCount: 10 }, cellBio: true });
    created.push(world.id);
    const persisted = await storage.getWorld(world.id);
    assert.equal(world.cellBio, true);
    assert.equal(persisted?.cellBio, true, 'flagged world must be persisted with cellBio');
  });

  it('leaves cellBio absent when the client does not send it (OFF by default)', async () => {
    const world = await wm.createWorld({ seed: 'cellbio-off', params: { spawnCount: 10 } });
    created.push(world.id);
    assert.equal(world.cellBio, undefined);
  });

  it('forwards universe from the client into the stored WorldConfig', async () => {
    const universe = { localGravity: 1.62, planetRadius: 1.7e6 };
    const world = await wm.createWorld({ seed: 'universe-on', params: { spawnCount: 10 }, universe });
    created.push(world.id);
    const persisted = await storage.getWorld(world.id);
    assert.equal(world.universe?.localGravity, 1.62);
    assert.deepEqual(persisted?.universe, universe, 'flagged world must be persisted with universe');
  });

  it('forwards grounding from the client into the stored WorldConfig', async () => {
    const g = new GroundingService();
    const base = g.snapshotJson();
    assert.ok(base, 'enrichment snapshot must be loadable for this test');
    const grounding = structuredClone(base);
    grounding.toolchain = 'client-supplied';
    const world = await wm.createWorld({ seed: 'grounding-on', params: { spawnCount: 10 }, grounding });
    created.push(world.id);
    const persisted = await storage.getWorld(world.id);
    assert.equal(world.grounding?.toolchain, 'client-supplied');
    assert.equal(persisted?.grounding?.toolchain, 'client-supplied', 'flagged world must be persisted with grounding');
  });

  it('rejects a malformed grounding payload at the schema boundary', async () => {
    await assert.rejects(
      wm.createWorld({ seed: 'grounding-bad', params: { spawnCount: 10 }, grounding: { bogus: true } as never }),
      /grounding/,
    );
  });
});