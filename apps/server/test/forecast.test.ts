import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { createApi } from '../src/api/index.js';
import { WorldManager } from '../src/worldManager.js';
import { config } from '../src/config.js';
import { GroundingService } from '../src/data/groundingService.js';
import type { Gateway, WsClient } from '../src/gateway/types.js';
import type { Storage, StoredSnapshot, AgentRecord } from '../src/store/interface.js';
import type { WorldConfig, SimEvent } from '@fractal-life/shared';

/** Transport + persistence stand-ins; the endpoint under test only needs the
 *  world's engine + statsRing, both of which live on the WorldManager. */
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
}

interface TestRuntime {
  engine: {
    tick(): unknown;
    currentTick: number;
    stats(): Record<string, number> & { aliveCount: number; speciesCount: number; avgEnergy: number; entropy: number; complexity: number; diversity: number; predatorFraction: number; meanPlasticity: number; meanSurprise: number };
  };
  statsRing: Array<{ tick: number; values: Record<string, number> }>;
}

describe('/api/worlds/:id/forecast', () => {
  const storage = new StubStorage();
  const gateway = new StubGateway();
  const grounding = new GroundingService();
  let wm: WorldManager;
  let server: http.Server;
  let baseUrl: string;
  let worldId: string;
  let emptyWorldId: string;

  before(async () => {
    wm = new WorldManager(gateway, storage, config, grounding);
    const app = express();
    app.use(express.json());
    app.use('/api', createApi(wm, storage, gateway, grounding));
    app.use('/api', (_req, res) => res.status(404).json({ error: 'not found' }));
    app.use('/api', (err: Error, _req: unknown, res: express.Response, _next: unknown) => {
      res.status(500).json({ error: err.message });
    });
    server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const { port } = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${port}/api`;

    // a world with no samples yet — must 400
    emptyWorldId = (await wm.createWorld({ seed: 'forecast-empty', params: { spawnCount: 40 } })).id;

    // a live world: tick the engine and push the same observable rows the
    // server's step() loop records, then forecast off the real numbers
    const world = await wm.createWorld({ seed: 'forecast-live', params: { spawnCount: 60 } });
    worldId = world.id;
    const rt = (wm as unknown as { getRuntime(id: string): TestRuntime }).getRuntime(worldId);
    for (let i = 0; i < 40; i++) {
      rt.engine.tick();
      const s = rt.engine.stats();
      rt.statsRing.push({
        tick: rt.engine.currentTick,
        values: {
          aliveCount: s.aliveCount,
          speciesCount: s.speciesCount,
          avgEnergy: s.avgEnergy,
          entropy: s.entropy,
          complexity: s.complexity,
          diversity: s.diversity,
          predatorFraction: s.predatorFraction,
          meanPlasticity: s.meanPlasticity,
          meanSurprise: s.meanSurprise,
        },
      });
    }
  });

  after(async () => {
    await wm.destroyWorld(worldId);
    await wm.destroyWorld(emptyWorldId);
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  });

  it('400 with no history', async () => {
    const res = await fetch(`${baseUrl}/worlds/${emptyWorldId}/forecast`);
    assert.equal(res.status, 400);
    const body = (await res.json()) as { error: string };
    assert.match(body.error, /not enough history/);
  });

  it('forecasts the default series with sane bands', async () => {
    const res = await fetch(`${baseUrl}/worlds/${worldId}/forecast`);
    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      worldId: string;
      series: string[];
      window: number;
      horizon: number;
      loss: number;
      present: Record<string, number>;
      steps: Array<{ ahead: number; values: Record<string, number> }>;
      bands: Record<string, { trend: number; lo: number; hi: number }>;
    };
    assert.equal(body.worldId, worldId);
    assert.deepEqual(body.series, ['aliveCount', 'avgEnergy', 'complexity', 'entropy']);
    assert.ok(body.horizon === 12);
    assert.ok(body.window >= 8 && body.window <= 24);
    assert.ok(body.loss >= 0);
    for (const s of body.series) {
      assert.ok(Number.isFinite(body.present[s]), `${s} present finite`);
      assert.ok(Number.isFinite(body.bands[s]!.trend), `${s} trend finite`);
      assert.ok(Number.isFinite(body.bands[s]!.lo), `${s} lo finite`);
      assert.ok(Number.isFinite(body.bands[s]!.hi), `${s} hi finite`);
    }
    assert.equal(body.steps.length, 12);
    assert.equal(body.steps[0]!.ahead, 1);
    for (const st of body.steps) {
      for (const s of body.series) assert.ok(Number.isFinite(st.values[s]), `step ${st.ahead} ${s} finite`);
    }
  });

  it('honours ?series= and ?horizon=', async () => {
    const res = await fetch(`${baseUrl}/worlds/${worldId}/forecast?series=aliveCount,avgEnergy&horizon=5`);
    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      series: string[];
      horizon: number;
      steps: unknown[];
      bands: Record<string, unknown>;
    };
    assert.deepEqual(body.series, ['aliveCount', 'avgEnergy']);
    assert.equal(body.horizon, 5);
    assert.equal(body.steps.length, 5);
    assert.deepEqual(Object.keys(body.bands), ['aliveCount', 'avgEnergy']);
  });

  it('400 when none of the requested series are observed', async () => {
    const res = await fetch(`${baseUrl}/worlds/${worldId}/forecast?series=nope,aliveCount2`);
    assert.equal(res.status, 400);
    const body = (await res.json()) as { error: string };
    assert.match(body.error, /none of the requested series/);
  });

  it('is deterministic for the same ring (seeded net, online SGD)', async () => {
    const a = await (await fetch(`${baseUrl}/worlds/${worldId}/forecast`)).json();
    const b = await (await fetch(`${baseUrl}/worlds/${worldId}/forecast`)).json();
    assert.deepEqual(a, b);
  });
});