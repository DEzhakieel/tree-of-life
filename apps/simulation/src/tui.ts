import readline from 'node:readline';
import {
  createDefaultRegistry,
  executeLine,
  SUBSTRATES,
  type SubstrateConfig,
  type SubstrateKind,
  type TerminalContext,
  type TerminalMeta,
} from '@fractal-life/shared';
import { ConsoleSession } from './tui/session.js';
import { banner, renderDashboard } from './tui/dashboard.js';

const META: TerminalMeta = {
  name: 'Tree of Life',
  version: '1.0.0',
  author: 'Daven Ezhakieel',
  license: 'MIT',
  repo: 'https://github.com/DEzhakieel/tree-of-life',
  docs: 'https://dezhakieel.github.io/tree-of-life/',
  description: 'Emergent artificial-life simulation on procedural fractal terrain.',
};

interface Args {
  seed: string;
  tps: number;
  steps: number | null;
  json: boolean;
  watch: boolean;
  substrate: SubstrateConfig | undefined;
}

function parseArgs(argv: string[]): Args {
  const get = (name: string): string | undefined => {
    const eq = argv.find((a) => a.startsWith(`--${name}=`));
    if (eq) return eq.slice(name.length + 3);
    const i = argv.indexOf(`--${name}`);
    if (i >= 0 && argv[i + 1] && !argv[i + 1]!.startsWith('--')) return argv[i + 1];
    return undefined;
  };
  const substrateArg = get('substrate');
  let substrate: SubstrateConfig | undefined;
  if (substrateArg !== undefined && substrateArg !== 'agents') {
    if (!(SUBSTRATES as readonly string[]).includes(substrateArg)) {
      throw new Error(`unknown substrate "${substrateArg}" (expected one of: ${SUBSTRATES.join(', ')})`);
    }
    substrate = { kind: substrateArg as SubstrateKind };
  }
  return {
    seed: get('seed') ?? `tol-${Math.random().toString(36).slice(2, 8)}`,
    tps: Number(get('tps') ?? 30),
    steps: get('steps') !== undefined ? Number(get('steps')) : null,
    json: argv.includes('--json'),
    watch: !argv.includes('--no-watch'),
    substrate,
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const session = new ConsoleSession(args.seed, args.tps, args.substrate);
  const width = () => process.stdout.columns ?? 100;
  const registry = createDefaultRegistry(META);

  let shouldQuit = false;
  registry.register({
    name: 'quit',
    aliases: ['exit', 'q'],
    summary: 'exit the console',
    run() {
      shouldQuit = true;
    },
  });

  const log: string[] = [];
  const pushLog = (...text: string[]) => {
    for (const t of text) {
      if (t === '\u0000clear') {
        log.length = 0;
        continue;
      }
      log.push(t);
    }
  };
  const ctx: TerminalContext = {
    host: session,
    print: (...t) => pushLog(...t),
    error: (t) => pushLog(`! ${t}`),
  };

  // ---- batch: simulate N steps then print a one-shot dashboard ------------
  if (args.steps !== null) {
    for (let i = 0; i < args.steps; i++) session.advance();
    if (args.json) {
      process.stdout.write(JSON.stringify(session.exportState(), null, 2) + '\n');
    } else {
      process.stdout.write(renderDashboard(session, [], width()) + '\n');
    }
    return;
  }

  // ---- piped stdin: run the commands as a script --------------------------
  if (!process.stdin.isTTY) {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
    const script = Buffer.concat(chunks).toString('utf8');
    for (const line of script.split(/\r?\n/)) {
      if (!line.trim()) continue;
      await executeLine(registry, ctx, line);
    }
    process.stdout.write(log.join('\n') + '\n');
    return;
  }

  // ---- interactive TTY dashboard ------------------------------------------
  session.paused = true;
  process.stdout.write(banner() + '\n');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: 'tol> ' });

  let busy = false;
  const tickMs = Math.max(8, Math.round(1000 / Math.min(Math.max(args.tps, 1), 60)));
  const ticker = setInterval(() => {
    if (busy || session.paused || shouldQuit) return;
    busy = true;
    try {
      session.advance();
    } finally {
      busy = false;
    }
  }, tickMs);

  let redrawing = false;
  const redraw = () => {
    if (shouldQuit || redrawing) return;
    redrawing = true;
    try {
      readline.cursorTo(process.stdout, 0, 0);
      readline.clearScreenDown(process.stdout);
      process.stdout.write(renderDashboard(session, log, width()) + '\n');
      rl.prompt(true);
    } finally {
      redrawing = false;
    }
  };
  const redrawTimer = args.watch ? setInterval(redraw, 250) : null;

  const shutdown = () => {
    shouldQuit = true;
    clearInterval(ticker);
    if (redrawTimer) clearInterval(redrawTimer);
    readline.cursorTo(process.stdout, 0, 0);
    readline.clearScreenDown(process.stdout);
    process.stdout.write(renderDashboard(session, log, width()) + '\n');
    rl.close();
    process.exit(0);
  };

  rl.on('line', (line) => {
    void (async () => {
      pushLog(`> ${line}`);
      await executeLine(registry, ctx, line);
      if (shouldQuit) {
        shutdown();
        return;
      }
      if (redrawTimer) redraw();
      else {
        process.stdout.write(log.slice(-6).join('\n') + '\n');
        rl.prompt();
      }
    })();
  });
  rl.on('SIGINT', shutdown);

  redraw();
}

void main();
