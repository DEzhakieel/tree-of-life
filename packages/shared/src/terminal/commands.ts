import type { SimStats } from '../types.js';
import { CommandRegistry } from './registry.js';
import type { Metric, TerminalContext, TerminalMeta } from './types.js';

const num = (v: number, digits = 3): string =>
  Number.isFinite(v) ? v.toFixed(digits) : String(v);

/** Canonical metric rows shared by the web panel and the console dashboard. */
export function summarizeStats(s: SimStats): Metric[] {
  return [
    { label: 'tick', value: String(s.tick) },
    { label: 'population', value: String(s.population) },
    { label: 'alive', value: String(s.aliveCount) },
    { label: 'species', value: String(s.speciesCount) },
    { label: 'births', value: String(s.births) },
    { label: 'deaths', value: String(s.deaths) },
    { label: 'tickRate', value: num(s.tickRate, 1) },
    { label: 'avgEnergy', value: num(s.avgEnergy) },
    { label: 'avgWater', value: num(s.avgWater) },
    { label: 'entropy', value: num(s.entropy) },
    { label: 'diversity', value: num(s.diversity) },
    { label: 'complexity', value: num(s.complexity) },
    { label: 'cooperation', value: num(s.cooperation) },
    { label: 'culture', value: String(s.cultureCount) },
    { label: 'meanFitness', value: num(s.meanFitness) },
    { label: 'meanPlasticity', value: num(s.meanPlasticity) },
    { label: 'energyInequality', value: num(s.energyInequality) },
    { label: 'stateHash', value: String(s.stateHash) },
  ];
}

const truthy = (v: string | undefined): boolean =>
  v === '' || /^(1|on|true|yes|y)$/i.test(v ?? '');

