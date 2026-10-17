import type { Command, TerminalContext } from './types.js';

/** Split a command line into tokens, honouring single and double quotes. */
export function tokenize(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quote: '"' | "'" | null = null;
  let has = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (quote) {
      if (ch === quote) quote = null;
      else cur += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      has = true;
      continue;
    }
    if (ch === ' ' || ch === '\t') {
      if (cur.length > 0 || has) out.push(cur);
      cur = '';
      has = false;
      continue;
    }
    cur += ch;
  }
  if (cur.length > 0 || has) out.push(cur);
  return out;
}

/** Parse a line into a command name and args, or null when empty. */
export function parseCommandLine(line: string): { name: string; args: string[] } | null {
  const tokens = tokenize(line.trim());
  if (tokens.length === 0) return null;
  return { name: tokens[0]!.toLowerCase(), args: tokens.slice(1) };
}

/** A registry of terminal commands, keyed by name and alias. */
export class CommandRegistry {
  private readonly byName = new Map<string, Command>();

  register(cmd: Command): this {
    this.byName.set(cmd.name.toLowerCase(), cmd);
    for (const a of cmd.aliases ?? []) this.byName.set(a.toLowerCase(), cmd);
    return this;
  }

  get(name: string): Command | undefined {
    return this.byName.get(name.toLowerCase());
  }

  /** Unique commands, in registration order (aliases collapsed). */
  list(): Command[] {
    const seen = new Set<Command>();
    const out: Command[] = [];
    for (const cmd of this.byName.values()) {
      if (seen.has(cmd)) continue;
      seen.add(cmd);
      out.push(cmd);
    }
    return out;
  }

  has(name: string): boolean {
    return this.byName.has(name.toLowerCase());
  }
}

/**
 * Parse and dispatch one command line against a context. Shared by the web
 * panel and the console TUI so behaviour is identical on both platforms.
 */
export async function executeLine(
  registry: CommandRegistry,
  ctx: TerminalContext,
  line: string,
): Promise<void> {
  const parsed = parseCommandLine(line);
  if (!parsed) return;
  const cmd = registry.get(parsed.name);
  if (!cmd) {
    ctx.error(`unknown command: ${parsed.name} (try "help")`);
    return;
  }
  try {
    await cmd.run(ctx, parsed.args);
  } catch (err) {
    ctx.error(err instanceof Error ? err.message : String(err));
  }
}
