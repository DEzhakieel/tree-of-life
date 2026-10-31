import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  KS_BURN,
  KS_CELLS,
  KS_CONDITIONS,
  KS_DELAY,
  KS_DESTROY_FRAC,
  KS_DIP_FRAC,
  KS_DOSES,
  KS_DOSE_TARGETS,
  KS_LESION,
  KS_SWEEP,
  buildKillSwitchReport,
  observeRun,
  runKillSwitch,
  spearman,
  type KillSwitchObservation,
} from '../src/research/killSwitch.js';

const SHORT = 320;

function run(seed: string, condition: string, ticks = SHORT) {
  return runKillSwitch({ seed, condition, ticks });
}

describe('killSwitch: model determinism and invariants', () => {
  it('reproduces identical series and scalars for the same seed and condition', () => {
    const a = run('ks.det.a', 'participation');
    const b = run('ks.det.a', 'participation');
    assert.deepEqual(a.series, b.series);
    assert.equal(a.pop0, b.pop0);
    assert.equal(a.finalPop, b.finalPop);
    assert.equal(a.birthsTotal, b.birthsTotal);
    assert.equal(a.deathsTotal, b.deathsTotal);
    assert.deepEqual(a.perturbation, b.perturbation);
  });

  it('changes the trajectory when the seed changes', () => {
    const a = run('ks.det.a', 'control');
    const b = run('ks.det.b', 'control');
    assert.notDeepEqual(a.series.pop, b.series.pop);
  });

  it('shares the pre-burn trajectory across conditions for a seed', () => {
    // Perturbation occurs at KS_BURN, so every sample strictly before it must
    // be identical even though the perturbed arm consumes a different RNG
    // stream for its choices.
    const names = ['control', 'core', 'participation', 'seal', 'delayParticipation'];
    const runs = names.map((name) => run('ks.shared.a', name));
    const preBurnSamples = Math.ceil(KS_BURN / runs[0]!.sampleEvery);
    for (const r of runs) {
      assert.deepEqual(r.series.pop.slice(0, preBurnSamples), runs[0]!.series.pop.slice(0, preBurnSamples));
      assert.equal(r.pop0, runs[0]!.pop0);
    }
  });

  it('keeps populations inside the lattice and destruction consistent with the threshold', () => {
    for (const name of ['control', 'participation', 'core']) {
      const r = run('ks.inv.a', name);
      assert.ok(r.pop0 > 0 && r.pop0 <= KS_CELLS);
      assert.ok(r.finalPop >= 0 && r.finalPop <= KS_CELLS);
      assert.ok(r.minPop >= 0 && r.minPop <= r.pop0);
      assert.equal(r.destruction, r.finalPop < KS_DESTROY_FRAC * r.pop0);
      assert.ok(r.birthsTotal > 0);
      for (const v of r.series.pop) assert.ok(Number.isInteger(v) && v >= 0 && v <= KS_CELLS);
    }
  });

  it('reports recovery only after a dip and never for a destroyed colony', () => {
    for (const name of ['control', 'participation', 'seal']) {
      const r = run('ks.rec.a', name);
      if (r.dipped) assert.ok(r.minPop < KS_DIP_FRAC * r.pop0);
      if (r.recoveryTick >= 0) {
        assert.ok(r.dipped);
        assert.ok(r.recoveryTick <= r.ticks - KS_BURN);
      }
      if (!r.dipped) assert.equal(r.recoveryTick, -1);
      if (r.destruction) assert.equal(r.recoveryTick, -1);
    }
  });
});

