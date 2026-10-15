import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { initSync, WasmEngine as RawWasmEngine } from '../crates/wasm/pkg/fractal_life_wasm.js';
import { Engine as TsEngine } from '@fractal-life/simulation';
import { DEFAULT_PARAMS, type WorldConfig } from '@fractal-life/shared';

const here = dirname(fileURLToPath(import.meta.url));
initSync({ module: new WebAssembly.Module(readFileSync(join(here, '..', 'crates', 'wasm', 'pkg', 'fractal_life_wasm_bg.wasm'))) });

const SPAWN = 60;
const MAX_TICKS = 400;
const SEED = 'blades-60-b2';

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

type Row = { id: number; x: number; y: number; energy: number; age: number; alive: boolean; species: number };

function tsSummaries(e: TsEngine): Row[] {
  return e.agentSummaries();
}
function wasmSummaries(e: RawWasmEngine): Row[] {
  const raw = JSON.parse(JSON.stringify(e.agent_summaries_json())) as Array<{
    id: number; x: number; y: number; energy: number; age: number; alive: boolean; species: number;
  }>;
  return raw.map((a) => ({ id: a.id, x: a.x, y: a.y, energy: a.energy, age: a.age, alive: a.alive, species: a.species }));
}

const ts = new TsEngine(makeWorld(SEED));
const wasm = new RawWasmEngine(JSON.stringify(makeWorld(SEED)));

let firstDiv = -1;
let reason = '';
for (let t = 1; t <= MAX_TICKS; t++) {
  ts.tick();
  wasm.tick();
  const tsS = tsSummaries(ts);
  const wsS = wasmSummaries(wasm);
  const tsAlive = tsS.filter((s) => s.alive).length;
  const wsAlive = wsS.filter((s) => s.alive).length;
  if (tsAlive !== wsAlive) { firstDiv = t; reason = `aliveCount ts=${tsAlive} wasm=${wsAlive}`; break; }
  const tsIds = tsS.map((s) => s.id).sort((a, b) => a - b).join(',');
  const wsIds = wsS.map((s) => s.id).sort((a, b) => a - b).join(',');
  if (tsIds !== wsIds) { firstDiv = t; reason = `idSet ts=[${tsIds}] wasm=[${wsIds}]`; break; }
  const tsById = new Map(tsS.map((s) => [s.id, s] as const));
  for (const w of wsS.filter((s) => s.alive)) {
    const s = tsById.get(w.id);
    if (!s) continue;
    const maxD = Math.max(Math.abs(s.x - w.x), Math.abs(s.y - w.y), Math.abs(s.energy - w.energy));
    if (maxD > 1e-2 || s.age !== w.age) { firstDiv = t; reason = `id ${w.id} x ${s.x.toFixed(2)}v${w.x.toFixed(2)} y ${s.y.toFixed(2)}v${w.y.toFixed(2)} energy ${s.energy.toFixed(2)}v${w.energy.toFixed(2)} age ${s.age}v${w.age}`; break; }
  }
  if (firstDiv !== -1) break;
}

if (firstDiv === -1) {
  console.log(`PARITY HOLDS: spawn=${SPAWN} ${SEED} ${MAX_TICKS} ticks byte-consistent`);
} else {
  console.log(`DIVERGENCE tick=${firstDiv} ${reason}`);
  const chunk = 5;
  const a = new TsEngine(makeWorld(SEED));
  const b = new RawWasmEngine(JSON.stringify(makeWorld(SEED)));
  for (let t = 1; t <= firstDiv + chunk; t++) { a.tick(); b.tick(); }
  const tsS = tsSummaries(a);
  const wsS = wasmSummaries(b);
  const tsById = new Map(tsS.map((s) => [s.id, s] as const));
  console.log('context window around divergence (shared ids):');
  let shown = 0;
  for (const w of wsS) {
    const s = tsById.get(w.id);
    if (!s) continue;
    const maxD = Math.max(Math.abs(s.x - w.x), Math.abs(s.y - w.y), Math.abs(s.energy - w.energy));
    if (maxD > 1e-2 || s.age !== w.age) {
      if (shown++ < 8) console.log(`  id ${w.id} x ts=${s.x.toFixed(1)} wasm=${w.x.toFixed(1)} | y ${s.y.toFixed(1)} v ${w.y.toFixed(1)} | e ${s.energy.toFixed(1)} v ${w.energy.toFixed(1)} | age ${s.age} v ${w.age} | alive ${s.alive} v ${w.alive}`);
    }
  }
}
