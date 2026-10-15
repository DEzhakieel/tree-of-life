/**
 * Shared test runner for every workspace in this monorepo.
 *
 * Why this exists: each package's `test` script used to hardcode an explicit
 * list of test files. That silently drifts - apps/simulation listed 19 of its 28
 * files, so `determinism`, `causal`, `perturb`, `forecast` and 5 others were
 * never run by `npm test` and CI could not have caught a regression in them.
 * Enumerating the directory removes the failure mode: adding a test file is
 * enough, it cannot be forgotten.
 *
 * A plain glob is not an option here:
 *   - `tsx --test "test/*.test.ts"` fails with `Could not find 'test\*.test.ts'`
 *     because tsx forwards the pattern to node without expanding it.
 *   - `tsx --test test/` reports `# tests 0`, because node 18's directory
 *     discovery only matches .js/.mjs/.cjs, not .ts/.tsx.
 *
 * Fast / full split: a few integration files dominate the wall clock (on the
 * reference machine `causal.test.ts` alone is ~15 min while 20+ files are under
 * 10 s). `--fast` runs only the cheap tier and `--full` (the default) runs
 * everything, so a pre-commit loop does not wait on the long poles. The tier is
 * data, not a hardcoded list: `test/tiers.json` records each file's duration
 * and a threshold, and `--record` regenerates it. `--jobs N` additionally runs
 * the selected files in a bounded process pool (node 18 has no
 * `--test-concurrency`, and its runner is sequential), which is what makes the
 * fast tier finish in under a minute.
 *
 * Usage (from any workspace, or with `--dir`):
 *   npm test                        # full, sequential (unchanged default)
 *   npm test -- --fast              # cheap tier only
 *   npm test -- --fast --jobs 4     # cheap tier, 4 files in parallel
 *   npm test -- --slow              # only the recorded long poles
 *   npm test -- --record            # re-time every file and rewrite tiers.json
 *   npm test -- --list              # print the plan without running
 *   npm test -- --test-name-pattern=parity   # extra args forward to --test
 *   node scripts/run-tests.mjs --dir apps/web --fast
 *
 * Invoked with plain `node`, not `tsx`: this script spawns the resolved tsx CLI
 * itself, so nothing needs to be on PATH to start it.
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { cpus } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function die(msg) {
  console.error(`[run-tests] ${msg}`);
  process.exit(1);
}

/* ---------- arguments ---------- */

function parseArgs(args) {
  const out = { dir: process.cwd(), mode: 'full', record: false, list: false, jobs: null, threshold: null, passthrough: [] };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--dir') { const v = args[++i]; if (v === undefined) die('--dir requires a path'); out.dir = resolve(repoRoot, v); continue; }
    if (a === '--fast') { out.mode = 'fast'; continue; }
    if (a === '--full') { out.mode = 'full'; continue; }
    if (a === '--slow') { out.mode = 'slow'; continue; }
    if (a === '--record') { out.record = true; continue; }
    if (a === '--list') { out.list = true; continue; }
    if (a === '--jobs') { out.jobs = num(args[++i], '--jobs'); continue; }
    if (a.startsWith('--jobs=')) { out.jobs = num(a.slice('--jobs='.length), '--jobs'); continue; }
    if (a === '--threshold') { out.threshold = num(args[++i], '--threshold'); continue; }
    if (a.startsWith('--threshold=')) { out.threshold = num(a.slice('--threshold='.length), '--threshold'); continue; }
    out.passthrough.push(a);
  }
  return out;
}

function num(value, flag) {
  const n = Number(value);
  if (!Number.isFinite(n)) die(`${flag} requires a number`);
  return n;
}

const { dir: pkgRoot, mode, record, list, jobs, threshold, passthrough } = parseArgs(process.argv.slice(2));

/* ---------- test discovery ---------- */

const TEST_EXTENSIONS = ['.test.ts', '.test.tsx', '.spec.ts', '.spec.tsx'];

function collect(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collect(full));
    else if (TEST_EXTENSIONS.some((ext) => entry.name.endsWith(ext))) out.push(full);
  }
  return out;
}

const testDir = join(pkgRoot, 'test');
if (!existsSync(testDir)) die(`no test/ directory in ${relative(repoRoot, pkgRoot) || '.'}`);

const files = collect(testDir).sort().map((f) => relative(pkgRoot, f).split(sep).join('/'));
if (files.length === 0) die(`no test files under ${relative(repoRoot, testDir) || testDir} - refusing to report success`);

// tsx is a root devDependency and is hoisted there; resolve it rather than
// hardcoding a path so this keeps working if a package gains its own copy.
let tsxCli;
try {
  tsxCli = createRequire(import.meta.url).resolve('tsx/cli');
} catch {
  die('cannot resolve `tsx` - run `npm install` at the workspace root');
}

const manifestPath = join(pkgRoot, 'test', 'tiers.json');
const DEFAULT_THRESHOLD = 16;

