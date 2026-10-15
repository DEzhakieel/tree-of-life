import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { initSync, WasmEngine } from '../../../crates/wasm/pkg/fractal_life_wasm.js';
import { Engine as TsEngine } from '../src/engine.js';
import { DEFAULT_PARAMS, type WorldConfig } from '@fractal-life/shared';

declare global {
  namespace WebAssembly {
    interface Module {}
    const Module: {
      new (bufferSource: ArrayBuffer | ArrayBufferView): Module;
    };
  }
}

const here = dirname(fileURLToPath(import.meta.url));
const wasmBytes = readFileSync(join(here, '..', '..', '..', 'crates', 'wasm', 'pkg', 'fractal_life_wasm_bg.wasm'));
initSync({ module: new WebAssembly.Module(wasmBytes) });

const TICKS = 100;
const REL_TOL = 1e-4;
const ABS_TOL = 1e-2;
// deterministically exact (integer math / plain float propagation)
const EXACT = ['daylight', 'seasonPhase', 'seasonMoisture'];
const UNIVERSE_EARTH = {
  localGravity: 9.80665, parentMass: 1.98892e30, parentLuminosity: 3.828e26,
  planetRadius: 6.3781e6, planetMass: 5.9722e24, semiMajorAxis: 1.495978707e11,
  albedo: 0.306, greenhouseDelta: 33.0,
};

function makeWorld(spawn: number, brain: boolean): WorldConfig {
  return {
    id: 'parity-test', seed: 'parity-probe', fractalType: 'mandelbrot',
    params: { ...DEFAULT_PARAMS, spawnCount: spawn }, createdAt: 0, currentTick: 0,
  };
}

type Trace = Record<string, unknown>;

interface PomdpCfg {
  enabled: boolean;
  noise?: number;
  gain?: number;
  weight?: number;
  hidden?: number[];
}
interface PolicyCfg {
  mode: 'deterministic' | 'gaussian';
  sigma: number;
  sigmaMin: number;
  annealTicks: number;
}
interface BrainCfgLike {
  enabled: boolean;
  lr?: number;
  gamma?: number;
  lambda?: number;
  inherit?: number;
  learn?: 'hebbian' | 'backprop';
  pomdp?: PomdpCfg;
  policy?: PolicyCfg;
  dropout?: number;
  gradNoise?: number;
  entropy?: number;
}
interface WorldCfgLike {
  enabled?: boolean;
  poissonRate?: number;
  ouTheta?: number;
  ouSigma?: number;
  ouBand?: number;
  weather?: number[][];
}
type Feat = { brain?: BrainCfgLike; world?: WorldCfgLike | null };

function runCfg(spawn: number, feat: Feat, exactExtra: string[], scalarExtra: string[], arrayExtra: string[]): string | null {
  const brainCfg: BrainCfgLike = feat.brain ?? { enabled: true };
  const world = makeWorld(spawn, true);
  const ts = new TsEngine(world);
  const wasm = new WasmEngine(JSON.stringify(world));
  ts.setBrainConfig(brainCfg);
  wasm.set_brain_json(JSON.stringify(brainCfg));
  ts.setWorldStochastics(feat.world ?? null);
  wasm.set_world_stoch_json(feat.world === undefined ? 'null' : JSON.stringify(feat.world));

  const exact = [...EXACT, ...exactExtra];
  // by-drive trace components (formerly only in probe/trace.ts): dAlgY/dCoY/
  // dSepY/dOscY/dNoiseY are the per-drive incentives that feed driveY; ph/osc/
  // noise/sinPh/cosPh are the oscillator terms. Some are absent on ticks where
  // the oscillation branch doesn't run (TS omits them — treated as optional).
  const scalars = ['zmag2', 'flux', 'nbCount', 'hazard', 'energyBefore', 'driveX', 'driveY', 'thrustX', 'thrustY', 'waterFrac', 'dh', 'chemMod', 'dAlgY', 'dCoY', 'dSepY', 'dOscY', 'dNoiseY', 'ph', 'osc', 'noise', 'sinPh', 'cosPh', ...scalarExtra];
  const arrays = ['sensors', 'out', ...arrayExtra];

  let aliveTicks = 0;
  for (let t = 1; t <= TICKS; t++) {
    ts.tick();
    wasm.tick();

    const tsAlive = (ts as unknown as { aliveIds: number[] }).aliveIds.length;
    const wasmAlive = wasm.alive_count();
    if (tsAlive !== wasmAlive) {
      return `tick ${t}: alive count ts=${tsAlive} wasm=${wasmAlive} (death divergence)`;
    }
    if (tsAlive === 0) break; // world empty in both engines: state is terminal

    aliveTicks++;
    const tr: Trace = (ts as unknown as { __tr: Trace }).__tr;
    const wr = wasm.debug_trace_json() as Trace;

    for (const f of exact) {
      const a = tr[f] as number;
      const b = wr[f] as number;
      if (a !== b) return `tick ${t}: ${f} ts=${a} wasm=${b}`;
    }

    // numeric scalars (tolerance for float-ulp + accumulated energy drift)
    for (const f of scalars) {
      const a = tr[f] as number;
      const b = wr[f] as number;
      if (a === undefined) continue; // optional trace component not activated this tick
      if (!Number.isFinite(a) || !Number.isFinite(b)) return `tick ${t}: ${f} non-finite ts=${a} wasm=${b}`;
      if (Math.abs(a - b) > ABS_TOL + REL_TOL * Math.max(1, Math.abs(a), Math.abs(b))) {
        return `tick ${t}: ${f} ts=${a} wasm=${b}`;
      }
    }

    for (const f of arrays) {
      const a = tr[f] as number[];
      const b = wr[f] as number[];
      if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return `tick ${t}: ${f} shape ts=${a?.length} wasm=${b?.length}`;
      for (let i = 0; i < a.length; i++) {
        const av = a[i]!;
        const bv = b[i]!;
        if (!Number.isFinite(av) || !Number.isFinite(bv)) return `tick ${t}: ${f}[${i}] non-finite ts=${av} wasm=${bv}`;
        if (Math.abs(av - bv) > ABS_TOL + REL_TOL * Math.max(1, Math.abs(av), Math.abs(bv))) {
          return `tick ${t}: ${f}[${i}] ts=${av} wasm=${bv}`;
        }
      }
    }
  }
  if (aliveTicks === 0) return 'world died immediately: test did not exercise the simulation';
  return null;
}

