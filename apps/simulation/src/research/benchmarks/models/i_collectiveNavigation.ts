/**
 * Benchmark I — Collective navigation.
 *
 * A swarm of agents must cross an arena to a destination. Each agent steers by
 * locally aligning with its neighbours (Vicsek) plus a weak pull toward the
 * destination; no agent sees a global map. Two signatures:
 *
 *   • consensus: the polarisation order parameter Φ = |Σv̂|/N during transit,
 *   • arrival: the fraction of agents that reach the destination.
 *
 * A coherent, self-organised flock satisfies both — the classic result that
 * local alignment produces global collective navigation.
 */

import { BenchRng, seedFromString } from '../rng.js';
import { sha256OfNumbers } from '../signatures.js';
import type { BenchmarkModel, BenchmarkScale, BenchParams, RunOutput } from '../types.js';

interface Cfg {
  n: number;
  steps: number;
  L: number;
  r: number;
  speed: number;
  noise: number;
  wAlign: number;
  wTarget: number;
  arriveR: number;
}

const FULL: Cfg = { n: 120, steps: 180, L: 100, r: 15, speed: 1.2, noise: 0.12, wAlign: 2.5, wTarget: 1.0, arriveR: 9 };
const QUICK: Cfg = { n: 80, steps: 140, L: 100, r: 15, speed: 1.2, noise: 0.12, wAlign: 2.5, wTarget: 1.0, arriveR: 9 };

const TARGET_X = 72;
const TARGET_Y = 50;

function wrap(d: number, L: number): number {
  let v = d % L;
  if (v > L / 2) v -= L;
  else if (v < -L / 2) v += L;
  return v;
}

export const collectiveNavigationBenchmark: BenchmarkModel = {
  id: 'I',
  name: 'Collective navigation',
  family: 'swarm intelligence',
  stochastic: true,
  reference:
    'Vicsek et al. (1995) + Couzin et al. (2005): local alignment yields a polarised flock that navigates coherently to a destination.',
  run(seed: string, scale: BenchmarkScale, params: BenchParams = {}): RunOutput {
    const cfg = { ...(scale === 'quick' ? QUICK : FULL), wAlign: 2.5, wTarget: 1.0, noise: 0.12, ...params };
    const { n, steps, L, r, speed, noise, wAlign, wTarget, arriveR } = cfg;
    const rng = new BenchRng(seedFromString(seed + ':nav'));

    const x = new Float64Array(n);
    const y = new Float64Array(n);
    const vx = new Float64Array(n);
    const vy = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      x[i] = rng.range(0, 15);
      y[i] = rng.range(0, L);
      const a = rng.range(0, Math.PI * 2);
      vx[i] = Math.cos(a);
      vy[i] = Math.sin(a);
    }

    const r2 = r * r;
    let phiSum = 0;
    let phiCnt = 0;
    for (let t = 0; t < steps; t++) {
      // steering
      for (let i = 0; i < n; i++) {
        let ax = 0;
        let ay = 0;
        let cnt = 0;
        for (let j = 0; j < n; j++) {
          if (j === i) continue;
          const dx = wrap(x[j]! - x[i]!, L);
          const dy = wrap(y[j]! - y[i]!, L);
          if (dx * dx + dy * dy > r2) continue;
          cnt++;
          ax += vx[j]!;
          ay += vy[j]!;
        }
        let sx = 0;
        let sy = 0;
        if (cnt > 0) {
          const an = Math.hypot(ax, ay);
          if (an > 1e-9) {
            sx += (wAlign * ax) / an;
            sy += (wAlign * ay) / an;
          }
        }
        const tx = wrap(TARGET_X - x[i]!, L);
        const ty = wrap(TARGET_Y - y[i]!, L);
        const tn = Math.hypot(tx, ty);
        if (tn > 1e-9) {
          sx += (wTarget * tx) / tn;
          sy += (wTarget * ty) / tn;
        }
        const sn = Math.hypot(sx, sy) || 1;
        // add heading noise
        const na = (rng.signed()) * noise;
        const ca = Math.cos(na);
        const sa = Math.sin(na);
        const ndx = (sx / sn) * ca - (sy / sn) * sa;
        const ndy = (sx / sn) * sa + (sy / sn) * ca;
        vx[i] = ndx;
        vy[i] = ndy;
      }
      // integrate
      for (let i = 0; i < n; i++) {
        x[i] = (x[i]! + vx[i]! * speed + L) % L;
        y[i] = (y[i]! + vy[i]! * speed + L) % L;
      }
      if (t < steps * 0.6) {
        let sxi = 0;
        let syi = 0;
        for (let i = 0; i < n; i++) {
          sxi += vx[i]!;
          syi += vy[i]!;
        }
        phiSum += Math.hypot(sxi, syi) / n;
        phiCnt++;
      }
    }

    // arrival: fraction resting at the destination
    let arrived = 0;
    for (let i = 0; i < n; i++) {
      const dx = wrap(TARGET_X - x[i]!, L);
      const dy = wrap(TARGET_Y - y[i]!, L);
      if (dx * dx + dy * dy <= arriveR * arriveR) arrived++;
    }

    return {
      signature: {
        consensus: phiCnt > 0 ? phiSum / phiCnt : 0,
        arrival: arrived / n,
      },
      fingerprint: sha256OfNumbers(x, y),
    };
  },
  checks: [
    {
      key: 'consensus',
      test: 'gte',
      value: 0.8,
      note: 'the swarm becomes polarised during transit: Φ ≥ 0.8.',
      gate: true,
      referenceKind: 'empirical',
      citation: 'Vicsek et al. (1995)',
    },
    {
      key: 'arrival',
      test: 'gte',
      value: 0.9,
      note: 'at least 90% of agents reach the destination.',
      gate: true,
      referenceKind: 'empirical',
      citation: 'Couzin et al. (2005)',
    },
  ],
  params: [
    { key: 'wAlign', label: 'alignment weight', def: 2.5, min: 0, max: 5 },
    { key: 'wTarget', label: 'target bias', def: 1.0, min: 0, max: 3 },
    { key: 'noise', label: 'heading noise', def: 0.12, min: 0.01, max: 0.4, log: true },
  ],
  interventions: [
    {
      id: 'abl-target',
      label: 'remove target bias (wTarget = 0)',
      kind: 'ablation',
      apply: (p) => ({ ...p, wTarget: 0 }),
      effects: [{ key: 'arrival', direction: 'decrease', note: 'without target bias agents cannot reliably navigate.' }],
    },
    {
      id: 'abl-align',
      label: 'remove alignment (wAlign = 0)',
      kind: 'ablation',
      apply: (p) => ({ ...p, wAlign: 0 }),
      effects: [{ key: 'consensus', direction: 'decrease', note: 'without alignment the swarm cannot polarise.' }],
    },
  ],
  empirical: {
    systemId: 'vicsek-coordination',
    claim: 'Local alignment generates a polarised flock that can collectively navigate toward a goal.',
  },
};
