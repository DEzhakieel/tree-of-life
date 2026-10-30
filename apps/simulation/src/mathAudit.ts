/**
 * Mathematical audit of the simulation state.
 *
 * This module is a *witness*, not a model: it never draws, mutates, or
 * reorders anything, so calling it cannot change a trajectory. It exists
 * because the project's central claim is that a world is a pure function of its
 * seed and configuration; that claim is only as good as the statement that the
 * state stays inside the domain the equations were derived for. A `NaN` or an
 * out-of-range coordinate silently poisons every downstream statistic long
 * before anyone notices a wrong number in a report.
 *
 * The rules below are the ones the engine maintains after construction. A world
 * configured with `spawnCount > maxPopulation` is reported as out of domain:
 * the population ceiling gates births, but founder spawning trusts the
 * configuration, so that case is a configuration error worth surfacing.
 * Values a scenario deliberately overrides — e.g. `feedGenome` writes threshold
 * genes at ±5 — are not violations, which is why genome values are checked for
 * finiteness but not for the mutation kernel's [-1, 1] range.
 */

export interface AuditableAgent {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  energy: number;
  water: number;
  age: number;
  alive: boolean;
  genome: Float32Array;
}

export interface AuditContext {
  tick: number;
  worldSize: number;
  maxPopulation: number;
  energyCapacity: number;
  /** expected genome length; defaults to the shared GENOME_SIZE */
  genomeSize?: number;
}

export interface Violation {
  tick: number;
  agent: number | null;
  field: string;
  value: number;
  rule: string;
}

const EPS = 1e-9;

function push(
  out: Violation[],
  tick: number,
  agent: number | null,
  field: string,
  value: number,
  rule: string,
): void {
  out.push({ tick, agent, field, value, rule });
}

function finite(out: Violation[], tick: number, agent: number | null, field: string, value: number): void {
  if (!Number.isFinite(value)) push(out, tick, agent, field, value, 'must be finite');
}

/** Audit one agent against the engine's invariants. */
export function auditAgent(a: AuditableAgent, ctx: AuditContext, out: Violation[]): void {
  const t = ctx.tick;
  const id = a.id;
  finite(out, t, id, 'x', a.x);
  finite(out, t, id, 'y', a.y);
  finite(out, t, id, 'vx', a.vx);
  finite(out, t, id, 'vy', a.vy);
  finite(out, t, id, 'energy', a.energy);
  finite(out, t, id, 'water', a.water);
  finite(out, t, id, 'age', a.age);

  if (Number.isFinite(a.x) && !(a.x >= 0 && a.x < ctx.worldSize)) {
    push(out, t, id, 'x', a.x, `must lie in [0, ${ctx.worldSize})`);
  }
  if (Number.isFinite(a.y) && !(a.y >= 0 && a.y < ctx.worldSize)) {
    push(out, t, id, 'y', a.y, `must lie in [0, ${ctx.worldSize})`);
  }
  if (Number.isFinite(a.age) && a.age < 0) push(out, t, id, 'age', a.age, 'must be >= 0');

  if (!a.alive) return;

  // Survivors have passed both death checks of the tick, so energy and water
  // are strictly positive; energy is clamped on every gain path, so it cannot
  // exceed capacity.
  if (Number.isFinite(a.energy)) {
    if (a.energy <= 0) push(out, t, id, 'energy', a.energy, 'alive agent must have energy > 0');
    if (a.energy > ctx.energyCapacity * (1 + EPS)) {
      push(out, t, id, 'energy', a.energy, `alive agent must have energy <= capacity (${ctx.energyCapacity})`);
    }
  }
  if (Number.isFinite(a.water)) {
    if (a.water <= 0) push(out, t, id, 'water', a.water, 'alive agent must have water > 0');
    if (a.water > ctx.energyCapacity * (1 + EPS)) {
      push(out, t, id, 'water', a.water, `alive agent must have water <= capacity (${ctx.energyCapacity})`);
    }
  }

  const expected = ctx.genomeSize ?? 0;
  if (expected > 0 && a.genome.length !== expected) {
    push(out, t, id, 'genome.length', a.genome.length, `must equal ${expected}`);
  }
  for (let i = 0; i < a.genome.length; i++) {
    const g = a.genome[i]!;
    if (!Number.isFinite(g)) {
      push(out, t, id, `genome[${i}]`, g, 'must be finite');
      break;
    }
  }
}

/**
 * Audit a whole world: every agent, the population bound, and (optionally) the
 * numeric fields of a tick-stats object.
 */
export function auditWorld(
  input: {
    tick: number;
    worldSize: number;
    maxPopulation: number;
    energyCapacity: number;
    agents: Iterable<AuditableAgent>;
    stats?: object;
  },
  genomeSize?: number,
): Violation[] {
  const out: Violation[] = [];
  const ctx: AuditContext = {
    tick: input.tick,
    worldSize: input.worldSize,
    maxPopulation: input.maxPopulation,
    energyCapacity: input.energyCapacity,
    genomeSize,
  };
  let alive = 0;
  for (const a of input.agents) {
    if (a.alive) alive++;
    auditAgent(a, ctx, out);
  }
  if (alive > ctx.maxPopulation) {
    push(out, ctx.tick, null, 'population', alive, `must be <= maxPopulation (${ctx.maxPopulation})`);
  }
  if (input.stats) auditNumbers(input.stats, 'stats', ctx.tick, out);
  return out;
}

/**
 * Walk every numeric field (including numeric arrays) of an object and report
 * non-finite values. Depth- and size-limited so a runaway structure cannot make
 * the auditor itself the problem.
 */
export function auditNumbers(value: unknown, prefix: string, tick: number, out: Violation[], depth = 0): void {
  if (depth > 4 || out.length > 64) return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) push(out, tick, null, prefix, value, 'must be finite');
    return;
  }
  if (Array.isArray(value) || ArrayBuffer.isView(value)) {
    const arr = value as ArrayLike<number>;
    const n = Math.min(arr.length, 4096);
    for (let i = 0; i < n; i++) {
      const v = arr[i];
      if (typeof v === 'number' && !Number.isFinite(v)) {
        push(out, tick, null, `${prefix}[${i}]`, v, 'must be finite');
      }
    }
    return;
  }
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      auditNumbers(v, prefix ? `${prefix}.${k}` : k, tick, out, depth + 1);
    }
  }
}

/** First few violations as a readable string, for assertion messages. */
export function describeViolations(violations: Violation[], limit = 5): string {
  if (violations.length === 0) return 'no violations';
  const lines = violations
    .slice(0, limit)
    .map((v) => `t=${v.tick}${v.agent === null ? '' : ` agent=${v.agent}`} ${v.field}=${v.value}: ${v.rule}`);
  const more = violations.length > limit ? `\n…and ${violations.length - limit} more` : '';
  return `${violations.length} violation(s):\n${lines.join('\n')}${more}`;
}
