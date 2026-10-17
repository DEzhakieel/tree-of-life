import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Engine } from '../src/engine.js';
import { makeWorld, placeAgentsAt, richestWetCell, cellCorner, cellGxGy } from '../src/research/scenarios.js';
import { BASELINE, baselineGenome, perturbedGenome } from '../src/research/perturb.js';

/**
 * Reciprocity gate.
 *
 * Cooperation here is memetic greenbeard altruism: a surplus agent gifts energy
 * to the nearest *needy* neighbour that shares its cultural tag. The transfer is
 * recorded on both sides (`totalDonated` on the donor, `totalReceived` on the
 * recipient), which yields an exact accounting identity that must hold for all
 * time:
 *
 *     sum(totalDonated)  ==  sum(totalReceived)      over every agent, alive or dead
 *
 * The founders are engineered so the channel *must* fire: donors sit above the
 * donation threshold with the signal output on, and their same-tag neighbours
 * sit below the needy threshold, all adjacent. That makes the reciprocity
 * assertions deterministic rather than probabilistic.
 */

type World = ConstructorParameters<typeof Engine>[0];

const N = 16;
const CAP = 100;

function founders(seed: string, genome: Float32Array): Engine {
  const world = makeWorld(seed, N, { maxIter: 2, energyCapacity: CAP }) as World;
  return new Engine(
    world,
    Array.from({ length: N }, (_, id) => ({ id, genome: new Float32Array(genome) })),
  );
}

/** cluster every founder at the richest wet cell; half rich (donors), half needy (recipients) */
function clustered(engine: Engine): void {
  const { gx, gy } = cellGxGy(richestWetCell(engine, 0), engine.grid.size);
  const { x, y } = cellCorner(gx, gy);
  placeAgentsAt(engine, new Array(N * 2).fill(0).map((_, i) => (i % 2 === 0 ? x : y)));
  let i = 0;
  for (const a of engine.agents.values()) {
    a.meme = 0;
    a.energy = i % 2 === 0 ? CAP : 1;
    i++;
  }
}

function sumDonated(engine: Engine): number {
  let s = 0;
  for (const a of engine.agents.values()) s += a.totalDonated;
  return s;
}

function sumReceived(engine: Engine): number {
  let s = 0;
  for (const a of engine.agents.values()) s += a.totalReceived;
  return s;
}

describe('reciprocity · the gift ledger is exactly conserved', () => {
  it('sum(totalDonated) == sum(totalReceived) at every tick (donors and recipients both live)', () => {
    const eng = founders('recip.identity', baselineGenome(BASELINE));
    clustered(eng);
    let fired = 0;
    for (let t = 0; t < 40; t++) {
      eng.tick();
      const d = sumDonated(eng);
      const r = sumReceived(eng);
      assert.ok(Math.abs(d - r) < 1e-9, `tick ${t}: donated ${d} != received ${r}`);
      if (d > 0) fired++;
    }
    assert.ok(fired > 0, 'the engineered founders must trigger a donation');
  });

  it('per-agent gift counters are non-negative and monotone non-decreasing', () => {
    const eng = founders('recip.monotone', baselineGenome(BASELINE));
    clustered(eng);
    let prev = [...eng.agents.values()].map((a) => ({ d: a.totalDonated, r: a.totalReceived }));
    for (let t = 0; t < 30; t++) {
      eng.tick();
      let i = 0;
      for (const a of eng.agents.values()) {
        assert.ok(a.totalDonated >= 0 && a.totalReceived >= 0, `agent ${a.id} negative gift`);
        assert.ok(a.totalDonated >= prev[i]!.d - 1e-12, `agent ${a.id} totalDonated decreased`);
        assert.ok(a.totalReceived >= prev[i]!.r - 1e-12, `agent ${a.id} totalReceived decreased`);
        i++;
      }
      prev = [...eng.agents.values()].map((a) => ({ d: a.totalDonated, r: a.totalReceived }));
    }
  });

  it('when a donation happened, both a donor and a recipient recorded it', () => {
    const eng = founders('recip.both', baselineGenome(BASELINE));
    clustered(eng);
    for (let t = 0; t < 20; t++) eng.tick();
    const total = sumDonated(eng);
    if (total > 0) {
      const anyDonor = [...eng.agents.values()].some((a) => a.totalDonated > 0);
      const anyRecipient = [...eng.agents.values()].some((a) => a.totalReceived > 0);
      assert.ok(anyDonor, 'a donor must have recorded a gift');
      assert.ok(anyRecipient, 'a recipient must have recorded a gift');
    }
  });
});

describe('reciprocity · a more cooperative gene gives more', () => {
  it('cooperation 0.5 donates strictly more than cooperation 0 at identical placement', () => {
    const base = founders('recip.gene.base', baselineGenome(BASELINE));
    const selfish = founders(
      'recip.gene.base',
      perturbedGenome(baselineGenome(BASELINE), { id: 'no-cooperation', kind: 'cooperation', axis: '' }),
    );
    clustered(base);
    clustered(selfish);
    for (let t = 0; t < 20; t++) {
      base.tick();
      selfish.tick();
    }
    const b = sumDonated(base);
    const s = sumDonated(selfish);
    assert.ok(b > 0, `baseline donations ${b}`);
    assert.ok(b > s, `cooperation 0.5 (${b}) must outgive cooperation 0 (${s})`);
  });
});

describe('reciprocity · the reported cooperation telemetry is well formed', () => {
  it('cooperation stays in [0,1] and donationRatio/altruism stay non-negative', () => {
    const eng = founders('recip.stats', baselineGenome(BASELINE));
    clustered(eng);
    for (let t = 0; t < 60; t++) {
      const s = eng.stats();
      assert.ok(s.cooperation >= 0 && s.cooperation <= 1, `cooperation ${s.cooperation}`);
      assert.ok(s.donationRatio >= 0, `donationRatio ${s.donationRatio}`);
      assert.ok(s.meanAltruism >= 0, `meanAltruism ${s.meanAltruism}`);
      eng.tick();
    }
  });
});