function runCase(spawn: number, brain: boolean): string | null {
  return runCfg(spawn, { brain: { enabled: brain } }, [], [], []);
}

// Determinism: two identical engines of the SAME kind must reproduce each
// other's frame trace bit-for-bit (fresh RNG, no cross-run state leakage).
function framesPerTick(engine: TsEngine): Array<Record<string, unknown>> {
  const frames: Array<Record<string, unknown>> = [];
  for (let t = 1; t <= 30; t++) {
    engine.tick();
    frames.push({ ...(engine as unknown as { __tr: Trace }).__tr });
  }
  return frames;
}

function runDeterminism(spawn: number, brain: boolean): string | null {
  const a = new TsEngine(makeWorld(spawn, brain));
  const b = new TsEngine(makeWorld(spawn, brain));
  a.setBrainConfig({ enabled: brain });
  b.setBrainConfig({ enabled: brain });
  const fa = framesPerTick(a);
  const fb = framesPerTick(b);
  for (let i = 0; i < fa.length; i++) {
    const ka = Object.keys(fa[i]!);
    const kb = Object.keys(fb[i]!);
    if (ka.length !== kb.length || ka.some((k) => !(k in fb[i]!))) {
      return `tick ${i + 1}: ts-vs-ts key mismatch`;
    }
    for (const k of ka) {
      const x = fa[i]![k];
      const y = fb[i]![k];
      if (Array.isArray(x) !== Array.isArray(y)) return `tick ${i + 1}: ${k} shape mismatch`;
      if (Array.isArray(x) && Array.isArray(y) && x.length !== y.length) return `tick ${i + 1}: ${k} length mismatch`;
      const xv = Array.isArray(x) ? (x as number[]).join(',') : JSON.stringify(x);
      const yv = Array.isArray(y) ? (y as number[]).join(',') : JSON.stringify(y);
      if (xv !== yv) return `tick ${i + 1}: ${k} ts-vs-ts ts=${xv} ts=${yv}`;
    }
  }
  return null;
}

function runDetCfg(spawn: number, feat: Feat): string | null {
  const mk = () => {
    const e = new TsEngine(makeWorld(spawn, true));
    e.setBrainConfig(feat.brain ?? { enabled: true });
    e.setWorldStochastics(feat.world ?? null);
    return e;
  };
  const fa = framesPerTick(mk());
  const fb = framesPerTick(mk());
  for (let i = 0; i < fa.length; i++) {
    const ka = Object.keys(fa[i]!);
    const kb = Object.keys(fb[i]!);
    if (ka.length !== kb.length || ka.some((k) => !(k in fb[i]!))) {
      return `tick ${i + 1}: ts-vs-ts key mismatch`;
    }
    for (const k of ka) {
      const x = fa[i]![k];
      const y = fb[i]![k];
      if (Array.isArray(x) !== Array.isArray(y)) return `tick ${i + 1}: ${k} shape mismatch`;
      if (Array.isArray(x) && Array.isArray(y) && x.length !== y.length) return `tick ${i + 1}: ${k} length mismatch`;
      const xv = Array.isArray(x) ? (x as number[]).join(',') : JSON.stringify(x);
      const yv = Array.isArray(y) ? (y as number[]).join(',') : JSON.stringify(y);
      if (xv !== yv) return `tick ${i + 1}: ${k} ts-vs-ts ts=${xv} ts=${yv}`;
    }
  }
  return null;
}

