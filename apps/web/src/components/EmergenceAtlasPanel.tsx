import { useMemo } from 'react';
import { atlasSeries, summarizeAtlas, type AtlasPoint } from '@fractal-life/shared';
import { useStore } from '../store/useStore.js';
import { Panel } from './Panel.js';
import {
  REGIME_HEX,
  REGIME_LABEL,
  REGIME_TEXT,
  ridgePath,
  toAtlasSample,
} from '../lib/emergenceAtlas.js';

const W = 200;
const H = 132;
const PAD = 4;
const INNER_W = W - 2 * PAD;
const INNER_H = H - 2 * PAD;

const BANDS: { label: string; fill: string; text: string }[] = [
  { label: 'ORDER', fill: 'rgba(56,189,248,0.10)', text: '#38bdf8' },
  { label: 'EDGE', fill: 'rgba(192,132,252,0.13)', text: '#c084fc' },
  { label: 'CHAOS', fill: 'rgba(248,113,113,0.10)', text: '#f87171' },
];

function sx(x: number): number {
  return PAD + Math.min(1, Math.max(0, x)) * INNER_W;
}

function sy(y: number): number {
  return PAD + (1 - Math.min(1, Math.max(0, y))) * INNER_H;
}

/**
 * Emergence atlas: the run traced through the order -> chaos (x) x
 * complexity (y) phase plane, against the dashed edge-of-chaos arch.
 */
export function EmergenceAtlasPanel() {
  const history = useStore((s) => s.statsHistory);

  const series = useMemo(() => atlasSeries(history.map(toAtlasSample)), [history]);
  const summary = useMemo(() => summarizeAtlas(series), [series]);

  const trajectory = useMemo(() => series.map((p) => `${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`).join(' '), [series]);

  const end = summary.end;

  return (
    <Panel
      title="Emergence atlas"
      id="atlas"
      right={<span className="font-mono text-zinc-500">{summary.n} pts</span>}
    >
      <svg
        width={W}
        height={H}
        viewBox={`0 0 ${W} ${H}`}
        className="rounded-md bg-white/[0.03]"
        role="img"
        aria-label="emergence phase diagram"
      >
        {BANDS.map((b, i) => (
          <rect
            key={b.label}
            x={PAD + (i * INNER_W) / 3}
            y={PAD}
            width={INNER_W / 3}
            height={INNER_H}
            fill={b.fill}
          />
        ))}
        {[1, 2].map((i) => (
          <line
            key={i}
            x1={PAD + (i * INNER_W) / 3}
            x2={PAD + (i * INNER_W) / 3}
            y1={PAD}
            y2={PAD + INNER_H}
            stroke="#3f3f46"
            strokeWidth={1}
            strokeDasharray="2 3"
          />
        ))}

        {/* expected complexity ridge: maximal at the edge of chaos */}
        <polyline
          points={ridgePath(PAD, PAD, INNER_W, INNER_H)}
          fill="none"
          stroke="#fbbf24"
          strokeWidth={1}
          strokeDasharray="3 3"
          opacity={0.45}
        />

        {series.length > 1 && (
          <polyline points={trajectory} fill="none" stroke="#52525b" strokeWidth={1} />
        )}
        {series.map((p, i) => (
          <circle
            key={p.tick}
            cx={sx(p.x)}
            cy={sy(p.y)}
            r={1.7}
            fill={REGIME_HEX[p.regime]}
            opacity={0.25 + (0.7 * i) / Math.max(1, series.length - 1)}
          />
        ))}
        {end && (
          <circle cx={sx(end.x)} cy={sy(end.y)} r={3.5} fill="none" stroke="#f4f4f5" strokeWidth={1.2} />
        )}

        {BANDS.map((b, i) => (
          <text
            key={b.label}
            x={PAD + ((i + 0.5) * INNER_W) / 3}
            y={PAD + 9}
            fontSize={7.5}
            fill={b.text}
            textAnchor="middle"
            fontFamily="monospace"
            opacity={0.85}
          >
            {b.label}
          </text>
        ))}

        <text x={PAD + 2} y={PAD + INNER_H - 3} fontSize={7} fill="#71717a" fontFamily="monospace">
          order
        </text>
        <text x={W - PAD - 2} y={PAD + INNER_H - 3} fontSize={7} fill="#71717a" textAnchor="end" fontFamily="monospace">
          chaos
        </text>

        {series.length === 0 && (
          <text x={W / 2} y={H / 2} fontSize={9} fill="#71717a" textAnchor="middle" fontFamily="monospace">
            waiting for stats…
          </text>
        )}
      </svg>

      {summary.n > 0 && end && (
        <>
          <div className="mt-1 flex h-1.5 w-full overflow-hidden rounded-full">
            {(['order', 'edge', 'chaos'] as const).map((r) => (
              <div key={r} style={{ width: `${summary.residence[r] * 100}%`, background: REGIME_HEX[r] }} />
            ))}
          </div>
          <div className="mt-1 flex items-baseline gap-1 font-mono text-[10px] leading-4 text-zinc-500">
            <span>
              x{end.x.toFixed(2)} y{end.y.toFixed(2)}
            </span>
            <span className={REGIME_TEXT[end.regime]}>{REGIME_LABEL[end.regime]}</span>
            <span className="ml-auto text-zinc-600">
              {Math.round(summary.residence.order * 100)}/{Math.round(summary.residence.edge * 100)}/
              {Math.round(summary.residence.chaos * 100)}%
            </span>
          </div>
        </>
      )}
    </Panel>
  );
}
