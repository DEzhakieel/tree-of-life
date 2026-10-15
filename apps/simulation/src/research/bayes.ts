import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pairedT, welch, twoProportionZ, mean, summarize, type PairedResult, type WelchResult } from './statistics.js';

/**
 * Bayesian hypothesis ledger for the Phase-M research program.
 *
 * Method
 *  - Every claim is a hypothesis with a prior probability (default 0.5).
 *  - Each independent dataset contributes at most one likelihood-ratio update
 *    via the Sellke–Berger–Pericchi *minimal* Bayes factor: for a two-sided
 *    p-value p < 1/e the smallest defensible Bayes factor in favor of the
 *    alternative is BF = 1 / (-e·p·ln p); larger p gives no support (BF = 1).
 *    This is the standard p-to-BF bound, so posteriors are CONSERVATIVE — they
 *    can never exceed what a p-value alone can justify.
 *  - Directional claims only update when the observed effect has the claimed
 *    sign; opposite-signed effects are recorded but credited as BF = 1 (we do
 *    not double-count evidence in the discussion of the opposite direction).
 *  - Recovery claims use an exact binomial likelihood ratio (chance θ = 0.5
 *    vs the observed-rate plug-in with a Beta(1,1)-regularized alternative).
 *  - Because the engine is deterministic, every "sample" is a different world
 *    (habitat / seed / biome), and the posterior describes belief about effects
 *    ACROSS worlds, not within-world noise.
 *
 * Sequential update / "bayes": the ledger file `hypotheses.json` stores which
 * evidence IDs each hypothesis has already absorbed. A re-run over the same
 * data is idempotent; when a NEW dataset appears, only the new evidence's
 * likelihood ratio multiplies the stored posterior (odds ×= BF), and the run
 * is appended to `history`. That is exact Bayesian sequential updating.
 */

const outputDir = fileURLToPath(new URL('../../research/output/', import.meta.url));
const plotsDir = join(outputDir, 'plots');
const ledgerPath = join(outputDir, 'hypotheses.json');

// ---- p → minimal Bayes factor (Sellke, Berger & Pericchi 2001) ----

export function sbpBF(p: number): number {
  const pp = Math.max(1e-16, Math.min(1, p));
  if (pp >= 1 / Math.E) return 1;
  return Math.min(1e6, 1 / (-Math.E * pp * Math.log(pp)));
}

function odds(prior: number): number {
  return prior / (1 - prior);
}

function fromOdds(o: number): number {
  return o / (1 + o);
}

// ---- CSV loading ----

interface CsvTable {
  header: string[];
  rows: Record<string, string>[];
}

function loadCsv(name: string): CsvTable {
  const text = readFileSync(join(outputDir, name), 'utf8').replace(/\r\n/g, '\n').trimEnd();
  const lines = text.split('\n');
  const header = lines[0]!.split(',');
  const rows = lines.slice(1).map((ln) => {
    const cells = ln.split(',');
    const rec: Record<string, string> = {};
    header.forEach((h, i) => (rec[h] = cells[i] ?? ''));
    return rec;
  });
  return { header, rows };
}

const num = (v: string | undefined): number => (v === undefined || v === '' ? Number.NaN : Number(v));

// ---- evidence plumbing ----

export interface Evidence {
  id: string;
  label: string;
  bf: number;
  /** compact quantitative detail for the ledger / markdown */
  detail: string;
}

