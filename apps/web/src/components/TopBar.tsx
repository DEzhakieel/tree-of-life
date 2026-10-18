import { useStore } from '../store/useStore.js';
import { control, setTickRate, setTurbo, setRenderCadence } from '../net/session.js';
import { NewWorldModal } from './NewWorldModal.js';

export function TopBar() {
  const connected = useStore((s) => s.connected);
  const paused = useStore((s) => s.paused);
  const targetTickRate = useStore((s) => s.targetTickRate);
  const stats = useStore((s) => s.stats);
  const status = useStore((s) => s.status);
  const mode = useStore((s) => s.mode);
  const headless = useStore((s) => s.headless);

  return (
    <div className="absolute inset-x-0 top-0 z-20 flex items-center gap-3 border-b border-white/10 bg-black/60 px-4 py-2 backdrop-blur">
      <h1 className="mr-2 bg-gradient-to-r from-indigo-400 to-fuchsia-400 bg-clip-text text-sm font-black tracking-tight text-transparent">
        TREE OF LIFE
      </h1>

      <NewWorldModal />
      <span className="mx-1 h-5 w-px bg-white/10" />

      <div className="flex items-center gap-1">
        <button
          onClick={() => control(paused ? 'play' : 'pause')}
          disabled={!connected}
          className="rounded-md border border-white/10 px-2 py-1 text-xs text-zinc-200 hover:bg-white/10 disabled:opacity-40"
        >
          {paused ? '▶' : '⏸'}
        </button>
        <button
          onClick={() => control('step')}
          disabled={!connected}
          title="advance one tick"
          className="rounded-md border border-white/10 px-2 py-1 text-xs text-zinc-200 hover:bg-white/10 disabled:opacity-40"
        >
          ⏭
        </button>
      </div>
      <span className="mx-1 h-5 w-px bg-white/10" />

      <label className="ml-1 flex items-center gap-2 text-xs text-zinc-400">
        <span className="uppercase tracking-wider text-zinc-500">Speed</span>
        <input
          type="range"
          min={1}
          max={120}
          value={targetTickRate}
          onChange={(e) => {
            const v = Number(e.target.value);
            useStore.getState().setTargetTickRate(v);
            setTickRate(v);
          }}
          className="w-24 accent-indigo-500"
        />
        <span className="w-9 text-zinc-200">{targetTickRate} tps</span>
      </label>

      <button
        onClick={() => {
          const next = !headless;
          useStore.getState().setHeadless(next);
          // headless = unpaced sim + no render frames; both are separate from tps
          setTurbo(next);
          setRenderCadence(next ? 0 : 1, next ? 20 : 10);
        }}
        disabled={!connected}
        title="run the simulation unpaced with rendering disabled"
        className={`rounded-md border px-2 py-1 text-xs disabled:opacity-40 ${
          headless
            ? 'border-amber-400/60 bg-amber-400/20 text-amber-200'
            : 'border-white/10 text-zinc-300 hover:bg-white/10'
        }`}
      >
        {headless ? 'HEADLESS' : 'Headless'}
      </button>

      <div className="ml-auto flex items-center gap-3 text-xs text-zinc-400">
        <span className={`rounded-full px-2 py-0.5 ${connected ? 'bg-emerald-500/20 text-emerald-300' : 'bg-red-500/20 text-red-300'}`}>
          {connected ? mode.toUpperCase() : 'OFFLINE'}
        </span>
        {status && (
          <span className="font-mono">
            t={stats?.tick ?? 0} <span className="text-zinc-600">|</span> {status.fractalType}
            {status.seed ? ` · ${status.seed.slice(0, 10)}` : ''}
          </span>
        )}
        {stats && <span className="font-mono text-emerald-300">{stats.tickRate.toFixed(0)} tps</span>}
      </div>
    </div>
  );
}
