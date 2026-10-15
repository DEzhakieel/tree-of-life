import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import type { StatsPoint } from '../src/store/useStore.js';
import type { EventFeedEntry } from '../src/store/useStore.js';
import { measureRipple } from '../src/lib/ripple.js';
import { useStore } from '../src/store/useStore.js';

/** Minimal full StatsPoint factory for ripple tests. */
function stat(tick: number, population: number, speciesCount: number): StatsPoint {
  return {
    tick,
    population,
    speciesCount,
    entropy: 0,
    diversity: 0,
    complexity: 0,
    cooperation: 0,
    predatorFraction: 0,
    memeEntropy: 0,
    speciesMemeMI: 0,
    meanAltruism: 0,
    meanAggression: 0,
    meanCooperation: 0,
    meanRisk: 0,
    meanDeception: 0,
    predatorGeneFraction: 0,
    preyGeneFraction: 0,
    energyInequality: 0,
    donationRatio: 0,
    lyapunovExponent: 0,
    selectionEntropy: 0,
    fixationIndex: 0,
    priceEquationSelection: 0,
    foodGradMagMean: 0,
    foodLapMean: 0,
    velocityDivMean: 0,
    velocityCurlMagMean: 0,
    caAliveFraction: 0,
    caComplexity: 0,
    traitTotalVariance: 0,
    traitEffectiveDim: 0,
    traitAnisotropy: 0,
    meanATP: 0,
    meanEnzyme: 0,
    meanToxin: 0,
    meanPH: 0,
    chemicalDiversity: 0,
    meanGlucose: 0,
    meanProtein: 0,
    activeSynthesisFraction: 0,
    terrainOxygen: 0,
    terrainPH: 0,
    terrainToxin: 0,
    meanForce: 0,
    clusterCount: 0,
    clusterOrder: 0,
    rotationalOrder: 0,
    spatialEntropy: 0,
    dimensionalEntropy: 0,
    orgIndex: 0,
    massConservation: 0,
    symmetryDrift: 0,
    cascadeRate: 0,
    bondEnergy: 0,
    reactionEnthalpy: 0,
    entropyProduction: 0,
    carnotEfficiency: 0,
    heatWaste: 0,
    enginePower: 0,
    radiationField: 0,
    thermalBalance: 0,
    expressionEntropy: 0,
    transcriptActivity: 0,
    proteinDiversity: 0,
    proteomeLoad: 0,
    pathwayFlux: 0,
    fluxDiversity: 0,
    regulationGating: 0,
    ecCoupling: 0,
    nativeFraction: 0,
    misfoldLoad: 0,
    foldStability: 0,
    tfRegulation: 0,
    envRecognition: 0,
    expressionNoise: 0,
    libraryDiversity: 0,
  };
}

function event(tick: number, type: EventFeedEntry['type'], data: Record<string, unknown> = {}): EventFeedEntry {
  return { id: tick, tick, type, significance: 0.5, data };
}

describe('revival ripple (meteor → population crashes then recovers)', () => {
  const stats = [
    stat(0, 400, 5),
    stat(100, 380, 5),
    stat(200, 200, 4), // meteor lands at 150 → crash
    stat(300, 280, 4),
    stat(400, 450, 5),
    stat(500, 450, 5),
  ];
  const events = [
    event(150, 'intervention', { itype: 'meteor' }),
    event(210, 'death', { cause: 'impact' }),
    event(250, 'birth', {}),
    event(310, 'birth', {}),
    event(350, 'cambrian'),
    event(100, 'death', { cause: 'age' }),
  ];

  it('measures the aggregate drift in the window', () => {
    const r = measureRipple(stats, events, 300); // window closes at t450
    assert.equal(r.hasRipple, true);
    assert.equal(r.eventTick, 150);
    assert.equal(r.windowEndTick, 450);
    assert.equal(r.prePop, 380); // last sample before the event
    assert.equal(r.postPop, 450); // last sample before window close
    assert.equal(r.popDelta, 70);
    assert.equal(r.speciesDelta, 0);
    assert.equal(r.births, 2);
    assert.equal(r.deaths, 1); // only the death inside the window (t=210)
  });

  it('labels shock events catalysed by the intervention', () => {
    const r = measureRipple(stats, events, 300);
    assert.deepEqual(r.shocks, [{ type: 'cambrian', count: 1 }]);
    assert.equal(r.verdict, 'expansion'); // +70/380 ≈ +18% → recovery past baseline
  });
});

