/**
 * Run the API and dashboard together: `npm run dev`.
 *
 * The dashboard boots local worker worlds on its own, but its "Remote
 * (Server)" mode needs the REST/WS backend. With `dev:web` alone, Vite's proxy
 * answers POST /api/worlds with an empty 500 when nothing is listening on
 * :8080. Starting both from one command removes that failure mode.
 */
import { spawn, spawnSync } from 'node:child_process';

const npmCli = process.env.npm_execpath;
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const scripts = ['dev:server', 'dev:web'];
const children = [];
let stopping = false;

function stop(code) {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (child.exitCode !== null) continue;
    if (process.platform === 'win32') {
      // npm -> node -> tsx/vite: kill the tree, not just the wrapper.
      spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    } else {
      child.kill('SIGTERM');
    }
  }
  process.exitCode = code;
}

process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));

for (const script of scripts) {
  const child = npmCli
    ? spawn(process.execPath, [npmCli, 'run', script], { stdio: 'inherit' })
    : spawn(npm, ['run', script], { stdio: 'inherit', shell: process.platform === 'win32' });
  children.push(child);
  child.on('error', (err) => {
    console.error(`[dev] failed to start ${script}: ${err.message}`);
    stop(1);
  });
  child.on('exit', (code, signal) => {
    if (stopping) return;
    console.error(`[dev] ${script} stopped (${signal ?? `exit ${code}`}) — shutting down`);
    stop(code ?? 1);
  });
}
