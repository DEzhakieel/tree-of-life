/**
 * Emergence-radar report: runs the WASM world, reads it through the shared
 * primitive detectors (packages/shared/src/emergenceRadar.ts) into the L0..L10
 * capability ladder, and validates every detector by ablation.
 *
 * The scientific contract is the ablation step, not the score: a level is only
 * reported as a real capability if removing its enabling faculty collapses the
 * detector on the very same world. Faculties with no confirmed removal path yet
 * are marked `pending` and keep the report non-strict.
 *
 * Outputs (research/output/): radar.md (narrative), radar.json + radar.csv
 * (machine-readable), plots/radar.svg (level ladder + novelty).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  LEVELS,
  radarSeries,
  summarizeRadar,
  type EnvironmentPreset,
  type LevelId,
  type LevelStatus,
  type RadarPoint,
  type RadarSample,
  type RadarSummary,
  type WorldTopology,
} from '@fractal-life/shared';
import { makeWorld } from './scenarios.js';
import { runWasmRadar, type WasmBrainConfig, type WasmWorldStoch, type WasmRunSpec } from './wasmHarness.js';

export const RADAR_SEEDS = ['radar.s1', 'radar.s2', 'radar.s3'];
export const RADAR_SPAWN = 50;
export const RADAR_TICKS = 300;
export const RADAR_SAMPLE_EVERY = 10;
export const RADAR_OVERRIDES = { foodRegenRate: 0.003, metabolismBase: 0.5, energyCapacity: 150 };
export const RADAR_BRAIN: WasmBrainConfig = { enabled: true, learn: 'backprop' };
/** a detector must fall by at least this much when its faculty is removed */
export const RADAR_MARGIN = 0.25;

export interface RadarSpec {
  spawn: number;
  ticks: number;
  sampleEvery: number;
  brain: WasmBrainConfig | null;
  worldStoch: WasmWorldStoch | null;
  overrides: Record<string, number>;
  environment?: EnvironmentPreset;
  topology?: WorldTopology;
  /** Phase D communication-channel gain (absent = 1); 0 closes signalling. */
  signalDeposit?: number;
  /** Phase D cultural-transmission rate (absent = 1); 0 freezes memes. */
  memeCopyRate?: number;
  /** opt-in discovery/curiosity subsystem (drives the novelty primitive) */
  discovery?: boolean;
  /** reproduction master switch (absent = true); false forbids division. */
  reproduction?: boolean;
  /** sensorimotor master switch (absent = true); false freezes movement. */
  sensing?: boolean;
}

export function baselineSpec(ticks = RADAR_TICKS, spawn = RADAR_SPAWN): RadarSpec {
  return {
    spawn,
    ticks,
    sampleEvery: RADAR_SAMPLE_EVERY,
    brain: RADAR_BRAIN,
    worldStoch: null,
    overrides: { ...RADAR_OVERRIDES },
    environment: 'calm',
    topology: 'torus',
    discovery: true,
  };
}

// ---------------------------------------------------------------------------
// Ablation registry — faculty removal transforms. A level with no wired
// transform is reported `pending` and blocks --strict until it is added.
// ---------------------------------------------------------------------------

export interface Ablation {
  key: string;
  label: string;
  transform?: (base: RadarSpec) => RadarSpec;
}

export const ABLATIONS: Record<string, Ablation> = {
  world: {
    key: 'world',
    label: 'no world matter flux (spawn 0, no food regen, uniform inert terrain, no environment)',
    transform: (b) => ({
      ...b,
      spawn: 0,
      environment: undefined,
      overrides: { ...b.overrides, foodRegenRate: 0, centerX: 1e9 },
    }),
  },
  spawn: {
    key: 'spawn',
    label: 'no agents spawned',
    transform: (b) => ({ ...b, spawn: 0 }),
  },
  reflex: {
    key: 'reflex',
    label: 'sensorimotor loop disabled (agents hold position, no feedback)',
    transform: (b) => ({ ...b, sensing: false }),
  },
  brain: {
    key: 'brain',
    label: 'learning disabled (brain off)',
    transform: (b) => ({ ...b, brain: { enabled: false } }),
  },
  monoculture: {
    key: 'monoculture',
    label: 'single founder (no ecological richness)',
    transform: (b) => ({ ...b, spawn: 1 }),
  },
  'group-scaling': {
    key: 'group-scaling',
    label: 'tiny group (no collective scaling)',
    transform: (b) => ({ ...b, spawn: 3 }),
  },
  clonal: {
    key: 'clonal',
    label: 'single founder clone (no heritable variation)',
    transform: (b) => ({ ...b, spawn: 1 }),
  },
  'no-birth': {
    key: 'no-birth',
    label: 'reproduction disabled (no offspring)',
    transform: (b) => ({ ...b, reproduction: false }),
  },
  'signal-zero': {
    key: 'signal-zero',
    label: 'signal deposit 0 (closed communication channel)',
    transform: (b) => ({ ...b, signalDeposit: 0 }),
  },
  'meme-zero': {
    key: 'meme-zero',
    label: 'meme copy rate 0 (culture transmission frozen)',
    transform: (b) => ({ ...b, memeCopyRate: 0 }),
  },
  'open-ended': {
    key: 'open-ended',
    label: 'open-ended novelty off (discovery off + frozen uniform environment)',
    transform: (b) => ({ ...b, discovery: false, environment: undefined, overrides: { ...b.overrides, centerX: 1e9 } }),
  },
};

