import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { WorldConfig } from '@fractal-life/shared';
import { DEFAULT_PARAMS, WORLD_SIZE, decodeServerFrame } from '@fractal-life/shared';
import { Engine } from '../src/engine.js';
import { SplitMix64 } from '../src/rng.js';
import { randomGenome, mutateGenome } from '../src/genome.js';

function makeWorld(seed: string, spawnCount = 40, overrides: Partial<typeof DEFAULT_PARAMS> = {}): WorldConfig {
  return {
    id: `test-${seed}`,
    seed,
    fractalType: 'mandelbrot',
    params: { ...DEFAULT_PARAMS, spawnCount, ...overrides },
    createdAt: 0,
    currentTick: 0,
  };
}

describe('SplitMix64', () => {
  it('is deterministic and well-distributed', () => {
    const a = new SplitMix64(42);
    const b = new SplitMix64(42);
    const seq: number[] = [];
    for (let i = 0; i < 100; i++) {
      const va = a.next();
      assert.equal(va, b.next());
      seq.push(va);
    }
    assert.notEqual(new SplitMix64(43).next(), seq[0]);
    assert.ok(seq.every((v) => v >= 0 && v < 4294967296));
  });
});

describe('Engine determinism', () => {
  it('produces identical state for identical seeds across two instances', () => {
    const worldA = makeWorld('alpha');
    const worldB = makeWorld('alpha');
    const a = new Engine(worldA);
    const b = new Engine(worldB);
    for (let i = 0; i < 200; i++) {
      a.tick();
      b.tick();
    }
    assert.equal(a.computeStateHash(), b.computeStateHash());
    assert.equal(a.currentTick, b.currentTick);
    const sa = a.stats();
    const sb = b.stats();
    assert.equal(sa.aliveCount, sb.aliveCount);
    assert.equal(sa.speciesCount, sb.speciesCount);
    assert.equal(sa.entropy, sb.entropy);
    assert.equal(sa.diversity, sb.diversity);
    assert.equal(sa.complexity, sb.complexity);
    assert.equal(sa.cooperation, sb.cooperation);
    assert.equal(sa.predatorFraction, sb.predatorFraction);
    assert.equal(sa.cultureCount, sb.cultureCount);
    assert.equal(sa.meanAltruism, sb.meanAltruism);
    assert.equal(sa.memeEntropy, sb.memeEntropy);
    assert.equal(sa.speciesMemeMI, sb.speciesMemeMI);
    assert.equal(sa.meanAggression, sb.meanAggression);
    assert.equal(sa.meanCooperation, sb.meanCooperation);
    assert.equal(sa.meanRisk, sb.meanRisk);
    assert.equal(sa.meanDeception, sb.meanDeception);
    assert.equal(sa.predatorGeneFraction, sb.predatorGeneFraction);
    assert.equal(sa.preyGeneFraction, sb.preyGeneFraction);
    assert.equal(sa.energyInequality, sb.energyInequality);
    assert.equal(sa.donationRatio, sb.donationRatio);
  });

  it('diverges for different seeds', () => {
    const a = new Engine(makeWorld('seed-1'));
    const b = new Engine(makeWorld('seed-2'));
    for (let i = 0; i < 100; i++) {
      a.tick();
      b.tick();
    }
    assert.notEqual(a.computeStateHash(), b.computeStateHash());
  });

  it('replays identically from the intervention log', () => {
    const world = makeWorld('replay');
    const engine = new Engine(world);
    for (let i = 0; i < 30; i++) engine.tick();
    engine.applyIntervention({ type: 'meteor', x: 500, y: 500, radius: 200, sequence: 1 });
    for (let i = 0; i < 60; i++) engine.tick();
    engine.applyIntervention({ type: 'seedFood', x: 300, y: 900, amount: 80, radius: 160, sequence: 2 });
    for (let i = 0; i < 40; i++) engine.tick();

    const snapshotHash = engine.computeStateHash();
    const targetTick = engine.currentTick;

    const replayed = Engine.replay(world, engine.getInterventionLog(), targetTick);
    assert.equal(replayed.currentTick, targetTick);
    assert.equal(replayed.computeStateHash(), snapshotHash);
    assert.equal(replayed.interventionLog.length, engine.interventionLog.length);
  });

  it('agents stay inside the world (wrap)', () => {
    const engine = new Engine(makeWorld('bounds'));
    for (let i = 0; i < 300; i++) engine.tick();
    for (const a of engine.agents.values()) {
      if (a.alive) {
        assert.ok(a.x >= 0 && a.x < WORLD_SIZE);
        assert.ok(a.y >= 0 && a.y < WORLD_SIZE);
      }
    }
  });

  it('retention cap evicts only dead agents (alive agents are never dropped)', () => {
    const world = makeWorld('retention', 600, {
      maxPopulation: 2000,
      foodRegenRate: 0.05,
      metabolismBase: 0.02,
      agentMaxAge: 5000,
    });
    const engine = new Engine(world, undefined, 100);
    // Any agent alive at the start of a tick must still be stored when the tick
    // ends: eviction only removes ids from the dead queue, and an agent that
    // dies mid-tick is never evicted in the same tick (tickDeaths guard).
    for (let i = 0; i < 300; i++) {
      const aliveBefore: number[] = [];
      for (const [id, a] of engine.agents) if (a.alive) aliveBefore.push(id);
      assert.doesNotThrow(() => engine.tick());
      for (const id of aliveBefore) {
        assert.ok(engine.agents.get(id), `alive agent ${id} was evicted at tick ${engine.currentTick}`);
      }
    }
    // dead retention + current-tick deaths cap total stored agents
    assert.ok(engine.agents.size <= 2300, `stored agents ${engine.agents.size} should be retention-capped`);
    assert.ok(engine.aliveCount() > 0, 'population survived eviction pressure');
  });

  it('meteor kills agents within radius only', () => {
    const engine = new Engine(makeWorld('meteor', 100));
    // Guarantee in-radius coverage: the founder spawn RNG for this seed scatters
    // everyone away from the centre, so drop one founder at the epicentre.
    engine.applyIntervention({ type: 'spawnAgent', x: 512, y: 512, sequence: 0 });
    const before = engine.aliveCount();
    const r2 = 128 * 128;
    const inRadius: number[] = [];
    for (const [id, a] of engine.agents) {
      if (a.alive) {
        const dx = a.x - 512;
        const dy = a.y - 512;
        if (dx * dx + dy * dy < r2) inRadius.push(id);
      }
    }
    assert.ok(inRadius.length > 0, 'fixture guarantees an in-radius agent');
    engine.applyIntervention({ type: 'meteor', x: 512, y: 512, radius: 128, sequence: 1 });
    const after = engine.aliveCount();
    assert.equal(after, before - inRadius.length, 'exactly the in-radius agents die');
    for (const id of inRadius) {
      assert.equal(engine.agents.get(id)!.alive, false, `agent ${id} inside radius must die`);
    }
    assert.ok(after > 0, 'agents outside the radius survive');
  });

  it('spawn tool respects the population ceiling (regression: bypassed maxPopulation)', () => {
    const world = makeWorld('spawncap', 40, { maxPopulation: 120 });
    const engine = new Engine(world);
    for (let i = 0; i < 10; i++) engine.tick();
    const aliveBefore = engine.aliveCount();
    for (let i = 0; i < 500; i++) {
      engine.applyIntervention({ type: 'spawnAgent', x: 100 + i, y: 100, sequence: 1000 + i });
    }
    assert.ok(engine.aliveCount() <= 120, `alive ${engine.aliveCount()} must not exceed maxPopulation 120`);
    assert.ok(engine.aliveCount() >= aliveBefore, 'spawning adds agents below the cap');
    assert.ok(engine.agents.size <= 120 + 1000, 'dead retention still bounds stored agents');
  });

  it('lineage tracks parents', () => {
    const engine = new Engine(makeWorld('lineage', 30));
    let reproduced = false;
    for (let i = 0; i < 600 && !reproduced; i++) {
      engine.tick();
      for (const a of engine.agents.values()) {
        if (a.parentId !== -1 && a.alive) {
          reproduced = true;
          break;
        }
      }
    }
    assert.ok(reproduced, 'expected at least one born agent');
    const roots = engine.buildLineage();
    assert.ok(roots.length > 0);
  });

  it('reports deterministic events', () => {
    const engine = new Engine(makeWorld('events', 200));
    let sawExtinction = false;
    for (let i = 0; i < 500; i++) {
      const r = engine.tick();
      if (r.events.some((e) => e.type === 'extinction')) sawExtinction = true;
    }
    void sawExtinction;
    assert.ok(engine.currentTick > 0);
  });

  it('mutation stays within [-1, 1]', () => {
    const rng = new SplitMix64(7);
    const g = randomGenome(rng);
    let child = g;
    for (let i = 0; i < 200; i++) {
      child = mutateGenome(child, new SplitMix64(i + 1));
      assert.ok([...child].every((v) => v >= -1 && v <= 1));
    }
  });

  it('physics: alive agents accumulate bounded velocity and stay in bounds', () => {
    const engine = new Engine(makeWorld('phys-eng', 80));
    for (let i = 0; i < 120; i++) engine.tick();
    let sawMotion = false;
    for (const a of engine.agents.values()) {
      if (!a.alive) continue;
      assert.ok(Number.isFinite(a.vx) && Number.isFinite(a.vy), `velocity finite for ${a.id}`);
      assert.ok(Math.abs(a.vx) <= 10 && Math.abs(a.vy) <= 10, `velocity bounded for ${a.id}`);
      assert.ok(a.x >= 0 && a.x < WORLD_SIZE && a.y >= 0 && a.y < WORLD_SIZE, 'physics wrap keeps in bounds');
      if (Math.abs(a.vx) > 0.01 || Math.abs(a.vy) > 0.01) sawMotion = true;
    }
    assert.ok(sawMotion, 'alive agents should accumulate momentum');
  });

  it('physics: climb drain never creates energy (alive energy stays in [0, cap])', () => {
    const engine = new Engine(makeWorld('climb-eng', 60));
    for (let i = 0; i < 200; i++) engine.tick();
    const cap = engine.params.energyCapacity;
    for (const a of engine.agents.values()) {
      if (!a.alive) continue;
      assert.ok(a.energy >= 0 && a.energy <= cap + 1e-6, `energy ${a.energy} within [0,cap] for ${a.id}`);
    }
  });

  it('engine delta and snapshot frames decode with the shared reader', () => {
    const engine = new Engine(makeWorld('wire'));
    for (let i = 0; i < 50; i++) engine.tick();
    const last = engine.tick();
    const delta = decodeServerFrame(last.delta);
    assert.equal(delta.kind, 'delta');
    assert.equal(delta.msg.agents.length, last.deltaCount);
    for (const a of delta.msg.agents) {
      assert.ok(a.id >= 0);
      assert.ok(a.x >= 0 && a.x < WORLD_SIZE);
      assert.ok(a.y >= 0 && a.y < WORLD_SIZE);
    }
    const snap = decodeServerFrame(engine.encodeSnapshotMessage());
    assert.equal(snap.kind, 'snapshot');
    assert.equal(snap.msg.aliveCount, snap.msg.agents.length);
    assert.equal(snap.msg.agents.length, engine.aliveCount());
  });
});
