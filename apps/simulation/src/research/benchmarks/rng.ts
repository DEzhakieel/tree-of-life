/**
 * Deterministic RNG for the benchmark models.
 *
 * Benchmarks are standalone micro-models and need a FAST deterministic stream
 * (the engine's SplitMix64 uses BigInt and is far too slow for millions of
 * draws). This is the same mulberry32 used by the research stats layer and by
 * `dimensional_worlds.ts`, so results are reproducible across processes and
 * machines, and no `Math.random` ever enters a benchmark.
 */

export class BenchRng {
  private a: number;

  constructor(seed: number) {
    this.a = seed >>> 0 || 0x6d2b79f5;
  }

  /** 32-bit unsigned integer. */
  next(): number {
    this.a = (this.a + 0x6d2b79f5) | 0;
    let t = Math.imul(this.a ^ (this.a >>> 15), 1 | this.a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return (t ^ (t >>> 14)) >>> 0;
  }

  /** float in [0, 1). */
  unit(): number {
    return this.next() / 4294967296;
  }

  /** float in [-1, 1). */
  signed(): number {
    return this.unit() * 2 - 1;
  }

  /** float in [lo, hi). */
  range(lo: number, hi: number): number {
    return lo + (hi - lo) * this.unit();
  }

  /** integer in [0, n). */
  int(n: number): number {
    if (n <= 1) return 0;
    return this.next() % n;
  }

  /** standard normal via Box-Muller. */
  gaussian(): number {
    let u = 0;
    let v = 0;
    while (u === 0) u = this.unit();
    while (v === 0) v = this.unit();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  /** in-place Fisher-Yates shuffle. */
  shuffle<T>(arr: T[]): void {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = this.int(i + 1);
      const t = arr[i]!;
      arr[i] = arr[j]!;
      arr[j] = t;
    }
  }
}

/** FNV-1a 32-bit string hash — turns a seed string into a stream seed. */
export function seedFromString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
