import type { AgentState, SimEvent, SimStats, SubstrateConfig, WorldConfig, WorldParams } from '@fractal-life/shared';
import { MAX_AGENTS, SPATIAL_CELL, STATE, WORLD_SIZE } from '@fractal-life/shared';
import { SplitMix64 } from '../rng.js';
import { SpatialHash } from '../spatialHash.js';
import {
  ByteHasher,
  EVENT_BUDGET,
  makeEvent,
  kernelSeed,
  minImage,
  shannonFromCounts,
  simpsonFromCounts,
  spatialEntropy,
  wrapPos,
  type KernelKind,
  type SetMapFields,
  type SubstrateKernel,
} from './types.js';

/**
 * Particle substrate: an attraction-repulsion swarm (soft springs around a
 * rest length + short-range repulsion) whose bodies carry energy, split when
 * satiated and starve — the resource field depletes and regenerates, so the
 * population self-organises into boom/bust life cycles instead of converging
 * to a static shape.
 */
export class ParticleSubstrate implements SubstrateKernel {
  readonly kind: KernelKind = 'particles';
  readonly params: WorldParams;

  private readonly worldId: string;
  private readonly rng: SplitMix64;
  private readonly hash: SpatialHash;
  private readonly scratch = new Int32Array(160);
  private readonly cfg: SubstrateConfig | undefined;

  // --- swarm geometry (world units) ---
  private readonly rest = 44;
  private readonly attrR = 72;
  private readonly repR = 16;
  private readonly springK = 0.032;
  private readonly drag = 0.92;
  private readonly vMax = 5;

  // --- resource field ---
  private readonly foodCells = 64;
  private readonly food = new Float32Array(64 * 64);
  private readonly foodRegen = 0.08;
  private readonly eatMax = 0.4;
  private readonly eatGain = 1.4;

  // --- life cycle ---
  private readonly splitThreshold = 80;
  private readonly splitChance = 0.4;
  private readonly mutation = 0.1;
  private readonly maxSpecies = 16;

  private cap: number;
  private n = 0;
  private idCounter = 0;
  private id: Uint32Array;
  private x: Float32Array;
  private y: Float32Array;
  private vx: Float32Array;
  private vy: Float32Array;
  private energy: Float32Array;
  private species: Uint32Array;
  private age: Uint16Array;
  private deadFlag: Uint8Array;
  private speciesCounts = new Uint32Array(17);
  private hasher = new ByteHasher();

  private tickNum = 0;
  private totalBirths = 0;
  private totalDeaths = 0;
  private pending: SimEvent[] = [];
  private individual = 0;

  constructor(world: WorldConfig) {
    this.worldId = world.id;
    this.params = world.params;
    this.cfg = world.substrate;
    this.rng = new SplitMix64(kernelSeed(world, 'particles'));
    this.hash = new SpatialHash(SPATIAL_CELL);
    this.cap = Math.max(16, Math.min(MAX_AGENTS, Math.round(world.params.maxPopulation)));
    this.id = new Uint32Array(this.cap);
    this.x = new Float32Array(this.cap);
    this.y = new Float32Array(this.cap);
    this.vx = new Float32Array(this.cap);
    this.vy = new Float32Array(this.cap);
    this.energy = new Float32Array(this.cap);
    this.species = new Uint32Array(this.cap);
    this.age = new Uint16Array(this.cap);
    this.deadFlag = new Uint8Array(this.cap);

    for (let i = 0; i < this.food.length; i++) this.food[i] = 1;

    const founders = Math.max(24, Math.min(this.cap, Math.round(world.params.spawnCount)));
    for (let i = 0; i < founders; i++) this.pushBody();
    for (let i = 0; i < this.n; i++) {
      this.energy[i] = 50 + this.rng.nextFloat() * 25;
      this.vx[i] = this.rng.nextSigned() * 0.5;
      this.vy[i] = this.rng.nextSigned() * 0.5;
    }
  }

  get currentTick(): number {
    return this.tickNum;
  }

  get population(): number {
    return this.n;
  }

  get speciesCount(): number {
    this.countSpecies();
    let k = 0;
    for (let s = 0; s < this.speciesCounts.length; s++) if (this.speciesCounts[s]! > 0) k++;
    return k;
  }

