/**
 * Canonical A-Life benchmark suite — shared types.
 *
 * A benchmark is a self-contained, deterministic micro-model (the precedent is
 * `dimensional_worlds.ts`: when a phenomenon cannot be exercised cleanly in the
 * full engine, build a minimal instrument). Each model exposes a `run` that
 * returns a small set of LITERATURE-DEFINED measures (its signature) plus a
 * full-state fingerprint, and a declarative list of acceptance checks. The
 * harness applies the checks to the seed-aggregated mean and its bootstrap CI.
 */

export type BenchId = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'H' | 'I' | 'J';

export type BenchmarkScale = 'quick' | 'full';

/** a model's tunable parameter values, keyed by `ParamSpec.key` */
export type BenchParams = Record<string, number>;

/** how a check's reference value is grounded — drives the verification/validation split */
export type ReferenceKind = 'analytic' | 'exact' | 'empirical' | 'theory';

/** a declared tunable knob (used by the sensitivity study) */
export interface ParamSpec {
  key: string;
  label: string;
  /** default value (the full-scale default) */
  def: number;
  min: number;
  max: number;
  /** sweep geometrically (log-spaced) rather than linearly */
  log?: boolean;
  unit?: string;
  note?: string;
}

export type InterventionKind = 'ablation' | 'perturbation';
export type EffectDirection = 'increase' | 'decrease' | 'change';

export interface InterventionEffect {
  /** signature key expected to move */
  key: string;
  direction: EffectDirection;
  note: string;
}

/**
 * A declared intervention: given the baseline params, return the modified
 * params. `apply` is pure so the study can pair it against the untouched
 * baseline on the same seed.
 */
export interface Intervention {
  id: string;
  label: string;
  kind: InterventionKind;
  apply(p: BenchParams): BenchParams;
  effects: InterventionEffect[];
}

export interface RunOutput {
  /** canonical measures, e.g. { alpha: 1.001, dRelErr: 0.004 } */
  signature: Record<string, number>;
  /** full-state hash; the double-run gate requires this to match across two runs */
  fingerprint: string;
}

export type CheckTest = 'gte' | 'lte' | 'range' | 'eqAbs';

export interface BenchCheck {
  /** signature key the check reads */
  key: string;
  test: CheckTest;
  /** gte/lte/eqAbs threshold */
  value?: number;
  /** range bounds */
  lo?: number;
  hi?: number;
  /** eqAbs absolute tolerance */
  tol?: number;
  /** rationale, ideally citing the canonical result */
  note: string;
  /** gates the PASS verdict; non-gating checks are informational only */
  gate: boolean;
  /**
   * Grounds the check: `analytic`/`exact` checks are checked by the verification
   * study against closed-form values; `empirical`/`theory` checks are the ones
   * the validation study maps to the published phenomenon.
   */
  referenceKind?: ReferenceKind;
  /** literature citation for empirical/theory checks */
  citation?: string;
}

export interface BenchmarkModel {
  id: BenchId;
  name: string;
  family: string;
  /** true => evaluate across seeds with bootstrap CIs; false => one deterministic seed */
  stochastic: boolean;
  /** what the model is and where the ground truth comes from */
  reference: string;
  /**
   * `params` overrides the scale default for any declared knob. With no
   * overrides the run must reproduce the canonical FULL/QUICK numbers exactly.
   */
  run(seed: string, scale: BenchmarkScale, params?: BenchParams): RunOutput;
  checks: BenchCheck[];
  /** declared tunable knobs swept by the sensitivity study */
  params?: ParamSpec[];
  /** declared interventions evaluated by the ablation study */
  interventions?: Intervention[];
  /**
   * Closed-form reference values for signature keys, used by the verification
   * study: `absErr = |observed − analytic|`, reported both absolute and relative.
   */
  analytic?: Record<string, number>;
  /** registry linkage: which known system this model empirically realises */
  empirical?: { systemId: string; claim: string };
}

export interface CheckOutcome {
  key: string;
  test: CheckTest;
  threshold: number | [number, number];
  observed: number;
  /** 95% bootstrap CI of the observed mean across seeds */
  ci: [number, number];
  pass: boolean;
  gate: boolean;
  note: string;
}

export interface BenchResult {
  id: BenchId;
  name: string;
  family: string;
  stochastic: boolean;
  seeds: number;
  scale: BenchmarkScale;
  /** seed-aggregated mean of every signature key */
  signature: Record<string, number>;
  ci: Record<string, [number, number]>;
  checks: CheckOutcome[];
  /** gated checks passed / gated checks total, in [0,1] */
  fidelity: number;
  /** both runs of every evaluated seed reproduced their fingerprint bit-for-bit */
  determinism: boolean;
  verdict: 'PASS' | 'FAIL';
  elapsedMs: number;
}

export interface BenchScorecard {
  scale: BenchmarkScale;
  seeds: string[];
  results: BenchResult[];
  pass: boolean;
  totalMs: number;
}
