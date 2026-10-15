/**
 * End-to-end WS gateway smoke test. Spawns the server, creates a world, joins
 * over the websocket, exercises interventions and event frames.
 *
 * Run: npm exec tsx -- scripts/ws-smoke.ts
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { decodeServerFrame } from '@fractal-life/shared';

const PORT = 8080;
const base = `http://localhost:${PORT}`;
const wsUrl = `ws://localhost:${PORT}/ws`;

function startServer(): ChildProcess {
  const child = spawn(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'apps/server/src/index.ts'], {
    cwd: process.cwd(),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout?.on('data', (d: Buffer) => console.log('[server]', d.toString().trim()));
  child.stderr?.on('data', (d: Buffer) => process.stderr.write(d));
  return child;
}

async function waitForHealth(timeoutMs = 20000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`${base}/api/health`);
      if (r.ok) return;
    } catch {
      /* not up yet */
    }
    await sleep(300);
  }
  throw new Error('server did not become healthy in time');
}

async function createWorld(): Promise<string> {
  const r = await fetch(`${base}/api/worlds`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      seed: `ws-smoke-${Date.now()}`,
      fractalType: 'julia',
      params: { spawnCount: 200, foodRegenRate: 0, metabolismBase: 0.05, maxPopulation: 500, maxIter: 64, worldScale: 2 },
    }),
  });
  if (!r.ok) throw new Error(`create world failed: ${r.status} ${await r.text()}`);
  const w = (await r.json()) as { id: string };
  console.log('[test] world created', w.id);
  return w.id;
}

