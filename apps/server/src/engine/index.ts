import type { WorldConfig, SimStats, WorldStatus, Intervention, AgentSummary, LineageNode } from '@fractal-life/shared';
import { WasmSimEngine, type TickResult, type BrainConfigLike, type WorldStochLike } from './wasmEngine.js';

export { WasmSimEngine } from './wasmEngine.js';
export type { TickResult, BrainConfigLike, WorldStochLike } from './wasmEngine.js';

export interface EngineLike {
  readonly config: WorldConfig;
  currentTick: number;
  tick(): TickResult;
  stats(): SimStats;
  worldStatus(paused: boolean): WorldStatus;
  applyIntervention(iv: Intervention): void;
  computeStateHash(): number;
  encodeSnapshotMessage(): Uint8Array;
  encodeStatsMessage(): Uint8Array;
  encodeSetMapMessage(): Uint8Array;
  agentSummaries(): AgentSummary[];
  getInterventionLog(): Array<{ tick: number; intervention: Intervention }>;
  buildLineage(): LineageNode[];
  setBrainConfig?(cfg: BrainConfigLike): void;
  setWorldStochastics?(cfg: Partial<WorldStochLike> | null): void;
  brainStats?(): { enabled: boolean; meanPlasticity: number; meanSurprise: number; plasticAgents: number };
}

export async function createEngine(
  config: WorldConfig,
  groundingJson?: string,
  brainCfg?: BrainConfigLike,
  worldStochCfg?: Partial<WorldStochLike> | null,
): Promise<EngineLike> {
  try {
    const engine = new WasmSimEngine(config);
    if (groundingJson) engine.setGrounding(groundingJson);
    if (brainCfg) engine.setBrainConfig(brainCfg);
    if (worldStochCfg) engine.setWorldStochastics(worldStochCfg);
    return engine;
  } catch {
    const { Engine } = await import('@fractal-life/simulation');
    const world =
      groundingJson === undefined
        ? config
        : { ...config, grounding: JSON.parse(groundingJson) as WorldConfig['grounding'] };
    const engine = new Engine(world);
    if (brainCfg) engine.setBrainConfig({ ...brainCfg, enabled: brainCfg.enabled ?? true });
    if (worldStochCfg) engine.setWorldStochastics(worldStochCfg);
    return engine;
  }
}

/** Replay a world to a target tick using the same engine type as createEngine.
 *  Returns an EngineLike at the target tick (used by handleSnapshot). Grounding
 *  is re-applied so replayed frames reproduce the grounded headworld exactly. */
export async function replayEngine(
  config: WorldConfig,
  log: Array<{ tick: number; intervention: Intervention }>,
  targetTick: number,
  groundingJson?: string,
): Promise<EngineLike> {
  try {
    return WasmSimEngine.replay(config, log, targetTick, groundingJson);
  } catch {
    const { Engine } = await import('@fractal-life/simulation');
    const world =
      groundingJson === undefined
        ? config
        : { ...config, grounding: JSON.parse(groundingJson) as WorldConfig['grounding'] };
    return Engine.replay(world, log, targetTick);
  }
}
