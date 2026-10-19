import type { AgentState, SimEvent, SimStats, SubstrateConfig, WorldConfig, WorldParams } from '@fractal-life/shared';
import { STATE, TERRAIN_GRID, WORLD_SIZE } from '@fractal-life/shared';
import { SplitMix64 } from '../rng.js';
import {
  EVENT_BUDGET,
  fnvBytes,
  makeEvent,
  kernelSeed,
  minImage,
  type KernelKind,
  type SetMapFields,
  type SubstrateKernel,
} from './types.js';

/**
 * Lattice substrate: a cellular automaton living directly on the terrain
 * grid (TERRAIN_GRID x TERRAIN_GRID torus, cell = TERRAIN_CELL world units).
 *
 * Rule: Conway B3/S23 by default plus optional seeded noise flips — births and
 * deaths are the life cycle. Alive cells stream out as wire rows, so every
 * representation and the ground layer (the cell states double as the set map)
 * render the same CA state with no renderer changes.
 */
export class LatticeSubstrate implements SubstrateKernel {
  readonly kind: KernelKind = 'lattice';
  readonly params: WorldParams;

  private readonly worldId: string;
  private readonly rng: SplitMix64;
  private readonly size = TERRAIN_GRID;
  private readonly cellSize = WORLD_SIZE / TERRAIN_GRID;
  private readonly total = TERRAIN_GRID * TERRAIN_GRID;
  private readonly noise: number;

  private cells = new Uint8Array(TERRAIN_GRID * TERRAIN_GRID);
  private next = new Uint8Array(TERRAIN_GRID * TERRAIN_GRID);
  private depth = new Uint8Array(TERRAIN_GRID * TERRAIN_GRID);
  private escape = new Uint8Array(TERRAIN_GRID * TERRAIN_GRID);
  /** 2x2 block-pattern counts for the complexity measure. */
  private blockCounts = new Uint32Array(16);

  private tickNum = 0;
  private alive = 0;
  private totalBirths = 0;
  private totalDeaths = 0;
  private lastPopulation = 0;
  private pending: SimEvent[] = [];
  private individual = 0;

  constructor(world: WorldConfig) {
    this.worldId = world.id;
    this.params = world.params;
    const cfg = world.substrate as SubstrateConfig | undefined;
    this.noise = Math.max(0, Math.min(1, cfg?.noise ?? 0));
    this.rng = new SplitMix64(kernelSeed(world, 'lattice'));
    for (let i = 0; i < this.total; i++) {
      this.cells[i] = this.rng.nextFloat() < 0.33 ? 1 : 0;
    }
    this.lastPopulation = this.countAlive();
    this.alive = this.lastPopulation;
  }

  get currentTick(): number {
    return this.tickNum;
  }

  get population(): number {
    return this.alive;
  }

  get speciesCount(): number {
    return this.alive > 0 ? 1 : 0;
  }

  private countAlive(): number {
    let n = 0;
    for (let i = 0; i < this.total; i++) n += this.cells[i]!;
    return n;
  }

  /** Direct cell poke — used by tests to seed known patterns (gliders).
   *  Keeps the alive counter in sync so stats stay truthful after a poke. */
  setCell(x: number, y: number, alive: boolean): void {
    const sx = ((x % this.size) + this.size) % this.size;
    const sy = ((y % this.size) + this.size) % this.size;
    const i = sy * this.size + sx;
    const v = alive ? 1 : 0;
    if (this.cells[i] !== v) {
      this.cells[i] = v;
      this.alive += v ? 1 : -1;
    }
  }

  getCell(x: number, y: number): number {
    const sx = ((x % this.size) + this.size) % this.size;
    const sy = ((y % this.size) + this.size) % this.size;
    return this.cells[sy * this.size + sx]!;
  }

  private push(event: SimEvent): void {
    // individual events are rate-limited; population-level ones always pass
    if (event.type === 'birth' || event.type === 'death') {
      if (this.individual >= EVENT_BUDGET) return;
      this.individual++;
    }
    this.pending.push(event);
  }

  step(): SimEvent[] {
    this.tickNum++;
    this.pending = [];
    this.individual = 0;
    const size = this.size;
    const cells = this.cells;
    const next = this.next;
    let births = 0;
    let deaths = 0;

    for (let y = 0; y < size; y++) {
      const yUp = ((y - 1 + size) % size) * size;
      const yMid = y * size;
      const yDown = ((y + 1) % size) * size;
      for (let x = 0; x < size; x++) {
        const xL = (x - 1 + size) % size;
        const xR = (x + 1) % size;
        const n =
          cells[yUp + xL]! + cells[yUp + x]! + cells[yUp + xR]! +
          cells[yMid + xL]! + cells[yMid + xR]! +
          cells[yDown + xL]! + cells[yDown + x]! + cells[yDown + xR]!;
        let v = cells[yMid + x]! ? (n === 2 || n === 3 ? 1 : 0) : n === 3 ? 1 : 0;
        if (this.noise > 0 && this.rng.nextFloat() < this.noise) v = v ? 0 : 1;
        next[yMid + x] = v;
      }
    }

    for (let i = 0; i < this.total; i++) {
      const a = cells[i]!;
      const b = next[i]!;
      // per-cell churn is reported through the births/deaths stats; the event
      // feed only gets population-level events (extinction, intervention)
      if (a !== b) {
        if (b) births++;
        else deaths++;
      }
      cells[i] = b;
    }

    this.alive += births - deaths;
    this.totalBirths += births;
    this.totalDeaths += deaths;
    if (this.alive === 0 && this.lastPopulation > 0) {
      this.push(makeEvent(this.worldId, this.tickNum, 1, 'extinction', {
        from: this.lastPopulation, to: 0,
      }));
    }
    this.lastPopulation = this.alive;
    const drained = this.pending;
    this.pending = [];
    return drained;
  }

