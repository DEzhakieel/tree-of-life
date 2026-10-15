/**
 * Emergence atlas: maps a run's per-tick stats into the phase plane
 *
 *     x = order  <-disorder->  chaos     y = complexity
 *
 * The x coordinate is a composite structural/dynamical disorder in [0,1]:
 *
 *   - diversity   — Simpson 1 - sum(p_i^2);
 *   - evenness    — Pielou J = H / log2(S) (falls back to raw entropy when
 *                   speciesCount is unavailable);
 *   - lyapunov    — dynamical sensitivity, included only when it actually
 *                   varies (range >= 0.005) and reaches positive values
 *                   (a world that never goes lambda > 0 has no dynamical
 *                   chaos to report — a dead or always-stable sensor must
 *                   not drag the coordinate).
 *
 * Each component is stretched across the run's own envelope (min-max over
 * the series, floors 0.02 keep a jittering-but-dead signal out), so the
 * bands read as regimes *relative to what this world actually does*:
 * ORDER = the run's most ordered stretch, CHAOS = its most disordered.
 * This is deliberate: the absolute scales saturate in practice (populations
 * here are hyper-even, so raw Simpson sits at 0.9-1.0 forever and fixed
 * thirds would pin every run in the chaos corner). Compare trajectory
 * shapes and residence shares, not absolute x across different run sets.
 * If every component is dead the point sits at x = 0 (frozen).
 *
 * The y coordinate is the engine's LMC complexity (entropy x disequilibrium)
 * normalised to the run's own peak — the "edge of chaos" arch (complexity
 * maximal at intermediate disorder) is the shape the diagram is read against.
 *
 * Pure math, shared by the live web panel and the research CLI so both draw
 * the same diagram.
 */

export type Regime = 'order' | 'edge' | 'chaos';

export interface AtlasSample {
  tick: number;
  /** species-abundance Shannon entropy (bits) */
  entropy: number;
  /** Simpson diversity: 1 - sum(p_i^2) */
  diversity: number;
  /** LMC complexity: entropy x disequilibrium against the uniform distribution */
  complexity: number;
  /** enables Pielou evenness; absent -> raw entropy (run-stretched) */
  speciesCount?: number;
  /** dynamical chaos indicator; absent/flat/non-positive -> component excluded */
  lyapunovExponent?: number;
}

export interface AtlasPoint {
  tick: number;
  /** 0 = ordered end of the run's envelope, 1 = disordered end */
  x: number;
  /** complexity normalised to the run's peak, [0,1] */
  y: number;
  regime: Regime;
}

export interface AtlasSummary {
  n: number;
  /** fraction of points in each regime (sums to 1 for n > 0) */
  residence: Record<Regime, number>;
  /** mean complexity within each regime (0 when the regime never occurs) */
  meanY: Record<Regime, number>;
  /** highest-complexity point of the run */
  peak: AtlasPoint | null;
  start: AtlasPoint | null;
  end: AtlasPoint | null;
  /** regime where the run spent the most time */
  dominant: Regime | null;
}

/** band edges of the diagram: x <= 1/3 ordered, x >= 2/3 chaotic, between = edge */
export function regimeOf(x: number): Regime {
  if (x <= 1 / 3) return 'order';
  if (x >= 2 / 3) return 'chaos';
  return 'edge';
}

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** stretch a series across its own [min,max]; null when the series carries no
 *  information (dead sensor / pure noise below the floor). Non-finite samples
 *  map to the ordered end (0). */
