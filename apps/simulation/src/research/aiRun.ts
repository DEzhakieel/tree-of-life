import fs from 'node:fs';
import path from 'node:path';
import { makeWorld } from './scenarios.js';
import { BENCHMARK_MODELS } from './benchmarks/models/index.js';
import { runBenchmark } from './benchmarks/harness.js';
import { createLlm } from './ai/client.js';
import { OUTPUT_DIR } from './ai/paths.js';
import { runWorldControl } from './ai/controller.js';
import { runWorld, fmtSample, deltaLine, type WorldSample } from './ai/world.js';
import { analysePhases } from './ai/phaseAnalyst.js';
import { runResearchLoop, scoreProposalParsimony, type ExperimentProposal, type LoopResult } from './ai/researchAgent.js';
import { KNOWN_SYSTEMS } from './benchmarks/knownSystems/index.js';
import { WORLD_KNOBS } from './ai/knobs.js';
import type { ChatOptions, LlmConfig, ProviderId } from './ai/types.js';
import type { WorldConfig } from '@fractal-life/shared';

/**
 * CLI for the LLM / AI-agent layer.
 *
 *   aiRun.ts world  — iterative world controller: an unsteered warmup, then a
 *                     closed loop of observe → directive → actuate → measure,
 *                     against an unsteered control run of the same tick budget
 *   aiRun.ts phase  — sweep a parameter, locate phase transitions, ask the LLM
 *                     to interpret them
 *   aiRun.ts loop   — iterative research agent: proposals are scored by the A–J
 *                     harness and the verdicts are fed back into later rounds
 *
 * Flags: --live (force a fresh call, then cache it) | --no-cache (never touch
 *        the cache) | --replay (cache-only, error on a miss) |
 *        --provider mock|ollama | --model <id> | --seed <s> | --objective <text>
 *        --windows <n> | --window-ticks <n> | --warmup <n> | --axis <knob>
 *        --steps <n> | --rounds <n> | --scale quick|full
 */

interface Args {
  cmd: string;
  flags: Map<string, string | boolean>;
}

function parseArgs(argv: string[]): Args {
  const cmd = argv[0] ?? 'world';
  const flags = new Map<string, string | boolean>();
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) flags.set(key, true);
      else {
        flags.set(key, next);
        i++;
      }
    }
  }
  return { cmd, flags };
}

function str(args: Args, key: string, dflt: string): string {
  const v = args.flags.get(key);
  return typeof v === 'string' ? v : dflt;
}
function num(args: Args, key: string, dflt: number): number {
  const v = args.flags.get(key);
  const n = typeof v === 'string' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : dflt;
}

function makeLlm(args: Args) {
  const cfg: LlmConfig = {
    provider: str(args, 'provider', process.env.FRACTAL_LLM_PROVIDER ?? 'ollama') as ProviderId,
    model: str(args, 'model', process.env.FRACTAL_LLM_MODEL ?? 'qwen2.5:3b'),
    temperature: 0.6,
    seed: num(args, 'llm-seed', 7),
    timeoutMs: num(args, 'llm-timeout', 300_000),
  };
  if (args.flags.has('live')) cfg.cache = 'refresh';
  else if (args.flags.has('no-cache')) cfg.cache = 'off';
  else if (args.flags.has('replay')) cfg.cache = 'replay';
  else cfg.cache = 'on';
  return createLlm(cfg);
}

function chatOpts(args: Args): ChatOptions {
  return { temperature: 0.6, seed: num(args, 'llm-seed', 7) };
}

function writeOut(name: string, json: unknown, md?: string): { jsonPath: string; mdPath?: string } {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const jsonPath = path.join(OUTPUT_DIR, `${name}.json`);
  fs.writeFileSync(jsonPath, JSON.stringify(json, null, 2));
  if (md === undefined) return { jsonPath };
  const mdPath = path.join(OUTPUT_DIR, `${name}.md`);
  fs.writeFileSync(mdPath, md);
  return { jsonPath, mdPath };
}

// --- world controller -------------------------------------------------------

