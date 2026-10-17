import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MAX_AGENTS } from '@fractal-life/shared';
import { runLadder, type LadderOptions, type LadderResult } from './ladder.js';
import { runDigest } from './experiment.js';
import {
  MACRO_REGIMES,
  classifyMacroRegime,
  macroRigidity,
  macroStatePersistence,
  quantize,
  sustainedPeak,
} from './emergence.js';
import { mean } from './stats.js';

export interface GNScore {
  G0: number;
  G1: number;
  G2: number;
  G3: number;
  G4: number;
  G5: number;
  G6: number;
  G7: number;
  G8: number;
  total: number;
}

export interface RegimeVec {
  macroIdx: number;
  structure: number;
  rigidity: number;
  persistence: number;
  hL1: number;
  hL2: number;
  hL3: number;
  maxSpecies: number;
  coop: number;
  donation: number;
  pop: number;
}

export interface HighNCandidate {
  id: string;
  seed: string;
  opts: LadderOptions;
  result: LadderResult;
  rv: RegimeVec;
  scores?: GNScore;
  digest?: string;
  reproducible?: boolean;
}

function clamp(n: number, lo: number, hi: number): number {
  if (n < lo) return lo;
  if (n > hi) return hi;
  return n;
}

function verdictScore(v: string | undefined): number {
  if (v === 'EMERGENT') return 1;
  if (v === 'PARTIAL') return 0.5;
  return 0;
}

/**
 * Regime vector derived from the ladder trajectory (no engine internals):
 * quantized [alive, species, cooperation, memeEntropy] per sample give the
 * macro-state sequence used for rigidity/persistence; `structure` is a
 * population-organization proxy (cooperation + species order) standing in for
 * the occupancy-based spatial measure that needs the live engine.
 */
export function regimeVec(r: LadderResult): RegimeVec {
  const traj = r.trajectory;
  const maxAlive = Math.max(1, r.summary.life.maxAlive);
  const maxSpecies = Math.max(1, r.summary.interaction.maxSpecies);
  const maxCoop = Math.max(1e-12, r.summary.interaction.maxCooperation);
  const maxMeme = Math.max(1e-12, r.summary.cognition.memeEntropyMax);
  const states = traj.map((t) => {
    let idx = 0;
    idx = idx * 4 + quantize(t.alive, 0, maxAlive, 4);
    idx = idx * 4 + quantize(t.species, 0, maxSpecies, 4);
    idx = idx * 4 + quantize(t.cooperation, 0, maxCoop, 4);
    idx = idx * 4 + quantize(t.memeEntropy, 0, maxMeme, 4);
    return idx;
  });
  const rigidity = macroRigidity(states);
  const persistence = macroStatePersistence(states);
  const coopOrder = maxCoop > 1e-12 ? mean(traj.map((t) => t.cooperation)) / maxCoop : 0;
  const speciesOrder = maxSpecies > 1 ? mean(traj.map((t) => t.species)) / maxSpecies : 0;
  const structure = clamp(0.5 * coopOrder + 0.5 * speciesOrder, 0, 1);
  const peakAlive = sustainedPeak(traj.map((t) => t.alive));
  const collapsed = peakAlive > 1e-12 && r.summary.life.finalAlive < 0.6 * peakAlive;
  const dominant = classifyMacroRegime(structure, rigidity, collapsed);
  const lv = (prefix: string) =>
    verdictScore(r.synthesis.levels.find((l) => l.level.startsWith(prefix))?.verdict);
  return {
    macroIdx: MACRO_REGIMES.indexOf(dominant),
    structure,
    rigidity,
    persistence,
    hL1: lv('L1'),
    hL2: lv('L2'),
    hL3: lv('L3'),
    maxSpecies: r.summary.interaction.maxSpecies,
    coop: clamp(r.summary.interaction.maxCooperation, 0, 1),
    donation: clamp(r.summary.interaction.maxMeanAltruism, 0, 1),
    pop: r.summary.life.finalAlive,
  };
}