/** Directional contrast evidence from a paired family (knob vs control per seed). */
function pairedEvidence(
  id: string,
  label: string,
  knobRows: Record<string, string>[],
  controlByRep: Map<string, number>,
  field: 'dPop' | 'alive' | 'births',
  expect: 'pos' | 'neg' | 'twosided',
): Evidence {
  const b: number[] = [];
  const a: number[] = [];
  for (const r of [...knobRows].sort((x, y) => x.rep!.localeCompare(y.rep!))) {
    const ctrl = controlByRep.get(r.rep!);
    if (ctrl === undefined) continue;
    a.push(num(r[field]));
    b.push(ctrl);
  }
  if (a.length === 0) {
    return { id, label, bf: 1, detail: 'no matched control rows; skipped' };
  }
  const pt: PairedResult = pairedT(a, b);
  const signOk = expect === 'twosided' || (expect === 'pos' && pt.meanDiff > 0) || (expect === 'neg' && pt.meanDiff < 0);
  const bf = expect === 'twosided' ? sbpBF(pt.p) : signOk ? sbpBF(pt.p) : 1;
  const dirNote = expect !== 'twosided' && !signOk ? ' (sign opposes claim → BF=1)' : '';
  return {
    id,
    label,
    bf,
    detail: `paired n=${a.length}: Δmean=${pt.meanDiff.toFixed(2)}, t=${pt.t.toFixed(2)}, df=${pt.df}, p=${pt.p.toFixed(3)}, BF≤${bf.toFixed(2)}${dirNote}`,
  };
}

/** Two-sided evidence from an unpaired sample (welch). */
function welchEvidence(id: string, label: string, a: number[], b: number[]): Evidence {
  const w: WelchResult = welch(a, b);
  return {
    id,
    label,
    bf: sbpBF(w.p),
    detail: `welch n=${a.length}/${b.length}: Δmean=${w.meanDiff.toFixed(2)}, t=${w.t.toFixed(2)}, p=${w.p.toFixed(3)}, BF≤${sbpBF(w.p).toFixed(2)}`,
  };
}

/** Exact binomial recovery evidence: k recovered of n worlds. */
function binomRecoveryEvidence(id: string, label: string, k: number, n: number): Evidence {
  const theta1 = (k + 1) / (n + 2); // Beta(1,1)-regularized plug-in
  const lk1 = theta1 ** k * (1 - theta1) ** (n - k);
  const lk0 = 0.5 ** n;
  const raw = lk1 / lk0; // >1 supports "recovery is common"
  const bf = k >= n / 2 ? Math.min(1e6, raw) : 1 / Math.min(1e6, 1 / raw);
  return {
    id,
    label,
    bf,
    detail: `binomial: ${k}/${n} recovered, θ̂=${theta1.toFixed(2)}, LR=${raw.toFixed(2)} → BF=${bf.toFixed(2)} (vs chance 0.5)`,
  };
}

// ---- hypothesis registry ----

export interface HypothesisSpec {
  id: string;
  claim: string;
  kind: 'directional' | 'twosided' | 'null';
  qualitative: string;
}

