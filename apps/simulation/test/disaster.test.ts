import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  surpriseScore,
  blackSwanSuite,
  type BlackSwanObs,
} from '../src/research/blackSwans.js';
import { probEventSet, jointSurprise } from '../src/research/eventProbability.js';

/**
 * Disaster / rare-event gate.
 *
 * A black swan is a high-impact, low-probability event. The module separates
 * two concerns:
 *
 *   1. detection   — `blackSwanSuite` names the catastrophes worth watching;
 *   2. surprise    — `surpriseScore` ranks them by impact × rarity, and
 *                    `probEventSet`/`jointSurprise` handle the probability of
 *                    *several* co-occurring events rather than one.
 *
 * These are pure functions, so the whole statistical contract can be pinned
 * without running a world.
 */

function obs(id: string, impact = 1): BlackSwanObs {
  return { id, tick: 1, impact, pHat: 0.1, surprise: 0 };
}

describe('disaster · surprise is monotone in impact and in rarity', () => {
  it('rises with impact at fixed base rate', () => {
    // base rate 0.9 keeps the score in the unsaturated region for this impact range
    assert.ok(surpriseScore(0.9, 0.9) > surpriseScore(0.5, 0.9));
    assert.ok(surpriseScore(0.5, 0.9) > surpriseScore(0.1, 0.9));
  });

  it('rises as the base rate falls', () => {
    // a tiny impact keeps every score below the clamp for all three rates
    assert.ok(surpriseScore(1e-5, 1e-4) > surpriseScore(1e-5, 1e-2));
    assert.ok(surpriseScore(1e-5, 1e-2) > surpriseScore(1e-5, 0.5));
  });

  it('is zero for a zero-impact event', () => {
    assert.equal(surpriseScore(0, 1e-6), 0);
  });

  it('stays clamped to [0,1] and never returns NaN', () => {
    for (const [i, p] of [[0, 0], [1, 0], [2, 0.5], [1, -1], [1, 2], [NaN, 0.1], [1, NaN]] as const) {
      const s = surpriseScore(i, p);
      assert.ok(Number.isFinite(s) && s >= 0 && s <= 1, `surpriseScore(${i},${p}) = ${s}`);
    }
  });
});

describe('disaster · the black-swan suite names the catastrophes', () => {
  it('has four detectors with unique ids and callable impact functions', () => {
    const suite = blackSwanSuite();
    assert.equal(suite.length, 4);
    const ids = suite.map((d) => d.id);
    assert.equal(new Set(ids).size, ids.length);
    assert.deepEqual(new Set(ids), new Set(['extinction', 'complexity-collapse', 'cooperation-drop', 'culture-loss']));
    for (const d of suite) {
      assert.equal(typeof d.detect, 'function', `${d.id} missing detect`);
      assert.equal(typeof d.impact, 'function', `${d.id} missing impact`);
      assert.ok((d.baseRate ?? 0) > 0 && (d.baseRate ?? 1) < 1, `${d.id} baseRate out of range`);
    }
  });
});

describe('disaster · joint event-set probability respects the Fréchet bounds', () => {
  const observations = [obs('a'), obs('a'), obs('b')];

  it('multiplies per-event rates into a simple independence estimate', () => {
    const p = probEventSet(observations, { events: ['a', 'b'] });
    assert.ok(Math.abs(p.pIndep - (2 / 3) * (1 / 3)) < 1e-12);
    assert.equal(p.count, 3);
  });

  it('encodes the Fréchet bounds (min 0 for many events, max = sum of rates)', () => {
    const multi = probEventSet(observations, { events: ['a', 'b'] });
    assert.equal(multi.pBounds.min, 0);
    assert.ok(Math.abs(multi.pBounds.max - 1) < 1e-12); // min(1, 2/3+1/3)
    const single = probEventSet(observations, { events: ['a'] });
    assert.ok(Math.abs(single.pBounds.min - 2 / 3) < 1e-12);
    assert.ok(Math.abs(single.pBounds.max - 2 / 3) < 1e-12);
    assert.equal(single.count, 2);
  });

  it('ranks a rarer joint event as more surprising', () => {
    const rare = jointSurprise([obs('a', 1), obs('b', 1), obs('b', 1), obs('b', 1)], { events: ['a', 'b'] });
    const common = jointSurprise([obs('a', 1), obs('a', 1), obs('b', 1), obs('b', 1)], { events: ['a', 'b'] });
    assert.ok(Number.isFinite(rare) && rare >= 0);
    assert.ok(rare > common, `rare ${rare} should exceed common ${common}`);
  });
});
