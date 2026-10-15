import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { initSync, WasmEngine as RawWasmEngine } from '../crates/wasm/pkg/fractal_life_wasm.js';
import { Engine as TsEngine } from '../apps/simulation/src/engine.js';
import { DEFAULT_PARAMS, type WorldConfig } from '@fractal-life/shared';

const here = dirname(fileURLToPath(import.meta.url));
initSync({ module: readFileSync(join(here, '..', 'crates', 'wasm', 'pkg', 'fractal_life_wasm_bg.wasm')) });

const SPAWN = 60;
const TICKS = 400;

function makeWorld(): WorldConfig {
  return {
    id: 'lineage-parity-probe',
    seed: 'lineage-parity-probe-seed',
    fractalType: 'mandelbrot',
    params: { ...DEFAULT_PARAMS, spawnCount: SPAWN },
    createdAt: 0,
    currentTick: 0,
  };
}

const ts = new TsEngine(makeWorld());
const wasm = new RawWasmEngine(JSON.stringify(makeWorld()));
for (let t = 1; t <= TICKS; t++) {
  ts.tick();
  wasm.tick();
}

type Rec = { id: number; parentId: number; bornAtTick: number; diedAtTick: number; species: number; finalFitness: number; alive: boolean };

const tsFlat: Rec[] = (ts.buildLineage() as unknown as Array<Rec & { children: unknown[] }>).map((n) => ({
  id: n.id,
  parentId: n.parentId,
  bornAtTick: n.bornAtTick,
  diedAtTick: n.diedAtTick,
  species: n.species,
  finalFitness: n.finalFitness,
  alive: n.alive,
}));
tsFlat.sort((a, b) => a.id - b.id);
const wasmFlat: Rec[] = JSON.parse(JSON.stringify(wasm.build_lineage_json())) as Rec[];
wasmFlat.sort((a, b) => a.id - b.id);

console.log('ts agents:', tsFlat.length, 'wasm agents:', wasmFlat.length);
console.log('ts dead:', tsFlat.filter((a) => !a.alive).length, 'wasm dead:', wasmFlat.filter((a) => !a.alive).length);

let worst = 0;
const byId = new Map(tsFlat.map((r) => [r.id, r] as const));
let mismatch = 0;
let count = 0;
for (const w of wasmFlat) {
  const t = byId.get(w.id);
  if (!t) {
    mismatch++;
    console.log('  [missing] ts has no id', w.id);
    continue;
  }
  count++;
  if (t.parentId !== w.parentId || t.bornAtTick !== w.bornAtTick || t.species !== w.species || t.alive !== w.alive || t.diedAtTick !== w.diedAtTick) {
    mismatch++;
    console.log(`  [field] id ${w.id}: ${JSON.stringify(t)} vs ${JSON.stringify(w)}`);
    continue;
  }
  const d = Math.abs(t.finalFitness - w.finalFitness);
  worst = Math.max(worst, d);
  if (d > 1e-2) {
    mismatch++;
    console.log(`  [fitness] id ${w.id}: ts=${t.finalFitness} wasm=${w.finalFitness} (d=${d})`);
  }
}
console.log('compared:', count, 'mismatches:', mismatch, 'worst fitness delta:', worst);
if (mismatch > 0 || tsFlat.length !== wasmFlat.length) process.exitCode = 1;