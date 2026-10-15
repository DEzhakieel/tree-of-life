/**
 * Benchmark H — Resource competition and R*.
 *
 * Two species competing for one limiting resource in a chemostat (Tilman 1982):
 *
 *     dN_i/dt = N_i (μ_i(R) − m),   μ_i(R) = μmax_i R/(K_i + R)
 *     dR/dt   = D(S0 − R) − Σ_i μ_i(R) N_i
 *
 * Each species has a break-even resource R*ᵢ = m Kᵢ/(μmaxᵢ − m). R* theory
 * predicts the species with the lowest R* competitively excludes the other; when
 * the two R* are equal (symmetric species) they coexist neutrally.
 */

import { BenchRng, seedFromString } from '../rng.js';
import { sha256OfNumbers } from '../signatures.js';
import type { BenchmarkModel, BenchmarkScale, BenchParams, RunOutput } from '../types.js';

const M = 0.25;
const D_DIL = 0.25;
const S0 = 1.0;

interface Species {
  muMax: number;
  K: number;
}

function rstar(s: Species): number {
  return (M * s.K) / (s.muMax - M);
}

interface Cfg {
  dt: number;
  tEnd: number;
}

const FULL: Cfg = { dt: 0.01, tEnd: 300 };
const QUICK: Cfg = { dt: 0.02, tEnd: 200 };

function mu(s: Species, R: number): number {
  return (s.muMax * R) / (s.K + R);
}

/** integrate a two-species chemostat, return final fractions of total biomass */
function simulate(
  a: Species,
  b: Species,
  na0: number,
  nb0: number,
  cfg: Cfg,
): { fa: number; fb: number } {
  let na = na0;
  let nb = nb0;
  let R = S0;

  const deriv = (na_: number, nb_: number, R_: number): [number, number, number] => {
    const ua = mu(a, R_);
    const ub = mu(b, R_);
    const dna = na_ * (ua - M);
    const dnb = nb_ * (ub - M);
    const dR = D_DIL * (S0 - R_) - ua * na_ - ub * nb_;
    return [dna, dnb, dR];
  };

  const steps = Math.round(cfg.tEnd / cfg.dt);
  for (let s = 0; s < steps; s++) {
    const [k1a, k1b, k1r] = deriv(na, nb, R);
    const [k2a, k2b, k2r] = deriv(na + (cfg.dt / 2) * k1a, nb + (cfg.dt / 2) * k1b, R + (cfg.dt / 2) * k1r);
    const [k3a, k3b, k3r] = deriv(na + (cfg.dt / 2) * k2a, nb + (cfg.dt / 2) * k2b, R + (cfg.dt / 2) * k2r);
    const [k4a, k4b, k4r] = deriv(na + cfg.dt * k3a, nb + cfg.dt * k3b, R + cfg.dt * k3r);
    na += (cfg.dt / 6) * (k1a + 2 * k2a + 2 * k3a + k4a);
    nb += (cfg.dt / 6) * (k1b + 2 * k2b + 2 * k3b + k4b);
    R += (cfg.dt / 6) * (k1r + 2 * k2r + 2 * k3r + k4r);
    if (na < 1e-9) na = 0;
    if (nb < 1e-9) nb = 0;
  }

  const total = na + nb;
  if (total <= 1e-12) return { fa: 0.5, fb: 0.5 };
  return { fa: na / total, fb: nb / total };
}

