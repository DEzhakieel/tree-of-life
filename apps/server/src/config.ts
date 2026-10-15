import 'dotenv/config';

export interface ServerConfig {
  port: number;
  wsPort: number;
  tickRate: number;
  tickMs: number;
  databaseUrl?: string;
  redisUrl?: string;
  snapshotEveryTicks: number;
  snapshotRetention: number;
  statsEveryTicks: number;
  maxWorlds: number;
  /** Base URL clients should batch-POST events to (GET /api/config publishes
   *  it). Defaults to same-origin `/api`; point it at a dedicated log host to
   *  collect events out-of-process. */
  eventSinkUrl: string;
}

function int(v: string | undefined, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export const config: ServerConfig = {
  port: int(process.env.PORT, 8080),
  wsPort: int(process.env.WS_PORT, 8081),
  tickRate: int(process.env.TICK_RATE, 60),
  tickMs: 1000 / int(process.env.TICK_RATE, 60),
  databaseUrl: process.env.DATABASE_URL || undefined,
  redisUrl: process.env.REDIS_URL || undefined,
  snapshotEveryTicks: int(process.env.SNAPSHOT_EVERY_TICKS, 30),
  snapshotRetention: int(process.env.SNAPSHOT_RETENTION, 4000),
  statsEveryTicks: int(process.env.STATS_EVERY_TICKS, 30),
  maxWorlds: int(process.env.MAX_WORLDS, 32),
  eventSinkUrl: process.env.EVENT_SINK_URL || '/api',
};
