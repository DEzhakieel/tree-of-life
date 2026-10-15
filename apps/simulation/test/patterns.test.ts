import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_PARAMS,
  GENOME_SIZE,
  DRIVE_OFFSET,
  DRIVES,
  WORLD_SIZE,
  type WorldConfig,
} from '@fractal-life/shared';
import { Engine } from '../src/engine.js';
import { decodeDrives } from '../src/genome.js';

function makeWorld(seed: string, spawnCount: number, overrides: Partial<typeof DEFAULT_PARAMS> = {}): WorldConfig {
  return {
    id: `patterns-${seed}`,
    seed,
    fractalType: 'mandelbrot',
    params: { ...DEFAULT_PARAMS, spawnCount, ...overrides },
    createdAt: 0,
    currentTick: 0,
  };
}

/**
 * Calm, bounded genome with zero brain activity: all MLP weights/bias are zero
 * so out[0..1] (thrust) is 0 — any movement comes purely from the drive genes,
 * isolating the instinct vector for testing. c = 0 (main cardioid) never escapes.
 */
function driveGenome(overrides: Partial<Record<keyof ReturnType<typeof decodeDrives>, number>> = {}): Float32Array {
  const g = new Float32Array(GENOME_SIZE);
  g[0] = 1 / 3; // c = 0: bounded, survives
  g[2] = -1; // metabolism 0.02
  g[6] = -1; // size 0.5
  g[7] = 0; // herbivore
  g[9] = 1; // longevity
  g[10] = -1; // mutability 0.25
  g[105] = 5; // eat on (keeps them fed)
  g[106] = -5; // repro off
  g[107] = -5; // hunt off
  g[108] = -5; // signal off
  g[DRIVE_OFFSET + DRIVES.ALIGNMENT] = overrides.alignment ?? -1;
  g[DRIVE_OFFSET + DRIVES.COHESION] = overrides.cohesion ?? -1;
  g[DRIVE_OFFSET + DRIVES.SEPARATION] = overrides.separation ?? -1;
  g[DRIVE_OFFSET + DRIVES.CIRCULATION] = overrides.circulation ?? -1;
  g[DRIVE_OFFSET + DRIVES.OSCILLATION] = overrides.oscillation ?? -1;
  g[DRIVE_OFFSET + DRIVES.NOISE] = overrides.noise ?? -1;
  return g;
}

function place(engine: Engine, cluster: [number, number][], energy = 60): void {
  const cap = engine.params.energyCapacity;
  let i = 0;
  for (const a of engine.agents.values()) {
    if (i >= cluster.length) break;
    a.x = cluster[i]![0];
    a.y = cluster[i]![1];
    a.energy = a.water = energy;
    a.vx = 0;
    a.vy = 0;
    i++;
  }
}

function meanVelocityDot(engine: Engine): number {
  // mean pairwise alignment of alive agent velocities (unit vectors)
  const alive: { vx: number; vy: number }[] = [];
  for (const a of engine.agents.values()) {
    if (!a.alive || (Math.abs(a.vx) < 0.01 && Math.abs(a.vy) < 0.01)) continue;
    const mag = Math.hypot(a.vx, a.vy);
    alive.push({ vx: a.vx / mag, vy: a.vy / mag });
  }
  if (alive.length < 2) return 0;
  let dot = 0;
  let pairs = 0;
  for (let i = 0; i < alive.length; i++) {
    for (let j = i + 1; j < alive.length; j++) {
      dot += alive[i]!.vx * alive[j]!.vx + alive[i]!.vy * alive[j]!.vy;
      pairs++;
    }
  }
  return dot / pairs;
}

function autocorr(series: number[], lag: number): number {
  const n = series.length;
  if (n < lag + 4) return 0;
  let mean = 0;
  for (let i = 0; i < n; i++) mean += series[i]!;
  mean /= n;
  let num = 0;
  let d1 = 0;
  let d2 = 0;
  for (let i = 0; i < n - lag; i++) {
    num += (series[i]! - mean) * (series[i + lag]! - mean);
    d1 += (series[i]! - mean) ** 2;
    d2 += (series[i + lag]! - mean) ** 2;
  }
  if (d1 === 0 || d2 === 0) return 0;
  return num / Math.sqrt(d1 * d2);
}

