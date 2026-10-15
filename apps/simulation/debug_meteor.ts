import { Engine } from './src/engine.js';
import { DEFAULT_PARAMS } from '@fractal-life/shared';
function makeWorld(seed: string, spawnCount = 40, overrides: any = {}) {
  return { id: `test-${seed}`, seed, fractalType: 'mandelbrot', params: { ...DEFAULT_PARAMS, spawnCount, ...overrides }, createdAt: 0, currentTick: 0 };
}
const w = makeWorld('retention', 600, { maxPopulation: 2000, foodRegenRate: 0.05, metabolismBase: 0.02, agentMaxAge: 5000 });
const e = new Engine(w, undefined, 100);
for (let i = 0; i < 300; i++) e.tick();
const me = new Engine(makeWorld('meteor', 100));
const before = me.aliveCount();
let inRadius = 0;
for (const a of me.agents.values()) { const dx = a.x - 512, dy = a.y - 512; if (dx*dx + dy*dy < 16384) inRadius++; }
me.applyIntervention({ type: 'meteor', x: 512, y: 512, radius: 128, sequence: 1 });
const after = me.aliveCount();
console.log({ before, inRadius, after });
// also confirm spawn rng deterministic across two fresh engines
const m2 = new Engine(makeWorld('meteor', 100));
m2.applyIntervention({ type: 'meteor', x: 512, y: 512, radius: 128, sequence: 1 });
console.log({ after2: m2.aliveCount() });
