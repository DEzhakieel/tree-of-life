import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { initSync, WasmEngine as RawWasmEngine } from '../crates/wasm/pkg/fractal_life_wasm.js';
import { Engine as TsEngine } from '@fractal-life/simulation';
import { DEFAULT_PARAMS, type WorldConfig } from '@fractal-life/shared';

const here = dirname(fileURLToPath(import.meta.url));
initSync({ module: readFileSync(join(here, '..', 'crates', 'wasm', 'pkg', 'fractal_life_wasm_bg.wasm')) });

const SPAWN = 60;
const MAX_TICKS = 400;

function makeWorld(seed: string): WorldConfig {
  return {
    id: `blades-${seed}`,
    seed,
    fractalType: 'mandelbrot',
    params: { ...DEFAULT_PARAMS, spawnCount: SPAWN },
    createdAt: 0,
    currentTick: 0,
  };
}

type Summary = { id: number; x: number; y: number; energy: number; age: number; alive: boolean; species: number };

function tsSummaries(e: TsEngine): Summary[] {
  return e.agentSummaries();
}

function wasmSummaries(e: RawWasmEngine): Summary[] {
  const raw = JSON.parse(JSON.stringify(e.agent_summaries_json())) as Array<{
    id: number; x: number; y: number; energy: number; age: number; alive: boolean; species: number;
  }>;
  return raw.map((a) => ({ id: a.id, x: a.x, y: a.y, energy: a.energy, age: a.age, alive: a.alive, species: a.species }));
}

function compareAt(e: RawWasmEngine, ts: Summary[], wasm: Summary[]): string | null {
  const tsById = new Map(ts.map((s) => [s.id, s] as const));
  const wasmById = new Map(wasm.map((s) => [s.id, s] as const));
  let diffs = 0;
  for (const w of wasm) {
    const t = tsById.get(w.id);
    if (!t) { diffs++; continue; }
    const maxD = Math.max(Math.abs(t.x - w.x), Math.abs(t.y - w.y), Math.abs(t.energy - w.energy));
    if (t.alive !== w.alive || maxD > 1e-3 || t.age !== w.age) { diffs++; }
  }
  if (diffCount > 0 && diffCount <= 3) {
    const tsStr = ts.length;
    const wasmStr = wasm.length;
    const aliveTs = ts.filter((s) => s.alive).length;
    const aliveWasm = wasm.filter((s) => s.alive).length;
    if (aliveTs !== aliveWasm || tsStr !== wasmStr) return null; // count mismatch is its own signal
  }
  return null;
}

const ts = new TsEngine(makeWorld('blades-60-b2'));
const wasm = new RawWasmEngine(JSON.stringify(makeWorld('blades-60-b2')));

let firstDiv: number | null = null;
let field: string | null = null;
for (let t = 1; t <= MAX_TICKS; t++) {
  ts.tick();
  wasm.tick();
  const tsS = tsSummaries(ts);
  const wsS = wasmSummaries(wasm);
  const tsAlive = tsS.filter((s) => s.alive).length;
  const wsAlive = wsS.filter((s) => s.alive).length;
  if (tsAlive !== wsAlive) {
    firstDiv = t;
    field = `aliveCount ts=${tsAlive} wasm=${wsAlive}`;
    break;
  }
  const tsIds = tsS.map((s) => s.id).sort((a, b) => a - b).join(',');
  const wsIds = wsS.map((s) => s.id).sort((a, b) => a - b).join(',');
  if (tsIds !== wsIds) {
    firstDiv = t;
    field = `idSet ts=[${tsIds}] wasm=[${wsIds}]`;
    break;
  }
  // per-field diff on shared alive agents
  const tsById = new Map(tsS.map((s) => [s.id, s] as const));
  for (const w of wsS.filter((s) => s.alive)) {
    const t = tsById.get(w.id);
    if (!t) continue;
    const maxD = Math.max(Math.abs(t.x - w.x), Math.abs(t.y - w.y), Math.abs(t.energy - w.energy));
    if (t.alive !== w.alive || maxD > 1e-2 || t.age !== w.age) {
      firstDiv = t;
      field = `summary id=${w.id} ts=${JSON.stringify(t)} wasm=${JSON.stringify(w)}`;
      break;
    }
  }
  if (firstDiv !== null) break;
}

if (firstDiv === null) {
  console.log(`PARITY HOLDS: spawn=${SPAWN} all ` + MAX_TICKS + ' ticks identical');
} else {
  console.log(`DIVERGENCE at tick ${firstDiv}: ${field}`);
  const diffAgent = (firstDiv as number);
  const [tsF, wasmF] = (() => {
    const ts = new TsEngine(makeWorld('blades-60-b2'));
    const wasm = new RawWasmEngine(JSON.stringify(makeWorld('blades-60-b2')));
    for (let t = 1; t <= diffAgent; t++) { ts.tick(); wasm.tick(); }
    return [tsSummaries(ts), wasmSummaries(wasm)];
  })();
  // find ids present in both with differing fields
  const tsById = new Map(tsF.map((s) => [s.id, s] as const));
  const wasmById = new Map(wasmF.map((s) => [s.id, s] as const));
  let shown = 0;
  for (const w of wasmF) {
    const t = tsById.get(w.id);
    if (!t) continue;
    const maxD = Math.max(Math.abs(t.x - w.x), Math.abs(t.y - w.y), Math.abs(t.energy - w.energy));
    if (maxD > 1e-2 || t.alive !== w.alive || t.age !== w.age) {
      if (shown++ < 5) console.log(`  id ${w.id} x ts=${t.x.toFixed(2)} wasm=${w.x.toFixed(2)} | y ${t.y.toFixed(2)} v ${w.y.toFixed(2)} | energy ${t.energy.toFixed(2)} v ${w.energy.toFixed(2)} | age ${t.age} v ${w.age} | alive ${t.alive} v ${w.alive}`);
    }
  }
}
