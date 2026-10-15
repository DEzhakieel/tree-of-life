/**
 * Pure helpers for the emergence-atlas panel. The coordinate math itself
 * lives in @fractal-life/shared (emergenceAtlas) so the research CLI maps
 * runs through the identical code; this module only adapts the web store's
 * StatsPoint shape and holds the panel's palette.
 */
import type { AtlasSample, Regime } from '@fractal-life/shared';
import type { StatsPoint } from '../store/useStore.js';

export function toAtlasSample(p: StatsPoint): AtlasSample {
  return {
    tick: p.tick,
    entropy: p.entropy,
    diversity: p.diversity,
    complexity: p.complexity,
    speciesCount: p.speciesCount,
    lyapunovExponent: p.lyapunovExponent,
  };
}

export const REGIME_HEX: Record<Regime, string> = {
  order: '#38bdf8',
  edge: '#c084fc',
  chaos: '#f87171',
};

export const REGIME_TEXT: Record<Regime, string> = {
  order: 'text-sky-400',
  edge: 'text-violet-400',
  chaos: 'text-rose-400',
};

export const REGIME_LABEL: Record<Regime, string> = {
  order: 'ORDER',
  edge: 'EDGE',
  chaos: 'CHAOS',
};

/** coordinates for the dashed "edge of chaos" complexity ridge: the arch
 *  y = 4t(1-t) sampled across the plot's inner box. */
export function ridgePath(
  x0: number,
  y0: number,
  w: number,
  h: number,
  steps = 40,
): string {
  const pts: string[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = x0 + t * w;
    const y = y0 + (1 - 4 * t * (1 - t)) * h;
    pts.push(`${x.toFixed(1)},${y.toFixed(1)}`);
  }
  return pts.join(' ');
}
