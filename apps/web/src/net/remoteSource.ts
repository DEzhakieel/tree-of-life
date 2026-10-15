import type { WorldConfig, Intervention } from './source.js';
import type { SimSource } from './source.js';
import type { StoreApi } from 'zustand';
import type { SimState } from '../store/useStore.js';
import type { AgentBuffer } from './agentBuffer.js';

type Store = StoreApi<SimState>;

export interface RemoteSink {
  store: Store;
  agents: AgentBuffer;
}

function wsUrl(): string {
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
  const host = window.location.hostname;
  const basePort = window.location.port ? `:${window.location.port}` : '';
  if (gatewayKind === 'uws' && wsPort !== null) {
    // dedicated uWS gateway on its own port
    return `${proto}://${host}:${wsPort}/ws`;
  }
  // `ws` adapter served on the same Express port (default/fallback)
  return `${proto}://${host}${basePort}/ws`;
}

/** Which gateway the server actually runs (cached for the session). */
let gatewayKind: 'ws' | 'uws' | null = null;
let wsPort: number | null = null;

async function loadGatewayConfig(): Promise<void> {
  if (gatewayKind !== null) return; // already resolved
  try {
    const res = await fetch('/api/config');
    if (res.ok) {
      const cfg = (await res.json()) as { gateway?: 'ws' | 'uws'; wsPort?: number };
      gatewayKind = cfg.gateway ?? 'ws';
      wsPort = typeof cfg.wsPort === 'number' ? cfg.wsPort : null;
    } else {
      gatewayKind = 'ws';
    }
  } catch {
    gatewayKind = 'ws'; // same-origin /ws fallback
  }
}

/** App-level heartbeat so half-open links (NAT/proxy idle timeouts, laptop sleep) get detected. */
const HEARTBEAT_MS = 10000;
const HEARTBEAT_TIMEOUT_MS = 35000;
/** Reconnect backoff caps at 5s. */
const RECONNECT_MAX_MS = 5000;
/** Give up only when the server rejects the join (world deleted/restarted). */
const JOIN_FAILURE_ATTEMPTS = 3;

/**
 * Remote simulation source: streams authoritative frames from the server over
 * the binary WS gateway. Uses the exact same frame decoder as the local worker.
 *
 * The socket is kept alive with app-level ping/pong and auto-reconnects on a
 * drop. A reconnect re-syncs the transport state the server may have lost
 * while the link was down (play/pause + tick rate); tool paints are transient
 * and are never replayed.
 */