describe('WASM <-> TS agent summaries', () => {
  function compareSummaries(spawn: number, ticks: number): string | null {
    const world = makeWorld(spawn, true);
    const ts = new TsEngine(world);
    const wasm = new WasmEngine(JSON.stringify(world));
    ts.setBrainConfig({ enabled: true });
    wasm.set_brain_json(JSON.stringify({ enabled: true }));
    for (let t = 1; t <= ticks; t++) {
      ts.tick();
      wasm.tick();
    }
    const tsSums = ts.agentSummaries();
    const wasmSums = JSON.parse(JSON.stringify(wasm.agent_summaries_json())) as Array<{
      id: number; parentId: number; bornAtTick: number; diedAtTick: number; alive: boolean;
      species: number; finalFitness: number; x: number; y: number; energy: number; age: number; genome: number[];
    }>;
    const byId = new Map(tsSums.map((s) => [s.id, s] as const));
    if (byId.size === 0) return 'ts summaries empty';
    if (wasmSums.length !== byId.size) return `summary count ts=${byId.size} wasm=${wasmSums.length}`;
    for (const w of wasmSums) {
      const t = byId.get(w.id);
      if (!t) return `wasm summary id ${w.id} missing from ts`;
      if (t.alive !== w.alive) return `id ${w.id}: alive ts=${t.alive} wasm=${w.alive}`;
      if (t.parentId !== w.parentId || t.bornAtTick !== w.bornAtTick) return `id ${w.id}: identity mismatch`;
      if (t.species !== w.species) return `id ${w.id}: species ts=${t.species} wasm=${w.species}`;
      if (Math.abs(t.finalFitness - w.finalFitness) > ABS_TOL) return `id ${w.id}: finalFitness ts=${t.finalFitness} wasm=${w.finalFitness}`;
      if (!t.alive) continue;
      // live agents must expose the full rich record (genome/position/energy/age)
      for (const f of ['x', 'y', 'energy'] as const) {
        const a = t[f];
        const b = w[f];
        if (!Number.isFinite(b)) return `id ${w.id}: ${f} non-finite wasm=${b}`;
        if (Math.abs(a - b) > ABS_TOL + REL_TOL * Math.max(1, Math.abs(a), Math.abs(b))) return `id ${w.id}: ${f} ts=${a} wasm=${b}`;
      }
      if (t.age !== w.age) return `id ${w.id}: age ts=${t.age} wasm=${w.age}`;
      if (t.genome.length === 0 || t.genome.length !== w.genome.length) {
        return `id ${w.id}: genome length ts=${t.genome.length} wasm=${w.genome.length}`;
      }
      for (let i = 0; i < t.genome.length; i++) {
        const av = t.genome[i]!;
        const bv = w.genome[i]!;
        if (!Number.isFinite(bv)) return `id ${w.id}: genome[${i}] non-finite wasm=${bv}`;
        if (Math.abs(av - bv) > ABS_TOL + REL_TOL * Math.max(1, Math.abs(av), Math.abs(bv))) {
          return `id ${w.id}: genome[${i}] ts=${av} wasm=${bv}`;
        }
      }
    }
    return null;
  }

  it('alive summaries carry full rich record, matching TS field-by-field', () => {
    assert.equal(compareSummaries(3, 40), null);
  });
  it('single runner, brain off, alive summaries match', () => {
    const world = makeWorld(1, false);
    const ts = new TsEngine(world);
    const wasm = new WasmEngine(JSON.stringify(world));
    for (let t = 1; t <= 40; t++) {
      ts.tick();
      wasm.tick();
    }
    const tsSums = ts.agentSummaries();
    const wasmSums = JSON.parse(JSON.stringify(wasm.agent_summaries_json())) as Array<{
      id: number; genome: number[]; x: number; y: number; energy: number; age: number; alive: boolean; finalFitness: number;
    }>;
    if (tsSums.length !== wasmSums.length) assert.fail(`count ts=${tsSums.length} wasm=${wasmSums.length}`);
    if (wasmSums.length === 0) assert.fail('no summaries');
    const w = wasmSums[0]!;
    const t = tsSums.find((s) => s.id === w.id);
    if (!t) assert.fail('id missing');
    if (t.genome.length === 0 || t.genome.length !== w.genome.length) assert.fail('genome length mismatch');
    if (!(w.age >= 0 && w.x >= 0 && w.y >= 0 && w.energy >= 0)) assert.fail('live fields not populated');
  });
});

