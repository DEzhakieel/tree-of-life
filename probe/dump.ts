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
const TICKS = Number(process.env.PARITY_TICKS ?? 4);

const world: WorldConfig = {
  id: `parity-${SEED}`, seed: SEED, fractalType: 'mandelbrot',
  params: { ...DEFAULT_PARAMS, spawnCount: SPAWN }, createdAt: 0, currentTick: 0,
};

const ts = new TsEngine(world);
const wasm = new RawWasmEngine(JSON.stringify(world));
ts.setBrainConfig({ enabled: false });
wasm.set_brain_json(JSON.stringify({ enabled: false }));

for (let t = 1; t <= TICKS; t++) {
  ts.tick(); wasm.tick();
  const tr: any = (ts as any).__tr;
  const wr: any = wasm.debug_trace_json();
  console.log(`--- tick${t} ---`);
  for (const k of Object.keys(tr)) {
    const a = tr[k], b = wr[k];
    const sa = Array.isArray(a) ? `[${a.join(',')}]` : String(a);
    const sb = Array.isArray(b) ? `[${b.join(',')}]` : String(b);
    const flag = sa === sb ? '' : '  <<< DIFF';
    console.log(`  ts.${k} = ${sa}${flag}`);
    console.log(`  wm.${k} = ${sb}`);
  }
  Object.keys(wr).forEach((k) => { if (!(k in tr)) console.log(`  ws-only.${k} = ${wr[k]}`); });
}