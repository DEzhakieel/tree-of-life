import { fnv1a32 } from '@fractal-life/shared';

const U64_MASK = 0xffffffffffffffffn;
const GOLDEN = 0x9e3779b97f4a7c15n;
const C1 = 0xbf58476d1ce4e5b9n;
const C2 = 0x94d049bb133111ebn;

/**
 * SplitMix64 — a fully deterministic PRNG. All simulation randomness flows
 * through instances of this class seeded from (worldSeed, tick, agentId),
 * so the same seed + interventions reproduce identical state on any machine.
 */
export class SplitMix64 {
  private state: bigint;

  constructor(seed: number | bigint) {
    this.state = typeof seed === 'bigint' ? seed & U64_MASK : BigInt(seed >>> 0);
    // warm up so correlated seeds diverge immediately
    this.next();
  }

  /** 32-bit unsigned integer, [0, 2^32). */
  next(): number {
    this.state = (this.state + GOLDEN) & U64_MASK;
    let z = this.state;
    z = ((z ^ (z >> 30n)) * C1) & U64_MASK;
    z = ((z ^ (z >> 27n)) * C2) & U64_MASK;
    // Mask to the low 32 bits in BigInt BEFORE converting to Number. The
    // mixed value spans up to 2^64, where Number() loses precision (>2^53);
    // `>>> 0` afterwards would then truncate the *rounded* value and silently
    // corrupt every PRNG draw, diverging from the Rust engine (which masks in
    // u64 and casts exactly). This is the root cause of WASM-vs-TS divergence
    // from the very first founder genome.
    return Number((z ^ (z >> 31n)) & 0xffffffffn);
  }

  /** Float in [0, 1). */
  nextFloat(): number {
    return this.next() / 4294967296;
  }

  /** Float in [-1, 1). */
  nextSigned(): number {
    return this.nextFloat() * 2 - 1;
  }

  /** Integer in [0, n). Bias-free. */
  nextInt(n: number): number {
    if (n <= 0) return 0;
    if (n === 1) return 0;
    const limit = Math.floor(4294967296 / n) * n;
    let v = this.next();
    while (v >= limit) v = this.next();
    return v % n;
  }

  /** Standard normal via Box-Muller (uses two draws per call). */
  nextGaussian(): number {
    let u = 0;
    let v = 0;
    while (u === 0) u = this.nextFloat();
    while (v === 0) v = this.nextFloat();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
}

/** Derive a numeric stream seed from worldSeed + tick + agentId. */
export function streamSeed(worldSeed: string, tick: number, agentId: number): number {
  return fnv1a32(`${worldSeed}:${tick}:${agentId}`);
}

/** Independent stream for memetic (cultural) transmission draws. */
export function memeSeed(worldSeed: string, tick: number, agentId: number): number {
  return fnv1a32(`${worldSeed}:meme:${tick}:${agentId}`);
}

/** Deterministic per-world environment stream (not per-agent). */
export function envSeed(worldSeed: string, tick: number): number {
  return fnv1a32(`${worldSeed}:env:${tick}`);
}

/** Independent stream for the molecular-omics layer's stochastic draws
 * (stochastic gene expression + folding entropy). Kept in its own domain so
 * the draws never collide with the mutation / meme / env streams, and both
 * engines construct a fresh SplitMix64 from it inside `tickOmics`. */
export function omicsSeed(worldSeed: string, tick: number, agentId: number): number {
  return fnv1a32(`${worldSeed}:omics:${tick}:${agentId}`);
}

/** Deterministic founder-spawn stream. */
export function initSeed(worldSeed: string): number {
  return fnv1a32(`${worldSeed}:init`);
}
