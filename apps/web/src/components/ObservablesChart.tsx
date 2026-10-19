import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store/useStore.js';
import type { StatsPoint } from '../store/useStore.js';
import { Panel } from './Panel.js';

type SignalKey = keyof StatsPoint;

interface SignalDef {
  key: SignalKey;
  label: string;
  color: string;
  /** series are normalised to [0,1] when shown; a transform makes them readable. */
  scale?: (v: number) => number;
}

interface SignalGroup {
  id: string;
  name: string;
  signals: SignalDef[];
}

const SIGNAL_GROUPS: SignalGroup[] = [
  {
    id: 'ecology',
    name: 'Ecology',
    signals: [
      { key: 'entropy', label: 'entropy', color: '#34d399' },
      { key: 'diversity', label: 'diversity', color: '#60a5fa' },
      { key: 'complexity', label: 'complexity', color: '#fbbf24', scale: (v) => v / 5 },
      { key: 'predatorFraction', label: 'predators', color: '#f87171' },
    ],
  },
  {
    id: 'strategy',
    name: 'Strategy',
    signals: [
      { key: 'cooperation', label: 'cooperation', color: '#f472b6' },
      { key: 'meanAggression', label: 'aggression', color: '#fb7185' },
      { key: 'meanRisk', label: 'risk', color: '#f59e0b' },
      { key: 'meanDeception', label: 'deception', color: '#a78bfa' },
      { key: 'donationRatio', label: 'donation', color: '#f9a8d4', scale: (v) => v },
    ],
  },
  {
    id: 'selection',
    name: 'Selection',
    signals: [
      { key: 'selectionEntropy', label: 'sel. entropy', color: '#c084fc' },
      { key: 'fixationIndex', label: 'fixation', color: '#e879f9' },
      { key: 'priceEquationSelection', label: 'price eq.', color: '#f0abfc' },
      { key: 'energyInequality', label: 'inequality', color: '#fda4af' },
    ],
  },
  {
    id: 'culture',
    name: 'Culture',
    signals: [
      { key: 'memeEntropy', label: 'meme entropy', color: '#c084fc' },
      { key: 'speciesMemeMI', label: 'culture↔sp. MI', color: '#22d3ee' },
      { key: 'meanAltruism', label: 'altruism', color: '#a3e635' },
    ],
  },
  {
    id: 'physics',
    name: 'Physics',
    signals: [
      { key: 'lyapunovExponent', label: 'lyapunov', color: '#818cf8', scale: (v) => (v + 4) / 8 },
      { key: 'velocityDivMean', label: 'vel. divergence', color: '#7dd3fc', scale: (v) => (v + 1) / 2 },
      { key: 'velocityCurlMagMean', label: 'curl', color: '#38bdf8', scale: (v) => v / 2 },
      { key: 'caAliveFraction', label: 'CA alive', color: '#2dd4bf' },
    ],
  },
  {
    id: 'biophysics',
    name: 'Biophysics',
    signals: [
      { key: 'meanForce', label: 'mean force', color: '#fda4af' },
      { key: 'clusterCount', label: 'clusters', color: '#fb7185' },
      { key: 'rotationalOrder', label: 'rot. order', color: '#f87171' },
      { key: 'spatialEntropy', label: 'spatial entropy', color: '#fdba74' },
      { key: 'orgIndex', label: 'org index', color: '#fbbf24' },
      { key: 'massConservation', label: 'mass drift', color: '#facc15', scale: (v) => v },
      { key: 'carnotEfficiency', label: 'carnot', color: '#a3e635' },
      { key: 'entropyProduction', label: 'entropy prod', color: '#4ade80' },
      { key: 'enginePower', label: 'engine power', color: '#34d399' },
    ],
  },
  {
    id: 'omics',
    name: 'Omics',
    signals: [
      { key: 'expressionEntropy', label: 'expression entropy', color: '#c084fc' },
      { key: 'transcriptActivity', label: 'transcription', color: '#a78bfa' },
      { key: 'proteinDiversity', label: 'protein diversity', color: '#818cf8' },
      { key: 'proteomeLoad', label: 'proteome', color: '#6366f1' },
      { key: 'pathwayFlux', label: 'pathway flux', color: '#f472b6' },
      { key: 'fluxDiversity', label: 'flux diversity', color: '#f9a8d4' },
      { key: 'regulationGating', label: 'epi gating', color: '#22d3ee' },
      { key: 'ecCoupling', label: 'proteome-enzyme', color: '#67e8f9' },
      { key: 'nativeFraction', label: 'native frac', color: '#f87171' },
      { key: 'misfoldLoad', label: 'misfold load', color: '#fb7185' },
      { key: 'foldStability', label: 'fold stability', color: '#2dd4bf' },
      { key: 'tfRegulation', label: 'TF regulation', color: '#c4b5fd' },
      { key: 'envRecognition', label: 'env recognition', color: '#fde047' },
      { key: 'expressionNoise', label: 'expr noise', color: '#fbbf24' },
      { key: 'libraryDiversity', label: 'library div', color: '#fb923c' },
    ],
  },
  {
    id: 'chemistry',
    name: 'Chemistry',
    signals: [
      { key: 'chemicalDiversity', label: 'chem. diversity', color: '#4ade80' },
      { key: 'meanATP', label: 'ATP', color: '#86efac' },
      { key: 'meanEnzyme', label: 'enzyme', color: '#bef264' },
      { key: 'meanToxin', label: 'toxin', color: '#fb923c' },
    ],
  },
];

