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
const TICKS = Number(process.env.PARITY_TICKS ?? 100);
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

type Field = { name: string; scalar: boolean };
const TYPES: Field[] = [
  { name: 'daylight', scalar: true }, { name: 'seasonPhase', scalar: true }, { name: 'seasonMoisture', scalar: true },
  { name: 'zmag2', scalar: true }, { name: 'flux', scalar: true }, { name: 'nbCount', scalar: true },
  { name: 'sensors', scalar: false }, { name: 'hazard', scalar: true }, { name: 'energyBefore', scalar: true },
  { name: 'out', scalar: false }, { name: 'driveX', scalar: true }, { name: 'driveY', scalar: true },
  { name: 'thrustX', scalar: true }, { name: 'thrustY', scalar: true }, { name: 'waterFrac', scalar: true },
  { name: 'dh', scalar: true }, { name: 'chemMod', scalar: true },
];

const maxAbs = new Map<string, number>();
const maxRel = new Map<string, number>();
let anyDiff = false;

for (let t = 1; t <= TICKS; t++) {
  ts.tick();
  wasm.tick();
  const tr: any = (ts as any).__tr;
  const wr: any = wasm.debug_trace_json();
  for (const f of TYPES) {
    const a = tr[f.name];
    const b = wr[f.name];
    const keys = f.scalar ? [''] : (a as unknown[]).map((_, i) => String(i));
    for (const k of keys) {
      const av = f.scalar ? a : (a as number[])[Number(k)];
      const bv = f.scalar ? b : (b as number[])[Number(k)];
      const abs = Math.abs(av - bv);
      const rel = abs / Math.max(1, Math.abs(av), Math.abs(bv));
      const key = `${f.name}[${k}]`;
      if (abs !== 0) anyDiff = true;
      if (abs > (maxAbs.get(key) ?? -1)) maxAbs.set(key, abs);
      if (rel > (maxRel.get(key) ?? -1)) maxRel.set(key, rel);
    }
  }
}

console.log(`seed=${SEED} spawn=${SPAWN} ticks=${TICKS} brain=${BRAIN ? 'on' : 'off'} anyDiff=${anyDiff}`);
const rows: Array<{ key: string; abs: number; rel: number }> = [];
for (const [k] of maxAbs) rows.push({ key: k, abs: maxAbs.get(k)!, rel: maxRel.get(k) ?? 0 });
rows.sort((x, y) => y.abs - x.abs);
for (const r of rows.slice(0, 15)) {
  console.log(`  max ${r.key}  abs=${r.abs.toExponential(3)}  rel=${r.rel.toExponential(3)}`);
}