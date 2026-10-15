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
 * Usage (from any workspace):
 *   npm test
 *   npm test -- --test-name-pattern=parity     # extra args forward to --test
 *   node scripts/run-tests.mjs --dir apps/web  # or point at a package directly
 *
 * Invoked with plain `node`, not `tsx`: this script spawns the resolved tsx CLI
 * itself, so nothing needs to be on PATH to start it.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const argv = process.argv.slice(2);

/** `--dir <path>` overrides the package root; defaults to cwd, which is what
 *  `npm run test` sets to the workspace being tested. */
function parseDir(args) {
  const i = args.indexOf('--dir');
  if (i === -1) return { dir: process.cwd(), rest: args };
  const value = args[i + 1];
  if (value === undefined) die('--dir requires a path');
  return { dir: resolve(repoRoot, value), rest: [...args.slice(0, i), ...args.slice(i + 2)] };
}

function die(msg) {
  console.error(`[run-tests] ${msg}`);
  process.exit(1);
}

const { dir: pkgRoot, rest: passthrough } = parseDir(argv);

const TEST_EXTENSIONS = ['.test.ts', '.test.tsx', '.spec.ts', '.spec.tsx'];

/** Recursively collect test files under `<pkgRoot>/test`. */
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

const files = collect(testDir).sort();
if (files.length === 0) die(`no test files under ${relative(repoRoot, testDir) || testDir} - refusing to report success`);

// tsx is a root devDependency and is hoisted there; resolve it rather than
// hardcoding a path so this keeps working if a package gains its own copy.
let tsxCli;
try {
  tsxCli = createRequire(import.meta.url).resolve('tsx/cli');
} catch {
  die('cannot resolve `tsx` - run `npm install` at the workspace root');
}

const rel = files.map((f) => relative(pkgRoot, f).split(sep).join('/'));
console.log(`[run-tests] ${rel.length} test file(s) in ${relative(repoRoot, pkgRoot) || '.'}`);

// Forwarded args must precede the file paths, otherwise the runner treats them
// as paths to test.
const res = spawnSync(process.execPath, [tsxCli, '--test', ...passthrough, ...rel], {
  cwd: pkgRoot,
  stdio: 'inherit',
});

if (res.error) die(`failed to start the test runner: ${res.error.message}`);
process.exit(res.status ?? 1);