function loadManifest() {
  try {
    return JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch {
    return null;
  }
}

const workspace = relative(repoRoot, pkgRoot) || '.';

/* ---------- --record: time every file, (re)write the tier manifest ---------- */

function doRecord() {
  const entries = [];
  console.log(`[run-tests] recording ${files.length} file(s) in ${workspace} (sequential, one process each)`);
  for (const rel of files) {
    const t0 = Date.now();
    const res = spawnSync(process.execPath, [tsxCli, '--test', ...passthrough, rel], { cwd: pkgRoot, stdio: 'ignore' });
    const seconds = Number(((Date.now() - t0) / 1000).toFixed(1));
    entries.push({ file: rel, seconds, exit: res.status ?? 1 });
    console.log(`[run-tests]   ${String(seconds).padStart(7)}s  ${res.status === 0 ? 'ok  ' : 'FAIL'}  ${rel}`);
  }
  const thr = threshold ?? loadManifest()?.thresholdSec ?? DEFAULT_THRESHOLD;
  const slow = entries.filter((e) => e.seconds >= thr).map((e) => e.file);
  writeFileSync(
    manifestPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        note: 'Per-file durations (sequential, tsx startup included). `--fast` runs files under `thresholdSec`; `--slow` runs the rest. Regenerate with `npm test -- --record`.',
        thresholdSec: thr,
        entries,
        slow,
      },
      null,
      2,
    ),
  );
  console.log(`[run-tests] wrote ${relative(repoRoot, manifestPath)}: ${slow.length} slow file(s) at >= ${thr}s`);
}

/* ---------- tier selection ---------- */

function selectFiles() {
  if (mode === 'full') return files;
  const manifest = loadManifest();
  if (!manifest || !Array.isArray(manifest.entries)) {
    if (mode === 'slow') {
      die(`no ${relative(repoRoot, manifestPath)} - cannot tell which files are slow; run with --record first`);
    }
    console.log(`[run-tests] no ${relative(repoRoot, manifestPath)} - running all ${files.length} file(s) (fast tier not configured)`);
    return files;
  }
  const thr = threshold ?? manifest.thresholdSec ?? DEFAULT_THRESHOLD;
  const slow = new Set(manifest.entries.filter((e) => e.seconds >= thr).map((e) => e.file));
  return mode === 'slow' ? files.filter((f) => slow.has(f)) : files.filter((f) => !slow.has(f));
}

/* ---------- execution ---------- */

/** Run the selected files in one tsx process (node's test runner runs files sequentially). */
function runTogether(selected, effectiveJobs) {
  const res = spawnSync(process.execPath, [tsxCli, '--test', ...passthrough, ...selected], {
    cwd: pkgRoot,
    stdio: 'inherit',
  });
  if (res.error) die(`failed to start the test runner: ${res.error.message}`);
  return res.status ?? 1;
}

/** Run one tsx process per file with a bounded pool. Resolves to the number of failures. */
function runPool(selected, concurrency) {
  return new Promise((resolvePool) => {
    let next = 0;
    let active = 0;
    let failed = 0;
    const start = () => {
      while (active < concurrency && next < selected.length) {
        const rel = selected[next++];
        active++;
        const t0 = Date.now();
        const child = spawn(process.execPath, [tsxCli, '--test', ...passthrough, rel], { cwd: pkgRoot });
        let out = '';
        child.stdout.on('data', (d) => { out += d; });
        child.stderr.on('data', (d) => { out += d; });
        child.on('close', (code) => {
          active--;
          const ok = code === 0;
          if (!ok) failed++;
          const secs = ((Date.now() - t0) / 1000).toFixed(1);
          console.log(`[run-tests] ${ok ? 'PASS' : 'FAIL'}  ${String(secs).padStart(6)}s  ${rel}`);
          if (!ok) console.log(out.trimEnd());
          if (next >= selected.length && active === 0) resolvePool(failed);
          else start();
        });
      }
    };
    start();
  });
}

/* ---------- main ---------- */

async function main() {
  if (record) {
    doRecord();
    return;
  }

  const selected = selectFiles();

  if (list) {
    const manifest = loadManifest();
    const thr = threshold ?? manifest?.thresholdSec ?? DEFAULT_THRESHOLD;
    console.log(`[run-tests] ${workspace}: mode=${mode} threshold=${thr}s ${selected.length}/${files.length} file(s) selected`);
    for (const f of selected) console.log(`  ${f}`);
    return;
  }

  if (selected.length === 0) {
    console.log(`[run-tests] ${workspace}: no files selected for mode=${mode} - nothing to run`);
    return;
  }

  const cpuCount = cpus().length;
  const effectiveJobs = jobs ?? (mode === 'fast' ? Math.max(1, Math.min(4, cpuCount - 1)) : 1);
  console.log(`[run-tests] ${workspace}: mode=${mode} files=${selected.length}/${files.length} jobs=${effectiveJobs}`);

  if (effectiveJobs > 1 && selected.length > 1) {
    const failed = await runPool(selected, effectiveJobs);
    if (failed > 0) {
      console.error(`[run-tests] ${failed} file(s) failed`);
      process.exit(1);
    }
    console.log(`[run-tests] all ${selected.length} file(s) passed`);
    return;
  }

  process.exit(runTogether(selected, effectiveJobs));
}

await main();
