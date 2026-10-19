/// <reference lib="webworker" />
import { createWasmSimEngine, WasmSimEngine, type BrainConfigLike, type WorldStochLike } from './wasmAdapter';
import { SubstrateEngine } from '@fractal-life/simulation/substrates';
import {
  encodeStats,
  encodeAck,
  encodeWorld,
  isSubstrateWorld,
  type WorldConfig,
  type Intervention,
  type SimStats,
  type SimEvent,
  type WorldStatus,
  type RadarSample,
} from '@fractal-life/shared';
/**
 * Deterministic simulation source running the engine off the main thread.
 * Mirrors the server's WS gateway protocol exactly (identical binary frames),
 * so the browser can switch between local and remote worlds without changing
 * the renderer.
 *
 * Simulation time and render time are decoupled on three independent axes:
 *
 *  - `tps`        wall-clock pacing target for watched playback. `turbo` drops
 *                 the pacing entirely and runs the tick loop flat out.
 *  - `frameEvery` how many ticks between MT_DELTA frames sent to the renderer.
 *                 0 = never render; the sim keeps advancing regardless.
 *  - `statsEvery` how many ticks between stats frames.
 *
 * A headless run (`turbo` + `frameEvery: 0`) never builds a render frame at all:
 * `setRecordDelta(false)` tells the Rust engine to skip it, which is bit-for-bit
 * identical to rendering it (see crates/simulation/tests/record_delta.rs).
 *
 * Events are independent of all three: they are buffered here and posted to
 * the main thread as one `{ op: 'events' }` batch whenever the buffer is full
 * or a stats frame fires, so a render-suppressed run still produces the full
 * event log.
 */

type WorkerRequest =
  | { op: 'init'; world: WorldConfig; wasmUrl?: string; brainCfg?: BrainConfigLike; worldStoch?: Partial<WorldStochLike> | null }
  | { op: 'intervene'; iv: Intervention }
  | { op: 'control'; cmd: 'play' | 'pause' | 'step' }
  | { op: 'rate'; tps: number }
  | { op: 'render'; frameEvery?: number; statsEvery?: number }
  | { op: 'turbo'; on: boolean }
  | { op: 'snapshot'; tick?: number }
  | { op: 'lineage' }
  | { op: 'summaries' };

/** Longest a turbo batch runs before yielding to the worker's message queue.
 *  Bounded so pause/intervene/snapshot still land promptly. */
const BATCH_MS = 8;

/** The active engine: the WASM agent engine, or a pure-TS substrate kernel
 *  adapter for worlds that opted into a non-agent life substrate. Both expose
 *  the same duck-typed surface (tick/stats/frames/interventions), so the whole
 *  loop below is substrate-agnostic. */
let engine: WasmSimEngine | SubstrateEngine | null = null;
let timer: ReturnType<typeof setInterval> | ReturnType<typeof setTimeout> | null = null;
/** turbo = run flat out with no wall-clock pacing */
let turbo = false;
let tps = 30;
/** ticks between render frames; 0 suppresses the render stream entirely */
let frameEvery = 1;
/** ticks between stats frames */
let statsEvery = 10;
let paused = false;
let measuredRate = 0;
let tickWindow: number[] = [];
let sinceStats = 0;
let sinceFrame = 0;
let seq = 0;
/** events buffered since the last batch post (independent of render cadence) */
let pendingEvents: SimEvent[] = [];
/** buffered events are posted to the main thread in chunks of this size */
const EVENT_BATCH = 32;

function postFrame(frame: Uint8Array): void {
  const copy = frame.slice();
  (self as unknown as Worker).postMessage({ op: 'frame', bytes: copy.buffer }, [copy.buffer]);
}

/** Post every buffered event to the main thread as a single batch message.
 *  Called on buffer overflow and on the stats cadence; also on pause so a
 *  stopped run never strands its last few events. */