async function cmdWorld(args: Args): Promise<void> {
  const llm = makeLlm(args);
  const seed = str(args, 'seed', 'ai-world-0001');
  const spawn = num(args, 'spawn', 200);
  const objective = str(
    args,
    'objective',
    'sustain a large, healthy population with high trait diversity and no energy collapse',
  );

  const run = await runWorldControl(llm, makeWorld(seed, spawn, {}), {
    objective,
    windows: num(args, 'windows', 3),
    windowTicks: num(args, 'window-ticks', 200),
    warmupTicks: num(args, 'warmup', 200),
    chat: chatOpts(args),
  });

  const last = run.trajectory[run.trajectory.length - 1]!;
  const payload = {
    generatedAt: new Date().toISOString(),
    provider: llm.provider,
    model: last.result.model,
    cached: run.trajectory.every((t) => t.result.cached),
    seed,
    spawn,
    objective,
    windows: run.windows,
    windowTicks: run.windowTicks,
    warmupTicks: run.warmupTicks,
    control: run.control,
    trajectory: run.trajectory.map((t) => ({
      window: t.window,
      inForce: t.inForce,
      applied: t.applied,
      objective: t.directive.objective,
      rationale: t.directive.rationale,
      overrides: t.directive.overrides,
      species: t.directive.species,
      sample: t.sample,
      cached: t.result.cached,
    })),
    final: run.final,
  };

  const { jsonPath } = writeOut('ai-world', payload, renderControlMd(payload));
  console.log(
    `aiRun world: ${run.windows} windows x ${run.windowTicks} ticks; ` +
      `control alive=${run.control.aliveCount} vs final alive=${run.final.aliveCount}; wrote ${jsonPath}`,
  );
}

function renderControlMd(p: {
  generatedAt: string;
  provider: string;
  model: string;
  cached: boolean;
  objective: string;
  windows: number;
  windowTicks: number;
  warmupTicks: number;
  control: WorldSample;
  trajectory: {
    window: number;
    applied: Record<string, number>;
    objective: string;
    rationale: string;
    species: { name: string; strategy: string; note: string }[];
    sample: WorldSample;
  }[];
  final: WorldSample;
}): string {
  return [
    '# AI World Controller',
    `Generated: ${p.generatedAt}`,
    `Provider: ${p.provider} (${p.model})${p.cached ? ' [cached]' : ''}`,
    `Objective: ${p.objective}`,
    `Design: ${p.warmupTicks}-tick unsteered warmup, then ${p.windows} steered windows of ${p.windowTicks} ticks, against an unsteered control run of the same tick budget.`,
    '',
    '## Trajectory',
    '| window | applied | alive | pop | species | energy | effDim |',
    '|---|---|---|---|---|---|---|',
    ...p.trajectory.map(
      (t) =>
        `| ${t.window} | ${Object.entries(t.applied).map(([k, v]) => `${k}=${v}`).join(', ') || '—'} | ${t.sample.aliveCount} | ${t.sample.population} | ${t.sample.speciesCount} | ${t.sample.avgEnergy.toFixed(1)} | ${t.sample.traitEffectiveDim.toFixed(1)} |`,
    ),
    '',
    '## Decisions',
    ...p.trajectory.flatMap((t) => [
      `**Window ${t.window}** — ${t.objective}`,
      `  ${t.rationale}`,
      `  outcome: ${fmtSample(t.sample)}`,
      ...(t.species.length
        ? ['  species:', ...t.species.map((s) => `    - ${s.name}: ${s.strategy} (${s.note})`)]
        : []),
      '',
    ]),
    '## Steered vs unsteered control',
    `control: ${fmtSample(p.control)}`,
    `steered: ${fmtSample(p.final)}`,
    '',
    '| metric | control (unsteered) | steered |',
    '|---|---|---|',
    ...(Object.keys(p.final) as (keyof WorldSample)[])
      .filter((k) => k !== 'tick')
      .map((k) => `| ${k} | ${p.control[k]} | ${p.final[k]} |`),
    '',
    `<sub>${deltaLine(p.control, p.final)}</sub>`,
  ].join('\n');
}

// --- phase analysis ---------------------------------------------------------

interface SweepPoint {
  value: number;
  sample: WorldSample;
}

