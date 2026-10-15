import path from 'node:path';

/** Research output directory (same anchor the other research CLIs write to). */
export const OUTPUT_DIR = path.resolve('C:/Users/LENOVO/Downloads/fractallife2/apps/simulation/research/output');

/** Content-addressed cache for every LLM call, so re-runs replay offline. */
export const AI_CACHE_DIR = path.join(OUTPUT_DIR, 'ai-cache');
