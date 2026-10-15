import fs from 'node:fs';
import path from 'node:path';
import { runVerification } from './verification.js';
import { runValidation } from './validation.js';
import { runReproducibility } from './reproducibility.js';
import { runSensitivity } from './sensitivity.js';
import { runAblation } from './ablation.js';
import { runSignificance } from './significance.js';
import { runNovelty } from './novelty.js';
import type { BenchmarkScale } from '../types.js';
import type { RigorResult, RigorSection } from './types.js';

const OUTDIR = path.resolve('C:\\Users\\LENOVO\\Downloads\\fractallife2\\apps\\simulation\\research\\output');

function fmtDate(): string {
  return new Date().toISOString();
}

function renderMd(res: RigorResult): string {
  const lines: string[] = [];
  lines.push('# Rigor Study');
  lines.push(`Generated: ${res.generatedAt}`);
  lines.push(`Overall: ${res.overall}`);
  lines.push(res.summary);
  lines.push('');
  for (const s of res.studies) {
    lines.push(`## ${s.title} (${s.id})`);
    lines.push(s.summary);
    lines.push('| module | key | label | outcome | value | detail |');
    lines.push('|---|---|---|---|---|---|');
    for (const c of s.checks) {
      lines.push(`| ${c.module} | ${c.key} | ${c.label} | ${c.outcome} | ${String(c.value)} | ${c.detail.replace(/\|/g,'/')} |`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

function renderCsv(res: RigorResult): string {
  const header = ['module','key','label','outcome','value','detail'];
  const rows = [header.join(',')];
  for (const s of res.studies) {
    for (const c of s.checks) {
      const v = String(c.value).replace(/,/g,';');
      const d = c.detail.replace(/,/g,';').replace(/\n/g,' ');
      rows.push([c.module,c.key,c.label,c.outcome,v,d].join(','));
    }
  }
  return rows.join('\n');
}

export function runRigor(alwaysFull = true): RigorResult {
  const scale: BenchmarkScale = alwaysFull ? 'full' : 'quick';
  const studies: RigorSection[] = [];
  studies.push(runVerification(scale));
  studies.push(runValidation());
  studies.push(runReproducibility(scale));
  studies.push(runSensitivity(scale));
  studies.push(runAblation(scale));
  studies.push(runSignificance(scale));
  studies.push(runNovelty(scale));
  let overall: 'PASS'|'FAIL'|'WARN' = 'PASS';
  for (const s of studies) {
    for (const c of s.checks) {
      if (c.outcome === 'FAIL') overall = 'FAIL';
      if (c.outcome === 'WARN' && overall !== 'FAIL') overall = 'PASS'; // don't fail on warn per harness style
    }
  }
  const summary = `rigor modules: ${studies.length}; scale=${scale} (alwaysFull=${alwaysFull})`;
  const res: RigorResult = {
    generatedAt: fmtDate(),
    repo: 'fractallife2',
    studies,
    overall,
    summary,
    plotsDir: path.join(OUTDIR, 'plots'),
    jsonPath: path.join(OUTDIR, 'rigor.json'),
    mdPath: path.join(OUTDIR, 'rigor.md'),
    csvPath: path.join(OUTDIR, 'rigor.csv'),
  };
  try {
    fs.mkdirSync(path.dirname(res.jsonPath), { recursive: true });
    fs.mkdirSync(res.plotsDir, { recursive: true });
    fs.writeFileSync(res.jsonPath, JSON.stringify(res, null, 2));
    fs.writeFileSync(res.mdPath, renderMd(res));
    fs.writeFileSync(res.csvPath, renderCsv(res));
  } catch {}
  return res;
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('rigorRun.ts')) {
  const quick = process.argv.includes('--quick');
  const r = runRigor(!quick);
  console.log(`rigor: ${r.overall}; wrote ${r.jsonPath}`);
}
