/**
 * Benchmark F — Reaction–diffusion (Gray–Scott).
 *
 *     ∂u/∂t = Du∇²u − uv² + F(1 − u)
 *     ∂v/∂t = Dv∇²v + uv² − (F + k)v
 *
 * With (Du=0.16, Dv=0.08) and the classical spot/lamellar regime
 * (F=0.0545, k=0.062) the inhibitor field v spontaneously develops a
 * Turing-like pattern (Pearson 1993). Outside the pattern regime
 * (F=0.02, k=0.05, F < k) the uniform state (u→1, v→0) is stable and v dies.
 * Occupied fraction, spatial variance and blob count are measured from the
 * pattern; only the inhibitor maximum constraints the out-regime run.
 */

import { BenchRng, seedFromString } from '../rng.js';
import { sha256OfNumbers } from '../signatures.js';
import type { BenchmarkModel, BenchmarkScale, BenchParams, RunOutput } from '../types.js';

const DU = 0.16;
const DV = 0.08;
const OCC = 0.3; // cells with v > OCC count as "occupied"
const MIN_BLOB = 4; // ignore specks below this size

const FULL: Cfg = { n: 96, tEnd: 2600, seedSize: 24 };
const QUICK: Cfg = { n: 64, tEnd: 2000, seedSize: 18 };

interface Cfg {
  n: number;
  tEnd: number;
  seedSize: number;
}

function runGrayScott(
  F: number,
  k: number,
  cfg: Cfg,
  seedStr: string,
  seedMode: 'multi' | 'noise',
): { occFrac: number; vVar: number; blobs: number; vMax: number } {
  const n = cfg.n;
  const rng = new BenchRng(seedFromString(seedStr + ':' + F));
  let u = new Float64Array(n * n);
  let v = new Float64Array(n * n);
  let un = new Float64Array(n * n);
  let vn = new Float64Array(n * n);
  u.fill(1);

  if (seedMode === 'multi') {
    // a ring of small, widely separated nuclei so spots stay distinct
    const blocks = 3;
    const bs = Math.max(2, Math.floor(cfg.seedSize / 3));
    for (let bj = 0; bj < blocks; bj++) {
      for (let bi = 0; bi < blocks; bi++) {
        const cx = Math.floor(((bi + 0.5) * n) / blocks);
        const cy = Math.floor(((bj + 0.5) * n) / blocks);
        for (let j = cy - bs; j < cy + bs; j++) {
          for (let i = cx - bs; i < cx + bs; i++) {
            const idx = ((j + n) % n) * n + ((i + n) % n);
            u[idx] = 0.5;
            v[idx] = 0.25;
          }
        }
      }
    }
  } else {
    // near-uniform state: tiny perturbations must decay outside the pattern regime
    for (let idx = 0; idx < v.length; idx++) v[idx] = 1e-3 * rng.unit();
  }

  for (let t = 0; t < cfg.tEnd; t++) {
    for (let j = 0; j < n; j++) {
      const jm = (j - 1 + n) % n;
      const jp = (j + 1) % n;
      for (let i = 0; i < n; i++) {
        const im = (i - 1 + n) % n;
        const ip = (i + 1) % n;
        const idx = j * n + i;
        const idxIn = j * n + im;
        const idxIp = j * n + ip;
        const idxJm = jm * n + i;
        const idxJp = jp * n + i;
        const ui = u[idx]!;
        const vi = v[idx]!;
        const uvv = ui * vi * vi;
        const lapU = u[idxIn]! + u[idxIp]! + u[idxJm]! + u[idxJp]! - 4 * ui;
        const lapV = v[idxIn]! + v[idxIp]! + v[idxJm]! + v[idxJp]! - 4 * vi;
        un[idx] = ui + DU * lapU - uvv + F * (1 - ui);
        vn[idx] = vi + DV * lapV + uvv - (F + k) * vi;
      }
    }
    const tu = u;
    const tv = v;
    u = un;
    v = vn;
    un = tu;
    vn = tv;
  }

  let occCount = 0;
  let sumV = 0;
  let vMax = 0;
  for (let idx = 0; idx < v.length; idx++) {
    if (v[idx]! > OCC) occCount++;
    sumV += v[idx]!;
    if (v[idx]! > vMax) vMax = v[idx]!;
  }
  const occFrac = occCount / v.length;
  const meanV = sumV / v.length;
  let varSum = 0;
  for (let idx = 0; idx < v.length; idx++) {
    const d = v[idx]! - meanV;
    varSum += d * d;
  }
  const vVar = varSum / v.length;

  // connected components (4-connectivity, periodic) of the occupied region
  const visited = new Uint8Array(n * n);
  let blobs = 0;
  const stack: number[] = [];
  const neigh = [1, -1, n, -n];
  for (let start = 0; start < v.length; start++) {
    if (v[start]! <= OCC || visited[start]) continue;
    visited[start] = 1;
    stack.length = 0;
    stack.push(start);
    let size = 0;
    while (stack.length > 0) {
      const c = stack.pop()!;
      size++;
      const ci = c % n;
      const cj = (c - ci) / n;
      for (const d of neigh) {
        let ni = ci;
        let nj = cj;
        if (d === 1) ni = (ci + 1) % n;
        else if (d === -1) ni = (ci - 1 + n) % n;
        else if (d === n) nj = (cj + 1) % n;
        else nj = (cj - 1 + n) % n;
        const nb = nj * n + ni;
        if (v[nb]! > OCC && !visited[nb]) {
          visited[nb] = 1;
          stack.push(nb);
        }
      }
    }
    if (size >= MIN_BLOB) blobs++;
  }

  return { occFrac, vVar, blobs, vMax };
}

