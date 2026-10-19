import type { AgentState, SimEvent, SimStats, SubstrateConfig, WorldConfig, WorldParams } from '@fractal-life/shared';
import { MAX_AGENTS, STATE, WORLD_SIZE } from '@fractal-life/shared';
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
 * Graph substrate: nodes linked to their k nearest neighbours within a radius
 * (the graph is the proximity structure — layout forces keep adjacency
 * meaningful in the graph view). Node states run an excitable-medium rule:
 * spikes propagate along edges as activation waves, spiked nodes bud new nodes
 * (birth) and nodes without drive starve (death), so topology, waves and
 * population all evolve together from the seed.
 */
export class GraphSubstrate implements SubstrateKernel {
  readonly kind: KernelKind = 'graph';
  readonly params: WorldParams;

  private readonly worldId: string;
  private readonly rng: SplitMix64;
  private readonly hash: SpatialHash;
  private readonly scratch = new Int32Array(256);
  private readonly cfg: SubstrateConfig | undefined;

  private readonly maxDeg = 8;
  private readonly rest = 40;
  private readonly springK = 0.004;
  private readonly hardRepR = 14;
  private readonly drag = 0.88;
  private readonly vMax = 3;
  private readonly leakAbs = 0.004;
  private readonly leakRel = 0.02;
  private readonly drive = 0.9;
  private readonly driveCap = 1.8;
  private readonly ignitionP = 0.02;
  private readonly budP = 0.04;
  private readonly mutation = 0.12;
  private readonly maxSpecies = 16;
  private readonly spikeBaseline = 0.3;

  private cap: number;
  private linkRadius: number;
  private n = 0;
  private idCounter = 0;
  private id: Uint32Array;
  private x: Float32Array;
  private y: Float32Array;
  private vx: Float32Array;
  private vy: Float32Array;
  private u: Float32Array;
  private uPrev: Float32Array;
  private refr: Uint8Array;
  private species: Uint32Array;
  private deadFlag: Uint8Array;
  private neigh: Int32Array;
  private deg: Uint16Array;
  private speciesCounts = new Uint32Array(17);
  private hasher = new ByteHasher();
  private activity = new Float32Array(64 * 64);
  /** scratch for top-k neighbour selection (reused, no per-tick allocation) */
  private bestD2 = new Float64Array(this.maxDeg);
  private bestSlot = new Int32Array(this.maxDeg);
  private _depth: Uint8Array | null = null;
  private _escape: Uint8Array | null = null;

  private tickNum = 0;
  private totalBirths = 0;
  private totalDeaths = 0;
  private lastPopulation = 0;
  private pending: SimEvent[] = [];
  private individual = 0;

