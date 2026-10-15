/**
 * Phase M plotting layer — deterministic, dependency-free SVG charts.
 *
 * Everything is emitted as plain UTF-8 SVG text (no canvas, no node bindings),
 * so reports embed plots that render in any browser, diff cleanly in git, and
 * never depend on a package-lock. Layout math is fixed (nice-tick rounding),
 * so regenerating a report yields byte-identical plots for identical data.
 */

const PALETTE = [
  '#4e79a7', // torus / primary
  '#f28e2b', // cylinder
  '#59a14f', // sphere
  '#e15759', // mobius
  '#b07aa1', // kleinBottle
  '#76b7b2',
  '#edc948',
  '#ff9da7',
];

export const TOPOLOGY_COLORS: Record<string, string> = {
  torus: PALETTE[0],
  cylinder: PALETTE[1],
  sphere: PALETTE[2],
  mobius: PALETTE[3],
  kleinBottle: PALETTE[4],
};

export function colorFor(key: string, i = 0): string {
  return TOPOLOGY_COLORS[key] ?? PALETTE[i % PALETTE.length];
}

function esc(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function niceTicks(lo: number, hi: number, target = 5): number[] {
  if (!isFinite(lo) || !isFinite(hi) || lo === hi) {
    const c = isFinite(lo) ? lo : 0;
    return [c - 1, c, c + 1];
  }
  const span = hi - lo;
  const raw = span / target;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag;
  const start = Math.ceil(lo / step) * step;
  const ticks: number[] = [];
  for (let v = start; v <= hi + step * 1e-9; v += step) {
    ticks.push(Math.round(v / step) * step);
  }
  return ticks;
}

function fmtTick(v: number): string {
  if (Math.abs(v) < 1e-9) return '0';
  if (Math.abs(v) >= 100) return v.toFixed(0);
  if (Math.abs(v) >= 10) return v.toFixed(1).replace(/\.0$/, '');
  return v.toFixed(2).replace(/\.?0+$/, '');
}

function svgOpen(width: number, height: number, title: string): string {
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="Segoe UI, Helvetica, Arial, sans-serif">`,
    `<rect width="${width}" height="${height}" fill="#ffffff"/>`,
    `<text x="${width / 2}" y="22" text-anchor="middle" font-size="15" font-weight="600" fill="#222">${esc(title)}</text>`,
  ].join('\n');
}

function axisFrame(opts: {
  width: number;
  height: number;
  margin: { l: number; r: number; t: number; b: number };
  yLo: number;
  yHi: number;
  yLabel: string;
}): { y: (v: number) => number; ticks: number[] } {
  const { width, height, margin, yLo, yHi, yLabel } = opts;
  const plotW = width - margin.l - margin.r;
  const plotH = height - margin.t - margin.b;
  const y = (v: number) => margin.t + plotH - ((v - yLo) / (yHi - yLo)) * plotH;
  const ticks = niceTicks(yLo, yHi);
  const parts: string[] = [];
  for (const t of ticks) {
    const yy = y(t);
    parts.push(
      `<line x1="${margin.l}" x2="${width - margin.r}" y1="${yy.toFixed(1)}" y2="${yy.toFixed(1)}" stroke="#e6e6e6"/>`,
      `<text x="${margin.l - 6}" y="${(yy + 4).toFixed(1)}" text-anchor="end" font-size="11" fill="#555">${fmtTick(t)}</text>`,
    );
  }
  // zero line emphasised when it falls inside the domain
  if (yLo < 0 && yHi > 0) {
    const y0 = y(0);
    parts.push(
      `<line x1="${margin.l}" x2="${width - margin.r}" y1="${y0.toFixed(1)}" y2="${y0.toFixed(1)}" stroke="#888" stroke-width="1.2"/>`,
    );
  }
  parts.push(
    `<line x1="${margin.l}" x2="${margin.l}" y1="${margin.t}" y2="${height - margin.b}" stroke="#444"/>`,
    `<line x1="${margin.l}" x2="${width - margin.r}" y1="${height - margin.b}" y2="${height - margin.b}" stroke="#444"/>`,
    `<text x="14" y="${margin.t + plotH / 2}" text-anchor="middle" font-size="12" fill="#333" transform="rotate(-90 14 ${margin.t + plotH / 2})">${esc(yLabel)}</text>`,
  );
  frameAxis().parts = parts;
  return { y, ticks };
}

/** side-channel for the axis markup (kept off the public type) */
interface Frame {
  parts: string[];
}
function frameAxis(): Frame {
  return frameAxisState;
}
const frameAxisState: Frame = { parts: [] };

// ---- chart 1: bars with confidence-interval whiskers ----

export function barChartCI(opts: {
  title: string;
  labels: string[];
  means: number[];
  los: number[];
  his: number[];
  yLabel: string;
  colors?: string[];
  width?: number;
  height?: number;
}): string {
  const width = opts.width ?? 640;
  const height = opts.height ?? 340;
  const margin = { l: 56, r: 16, t: 40, b: 56 };
  const dataLo = Math.min(...opts.los, 0);
  const dataHi = Math.max(...opts.his, 0);
  const pad = (dataHi - dataLo) * 0.08 || 1;
  const { y } = axisFrame({
    width,
    height,
    margin,
    yLo: dataLo - pad,
    yHi: dataHi + pad,
    yLabel: opts.yLabel,
  });
  const axis = frameAxis().parts;
  const plotW = width - margin.l - margin.r;
  const n = opts.labels.length;
  const slot = plotW / n;
  const barW = Math.min(slot * 0.55, 72);
  const body: string[] = [];
  const y0 = y(0);
  for (let i = 0; i < n; i++) {
    const cx = margin.l + slot * (i + 0.5);
    const m = opts.means[i];
    const color = opts.colors?.[i] ?? colorFor(opts.labels[i], i);
    const barTop = Math.min(y(m), y0);
    const barH = Math.abs(y(m) - y0);
    body.push(
      `<rect x="${(cx - barW / 2).toFixed(1)}" y="${barTop.toFixed(1)}" width="${barW.toFixed(1)}" height="${Math.max(1, barH).toFixed(1)}" fill="${color}" opacity="0.9" rx="3"/>`,
      `<line x1="${cx.toFixed(1)}" x2="${cx.toFixed(1)}" y1="${y(opts.los[i]).toFixed(1)}" y2="${y(opts.his[i]).toFixed(1)}" stroke="#333" stroke-width="1.5"/>`,
      `<line x1="${(cx - barW * 0.22).toFixed(1)}" x2="${(cx + barW * 0.22).toFixed(1)}" y1="${y(opts.los[i]).toFixed(1)}" y2="${y(opts.los[i]).toFixed(1)}" stroke="#333" stroke-width="1.5"/>`,
      `<line x1="${(cx - barW * 0.22).toFixed(1)}" x2="${(cx + barW * 0.22).toFixed(1)}" y1="${y(opts.his[i]).toFixed(1)}" y2="${y(opts.his[i]).toFixed(1)}" stroke="#333" stroke-width="1.5"/>`,
      `<text x="${cx.toFixed(1)}" y="${(Math.min(y(m), y(opts.his[i])) - 6).toFixed(1)}" text-anchor="middle" font-size="11" font-weight="600" fill="#333">${fmtTick(m)}</text>`,
      `<text x="${cx.toFixed(1)}" y="${height - margin.b + 16}" text-anchor="middle" font-size="12" fill="#333">${esc(opts.labels[i])}</text>`,
    );
  }
  return [svgOpen(width, height, opts.title), ...axis, ...body, '</svg>'].join('\n');
}

// ---- chart 2: box plots (Tukey) ----

export function boxPlot(opts: {
  title: string;
  labels: string[];
  series: number[][];
  yLabel: string;
  colors?: string[];
  width?: number;
  height?: number;
}): string {
  const width = opts.width ?? 640;
  const height = opts.height ?? 360;
  const margin = { l: 56, r: 16, t: 40, b: 56 };
  const all = opts.series.flat();
  const dataLo = Math.min(...all, 0);
  const dataHi = Math.max(...all, 0);
  const pad = (dataHi - dataLo) * 0.08 || 1;
  const { y } = axisFrame({
    width,
    height,
    margin,
    yLo: dataLo - pad,
    yHi: dataHi + pad,
    yLabel: opts.yLabel,
  });
  const axis = frameAxis().parts;
  const plotW = width - margin.l - margin.r;
  const n = opts.labels.length;
  const slot = plotW / n;
  const boxW = Math.min(slot * 0.5, 64);
  const body: string[] = [];
  for (let i = 0; i < n; i++) {
    const xs = opts.series[i];
    const cx = margin.l + slot * (i + 0.5);
    const q1 = quantileOf(xs, 0.25);
    const med = quantileOf(xs, 0.5);
    const q3 = quantileOf(xs, 0.75);
    const iqr = q3 - q1;
    const loFence = q1 - 1.5 * iqr;
    const hiFence = q3 + 1.5 * iqr;
    const inliers = xs.filter((v) => v >= loFence && v <= hiFence);
    const outliers = xs.filter((v) => v < loFence || v > hiFence);
    const wLo = Math.min(...inliers);
    const wHi = Math.max(...inliers);
    const color = opts.colors?.[i] ?? colorFor(opts.labels[i], i);
    body.push(
      `<line x1="${cx.toFixed(1)}" x2="${cx.toFixed(1)}" y1="${y(wLo).toFixed(1)}" y2="${y(q1).toFixed(1)}" stroke="#555" stroke-width="1.4"/>`,
      `<line x1="${cx.toFixed(1)}" x2="${cx.toFixed(1)}" y1="${y(q3).toFixed(1)}" y2="${y(wHi).toFixed(1)}" stroke="#555" stroke-width="1.4"/>`,
      `<line x1="${(cx - boxW * 0.3).toFixed(1)}" x2="${(cx + boxW * 0.3).toFixed(1)}" y1="${y(wLo).toFixed(1)}" y2="${y(wLo).toFixed(1)}" stroke="#555" stroke-width="1.4"/>`,
      `<line x1="${(cx - boxW * 0.3).toFixed(1)}" x2="${cx + boxW * 0.3}" y1="${y(wHi).toFixed(1)}" y2="${y(wHi).toFixed(1)}" stroke="#555" stroke-width="1.4"/>`,
      `<rect x="${(cx - boxW / 2).toFixed(1)}" y="${y(q3).toFixed(1)}" width="${boxW.toFixed(1)}" height="${Math.max(1, y(q1) - y(q3)).toFixed(1)}" fill="${color}" opacity="0.85" stroke="#333" stroke-width="1" rx="2"/>`,
      `<line x1="${(cx - boxW / 2).toFixed(1)}" x2="${(cx + boxW / 2).toFixed(1)}" y1="${y(med).toFixed(1)}" y2="${y(med).toFixed(1)}" stroke="#222" stroke-width="2"/>`,
      `<text x="${cx.toFixed(1)}" y="${height - margin.b + 16}" text-anchor="middle" font-size="12" fill="#333">${esc(opts.labels[i])}</text>`,
    );
    for (const o of outliers) {
      body.push(
        `<circle cx="${cx.toFixed(1)}" cy="${y(o).toFixed(1)}" r="2.6" fill="none" stroke="#c33"/>`,
      );
    }
    body.push(
      `<text x="${cx.toFixed(1)}" y="${(y(wHi) - 6).toFixed(1)}" text-anchor="middle" font-size="10" fill="#666">n=${xs.length}</text>`,
    );
  }
  return [svgOpen(width, height, opts.title), ...axis, ...body, '</svg>'].join('\n');
}

function quantileOf(xs: number[], q: number): number {
  const s = [...xs].sort((a, b) => a - b);
  if (s.length === 1) return s[0];
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}

// ---- chart 3: heatmap (diverging) ----

export function heatmap(opts: {
  title: string;
  rowLabels: string[];
  colLabels: string[];
  values: (number | null)[][];
  colorDomain: number; // symmetric |v| domain
  valueFmt?: (v: number) => string;
  width?: number;
  height?: number;
  rowGroupLabels?: string[];
  colGroupLabels?: string[];
}): string {
  const width = opts.width ?? 640;
  const height = opts.height ?? 300;
  const margin = { l: 96, r: 16, t: 64, b: 36 };
  const rows = opts.rowLabels.length;
  const cols = opts.colLabels.length;
  const cellW = (width - margin.l - margin.r) / cols;
  const cellH = (height - margin.t - margin.b) / rows;
  const body: string[] = [];
  const D = opts.colorDomain || 1;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const v = opts.values[r]?.[c] ?? null;
      const fill = v === null ? '#f2f2f2' : diverge(v / D);
      const x = margin.l + c * cellW;
      const yTop = margin.t + r * cellH;
      body.push(
        `<rect x="${x.toFixed(1)}" y="${yTop.toFixed(1)}" width="${(cellW - 2).toFixed(1)}" height="${(cellH - 2).toFixed(1)}" fill="${fill}" rx="2"/>`,
      );
      if (v !== null) {
        const label = opts.valueFmt ? opts.valueFmt(v) : fmtTick(v);
        const lum = Math.abs(v / D) > 0.55 ? '#fff' : '#333';
        body.push(
          `<text x="${(x + cellW / 2 - 1).toFixed(1)}" y="${(yTop + cellH / 2 + 4).toFixed(1)}" text-anchor="middle" font-size="11" fill="${lum}">${esc(label)}</text>`,
        );
      }
    }
    body.push(
      `<text x="${margin.l - 8}" y="${(margin.t + r * cellH + cellH / 2 + 4).toFixed(1)}" text-anchor="end" font-size="12" fill="#333">${esc(opts.rowLabels[r])}</text>`,
    );
    if (opts.rowGroupLabels?.[r]) {
      body.push(
        `<text x="8" y="${(margin.t + r * cellH + cellH / 2 + 4).toFixed(1)}" text-anchor="start" font-size="10" font-weight="600" fill="#888">${esc(opts.rowGroupLabels[r])}</text>`,
      );
    }
  }
  for (let c = 0; c < cols; c++) {
    body.push(
      `<text x="${(margin.l + c * cellW + cellW / 2).toFixed(1)}" y="${height - 14}" text-anchor="middle" font-size="10" fill="#444">${esc(opts.colLabels[c])}</text>`,
    );
    if (opts.colGroupLabels?.[c]) {
      body.push(
        `<text x="${(margin.l + c * cellW + cellW / 2).toFixed(1)}" y="${margin.t - 8}" text-anchor="middle" font-size="10" font-weight="600" fill="#888">${esc(opts.colGroupLabels[c])}</text>`,
      );
    }
  }
  return [svgOpen(width, height, opts.title), ...body, '</svg>'].join('\n');
}

/** diverging ramp: blue (negative) → white (0) → green (positive) */
function diverge(t: number): string {
  const clamped = Math.max(-1, Math.min(1, t));
  const neg = [70, 120, 180];
  const mid = [248, 248, 248];
  const pos = [66, 150, 90];
  const mix = (a: number[], b: number[], u: number): string => {
    const rgb = a.map((v, i) => Math.round(v + (b[i] - v) * u));
    return `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
  };
  return clamped < 0
    ? mix(mid, neg, Math.abs(clamped))
    : mix(mid, pos, clamped);
}
