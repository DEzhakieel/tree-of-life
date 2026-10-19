import { useEffect, useState } from 'react';
import type { InterventionType } from '@fractal-life/shared';
import { WORLD_SIZE } from '@fractal-life/shared';
import { useStore } from '../store/useStore.js';
import type { ScheduledEvent } from '../store/useStore.js';
import { intervene } from '../net/session.js';
import { Panel } from './Panel.js';

// setGene is deliberately absent: the scheduler form can only send
// {x, y, radius, amount, timeScale}, and a setGene without agentId/index/value
// is a guaranteed no-op in the engine — offering it would queue a dead event.
const EVENT_TYPES: InterventionType[] = ['meteor', 'seedFood', 'spawnAgent', 'pauseRegion', 'setTimeScale', 'nuke'];

const EVENT_ICON: Record<InterventionType, string> = {
  meteor: '☄',
  seedFood: '🌾',
  spawnAgent: '🧬',
  pauseRegion: '❄',
  setTimeScale: '⏱',
  nuke: '💥',
  setGene: '🧬',
};

const POLL_MS = 300;

/** Fire a scheduled event once the world tick has reached it. Positional
 *  interventions without explicit coordinates land on a random point — the
 *  click path supplies coordinates, the scripted path should not need to. */
function fire(ev: ScheduledEvent, tick: number): void {
  const p = ev.payload;
  const spatial = ev.type === 'meteor' || ev.type === 'seedFood' || ev.type === 'spawnAgent' || ev.type === 'pauseRegion' || ev.type === 'nuke';
  const x = spatial ? (p.x ?? Math.random() * WORLD_SIZE) : p.x;
  const y = spatial ? (p.y ?? Math.random() * WORLD_SIZE) : p.y;
  intervene({
    type: ev.type,
    x,
    y,
    radius: p.radius,
    amount: p.amount,
    timeScale: p.timeScale,
  });
  useStore.getState().advanceScheduledEvent(ev.id, tick);
}

/** Event Scheduler: scripted interventions queued against the sim clock. The
 *  panel both edits the queue and (since it is always mounted) drives the poll
 *  loop that fires due events. */