function meanPairwiseDistance(engine: Engine): number {
  const alive: { x: number; y: number }[] = [];
  for (const a of engine.agents.values()) if (a.alive) alive.push({ x: a.x, y: a.y });
  if (alive.length < 2) return 0;
  let sum = 0;
  let pairs = 0;
  for (let i = 0; i < alive.length; i++) {
    for (let j = i + 1; j < alive.length; j++) {
      let dx = alive[i]!.x - alive[j]!.x;
      let dy = alive[i]!.y - alive[j]!.y;
      if (dx > WORLD_SIZE / 2) dx -= WORLD_SIZE;
      else if (dx < -WORLD_SIZE / 2) dx += WORLD_SIZE;
      if (dy > WORLD_SIZE / 2) dy -= WORLD_SIZE;
      else if (dy < -WORLD_SIZE / 2) dy += WORLD_SIZE;
      sum += Math.hypot(dx, dy);
      pairs++;
    }
  }
  return sum / pairs;
}

describe('decodeDrives', () => {
  it('maps the reserved genes to instinct weights', () => {
    const g = driveGenome({ alignment: 0.2, cohesion: 0.4, separation: 0.6, circulation: 0.8, oscillation: 1, noise: -0.5 });
    const d = decodeDrives(g);
    // signed gene v in [-1,1] -> weight (v+1)/2
    assert.ok(Math.abs(d.alignment - 0.6) < 1e-6, `alignment ${d.alignment}`);
    assert.ok(Math.abs(d.cohesion - 0.7) < 1e-6, `cohesion ${d.cohesion}`);
    assert.ok(Math.abs(d.separation - 0.8) < 1e-6, `separation ${d.separation}`);
    assert.ok(Math.abs(d.circulation - 0.8) < 1e-6, `circulation ${d.circulation}`);
    assert.ok(Math.abs(d.oscillation - 1) < 1e-6, `oscillation ${d.oscillation}`);
    assert.ok(Math.abs(d.noise - 0.25) < 1e-6, `noise ${d.noise}`);
  });

  it('is deterministic across identical genomes', () => {
    const a = driveGenome();
    const b = driveGenome();
    assert.deepEqual(decodeDrives(a), decodeDrives(b));
  });
});