export const HYPOTHESES: HypothesisSpec[] = [
  {
    id: 'H-BANK',
    claim: 'Shrinking the energy bank (capacity 100 → 25) lowers standing population across habitats.',
    kind: 'directional',
    qualitative:
      'The energy bank is the only buffer against an unlucky sequence of metabolic costs; a 4× smaller reservoir converts ordinary cost jitter into die-offs, so colonies lose agents before they can offset losses with births.',
  },
  {
    id: 'H-META',
    claim: 'Raising basal metabolism (1.0 → 1.5) shifts standing populations down.',
    kind: 'directional',
    qualitative:
      'Higher basal charge spends the same income faster: every agent pays more per tick, growth margins shrink, and (at this energy-rich baseline) the cost never converts into extra activity that could pay it back.',
  },
  {
    id: 'H-SUPPLY',
    claim: 'Raising food regeneration (supply) raises colony growth.',
    kind: 'directional',
    qualitative:
      'Supply elasticity is live: regen feeds the standing resource pool that populations graze on, so a 10× higher regen should convert into more headcount — the effect is expected to be noisy across habitats because barren windows constrain how much supply can be captured.',
  },
  {
    id: 'H-FAMINE',
    claim: 'Supply destruction (catastrophic food loss) depresses standing population on every habitat.',
    kind: 'directional',
    qualitative:
      'Food is the shared public capital: wiping it out at a fixed tick removes the population\'s only growth margin for the rest of the window, so the standing population after a famine tracks the famine, not the habitat.',
  },
  {
    id: 'H-BOUNTY',
    claim: 'A one-shot resource pulse (bounty) raises population when the habitat can absorb it.',
    kind: 'directional',
    qualitative:
      'A pulse is an option, not a floor: it only converts into headcount where the window already supports reproduction; on barren windows the pulse is consumed and forgotten within a few ticks.',
  },
  {
    id: 'H-NUKE-IRRECOVERABLE',
    claim: 'A total-cull event is NOT recoverable within 4× the developmental horizon (no recolonization).',
    kind: 'directional',
    qualitative:
      'With no immigration and no founder seed, an empty world has no mechanism to re-seed itself: extinction is absorbing at this horizon because recovery requires births from survivors, and a true cull leaves none.',
  },
  {
    id: 'H-METEOR-SURVIVABLE',
    claim: 'A spatially-localized impact (meteor at the colony centroid) is survivable — colonies persist.',
    kind: 'directional',
    qualitative:
      'A localized shock removes agents only inside its radius; the colony\'s spatial spread and the surviving out-of-radius agents provide both the population floor and the reproduction needed to recover within ticks.',
  },
  {
    id: 'H-EARTH-CALIBRATED',
    claim: 'Earth-like physics laws are indistinguishable from legacy physics (calibration tie-out, no effect).',
    kind: 'null',
    qualitative:
      'The engine\'s legacy climb cost was calibrated to Earth gravity (4.0 ≈ 9.81 × 0.408), so Earth-like law should reproduce legacy dynamics — a null result here is a *calibration confirmation*, not a trivial non-effect.',
  },
  {
    id: 'H-ESCAPE',
    claim: 'The escape-window (universe constant) materially changes growth outcomes.',
    kind: 'twosided',
    qualitative:
      'The escape radius shapes the fractal iteration texture (hazard/energy terrain) rather than actual escape dynamics at these speeds; changing it re-samples the growth surface, so the sign of the effect can flip by habitat.',
  },
  {
    id: 'H-KLEIN',
    claim: 'The klein bottle boundary (non-orientable cap loop) differs from the torus in cap-growth.',
    kind: 'twosided',
    qualitative:
      'Edge-seeded founders engage the boundary immediately; if the flipped cap-loop reorganises dispersal, Δpop distributions should separate — but between-biome variance is large, so this needs the 17-biome paired panel to even be visible.',
  },
  {
    id: 'H-JULIA',
    claim: 'Julia-set terrain outgrows perlin terrain at matched biome/resolution (terrain complexity pays).',
    kind: 'directional',
    qualitative:
      'Julia windows concentrate resource structure into coherent patches that colonies can exploit, while perlin noise spreads the same resource thinly; the advantage should appear as higher Δpop at matched zoom/resolution.',
  },
  {
    id: 'H-LATTICE-1D',
    claim: '1D lattices bottleneck colonization relative to 2D (dimensional phase change).',
    kind: 'twosided',
    qualitative:
      'At fixed volume, a 1D chain has only 2 neighbours per cell: any blockage severs the network, while 2D+ give the colony alternate routes around poor cells — the prediction is a hard phase change between 1D and 2D, not a smooth gradient.',
  },
];

interface LedgerEvidence {
  id: string;
  bf: number;
  detail: string;
  absorbedAt: string;
}

interface LedgerEntry {
  claim: string;
  kind: string;
  prior0: number;
  prior: number; // before this run's new evidence
  posterior: number;
  qualitative: string;
  absorbed: LedgerEvidence[];
  history: { at: string; newIds: string[]; posterior: number }[];
}

interface Ledger {
  generatedAt: string;
  method: string;
  hypotheses: Record<string, LedgerEntry>;
}

