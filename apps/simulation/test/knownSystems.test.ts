import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BENCHMARK_MODELS } from '../src/research/benchmarks/models/index.js';
import { buildKnownReport, KNOWN_SYSTEMS } from '../src/research/benchmarks/knownSystems/index.js';
import { renderKnownReport, renderKnownSvg } from '../src/research/benchmarks/knownRun.js';

test('registry entries are well-formed and uniquely identified', () => {
  const ids = new Set<string>();
  for (const s of KNOWN_SYSTEMS) {
    assert.ok(!ids.has(s.id), `duplicate id ${s.id}`);
    ids.add(s.id);
    assert.ok(s.name.length > 0, `${s.id} has a name`);
    assert.ok(s.reference.length > 0, `${s.id} cites a reference`);
    assert.ok(s.demonstrates.length > 0, `${s.id} states what it demonstrates`);
    assert.ok(s.replication.length > 0, `${s.id} describes its replication`);
    assert.ok(s.domain === 'scientific' || s.domain === 'platform');
  }
});

test('every replicated entry links to a shipped benchmark', () => {
  const benchIds = new Set(BENCHMARK_MODELS.map((m) => m.id));
  for (const s of KNOWN_SYSTEMS) {
    if (s.replicated) {
      assert.ok(s.benchId, `${s.id} declares a benchId when replicated`);
      assert.ok(benchIds.has(s.benchId!), `${s.id} links to a real benchmark (${s.benchId})`);
    }
  }
});

test('buildKnownReport computes fidelity for replicated entries and documents the rest', () => {
  const report = buildKnownReport('quick');
  assert.equal(report.entries.length, KNOWN_SYSTEMS.length);
  assert.ok(report.scientific > 0 && report.platforms > 0);

  for (const e of report.entries) {
    if (e.replicated) {
      assert.notEqual(e.status, 'documented', `${e.id} is replicated`);
      assert.ok(e.fidelity !== undefined && e.fidelity >= 0 && e.fidelity <= 1, `${e.id} fidelity in range`);
    } else {
      assert.equal(e.status, 'documented', `${e.id} is documented-only`);
      assert.equal(e.fidelity, undefined);
    }
  }

  const { md, json } = renderKnownReport(report);
  assert.ok(md.includes('Known-systems reverse-engineering registry'));
  assert.ok(md.includes('## Scientific systems'));
  assert.ok(md.includes('## Platform systems'));
  assert.ok(JSON.parse(json).entries.length === report.entries.length);
  assert.ok(renderKnownSvg(report).includes('<svg'));
});
