import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { LEVELS } from '@fractal-life/shared';
import {
  ABLATIONS,
  RADAR_MARGIN,
  baselineSpec,
  renderRadarReport,
  renderRadarSvg,
  runRadar,
  runRadarReport,
  validateDetector,
} from '../src/research/emergenceRadar.js';

describe('ablation registry', () => {
  it('covers every level with a named ablation', () => {
    for (const def of LEVELS) {
      assert.ok(ABLATIONS[def.ablation], `${def.id} ablation ${def.ablation} missing`);
    }
  });

  it('wires a transform for every level ablation', () => {
    assert.equal(typeof ABLATIONS.world!.transform, 'function');
    assert.equal(typeof ABLATIONS['signal-zero']!.transform, 'function');
    assert.equal(typeof ABLATIONS['meme-zero']!.transform, 'function');
    for (const def of LEVELS) {
      assert.equal(typeof ABLATIONS[def.ablation]!.transform, 'function', `${def.id} ablation not wired`);
    }
  });
});

describe('validateDetector', () => {
  it('accepts an emergent baseline that collapses under ablation', () => {
    assert.equal(validateDetector(0.9, 0.1), true);
    assert.equal(validateDetector(0.6, 0.6 - RADAR_MARGIN), true);
  });

  it('rejects a weak baseline or a weak drop', () => {
    assert.equal(validateDetector(0.5, 0.1), false); // baseline never emerged
    assert.equal(validateDetector(0.9, 0.8), false); // ablation did not collapse
  });
});

describe('runRadar', () => {
  it('is deterministic for the same seed and spec', () => {
    const spec = { ...baselineSpec(30, 8), sampleEvery: 10 };
    const a = runRadar('radar.det', spec);
    const b = runRadar('radar.det', spec);
    assert.deepEqual(
      a.summary.levels.map((l) => l.peakScore),
      b.summary.levels.map((l) => l.peakScore),
    );
    assert.equal(a.points.length, b.points.length);
    assert.equal(a.summary.levels.length, 11);
  });
});

describe('runRadarReport', () => {
  it('produces a verdict for every level and renders md/json/csv/svg', () => {
    const report = runRadarReport({ seeds: ['radar.t1'], ticks: 30, spawn: 8 });
    assert.equal(report.verdicts.length, 11);
    assert.equal(report.verdicts.filter((v) => v.wired).length, 11);
    assert.equal(report.pass, report.verdicts.every((v) => v.validated));

    const { md, json, csv } = renderRadarReport(report);
    assert.ok(md.includes('# emergence radar'));
    assert.ok(md.includes('ablation validation'));
    const parsed = JSON.parse(json);
    assert.equal(parsed.verdicts.length, 11);
    assert.equal(csv.trim().split('\n').length, 1 + 11); // header + 1 seed * 11 levels

    const svg = renderRadarSvg(report);
    assert.ok(svg.startsWith('<svg'));
    for (const def of LEVELS) assert.ok(svg.includes(def.id));
  });
});