describe('pattern drives generate structures', () => {
  it('alignment drive makes co-located agents move as a flock (velocity alignment)', () => {
    const engine = new Engine(makeWorld('flock', 8), Array.from({ length: 8 }, (_, i) => ({ id: i, genome: driveGenome({ alignment: 1 }) })));
    // co-locate them in a tight cluster
    place(engine, Array.from({ length: 8 }, (_, i) => [500 + i, 500]));
    // give each a distinct initial heading so alignment has something to act on
    let i = 0;
    for (const a of engine.agents.values()) {
      const ang = (i++ / 8) * Math.PI * 2;
      a.vx = Math.cos(ang) * 2;
      a.vy = Math.sin(ang) * 2;
    }
    for (let t = 0; t < 40; t++) engine.tick();
    const dot = meanVelocityDot(engine);
    assert.ok(dot > 0.9, `velocities should align into a flock (dot=${dot.toFixed(3)})`);
  });

  it('separation drive keeps agents apart (spacing / packing)', () => {
    const engine = new Engine(makeWorld('sep', 8), Array.from({ length: 8 }, (_, i) => ({ id: i, genome: driveGenome({ separation: 1 }) })));
    // all piled on top of each other
    place(engine, Array.from({ length: 8 }, () => [500, 500]));
    for (let t = 0; t < 30; t++) engine.tick();
    const d = meanPairwiseDistance(engine);
    assert.ok(d > 5, `separation drive should spread a pile of agents (mean dist=${d.toFixed(1)})`);
  });

  it('oscillation drive produces periodic thrust (cycles/waves)', () => {
    const engine = new Engine(makeWorld('osc', 4), Array.from({ length: 4 }, (_, i) => ({ id: i, genome: driveGenome({ oscillation: 1 }) })));
    place(engine, Array.from({ length: 4 }, (_, i) => [500 + i, 500]));
    const series: number[] = [];
    for (let t = 0; t < 120; t++) {
      engine.tick();
      let sum = 0;
      let n = 0;
      for (const a of engine.agents.values()) {
        if (!a.alive) continue;
        sum += a.vx;
        n++;
      }
      series.push(n > 0 ? sum / n : 0);
    }
    // the agent's phase is anchored to its (heritable) fractal parameter c, so
    // a coherent lineage oscillates as a wave. A genuine cycle shows up as a
    // strong negative autocorrelation at half the period — the same signature
    // the model hierarchy uses to detect waves/cycles.
    let minAC = 1;
    for (let lag = 5; lag <= 30; lag++) minAC = Math.min(minAC, autocorr(series, lag));
    assert.ok(minAC < -0.4, `oscillation drive should produce a periodic velocity wave (min autocorr=${minAC.toFixed(3)})`);
  });

  it('drives remain deterministic for a fixed seed', () => {
    const a = new Engine(makeWorld('det', 60));
    const b = new Engine(makeWorld('det', 60));
    for (let i = 0; i < 200; i++) {
      a.tick();
      b.tick();
    }
    assert.equal(a.computeStateHash(), b.computeStateHash());
  });

  it('drive genes are heritable: children keep the parent drive profile', () => {
    const genome = driveGenome({ alignment: 1, cohesion: 0.5, separation: 0.5 });
    const engine = new Engine(makeWorld('inherit', 2), [
      { id: 0, genome },
      { id: 1, genome },
    ]);
    // This test asserts gene-level heredity, so run it brain-off: the repro gate
    // is then the genome bias (out[3]=sigmoid(g[106])), not the learned MLP.
    engine.setBrainConfig({ enabled: false });
    const f0 = engine.agents.get(0)!;
    const f1 = engine.agents.get(1)!;
    f0.x = f0.y = f1.x = f1.y = 500;
    f0.energy = f0.water = f1.energy = f1.water = engine.params.energyCapacity * 0.5;
    // force reproduction on by zeroing the drive-only influence... the brain is
    // off (out[3]=sigmoid(0)=0.5 not > 0.5), so override the repro bias gene.
    genome[106] = 5;
    let childId = -1;
    for (let t = 0; t < 120 && childId < 0; t++) {
      engine.tick();
      for (const [id, a] of engine.agents) {
        if (a.parentId === 0 && a.bornAtTick === engine.currentTick && a.alive) {
          childId = id;
          break;
        }
      }
    }
    assert.ok(childId >= 0, 'expected a child before 120 ticks');
    const child = engine.agents.get(childId)!;
    const dParent = decodeDrives(f0.genome);
    const dChild = decodeDrives(child.genome);
    for (const key of ['alignment', 'cohesion', 'separation', 'circulation', 'oscillation', 'noise'] as const) {
      assert.ok(
        Math.abs(dParent[key] - dChild[key]) < 0.2,
        `${key} parent=${dParent[key].toFixed(2)} child=${dChild[key].toFixed(2)} should stay close after mutation`,
      );
    }
  });
});

describe('drive interactions do not break invariants', () => {
  it('strong separation + alignment still keeps energy within [0, cap]', () => {
    const engine = new Engine(makeWorld('inv', 40), Array.from({ length: 40 }, (_, i) => ({
      id: i,
      genome: driveGenome({ alignment: 1, separation: 1, circulation: 0.7, oscillation: 0.5 }),
    })));
    for (let t = 0; t < 100; t++) engine.tick();
    const cap = engine.params.energyCapacity;
    for (const a of engine.agents.values()) {
      if (!a.alive) continue;
      assert.ok(a.energy >= 0 && a.energy <= cap + 1e-6, `energy ${a.energy} within [0,cap] for ${a.id}`);
      assert.ok(Math.abs(a.vx) <= 10 && Math.abs(a.vy) <= 10, `velocity bounded for ${a.id}`);
      assert.ok(a.x >= 0 && a.x < WORLD_SIZE && a.y >= 0 && a.y < WORLD_SIZE, 'wrap keeps in bounds');
    }
  });
});
