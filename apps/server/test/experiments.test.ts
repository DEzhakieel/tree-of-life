import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { createApi } from '../src/api/index.js';
import { createExperimentsApi } from '../src/api/experiments.js';
import { ExperimentJobs, experimentManifestPath } from '../src/experiments/jobs.js';
import type {
  ExperimentJob,
  ExperimentJobInput,
  ExperimentJobMessage,
  ExperimentJobQueue,
  ExperimentJobRequest,
  ExperimentWorkerHandle,
} from '../src/experiments/types.js';
import type { Experiment, ExperimentManifest } from '@fractal-life/simulation/research';
import { defaultExperiments } from '@fractal-life/simulation/research';
import { WorldManager } from '../src/worldManager.js';
import { config } from '../src/config.js';
import { GroundingService } from '../src/data/groundingService.js';
import type { Gateway, WsClient } from '../src/gateway/types.js';
import type { Storage, StoredSnapshot, AgentRecord } from '../src/store/interface.js';
import type { WorldConfig, SimEvent } from '@fractal-life/shared';

class StubGateway implements Gateway {
  readonly kind = 'ws' as const;
  onConnect(_cb: (client: WsClient) => void): void {}
  onMessage(_cb: (client: WsClient, data: Uint8Array | string) => void): void {}
  onDisconnect(_cb: (client: WsClient) => void): void {}
  async start(): Promise<void> {}
  async stop(): Promise<void> {}
}

class StubStorage implements Storage {
  async saveWorld(_world: WorldConfig): Promise<void> {}
  async updateWorldTick(_worldId: string, _tick: number): Promise<void> {}
  async saveSnapshot(_worldId: string, _snap: StoredSnapshot): Promise<void> {}
  async getSnapshot(_worldId: string, _tick: number): Promise<StoredSnapshot | null> {
    return null;
  }
  async getLatestSnapshot(_worldId: string): Promise<StoredSnapshot | null> {
    return null;
  }
  async listWorlds(): Promise<WorldConfig[]> {
    return [];
  }
  async getWorld(_worldId: string): Promise<WorldConfig | null> {
    return null;
  }
  async saveEvents(_worldId: string, _events: SimEvent[]): Promise<void> {}
  async listEvents(_worldId: string): Promise<SimEvent[]> {
    return [];
  }
  async saveAgents(_worldId: string, _agents: AgentRecord[]): Promise<void> {}
  async listAgents(_worldId: string): Promise<AgentRecord[]> {
    return [];
  }
  async deleteWorld(_worldId: string): Promise<void> {}
}

/** Queue stand-in: records what the API submitted and hands back a canned job,
 * so the HTTP contract is covered without starting a worker thread. */
class FakeQueue implements ExperimentJobQueue {
  readonly submitted: ExperimentJobInput[] = [];
  private readonly jobs = new Map<string, ExperimentJob>();

  submit(input: ExperimentJobInput): ExperimentJob {
    const job: ExperimentJob = {
      id: `job-${this.submitted.length + 1}`,
      mode: input.mode,
      experimentId: input.mode === 'run' ? input.experiment.id : input.manifest.experiment.id,
      status: 'queued',
      progress: null,
      createdAt: new Date().toISOString(),
    };
    this.submitted.push(input);
    this.jobs.set(job.id, job);
    return job;
  }

  get(jobId: string): ExperimentJob | undefined {
    return this.jobs.get(jobId);
  }

  list(): ExperimentJob[] {
    return [...this.jobs.values()];
  }
}

/** Worker stand-in the queue can be driven with: `emit` plays the worker's
 * replies, so the whole job lifecycle runs without a real thread. */
class FakeWorker implements ExperimentWorkerHandle {
  readonly sent: ExperimentJobRequest[] = [];
  terminated = false;
  private readonly listeners = new Map<string, Array<(...args: unknown[]) => void>>();

  postMessage(message: ExperimentJobRequest): void {
    this.sent.push(message);
  }

  terminate(): void {
    this.terminated = true;
  }

  on(event: string, listener: (...args: never[]) => void): unknown {
    const list = this.listeners.get(event) ?? [];
    list.push(listener as (...args: unknown[]) => void);
    this.listeners.set(event, list);
    return this;
  }

  emit(event: string, ...args: unknown[]): void {
    for (const cb of this.listeners.get(event) ?? []) cb(...args);
  }

  reply(msg: Omit<ExperimentJobMessage, 'jobId'>): void {
    this.emit('message', { jobId: this.sent[0]!.jobId, ...msg });
  }
}

function tinyExp(overrides: Partial<Experiment> = {}): Experiment {
  return {
    id: 'unit-tiny',
    name: 'Unit Tiny',
    hypothesis: 'job bookkeeping is correct',
    tags: ['test'],
    seeds: ['unit-seed-0001'],
    ladder: { ticks: 10, spawnCount: 4, maxPopulation: 8, sampleEvery: 5 },
    objectiveIds: ['l1-emergent'],
    createdAt: '2026-10-18T00:00:00.000Z',
    ...overrides,
  };
}

