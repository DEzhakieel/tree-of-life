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
import { parseProposals, runResearchLoop } from '../src/research/ai/researchAgent.js';
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

test('research loop proposes then records harness-evaluated verdicts', async () => {
  const llm = createLlm({ provider: 'mock', cache: 'off' });
  const props = parseProposals(mockGenerate([{ role: 'user', content: 'TASK: research-proposal\nctx' }], { json: true }));
  assert.ok(props.length >= 1);

  const { proposals, records } = await runResearchLoop(llm, 'ctx', (p) => ({
    verdict: 'supported',
    detail: `checked ${p.model}`,
  }));
  assert.equal(proposals.length, records.length);
  assert.ok(records.every((r) => r.verdict === 'supported'));
});
