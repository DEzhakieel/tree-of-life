import { useEffect, useState } from 'react';
import { agents } from '../net/session.js';
import { useStore } from '../store/useStore.js';
import { computeModelLayers, type TierMetric } from '../model/layers.js';
import { Panel } from './Panel.js';

/**
 * The model hierarchy: universal patterns grouped by the tier they emerge in.
 * Tiers are stacked bottom→top (geometry → ecology). Patterns with a spatial
 * reading (▸) switch the ground layer when clicked.
 */
export function ModelPanel() {
  const stats = useStore((s) => s.stats);
  const groundLayer = useStore((s) => s.groundLayer);
  const [tiers, setTiers] = useState<TierMetric[]>(() => computeModelLayers(null, agents));
  const [open, setOpen] = useState<Set<string>>(() => new Set(['geometry']));

  useEffect(() => {
    const timer = setInterval(() => {
      setTiers(computeModelLayers(stats, agents));
    }, 500);
    return () => clearInterval(timer);
  }, [stats]);

  const toggle = (id: string): void =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <Panel title="Model hierarchy" right={<span className="text-zinc-500">↑ emergence</span>}>
      <div className="flex flex-col gap-1">
        {tiers.map((t) => {
          const expanded = open.has(t.id);
          const mean = t.patterns.reduce((a, p) => a + p.value, 0) / t.patterns.length;
          return (
            <div key={t.id} className="rounded-md bg-white/[0.03]">
              <button
                onClick={() => toggle(t.id)}
                title={`${t.patterns.length} patterns · tap to expand`}
                className="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left hover:bg-white/5"
              >
                <span
                  className={`text-[10px] text-zinc-500 transition-transform ${expanded ? 'rotate-90' : ''}`}
                >
                  ▸
                </span>
                <span className="w-[52px] shrink-0 truncate text-[10px] font-semibold uppercase tracking-wider text-zinc-300">
                  {t.name}
                </span>
                <span className="h-1 flex-1 overflow-hidden rounded-full bg-white/10">
                  <span
                    className="block h-full rounded-full"
                    style={{ width: `${Math.round(mean * 100)}%`, background: t.color, opacity: 0.85 }}
                  />
                </span>
                <span className="w-8 shrink-0 text-right font-mono text-[10px] text-zinc-500">
                  {t.patterns.length}
                </span>
              </button>
              {expanded && (
                <div className="flex flex-col pb-1">
                  {t.patterns.map((p) => {
                    const mapped = p.ground !== undefined;
                    const active = mapped && groundLayer === p.ground;
                    return (
                      <button
                        key={p.id}
                        title={p.desc}
                        onClick={() => {
                          if (mapped) useStore.getState().setGroundLayer(p.ground!);
                        }}
                        className={`group flex items-center gap-2 rounded-md px-2 py-[3px] text-left ${
                          mapped ? 'cursor-pointer hover:bg-white/5' : 'cursor-default'
                        } ${active ? 'bg-indigo-500/20' : ''}`}
                      >
                        <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: p.color }} />
                        <span className="w-[86px] shrink-0 truncate text-[11px] text-zinc-300">{p.name}</span>
                        <span className="h-1 flex-1 overflow-hidden rounded-full bg-white/10">
                          <span
                            className="block h-full rounded-full"
                            style={{ width: `${Math.round(p.value * 100)}%`, background: p.color, opacity: 0.85 }}
                          />
                        </span>
                        <span className="w-[56px] shrink-0 text-right font-mono text-[10px] text-zinc-500">
                          {p.display}
                        </span>
                        {mapped && (
                          <span
                            className={`shrink-0 text-[10px] ${active ? 'text-indigo-300' : 'text-zinc-600 group-hover:text-zinc-400'}`}
                          >
                            ▸
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Panel>
  );
}
