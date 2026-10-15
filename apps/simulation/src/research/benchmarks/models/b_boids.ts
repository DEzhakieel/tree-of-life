/**
 * Benchmark B — Boids flocking (Reynolds 1987 / Vicsek 1995).
 *
 * The three classic steering rules — alignment, cohesion, separation — on a
 * torus. The canonical signature is the polarization order parameter
 *
 *     Φ = |Σ v̂_i| / N
 *
 * With alignment on, the flock orders (Φ → ~1); with alignment off, headings
 * stay random and Φ ≈ 1/√N. Separation must keep agents apart.
 *
 * Neighbour lookups use a uniform grid (the classic O(N²) form is far too slow
 * for the full budget) and a light positional relaxation guarantees the
 * no-overlap signature that pure velocity steering cannot (the symmetric
 * separation sum cancels at the centre of a crowd).
 */

import { BenchRng, seedFromString } from '../rng.js';
import { sha256OfNumbers } from '../signatures.js';
import type { BenchmarkModel, BenchmarkScale, BenchParams, RunOutput } from '../types.js';

interface Flock {
  x: Float64Array;
  y: Float64Array;
  vx: Float64Array;
  vy: Float64Array;
}

interface BoidsParams {
  n: number;
  steps: number;
  L: number;
  r: number;
  sepR: number;
  maxSpeed: number;
  warmup: number;
}

const FULL: BoidsParams = { n: 160, steps: 240, L: 180, r: 25, sepR: 7, maxSpeed: 2, warmup: 100 };
const QUICK: BoidsParams = { n: 140, steps: 180, L: 160, r: 25, sepR: 7, maxSpeed: 2, warmup: 70 };

const TURN = 0.5;
const MAX_PASSES = 6;

function wrapDelta(d: number, L: number): number {
  let v = d % L;
  if (v > L / 2) v -= L;
  else if (v < -L / 2) v += L;
  return v;
}

/** Uniform grid over the torus for O(1) amortised neighbour queries. */
class Grid {
  readonly nx: number;
  readonly cell: number;
  private readonly counts: Int32Array;
  private readonly starts: Int32Array;
  private readonly order: Int32Array;
  private readonly cursor: Int32Array;

  constructor(private readonly n: number, L: number, cell: number) {
    this.cell = cell;
    this.nx = Math.max(3, Math.floor(L / cell));
    const nc = this.nx * this.nx;
    this.counts = new Int32Array(nc);
    this.starts = new Int32Array(nc + 1);
    this.order = new Int32Array(n);
    this.cursor = new Int32Array(nc);
  }

  idx(x: number, y: number): number {
    let cx = Math.floor(x / this.cell);
    let cy = Math.floor(y / this.cell);
    if (cx < 0) cx = 0;
    else if (cx >= this.nx) cx = this.nx - 1;
    if (cy < 0) cy = 0;
    else if (cy >= this.nx) cy = this.nx - 1;
    return cy * this.nx + cx;
  }

  build(x: Float64Array, y: Float64Array): void {
    const { counts, starts, cursor, nx, n } = this;
    counts.fill(0);
    for (let i = 0; i < n; i++) counts[this.idx(x[i]!, y[i]!)]!++;
    let acc = 0;
    for (let c = 0; c < counts.length; c++) {
      starts[c] = acc;
      acc += counts[c]!;
      cursor[c] = starts[c]!;
    }
    starts[counts.length] = acc;
    for (let i = 0; i < n; i++) {
      const c = this.idx(x[i]!, y[i]!);
      this.order[cursor[c]!++] = i;
    }
  }

  /** Visit every boid in the 3×3 cell block around (x, y). */
  neighbors(x: number, y: number, visit: (j: number) => void): void {
    const { nx, cell, starts, order } = this;
    let cx = Math.floor(x / cell);
    let cy = Math.floor(y / cell);
    if (cx < 0) cx = 0;
    else if (cx >= nx) cx = nx - 1;
    if (cy < 0) cy = 0;
    else if (cy >= nx) cy = nx - 1;
    for (let dcy = -1; dcy <= 1; dcy++) {
      const yy = (cy + dcy + nx) % nx;
      for (let dcx = -1; dcx <= 1; dcx++) {
        const xx = (cx + dcx + nx) % nx;
        const c = yy * nx + xx;
        for (let k = starts[c]!; k < starts[c + 1]!; k++) visit(order[k]!);
      }
    }
  }
}

function initFlock(rng: BenchRng, p: BoidsParams): Flock {
  const f: Flock = {
    x: new Float64Array(p.n),
    y: new Float64Array(p.n),
    vx: new Float64Array(p.n),
    vy: new Float64Array(p.n),
  };
  for (let i = 0; i < p.n; i++) {
    f.x[i] = rng.range(0, p.L);
    f.y[i] = rng.range(0, p.L);
    const a = rng.range(0, Math.PI * 2);
    f.vx[i] = Math.cos(a) * p.maxSpeed;
    f.vy[i] = Math.sin(a) * p.maxSpeed;
  }
  return f;
}

