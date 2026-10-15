import type { Storage } from './interface.js';
import { MemoryStore } from './memoryStore.js';

let _store: Storage | null = null;

/**
 * Choose the storage backend: Postgres when DATABASE_URL is present,
 * otherwise the in-memory store. Postgres availability is probed lazily;
 * a failed connect degrades to MemoryStore with a warning.
 */
export async function getStorage(): Promise<Storage> {
  if (_store) return _store;
  const url = process.env.DATABASE_URL;
  if (url) {
    try {
      const { PostgresStore } = await import('./postgresStore.js');
      _store = new PostgresStore();
      return _store;
    } catch (err) {
      console.warn('[storage] Postgres unavailable, falling back to MemoryStore:', (err as Error).message);
    }
  }
  _store = new MemoryStore();
  return _store;
}
