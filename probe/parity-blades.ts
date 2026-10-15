import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { initSync, WasmEngine as RawWasmEngine } from '../crates/wasm/pkg/fractal_life_wasm.js';
import { Engine as TsEngine } from '@fractal-life/simulation';
import { DEFAULT_PARAMS, type WorldConfig } from '@fractal-life/shared';

const here = dirname(fileURLToPath(import.meta.url));
initSync({ module: readFileSync(join(here, '..', 'crates', 'wasm', 'pkg', 'fractal_life_wasm_bg.wasm')) });

const SPAWN = 52;
const MAX_TICKS = 300;

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

const cfg = makeWorld('blades-52');
const ts = new TsEngine(cfg);
const wasm = new RawWasmEngine(JSON.stringify(cfg));

function digest(e: TsEngine | RawWasmEngine): { alive: number; ids: string } {
  let es: TsEngine | RawWasmEngine;
  const aliveCount = (e as unknown as { aliveCount?: number }).aliveCount;
  if (typeof aliveCount === 'number') return { alive: aliveCount, ids: '' };
  const raw = JSON.parse(JSON.stringify((wasm as unknown as { agent_summaries_json(): unknown }).agent_summaries_json())) as Array<{ id: number; alive: boolean }>;
  const aliveRaw = raw.filter((a) => a.alive);
  return { alive: aliveRaw.length, ids: aliveRaw.map((a) => a.id).sort((p, q) => p - q).join(',') };
}

for (let t = 1; t <= MAX_TICKS; t++) {
  ts.tick();
  wasm.tick();
  const dTs = (ts as unknown as { aliveCount: number }).aliveCount;
  const dWasm = (wasm as unknown as { alive_count(): number }).alive_count();
  if (dTs !== dWasm) {
    console.log(`tick ${t}: FIRST DIVERGENCE aliveCount ts=${dTs} wasm=${dWasm}`);
    // per-field diff on the alignable subset
    const tsSums = (ts as unknown as { agentSummaries(): Array<{ id: number; alive: boolean; energy: number; x: number; y: number; age: number }> }).agentSummaries();
    const wRaw = JSON.parse(JSON.stringify(wasm.agent_summaries_json())) as Array<{ id: number; alive: boolean; energy: number; x: number; y: number; age: number }>;
    const tsById = new Map(tsSums.map((a) => [a.id, a] as const));
    const both = wRaw.filter((a) => tsById.has(a.id));
    let diffs = 0;
    for (const w of both) {
      const s = tsById.get(w.id)!;
      const d = (a: number, b: number) => Math.abs(a - b);
      const maxD = Math.max(
        d(s.energy, w.energy),
        d(s.x, w.x),
        d(s.y, w.y),
      );
      if (!(maxD < 1e-3) || w.alive !== s.alive) {
        diffs++;
        if (diffs < 6)
          console.log(`  id ${w.id}: alive ts=${s.alive} wasm=${w.alive} energy ${s.energy.toFixed(3)} v ${w.energy.toFixed(3)} x ${s.x.toFixed(1)} v ${w.x.toFixed(1)}`);
      }
    }
    console.log(`  shared ids: ${both.length} diffs>1e-3: ${diffs}`);
    break;
  }
}
if (dTs === dWasm) console.log('no aliveCount divergence in', MAX_TICKS, 'ticks');