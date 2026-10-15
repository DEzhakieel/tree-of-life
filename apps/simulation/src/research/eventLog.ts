/**
 * Event log data layer for the causal-analysis CLI.
 *
 * Two sources feed the report:
 *  - an in-process TS Engine run (events + per-tick stats series captured
 *    together, plus any interventions planted by the CLI), and
 *  - an NDJSON event file exported from / written by the server.
 *
 * The in-process capture is the primary source: observational pre/post
 * analysis needs a metric series aligned tick-for-tick with the events, and
 * only a run we control produces both. External logs get census-level
 * analysis (counts, rates, interarrival gaps) only.
 */
import { readFileSync } from 'node:fs';
import type { EventType, Intervention, ParsedEventBatch, SimEvent, SimStats } from '@fractal-life/shared';
import { parseEventBatch, parseEventList, worldSize } from '@fractal-life/shared';
import { Engine } from '../engine.js';
import { makeWorld } from './scenarios.js';

/** Metrics read for pre/post and interventional analysis. Deliberately excludes
 *  per-tick counters (births/deaths/escapeDeaths) that are mechanically part of
 *  the events themselves — attributing `death` events to the `deaths` counter
 *  is a tautology, not a finding. */
export const ANALYSIS_METRICS = [
  'aliveCount',
  'avgEnergy',
  'speciesCount',
  'entropy',
  'diversity',
  'cooperation',
  'predatorFraction',
  'cultureCount',
] as const;

/** Extra stats the emergence-atlas report reads out of the same capture.
 *  Kept out of ANALYSIS_METRICS on purpose: observational pre/post iterates
 *  that list and its scope must not silently grow. */
export const ATLAS_METRICS = ['complexity', 'lyapunovExponent'] as const;

export type MetricKey = (typeof ANALYSIS_METRICS)[number];

export interface SeriesPoint {
  tick: number;
  values: Record<string, number>;
}

export interface PlantRecord {
  tick: number;
  intervention: Intervention;
}

export interface EventCapture {
  seed: string;
  ticks: number;
  events: SimEvent[];
  series: SeriesPoint[];
  /** interventions actually applied, in application order */
  plants: PlantRecord[];
}

export interface RunEventOptions {
  seed: string;
  ticks: number;
  spawn: number;
  /** interventions applied at their `tick`; each run pair must pass the same
   *  schedule so treatment/baseline arms only diverge at the plant itself */
  plants?: readonly PlantRecord[];
}

/**
 * Run the TS Engine for `ticks` and capture every emitted event plus a
 * per-tick stats point (the ANALYSIS_METRICS subset of SimStats).
 *
 * Planted interventions target the middle alive agent (lowest-id ordering)
 * so an area effect lands where the population actually is; both arms of a
 * paired run are bit-identical up to the plant tick, so the placement does
 * not leak treatment information into the baseline.
 */
export function runWithEvents(opts: RunEventOptions): EventCapture {
  const engine = new Engine(makeWorld(opts.seed, opts.spawn));
  const byTick = new Map<number, Intervention[]>();
  for (const p of opts.plants ?? []) {
    const list = byTick.get(p.tick) ?? [];
    list.push(p.intervention);
    byTick.set(p.tick, list);
  }
  const events: SimEvent[] = [];
  const series: SeriesPoint[] = [];
  const applied: PlantRecord[] = [];
  for (let t = 0; t < opts.ticks; t++) {
    const due = byTick.get(t);
    if (due) {
      for (const iv of due) {
        const placed = placePlant(engine, iv);
        engine.applyIntervention(placed);
        applied.push({ tick: t, intervention: placed });
      }
    }
    const tr = engine.tick();
    for (const ev of tr.events) events.push(ev);
    series.push({ tick: tr.tick, values: pickStats(tr.stats) });
  }
  return { seed: opts.seed, ticks: opts.ticks, events, series, plants: applied };
}

/** default intervention schedule for the CLI: one lethal, one replenishing,
 *  one behavioural intervention, at 40% / 60% / 80% of the run. */