function stretch(vals: readonly number[], floor: number): number[] | null {
  let min = Infinity;
  let max = -Infinity;
  for (const v of vals) {
    if (!Number.isFinite(v)) continue;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (!Number.isFinite(min) || max - min < floor) return null;
  return vals.map((v) => (Number.isFinite(v) ? (v - min) / (max - min) : 0));
}

interface AtlasContext {
  diversity: number[] | null;
  structural: number[] | null;
  lyapunov: number[] | null;
  maxComplexity: number;
}

const FLOOR_DIVERSITY = 0.02;
const FLOOR_STRUCTURAL = 0.02;
const FLOOR_LYAPUNOV = 0.005;

function evenness(s: AtlasSample): number {
  return clamp01(s.entropy / Math.log2(Math.max(s.speciesCount!, 2)));
}

function buildContext(samples: readonly AtlasSample[]): AtlasContext {
  const speciesEverywhere = samples.length > 0 && samples.every((s) => s.speciesCount !== undefined && Number.isFinite(s.speciesCount));
  const lyapEverywhere = samples.length > 0 && samples.every((s) => s.lyapunovExponent !== undefined && Number.isFinite(s.lyapunovExponent));

  const structural = stretch(
    samples.map((s) => (speciesEverywhere ? evenness(s) : s.entropy)),
    FLOOR_STRUCTURAL,
  );

  let lyap: number[] | null = null;
  if (lyapEverywhere) {
    const vals = samples.map((s) => s.lyapunovExponent!);
    let max = -Infinity;
    for (const v of vals) if (v > max) max = v;
    // positive reach is the physical gate: lambda <= 0 everywhere means the
    // run never left stable dynamics, whatever its internal jitter
    if (max > 0) lyap = stretch(vals, FLOOR_LYAPUNOV);
  }

  let maxComplexity = 0;
  for (const s of samples) if (Number.isFinite(s.complexity) && s.complexity > maxComplexity) maxComplexity = s.complexity;

  return {
    diversity: stretch(samples.map((s) => s.diversity), FLOOR_DIVERSITY),
    structural,
    lyapunov: lyap,
    maxComplexity,
  };
}

/** Map a stats series into the phase plane. */
export function atlasSeries(samples: readonly AtlasSample[]): AtlasPoint[] {
  const ctx = buildContext(samples);
  const out: AtlasPoint[] = [];
  for (let i = 0; i < samples.length; i++) {
    const comps: number[] = [];
    if (ctx.diversity) comps.push(ctx.diversity[i]!);
    if (ctx.structural) comps.push(ctx.structural[i]!);
    if (ctx.lyapunov) comps.push(ctx.lyapunov[i]!);
    let sum = 0;
    for (const c of comps) sum += c;
    const x = comps.length > 0 ? sum / comps.length : 0;
    const y = ctx.maxComplexity > 1e-12 ? clamp01(samples[i]!.complexity / ctx.maxComplexity) : 0;
    out.push({ tick: samples[i]!.tick, x, y, regime: regimeOf(x) });
  }
  return out;
}

/** Regime residence, in-run complexity peaks and endpoints of a trajectory. */
export function summarizeAtlas(points: readonly AtlasPoint[]): AtlasSummary {
  const residence: Record<Regime, number> = { order: 0, edge: 0, chaos: 0 };
  const sumY: Record<Regime, number> = { order: 0, edge: 0, chaos: 0 };
  let peak: AtlasPoint | null = null;
  for (const p of points) {
    residence[p.regime] += 1;
    sumY[p.regime] += p.y;
    if (peak === null || p.y > peak.y) peak = p;
  }
  const n = points.length;
  const meanY: Record<Regime, number> = {
    order: residence.order > 0 ? sumY.order / residence.order : 0,
    edge: residence.edge > 0 ? sumY.edge / residence.edge : 0,
    chaos: residence.chaos > 0 ? sumY.chaos / residence.chaos : 0,
  };
  let dominant: Regime | null = null;
  if (n > 0) {
    dominant = 'order';
    for (const r of ['edge', 'chaos'] as const) if (residence[r] > residence[dominant]) dominant = r;
    for (const r of ['order', 'edge', 'chaos'] as const) residence[r] /= n;
  }
  return {
    n,
    residence,
    meanY,
    peak,
    start: n > 0 ? points[0]! : null,
    end: n > 0 ? points[n - 1]! : null,
    dominant,
  };
}
