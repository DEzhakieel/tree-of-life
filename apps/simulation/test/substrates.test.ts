import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_PARAMS,
  MAX_AGENTS,
  TERRAIN_GRID,
  WORLD_SIZE,
  decodeDelta,
  decodeSetMap,
  decodeSnapshot,
  isSubstrateWorld,
  substrateKind,
  type SimStats,
  type SubstrateConfig,
  type SubstrateKind,
  type WorldConfig,
} from '@fractal-life/shared';
import {
  LatticeSubstrate,
  SubstrateEngine,
  createSubstrateKernel,
} from '../src/substrates/index.js';
import { ConsoleSession } from '../src/tui/session.js';

const KINDS: SubstrateKind[] = ['particles', 'lattice', 'graph'];
const TOTAL = TERRAIN_GRID * TERRAIN_GRID;

function world(kind: SubstrateKind, seed = 'substrate-test', extra?: Partial<SubstrateConfig>): WorldConfig {
  return {
    id: `test-${kind}`,
    seed,
    fractalType: 'mandelbrot',
    params: { ...DEFAULT_PARAMS },
    createdAt: 1_700_000_000_000,
    currentTick: 0,
    ...(kind === 'agents' ? {} : { substrate: { kind, ...extra } }),
  };
}

function run(engine: SubstrateEngine, ticks: number): void {
  for (let i = 0; i < ticks; i++) engine.tick();
}

function stateHashes(engine: SubstrateEngine, ticks: number, every: number): number[] {
  const out: number[] = [];
  for (let i = 1; i <= ticks; i++) {
    engine.tick();
    if (i % every === 0) out.push(engine.stats().stateHash);
  }
  return out;
}

function assertFinite(s: SimStats): void {
  for (const v of Object.values(s)) {
    assert.ok(typeof v !== 'number' || Number.isFinite(v), `non-finite stat: ${String(v)}`);
  }
}

describe('substrate construction', () => {
  it('agents worlds have no substrate kernel', () => {
    assert.equal(createSubstrateKernel(world('agents')), null);
    const agentWithFlag = world('agents', 's', {});
    assert.equal(createSubstrateKernel({ ...agentWithFlag, substrate: { kind: 'agents' } }), null);
    assert.throws(() => new SubstrateEngine(world('agents')), /no substrate kernel/);
  });

  it('substrateKind defaults to agents and reads the world field', () => {
    assert.equal(substrateKind({ ...world('agents') }), 'agents');
    assert.equal(substrateKind(world('lattice')), 'lattice');
    assert.equal(isSubstrateWorld(world('graph')), true);
    assert.equal(isSubstrateWorld(world('agents')), false);
  });

  it('each kind builds its kernel and the adapter reports it', () => {
    for (const kind of KINDS) {
      const engine = new SubstrateEngine(world(kind));
      assert.equal(engine.kind, kind);
    }
  });
});

describe('substrate determinism', () => {
  for (const kind of KINDS) {
    it(`${kind}: identical seeds tick identically, different seeds diverge`, () => {
      const a = new SubstrateEngine(world(kind, 'det-seed'));
      const b = new SubstrateEngine(world(kind, 'det-seed'));
      const c = new SubstrateEngine(world(kind, 'det-seed-other'));
      const ha = stateHashes(a, 150, 15);
      const hb = stateHashes(b, 150, 15);
      const hc = stateHashes(c, 150, 15);
      assert.ok(ha.length > 0);
      assert.deepEqual(ha, hb);
      assert.deepEqual(a.stats(), b.stats());
      assert.ok(
        ha.some((v, i) => v !== hc[i]),
        `${kind}: different seeds produced identical hashes across all checkpoints`,
      );
    });
  }

  it('lattice noise knob changes the trajectory', () => {
    const clean = new SubstrateEngine(world('lattice', 'noise-knob'));
    const noisy = new SubstrateEngine(world('lattice', 'noise-knob', { noise: 0.05 }));
    const h0 = stateHashes(clean, 30, 10);
    const h1 = stateHashes(noisy, 30, 10);
    assert.ok(h0.some((v, i) => v !== h1[i]));
  });
});

