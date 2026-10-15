import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { radarSeries, summarizeRadar, emptySimStats, LEVELS } from '@fractal-life/shared';
import { STATUS_HEX, STATUS_LABEL, toRadarPoints } from '../src/lib/emergenceRadar.js';
import { useStore } from '../src/store/useStore.js';

function makeSample(tick: number) {
  const stats = emptySimStats(tick, 1);
  return {
    tick,
    primitives: {},
    measured: [],
  } as any;
}

describe('emergenceRadar web lib', () => {
  it('toRadarPoints maps empty to empty', () => {
    assert.deepEqual(toRadarPoints([]), []);
  });

  it('radarSeries produces points with all levels', () => {
    const samples = [makeSample(0), makeSample(10)];
    const pts = radarSeries(samples);
    assert.equal(pts.length, 2);
    for (const l of LEVELS) {
      assert.ok(l.id in pts[0]!.scores);
      assert.ok(l.id in pts[0]!.status);
    }
  });

  it('palette covers all statuses', () => {
    for (const s of ['DORMANT', 'ABSENT', 'PARTIAL', 'EMERGENT'] as const) {
      assert.match(STATUS_HEX[s], /^#[0-9a-f]{6}$/);
      assert.ok(STATUS_LABEL[s].length > 0);
    }
  });
});

describe('clearStats resets radarHistory', () => {
  it('drops radar samples on world switch', () => {
    const base = emptySimStats(5, 1);
    useStore.getState().clearStats();
    useStore.getState().pushRadarSample({ tick: 5, primitives: {}, measured: [] } as any);
    useStore.getState().pushRadarSample({ tick: 10, primitives: {}, measured: [] } as any);
    assert.equal(useStore.getState().radarHistory.length, 2);
    useStore.getState().clearStats();
    assert.equal(useStore.getState().radarHistory.length, 0);
    assert.equal(useStore.getState().stats, null);
  });
});