function loadLedger(): Ledger | undefined {
  if (!existsSync(ledgerPath)) return undefined;
  try {
    return JSON.parse(readFileSync(ledgerPath, 'utf8')) as Ledger;
  } catch {
    return undefined;
  }
}

// ---- data assembly: one Evidence per independent dataset ----

function collectEvidence(): Map<string, Evidence[]> {
  const out = new Map<string, Evidence[]>();
  const add = (hid: string, e: Evidence) => {
    if (!out.has(hid)) out.set(hid, []);
    out.get(hid)!.push(e);
  };

  // -- cosmos replicates (paired per seed) --
  const cosmos = loadCsv('cosmos.csv').rows;
  const controlByRep = new Map<string, number>();
  for (const r of cosmos) {
    if (r.axis === 'controls' && r.knob === 'control') controlByRep.set(r.rep!, num(r.dPop));
  }
  const fam = (axis: string, knob: string) => cosmos.filter((r) => r.axis === axis && r.knob === knob && r.rep !== '-');
  const ctrlAlive = new Map<string, number>();
  for (const r of cosmos) {
    if (r.axis === 'controls' && r.knob === 'control') ctrlAlive.set(r.rep!, num(r.alive));
  }

  add('H-BANK', pairedEvidence('cosmos.bank', 'cosmos energy.bank.small vs control (dPop, n=4)', fam('energy', 'bank.small'), controlByRep, 'dPop', 'neg'));
  add('H-META', pairedEvidence('cosmos.meta', 'cosmos energy.meta.high vs control (dPop, n=4)', fam('energy', 'meta.high'), controlByRep, 'dPop', 'neg'));
  add('H-SUPPLY', pairedEvidence('cosmos.supply', 'cosmos supply.high vs control (dPop, n=4)', fam('supply', 'supply.high'), controlByRep, 'dPop', 'pos'));
  add('H-SUPPLY', pairedEvidence('cosmos.supply.low', 'cosmos supply.low vs control (dPop, n=4; sign-gated)', fam('supply', 'supply.low'), controlByRep, 'dPop', 'pos'));
  add('H-ESCAPE', pairedEvidence('cosmos.escape', 'cosmos escape.small vs control (dPop, n=4)', fam('universeConstants', 'escape.small'), controlByRep, 'dPop', 'twosided'));
  add('H-EARTH-CALIBRATED', pairedEvidence('cosmos.earth', 'cosmos law.earth vs control (dPop, n=4)', fam('laws', 'law.earth'), controlByRep, 'dPop', 'twosided'));

  // -- black-swan treatments (paired against swan.none, same seed) --
  const noneByRep = new Map<string, number>();
  for (const r of cosmos) {
    if (r.axis === 'blackswan' && r.knob === 'swan.none') noneByRep.set(r.rep!, num(r.dPop));
  }
  add('H-FAMINE', pairedEvidence('cosmos.famine', 'cosmos swan.famine vs swan.none (dPop, n=4)', cosmos.filter((r) => r.knob === 'swan.famine'), noneByRep, 'dPop', 'neg'));
  add('H-BOUNTY', pairedEvidence('cosmos.bounty', 'cosmos swan.bounty vs swan.none (dPop, n=4)', cosmos.filter((r) => r.knob === 'swan.bounty'), noneByRep, 'dPop', 'pos'));

  // recovery: recovered = alive(final) >= 0.5 * alive@event
  const recovers = (knob: string) => {
    const rs = cosmos.filter((r) => r.knob === knob);
    const k = rs.filter((r) => num(r.recover) >= 0.5).length;
    return { k, n: rs.length };
  };
  const nuke = recovers('swan.nuke');
  add('H-NUKE-IRRECOVERABLE', binomRecoveryEvidence('cosmos.nuke.rec', 'cosmos swan.nuke recovery', nuke.k, nuke.n));
  const meteor = recovers('swan.meteor');
  add('H-METEOR-SURVIVABLE', binomRecoveryEvidence('cosmos.meteor.rec', 'cosmos swan.meteor recovery', meteor.k, meteor.n));

  // -- canonical 17-biome topologies panel (paired klein vs torus) --
  const topo = loadCsv('topologies.csv').rows;
  const byBiome = new Map<string, Record<string, string>>();
  for (const r of topo) byBiome.set(`${r.biome}|${r.topology}`, r);
  const kD: number[] = [];
  const tD: number[] = [];
  const biomes = [...new Set(topo.map((r) => r.biome!))];
  for (const b of biomes) {
    const k = byBiome.get(`${b}|kleinBottle`);
    const t = byBiome.get(`${b}|torus`);
    if (k && t) {
      kD.push(num(k.dPop));
      tD.push(num(t.dPop));
    }
  }
  const kt = pairedT(kD, tD);
  add('H-KLEIN', {
    id: 'topo.klein',
    label: `topologies kleinBottle vs torus (Δpop, n=${kD.length} biomes)`,
    bf: sbpBF(kt.p),
    detail: `paired n=${kD.length}: Δmean=${kt.meanDiff.toFixed(2)}, t=${kt.t.toFixed(2)}, p=${kt.p.toFixed(3)}, BF≤${sbpBF(kt.p).toFixed(2)}`,
  });

  // -- canonical fractal panel: julia vs perlin Δpop (all cells, both biomes) --
  const dim = loadCsv('dimensions.csv').rows;
  const julia = dim.filter((r) => r.fractal === 'julia').map((r) => num(r.dPop));
  const perlin = dim.filter((r) => r.fractal === 'perlin').map((r) => num(r.dPop));
  add('H-JULIA', welchEvidence('dim.julia', 'dimensions julia vs perlin (Δpop)', julia, perlin));

  // -- canonical lattice: 1D vs 2D colonization --
  const lat = loadCsv('lattice.csv').rows;
  const oneD = lat.find((r) => r.topology === 'torus' && !r.dims.includes('x') && !r.dims.includes('×'));
  const twoD = lat.find((r) => r.topology === 'torus' && (r.dims.includes('x') || r.dims.includes('×')));
  if (oneD && twoD) {
    const n = 4096;
    const kA = Math.round(num(oneD.survival) * n);
    const kB = Math.round(num(twoD.survival) * n);
    const z = twoProportionZ(kA, n, kB, n);
    add('H-LATTICE-1D', {
      id: 'lattice.1d2d',
      label: `lattice 1D vs 2D colonization (z-test, ${kA}/${n} vs ${kB}/${n})`,
      bf: sbpBF(z.p),
      detail: `two-proportion z=${z.z.toFixed(2)}, p=${z.p.toExponential(2)}, BF≤${Math.min(1e6, sbpBF(z.p)).toFixed(0)}`,
    });
  }

  return out;
}

