import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { initSync, WasmEngine } from '../../../crates/wasm/pkg/fractal_life_wasm.js';
import { Engine as TsEngine } from '../src/engine.js';
import { DEFAULT_PARAMS, type WorldConfig } from '@fractal-life/shared';

/**
 * WASM <=> TS engine parity.
 *
 * The Rust/WASM engine and the TypeScript reference engine must produce the
 * same trajectory from the same seed+config. Pure functions of simulation time
 * (daylight, season, julia flux...) must match EXACTLY; everything derived from
 * agent physics may differ only by the last-ulp of the platform libm
 * (V8 Math.* vs Rust libm) — observed magnitudes are ~1e-7 absolute after 100
 * ticks (f32 quantization boundary crossings), energy ~1e-8 relative. The
 * tolerances below have >100x margin over those, yet will still catch real
 * divergences like the noise-drive sign flip this suite was built to lock in.
 */

const REL_TOL = 1e-4;
const ABS_TOL = 1e-2;
const EXACT = ['daylight', 'seasonPhase', 'seasonMoisture', 'zmag2', 'flux'];

function makeWorld(spawn: number, brain: boolean): WorldConfig {
  return {
    id: 'parity-test',
    seed: 'parity-test',
    fractalType: 'mandelbrot',
    params: { ...DEFAULT_PARAMS, spawnCount: spawn },
    createdAt: 0,
    currentTick: 0,
  };
}

type ScalarTarget = { name: string; scalar: true };
type ArrayTarget = { name: string; scalar: false };
const SCALARS: ScalarTarget[] = [
  { name: 'hazard', scalar: true },
  { name: 'energyBefore', scalar: true },
  { name: 'driveX', scalar: true },
  { name: 'driveY', scalar: true },
  { name: 'thrustX', scalar: true },
  { name: 'thrustY', scalar: true },
  { name: 'waterFrac', scalar: true },
  { name: 'dh', scalar: true },
  { name: 'chemMod', scalar: true },
];
const ARRAYS: ArrayTarget[] = [{ name: 'sensors', scalar: false }, { name: 'out', scalar: false }];

function mismatch(tick: number, field: string, ts: number | undefined, wasm: number | undefined): string {
  return `tick ${tick}: ${field} ts=${ts} wasm=${wasm}`;
}

function checkTick(tr: Record<string, unknown>, wr: Record<string, unknown>, tick: number): string | null {
  const inRange = (field: string, a: number, b: number): boolean => {
    if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
    return Math.abs(a - b) <= ABS_TOL + REL_TOL * Math.max(1, Math.abs(a), Math.abs(b));
  };
  for (const f of EXACT) {
    const a = tr[f] as number;
    const b = wr[f] as number;
    if (a !== b) return mismatch(tick, f, a, b);
  }
  for (const f of [...SCALARS, ...ARRAYS]) {
    const a = tr[f.name] as number | number[];
    const b = wr[f.name] as number | number[];
    const items = f.scalar ? [f.name as string] : (a as number[]).map((_, i) => `${f.name}[${i}]`);
    const av = (i: number) => (f.scalar ? (a as number) : (a as number[])[i]);
    const bv = (i: number) => (f.scalar ? (b as number) : (b as number[])[i]);
    for (let i = 0; i < items.length; i++) {
      if (!inRange(items[i]!, av(i), bv(i))) return mismatch(tick, items[i]!, av(i), bv(i));
    }
  }
  return null;
}

function runCase(spawn: number, brain: boolean, ticks: number): string | null {
  const world = makeWorld(spawn, brain);
  const ts = new TsEngine(world);
  const wasm = new WasmEngine(JSON.stringify(world));
  ts.setBrainConfig({ enabled: brain });
  wasm.set_brain_json(JSON.stringify({ enabled: brain }));
  for (let t = 1; t <= ticks; t++) {
    ts.tick();
    wasm.tick();
    const tr = (ts as unknown as { __tr: Record<string, unknown> }).__tr;
    const wr = wasm.debug_trace_json() as Record<string, unknown>;
    const m = checkTick(tr, wr, t);
    if (m) return m;
  }
  return null;
}

describe('WASM <=> TS engine parity', () => {
  it('brain off, single spawn, 100 ticks', () => {
    assert.equal(runCase(1, false, 100), null);
  });
  it('brain on, single spawn, 100 ticks', () => {
    assert.equal(runCase(1, true, 100), null);
  });
  it('brain off, 3 spawn (neighbor sums), 100 ticks', () => {
    assert.equal(runCase(3, false, 100), null);
  });
  it('brain on, 3 spawn (neighbor sums), 100 ticks', () => {
    assert.equal(runCase(3, true, 100), null);
  });
});