const ORDER_METRICS: (keyof WorldSample)[] = [
  'aliveCount',
  'speciesCount',
  'avgEnergy',
  'cooperation',
  'caComplexity',
  'traitEffectiveDim',
];

interface Locus {
  metric: string;
  at: number;
  delta: number;
  sharp: boolean;
}

function findLoci(points: SweepPoint[]): Locus[] {
  const loci: Locus[] = [];
  for (const metric of ORDER_METRICS) {
    const deltas: number[] = [];
    for (let i = 1; i < points.length; i++) {
      deltas.push(Math.abs(points[i]!.sample[metric] - points[i - 1]!.sample[metric]));
    }
    if (deltas.length === 0) continue;
    let best = 0;
    for (let i = 1; i < deltas.length; i++) if (deltas[i]! > deltas[best]!) best = i;
    const sorted = [...deltas].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
    const delta = deltas[best]!;
    loci.push({
      metric,
      at: (points[best]!.value + points[best + 1]!.value) / 2,
      delta,
      sharp: delta > 0 && delta >= 2 * median,
    });
  }
  return loci;
}

async function cmdPhase(args: Args): Promise<void> {
  const llm = makeLlm(args);
  const seed = str(args, 'seed', 'ai-phase-0001');
  const ticks = num(args, 'ticks', 400);
  const spawn = num(args, 'spawn', 150);
  const axis = str(args, 'axis', 'foodRegenRate');
  const steps = Math.max(3, num(args, 'steps', 8));

  const knob = WORLD_KNOBS.find((k) => k.key === axis) ?? WORLD_KNOBS[1]!;
  const log = knob.key !== 'energyCapacity' && knob.key !== 'maxPopulation' && knob.key !== 'spawnCount';
  const values: number[] = [];
  for (let i = 0; i < steps; i++) {
    const t = i / (steps - 1);
    values.push(log ? knob.min * Math.pow(knob.max / knob.min, t) : knob.min + (knob.max - knob.min) * t);
  }

  const points: SweepPoint[] = values.map((value) => ({
    value,
    sample: runWorld(makeWorld(seed, spawn, { [knob.key]: value }), ticks),
  }));
  const loci = findLoci(points);

  const table = points.map((p) => `${knob.key}=${p.value.toPrecision(3)}: ${fmtSample(p.sample)}`).join('\n');
  const context = [
    `axis=${knob.key} (${knob.label}) steps=${steps} ticks=${ticks} founders=${spawn}`,
    'sweep:',
    table,
    '',
    'sharpest adjacent-change loci per order parameter:',
    ...loci.map((l) => `${l.metric}: at ${l.at.toPrecision(3)} (|Δ|=${l.delta.toPrecision(3)}${l.sharp ? ', sharp' : ''})`),
  ].join('\n');

  const { analysis, result } = await analysePhases(llm, context, chatOpts(args));

  const payload = {
    generatedAt: new Date().toISOString(),
    provider: llm.provider,
    model: result.model,
    cached: result.cached,
    seed,
    ticks,
    axis: knob.key,
    sweep: points,
    measuredLoci: loci,
    analysis,
  };

  const { jsonPath } = writeOut(
    'ai-phase',
    payload,
    [
      '# AI Phase Analysis',
      `Generated: ${payload.generatedAt}`,
      `Provider: ${llm.provider} (${result.model})${result.cached ? ' [cached]' : ''}`,
      `Axis: ${knob.key} (${knob.label}), ${steps} steps, ${ticks} ticks`,
      '',
      '## Measured sweep',
      '| value | pop | alive | species | energy | coop | caComplexity | effDim |',
      '|---|---|---|---|---|---|---|---|',
      ...points.map(
        (p) =>
          `| ${p.value.toPrecision(3)} | ${p.sample.population} | ${p.sample.aliveCount} | ${p.sample.speciesCount} | ${p.sample.avgEnergy.toFixed(1)} | ${p.sample.cooperation.toFixed(3)} | ${p.sample.caComplexity.toFixed(3)} | ${p.sample.traitEffectiveDim.toFixed(1)} |`,
      ),
      '',
      '## Measured critical loci',
      '| metric | locus | |Δ| | sharp |',
      '|---|---|---|---|',
      ...loci.map((l) => `| ${l.metric} | ${l.at.toPrecision(3)} | ${l.delta.toPrecision(3)} | ${l.sharp} |`),
      '',
      '## LLM interpretation',
      analysis.recommendation,
      '',
      '| axis | locus | sharp | note |',
      '|---|---|---|---|',
      ...analysis.loci.map((l) => `| ${l.axis} | ${l.locus} | ${l.sharp} | ${l.note} |`),
      '',
      '### Recommended refinements',
      ...analysis.refine.map((r) => `- ${r.axis} around ${r.around}`),
    ].join('\n'),
  );
  console.log(`aiRun phase: wrote ${jsonPath}`);
}

