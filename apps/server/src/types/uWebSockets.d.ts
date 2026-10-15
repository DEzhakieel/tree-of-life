/**
 * Minimal type surface for the optional uWebSockets.js binding.
 * uWS ships no type definitions in some versions; this stub keeps the
 * adapter type-checking even when the package is not installed (the gateway
 * falls back to `ws` at runtime). Do not rely on these types at runtime.
 */
declare module 'uWebSockets.js' {
  export interface HttpResponse {
    writeStatus(status: string): HttpResponse;
    writeHeader(key: string, value: string): HttpResponse;
    end(body?: string | ArrayBuffer | null): void;
  }

  export interface WebSocket<T = unknown> {
    send(message: ArrayBuffer | Uint8Array, isBinary?: boolean, compress?: boolean): boolean;
    close(code?: number, message?: string): boolean;
    getRemoteAddress(): ArrayBuffer;
    getRemoteAddressAsText(): ArrayBuffer;
    userData?: T;
  }

  export interface WebSocketBehavior<T = unknown> {
    maxPayloadLength?: number;
    idleTimeout?: number;
    compression?: number;
    open?: (ws: WebSocket<T>) => void;
    message?: (ws: WebSocket<T>, message: ArrayBuffer, isBinary: boolean) => void;
    drain?: (ws: WebSocket<T>) => void;
    close?: (ws: WebSocket<T>, code: number, message: ArrayBuffer) => void;
  }

  export interface AppOptions {
    key_file_name?: string;
    cert_file_name?: string;
  }

  export interface App {
    ws<T = unknown>(pattern: string, behavior: WebSocketBehavior<T>): App;
    get(pattern: string, handler: (res: HttpResponse, req: unknown) => void): App;
    post(pattern: string, handler: (res: HttpResponse, req: unknown) => void): App;
    listen(port: number, cb: (token: unknown) => void): App;
    close(cb?: () => void): App;
  }

  export function App(options?: AppOptions): App;
  export function SSLApp(options: AppOptions): App;
}