  /** Append a body at the current rng position (also used by spawn()). */
  private pushBody(): number {
    if (this.n >= this.cap) return -1;
    const i = this.n++;
    this.id[i] = ++this.idCounter;
    this.x[i] = wrapPos(this.rng.nextFloat() * WORLD_SIZE, WORLD_SIZE);
    this.y[i] = wrapPos(this.rng.nextFloat() * WORLD_SIZE, WORLD_SIZE);
    this.vx[i] = 0;
    this.vy[i] = 0;
    this.energy[i] = 60;
    this.species[i] = 0;
    this.age[i] = 0;
    this.deadFlag[i] = 0;
    return i;
  }

  private push(event: SimEvent): void {
    if (event.type === 'birth' || event.type === 'death') {
      if (this.individual >= EVENT_BUDGET) return;
      this.individual++;
    }
    this.pending.push(event);
  }

  private foodIndex(x: number, y: number): number {
    const cell = WORLD_SIZE / this.foodCells;
    const fx = Math.min(this.foodCells - 1, Math.floor(x / cell));
    const fy = Math.min(this.foodCells - 1, Math.floor(y / cell));
    return fy * this.foodCells + fx;
  }

  step(): SimEvent[] {
    this.tickNum++;
    this.pending = [];
    this.individual = 0;
    const n0 = this.n;
    const attraction = Math.max(0, this.cfg?.attraction ?? 1);
    const repulsion = Math.max(0, this.cfg?.repulsion ?? 1);
    const attrR2 = this.attrR * this.attrR;
    const repR2 = this.repR * this.repR;

    // --- neighbour structure (ascending slot order; slots are stable until
    // the end-of-tick compaction, so query results index the arrays directly) ---
    this.hash.clear();
    for (let i = 0; i < n0; i++) this.hash.insert(i, this.x[i]!, this.y[i]!);

    // --- forces + integration ---
    for (let i = 0; i < n0; i++) {
      let fx = 0;
      let fy = 0;
      const k = this.hash.queryNeighbors(this.x[i]!, this.y[i]!, this.attrR, this.scratch, this.scratch.length);
      for (let c = 0; c < k; c++) {
        const jSlot = this.scratch[c]!;
        if (jSlot === i) continue;
        const dx = minImage(this.x[jSlot]! - this.x[i]!, WORLD_SIZE);
        const dy = minImage(this.y[jSlot]! - this.y[i]!, WORLD_SIZE);
        const d2 = dx * dx + dy * dy;
        if (d2 < 1e-4 || d2 > attrR2) continue;
        const d = Math.sqrt(d2);
        if (d2 < repR2) {
          // hard short-range repulsion
          const fmag = (1 - d / this.repR) * 1.6 * repulsion;
          fx -= (dx / d) * fmag;
          fy -= (dy / d) * fmag;
        } else {
          // soft spring around the rest length: push below, pull above
          const fmag = this.springK * ((d - this.rest) / (this.attrR - this.rest));
          fx += (dx / d) * fmag * attraction;
          fy += (dy / d) * fmag * attraction;
        }
      }
      fx += this.rng.nextSigned() * 0.12;
      fy += this.rng.nextSigned() * 0.12;
      let nvx = (this.vx[i]! + fx) * this.drag;
      let nvy = (this.vy[i]! + fy) * this.drag;
      const sp2 = nvx * nvx + nvy * nvy;
      if (sp2 > this.vMax * this.vMax) {
        const s = this.vMax / Math.sqrt(sp2);
        nvx *= s;
        nvy *= s;
      }
      this.vx[i] = nvx;
      this.vy[i] = nvy;
      this.x[i] = wrapPos(this.x[i]! + nvx, WORLD_SIZE);
      this.y[i] = wrapPos(this.y[i]! + nvy, WORLD_SIZE);
    }

    // --- resources + life cycle (ascending id; deaths flagged, then compacted) ---
    let deaths = 0;
    const energyCap = Math.max(this.splitThreshold, this.params.energyCapacity) * 1.2;
    for (let i = 0; i < n0; i++) {
      if (this.deadFlag[i]) continue;
      const fi = this.foodIndex(this.x[i]!, this.y[i]!);
      const eat = Math.min(this.food[fi]!, this.eatMax);
      this.food[fi]! -= eat;
      const speed2 = this.vx[i]! * this.vx[i]! + this.vy[i]! * this.vy[i]!;
      this.energy[i]! += eat * this.eatGain - (0.1 + 0.01 * speed2);
      if (this.energy[i]! > energyCap) this.energy[i] = energyCap;
      this.age[i] = Math.min(65534, this.age[i]! + 1);

      if (this.age[i]! >= this.params.agentMaxAge) {
        this.killBody(i, 'age');
        deaths++;
        continue;
      }
      if (this.energy[i]! <= 0) {
        this.killBody(i, 'starvation');
        deaths++;
        continue;
      }
      if (this.energy[i]! >= this.splitThreshold && this.n < this.cap && this.rng.nextFloat() < this.splitChance) {
        this.splitBody(i);
      }
    }

    if (deaths > 0) this.compact();

    // --- resource regeneration ---
    for (let i = 0; i < this.food.length; i++) {
      const v = this.food[i]! + this.foodRegen;
      this.food[i] = v > 1 ? 1 : v;
    }

    const drained = this.pending;
    this.pending = [];
    return drained;
  }

