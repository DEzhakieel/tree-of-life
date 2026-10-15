/**
 * Second/third-order ripple analysis for the event timeline.
 *
 * After a player intervention (or any logged event), measure the aggregate
 * consequences that unfold in the following window: population and species
 * drift, the birth/death load, and the emergent "shock" events (famine,
 * drought, war, extinction, cambrian) that the intervention catalysed.
 */
import type { EventFeedEntry } from '../store/useStore.js';
import type { StatsPoint } from '../store/useStore.js';

/** tick window over which a ripple is measured (stats cadence is normally 10) */
export const RIPPLE_WINDOW_TICKS = 200;

export const SHOCK_TYPES = ['famine', 'drought', 'war', 'extinction', 'cambrian'] as const;

export interface RippleShock {
  type: (typeof SHOCK_TYPES)[number];
  count: number;
}

export interface RippleSummary {
  /** true when an intervention exists and at least one stat sample followed it */
  hasRipple: boolean;
  eventTick: number;
  windowEndTick: number;
  prePop: number;
  postPop: number;
  popDelta: number;
  preSpecies: number;
  postSpecies: number;
  speciesDelta: number;
  births: number;
  deaths: number;
  shocks: RippleShock[];
  /** qualitative read of the aggregate trajectory */
  verdict: 'collapse' | 'shock' | 'contained' | 'expansion';
}

/** last stats sample at or before `tick`; falls back to the first sample when
 *  the window predates all measurements (world just started). */
function anchor(points: readonly StatsPoint[], tick: number): StatsPoint | null {
  let best: StatsPoint | null = null;
  for (const p of points) {
    if (p.tick <= tick) best = p;
    else break;
  }
  return best ?? points[0] ?? null;
}

/**
 * Measure the ripple for the most recent intervention in `events` using
 * `stats`. `pre` = the last measurement before the event, `post` = the last
 * measurement before the window closes, so a recovering world shows up as
 * population growth back toward (or past) the pre-event level.
 */
export function measureRipple(
  stats: readonly StatsPoint[],
  events: readonly EventFeedEntry[],
  windowTicks: number = RIPPLE_WINDOW_TICKS,
): RippleSummary {
  const summary: RippleSummary = {
    hasRipple: false,
    eventTick: 0,
    windowEndTick: 0,
    prePop: 0,
    postPop: 0,
    popDelta: 0,
    preSpecies: 0,
    postSpecies: 0,
    speciesDelta: 0,
    births: 0,
    deaths: 0,
    shocks: [],
    verdict: 'contained',
  };

  // newest-first feed → the first match is the most recent intervention
  const iv = [...events].find((e) => e.type === 'intervention');
  if (!iv) return summary;
  const t0 = iv.tick;
  const t1 = t0 + windowTicks;

  const pre = anchor(stats, t0);
  if (!pre) return summary;
  const post = anchor(stats, t1);
  if (!post) return summary;

  const births = events.filter((e) => e.type === 'birth' && e.tick >= t0 && e.tick <= t1).length;
  const deaths = events.filter((e) => e.type === 'death' && e.tick >= t0 && e.tick <= t1).length;
  const shocks: RippleShock[] = SHOCK_TYPES.map((type) => ({
    type,
    count: events.filter((e) => e.type === type && e.tick > t0 && e.tick <= t1).length,
  })).filter((s) => s.count > 0);

  const popDelta = post.population - pre.population;
  const speciesDelta = post.speciesCount - pre.speciesCount;
  const rel = pre.population > 0 ? popDelta / pre.population : 0;
  const verdict: RippleSummary['verdict'] =
    rel <= -0.15 ? 'collapse' : rel <= -0.02 ? 'shock' : rel < 0.02 ? 'contained' : 'expansion';

  return {
    hasRipple: true,
    eventTick: t0,
    windowEndTick: t1,
    prePop: pre.population,
    postPop: post.population,
    popDelta,
    preSpecies: pre.speciesCount,
    postSpecies: post.speciesCount,
    speciesDelta,
    births,
    deaths,
    shocks,
    verdict,
  };
}