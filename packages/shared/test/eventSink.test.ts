import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  HttpEventSink,
  encodeEventBatch,
  parseEventBatch,
  parseEventList,
  type SimEvent,
} from '../src/index.js';

function death(i: number): SimEvent {
  return {
    worldId: 'w1',
    tick: i,
    type: 'death',
    significance: 0.5,
    data: { agentId: i, cause: 'age', species: 1, x: 0, y: 0, age: 10, energy: 0 },
  };
}

interface RecordedCall {
  url: string;
  method: string;
  contentType: string;
  body: string;
}

interface FetchControl {
  calls: RecordedCall[];
  fail: boolean;
  status: number;
  ack: { accepted: number; invalid: number } | null;
  fetchFn: typeof fetch;
}

function makeFetch(): FetchControl {
  const ctl: FetchControl = {
    calls: [],
    fail: false,
    status: 200,
    ack: null,
    fetchFn: (async (input: RequestInfo | URL, init?: RequestInit) => {
      ctl.calls.push({
        url: String(input),
        method: init?.method ?? 'GET',
        contentType: String((init?.headers as Record<string, string>)?.['Content-Type'] ?? ''),
        body: String(init?.body ?? ''),
      });
      if (ctl.fail) throw new Error('network down');
      if (ctl.status >= 400) {
        return { ok: false, status: ctl.status, text: async () => '' } as Response;
      }
      const ack = ctl.ack ?? { accepted: ctl.calls[ctl.calls.length - 1]!.body.split('\n').length, invalid: 0 };
      return { ok: true, status: 200, text: async () => JSON.stringify(ack) } as Response;
    }) as typeof fetch,
  };
  return ctl;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('NDJSON batch codecs', () => {
  it('encodeEventBatch round-trips through parseEventBatch', () => {
    const events = [death(1), death(2), death(3)];
    const { events: back, invalid } = parseEventBatch(encodeEventBatch(events));
    assert.equal(invalid, 0);
    assert.deepEqual(back, events);
  });

  it('skips blank lines and counts malformed lines as invalid', () => {
    const ndjson = [encodeEventBatch([death(1)]), '', 'not json', '{"tick":"nope"}'].join('\n');
    const { events, invalid } = parseEventBatch(ndjson);
    assert.equal(events.length, 1);
    assert.equal(invalid, 2);
  });

  it('rejects structurally invalid objects in lists', () => {
    const good = death(7);
    const { events, invalid } = parseEventList([
      good,
      { ...good, type: 'nonsense' },
      { ...good, tick: -1 },
      { ...good, data: [1, 2] },
      { ...good, significance: 'high' },
      'string',
    ]);
    assert.equal(events.length, 1);
    assert.equal(invalid, 5);
    assert.deepEqual(events[0], good);
  });
});

describe('HttpEventSink', () => {
  it('POSTs NDJSON batches to the world batch endpoint', async () => {
    const ctl = makeFetch();
    const sink = new HttpEventSink({ worldId: 'local-abc', baseUrl: '/api', fetchFn: ctl.fetchFn });
    sink.push([death(1), death(2)]);
    assert.equal(ctl.calls.length, 0, 'below batchSize must not auto-flush');
    await sink.flush();
    assert.equal(ctl.calls.length, 1);
    const call = ctl.calls[0]!;
    assert.equal(call.url, '/api/worlds/local-abc/events/batch');
    assert.equal(call.method, 'POST');
    assert.equal(call.contentType, 'application/x-ndjson');
    assert.deepEqual(parseEventBatch(call.body).events, [death(1), death(2)]);
    assert.equal(sink.sent, 2);
    assert.equal(sink.dropped, 0);
    sink.close();
  });

  it('auto-flushes once the buffer reaches batchSize', async () => {
    const ctl = makeFetch();
    const sink = new HttpEventSink({ worldId: 'w', baseUrl: '/api', batchSize: 5, fetchFn: ctl.fetchFn });
    sink.push([death(1), death(2), death(3)]);
    sink.push([death(4), death(5)]);
    await sleep(10);
    assert.equal(ctl.calls.length, 1, 'reaching batchSize must trigger a flush');
    assert.equal(sink.sent, 5);
    assert.equal(sink.buffered, 0);
    sink.close();
  });

  it('flushes on the periodic timer', async () => {
    const ctl = makeFetch();
    const sink = new HttpEventSink({ worldId: 'w', baseUrl: '/api', intervalMs: 10, fetchFn: ctl.fetchFn });
    sink.push([death(1)]);
    await sleep(60);
    assert.ok(ctl.calls.length >= 1, 'timer must flush buffered events');
    assert.equal(sink.sent, 1);
    sink.close();
  });

  it('drops with a counter when the network fails (no unbounded retry)', async () => {
    const ctl = makeFetch();
    ctl.fail = true;
    const sink = new HttpEventSink({ worldId: 'w', baseUrl: '/api', fetchFn: ctl.fetchFn });
    sink.push([death(1), death(2), death(3)]);
    await sink.flush();
    assert.equal(sink.sent, 0);
    assert.equal(sink.dropped, 3, 'failed batch must be counted as dropped');
    assert.equal(sink.buffered, 0, 'failed batch must not be requeued');
    ctl.fail = false;
    sink.push([death(4)]);
    await sink.flush();
    assert.equal(sink.sent, 1);
    assert.equal(sink.dropped, 3);
    sink.close();
  });

  it('counts HTTP error statuses as dropped', async () => {
    const ctl = makeFetch();
    ctl.status = 503;
    const sink = new HttpEventSink({ worldId: 'w', baseUrl: '/api', fetchFn: ctl.fetchFn });
    sink.push([death(1)]);
    await sink.flush();
    assert.equal(sink.dropped, 1);
    sink.close();
  });

  it('counts server-rejected lines from the ack body', async () => {
    const ctl = makeFetch();
    ctl.ack = { accepted: 2, invalid: 1 };
    const sink = new HttpEventSink({ worldId: 'w', baseUrl: '/api', fetchFn: ctl.fetchFn });
    sink.push([death(1), death(2), death(3)]);
    await sink.flush();
    assert.equal(sink.sent, 2);
    assert.equal(sink.dropped, 1);
    sink.close();
  });

  it('caps the buffer at maxBuffer and counts overflow as dropped', async () => {
    const ctl = makeFetch();
    const sink = new HttpEventSink({
      worldId: 'w',
      baseUrl: '/api',
      maxBuffer: 10,
      batchSize: 1000,
      fetchFn: ctl.fetchFn,
    });
    sink.push(Array.from({ length: 25 }, (_, i) => death(i)));
    assert.equal(sink.buffered, 10);
    assert.equal(sink.dropped, 15);
    await sink.flush();
    assert.equal(sink.sent, 10, 'keep-earliest policy stores exactly maxBuffer');
    sink.close();
  });

  it('holds events while the base URL is unresolved, then flushes', async () => {
    const ctl = makeFetch();
    const sink = new HttpEventSink({ worldId: 'w', fetchFn: ctl.fetchFn });
    sink.push([death(1), death(2)]);
    await sink.flush();
    assert.equal(ctl.calls.length, 0, 'unresolved sink must hold, not send');
    assert.equal(sink.buffered, 2);
    assert.equal(sink.dropped, 0);
    sink.setBaseUrl('/api');
    await sleep(10);
    assert.equal(ctl.calls.length, 1, 'resolving the URL must drain the buffer');
    assert.equal(sink.sent, 2);
    sink.close();
  });

  it('an empty base URL disables the sink with a drop count', async () => {
    const ctl = makeFetch();
    const sink = new HttpEventSink({ worldId: 'w', baseUrl: '', fetchFn: ctl.fetchFn });
    sink.push([death(1), death(2)]);
    await sink.flush();
    assert.equal(ctl.calls.length, 0);
    assert.equal(sink.dropped, 2);
    assert.equal(sink.buffered, 0);
    sink.close();
  });

  it('close() drains the buffer once and rejects later pushes', async () => {
    const ctl = makeFetch();
    const sink = new HttpEventSink({ worldId: 'w', baseUrl: '/api', fetchFn: ctl.fetchFn });
    sink.push([death(1)]);
    sink.close();
    await sleep(10);
    assert.equal(ctl.calls.length, 1, 'close must attempt a final flush');
    assert.equal(sink.sent, 1);
    sink.push([death(2)]);
    assert.equal(sink.dropped, 1, 'pushes after close are counted dropped');
    assert.equal(ctl.calls.length, 1);
  });
});