// ---- update the ledger (sequential, idempotent) ----

function updateLedger(evidence: Map<string, Evidence[]>): Ledger {
  const now = new Date().toISOString();
  const prev = loadLedger();
  const method =
    'Sellke–Berger–Pericchi minimal Bayes factor: BF = 1/(-e·p·ln p) for p < 1/e, else 1; ' +
    'binomial LR for recovery claims; directional claims credit only sign-consistent effects; ' +
    'null claims update with the reciprocal BF (maximal support for the null). ' +
    'Sequential updates multiply odds; same-data re-runs are idempotent (evidence IDs absorb once).';
  const ledger: Ledger = { generatedAt: now, method, hypotheses: {} };

  for (const spec of HYPOTHESES) {
    const priorEntry = prev?.hypotheses[spec.id];
    const basePrior = priorEntry?.prior0 ?? 0.5;
    const prior = priorEntry?.posterior ?? basePrior;
    const absorbed: LedgerEvidence[] = priorEntry ? [...priorEntry.absorbed] : [];
    const history = priorEntry ? [...priorEntry.history] : [];
    const seen = new Set(absorbed.map((a) => a.id));

    let o = odds(prior);
    const newIds: string[] = [];
    for (const e of evidence.get(spec.id) ?? []) {
      if (seen.has(e.id)) continue;
      // null claims believe the ABSENCE of an effect: invert the effect-BF so
      // the multiplication stays in claim space (maximal support for the null)
      const claimBF = spec.kind === 'null' ? 1 / Math.max(1e-12, e.bf) : e.bf;
      o *= claimBF;
      absorbed.push({ id: e.id, bf: e.bf, detail: e.detail, absorbedAt: now });
      seen.add(e.id);
      newIds.push(e.id);
    }
    const posterior = fromOdds(o);
    if (newIds.length > 0) history.push({ at: now, newIds, posterior });

    ledger.hypotheses[spec.id] = {
      claim: spec.claim,
      kind: spec.kind,
      prior0: basePrior,
      prior,
      posterior,
      qualitative: spec.qualitative,
      absorbed,
      history,
    };
  }
  return ledger;
}