// --- research agent loop ----------------------------------------------------

function findModel(id: string) {
  const needle = id.toLowerCase().trim();
  return (
    BENCHMARK_MODELS.find((m) => m.id.toLowerCase() === needle) ??
    BENCHMARK_MODELS.find((m) => m.name.toLowerCase().includes(needle) || needle.includes(m.name.toLowerCase()))
  );
}

function scorecardContext(scale: 'quick' | 'full'): string {
  const rows = BENCHMARK_MODELS.map((m) => `${m.id} — ${m.name} (family: ${m.family}; ${m.reference})`);
  return [
    `benchmark suite (scale=${scale}), ${BENCHMARK_MODELS.length} models A–J:`,
    ...rows,
    '',
    'Each proposal names a model by id/name; its `params` override the model knobs; it is "supported" if the model still passes its acceptance checks at those params.',
  ].join('\n');
}

function countByVerdict(records: { verdict: string }[]) {
  return {
    total: records.length,
    supported: records.filter((r) => r.verdict === 'supported').length,
    refuted: records.filter((r) => r.verdict === 'refuted').length,
    inconclusive: records.filter((r) => r.verdict === 'inconclusive').length,
  };
}

/** reference values a proposal is scored against: closed form first, then published targets */
function referenceFor(model: (typeof BENCHMARK_MODELS)[number]): Record<string, number> | undefined {
  if (model.analytic && Object.keys(model.analytic).length > 0) return model.analytic;
  const targets = KNOWN_SYSTEMS.find((s) => s.id === model.empirical?.systemId)?.targets;
  if (targets && targets.length > 0) return Object.fromEntries(targets.map((t) => [t.key, t.value]));
  return undefined;
}

function defaultsFor(model: (typeof BENCHMARK_MODELS)[number]): Record<string, number> | undefined {
  if (!model.params || model.params.length === 0) return undefined;
  return Object.fromEntries(model.params.map((p) => [p.key, p.def]));
}

