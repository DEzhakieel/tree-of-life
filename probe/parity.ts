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
const SPAWN = Number(process.env.PARITY_SPAWN ?? 60);
const TICKS = Number(process.env.PARITY_TICKS ?? 1000);

function makeWorld(seed: string, spawnCount: number, overrides: Partial<typeof DEFAULT_PARAMS> = {}): WorldConfig {
  return {
    id: `parity-${seed}`,
    seed,
    fractalType: 'mandelbrot',
    params: { ...DEFAULT_PARAMS, spawnCount, ...overrides },
    createdAt: 0,
    currentTick: 0,
  };
}

type Rec = {
  id: number;
  alive: boolean;
  died: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  energy: number;
  water: number;
  meme: number;
  cRe: number;
  cIm: number;
  zRe: number;
  zIm: number;
  orbit: number;
  species: number;
  age: number;
  paused: number;
};

type TsAgent = { alive: boolean; diedAtTick: number; id: number; x: number; y: number; vx: number; vy: number; energy: number; water: number; meme: number; cRe: number; cIm: number; zRe: number; zIm: number; orbitDepth: number; species: number; age: number; pausedTicks: number };

function tsDump(ts: TsEngine): Rec[] {
  const inner = ts as unknown as { agents: Map<number, TsAgent> };
  const out: Rec[] = [];
  for (const a of inner.agents.values()) {
    out.push({
      id: a.id, alive: a.alive, died: a.diedAtTick,
      x: a.x, y: a.y, vx: a.vx, vy: a.vy,
      energy: a.energy, water: a.water, meme: a.meme,
      cRe: a.cRe, cIm: a.cIm, zRe: a.zRe, zIm: a.zIm,
      orbit: a.orbitDepth, species: a.species, age: a.age, paused: a.pausedTicks,
    });
  }
  out.sort((p, q) => p.id - q.id);
  return out;
}

function wasmDump(w: RawWasmEngine): Rec[] {
  const arr = w.debug_agents_json() as unknown as Rec[];
  arr.sort((p, q) => p.id - q.id);
  return arr;
}

const FIELDS: (keyof Rec)[] = ['alive', 'died', 'x', 'y', 'vx', 'vy', 'energy', 'water', 'meme', 'cRe', 'cIm', 'zRe', 'zIm', 'orbit', 'species', 'age', 'paused'];

function diffAtTick(label: string, a: Rec[], b: Rec[]): boolean {
  let ok = true;
  const maxLen = Math.max(a.length, b.length);
  for (let i = 0; i < maxLen; i++) {
    const ra = a[i];
    const rb = b[i];
    if (!ra || !rb || ra.id !== rb.id) {
      ok = false;
      console.log(`  [${label}] id set differs at idx ${i}: ts=${ra?.id ?? '∅'} wasm=${rb?.id ?? '∅'}`);
      if (ok) {};
      if (!ra || !rb) break;
      continue;
    }
    for (const f of FIELDS) {
      if (ra[f] !== rb[f]) {
        ok = false;
        console.log(`  [${label}] agent ${ra.id} field ${f}: ts=${JSON.stringify(ra[f])} wasm=${JSON.stringify(rb[f])}`);
      }
    }
  }
  if (a.length !== b.length) {
    ok = false;
    const tsDead = a.filter((r) => !r.alive).map((r) => r.id);
    const wasmDead = b.filter((r) => !r.alive).map((r) => r.id);
    console.log(`  [${label}] length ts=${a.length} wasm=${b.length}`);
    console.log(`  ts dead  = [${tsDead.join(',')}]`);
    console.log(`  wasm dead= [${wasmDead.join(',')}]`);
  }
  return ok;
}

const world = makeWorld(SEED, SPAWN);
const ts = new TsEngine(world);
const wasm = new RawWasmEngine(JSON.stringify(world));

console.log(`seed=${SEED} spawn=${SPAWN} ticks=${TICKS}`);

let tick0Ok = diffAtTick('tick0', tsDump(ts), wasmDump(wasm));
if (!tick0Ok) console.log('INITIAL STATE DIVERGES');
if (tick0Ok) console.log('tick0: identical');

let failures = 0;
for (let t = 1; t <= TICKS; t++) {
  ts.tick();
  wasm.tick();

  const hTs = ts.computeStateHash();
  const hWasm = wasm.compute_state_hash();
  const aliveTs = ts.aliveCount();
  const aliveWasm = wasm.alive_count();
  const statusWasm = wasm.world_status_json(false) as unknown as { speciesCount: number };
  const speciesTs = (ts as unknown as { countSpecies(): number }).countSpecies();
  const speciesWasm = statusWasm.speciesCount;

  if (hTs === hWasm && aliveTs === aliveWasm && speciesTs === speciesWasm) {
    if (t === TICKS) console.log(`PASS: ${t} ticks, hash=${hTs}, alive=${aliveTs}, species=${speciesTs}`);
    continue;
  }

  failures++;
  console.log(`DIVERGENCE at tick=${t}: hash ts=${hTs} wasm=${hWasm} | alive ts=${aliveTs} wasm=${aliveWasm} | species ts=${speciesTs} wasm=${speciesWasm}`);
  const f = diffAtTick(`tick${t}`, tsDump(ts), wasmDump(wasm));
  if (f) console.log('  (debug-dump fields all equal — divergence is in a field not dumped)');
  if (failures >= 20) {
    console.log('too many divergences, aborting');
    break;
  }
}

process.exit(failures === 0 ? 0 : 1);