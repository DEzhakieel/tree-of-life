/**
 * Life-organization research runner.
 *
 * Drives the TS reference engine, samples the full `SimStats` row every N ticks
 * and feeds that stream through the shared organization detector
 * (`lifeOrganization.ts`) to map O0 subatomic → O9 organism.
 *
 * Two arms are run so the effect of the opt-in substrates is visible and honest:
 *
 *   - `legacy`: only the always-on layers (chemistry, DNA, cell, trophic). The
 *     Phase E–I omics fields are switched off and must read DORMANT, not zero.
 *   - `full`:   cellBio + biophysics + molecular-omics (+ stochastic +
 *     combinatorial) are switched on, wiring the subatomic / organellar /
 *     organ-system rungs.
 *
 * Writes research/output/lifeorg.{md,json,csv} and plots/lifeorg.svg.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import {
  LIFE_LEVELS,
  lifeSeries,
  summarizeLife,
  type LifePoint,
  type LifeRaw,
  type LifeSummary,
  type LifeStatus,
} from '@fractal-life/shared';
import { Engine } from '../engine.js';
import { makeWorld } from './scenarios.js';

export const LIFE_SEEDS = ['life.o1', 'life.o2', 'life.o3'];
export const LIFE_SPAWN = 60;
export const LIFE_TICKS = 400;
export const LIFE_SAMPLE_EVERY = 10;
export const LIFE_MAX_POP = 300;
export const LIFE_OVERRIDES = { foodRegenRate: 0.003, metabolismBase: 0.5, energyCapacity: 150 };
export const LIFE_BRAIN = { enabled: true, learn: 'backprop' } as const;

export type LifeProfile = 'legacy' | 'full';

export interface LifeRunOptions {
  seed: string;
  ticks: number;
  spawn: number;
  sampleEvery: number;
  profile: LifeProfile;
}

export interface LifeRun {
  seed: string;
  profile: LifeProfile;
  summary: LifeSummary;
  points: LifePoint[];
}

export interface LifeReport {
  seeds: string[];
  ticks: number;
  spawn: number;
  sampleEvery: number;
  runs: LifeRun[];
}

function makeLifeWorld(seed: string, spawn: number, profile: LifeProfile) {
  const world = makeWorld(seed, spawn, { ...LIFE_OVERRIDES, maxPopulation: LIFE_MAX_POP });
  if (profile === 'full') {
    world.cellBio = true;
    world.biophysics = true;
    world.omics = true;
    world.omicsStochastic = true;
    world.combinatorial = true;
  }
  return world;
}

/** Run one world and turn its `SimStats` stream into an organization ladder. */
export function runLifeRun(opts: LifeRunOptions): LifeRun {
  const engine = new Engine(makeLifeWorld(opts.seed, opts.spawn, opts.profile));
  engine.setBrainConfig({ ...LIFE_BRAIN });

  const raws: LifeRaw[] = [];
  for (let tick = 1; tick <= opts.ticks; tick++) {
    const stats = engine.tick().stats;
    if (tick % opts.sampleEvery === 0) raws.push({ tick, stats });
  }

  const points = lifeSeries(raws);
  return { seed: opts.seed, profile: opts.profile, summary: summarizeLife(points), points };
}

export function runLifeReport(opts: {
  seeds: string[];
  ticks: number;
  spawn: number;
  sampleEvery?: number;
}): LifeReport {
  const sampleEvery = opts.sampleEvery ?? LIFE_SAMPLE_EVERY;
  const runs: LifeRun[] = [];
  for (const seed of opts.seeds) {
    for (const profile of ['legacy', 'full'] as const) {
      runs.push(runLifeRun({ seed, profile, ticks: opts.ticks, spawn: opts.spawn, sampleEvery }));
    }
  }
  return { seeds: opts.seeds, ticks: opts.ticks, spawn: opts.spawn, sampleEvery, runs };
}

// ---------------------------------------------------------------------------

const STATUS_HEX: Record<LifeStatus, string> = {
  EMERGENT: '#34d399',
  PARTIAL: '#fbbf24',
  ABSENT: '#71717a',
  DORMANT: '#3f3f46',
};

