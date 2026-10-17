import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MAX_AGENTS } from '@fractal-life/shared';
import { runLadder, type LadderOptions } from './ladder.js';
import { runDigest } from './experiment.js';
import { regimeVec } from './highN.js';
import { MACRO_REGIMES } from './emergence.js';

export type Phase = 'exploration' | 'activeSearch' | 'confirmation';

export interface Allocation {
  phase: Phase;
  budget: number;
  nSeeds: number;
  scales: number[];
  ticks: number;
  sampleEvery: number;
  rationale: string;
}

export function defaultAllocations(): Allocation[] {
  const clampScales = (xs: number[]) => xs.filter((s) => s <= MAX_AGENTS);
  return [
    {
      phase: 'exploration',
      budget: 0.5,
      nSeeds: 3,
      scales: clampScales([100, 500, 1000, 2000, 5000, 10000]),
      ticks: 2000,
      sampleEvery: 200,
      rationale: 'wide sweep across 10^n agents to discover candidate regimes',
    },
    {
      phase: 'activeSearch',
      budget: 0.3,
      nSeeds: 5,
      scales: clampScales([2000, 5000, 8000, 10000]),
      ticks: 3000,
      sampleEvery: 150,
      rationale: 'focus on promising scales with more seeds',
    },
    {
      phase: 'confirmation',
      budget: 0.2,
      nSeeds: 7,
      scales: clampScales([5000, 8000, 10000]),
      ticks: 4000,
      sampleEvery: 100,
      rationale: 'confirm top candidates with higher fidelity + repro checks',
    },
  ];
}

export function computeTotalBudget(allocs: Allocation[]): number {
  return allocs.reduce((a, b) => a + b.budget, 0);
}

export interface PhaseResult {
  phase: Phase;
  N: number;
  seed: string;
  opts: LadderOptions;
  dominant: string;
  hL1: number;
  hL2: number;
  hL3: number;
  pop: number;
  digest?: string;
  reproducible?: boolean;
}

export async function runAllocated(allocs: Allocation[] = defaultAllocations()) {
  const outDir = fileURLToPath(new URL('../../research/output/', import.meta.url));
  mkdirSync(outDir, { recursive: true });
  const results: PhaseResult[] = [];
  for (const alloc of allocs) {
    const seeds = Array.from({ length: alloc.nSeeds }, (_, i) => `${alloc.phase}.s${i + 1}`);
    for (const N of alloc.scales) {
      const sp = Math.min(Math.max(50, Math.floor(N)), MAX_AGENTS);
      const mp = Math.min(Math.max(sp, Math.floor(N * 1.2)), MAX_AGENTS);
      for (const seed of seeds) {
        const opts: LadderOptions = {
          seed,
          ticks: alloc.ticks,
          spawnCount: sp,
          maxPopulation: mp,
          sampleEvery: alloc.sampleEvery,
        };
        const r = runLadder(opts);
        const rv = regimeVec(r);
        results.push({
          phase: alloc.phase,
          N: sp,
          seed,
          opts,
          dominant: MACRO_REGIMES[rv.macroIdx] ?? 'random',
          hL1: rv.hL1,
          hL2: rv.hL2,
          hL3: rv.hL3,
          pop: rv.pop,
        });
      }
    }
  }
  const conf = results.filter((x) => x.phase === 'confirmation').slice(0, 3);
  for (const c of conf) {
    const first = runLadder(c.opts);
    const again = runLadder(c.opts);
    c.digest = runDigest(first);
    c.reproducible = runDigest(again) === c.digest;
  }
  writeFileSync(join(outDir, 'allocCompute.json'), JSON.stringify({ allocations: allocs, results }, null, 2));
  return { allocations: allocs, results };
}
