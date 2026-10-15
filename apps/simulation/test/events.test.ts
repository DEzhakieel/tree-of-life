import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { WorldConfig, SimEvent, EventType } from '@fractal-life/shared';
import { DEFAULT_PARAMS } from '@fractal-life/shared';
import { Engine } from '../src/engine.js';

function makeWorld(seed: string, paramOverrides: Partial<typeof DEFAULT_PARAMS> = {}, configOverrides: Partial<WorldConfig> = {}): WorldConfig {
  return {
    id: `events-${seed}`,
    seed,
    fractalType: 'mandelbrot',
    params: { ...DEFAULT_PARAMS, ...paramOverrides },
    createdAt: 0,
    currentTick: 0,
    ...configOverrides,
  };
}

const byType = <T extends EventType>(events: SimEvent[], type: T): Array<Extract<SimEvent, { type: T }>> =>
  events.filter((e): e is Extract<SimEvent, { type: T }> => e.type === type);

const isDeathCause = (c: unknown): boolean =>
  c === 'starvation' || c === 'thirst' || c === 'age' || c === 'predation' || c === 'escape' || c === 'intervention';

describe('event emission', () => {
  it('emits death events with typed payloads', () => {
    const e = new Engine(makeWorld('death', { spawnCount: 60 }));
    const all: SimEvent[] = [];
    for (let i = 0; i < 300; i++) all.push(...e.tick().events);
    const deaths = byType(all, 'death');
    assert.ok(deaths.length > 0, 'expected at least one death in 300 ticks');
    for (const d of deaths) {
      assert.equal(typeof d.data.agentId, 'number');
      assert.ok(isDeathCause(d.data.cause), `unexpected cause ${d.data.cause}`);
      assert.equal(typeof d.data.species, 'number');
      assert.equal(typeof d.data.x, 'number');
      assert.equal(typeof d.data.y, 'number');
      assert.equal(typeof d.data.age, 'number');
      assert.ok(d.significance >= 0 && d.significance <= 1);
      if (d.data.killerId !== undefined) assert.ok(d.data.killerId >= 0);
    }
  });

  it('emits birth events with parent attribution when agents reproduce', () => {
    const e = new Engine(makeWorld('birth', { spawnCount: 80 }));
    const all: SimEvent[] = [];
    for (let i = 0; i < 600; i++) all.push(...e.tick().events);
    const births = byType(all, 'birth');
    assert.ok(births.length > 0, 'expected at least one birth in 600 ticks');
    for (const b of births) {
      assert.equal(typeof b.data.agentId, 'number');
      assert.equal(typeof b.data.parentId, 'number');
      assert.equal(typeof b.data.species, 'number');
      assert.ok(b.data.energy > 0);
    }
  });

  it('population detectors emit typed payloads', () => {
    const e = new Engine(makeWorld('pop', { spawnCount: 0 }));
    const st = e as unknown as { prevAlive: number; prevSpecies: number };
    st.prevAlive = 100;
    st.prevSpecies = 5;
    // 10 alive < 50% of 100 -> extinction; 40 starvation deaths > 15 -> famine
    e.detectEvents(10, 6, 0, 0, 40, 0, 0);
    const r = e.tick();
    const ext = byType(r.events, 'extinction');
    assert.equal(ext.length, 1);
    assert.deepEqual(ext[0]!.data, { from: 100, to: 10 });
    const fam = byType(r.events, 'famine');
    assert.equal(fam.length, 1);
    assert.deepEqual(fam[0]!.data, { deaths: 40 });
  });

  it('emits intervention events with itype payload', () => {
    const e = new Engine(makeWorld('iv', { spawnCount: 30 }));
    e.tick();
    e.applyIntervention({ type: 'meteor', x: 50, y: 50, radius: 30, sequence: 1 });
    const r = e.tick();
    const ivs = byType(r.events, 'intervention');
    assert.equal(ivs.length, 1);
    assert.equal(ivs[0]!.data.itype, 'meteor');
    assert.equal(ivs[0]!.data.x, 50);
    assert.equal(ivs[0]!.data.y, 50);
    assert.equal(ivs[0]!.significance, 1);
  });
});

describe('event buffer semantics', () => {
  it('events pushed between ticks arrive with the next tick (no tick-start wipe)', () => {
    const e = new Engine(makeWorld('between', { spawnCount: 30 }));
    e.tick();
    e.applyIntervention({ type: 'seedFood', x: 10, y: 10, amount: 5, sequence: 1 });
    const r = e.tick();
    assert.equal(byType(r.events, 'intervention').length, 1);
  });

  it('previously returned event arrays are snapshots, not the live buffer', () => {
    const e = new Engine(makeWorld('alias', { spawnCount: 40 }));
    e.tick();
    const r1 = e.tick();
    const frozen = JSON.stringify(r1.events);
    e.applyIntervention({ type: 'seedFood', x: 20, y: 20, amount: 5, sequence: 1 });
    for (let i = 0; i < 3; i++) e.tick();
    assert.equal(JSON.stringify(r1.events), frozen, 'returned events must not be mutated by later ticks');
  });
});

describe('event policy', () => {
  it('honours WorldConfig.eventPolicy.include', () => {
    const e = new Engine(makeWorld('policy', { spawnCount: 40 }, { eventPolicy: { include: ['intervention'] } }));
    for (let i = 0; i < 150; i++) {
      for (const ev of e.tick().events) {
        assert.equal(ev.type, 'intervention', 'non-included event types must not be emitted');
      }
    }
    e.applyIntervention({ type: 'nuke', x: 30, y: 30, radius: 20, sequence: 1 });
    const r = e.tick();
    const ivs = byType(r.events, 'intervention');
    assert.equal(ivs.length, 1);
    assert.equal(ivs[0]!.data.itype, 'nuke');
  });

  it('emits every type when no policy is set', () => {
    const e = new Engine(makeWorld('nopoly', { spawnCount: 60 }));
    e.applyIntervention({ type: 'seedFood', x: 1, y: 1, amount: 1, sequence: 1 });
    const all: SimEvent[] = [];
    for (let i = 0; i < 50; i++) all.push(...e.tick().events);
    assert.ok(all.some((ev) => ev.type === 'intervention'));
    assert.ok(all.some((ev) => ev.type === 'death'), 'default policy must not filter death events');
  });
});