function flushEvents(): void {
  if (pendingEvents.length === 0) return;
  const batch = pendingEvents;
  pendingEvents = [];
  (self as unknown as Worker).postMessage({ op: 'events', events: batch });
}

/** Advance the simulation exactly one tick. Emits nothing — publishing to the
 *  renderer is a separate concern handled by `publish`. */
function advance(): void {
  if (!engine) return;
  const t0 = performance.now();
  const result = engine.tick();
  const dt = performance.now() - t0;
  tickWindow.push(dt);
  if (tickWindow.length > 60) tickWindow.shift();
  measuredRate = 1000 / (tickWindow.reduce((a, b) => a + b, 0) / tickWindow.length);

  const tick = engine.currentTick;
  sinceStats++;
  sinceFrame++;

  if (result.events.length > 0) pendingEvents.push(...result.events);

  // push a radar sample at the same cadence as stats; the shared primitives
  // run on terrain + agent summaries in world units (converted from cells)
  if (statsEvery > 0 && sinceStats >= statsEvery) {
    try {
      const rs = engine.radarSample();
      (self as unknown as Worker).postMessage({ op: 'radar', sample: rs });
    } catch (e) {
      // best-effort; do not break the tick loop if radar sampling fails
    }
  }

  if (frameEvery > 0 && sinceFrame >= frameEvery) {
    sinceFrame = 0;
    postFrame(result.delta);
    // the evolved set is recomputed every 30 ticks — slow enough to amortise the
    // O(n) persistence scan, fast enough to watch the set grow as life colonises
    if (tick % 30 === 0) postFrame(engine.encodeSetMapMessage());
  }

  if (statsEvery > 0 && sinceStats >= statsEvery) {
    sinceStats = 0;
    const stats: SimStats = { ...engine.stats(), tickRate: measuredRate };
    postFrame(encodeStats(stats));
    flushEvents();
  }
  if (pendingEvents.length >= EVENT_BATCH) flushEvents();
}

/** One paced tick, used by interval mode and by the manual step button. */
function step(manual = false): void {
  if (!engine) return;
  if (paused && !manual) return;
  advance();
  if (manual) {
    // a manual step must always surface state, even with frames suppressed
    sinceFrame = 0;
    sinceStats = 0;
    flushEvents();
    postFrame(encodeStats({ ...engine.stats(), tickRate: measuredRate }));
  }
}

function stopTimer(): void {
  if (timer !== null) {
    clearInterval(timer as ReturnType<typeof setInterval>);
    clearTimeout(timer as ReturnType<typeof setTimeout>);
    timer = null;
  }
}

/** Turbo: run batches of ticks until the slice is spent, then yield to the
 *  worker's message queue via setTimeout so `pause` / `intervene` / `snapshot`
 *  are still delivered mid-run. Without the yield a tight loop would block the
 *  worker's event loop and the world would be unpausable. */
function runBatch(): void {
  timer = null;
  if (!engine || paused) return;
  const deadline = performance.now() + BATCH_MS;
  do {
    advance();
  } while (!paused && engine !== null && performance.now() < deadline);
  if (!paused && engine !== null) {
    timer = setTimeout(runBatch, 0);
  }
}

function schedule(): void {
  stopTimer();
  if (!engine) return;
  if (turbo) {
    if (!paused) timer = setTimeout(runBatch, 0);
    return;
  }
  timer = setInterval(() => step(), 1000 / tps);
}

/** Rebuild-free toggle: keeps the sim identical, only the frame stream changes. */
function applyRenderPolicy(): void {
  if (!engine) return;
  engine.setRecordDelta(frameEvery > 0);
  sinceFrame = 0;
  sinceStats = 0;
}

