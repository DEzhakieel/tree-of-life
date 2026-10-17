# Master System Map: LLM/AI Agent Layer (Tree of Life)

*(Tree of Life — formerly "Fractal Life v2"; repo dir `fractallife2`.)*

## 1. Inventory (per file)

| file | role | key exports/types | mechanism | line refs |
|---|---|---|---|---|---
| `apps/simulation/src/research/ai/index.ts` | Barrel export for AI layer | exports all submodules (types, hash, cache, knobs, prompts, mock, ollama, client, world, worldAI, controller, phaseAnalyst, researchAgent); re-exports `OUTPUT_DIR`, `AI_CACHE_DIR` from `paths.ts` | Public API entrypoint; organizes cache+provider+agents+control loop. | `apps/simulation/src/research/ai/index.ts:1-28` |
| \pps/simulation/src/research/ai/types.ts\ | Core type contracts | \ProviderId = 'ollama'|'mock'\; \CacheMode = 'on'|'off'|'replay'|'refresh'\; \LlmMessage\, \ChatOptions\ (system, temperature, seed, maxTokens, json), \ChatResult\ (content,model,provider,cached,elapsedMs,key), \LlmConfig\, \Llm\ interface | Defines determinism/cache contract (cached flag, content-addressed key, seed passthrough) | \pps/simulation/src/research/ai/types.ts:1-72\ |
