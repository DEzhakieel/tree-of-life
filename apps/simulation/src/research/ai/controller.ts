import { Engine } from '../../engine.js';
import type { WorldConfig } from '@fractal-life/shared';
import { WORLD_KNOBS } from './knobs.js';
import { directWorld, type WorldDirective } from './worldAI.js';
import { applyWorldOverrides, fmtSample, pickSample, runWorld, type WorldSample } from './world.js';
import type { ChatOptions, ChatResult, Llm } from './types.js';

/**
 * One control step: a directive issued from the previous observation, the
 * overrides that were actually actuated, and the measured world state at the
 * end of the window that followed.
 */
export interface ControlWindow {
  window: number;
  /** what was already in force when this window started */
  inForce: Record<string, number>;
  /** what the world mind asked for, given the previous observation */
  directive: WorldDirective;
  /** overrides actually written into the running engine (advisory ones dropped) */
  applied: Record<string, number>;
  /** state measured at the END of this window */
  sample: WorldSample;
  result: ChatResult;
}

export interface ControlRun {
  objective: string;
  windows: number;
  windowTicks: number;
  warmupTicks: number;
  /** unsteered run over the identical tick budget and seed */
  control: WorldSample;
  trajectory: ControlWindow[];
  /** final observation of the steered run */
  final: WorldSample;
}

export interface ControlOptions {
  objective: string;
  /** number of steered windows (default 3) */
  windows?: number;
  /** ticks per steered window (default 200) */
  windowTicks?: number;
  /** unsteered ticks before the first observation (default 200) */
  warmupTicks?: number;
  chat?: ChatOptions;
}

/**
 * Iterative world controller.
 *
 * One engine runs the whole experiment — the per-agent core is untouched, the
 * world mind only writes population-level `WorldParams` between windows, so the
 * loop is genuinely closed: every directive is issued from a real observation
 * and followed by a window whose outcome can be attributed to it. An unsteered
 * control run over the same seed and tick budget gives the comparison baseline.
 */
export async function runWorldControl(
  llm: Llm,
  world: WorldConfig,
  options: ControlOptions,
): Promise<ControlRun> {
  const objective = options.objective;
  const windows = Math.max(1, options.windows ?? 3);
  const windowTicks = Math.max(10, options.windowTicks ?? 200);
  const warmupTicks = Math.max(0, options.warmupTicks ?? 200);

  // unsteered control: same seed, same total tick budget
  const control = runWorld(world, warmupTicks + windows * windowTicks);

  const engine = new Engine(world);
  for (let i = 0; i < warmupTicks; i++) engine.tick();
  let observation = pickSample(engine);

  const trajectory: ControlWindow[] = [];
  let inForce: Record<string, number> = {};

  for (let w = 1; w <= windows; w++) {
    const context = buildContext({
      objective, w, windows, windowTicks, warmupTicks, observation, inForce, trajectory,
    });
    const { directive, result } = await directWorld(llm, context, options.chat);
    const applied = applyWorldOverrides(engine, directive.overrides);
    inForce = { ...inForce, ...applied };
    for (let i = 0; i < windowTicks; i++) engine.tick();
    observation = pickSample(engine);
    trajectory.push({ window: w, inForce, directive, applied, sample: observation, result });
  }

  return {
    objective,
    windows,
    windowTicks,
    warmupTicks,
    control,
    trajectory,
    final: trajectory[trajectory.length - 1]!.sample,
  };
}

interface ContextInput {
  objective: string;
  w: number;
  windows: number;
  windowTicks: number;
  warmupTicks: number;
  observation: WorldSample;
  inForce: Record<string, number>;
  trajectory: ControlWindow[];
}

function buildContext(i: ContextInput): string {
  const runtime = WORLD_KNOBS.filter((k) => !k.constructionOnly)
    .map((k) => `${k.key} in [${k.min}, ${k.max}]`)
    .join(', ');
  const advisory = WORLD_KNOBS.filter((k) => k.constructionOnly).map((k) => k.key).join(', ');

  const history = i.trajectory.length
    ? i.trajectory
        .map(
          (t) =>
            `  window ${t.window}: applied {${fmtOverrides(t.applied)}} -> ${fmtSummary(t.sample)} (objective: ${t.directive.objective})`,
        )
        .join('\n')
    : '  (none yet)';

  return [
    `objective: ${i.objective}`,
    `control run: window ${i.w} of ${i.windows}; each window is ${i.windowTicks} ticks after a ${i.warmupTicks}-tick unsteered warmup`,
    `currently in force: ${Object.keys(i.inForce).length ? `{${fmtOverrides(i.inForce)}}` : 'nothing (baseline)'}`,
    `construction-only, advisory (not actuated mid-run): ${advisory}`,
    `steerable knobs: ${runtime}`,
    `observation at tick ${i.observation.tick}: ${fmtSummary(i.observation)}`,
    '',
    'trajectory so far (what you applied and what happened):',
    history,
  ].join('\n');
}

function fmtOverrides(o: Record<string, number>): string {
  const entries = Object.entries(o);
  return entries.length ? entries.map(([k, v]) => `${k}=${v}`).join(', ') : '';
}

function fmtSummary(s: WorldSample): string {
  return (
    `pop=${s.population} alive=${s.aliveCount} species=${s.speciesCount} ` +
    `energy=${s.avgEnergy.toFixed(1)} effDim=${s.traitEffectiveDim.toFixed(1)}`
  );
}