function fakeManifest(exp: Experiment): ExperimentManifest {
  return {
    experiment: exp,
    objectiveIds: exp.objectiveIds ?? [],
    ranAt: '2026-10-18T00:00:00.000Z',
    runtime: { node: process.version, platform: process.platform },
    perSeed: exp.seeds.map((seed) => ({
      seed,
      digest: 'f'.repeat(64),
      score: 0.5,
      breakdown: { 'l1-emergent': 0.5 },
      thresholdsMet: false,
      verdicts: { 'L1 life': 'ABSENT' },
    })),
    aggregate: { meanScore: 0.5, sdScore: 0, passRate: 0 },
    reproducible: true,
  };
}

describe('experiment directory HTTP API', () => {
  const storage = new StubStorage();
  const gateway = new StubGateway();
  const grounding = new GroundingService();
  const queue = new FakeQueue();
  // Manifests are served from disk, so point the router at a scratch dir — the
  // test must not depend on (or dirty) the real research/experiments records.
  const outDir = mkdtempSync(join(tmpdir(), 'exp-api-'));
  let wm: WorldManager;
  let server: http.Server;
  let baseUrl: string;

  before(async () => {
    wm = new WorldManager(gateway, storage, config, grounding);
    const app = express();
    app.use(express.json());
    // Mounted ahead of createApi so the router under test gets the fake queue;
    // createApi still registers the real mount, which proves the path is right.
    app.use('/api/experiments', createExperimentsApi(queue, outDir));
    app.use('/api', createApi(wm, storage, gateway, grounding));
    app.use('/api', (_req, res) => res.status(404).json({ error: 'not found' }));
    app.use('/api', (err: Error, _req: unknown, res: express.Response, _next: unknown) => {
      res.status(500).json({ error: err.message });
    });
    server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const { port } = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${port}/api/experiments`;
  });

  after(async () => {
    rmSync(outDir, { recursive: true, force: true });
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  });

  it('lists the registered experiments', async () => {
    const res = await fetch(baseUrl);
    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      experiments: Array<{ id: string; kind?: string; seeds: string[]; ews?: { ramps: number[] }; hypothesis: string }>;
    };
    const ids = body.experiments.map((e) => e.id);
    assert.deepEqual(ids.sort(), ['abundance-lift', 'ews-sweep', 'l3-baseline']);
    const ews = body.experiments.find((e) => e.id === 'ews-sweep')!;
    assert.equal(ews.kind, 'ews');
    assert.ok(Array.isArray(ews.ews?.ramps) && ews.ews.ramps.length > 0);
    const baseline = body.experiments.find((e) => e.id === 'l3-baseline')!;
    assert.equal(baseline.kind ?? 'ladder', 'ladder');
    assert.equal(baseline.seeds.length, 3);
    assert.ok(baseline.hypothesis.length > 0, 'the falsifiable claim travels with the catalog entry');
  });

  it('returns a full experiment, or 404 naming what exists', async () => {
    const ok = await fetch(`${baseUrl}/l3-baseline`);
    assert.equal(ok.status, 200);
    const exp = (await ok.json()) as Experiment;
    assert.equal(exp.id, 'l3-baseline');
    assert.ok(exp.hypothesis.length > 0);

    const missing = await fetch(`${baseUrl}/nope`);
    assert.equal(missing.status, 404);
    const body = (await missing.json()) as { error: string };
    assert.match(body.error, /unknown experiment 'nope'/);
    assert.match(body.error, /l3-baseline/);
  });

  it('404s a manifest that has not been recorded yet', async () => {
    const res = await fetch(`${baseUrl}/abundance-lift/manifest`);
    assert.equal(res.status, 404);
    const body = (await res.json()) as { error: string };
    assert.match(body.error, /run it first/);
  });

  it('queues a run and reports the job', async () => {
    const res = await fetch(`${baseUrl}/l3-baseline/run`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.equal(res.status, 202);
    const body = (await res.json()) as { job: ExperimentJob };
    assert.equal(body.job.mode, 'run');
    assert.equal(body.job.experimentId, 'l3-baseline');
    assert.equal(body.job.status, 'queued');
    assert.equal(queue.submitted.length, 1);
    const input = queue.submitted[0]!;
    assert.equal(input.mode, 'run');
    assert.equal(input.mode === 'run' && input.doubleCheck, false, 'double-check is opt-in over HTTP');

    const polled = await fetch(`${baseUrl}/jobs/${body.job.id}`);
    assert.equal(polled.status, 200);
    assert.equal(((await polled.json()) as ExperimentJob).id, body.job.id);

    const unknown = await fetch(`${baseUrl}/jobs/job-404`);
    assert.equal(unknown.status, 404);
  });

  it('honours doubleCheck=true and rejects unknown experiments', async () => {
    const res = await fetch(`${baseUrl}/l3-baseline/run`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ doubleCheck: true }),
    });
    assert.equal(res.status, 202);
    const input = queue.submitted[1]!;
    assert.equal(input.mode === 'run' && input.doubleCheck, true);

    const missing = await fetch(`${baseUrl}/nope/run`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.equal(missing.status, 404);
  });

  it('404s reproduce when nothing was recorded', async () => {
    const res = await fetch(`${baseUrl}/ews-sweep/reproduce`, { method: 'POST' });
    assert.equal(res.status, 404);
    const body = (await res.json()) as { error: string };
    assert.match(body.error, /run it first/);
  });

  it('serves a recorded manifest and reproduces from it', async () => {
    const exp = defaultExperiments().require('l3-baseline');
    writeFileSync(experimentManifestPath(exp.id, outDir), JSON.stringify(fakeManifest(exp)));

    const res = await fetch(`${baseUrl}/${exp.id}/manifest`);
    assert.equal(res.status, 200);
    assert.equal(((await res.json()) as ExperimentManifest).experiment.id, exp.id);

    const rep = await fetch(`${baseUrl}/${exp.id}/reproduce`, { method: 'POST' });
    assert.equal(rep.status, 202);
    assert.equal(queue.submitted.at(-1)!.mode, 'reproduce');
  });
});

describe('ExperimentJobs lifecycle', () => {
  // Scratch manifest dir: a finished job writes its manifest, and the test
  // asserts that without leaving anything in the repo.
  const outDir = mkdtempSync(join(tmpdir(), 'exp-jobs-'));

  after(() => {
    rmSync(outDir, { recursive: true, force: true });
  });

  it('runs a job through progress to done and reuses one worker', () => {
    const workers: FakeWorker[] = [];
    const jobs = new ExperimentJobs(() => {
      const w = new FakeWorker();
      workers.push(w);
      return w;
    }, outDir);

    const a = jobs.submit({ mode: 'run', experiment: tinyExp(), doubleCheck: false });
    assert.equal(a.status, 'running', 'first submit starts immediately');
    assert.equal(workers.length, 1);
    assert.equal(workers[0]!.sent.length, 1);
    assert.equal(workers[0]!.sent[0]!.jobId, a.id);

    const b = jobs.submit({ mode: 'reproduce', manifest: fakeManifest(tinyExp()) });
    assert.equal(b.status, 'queued', 'second submit waits for the active job');
    assert.equal(workers.length, 1, 'worker is reused, not spawned again');
    assert.equal(workers[0]!.sent.length, 1);

    workers[0]!.emit('message', { jobId: a.id, type: 'progress', done: 1, total: 2, label: 'unit-seed-0001' });
    assert.deepEqual(jobs.get(a.id)!.progress, { done: 1, total: 2, label: 'unit-seed-0001' });

    workers[0]!.emit('message', { jobId: a.id, type: 'result', manifest: fakeManifest(tinyExp()) });
    const done = jobs.get(a.id)!;
    assert.equal(done.status, 'done');
    assert.equal(typeof done.finishedAt, 'string');
    assert.equal(done.saveError, undefined, 'manifest written without error');
    assert.ok(
      existsSync(experimentManifestPath('unit-tiny', outDir)),
      'manifest lands in the injected out dir next to the CLI records',
    );
    assert.equal(b.status, 'running', 'queue advances when a job finishes');
    assert.equal(workers[0]!.sent.length, 2, 'next job went to the same worker');

    workers[0]!.emit('message', { jobId: b.id, type: 'result', report: { matched: true, seeds: [] } });
    assert.equal(jobs.get(b.id)!.status, 'done');
    assert.equal(jobs.get(b.id)!.report!.matched, true);
    jobs.shutdown();
  });

  it('surfaces worker errors and keeps the queue moving', () => {
    const workers: FakeWorker[] = [];
    const jobs = new ExperimentJobs(() => {
      const w = new FakeWorker();
      workers.push(w);
      return w;
    }, outDir);

    const a = jobs.submit({ mode: 'run', experiment: tinyExp(), doubleCheck: false });
    const b = jobs.submit({ mode: 'run', experiment: tinyExp({ id: 'unit-tiny-2' }), doubleCheck: false });
    workers[0]!.emit('error', new Error('boom'));
    assert.equal(jobs.get(a.id)!.status, 'error');
    assert.equal(jobs.get(a.id)!.error, 'boom');
    assert.equal(b.status, 'running', 'a crashed worker does not strand the queue');
    assert.equal(workers.length, 2, 'a fresh worker takes over');

    workers[1]!.emit('exit', 1);
    assert.equal(jobs.get(b.id)!.status, 'error');
    assert.match(jobs.get(b.id)!.error!, /exited with code 1/);
    jobs.shutdown();
  });

  it('reports the experiment error rather than hanging', () => {
    const workers: FakeWorker[] = [];
    const jobs = new ExperimentJobs(() => {
      const w = new FakeWorker();
      workers.push(w);
      return w;
    }, outDir);
    const a = jobs.submit({ mode: 'run', experiment: tinyExp(), doubleCheck: false });
    workers[0]!.emit('message', { jobId: a.id, type: 'error', message: "unknown objective 'nope'" });
    const job = jobs.get(a.id)!;
    assert.equal(job.status, 'error');
    assert.match(job.error!, /unknown objective/);
    jobs.shutdown();
  });
});
