import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  CommandRegistry,
  createDefaultRegistry,
  emptySimStats,
  executeLine,
  parseCommandLine,
  summarizeStats,
  tokenize,
  type TerminalContext,
  type TerminalHost,
  type TerminalMeta,
} from '@fractal-life/shared';

const META: TerminalMeta = {
  name: 'Tree of Life',
  version: '1.0.0',
  author: 'Daven Ezhakieel',
  license: 'MIT',
  repo: 'https://github.com/DEzhakieel/tree-of-life',
  docs: 'https://dezhakieel.github.io/tree-of-life/',
};

interface Mock extends TerminalHost {
  calls: string[];
  params_: Record<string, number>;
}

function mockHost(): Mock {
  const calls: string[] = [];
  const params_: Record<string, number> = { timeScale: 1, spawnCount: 300, maxPopulation: 4000 };
  const stats = emptySimStats(7, 1, { population: 42, aliveCount: 40 });
  return {
    platform: 'console',
    calls,
    params_,
    describe: () => ({ platform: 'console', tick: stats.tick }),
    stats: () => stats,
    params: () => ({ ...params_ }),
    setParam(k, v) {
      if (!(k in params_)) return false;
      params_[k] = v;
      return true;
    },
    control(cmd) {
      calls.push(`control:${cmd}`);
    },
    step(n = 1) {
      calls.push(`step:${n}`);
    },
    reset() {
      calls.push('reset');
    },
    spawn(n = 1) {
      calls.push(`spawn:${n}`);
    },
    setTickRate(t) {
      calls.push(`tps:${t}`);
    },
    setTurbo(on) {
      calls.push(`turbo:${on}`);
    },
    exportState: () => ({ ok: true }),
  };
}

function ctxFor(host: TerminalHost): { ctx: TerminalContext; out: string[]; errs: string[] } {
  const out: string[] = [];
  const errs: string[] = [];
  return {
    out,
    errs,
    ctx: { host, print: (...t) => out.push(...t), error: (t) => errs.push(t) },
  };
}

describe('terminal tokenizer', () => {
  it('splits on whitespace and honours quotes', () => {
    assert.deepEqual(tokenize('set  a   b '), ['set', 'a', 'b']);
    assert.deepEqual(tokenize('echo "hello world"'), ['echo', 'hello world']);
    assert.deepEqual(tokenize("echo 'a b' c"), ['echo', 'a b', 'c']);
  });

  it('parses the command name + args, lowercased', () => {
    assert.deepEqual(parseCommandLine('  PLAY 3 '), { name: 'play', args: ['3'] });
    assert.equal(parseCommandLine('   '), null);
  });
});

describe('CommandRegistry', () => {
  it('resolves names and aliases', () => {
    const r = new CommandRegistry().register({
      name: 'play',
      aliases: ['run'],
      summary: 'run',
      run: () => {},
    });
    assert.ok(r.get('PLAY'));
    assert.ok(r.get('run'));
    assert.equal(r.list().length, 1);
  });
});

describe('default command set', () => {
  it('drives the host through the shared context', async () => {
    const host = mockHost();
    const { ctx, out, errs } = ctxFor(host);
    const registry = createDefaultRegistry(META);

    await executeLine(registry, ctx, 'set timeScale 0.5');
    assert.equal(host.params_.timeScale, 0.5);
    assert.ok(out.some((l) => l.includes('timeScale = 0.5')));

    await executeLine(registry, ctx, 'spawn 5');
    assert.ok(host.calls.includes('spawn:5'));

    await executeLine(registry, ctx, 'pause');
    assert.ok(host.calls.includes('control:pause'));

    await executeLine(registry, ctx, 'speed 120');
    assert.ok(host.calls.includes('tps:120'));

    await executeLine(registry, ctx, 'set nope 1');
    assert.ok(out.some((l) => l.includes('unknown param: nope')));

    await executeLine(registry, ctx, 'help');
    assert.ok(out.some((l) => l.includes('commands')));

    await executeLine(registry, ctx, 'definitely-not-a-command');
    assert.ok(errs.some((l) => l.includes('unknown command')));

    await executeLine(registry, ctx, 'stats');
    assert.ok(out.some((l) => l.includes('population')));
  });
});

describe('summarizeStats', () => {
  it('reports the canonical metric rows', () => {
    const rows = summarizeStats(emptySimStats(7, 1, { population: 42, aliveCount: 40 }));
    assert.ok(rows.some((r) => r.label === 'tick' && r.value === '7'));
    assert.ok(rows.some((r) => r.label === 'population' && r.value === '42'));
  });
});
