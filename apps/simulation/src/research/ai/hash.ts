import { createHash } from 'node:crypto';

/** Stable hex digest, used as the content-addressed cache key. */
export function sha256Hex(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

/**
 * Deterministic JSON: object keys are sorted recursively so two structurally
 * equal requests always hash to the same cache key regardless of key order.
 */
export function stableStringify(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === 'object') {
    const src = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(src).sort()) out[k] = sortValue(src[k]);
    return out;
  }
  return value;
}
