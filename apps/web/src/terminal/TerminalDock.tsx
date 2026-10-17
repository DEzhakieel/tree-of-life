import { useEffect, useRef, useState } from 'react';
import {
  createDefaultRegistry,
  executeLine,
  type TerminalContext,
  type TerminalMeta,
} from '@fractal-life/shared';
import { createWebHost } from './host.js';

const META: TerminalMeta = {
  name: 'Tree of Life',
  version: '1.0.0',
  author: 'Daven Ezhakieel',
  license: 'MIT',
  repo: 'https://github.com/DEzhakieel/tree-of-life',
  docs: 'https://dezhakieel.github.io/tree-of-life/',
  description: 'Emergent artificial-life simulation on procedural fractal terrain.',
};

interface Line {
  kind: 'in' | 'out' | 'err';
  text: string;
}

const CLEAR = '\u0000clear';

/**
 * In-browser terminal sharing its command layer with the console TUI. Every
 * command is defined once in `@fractal-life/shared/terminal`.
 */
export function TerminalDock() {
  const [open, setOpen] = useState(false);
  const [lines, setLines] = useState<Line[]>([
    { kind: 'out', text: 'Tree of Life terminal - type "help"' },
  ]);
  const [input, setInput] = useState('');
  const [history, setHistory] = useState<string[]>([]);
  const histIdx = useRef(-1);
  const scrollRef = useRef<HTMLDivElement>(null);

  const registryRef = useRef(createDefaultRegistry(META));
  const hostRef = useRef(createWebHost());

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [lines, open]);

  const ctx: TerminalContext = {
    host: hostRef.current,
    print: (...text) => {
      const next: Line[] = [];
      for (const t of text) {
        if (t === CLEAR) {
          setLines([]);
          return;
        }
        next.push({ kind: 'out', text: t });
      }
      setLines((prev) => [...prev, ...next]);
    },
    error: (text) => setLines((prev) => [...prev, { kind: 'err', text }]),
  };

  const submit = async (raw: string) => {
    const line = raw.trim();
    if (!line) return;
    setLines((prev) => [...prev, { kind: 'in', text: line }]);
    setHistory((prev) => [...prev, line].slice(-100));
    histIdx.current = -1;
    setInput('');
    await executeLine(registryRef.current, ctx, line);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      void submit(input);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (history.length === 0) return;
      histIdx.current = histIdx.current < 0 ? history.length - 1 : Math.max(0, histIdx.current - 1);
      setInput(history[histIdx.current] ?? '');
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (histIdx.current < 0) return;
      histIdx.current += 1;
      if (histIdx.current >= history.length) {
        histIdx.current = -1;
        setInput('');
      } else {
        setInput(history[histIdx.current] ?? '');
      }
    }
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        title="open command terminal"
        className="pointer-events-auto fixed bottom-3 right-3 z-30 rounded-lg border border-white/10 bg-black/70 px-3 py-2 font-mono text-xs text-zinc-200 backdrop-blur hover:bg-white/10"
      >
        &gt; terminal
      </button>
    );
  }

  return (
    <div className="pointer-events-auto fixed bottom-3 right-3 z-30 flex h-72 w-[30rem] max-w-[calc(100vw-1.5rem)] flex-col rounded-xl border border-white/10 bg-black/80 font-mono text-xs text-zinc-200 backdrop-blur">
      <div className="flex items-center justify-between border-b border-white/10 px-3 py-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
          Tree of Life · terminal
        </span>
        <button onClick={() => setOpen(false)} className="rounded px-2 text-zinc-400 hover:bg-white/10 hover:text-zinc-100">
          close
        </button>
      </div>
      <div ref={scrollRef} className="flex-1 space-y-0.5 overflow-y-auto px-3 py-2">
        {lines.map((l, i) => (
          <div
            key={i}
            className={
              l.kind === 'err' ? 'text-red-400' : l.kind === 'in' ? 'text-indigo-300' : 'text-zinc-300'
            }
            style={{ whiteSpace: 'pre-wrap' }}
          >
            {l.kind === 'in' ? `> ${l.text}` : l.text}
          </div>
        ))}
      </div>
      <div className="flex items-center gap-2 border-t border-white/10 px-3 py-2">
        <span className="text-indigo-400">&gt;</span>
        <input
          autoFocus
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          spellCheck={false}
          className="flex-1 bg-transparent outline-none placeholder:text-zinc-600"
          placeholder='help · stats · pause · spawn 5 · set timeScale 0.5'
        />
      </div>
    </div>
  );
}