  writeRows(out: AgentState[]): void {
    let k = 0;
    for (let i = 0; i < this.total; i++) {
      if (this.cells[i] === 0) continue;
      const r = out[k] ?? (out[k] = { id: 0, x: 0, y: 0, energy: 0, state: 0, species: 0, meme: 0 });
      r.id = i + 1;
      r.x = ((i % this.size) + 0.5) * this.cellSize;
      r.y = (Math.floor(i / this.size) + 0.5) * this.cellSize;
      r.energy = 1;
      r.state = STATE.ALIVE;
      r.species = 0;
      r.meme = 0;
      k++;
    }
    out.length = k;
  }

  /** Normalised entropy of the 2x2 block distribution (0..1) — the classic
   *  CA complexity measure: soup ~1, still lifes ~0, Life sits between. */
  private blockComplexity(): number {
    const size = this.size;
    const cells = this.cells;
    const counts = this.blockCounts;
    counts.fill(0);
    for (let y = 0; y < size; y++) {
      const yUp = ((y - 1 + size) % size) * size;
      const yMid = y * size;
      for (let x = 0; x < size; x++) {
        const xR = (x + 1) % size;
        const pat =
          (cells[yUp + x]! << 3) | (cells[yUp + xR]! << 2) | (cells[yMid + x]! << 1) | cells[yMid + xR]!;
        counts[pat]! += 1;
      }
    }
    let h = 0;
    for (let p = 0; p < 16; p++) {
      const c = counts[p]!;
      if (c <= 0) continue;
      const pr = c / this.total;
      h -= pr * Math.log2(pr);
    }
    return h / 4;
  }

  writeStats(s: SimStats): void {
    const complexity = this.blockComplexity();
    s.population = this.alive;
    s.aliveCount = this.alive;
    s.deadCount = this.totalDeaths;
    s.births = this.totalBirths;
    s.deaths = this.totalDeaths;
    s.speciesCount = this.alive > 0 ? 1 : 0;
    s.energySum = this.alive;
    s.avgEnergy = this.alive > 0 ? 1 : 0;
    s.caAliveFraction = this.alive / this.total;
    s.caComplexity = complexity;
    s.complexity = complexity;
    s.stateHash = fnvBytes(this.cells);
  }

  setMapFields(): SetMapFields | null {
    const depth = this.depth;
    for (let i = 0; i < this.total; i++) depth[i] = this.cells[i] ? 255 : 0;
    return { size: this.size, depth, escape: this.escape };
  }

  spawn(x: number, y: number): void {
    const cx = Math.floor(x / this.cellSize);
    const cy = Math.floor(y / this.cellSize);
    // a small cross so a single intervention is visible in the 48x48 view
    for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const sx = ((cx + dx!) % this.size + this.size) % this.size;
      const sy = ((cy + dy!) % this.size + this.size) % this.size;
      const i = sy * this.size + sx;
      if (!this.cells[i]) {
        this.cells[i] = 1;
        this.alive++;
        this.totalBirths++;
      }
    }
  }

  kill(x: number, y: number, radius: number): number {
    const r2 = radius * radius;
    let killed = 0;
    for (let i = 0; i < this.total; i++) {
      if (!this.cells[i]) continue;
      const dx = minImage(((i % this.size) + 0.5) * this.cellSize - x, WORLD_SIZE);
      const dy = minImage((Math.floor(i / this.size) + 0.5) * this.cellSize - y, WORLD_SIZE);
      if (dx * dx + dy * dy <= r2) {
        this.cells[i] = 0;
        this.alive--;
        this.totalDeaths++;
        killed++;
      }
    }
    return killed;
  }

  feed(x: number, y: number, amount: number): number {
    // seedFood on the lattice reseeds cells alive within a radius derived from amount
    const radius = Math.max(this.cellSize, Math.min(WORLD_SIZE / 4, amount / 4));
    const r2 = radius * radius;
    let seeded = 0;
    for (let i = 0; i < this.total; i++) {
      if (this.cells[i]) continue;
      const dx = minImage(((i % this.size) + 0.5) * this.cellSize - x, WORLD_SIZE);
      const dy = minImage((Math.floor(i / this.size) + 0.5) * this.cellSize - y, WORLD_SIZE);
      if (dx * dx + dy * dy <= r2) {
        this.cells[i] = 1;
        this.alive++;
        this.totalBirths++;
        seeded++;
        if (seeded >= 256) break; // bounded so a huge amount cannot flood the grid
      }
    }
    return seeded;
  }

  setTimeScale(timeScale: number): void {
    this.params.timeScale = timeScale;
  }
}
