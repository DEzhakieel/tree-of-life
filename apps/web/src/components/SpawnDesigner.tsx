import { useCallback, useMemo, useState } from 'react';
import { GENOME_SIZE } from '@fractal-life/shared';
import { useStore } from '../store/useStore.js';
import { Panel } from './Panel.js';
import { GenomeBrowser } from './GenomeBrowser.js';
import { SPECIES_PRESETS } from '../lib/presets.js';

function makeRandom(): Float32Array {
  const g = new Float32Array(GENOME_SIZE);
  for (let i = 0; i < GENOME_SIZE; i++) g[i] = Math.random() * 2 - 1;
  return g;
}

/** Genome designer panel: edit a genome used by the Spawn tool. */
export function SpawnDesigner() {
  const designGenome = useStore((s) => s.designGenome);
  const setDesignGenome = useStore((s) => s.setDesignGenome);
  const selectedId = useStore((s) => s.selectedAgentId);
  const agentsMeta = useStore((s) => s.agentsMeta);
  const meta = selectedId !== null ? agentsMeta.get(selectedId) : undefined;

  // editing buffer — a fresh copy each time the store genome is swapped for a
  // new source (random / cloned). `sourceKey` remounts the browser on external
  // swaps only, so slider local-state never goes stale while dragging.
  const [genome, setGenome] = useState<Float32Array>(() => designGenome ?? makeRandom());
  const [sourceKey, setSourceKey] = useState(0);

  const onEdit = useCallback(
    (index: number, value: number) => {
      if (index < 0 || index >= GENOME_SIZE) return;
      const next = genome.slice();
      next[index] = Math.max(-1, Math.min(1, value));
      setGenome(next);
      setDesignGenome(next);
    },
    [genome, setDesignGenome],
  );

  const syncFrom = useCallback(
    (src: Float32Array) => {
      setGenome(src.slice());
      setDesignGenome(src.slice());
      setSourceKey((k) => k + 1);
    },
    [setDesignGenome],
  );

  const mean = useMemo(() => {
    let s = 0;
    for (let i = 0; i < genome.length; i++) s += genome[i]!;
    return s / genome.length;
  }, [genome]);

  if (!designGenome) return null;

  return (
    <div className="pointer-events-auto absolute bottom-20 left-1/2 z-20 flex w-[26rem] max-w-[calc(100vw-1.5rem)] max-h-[45vh] -translate-x-1/2 flex-col rounded-xl border border-white/10 bg-black/80 shadow-2xl backdrop-blur">
      <Panel
        title="Genome Designer"
        className="flex min-h-0 flex-1 flex-col"
        right={
          <div className="flex items-center gap-1">
            <span className="font-mono text-[10px] text-zinc-500">
              μ={mean.toFixed(3)}
            </span>
            <button
              type="button"
              onClick={() => syncFrom(makeRandom())}
              className="rounded px-1.5 py-0.5 text-[10px] text-zinc-300 hover:bg-white/10"
              title="random genome"
            >
              random
            </button>
            <button
              type="button"
              disabled={!meta}
              onClick={() => {
                if (meta) syncFrom(meta.genome.slice());
              }}
              className="rounded px-1.5 py-0.5 text-[10px] text-zinc-300 hover:bg-white/10 disabled:opacity-40"
              title="clone inspected agent genome"
            >
              clone inspected
            </button>
            <button
              type="button"
              onClick={() => setDesignGenome(null)}
              className="rounded px-1.5 py-0.5 text-zinc-400 hover:bg-white/10"
              title="close designer (spawn tool will revert to random)"
            >
              ✕
            </button>
          </div>
        }
      >
        <div className="mb-1 text-[10px] leading-snug text-zinc-500">
          The <span className="font-semibold text-zinc-300">Spawn</span> tool drops this genome
          into the world wherever you click. Select <span className="font-semibold text-zinc-300">Spawn</span> in the toolbar if it isn't active. Edits apply instantly.
        </div>
        <div className="mb-1.5 flex flex-wrap gap-1">
          {SPECIES_PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => syncFrom(p.build())}
              title={`${p.hint} — ${p.notes}`}
              className="rounded border border-white/10 bg-white/5 px-1.5 py-0.5 text-[10px] text-zinc-300 hover:border-indigo-400 hover:text-white"
            >
              {p.label}
            </button>
          ))}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <GenomeBrowser genome={genome} onEdit={onEdit} title="editing" key={sourceKey} />
        </div>
      </Panel>
    </div>
  );
}