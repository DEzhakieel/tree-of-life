import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MT,
  encodeAck,
  encodeDelta,
  encodeEvent,
  encodeSetMap,
  encodeSnapshot,
  encodeStats,
  encodeWorld,
  decodeAck,
  decodeDelta,
  decodeJsonMessage,
  decodeServerFrame,
  decodeSetMap,
  decodeSnapshot,
  decodeStats,
  type SimEvent,
} from '../src/index.js';

const agents = [
  { id: 0, x: 0, y: 0, energy: 0.5, state: 0, species: 7, meme: 0.25 },
  { id: 5, x: 1000.5, y: 777.25, energy: 1, state: 0, species: 59216, meme: 0.75 },
  { id: 9000, x: 2047, y: 2047, energy: 0.01, state: 2, species: 70000, meme: 0.1 },
];

test('snapshot round-trips', () => {
  const bytes = encodeSnapshot(1234, 0.5, 42, 3, agents);
  const decoded = decodeSnapshot(bytes);
  assert.equal(decoded.tick, 1234);
  assert.equal(decoded.timeScale, 0.5);
  assert.equal(decoded.speciesCount, 42);
  assert.equal(decoded.aliveCount, 3);
  assert.equal(decoded.agents.length, 3);
  assert.deepEqual(
    decoded.agents.map((a) => ({ id: a.id, state: a.state, species: a.species })),
    [
      { id: 0, state: 0, species: 7 },
      { id: 5, state: 0, species: 59216 },
      { id: 9000, state: 2, species: 70000 },
    ],
  );
  // meme survives u8*255 quantisation
  assert.ok(Math.abs(decoded.agents[0]!.meme - 0.25) < 0.01);
  assert.ok(Math.abs(decoded.agents[1]!.meme - 0.75) < 0.01);
  // positions survive fixed-point quantisation
  assert.ok(Math.abs(decoded.agents[1]!.x - 1000.5) < 0.01);
  assert.ok(Math.abs(decoded.agents[1]!.y - 777.25) < 0.01);
});

test('delta round-trips', () => {
  const bytes = encodeDelta(99, [agents[1]!]);
  const decoded = decodeDelta(bytes);
  assert.equal(decoded.tick, 99);
  assert.equal(decoded.agents.length, 1);
  assert.equal(decoded.agents[0]!.id, 5);
  assert.equal(decoded.agents[0]!.species, 59216);
});

test('stats round-trips', () => {
  const stats = {
    tick: 55,
    population: 400,
    aliveCount: 350,
    deadCount: 12,
    speciesCount: 90,
    avgEnergy: 0.42,
    avgWater: 0.31,
    tickRate: 59.4,
    stateHash: 0xdeadbeef,
    energySum: 147,
    births: 8,
    deaths: 12,
    escapeDeaths: 3,
    entropy: 3.21,
    diversity: 0.87,
    complexity: 0.142,
    cooperation: 0.004,
    predatorFraction: 0.25,
    cultureCount: 17,
    meanAltruism: 0.019,
    memeEntropy: 2.5,
    speciesMemeMI: 0.63,
  };
  const decoded = decodeStats(encodeStats(stats as never));
  assert.equal(decoded.tick, 55);
  assert.equal(decoded.aliveCount, 350);
  assert.equal(decoded.speciesCount, 90);
  assert.equal(decoded.escapeDeaths, 3);
  assert.ok(Math.abs(decoded.avgEnergy - 0.42) < 1e-4);
  assert.ok(Math.abs(decoded.tickRate - 59.4) < 1e-4);
  assert.equal(decoded.stateHash, 0xdeadbeef >>> 0);
  assert.ok(Math.abs(decoded.entropy - 3.21) < 1e-4);
  assert.ok(Math.abs(decoded.diversity - 0.87) < 1e-4);
  assert.ok(Math.abs(decoded.complexity - 0.142) < 1e-4);
  assert.ok(Math.abs(decoded.cooperation - 0.004) < 1e-4);
  assert.ok(Math.abs(decoded.predatorFraction - 0.25) < 1e-4);
  assert.equal(decoded.cultureCount, 17);
  assert.ok(Math.abs(decoded.meanAltruism - 0.019) < 1e-4);
  assert.ok(Math.abs(decoded.memeEntropy - 2.5) < 1e-4);
  assert.ok(Math.abs(decoded.speciesMemeMI - 0.63) < 1e-4);
});