export function defaultPlants(ticks: number): PlantRecord[] {
  return [
    { tick: Math.max(20, Math.floor(ticks * 0.4)), intervention: { type: 'meteor', radius: 128, sequence: 1 } },
    { tick: Math.max(30, Math.floor(ticks * 0.6)), intervention: { type: 'seedFood', radius: 160, amount: 80, sequence: 2 } },
    { tick: Math.max(40, Math.floor(ticks * 0.8)), intervention: { type: 'pauseRegion', radius: 200, ticks: 20, sequence: 3 } },
  ];
}

/** anchor an area intervention on a live agent (deterministic pick) so it is
 *  guaranteed to touch the population; fall back to world centre when the
 *  world is already empty. */
function placePlant(engine: Engine, iv: Intervention): Intervention {
  if (iv.x !== undefined && iv.y !== undefined) return iv;
  if (iv.type !== 'meteor' && iv.type !== 'nuke' && iv.type !== 'seedFood' && iv.type !== 'pauseRegion') return iv;
  const live = [...engine.agents.values()].filter((a) => a.alive).sort((a, b) => a.id - b.id);
  if (live.length === 0) return { ...iv, x: worldSize() / 2, y: worldSize() / 2 };
  const target = live[Math.floor(live.length / 2)]!;
  return { ...iv, x: target.x, y: target.y };
}

function pickStats(stats: SimStats): Record<string, number> {
  const out: Record<string, number> = {};
  for (const m of ANALYSIS_METRICS) out[m] = stats[m];
  for (const m of ATLAS_METRICS) out[m] = stats[m];
  return out;
}

/** Parse an event log from text: NDJSON (one SimEvent per line — the server's
 *  format) or a JSON array. Throws on a structurally broken array; per-line
 *  garbage in NDJSON is counted, not fatal. */
export function parseEventLogText(text: string): ParsedEventBatch {
  const trimmed = text.trimStart();
  if (trimmed.startsWith('[')) {
    let raw: unknown;
    try {
      raw = JSON.parse(trimmed);
    } catch {
      throw new Error('event log is not valid JSON');
    }
    if (!Array.isArray(raw)) throw new Error('event log JSON must be an array of events');
    return parseEventList(raw);
  }
  return parseEventBatch(text);
}

export function loadEventLog(path: string): ParsedEventBatch {
  return parseEventLogText(readFileSync(path, 'utf8'));
}

export function countByType(events: readonly SimEvent[]): Map<EventType, number> {
  const counts = new Map<EventType, number>();
  for (const ev of events) counts.set(ev.type, (counts.get(ev.type) ?? 0) + 1);
  return counts;
}

/** unique, sorted ticks on which `type` occurred — multiple same-tick events
 *  (per-agent types like birth/death) count as one windowed occurrence. */
export function occurrenceTicks(events: readonly SimEvent[], type: EventType): number[] {
  const ticks = new Set<number>();
  for (const ev of events) if (ev.type === type) ticks.add(ev.tick);
  return [...ticks].sort((a, b) => a - b);
}

export interface TypeCensus {
  type: EventType;
  /** total events of this type (per-agent events count individually) */
  count: number;
  /** unique ticks with at least one event of this type (windowed sample size) */
  ticks: number;
  ratePer100: number;
  meanSignificance: number;
  /** median gap between consecutive occurrence ticks; null when < 2 ticks */
  medianGap: number | null;
}

export function census(events: readonly SimEvent[], totalTicks: number): TypeCensus[] {
  const counts = countByType(events);
  const rows: TypeCensus[] = [];
  const denom = totalTicks > 0 ? totalTicks : 1;
  for (const [type, count] of counts) {
    const ticks = occurrenceTicks(events, type);
    const sigs = events.filter((e) => e.type === type).map((e) => e.significance);
    const gaps: number[] = [];
    for (let i = 1; i < ticks.length; i++) gaps.push(ticks[i]! - ticks[i - 1]!);
    const sortedGaps = [...gaps].sort((a, b) => a - b);
    rows.push({
      type,
      count,
      ticks: ticks.length,
      ratePer100: (count / denom) * 100,
      meanSignificance: sigs.reduce((a, b) => a + b, 0) / Math.max(1, sigs.length),
      medianGap: sortedGaps.length === 0 ? null : sortedGaps[Math.floor((sortedGaps.length - 1) / 2)]!,
    });
  }
  rows.sort((a, b) => b.ticks - a.ticks || a.type.localeCompare(b.type));
  return rows;
}
