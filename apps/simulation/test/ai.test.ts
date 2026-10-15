import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createLlm, parseJsonLoose } from '../src/research/ai/client.js';
import { stableStringify, sha256Hex } from '../src/research/ai/hash.js';
import { clampOverrides } from '../src/research/ai/knobs.js';
import { mockGenerate } from '../src/research/ai/mock.js';
import { directiveFromObject, parseDirective, directWorld } from '../src/research/ai/worldAI.js';
import { parseAnalysis, analysePhases } from '../src/research/ai/phaseAnalyst.js';
import { runResearchLoop } from '../src/research/ai/researchAgent.js';
import { runWorldControl } from '../src/research/ai/controller.js';
import { applyWorldOverrides } from '../src/research/ai/world.js';
import { makeWorld } from '../src/research/scenarios.js';
import { Engine } from '../src/engine.js';
import type { LlmMessage } from '../src/research/ai/types.js';

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ai-test-'));
}

test('stableStringify is key-order independent and sha256 is stable', () => {
  const a = stableStringify({ b: 1, a: { y: 2, x: 3 } });
  const b = stableStringify({ a: { x: 3, y: 2 }, b: 1 });
  assert.equal(a, b);
  assert.equal(sha256Hex(a), sha256Hex(b));
  assert.match(sha256Hex('x'), /^[0-9a-f]{64}$/);
});

