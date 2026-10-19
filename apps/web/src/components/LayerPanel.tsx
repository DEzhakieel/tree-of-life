import { useStore, type GroundLayer, type Representation } from '../store/useStore.js';
import { Panel } from './Panel.js';

const GROUND_LAYERS: { id: GroundLayer; label: string; hint: string }[] = [
  { id: 'set', label: 'Evolved set', hint: 'lineage persistence in parameter space' },
  { id: 'escape', label: 'Escape scars', hint: 'where lineages diverged and escaped' },
  { id: 'density', label: 'Density', hint: 'population clustering' },
  { id: 'energy', label: 'Energy field', hint: 'where energy is stored' },
  { id: 'culture', label: 'Culture map', hint: 'which memes dominate where' },
  { id: 'gene', label: 'Gene map', hint: 'which species genomes dominate where' },
];

const REPRESENTATIONS: { id: Representation; label: string; hint: string }[] = [
  { id: 'particle', label: 'Particle', hint: 'Lenia-style glow field, agents fuse into masses' },
  { id: 'fractal', label: 'Fractal', hint: 'evolved-set terrain, agents as crisp markers' },
  { id: 'graph', label: 'Network', hint: 'agents as nodes, lineage and proximity as edges' },
  { id: 'lattice', label: 'Lattice', hint: 'pixel grid, cell brightness = density' },
];

function Switch({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`h-3.5 w-6 rounded-full p-0.5 transition-colors ${on ? 'bg-emerald-500/70' : 'bg-white/15'}`}
      title={on ? 'on' : 'off'}
    >
      <span
        className={`block h-2.5 w-2.5 rounded-full bg-white transition-transform ${on ? 'translate-x-2.5' : ''}`}
      />
    </button>
  );
}

function Row({ label, on, action }: { label: string; on: boolean; action: () => void }) {
  return (
    <div className="flex items-center justify-between rounded-md px-1.5 py-1 hover:bg-white/5">
      <button onClick={action} className="flex-1 text-left text-zinc-300">
        {label}
      </button>
      <Switch on={on} onClick={action} />
    </div>
  );
}

export function LayerPanel({ id }: { id?: string }) {
  const representation = useStore((s) => s.representation);
  const groundLayer = useStore((s) => s.groundLayer);
  const showTerrain = useStore((s) => s.showTerrain);
  const showAgents = useStore((s) => s.showAgents);
  const showMinimap = useStore((s) => s.showMinimap);
  const showSpecies = useStore((s) => s.showSpecies);
  const showCulture = useStore((s) => s.showCulture);

  return (
    <Panel id={id} title="Display">
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-zinc-500">Representation</div>
      <div className="mb-2 flex flex-col gap-0.5">
        {REPRESENTATIONS.map((r) => (
          <button
            key={r.id}
            onClick={() => useStore.getState().setRepresentation(r.id)}
            title={r.hint}
            className={`rounded-md px-1.5 py-1 text-left text-xs ${
              representation === r.id ? 'bg-indigo-500/40 text-white' : 'text-zinc-400 hover:bg-white/10'
            }`}
          >
            {r.label}
          </button>
        ))}
      </div>
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-zinc-500">Ground layer</div>
      <div className="mb-2 flex flex-col gap-0.5">
        {GROUND_LAYERS.map((l) => (
          <button
            key={l.id}
            onClick={() => useStore.getState().setGroundLayer(l.id)}
            title={l.hint}
            className={`rounded-md px-1.5 py-1 text-left text-xs ${
              groundLayer === l.id ? 'bg-indigo-500/40 text-white' : 'text-zinc-400 hover:bg-white/10'
            }`}
          >
            {l.label}
          </button>
        ))}
      </div>
      <div className="mb-1 border-t border-white/10 pt-1.5 text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
        Overlays
      </div>
      <div className="flex flex-col gap-0.5">
        <Row label="Ground" on={showTerrain} action={() => useStore.getState().setShowTerrain(!showTerrain)} />
        <Row label="Agents" on={showAgents} action={() => useStore.getState().setShowAgents(!showAgents)} />
        <Row label="Culture colors" on={showCulture} action={() => useStore.getState().setShowCulture(!showCulture)} />
        <Row label="Minimap" on={showMinimap} action={() => useStore.getState().setShowMinimap(!showMinimap)} />
        <Row label="Species list" on={showSpecies} action={() => useStore.getState().setShowSpecies(!showSpecies)} />
      </div>
    </Panel>
  );
}