const METHOD = [
  'Each level is a pure composition of measured `SimStats` observables (never an',
  'engine self-flag). Observables are min-max stretched across the run; a level',
  'turns EMERGENT when its mean stretched score crosses 0.6 and stays until it',
  'falls below 0.4 (hysteresis). A channel that is all-zero across the whole run',
  '(its subsystem is switched off) is excluded, and a level with < 25% of its',
  'channels wired reads DORMANT — the substrate for that scale was never assayed,',
  'so a zero is not reported as a failure.',
].join('\n');

// The TS reference engine (which this runner drives) hard-zeros the mesoscale-
// biophysics observables (orgIndex / clusterOrder / rotationalOrder / meanForce)
// and the discovery observables exactly as it zeros the novelty observables the
// radar works around; those channels are WASM-only. The `coverage` column makes
// this visible rather than hiding it.
const SUBSTRATE_NOTE = [
  '**Substrate note.** This runner drives the TS *reference* engine, which leaves',
  'the mesoscale-biophysics observables (`orgIndex`, `clusterOrder`,',
  '`rotationalOrder`, `meanForce`) and the discovery/novelty observables at zero —',
  'they are wired only in the Rust/WASM engine. Consequently O7 (organ) is assayed',
  'here through its omics `metabolicRate` channel alone (coverage 0.25); the WASM',
  'engine would flesh it out. Low coverage is reported, not smoothed over.',
].join('\n');

function f(v: number, d = 3): string {
  return Number.isFinite(v) ? v.toFixed(d) : 'n/a';
}

function meanNum(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
}

function runsFor(report: LifeReport, profile: LifeProfile): LifeRun[] {
  return report.runs.filter((r) => r.profile === profile);
}

export function renderLifeReport(report: LifeReport): { md: string; json: string; csv: string } {
  const md: string[] = [];
  md.push(`# life-organization ladder: ${report.seeds.join(', ')}`);
  md.push('');
  md.push(
    `${report.ticks} ticks, spawn ${report.spawn}, sample every ${report.sampleEvery} ticks, ${report.runs.length} run(s).`,
  );
  md.push('');
  md.push(METHOD);
  md.push('');
  md.push(SUBSTRATE_NOTE);
  md.push('');

  for (const profile of ['legacy', 'full'] as const) {
    const runs = runsFor(report, profile);
    md.push(`## ladder — ${profile} arm`);
    md.push('');
    md.push('| level | organization | scale | status | onset t | peak | coverage |');
    md.push('|---|---|---|---|---:|---:|---:|');
    for (const def of LIFE_LEVELS) {
      const peaks = runs.map((r) => r.summary.levels[def.index].peakScore);
      const cov = runs.map((r) => r.summary.levels[def.index].coverage);
      const onset = runs
        .map((r) => r.summary.levels[def.index].onset)
        .filter((t): t is number => t !== null);
      const statuses = runs.map((r) => r.summary.levels[def.index].status);
      const onsetStr = onset.length ? String(Math.min(...onset)) : 'n/a';
      md.push(
        `| ${def.id} | ${def.name} | ${def.scale} | ${statuses.join('/')} | ${onsetStr} | ${f(
          meanNum(peaks),
        )} | ${f(meanNum(cov), 2)} |`,
      );
    }
    for (const r of runs) {
      md.push('');
      md.push(`- ${r.seed}: ceiling ${r.summary.ceiling ?? '-'}, dominant ${r.summary.dominant ?? '-'}`);
    }
    md.push('');
  }

  const json =
    JSON.stringify(
      {
        seeds: report.seeds,
        ticks: report.ticks,
        spawn: report.spawn,
        sampleEvery: report.sampleEvery,
        runs: report.runs.map((r) => ({ seed: r.seed, profile: r.profile, summary: r.summary, points: r.points })),
      },
      null,
      2,
    ) + '\n';

  const csvRows: string[] = ['seed,profile,level,name,status,onset,peak,finalScore,coverage'];
  for (const r of report.runs) {
    for (const def of LIFE_LEVELS) {
      const l = r.summary.levels[def.index];
      csvRows.push(
        [r.seed, r.profile, def.id, def.name, l.status, l.onset ?? '', l.peakScore, l.finalScore, l.coverage].join(','),
      );
    }
  }

  return { md: md.join('\n'), json, csv: csvRows.join('\n') };
}