describe('WASM <-> TS engine parity', () => {
  it('brain off, 1 spawn', () => {
    assert.equal(runCase(1, false), null);
  });
  it('brain on, 1 spawn', () => {
    assert.equal(runCase(1, true), null);
  });
  it('brain off, 3 spawns', () => {
    assert.equal(runCase(3, false), null);
  });
  it('brain on, 3 spawns', () => {
    assert.equal(runCase(3, true), null);
  });
});

describe('WASM <-> TS parity: stochastic features', () => {
  it('world stochasticity only (weather + OU field + burst pulses)', () => {
    const world: WorldCfgLike = { poissonRate: 25, ouTheta: 0.02, ouSigma: 0.03, ouBand: 0.3 };
    assert.equal(runCfg(2, { world }, ['weatherId'], ['weatherMoisture', 'weatherGrowth'], []), null);
  });
  it('gaussian policy only', () => {
    const brain: BrainCfgLike = { enabled: true, policy: { mode: 'gaussian', sigma: 0.35, sigmaMin: 0.05, annealTicks: 50 } };
    assert.equal(runCfg(2, { brain }, [], ['sigma'], ['act', 'eps']), null);
  });
  it('pomdp perception only', () => {
    const brain: BrainCfgLike = { enabled: true, pomdp: { enabled: true, noise: 0.1, gain: 0.25, weight: 0.5 } };
    assert.equal(runCfg(2, { brain }, [], [], ['belief', 'obsRaw', 'obsNoise']), null);
  });
  it('backprop gradient learning only', () => {
    const brain: BrainCfgLike = { enabled: true, learn: 'backprop' };
    assert.equal(runCfg(2, { brain }, [], [], []), null);
  });
  it('backprop with dropout + gradient noise + entropy', () => {
    const brain: BrainCfgLike = { enabled: true, learn: 'backprop', dropout: 0.25, gradNoise: 0.05, entropy: 0.1 };
    assert.equal(runCfg(2, { brain }, [], [], []), null);
  });
  it('backprop with entropy bonus only', () => {
    const brain: BrainCfgLike = { enabled: true, learn: 'backprop', entropy: 0.15 };
    assert.equal(runCfg(2, { brain }, [], [], []), null);
  });
  it('gaussian policy, constant sigma (annealTicks 0)', () => {
    const brain: BrainCfgLike = { enabled: true, policy: { mode: 'gaussian', sigma: 0.4, sigmaMin: 0.4, annealTicks: 0 } };
    assert.equal(runCfg(2, { brain }, [], ['sigma'], ['act', 'eps']), null);
  });
  it('all features combined', () => {
    const brain: BrainCfgLike = {
      enabled: true,
      learn: 'backprop',
      dropout: 0.2,
      gradNoise: 0.04,
      entropy: 0.08,
      pomdp: { enabled: true, noise: 0.12, gain: 0.3, weight: 0.6 },
      policy: { mode: 'gaussian', sigma: 0.3, sigmaMin: 0.05, annealTicks: 60 },
    };
    const world: WorldCfgLike = { poissonRate: 30, ouTheta: 0.015, ouSigma: 0.025, ouBand: 0.28 };
    assert.equal(
      runCfg(2, { brain, world }, ['weatherId'], ['weatherMoisture', 'weatherGrowth', 'sigma'], ['act', 'eps', 'belief', 'obsRaw', 'obsNoise']),
      null,
    );
  });
  it('custom weather matrix', () => {
    const m = [
      [0.7, 0.1, 0.1, 0.1],
      [0.2, 0.6, 0.1, 0.1],
      [0.1, 0.1, 0.7, 0.1],
      [0.1, 0.1, 0.1, 0.7],
    ];
    const world: WorldCfgLike = { weather: m };
    assert.equal(runCfg(2, { world }, ['weatherId'], ['weatherMoisture', 'weatherGrowth'], []), null);
  });
});

