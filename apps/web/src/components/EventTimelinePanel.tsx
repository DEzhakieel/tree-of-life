import { useMemo, useState } from 'react';
import { useStore } from '../store/useStore.js';
import { Panel } from './Panel.js';
import {
  EVENT_HEX,
  EVENT_TEXT,
  countByEventType,
  filterMarks,
  significanceHeight,
  summarizeEvent,
  timelineDomain,
  timelineScale,
} from '../lib/eventFeed.js';
import { measureRipple } from '../lib/ripple.js';

const STRIP_W = 200;
const STRIP_H = 46;

const VERDICT_STYLE: Record<string, string> = {
  collapse: 'text-rose-300',
  shock: 'text-amber-300',
  contained: 'text-zinc-400',
  expansion: 'text-emerald-300',
};

/**
 * Live event timeline: a significance-weighted strip over the whole run plus
 * the detailed feed. Type chips toggle visibility — first click solos a type,
 * later clicks combine, and clearing the last one returns to "show all".
 */
export function EventTimelinePanel() {
  const marks = useStore((s) => s.eventMarks);
  const events = useStore((s) => s.events);
  const statsHistory = useStore((s) => s.statsHistory);
  const currentTick = useStore((s) => s.status?.currentTick ?? 0);
  const [active, setActive] = useState<ReadonlySet<string>>(new Set());

  const counts = useMemo(() => countByEventType(marks), [marks]);
  const shownMarks = useMemo(() => filterMarks(marks, active), [marks, active]);
  const shownEvents = useMemo(() => filterMarks(events, active), [events, active]);
  const domain = useMemo(() => timelineDomain(marks, currentTick), [marks, currentTick]);
  const x = useMemo(() => timelineScale(domain, STRIP_W), [domain]);
  const chips = useMemo(() => [...counts.entries()].sort((a, b) => b[1] - a[1]), [counts]);
  const ripple = useMemo(() => measureRipple(statsHistory, events), [statsHistory, events]);

  const toggle = (type: string) =>
    setActive((prev) => {
      if (prev.size === 0) return new Set([type]);
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });

  const baseline = STRIP_H - 9;
  const nowX = x(currentTick);

  return (
    <Panel
      title="Events"
      right={
        <span className="font-mono text-zinc-500">
          {shownMarks.length === marks.length ? marks.length : `${shownMarks.length}/${marks.length}`}
        </span>
      }
    >
      <svg
        width={STRIP_W}
        height={STRIP_H}
        viewBox={`0 0 ${STRIP_W} ${STRIP_H}`}
        className="rounded-md bg-white/[0.03]"
        role="img"
        aria-label="event timeline"
      >
        <line x1={0} x2={STRIP_W} y1={baseline} y2={baseline} stroke="#3f3f46" strokeWidth={1} />
        {shownMarks.map((m) => {
          const h = significanceHeight(m.significance, STRIP_H);
          return (
            <rect
              key={m.id}
              x={x(m.tick)}
              y={baseline - h}
              width={1.5}
              height={h}
              fill={EVENT_HEX[m.type] ?? '#a1a1aa'}
              opacity={0.45 + 0.55 * Math.min(1, Math.max(0, m.significance))}
            />
          );
        })}
        <line x1={nowX} x2={nowX} y1={2} y2={baseline} stroke="#e4e4e7" strokeWidth={1} opacity={0.35} />
        <text x={3} y={STRIP_H - 2} fontSize={8} fill="#71717a" fontFamily="monospace">
          t0
        </text>
        <text x={STRIP_W - 3} y={STRIP_H - 2} fontSize={8} fill="#71717a" textAnchor="end" fontFamily="monospace">
          t{domain.end}
        </text>
        {shownMarks.length === 0 && (
          <text x={STRIP_W / 2} y={baseline - 14} fontSize={9} fill="#71717a" textAnchor="middle" fontFamily="monospace">
            {marks.length === 0 ? 'no events yet' : 'all types filtered out'}
          </text>
        )}
      </svg>

      {chips.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {chips.map(([type, n]) => {
            const enabled = active.size === 0 || active.has(type);
            return (
              <button
                key={type}
                type="button"
                onClick={() => toggle(type)}
                title={`${type}: click to solo, then combine with more; clearing the last one shows everything`}
                className={`flex items-center gap-1 rounded px-1 py-0.5 font-mono text-[10px] leading-none transition-colors ${
                  enabled ? `bg-white/10 ${EVENT_TEXT[type] ?? 'text-zinc-300'}` : 'text-zinc-600'
                }`}
              >
                <span
                  className="h-1.5 w-1.5 rounded-full"
                  style={{ background: EVENT_HEX[type] ?? '#a1a1aa', opacity: enabled ? 1 : 0.35 }}
                />
                {type}
                <span className="text-zinc-500">{n}</span>
              </button>
            );
          })}
        </div>
      )}

      <ul className="mt-2 max-h-36 space-y-0.5 overflow-y-auto">
        {shownEvents.map((e) => (
          <li key={e.id} className="flex items-baseline gap-1.5 font-mono text-[11px] leading-4">
            <span className="shrink-0 text-zinc-600">t{e.tick}</span>
            <span className={`shrink-0 ${EVENT_TEXT[e.type] ?? 'text-zinc-300'}`}>{e.type}</span>
            <span className="ml-auto truncate text-zinc-500" title={summarizeEvent(e)}>
              {summarizeEvent(e)}
            </span>
            <span className="shrink-0 text-zinc-600">{e.significance.toFixed(2)}</span>
          </li>
        ))}
        {shownEvents.length === 0 && (
          <li className="font-mono text-[10px] text-zinc-600">
            {events.length === 0 ? 'waiting for events…' : 'filtered out'}
          </li>
        )}
      </ul>

      {ripple.hasRipple && (
        <div className="mt-1.5 rounded-md border border-white/10 bg-white/[0.03] px-2 py-1.5 font-mono text-[10px] leading-4">
          <div className="flex items-center gap-1.5">
            <span className="uppercase tracking-widest text-zinc-500">Ripple</span>
            <span className="text-purple-300">{ripple.eventTick}</span>
            <span className="text-zinc-600">→ t{ripple.windowEndTick}</span>
            <span className={`ml-auto ${VERDICT_STYLE[ripple.verdict] ?? 'text-zinc-400'}`}>{ripple.verdict}</span>
          </div>
          <div className="text-zinc-400">
            Δpop {ripple.popDelta >= 0 ? '+' : ''}
            {ripple.popDelta} ({ripple.prePop > 0 ? ((ripple.popDelta / ripple.prePop) * 100).toFixed(0) : '0'}%) · Δspecies{' '}
            {ripple.speciesDelta >= 0 ? '+' : ''}
            {ripple.speciesDelta}
            <span className="text-zinc-600"> · </span>
            <span className="text-lime-400">♥{ripple.births}</span>
            <span className="text-slate-500">/{ripple.deaths}†</span>
          </div>
          {ripple.shocks.length > 0 && (
            <div className="flex flex-wrap gap-1 text-zinc-500">
              {ripple.shocks.map((s) => (
                <span key={s.type} className={EVENT_TEXT[s.type] ?? ''}>
                  {s.type}×{s.count}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </Panel>
  );
}
