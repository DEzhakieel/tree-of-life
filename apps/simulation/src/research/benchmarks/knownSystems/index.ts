/**
 * Known-systems registry — index + report builder.
 *
 * Combines the scientific and platform inventories and computes fidelity by
 * re-running each linked benchmark over the canonical seed cohort. Entries
 * without a shipped replication are reported as `documented`.
 */

import { runBenchmark } from '../harness.js';
import { BENCHMARK_MODELS } from '../models/index.js';
import type { BenchId, BenchmarkScale } from '../types.js';
import { PLATFORM_SYSTEMS } from './platforms.js';
import { SCIENTIFIC_SYSTEMS } from './scientific.js';
import type { KnownEntry, KnownReport, KnownSystem } from './types.js';

export const KNOWN_SYSTEMS: KnownSystem[] = [...SCIENTIFIC_SYSTEMS, ...PLATFORM_SYSTEMS];

export function buildKnownReport(scale: BenchmarkScale = 'full'): KnownReport {
  const started = Date.now();
  const byId = new Map(BENCHMARK_MODELS.map((m) => [m.id, m]));
  const fidelityCache = new Map<BenchId, number>();

  const entries: KnownEntry[] = KNOWN_SYSTEMS.map((s) => {
    let fidelity: number | undefined;
    if (s.replicated && s.benchId) {
      let f = fidelityCache.get(s.benchId);
      if (f === undefined) {
        const model = byId.get(s.benchId);
        f = model ? runBenchmark(model, { scale, determinismCheck: false }).fidelity : undefined;
        if (f !== undefined) fidelityCache.set(s.benchId, f);
      }
      fidelity = f;
    }
    const status: KnownEntry['status'] = !s.replicated || fidelity === undefined ? 'documented' : fidelity >= 0.999 ? 'replicated' : 'partial';
    return { ...s, fidelity, status };
  });

  const replicated = entries.filter((e) => e.status !== 'documented');
  const meanFidelity = replicated.length ? replicated.reduce((a, e) => a + (e.fidelity ?? 0), 0) / replicated.length : 0;

  return {
    scale,
    entries,
    scientific: entries.filter((e) => e.domain === 'scientific').length,
    platforms: entries.filter((e) => e.domain === 'platform').length,
    replicated: replicated.length,
    meanFidelity,
    totalMs: Date.now() - started,
  };
}

export type { KnownEntry, KnownReport, KnownSystem } from './types.js';
