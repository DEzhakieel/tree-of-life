import type http from 'node:http';
import type { ServerConfig } from '../config.js';
import type { Gateway } from './types.js';
import { WsGateway } from './wsAdapter.js';

/**
 * Create the WS gateway: prefer uWebSockets.js (fast native), fall back to the
 * pure-JS `ws` adapter on the Express HTTP server when the uWS binding cannot
 * load (e.g. Node 18 on Windows without a prebuilt binary).
 */
export async function createGateway(httpServer: http.Server, config: ServerConfig): Promise<Gateway> {
  try {
    if (process.env.UWS_DISABLE === '1') throw new Error('UWS_DISABLE=1');
    const { UwsGateway } = await import('./uwsAdapter.js');
    const g = new UwsGateway(config.wsPort);
    await g.start();
    console.log(`[gateway] uWebSockets.js listening on :${config.wsPort} (/ws)`);
    return g;
  } catch (err) {
    console.warn(`[gateway] uWebSockets.js unavailable (${(err as Error).message}); using ws adapter on :${config.port}/ws`);
    const g = new WsGateway(httpServer, '/ws');
    await g.start();
    return g;
  }
}