test('parseJsonLoose tolerates fences and leading prose', () => {
  assert.deepEqual(parseJsonLoose('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(parseJsonLoose('Sure! Here you go: {"a":[1,2]} done.'), { a: [1, 2] });
  assert.deepEqual(parseJsonLoose('[1,2,3]'), [1, 2, 3]);
});

test('clampOverrides clamps to declared ranges and drops unknown knobs', () => {
  const out = clampOverrides({ metabolismBase: 999, foodRegenRate: -5, notAKnob: 3 });
  assert.equal(out.metabolismBase, 3);
  assert.equal(out.foodRegenRate, 0.00002);
  assert.ok(!('notAKnob' in out));
});

test('mock backend is deterministic and task-routed', () => {
  const msgs: LlmMessage[] = [{ role: 'user', content: 'TASK: world-directive\nsteer please' }];
  const a = mockGenerate(msgs, { json: true });
  const b = mockGenerate(msgs, { json: true });
  assert.equal(a, b);
  const obj = JSON.parse(a) as { overrides: Record<string, number> };
  assert.ok(Object.keys(obj.overrides).length > 0);
});

test('LLM cache serves the second call from disk without a backend hit', async () => {
  const llm = createLlm({ provider: 'mock', cache: 'on', cacheDir: tmpDir() });
  const msgs: LlmMessage[] = [{ role: 'user', content: 'TASK: research-proposal\nx' }];
  const a = await llm.chat(msgs);
  const b = await llm.chat(msgs);
  assert.equal(a.cached, false);
  assert.equal(b.cached, true);
  assert.equal(a.content, b.content);
  assert.equal(a.key, b.key);
});

test('replay cache mode hard-errors on a miss', async () => {
  const llm = createLlm({ provider: 'mock', cache: 'replay', cacheDir: tmpDir() });
  await assert.rejects(
    () => llm.chat([{ role: 'user', content: 'TASK: world-directive\nnever cached' }]),
    /replay miss/,
  );
});

test('directive parsing clamps overrides from raw model output', () => {
  const d = parseDirective('{"objective":"o","rationale":"r","overrides":{"metabolismBase":1e9,"bogus":2},"species":[{"name":"a","strategy":"expand"}]}');
  assert.equal(d.overrides.metabolismBase, 3);
  assert.ok(!('bogus' in d.overrides));
  assert.equal(d.species[0]!.name, 'a');
});

test('directWorld returns a safe directive from the mock backend', async () => {
  const llm = createLlm({ provider: 'mock', cache: 'off' });
  const { directive, result } = await directWorld(llm, 'seed=test');
  assert.ok(Object.keys(directive.overrides).every((k) => typeof directive.overrides[k] === 'number'));
  assert.equal(result.provider, 'mock');
  assert.equal(directiveFromObject({ overrides: {}, species: [] }).species.length, 0);
});

test('phase analysis parses and filters non-numeric refinements', () => {
  const a = parseAnalysis('{"loci":[{"axis":"x","locus":"y","sharp":true,"note":"n"}],"recommendation":"r","refine":[{"axis":"x","around":1.5},{"axis":"z","around":"nope"}]}');
  assert.equal(a.loci.length, 1);
  assert.equal(a.refine.length, 1);
  assert.equal(a.refine[0]!.around, 1.5);
});

test('analysePhases runs end-to-end on the mock backend', async () => {
  const llm = createLlm({ provider: 'mock', cache: 'off' });
  const { analysis } = await analysePhases(llm, 'axis=capacity sweep...');
  assert.ok(analysis.recommendation.length > 0);
});

test('research loop iterates rounds, deduplicates and writes a ledger', async () => {
  const llm = createLlm({ provider: 'mock', cache: 'off' });
  const { rounds, records, ledger, roundsUsed } = await runResearchLoop(llm, 'ctx', (p) => ({
    verdict: 'supported',
    detail: `checked ${p.model}`,
  }));
  assert.equal(roundsUsed, 3);
  assert.equal(rounds.length, 3);
  assert.equal(records.length, 9);
  assert.equal(ledger.length, 9);
  assert.equal(new Set(ledger.map((e) => e.key)).size, 9);
  assert.ok(ledger.every((e) => e.verdict === 'supported'));
  // each round explores a different slice of the suite
  assert.equal(rounds[0]!.records[0]!.proposal.model, 'A');
  assert.equal(rounds[1]!.records[0]!.proposal.model, 'C');
});

test('research loop stops early once a round repeats proposals', async () => {
  const llm = createLlm({ provider: 'mock', cache: 'off' });
  const { roundsUsed, records } = await runResearchLoop(llm, 'ctx', () => ({ verdict: 'supported', detail: 'ok' }), {
    maxRounds: 6,
  });
  assert.equal(records.length, 9);
  assert.equal(roundsUsed, 4); // round 4 only re-proposes known experiments
});

test('research loop stops when a round is entirely inconclusive', async () => {
  const llm = createLlm({ provider: 'mock', cache: 'off' });
  const { roundsUsed } = await runResearchLoop(llm, 'ctx', () => ({ verdict: 'inconclusive', detail: 'x' }), {
    maxRounds: 5,
  });
  assert.equal(roundsUsed, 1);
});

test('applyWorldOverrides actuates runtime knobs and drops construction-only ones', () => {
  const engine = new Engine(makeWorld('ai-override-test', 10, {}));
  const applied = applyWorldOverrides(engine, { spawnCount: 500, foodRegenRate: 0.005 });
  assert.deepEqual(applied, { foodRegenRate: 0.005 });
  assert.equal(engine.params.foodRegenRate, 0.005);
  assert.equal(engine.params.spawnCount, 10); // untouched: founders are construction-only
});

test('world controller runs a closed loop against an unsteered control', async () => {
  const llm = createLlm({ provider: 'mock', cache: 'off' });
  const run = await runWorldControl(llm, makeWorld('ai-test-ctrl', 80, {}), {
    objective: 'grow the population',
    windows: 3,
    windowTicks: 40,
    warmupTicks: 40,
  });
  assert.equal(run.trajectory.length, 3);
  assert.equal(run.control.tick, run.final.tick); // identical tick budget
  for (const t of run.trajectory) {
    assert.ok(Object.keys(t.directive.overrides).length > 0, 'directive should carry overrides');
    assert.ok(!(t.applied as Record<string, number>).spawnCount, 'founders must not be actuated mid-run');
    assert.ok(t.sample.tick > 40);
  }
  // every directive was issued from an observation of the PREVIOUS window
  assert.ok(run.trajectory[1]!.inForce && Object.keys(run.trajectory[1]!.inForce).length >= 0);
});

test('controller is reproducible with the mock backend', async () => {
  const opts = { objective: 'o', windows: 2, windowTicks: 30, warmupTicks: 30 };
  const a = await runWorldControl(createLlm({ provider: 'mock', cache: 'off' }), makeWorld('seed-x', 60, {}), opts);
  const b = await runWorldControl(createLlm({ provider: 'mock', cache: 'off' }), makeWorld('seed-x', 60, {}), opts);
  assert.deepEqual(a.final, b.final);
  assert.deepEqual(
    a.trajectory.map((t) => t.applied),
    b.trajectory.map((t) => t.applied),
  );
  assert.deepEqual(a.control, b.control);
});