function main(): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = startServer();
    const failures: string[] = [];

    waitForHealth()
      .then(async () => {
        const worldId = await createWorld();
        const { default: WebSocket } = await import('ws');
        const ws = new WebSocket(wsUrl);
        const counts = new Map<number, number>();
        const snapshots = new Map<number, { bytes: number; firstByte: number }>();
        let acks = 0;
        let events = 0;
        let sawWorld = false;
        let decodedDeltaAgents = 0;
        let decodeErrors = 0;
        let decodedSnapAgents = 0;
        let pausedFromServer: boolean | null = null;
        let lastDeltaTick = 0;
        const stepDeltas: number[] = [];
        let playConfirmed = false;

        // leave the server clean so runs don't accumulate worlds
        const cleanupWorld = async (): Promise<void> => {
          try {
            await fetch(`${base}/api/worlds/${worldId}`, { method: 'DELETE' });
            console.log('[test] world deleted', worldId);
          } catch {
            /* server already gone */
          }
        };

        const waitUntil = async (cond: () => boolean, timeoutMs: number): Promise<void> => {
          const deadline = Date.now() + timeoutMs;
          while (Date.now() < deadline) {
            if (cond()) return;
            await sleep(100);
          }
          throw new Error('waitUntil timeout');
        };

        const frameTimer = setTimeout(() => {
          console.log('[test] frame counts', Object.fromEntries([...counts.entries()].sort()));
          console.log('[test] snapshot sizes', [...snapshots.entries()].slice(0, 3));
          console.log('[test] results', { sawWorld, joined: sawWorld, acks, events, decodedDeltaAgents, decodedSnapAgents, decodeErrors, pausedFromServer, stepDeltas, playConfirmed });
          for (const f of failures) console.log('[test] FAIL', f);
          const ok =
            counts.get(0)! > 0 &&
            counts.get(1)! > 50 &&
            counts.get(2)! > 0 &&
            counts.get(3)! >= 1 &&
            sawWorld &&
            acks === 4 &&
            events > 0 &&
            decodeErrors === 0 &&
            decodedDeltaAgents > 0 &&
            decodedSnapAgents > 0 &&
            stepDeltas.length === 2 &&
            stepDeltas[0] === 1 &&
            stepDeltas[1] === 1 &&
            pausedFromServer === false &&
            playConfirmed &&
            failures.length === 0;
          console.log('[test] RESULT', ok ? 'PASS' : 'FAIL');
          ws.close();
          void cleanupWorld().finally(() => {
            child.kill();
            resolve();
          });
        }, 15000);

        ws.on('open', () => {
          ws.send(JSON.stringify({ op: 'join', worldId }));
        });

        ws.on('message', (data: Buffer) => {
          // Exact per-message framing: Buffer is a slice into a shared pool.
          const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
          const mt = bytes[0]!;
          counts.set(mt, (counts.get(mt) ?? 0) + 1);
          if (mt === 3 && !sawWorld) {
            sawWorld = true;
            const worldFrame = JSON.parse(data.subarray(1).toString());
            console.log('[test] world frame', worldFrame.world?.id, 'tick', worldFrame.status?.currentTick);
          }
          if (mt === 3) {
            const worldFrame = JSON.parse(data.subarray(1).toString());
            pausedFromServer = worldFrame.status?.paused ?? null;
          }
          if (mt === 0) snapshots.set((counts.get(0) ?? 0), { bytes: bytes.byteLength, firstByte: bytes[1] });
          if (mt === 0 || mt === 1) {
            try {
              const frame = decodeServerFrame(bytes);
              if (frame.kind === 'delta') {
                lastDeltaTick = frame.msg.tick;
                decodedDeltaAgents += frame.msg.agents.length;
                for (const a of frame.msg.agents) {
                  if (!(a.id >= 0 && a.x >= 0 && a.y >= 0 && a.species >= 0)) {
                    decodeErrors++;
                    break;
                  }
                }
              } else {
                decodedSnapAgents = frame.msg.agents.length;
                if (frame.msg.aliveCount !== frame.msg.agents.length) decodeErrors++;
              }
            } catch (e) {
              decodeErrors++;
              if (decodeErrors === 1) console.log('[test] decode error', e);
            }
          }
          if (mt === 5) {
            acks++;
            const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
            console.log('[test] ack', view.getUint32(1, true));
          }
          if (mt === 4) {
            events++;
            if (events === 1) console.log('[test] first EVENT', data.subarray(1).toString().slice(0, 160));
          }
        });

        // interventions: wait a moment for the world to start ticking
        setTimeout(() => {
          ws.send(JSON.stringify({ op: 'intervene', worldId, intervention: { type: 'setTimeScale', timeScale: 4 } }));
          ws.send(JSON.stringify({ op: 'intervene', worldId, intervention: { type: 'seedFood', x: 512, y: 512, amount: 200, radius: 64 } }));
          ws.send(JSON.stringify({ op: 'intervene', worldId, intervention: { type: 'pauseRegion', x: 1000, y: 1000, radius: 64, ticks: 30 } }));
          // massive meteor to trigger an extinction event (kills >50% in one tick)
          ws.send(JSON.stringify({ op: 'intervene', worldId, intervention: { type: 'meteor', x: 0, y: 0, radius: 2200 } }));
          console.log('[test] sent 4 interventions');
        }, 1500);

        // control flow: pause must freeze ticks, step must advance exactly one, play must resume
        setTimeout(() => {
          void (async () => {
            try {
              await sleep(1000);
              ws.send(JSON.stringify({ op: 'pause', worldId }));
              await waitUntil(() => pausedFromServer === true, 3000);
              const b1 = lastDeltaTick;
              ws.send(JSON.stringify({ op: 'step', worldId }));
              await waitUntil(() => lastDeltaTick > b1, 3000);
              stepDeltas.push(lastDeltaTick - b1);
              const b2 = lastDeltaTick;
              ws.send(JSON.stringify({ op: 'step', worldId }));
              await waitUntil(() => lastDeltaTick > b2, 3000);
              stepDeltas.push(lastDeltaTick - b2);
              ws.send(JSON.stringify({ op: 'play', worldId }));
              await waitUntil(() => pausedFromServer === false, 3000);
              const b3 = lastDeltaTick;
              await waitUntil(() => lastDeltaTick >= b3 + 2, 3000);
              playConfirmed = true;
              console.log('[test] control flow: paused -> steps', stepDeltas, '-> resumed');
            } catch (e) {
              failures.push(`control: ${String(e)}`);
            }
          })();
        }, 4000);
      })
      .catch((err) => {
        failures.push(String(err));
        console.error('[test] fatal', err);
        child.kill();
        reject(err);
      });
  });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => clearTimeout as never);
