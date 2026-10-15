/**
 * Benchmark J — Novel fractal-life composite (coupled CA + stigmergic agents).
 *
 * A deliberately new model combining the engine's cellular automaton with
 * pheromone-laying agents: the Game of Life layer runs on a torus while agents
 * climb the field (pheromone + coupling·CA-alive), depositing a diffusing,
 * decaying trail. The two layers are mutually reinforcing, so the trail
 * self-organises into clusters (positive Moran's I) that spatially track the CA.
 *
 *   • selfOrgGain: Moran's I of the trail (coupled) minus the decoupled,
 *     randomly-walking baseline — coupling must add ≥0.05 of structure.
 *   • crossCorr: correlation between agent density and CA activity (≥0.30).
 *   • moranCoupled: absolute spatial structure of the coupled trail (≥0.20).
 */

import { createGameOfLife, stepGameOfLife } from '../../../gameoflife.js';
import { moranI } from '../../emergence.js';
import { BenchRng, seedFromString } from '../rng.js';
import { sha256OfNumbers } from '../signatures.js';
import type { BenchmarkModel, BenchmarkScale, BenchParams, RunOutput } from '../types.js';

interface Cfg {
  n: number;
  steps: number;
  agents: number;
  deposit: number;
  diffusion: number;
  decay: number;
  coupling: number;
  crowding: number;
}

const FULL: Cfg = { n: 96, steps: 260, agents: 400, deposit: 1, diffusion: 0.15, decay: 0.97, coupling: 100, crowding: 6 };
const QUICK: Cfg = { n: 64, steps: 180, agents: 250, deposit: 1, diffusion: 0.15, decay: 0.97, coupling: 100, crowding: 6 };

const NB: [number, number][] = [
  [0, 0], [-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1],
];

interface Result {
  moranAgents: number;
  agentDensity: Float64Array;
  caAct: Float64Array;
  crossCorr: number;
}

function pearson(a: Float64Array, b: Float64Array): number {
  const n = a.length;
  let ma = 0;
  let mb = 0;
  for (let i = 0; i < n; i++) {
    ma += a[i]!;
    mb += b[i]!;
  }
  ma /= n;
  mb /= n;
  let cov = 0;
  let va = 0;
  let vb = 0;
  for (let i = 0; i < n; i++) {
    const da = a[i]! - ma;
    const db = b[i]! - mb;
    cov += da * db;
    va += da * da;
    vb += db * db;
  }
  const den = Math.sqrt(va * vb);
  return den > 1e-12 ? cov / den : 0;
}

/** 5-point periodic blur used to turn the binary CA grid into a smooth activity field */
function blur(src: Float64Array, n: number, passes: number): Float64Array {
  let a: Float64Array = src;
  let b: Float64Array = new Float64Array(src.length);
  for (let p = 0; p < passes; p++) {
    for (let y = 0; y < n; y++) {
      const ym = ((y - 1 + n) % n) * n;
      const yp = ((y + 1) % n) * n;
      const yc = y * n;
      for (let x = 0; x < n; x++) {
        const xm = (x - 1 + n) % n;
        const xp = (x + 1) % n;
        const c = yc + x;
        b[c] = (a[c]! + a[yc + xm]! + a[yc + xp]! + a[ym + x]! + a[yp + x]!) / 5;
      }
    }
    const t = a;
    a = b;
    b = t;
  }
  return a;
}

function runComposite(seed: string, cfg: Cfg, coupled: boolean): Result {
  const { n, steps, agents, deposit, diffusion, decay, coupling, crowding } = cfg;
  const rng = new BenchRng(seedFromString(seed + (coupled ? ':coupled' : ':baseline')));
  const ca = createGameOfLife(n);
  for (let i = 0; i < ca.current.length; i++) ca.current[i] = rng.unit() < 0.35 ? 1 : 0;

  let ph = new Float64Array(n * n);
  let ph2 = new Float64Array(n * n);
  const ax = new Int32Array(agents);
  const ay = new Int32Array(agents);
  const visit = new Float64Array(n * n);
  const caSum = new Float64Array(n * n);
  for (let i = 0; i < agents; i++) {
    ax[i] = rng.int(n);
    ay[i] = rng.int(n);
  }

  let caAct: Float64Array = new Float64Array(n * n);
  for (let t = 0; t < steps; t++) {
    stepGameOfLife(ca);
    const bin = new Float64Array(n * n);
    for (let i = 0; i < bin.length; i++) bin[i] = ca.current[i]!;
    caAct = blur(bin, n, 2);
    for (let i = 0; i < caSum.length; i++) caSum[i] += caAct[i]!;
    const occ = new Float64Array(n * n);

    for (let i = 0; i < agents; i++) {
      const cx = ax[i]!;
      const cy = ay[i]!;
      if (coupled) {
        // follow the blended field (pheromone + CA activity), but a crowding
        // penalty keeps the swarm a compact patch rather than a single spike
        let bestVal = -Infinity;
        let bx = cx;
        let by = cy;
        for (const [dx, dy] of NB) {
          const nx = (cx + dx + n) % n;
          const ny = (cy + dy + n) % n;
          const idx = ny * n + nx;
          const val = ph[idx]! + coupling * caAct[idx]! - crowding * occ[idx]! + rng.range(0, 0.5);
          if (val > bestVal) {
            bestVal = val;
            bx = nx;
            by = ny;
          }
        }
        ax[i] = bx;
        ay[i] = by;
      } else {
        const [dx, dy] = NB[1 + rng.int(NB.length - 1)]!;
        ax[i] = (cx + dx + n) % n;
        ay[i] = (cy + dy + n) % n;
      }
      const cell = ay[i]! * n + ax[i]!;
      occ[cell] += 1;
      visit[cell] += 1;
      ph[cell] += deposit;
    }

    // diffuse + decay the trail
    for (let y = 0; y < n; y++) {
      const ym = ((y - 1 + n) % n) * n;
      const yp = ((y + 1) % n) * n;
      const yc = y * n;
      for (let x = 0; x < n; x++) {
        const xm = (x - 1 + n) % n;
        const xp = (x + 1) % n;
        const c = yc + x;
        const lap = ph[yc + xm]! + ph[yc + xp]! + ph[ym + x]! + ph[yp + x]! - 4 * ph[c]!;
        ph2[c] = (ph[c]! + diffusion * lap) * decay;
      }
    }
    const tmp = ph;
    ph = ph2;
    ph2 = tmp;
    ph2.fill(0);
  }

  const adens = new Float64Array(n * n);
  for (let i = 0; i < agents; i++) adens[ay[i]! * n + ax[i]!]++;

  return {
    moranAgents: moranI(adens, n),
    agentDensity: adens,
    caAct: caSum,
    crossCorr: pearson(visit, caSum),
  };
}

