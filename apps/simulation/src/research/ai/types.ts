/** Open-source model backends. `mock` is a deterministic offline stand-in. */
export type ProviderId = 'ollama' | 'mock';

/**
 * Cache policy:
 *  - `on`     — serve cached responses, write new ones (default; replay-safe)
 *  - `off`    — always call the backend live, never read/write the cache
 *  - `replay` — read-only; a miss is an error (CI / strict reproducibility)
 */
export type CacheMode = 'on' | 'off' | 'replay';

export interface LlmMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatOptions {
  model?: string;
  /** prepended as a system message (part of the cache key) */
  system?: string;
  temperature?: number;
  /** passed through to Ollama's sampler; fixed seed => reproducible live output */
  seed?: number;
  maxTokens?: number;
  /** request strict JSON output */
  json?: boolean;
}

export interface ChatResult {
  content: string;
  model: string;
  provider: ProviderId;
  /** true when served from the on-disk cache (no backend call) */
  cached: boolean;
  elapsedMs: number;
  /** content-addressed cache key for this request */
  key: string;
}

export interface LlmConfig {
  provider?: ProviderId;
  model?: string;
  /** Ollama base URL, e.g. http://127.0.0.1:11434 */
  host?: string;
  cacheDir?: string;
  cache?: CacheMode;
  temperature?: number;
  seed?: number;
  timeoutMs?: number;
}

export interface Llm {
  readonly provider: ProviderId;
  readonly model: string;
  readonly cacheMode: CacheMode;
  chat(messages: LlmMessage[], opts?: ChatOptions): Promise<ChatResult>;
  chatJson<T>(messages: LlmMessage[], opts?: ChatOptions): Promise<{ data: T; result: ChatResult }>;
}
