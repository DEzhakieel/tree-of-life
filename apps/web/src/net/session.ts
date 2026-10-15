import type { WorldConfig, WorldParams, FractalType, Intervention, UniverseConfig, EnvironmentPreset, WorldTopology } from '@fractal-life/shared';
import type { SimSource } from './source.js';
import { AgentBuffer } from './agentBuffer.js';
import { useStore } from '../store/useStore.js';
import { createWorkerSource } from './workerSource.js';
import { createRemoteSource } from './remoteSource.js';
import { resetModelHistories } from '../model/layers.js';

export const agents = new AgentBuffer();
export const store = useStore;

let source: SimSource | null = null;

/**
 * Monotonic session token. Every startSession/destroySession increments it, and
 * an async start aborts if it has been superseded meanwhile — React 18's
 * StrictMode double-invokes mount effects in dev (mount → cleanup → mount), so
 * without this guard the second call would run on top of the first and, in
 * remote mode, POST two worlds to the server.
 */
let sessionEpoch = 0;

export function getSource(): SimSource | null {
  return source;
}

/** Build a local world config directly on the client (engine runs in a worker). */
export function buildLocalWorld(opts: {
  seed: string;
  fractalType: FractalType;
  params: WorldParams;
  cellBio?: boolean;
  biophysics?: boolean;
  omics?: boolean;
  omicsStochastic?: boolean;
  combinatorial?: boolean;
  recombination?: boolean;
  universe?: UniverseConfig;
  environment?: EnvironmentPreset;
  topology?: WorldTopology;
  signalDeposit?: number;
  memeCopyRate?: number;
  discovery?: boolean;
  reproduction?: boolean;
  sensing?: boolean;
}): WorldConfig {
  const world: WorldConfig = {
    id: `local-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
    seed: opts.seed.length > 0 ? opts.seed : Math.random().toString(36).slice(2) + Date.now().toString(36),
    fractalType: opts.fractalType,
    params: { ...opts.params },
    createdAt: Date.now(),
    currentTick: 0,
  };
  if (opts.cellBio) world.cellBio = true;
  if (opts.biophysics) world.biophysics = true;
  if (opts.omics) world.omics = true;
  if (opts.omicsStochastic) world.omicsStochastic = true;
  if (opts.combinatorial) world.combinatorial = true;
  if (opts.recombination) world.recombination = true;
  if (opts.universe) world.universe = opts.universe;
  if (opts.environment) world.environment = opts.environment;
  if (opts.topology) world.topology = opts.topology;
  if (opts.signalDeposit !== undefined) world.signalDeposit = opts.signalDeposit;
  if (opts.memeCopyRate !== undefined) world.memeCopyRate = opts.memeCopyRate;
  if (opts.discovery) world.discovery = true;
  if (opts.reproduction !== undefined) world.reproduction = opts.reproduction;
  if (opts.sensing !== undefined) world.sensing = opts.sensing;
  return world;
}

/** Ask the server to create a world and return its authoritative config. */
export async function createRemoteWorld(opts: {
  seed?: string;
  fractalType?: FractalType;
  params?: Partial<WorldParams>;
  cellBio?: boolean;
  biophysics?: boolean;
  omics?: boolean;
  omicsStochastic?: boolean;
  combinatorial?: boolean;
  recombination?: boolean;
  universe?: UniverseConfig;
  environment?: EnvironmentPreset;
  topology?: WorldTopology;
  signalDeposit?: number;
  memeCopyRate?: number;
  discovery?: boolean;
  reproduction?: boolean;
  sensing?: boolean;
}): Promise<WorldConfig> {
  const res = await fetch('/api/worlds', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(opts),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `server returned ${res.status}`);
  }
  return (await res.json()) as WorldConfig;
}

/** Start (or restart) the active simulation source. */
export async function startSession(opts: {
  mode: 'local' | 'remote';
  world?: WorldConfig;
  create?: { seed: string; fractalType: FractalType; params: WorldParams; cellBio?: boolean; biophysics?: boolean; omics?: boolean; omicsStochastic?: boolean; combinatorial?: boolean; recombination?: boolean; universe?: UniverseConfig; environment?: EnvironmentPreset; topology?: WorldTopology; signalDeposit?: number; memeCopyRate?: number; discovery?: boolean; reproduction?: boolean; sensing?: boolean };
}): Promise<WorldConfig> {
  const epoch = ++sessionEpoch;
  source?.destroy();
  source = null;
  useStore.getState().setMode(opts.mode);

  const sink = { store, agents };

  if (opts.mode === 'remote') {
    const world = opts.world ?? (opts.create ? await createRemoteWorld(opts.create) : await createRemoteWorld({}));
    // A newer session superseded us while the POST was in flight: do not start
    // a source (and do not leave a half-built one behind).
    if (epoch !== sessionEpoch) return world;
    source = createRemoteSource(sink);
    source.start(world);
    resetModelHistories();
    return world;
  }

  const world = opts.world ?? buildLocalWorld(opts.create ?? { seed: '', fractalType: 'mandelbrot', params: useStore.getState().formParams });
  if (epoch !== sessionEpoch) return world;
  source = createWorkerSource(sink);
  source.start(world);
  resetModelHistories();
  return world;
}

export function intervene(iv: Omit<Intervention, 'sequence'>): void {
  source?.intervene(iv);
}

export function control(cmd: 'play' | 'pause' | 'step'): void {
  source?.control(cmd);
}

export function setTickRate(tps: number): void {
  source?.setTickRate(tps);
}

/** Run the tick loop unpaced, so the simulation runs at CPU speed instead of
 *  `tps`. Only honoured by local (worker) sources. */
export function setTurbo(on: boolean): void {
  source?.setTurbo?.(on);
}

/** Render cadence, independent of sim rate. `frameEvery: 0` stops the render
 *  stream entirely while the simulation keeps advancing. */
export function setRenderCadence(frameEvery: number, statsEvery?: number): void {
  source?.setRenderCadence?.(frameEvery, statsEvery);
}

export function requestSnapshot(tick?: number): void {
  source?.requestSnapshot(tick);
}

export function requestLineage(): void {
  source?.requestLineage();
}

export function requestAgentSummaries(): void {
  source?.requestAgentSummaries();
}

export function destroySession(): void {
  sessionEpoch++;
  source?.destroy();
  source = null;
  resetModelHistories();
}
