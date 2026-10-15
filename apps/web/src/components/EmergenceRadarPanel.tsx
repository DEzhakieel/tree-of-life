import { useMemo } from 'react';
import { toRadarPoints, STATUS_HEX, STATUS_LABEL, LEVEL_SHORT } from '../lib/emergenceRadar.js';
import { useStore } from '../store/useStore.js';
import { Panel } from './Panel.js';

const COLS = ['L0', 'L1', 'L2', 'L3', 'L4', 'L5', 'L6', 'L7', 'L8', 'L9', 'L10'] as const;

export function EmergenceRadarPanel() {
  const history = useStore((s) => s.radarHistory);

  const points = useMemo(() => toRadarPoints(history), [history]);
  const last = points[points.length - 1];
  const count = points.length;

  return (
    <Panel title="Emergence radar" right={<span className="font-mono text-zinc-500">{count} pts</span>}>
      <div className="flex flex-col gap-1">
        {COLS.map((id) => {
          const st = last?.status[id] ?? 'DORMANT';
          const score = last?.scores[id] ?? 0;
          const hex = STATUS_HEX[st];
          return (
            <div key={id} className="flex items-center gap-1.5 font-mono text-[10px] leading-4">
              <span className="w-2 text-zinc-500">{id}</span>
              <span className="w-16 truncate text-zinc-400">{LEVEL_SHORT[id]}</span>
              <span className="ml-auto flex items-center gap-1">
                <span style={{ color: hex }}>{STATUS_LABEL[st]}</span>
                <span className="text-zinc-500">{score.toFixed(2)}</span>
              </span>
            </div>
          );
        })}
        {count === 0 && <div className="font-mono text-[10px] text-zinc-500">waiting for samples…</div>}
      </div>
    </Panel>
  );
}
