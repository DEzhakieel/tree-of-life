import { z } from 'zod';

// ---------------------------------------------------------------------------
// Enrichment snapshot schema — real-world grounding data fetched from open
// scientific APIs and snapshotted offline so the engine stays deterministic.
// ---------------------------------------------------------------------------

const SourceRef = z.object({
  name: z.string(),
  url: z.string(),
  accessedAt: z.string(),
  license: z.string().optional(),
});

const ElementRef = z.object({
  index: z.number().int(),
  symbol: z.string(),
  atomicMass: z.number().optional(),
  electronegativity: z.number().optional(),
});

const MoleculeRef = z.object({
  index: z.number().int(),
  name: z.string(),
  role: z.string(),
  pubchemCid: z.number().optional(),
  molecularFormula: z.string().optional(),
  molecularWeight: z.number().optional(),
  iupacName: z.string().optional(),
  elementCounts: z.number().nonnegative().array().length(8),
});

const EcologyTaxon = z.object({
  level: z.number().int(),
  role: z.string(),
  scientificName: z.string(),
  commonName: z.string().optional(),
  gbifUsageKey: z.number(),
  kingdom: z.string().optional(),
  phylum: z.string().optional(),
  class: z.string().optional(),
  order: z.string().optional(),
  family: z.string().optional(),
  genus: z.string().optional(),
  occurrenceCount: z.number(),
});

const CodonEntry = z.object({
  codon: z.string().length(3),
  aminoAcid: z.string(),
  fraction: z.number(),
  perThousand: z.number(),
  count: z.number().int(),
});

const EngineStoichiometry = z.object({
  plant: z.number().array().length(8),
  meat: z.number().array().length(8),
  aminoAcid: z.number().array().length(8),
  fattyAcid: z.number().array().length(8),
  sugar: z.number().array().length(8),
  glucose: z.number().array().length(8),
});

const EcoPrior = z.object({
  level: z.number().int(),
  role: z.string(),
  carryingCapacityScale: z.number(),
  occurrenceCount: z.number(),
  occurrenceFraction: z.number(),
});

const GeneticsPrior = z.object({
  organism: z.string(),
  gcContent: z.number(),
  avgHydrophobicity: z.number(),
  codonCount: z.number().int(),
});

export const EnrichmentSnapshot = z.object({
  version: z.literal(1),
  generatedAt: z.string(),
  toolchain: z.string(),
  sources: z.array(SourceRef),
  fetchedAt: z.record(z.string(), z.string()),
  chemistry: z.object({
    elements: z.array(ElementRef).length(8),
    molecules: z.array(MoleculeRef).length(12),
    stoichiometry: EngineStoichiometry,
  }),
  ecology: z.object({
    taxa: z.array(EcologyTaxon),
    priors: z.array(EcoPrior),
    totalOccurrences: z.number(),
  }),
  genetics: z.object({
    codons: z.array(CodonEntry).min(1),
    prior: GeneticsPrior,
  }),
});

export type EnrichmentSnapshot = z.infer<typeof EnrichmentSnapshot>;
export type MoleculeRef = z.infer<typeof MoleculeRef>;
export type EcologyTaxon = z.infer<typeof EcologyTaxon>;
export type EcoPrior = z.infer<typeof EcoPrior>;
export type EngineStoichiometry = z.infer<typeof EngineStoichiometry>;
