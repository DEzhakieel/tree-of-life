import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { DEFAULT_PARAMS, type WorldConfig } from '@fractal-life/shared';
import { createEngine, replayEngine } from '../apps/server/src/engine/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const groundingJson = readFileSync(join(here, '..', 'apps', 'simulation', 'data', 'enrichment.json'), 'utf-8');

const TARGET = 120;
const SPAWN = 8;

function makeWorld(seed: string): WorldConfig {
  return {
    id: `replay-grounding-${seed}`,
    seed,
    fractalType: 'mandelbrot',
    params: { ...DEFAULT_PARAMS, spawnCount: SPAWN },
    createdAt: 0,
    currentTick: 0,
  };
}

function bytesOf(a: Uint8Array): string {
  return String.fromCharCode(...a);
}

async function verify(seed: string): Promise<void> {
  const config = makeWorld(seed);
  const head = await createEngine(config, groundingJson);
  for (let t = 0; t < TARGET; t++) head.tick();
  const headFrame = bytesOf(head.encodeSnapshotMessage());

  const log = head.getInterventionLog();
  const repGrounded = await replayEngine(config, log, TARGET, groundingJson);
  const repGroundedFrame = bytesOf(repGrounded.encodeSnapshotMessage());

  const repPlain = await replayEngine(config, log, TARGET);
  const repPlainFrame = bytesOf(repPlain.encodeSnapshotMessage());

  const headN = head.agentSummaries().length;
  const gN = repGrounded.agentSummaries().length;
  const pN = repPlain.agentSummaries().length;

  const matchGrounded = headFrame === repGroundedFrame;
  const matchPlain = headFrame === repPlainFrame;

  // per-agent diff on alive counts is the coarse signal; bytes are the exact one
  console.log(`seed=${seed}: head=${headN} groundedReplay=${gN} plainReplay=${pN}`);
  console.log(`  head == grounded replay : ${matchGrounded}  (bytes exactly ${headFrame.length})`);
  console.log(`  head == plain    replay : ${matchPlain}`);

  if (!matchGrounded) {
    console.log('  [flag] grounded replay failed to reproduce headworld');
    process.exitCode = 1;
  }
  if (matchGrounded === matchPlain) {
    // both match or both diverge: grounding had no observable effect for this seed
    console.log('  note: ungrounded replay identical to grounded -> grounding inert for this seed');
  }
}

await verify('replay-grounding-a');
await verify('replay-grounding-b');