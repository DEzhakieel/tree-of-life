import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  MACRO_REGIMES,
  classifyMacroRegime,
  macroRigidity,
  macroStatePersistence,
} from '../src/research/emergence.js';

/**
 * Transition gate.
 *
 * As a population organises, its macro-state moves through a fixed sequence —
 * random → clustered → organized → (specialized) — and can collapse back. The
 * classifier and the rigidity/persistence statistics it feeds are the boundary
 * detectors for those transitions, so their thresholds and edge behaviour are
 * pinned exactly here:
 *
 *   spatial ≥ 0.30          clustered
 *   spatial ≥ 0.42          organized
 *   spatial ≥ 0.55 & rig ≥ 0.6   specialized
 *   collapsed               collapsed (dominates every threshold)
 */

const rank = (r: string): number => MACRO_REGIMES.indexOf(r as (typeof MACRO_REGIMES)[number]);

describe('transitions · the regime ladder is ordered', () => {
  it('lists the five regimes in ascending organisation', () => {
    assert.deepEqual([...MACRO_REGIMES], ['random', 'clustered', 'organized', 'specialized', 'collapsed']);
  });
});

describe('transitions · classification honours the spatial thresholds', () => {
  it('collapses regardless of structure', () => {
    assert.equal(classifyMacroRegime(0.9, 0.9, true), 'collapsed');
    assert.equal(classifyMacroRegime(0, 0, true), 'collapsed');
  });

  it('needs both high structure and rigidity for specialized', () => {
    assert.equal(classifyMacroRegime(0.55, 0.6, false), 'specialized');
    assert.equal(classifyMacroRegime(0.55, 0.59, false), 'organized');
    assert.equal(classifyMacroRegime(0.54, 0.9, false), 'organized');
  });

  it('walks clustered → organized at exactly 0.42', () => {
    assert.equal(classifyMacroRegime(0.419, 0, false), 'clustered');
    assert.equal(classifyMacroRegime(0.42, 0, false), 'organized');
  });

  it('walks random → clustered at exactly 0.30', () => {
    assert.equal(classifyMacroRegime(0.299, 0, false), 'random');
    assert.equal(classifyMacroRegime(0.3, 0, false), 'clustered');
  });

  it('never moves backwards as structure increases', () => {
    let prev = rank(classifyMacroRegime(0, 0, false));
    for (let s = 0; s <= 1.0001; s += 0.01) {
      const r = rank(classifyMacroRegime(s, 0, false));
      assert.ok(r >= prev, `rank fell at spatial ${s.toFixed(2)}`);
      prev = r;
    }
  });
});

describe('transitions · rigidity measures concentration of macro-states', () => {
  it('is zero for an empty sequence and one for a constant sequence', () => {
    assert.equal(macroRigidity([]), 0);
    assert.equal(macroRigidity([7, 7, 7, 7, 7]), 1);
  });

  it('concentrates on the top quartile of distinct states', () => {
    assert.ok(Math.abs(macroRigidity([1, 2, 3, 4]) - 0.25) < 1e-12);
    assert.ok(Math.abs(macroRigidity([1, 1, 1, 2]) - 0.75) < 1e-12);
  });

  it('rises as the most common state takes a larger share', () => {
    assert.ok(macroRigidity([1, 1, 1, 2, 3]) > macroRigidity([1, 2, 3, 4, 5]));
  });
});

describe('transitions · persistence measures run-to-run repeatability', () => {
  it('is zero for degenerate sequences', () => {
    assert.equal(macroStatePersistence([]), 0);
    assert.equal(macroStatePersistence([1]), 0);
  });

  it('is one for a constant sequence and zero for a perfect alternation', () => {
    assert.equal(macroStatePersistence([3, 3, 3]), 1);
    assert.equal(macroStatePersistence([1, 2, 1, 2, 1]), 0);
  });
});