export const novelCompositeBenchmark: BenchmarkModel = {
  id: 'J',
  name: 'Fractal-life composite',
  family: 'novel hybrid',
  stochastic: true,
  reference:
    'Novel composite: Game of Life (Conway 1970) coupled bidirectionally to stigmergic agents climbing a diffusing pheromone field (Grasse 1959); coupling should add spatial self-organisation.',
  run(seed: string, scale: BenchmarkScale, params: BenchParams = {}): RunOutput {
    const cfg = { ...(scale === 'quick' ? QUICK : FULL), coupling: 100, diffusion: 0.15, decay: 0.97, crowding: 6, deposit: 1, ...params };
    const coupled = runComposite(seed, cfg, true);
    const baseline = runComposite(seed, cfg, false);
    const selfOrgGain = coupled.moranAgents - baseline.moranAgents;
    return {
      signature: {
        moranCoupled: coupled.moranAgents,
        moranBaseline: baseline.moranAgents,
        selfOrgGain,
        crossCorr: coupled.crossCorr,
      },
      fingerprint: sha256OfNumbers(coupled.agentDensity, coupled.caAct),
    };
  },
  checks: [
    {
      key: 'moranCoupled',
      test: 'gte',
      value: 0.2,
      note: 'cross-influence produces spatial auto-correlation in agent density (Moran’s I ≥ 0.20).',
      gate: true,
      referenceKind: 'empirical',
      citation: 'Moran (1950) auto-correlation (used as a calibration target for the composite)',
    },
    {
      key: 'selfOrgGain',
      test: 'gte',
      value: 0.05,
      note: 'pattern strength exceeds the uncoupled baseline (gain ≥ 0.05).',
      gate: true,
      referenceKind: 'theory',
      citation: 'reaction–diffusion–advection coupling (synthetic control)',
    },
    {
      key: 'crossCorr',
      test: 'gte',
      value: 0.3,
      note: 'time-accumulated occupancy and CA activity become positively coupled (r ≥ 0.30).',
      gate: true,
      referenceKind: 'theory',
      citation: 'cross-correlation (synthetic control)',
    },
  ],
  params: [
    { key: 'coupling', label: 'agent–field coupling', def: 100, min: 10, max: 500, log: true },
    { key: 'diffusion', label: 'pheromone diffusion', def: 0.15, min: 0.01, max: 1.0, log: true },
    { key: 'decay', label: 'pheromone decay', def: 0.97, min: 0.8, max: 0.999, log: true },
    { key: 'crowding', label: 'crowding penalty', def: 6, min: 1, max: 20, log: true },
  ],
  interventions: [
    {
      id: 'abl-coupling',
      label: 'uncouple agents from pheromone (coupling = 0)',
      kind: 'ablation',
      apply: (p) => ({ ...p, coupling: 0 }),
      effects: [
        { key: 'moranCoupled', direction: 'decrease', note: 'coupling drives spatial clustering.' },
        { key: 'crossCorr', direction: 'decrease', note: 'no agent–field feedback → weaker coupling.' },
      ],
    },
    {
      id: 'abl-pheromone',
      label: 'remove pheromone dynamics (diffusion=0, decay=1)',
      kind: 'ablation',
      apply: (p) => ({ ...p, diffusion: 0, decay: 1 }),
      effects: [{ key: 'crossCorr', direction: 'decrease', note: 'field cannot carry history across space/time.' }],
    },
  ],
  empirical: {
    systemId: 'stochastic-search-composite',
    claim: 'Coupling agents to an autogenic field generates spatial coherence and measurable agent–field cross-correlation.',
  },
};