function stepFlock(
  f: Flock,
  p: BoidsParams,
  wAli: number,
  wCoh: number,
  wSep: number,
  relax: boolean,
  grid: Grid,
  tmp: Flock,
): void {
  const { n, L, r, sepR, maxSpeed } = p;
  const r2 = r * r;
  const sep2 = sepR * sepR;
  grid.build(f.x, f.y);

  for (let i = 0; i < n; i++) {
    const xi = f.x[i]!;
    const yi = f.y[i]!;
    let aliX = 0;
    let aliY = 0;
    let cohX = 0;
    let cohY = 0;
    let sepX = 0;
    let sepY = 0;
    let cnt = 0;
    grid.neighbors(xi, yi, (j) => {
      if (j === i) return;
      const dx = wrapDelta(f.x[j]! - xi, L);
      const dy = wrapDelta(f.y[j]! - yi, L);
      const d2 = dx * dx + dy * dy;
      if (d2 <= 0 || d2 > r2) return;
      cnt++;
      aliX += f.vx[j]!;
      aliY += f.vy[j]!;
      cohX += dx;
      cohY += dy;
      if (d2 < sep2) {
        const inv = 1 / Math.sqrt(d2);
        sepX -= dx * inv;
        sepY -= dy * inv;
      }
    });

    let desX = 0;
    let desY = 0;
    if (cnt > 0) {
      const an = Math.hypot(aliX, aliY);
      if (an > 1e-9) {
        desX += (wAli * aliX) / an;
        desY += (wAli * aliY) / an;
      }
      const cn = Math.hypot(cohX, cohY);
      if (cn > 1e-9) {
        desX += (wCoh * cohX) / cn;
        desY += (wCoh * cohY) / cn;
      }
      desX += wSep * sepX;
      desY += wSep * sepY;
    }
    let dn = Math.hypot(desX, desY);
    if (dn < 1e-9) {
      desX = f.vx[i]!;
      desY = f.vy[i]!;
      dn = Math.hypot(desX, desY) || 1;
    }
    let nvx = f.vx[i]! + TURN * ((desX / dn) * maxSpeed - f.vx[i]!);
    let nvy = f.vy[i]! + TURN * ((desY / dn) * maxSpeed - f.vy[i]!);
    const sp = Math.hypot(nvx, nvy);
    if (sp > maxSpeed) {
      nvx *= maxSpeed / sp;
      nvy *= maxSpeed / sp;
    }
    tmp.vx[i] = nvx;
    tmp.vy[i] = nvy;
    tmp.x[i] = (xi + nvx + L) % L;
    tmp.y[i] = (yi + nvy + L) % L;
  }

  f.vx.set(tmp.vx);
  f.vy.set(tmp.vy);
  f.x.set(tmp.x);
  f.y.set(tmp.y);

  if (!relax) return;

  for (let pass = 0; pass < MAX_PASSES; pass++) {
    grid.build(f.x, f.y);
    let moved = 0;
    for (let i = 0; i < n; i++) {
      grid.neighbors(f.x[i]!, f.y[i]!, (j) => {
        if (j <= i) return;
        const dx = wrapDelta(f.x[j]! - f.x[i]!, L);
        const dy = wrapDelta(f.y[j]! - f.y[i]!, L);
        const d2 = dx * dx + dy * dy;
        if (d2 >= sep2 || d2 <= 1e-12) return;
        const d = Math.sqrt(d2);
        const push = 0.5 * (sepR - d);
        const ux = (dx / d) * push;
        const uy = (dy / d) * push;
        f.x[i] = (f.x[i]! - ux + L) % L;
        f.y[i] = (f.y[i]! - uy + L) % L;
        f.x[j] = (f.x[j]! + ux + L) % L;
        f.y[j] = (f.y[j]! + uy + L) % L;
        moved++;
      });
    }
    if (moved === 0) break;
  }
}

function polarization(f: Flock, n: number): number {
  let sx = 0;
  let sy = 0;
  for (let i = 0; i < n; i++) {
    const sp = Math.hypot(f.vx[i]!, f.vy[i]!) || 1;
    sx += f.vx[i]! / sp;
    sy += f.vy[i]! / sp;
  }
  return Math.hypot(sx, sy) / Math.max(1, n);
}

function minPairDistance(f: Flock, p: BoidsParams): number {
  let best = Infinity;
  for (let i = 0; i < p.n; i++) {
    for (let j = i + 1; j < p.n; j++) {
      const dx = wrapDelta(f.x[j]! - f.x[i]!, p.L);
      const dy = wrapDelta(f.y[j]! - f.y[i]!, p.L);
      const d2 = dx * dx + dy * dy;
      if (d2 < best) best = d2;
    }
  }
  return Math.sqrt(best);
}

