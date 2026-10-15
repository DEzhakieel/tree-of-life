/**
 * Known-systems reverse-engineering registry — shared types.
 *
 * The registry is an inventory of canonical artificial-life / complex-systems
 * models drawn from the scientific literature and the major ABM platforms. Each
 * entry records what the reference system is, which phenomenon it demonstrates,
 * and — where we ship an executable replication — links to the benchmark that
 * operationalises it. `replicated` entries get a numeric fidelity (gated checks
 * passed / total) computed by re-running the linked benchmark; documentation-only
 * entries carry a qualitative status instead.
 */

import type { BenchId } from '../types.js';

export type KnownDomain = 'scientific' | 'platform';

/**
 * How a target value is grounded. This is the distinction the validation study
 * actually tests, so it is first-class:
 *
 *  - `measured`  — a value reported from observation or experiment in the
 *                  source (or a CI/SE reported around one).
 *  - `derived`   — a closed-form consequence of the reference model itself
 *                  (e.g. the Lotka–Volterra period 2π/√(αγ), or a glider's
 *                  exact (1,1)/4-gen translation).
 *  - `expected`  — the source states only a qualitative regime (high vs low,
 *                  present vs absent); the numeric band is our conservative
 *                  quantification of it, stated as such.
 */
export type TargetKind = 'measured' | 'derived' | 'expected';

/**
 * A published or derivable reference value for one signature key, with the
 * uncertainty the source supports and the citation it comes from.
 *
 * Targets are deliberately independent of the benchmark's own acceptance
 * thresholds: `BenchCheck` encodes the criterion we chose; `EmpiricalTarget`
 * encodes what the literature reports. A model can pass every gate and still
 * miss its empirical target, which is exactly what the validation study should
 * surface.
 */
export interface EmpiricalTarget {
  /** signature key this target constrains (must exist in the model's signature) */
  key: string;
  /** published / derived reference value */
  value: number;
  /** symmetric half-width of the acceptance band, when the source supports one */
  tol?: number;
  /** asymmetric band, overriding `tol` when both are given */
  lo?: number;
  hi?: number;
  /** sample size behind a `measured` value, when the source reports one */
  n?: number;
  kind: TargetKind;
  /** canonical citation for the value */
  source: string;
  note?: string;
}

export interface KnownSystem {
  /** stable slug, e.g. 'conway-life' */
  id: string;
  name: string;
  author: string;
  year: number;
  domain: KnownDomain;
  /** ABM framework the reference implementation ships with, when applicable */
  framework?: string;
  /** the phenomenon this system is the canonical demonstration of */
  demonstrates: string;
  /** canonical citation / source */
  reference: string;
  /** true when we ship an executable replication linked to a benchmark */
  replicated: boolean;
  /** linked benchmark id, when replicated */
  benchId?: BenchId;
  /** short description of how the replication is built */
  replication: string;
  /** caveats, simplifications and known deviations from the reference */
  notes: string;
  /**
   * quantitative literature targets the linked benchmark is scored against.
   * Empty for documentation-only entries and for replications whose source
   * reports no usable numeric reference.
   */
  targets?: EmpiricalTarget[];
}

/** one target evaluated against a benchmark run */
export interface TargetScore {
  key: string;
  /** published reference value */
  target: number;
  /** seed-aggregated engine mean for that key */
  observed: number;
  ci: [number, number];
  /** the band the source supports; [lo, hi] */
  band: [number, number];
  absErr: number;
  relErr: number;
  withinBand: boolean;
  kind: TargetKind;
  source: string;
}

/** all targets of one system, evaluated */
export interface TargetAssessment {
  systemId: string;
  benchId: BenchId;
  scores: TargetScore[];
  /** targets within band / total targets */
  hits: number;
  total: number;
  /** measured+derived targets within band / measured+derived total (the hard part) */
  strictHits: number;
  strictTotal: number;
  /** strict-hit fraction; 1 when the source supports no measurable target */
  fidelity: number;
  status: 'matched' | 'partial' | 'unmatched';
}

export interface KnownEntry extends KnownSystem {
  /** gated fidelity of the linked benchmark (replicated entries only) */
  fidelity?: number;
  /** fidelity-derived status; 'documented' for non-replicated entries */
  status: 'replicated' | 'partial' | 'documented';
  /** empirical-target assessment (replicated entries with declared targets) */
  targetAssessment?: TargetAssessment;
  /** strict (measured + derived) target hits, over the whole report */
  empiricalFidelity?: number;
}

export interface KnownReport {
  scale: 'full' | 'quick';
  entries: KnownEntry[];
  scientific: number;
  platforms: number;
  replicated: number;
  meanFidelity: number;
  /** systems carrying quantitative targets */
  assessed: number;
  /** strict (measured + derived) target hits across the report */
  empiricalHits: number;
  empiricalTotal: number;
  empiricalFidelity: number;
  totalMs: number;
}
