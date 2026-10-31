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

function Switch({ on, onClick, disabled }: { on: boolean; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`h-3.5 w-6 rounded-full p-0.5 transition-colors ${
        disabled ? 'cursor-not-allowed bg-white/5 opacity-40' : on ? 'bg-emerald-500/70' : 'bg-white/15'
      }`}
      title={disabled ? 'unavailable in this renderer' : on ? 'on' : 'off'}
    >
      <span
        className={`block h-2.5 w-2.5 rounded-full bg-white transition-transform ${on ? 'translate-x-2.5' : ''}`}
      />
    </button>
  );
}

function Row({
  label,
  hint,
  on,
  action,
  disabled,
}: {
  label: string;
  hint?: string;
  on: boolean;
  action: () => void;
  disabled?: boolean;
}) {
  return (
    <div
      className={`flex items-center justify-between rounded-md px-1.5 py-1 ${
        disabled ? 'opacity-40' : 'hover:bg-white/5'
      }`}
      title={hint}
    >
      <button onClick={action} disabled={disabled} className="flex-1 text-left text-zinc-300 disabled:cursor-not-allowed">
        {label}
      </button>
      <Switch on={on} onClick={action} disabled={disabled} />
    </div>
  );
}

function Section({ children, first }: { children: string; first?: boolean }) {
  return (
    <div
      className={`mb-1 text-[10px] font-semibold uppercase tracking-widest text-zinc-500 ${
        first ? '' : 'mt-1 border-t border-white/10 pt-1.5'
      }`}
    >
      {children}
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
  const showLineage = useStore((s) => s.showLineage);
  const showCulture = useStore((s) => s.showCulture);
  const showBoundary = useStore((s) => s.showBoundary);

  const groundForced = representation === 'fractal';
  const groundDisabled = groundForced;

  return (
    <Panel id={id} title="Display">
      <Section first>Representation</Section>
      <div className="mb-2 flex flex-col gap-0.5">
        {REPRESENTATIONS.map((r) => (
          <button
            key={r.id}
            onClick={() => {
              const st = useStore.getState();
              st.setRepresentation(r.id);
              // fractal foregrounds the ground; enabling it keeps the Ground
              // toggle honest instead of silently ignored
              if (r.id === 'fractal') st.setShowTerrain(true);
            }}
            title={r.hint}
            className={`rounded-md px-1.5 py-1 text-left text-xs ${
              representation === r.id ? 'bg-indigo-500/40 text-white' : 'text-zinc-400 hover:bg-white/10'
            }`}
          >
            {r.label}
          </button>
        ))}
      </div>

      <Section>Ground layer</Section>
      <div className="mb-2 flex flex-col gap-0.5">
        {GROUND_LAYERS.map((l) => (
          <button
            key={l.id}
            onClick={() => useStore.getState().setGroundLayer(l.id)}
            title={l.hint}
            className={`rounded-md px-1.5 py-1 text-left text-xs ${
              groundLayer === l.id
                ? 'bg-indigo-500/40 text-white'
                : 'text-zinc-400 hover:bg-white/10'
            }`}
          >
            {l.label}
          </button>
        ))}
      </div>

      <Section>Canvas overlays</Section>
      <div className="flex flex-col gap-0.5">
        <Row
          label="Boundary"
          hint="draw how each world edge is identified for the selected topology"
          on={showBoundary}
          action={() => useStore.getState().setShowBoundary(!showBoundary)}
        />
        {showBoundary && (
          <div className="mb-1 px-1.5 font-mono text-[9px] leading-snug text-zinc-500">
            <span className="text-indigo-400">wrap</span> · <span className="text-amber-400">reflect</span> ·{' '}
            <span className="text-fuchsia-400">twist</span> · <span className="text-teal-300">flip-wrap</span> edge
            markings
          </div>
        )}
        <Row
          label="Ground"
          hint={groundForced ? 'the fractal representation always shows the ground' : 'terrain under the agents'}
          on={groundForced || showTerrain}
          action={() => useStore.getState().setShowTerrain(!showTerrain)}
          disabled={groundDisabled}
        />
        <Row
          label="Agents"
          hint="particle and fractal representations only"
          on={showAgents}
          action={() => useStore.getState().setShowAgents(!showAgents)}
        />
        <Row
          label="Culture colors"
          hint="colour by meme instead of species"
          on={showCulture}
          action={() => useStore.getState().setShowCulture(!showCulture)}
        />
        <Row
          label="Minimap"
          on={showMinimap}
          action={() => useStore.getState().setShowMinimap(!showMinimap)}
        />
      </div>

      <Section>Panels</Section>
      <div className="flex flex-col gap-0.5">
        <Row
          label="Species list"
          hint="population breakdown panel"
          on={showSpecies}
          action={() => useStore.getState().setShowSpecies(!showSpecies)}
        />
        <Row
          label="Genealogy"
          hint="genealogy panel; also draws lineage edges in the network view"
          on={showLineage}
          action={() => useStore.getState().setShowLineage(!showLineage)}
        />
      </div>
    </Panel>
  );
}