function scoreCandidate(baseRv: RegimeVec | null, cand: HighNCandidate): GNScore {
  const r = cand.result;
  const rv = cand.rv;
  const summary = r.summary;
  const finite = [
    summary.life.finalAlive,
    summary.life.minAlive,
    summary.interaction.maxSpecies,
    summary.interaction.maxCooperation,
    summary.cognition.signalTotalMean,
    summary.cognition.hazardCorr,
    summary.cognition.signalCorr,
  ];
  let G0 = finite.every((v) => Number.isFinite(v)) && r.synthesis.levels.length === 3 ? 1.0 : 0.0;
  let G1 = 0.0;
  if (summary.life.minAlive > 0) G1 += 0.3;
  if (summary.interaction.maxSpecies >= 2) G1 += 0.3;
  if (rv.coop > 1e-6 || summary.cognition.signalTotalMean > 1e-6) G1 += 0.4;
  G1 = clamp(G1, 0, 1);
  let G2 = 0.5;
  if (baseRv) {
    let d = 0;
    d += Math.abs(rv.macroIdx - baseRv.macroIdx) / 4;
    d += Math.abs(rv.structure - baseRv.structure);
    d += Math.abs(rv.rigidity - baseRv.rigidity);
    d += Math.abs(rv.persistence - baseRv.persistence);
    d += Math.abs(rv.hL1 - baseRv.hL1) + Math.abs(rv.hL2 - baseRv.hL2) + Math.abs(rv.hL3 - baseRv.hL3);
    G2 = clamp((d / 7) * 2, 0, 1);
  }
  let G3 = 0.0;
  if (summary.life.minAlive > 0 && summary.life.finalAlive > 0) G3 += 0.5;
  if (rv.persistence > 0.2 || rv.rigidity > 0.3) G3 += 0.5;
  G3 = clamp(G3, 0, 1);
  const G4 = cand.reproducible ? 1.0 : cand.digest ? 0.9 : 0.8;
  let G5 = 0.5;
  if (Math.abs(summary.cognition.hazardCorr) > 0.01 || Math.abs(summary.cognition.signalCorr) > 0.01) G5 += 0.3;
  if (rv.coop > 0 && rv.hL2 >= 0.5) G5 += 0.2;
  G5 = clamp(G5, 0, 1);
  let G6 = 0.0;
  if (summary.life.cycling) G6 += 0.3;
  if (rv.hL1 >= 0.5) G6 += 0.3;
  if (rv.hL2 >= 0.5) G6 += 0.2;
  if (rv.hL3 >= 0.5) G6 += 0.2;
  G6 = clamp(G6, 0, 1);
  let G7 = 0.3;
  if (rv.macroIdx >= 2) G7 += 0.3;
  if (rv.rigidity > 0.4) G7 += 0.2;
  if (rv.maxSpecies >= 3) G7 += 0.2;
  G7 = clamp(G7, 0, 1);
  let G8 = 0.4;
  if (G6 >= 0.7 && G5 >= 0.6) G8 += 0.3;
  if (G7 >= 0.6 && G3 >= 0.6) G8 += 0.3;
  G8 = clamp(G8, 0, 1);
  const total = G0 * 2 + G1 + G2 + G3 + G4 * 2 + G5 + G6 + G7 + G8;
  return { G0, G1, G2, G3, G4, G5, G6, G7, G8, total };
}

function serializeCandidate(c: HighNCandidate) {
  return {
    id: c.id,
    seed: c.seed,
    opts: {
      seed: c.opts.seed,
      ticks: c.opts.ticks,
      spawnCount: c.opts.spawnCount,
      maxPopulation: c.opts.maxPopulation,
      sampleEvery: c.opts.sampleEvery,
    },
    regimeVec: c.rv,
    scores: c.scores,
    digest: c.digest,
    reproducible: c.reproducible,
    summary: c.result.summary,
    synthesis: c.result.synthesis,
    worldFingerprint: c.result.worldFingerprint,
  };
}