describe('lattice substrate', () => {
  it('a seeded glider translates +1,+1 every four ticks', () => {
    const kernel = new LatticeSubstrate(world('lattice', 'glider'));
    for (let y = 0; y < TERRAIN_GRID; y++) {
      for (let x = 0; x < TERRAIN_GRID; x++) kernel.setCell(x, y, false);
    }
    const glider: Array<[number, number]> = [[1, 0], [2, 1], [0, 2], [1, 2], [2, 2]];
    for (const [x, y] of glider) kernel.setCell(x, y, true);

    const expect = (dx: number, dy: number): void => {
      const alive = new Set(glider.map(([x, y]) => `${x + dx},${y + dy}`));
      for (let y = 0; y < 5; y++) {
        for (let x = 0; x < 5; x++) {
          assert.equal(kernel.getCell(x, y), alive.has(`${x},${y}`) ? 1 : 0, `cell ${x},${y} after +${dx},+${dy}`);
        }
      }
    };

    kernel.step();
    kernel.step();
    kernel.step();
    kernel.step();
    expect(1, 1);
    kernel.step();
    kernel.step();
    kernel.step();
    kernel.step();
    expect(2, 2);
    assert.equal(kernel.population, 5);
  });

  it('soup churns with births and deaths and coherent stats', () => {
    const engine = new SubstrateEngine(world('lattice', 'soup'));
    for (let i = 0; i < 100; i++) engine.tick();
    const s = engine.stats();
    assert.ok(s.births > 0, 'soup produced births');
    assert.ok(s.deaths > 0, 'soup produced deaths');
    assert.ok(s.population > 0 && s.population <= TOTAL);
    assert.ok(s.caAliveFraction >= 0 && s.caAliveFraction <= 1);
    assert.ok(Math.abs(s.caAliveFraction - s.population / TOTAL) < 1e-9);
    assert.ok(s.caComplexity >= 0 && s.caComplexity <= 1);
    assert.ok(s.stateHash >= 0);
    assertFinite(s);
  });

  it('setMap frame carries a full 128 grid matching the population', () => {
    const engine = new SubstrateEngine(world('lattice', 'setmap'));
    run(engine, 12);
    const map = decodeSetMap(engine.encodeSetMapMessage());
    assert.equal(map.size, TERRAIN_GRID);
    assert.equal(map.depth.length, TOTAL);
    assert.equal(map.escape.length, TOTAL);
    let sum = 0;
    for (const v of map.depth) sum += v;
    assert.equal(Math.round(sum / 255), engine.stats().population);
  });

  it('extinction surfaces as an event', () => {
    const engine = new SubstrateEngine(world('lattice', 'extinct'));
    run(engine, 3);
    assert.ok(engine.stats().population > 0);
    engine.applyIntervention({
      type: 'nuke',
      x: WORLD_SIZE / 2,
      y: WORLD_SIZE / 2,
      radius: WORLD_SIZE * 4,
      sequence: 0,
    });
    const { events } = engine.tick();
    assert.ok(events.some((e) => e.type === 'intervention'));
    assert.ok(events.some((e) => e.type === 'extinction'));
    assert.equal(engine.stats().population, 0);
  });
});

describe('particles substrate', () => {
  it('a colony is born, grows and stays within the population cap', () => {
    const engine = new SubstrateEngine(world('particles', 'colony'));
    const cap = Math.min(MAX_AGENTS, Math.round(DEFAULT_PARAMS.maxPopulation));
    run(engine, 800);
    const s = engine.stats();
    assert.ok(s.births > 0, 'colony reproduced');
    assert.ok(s.population > 0, 'colony survived');
    assert.ok(s.population <= cap, `population ${s.population} <= cap ${cap}`);
    assert.ok(s.speciesCount >= 1);
    assert.ok(s.avgEnergy > 0);
    assert.ok(s.entropy >= 0 && s.spatialEntropy >= 0 && s.metabolicRate > 0);
    assert.equal(s.aliveCount, s.population);
    assertFinite(s);
  });

  it('rows are normalised to the wire contract', () => {
    const engine = new SubstrateEngine(world('particles', 'wire'));
    run(engine, 25);
    const stats = engine.stats();
    const snap = decodeSnapshot(engine.encodeSnapshotMessage());
    assert.equal(snap.tick, engine.currentTick);
    assert.equal(snap.aliveCount, stats.population);
    assert.equal(snap.agents.length, stats.population);
    assert.equal(snap.speciesCount, stats.speciesCount);
    for (const a of snap.agents) {
      assert.ok(a.energy >= 0 && a.energy <= 1, `energy ${a.energy} in [0,1]`);
      assert.ok(a.x >= 0 && a.x <= WORLD_SIZE && a.y >= 0 && a.y <= WORLD_SIZE);
      assert.ok(Number.isFinite(a.state));
    }
  });
});

describe('graph substrate', () => {
  it('an excitable colony buds, starves and stays under the cap', () => {
    const engine = new SubstrateEngine(world('graph', 'colony'));
    run(engine, 800);
    const s = engine.stats();
    assert.ok(s.births > 0, 'graph budded');
    assert.ok(s.deaths > 0, 'graph starved');
    assert.ok(s.population > 0 && s.population <= 3000);
    assert.ok(s.speciesCount >= 1);
    assert.ok(s.entropy >= 0);
    assert.ok(s.clusterOrder >= 0 && s.clusterOrder <= 1);
    assert.equal(s.aliveCount, s.population);
    assertFinite(s);
  });
});