describe('killSwitch: perturbation wiring', () => {
  it('defines twelve unique conditions with one control', () => {
    assert.equal(KS_CONDITIONS.length, 12);
    assert.equal(new Set(KS_CONDITIONS.map((c) => c.name)).size, 12);
    assert.equal(KS_CONDITIONS.filter((c) => c.kind === 'control').length, 1);
    assert.deepEqual(
      KS_CONDITIONS.map((c) => c.name),
      [
        'control',
        'core',
        'rim',
        'participation',
        'matched',
        'ageMatched',
        'random',
        'seal',
        'randomEdges',
        'delayCore',
        'delayRim',
        'delayParticipation',
      ],
    );
    assert.throws(() => runKillSwitch({ seed: 'x', condition: 'nope' }));
  });

  it('removes exactly the registered fraction of the pre-lesion colony', () => {
    const base = run('ks.exact.a', 'control');
    const k = Math.round(base.pop0 * KS_LESION);
    for (const name of ['core', 'rim', 'participation', 'random']) {
      const r = run('ks.exact.a', name);
      assert.equal(r.pop0, base.pop0);
      assert.equal(r.perturbation.removed, k, name);
    }
    const small = runKillSwitch({
      seed: 'ks.exact.a',
      condition: 'participation',
      target: 'participation',
      fraction: 0.15,
    });
    assert.equal(small.perturbation.removed, Math.round(base.pop0 * 0.15));
  });

  it('never removes more than the requested count for the matched controls', () => {
    const k = Math.round(run('ks.match.a', 'control').pop0 * KS_LESION);
    for (const name of ['matched', 'ageMatched']) {
      const r = run('ks.match.a', name);
      assert.ok(r.perturbation.removed > 0, name);
      assert.ok(r.perturbation.removed <= k, name);
    }
  });

  it('seals the same number of edges as the random-edge control, and more than zero', () => {
    const seal = run('ks.edges.a', 'seal');
    const rand = run('ks.edges.a', 'randomEdges');
    assert.ok(seal.perturbation.edges > 0);
    assert.equal(rand.perturbation.edges, seal.perturbation.edges);
    assert.equal(seal.perturbation.removed, 0);
    assert.equal(rand.perturbation.removed, 0);
  });

  it('freezes the registered fraction of cells and keeps them alive through the pause', () => {
    const k = Math.round(run('ks.freeze.a', 'control').pop0 * KS_LESION);
    for (const name of ['delayCore', 'delayRim', 'delayParticipation']) {
      // Stop inside the pause, before KS_BURN + KS_DELAY.
      const r = run('ks.freeze.a', name, KS_BURN + KS_DELAY - 10);
      assert.equal(r.perturbation.frozen, k, name);
      assert.equal(r.perturbation.removed, 0);
      assert.ok(r.finalPop >= r.pop0 - r.perturbation.frozen, name);
    }
    // A pause that is lifted still completes and reports a finite population.
    const lifted = run('ks.freeze.a', 'delayParticipation', KS_BURN + KS_DELAY + 10);
    assert.ok(Number.isFinite(lifted.finalPop));
    assert.equal(lifted.perturbation.frozen, k);
  });

  it('applies the lesion at the requested sweep location', () => {
    const first = KS_SWEEP[0]!;
    const last = KS_SWEEP[KS_SWEEP.length - 1]!;
    const centre = runKillSwitch({ seed: 'ks.sweep.a', condition: 'core', target: 'none', lesion: first });
    const rim = runKillSwitch({ seed: 'ks.sweep.a', condition: 'core', target: 'none', lesion: last });
    assert.equal(centre.pop0, rim.pop0);
    assert.equal(centre.perturbation.radiusFrac, 0);
    assert.equal(rim.perturbation.radiusFrac, 0.9);
    assert.equal(centre.perturbation.removed, Math.round(centre.pop0 * KS_LESION));
    assert.equal(rim.perturbation.removed, Math.round(rim.pop0 * KS_LESION));
  });

  it('carries dose and sweep metadata into observations', () => {
    const dose = runKillSwitch({ seed: 'ks.meta.a', condition: 'random', target: 'random', fraction: 0.1 });
    const doseObs = observeRun(dose, { task: 'dose', fraction: 0.1, radiusFrac: 0, angle: 0 });
    assert.equal(doseObs.task, 'dose');
    assert.equal(doseObs.target, 'random');
    assert.equal(doseObs.fraction, 0.1);
    assert.equal(doseObs.removed, Math.round(dose.pop0 * 0.1));

    const sweep = runKillSwitch({ seed: 'ks.meta.a', condition: 'core', target: 'none', lesion: KS_SWEEP[3]! });
    const sweepObs = observeRun(sweep, { task: 'sweep', sweepIndex: 3, fraction: 0.4, ...KS_SWEEP[3]! });
    assert.equal(sweepObs.task, 'sweep');
    assert.equal(sweepObs.sweepIndex, 3);
    assert.equal(sweepObs.radiusFrac, 0.5);
    assert.ok(sweepObs.largestFrac > 0 && sweepObs.largestFrac <= 1);
  });

  it('reports fragmentation immediately after the perturbation', () => {
    const control = run('ks.frag.a', 'control');
    assert.ok(control.perturbation.components >= 1);
    assert.ok(control.perturbation.largestFrac > 0 && control.perturbation.largestFrac <= 1);
    const spread = run('ks.frag.a', 'random');
    const compact = run('ks.frag.a', 'core');
    assert.ok(spread.perturbation.components >= 1);
    assert.ok(compact.perturbation.components >= 1);
    assert.ok(compact.perturbation.largestFrac > spread.perturbation.largestFrac);
  });
});

