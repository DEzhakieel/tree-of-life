/**
 * Emergence-atlas report: maps captured stats series into the
 * order <-> complexity <-> chaos phase plane and renders md/json/svg.
 *
 * The coordinate math lives in @fractal-life/shared/emergenceAtlas — the
 * same code the live web panel runs — so a CLI diagram and an on-screen
 * diagram of the same run are the same picture.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  atlasSeries,
  summarizeAtlas,
  type AtlasPoint,
  type AtlasSample,
  type AtlasSummary,
  type Regime,
} from '@fractal-life/shared';
import type { EventCapture, SeriesPoint } from './eventLog.js';

export const REGIME_HEX: Record<Regime, string> = {
  order: '#38bdf8',
  edge: '#c084fc',
  chaos: '#f87171',
};

export const SEED_COLORS = ['#60a5fa', '#34d399', '#fbbf24', '#f472b6', '#a78bfa', '#22d3ee'];

export interface AtlasRun {
  seed: string;
  points: AtlasPoint[];
  summary: AtlasSummary;
}

export interface AtlasReportInput {
  seeds: string[];
  ticks: number;
  spawn: number;
  runs: AtlasRun[];
}

/** SeriesPoint values -> atlas samples; absent keys fall through to the
 *  shared module's own fallbacks (run-scaled entropy, dropped lyapunov). */
export function samplesFromSeries(series: readonly SeriesPoint[]): AtlasSample[] {
  return series.map((p) => ({
    tick: p.tick,
    entropy: p.values.entropy ?? 0,
    diversity: p.values.diversity ?? 0,
    complexity: p.values.complexity ?? 0,
    speciesCount: p.values.speciesCount,
    lyapunovExponent: p.values.lyapunovExponent,
  }));
}

export function buildAtlasRun(seed: string, capture: EventCapture): AtlasRun {
  const points = atlasSeries(samplesFromSeries(capture.series));
  return { seed, points, summary: summarizeAtlas(points) };
}

/** pooled residence/complexity across runs, each run weighted by its points */
export function pooledSummary(runs: readonly AtlasRun[]): {
  residence: Record<Regime, number>;
  meanY: Record<Regime, number>;
  n: number;
} {
  const residence: Record<Regime, number> = { order: 0, edge: 0, chaos: 0 };
  const sumY: Record<Regime, number> = { order: 0, edge: 0, chaos: 0 };
  let n = 0;
  for (const r of runs) {
    n += r.summary.n;
    for (const k of ['order', 'edge', 'chaos'] as const) {
      residence[k] += r.summary.residence[k] * r.summary.n;
      sumY[k] += r.summary.meanY[k] * r.summary.residence[k] * r.summary.n;
    }
  }
  const meanY: Record<Regime, number> = {
    order: residence.order > 0 ? sumY.order / residence.order : 0,
    edge: residence.edge > 0 ? sumY.edge / residence.edge : 0,
    chaos: residence.chaos > 0 ? sumY.chaos / residence.chaos : 0,
  };
  if (n > 0) for (const k of ['order', 'edge', 'chaos'] as const) residence[k] /= n;
  return { residence, meanY, n };
}

function pct(v: number): string {
  return `${(v * 100).toFixed(0)}%`;
}

function f(v: number, d = 3): string {
  return Number.isFinite(v) ? v.toFixed(d) : 'n/a';
}

const METHOD = [
  'x = composite disorder: mean of Simpson diversity (1 - sum p^2), Pielou evenness',
  '(H / log2 S, falling back to raw entropy without species counts) and the lyapunov',
  'exponent — each component stretched min-max across the run\'s own envelope, with',
  'noise floors so a jittering-but-dead signal is dropped, and lyapunov admitted only',
  'when it varies and reaches lambda > 0. Bands are thirds of x and read relative to',
  'this run: ORDER = its most ordered stretch, CHAOS = its most disordered. y = LMC',
  'complexity normalised to the run peak; the dashed arch is the reference curve',
  'y = 4x(1-x), not a fit. Compare trajectory shapes and residence shares, not',
  'absolute x across different run sets. Descriptive/correlational, not causal.',
].join('\n');

