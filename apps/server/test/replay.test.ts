import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { DEFAULT_PARAMS, type WorldConfig } from '@fractal-life/shared';
import { createEngine, replayEngine } from '../src/engine/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const groundingJson = readFileSync(join(here, '..', '..', 'simulation', 'data', 'enrichment.json'), 'utf-8');

const TARGET = 120;

function makeWorld(seed: string): WorldConfig {
  return {
    id: `replay-grounding-${seed}`,
    seed,
    fractalType: 'mandelbrot',
    params: { ...DEFAULT_PARAMS, spawnCount: 8 },
    createdAt: 0,
    currentTick: 0,
  };
}

function toStr(a: Uint8Array): string {
  return String.fromCharCode(...a);
}

describe('replay determinism with grounding', () => {
  it('grounded replay reproduces the grounded headworld frame byte-for-byte', async () => {
    for (const seed of ['replay-grounding-b', 'replay-grounding-a']) {
      const config = makeWorld(seed);
      const head = await createEngine(config, groundingJson);
      for (let t = 0; t < TARGET; t++) head.tick();
      const headFrame = toStr(head.encodeSnapshotMessage());

      const log = head.getInterventionLog();
      const replayed = await replayEngine(config, log, TARGET, groundingJson);
      const replayFrame = toStr(replayed.encodeSnapshotMessage());

      assert.equal(replayFrame, headFrame, `seed ${seed}: grounded replay diverged from headworld`);
    }
  });

  it('replay with and without grounding can diverge (grounding materially changes dynamics)', async () => {
    // seed replay-grounding-b is empirically a case where the ecology priors
    // change the world: the ungrounded replay differs from the grounded head.
    const config = makeWorld('replay-grounding-b');
    const head = await createEngine(config, groundingJson);
    for (let t = 0; t < TARGET; t++) head.tick();
    const headFrame = toStr(head.encodeSnapshotMessage());

    const log = head.getInterventionLog();
    const ungrounded = await replayEngine(config, log, TARGET);
    const ungroundedFrame = toStr(ungrounded.encodeSnapshotMessage());

    assert.notEqual(ungroundedFrame, headFrame, 'ungrounded replay should not reproduce the grounded head');
  });
});