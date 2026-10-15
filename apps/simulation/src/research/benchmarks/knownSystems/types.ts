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
}

export interface KnownEntry extends KnownSystem {
  /** gated fidelity of the linked benchmark (replicated entries only) */
  fidelity?: number;
  /** fidelity-derived status; 'documented' for non-replicated entries */
  status: 'replicated' | 'partial' | 'documented';
}

export interface KnownReport {
  scale: 'full' | 'quick';
  entries: KnownEntry[];
  scientific: number;
  platforms: number;
  replicated: number;
  meanFidelity: number;
  totalMs: number;
}