export function renderAtlasReport(input: AtlasReportInput): { md: string; json: string } {
  const md: string[] = [];
  md.push(`# emergence atlas: ${input.seeds.join(', ')}`);
  md.push('');
  md.push(`${input.ticks} ticks, spawn ${input.spawn}, ${input.runs.length} run(s), ${METHOD}`);
  md.push('');
  md.push('## runs');
  md.push('');
  md.push('| seed | n | order | edge | chaos | dominant | peak y @ t | end x, y | end regime |');
  md.push('|---|---|---|---|---|---|---|---|---|');
  for (const r of input.runs) {
    const s = r.summary;
    const peak = s.peak ? `${f(s.peak.y, 2)} @ ${s.peak.tick}` : 'n/a';
    const end = s.end ? `${f(s.end.x, 2)}, ${f(s.end.y, 2)}` : 'n/a';
    md.push(
      `| ${mdCell(r.seed)} | ${s.n} | ${pct(s.residence.order)} | ${pct(s.residence.edge)} | ${pct(s.residence.chaos)} | ${s.dominant ?? 'n/a'} | ${peak} | ${end} | ${s.end?.regime ?? 'n/a'} |`,
    );
  }
  md.push('');
  const pooled = pooledSummary(input.runs);
  md.push('## pooled residence (run-weighted)');
  md.push('');
  md.push('| regime | share | mean complexity |');
  md.push('|---|---|---|');
  for (const k of ['order', 'edge', 'chaos'] as const) {
    md.push(`| ${k} | ${pct(pooled.residence[k])} | ${f(pooled.meanY[k], 2)} |`);
  }
  md.push('');
  md.push('## how to read this');
  md.push('');
  md.push('- the dashed arch in plots/atlas.svg is the expected edge-of-chaos ridge');
  md.push('  y = 4x(1-x) drawn for reference — it is not fitted to the data;');
  md.push('- trajectories connect per-tick stats points, coloured by regime; a run that');
  md.push('  parks in one band is dynamically frozen (order) or featureless (chaos);');
  md.push('- residence share plus mean complexity per regime is the summary statistic:');
  md.push('  high edge-residence with high edge mean-complexity is where emergence lives.');
  md.push('');

  const json = JSON.stringify(
    {
      seeds: input.seeds,
      ticks: input.ticks,
      spawn: input.spawn,
      pooled,
      runs: input.runs.map((r) => ({
        seed: r.seed,
        summary: r.summary,
        points: r.points,
      })),
    },
    null,
    2,
  );
  return { md: md.join('\n'), json };
}

function esc(s: string): string {
  // text nodes only need & and < escaped; escaping '>' would mangle arrows
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
}

/** keep legend/endpoint labels inside the frame */
function shortSeed(seed: string): string {
  return seed.length > 16 ? `${seed.slice(0, 15)}…` : seed;
}

/** md table cell: a literal pipe in a seed would split the row */
function mdCell(s: string): string {
  return s.replace(/\|/g, '\\|');
}

/** title seed list: many seeds would run past the frame */
function titleSeeds(seeds: string[]): string {
  const line = seeds.join(', ');
  return line.length > 90 ? `${line.slice(0, 89)}…` : line;
}

