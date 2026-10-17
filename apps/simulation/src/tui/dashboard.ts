import { summarizeStats, type Metric } from '@fractal-life/shared';
import type { ConsoleSession } from './session.js';

const useColor = process.env.NO_COLOR === undefined && process.env.TERM !== 'dumb';

const c = (code: string) => (s: string) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s);
const bold = c('1');
const dim = c('2');
const cyan = c('36');
const green = c('32');
const yellow = c('33');
const magenta = c('35');

/** A compact two-column metric dashboard for the console. */
export function renderDashboard(session: ConsoleSession, log: string[], width: number): string {
  const s = session.stats();
  const rows = summarizeStats(s);
  const cols = Math.max(1, Math.min(3, Math.floor(width / 24)));
  const perCol = Math.ceil(rows.length / cols);

  const cell = (m: Metric): string => {
    const label = dim(m.label.padEnd(16));
    const value = m.label === 'tick' ? bold(m.value) : m.value;
    return `${label}${value}`;
  };

  const lines: string[] = [];
  const header =
    `${magenta(bold('TREE OF LIFE'))} ${dim('· console')}   ` +
    `${cyan('seed')}=${session.seed}`;
  const state = session.paused ? yellow('PAUSED') : green('RUNNING');
  const status = `  ${state} ${dim('|')} tickRate=${session.turbo ? magenta('turbo') : session.tickRate}`;
  lines.push(header);
  lines.push(status);
  lines.push(dim('─'.repeat(Math.max(20, Math.min(width, 100)))));

  for (let r = 0; r < perCol; r++) {
    const parts: string[] = [];
    for (let col = 0; col < cols; col++) {
      const idx = col * perCol + r;
      const m = rows[idx];
      if (m) parts.push(cell(m).padEnd(26));
    }
    if (parts.length) lines.push('  ' + parts.join(''));
  }

  if (log.length) {
    lines.push(dim('─'.repeat(Math.max(20, Math.min(width, 100)))));
    for (const l of log.slice(-8)) lines.push(dim('| ') + l);
  }
  return lines.join('\n');
}

export function banner(): string {
  return [
    magenta(bold('  Tree of Life · console dashboard')),
    dim('  by Daven Ezhakieel · MIT · shared command layer'),
    '',
    `  ${cyan('help')}  list commands        ${cyan('stats')}  live observables`,
    `  ${cyan('play')}  run                   ${cyan('pause')}  hold`,
    `  ${cyan('step')} n advance              ${cyan('spawn')} n  add agents`,
    `  ${cyan('speed')} n tps               ${cyan('turbo')} [on|off]`,
    `  ${cyan('set')} key val  tune param    ${cyan('quit')}  exit`,
    '',
  ].join('\n');
}
