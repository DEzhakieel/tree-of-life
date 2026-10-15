import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { InterventionSchema, GENOME_SIZE } from '@fractal-life/shared';

describe('InterventionSchema wake-world genome cap', () => {
  it('accepts a full 217-gene genome for spawnAgent', () => {
    const genome = new Array<number>(GENOME_SIZE).fill(0.25);
    const parsed = InterventionSchema.parse({
      type: 'spawnAgent', x: 10, y: 10, radius: 4,
      genome, sequence: 1,
    });
    assert.equal(parsed.genome?.length, GENOME_SIZE);
  });

  it('accepts a partial (designer) genome shorter than full', () => {
    const parsed = InterventionSchema.parse({
      type: 'spawnAgent', x: 10, y: 10, radius: 4,
      genome: [0.5, -0.5, 1, -1, 0], sequence: 2,
    });
    assert.equal(parsed.genome?.length, 5);
  });

  it('rejects genomes longer than GENOME_SIZE', () => {
    const genome = new Array<number>(GENOME_SIZE + 1).fill(0.5);
    assert.throws(() =>
      InterventionSchema.parse({ type: 'spawnAgent', genome, sequence: 3 }),
    );
  });

  it('rejects out-of-bounds gene values', () => {
    assert.throws(() =>
      InterventionSchema.parse({ type: 'spawnAgent', genome: [1.5], sequence: 4 }),
    );
    assert.throws(() =>
      InterventionSchema.parse({ type: 'spawnAgent', genome: [-2], sequence: 5 }),
    );
  });

  it('accepts a valid setGene intervention', () => {
    const parsed = InterventionSchema.parse({
      type: 'setGene', agentId: 7, index: 130, value: 0.42, sequence: 6,
    });
    assert.equal(parsed.agentId, 7);
    assert.equal(parsed.index, 130);
    assert.equal(parsed.value, 0.42);
  });

  it('rejects setGene with non-integer or out-of-range index/agentId/value', () => {
    assert.throws(() =>
      InterventionSchema.parse({ type: 'setGene', agentId: 7, index: 1.5, value: 0, sequence: 7 }),
    );
    assert.throws(() =>
      InterventionSchema.parse({ type: 'setGene', agentId: 7, index: -1, value: 0, sequence: 8 }),
    );
    assert.throws(() =>
      InterventionSchema.parse({ type: 'setGene', agentId: 7, index: GENOME_SIZE, value: 0, sequence: 9 }),
    );
    assert.throws(() =>
      InterventionSchema.parse({ type: 'setGene', agentId: -1, index: 0, value: 0, sequence: 10 }),
    );
    assert.throws(() =>
      InterventionSchema.parse({ type: 'setGene', agentId: 7, index: 0, value: 1.2, sequence: 11 }),
    );
  });

  it('rejects unknown intervention types', () => {
    assert.throws(() =>
      InterventionSchema.parse({ type: 'disco', sequence: 12 }),
    );
  });
});