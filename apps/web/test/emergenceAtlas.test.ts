import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { atlasSeries, emptySimStats, summarizeAtlas, type Regime } from '@fractal-life/shared';
import type { StatsPoint } from '../src/store/useStore.js';
import { useStore } from '../src/store/useStore.js';
import {
  REGIME_HEX,
  REGIME_LABEL,
  REGIME_TEXT,
  ridgePath,
  toAtlasSample,
} from '../src/lib/emergenceAtlas.js';

const point = (over: Partial<StatsPoint>): StatsPoint =>
  ({ ...emptySimStats(over.tick ?? 0, 1), ...over }) as StatsPoint;

describe('toAtlasSample', () => {
  it('carries the five atlas inputs out of a store StatsPoint', () => {
    const s = toAtlasSample(
      point({ tick: 7, entropy: 2.5, diversity: 0.7, complexity: 3.1, speciesCount: 9, lyapunovExponent: -1.2 }),
    );
    assert.deepEqual(s, {
      tick: 7,
      entropy: 2.5,
      diversity: 0.7,
      complexity: 3.1,
      speciesCount: 9,
      lyapunovExponent: -1.2,
    });
  });

  it('feeds the shared coordinate math', () => {
    const frozen = atlasSeries([
      toAtlasSample(point({ tick: 0, speciesCount: 1, lyapunovExponent: 0 })),
      toAtlasSample(point({ tick: 1, speciesCount: 1, lyapunovExponent: 0 })),
    ]);
    assert.equal(frozen[0]!.x, 0);
    assert.equal(frozen[0]!.regime, 'order');

    const chaotic = atlasSeries([
      toAtlasSample(point({ tick: 0, entropy: 3, diversity: 1, complexity: 0, speciesCount: 8, lyapunovExponent: -4 })),
      toAtlasSample(point({ tick: 1, entropy: 3, diversity: 1, complexity: 2, speciesCount: 8, lyapunovExponent: 4 })),
      toAtlasSample(point({ tick: 2, entropy: 3, diversity: 1, complexity: 1, speciesCount: 8, lyapunovExponent: 4 })),
    ]);
    // diversity/evenness flat across this slice -> only lyapunov stretches
    assert.equal(chaotic[0]!.x, 0);
    assert.equal(chaotic[1]!.x, 1);
    assert.equal(chaotic[1]!.regime, 'chaos');
    const sum = summarizeAtlas(chaotic);
    assert.equal(sum.dominant, 'chaos');
    assert.equal(sum.peak?.y, 1);
  });
});

describe('regime palette', () => {
  it('covers every regime with a class, a hex and a label', () => {
    const regimes: Regime[] = ['order', 'edge', 'chaos'];
    for (const r of regimes) {
      assert.match(REGIME_HEX[r], /^#[0-9a-f]{6}$/);
      assert.ok(REGIME_TEXT[r].startsWith('text-'));
      assert.ok(REGIME_LABEL[r].length > 0);
    }
  });
});

describe('ridgePath', () => {
  it('runs bottom-left to bottom-right with the apex on the top edge', () => {
    const d = ridgePath(4, 4, 192, 124);
    const pts = d.split(' ').map((p) => p.split(',').map(Number));
    assert.equal(pts.length, 41);
    const [first, mid, last] = [pts[0]!, pts[20]!, pts[40]!];
    assert.deepEqual(first, [4, 128]); // y = 4 + 1*124
    assert.deepEqual(last, [196, 128]);
    assert.deepEqual(mid, [100, 4]); // arch apex at t = 0.5
  });
});

describe('clearStats (world switch)', () => {
  it('drops live stats and the series the atlas draws from', () => {
    useStore.getState().setStats(emptySimStats(5, 1));
    useStore.getState().pushStatsHistory(point({ tick: 5 }));
    useStore.getState().pushStatsHistory(point({ tick: 10 }));
    assert.equal(useStore.getState().statsHistory.length, 2);

    useStore.getState().clearStats();
    const after = useStore.getState();
    assert.equal(after.stats, null);
    assert.equal(after.statsHistory.length, 0);
  });
});
