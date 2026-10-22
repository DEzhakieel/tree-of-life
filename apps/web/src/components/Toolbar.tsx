import { useStore } from '../store/useStore.js';
import { requestLineage, intervene } from '../net/session.js';

const TOOLS: { id: 'none' | 'meteor' | 'seedFood' | 'spawnAgent' | 'nuke' | 'pauseRegion'; label: string }[] = [
  { id: 'none', label: 'Pan' },
  { id: 'meteor', label: 'Meteor' },
  { id: 'seedFood', label: 'Seed food' },
  { id: 'spawnAgent', label: 'Spawn' },
  { id: 'pauseRegion', label: 'Freeze' },
  { id: 'nuke', label: 'Nuke' },
];

export function Toolbar() {
  const tool = useStore((s) => s.tool);
  const brushSize = useStore((s) => s.brushSize);
  const timeScale = useStore((s) => s.formParams.timeScale);
  const showLineage = useStore((s) => s.showLineage);
  const cameraZoom = useStore((s) => s.cameraZoom);

  return (
    <div
      className="pointer-events-none absolute inset-x-0 bottom-3 z-20 flex justify-center px-3"
      data-testid="toolbar"
    >
      <div className="pointer-events-auto flex max-w-[calc(100vw-1.5rem)] flex-wrap items-center justify-center gap-1 rounded-xl border border-white/10 bg-black/70 px-2 py-1.5 backdrop-blur">
        <span className="px-1 text-[10px] font-semibold uppercase tracking-widest text-zinc-500">Tools</span>
        {TOOLS.map((t) => (
          <button
            key={t.id}
            onClick={() => useStore.getState().setTool(t.id)}
            title={t.label}
            className={`rounded-md px-2 py-1 text-xs ${
              tool === t.id ? 'bg-indigo-500/40 text-white' : 'text-zinc-300 hover:bg-white/10'
            }`}
          >
            {t.label}
          </button>
        ))}
        <div className="mx-2 h-6 w-px bg-white/10" />
        <label className="flex items-center gap-2 text-xs text-zinc-400" title="brush radius in world units">
          <span className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">Brush</span>
          <input
            type="range"
            min={10}
            max={600}
            value={brushSize}
            onChange={(e) => useStore.getState().setBrushSize(Number(e.target.value))}
            className="w-24 accent-indigo-500"
          />
          <span className="w-8 font-mono text-zinc-200">{brushSize}</span>
        </label>
        <label className="flex items-center gap-2 text-xs text-zinc-400" title="simulation time scale">
          <span className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">Time</span>
          <input
            type="range"
            min={0.05}
            max={1}
            step={0.05}
            value={timeScale}
            onChange={(e) => {
              const v = Number(e.target.value);
              useStore.getState().setFormParam('timeScale', v);
              intervene({ type: 'setTimeScale', timeScale: v });
            }}
            className="w-16 accent-fuchsia-500"
          />
          <span className="w-9 font-mono text-zinc-200">{timeScale.toFixed(2)}</span>
        </label>
        <div className="mx-2 h-6 w-px bg-white/10" />
        <span className="font-mono text-[10px] text-zinc-500" title="camera zoom (mouse wheel)">
          zoom ×{cameraZoom.toFixed(2)}
        </span>
        <button
          onClick={() => {
            const st = useStore.getState();
            if (st.showLineage) {
              st.setShowLineage(false);
              return;
            }
            requestLineage();
            st.setShowLineage(true);
          }}
          className={`rounded-md px-2 py-1 text-xs ${
            showLineage ? 'bg-indigo-500/40 text-white' : 'text-zinc-300 hover:bg-white/10'
          }`}
          title="genealogy panel and lineage edges"
        >
          Genealogy
        </button>
      </div>
    </div>
  );
}
