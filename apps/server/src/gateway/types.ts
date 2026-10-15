/** Minimal transport abstraction so the world manager is transport-agnostic. */
export interface WsClient {
  id: string;
  send(data: Uint8Array<ArrayBufferLike> | string): void;
  close(): void;
}

export type GatewayMessageHandler = (client: WsClient, data: Uint8Array | string) => void;

export interface Gateway {
  /** Which transport is actually serving, so clients can compute the WS URL. */
  readonly kind: 'ws' | 'uws';
  /** Attach connection lifecycle + message handlers. */
  onConnect(cb: (client: WsClient) => void): void;
  onMessage(cb: GatewayMessageHandler): void;
  onDisconnect(cb: (client: WsClient) => void): void;
  /** Bind and start listening. */
  start(): Promise<void>;
  stop(): Promise<void>;
}