// ---- outputs ----

function verdict(posterior: number): string {
  if (posterior >= 0.9) return 'strong support';
  if (posterior >= 0.7) return 'support';
  if (posterior > 0.5) return 'lean';
  if (posterior >= 0.3) return 'undecided';
  if (posterior >= 0.1) return 'lean against';
  return 'strongly against';
}

function fmt(x: number, d = 2): string {
  return x.toFixed(d);
}

function renderMarkdown(ledger: Ledger, evidence: Map<string, Evidence[]>): string {
  const lines: string[] = [];
  lines.push('# Phase M+ — Bayesian hypothesis ledger');
  lines.push('');
  lines.push(`Generated ${ledger.generatedAt} by \`research/bayes.ts\`.`);
  lines.push('');
  lines.push('## 0. Method');
  lines.push('');
  lines.push(ledger.method);
  lines.push('');
  lines.push('Determinism caveat: every sample is a different world (seed/habitat/biome); posteriors describe belief about effects **across worlds**.');
  lines.push('');
  lines.push('## 1. Hypotheses and posteriors');
  lines.push('');
  lines.push('| id | claim | prior0 | posterior | verdict |');
  lines.push('|---|---|---|---|---|');
  for (const spec of HYPOTHESES) {
    const h = ledger.hypotheses[spec.id]!;
    lines.push(`| ${spec.id} | ${spec.claim} | ${fmt(h.prior0)} | **${fmt(h.posterior)}** | ${verdict(h.posterior)} |`);
  }
  lines.push('');
  lines.push('![posterior](plots/posterior.svg)');
  lines.push('');
  lines.push('## 2. Evidence ledger (quantitative → qualitative)');
  lines.push('');
  for (const spec of HYPOTHESES) {
    const h = ledger.hypotheses[spec.id]!;
    lines.push(`### ${spec.id} — posterior ${fmt(h.posterior)} (${verdict(h.posterior)})`);
    lines.push('');
    lines.push(`**Claim:** ${spec.claim}`);
    lines.push('');
    lines.push(`**Qualitative explanation:** ${h.qualitative}`);
    lines.push('');
    const ev = evidence.get(spec.id) ?? [];
    if (ev.length === 0) {
      lines.push('_No dataset yet._');
    } else {
      for (const e of ev) {
        lines.push(`- **${e.label}** — ${e.detail} → BF = ${fmt(e.bf)}`);
      }
    }
    lines.push('');
    if (h.history.length > 0) {
      lines.push(`Update history: ${h.history.length} update(s); latest posterior ${fmt(h.history[h.history.length - 1]!.posterior)} at ${h.history[h.history.length - 1]!.at}.`);
      lines.push('');
    }
  }
  lines.push('## 3. Reading guide');
  lines.push('');
  lines.push('- BF ≤ 1/(-e·p·ln p) is the *minimal* Bayes factor: with n = 4 worlds, even p = 0.05 can only push a 0.5 prior to ≈ 0.71. Posterior strength is bounded by the sample size of worlds, not by enthusiasm.');
  lines.push('- Posterior ≥ 0.9 in this ledger therefore means either very strong p-values (large n or huge effects) or repeated independent evidence.');
  lines.push('- A `null` claim (H-EARTH-CALIBRATED) believes the absence of an effect: it updates with the reciprocal BF (maximal support for the null) and its support is exactly the absence of evidence of an effect. With the current n=4 tie-out that support stays at 0.50 — an honest "cannot decide".');
  lines.push('');
  return lines.join('\n');
}