// ---------------------------------------------------------------------------
// Runs
// ---------------------------------------------------------------------------

export interface RadarRun {
  seed: string;
  points: RadarPoint[];
  summary: RadarSummary;
}

export function runRadar(seed: string, spec: RadarSpec): RadarRun {
  const world = makeWorld(seed, spec.spawn, spec.overrides, spec.environment, spec.topology);
  if (spec.signalDeposit !== undefined) world.signalDeposit = spec.signalDeposit;
  if (spec.memeCopyRate !== undefined) world.memeCopyRate = spec.memeCopyRate;
  if (spec.discovery !== undefined) world.discovery = spec.discovery;
  if (spec.reproduction !== undefined) world.reproduction = spec.reproduction;
  if (spec.sensing !== undefined) world.sensing = spec.sensing;
  const runSpec: WasmRunSpec = { config: world, brain: spec.brain, worldStoch: spec.worldStoch };
  const { samples } = runWasmRadar({ ...runSpec, ticks: spec.ticks, sampleEvery: spec.sampleEvery });
  const points = radarSeries(samples as readonly RadarSample[]);
  return { seed, points, summary: summarizeRadar(points) };
}

export interface DetectorVerdict {
  id: LevelId;
  name: string;
  ablation: string;
  ablationLabel: string;
  /** false when the ablation faculty has no wired removal path yet */
  wired: boolean;
  validated: boolean;
  baselinePeak: number;
  ablatedPeak: number;
  drop: number;
}

/** a detector is validated only when the baseline genuinely lights it AND the
 *  faculty removal genuinely collapses it. */
export function validateDetector(baselinePeak: number, ablatedPeak: number): boolean {
  return baselinePeak >= 0.6 && baselinePeak - ablatedPeak >= RADAR_MARGIN;
}

export interface RadarReport {
  seeds: string[];
  ticks: number;
  spawn: number;
  sampleEvery: number;
  baseline: RadarRun[];
  verdicts: DetectorVerdict[];
  /** every detector ablation-validated */
  pass: boolean;
}

export interface RunRadarReportOptions {
  seeds?: string[];
  ticks?: number;
  spawn?: number;
}

export function runRadarReport(opts: RunRadarReportOptions = {}): RadarReport {
  const seeds = opts.seeds ?? RADAR_SEEDS;
  const base = baselineSpec(opts.ticks ?? RADAR_TICKS, opts.spawn ?? RADAR_SPAWN);
  const baseline = seeds.map((seed) => runRadar(seed, base));

  const ablatedCache = new Map<string, Map<string, RadarRun>>();
  const runAblated = (key: string, seed: string): RadarRun | null => {
    const ab = ABLATIONS[key];
    if (!ab?.transform) return null;
    let perSeed = ablatedCache.get(key);
    if (!perSeed) {
      perSeed = new Map();
      ablatedCache.set(key, perSeed);
    }
    let run = perSeed.get(seed);
    if (!run) {
      run = runRadar(seed, ab.transform(base));
      perSeed.set(seed, run);
    }
    return run;
  };

  const mean = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

  const verdicts: DetectorVerdict[] = LEVELS.map((def) => {
    const ab = ABLATIONS[def.ablation]!;
    const basePeaks = baseline.map((r) => r.summary.levels[def.index]!.peakScore);
    const baselinePeak = mean(basePeaks);
    if (!ab.transform) {
      return {
        id: def.id,
        name: def.name,
        ablation: def.ablation,
        ablationLabel: ab.label,
        wired: false,
        validated: false,
        baselinePeak,
        ablatedPeak: Number.NaN,
        drop: Number.NaN,
      };
    }
    const ablPeaks = seeds.map((seed) => runAblated(def.ablation, seed)!.summary.levels[def.index]!.peakScore);
    const ablatedPeak = mean(ablPeaks);
    return {
      id: def.id,
      name: def.name,
      ablation: def.ablation,
      ablationLabel: ab.label,
      wired: true,
      validated: validateDetector(baselinePeak, ablatedPeak),
      baselinePeak,
      ablatedPeak,
      drop: baselinePeak - ablatedPeak,
    };
  });

  return {
    seeds,
    ticks: base.ticks,
    spawn: base.spawn,
    sampleEvery: base.sampleEvery,
    baseline,
    verdicts,
    pass: verdicts.every((v) => v.validated),
  };
}

