import type { WorldConfig, Intervention } from './source.js';
import type { SimSource } from './source.js';
import type { StoreApi } from 'zustand';
import type { SimState } from '../store/useStore.js';
import type { AgentBuffer } from './agentBuffer.js';
import type { SimEvent, RadarSample } from '@fractal-life/shared';
import { HttpEventSink } from '@fractal-life/shared';
import { resolveEventSinkUrl } from './sinkConfig.js';

type Store = StoreApi<SimState>;

export interface FrameSink {
  store: Store;
  agents: AgentBuffer;
}

const WASM_BG_URL = new URL('/wasm/fractal_life_wasm_bg.wasm', import.meta.url).href;

// Hoisted: `applyFrame` is called once per delta frame, and a dynamic import per
// frame costs a promise allocation + module resolution on the render path. Load
// it eagerly and reuse the binding.
import { applyFrame } from './frames.js';

export function createWorkerSource(sink: FrameSink): SimSource & { worker: Worker } {
  const worker = new Worker(new URL('../sim/engineWorker.ts', import.meta.url), { type: 'module' });

  /** Batch sink for the external event log. Created on start(); events pushed
   *  before the sink URL resolves are held (bounded), never lost silently. */
  let eventSink: HttpEventSink | null = null;

  worker.onmessage = (ev: MessageEvent) => {
    const msg = ev.data;
    if (!msg || typeof msg !== 'object') return;
    switch (msg.op) {
      case 'frame': {
        applyFrame(new Uint8Array(msg.bytes as ArrayBuffer), sink.store, sink.agents);
        break;
      }
      case 'events': {
        // batched event post from the worker: feed the bounded UI timeline
        // (one store set for the whole batch) and forward to the log sink
        const events = msg.events as SimEvent[];
        sink.store.getState().pushEvents(events);
        eventSink?.push(events);
        break;
      }
      case 'ready': {
        sink.store.getState().setStatus(msg.status);
        sink.store.getState().setPaused(msg.status.paused);
        sink.store.getState().setConnected(true);
        break;
      }
      case 'debug': {
        if (typeof (window as { __controlLog?: string }).__controlLog !== 'string') {
          (window as { __controlLog?: string }).__controlLog = '';
        }
        (window as { __controlLog?: string }).__controlLog += `${msg.text}\n`;
        break;
      }
      case 'lineage': {
        sink.store.getState().setLineage(msg.nodes);
        break;
      }
      case 'summaries': {
        sink.store.getState().setAgentSummaries(msg.summaries);
        break;
      }
      case 'radar': {
        sink.store.getState().pushRadarSample(msg.sample as RadarSample);
        break;
      }
    }
  };

  worker.onerror = (e) => {
    console.error('[worker]', e.message, e);
    (window as any).__workerError = e.message;
    sink.store.getState().setWorkerError(e.message);
    sink.store.getState().setConnected(false);
  };

  return {
    worker,
    start(world: WorldConfig) {
      sink.store.getState().setWorld(world);
      sink.store.getState().setConnected(true);
      if (eventSink && eventSink.worldId !== world.id) {
        eventSink.close();
        eventSink = null;
      }
      if (!eventSink) {
        const created = new HttpEventSink({ worldId: world.id });
        eventSink = created;
        void resolveEventSinkUrl().then((url) => created.setBaseUrl(url));
      }
      worker.postMessage({ op: 'init', world, wasmUrl: WASM_BG_URL });
    },
    intervene(iv: Omit<Intervention, 'sequence'>) {
      // The worker owns sequence numbers; assign a local monotonic one that the
      // engine's authoritative applyIntervention will record verbatim.
      worker.postMessage({ op: 'intervene', iv: iv as Intervention });
    },
    control(cmd) {
      worker.postMessage({ op: 'control', cmd });
    },
    setTickRate(tps) {
      worker.postMessage({ op: 'rate', tps });
    },
    setRenderCadence(frameEvery, statsEvery) {
      worker.postMessage({ op: 'render', frameEvery, statsEvery });
    },
    setTurbo(on) {
      worker.postMessage({ op: 'turbo', on });
    },
    requestSnapshot(tick?: number) {
      worker.postMessage({ op: 'snapshot', tick });
    },
    requestLineage() {
      worker.postMessage({ op: 'lineage' });
    },
    requestAgentSummaries() {
      worker.postMessage({ op: 'summaries' });
    },
    destroy() {
      eventSink?.close();
      eventSink = null;
      worker.terminate();
    },
  };
}
