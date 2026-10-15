import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { decodePhenotype, decodeStrategies, decodeDrives } from '@fractal-life/simulation';
import { SPECIES_PRESETS, encodeWeight } from '../src/lib/presets.js';

describe('species presets', () => {
  it('every preset builds a full signed genome', () => {
    for (const p of SPECIES_PRESETS) {
      const g = p.build();
      assert.equal(g.length, 217);
      for (let i = 0; i < g.length; i++) {
        assert.ok(g[i]! >= -1 && g[i]! <= 1, `${p.id} gene ${i} out of range`);
      }
    }
  });

  it('grazer decodes as a herbivore', () => {
    const g = SPECIES_PRESETS.find((p) => p.id === 'grazer')!.build();
    assert.ok(decodePhenotype(g).diet < 0.4, 'grazer should be herbivore');
    assert.ok(decodeStrategies(g).aggression < 0.4, 'grazer should be non-aggressive');
    assert.ok(decodeStrategies(g).cooperation > 0.5, 'grazer should be cooperative');
  });

  it('predator decodes as a fast carnivore hunter', () => {
    const g = SPECIES_PRESETS.find((p) => p.id === 'predator')!.build();
    const p = decodePhenotype(g);
    const s = decodeStrategies(g);
    assert.ok(p.diet > 0.6, 'predator should be carnivore');
    assert.ok(p.size > 1.5, 'predator should be large-bodied');
    assert.ok(s.aggression > 0.6, 'predator should hunt');
  });

  it('altruist decodes near-max cooperation and low aggression', () => {
    const g = SPECIES_PRESETS.find((p) => p.id === 'altruist')!.build();
    assert.ok(decodeStrategies(g).cooperation > 0.85, 'altruist should be a strong donor');
    assert.ok(decodeStrategies(g).aggression < 0.3, 'altruist should be docile');
  });

  it('swarm carries alignment + cohesion instincts', () => {
    const g = SPECIES_PRESETS.find((p) => p.id === 'swarm')!.build();
    const d = decodeDrives(g);
    assert.ok(d.alignment > 0.6, 'swarm should align with neighbours');
    assert.ok(d.cohesion > 0.5, 'swarm should cohere');
    assert.ok(d.separation > 0.6, 'swarm should keep spacing');
  });

  it('burster is a high-mutation short-lived r-strategist', () => {
    const g = SPECIES_PRESETS.find((p) => p.id === 'burster')!.build();
    const p = decodePhenotype(g);
    assert.ok(p.mutability > 1.5, 'burster should mutate fast');
    assert.ok(p.longevity < 0.8, 'burster should be short-lived');
  });

  it('encodeWeight round-trips decoded weights', () => {
    assert.equal(encodeWeight(0), -1);
    assert.equal(encodeWeight(1), 1);
    assert.equal(encodeWeight(0.5), 0);
    assert.ok(encodeWeight(1.5) <= 1);
    assert.ok(encodeWeight(-1) >= -1);
  });
});