// ---------------------------------------------------------------------------
// Renderers
// ---------------------------------------------------------------------------

const METHOD = [
  'Each level is a conjunction of first-principles primitives (matter flux, homeostasis,',
  'state->action feedback, within-lifetime memory, heredity, differential reproduction,',
  'copy fidelity, information transfer, non-genetic transmission, integration, novelty,',
  'richness), each primitive stretched min-max across THIS run\'s own envelope with a',
  'relative dead-sensor floor. Levels cross EMERGENT at score >= 0.6 with hysteresis',
  '(drop below 0.4 to fall). A level whose required substrate is absent reads DORMANT,',
  'not ABSENT. Scores are run-relative: compare onsets and shapes, not absolute values.',
  'A detector is accepted only if removing its enabling faculty (same world, same seeds)',
  'collapses its peak by >= ' + RADAR_MARGIN.toFixed(2) + ' from an EMERGENT baseline.',
].join('\n');

const STATUS_HEX: Record<LevelStatus, string> = {
  EMERGENT: '#34d399',
  PARTIAL: '#fbbf24',
  ABSENT: '#71717a',
  DORMANT: '#3f3f46',
};

function f(v: number, d = 3): string {
  return Number.isFinite(v) ? v.toFixed(d) : 'n/a';
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
}

export function renderRadarReport(report: RadarReport): { md: string; json: string; csv: string } {
  const md: string[] = [];
  md.push(`# emergence radar: ${report.seeds.join(', ')}`);
  md.push('');
  md.push(`${report.ticks} ticks, spawn ${report.spawn}, sample every ${report.sampleEvery} ticks, ${report.baseline.length} baseline run(s).`);
  md.push('');
  md.push(METHOD);
  md.push('');

  md.push('## level ladder (mean peak score over seeds)');
  md.push('');
  md.push('| level | capability | status (final) | onset t | peak | ablation | validated |');
  md.push('|---|---|---|---|---:|---|---|');
  for (const def of LEVELS) {
    const peaks = report.baseline.map((r) => r.summary.levels[def.index]!.peakScore);
    const onset = report.baseline.map((r) => r.summary.levels[def.index]!.onset).filter((t): t is number => t !== null);
    const statuses = report.baseline.map((r) => r.summary.levels[def.index]!.status);
    const v = report.verdicts[def.index]!;
    const onsetStr = onset.length ? String(Math.min(...onset)) : 'n/a';
    md.push(
      `| ${def.id} | ${def.name} | ${statuses.join('/')} | ${onsetStr} | ${f(meanNum(peaks))} | ${esc(def.ablation)} | ${
        v.validated ? 'yes' : v.wired ? 'NO (weak drop)' : 'pending'
      } |`,
    );
  }
  md.push('');

  md.push('## ablation validation');
  md.push('');
  md.push('| level | faculty removed | wired | baseline peak | ablated peak | drop | verdict |');
  md.push('|---|---|---|---:|---:|---:|---|');
  for (const v of report.verdicts) {
    md.push(
      `| ${v.id} | ${esc(v.ablationLabel)} | ${v.wired ? 'yes' : 'pending'} | ${f(v.baselinePeak)} | ${f(v.ablatedPeak)} | ${f(v.drop)} | ${
        v.validated ? 'VALIDATED' : v.wired ? 'rejected' : 'pending'
      } |`,
    );
  }
  md.push('');
  md.push(`strict: ${report.pass ? 'PASS — every detector ablation-validated' : 'FAIL — some detectors pending or rejected'}`);
  md.push('');

  const json =
    JSON.stringify(
      {
        seeds: report.seeds,
        ticks: report.ticks,
        spawn: report.spawn,
        sampleEvery: report.sampleEvery,
        pass: report.pass,
        baseline: report.baseline.map((r) => ({ seed: r.seed, summary: r.summary, points: r.points })),
        verdicts: report.verdicts,
      },
      null,
      2,
    ) + '\n';

  const csvRows: string[] = [
    'seed,level,name,status,onset,peak,finalScore',
    ...report.baseline.flatMap((r) =>
      LEVELS.map((def) => {
        const l = r.summary.levels[def.index]!;
        return [r.seed, def.id, def.name, l.status, l.onset ?? '', l.peakScore, l.finalScore].join(',');
      }),
    ),
  ];

  return { md: md.join('\n'), json, csv: csvRows.join('\n') };
}