test('evolved set round-trips', () => {
  const size = 8;
  const depth = new Uint8Array(size * size);
  const escape = new Uint8Array(size * size);
  depth[5] = 42;
  depth[63] = 255;
  escape[10] = 255;
  const bytes = encodeSetMap(777, size, depth, escape);
  assert.equal(bytes[0], MT.SET);
  const decoded = decodeSetMap(bytes);
  assert.equal(decoded.tick, 777);
  assert.equal(decoded.size, size);
  assert.deepEqual(Array.from(decoded.depth), Array.from(depth));
  assert.deepEqual(Array.from(decoded.escape), Array.from(escape));

  const frame = decodeServerFrame(bytes);
  assert.equal(frame.kind, 'set');
  if (frame.kind === 'set') assert.equal(frame.msg.tick, 777);
});

test('world / event / ack round-trip through decodeServerFrame', () => {
  const world = {
    id: 'w1',
    seed: 'seed-1',
    fractalType: 'julia' as const,
    params: {} as never,
    createdAt: 1,
    currentTick: 10,
  };
  const status = {
    id: 'w1',
    seed: 'seed-1',
    fractalType: 'julia' as const,
    params: {} as never,
    currentTick: 10,
    population: 5,
    aliveCount: 5,
    speciesCount: 2,
    createdAt: 1,
    interventions: 0,
  };
  const worldFrame = decodeServerFrame(encodeWorld(world, status));
  assert.equal(worldFrame.kind, 'world');
  if (worldFrame.kind === 'world') {
    assert.equal(worldFrame.world.id, 'w1');
    assert.equal(worldFrame.status.population, 5);
  }

  const event = { worldId: 'w1', tick: 10, type: 'cambrian' as const, significance: 0.5, data: {} };
  const eventFrame = decodeServerFrame(encodeEvent(event));
  assert.equal(eventFrame.kind, 'event');
  if (eventFrame.kind === 'event') assert.equal(eventFrame.event.type, 'cambrian');

  const ack = decodeAck(encodeAck(123456));
  assert.equal(ack, 123456);

  const s = {
    tick: 55,
    population: 400,
    aliveCount: 350,
    deadCount: 12,
    speciesCount: 90,
    avgEnergy: 0.42,
    tickRate: 59.4,
    stateHash: 0xdeadbeef,
    births: 8,
    deaths: 12,
  };
  assert.equal(new Uint8Array(encodeSnapshot(0, 1, 0, 0, []))[0], MT.SNAPSHOT);
  assert.equal(new Uint8Array(encodeDelta(0, []))[0], MT.DELTA);
  assert.equal(new Uint8Array(encodeStats(s as never))[0], MT.STATS);
});

test('snapshot frame decodes via decodeServerFrame', () => {
  const bytes = encodeSnapshot(7, 1, 3, 2, agents);
  const frame = decodeServerFrame(bytes);
  assert.equal(frame.kind, 'snapshot');
  if (frame.kind === 'snapshot') {
    assert.equal(frame.msg.tick, 7);
    assert.equal(frame.msg.agents.length, 3);
  }
});

test('decodeJsonMessage round-trips payloads', () => {
  const bytes = encodeEvent({ worldId: 'w', tick: 1, type: 'extinction', significance: 1, data: { from: 10, to: 4 } });
  const obj = decodeJsonMessage(bytes, MT.EVENT) as { type: string; data: { from: number } };
  assert.equal(obj.type, 'extinction');
  assert.equal(obj.data.from, 10);
});

test('event round-trips through the wire with full payloads', () => {
  const death: SimEvent = {
    worldId: 'w1',
    tick: 42,
    type: 'death',
    significance: 0.5,
    data: { agentId: 7, cause: 'predation', species: 3, x: 12.5, y: 80.25, age: 100, energy: 0, killerId: 9 },
  };
  const birth: SimEvent = {
    worldId: 'w1',
    tick: 43,
    type: 'birth',
    significance: 0.15,
    data: { agentId: 8, parentId: 7, species: 3, x: 13, y: 81, energy: 22 },
  };
  const iv: SimEvent = {
    worldId: 'w1',
    tick: 44,
    type: 'intervention',
    significance: 1,
    data: { itype: 'meteor', x: 5, y: 6 },
  };
  for (const ev of [death, birth, iv]) {
    const frame = decodeServerFrame(encodeEvent(ev));
    assert.equal(frame.kind, 'event');
    if (frame.kind !== 'event') throw new Error('unreachable');
    assert.deepEqual(frame.event, ev);
  }
});