const W = 320;
const H = 96;
const PAD = 4;

const DEFAULTS = ['entropy', 'diversity', 'complexity', 'predatorFraction', 'cooperation'];

const STORAGE_KEY = 'fls.signals.selected';

function loadSelection(): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return new Set(JSON.parse(raw) as string[]);
  } catch {
    /* ignore */
  }
  return new Set(DEFAULTS);
}

/** Live time-series of the system-level observables, each auto-scaled. */
export function ObservablesChart({ id }: { id?: string }) {
  const history = useStore((s) => s.statsHistory);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [selected, setSelected] = useState<Set<string>>(loadSelection);
  const [groupsOpen, setGroupsOpen] = useState<Set<string>>(
    () => new Set(['ecology', 'strategy', 'selection']),
  );

  const allSignals = SIGNAL_GROUPS.flatMap((g) => g.signals);

  const toggleSignal = (key: string): void => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      localStorage.setItem(STORAGE_KEY, JSON.stringify([...next]));
      return next;
    });
  };

  const groupOpen = (id: string): boolean =>
    groupsOpen.has(id) || SIGNAL_GROUPS.find((g) => g.id === id)!.signals.some((s) => selected.has(s.key));

  const toggleGroup = (id: string): void => {
    const group = SIGNAL_GROUPS.find((g) => g.id === id)!;
    const hasAny = group.signals.some((s) => selected.has(s.key));
    setSelected((prev) => {
      const next = new Set(prev);
      for (const s of group.signals) {
        if (hasAny) next.delete(s.key);
        else next.add(s.key);
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify([...next]));
      return next;
    });
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    canvas.style.width = `${W}px`;
    canvas.style.height = `${H}px`;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    // grid
    ctx.strokeStyle = 'rgba(255,255,255,0.07)';
    ctx.lineWidth = 1;
    for (let i = 1; i < 4; i++) {
      const y = PAD + (i * (H - 2 * PAD)) / 4;
      ctx.beginPath();
      ctx.moveTo(PAD, y);
      ctx.lineTo(W - PAD, y);
      ctx.stroke();
    }

    const n = history.length;
    if (n < 2) return;

    for (const def of allSignals) {
      if (!selected.has(def.key)) continue;
      const scale = def.scale ?? ((v: number) => v);
      let max = 0;
      for (const p of history) max = Math.max(max, Math.max(0, scale(p[def.key] as number)));
      if (max <= 0) continue;
      ctx.strokeStyle = def.color;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        const raw = history[i]![def.key] as number;
        const v = Math.max(0, Math.min(1, scale(raw) / max));
        const x = PAD + (i / (n - 1)) * (W - 2 * PAD);
        const y = PAD + (1 - v) * (H - 2 * PAD);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  }, [history, selected, allSignals]);

  const activeCount = allSignals.filter((s) => selected.has(s.key)).length;

  return (
    <Panel
      id={id}
      title="Signals"
      right={<span className="font-mono text-[10px] text-zinc-500">{activeCount} on</span>}
    >
      <canvas ref={canvasRef} />
      <div className="mt-1.5 flex flex-col gap-0.5">
        {SIGNAL_GROUPS.map((g) => {
          const open = groupOpen(g.id);
          const groupHas = g.signals.some((s) => selected.has(s.key));
          return (
            <div key={g.id}>
              <div className="flex w-full items-center gap-1.5">
                <button
                  onClick={() => {
                    setGroupsOpen((prev) => {
                      const next = new Set(prev);
                      if (next.has(g.id)) next.delete(g.id);
                      else next.add(g.id);
                      return next;
                    });
                  }}
                  className="flex flex-1 items-center gap-1.5 rounded px-1 py-0.5 text-left hover:bg-white/5"
                >
                  <span className={`text-[9px] text-zinc-500 transition-transform ${open ? 'rotate-90' : ''}`}>
                    ▸
                  </span>
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                    {g.name}
                  </span>
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleGroup(g.id);
                  }}
                  className="rounded border border-white/10 px-1 text-[9px] text-zinc-400 hover:bg-white/10"
                >
                  {groupHas ? 'off' : 'on'}
                </button>
              </div>
              {open && (
                <div className="flex flex-wrap gap-x-2 gap-y-1 pl-3">
                  {g.signals.map((s) => (
                    <label key={s.key} className="flex cursor-pointer items-center gap-1 text-[10px] text-zinc-400">
                      <input
                        type="checkbox"
                        checked={selected.has(s.key)}
                        onChange={() => toggleSignal(s.key)}
                        className="accent-indigo-500"
                      />
                      <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: s.color }} />
                      {s.label}
                    </label>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Panel>
  );
}