async function cmdLoop(args: Args): Promise<void> {
  const llm = makeLlm(args);
  const scale = (str(args, 'scale', 'quick') === 'full' ? 'full' : 'quick') as 'quick' | 'full';
  const maxRounds = num(args, 'rounds', 3);

  const evaluate = (p: ExperimentProposal) => {
    const model = findModel(p.model);
    if (!model) return { verdict: 'inconclusive' as const, detail: `no benchmark model matches "${p.model}"`, harnessRun: false };
    try {
      const r = runBenchmark(model, { scale, determinismCheck: false, params: p.params });
      const failed = r.checks.filter((c) => c.gate && !c.pass).map((c) => c.key);
      const parsimony = scoreProposalParsimony(p, r.signature, referenceFor(model), defaultsFor(model));
      return {
        verdict: (r.verdict === 'PASS' ? 'supported' : 'refuted') as 'supported' | 'refuted',
        detail: `model ${r.id} ${r.verdict} (fidelity ${r.fidelity.toFixed(2)})${failed.length ? `; failed gates: ${failed.join(', ')}` : ''}`,
        parsimony,
        harnessRun: true,
      };
    } catch (err) {
      return { verdict: 'inconclusive' as const, detail: `evaluation error: ${(err as Error).message}`, harnessRun: false };
    }
  };

  // Every verdict is adjudicated by deterministic code: either a benchmark run
  // (`harnessRuns`) or a lookup that resolved to no model (`unmatched`). The
  // language model never produces a verdict, which is what C-AI-01 records.
  const harnessRuns = { n: 0 };
  const wrappedEvaluate = (p: ExperimentProposal) => {
    const out = evaluate(p);
    if (out.harnessRun) harnessRuns.n++;
    const { harnessRun: _h, ...rest } = out;
    return rest;
  };

  const result: LoopResult = await runResearchLoop(llm, scorecardContext(scale), wrappedEvaluate, {
    maxRounds,
    chat: chatOpts(args),
  });
  const counts = countByVerdict(result.records);

  const payload = {
    generatedAt: new Date().toISOString(),
    provider: llm.provider,
    model: result.rounds[0]?.proposeResult.model ?? llm.model,
    cached: result.rounds.every((r) => r.proposeResult.cached),
    scale,
    maxRounds,
    roundsUsed: result.roundsUsed,
    /** proposals whose verdict came from an actual benchmark run */
    harnessRuns: harnessRuns.n,
    /** proposals adjudicated by deterministic code (all of them; the model never adjudicates) */
    harnessScored: result.records.length,
    counts,
    rounds: result.rounds.map((r) => ({
      round: r.round,
      proposals: r.proposals.map((p) => p.id),
      records: r.records.map((rec) => ({
        id: rec.proposal.id,
        model: rec.proposal.model,
        hypothesis: rec.proposal.hypothesis,
        params: rec.proposal.params,
        expected: rec.proposal.expected,
        verdict: rec.verdict,
        detail: rec.detail,
        parsimony: rec.parsimony,
      })),
      cached: r.proposeResult.cached,
    })),
  };

  const { jsonPath } = writeOut('ai-loop', payload, renderLoopMd(payload, result));
  writeOut('ai-loop-ledger', {
    generatedAt: payload.generatedAt,
    provider: llm.provider,
    model: payload.model,
    scale,
    harnessScored: result.records.length,
    harnessRuns: harnessRuns.n,
    counts,
    ledger: result.ledger,
  });
  console.log(
    `aiRun loop: ${result.roundsUsed} round(s), ${counts.supported}/${counts.total} supported; wrote ${jsonPath}`,
  );
}

function renderLoopMd(
  p: {
    generatedAt: string;
    provider: string;
    model: string;
    cached: boolean;
    scale: string;
    maxRounds: number;
    roundsUsed: number;
    counts: { total: number; supported: number; refuted: number; inconclusive: number };
    rounds: {
      round: number;
      records: { id: string; model: string; hypothesis: string; verdict: string; detail: string }[];
      cached: boolean;
    }[];
  },
  result: LoopResult,
): string {
  return [
    '# AI Research Agent Loop',
    `Generated: ${p.generatedAt}`,
    `Provider: ${p.provider} (${p.model})${p.cached ? ' [cached]' : ''}, evaluation scale=${p.scale}`,
    `Rounds used: ${p.roundsUsed} of ${p.maxRounds} — supported ${p.counts.supported}, refuted ${p.counts.refuted}, inconclusive ${p.counts.inconclusive}`,
    '',
    ...p.rounds.flatMap((r) => [
      `## Round ${r.round}${r.cached ? ' [cached]' : ''}`,
      '| id | model | hypothesis | verdict | detail |',
      '|---|---|---|---|---|',
      ...r.records.map(
        (rec) =>
          `| ${rec.id} | ${rec.model} | ${rec.hypothesis} | ${rec.verdict} | ${rec.detail.replace(/\|/g, '/')} |`,
      ),
      '',
    ]),
    '## Ledger (deduplicated, deterministic)',
    '| key | round | verdict |',
    '|---|---|---|',
    ...result.ledger.map((e) => `| ${e.key} | ${e.round} | ${e.verdict} |`),
  ].join('\n');
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  switch (args.cmd) {
    case 'world':
      return cmdWorld(args);
    case 'phase':
      return cmdPhase(args);
    case 'loop':
      return cmdLoop(args);
    default:
      console.error(`unknown command "${args.cmd}" (expected: world | phase | loop)`);
      process.exitCode = 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('aiRun.ts')) {
  main().catch((err) => {
    console.error(`aiRun failed: ${(err as Error).message}`);
    process.exitCode = 1;
  });
}
