import type { SimEvent } from './types.js';
import { EVENT_TYPES } from './types.js';

/**
 * Destination for simulation events produced outside the server process
 * (chiefly the browser simulation worker). Implementations must be
 * non-blocking and bounded: events that cannot be delivered are dropped and
 * counted, never queued without limit.
 */
export interface EventSink {
  push(events: SimEvent[]): void;
  flush(): Promise<void>;
  /** events the sink delivered successfully */
  readonly sent: number;
  /** events the sink lost (backpressure, network failure, server rejection) */
  readonly dropped: number;
}

/** Serialize events as NDJSON (one JSON object per line). */
export function encodeEventBatch(events: SimEvent[]): string {
  return events.map((e) => JSON.stringify(e)).join('\n');
}

export interface ParsedEventBatch {
  events: SimEvent[];
  /** lines/items that could not be parsed into a structurally valid SimEvent */
  invalid: number;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function toSimEvent(raw: unknown): SimEvent | null {
  if (!isPlainObject(raw)) return null;
  const { worldId, tick, type, significance, data } = raw;
  if (typeof tick !== 'number' || !Number.isFinite(tick) || tick < 0) return null;
  if (typeof type !== 'string' || !(EVENT_TYPES as readonly string[]).includes(type)) return null;
  if (typeof significance !== 'number' || !Number.isFinite(significance)) return null;
  if (!isPlainObject(data)) return null;
  if (worldId !== undefined && typeof worldId !== 'string') return null;
  return { worldId: typeof worldId === 'string' ? worldId : '', tick, type, significance, data } as SimEvent;
}

/** Validate a list of already-parsed JSON items. */
export function parseEventList(items: readonly unknown[]): ParsedEventBatch {
  const events: SimEvent[] = [];
  let invalid = 0;
  for (const item of items) {
    const ev = toSimEvent(item);
    if (ev) events.push(ev);
    else invalid++;
  }
  return { events, invalid };
}

/** Parse an NDJSON event batch (one SimEvent per line). Blank lines are
 *  skipped; malformed lines count as `invalid`. */
export function parseEventBatch(ndjson: string): ParsedEventBatch {
  const events: SimEvent[] = [];
  let invalid = 0;
  for (const line of ndjson.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    let raw: unknown;
    try {
      raw = JSON.parse(trimmed);
    } catch {
      invalid++;
      continue;
    }
    const ev = toSimEvent(raw);
    if (ev) events.push(ev);
    else invalid++;
  }
  return { events, invalid };
}

export interface HttpEventSinkOptions {
  worldId: string;
  /** API base the batches post to (e.g. `/api`). `''` disables the sink;
   *  `undefined` holds events until `setBaseUrl` resolves the real target. */
  baseUrl?: string;
  /** hard cap on buffered events (overflow is dropped and counted) */
  maxBuffer?: number;
  /** buffer length that triggers an immediate flush */
  batchSize?: number;
  /** periodic flush cadence while events are buffered */
  intervalMs?: number;
  /** injectable for tests */
  fetchFn?: typeof fetch;
}

/**
 * Batches events and POSTs them as NDJSON to `${baseUrl}/worlds/:id/events/batch`.
 *
 * Backpressure policy (deliberate): a failed POST drops its batch and counts
 * it in `dropped`; the buffer is capped at `maxBuffer` (keep-earliest, overflow
 * counted); a single in-flight POST at a time. The log is therefore never
 * allowed to grow without bound on a struggling client.
 */
export class HttpEventSink implements EventSink {
  readonly worldId: string;
  private baseUrl: string | null;
  private readonly maxBuffer: number;
  private readonly batchSize: number;
  private readonly intervalMs: number;
  private readonly fetchFn: typeof fetch;
  private buf: SimEvent[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private inFlight = false;
  private closed = false;
  private warned = false;
  sent = 0;
  dropped = 0;

  constructor(opts: HttpEventSinkOptions) {
    this.worldId = opts.worldId;
    this.baseUrl = opts.baseUrl ?? null;
    this.maxBuffer = opts.maxBuffer ?? 1000;
    this.batchSize = opts.batchSize ?? 100;
    this.intervalMs = opts.intervalMs ?? 1500;
    this.fetchFn = opts.fetchFn ?? ((input, init) => fetch(input, init));
  }

  /** Resolve the sink target after construction. `''` disables the sink and
   *  discards anything buffered so far (counted as dropped). */
  setBaseUrl(url: string): void {
    if (this.closed) return;
    this.baseUrl = url;
    if (url === '') {
      this.dropped += this.buf.length;
      this.buf = [];
      this.stopTimer();
      return;
    }
    if (this.buf.length > 0) void this.flush();
  }

  push(events: SimEvent[]): void {
    if (events.length === 0) return;
    if (this.closed || this.baseUrl === '') {
      this.dropped += events.length;
      return;
    }
    for (const e of events) {
      if (this.buf.length >= this.maxBuffer) this.dropped++;
      else this.buf.push(e);
    }
    if (this.buf.length >= this.batchSize) void this.flush();
    else this.ensureTimer();
  }

  async flush(): Promise<void> {
    if (this.closed) return;
    await this.send();
  }

  private async send(): Promise<void> {
    if (this.inFlight || this.buf.length === 0) return;
    if (this.baseUrl === null || this.baseUrl === '') return;
    this.inFlight = true;
    const batch = this.buf;
    this.buf = [];
    const url = `${this.baseUrl.replace(/\/+$/, '')}/worlds/${encodeURIComponent(this.worldId)}/events/batch`;
    try {
      const res = await this.fetchFn(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-ndjson' },
        body: encodeEventBatch(batch),
      });
      if (!res.ok) throw new Error(`sink responded ${res.status}`);
      // the server reports what it actually stored; anything it rejected
      // (invalid lines) counts as dropped on this side too
      let accepted = batch.length;
      try {
        const parsed = JSON.parse(await res.text()) as { accepted?: unknown; invalid?: unknown };
        if (parsed && typeof parsed === 'object') {
          if (typeof parsed.accepted === 'number') accepted = parsed.accepted;
        }
      } catch {
        /* non-JSON acknowledgement: assume the full batch landed */
      }
      this.sent += accepted;
      this.dropped += batch.length - accepted;
    } catch (err) {
      this.dropped += batch.length;
      if (!this.warned) {
        this.warned = true;
        console.warn('[EventSink] event batch dropped (further failures are silent):', (err as Error).message);
      }
    } finally {
      this.inFlight = false;
      if (this.closed) return;
      if (this.buf.length >= this.batchSize) void this.send();
      else if (this.buf.length > 0) this.ensureTimer();
      else this.stopTimer();
    }
  }

  /** Stop accepting events and attempt one final flush (fire-and-forget). */
  close(): void {
    this.closed = true;
    this.stopTimer();
    void this.send();
    // if a POST was already in flight, `send` bailed and the remainder cannot
    // be awaited: close is synchronous and callers (worker teardown) cannot wait
    if (this.buf.length > 0) {
      this.dropped += this.buf.length;
      this.buf = [];
    }
  }

  /** Number of events currently buffered (for tests/telemetry). */
  get buffered(): number {
    return this.buf.length;
  }

  private ensureTimer(): void {
    if (this.timer !== null || this.closed) return;
    this.timer = setInterval(() => {
      if (this.buf.length > 0 && !this.closed) void this.flush();
      else this.stopTimer();
    }, this.intervalMs);
  }

  private stopTimer(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
