import fs from 'node:fs';
import path from 'node:path';
import { sha256Hex, stableStringify } from './hash.js';
import type { ProviderId } from './types.js';

export interface CacheEntry {
  key: string;
  request: unknown;
  response: { content: string; model: string; provider: ProviderId };
  createdAt: string;
}

/** Content-addressed on-disk store: `<dir>/<sha256>.json`. */
export class LlmCache {
  constructor(readonly dir: string) {}

  keyFor(request: unknown): string {
    return sha256Hex(stableStringify(request));
  }

  pathFor(key: string): string {
    return path.join(this.dir, `${key}.json`);
  }

  read(key: string): CacheEntry | undefined {
    const p = this.pathFor(key);
    if (!fs.existsSync(p)) return undefined;
    try {
      return JSON.parse(fs.readFileSync(p, 'utf8')) as CacheEntry;
    } catch {
      return undefined;
    }
  }

  write(entry: CacheEntry): void {
    fs.mkdirSync(this.dir, { recursive: true });
    fs.writeFileSync(this.pathFor(entry.key), JSON.stringify(entry, null, 2));
  }
}
