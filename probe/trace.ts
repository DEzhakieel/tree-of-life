import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { initSync, WasmEngine as RawWasmEngine } from '../crates/wasm/pkg/fractal_life_wasm.js';
import { Engine as TsEngine } from '@fractal-life/simulation';
import { DEFAULT_PARAMS, type WorldConfig } from '@fractal-life/shared';

const here = dirname(fileURLToPath(import.meta.url));
const wasmBytes = readFileSync(join(here, '..', 'crates', 'wasm', 'pkg', 'fractal_life_wasm_bg.wasm'));
initSync({ module: new WebAssembly.Module(wasmBytes) });

const SEED = process.env.PARITY_SEED ?? 'parity-probe';
const SPAWN = Number(process.env.PARITY_SPAWN ?? 1);
const TICKS = Number(process.env.PARITY_TICKS ?? 3);
const BRAIN = (process.env.PARITY_BRAIN ?? 'off') === 'on';

const world: WorldConfig = {
  id: `parity-${SEED}`,
  seed: SEED,
  fractalType: 'mandelbrot',
  params: { ...DEFAULT_PARAMS, spawnCount: SPAWN },
  createdAt: 0,
  currentTick: 0,
};

const ts = new TsEngine(world);
const wasm = new RawWasmEngine(JSON.stringify(world));
ts.setBrainConfig({ enabled: BRAIN });
wasm.set_brain_json(JSON.stringify({ enabled: BRAIN }));

type Tr = {
  tick: number; daylight: number; seasonPhase: number; seasonMoisture: number;
  zmag2: number; flux: number; nbCount: number;
  sensors: number[]; hazard: number; energyBefore: number;
  out: number[]; driveX: number; driveY: number; ph: number; osc: number; noise: number; sinPh: number; cosPh: number; thrustX: number; thrustY: number;
  waterFrac: number; dh: number; chemMod: number;
};

function cmp(label: string, t: any, w: any): boolean {
  let ok = true;
  for (const k of Object.keys(t)) {
    const a = t[k], b = w[k];
    if (Array.isArray(a)) {
      if (a.length !== b.length) { ok = false; console.log(`  ${label}.${k} len ts=${a.length} wasm=${b.length}`); continue; }
      for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) { ok = false; console.log(`  ${label}.${k}[${i}] ts=${a[i]} wasm=${b[i]}`); }
    } else if (a !== b) {
      ok = false; console.log(`  ${label}.${k} ts=${a} wasm=${b}`);
    }
  }
  return ok;
}

console.log(`seed=${SEED} spawn=${SPAWN} brain=${BRAIN ? 'on' : 'off'}`);
for (let t = 1; t <= TICKS; t++) {
  ts.tick();
  wasm.tick();
  const tr = (ts as any).__tr as Tr;
  const wr = wasm.debug_trace_json() as any;
  if (cmp(`tick${t}`, tr, wr)) console.log(`  tick${t}: trace identical`);
}
process.exit(0);