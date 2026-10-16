/** Reproducible experiment runner: run documented experiments, fingerprint
 * their trajectories bit-for-bit, aggregate objective scores across seeds,
 * and verify that a recorded manifest reproduces exactly.
 *
 * Pipeline: Experiment (immutable doc) -> runExperiment -> ExperimentManifest
 * -> saveManifest -> loadManifest -> reproduceExperiment (bit-exact check).
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { runLadder, type LadderOptions, type LadderResult } from './ladder.js';
import { mean, stdev } from './stats.js';
import { objectives, scoreMulti, meetsThresholds, type Objective } from './design/objectives.js';

export interface Experiment {
  id: string;
  name: string;
  /** falsifiable statement the experiment tests */
  hypothesis: string;
  description?: string;
  tags: string[];
  seeds: string[];
  /** ladder settings (ticks, spawnCount, overrides, brain, cellBio, ...) */
  ladder: Partial<LadderOptions>;
  /** objective ids from OBJECTIVE_SET (default: l1/l2/l3 + adaptation) */
  objectiveIds?: string[];
  createdAt: string;
}

const OBJECTIVE_SET: Record<string, () => Objective> = {
  'l1-emergent': () => objectives.l1Emergent(),
  'l2-emergent': () => objectives.l2Emergent(),
  'l3-emergent': () => objectives.l3Emergent(),
  adaptation: () => objectives.adaptation(0),
  'life-steady': () => objectives.lifeSteady(),
  speciation: () => objectives.speciation(0),
  'hazard-avoidance': () => objectives.hazardAvoidance(),
  'signal-use': () => objectives.signalUse(),
  'culture-mi': () => objectives.cultureMemeMI(),
};

export const DEFAULT_OBJECTIVES = ['l1-emergent', 'l2-emergent', 'l3-emergent', 'adaptation'];

export function resolveObjectives(ids?: string[]): Objective[] {
  const use = ids && ids.length > 0 ? ids : DEFAULT_OBJECTIVES;
  return use.map((id) => {
    const f = OBJECTIVE_SET[id];
    if (!f) throw new Error(`unknown objective '${id}' (have: ${Object.keys(OBJECTIVE_SET).join(', ')})`);
    return f();
  });
}

export function availableObjectives(): string[] {
  return Object.keys(OBJECTIVE_SET);
}

/** Bit-exact digest of a ladder run: sha256 over the full world fingerprint
 * (grid + alive agents) plus the trajectory, summary and synthesis. The world
 * fingerprint is included so that degenerate summaries (e.g. a world where
 * nothing was alive) still differ across seeds when the underlying grids do. */
export function runDigest(r: LadderResult): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        worldFingerprint: r.worldFingerprint,
        trajectory: r.trajectory,
        summary: r.summary,
        synthesis: r.synthesis,
      }),
    )
    .digest('hex');
}

function verdictsOf(r: LadderResult): Record<string, string> {
  const out: Record<string, string> = {};
  for (const l of r.synthesis.levels) out[l.level] = l.verdict;
  return out;
}

export interface SeedOutcome {
  seed: string;
  digest: string;
  score: number;
  breakdown: Record<string, number>;
  thresholdsMet: boolean;
  verdicts: Record<string, string>;
}

export interface ExperimentManifest {
  experiment: Experiment;
  objectiveIds: string[];
  ranAt: string;
  runtime: { node: string; platform: string };
  perSeed: SeedOutcome[];
  aggregate: { meanScore: number; sdScore: number; passRate: number };
  /** true if a double-run of seed[0] produced identical digests */
  reproducible: boolean;
}

export interface RunOptions {
  /** run seed[0] twice and confirm bit-exact digests (default true) */
  doubleCheck?: boolean;
  /** ladder runner override — tests inject a cheap deterministic fake so the
   * experiment pipeline (digest/aggregate/persist/reproduce) is covered
   * without paying for the full controlled-scenario ladder */
  runner?: (o: LadderOptions) => LadderResult;
}

/** Effective ladder options for a seed: documented defaults < experiment.ladder < seed. */
export function ladderOptsFor(exp: Experiment, seed: string): LadderOptions {
  const base: LadderOptions = {
    seed,
    ticks: 12000,
    spawnCount: 60,
    maxPopulation: 400,
    sampleEvery: 400,
    ...exp.ladder,
  };
  base.seed = seed;
  return base;
}

export function runExperiment(exp: Experiment, opts: RunOptions = {}): ExperimentManifest {
  const run = opts.runner ?? runLadder;
  const objs = resolveObjectives(exp.objectiveIds);
  const perSeed: SeedOutcome[] = [];
  for (const seed of exp.seeds) {
    const r = run(ladderOptsFor(exp, seed));
    const s = scoreMulti(objs, r);
    perSeed.push({
      seed,
      digest: runDigest(r),
      score: s.total,
      breakdown: s.breakdown,
      thresholdsMet: meetsThresholds(objs, r),
      verdicts: verdictsOf(r),
    });
  }
  const scores = perSeed.map((p) => p.score);
  const check = opts.doubleCheck !== false && perSeed.length > 0;
  let reproducible = true;
  if (check) {
    const first = perSeed[0]!;
    const again = run(ladderOptsFor(exp, first.seed));
    reproducible = runDigest(again) === first.digest;
  }
  return {
    experiment: exp,
    objectiveIds: objs.map((o) => o.id),
    ranAt: new Date().toISOString(),
    runtime: { node: process.version, platform: process.platform },
    perSeed,
    aggregate: {
      meanScore: mean(scores),
      sdScore: scores.length > 1 ? stdev(scores) : 0,
      passRate: perSeed.filter((p) => p.thresholdsMet).length / perSeed.length,
    },
    reproducible,
  };
}

export function saveManifest(m: ExperimentManifest, filePath: string): void {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify(m, null, 2) + '\n');
}

export function loadManifest(filePath: string): ExperimentManifest {
  if (!existsSync(filePath)) throw new Error(`manifest not found: ${filePath}`);
  return JSON.parse(readFileSync(filePath, 'utf8')) as ExperimentManifest;
}

export interface ReproduceReport {
  matched: boolean;
  seeds: { seed: string; recorded: string; rerun: string; matched: boolean }[];
}

/** Re-run a recorded manifest and compare digests bit-for-bit. */
export function reproduceExperiment(m: ExperimentManifest, runner?: (o: LadderOptions) => LadderResult): ReproduceReport {
  const run = runner ?? runLadder;
  const exp = m.experiment;
  const seeds = m.perSeed.map((p) => {
    const d = runDigest(run(ladderOptsFor(exp, p.seed)));
    return { seed: p.seed, recorded: p.digest, rerun: d, matched: d === p.digest };
  });
  return { matched: seeds.every((s) => s.matched), seeds };
}