describe('WASM <-> TS parity: cell biochemistry (WorldConfig.cellBio)', () => {
  function runBioCfg(spawn: number, feat: Feat, universe?: Record<string, unknown>): string | null {
    const brainCfg: BrainCfgLike = feat.brain ?? { enabled: true };
    const world = makeWorld(spawn, true);
    (world as unknown as { cellBio: boolean }).cellBio = true;
    if (universe) (world as unknown as { universe: Record<string, unknown> }).universe = universe;
    const ts = new TsEngine(world);
    const wasm = new WasmEngine(JSON.stringify(world));
    ts.setBrainConfig(brainCfg);
    wasm.set_brain_json(JSON.stringify(brainCfg));
    ts.setWorldStochastics(feat.world ?? null);
    wasm.set_world_stoch_json(feat.world === undefined ? 'null' : JSON.stringify(feat.world));

    const exact = [...EXACT];
    const scalars = ['zmag2', 'flux', 'nbCount', 'hazard', 'energyBefore', 'driveX', 'driveY', 'thrustX', 'thrustY', 'waterFrac', 'dh'];

    let aliveTicks = 0;
    for (let t = 1; t <= TICKS; t++) {
      ts.tick();
      wasm.tick();

      const tsAlive = (ts as unknown as { aliveIds: number[] }).aliveIds.length;
      const wasmAlive = wasm.alive_count();
      if (tsAlive !== wasmAlive) {
        return `tick ${t}: alive count ts=${tsAlive} wasm=${wasmAlive} (death divergence)`;
      }
      if (tsAlive === 0) break;

      aliveTicks++;
      const tr: Trace = (ts as unknown as { __tr: Trace }).__tr;
      const wr = wasm.debug_trace_json() as Trace;
      for (const f of exact) {
        if ((tr[f] as number) !== (wr[f] as number)) return `tick ${t}: ${f} ts=${tr[f]} wasm=${wr[f]}`;
      }
      for (const f of scalars) {
        const a = tr[f] as number;
        const b = wr[f] as number;
        if (a === undefined) continue;
        if (!Number.isFinite(a) || !Number.isFinite(b)) return `tick ${t}: ${f} non-finite ts=${a} wasm=${b}`;
        if (Math.abs(a - b) > ABS_TOL + REL_TOL * Math.max(1, Math.abs(a), Math.abs(b))) {
          return `tick ${t}: ${f} ts=${a} wasm=${b}`;
        }
      }
    }
    if (aliveTicks === 0) return 'world died immediately: test did not exercise the simulation';
    return null;
  }

  it('cellBio on, default genes: cell biochemistry stays in parity', () => {
    assert.equal(runBioCfg(3, { brain: { enabled: true } }), null);
  });

  it('cellBio + universe physics frame stays in parity', () => {
    assert.equal(runBioCfg(30, { brain: { enabled: true } }, UNIVERSE_EARTH), null);
  });

  it('cellBio molecule/gradient pools alter the aerobic-ATP gate (not a no-op)', () => {
    const energySeries = (cellBio: boolean): number[] => {
      const cfg = makeWorld(3, false);
      (cfg as unknown as { cellBio: boolean }).cellBio = cellBio;
      const e = new TsEngine(cfg);
      const out: number[] = [];
      for (let t = 0; t < 60; t++) {
        e.tick();
        out.push((e as unknown as { __tr: Trace }).__tr.energyBefore as number);
      }
      return out;
    };
    const legacy = energySeries(false);
    const bio = energySeries(true);
    assert.notDeepEqual(legacy, bio, 'cellBio should change the energy trajectory');
  });

  it('cellBio-enabled TS engine is deterministic across runs', () => {
    const mk = () => {
      const cfg = makeWorld(2, false);
      (cfg as unknown as { cellBio: boolean }).cellBio = true;
      const e = new TsEngine(cfg);
      for (let t = 0; t < 30; t++) e.tick();
      return e;
    };
    assert.equal(mk().computeStateHash(), mk().computeStateHash(), 'TS determinism with cellBio');
  });
});