function runFlock(
  seed: string,
  p: BoidsParams,
  wAli: number,
  wCoh: number,
  wSep: number,
  relax: boolean,
): { f: Flock; phi: number; minDist: number } {
  const rng = new BenchRng(seedFromString(seed));
  const f = initFlock(rng, p);
  const grid = new Grid(p.n, p.L, p.r);
  const tmp: Flock = {
    x: new Float64Array(p.n),
    y: new Float64Array(p.n),
    vx: new Float64Array(p.n),
    vy: new Float64Array(p.n),
  };
  let phiSum = 0;
  let phiCount = 0;
  let minDist = Infinity;
  for (let t = 0; t < p.steps; t++) {
    stepFlock(f, p, wAli, wCoh, wSep, relax, grid, tmp);
    if (t >= p.warmup) {
      phiSum += polarization(f, p.n);
      phiCount++;
      if (t >= p.steps - 100) minDist = Math.min(minDist, minPairDistance(f, p));
    }
  }
  return { f, phi: phiCount > 0 ? phiSum / phiCount : 0, minDist };
}

export const boidsBenchmark: BenchmarkModel = {
  id: 'B',
  name: 'Boids',
  family: 'collective motion',
  stochastic: true,
  reference:
    'Reynolds (1987) boids + Vicsek et al. (1995): alignment drives a polar order parameter Φ = |Σv̂|/N from ~1/√N to ~1.',
  run(seed: string, scale: BenchmarkScale, params: BenchParams = {}): RunOutput {
    const cfg = { ...(scale === 'quick' ? QUICK : FULL), wAli: 2.5, wCoh: 0.7, wSep: 1.5, relax: 1, ...params };
    const p: BoidsParams = {
      n: cfg.n,
      steps: cfg.steps,
      L: cfg.L,
      r: cfg.r,
      sepR: cfg.sepR,
      maxSpeed: cfg.maxSpeed,
      warmup: cfg.warmup,
    };
    const off = runFlock(seed, p, 0, 0, 0, false);
    const on = runFlock(seed, p, cfg.wAli, cfg.wCoh, cfg.wSep, cfg.relax !== 0);
    return {
      signature: {
        phiOn: on.phi,
        phiOff: off.phi,
        minDistOn: Number.isFinite(on.minDist) ? on.minDist : 0,
      },
      fingerprint: sha256OfNumbers(on.f.x, on.f.y, on.f.vx, on.f.vy, off.f.x, off.f.y),
    };
  },
  checks: [
    {
      key: 'phiOn',
      test: 'gte',
      value: 0.8,
      note: 'alignment + cohesion order the flock: Φ ≥ 0.8.',
      gate: true,
      referenceKind: 'empirical',
      citation: 'Reynolds (1987); Vicsek et al. (1995)',
    },
    {
      key: 'phiOff',
      test: 'lte',
      value: 0.15,
      note: 'with alignment off, headings stay random: Φ ≈ 1/√N ≤ 0.15.',
      gate: true,
      referenceKind: 'theory',
      citation: 'random-walk polarisation ~ 1/√N',
    },
    {
      key: 'minDistOn',
      test: 'gte',
      value: 5.6,
      note: 'separation keeps agents apart: min pairwise distance ≥ 0.8·r_sep.',
      gate: true,
      referenceKind: 'theory',
      citation: 'Reynolds (1987) separation rule',
    },
  ],
  params: [
    { key: 'wAli', label: 'alignment weight', def: 2.5, min: 0, max: 5 },
    { key: 'wCoh', label: 'cohesion weight', def: 0.7, min: 0, max: 3 },
    { key: 'wSep', label: 'separation weight', def: 1.5, min: 0, max: 4 },
    { key: 'sepR', label: 'separation radius', def: 7, min: 3, max: 15 },
    { key: 'r', label: 'neighbour radius', def: 25, min: 12, max: 45, log: true },
  ],
  interventions: [
    {
      id: 'abl-align',
      label: 'alignment off (wAli = 0)',
      kind: 'ablation',
      apply: (p) => ({ ...p, wAli: 0 }),
      effects: [{ key: 'phiOn', direction: 'decrease', note: 'without alignment the flock cannot polarise.' }],
    },
    {
      id: 'abl-cohesion',
      label: 'cohesion off (wCoh = 0)',
      kind: 'ablation',
      apply: (p) => ({ ...p, wCoh: 0 }),
      effects: [{ key: 'phiOn', direction: 'change', note: 'cohesion alone does not order headings.' }],
    },
    {
      id: 'abl-separation',
      label: 'separation off (wSep = 0)',
      kind: 'ablation',
      apply: (p) => ({ ...p, wSep: 0 }),
      effects: [{ key: 'minDistOn', direction: 'decrease', note: 'agents are no longer pushed apart.' }],
    },
    {
      id: 'abl-relax',
      label: 'positional relaxation off',
      kind: 'ablation',
      apply: (p) => ({ ...p, relax: 0 }),
      effects: [{ key: 'minDistOn', direction: 'decrease', note: 'velocity steering alone cannot prevent overlap.' }],
    },
  ],
  empirical: {
    systemId: 'reynolds-boids',
    claim: 'Three local steering rules (alignment/cohesion/separation) produce a polarised, non-overlapping flock.',
  },
};
