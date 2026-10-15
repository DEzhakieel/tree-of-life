import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { initSync } from '../src/sim/wasm_glue.js';
import { WasmSimEngine as WebAdapter } from '../src/sim/wasmAdapter.js';
import { DEFAULT_PARAMS, type WorldConfig } from '@fractal-life/shared';

interface WorkerLike {
  onmessage: ((ev: { data: unknown }) => void) | null;
  postMessage(msg: unknown): void;
}

const here = dirname(fileURLToPath(import.meta.url));
const wasmBytes = readFileSync(join(here, '..', '..', '..', 'crates', 'wasm', 'pkg', 'fractal_life_wasm_bg.wasm'));
const WASM_DATA_URL = `data:application/wasm;base64,${wasmBytes.toString('base64')}`;
const groundingJson = readFileSync(join(here, '..', '..', 'simulation', 'data', 'enrichment.json'), 'utf-8');

function makeWorld(spawn: number): WorldConfig {
  return {
    id: 'web-test',
    seed: 'web-worker-probe',
    fractalType: 'mandelbrot',
    params: { ...DEFAULT_PARAMS, spawnCount: spawn },
    createdAt: 0,
    currentTick: 0,
  };
}

const FULL_FEATURES = {
  enabled: true,
  learn: 'backprop' as const,
  dropout: 0.2,
  gradNoise: 0.05,
  entropy: 0.1,
  pomdp: { enabled: true, noise: 0.1, gain: 0.25, weight: 0.5 },
  policy: { mode: 'gaussian' as const, sigma: 0.3, sigmaMin: 0.05, annealTicks: 60 },
};

describe('web wasm adapter: feature bridge', () => {
  before(() => {
    initSync({ module: new WebAssembly.Module(wasmBytes as unknown as ArrayBuffer) });
  });

  it('setBrainConfig + setWorldStochastics alter the trajectory deterministically', () => {
    const mk = () => {
      const e = new WebAdapter(makeWorld(12));
      e.setBrainConfig(FULL_FEATURES);
      e.setWorldStochastics({ poissonRate: 25 });
      return e;
    };
    const a = mk();
    const b = mk();
    const plain = new WebAdapter(makeWorld(12));
    for (let i = 0; i < 30; i++) {
      a.tick();
      b.tick();
      plain.tick();
    }
    assert.equal(a.stats().stateHash, b.stats().stateHash, 'deterministic with features');
    assert.notEqual(a.stats().stateHash, plain.stats().stateHash, 'features change the trajectory');
    const bstats = a.brainStats();
    assert.equal(bstats.enabled, true);
    assert.equal(typeof bstats.meanPlasticity, 'number');
    assert.equal(typeof bstats.meanSurprise, 'number');
    assert.equal(typeof bstats.plasticAgents, 'number');
  });

  it('stats_json is well-formed JSON on every tick', () => {
    // Regression: the Rust stats_json hand-rolled format! string carried one
    // extra `}}`, so every stats payload ended `"combinatorialEntropy":0}}` and
    // `JSON.parse` threw "Unexpected token }" on tick 0. That silently broke the
    // web worker contract and the WASM<->TS omics parity suite.
    const e = new WebAdapter(makeWorld(10));
    e.setBrainConfig(FULL_FEATURES);
    e.setWorldStochastics({ poissonRate: 20 });
    for (let i = 0; i < 30; i++) {
      const stats = e.stats() as unknown as Record<string, unknown>;
      assert.equal(typeof stats.tick, 'number', `tick ${i}: stats must parse`);
      assert.equal(typeof stats.combinatorialEntropy, 'number', `tick ${i}: last field must be reachable`);
      e.tick();
    }
  });

  it('recordDelta=false keeps the trajectory identical while emitting no frame', () => {
    const a = new WebAdapter(makeWorld(24));
    const b = new WebAdapter(makeWorld(24));
    b.setRecordDelta(false);
    for (let i = 0; i < 40; i++) {
      const ra = a.tick();
      const rb = b.tick();
      assert.equal(rb.deltaCount, 0, `tick ${i}: suppressed frame must carry no agents`);
      assert.equal(rb.delta.length, 7, `tick ${i}: suppressed frame is header-only`);
      assert.equal(a.currentTick, b.currentTick);
    }
    assert.equal(a.stats().stateHash, b.stats().stateHash, 'headless run must match exactly');
  });

  it('grounded replay reproduces the grounded headworld frame byte-for-byte', () => {
    const TARGET = 120;
    const makeGroundWorld = (seed: string): WorldConfig => ({
      id: `web-replay-grounding-${seed}`,
      seed,
      fractalType: 'mandelbrot',
      params: { ...DEFAULT_PARAMS, spawnCount: 8 },
      createdAt: 0,
      currentTick: 0,
    });
    const toStr = (a: Uint8Array): string => String.fromCharCode(...a);
    for (const seed of ['replay-grounding-b', 'replay-grounding-a']) {
      const config = makeGroundWorld(seed);
      const head = new WebAdapter(config);
      head.setGrounding(groundingJson);
      for (let t = 0; t < TARGET; t++) head.tick();
      const headFrame = toStr(head.encodeSnapshotMessage());

      const replayed = WebAdapter.replay(config, head.getInterventionLog(), TARGET, groundingJson);
      assert.equal(toStr(replayed.encodeSnapshotMessage()), headFrame, `seed ${seed}: grounded replay diverged`);
    }
  });

  it('replay without grounding diverges from the grounded headworld', () => {
    const TARGET = 120;
    const toStr = (a: Uint8Array): string => String.fromCharCode(...a);
    const config: WorldConfig = {
      id: 'web-replay-grounding-replay-grounding-b',
      seed: 'replay-grounding-b',
      fractalType: 'mandelbrot',
      params: { ...DEFAULT_PARAMS, spawnCount: 8 },
      createdAt: 0,
      currentTick: 0,
    };
    const head = new WebAdapter(config);
    head.setGrounding(groundingJson);
    for (let t = 0; t < TARGET; t++) head.tick();
    const headFrame = toStr(head.encodeSnapshotMessage());

    const ungrounded = WebAdapter.replay(config, head.getInterventionLog(), TARGET);
    assert.notEqual(toStr(ungrounded.encodeSnapshotMessage()), headFrame);
  });
});