function renderPosteriorSvg(ledger: Ledger): string {
  const specs = HYPOTHESES.map((s) => ({ id: s.id, p: ledger.hypotheses[s.id]!.posterior }));
  const rowH = 30;
  const top = 60;
  const left = 250;
  const width = 720;
  const height = top + specs.length * rowH + 40;
  const bars = specs
    .map((s, i) => {
      const y = top + i * rowH;
      const w = Math.max(1, Math.round((s.p * (width - left - 30)) / 1));
      const color = s.p >= 0.7 ? '#2f7d32' : s.p >= 0.5 ? '#7cb342' : s.p >= 0.3 ? '#b0bec5' : '#c62828';
      return (
        `<text x="${left - 8}" y="${y + 15}" text-anchor="end" font-size="12" font-family="monospace">${s.id}</text>` +
        `<rect x="${left}" y="${y + 3}" width="${w}" height="16" fill="${color}" />` +
        `<text x="${left + w + 6}" y="${y + 15}" font-size="11" font-family="monospace">${s.p.toFixed(3)}</text>`
      );
    })
    .join('');
  const cx = left + Math.round(0.5 * (width - left - 30));
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    `<rect width="${width}" height="${height}" fill="white"/>` +
    `<text x="16" y="24" font-size="16" font-weight="bold" font-family="sans-serif">Bayesian posterior by hypothesis (prior 0.5 → sequential updates)</text>` +
    `<text x="16" y="42" font-size="11" font-family="sans-serif" fill="#555">SBP minimal Bayes factors; dashed line = 0.5 (prior). Determinism ⇒ samples are worlds, not noise.</text>` +
    `<line x1="${cx}" y1="${top}" x2="${cx}" y2="${top + specs.length * rowH}" stroke="#90a4ae" stroke-dasharray="4 3"/>` +
    bars +
    `<text x="${left}" y="${top + specs.length * rowH + 24}" font-size="11" font-family="sans-serif" fill="#555">posterior P(claim | data)</text>` +
    `</svg>\n`
  );
}

export function runBayes(): void {
  const evidence = collectEvidence();
  const ledger = updateLedger(evidence);
  mkdirSync(outputDir, { recursive: true });
  mkdirSync(plotsDir, { recursive: true });
  writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + '\n');
  writeFileSync(join(outputDir, 'bayes.md'), renderMarkdown(ledger, evidence));
  writeFileSync(join(outputDir, 'plots', 'posterior.svg'), renderPosteriorSvg(ledger));

  console.log('# Bayesian ledger updated');
  for (const spec of HYPOTHESES) {
    const h = ledger.hypotheses[spec.id]!;
    const evCount = evidence.get(spec.id)?.length ?? 0;
    console.log(
      `  ${spec.id.padEnd(24)} P0=${fmt(h.prior0)} → ${fmt(h.posterior).padStart(5)}  (${verdict(h.posterior)}, ${evCount} evidence)`,
    );
  }
  console.log('\nwritten: hypotheses.json, bayes.md, plots/posterior.svg');
}

if (process.argv[1]?.endsWith('bayes.ts')) {
  runBayes();
}