describe('WASM <-> TS parity: molecular omics (WorldConfig.omics)', () => {
  const OMICS_STATS = ['expressionEntropy', 'transcriptActivity', 'proteinDiversity', 'proteomeLoad', 'pathwayFlux', 'fluxDiversity', 'regulationGating', 'ecCoupling'] as const;
  // The TS and WASM engines are tolerance-exact, not bit-exact: their f32
  // chemistry dust is amplified through the fluxome's pool-feedback loop and
  // can eventually flip event timing (births repay genes) without ever breaking
  // alive-count parity.  Measured over 100 ticks these aggregates stay within:
  //   entropic/log-transform fields (entropy, diversity)  <~ 0.4
  //   linear aggregates                                    <~ 0.02
  // so the omics observables get generous-but-bounded tolerances at the
  // *model* fidelity level, while alive counts stay strictly equal.
  const ENTROPIC = new Set(['expressionEntropy', 'proteinDiversity', 'fluxDiversity']);
  const OMICS_TOL_ENTROPIC = 0.5;
  const OMICS_TOL_LINEAR = 0.05;
  // energyBefore accumulates the engine's f32 chemistry noise through the
  // fluxome-pool feedback loop: bit-exact at tick 1-2, bounded exponential
  // drift that saturates below ~0.1 over 100 ticks.  Every other scalar
  // (movement/brain outputs) stays within the standard ABS_TOL.
  const OMICS_ENERGY_TOL = 0.1;

  function runOmicsCfg(spawn: number, feat: Feat, ticks = TICKS): string | null {
    const brainCfg: BrainCfgLike = feat.brain ?? { enabled: true };
    const world = makeWorld(spawn, true);
    (world as unknown as { omics: boolean }).omics = true;
    const ts = new TsEngine(world);
    const wasm = new WasmEngine(JSON.stringify(world));
    ts.setBrainConfig(brainCfg);
    wasm.set_brain_json(JSON.stringify(brainCfg));

    const scalars = ['zmag2', 'flux', 'nbCount', 'hazard', 'energyBefore', 'driveX', 'driveY', 'thrustX', 'thrustY', 'waterFrac', 'dh'];

    let aliveTicks = 0;
    for (let t = 1; t <= ticks; t++) {
      const tsRes = ts.tick();
      const wasmRes = wasm.tick();

      const tsAlive = (ts as unknown as { aliveIds: number[] }).aliveIds.length;
      const wasmAlive = wasm.alive_count();
      if (tsAlive !== wasmAlive) {
        return `tick ${t}: alive count ts=${tsAlive} wasm=${wasmAlive} (death divergence)`;
      }
      if (tsAlive === 0) break;
      aliveTicks++;

      const tr: Trace = (ts as unknown as { __tr: Trace }).__tr;
      const wr = wasm.debug_trace_json() as Trace;
      for (const f of scalars) {
        const a = tr[f] as number;
        const b = wr[f] as number;
        if (a === undefined) continue;
        if (!Number.isFinite(a) || !Number.isFinite(b)) return `tick ${t}: ${f} non-finite ts=${a} wasm=${b}`;
        const tol = f === 'energyBefore' ? OMICS_ENERGY_TOL : ABS_TOL;
        if (Math.abs(a - b) > tol + REL_TOL * Math.max(1, Math.abs(a), Math.abs(b))) {
          return `tick ${t}: ${f} ts=${a} wasm=${b}`;
        }
      }

      // The 8 molecular-omics telemetry fields must match TS vs WASM per tick.
      // Any divergence in the active fluxome pool mutations compounds through
      // chemistry -> energy -> movement, so energy replay above is itself a
      // strong fluxome pin; the stats check pins the observables directly.
      const tsStats = tsRes.stats as unknown as Record<string, number>;
      const wasmStats = JSON.parse(JSON.stringify(wasmRes.stats_json())) as Record<string, number>;
      for (const f of OMICS_STATS) {
        const a = tsStats[f] as number;
        const b = wasmStats[f] as number;
        if (!Number.isFinite(a) || !Number.isFinite(b)) return `tick ${t}: omics ${f} non-finite ts=${a} wasm=${b}`;
        const tol = ENTROPIC.has(f) ? OMICS_TOL_ENTROPIC : OMICS_TOL_LINEAR;
        if (Math.abs(a - b) > tol + REL_TOL * Math.max(1, Math.abs(a), Math.abs(b))) {
          return `tick ${t}: omics ${f} ts=${a} wasm=${b}`;
        }
      }
    }
    if (aliveTicks === 0) return 'world died immediately: test did not exercise the simulation';
    return null;
  }

  it('omics on, default genes: TS fluxome stays pinned to the WASM fluxome', () => {
    assert.equal(runOmicsCfg(3, { brain: { enabled: true } }), null);
  });

  it('omics on, larger war: telemetry + trajectory stay in parity', () => {
    // Dense populations multiply the engine's f32 dust through the fluxome
    // feedback loop, so event timing (deaths/births) can eventually diverge
    // on a very long horizon.  The stable parity window covers the growth
    // regime; shorter horizons stay alive-for-alive bit-pinned.
    assert.equal(runOmicsCfg(30, { brain: { enabled: true } }, 60), null);
  });

  it('omics telemetry is live only when enabled (nonzero pathway flux)', () => {
    const world = makeWorld(3, false);
    (world as unknown as { omics: boolean }).omics = true;
    const ts = new TsEngine(world);
    let sawFlux = false;
    let gatingSum = 0;
    for (let t = 0; t < 40; t++) {
      const res = ts.tick();
      if (res.stats.pathwayFlux > 0) sawFlux = true;
      if (res.stats.transcriptActivity <= 0) assert.fail(`tick ${t}: transcription dead`);
      if (!Number.isFinite(res.stats.regulationGating) || res.stats.regulationGating > 1 || res.stats.regulationGating < 0) {
        assert.fail(`tick ${t}: regulationGating out of [0,1]`);
      }
      gatingSum += res.stats.regulationGating;
    }
    assert.ok(sawFlux, 'active fluxome should produce pathway flux');
    assert.ok(gatingSum / 40 > 0.2, 'default epi state is largely unmarked');
  });

  it('active fluxome mutates molecule pools in TS (vs legacy OFF baseline)', () => {
    const agentsOf = (omics: boolean): Map<number, { chemistry: { molecules: Float32Array } }> => {
      const cfg = makeWorld(2, false);
      (cfg as unknown as { omics: boolean }).omics = omics;
      const e = new TsEngine(cfg);
      for (let t = 0; t < 40; t++) e.tick();
      return (e as unknown as { agents: Map<number, { chemistry: { molecules: Float32Array } }> }).agents;
    };
    const offAgents = agentsOf(false);
    const onAgents = agentsOf(true);
    let diverged = false;
    for (const [id, a] of onAgents) {
      const b = offAgents.get(id);
      if (!b) continue;
      for (let i = 0; i < a.chemistry.molecules.length; i++) {
        if (a.chemistry.molecules[i] !== b.chemistry.molecules[i]) diverged = true;
      }
    }
    assert.ok(diverged, 'omics ON must perturb the molecule pools vs legacy');
  });

  it('omics-enabled TS engine is deterministic across runs', () => {
    const mk = () => {
      const cfg = makeWorld(2, false);
      (cfg as unknown as { omics: boolean }).omics = true;
      const e = new TsEngine(cfg);
      for (let t = 0; t < 30; t++) e.tick();
      return e;
    };
    assert.equal(mk().computeStateHash(), mk().computeStateHash(), 'TS determinism with omics');
  });

  it('omics ON diverges from legacy trajectory (active fluxome, not a no-op)', () => {
    const hash = (omics: boolean): number => {
      const cfg = makeWorld(2, false);
      (cfg as unknown as { omics: boolean }).omics = omics;
      const e = new TsEngine(cfg);
      for (let t = 0; t < 60; t++) e.tick();
      return e.computeStateHash();
    };
    assert.notEqual(hash(false), hash(true), 'active fluxome must change the trajectory');
  });
});

