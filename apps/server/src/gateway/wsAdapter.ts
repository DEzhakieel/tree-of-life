import { WebSocketServer, WebSocket } from 'ws';
import type http from 'node:http';
import type { Gateway, GatewayMessageHandler, WsClient } from './types.js';

let nextClientId = 0;

const HEARTBEAT_INTERVAL_MS = 30000;
/** close sockets that show no traffic (app-level ping or any frame) for 60s */
const STALE_MS = 60000;

/**
 * Transport backed by the `ws` package, upgraded on the same HTTP server that
 * serves the Express REST API (path `/ws`). Used when uWebSockets.js is not
 * installed (Node 18 has no prebuilt binary).
 */
export class WsGateway implements Gateway {
  readonly kind = 'ws' as const;
  private wss: WebSocketServer | null = null;
  private clients = new Set<WsClient>();
  private onConnectCb: ((c: WsClient) => void) | null = null;
  private onMessageCb: GatewayMessageHandler | null = null;
  private onDisconnectCb: ((c: WsClient) => void) | null = null;
  /** last time each socket showed activity; stale ones are reaped */
  private lastSeen = new Map<WebSocket, number>();
  private heartbeat: ReturnType<typeof setInterval> | null = null;

  constructor(
    private httpServer: http.Server,
    private path = '/ws',
  ) {}

  onConnect(cb: (client: WsClient) => void): void {
    this.onConnectCb = cb;
  }
  onMessage(cb: GatewayMessageHandler): void {
    this.onMessageCb = cb;
  }
  onDisconnect(cb: (client: WsClient) => void): void {
    this.onDisconnectCb = cb;
  }

  async start(): Promise<void> {
    this.wss = new WebSocketServer({ server: this.httpServer, path: this.path });

    this.wss.on('connection', (ws: WebSocket) => {
      this.lastSeen.set(ws, Date.now());
      const client: WsClient = {
        id: `ws-${nextClientId++}`,
        send: (data) => {
          if (ws.readyState === WebSocket.OPEN) ws.send(data);
        },
        close: () => ws.close(),
      };
      this.clients.add(client);
      this.onConnectCb?.(client);
      ws.on('message', (data: Buffer) => {
        this.lastSeen.set(ws, Date.now());
        this.onMessageCb?.(client, data);
      });
      ws.on('close', () => {
        this.lastSeen.delete(ws);
        this.clients.delete(client);
        this.onDisconnectCb?.(client);
      });
      ws.on('error', () => this.clients.delete(client));
    });

    // Reap half-open connections (client vanished without a FIN). The browser
    // client sends an app-level ping every 10s, so any message resets activity.
    this.heartbeat = setInterval(() => {
      const now = Date.now();
      for (const [ws, seen] of this.lastSeen) {
        if (now - seen > STALE_MS) {
          this.lastSeen.delete(ws);
          ws.terminate();
        }
      }
    }, HEARTBEAT_INTERVAL_MS);
  }

  async stop(): Promise<void> {
    if (this.heartbeat !== null) {
      clearInterval(this.heartbeat);
      this.heartbeat = null;
    }
    await new Promise<void>((resolve) => this.wss?.close(() => resolve()));
    this.wss = null;
  }
}
