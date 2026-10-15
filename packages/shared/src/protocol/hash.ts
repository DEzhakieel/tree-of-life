/** Deterministic 32-bit hashes. No Math.random() anywhere in the sim core. */

export function fnv1a32(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Stable string for a numeric u32 (little-endian hex). */
export function u32hex(v: number): string {
  return (v >>> 0).toString(16).padStart(8, '0');
}

/** Hash a float32Array into a single u32 (for state hashing / determinism checks). */
export function hashFloats(values: Float32Array | number[], seed = 0): number {
  let h = (seed ^ 0x811c9dc5) >>> 0;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    const buf = new DataView(new ArrayBuffer(4));
    buf.setFloat32(0, v, true);
    const b = buf.getUint32(0, true);
    h ^= b;
    h = Math.imul(h, 0x01000193);
    h ^= i + 1;
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function hashNumbers(...values: number[]): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < values.length; i++) {
    const v = values[i] >>> 0;
    h ^= v;
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
