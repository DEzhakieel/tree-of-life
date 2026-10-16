/** Registry of documented experiments: immutable records that make a run
 * re-creatable (hypothesis + config + seeds + objectives).
 */
import type { Experiment } from './experiment.js';

export type { Experiment };

export class ExperimentRegistry {
  private exps = new Map<string, Experiment>();

  register(e: Experiment): void {
    if (this.exps.has(e.id)) throw new Error(`experiment '${e.id}' already registered`);
    if (e.seeds.length === 0) throw new Error(`experiment '${e.id}' needs >=1 seed`);
    this.exps.set(e.id, e);
  }

  get(id: string): Experiment | undefined {
    return this.exps.get(id);
  }

  require(id: string): Experiment {
    const e = this.exps.get(id);
    if (!e) throw new Error(`unknown experiment '${id}' (have: ${[...this.exps.keys()].join(', ')})`);
    return e;
  }

  list(): Experiment[] {
    return Array.from(this.exps.values()).sort((a, b) => a.name.localeCompare(b.name));
  }
}

export function defaultExperiments(): ExperimentRegistry {
  const reg = new ExperimentRegistry();
  reg.register({
    id: 'l3-baseline',
    name: 'L3 Baseline',
    hypothesis: 'Default config yields robust L3 emergence across seeds',
    description: 'Control run: unmodified ladder defaults, multi-seed, all thresholds.',
    tags: ['baseline', 'emergence', 'repro'],
    seeds: ['ladder-seed-0001', 'ladder-seed-0002', 'ladder-seed-0003'],
    ladder: { ticks: 6000, spawnCount: 60, maxPopulation: 400, sampleEvery: 400 },
    objectiveIds: ['l1-emergent', 'l2-emergent', 'l3-emergent', 'adaptation'],
    createdAt: '2026-10-16T00:00:00.000Z',
  });
  reg.register({
    id: 'abundance-lift',
    name: 'Abundance Lift',
    hypothesis: '3x food regen increases steady-state life and speciation without erasing hazard avoidance',
    description: 'Manipulation: foodRegenRate 0.0003 -> 0.0009 vs the baseline registry entry.',
    tags: ['manipulation', 'design', 'life'],
    seeds: ['ladder-seed-0001', 'ladder-seed-0002'],
    ladder: { ticks: 6000, spawnCount: 60, maxPopulation: 400, sampleEvery: 400, overrides: { foodRegenRate: 0.0009 } },
    objectiveIds: ['life-steady', 'speciation', 'hazard-avoidance'],
    createdAt: '2026-10-16T00:00:00.000Z',
  });
  return reg;
}
