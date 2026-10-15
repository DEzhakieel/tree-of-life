import http from 'node:http';

export interface OllamaOptions {
  temperature?: number;
  seed?: number;
  maxTokens?: number;
  json?: boolean;
  timeoutMs?: number;
}

export interface OllamaResult {
  content: string;
  model: string;
}

/**
 * Minimal Ollama `/api/chat` client (non-streaming). No SDK dependency: a plain
 * HTTP POST so the layer stays offline-friendly and Node-18 compatible.
 */
export async function ollamaChat(
  host: string,
  model: string,
  messages: { role: string; content: string }[],
  opts: OllamaOptions = {},
): Promise<OllamaResult> {
  const url = new URL('/api/chat', host);
  const body = JSON.stringify({
    model,
    stream: false,
    messages,
    ...(opts.json ? { format: 'json' } : {}),
    options: {
      temperature: opts.temperature ?? 0.7,
      ...(opts.seed !== undefined ? { seed: opts.seed } : {}),
      ...(opts.maxTokens !== undefined ? { num_predict: opts.maxTokens } : {}),
    },
  });

    const raw = await postJson(url, body, opts.timeoutMs ?? 300_000);
  const parsed = JSON.parse(raw) as { message?: { content?: string }; model?: string; error?: string };
  if (parsed.error) throw new Error(`ollama: ${parsed.error}`);
  return { content: parsed.message?.content ?? '', model: parsed.model ?? model };
}

function postJson(url: URL, body: string, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      url,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) },
      },
      (res) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(`ollama HTTP ${res.statusCode}: ${data.slice(0, 200)}`));
          } else {
            resolve(data);
          }
        });
      },
    );
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => req.destroy(new Error(`ollama request timed out after ${timeoutMs}ms`)));
    req.write(body);
    req.end();
  });
}