export const resourceCompetitionBenchmark: BenchmarkModel = {
  id: 'H',
  name: 'Resource competition (R*)',
  family: 'community ecology',
  stochastic: true,
  reference:
    'Tilman (1982) R* rule: the species with the lowest break-even resource competitively excludes its rival; equal R* allows neutral coexistence.',
  run(seed: string, scale: BenchmarkScale, params: BenchParams = {}): RunOutput {
    const cfg = { ...(scale === 'quick' ? QUICK : FULL), Ka: 0.5, Kb: 1.0, muMax: 1.0, ...params };
    const rng = new BenchRng(seedFromString(seed + ':rstar'));

    // exclusion: distinct R* (A = low K, B = high K) => A must win
    const a1: Species = { muMax: cfg.muMax, K: cfg.Ka };
    const b1: Species = { muMax: cfg.muMax, K: cfg.Kb };
    const exclusive = simulate(
      a1,
      b1,
      0.1 * (1 + 0.3 * rng.signed()) + 0.05,
      0.1 * (1 + 0.3 * rng.signed()) + 0.05,
      cfg,
    );
    const winnerIsLowerRstar = rstar(a1) < rstar(b1) ? exclusive.fa > exclusive.fb : exclusive.fb > exclusive.fa;
    const loserFrac = Math.min(exclusive.fa, exclusive.fb);

    // coexistence: symmetric species (equal R*)
    const a2: Species = { muMax: cfg.muMax, K: 0.5 };
    const b2: Species = { muMax: cfg.muMax, K: 0.5 };
    const coexist = simulate(
      a2,
      b2,
      0.5 * (1 + 0.15 * rng.signed()),
      0.5 * (1 + 0.15 * rng.signed()),
      cfg,
    );

    return {
      signature: {
        winnerCorrect: winnerIsLowerRstar ? 1 : 0,
        loserFrac,
        coexistFA: coexist.fa,
        coexistFB: coexist.fb,
      },
      fingerprint: sha256OfNumbers(
        Float64Array.from([exclusive.fa, exclusive.fb, coexist.fa, coexist.fb]),
      ),
    };
  },
  checks: [
    {
      key: 'winnerCorrect',
      test: 'eqAbs',
      value: 1,
      tol: 0,
      note: 'the species with the lowest R* wins competitive exclusion.',
      gate: true,
      referenceKind: 'analytic',
      citation: 'Tilman (1982) R* theory',
    },
    {
      key: 'loserFrac',
      test: 'lte',
      value: 0.05,
      note: 'the higher-R* species is driven effectively extinct (<5% of biomass).',
      gate: true,
      referenceKind: 'analytic',
      citation: 'Tilman (1982)',
    },
    {
      key: 'coexistFA',
      test: 'range',
      lo: 0.1,
      hi: 0.9,
      note: 'equal-R* species coexist; species A holds 10–90% of biomass.',
      gate: true,
      referenceKind: 'theory',
      citation: 'Tilman (1982) (neutral coexistence)',
    },
    {
      key: 'coexistFB',
      test: 'range',
      lo: 0.1,
      hi: 0.9,
      note: 'equal-R* species coexist; species B holds 10–90% of biomass.',
      gate: true,
      referenceKind: 'theory',
      citation: 'Tilman (1982)',
    },
  ],
  params: [
    { key: 'Ka', label: 'half-saturation K_A', def: 0.5, min: 0.2, max: 1.5, log: true },
    { key: 'Kb', label: 'half-saturation K_B', def: 1.0, min: 0.2, max: 1.5, log: true },
    { key: 'muMax', label: 'max growth μ_max', def: 1.0, min: 0.6, max: 2.0, log: true },
  ],
  interventions: [
    {
      id: 'abl-symmetric',
      label: 'set K_A = K_B (neutral coexistence)',
      kind: 'ablation',
      apply: (p) => ({ ...p, Kb: p.Ka ?? 0.5 }),
      effects: [
        { key: 'coexistFA', direction: 'increase', note: 'symmetric R* should allow coexistence.' },
        { key: 'coexistFB', direction: 'increase', note: 'symmetric R* should allow coexistence.' },
      ],
    },
    {
      id: 'abl-no-limitation',
      label: 'remove resource limitation (theoretical boundary)',
      kind: 'ablation',
      apply: (p) => ({ ...p, Ka: 1e-6, Kb: 1e-6 }),
      effects: [{ key: 'loserFrac', direction: 'increase', note: 'without limitation R* rule loses its ecological constraint.' }],
    },
  ],
  analytic: { winnerCorrect: 1, loserFrac: 0 },
  empirical: {
    systemId: 'tilman-chemostat',
    claim: 'In a chemostat the species with the lowest break-even resource R* competitively excludes the rival; equal R* yields coexistence.',
  },
};