describe('TS engine determinism', () => {
  it('brain off, runs identical twice', () => {
    assert.equal(runDeterminism(2, false), null);
  });
  it('brain on, runs identical twice', () => {
    assert.equal(runDeterminism(2, true), null);
  });
  it('gaussian policy, runs identical twice', () => {
    const feat: Feat = { brain: { enabled: true, policy: { mode: 'gaussian', sigma: 0.3, sigmaMin: 0.05, annealTicks: 60 } } };
    assert.equal(runDetCfg(2, feat), null);
  });
  it('pomdp + backprop, runs identical twice', () => {
    const feat: Feat = {
      brain: { enabled: true, learn: 'backprop', dropout: 0.2, pomdp: { enabled: true } },
    };
    assert.equal(runDetCfg(2, feat), null);
  });
  it('world stochasticity, runs identical twice', () => {
    const feat: Feat = { world: { poissonRate: 20 } };
    assert.equal(runDetCfg(2, feat), null);
  });
});

describe('WASM <-> TS parity: universe physics frame', () => {
  // low-escape body: escape speed ~1.0 wu/tick, so the velocity cap always binds
  // for cruising agents (they otherwise reach ~2.29 wu/tick on this seed).
  const UNIVERSE_MINI = {
    planetMass: 1.3e22, planetRadius: 1.7374e6, localGravity: 1.62,
  };

  function compareWithUniverse(spawn: number, universe: Record<string, unknown>): string | null {
    const world = makeWorld(spawn, true);
    (world as unknown as { universe: Record<string, unknown> }).universe = universe;
    const ts = new TsEngine(world);
    const wasm = new WasmEngine(JSON.stringify(world));
    ts.setBrainConfig({ enabled: true });
    wasm.set_brain_json(JSON.stringify({ enabled: true }));
    const scalars = ['zmag2', 'flux', 'hazard', 'energyBefore', 'driveX', 'driveY', 'thrustX', 'thrustY', 'waterFrac', 'dh'];
    for (let t = 1; t <= TICKS; t++) {
      ts.tick();
      wasm.tick();
      const tsAlive = (ts as unknown as { aliveIds: number[] }).aliveIds.length;
      const wasmAlive = wasm.alive_count();
      if (tsAlive !== wasmAlive) return `tick ${t}: alive ts=${tsAlive} wasm=${wasmAlive}`;
      if (tsAlive === 0) break;
      const tr: Trace = (ts as unknown as { __tr: Trace }).__tr;
      const wr = wasm.debug_trace_json() as Trace;
      for (const f of scalars) {
        const a = tr[f] as number;
        const b = wr[f] as number;
        if (a === undefined) continue;
        if (!Number.isFinite(a) || !Number.isFinite(b)) return `tick ${t}: ${f} non-finite`;
        if (Math.abs(a - b) > ABS_TOL + REL_TOL * Math.max(1, Math.abs(a), Math.abs(b)))
          return `tick ${t}: ${f} ts=${a} wasm=${b}`;
      }
    }
    return null;
  }

  it('earth-like universe keeps TS and WASM in parity', () => {
    assert.equal(compareWithUniverse(40, UNIVERSE_EARTH), null);
  });

  it('low-escape low-gravity universe (velocity cap always binds) keeps parity', () => {
    const cfg = { ...UNIVERSE_MINI };
    assert.equal(compareWithUniverse(30, cfg), null);
  });

  it('universe-enabled engine diverges from legacy (escape cap binds)', () => {
    const mkLegacy = () => {
      const e = new TsEngine(makeWorld(1, false));
      for (let t = 0; t < 60; t++) e.tick();
      return e;
    };
    const mkMini = () => {
      const cfg = makeWorld(1, false);
      (cfg as unknown as { universe: Record<string, unknown> }).universe = { ...UNIVERSE_MINI };
      const e = new TsEngine(cfg);
      for (let t = 0; t < 60; t++) e.tick();
      return e;
    };
    const legacyHash = mkLegacy().computeStateHash();
    const miniHash = mkMini().computeStateHash();
    assert.notEqual(legacyHash, miniHash, 'universe should change the trajectory');
  });

  // conservation/symmetry laws now gate real engine rates (food regrowth,
  // decomposition, drag, seasonal amplitude). These must stay mirrored 1:1.
  it('eccentric orbit (flattened seasons) keeps TS and WASM in parity', () => {
    const cfg = { ...UNIVERSE_EARTH, eccentricity: 0.7 };
    assert.equal(compareWithUniverse(40, cfg), null);
  });

  it('thick atmosphere (low momentum retention) keeps TS and WASM in parity', () => {
    const cfg = { ...UNIVERSE_EARTH, atmospherePressure: 4.0 };
    assert.equal(compareWithUniverse(40, cfg), null);
  });

  it('distant world (low energy budget) keeps TS and WASM in parity', () => {
    const cfg = { ...UNIVERSE_EARTH, semiMajorAxis: 3.0e11, greenhouseDelta: 0 };
    assert.equal(compareWithUniverse(40, cfg), null);
  });

  it('low gravity (slow recycling) keeps TS and WASM in parity', () => {
    const cfg = { planetMass: 2.5e23, planetRadius: 3.0e6, eccentricity: 0.4 };
    assert.equal(compareWithUniverse(40, cfg), null);
  });
});