export function createRemoteSource(sink: RemoteSink): SimSource {
  let ws: WebSocket | null = null;
  let worldId: string | null = null;
  let pendingSnapshotTick: number | undefined;
  let seq = 0;

  let destroyed = false;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  let retryMs = 500;
  let joinFailures = 0;
  /** whether a world frame (mt=3) was received on the current socket */
  let joined = false;
  /** last proof of life (any binary frame or an app-level pong) */
  let lastSeen = 0;

  function send(text: string): void {
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(text);
  }

  function clearReconnect(): void {
    if (reconnectTimer !== null) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  }

  function scheduleReconnect(): void {
    if (destroyed || !worldId) return;
    if (reconnectTimer !== null) return;
    if (!joined) {
      // open+join rejected or never completed (world deleted, server restarted,
      // server down): retry a bounded number of times, then surface as offline.
      joinFailures++;
      if (joinFailures > JOIN_FAILURE_ATTEMPTS) {
        sink.store.getState().setConnected(false);
        return;
      }
    } else {
      // healthy session dropped: reconnect forever with backoff; the next
      // successful join resets the failure counter.
      joinFailures = 0;
    }
    retryMs = Math.min(retryMs * 2, RECONNECT_MAX_MS);
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, retryMs);
  }

  function connect(): void {
    clearReconnect();
    if (destroyed || !worldId) return;
    if (gatewayKind === null) {
      // First connect: resolve the gateway transport, then open the socket.
      void loadGatewayConfig().then(() => {
        if (!destroyed && worldId) openSocket();
      });
      return;
    }
    openSocket();
  }

  function openSocket(): void {
    ws = new WebSocket(wsUrl());
    ws.binaryType = 'arraybuffer';
    joined = false;
    lastSeen = Date.now();
    ws.onopen = () => {
      sink.store.getState().setConnected(true);
      if (!worldId) return;
      send(JSON.stringify({ op: 'join', worldId, clientId: `web-${Math.random().toString(36).slice(2)}` }));
      if (pendingSnapshotTick !== undefined) {
        send(JSON.stringify({ op: 'snapshot', worldId, tick: pendingSnapshotTick }));
        pendingSnapshotTick = undefined;
      }
      // Always re-sync transport state on (re)join: a fresh world starts at the
      // server default (60 tps), and a reconnect must replay whatever play/pause
      // and tick rate the server lost while the link was down.
      const st = sink.store.getState();
      send(JSON.stringify({ op: st.paused ? 'pause' : 'play', worldId }));
      send(JSON.stringify({ op: 'rate', worldId, tps: st.targetTickRate }));
    };
    ws.onmessage = (ev) => {
      lastSeen = Date.now();
      if (typeof ev.data === 'string') return; // app-level pong is implicit keep-alive
      const bytes = new Uint8Array(ev.data as ArrayBuffer);
      if (bytes.length > 0 && bytes[0] === 3) joined = true; // world frame
      void import('./frames.js').then(({ applyFrame }) =>
        applyFrame(new Uint8Array(ev.data as ArrayBuffer), sink.store, sink.agents),
      );
    };
    ws.onclose = () => {
      sink.store.getState().setConnected(false);
      if (destroyed || !worldId) return;
      scheduleReconnect();
    };
    ws.onerror = () => {
      /* close follows */
    };
  }

  function startHeartbeat(): void {
    heartbeatTimer = setInterval(() => {
      if (destroyed || !ws || ws.readyState !== WebSocket.OPEN) return;
      if (Date.now() - lastSeen > HEARTBEAT_TIMEOUT_MS) {
        // half-open link: force a close so the reconnect path can rebuild it
        ws.close();
        return;
      }
      send(JSON.stringify({ op: 'ping' }));
    }, HEARTBEAT_MS);
  }

  const source: SimSource = {
    start(world: WorldConfig) {
      worldId = world.id;
      destroyed = false;
      joinFailures = 0;
      retryMs = 500;
      sink.store.getState().setWorld(world);
      connect();
      startHeartbeat();
    },
    intervene(iv: Omit<Intervention, 'sequence'>) {
      const full: Intervention = { ...iv, sequence: seq++ };
      send(JSON.stringify({ op: 'intervene', worldId, intervention: full }));
    },
    control(cmd) {
      send(JSON.stringify({ op: cmd, worldId }));
    },
    setTickRate(tps) {
      send(JSON.stringify({ op: 'rate', worldId, tps }));
    },
    requestSnapshot(tick?: number) {
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        pendingSnapshotTick = tick;
        return;
      }
      send(JSON.stringify({ op: 'snapshot', worldId, tick }));
    },
    requestLineage() {
      if (!worldId) return;
      void fetch(`/api/worlds/${worldId}/lineage`)
        .then((r) => r.json())
        .then((nodes) => sink.store.getState().setLineage(nodes))
        .catch(() => undefined);
    },
    requestAgentSummaries() {
      if (!worldId) return;
      void fetch(`/api/worlds/${worldId}/agents`)
        .then((r) => {
          if (!r.ok) throw new Error(`status ${r.status}`);
          return r.json() as Promise<
            Array<{
              id: number;
              parentId: number;
              bornAtTick: number;
              diedAtTick: number;
              alive: boolean;
              species: number;
              finalFitness: number;
              x: number;
              y: number;
              energy: number;
              age: number;
              genome: number[] | Record<string, number>;
            }>
          >;
        })
        .then((list) =>
          list.map((a) => ({
            id: a.id,
            parentId: a.parentId,
            bornAtTick: a.bornAtTick,
            diedAtTick: a.diedAtTick,
            alive: a.alive,
            species: a.species,
            finalFitness: a.finalFitness,
            x: a.x,
            y: a.y,
            energy: a.energy,
            age: a.age,
            genome: new Float32Array(Array.isArray(a.genome) ? a.genome : Object.values(a.genome)),
          })),
        )
        .then((summaries) => sink.store.getState().setAgentSummaries(summaries))
        .catch(() => undefined);
    },
    destroy() {
      destroyed = true;
      clearReconnect();
      if (heartbeatTimer !== null) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
      }
      ws?.close();
      ws = null;
    },
  };
  return source;
}
