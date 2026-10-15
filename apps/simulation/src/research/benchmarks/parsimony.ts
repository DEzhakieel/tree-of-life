/**
 * Parsimony / model-selection layer.
 *
 * Accuracy alone rewards free parameters: a proposal that retunes five knobs to
 * fit one reference number will beat a two-parameter proposal on residual error
 * while explaining nothing. The information criteria here keep the comparison
 * honest by charging for each free parameter, so the research loop and any
 * parameter-sweep comparison select on accuracy *per unit of complexity*.
 *
 *   AIC = n·ln(SSE/n) + 2k
 *   BIC = n·ln(SSE/n) + k·ln(n)
 *
 * Lower is better. SSE is the sum of squared *relative* residuals against the
 * model's declared reference values (its `analytic` map, else the empirical
 * targets), so keys with different units are comparable. ΔAIC and Akaike
 * weights give the usual strength-of-evidence reading:
 *   Δ ≤ 2   substantial support
 *   Δ ≤ 6   considerably less support
 *   Δ > 10  essentially no support for that candidate
 */

export interface Candidate {
  id: string;
  label?: string;
  /** free parameters: how many knobs differ from the declared default */
  k: number;
  /** sum of squared relative residuals against the reference values */
  sse: number;
  /** residual observations (reference keys used) */
  n: number;
}

export interface ParsimonyScore {
  id: string;
  label?: string;
  k: number;
  n: number;
  sse: number;
  aic: number;
  bic: number;
  /** distance from the best AIC in the comparison set */
  deltaAic: number;
  /** relative support in [0,1]; sums to 1 across the comparison set */
  akaikeWeight: number;
  /** reading of the strength of evidence */
  evidence: 'substantial' | 'considerably-less' | 'none';
}

export interface ParsimonyRanking {
  /** best-first by AIC */
  ranked: ParsimonyScore[];
  best: ParsimonyScore;
  /** AIC spread between best and worst; large spread = complexity decides */
  spread: number;
  /** the model-selection verdict */
  verdict: string;
}

/** floor so a perfect fit does not produce -Infinity */
const SSE_FLOOR = 1e-12;
const REF_FLOOR = 1e-9;

export function informationCriteria(k: number, sse: number, n: number): { aic: number; bic: number } {
  if (n <= 0) return { aic: NaN, bic: NaN };
  const s = Math.max(sse, SSE_FLOOR);
  const base = n * Math.log(s / n);
  return { aic: base + 2 * k, bic: base + k * Math.log(n) };
}

/**
 * Sum of squared relative residuals. Each residual is the *symmetric* relative
 * difference `(obs − ref) / max(|ref|, |obs|, REF_FLOOR)`, bounded to [-1, 1].
 * The symmetric denominator is what makes this well-defined for the many
 * references that are exactly zero (an ideal error metric such as `relL2 = 0`):
 * a pure relative residual would divide by zero and let one near-ideal key
 * dominate the whole sum.
 */
export function relativeSse(
  observed: Record<string, number>,
  reference: Record<string, number>,
): { sse: number; n: number; residuals: Record<string, number> } {
  const residuals: Record<string, number> = {};
  let sse = 0;
  let n = 0;
  for (const [key, ref] of Object.entries(reference)) {
    const obs = observed[key];
    if (obs === undefined || !Number.isFinite(obs) || !Number.isFinite(ref)) continue;
    const scale = Math.max(Math.abs(ref), Math.abs(obs), REF_FLOOR);
    const r = (obs - ref) / scale;
    residuals[key] = r;
    sse += r * r;
    n++;
  }
  return { sse, n, residuals };
}

/** free parameters: how many of the candidate's params differ from the defaults */
export function countFreeParams(
  params: Record<string, number> | undefined,
  defaults: Record<string, number> | undefined,
): number {
  if (!params) return 0;
  const d = defaults ?? {};
  let k = 0;
  for (const [key, v] of Object.entries(params)) {
    if (!(key in d) || d[key] !== v) k++;
  }
  return k;
}

/** rank candidates by AIC and attach ΔAIC, Akaike weights and an evidence reading */
export function parsimonyRank(candidates: readonly Candidate[]): ParsimonyRanking | undefined {
  if (candidates.length === 0) return undefined;

  const scored = candidates.map<ParsimonyScore>((c) => {
    const { aic, bic } = informationCriteria(c.k, c.sse, c.n);
    return { id: c.id, label: c.label, k: c.k, n: c.n, sse: c.sse, aic, bic, deltaAic: 0, akaikeWeight: 0, evidence: 'none' };
  });

  const finite = scored.filter((s) => Number.isFinite(s.aic));
  if (finite.length === 0) return undefined;

  const bestAic = Math.min(...finite.map((s) => s.aic));
  // Akaike weights via the usual normalisation of exp(-Δ/2)
  const weights = finite.map((s) => Math.exp(-0.5 * (s.aic - bestAic)));
  const weightSum = weights.reduce((a, b) => a + b, 0);

  scored.forEach((s, i) => {
    if (!Number.isFinite(s.aic)) return;
    s.deltaAic = s.aic - bestAic;
    s.akaikeWeight = weights[i]! / weightSum;
    s.evidence = s.deltaAic <= 2 ? 'substantial' : s.deltaAic <= 6 ? 'considerably-less' : 'none';
  });

  const ranked = [...scored].sort((a, b) => a.aic - b.aic || a.k - b.k || a.id.localeCompare(b.id));
  const best = ranked[0]!;
  const worst = ranked[ranked.length - 1]!;
  const spread = worst.aic - best.aic;
  const runnersUp = ranked.slice(1).filter((s) => s.deltaAic <= 2);
  const verdict =
    ranked.length === 1
      ? `${best.id} is the only candidate (k=${best.k}, ΔAIC=0)`
      : runnersUp.length === 0
        ? `${best.id} wins on parsimony (k=${best.k}, ΔAIC=${spread.toFixed(1)} ahead of the field)`
        : `${best.id} leads but ${runnersUp.map((s) => s.id).join(', ')} remain within ΔAIC≤2 — the extra complexity is not resolved by the data`;

  return { ranked, best, spread, verdict };
}