  private killBody(i: number, cause: 'age' | 'starvation' | 'intervention'): void {
    this.push(makeEvent(this.worldId, this.tickNum, 0.3, 'death', {
      agentId: this.id[i]!,
      cause,
      species: this.species[i]!,
      x: this.x[i]!,
      y: this.y[i]!,
      age: this.age[i]!,
      energy: Math.max(0, this.energy[i]!),
    }));
    this.deadFlag[i] = 1;
    this.totalDeaths++;
  }

  private splitBody(i: number): void {
    const child = this.pushBody();
    if (child < 0) return;
    const half = this.energy[i]! * 0.5;
    this.energy[i] = half;
    this.energy[child] = half;
    this.age[child] = 0;
    this.x[child] = wrapPos(this.x[i]! + this.rng.nextSigned() * 6, WORLD_SIZE);
    this.y[child] = wrapPos(this.y[i]! + this.rng.nextSigned() * 6, WORLD_SIZE);
    this.vx[child] = this.vx[i]! + this.rng.nextSigned() * 0.3;
    this.vy[child] = this.vy[i]! + this.rng.nextSigned() * 0.3;
    const mutate = this.rng.nextFloat() < this.mutation;
    this.species[child] = mutate && this.species[i]! + 1 < this.maxSpecies ? this.species[i]! + 1 : this.species[i]!;
    this.totalBirths++;
    this.push(makeEvent(this.worldId, this.tickNum, 0.3, 'birth', {
      agentId: this.id[child]!,
      parentId: this.id[i]!,
      species: this.species[child]!,
      x: this.x[child]!,
      y: this.y[child]!,
      energy: Math.min(1, this.energy[child]! / this.params.energyCapacity),
    }));
  }

  /** Order-preserving removal of flagged bodies (keeps ascending id order). */
  private compact(): void {
    let w = 0;
    for (let r = 0; r < this.n; r++) {
      if (this.deadFlag[r]) {
        this.deadFlag[r] = 0;
        continue;
      }
      if (w !== r) {
        this.id[w] = this.id[r]!;
        this.x[w] = this.x[r]!;
        this.y[w] = this.y[r]!;
        this.vx[w] = this.vx[r]!;
        this.vy[w] = this.vy[r]!;
        this.energy[w] = this.energy[r]!;
        this.species[w] = this.species[r]!;
        this.age[w] = this.age[r]!;
        this.deadFlag[w] = 0;
      }
      w++;
    }
    this.n = w;
  }

  private countSpecies(): void {
    this.speciesCounts.fill(0);
    for (let i = 0; i < this.n; i++) {
      const s = this.species[i]!;
      if (s < this.speciesCounts.length) this.speciesCounts[s]! += 1;
    }
  }

  writeRows(out: AgentState[]): void {
    const energyCap = Math.max(1, this.params.energyCapacity);
    for (let i = 0; i < this.n; i++) {
      const r = out[i] ?? (out[i] = { id: 0, x: 0, y: 0, energy: 0, state: 0, species: 0, meme: 0 });
      r.id = this.id[i]!;
      r.x = this.x[i]!;
      r.y = this.y[i]!;
      r.energy = Math.max(0, Math.min(1, this.energy[i]! / energyCap));
      r.state = STATE.ALIVE;
      r.species = this.species[i]!;
      r.meme = 0;
    }
    out.length = this.n;
  }

