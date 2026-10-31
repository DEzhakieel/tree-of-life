import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { UNIVERSE_MARS, DEFAULT_PARAMS } from '@fractal-life/shared';
import { buildLocalWorld, createRemoteWorld } from '../src/net/session.js';

const originalFetch = globalThis.fetch;

function stubFetch(response: { status: number; body: unknown; text?: string }) {
  const calls: { url: string; init?: RequestInit }[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return {
      ok: response.status >= 200 && response.status < 300,
      status: response.status,
      json: async () => response.body,
      text: async () => response.text ?? JSON.stringify(response.body),
    } as Response;
  }) as typeof fetch;
  return calls;
}

after(() => {
  globalThis.fetch = originalFetch;
});

describe('buildLocalWorld universe forwarding', () => {
  it('sets the universe key when a physics frame is requested', () => {
    const world = buildLocalWorld({
      seed: 's',
      fractalType: 'mandelbrot',
      params: { ...DEFAULT_PARAMS, spawnCount: 10 },
      universe: UNIVERSE_MARS,
    });
    assert.equal(world.universe, UNIVERSE_MARS);
  });

  it('omits the universe key when the frame is off (legacy)', () => {
    const world = buildLocalWorld({
      seed: 's',
      fractalType: 'mandelbrot',
      params: { ...DEFAULT_PARAMS, spawnCount: 10 },
    });
    assert.equal(world.universe, undefined);
  });
});

describe('createRemoteWorld universe forwarding', () => {
  it('POSTs the universe with the create payload', async () => {
    const calls = stubFetch({ status: 201, body: { id: 'w1' } });
    await createRemoteWorld({ seed: 's', universe: UNIVERSE_MARS });
    const body = JSON.parse(String(calls[0].init?.body) ?? '{}');
    assert.deepEqual(body.universe, UNIVERSE_MARS);
  });

  it('does not send the universe key when off (legacy)', async () => {
    const calls = stubFetch({ status: 201, body: { id: 'w2' } });
    await createRemoteWorld({ seed: 's' });
    const body = JSON.parse(String(calls[0].init?.body) ?? '{}');
    assert.equal('universe' in body, false);
  });
});

describe('createRemoteWorld error reporting', () => {
  it('surfaces the error message from a JSON API response', async () => {
    stubFetch({ status: 500, body: { error: 'world limit reached' }, text: '{"error":"world limit reached"}' });
    await assert.rejects(createRemoteWorld({ seed: 's' }), /world limit reached/);
  });

  it('explains a bodyless proxy 500 instead of returning a bare status', async () => {
    stubFetch({ status: 500, body: null, text: '' });
    await assert.rejects(createRemoteWorld({ seed: 's' }), /API server unavailable \(HTTP 500\)/);
  });
});