async function init(world: WorldConfig, wasmUrl?: string, brainCfg?: BrainConfigLike, worldStoch?: Partial<WorldStochLike> | null): Promise<void> {
  // substrate worlds run the pure-TS kernel in this worker — no WASM, no
  // server round trip; the agent engine keeps its original path untouched
  engine = isSubstrateWorld(world) ? new SubstrateEngine(world) : await createWasmSimEngine(world, wasmUrl);
  if (brainCfg) engine.setBrainConfig(brainCfg);
  if (worldStoch !== undefined) engine.setWorldStochastics(worldStoch);
  paused = false;
  tps = 30;
  tickWindow = [];
  sinceStats = 0;
  sinceFrame = 0;
  pendingEvents = [];
  applyRenderPolicy();
  postFrame(engine.encodeSnapshotMessage());
  postFrame(engine.encodeSetMapMessage());
  schedule();
  const status: WorldStatus = engine.worldStatus(paused);
  (self as unknown as Worker).postMessage({ op: 'ready', status });
}

function broadcastControlState(): void {
  if (!engine) return;
  postFrame(encodeWorld(engine.config, engine.worldStatus(paused)));
}

self.onmessage = async (ev: MessageEvent<WorkerRequest>) => {
  const msg = ev.data;
  switch (msg.op) {
    case 'init':
      await init(msg.world, msg.wasmUrl, msg.brainCfg, msg.worldStoch);
      break;
    case 'intervene': {
      if (!engine) break;
      const iv: Intervention = { ...msg.iv, sequence: seq++ };
      engine.applyIntervention(iv);
      postFrame(encodeAck(iv.sequence));
      break;
    }
    case 'control':
      // drain buffered events before any state change so a paused run's log
      // is complete on the main thread
      flushEvents();
      if (msg.cmd === 'play') {
        paused = false;
        schedule();
        broadcastControlState();
      } else if (msg.cmd === 'pause') {
        paused = true;
        // let an in-flight turbo batch observe the flag and wind down
        stopTimer();
        broadcastControlState();
      } else if (msg.cmd === 'step') {
        step(true);
        broadcastControlState();
      }
      (self as { postMessage(msg: object): void }).postMessage({
        op: 'debug',
        text: `${msg.cmd} tick=${engine?.currentTick ?? -1} paused=${paused}`,
      });
      break;
    case 'rate': {
      tps = Math.max(1, Math.min(120, msg.tps));
      tickWindow = [];
      // turbo overrides pacing entirely
      if (!turbo) schedule();
      break;
    }
    case 'render': {
      if (msg.frameEvery !== undefined) frameEvery = Math.max(0, msg.frameEvery | 0);
      if (msg.statsEvery !== undefined) statsEvery = Math.max(0, msg.statsEvery | 0);
      applyRenderPolicy();
      if (frameEvery > 0) {
        // a resume after a frame-suppressed run needs one frame to redraw
        postFrame(engine ? engine.encodeSnapshotMessage() : new Uint8Array(0));
      }
      break;
    }
    case 'turbo': {
      turbo = msg.on;
      tickWindow = [];
      schedule();
      break;
    }
    case 'snapshot': {
      if (!engine) break;
      if (msg.tick === undefined || msg.tick >= engine.currentTick || !(engine instanceof WasmSimEngine)) {
        // substrates snapshot only — no time travel: substrate states are
        // ticked forward, never replayed from history
        postFrame(engine.encodeSnapshotMessage());
      } else {
        try {
          const replay = WasmSimEngine.replay(engine.config, engine.getInterventionLog(), msg.tick);
          postFrame(replay.encodeSnapshotMessage());
        } catch {
          postFrame(engine.encodeSnapshotMessage());
        }
      }
      break;
    }
    case 'lineage': {
      if (!engine) break;
      (self as unknown as Worker).postMessage({ op: 'lineage', nodes: engine.buildLineage() });
      break;
    }
    case 'summaries': {
      if (!engine) break;
      (self as unknown as Worker).postMessage({ op: 'summaries', summaries: engine.agentSummaries() });
      break;
    }
  }
};