import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './drizzleSchema.js';

let _db: ReturnType<typeof drizzle<typeof schema>> | null = null;
let _pool: pg.Pool | null = null;

/** Lazily create the Postgres client. Throws when no DATABASE_URL is set. */
export function getDb() {
  if (_db) return _db;
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL is not set — Postgres persistence is disabled. Set DATABASE_URL to enable it.');
  }
  _pool = new pg.Pool({ connectionString: url, max: 10 });
  // Idle-client failures emit on the pool; without a listener they crash the process.
  _pool.on('error', (err) => {
    console.error('[db] pool error:', err.message);
  });
  _db = drizzle(_pool, { schema });
  return _db;
}

export function getPool(): pg.Pool {
  return _pool!;
}

export async function closeDb(): Promise<void> {
  if (_pool) {
    await _pool.end();
    _pool = null;
    _db = null;
  }
}
