import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SimEvent } from '@fractal-life/shared';
import {
  census,
  countByType,
  defaultPlants,
  loadEventLog,
  occurrenceTicks,
  parseEventLogText,
  runWithEvents,
  type SeriesPoint,
} from '../src/research/eventLog.js';
import {
  analyzeObservational,
  lagCorrelation,
  pairInterventional,
  renderEventReport,
  renderEventSvg,
  type EventReportInput,
} from '../src/research/eventCausal.js';

const famineAt = (tick: number): SimEvent => ({ worldId: 'w', tick, significance: 0.4, type: 'famine', data: { deaths: 1 } });
const warAt = (tick: number): SimEvent => ({ worldId: 'w', tick, significance: 0.7, type: 'war', data: { deaths: 2 } });
const deathAt = (tick: number): SimEvent => ({
  worldId: 'w',
  tick,
  significance: 0.3,
  type: 'death',
  data: { agentId: tick, cause: 'age', species: 0, x: 0, y: 0, age: 10, energy: 0 },
});

/** full metric row at a fixed base so every ANALYSIS_METRICS key exists */
const pointAt = (tick: number, alive: number): SeriesPoint => ({
  tick,
  values: {
    aliveCount: alive,
    avgEnergy: 60,
    speciesCount: 4,
    entropy: 2,
    diversity: 0.5,
    cooperation: 0.5,
    predatorFraction: 0.1,
    cultureCount: 3,
  },
});