export function EventSchedulerPanel() {
  const scheduled = useStore((s) => s.scheduledEvents);
  const currentTick = useStore((s) => s.status?.currentTick ?? 0);
  const connected = useStore((s) => s.connected);

  const [type, setType] = useState<InterventionType>('meteor');
  const [tick, setTick] = useState(500);
  const [label, setLabel] = useState('');
  const [radius, setRadius] = useState(120);
  const [amount, setAmount] = useState(500);
  const [timeScale, setTimeScale] = useState(0.5);
  const [repeatEvery, setRepeatEvery] = useState(0);
  const [count, setCount] = useState('');
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    if (!connected) return;
    const timer = setInterval(() => {
      if (!connected) return;
      const now = useStore.getState().status?.currentTick ?? 0;
      const due = useStore.getState().scheduledEvents.filter((e) => e.enabled && e.firedTick === undefined && e.tick <= now);
      if (due.length === 0) return;
      for (const ev of due) fire(ev, now);
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [connected]);

  const add = () => {
    const rep = Math.max(0, Math.floor(repeatEvery));
    useStore.getState().addScheduledEvent({
      label: label.trim() !== '' ? label.trim() : type,
      type,
      tick: Math.max(0, Math.floor(tick)),
      enabled: true,
      payload: { radius: Math.max(0, radius), amount: Math.max(0, amount), timeScale: Math.max(0.01, timeScale) },
      repeatEvery: rep,
      remaining: rep > 0 && count.trim() !== '' ? Math.max(1, Math.floor(Number(count))) : undefined,
    });
    setLabel('');
  };

  const sorted = [...scheduled].sort((a, b) => a.tick - b.tick);

  return (
    <Panel
      title="Event Scheduler"
      id="scheduler"
      right={
        <span className="font-mono text-zinc-500">
          {scheduled.filter((e) => e.firedTick === undefined).length} pending
        </span>
      }
    >
      {adding && (
        <div className="mb-2 space-y-1.5 rounded-md border border-white/10 bg-white/[0.03] p-2">
          <div className="grid grid-cols-2 gap-1.5">
            <select
              value={type}
              onChange={(e) => setType(e.target.value as InterventionType)}
              className="rounded border border-white/10 bg-zinc-900 px-1.5 py-1 text-[11px] text-white"
            >
              {EVENT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {EVENT_ICON[t]} {t}
                </option>
              ))}
            </select>
            <input
              type="number"
              min={0}
              value={tick}
              onChange={(e) => setTick(Number(e.target.value))}
              title="tick to fire at"
              className="rounded border border-white/10 bg-zinc-900 px-1.5 py-1 font-mono text-[11px] text-white"
            />
          </div>
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="label (optional)"
            className="w-full rounded border border-white/10 bg-zinc-900 px-1.5 py-1 text-[11px] text-white"
          />
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1 text-[10px] text-zinc-500">
              r
              <input
                type="number"
                min={0}
                value={radius}
                onChange={(e) => setRadius(Number(e.target.value))}
                className="w-14 rounded border border-white/10 bg-zinc-900 px-1 py-0.5 font-mono text-[10px] text-white"
              />
            </label>
            <label className="flex items-center gap-1 text-[10px] text-zinc-500">
              amt
              <input
                type="number"
                min={0}
                value={amount}
                onChange={(e) => setAmount(Number(e.target.value))}
                className="w-14 rounded border border-white/10 bg-zinc-900 px-1 py-0.5 font-mono text-[10px] text-white"
              />
            </label>
            <label className="flex items-center gap-1 text-[10px] text-zinc-500">
              ts
              <input
                type="number"
                min={0.01}
                step={0.05}
                value={timeScale}
                onChange={(e) => setTimeScale(Number(e.target.value))}
                className="w-14 rounded border border-white/10 bg-zinc-900 px-1 py-0.5 font-mono text-[10px] text-white"
              />
            </label>
          </div>
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1 text-[10px] text-zinc-500" title="re-arm every N ticks (0 = one-shot)">
              ↻ every
              <input
                type="number"
                min={0}
                value={repeatEvery}
                onChange={(e) => setRepeatEvery(Number(e.target.value))}
                className="w-14 rounded border border-white/10 bg-zinc-900 px-1 py-0.5 font-mono text-[10px] text-white"
              />
            </label>
            <label className="flex items-center gap-1 text-[10px] text-zinc-500" title="number of fires (blank = forever)">
              ×
              <input
                type="number"
                min={1}
                placeholder="∞"
                value={count}
                onChange={(e) => setCount(e.target.value)}
                disabled={repeatEvery <= 0}
                className="w-14 rounded border border-white/10 bg-zinc-900 px-1 py-0.5 font-mono text-[10px] text-white disabled:opacity-40"
              />
            </label>
          </div>
          <div className="flex gap-1.5">
            <button
              onClick={add}
              className="flex-1 rounded bg-indigo-500/80 px-2 py-1 text-[10px] font-semibold text-white hover:bg-indigo-400"
            >
              Queue
            </button>
            <button onClick={() => setAdding(false)} className="rounded px-2 py-1 text-[10px] text-zinc-400 hover:bg-white/10">
              ✕
            </button>
          </div>
        </div>
      )}

      <button
        onClick={() => setAdding((a) => !a)}
        className="mb-1.5 w-full rounded border border-dashed border-white/15 px-2 py-1 text-[10px] text-zinc-400 hover:border-indigo-400 hover:text-white"
      >
        {adding ? 'cancel' : '+ queue intervention at tick'}
      </button>

      {sorted.length === 0 ? (
        <div className="py-2 text-center text-[10px] text-zinc-600">queue scripted events against the sim clock</div>
      ) : (
        <ul className="max-h-32 space-y-0.5 overflow-y-auto">
          {sorted.map((e) => {
            const fired = e.firedTick !== undefined;
            return (
              <li key={e.id} className="flex items-center gap-1.5 font-mono text-[10px] leading-4">
                <button
                  onClick={() => useStore.getState().toggleScheduledEvent(e.id)}
                  title={e.enabled ? 'armed' : 'disarmed'}
                  className={`h-2.5 w-2.5 shrink-0 rounded-full ${fired ? 'bg-zinc-600' : e.enabled ? 'bg-emerald-400' : 'bg-white/20'}`}
                />
                <span className="shrink-0 text-zinc-600">t{e.tick}</span>
                <span className={`shrink-0 ${fired ? 'text-zinc-600 line-through' : 'text-purple-300'}`}>{e.label}</span>
                {(e.repeatEvery ?? 0) > 0 && !fired && (
                  <span className="shrink-0 text-[9px] text-sky-400" title="repeat cadence">
                    ↻{e.repeatEvery}
                    {e.remaining === undefined ? '×∞' : `×${e.remaining}`}
                  </span>
                )}
                <span className="ml-auto text-[9px] text-zinc-600">
                  {fired ? `done@${e.firedTick}` : `now:${currentTick}`}
                </span>
                <button
                  onClick={() => useStore.getState().removeScheduledEvent(e.id)}
                  className="shrink-0 text-zinc-600 hover:text-rose-300"
                  title="remove"
                >
                  ✕
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}