  constructor(world: WorldConfig) {
    this.worldId = world.id;
    this.params = world.params;
    this.cfg = world.substrate;
    this.rng = new SplitMix64(kernelSeed(world, 'graph'));
    this.hash = new SpatialHash(64); // coarse cells: link queries span few buckets
    this.cap = Math.max(50, Math.min(MAX_AGENTS, 3000, Math.round(world.params.maxPopulation)));
    this.linkRadius = Math.max(40, Math.min(400, this.cfg?.linkRadius ?? 90));
    this.id = new Uint32Array(this.cap);
    this.x = new Float32Array(this.cap);
    this.y = new Float32Array(this.cap);
    this.vx = new Float32Array(this.cap);
    this.vy = new Float32Array(this.cap);
    this.u = new Float32Array(this.cap);
    this.uPrev = new Float32Array(this.cap);
    this.refr = new Uint8Array(this.cap);
    this.species = new Uint32Array(this.cap);
    this.deadFlag = new Uint8Array(this.cap);
    this.neigh = new Int32Array(this.cap * this.maxDeg);
    this.deg = new Uint16Array(this.cap);

    const founders = Math.max(40, Math.min(this.cap, Math.round(world.params.spawnCount)));
    for (let i = 0; i < founders; i++) {
      const s = this.n++;
      this.id[s] = ++this.idCounter;
      this.x[s] = wrapPos(this.rng.nextFloat() * WORLD_SIZE, WORLD_SIZE);
      this.y[s] = wrapPos(this.rng.nextFloat() * WORLD_SIZE, WORLD_SIZE);
      let u = 0.3 + this.rng.nextFloat() * 0.4;
      if (this.rng.nextFloat() < 0.05) u = 1.05; // seed ignitors so waves start from the seed
      this.u[s] = u;
      this.species[s] = 0;
    }
    this.lastPopulation = this.n;
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

  private push(event: SimEvent): void {
    if (event.type === 'birth' || event.type === 'death') {
      if (this.individual >= EVENT_BUDGET) return;
      this.individual++;
    }
    this.pending.push(event);
  }

  /** Rebuild the proximity graph: up to maxDeg nearest nodes within linkRadius,
   *  tie-broken by id so the selection is independent of hash scan order. */
  private rebuildNeighbors(n0: number): void {
    const maxD2 = this.linkRadius * this.linkRadius;
    const bestD2 = this.bestD2;
    const bestSlot = this.bestSlot;
    // slots are stable until the end-of-tick compaction, so neighbour slots
    // index uPrev/x directly; the hash is keyed by slot, not by agent id
    this.hash.clear();
    for (let i = 0; i < n0; i++) this.hash.insert(i, this.x[i]!, this.y[i]!);
    for (let i = 0; i < n0; i++) {
      let count = 0;
      for (let c = 0; c < bestD2.length; c++) bestSlot[c] = -1;
      const k = this.hash.queryNeighbors(this.x[i]!, this.y[i]!, this.linkRadius, this.scratch, this.scratch.length);
      for (let c = 0; c < k; c++) {
        const slot = this.scratch[c]!;
        if (slot === i) continue;
        const dx = minImage(this.x[slot]! - this.x[i]!, WORLD_SIZE);
        const dy = minImage(this.y[slot]! - this.y[i]!, WORLD_SIZE);
        const d2 = dx * dx + dy * dy;
        if (d2 > maxD2) continue;
        // early-out: with a full buffer, only a strictly-worse distance (ties
        // can still win on id) can beat the current worst slot
        if (count === this.maxDeg && d2 > bestD2[this.maxDeg - 1]!) continue;
        // insert into the top-maxDeg buffer sorted by (d2, id)
        let pos = count < this.maxDeg ? count : this.maxDeg;
        while (pos > 0 && this.better(d2, slot, bestD2[pos - 1]!, bestSlot[pos - 1]!)) pos--;
        if (pos >= this.maxDeg) continue; // full and ranked worst — drop
        if (count < this.maxDeg) count++;
        for (let m = count - 1; m > pos; m--) {
          bestD2[m] = bestD2[m - 1]!;
          bestSlot[m] = bestSlot[m - 1]!;
        }
        bestD2[pos] = d2;
        bestSlot[pos] = slot;
      }
      this.deg[i] = count;
      const base = i * this.maxDeg;
      for (let m = 0; m < count; m++) this.neigh[base + m] = bestSlot[m]!;
      for (let m = count; m < this.maxDeg; m++) this.neigh[base + m] = -1;
    }
  }

  /** true when (d2, slot) sorts before (od2, oslot). */
  private better(d2: number, slot: number, od2: number, oslot: number): boolean {
    if (d2 !== od2) return d2 < od2;
    return this.id[slot]! < this.id[oslot]!;
  }

  step(): SimEvent[] {
    this.tickNum++;
    this.pending = [];
    this.individual = 0;
    const n0 = this.n;
    this.rebuildNeighbors(n0);

    for (let i = 0; i < n0; i++) this.uPrev[i] = this.u[i]!;

    // --- synchronous excitable dynamics (ascending id; children appended past n0) ---
    let deaths = 0;
    for (let i = 0; i < n0; i++) {
      if (this.deadFlag[i]) continue;
      const prev = this.uPrev[i]!;
      let u: number;
      if (this.refr[i]! > 0) {
        // just-fired nodes hold their spike marker (u >= 1) for exactly one
        // tick so neighbours see it via uPrev; only then reset to baseline
        u = prev >= 1 ? this.spikeBaseline : Math.max(this.spikeBaseline * 0.3, prev * 0.98 - 0.005);
        this.refr[i]! -= 1;
      } else {
        let drive = 0;
        const base = i * this.maxDeg;
        const deg = this.deg[i]!;
        for (let m = 0; m < deg; m++) {
          const j = this.neigh[base + m]!;
          if (this.uPrev[j]! >= 1) {
            drive += this.drive;
            if (drive >= this.driveCap) break;
          }
        }
        u = prev * (1 - this.leakRel) - this.leakAbs + drive;
        if (u < 1 && this.rng.nextFloat() < this.ignitionP) u = 1.05; // spontaneous ignition
        if (u >= 1) {
          u = 1.02; // spike marker — lowered by the refractory branch next tick
          this.refr[i] = 10;
          this.bud(i);
        }
      }
      if (u <= 0) {
        this.deadFlag[i] = 1;
        this.totalDeaths++;
        deaths++;
        this.push(makeEvent(this.worldId, this.tickNum, 0.3, 'death', {
          agentId: this.id[i]!, cause: 'starvation', species: this.species[i]!,
          x: this.x[i]!, y: this.y[i]!, age: 0, energy: 0,
        }));
        u = 0;
      }
      this.u[i] = u;
    }

    // --- layout forces from the rebuilt graph ---
    for (let i = 0; i < n0; i++) {
      if (this.deadFlag[i]) continue;
      let fx = 0;
      let fy = 0;
      const base = i * this.maxDeg;
      const deg = this.deg[i]!;
      for (let m = 0; m < deg; m++) {
        const j = this.neigh[base + m]!;
        if (j < 0) continue;
        const dx = minImage(this.x[j]! - this.x[i]!, WORLD_SIZE);
        const dy = minImage(this.y[j]! - this.y[i]!, WORLD_SIZE);
        const d2 = dx * dx + dy * dy;
        if (d2 < 1e-4) continue;
        const d = Math.sqrt(d2);
        if (d < this.hardRepR) {
          const fmag = ((this.hardRepR - d) / this.hardRepR) * 0.4;
          fx += (dx / d) * fmag;
          fy += (dy / d) * fmag;
        } else {
          const fmag = (d - this.rest) * this.springK;
          fx += (dx / d) * fmag;
          fy += (dy / d) * fmag;
        }
      }
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

    if (deaths > 0) this.compact(n0);
    if (this.n === 0 && this.lastPopulation > 0) {
      this.push(makeEvent(this.worldId, this.tickNum, 1, 'extinction', { from: this.lastPopulation, to: 0 }));
    }
    this.lastPopulation = this.n;

    const drained = this.pending;
    this.pending = [];
    return drained;
  }

  /** A spiked node may bud a child near itself (birth), inheriting species
   *  with a mutation chance. Called from the dynamics loop; the child sits
   *  past n0 so it is not iterated until the next tick. */
  private bud(i: number): void {
    if (this.n >= this.cap) return;
    if (this.rng.nextFloat() >= this.budP) return;
    const s = this.n++;
    this.id[s] = ++this.idCounter;
    this.x[s] = wrapPos(this.x[i]! + this.rng.nextSigned() * 10, WORLD_SIZE);
    this.y[s] = wrapPos(this.y[i]! + this.rng.nextSigned() * 10, WORLD_SIZE);
    this.vx[s] = this.vx[i]!;
    this.vy[s] = this.vy[i]!;
    this.u[s] = 0.35;
    this.refr[s] = 0;
    this.deadFlag[s] = 0;
    this.deg[s] = 0; // neighbours are rebuilt at the start of the next tick
    const mutate = this.rng.nextFloat() < this.mutation;
    this.species[s] = mutate && this.species[i]! + 1 < this.maxSpecies ? this.species[i]! + 1 : this.species[i]!;
    this.totalBirths++;
    this.push(makeEvent(this.worldId, this.tickNum, 0.3, 'birth', {
      agentId: this.id[s]!, parentId: this.id[i]!, species: this.species[s]!,
      x: this.x[s]!, y: this.y[s]!, energy: 0.35,
    }));
  }

  /** Order-preserving removal of flagged bodies. Children (>= n0) are kept. */
  private compact(n0: number): void {
    let w = 0;
    for (let r = 0; r < this.n; r++) {
      if (r < n0) {
        if (this.deadFlag[r]) {
          this.deadFlag[r] = 0;
          continue;
        }
      }
      if (w !== r) {
        this.id[w] = this.id[r]!;
        this.x[w] = this.x[r]!;
        this.y[w] = this.y[r]!;
        this.vx[w] = this.vx[r]!;
        this.vy[w] = this.vy[r]!;
        this.u[w] = this.u[r]!;
        this.refr[w] = this.refr[r]!;
        this.species[w] = this.species[r]!;
        this.deg[w] = this.deg[r]!;
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
    for (let i = 0; i < this.n; i++) {
      const r = out[i] ?? (out[i] = { id: 0, x: 0, y: 0, energy: 0, state: 0, species: 0, meme: 0 });
      r.id = this.id[i]!;
      r.x = this.x[i]!;
      r.y = this.y[i]!;
      r.energy = Math.max(0, Math.min(1, this.u[i]!));
      r.state = STATE.ALIVE;
      r.species = this.species[i]!;
      r.meme = 0;
    }
    out.length = this.n;
  }

  writeStats(s: SimStats): void {
    this.countSpecies();
    const counts = this.speciesCounts;
    const n = this.n;
    let speciesN = 0;
    let uSum = 0;
    let speedSum = 0;
    let degSum = 0;
    for (let c = 0; c < counts.length; c++) if (counts[c]! > 0) speciesN++;
    for (let i = 0; i < n; i++) {
      uSum += this.u[i]!;
      speedSum += Math.hypot(this.vx[i]!, this.vy[i]!);
      degSum += this.deg[i]!;
    }
    const entropy = shannonFromCounts(counts, n);
    const complexity = entropy > 0 ? entropy * (1 - entropy / Math.log2(counts.length)) : 0;
    const h = this.hasher;
    for (let i = 0; i < n; i++) {
      h.u16(this.id[i]!);
      h.u16(this.x[i]! / 4);
      h.u16(this.y[i]! / 4);
      h.u16(this.u[i]! * 100);
      h.u16(this.species[i]!);
    }
    s.population = n;
    s.aliveCount = n;
    s.deadCount = this.totalDeaths;
    s.births = this.totalBirths;
    s.deaths = this.totalDeaths;
    s.speciesCount = speciesN;
    s.energySum = uSum * 100;
    s.avgEnergy = n > 0 ? (uSum / n) * 100 : 0;
    s.entropy = entropy;
    s.diversity = simpsonFromCounts(counts, n);
    s.complexity = complexity;
    s.spatialEntropy = spatialEntropy(this.x, this.y, n, 48, WORLD_SIZE);
    s.metabolicRate = n > 0 ? speedSum / n : 0;
    // proximity-graph connectivity: mean degree share (0..1)
    s.clusterOrder = n > 0 ? degSum / (n * this.maxDeg) : 0;
    s.stateHash = h.value;
  }

  setMapFields(): SetMapFields | null {
    const bins = 64;
    const cell = WORLD_SIZE / bins;
    this.activity.fill(0);
    for (let i = 0; i < this.n; i++) {
      const bx = Math.min(bins - 1, Math.floor(this.x[i]! / cell));
      const by = Math.min(bins - 1, Math.floor(this.y[i]! / cell));
      this.activity[by * bins + bx]! += this.u[i]!;
    }
    let peak = 1e-6;
    for (let i = 0; i < this.activity.length; i++) if (this.activity[i]! > peak) peak = this.activity[i]!;
    const size = 128;
    const depth = this.depthBuf(size);
    const scale = 255 / peak;
    for (let by = 0; by < bins; by++) {
      for (let bx = 0; bx < bins; bx++) {
        const v = (this.activity[by * bins + bx]! * scale) | 0;
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

  private depthBuf(size: number): Uint8Array {
    if (!this._depth || this._depth.length !== size * size) this._depth = new Uint8Array(size * size);
    return this._depth;
  }

  private escapeBuf(size: number): Uint8Array {
    if (!this._escape || this._escape.length !== size * size) this._escape = new Uint8Array(size * size);
    return this._escape;
  }

  spawn(x: number, y: number): void {
    if (this.n >= this.cap) return;
    const s = this.n++;
    this.id[s] = ++this.idCounter;
    this.x[s] = wrapPos(x, WORLD_SIZE);
    this.y[s] = wrapPos(y, WORLD_SIZE);
    this.vx[s] = 0;
    this.vy[s] = 0;
    this.u[s] = 1.05; // spawn ignites, so the new node immediately signals
    this.refr[s] = 0;
    this.species[s] = 0;
    this.deadFlag[s] = 0;
    this.deg[s] = 0; // neighbours are rebuilt at the start of the next tick
  }

  kill(x: number, y: number, radius: number): number {
    const r2 = radius * radius;
    let killed = 0;
    for (let i = 0; i < this.n; i++) {
      if (this.deadFlag[i]) continue;
      const dx = minImage(this.x[i]! - x, WORLD_SIZE);
      const dy = minImage(this.y[i]! - y, WORLD_SIZE);
      if (dx * dx + dy * dy <= r2) {
        this.deadFlag[i] = 1;
        this.totalDeaths++;
        killed++;
      }
    }
    if (killed > 0) this.compact(this.n);
    return killed;
  }

  feed(x: number, y: number, amount: number): number {
    const r2 = 128 * 128;
    const boost = amount / 100;
    let fed = 0;
    for (let i = 0; i < this.n; i++) {
      const dx = minImage(this.x[i]! - x, WORLD_SIZE);
      const dy = minImage(this.y[i]! - y, WORLD_SIZE);
      if (dx * dx + dy * dy > r2) continue;
      const v = this.u[i]! + boost;
      this.u[i] = v > 1.4 ? 1.4 : v;
      fed++;
    }
    return fed;
  }

  setTimeScale(timeScale: number): void {
    this.params.timeScale = timeScale;
  }
}