describe('killSwitch: statistics and report shape', () => {
  it('computes Spearman rho with ties', () => {
    assert.equal(spearman([1, 2, 3, 4], [10, 20, 30, 40]), 1);
    assert.equal(spearman([1, 2, 3, 4], [40, 30, 20, 10]), -1);
    assert.ok(Math.abs(spearman([1, 2, 3, 4], [1, 1, 2, 2])) < 0.95);
  });

  const seeds = ['ks.rep.0', 'ks.rep.1', 'ks.rep.2', 'ks.rep.3', 'ks.rep.4'];
  // The eight conditions the claims actually read. The missing core/rim/delay
  // arms are exercised by the wiring tests above; leaving them out keeps this
  // file inside the fast test tier.
  const REPORT_CONDITIONS = [
    'control',
    'participation',
    'matched',
    'ageMatched',
    'random',
    'seal',
    'randomEdges',
    'delayParticipation',
  ] as const;
  const observations: KillSwitchObservation[] = [];
  for (const seed of seeds) {
    for (const condition of REPORT_CONDITIONS) {
      observations.push(observeRun(runKillSwitch({ seed, condition, ticks: SHORT }), { task: 'condition' }));
    }
  }

  it('summarises every condition and returns the five pre-registered claims', () => {
    const rep = buildKillSwitchReport(observations);
    assert.equal(rep.conditions.length, 12);
    assert.deepEqual(
      rep.conditions.map((c) => c.name),
      KS_CONDITIONS.map((c) => c.name),
    );
    assert.equal(rep.conditions.find((c) => c.name === 'control')!.n, seeds.length);
    for (const name of REPORT_CONDITIONS) {
      assert.equal(rep.conditions.find((c) => c.name === name)!.n, seeds.length, name);
    }
    assert.equal(rep.viability.n, seeds.length);
    assert.equal(rep.viability.valid, true);
    assert.ok(rep.viability.destruction <= 0.2);
    assert.ok(rep.viability.meanFinalRatio >= 0.5);
    assert.deepEqual(
      rep.claims.map((c) => c.id),
      ['C-KILL-01', 'C-KILL-02', 'C-KILL-03', 'C-KILL-04', 'C-KILL-05'],
    );
    for (const c of rep.claims) {
      assert.ok(['supported', 'refuted', 'inconclusive'].includes(c.verdict), c.id);
      assert.ok(c.claim.length > 0);
      assert.ok(c.detail.length > 0);
    }
    assert.equal(rep.seeds.length, seeds.length);
    assert.equal(rep.ticks, SHORT);
    assert.equal(rep.burn, KS_BURN);
    assert.equal(rep.lesionFraction, KS_LESION);
    assert.equal(rep.floorProb, 0.3);
    assert.ok(rep.floorLoss >= 0.1);
    assert.deepEqual(rep.doses, []);
    assert.deepEqual(rep.sweep, []);
  });

  it('is deterministic when reconstructed from a serialised cache', () => {
    const a = buildKillSwitchReport(observations);
    const cached = JSON.parse(JSON.stringify(observations)) as KillSwitchObservation[];
    const b = buildKillSwitchReport(cached);
    assert.deepEqual(b.claims, a.claims);
    assert.deepEqual(b.conditions, a.conditions);
    assert.equal(b.floorLoss, a.floorLoss);
    const c = buildKillSwitchReport(observations);
    assert.deepEqual(c.claims, a.claims);
  });

  it('gates every claim when the assay is not viable', () => {
    const twoSeeds = observations.filter((o) => o.seed === seeds[0] || o.seed === seeds[1]);
    const rep = buildKillSwitchReport(twoSeeds);
    assert.equal(rep.viability.valid, false);
    for (const c of rep.claims) {
      assert.equal(c.verdict, 'inconclusive', c.id);
      assert.match(c.detail, /^assay invalid:/);
    }
  });

  it('covers every registered dose and sweep point from cached rows', () => {
    // The dose and sweep arms are exercised in the wiring tests. Here the rows
    // are cloned from each seed's control so the aggregation and derived
    // thresholds can be checked without repeating the simulation.
    const obs: KillSwitchObservation[] = [...observations];
    for (const seed of seeds) {
      const base = observations.find((o) => o.seed === seed && o.condition === 'control')!;
      for (const target of KS_DOSE_TARGETS) {
        for (const fraction of KS_DOSES) {
          obs.push({ ...base, task: 'dose', target, fraction, radiusFrac: 0, angle: 0, sweepIndex: -1 });
        }
      }
      for (let i = 0; i < KS_SWEEP.length; i++) {
        const point = KS_SWEEP[i]!;
        obs.push({
          ...base,
          task: 'sweep',
          target: 'none',
          fraction: 0.4,
          sweepIndex: i,
          radiusFrac: point.radiusFrac,
          angle: point.angle,
        });
      }
    }
    const rep = buildKillSwitchReport(obs);
    assert.equal(rep.doses.length, KS_DOSE_TARGETS.length * KS_DOSES.length);
    assert.equal(rep.sweep.length, KS_SWEEP.length);
    for (const d of rep.doses) {
      assert.ok(KS_DOSE_TARGETS.includes(d.target as (typeof KS_DOSE_TARGETS)[number]));
      assert.ok(KS_DOSES.some((f) => Math.abs(f - d.fraction) < 1e-9));
      assert.equal(d.n, seeds.length);
    }
    for (let i = 0; i < rep.sweep.length; i++) {
      assert.equal(rep.sweep[i]!.label, KS_SWEEP[i]!.label);
      assert.equal(rep.sweep[i]!.n, seeds.length);
    }
  });
});
