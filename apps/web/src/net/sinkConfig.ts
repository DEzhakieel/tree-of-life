/**
 * Resolves where the browser should batch-POST local-run events.
 *
 * Order:
 *  1. `VITE_EVENT_SINK_URL` (build-time override; `''` disables the sink)
 *  2. `GET /api/config` → `eventSinkUrl` (the server's `EVENT_SINK_URL`,
 *     defaulting to same-origin `/api`)
 *  3. `''` — no server answering → the sink is disabled, so backend-less
 *     sessions (static hosting, e2e) don't POST batches into a dead endpoint
 *
 * The resolved URL is cached for the session; the promise never rejects, so
 * callers can wire it straight into an event sink.
 */
let cached: Promise<string> | null = null;

export function resolveEventSinkUrl(): Promise<string> {
  const env: string | undefined = (import.meta as { env?: Record<string, string | undefined> }).env?.VITE_EVENT_SINK_URL;
  if (env !== undefined) return Promise.resolve(env);
  if (!cached) {
    cached = fetch('/api/config')
      .then((res) => (res.ok ? (res.json() as Promise<Record<string, unknown>>) : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then((cfg) => (typeof cfg.eventSinkUrl === 'string' && cfg.eventSinkUrl.length > 0 ? cfg.eventSinkUrl : '/api'))
      .catch(() => '');
  }
  return cached;
}