describe('web engine worker: init -> tick message contract', () => {
  const intervalIds: unknown[] = [];
  let realSetInterval: unknown;
  let emitted: Array<Record<string, unknown>> = [];
  let worker: WorkerLike | null = null;

  before(() => {
    realSetInterval = globalThis.setInterval;
    (globalThis as unknown as Record<string, unknown>).setInterval = (
      fn: unknown,
      ms?: number,
      ...args: unknown[]
    ) => {
      const id = (realSetInterval as (fn: unknown, ms?: number) => unknown)(fn, ms ?? 0);
      intervalIds.push(id);
      return id;
    };
    emitted = [];
    worker = {
      onmessage: null,
      postMessage: (msg: unknown) => emitted.push(msg as Record<string, unknown>),
    };
    (globalThis as unknown as { self: unknown }).self = worker;
  });

  after(() => {
    for (const id of intervalIds) (clearInterval as (id: unknown) => void)(id);
    if (realSetInterval) (globalThis as unknown as Record<string, unknown>).setInterval = realSetInterval;
    delete (globalThis as unknown as { self?: unknown }).self;
  });

  it('init applies brainCfg/worldStoch, then streams frames + steps on demand', async () => {
    await import('../src/sim/engineWorker.js'); // binds self.onmessage (must run after `self` exists)
    assert.ok(worker && worker.onmessage, 'worker registered an onmessage handler');

    await worker!.onmessage?.({
      data: {
        op: 'init',
        world: makeWorld(10),
        wasmUrl: WASM_DATA_URL,
        brainCfg: FULL_FEATURES,
        worldStoch: { poissonRate: 20 },
      },
    });
    assert.ok(emitted.some((m) => m.op === 'ready'), 'init emits ready');
    assert.ok(emitted.some((m) => m.op === 'frame' && m.bytes instanceof ArrayBuffer), 'init emits a SNAPSHOT frame');

    // manual step drives one full tick and reports stats/debug
    emitted = [];
    await worker!.onmessage?.({ data: { op: 'control', cmd: 'step' } });
    assert.ok(emitted.some((m) => m.op === 'frame' && m.bytes instanceof ArrayBuffer), 'step emits a DELTA frame');
    assert.ok(emitted.some((m) => m.op === 'debug'), 'step emits a debug chevron');

    // pause broadcasts world status without ticker activity
    emitted = [];
    await worker!.onmessage?.({ data: { op: 'control', cmd: 'pause' } });
    assert.ok(emitted.some((m) => m.op === 'frame'), 'pause broadcasts status frame');
  });
});