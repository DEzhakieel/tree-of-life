import fs from 'node:fs';
import path from 'node:path';
import { Engine } from '../engine.js';
import { makeWorld } from './scenarios.js';
import { BENCHMARK_MODELS } from './benchmarks/models/index.js';
import { runBenchmark } from './benchmarks/harness.js';
import { createLlm } from './ai/client.js';
import { OUTPUT_DIR } from './ai/paths.js';
import { directWorld } from './ai/worldAI.js';
import { analysePhases } from './ai/phaseAnalyst.js';
import { runResearchLoop, type ExperimentProposal } from './ai/researchAgent.js';
import { WORLD_KNOBS } from './ai/knobs.js';
import type { ChatOptions, LlmConfig, ProviderId } from './ai/types.js';
import type { WorldConfig } from '@fractal-life/shared';

/**
 * CLI for the LLM / AI-agent layer.
 *
 *   aiRun.ts world   — the world-mind picks WorldParams overrides; baseline vs
 *                      directed worlds are simulated and compared
 *   aiRun.ts phase   — sweep a parameter, locate phase transitions, ask the LLM
 *                      to interpret them
 *   aiRun.ts loop    — the research agent proposes experiments which are then
 *                      evaluated by the real benchmark harness
 *
 * Flags: --live (bypass cache) | --replay (cache-only) | --provider mock|ollama
 *        --model <id> | --seed <s> | --ticks <n> | --spawn <n> | --objective <text>
 *        --axis <knob> | --steps <n> | --scale quick|full
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
  };
  if (args.flags.has('live') || args.flags.has('no-cache')) cfg.cache = 'off';
  else if (args.flags.has('replay')) cfg.cache = 'replay';
  else cfg.cache = 'on';
  return createLlm(cfg);
}

interface WorldSample {
  population: number;
  aliveCount: number;
  speciesCount: number;
  avgEnergy: number;
  cooperation: number;
  caComplexity: number;
  traitEffectiveDim: number;
  traitTotalVariance: number;
}

function runWorld(world: WorldConfig, ticks: number): WorldSample {
  const engine = new Engine(world);
  for (let i = 0; i < ticks; i++) engine.tick();
  const s = engine.stats();
  return {
    population: s.population,
    aliveCount: s.aliveCount,
    speciesCount: s.speciesCount,
    avgEnergy: s.avgEnergy,
    cooperation: s.cooperation,
    caComplexity: s.caComplexity,
    traitEffectiveDim: s.traitEffectiveDim,
    traitTotalVariance: s.traitTotalVariance,
  };
}

function fmtSample(s: WorldSample): string {
  return (
    `pop=${s.population} alive=${s.aliveCount} species=${s.speciesCount} ` +
    `energy=${s.avgEnergy.toFixed(1)} coop=${s.cooperation.toFixed(3)} ` +
    `caComplexity=${s.caComplexity.toFixed(3)} effDim=${s.traitEffectiveDim.toFixed(1)}`
  );
}

function writeOut(name: string, json: unknown, md: string): { jsonPath: string; mdPath: string } {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const jsonPath = path.join(OUTPUT_DIR, `${name}.json`);
  const mdPath = path.join(OUTPUT_DIR, `${name}.md`);
  fs.writeFileSync(jsonPath, JSON.stringify(json, null, 2));
  fs.writeFileSync(mdPath, md);
  return { jsonPath, mdPath };
}

// --- world ------------------------------------------------------------------

async function cmdWorld(args: Args): Promise<void> {
  const llm = makeLlm(args);
  const seed = str(args, 'seed', 'ai-world-0001');
  const ticks = num(args, 'ticks', 600);
  const spawn = num(args, 'spawn', 200);
  const objective = str(
    args,
    'objective',
    'sustain a large, healthy population with high trait diversity and no energy collapse',
  );

  const baseline = runWorld(makeWorld(seed, spawn, {}), ticks);
  const knobLines = WORLD_KNOBS.map((k) => `${k.key}=${k.min}..${k.max}`).join(', ');
  const context = [
    `seed=${seed} ticks=${ticks} founders=${spawn}`,
    `steerable knobs: ${knobLines}`,
    `baseline after ${ticks} ticks: ${fmtSample(baseline)}`,
    `objective: ${objective}`,
  ].join('\n');

  const { directive, result } = await directWorld(llm, context, chatOpts(args));
  const directed = runWorld(makeWorld(seed, spawn, directive.overrides as Partial<WorldConfig['params']>), ticks);

  const payload = {
    generatedAt: new Date().toISOString(),
    provider: llm.provider,
    model: result.model,
    cached: result.cached,
    seed,
    ticks,
    objective,
    directive,
    baseline,
    directed,
  };
  const deltas = (Object.keys(baseline) as (keyof WorldSample)[]).map(
    (k) => `${k}: ${baseline[k]} → ${directed[k]}`,
  );

  const { jsonPath } = writeOut(
    'ai-world',
    payload,
    [
      '# AI World Directive',
      `Generated: ${payload.generatedAt}`,
      `Provider: ${llm.provider} (${result.model})${result.cached ? ' [cached]' : ''}`,
      `Objective: ${directive.objective}`,
      '',
      '## Rationale',
      directive.rationale,
      '',
      '## Overrides',
      '| knob | value |',
      '|---|---|',
      ...Object.entries(directive.overrides).map(([k, v]) => `| ${k} | ${v} |`),
      '',
      '## Species strategies',
      '| species | strategy | note |',
      '|---|---|---|',
      ...directive.species.map((s) => `| ${s.name} | ${s.strategy} | ${s.note} |`),
      '',
      `## Outcome (${ticks} ticks)`,
      `baseline: ${fmtSample(baseline)}`,
      `directed: ${fmtSample(directed)}`,
      '',
      '| metric | baseline | directed |',
      '|---|---|---|',
      ...(Object.keys(baseline) as (keyof WorldSample)[]).map(
        (k) => `| ${k} | ${typeof baseline[k] === 'number' ? (baseline[k] as number).toFixed(4) : baseline[k]} | ${typeof directed[k] === 'number' ? (directed[k] as number).toFixed(4) : directed[k]} |`,
      ),
      '',
      `<sub>${deltas.join('; ')}</sub>`,
    ].join('\n'),
  );
  console.log(`aiRun world: wrote ${jsonPath}`);
}

// --- phase ------------------------------------------------------------------

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

// --- loop -------------------------------------------------------------------

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

async function cmdLoop(args: Args): Promise<void> {
  const llm = makeLlm(args);
  const scale = (str(args, 'scale', 'quick') === 'full' ? 'full' : 'quick') as 'quick' | 'full';

  const evaluate = (p: ExperimentProposal) => {
    const model = findModel(p.model);
    if (!model) return { verdict: 'inconclusive' as const, detail: `no benchmark model matches "${p.model}"` };
    try {
      const r = runBenchmark(model, { scale, determinismCheck: false, params: p.params });
      const failed = r.checks.filter((c) => c.gate && !c.pass).map((c) => c.key);
      return {
        verdict: (r.verdict === 'PASS' ? 'supported' : 'refuted') as 'supported' | 'refuted',
        detail: `model ${r.id} ${r.verdict} (fidelity ${r.fidelity.toFixed(2)})${failed.length ? `; failed gates: ${failed.join(', ')}` : ''}`,
      };
    } catch (err) {
      return { verdict: 'inconclusive' as const, detail: `evaluation error: ${(err as Error).message}` };
    }
  };

  const { proposals, records, proposeResult } = await runResearchLoop(
    llm,
    scorecardContext(scale),
    evaluate,
    chatOpts(args),
  );

  const supported = records.filter((r) => r.verdict === 'supported').length;
  const payload = {
    generatedAt: new Date().toISOString(),
    provider: llm.provider,
    model: proposeResult.model,
    cached: proposeResult.cached,
    scale,
    proposals,
    records,
    summary: { proposed: proposals.length, supported, refuted: records.filter((r) => r.verdict === 'refuted').length, inconclusive: records.filter((r) => r.verdict === 'inconclusive').length },
  };

  const { jsonPath } = writeOut(
    'ai-loop',
    payload,
    [
      '# AI Research Agent Loop',
      `Generated: ${payload.generatedAt}`,
      `Provider: ${llm.provider} (${proposeResult.model})${proposeResult.cached ? ' [cached]' : ''}, evaluation scale=${scale}`,
      `Proposed: ${payload.summary.proposed} — supported ${supported}, refuted ${payload.summary.refuted}, inconclusive ${payload.summary.inconclusive}`,
      '',
      '| id | model | hypothesis | verdict | detail |',
      '|---|---|---|---|---|',
      ...records.map(
        (r) =>
          `| ${r.proposal.id} | ${r.proposal.model} | ${r.proposal.hypothesis} | ${r.verdict} | ${r.detail.replace(/\|/g, '/')} |`,
      ),
    ].join('\n'),
  );
  console.log(`aiRun loop: wrote ${jsonPath} (${supported}/${proposals.length} supported)`);
}

function chatOpts(args: Args): ChatOptions {
  return { temperature: 0.6, seed: num(args, 'llm-seed', 7) };
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
