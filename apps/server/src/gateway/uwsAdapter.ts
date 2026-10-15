import type { Gateway, GatewayMessageHandler, WsClient } from './types.js';

let nextClientId = 0;

/**
 * Transport backed by uWebSockets.js (uWS) on a dedicated port. uWS is an
 * optional dependency — when its native binding is unavailable this adapter
 * throws and the server falls back to the `ws` adapter on the Express port.
 */
export class UwsGateway implements Gateway {
  readonly kind = 'uws' as const;
  private onConnectCb: ((c: WsClient) => void) | null = null;
  private onMessageCb: GatewayMessageHandler | null = null;
  private onDisconnectCb: ((c: WsClient) => void) | null = null;
  private app: import('uWebSockets.js').App | null = null;
  private listenSocket: unknown = null;
  private rawToClient = new Map<unknown, WsClient>();

  constructor(private port: number) {}

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
    const uWS = await import('uWebSockets.js');

    this.app = uWS.App().ws('/ws', {
      maxPayloadLength: 1 << 20,
      idleTimeout: 0,
      open: (rawWs) => {
        const client: WsClient = {
          id: `uws-${nextClientId++}`,
          send: (data) => {
            try {
              // uWS's JS binding accepts strings but its types only cover bytes;
              // encode text and use isBinary=false so the browser sees a string.
              const isText = typeof data === 'string';
              rawWs.send(isText ? new TextEncoder().encode(data) : data, isText ? false : true, false);
            } catch {
              /* socket gone */
            }
          },
          close: () => rawWs.close(),
        };
        this.rawToClient.set(rawWs, client);
        this.onConnectCb?.(client);
      },
      message: (rawWs, message) => {
        const client = this.rawToClient.get(rawWs);
        if (client) this.onMessageCb?.(client, new Uint8Array(message));
      },
      close: (rawWs) => {
        const client = this.rawToClient.get(rawWs);
        if (client) {
          this.rawToClient.delete(rawWs);
          this.onDisconnectCb?.(client);
        }
      },
    });

    await new Promise<void>((resolve, reject) => {
      this.app!.listen(this.port, (token: unknown) => {
        if (token) {
          this.listenSocket = token;
          resolve();
        } else {
          reject(new Error(`uWS failed to listen on :${this.port}`));
        }
      });
    });
  }

  async stop(): Promise<void> {
    if (this.app && this.listenSocket) {
      (this.app as unknown as { close: (cb: () => void) => void }).close(() => undefined);
      this.app = null;
      this.listenSocket = null;
      this.rawToClient.clear();
    }
  }
}