export interface HighNRunConfig {
  seeds: string[];
  scales: number[];
  ticks: number;
  sampleEvery: number;
  /** number of top candidates re-run to verify bit-exact reproducibility */
  verifyRepro: number;
}

export function defaultHighNConfig(): HighNRunConfig {
  return {
    seeds: ['highn.s1', 'highn.s2', 'highn.s3'],
    scales: [100, 500, 1000, 2000, 5000, 10000],
    ticks: 2000,
    sampleEvery: 200,
    verifyRepro: 2,
  };
}

export async function runHighNSelection(cfg: HighNRunConfig = defaultHighNConfig()) {
  const outDir = fileURLToPath(new URL('../../research/output/', import.meta.url));
  mkdirSync(outDir, { recursive: true });
  const candidates: HighNCandidate[] = [];
  for (const N of cfg.scales) {
    const sp = Math.min(Math.max(50, Math.floor(N)), MAX_AGENTS);
    const mp = Math.min(Math.max(sp, Math.floor(N * 1.2)), MAX_AGENTS);
    for (const seed of cfg.seeds) {
      const id = `highn_n${sp}_mp${mp}_${seed}`;
      const opts: LadderOptions = {
        seed,
        ticks: cfg.ticks,
        spawnCount: sp,
        maxPopulation: mp,
        sampleEvery: cfg.sampleEvery,
      };
      const result = runLadder(opts);
      const rv = regimeVec(result);
      candidates.push({ id, seed, opts, result, rv });
    }
  }
  let baseRvScore: RegimeVec | null = null;
  const scored: HighNCandidate[] = candidates.map((c) => {
    const sc = scoreCandidate(baseRvScore, c);
    if (!baseRvScore) baseRvScore = c.rv;
    return { ...c, scores: sc };
  });
  scored.sort((a, b) => (b.scores?.total ?? 0) - (a.scores?.total ?? 0));
  for (let i = 0; i < Math.min(cfg.verifyRepro, scored.length); i++) {
    const c = scored[i]!;
    const again = runLadder(c.opts);
    c.digest = runDigest(c.result);
    c.reproducible = runDigest(again) === c.digest;
  }
  const selected = scored.slice(0, 3);
  writeFileSync(
    join(outDir, 'highN_selection.json'),
    JSON.stringify(
      {
        config: cfg,
        nCandidates: scored.length,
        candidates: scored.map(serializeCandidate),
        selected: selected.map((c) => c.id),
      },
      null,
      2,
    ),
  );
  return { candidates: scored, selected };
}

function parseArgs(argv: string[]): HighNRunConfig {
  const cfg = defaultHighNConfig();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--scales' && argv[i + 1]) {
      cfg.scales = argv[++i]!.split(',').map((s) => Number(s.trim())).filter((n) => Number.isFinite(n) && n > 0);
    } else if (a === '--seeds' && argv[i + 1]) {
      cfg.seeds = argv[++i]!.split(',').map((s) => s.trim()).filter(Boolean);
    } else if (a === '--ticks' && argv[i + 1]) {
      cfg.ticks = Number(argv[++i]);
    } else if (a === '--sample-every' && argv[i + 1]) {
      cfg.sampleEvery = Number(argv[++i]);
    } else if (a === '--verify-repro' && argv[i + 1]) {
      cfg.verifyRepro = Number(argv[++i]);
    }
  }
  return cfg;
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('highN.ts')) {
  const cfg = parseArgs(process.argv.slice(2));
  runHighNSelection(cfg).then((r) => {
    console.log(
      JSON.stringify(
        {
          nCandidates: r.candidates.length,
          selected: r.selected.map((c) => ({ id: c.id, total: c.scores?.total, reproducible: c.reproducible })),
        },
        null,
        2,
      ),
    );
  });
}
