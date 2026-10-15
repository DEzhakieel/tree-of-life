/**
 * Pure helpers for the emergence-radar panel. Uses the shared radar math
 * (`radarSeries`, `summarizeRadar`, `computePrimitives`) and maps the web
 * store's `RadarSample[]` to the panel's palette and labels.
 */
import type { LevelId, LevelStatus, RadarPoint, RadarSample } from '@fractal-life/shared';
import { radarSeries, summarizeRadar } from '@fractal-life/shared';

export const STATUS_HEX: Record<LevelStatus, string> = {
  DORMANT: '#3f3f46',
  ABSENT: '#71717a',
  PARTIAL: '#fbbf24',
  EMERGENT: '#34d399',
};

export const STATUS_TEXT: Record<LevelStatus, string> = {
  DORMANT: 'text-zinc-500',
  ABSENT: 'text-zinc-400',
  PARTIAL: 'text-amber-400',
  EMERGENT: 'text-emerald-400',
};

export const STATUS_LABEL: Record<LevelStatus, string> = {
  DORMANT: 'DORMANT',
  ABSENT: 'ABSENT',
  PARTIAL: 'PARTIAL',
  EMERGENT: 'EMERGENT',
};

export const LEVEL_SHORT: Record<LevelId, string> = {
  L0: 'Particle',
  L1: 'Agent',
  L2: 'Adaptive',
  L3: 'Learning',
  L4: 'Ecosystem',
  L5: 'Evolution',
  L6: 'Replicator',
  L7: 'Communication',
  L8: 'Culture',
  L9: 'Collective',
  L10: 'Artificial',
};

export function toRadarPoints(samples: readonly RadarSample[]): RadarPoint[] {
  if (samples.length === 0) return [];
  return radarSeries(samples);
}

export function summarizeRadarPoints(samples: readonly RadarSample[]): ReturnType<typeof summarizeRadar> | null {
  const pts = toRadarPoints(samples);
  if (pts.length === 0) return null;
  return summarizeRadar(pts);
}
