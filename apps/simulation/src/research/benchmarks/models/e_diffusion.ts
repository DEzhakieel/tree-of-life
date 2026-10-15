/**
 * Benchmark E — Diffusion (heat equation).
 *
 * A 2D Gaussian packet evolving under u_t = D∇²u on a periodic grid, integrated
 * with the explicit FTCS stencil. Three exact facts are checked:
 *
 *   • the discrete solution converges to the analytic Gaussian
 *     u(r,t) = exp(−r²/2σ(t)²)/(2πσ(t)²), σ(t)² = σ0² + 2Dt,
 *   • total mass Σu is conserved to machine precision,
 *   • the second moment grows as ⟨r²⟩(t) = ⟨r²⟩(0) + 4Dt (2D diffusion law).
 *
 * Deterministic, so it runs on a single seed.
 */

import { sha256OfNumbers } from '../signatures.js';
import type { BenchmarkModel, BenchmarkScale, BenchParams, RunOutput } from '../types.js';

interface Cfg {
  nx: number;
  D: number;
  r: number; // stability number D·dt/dx²
  sigma0: number;
  tEnd: number;
}

const FULL: Cfg = { nx: 128, D: 0.01, r: 0.2, sigma0: 0.06, tEnd: 0.2 };
const QUICK: Cfg = { nx: 96, D: 0.01, r: 0.2, sigma0: 0.06, tEnd: 0.15 };

function minimalImage(d: number, L: number): number {
  let v = d % L;
  if (v > L / 2) v -= L;
  else if (v < -L / 2) v += L;
  return v;
}

function gaussian(nx: number, L: number, sigma: number): Float64Array {
  const u = new Float64Array(nx * nx);
  const cx = L / 2;
  const cy = L / 2;
  const inv = 1 / (2 * sigma * sigma);
  let s = 0;
  for (let j = 0; j < nx; j++) {
    for (let i = 0; i < nx; i++) {
      const dx = minimalImage((i + 0.5) * (L / nx) - cx, L);
      const dy = minimalImage((j + 0.5) * (L / nx) - cy, L);
      const val = Math.exp(-(dx * dx + dy * dy) * inv);
      u[j * nx + i] = val;
      s += val;
    }
  }
  for (let k = 0; k < u.length; k++) u[k]! /= s;
  return u;
}

function secondMoment(u: Float64Array, nx: number, L: number): number {
  const cx = L / 2;
  const cy = L / 2;
  let num = 0;
  let den = 0;
  for (let j = 0; j < nx; j++) {
    for (let i = 0; i < nx; i++) {
      const dx = minimalImage((i + 0.5) * (L / nx) - cx, L);
      const dy = minimalImage((j + 0.5) * (L / nx) - cy, L);
      const v = u[j * nx + i]!;
      num += (dx * dx + dy * dy) * v;
      den += v;
    }
  }
  return num / den;
}

export const diffusionBenchmark: BenchmarkModel = {
  id: 'E',
  name: 'Diffusion',
  family: 'continuum transport',
  stochastic: false,
  reference:
    'Fick (1855) / Einstein (1905): Gaussian spread σ(t)² = σ0² + 4Dt, conserved mass, ⟨r²⟩ = ⟨r²⟩₀ + 4Dt in 2D.',
  run(_seed: string, scale: BenchmarkScale, params: BenchParams = {}): RunOutput {
    const cfg = { ...(scale === 'quick' ? QUICK : FULL), ...params };
    const { D, r, sigma0, tEnd } = cfg;
    const nx = Math.round(cfg.nx);
    const L = 1;
    const dxg = L / nx;
    const dt = (r * dxg * dxg) / D;
    const steps = Math.round(tEnd / dt);
    const tFinal = steps * dt;

    let u: Float64Array = gaussian(nx, L, sigma0);
    const u0 = u.slice();
    const mass0 = u0.reduce((a, b) => a + b, 0);
    const m2_0 = secondMoment(u0, nx, L);

    let un: Float64Array = new Float64Array(u.length);
    for (let s = 0; s < steps; s++) {
      for (let j = 0; j < nx; j++) {
        const jm = (j - 1 + nx) % nx;
        const jp = (j + 1) % nx;
        for (let i = 0; i < nx; i++) {
          const im = (i - 1 + nx) % nx;
          const ip = (i + 1) % nx;
          const lap =
            u[j * nx + im]! + u[j * nx + ip]! + u[jm * nx + i]! + u[jp * nx + i]! - 4 * u[j * nx + i]!;
          un[j * nx + i] = u[j * nx + i]! + r * lap;
        }
      }
      const tmp = u;
      u = un;
      un = tmp;
    }

    const sigmaF = Math.sqrt(sigma0 * sigma0 + 2 * D * tFinal);
    const ana = gaussian(nx, L, sigmaF);
    let numErr = 0;
    let denL2 = 0;
    for (let k = 0; k < u.length; k++) {
      const e = u[k]! - ana[k]!;
      numErr += e * e;
      denL2 += ana[k]! * ana[k]!;
    }
    const relL2 = Math.sqrt(numErr / denL2);

    const massF = u.reduce((a, b) => a + b, 0);
    const massRelErr = Math.abs(massF - mass0) / mass0;

    const m2_f = secondMoment(u, nx, L);
    const msdRelErr = Math.abs((m2_f - m2_0) / tFinal / (4 * D) - 1);

    return {
      signature: { relL2, massRelErr, msdRelErr },
      fingerprint: sha256OfNumbers(u.slice(0, 4096)),
    };
  },
  checks: [
    {
      key: 'relL2',
      test: 'lte',
      value: 1e-3,
      note: 'FTCS solution matches the analytic Gaussian to L2 relative error < 1e-3.',
      gate: true,
      referenceKind: 'analytic',
      citation: 'Fick (1855); Einstein (1905)',
    },
    {
      key: 'massRelErr',
      test: 'lte',
      value: 1e-6,
      note: 'total mass is conserved to machine precision.',
      gate: true,
      referenceKind: 'exact',
      citation: 'conservation law of the diffusion equation',
    },
    {
      key: 'msdRelErr',
      test: 'lte',
      value: 0.01,
      note: 'second moment grows as 4Dt to within 1%.',
      gate: true,
      referenceKind: 'analytic',
      citation: 'Einstein (1905) ⟨r²⟩ = 4Dt in 2D',
    },
  ],
  params: [
    { key: 'D', label: 'diffusivity D', def: 0.01, min: 0.002, max: 0.05, log: true },
    { key: 'nx', label: 'grid resolution', def: 128, min: 48, max: 256, log: true, note: 'grid points per side (rounded)' },
  ],
  analytic: { relL2: 0, massRelErr: 0, msdRelErr: 0 },
  empirical: {
    systemId: 'diffusion-fick',
    claim: 'Explicit FTCS reproduces the analytic Gaussian spread, conserved mass, and ⟨r²⟩ = 4Dt.',
  },
};
