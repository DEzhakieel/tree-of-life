import 'dotenv/config';
import http from 'node:http';
import express, { type Response } from 'express';
import { config } from './config.js';
import { getStorage } from './store/index.js';
import { WorldManager } from './worldManager.js';
import { createGateway } from './gateway/index.js';
import { createApi } from './api/index.js';
import { GroundingService } from './data/groundingService.js';

async function main(): Promise<void> {
  const app = express();
  app.use(express.json({ limit: '4mb' }));
  app.use((_req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (_req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    next();
  });

  if (config.databaseUrl) {
    try {
      const { bootstrapDatabase } = await import('./db/migrate.js');
      await bootstrapDatabase(config.databaseUrl);
    } catch (err) {
      console.warn('[api] schema bootstrap failed (continuing with available store):', (err as Error).message);
    }
  }
  const storage = await getStorage();
  const httpServer = http.createServer(app);
  const gateway = await createGateway(httpServer, config);

  // Single shared source of truth for the open-source scientific data that
  // grounds every world — the API serves this same snapshot.
  const grounding = new GroundingService();
  if (grounding.hasSnapshot) {
    console.log(`[api] enrichment snapshot loaded (v${grounding.metadata.version} · ${grounding.metadata.generatedAt})`);
  } else {
    console.warn('[api] no enrichment snapshot — worlds run ungrounded:', grounding.metadata.loadError);
  }

  const worldManager = new WorldManager(gateway, storage, config, grounding);
  try {
    await worldManager.loadPersistedWorlds();
  } catch (err) {
    console.warn('[api] could not load persisted worlds (starting empty):', (err as Error).message);
  }

  app.use('/api', createApi(worldManager, storage, gateway, grounding));
  app.use('/api', (_req, res) => res.status(404).json({ error: 'not found' }));
  app.use('/api', (err: Error, _req: unknown, res: Response, _next: unknown) => {
    console.error('[api] handler error:', err);
    res.status(500).json({ error: err.message });
  });

  httpServer.listen(config.port, () => {
    console.log(`[api] Fractal Life Sandbox listening on :${config.port} (${storage.constructor.name})`);
    console.log(`[api] tickRate=${config.tickRate}Hz snapshotEvery=${config.snapshotEveryTicks}t statsEvery=${config.statsEveryTicks}t`);
    if (worldManager.listWorlds().length === 0) {
      console.log('[api] no persisted worlds — create one via POST /api/worlds');
    }
  });

  const shutdown = async () => {
    console.log('\n[api] shutting down…');
    try {
      await worldManager.flushAllEvents();
    } catch (err) {
      console.warn('[api] final event flush failed:', (err as Error).message);
    }
    gateway.stop();
    httpServer.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