export function renderLifeSvg(report: LifeReport): string {
  const w = 1040;
  const rowH = 30;
  const h = 150 + LIFE_LEVELS.length * rowH + 60;
  const x0 = 250;
  const barW = 300;
  const parts: string[] = [];

  parts.push(
    `<text x="24" y="40" fill="#e6edf3" font-family="monospace" font-size="15">life-organization ladder: ${esc(
      report.seeds.join(', '),
    )}</text>`,
    `<text x="24" y="60" fill="#8b949e" font-family="monospace" font-size="11">${report.ticks} ticks, spawn ${report.spawn} · mean peak over seeds · legacy vs full substrate · on>=0.6 / off<0.4</text>`,
    `<text x="${x0}" y="86" fill="#8b949e" font-family="monospace" font-size="11">legacy</text>`,
    `<text x="${x0 + barW + 40}" y="86" fill="#8b949e" font-family="monospace" font-size="11">full</text>`,
  );

  LIFE_LEVELS.forEach((def, i) => {
    const y = 108 + i * rowH;
    parts.push(
      `<text x="24" y="${y + 4}" fill="#e6edf3" font-family="monospace" font-size="11">${def.id} ${esc(
        def.name,
      )}</text>`,
    );
    (['legacy', 'full'] as const).forEach((profile, k) => {
      const runs = runsFor(report, profile);
      const peaks = runs.map((r) => r.summary.levels[def.index].peakScore);
      const peak = meanNum(peaks);
      const status = runs[0]?.summary.levels[def.index].status ?? 'ABSENT';
      const x = x0 + k * (barW + 40);
      const bw = Math.max(0, Math.min(1, peak)) * barW;
      parts.push(
        `<rect x="${x}" y="${y - 9}" width="${barW}" height="14" fill="#1b2027"/>`,
        `<rect x="${x}" y="${y - 9}" width="${bw.toFixed(1)}" height="14" fill="${STATUS_HEX[status]}"/>`,
        `<text x="${x + barW + 8}" y="${y + 3}" fill="#8b949e" font-family="monospace" font-size="10">${status} ${peak.toFixed(2)}</text>`,
      );
    });
  });

  const ny = 108 + LIFE_LEVELS.length * rowH + 30;
  const run = report.runs[0];
  if (run && run.points.length > 1) {
    const ns = run.points.map((p) => p.novelty);
    const peak = Math.max(1e-9, ...ns);
    const line = ns
      .map((v, i) => `${(x0 + (i / (ns.length - 1)) * barW).toFixed(1)},${(ny + 40 - (v / peak) * 30).toFixed(1)}`)
      .join(' ');
    parts.push(
      `<text x="24" y="${ny}" fill="#8b949e" font-family="monospace" font-size="10">novelty (${esc(run.seed)})</text>`,
      `<polyline points="${line}" fill="none" stroke="#c084fc" stroke-width="1.4"/>`,
    );
  }

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`,
    `<rect width="${w}" height="${h}" fill="#0e1116"/>`,
    ...parts,
    '</svg>',
  ].join('\n');
}

export function writeLifeReport(report: LifeReport): string {
  const dir = join(fileURLToPath(new URL('.', import.meta.url)), '../../research/output');
  mkdirSync(dir, { recursive: true });
  mkdirSync(join(dir, 'plots'), { recursive: true });
  const { md, json, csv } = renderLifeReport(report);
  writeFileSync(join(dir, 'lifeorg.md'), md);
  writeFileSync(join(dir, 'lifeorg.json'), json);
  writeFileSync(join(dir, 'lifeorg.csv'), csv);
  writeFileSync(join(dir, 'plots', 'lifeorg.svg'), renderLifeSvg(report));
  return dir;
}
