import { Router, text, type Request, type Response, type NextFunction } from 'express';
import { Engine, TrendForecaster } from '@fractal-life/simulation';
import { parseEventBatch, parseEventList, type SimEvent } from '@fractal-life/shared';
import type { WorldManager } from '../worldManager.js';
import type { Storage } from '../store/interface.js';
import type { Gateway } from '../gateway/types.js';
import { config } from '../config.js';
import { GroundingService } from '../data/groundingService.js';
import { createDataApi } from './data.js';

/** Express 4 does not catch async rejections; forward them to the error handler. */
function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };
}

export function createApi(worldManager: WorldManager, storage: Storage, gateway: Gateway, grounding?: GroundingService): Router {
  const api = Router();

  // Open-source scientific data (PubChem / GBIF / Kazusa) served from the
  // offline enrichment snapshot. Mounted under /api/data.
  api.use('/data', createDataApi(grounding ?? new GroundingService()));

  api.get('/health', (_req, res) => {
    res.json({ ok: true, uptime: process.uptime() });
  });

  /**
   * Runtime settings the browser needs to build the right WS URL: the gateway
   * may serve on the same origin (`ws` adapter, `/ws` path) or on a dedicated
   * `wsPort` (uWS adapter). Clients should never hardcode either.
   */
  api.get('/config', (_req, res) => {
    res.json({
      port: config.port,
      wsPort: config.wsPort,
      tickRate: config.tickRate,
      snapshotEveryTicks: config.snapshotEveryTicks,
      statsEveryTicks: config.statsEveryTicks,
      gateway: gateway.kind,
      eventSinkUrl: config.eventSinkUrl,
    });
  });

  // Worlds --------------------------------------------------------------------

  api.post('/worlds', asyncHandler(async (req, res) => {
    try {
      const world = await worldManager.createWorld(req.body ?? {});
      res.status(201).json(world);
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  }));

  api.get('/worlds', asyncHandler(async (_req, res) => {
    const live = worldManager.listWorlds();
    if (live.length > 0) {
      res.json(live);
      return;
    }
    const stored = await storage.listWorlds();
    res.json(stored);
  }));

  api.get('/worlds/:id', asyncHandler(async (req, res) => {
    const rt = worldManager.getRuntime(req.params.id);
    if (rt) {
      res.json(rt.engine.worldStatus(rt.paused));
      return;
    }
    const world = await storage.getWorld(req.params.id);
    if (!world) {
      res.status(404).json({ error: 'world not found' });
      return;
    }
    res.json(world);
  }));

  api.delete('/worlds/:id', asyncHandler(async (req, res) => {
    await worldManager.destroyWorld(req.params.id);
    res.status(204).end();
  }));

  // Simulation state ----------------------------------------------------------

  api.get('/worlds/:id/snapshot', asyncHandler(async (req, res) => {
    const rt = worldManager.getRuntime(req.params.id);
    if (!rt) {
      res.status(404).json({ error: 'world not running' });
      return;
    }
    const tickParam = typeof req.query.tick === 'string' ? Number(req.query.tick) : undefined;
    if (tickParam === undefined || !Number.isFinite(tickParam) || tickParam >= rt.engine.currentTick) {
      res.type('application/octet-stream').send(Buffer.from(rt.engine.encodeSnapshotMessage()));
      return;
    }
    const g = grounding?.snapshotJsonString();
    const replayConfig = g === undefined || g === null ? rt.config : { ...rt.config, grounding: JSON.parse(g) as typeof rt.config.grounding };
    const replay = Engine.replay(replayConfig, rt.engine.getInterventionLog(), Math.max(0, tickParam));
    res.type('application/octet-stream').send(Buffer.from(replay.encodeSnapshotMessage()));
  }));

  api.get('/worlds/:id/stats', (req, res) => {
    const rt = worldManager.getRuntime(req.params.id);
    if (!rt) {
      res.status(404).json({ error: 'world not running' });
      return;
    }
    res.json(rt.engine.stats());
  });

  api.get('/worlds/:id/events', asyncHandler(async (req, res) => {
    res.json(await storage.listEvents(req.params.id));
  }));

  /**
   * Batch ingestion for the external event log. NDJSON body (one SimEvent per
   * line, `application/x-ndjson`) or a plain JSON array; posted by the browser
   * worker's HttpEventSink in bounded batches. Accepts ANY world id — browser
   * local worlds (`local-*`) never register a server-side world row, and the
   * id in the payload is always overwritten by the URL's so the path is the
   * single source of truth.
   */
  api.post(
    '/worlds/:id/events/batch',
    text({ type: ['application/x-ndjson', 'text/plain', 'text/*'], limit: '2mb' }),
    asyncHandler(async (req, res) => {
      const worldId = String(req.params.id);
      const parsed = Array.isArray(req.body)
        ? parseEventList(req.body as unknown[])
        : parseEventBatch(typeof req.body === 'string' ? req.body : '');
      const stamped: SimEvent[] = parsed.events.map((e) => ({ ...e, worldId }));
      if (stamped.length > 0) await storage.saveEvents(worldId, stamped);
      res.json({ accepted: stamped.length, invalid: parsed.invalid });
    }),
  );

  api.get('/worlds/:id/lineage', (req, res) => {
    const rt = worldManager.getRuntime(req.params.id);
    if (!rt) {
      res.status(404).json({ error: 'world not running' });
      return;
    }
    res.json(rt.engine.buildLineage());
  });

  api.get('/worlds/:id/agents', (req, res) => {
    const rt = worldManager.getRuntime(req.params.id);
    if (!rt) {
      res.status(404).json({ error: 'world not running' });
      return;
    }
    res.json(rt.engine.agentSummaries());
  });

  // Control / interventions (REST parity with the binary WS ops) ---------------

  /** Transport control: play, pause, or advance exactly one tick. */
  api.post('/worlds/:id/control', (req, res) => {
    const action = (req.body ?? {}).action;
    if (action !== 'play' && action !== 'pause' && action !== 'step') {
      res.status(400).json({ error: "action must be one of 'play' | 'pause' | 'step'" });
      return;
    }
    const status = worldManager.control(req.params.id, action);
    if (!status) {
      res.status(404).json({ error: 'world not running' });
      return;
    }
    res.json(status);
  });

  /** Adjust a live world's target tick rate (1..120 tps). */
  api.put('/worlds/:id/rate', (req, res) => {
    const tps = Number((req.body ?? {}).tps);
    if (!Number.isFinite(tps) || tps <= 0) {
      res.status(400).json({ error: 'tps must be a positive number' });
      return;
    }
    if (!worldManager.getRuntime(req.params.id)) {
      res.status(404).json({ error: 'world not running' });
      return;
    }
    res.json({ tps: worldManager.setTickRate(req.params.id, tps) });
  });

  /**
   * Apply a deterministic intervention over HTTP. The server assigns the
   * per-world sequence, so a mixed WS/HTTP session still replays identically.
   */
  api.post('/worlds/:id/interventions', asyncHandler(async (req, res) => {
    if (!worldManager.getRuntime(req.params.id)) {
      res.status(404).json({ error: 'world not running' });
      return;
    }
    try {
      const sequence = await worldManager.intervene(req.params.id, (req.body ?? {}) as Record<string, unknown>);
      res.status(202).json({ sequence });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  }));

  // Stored snapshots ----------------------------------------------------------

  /**
   * The most recent persisted restore point as a raw SNAPSHOT frame. Tick and
   * state hash travel as headers so clients can validate what they decoded.
   */
  api.get('/worlds/:id/snapshots/latest', asyncHandler(async (req, res) => {
    const snap = await storage.getLatestSnapshot(req.params.id);
    if (!snap) {
      res.status(404).json({ error: 'no snapshot stored' });
      return;
    }
    res
      .type('application/octet-stream')
      .set('X-Tick', String(snap.tick))
      .set('X-State-Hash', String(snap.stateHash))
      .send(Buffer.from(snap.data));
  }));

  /** A specific persisted restore point (raw SNAPSHOT frame + headers). */
  api.get('/worlds/:id/snapshots/:tick', asyncHandler(async (req, res) => {
    const tick = Number(req.params.tick);
    if (!Number.isInteger(tick) || tick < 0) {
      res.status(400).json({ error: 'tick must be a non-negative integer' });
      return;
    }
    const snap = await storage.getSnapshot(req.params.id, tick);
    if (!snap) {
      res.status(404).json({ error: 'snapshot not found' });
      return;
    }
    res
      .type('application/octet-stream')
      .set('X-Tick', String(snap.tick))
      .set('X-State-Hash', String(snap.stateHash))
      .send(Buffer.from(snap.data));
  }));

  /**
   * Neural forecast of the world's observables. The forecast network trains on
   * the rolling stats ring (online SGD, seeded) and extrapolates `horizon`
   * ticks ahead. `?series=aliveCount,avgEnergy&horizon=12` selects which
   * observables to forecast.
   */
  api.get('/worlds/:id/forecast', (req, res) => {
    const ring = worldManager.statsRing(req.params.id);
    if (ring.length < 8) {
      res.status(400).json({ error: 'not enough history yet to forecast (need >= 8 stats samples)' });
      return;
    }
    const series = typeof req.query.series === 'string'
      ? req.query.series.split(',').map((s) => s.trim()).filter(Boolean)
      : ['aliveCount', 'avgEnergy', 'complexity', 'entropy'];
    const horizon = typeof req.query.horizon === 'string'
      ? Math.min(64, Math.max(1, parseInt(req.query.horizon, 10) || 12))
      : 12;
    const live = series.filter((s) => Object.prototype.hasOwnProperty.call(ring[ring.length - 1]!.values, s));
    if (live.length === 0) {
      res.status(400).json({ error: 'none of the requested series are observed; saw ' + Object.keys(ring[ring.length - 1]!.values).join(',') });
      return;
    }
    const fc = new TrendForecaster({
      series: live,
      window: Math.min(24, ring.length - 1),
      hidden: 12,
      lr: 0.05,
      horizon,
      seed: 0x5eed,
    });
    for (const row of ring) fc.observe(row.tick, row.values);
    res.json({ worldId: req.params.id, ...fc.forecast() });
  });

  // Keep the router self-contained: unknown API paths and handler failures get
  // a JSON body even when the router is mounted without the app-level fallbacks.
  api.use((_req, res) => res.status(404).json({ error: 'not found' }));
  api.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error('[api] handler error:', err);
    res.status(500).json({ error: err.message });
  });

  return api;
}
