import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { AgentBuffer } from '../src/net/agentBuffer.js';

describe('agent buffer lookup', () => {
  it('finds a live agent by id and reports its row', () => {
    const b = new AgentBuffer();
    b.reset(8);
    b.push(10, 1, 1, 0.5, 2, 0, 0.1);
    b.push(11, 2, 2, 0.6, 3, 0, 0.7);
    b.push(12, 3, 3, 0.7, 4, 0, 0.9);

    const i = b.indexOf(11);
    assert.equal(i, 1);
    assert.equal(b.meme[i], Math.fround(0.7));
    assert.equal(b.species[i], 3);
    assert.equal(b.energy[i], Math.fround(0.6));
  });

  it('returns -1 for an unknown id', () => {
    const b = new AgentBuffer();
    b.reset(4);
    b.push(1, 0, 0, 1, 1, 0, 0);
    assert.equal(b.indexOf(99), -1);
    assert.equal(b.indexOf(1), 0);
  });
});