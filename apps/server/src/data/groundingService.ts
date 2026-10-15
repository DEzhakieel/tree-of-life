import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EnrichmentSnapshot, type EnrichmentSnapshot as SnapType } from '@fractal-life/shared';

/**
 * Serves the offline enrichment snapshot (real-world data pulled from open
 * scientific models — PubChem, GBIF, Kazusa) as a cached, deterministic source
 * of truth for the grounding system. The snapshot is loaded once at startup and
 * exposed through the `/api/data/grounding/*` endpoints.
 *
 * Isolation note: the browser/server never fetch live science APIs mid-run —
 * determinism is preserved by reading the checked-in snapshot file only.
 */
export class GroundingService {
  private snapshot: SnapType | null = null;
  private loadError: string | null = null;

  constructor(private readonly path?: string) {
    this.load();
  }

  private load(): void {
    try {
      const here = dirname(fileURLToPath(import.meta.url));
      // GroundingService lives at apps/server/src/data — up 3 levels to apps/,
      // then into apps/simulation/data/enrichment.json
      const path = this.path ?? resolve(here, '..', '..', '..', 'simulation', 'data', 'enrichment.json');
      const raw = readFileSync(path, 'utf-8');
      this.snapshot = EnrichmentSnapshot.parse(JSON.parse(raw));
    } catch (err) {
      this.loadError = (err as Error).message;
      this.snapshot = null;
    }
  }

  /** Whether a valid snapshot is loaded. */
  get hasSnapshot(): boolean {
    return this.snapshot !== null;
  }

  /** The version/generation stamp of the loaded snapshot. */
  get metadata(): { version?: number; generatedAt?: string; toolchain?: string; loadError?: string } {
    if (!this.snapshot) return { loadError: this.loadError ?? 'no snapshot' };
    return {
      version: this.snapshot.version,
      generatedAt: this.snapshot.generatedAt,
      toolchain: this.snapshot.toolchain,
    };
  }

  /** Full snapshot (typed JSON). */
  snapshotJson(): SnapType | null {
    return this.snapshot;
  }

  /** Full snapshot serialized back to JSON (for engine grounding injection). */
  snapshotJsonString(): string | null {
    return this.snapshot ? JSON.stringify(this.snapshot) : null;
  }

  /** Chemistry domain: elements, molecules, stoichiometry. */
  chemistry() {
    return this.snapshot?.chemistry ?? null;
  }

  /** Ecology domain: taxa + priors. */
  ecology() {
    return this.snapshot?.ecology ?? null;
  }

  /** Genetics domain: codon usage + prior. */
  genetics() {
    return this.snapshot?.genetics ?? null;
  }

  /** Provenance: which open-source models supplied the data + licenses. */
  sources() {
    return this.snapshot?.sources ?? null;
  }

  /** All taxa as a compact list (scientificName, role, level, occurrence). */
  taxaCompact() {
    return this.snapshot?.ecology.taxa.map((t) => ({
      level: t.level,
      role: t.role,
      scientificName: t.scientificName,
      commonName: t.commonName,
      occurrenceCount: t.occurrenceCount,
    })) ?? null;
  }

  /** All molecules as a compact list (name, role, formula). */
  moleculesCompact() {
    return this.snapshot?.chemistry.molecules.map((m) => ({
      index: m.index,
      name: m.name,
      role: m.role,
      molecularFormula: m.molecularFormula,
    })) ?? null;
  }

  /** Searchable codon table. */
  codons(search?: string) {
    const codons = this.snapshot?.genetics.codons;
    if (!codons) return null;
    if (search) {
      const q = search.trim().toUpperCase();
      return codons.filter((c) => c.codon === q || c.aminoAcid.toUpperCase().includes(q));
    }
    return codons;
  }
}
