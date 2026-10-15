import { LlmCache } from './cache.js';
import { mockGenerate } from './mock.js';
import { ollamaChat } from './ollama.js';
import { AI_CACHE_DIR } from './paths.js';
import type { CacheMode, ChatOptions, ChatResult, Llm, LlmConfig, LlmMessage, ProviderId } from './types.js';

const DEFAULT_MODEL = 'qwen2.5:3b';
const DEFAULT_HOST = 'http://127.0.0.1:11434';

/**
 * Provider-agnostic LLM handle with a content-addressed cache in front of it.
 *
 * Determinism contract: for a fixed request the cached bytes are returned
 * verbatim, so a run is reproducible even if the model's live output would
 * drift (temperature, version bumps). `cache: 'off'` forces live calls; `'replay'`
 * refuses to make them, turning a missing cache entry into a hard error.
 */
export function createLlm(cfg: LlmConfig = {}): Llm {
  const provider: ProviderId =
    cfg.provider ?? (process.env.FRACTAL_LLM_PROVIDER as ProviderId | undefined) ?? 'ollama';
  const model = cfg.model ?? process.env.FRACTAL_LLM_MODEL ?? DEFAULT_MODEL;
  const host = cfg.host ?? process.env.FRACTAL_LLM_HOST ?? DEFAULT_HOST;
  const cacheMode: CacheMode = cfg.cache ?? 'on';
  const cache = new LlmCache(cfg.cacheDir ?? AI_CACHE_DIR);
  const envTemp = process.env.FRACTAL_LLM_TEMPERATURE ? Number(process.env.FRACTAL_LLM_TEMPERATURE) : undefined;

  async function chat(messages: LlmMessage[], opts: ChatOptions = {}): Promise<ChatResult> {
    const useModel = opts.model ?? model;
    const temperature = opts.temperature ?? cfg.temperature ?? envTemp;
    const seed = opts.seed ?? cfg.seed;

    const full: LlmMessage[] = opts.system
      ? [{ role: 'system', content: opts.system }, ...messages]
      : messages;

    const request = {
      provider,
      model: useModel,
      messages: full,
      options: {
        temperature: temperature ?? null,
        seed: seed ?? null,
        maxTokens: opts.maxTokens ?? null,
        json: !!opts.json,
      },
    };
    const key = cache.keyFor(request);

    if (cacheMode !== 'off') {
      const hit = cache.read(key);
      if (hit) {
        return {
          content: hit.response.content,
          model: hit.response.model,
          provider: hit.response.provider,
          cached: true,
          elapsedMs: 0,
          key,
        };
      }
      if (cacheMode === 'replay') {
        throw new Error(
          `LLM replay miss for key ${key.slice(0, 12)}… — no cached response. Run once with a live backend to populate the cache.`,
        );
      }
    }

    const started = Date.now();
    let content: string;
    let usedModel = useModel;
    if (provider === 'mock') {
      content = mockGenerate(full, { json: opts.json });
    } else {
      const r = await ollamaChat(
        host,
        useModel,
        full.map((m) => ({ role: m.role, content: m.content })),
        { temperature, seed, maxTokens: opts.maxTokens, json: opts.json, timeoutMs: cfg.timeoutMs },
      );
      content = r.content;
      usedModel = r.model;
    }
    const elapsedMs = Date.now() - started;

    if (cacheMode !== 'off') {
      cache.write({
        key,
        request,
        response: { content, model: usedModel, provider },
        createdAt: new Date().toISOString(),
      });
    }
    return { content, model: usedModel, provider, cached: false, elapsedMs, key };
  }

  async function chatJson<T>(
    messages: LlmMessage[],
    opts: ChatOptions = {},
  ): Promise<{ data: T; result: ChatResult }> {
    const result = await chat(messages, { ...opts, json: true });
    return { data: parseJsonLoose<T>(result.content), result };
  }

  return { provider, model, cacheMode, chat, chatJson };
}

/** Tolerant JSON extraction: strips markdown fences and any leading prose. */
export function parseJsonLoose<T>(raw: string): T {
  let s = raw.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1]!.trim();

  const firstObj = s.indexOf('{');
  const firstArr = s.indexOf('[');
  const candidates = [firstObj, firstArr].filter((i) => i >= 0);
  if (candidates.length > 0) {
    const start = Math.min(...candidates);
    if (start > 0) s = s.slice(start);
  }

  try {
    return JSON.parse(s) as T;
  } catch {
    const end = Math.max(s.lastIndexOf('}'), s.lastIndexOf(']'));
    if (end > 0) {
      try {
        return JSON.parse(s.slice(0, end + 1)) as T;
      } catch {
        /* fall through */
      }
    }
    throw new Error(`could not parse JSON from LLM response: ${raw.slice(0, 200)}`);
  }
}
