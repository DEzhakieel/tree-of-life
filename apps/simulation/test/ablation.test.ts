import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Engine } from '../src/engine.js';
import { makeWorld } from '../src/research/scenarios.js';
import { fullStateHash } from '../src/research/snapshot.js';

/**
 * Ablation gate.
 *
 * Every faculty in the engine has a switch that turns it off without touching
 * the rest of the world, so a claim ("culture matters", "movement matters") can
 * be tested against a control that is identical in every other respect. This
 * file asserts that each switch does exactly what it advertises and that an
 * ablated world is still fully deterministic:
 *
 *   repetition?      no births appear            (`reproduction: false`)
 *   sensing?         founders hold position      (`sensing: false`)
 *   culture?         tags collapse, entropy 0    (`memeCopyRate: 0`)
 *   communication?   no signal is deposited      (`signalDeposit: 0`)
 *   plasticity?      brains report as disabled   (`setBrainConfig({enabled:false})`)
 */

type World = ConstructorParameters<typeof Engine>[0];

function world(seed: string, extra: Partial<World>): World {
  return { ...makeWorld(seed, 20, { maxIter: 2 }), ...extra } as World;
}

function run(engine: Engine, ticks: number): void {
  for (let t = 0; t < ticks; t++) engine.tick();
}

describe('ablation · reproduction off forbids births', () => {
  it('reports zero births and never grows the population', () => {
    const eng = new Engine(world('abl.repro', { reproduction: false }));
    const spawn = eng.agents.size;
    for (let t = 0; t < 80; t++) {
      const s = eng.tick().stats;
      assert.equal(s.births, 0, `birth at tick ${t}`);
      assert.ok(s.aliveCount <= spawn, `population grew: ${s.aliveCount} > ${spawn}`);
    }
  });
});

describe('ablation · sensing off freezes the sensorimotor loop', () => {
  it('founders that survive keep their exact position', () => {
    const eng = new Engine(world('abl.sense', { sensing: false }));
    const start = new Map<number, { x: number; y: number }>();
    for (const a of eng.agents.values()) start.set(a.id, { x: a.x, y: a.y });
    run(eng, 40);
    let survivors = 0;
    for (const a of eng.agents.values()) {
      if (!a.alive) continue;
      const s = start.get(a.id);
      if (!s) continue; // offspring, not a founder
      survivors++;
      assert.ok(Math.abs(a.x - s.x) < 1e-9, `agent ${a.id} moved in x`);
      assert.ok(Math.abs(a.y - s.y) < 1e-9, `agent ${a.id} moved in y`);
    }
    assert.ok(survivors > 0, 'expected at least one founder to survive');
  });
});

describe('ablation · culture off collapses the meme channel', () => {
  it('memeCopyRate = 0 yields at most one cultural tag and zero meme entropy', () => {
    const eng = new Engine(world('abl.culture', { memeCopyRate: 0 }));
    run(eng, 60);
    const s = eng.stats();
    assert.ok(s.cultureCount <= 1, `cultureCount ${s.cultureCount}`);
    assert.ok(s.memeEntropy < 1e-9, `memeEntropy ${s.memeEntropy}`);
  });
});

describe('ablation · communication off deposits no signal', () => {
  it('signalDeposit = 0 leaves the pheromone field empty', () => {
    const eng = new Engine(world('abl.signal', { signalDeposit: 0 }));
    run(eng, 60);
    let max = 0;
    for (const v of eng.grid.signal) if (v > max) max = v;
    assert.ok(max <= 1e-9, `signal field not empty: max ${max}`);
  });
});

describe('ablation · brains off report as disabled and unlearned', () => {
  it('setBrainConfig({enabled:false}) zeroes plasticity telemetry', () => {
    const eng = new Engine(world('abl.brain', {}));
    eng.setBrainConfig({ enabled: false });
    run(eng, 40);
    const bs = eng.brainStats();
    assert.equal(bs.enabled, false);
    assert.equal(bs.meanPlasticity, 0);
    assert.equal(bs.plasticAgents, 0);
    assert.equal(eng.stats().meanPlasticity, 0);
    assert.equal(eng.stats().plasticAgents, 0);
  });

  it('brains on report as enabled', () => {
    const eng = new Engine(world('abl.brain.on', {}));
    eng.setBrainConfig({ enabled: true });
    run(eng, 20);
    assert.equal(eng.brainStats().enabled, true);
  });
});

describe('ablation · ablated worlds remain deterministic', () => {
  const cases: [string, Partial<World>][] = [
    ['reproduction', { reproduction: false }],
    ['sensing', { sensing: false }],
    ['culture', { memeCopyRate: 0 }],
    ['signal', { signalDeposit: 0 }],
  ];
  for (const [name, extra] of cases) {
    it(`${name} ablation replays bit-for-bit`, () => {
      const w = world(`abl.fp.${name}`, extra);
      const a = new Engine(w);
      const b = new Engine(w);
      for (let t = 0; t < 40; t++) {
        a.tick();
        b.tick();
        assert.equal(fullStateHash(a), fullStateHash(b), `${name}: divergence at tick ${t}`);
      }
    });
  }
});