describe('event log parsing', () => {
  it('parses NDJSON, counting malformed lines and unknown types', () => {
    const text = [
      JSON.stringify(famineAt(3)),
      '{not json',
      JSON.stringify(warAt(5)),
      JSON.stringify({ worldId: 'w', tick: 7, significance: 0.1, type: 'nope', data: {} }),
      '',
    ].join('\n');
    const { events, invalid } = parseEventLogText(text);
    assert.equal(events.length, 2);
    assert.equal(invalid, 2);
    assert.equal(events[0]!.type, 'famine');
    assert.equal(events[1]!.tick, 5);
  });

  it('parses a JSON array form', () => {
    const { events, invalid } = parseEventLogText(JSON.stringify([famineAt(1), warAt(2)]));
    assert.equal(events.length, 2);
    assert.equal(invalid, 0);
  });

  it('throws on a broken JSON array, returns empty for empty input', () => {
    assert.throws(() => parseEventLogText('[{'), /not valid JSON/);
    const empty = parseEventLogText('   \n');
    assert.equal(empty.events.length, 0);
    assert.equal(empty.invalid, 0);
  });

  it('loadEventLog reads an NDJSON file from disk', () => {
    const dir = mkdtempSync(join(tmpdir(), 'event-log-'));
    const path = join(dir, 'log.ndjson');
    try {
      writeFileSync(path, `${JSON.stringify(famineAt(11))}\n${JSON.stringify(deathAt(12))}\n`);
      const { events, invalid } = loadEventLog(path);
      assert.equal(events.length, 2);
      assert.equal(invalid, 0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('census helpers', () => {
  it('collapses same-tick events and summarizes gaps and rates', () => {
    const events = [deathAt(1), deathAt(1), deathAt(5), famineAt(0), famineAt(4), famineAt(8)];
    const counts = countByType(events);
    assert.equal(counts.get('death'), 3);
    assert.equal(counts.get('famine'), 3);
    assert.deepEqual(occurrenceTicks(events, 'death'), [1, 5]);

    const rows = census(events, 10);
    const death = rows.find((r) => r.type === 'death')!;
    assert.equal(death.count, 3);
    assert.equal(death.ticks, 2);
    assert.equal(death.ratePer100, 30);
    assert.equal(death.medianGap, 4);
    const famine = rows.find((r) => r.type === 'famine')!;
    assert.equal(famine.medianGap, 4);
    assert.equal(famine.ratePer100, 30);
  });
});

describe('lag correlation', () => {
  it('recovers a planted shift as the peak lag', () => {
    const T = 100;
    const impulse = new Float64Array(T);
    impulse[20] = 1;
    impulse[70] = 1;
    const metric = new Array<number>(T).fill(0);
    metric[28] = 1;
    metric[78] = 1;
    const { peakLag, peakR } = lagCorrelation(impulse, metric, 15);
    assert.equal(peakLag, 8);
    assert.ok(peakR > 0.95, `peak r ${peakR} should be near 1`);
  });

  it('keeps the neutral lag 0 when there is nothing to correlate', () => {
    const impulse = new Float64Array(50);
    impulse[10] = 1;
    const metric = new Array<number>(50).fill(50);
    const { peakLag, peakR } = lagCorrelation(impulse, metric, 10);
    assert.equal(peakLag, 0);
    assert.equal(peakR, 0);
  });
});

describe('observational attribution', () => {
  /** famine fires at 10 well-spaced ticks, each a plateau of elevated
   *  aliveCount (height varying so the paired t has variance to work with);
   *  war fires on ~90% of ticks (must be skipped as dense);
   *  death fires twice (below the occurrence minimum). */
  const T = 220;
  const occ = [20, 40, 60, 80, 100, 120, 140, 160, 180, 200];
  const build = () => {
    const events: SimEvent[] = [];
    const series: SeriesPoint[] = [];
    for (let t = 0; t < T; t++) {
      const idx = occ.indexOf(t);
      const plateau = idx >= 0 ? 105 + (idx % 3) : null;
      let alive = 100;
      if (plateau !== null) alive = plateau;
      else {
        for (let k = 1; k <= 4; k++) {
          const prev = occ.indexOf(t - k);
          if (prev >= 0) alive = 105 + (prev % 3);
        }
      }
      series.push(pointAt(t, alive));
      if (idx >= 0) events.push(famineAt(t));
      if (t < 199) events.push(warAt(t));
      if (t === 100 || t === 150) events.push(deathAt(t));
    }
    return { events, series };
  };

  it('recovers the planted pre/post effect and flags pathological types', () => {
    const { events, series } = build();
    const report = analyzeObservational(events, series, { window: 5, lag: 10 });
    assert.equal(report.totalTicks, T);

    const famine = report.rows.filter((r) => r.type === 'famine');
    assert.ok(famine.length > 0, 'famine should be analyzed');
    const aliveRow = famine.find((r) => r.metric === 'aliveCount')!;
    assert.ok(aliveRow, 'aliveCount row exists');
    assert.ok(Math.abs(aliveRow.meanDelta - 5.9) < 0.5, `delta ${aliveRow.meanDelta} ≈ +5.9`);
    assert.ok(aliveRow.cohensDz > 1, `d_z ${aliveRow.cohensDz} should be large`);
    assert.ok(aliveRow.p < 0.05, `p ${aliveRow.p}`);
    assert.ok(Math.abs(aliveRow.peakR) > 0.3, `peak r ${aliveRow.peakR}`);
    assert.equal(aliveRow.n, 10);

    const warSkip = report.skipped.find((s) => s.type === 'war')!;
    assert.ok(warSkip, 'war is skipped');
    assert.match(warSkip.reason, /fires on 9\d% of ticks/);
    const deathSkip = report.skipped.find((s) => s.type === 'death')!;
    assert.match(deathSkip.reason, /only 2 occurrence tick\(s\)/);

    assert.ok(report.rows.every((r) => r.n >= 5));
  });

  it('renders md/json/csv/svg from the same inputs', () => {
    const { events, series } = build();
    const observational = analyzeObservational(events, series, { window: 5, lag: 10 });
    const input: EventReportInput = {
      source: { mode: 'in-process', seeds: ['syn.s1'], ticks: T, spawn: 40, invalidLines: 0, totalEvents: events.length },
      window: 5,
      lag: 10,
      censuses: census(events, T),
      observational,
      interventional: null,
      plants: [],
    };
    const { md, json, csv } = renderEventReport(input);
    assert.match(md, /# Event causality report/);
    assert.match(md, /## Event census/);
    assert.match(md, /## Observational pre\/post attribution/);
    assert.match(md, /`famine`/);
    assert.match(md, /fires on 9\d% of ticks/);
    assert.doesNotMatch(md, /## Interventional/);

    const parsed = JSON.parse(json) as { observational: { rows: unknown[] } };
    assert.equal(parsed.observational.rows.length, observational.rows.length);

    const lines = csv.split('\n');
    assert.equal(lines[0], 'scope,type,metric,n,mean_pre_base,mean_post_treated,mean_delta,cohens_dz,p,peak_r,peak_lag,sign_consistent');
    assert.equal(lines.length, 1 + observational.rows.length);
    assert.ok(lines.some((l) => l.startsWith('obs,famine,aliveCount,')));

    const svg = renderEventSvg(input);
    assert.ok(svg.startsWith('<svg'));
    assert.ok(svg.includes('famine -> aliveCount'));
    assert.ok(svg.includes('event census'));
  });

  it('renders file-mode reports as census-only', () => {
    const input: EventReportInput = {
      source: { mode: 'file', file: 'export.ndjson', seeds: [], ticks: 30, spawn: 0, invalidLines: 1, totalEvents: 4 },
      window: 10,
      lag: 10,
      censuses: census([famineAt(1), famineAt(9), warAt(3), warAt(20)], 30),
      observational: null,
      interventional: null,
      plants: [],
    };
    const { md } = renderEventReport(input);
    assert.match(md, /census-level/);
    assert.match(md, /cannot be replayed/);
    assert.doesNotMatch(md, /## Observational/);
  });
});

describe('interventional pairing', () => {
  it('verifies pre-plant identity and attributes the meteor delta', () => {
    const opts = { ticks: 50, spawn: 40 };
    const plants = [{ tick: 25, intervention: { type: 'meteor' as const, radius: 128, sequence: 1 } }];
    const seeds = ['it.s1', 'it.s2'];
    const treatments = seeds.map((seed) => runWithEvents({ ...opts, seed, plants }));
    const baselines = seeds.map((seed) => runWithEvents({ ...opts, seed, plants: [] }));

    const inter = pairInterventional(treatments, baselines, { window: 8 });
    assert.equal(inter.equivalentUpToTick, 25);
    assert.equal(inter.plants.length, 1);
    assert.equal(inter.plants[0]!.itype, 'meteor');

    const meteorRows = inter.rows.filter((r) => r.itype === 'meteor');
    assert.ok(meteorRows.length > 0, 'meteor rows exist');
    const alive = meteorRows.find((r) => r.metric === 'aliveCount');
    if (alive) assert.ok(alive.meanDelta <= 0, `aliveCount delta ${alive.meanDelta} cannot be positive`);

    const intDeaths = (evs: SimEvent[]) =>
      evs.filter((e) => e.type === 'death' && e.data.cause === 'intervention').length;
    assert.ok(intDeaths(treatments[0]!.events) >= 1, 'treatment killed by the meteor');
    assert.equal(intDeaths(baselines[0]!.events), 0, 'baseline never saw an intervention');

    const planted = treatments[0]!.plants[0]!.intervention;
    assert.ok(planted.x !== undefined && planted.y !== undefined, 'plant anchored on a live agent');
    assert.equal(treatments[0]!.events.some((e) => e.type === 'intervention' && e.data.itype === 'meteor'), true);
  });

  it('rejects arms that diverge before the first plant', () => {
    const opts = { ticks: 30, spawn: 30 };
    const plants = [{ tick: 15, intervention: { type: 'meteor' as const, radius: 64, sequence: 1 } }];
    const treatment = runWithEvents({ ...opts, seed: 'div.s1', plants });
    const skewed = runWithEvents({ ...opts, seed: 'div.s2', plants: [] });
    assert.throws(() => pairInterventional([treatment], [skewed], { window: 5 }), /diverge at tick/);
  });
});

describe('default intervention schedule', () => {
  it('plants strictly inside the run with increasing ticks', () => {
    const plants = defaultPlants(100);
    assert.equal(plants.length, 3);
    for (const p of plants) assert.ok(p.tick >= 20 && p.tick < 100, `plant tick ${p.tick}`);
    for (let i = 1; i < plants.length; i++) assert.ok(plants[i]!.tick > plants[i - 1]!.tick);
    assert.deepEqual(plants.map((p) => p.intervention.type), ['meteor', 'seedFood', 'pauseRegion']);
  });
});