function meanNum(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

export function renderRadarSvg(report: RadarReport): string {
  const w = 1040;
  const runs = report.baseline;
  const h = 150 + LEVELS.length * 30 + 120;
  const x0 = 210;
  const barW = 560;
  const parts: string[] = [];
  const run = runs[0]!;
  const ns = run.points.map((p) => p.novelty);

  parts.push(
    `<text x="24" y="40" fill="#e6edf3" font-family="monospace" font-size="15">emergence radar: ${esc(report.seeds.join(', '))}</text>`,
    `<text x="24" y="60" fill="#8b949e" font-family="monospace" font-size="11">${report.ticks} ticks, spawn ${report.spawn} · seed ${esc(run.seed)} · run-relative scores, hysteresis on>=0.6 / off<0.4</text>`,
  );

  LEVELS.forEach((def, i) => {
    const l = run.summary.levels[def.index]!;
    const y = 96 + i * 30;
    const bw = Math.max(0, Math.min(1, l.peakScore)) * barW;
    parts.push(
      `<text x="24" y="${y + 4}" fill="#e6edf3" font-family="monospace" font-size="11">${def.id} ${esc(def.name)}</text>`,
      `<rect x="${x0}" y="${y - 9}" width="${barW}" height="14" fill="#1b2027"/>`,
      `<rect x="${x0}" y="${y - 9}" width="${bw.toFixed(1)}" height="14" fill="${STATUS_HEX[l.status]}"/>`,
      `<text x="${x0 + bw + 8}" y="${y + 3}" fill="#8b949e" font-family="monospace" font-size="10">${l.status} peak ${l.peakScore.toFixed(2)}${l.onset !== null ? ' · onset t' + l.onset : ''}</text>`,
    );
  });

  // novelty sparkline
  const ny = 112 + LEVELS.length * 30;
  parts.push(
    `<text x="24" y="${ny}" fill="#e6edf3" font-family="monospace" font-size="12">novelty residual (change surprisal)</text>`,
  );
  if (ns.length > 1) {
    const peak = Math.max(1e-9, ...ns);
    const line = ns
      .map((v, i) => `${(x0 + (i / (ns.length - 1)) * barW).toFixed(1)},${(ny + 60 - (v / peak) * 50).toFixed(1)}`)
      .join(' ');
    parts.push(`<polyline points="${line}" fill="none" stroke="#c084fc" stroke-width="1.4"/>`);
    parts.push(
      `<text x="${x0}" y="${ny + 76}" fill="#71717a" font-family="monospace" font-size="10">0</text>`,
      `<text x="${x0 + barW}" y="${ny + 76}" fill="#71717a" font-family="monospace" font-size="10" text-anchor="end">t${run.points[ns.length - 1]!.tick}</text>`,
    );
  }

  let ly = ny + 96;
  parts.push(`<text x="24" y="${ly}" fill="#8b949e" font-family="monospace" font-size="10">ablation validation (mean peak across seeds):</text>`);
  ly += 16;
  for (const v of report.verdicts) {
    if (v.wired) {
      parts.push(
        `<text x="24" y="${ly}" fill="#8b949e" font-family="monospace" font-size="10">${v.id} ${v.validated ? 'VALID' : 'reject'} · ${esc(v.ablationLabel)} · peak ${v.baselinePeak.toFixed(2)} -> ${Number.isFinite(v.ablatedPeak) ? v.ablatedPeak.toFixed(2) : 'n/a'} (drop ${Number.isFinite(v.drop) ? v.drop.toFixed(2) : 'n/a'})</text>`,
      );
    } else {
      parts.push(`<text x="24" y="${ly}" fill="#52525b" font-family="monospace" font-size="10">${v.id} pending · ${esc(v.ablationLabel)}</text>`);
    }
    ly += 13;
  }

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`,
    `<rect width="${w}" height="${h}" fill="#0e1116"/>`,
    ...parts,
    '</svg>',
  ].join('\n');
}

export function writeRadarReport(report: RadarReport): string {
  const dir = join(fileURLToPath(new URL('.', import.meta.url)), '../../research/output');
  mkdirSync(dir, { recursive: true });
  mkdirSync(join(dir, 'plots'), { recursive: true });
  const { md, json, csv } = renderRadarReport(report);
  writeFileSync(join(dir, 'radar.md'), md);
  writeFileSync(join(dir, 'radar.json'), json);
  writeFileSync(join(dir, 'radar.csv'), csv);
  writeFileSync(join(dir, 'plots', 'radar.svg'), renderRadarSvg(report));
  return dir;
}
