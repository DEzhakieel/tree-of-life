import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { frameSuspended } from '../src/render/frameBudget.js';
import { useStore } from '../src/store/useStore.js';

/**
 * `frameBudget` is what the WebGL and canvas2d render loops check before doing
 * any work each animation frame. If this ever stopped tracking the headless
 * flag, a headless run would keep redrawing a stale scene at 60fps.
 */
describe('frame suspension tracks headless mode', () => {
  beforeEach(() => {
    useStore.getState().setHeadless(false);
  });

  it('draws normally by default', () => {
    assert.equal(frameSuspended(), false);
  });

  it('suspends drawing while headless is on', () => {
    useStore.getState().setHeadless(true);
    assert.equal(frameSuspended(), true);
  });

  it('resumes by itself when headless is switched off', () => {
    useStore.getState().setHeadless(true);
    assert.equal(frameSuspended(), true);
    useStore.getState().setHeadless(false);
    assert.equal(frameSuspended(), false);
  });
});
