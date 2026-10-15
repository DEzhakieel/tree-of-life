import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { initSync, WasmEngine as RawWasmEngine } from '../crates/wasm/pkg/fractal_life_wasm.js';
import { buildTerrainGrid } from '@fractal-life/simulation';
import { DEFAULT_PARAMS, fnv1a32, type WorldConfig } from '@fractal-life/shared';

const here = dirname(fileURLToPath(import.meta.url));
const wasmBytes = readFileSync(join(here, '..', 'crates', 'wasm', 'pkg', 'fractal_life_wasm_bg.wasm'));
initSync({ module: new WebAssembly.Module(wasmBytes) });

const SEED = process.env.PARITY_SEED ?? 'parity-terrain';
const FRACTAL = (process.env.PARITY_FRACTAL as any) ?? 'mandelbrot';
const world: WorldConfig = {
  id: `parity-${SEED}`,
  seed: SEED,
  fractalType: FRACTAL,
  params: { ...DEFAULT_PARAMS, spawnCount: 1 },
  createdAt: 0,
  currentTick: 0,
};

const tsGrid = buildTerrainGrid(world.params, world.fractalType, fnv1a32(world.seed));
const wasm = new RawWasmEngine(JSON.stringify(world));
const wg = wasm.terrain_grid_json() as any;

const FIELDS = ['height', 'energy', 'moisture', 'hazard', 'chem', 'baseMinerals', 'minerals', 'food', 'meat', 'signal', 'cap'] as const;
let bad = 0;
let total = 0;
for (const f of FIELDS) {
  const t = tsGrid[f] as Float32Array;
  const w = wg[f] as number[];
  if (t.length !== w.length) {
    console.log(`length mismatch ${f}: ts=${t.length} wasm=${w.length}`);
    bad++;
    continue;
  }
  let firstBad = -1;
  let nBad = 0;
  for (let i = 0; i < t.length; i++) {
    total++;
    if (t[i]! !== w[i]!) {
      nBad++;
      if (firstBad < 0) firstBad = i;
    }
  }
  if (nBad > 0) {
    bad++;
    const gx = firstBad % 128;
    const gy = Math.floor(firstBad / 128);
    console.log(`field ${f}: ${nBad}/${t.length} mismatch; first at idx ${firstBad} (gx=${gx},gy=${gy}) ts=${t[firstBad]} wasm=${w[firstBad]}`);
  } else {
    console.log(`field ${f}: identical (${t.length})`);
  }
}
console.log(bad === 0 ? 'TERRAIN PARITY OK' : `TERRAIN MISMATCH in ${bad} fields`);
process.exit(bad === 0 ? 0 : 1);