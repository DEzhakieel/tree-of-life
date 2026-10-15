import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runWithEvents, type EventCapture, type SeriesPoint } from '../src/research/eventLog.js';
import {
  buildAtlasRun,
  pooledSummary,
  renderAtlasReport,
  renderAtlasSvg,
  samplesFromSeries,
} from '../src/research/emergenceAtlas.js';

const point = (tick: number, over: Partial<Record<string, number>> = {}): SeriesPoint => ({
  tick,
  values: {
    aliveCount: 10,
    avgEnergy: 50,
    speciesCount: 4,
    entropy: 2,
    diversity: 0.5,
    cooperation: 0.5,
    predatorFraction: 0.1,
    cultureCount: 3,
    complexity: 1,
    lyapunovExponent: 0,
    ...over,
  },
});

const capture = (series: SeriesPoint[], seed = 'atlas.test'): EventCapture => ({
  seed,
  ticks: series.length,
  events: [],
  series,
  plants: [],
});

describe('samplesFromSeries', () => {
  it('maps the captured metrics and tolerates absent keys', () => {
    const s = samplesFromSeries([point(5, { complexity: 3, lyapunovExponent: 1.5 })]);
    assert.deepEqual(s[0], {
      tick: 5,
      entropy: 2,
      diversity: 0.5,
      complexity: 3,
      speciesCount: 4,
      lyapunovExponent: 1.5,
    });
    const bare = { tick: 9, values: { entropy: 1, diversity: 0.2 } } as SeriesPoint;
    const [b] = samplesFromSeries([bare]);
    assert.equal(b!.complexity, 0);
    assert.equal(b!.speciesCount, undefined);
    assert.equal(b!.lyapunovExponent, undefined);
  });
});

describe('buildAtlasRun', () => {
  it('traces a run from ordered to chaotic', () => {
    const series: SeriesPoint[] = [point(0, { speciesCount: 1, entropy: 0, diversity: 0, complexity: 0 })];
    for (let t = 1; t <= 10; t++) {
      series.push(point(t, { speciesCount: 8, entropy: 3, diversity: 1, complexity: 4, lyapunovExponent: 4 }));
    }
    const run = buildAtlasRun('move', capture(series));
    assert.equal(run.summary.n, 11);
    assert.equal(run.points[0]!.regime, 'order');
    assert.equal(run.points[10]!.regime, 'chaos');
    assert.equal(run.summary.dominant, 'chaos');
    assert.equal(run.summary.peak?.y, 1);
    assert.equal(run.summary.end?.regime, 'chaos');
  });

  it('captures complexity and lyapunov out of a real run (ATLAS_METRICS)', () => {
    const cap = runWithEvents({ seed: 'atlas.capture', ticks: 40, spawn: 30 });
    const s = cap.series[10]!;
    assert.ok('complexity' in s.values, 'complexity captured');
    assert.ok('lyapunovExponent' in s.values, 'lyapunovExponent captured');
    const run = buildAtlasRun('atlas.capture', cap);
    assert.equal(run.summary.n, 40);
    assert.ok(run.summary.end !== null);
  });
});

describe('pooledSummary', () => {
  it('weights runs by their point counts and sums to a valid split', () => {
    const ordered = buildAtlasRun(
      'a',
      capture(Array.from({ length: 9 }, (_, t) => point(t, { speciesCount: 1, entropy: 0, diversity: 0, complexity: 1 }))),
    );
    const chaotic = buildAtlasRun(
      'b',
      capture([
        point(100, { speciesCount: 8, entropy: 3, diversity: 0.3, complexity: 3, lyapunovExponent: 1 }),
        point(101, { speciesCount: 8, entropy: 3, diversity: 1, complexity: 3, lyapunovExponent: 4 }),
      ]),
    );
    const pooled = pooledSummary([ordered, chaotic]);
    assert.equal(pooled.n, 11);
    assert.ok(Math.abs(pooled.residence.order - 10 / 11) < 1e-9);
    assert.ok(Math.abs(pooled.residence.chaos - 1 / 11) < 1e-9);
    assert.ok(
      Math.abs(pooled.residence.order + pooled.residence.edge + pooled.residence.chaos - 1) < 1e-9,
    );
    assert.deepEqual(pooledSummary([]), {
      residence: { order: 0, edge: 0, chaos: 0 },
      meanY: { order: 0, edge: 0, chaos: 0 },
      n: 0,
    });
  });
});

describe('report rendering', () => {
  const input = {
    seeds: ['atlas.s1', 'atlas.s2'],
    ticks: 400,
    spawn: 100,
    runs: ['atlas.s1', 'atlas.s2'].map((seed) =>
      buildAtlasRun(
        seed,
        capture([
          point(0, { speciesCount: 1, entropy: 0, diversity: 0, complexity: 0 }),
          point(200, { speciesCount: 6, entropy: 2.5, diversity: 0.8, complexity: 2, lyapunovExponent: -1 }),
          point(399, { speciesCount: 8, entropy: 3, diversity: 1, complexity: 4, lyapunovExponent: 3 }),
        ]),
      ),
    ),
  };

  it('renders markdown with runs, pooled residence and reading notes', () => {
    const { md } = renderAtlasReport(input);
    assert.match(md, /^# emergence atlas: atlas\.s1, atlas\.s2/);
    assert.match(md, /\| atlas\.s1 \| 3 \|/);
    assert.match(md, /## pooled residence/);
    assert.match(md, /## how to read this/);
    assert.match(md, /not causal/);
  });

  it('renders parseable json carrying the full point series', () => {
    const { json } = renderAtlasReport(input);
    const parsed = JSON.parse(json) as { seeds: string[]; runs: { points: unknown[] }[] };
    assert.deepEqual(parsed.seeds, ['atlas.s1', 'atlas.s2']);
    assert.equal(parsed.runs.length, 2);
    assert.equal(parsed.runs[0]!.points.length, 3);
  });

  it('renders the phase-diagram svg with bands, arch, trajectories and legend', () => {
    const svg = renderAtlasSvg(input);
    assert.ok(svg.startsWith('<svg'));
    assert.ok(svg.endsWith('</svg>'));
    assert.match(svg, /ORDER/);
    assert.match(svg, /EDGE/);
    assert.match(svg, /CHAOS/);
    assert.match(svg, /stroke-dasharray="5 5"/); // reference arch
    assert.match(svg, /atlas\.s1/); // endpoint labels / legend
    assert.match(svg, /composite disorder/);
    assert.match(svg, /complexity \(run peak = 1\)/);
  });
});