  writeStats(s: SimStats): void {
    this.countSpecies();
    const counts = this.speciesCounts;
    let speciesN = 0;
    let energySum = 0;
    let speedSum = 0;
    for (let c = 0; c < counts.length; c++) if (counts[c]! > 0) speciesN++;
    for (let i = 0; i < this.n; i++) {
      energySum += this.energy[i]!;
      speedSum += Math.hypot(this.vx[i]!, this.vy[i]!);
    }
    const n = this.n;
    const entropy = shannonFromCounts(counts, n);
    // LMC: entropy x disequilibrium against the uniform 17-bin distribution
    const complexity = entropy > 0 ? entropy * (1 - entropy / Math.log2(counts.length)) : 0;
    const h = this.hasher;
    for (let i = 0; i < n; i++) {
      h.u16(this.id[i]!);
      h.u16(this.x[i]! / 4);
      h.u16(this.y[i]! / 4);
      h.u16(this.energy[i]! * 8);
      h.u16(this.species[i]!);
    }
    s.population = n;
    s.aliveCount = n;
    s.deadCount = this.totalDeaths;
    s.births = this.totalBirths;
    s.deaths = this.totalDeaths;
    s.speciesCount = speciesN;
    s.energySum = energySum;
    s.avgEnergy = n > 0 ? energySum / n : 0;
    s.entropy = entropy;
    s.diversity = simpsonFromCounts(counts, n);
    s.complexity = complexity;
    s.spatialEntropy = spatialEntropy(this.x, this.y, n, 48, WORLD_SIZE);
    s.metabolicRate = n > 0 ? speedSum / n : 0;
    s.stateHash = h.value;
  }

  setMapFields(): SetMapFields | null {
    // bin into 64x64 then replicate x2 into the 128x128 terrain grid
    const bins = 64;
    const cell = WORLD_SIZE / bins;
    const counts = new Uint16Array(bins * bins);
    let peak = 1;
    for (let i = 0; i < this.n; i++) {
      const bx = Math.min(bins - 1, Math.floor(this.x[i]! / cell));
      const by = Math.min(bins - 1, Math.floor(this.y[i]! / cell));
      const c = ++counts[by * bins + bx]!;
      if (c > peak) peak = c;
    }
    const size = 128;
    const depth = this.depthBuf(size);
    const scale = 255 / peak;
    for (let by = 0; by < bins; by++) {
      for (let bx = 0; bx < bins; bx++) {
        const v = (counts[by * bins + bx]! * scale) | 0;
        const px = v > 255 ? 255 : v;
        const ox = bx * 2;
        const oy = by * 2;
        depth[oy * size + ox] = px;
        depth[oy * size + ox + 1] = px;
        depth[(oy + 1) * size + ox] = px;
        depth[(oy + 1) * size + ox + 1] = px;
      }
    }
    return { size, depth, escape: this.escapeBuf(size) };
  }

  private _depth: Uint8Array | null = null;
  private _escape: Uint8Array | null = null;

  private depthBuf(size: number): Uint8Array {
    if (!this._depth || this._depth.length !== size * size) this._depth = new Uint8Array(size * size);
    return this._depth;
  }

  private escapeBuf(size: number): Uint8Array {
    if (!this._escape || this._escape.length !== size * size) this._escape = new Uint8Array(size * size);
    return this._escape;
  }

  spawn(x: number, y: number): void {
    const i = this.pushBody();
    if (i < 0) return;
    this.x[i] = wrapPos(x, WORLD_SIZE);
    this.y[i] = wrapPos(y, WORLD_SIZE);
    this.energy[i] = 60;
  }

  kill(x: number, y: number, radius: number): number {
    const r2 = radius * radius;
    let killed = 0;
    for (let i = 0; i < this.n; i++) {
      if (this.deadFlag[i]) continue;
      const dx = minImage(this.x[i]! - x, WORLD_SIZE);
      const dy = minImage(this.y[i]! - y, WORLD_SIZE);
      if (dx * dx + dy * dy <= r2) {
        this.killBody(i, 'intervention');
        killed++;
      }
    }
    if (killed > 0) this.compact();
    return killed;
  }

  feed(x: number, y: number, amount: number): number {
    const radius = 128;
    const cell = WORLD_SIZE / this.foodCells;
    const r2 = radius * radius;
    const perCell = amount / 50;
    let cells = 0;
    for (let fy = 0; fy < this.foodCells; fy++) {
      for (let fx = 0; fx < this.foodCells; fx++) {
        const cx = (fx + 0.5) * cell;
        const cy = (fy + 0.5) * cell;
        const dx = minImage(cx - x, WORLD_SIZE);
        const dy = minImage(cy - y, WORLD_SIZE);
        if (dx * dx + dy * dy > r2) continue;
        const v = this.food[fy * this.foodCells + fx]! + perCell;
        this.food[fy * this.foodCells + fx] = v > 1 ? 1 : v;
        cells++;
      }
    }
    return cells;
  }

  setTimeScale(timeScale: number): void {
    this.params.timeScale = timeScale;
  }
}