describe('collapse ripple', () => {
  it('flags a large population drop as collapse', () => {
    const stats = [stat(0, 500, 8), stat(100, 480, 8), stat(200, 300, 6), stat(300, 150, 4), stat(400, 100, 3)];
    const events = [
      event(110, 'intervention', { itype: 'nuke' }),
      event(250, 'famine', { deaths: 60 }),
      event(320, 'extinction', { from: 4, to: 3 }),
    ];
    const r = measureRipple(stats, events, 300);
    assert.equal(r.hasRipple, true);
    assert.equal(r.prePop, 480);
    assert.equal(r.postPop, 100);
    assert.equal(r.popDelta, -380);
    assert.equal(r.verdict, 'collapse');
    assert.deepEqual(r.shocks, [
      { type: 'famine', count: 1 },
      { type: 'extinction', count: 1 },
    ]);
  });
});

describe('expansion ripple', () => {
  it('flags strong growth after seeding food', () => {
    const stats = [stat(0, 200, 3), stat(100, 220, 3), stat(200, 300, 4), stat(300, 420, 5), stat(400, 560, 6)];
    const events = [event(120, 'intervention', { itype: 'seedFood' })];
    const r = measureRipple(stats, events, 250);
    assert.equal(r.prePop, 220);
    assert.equal(r.postPop, 420);
    assert.equal(r.popDelta, 200);
    assert.equal(r.verdict, 'expansion');
  });
});

describe('no intervention → no ripple', () => {
  it('returns hasRipple=false with no interventions logged', () => {
    const r = measureRipple([stat(0, 100, 2), stat(100, 120, 2)], [event(50, 'birth', {})]);
    assert.equal(r.hasRipple, false);
  });

  it('returns hasRipple=false when stats are missing entirely', () => {
    const r = measureRipple([], [event(10, 'intervention', { itype: 'meteor' })]);
    assert.equal(r.hasRipple, false);
  });
});

describe('scheduler store', () => {
  beforeEach(() => useStore.getState().clearScheduledEvents());

  it('adds, toggles, marks fired and removes events', () => {
    const st = useStore.getState();
    st.addScheduledEvent({ label: 'first strike', type: 'meteor', tick: 500, enabled: true, payload: { radius: 60 } });
    let s = useStore.getState();
    assert.equal(s.scheduledEvents.length, 1);
    assert.equal(s.scheduledEvents[0]!.id, 0);

    st.toggleScheduledEvent(0);
    s = useStore.getState();
    assert.equal(s.scheduledEvents[0]!.enabled, false);

    st.markScheduledEventFired(0, 512);
    s = useStore.getState();
    assert.equal(s.scheduledEvents[0]!.firedTick, 512);

    st.removeScheduledEvent(0);
    s = useStore.getState();
    assert.equal(s.scheduledEvents.length, 0);
  });

  it('new world resets the queue', () => {
    const st = useStore.getState();
    st.addScheduledEvent({ label: 'x', type: 'nuke', tick: 10, enabled: true, payload: {} });
    st.clearScheduledEvents();
    const s = useStore.getState();
    assert.equal(s.scheduledEvents.length, 0);
    assert.equal(s.nextScheduledEventId, 0);
  });

  it('re-arms a repeating event on a cadence and terminates after N fires', () => {
    const st = useStore.getState();
    st.addScheduledEvent({ label: 'pulse', type: 'meteor', tick: 100, enabled: true, payload: {}, repeatEvery: 100, remaining: 3 });
    st.advanceScheduledEvent(0, 100);
    let e = useStore.getState().scheduledEvents[0]!;
    assert.equal(e.firedTick, undefined);
    assert.equal(e.tick, 200);
    assert.equal(e.remaining, 2);

    st.advanceScheduledEvent(0, 200);
    e = useStore.getState().scheduledEvents[0]!;
    assert.equal(e.tick, 300);
    assert.equal(e.remaining, 1);

    st.advanceScheduledEvent(0, 300); // last fire → terminal
    e = useStore.getState().scheduledEvents[0]!;
    assert.equal(e.firedTick, 300);
    assert.equal(e.remaining, 0);
  });

  it('keeps re-arming an infinite repeat', () => {
    const st = useStore.getState();
    st.addScheduledEvent({ label: 'beat', type: 'seedFood', tick: 10, enabled: true, payload: {}, repeatEvery: 50 });
    st.advanceScheduledEvent(0, 10);
    const e = useStore.getState().scheduledEvents[0]!;
    assert.equal(e.firedTick, undefined);
    assert.equal(e.tick, 60);
    assert.equal(e.remaining, undefined);
  });

  it('a one-shot still fires once', () => {
    const st = useStore.getState();
    st.addScheduledEvent({ label: 'boom', type: 'nuke', tick: 10, enabled: true, payload: {}, repeatEvery: 0 });
    st.advanceScheduledEvent(0, 10);
    const e = useStore.getState().scheduledEvents[0]!;
    assert.equal(e.firedTick, 10);
    assert.equal(e.tick, 10);
  });
});