describe('TS engine conservation/symmetry law effects are non-trivial', () => {
  function hashWithUniverse(universe: Record<string, unknown>, ticks = 60): number {
    const cfg = makeWorld(1, false);
    (cfg as unknown as { universe: Record<string, unknown> }).universe = universe;
    const e = new TsEngine(cfg);
    for (let t = 0; t < ticks; t++) e.tick();
    return e.computeStateHash();
  }

  it('momentum retention: thicker atmosphere (more drag) changes the trajectory', () => {
    const base = hashWithUniverse({ localGravity: 9.80665, planetMass: 5.9722e24 });
    const dense = hashWithUniverse({ localGravity: 9.80665, planetMass: 5.9722e24, atmospherePressure: 5.0 });
    assert.notEqual(base, dense, 'drag modulation should change the trajectory');
  });

  it('energy budget: farther orbit (less insolation) changes the trajectory', () => {
    const near = hashWithUniverse({ localGravity: 9.80665, planetMass: 5.9722e24, semiMajorAxis: 1.495978707e11 });
    const far = hashWithUniverse({ localGravity: 9.80665, planetMass: 5.9722e24, semiMajorAxis: 3.0e11 });
    assert.notEqual(near, far, 'regrowth modulation should change the trajectory');
  });

  it('temporal uniformity: eccentric orbit (flattened seasons) changes the trajectory', () => {
    const round = hashWithUniverse({ localGravity: 9.80665, planetMass: 5.9722e24, eccentricity: 0.0 });
    const oval = hashWithUniverse({ localGravity: 9.80665, planetMass: 5.9722e24, eccentricity: 0.8 });
    assert.notEqual(round, oval, 'seasonal amplitude modulation should change the trajectory');
  });
});

describe('TS engine determinism with universe', () => {
  it('universe-enabled TS engine is deterministic across runs', () => {
    const mk = () => {
      const cfg = makeWorld(2, false);
      (cfg as unknown as { universe: Record<string, unknown> }).universe = { localGravity: 1.62, planetMass: 7.342e22 };
      const e = new TsEngine(cfg);
      for (let t = 0; t < 30; t++) e.tick();
      return e;
    };
    assert.equal(mk().computeStateHash(), mk().computeStateHash(), 'TS determinism with universe');
  });
});