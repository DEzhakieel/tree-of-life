import { useStore } from '../store/useStore.js';
import { control, setTickRate, setTurbo, setRenderCadence } from '../net/session.js';
import { topologyEdges, effectiveTopology } from '../render/topology.js';
import { NewWorldModal } from './NewWorldModal.js';

export function TopBar() {
  const connected = useStore((s) => s.connected);
  const paused = useStore((s) => s.paused);
  const targetTickRate = useStore((s) => s.targetTickRate);
  const stats = useStore((s) => s.stats);
  const status = useStore((s) => s.status);
  const mode = useStore((s) => s.mode);
  const headless = useStore((s) => s.headless);
  const world = useStore((s) => s.world);

  const boundary = world ? topologyEdges(effectiveTopology(world)) : null;

  return (
    <div className="absolute inset-x-0 top-0 z-20 flex items-center gap-2 border-b border-white/10 bg-black/60 px-3 py-2 backdrop-blur">
      <h1 className="shrink-0 bg-gradient-to-r from-indigo-400 to-fuchsia-400 bg-clip-text text-sm font-black tracking-tight text-transparent">
        TREE OF LIFE
      </h1>

      <NewWorldModal />
      <span className="mx-1 hidden h-5 w-px shrink-0 bg-white/10 sm:block" />

      <div className="flex shrink-0 items-center gap-1">
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
      <span className="mx-1 hidden h-5 w-px shrink-0 bg-white/10 sm:block" />

      <label className="ml-1 flex shrink-0 items-center gap-2 text-xs text-zinc-400">
        <span className="hidden uppercase tracking-wider text-zinc-500 xl:inline">Speed</span>
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
          className="w-20 accent-indigo-500"
        />
        <span className="w-12 shrink-0 tabular-nums text-zinc-200">{targetTickRate} tps</span>
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
        className={`shrink-0 rounded-md border px-2 py-1 text-xs disabled:opacity-40 ${
          headless
            ? 'border-amber-400/60 bg-amber-400/20 text-amber-200'
            : 'border-white/10 text-zinc-300 hover:bg-white/10'
        }`}
      >
        {headless ? 'HEADLESS' : 'Headless'}
      </button>

      <div className="ml-auto flex min-w-0 items-center gap-2 text-xs text-zinc-400">
        {world && boundary && (
          <span className="hidden shrink-0 items-center gap-1 xl:flex" title={boundary.desc}>
            <span className="rounded border border-white/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-zinc-400">
              {world.substrate?.kind ?? 'agents'}
            </span>
            <span className="rounded border border-white/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-zinc-400">
              {boundary.label}
            </span>
          </span>
        )}
        <span
          className={`shrink-0 rounded-full px-2 py-0.5 ${connected ? 'bg-emerald-500/20 text-emerald-300' : 'bg-red-500/20 text-red-300'}`}
        >
          {connected ? mode.toUpperCase() : 'OFFLINE'}
        </span>
        {status && (
          <span className="hidden min-w-0 truncate font-mono tabular-nums lg:inline" data-testid="tick-status">
            t={stats?.tick ?? 0} <span className="text-zinc-600">|</span> {status.fractalType}
            {status.seed ? ` · ${status.seed.slice(0, 10)}` : ''}
          </span>
        )}
        {stats && (
          <span className="shrink-0 font-mono text-emerald-300">{stats.tickRate.toFixed(0)} tps</span>
        )}
      </div>
    </div>
  );
}
