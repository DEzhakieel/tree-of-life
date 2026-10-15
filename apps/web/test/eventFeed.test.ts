import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import type { DeathCause, SimEvent } from '@fractal-life/shared';
import {
  EVENT_FEED_CAP,
  EVENT_MARK_CAP,
  useStore,
} from '../src/store/useStore.js';
import {
  EVENT_HEX,
  EVENT_TEXT,
  countByEventType,
  filterMarks,
  significanceHeight,
  summarizeEvent,
  timelineDomain,
  timelineScale,
  typeEnabled,
} from '../src/lib/eventFeed.js';

const death = (tick: number, cause: DeathCause = 'age'): SimEvent => ({
  worldId: 'w',
  tick,
  significance: 0.3,
  type: 'death',
  data: { agentId: tick, cause, species: 0, x: 0, y: 0, age: 5, energy: 0 },
});

const war = (tick: number): SimEvent => ({
  worldId: 'w',
  tick,
  significance: 0.9,
  type: 'war',
  data: { deaths: 4 },
});

const intervention = (tick: number): SimEvent => ({
  worldId: 'w',
  tick,
  significance: 1,
  type: 'intervention',
  data: { itype: 'meteor', x: 10, y: 20 },
});

describe('event payload summaries', () => {
  it('uses type-specific fields', () => {
    assert.equal(summarizeEvent({ type: 'death', data: { cause: 'starvation' } }), 'cause=starvation');
    assert.equal(summarizeEvent({ type: 'war', data: { deaths: 4 } }), 'deaths=4');
    assert.equal(summarizeEvent({ type: 'famine', data: { deaths: 2 } }), 'deaths=2');
    assert.equal(summarizeEvent({ type: 'birth', data: { species: 7 } }), 'species=7');
    assert.equal(summarizeEvent({ type: 'extinction', data: { from: 40, to: 0 } }), '40→0');
    assert.equal(summarizeEvent({ type: 'migration', data: { distance: 12.5 } }), 'distance=12.5');
    assert.equal(summarizeEvent({ type: 'predation', data: { bite: 0.4 } }), 'bite=0.4');
    assert.equal(summarizeEvent({ type: 'discovery', data: { novelty: 0.8 } }), 'novelty=0.8');
    assert.equal(summarizeEvent({ type: 'intervention', data: { itype: 'meteor' } }), 'meteor');
    assert.equal(summarizeEvent({ type: 'symbiosis', data: { species: 2 } }), 'species=2');
  });

  it('falls back for unknown shapes and truncates long values', () => {
    assert.equal(summarizeEvent({ type: 'war', data: {} }), 'war');
    assert.equal(summarizeEvent({ type: 'death', data: { cause: 'x'.repeat(80) } }).length <= 32, true);
  });
});

describe('timeline math', () => {
  it('never produces a degenerate domain', () => {
    assert.deepEqual(timelineDomain([], 0), { start: 0, end: 1 });
    assert.deepEqual(timelineDomain([], -5), { start: 0, end: 1 });
    assert.deepEqual(timelineDomain([{ tick: 500 }], 400), { start: 0, end: 500 });
    assert.deepEqual(timelineDomain([{ tick: 500 }], 900), { start: 0, end: 900 });
  });

  it('maps ticks to pixels and clamps strays', () => {
    const x = timelineScale({ start: 0, end: 100 }, 200);
    assert.equal(x(0), 0);
    assert.equal(x(50), 100);
    assert.equal(x(150), 200);
    assert.equal(x(-10), 0);
    const shifted = timelineScale({ start: 100, end: 200 }, 100);
    assert.equal(shifted(100), 0);
    assert.equal(shifted(200), 100);
  });

  it('bar height tracks significance with a floor', () => {
    assert.equal(significanceHeight(0, 46), 4);
    assert.equal(significanceHeight(1, 46), 34);
    assert.equal(significanceHeight(NaN, 46), 4);
    assert.ok(significanceHeight(0.5, 46) > significanceHeight(0.1, 46));
  });
});

describe('type filtering', () => {
  const marks = [
    { type: 'war', tick: 1 },
    { type: 'war', tick: 2 },
    { type: 'famine', tick: 3 },
  ];

  it('counts per type', () => {
    const counts = countByEventType(marks);
    assert.equal(counts.get('war'), 2);
    assert.equal(counts.get('famine'), 1);
    assert.equal(counts.get('death'), undefined);
  });

  it('empty set means everything is enabled', () => {
    assert.equal(typeEnabled('war', null), true);
    assert.equal(typeEnabled('war', new Set()), true);
    assert.equal(typeEnabled('war', new Set(['famine'])), false);
    assert.equal(typeEnabled('famine', new Set(['famine'])), true);
    assert.equal(filterMarks(marks, null).length, 3);
    assert.equal(filterMarks(marks, new Set()).length, 3);
    assert.equal(filterMarks(marks, new Set(['war'])).length, 2);
    assert.equal(filterMarks(marks, new Set(['death'])).length, 0);
  });
});

describe('feed store', () => {
  beforeEach(() => {
    useStore.getState().clearEvents();
  });

  it('pushes a batch newest-first with monotonic ids across calls', () => {
    const st = useStore.getState();
    st.pushEvents([death(1), war(2), death(3)]);
    let s = useStore.getState();
    assert.equal(s.events.length, 3);
    assert.equal(s.eventMarks.length, 3);
    assert.equal(s.events[0]!.type, 'death');
    assert.equal(s.events[0]!.tick, 3);
    assert.equal(s.eventMarks[0]!.tick, 3);
    assert.equal(s.eventCounter, 3);

    useStore.getState().pushEvent(intervention(4));
    s = useStore.getState();
    assert.equal(s.events[0]!.tick, 4);
    assert.equal(s.events[0]!.id, 3);
    assert.equal(s.eventCounter, 4);

    useStore.getState().pushEvents([]);
    assert.equal(useStore.getState().eventCounter, 4);
  });

  it('caps the detailed feed and the mark strip independently', () => {
    const big: SimEvent[] = [];
    for (let t = 0; t < EVENT_MARK_CAP + 100; t++) big.push(death(t));
    useStore.getState().pushEvents(big);
    const s = useStore.getState();
    assert.equal(s.eventMarks.length, EVENT_MARK_CAP);
    assert.equal(s.events.length, EVENT_FEED_CAP);
    // newest kept after the trim
    assert.equal(s.eventMarks[0]!.tick, EVENT_MARK_CAP + 99);
    assert.equal(s.events[0]!.tick, EVENT_MARK_CAP + 99);
    assert.equal(s.eventCounter, EVENT_MARK_CAP + 100);
  });

  it('clearEvents empties both arrays and restarts ids with the world', () => {
    useStore.getState().pushEvents([death(1), war(2)]);
    useStore.getState().clearEvents();
    const s = useStore.getState();
    assert.equal(s.events.length, 0);
    assert.equal(s.eventMarks.length, 0);
    assert.equal(s.eventCounter, 0);
    useStore.getState().pushEvent(death(9));
    assert.equal(useStore.getState().events[0]!.id, 0);
  });

  it('keeps every type in the shared palette', () => {
    for (const t of ['extinction', 'cambrian', 'migration', 'symbiosis', 'famine', 'drought', 'war', 'birth', 'death', 'predation', 'discovery', 'intervention'] as const) {
      assert.ok(EVENT_TEXT[t], `missing text colour for ${t}`);
      assert.match(EVENT_HEX[t]!, /^#[0-9a-f]{6}$/);
    }
  });
});