export const reactionDiffusionBenchmark: BenchmarkModel = {
  id: 'F',
  name: 'Reaction–diffusion (Gray–Scott)',
  family: 'pattern formation',
  stochastic: true,
  reference:
    'Gray & Scott (1983) / Pearson (1993): (0.16, 0.08) with F=0.0545, k=0.062 forms spots/labyrinths; F=0.02, k=0.05 (F<k) relaxes to uniform u=1, v=0.',
  run(seed: string, scale: BenchmarkScale, params: BenchParams = {}): RunOutput {
    const cfg = { ...(scale === 'quick' ? QUICK : FULL), F: 0.0545, k: 0.062, ...params };
    const inState = runGrayScott(cfg.F, cfg.k, cfg, seed, 'multi');
    const outState = runGrayScott(0.02, 0.05, cfg, seed, 'noise');
    return {
      signature: {
        inOccFrac: inState.occFrac,
        inVVar: inState.vVar,
        inBlobs: inState.blobs,
        outVMax: outState.vMax,
      },
      fingerprint: sha256OfNumbers(
        Float64Array.from([inState.occFrac, inState.vVar, inState.blobs, inState.vMax, outState.vMax]),
      ),
    };
  },
  checks: [
    {
      key: 'inOccFrac',
      test: 'range',
      lo: 0.15,
      hi: 0.6,
      note: 'pattern regime: 15–60% of cells are occupied by inhibitor spots.',
      gate: true,
      referenceKind: 'empirical',
      citation: 'Pearson (1993)',
    },
    {
      key: 'inVVar',
      test: 'gte',
      value: 0.01,
      note: 'spatial variance of v exceeds random noise: a real pattern formed.',
      gate: true,
      referenceKind: 'empirical',
      citation: 'Pearson (1993)',
    },
    {
      key: 'inBlobs',
      test: 'gte',
      value: 3,
      note: 'the pattern self-organises into ≥3 coherent spots (≥4 cells each).',
      gate: true,
      referenceKind: 'empirical',
      citation: 'Pearson (1993)',
    },
    {
      key: 'outVMax',
      test: 'lte',
      value: 0.05,
      note: 'outside the pattern regime v relaxes to u=1, v=0 (max < 0.05).',
      gate: true,
      referenceKind: 'theory',
      citation: 'Gray & Scott (1983) uniform-state linear stability',
    },
  ],
  params: [
    { key: 'F', label: 'feed rate F', def: 0.0545, min: 0.01, max: 0.09, log: true },
    { key: 'k', label: 'kill rate k', def: 0.062, min: 0.03, max: 0.07, log: true },
  ],
  interventions: [
    {
      id: 'abl-out-of-regime',
      label: 'push out of the Turing regime (F=0.02, k=0.05)',
      kind: 'ablation',
      apply: (p) => ({ ...p, F: 0.02, k: 0.05 }),
      effects: [{ key: 'inOccFrac', direction: 'decrease', note: 'outside the pattern regime the uniform state is stable.' }],
    },
  ],
  empirical: {
    systemId: 'turing-reaction-diffusion',
    claim: 'Gray–Scott (0.16, 0.08) at F=0.0545, k=0.062 self-organises spots/labyrinths; F<k relaxes to uniform.',
  },
};