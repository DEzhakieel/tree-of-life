import { SPATIAL_CELL } from '@fractal-life/shared';
import { WORLD_SIZE } from '@fractal-life/shared';

/**
 * Uniform spatial hash grid backed by typed arrays (zero per-query
 * allocation). All alive agents are inserted once per tick; neighbor queries
 * walk the surrounding cells => O(1) per query.
 */
export class SpatialHash {
  readonly cellSize: number;
  readonly cellCount: number;
  private map = new Map<number, number[]>();
  private slots: Int32Array = new Int32Array(1024);
  private xs: Float32Array = new Float32Array(1024);
  private ys: Float32Array = new Float32Array(1024);
  private idToSlot = new Map<number, number>();
  private n = 0;

  constructor(cellSize = SPATIAL_CELL) {
    this.cellSize = cellSize;
    this.cellCount = Math.ceil(WORLD_SIZE / cellSize);
  }

  clear(): void {
    this.map.clear();
    this.idToSlot.clear();
    this.n = 0;
  }

  private key(cx: number, cy: number): number {
    return (cx + cy * this.cellCount) >>> 0;
  }

  insert(id: number, x: number, y: number): void {
    if (this.n >= this.slots.length) {
      const cap = this.slots.length * 2;
      const ns = new Int32Array(cap);
      const nx = new Float32Array(cap);
      const ny = new Float32Array(cap);
      ns.set(this.slots);
      nx.set(this.xs);
      ny.set(this.ys);
      this.slots = ns;
      this.xs = nx;
      this.ys = ny;
    }
    this.idToSlot.set(id, this.n);
    this.slots[this.n] = id;
    this.xs[this.n] = x;
    this.ys[this.n] = y;
    this.n++;
    const cx = Math.floor(x / this.cellSize);
    const cy = Math.floor(y / this.cellSize);
    const k = this.key(cx, cy);
    let bucket = this.map.get(k);
    if (!bucket) {
      bucket = [];
      this.map.set(k, bucket);
    }
    bucket.push(this.n - 1); // store slot index, not id
  }

  /**
   * Id of the nearest inserted agent within `radius` of (x, y), or -1.
   * Zero allocation. Caller can resolve distance from its own agent data.
   */
  queryNearest(x: number, y: number, radius: number): number {
    const r2 = radius * radius;
    const cx = Math.floor(x / this.cellSize);
    const cy = Math.floor(y / this.cellSize);
    const span = Math.ceil(radius / this.cellSize);
    let bestSlot = -1;
    let bestD2 = r2;
    const xs = this.xs;
    const ys = this.ys;
    for (let dy = -span; dy <= span; dy++) {
      for (let dx = -span; dx <= span; dx++) {
        const bucket = this.map.get(this.key(cx + dx, cy + dy));
        if (!bucket) continue;
        for (let i = 0; i < bucket.length; i++) {
          const slot = bucket[i]!;
          const ddx = xs[slot]! - x;
          const ddy = ys[slot]! - y;
          const d2 = ddx * ddx + ddy * ddy;
          if (d2 < bestD2) {
            bestD2 = d2;
            bestSlot = slot;
          }
        }
      }
    }
    return bestSlot >= 0 ? this.slots[bestSlot]! : -1;
  }

  queryCircle(x: number, y: number, radius: number): number[] {
    const r2 = radius * radius;
    const cx = Math.floor(x / this.cellSize);
    const cy = Math.floor(y / this.cellSize);
    const span = Math.ceil(radius / this.cellSize);
    const out: number[] = [];
    const xs = this.xs;
    const ys = this.ys;
    for (let dy = -span; dy <= span; dy++) {
      for (let dx = -span; dx <= span; dx++) {
        const bucket = this.map.get(this.key(cx + dx, cy + dy));
        if (!bucket) continue;
        for (let i = 0; i < bucket.length; i++) {
          const slot = bucket[i]!;
          const ddx = xs[slot]! - x;
          const ddy = ys[slot]! - y;
          if (ddx * ddx + ddy * ddy < r2) out.push(this.slots[slot]!);
        }
      }
    }
    return out;
  }

  /**
   * Zero-allocation neighbour scan: fills `ids` with up to `max` agent ids
   * within `radius` of (x, y). Returns the count. Caller supplies scratch.
   */
  queryNeighbors(x: number, y: number, radius: number, ids: Int32Array, max: number): number {
    const r2 = radius * radius;
    const cx = Math.floor(x / this.cellSize);
    const cy = Math.floor(y / this.cellSize);
    const span = Math.ceil(radius / this.cellSize);
    let n = 0;
    const xs = this.xs;
    const ys = this.ys;
    for (let dy = -span; dy <= span && n < max; dy++) {
      for (let dx = -span; dx <= span && n < max; dx++) {
        const bucket = this.map.get(this.key(cx + dx, cy + dy));
        if (!bucket) continue;
        for (let i = 0; i < bucket.length && n < max; i++) {
          const slot = bucket[i]!;
          const ddx = xs[slot]! - x;
          const ddy = ys[slot]! - y;
          if (ddx * ddx + ddy * ddy < r2) {
            ids[n++] = this.slots[slot]!;
          }
        }
      }
    }
    return n;
  }
}