export function renderAtlasSvg(input: AtlasReportInput): string {
  const w = 1040;
  // legend column grows 52px per run; extend the frame instead of clipping
  const h = Math.max(620, 222 + 52 * input.runs.length + 16);
  const x0 = 72;
  const y0 = 84;
  const plotW = 640;
  const plotH = 440;
  const parts: string[] = [];

  const sx = (x: number): number => x0 + Math.min(1, Math.max(0, x)) * plotW;
  const sy = (y: number): number => y0 + (1 - Math.min(1, Math.max(0, y))) * plotH;

  const bands: { label: string; fill: string; text: string }[] = [
    { label: 'ORDER', fill: 'rgba(56,189,248,0.10)', text: '#38bdf8' },
    { label: 'EDGE', fill: 'rgba(192,132,252,0.13)', text: '#c084fc' },
    { label: 'CHAOS', fill: 'rgba(248,113,113,0.10)', text: '#f87171' },
  ];
  bands.forEach((b, i) => {
    parts.push(
      `<rect x="${(x0 + (i * plotW) / 3).toFixed(1)}" y="${y0}" width="${(plotW / 3).toFixed(1)}" height="${plotH}" fill="${b.fill}"/>`,
      `<text x="${(x0 + ((i + 0.5) * plotW) / 3).toFixed(1)}" y="${y0 + 20}" fill="${b.text}" font-family="monospace" font-size="12" text-anchor="middle">${b.label}</text>`,
    );
  });
  for (const i of [1, 2]) {
    const gx = x0 + (i * plotW) / 3;
    parts.push(
      `<line x1="${gx.toFixed(1)}" y1="${y0}" x2="${gx.toFixed(1)}" y2="${y0 + plotH}" stroke="#3f3f46" stroke-dasharray="3 4"/>`,
    );
  }
  parts.push(`<rect x="${x0}" y="${y0}" width="${plotW}" height="${plotH}" fill="none" stroke="#30363d"/>`);

  // reference ridge y = 4t(1-t)
  const ridge: string[] = [];
  for (let i = 0; i <= 60; i++) {
    const t = i / 60;
    ridge.push(`${sx(t).toFixed(1)},${sy(4 * t * (1 - t)).toFixed(1)}`);
  }
  parts.push(
    `<polyline points="${ridge.join(' ')}" fill="none" stroke="#fbbf24" stroke-width="1.2" stroke-dasharray="5 5" opacity="0.55"/>`,
  );

  // trajectories
  input.runs.forEach((r, idx) => {
    const color = SEED_COLORS[idx % SEED_COLORS.length]!;
    if (r.points.length > 1) {
      const line = r.points.map((p) => `${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`).join(' ');
      parts.push(`<polyline points="${line}" fill="none" stroke="${color}" stroke-width="1.2" opacity="0.55"/>`);
    }
    for (const p of r.points) {
      parts.push(
        `<circle cx="${sx(p.x).toFixed(1)}" cy="${sy(p.y).toFixed(1)}" r="1.8" fill="${REGIME_HEX[p.regime]}" opacity="0.55"/>`,
      );
    }
    const end = r.summary.end;
    if (end) {
      const ex = sx(end.x);
      const ey = sy(end.y);
      // near the chaos edge the label would run into the legend column
      const flip = ex > x0 + plotW * 0.7;
      parts.push(
        `<circle cx="${ex.toFixed(1)}" cy="${ey.toFixed(1)}" r="5" fill="none" stroke="${color}" stroke-width="1.6"/>`,
        `<text x="${(flip ? ex - 9 : ex + 9).toFixed(1)}" y="${(ey + 4).toFixed(1)}" fill="${color}" font-family="monospace" font-size="11" text-anchor="${flip ? 'end' : 'start'}">${esc(shortSeed(r.seed))}</text>`,
      );
    }
  });

  // axes
  parts.push(
    `<text x="${x0 + plotW / 2}" y="${y0 + plotH + 34}" fill="#8b949e" font-family="monospace" font-size="12" text-anchor="middle">composite disorder:  order  &lt;-&gt;  chaos</text>`,
    `<text x="${x0 - 12}" y="${y0 + plotH / 2}" fill="#8b949e" font-family="monospace" font-size="12" text-anchor="middle" transform="rotate(-90 ${x0 - 12} ${y0 + plotH / 2})">complexity (run peak = 1)</text>`,
    `<text x="${x0}" y="${y0 + plotH + 16}" fill="#71717a" font-family="monospace" font-size="10">0</text>`,
    `<text x="${x0 + plotW / 2}" y="${y0 + plotH + 16}" fill="#71717a" font-family="monospace" font-size="10" text-anchor="middle">0.5</text>`,
    `<text x="${x0 + plotW}" y="${y0 + plotH + 16}" fill="#71717a" font-family="monospace" font-size="10" text-anchor="end">1</text>`,
    `<text x="${x0 - 8}" y="${y0 + 4}" fill="#71717a" font-family="monospace" font-size="10" text-anchor="end">1</text>`,
    `<text x="${x0 - 8}" y="${y0 + plotH}" fill="#71717a" font-family="monospace" font-size="10" text-anchor="end">0</text>`,
  );

  // legend / residence column
  const pooled = pooledSummary(input.runs);
  let ly = y0 + 18;
  parts.push(
    `<text x="744" y="${ly}" fill="#e6edf3" font-family="monospace" font-size="13" font-weight="600">runs</text>`,
  );
  ly += 22;
  input.runs.forEach((r, idx) => {
    const color = SEED_COLORS[idx % SEED_COLORS.length]!;
    const s = r.summary;
    parts.push(
      `<rect x="744" y="${ly - 9}" width="10" height="10" fill="${color}"/>`,
      `<text x="760" y="${ly}" fill="#e6edf3" font-family="monospace" font-size="11">${esc(shortSeed(r.seed))}</text>`,
      `<text x="744" y="${ly + 15}" fill="#8b949e" font-family="monospace" font-size="10">ord ${pct(s.residence.order)} edge ${pct(s.residence.edge)} cha ${pct(s.residence.chaos)} · ${s.dominant ?? 'n/a'}</text>`,
      `<text x="744" y="${ly + 29}" fill="#8b949e" font-family="monospace" font-size="10">end (${f(s.end?.x ?? Number.NaN, 2)}, ${f(s.end?.y ?? Number.NaN, 2)}) ${s.end?.regime ?? 'n/a'}</text>`,
    );
    ly += 52;
  });
  ly += 8;
  parts.push(
    `<text x="744" y="${ly}" fill="#e6edf3" font-family="monospace" font-size="13" font-weight="600">pooled</text>`,
  );
  ly += 18;
  let bx = 744;
  for (const k of ['order', 'edge', 'chaos'] as const) {
    const bw = pooled.residence[k] * 192;
    parts.push(`<rect x="${bx.toFixed(1)}" y="${ly - 9}" width="${bw.toFixed(1)}" height="10" fill="${REGIME_HEX[k]}"/>`);
    bx += bw;
  }
  ly += 14;
  parts.push(
    `<text x="744" y="${ly}" fill="#8b949e" font-family="monospace" font-size="10">${pct(pooled.residence.order)} / ${pct(pooled.residence.edge)} / ${pct(pooled.residence.chaos)}</text>`,
  );
  ly += 30;
  parts.push(
    `<text x="744" y="${ly}" fill="#8b949e" font-family="monospace" font-size="10">arch = expected</text>`,
    `<text x="744" y="${ly + 14}" fill="#8b949e" font-family="monospace" font-size="10">edge-of-chaos ridge,</text>`,
    `<text x="744" y="${ly + 28}" fill="#8b949e" font-family="monospace" font-size="10">not a fitted curve</text>`,
  );

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`,
    `<rect width="${w}" height="${h}" fill="#0e1116"/>`,
    `<text x="24" y="34" fill="#e6edf3" font-family="monospace" font-size="15">emergence atlas: ${esc(titleSeeds(input.seeds))}</text>`,
    `<text x="24" y="54" fill="#8b949e" font-family="monospace" font-size="11">${input.ticks} ticks, spawn ${input.spawn} · x = run-stretched (diversity + evenness + lyapunov), y = LMC complexity / run peak</text>`,
    ...parts,
    '</svg>',
  ].join('\n');
}

export function writeAtlasReport(input: AtlasReportInput): string {
  const dir = join(fileURLToPath(new URL('.', import.meta.url)), '../../research/output');
  mkdirSync(dir, { recursive: true });
  mkdirSync(join(dir, 'plots'), { recursive: true });
  const { md, json } = renderAtlasReport(input);
  writeFileSync(join(dir, 'atlas.md'), md);
  writeFileSync(join(dir, 'atlas.json'), json);
  writeFileSync(join(dir, 'plots', 'atlas.svg'), renderAtlasSvg(input));
  return dir;
}
