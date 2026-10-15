/**
 * Pure helpers for the live event timeline UI. No React, no store — every
 * function here is unit-tested directly (apps/web/test/eventFeed.test.ts).
 */
import type { EventFeedEntry } from '../store/useStore.js';

/** Text colour class per event type (all 12, tailwind). */
export const EVENT_TEXT: Record<string, string> = {
  extinction: 'text-red-400',
  cambrian: 'text-emerald-400',
  migration: 'text-sky-400',
  symbiosis: 'text-fuchsia-400',
  famine: 'text-amber-400',
  drought: 'text-orange-400',
  war: 'text-rose-400',
  birth: 'text-lime-400',
  death: 'text-slate-400',
  predation: 'text-yellow-400',
  discovery: 'text-cyan-400',
  intervention: 'text-purple-400',
};

/** SVG fill colour per event type — same palette as EVENT_TEXT. */
export const EVENT_HEX: Record<string, string> = {
  extinction: '#f87171',
  cambrian: '#34d399',
  migration: '#38bdf8',
  symbiosis: '#e879f9',
  famine: '#fbbf24',
  drought: '#fb923c',
  war: '#fb7185',
  birth: '#a3e635',
  death: '#94a3b8',
  predation: '#facc15',
  discovery: '#22d3ee',
  intervention: '#c084fc',
};

const MAX_SUMMARY = 32;

/** One-line payload summary for a feed row (type-specific, generic fallback). */
export function summarizeEvent(e: Pick<EventFeedEntry, 'type' | 'data'>): string {
  const d = e.data as Record<string, unknown>;
  const num = (k: string): string | null => (typeof d[k] === 'number' ? String(d[k]) : null);
  let out: string;
  switch (e.type) {
    case 'death':
      out = typeof d.cause === 'string' ? `cause=${d.cause}` : 'death';
      break;
    case 'birth':
      out = num('species') !== null ? `species=${d.species}` : 'birth';
      break;
    case 'famine':
    case 'drought':
    case 'war':
      out = num('deaths') !== null ? `deaths=${d.deaths}` : e.type;
      break;
    case 'extinction':
    case 'cambrian':
      out = num('from') !== null && num('to') !== null ? `${d.from}→${d.to}` : e.type;
      break;
    case 'migration':
      out = num('distance') !== null ? `distance=${d.distance}` : 'migration';
      break;
    case 'symbiosis':
      out = num('species') !== null ? `species=${d.species}` : 'symbiosis';
      break;
    case 'predation':
      out = num('bite') !== null ? `bite=${d.bite}` : 'predation';
      break;
    case 'discovery':
      out = num('novelty') !== null ? `novelty=${d.novelty}` : 'discovery';
      break;
    case 'intervention':
      out = typeof d.itype === 'string' ? String(d.itype) : 'intervention';
      break;
    default: {
      const first = Object.entries(d).find(([, v]) => typeof v === 'number' || typeof v === 'string');
      out = first ? `${first[0]}=${first[1]}` : e.type;
      break;
    }
  }
  return out.length > MAX_SUMMARY ? out.slice(0, MAX_SUMMARY - 1) + '…' : out;
}

export function countByEventType(items: ReadonlyArray<{ type: string }>): Map<string, number> {
  const counts = new Map<string, number>();
  for (const m of items) counts.set(m.type, (counts.get(m.type) ?? 0) + 1);
  return counts;
}

/** An empty (or missing) set means "no filter — show everything". */
export function typeEnabled(type: string, active: ReadonlySet<string> | null | undefined): boolean {
  if (!active || active.size === 0) return true;
  return active.has(type);
}

export function filterMarks<T extends { type: string }>(items: readonly T[], active: ReadonlySet<string> | null): T[] {
  if (!active || active.size === 0) return [...items];
  return items.filter((m) => active.has(m.type));
}

export interface TimelineDomain {
  start: number;
  end: number;
}

/** x-domain for the strip: the whole run so far, never degenerate. */
export function timelineDomain(marks: readonly { tick: number }[], currentTick: number): TimelineDomain {
  let last = 0;
  for (const m of marks) if (m.tick > last) last = m.tick;
  return { start: 0, end: Math.max(last, Number.isFinite(currentTick) ? currentTick : 0, 1) };
}

/** tick → pixels, clamped into the domain so stray ticks cannot escape. */
export function timelineScale(domain: TimelineDomain, width: number): (tick: number) => number {
  const span = Math.max(1e-9, domain.end - domain.start);
  return (tick: number) => {
    const t = Math.min(Math.max(tick, domain.start), domain.end);
    return ((t - domain.start) / span) * width;
  };
}

/** Strip bar height for a significance in [0,1] — max leaves headroom above
 *  the baseline (baseline = H−9, so H−12 tops out 3px from the upper edge). */
export function significanceHeight(significance: number, stripHeight: number): number {
  const s = Math.min(1, Math.max(0, Number.isFinite(significance) ? significance : 0));
  return Math.max(4, Math.round(4 + s * (stripHeight - 16)));
}