describe('SubstrateEngine wire surface', () => {
  it('delta frames decode and can be suppressed', () => {
    const engine = new SubstrateEngine(world('particles', 'delta'));
    const first = engine.tick();
    const d0 = decodeDelta(first.delta);
    assert.equal(d0.tick, engine.currentTick);
    assert.equal(d0.agents.length, engine.stats().population);
    engine.setRecordDelta(false);
    const off = engine.tick();
    assert.equal(off.delta.byteLength, 0);
    engine.setRecordDelta(true);
    const on = engine.tick();
    assert.ok(on.delta.byteLength > 0);
  });

  it('status, summaries, radar and logs stay neutral but coherent', () => {
    const engine = new SubstrateEngine(world('graph', 'surface'));
    run(engine, 5);
    const s = engine.stats();
    const status = engine.worldStatus(true);
    assert.equal(status.currentTick, s.tick);
    assert.equal(status.population, s.population);
    assert.equal(status.speciesCount, s.speciesCount);
    assert.equal(status.interventions, 0);
    assert.equal(status.paused, true);
    assert.equal(engine.agentSummaries().length, s.population);
    assert.equal(engine.radarSample().tick, s.tick);
    assert.deepEqual(engine.getInterventionLog(), []);
    assert.deepEqual(engine.buildLineage(), []);
    engine.setBrainConfig({ ignored: true });
    engine.setWorldStochastics({ ignored: true });
    run(engine, 2);
    assert.equal(engine.currentTick, s.tick + 2);
  });

  it('snapshot ticks match stats and populations', () => {
    for (const kind of KINDS) {
      const engine = new SubstrateEngine(world(kind, 'snap'));
      run(engine, 8);
      const s = engine.stats();
      const snap = decodeSnapshot(engine.encodeSnapshotMessage());
      assert.equal(snap.tick, s.tick, kind);
      assert.equal(snap.aliveCount, s.population, kind);
      assert.equal(snap.agents.length, s.population, kind);
      assert.equal(snap.speciesCount, s.speciesCount, kind);
    }
  });
});

describe('SubstrateEngine interventions', () => {
  it('spawn and setTimeScale apply immediately and emit an event', () => {
    const engine = new SubstrateEngine(world('particles', 'iv'));
    const before = engine.stats().population;
    engine.applyIntervention({ type: 'spawnAgent', x: 512, y: 512, sequence: 0 });
    assert.equal(engine.stats().population, before + 1);
    engine.applyIntervention({ type: 'setTimeScale', timeScale: 2, sequence: 1 });
    assert.equal(engine.stats().timeScale, 2);
    const { events } = engine.tick();
    const interventions = events.filter((e) => e.type === 'intervention');
    assert.equal(interventions.length, 2);
    assert.equal(engine.worldStatus(false).interventions, 2);
  });

  it('nuke reduces the population; feed never adds bodies', () => {
    const engine = new SubstrateEngine(world('particles', 'nuke'));
    run(engine, 10);
    const before = engine.stats().population;
    engine.applyIntervention({ type: 'nuke', x: WORLD_SIZE / 2, y: WORLD_SIZE / 2, radius: WORLD_SIZE, sequence: 0 });
    const afterKill = engine.stats().population;
    assert.ok(afterKill < before, `nuke killed (${before} -> ${afterKill})`);
    engine.applyIntervention({ type: 'seedFood', x: 256, y: 256, amount: 500, sequence: 1 });
    assert.equal(engine.stats().population, afterKill);
    run(engine, 20);
    assert.ok(engine.stats().population <= afterKill + 5, 'no body explosion from feed');
  });

  it('lattice kill targets cells by world coordinates', () => {
    const kernel = new LatticeSubstrate(world('lattice', 'kill'));
    for (let y = 0; y < TERRAIN_GRID; y++) {
      for (let x = 0; x < TERRAIN_GRID; x++) kernel.setCell(x, y, false);
    }
    kernel.setCell(4, 4, true);
    kernel.setCell(0, 0, true);
    const killed = kernel.kill(70, 70, 50);
    assert.equal(killed, 1);
    assert.equal(kernel.getCell(4, 4), 0);
    assert.equal(kernel.getCell(0, 0), 1);
    assert.equal(kernel.population, 1);
  });
});

describe('console session substrate integration', () => {
  it('runs a substrate backend through the TerminalHost surface', () => {
    const sess = new ConsoleSession('substrate-sess', 30, { kind: 'lattice' });
    assert.equal(sess.describe().backend, 'substrate:lattice');
    assert.equal(sess.stats().tick, 0);
    sess.step(3);
    const s = sess.stats();
    assert.equal(s.tick, 3);
    assert.equal(s.speciesCount, 1);
    sess.spawn(2);
    sess.step(1);
    assert.equal(sess.stats().tick, 4);
    assert.equal(sess.describe().backend, 'substrate:lattice');
    sess.control('pause');
    sess.advance();
    assert.equal(sess.stats().tick, 4, 'paused session does not advance');
    sess.reset();
    assert.equal(sess.stats().tick, 0, 'reset rewinds the substrate');
  });

  it('defaults to the TS reference engine', () => {
    const sess = new ConsoleSession('plain', 30);
    assert.equal(sess.describe().backend, 'ts-reference');
  });
});
