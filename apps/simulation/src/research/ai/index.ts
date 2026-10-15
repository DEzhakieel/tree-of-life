/**
 * LLM / AI-agent layer for the research stack.
 *
 * Three uses, all cache-by-default and reproducible:
 *   - `worldAI`      — a collective "world mind" steers `WorldParams` per window
 *   - `phaseAnalyst` — interprets measured phase-transition loci
 *   - `researchAgent`— proposes experiments, evaluated by the real harness
 *
 * Providers: `ollama` (open-source models, e.g. qwen2.5:3b) and `mock`
 * (deterministic offline, used by tests/CI). Determinism is enforced by a
 * content-addressed cache in front of every call.
 */
export * from './types.js';
export * from './hash.js';
export * from './cache.js';
export * from './knobs.js';
export * from './prompts.js';
export * from './mock.js';
export * from './ollama.js';
export * from './client.js';
export * from './worldAI.js';
export * from './phaseAnalyst.js';
export * from './researchAgent.js';
export { OUTPUT_DIR, AI_CACHE_DIR } from './paths.js';
