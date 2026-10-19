import { useEffect, useState } from 'react';
import { agents } from '../net/session.js';
import { useStore } from '../store/useStore.js';
import { Panel } from './Panel.js';

const GOLDEN = 0.6180339887498949;

function speciesColor(species: number, energy: number): string {
  const hue = (species * GOLDEN) % 1;
  const l = 0.3 + energy * 0.5;
  return `hsl(${Math.round(hue * 360)}, 85%, ${Math.round(l * 100)}%)`;
}

interface SpeciesRow {
  id: number;
  count: number;
  avgEnergy: number;
  cultures: number;
  avgMeme: number;
}

/** Top populations by species, recomputed ~2x/sec from the agent buffer. */
export function SpeciesPanel({ id }: { id?: string }) {
  const visible = useStore((s) => s.showSpecies);
  const [rows, setRows] = useState<SpeciesRow[]>([]);

  useEffect(() => {
    if (!visible) return;
    const timer = setInterval(() => {
      const map = new Map<number, { count: number; energy: number; memeSum: number; cultures: Set<number> }>();
      for (let i = 0; i < agents.count; i++) {
        const s = agents.species[i]!;
        const e = agents.energy[i]!;
        const m = agents.meme[i]!;
        const rec = map.get(s) ?? { count: 0, energy: 0, memeSum: 0, cultures: new Set<number>() };
        rec.count++;
        rec.energy += e;
        rec.memeSum += m;
        rec.cultures.add(Math.round(m / 0.05));
        map.set(s, rec);
      }
      const list: SpeciesRow[] = [];
      for (const [id, rec] of map) {
        list.push({ id, count: rec.count, avgEnergy: rec.energy / rec.count, cultures: rec.cultures.size, avgMeme: rec.memeSum / rec.count });
      }
      list.sort((a, b) => b.count - a.count);
      setRows(list.slice(0, 12));
    }, 500);
    return () => clearInterval(timer);
  }, [visible]);

  if (!visible) return null;

  return (
    <Panel id={id} title="Species" right={<span className="font-mono text-zinc-500">{rows.length}</span>}>
      <ul className="space-y-1">
        {rows.map((r) => (
          <li key={r.id} className="flex items-center gap-2">
            <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: speciesColor(r.id, r.avgEnergy) }} />
            <span
              className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ background: `hsl(${Math.round(r.avgMeme * 360)}, 60%, 55%)` }}
              title={`${r.cultures} culture tag(s)`}
            />
            <span className="flex-1 truncate text-zinc-300">sp.{r.id % 10000}</span>
            <span className="font-mono text-zinc-500">{r.count}</span>
          </li>
        ))}
      </ul>
      {rows.length === 0 && <div className="text-zinc-500">waiting for population…</div>}
    </Panel>
  );
}