export function createDefaultRegistry(meta: TerminalMeta): CommandRegistry {
  const r = new CommandRegistry();

  r.register({
    name: 'help',
    aliases: ['?', 'h'],
    summary: 'list commands, or describe one: help <command>',
    usage: 'help [command]',
    run(ctx, args) {
      const target = args[0];
      if (target) {
        const cmd = r.get(target);
        if (!cmd) {
          ctx.error(`unknown command: ${target}`);
          return;
        }
        ctx.print(`${cmd.name}${cmd.aliases?.length ? ` (${cmd.aliases.join(', ')})` : ''} - ${cmd.summary}`);
        if (cmd.usage) ctx.print(`usage: ${cmd.usage}`);
        return;
      }
      ctx.print(`${meta.name} terminal - ${r.list().filter((c) => !c.hidden).length} commands`);
      const width = Math.max(...r.list().map((c) => c.name.length));
      for (const cmd of r.list()) {
        if (cmd.hidden) continue;
        ctx.print(`  ${cmd.name.padEnd(width + 2)}${cmd.summary}`);
      }
      ctx.print('type "help <command>" for usage');
    },
  });

  r.register({
    name: 'status',
    aliases: ['info', 'whoami', 'session'],
    summary: 'show session/world status',
    run(ctx) {
      const d = ctx.host.describe();
      const width = Math.max(0, ...Object.keys(d).map((k) => k.length));
      for (const [k, v] of Object.entries(d)) ctx.print(`${k.padEnd(width + 1)} ${v ?? '-'}`);
    },
  });

  r.register({
    name: 'stats',
    aliases: ['observables'],
    summary: 'print live observables (optionally one key: stats <key>)',
    usage: 'stats [key]',
    run(ctx, args) {
      const s = ctx.host.stats();
      if (!s) {
        ctx.error('no world running');
        return;
      }
      const key = args[0];
      if (key) {
        const val = (s as unknown as Record<string, unknown>)[key];
        if (val === undefined) {
          ctx.error(`unknown stats field: ${key}`);
          return;
        }
        ctx.print(`${key} = ${typeof val === 'number' ? num(val, 6) : String(val)}`);
        return;
      }
      for (const m of summarizeStats(s)) ctx.print(`${m.label.padEnd(18)}${m.value}`);
    },
  });

  r.register({
    name: 'params',
    aliases: ['world'],
    summary: 'print the current world parameters',
    run(ctx) {
      const p = ctx.host.params();
      if (!p) {
        ctx.error('no world running');
        return;
      }
      const width = Math.max(0, ...Object.keys(p).map((k) => k.length));
      for (const [k, v] of Object.entries(p)) ctx.print(`${k.padEnd(width + 1)} ${v}`);
    },
  });

  r.register({
    name: 'set',
    aliases: ['param'],
    summary: 'change a world parameter: set <key> <number>',
    usage: 'set <key> <value>',
    run(ctx, args) {
      const [key, raw] = args;
      if (!key || raw === undefined) {
        ctx.error('usage: set <key> <value>');
        return;
      }
      const value = Number(raw);
      if (!Number.isFinite(value)) {
        ctx.error(`not a number: ${raw}`);
        return;
      }
      ctx.print(ctx.host.setParam(key, value) ? `${key} = ${value}` : `unknown param: ${key}`);
    },
  });

  r.register({
    name: 'play',
    aliases: ['resume', 'run'],
    summary: 'resume the simulation',
    run(ctx) {
      ctx.host.control('play');
      ctx.print('running');
    },
  });

  r.register({
    name: 'pause',
    summary: 'pause the simulation',
    run(ctx) {
      ctx.host.control('pause');
      ctx.print('paused');
    },
  });

  r.register({
    name: 'step',
    summary: 'advance N ticks (default 1)',
    usage: 'step [n]',
    run(ctx, args) {
      const n = args[0] === undefined ? 1 : Math.max(1, Math.floor(Number(args[0])));
      if (!Number.isFinite(n)) {
        ctx.error('usage: step [n]');
        return;
      }
      ctx.host.step(n);
      ctx.print(`stepped ${n} tick${n === 1 ? '' : 's'}`);
    },
  });

  r.register({
    name: 'spawn',
    summary: 'spawn N agents (default 1)',
    usage: 'spawn [n]',
    run(ctx, args) {
      const n = args[0] === undefined ? 1 : Math.max(1, Math.floor(Number(args[0])));
      if (!Number.isFinite(n)) {
        ctx.error('usage: spawn [n]');
        return;
      }
      ctx.host.spawn(n);
      ctx.print(`spawned ${n} agent${n === 1 ? '' : 's'}`);
    },
  });

  r.register({
    name: 'reset',
    aliases: ['restart', 'new'],
    summary: 'restart the world (optionally with a nested patch is ignored)',
    run(ctx) {
      ctx.host.reset();
      ctx.print('world reset');
    },
  });

  r.register({
    name: 'speed',
    aliases: ['tps', 'rate'],
    summary: 'set target ticks/second',
    usage: 'speed <tps>',
    run(ctx, args) {
      const tps = Number(args[0]);
      if (!Number.isFinite(tps) || tps <= 0) {
        ctx.error('usage: speed <tps>');
        return;
      }
      ctx.host.setTickRate(tps);
      ctx.print(`target tick rate = ${tps}`);
    },
  });

  r.register({
    name: 'turbo',
    summary: 'run unpaced at CPU speed: turbo on|off',
    usage: 'turbo [on|off]',
    run(ctx, args) {
      const on = truthy(args[0]);
      ctx.host.setTurbo(on);
      ctx.print(`turbo ${on ? 'on' : 'off'}`);
    },
  });

  r.register({
    name: 'export',
    aliases: ['dump'],
    summary: 'print a JSON snapshot of the session state',
    run(ctx) {
      ctx.print(JSON.stringify(ctx.host.exportState(), null, 2));
    },
  });

  r.register({
    name: 'caps',
    aliases: ['capabilities'],
    summary: 'list host platform and available control verbs',
    run(ctx) {
      ctx.print(`platform  ${ctx.host.platform}`);
      ctx.print('verbs     play pause step reset spawn set speed turbo export');
      if (ctx.host.drain) ctx.print('extra     drain()');
    },
  });

  r.register({
    name: 'version',
    aliases: ['ver'],
    summary: 'print the project version',
    run(ctx) {
      ctx.print(`${meta.name} ${meta.version}`);
    },
  });

  r.register({
    name: 'about',
    summary: 'about this project',
    run(ctx) {
      ctx.print(meta.name);
      if (meta.description) ctx.print(meta.description);
      ctx.print(`by ${meta.author} - ${meta.license}`);
      ctx.print(meta.repo);
    },
  });

  r.register({
    name: 'license',
    summary: 'print the license summary',
    run(ctx) {
      ctx.print(`${meta.license} - Copyright (c) 2026 ${meta.author}`);
      ctx.print('See LICENSE in the repository for the full text.');
    },
  });

  r.register({
    name: 'cite',
    summary: 'print the citation entry',
    run(ctx) {
      ctx.print(`Ezhakieel, Daven (2026). ${meta.name} (v${meta.version}). ${meta.repo}`);
    },
  });

  r.register({
    name: 'docs',
    summary: 'print documentation links',
    run(ctx) {
      ctx.print(`manual  apps/simulation/research/manual/`);
      ctx.print(`site    ${meta.docs}`);
    },
  });

  r.register({
    name: 'platform',
    summary: 'print the host platform',
    run(ctx) {
      ctx.print(ctx.host.platform);
    },
  });

  r.register({
    name: 'echo',
    summary: 'echo the arguments',
    usage: 'echo <text...>',
    run(ctx, args) {
      ctx.print(args.join(' '));
    },
  });

  r.register({
    name: 'clear',
    aliases: ['cls'],
    summary: 'clear the terminal output',
    run(ctx) {
      ctx.print('\u0000clear');
    },
  });

  return r;
}
