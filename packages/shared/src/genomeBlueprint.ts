import {
  BRAIN_OFFSET,
  BRAIN_REC_COUNT,
  BRAIN_REC_OFFSET,
  CELL_GENES,
  CELL_OFFSET,
  CHEM_GENES,
  CHEM_OFFSET,
  CRITIC_OFFSET,
  CRITIC_COUNT,
  DNA_GENES,
  DNA_OFFSET,
  DRIVES,
  DRIVE_COUNT,
  DRIVE_OFFSET,
  ECOSYSTEM_GENES,
  ECOSYSTEM_OFFSET,
  GENOME_SIZE,
  IMMUNE_GENES,
  IMMUNE_OFFSET,
  MEMBRANE_GENES,
  MEMBRANE_OFFSET,
  METAB_GENES,
  METAB_OFFSET,
  MLP_WEIGHTS,
  PHENOTYPE_COUNT,
  PHENOTYPE_OFFSET,
  PLASTICITY_COUNT,
  PLASTICITY_OFFSET,
  PREDPREY_GENES,
  PREDPREY_OFFSET,
  REPRO_GENES,
  REPRO_OFFSET,
  STRATEGIES,
  STRATEGY_COUNT,
  STRATEGY_OFFSET,
  CHEM_GENE_COUNT,
  DNA_GENE_COUNT,
  IMMUNE_GENE_COUNT,
  PREDPREY_GENE_COUNT,
  REPRO_GENE_COUNT,
  METAB_GENE_COUNT,
  CELL_GENE_COUNT,
  ECOSYSTEM_GENE_COUNT,
  MEMBRANE_GENE_COUNT,
} from './constants.js';

export interface GenomeGene {
  /** human-readable gene label (block-local slot name; "" for raw weight slots) */
  name: string;
  /** absolute genome index */
  index: number;
}

export interface GenomeBlock {
  name: string;
  offset: number;
  count: number;
  hint?: string;
  /** named slots. Empty for large opaque weight blocks (MLP brain). */
  genes: GenomeGene[];
}

function genes(offset: number, names: readonly string[]): GenomeGene[] {
  return names.map((name, i) => ({ name, index: offset + i }));
}

function blockNames(map: Record<string, number>): string[] {
  const names: string[] = [];
  for (const key of Object.keys(map)) {
    names[map[key]!] = key.toLowerCase();
  }
  return names;
}

export const PHENOTYPE_GENE_NAMES = [
  'speed',
  'senseRadius',
  'metabolism',
  'colorR',
  'colorG',
  'colorB',
  'size',
  'diet',
  'fertility',
  'longevity',
  'mutability',
] as const;

/**
 * Canonical 217-gene layout as browsable blocks. Drives the inspector gene
 * table, the designer builder and the setGene index bounds — single source of
 * truth for what sits at each genome offset.
 */
export const GENOME_BLOCKS: GenomeBlock[] = [
  {
    name: 'Phenotype',
    offset: PHENOTYPE_OFFSET,
    count: PHENOTYPE_COUNT,
    hint: 'body plan + behaviour: genes 0/1 double as the fractal c parameter (cRe, cIm)',
    genes: genes(PHENOTYPE_OFFSET, PHENOTYPE_GENE_NAMES),
  },
  {
    name: 'Brain MLP',
    offset: BRAIN_OFFSET,
    count: MLP_WEIGHTS,
    hint: '15→4→7 policy network: w1[60] b1[4] w2[28] b2[7]',
    genes: [],
  },
  {
    name: 'Pattern drives',
    offset: DRIVE_OFFSET,
    count: DRIVE_COUNT,
    hint: 'instinct steering weights: flock/flow, cluster, spacing, spiral, wave, jitter',
    genes: genes(DRIVE_OFFSET, blockNames(DRIVES)),
  },
  {
    name: 'Strategy',
    offset: STRATEGY_OFFSET,
    count: STRATEGY_COUNT,
    hint: 'Darwinian game theory: hunting, charity, risk, deception',
    genes: genes(STRATEGY_OFFSET, blockNames(STRATEGIES)),
  },
  {
    name: 'Chemistry',
    offset: CHEM_OFFSET,
    count: CHEM_GENE_COUNT,
    genes: genes(CHEM_OFFSET, blockNames(CHEM_GENES)),
  },
  {
    name: 'DNA system',
    offset: DNA_OFFSET,
    count: DNA_GENE_COUNT,
    genes: genes(DNA_OFFSET, blockNames(DNA_GENES)),
  },
  {
    name: 'Immune system',
    offset: IMMUNE_OFFSET,
    count: IMMUNE_GENE_COUNT,
    genes: genes(IMMUNE_OFFSET, blockNames(IMMUNE_GENES)),
  },
  {
    name: 'Predator-prey',
    offset: PREDPREY_OFFSET,
    count: PREDPREY_GENE_COUNT,
    genes: genes(PREDPREY_OFFSET, blockNames(PREDPREY_GENES)),
  },
  {
    name: 'Reproduction',
    offset: REPRO_OFFSET,
    count: REPRO_GENE_COUNT,
    genes: genes(REPRO_OFFSET, blockNames(REPRO_GENES)),
  },
  {
    name: 'Energy metabolism',
    offset: METAB_OFFSET,
    count: METAB_GENE_COUNT,
    genes: genes(METAB_OFFSET, blockNames(METAB_GENES)),
  },
  {
    name: 'Cellular structure',
    offset: CELL_OFFSET,
    count: CELL_GENE_COUNT,
    genes: genes(CELL_OFFSET, blockNames(CELL_GENES)),
  },
  {
    name: 'Ecosystem adaptation',
    offset: ECOSYSTEM_OFFSET,
    count: ECOSYSTEM_GENE_COUNT,
    genes: genes(ECOSYSTEM_OFFSET, blockNames(ECOSYSTEM_GENES)),
  },
  {
    name: 'Membrane',
    offset: MEMBRANE_OFFSET,
    count: MEMBRANE_GENE_COUNT,
    genes: genes(MEMBRANE_OFFSET, blockNames(MEMBRANE_GENES)),
  },
  {
    name: 'Plastic brain (Wrec)',
    offset: BRAIN_REC_OFFSET,
    count: BRAIN_REC_COUNT,
    hint: 'Elman feedback weights — drift here is "learning"',
    genes: genes(
      BRAIN_REC_OFFSET,
      Array.from({ length: BRAIN_REC_COUNT }, (_, i) => `wrec[${i}]`),
    ),
  },
  {
    name: 'Learned critic',
    offset: CRITIC_OFFSET,
    count: CRITIC_COUNT,
    hint: 'w0..w3 + bias over the hidden layer',
    genes: genes(
      CRITIC_OFFSET,
      Array.from({ length: CRITIC_COUNT }, (_, i) => (i < CRITIC_COUNT - 1 ? `w[${i}]` : 'bias')),
    ),
  },
  {
    name: 'Plasticity',
    offset: PLASTICITY_OFFSET,
    count: PLASTICITY_COUNT,
    hint: 'heredity of learned synapses + learning hyper-parameters',
    genes: genes(PLASTICITY_OFFSET, ['inherit', 'lr', 'gamma', 'lambda']),
  },
];

/** Label for every gene index ("" = unnamed raw weight / data slot). */
export const GENOME_LABELS: string[] = (() => {
  const labels: string[] = new Array(GENOME_SIZE).fill('');
  for (const b of GENOME_BLOCKS) {
    for (const g of b.genes) {
      labels[g.index] = g.name;
    }
  }
  // Add structural labels for the opaque MLP block: w1[60] b1[4] w2[28] b2[7]
  for (let i = 0; i < MLP_WEIGHTS; i++) {
    const idx = BRAIN_OFFSET + i;
    let label: string;
    if (i < 60) label = `w1[${i}]`;
    else if (i < 64) label = `b1[${i - 60}]`;
    else if (i < 92) label = `w2[${i - 64}]`;
    else label = `b2[${i - 92}]`;
    labels[idx] = label;
  }
  return labels;
})();

export interface GenomeBlockSpan {
  name: string;
  offset: number;
  count: number;
  hint?: string;
}

/** Flat block map (without per-gene entries) for range lookups. */
export const GENOME_BLOCK_SPANS: GenomeBlockSpan[] = GENOME_BLOCKS.map((b) => ({
  name: b.name,
  offset: b.offset,
  count: b.count,
  hint: b.hint,
}));

/** Block containing a genome index (or null if out of range). */
export function genomeBlockAt(index: number): GenomeBlockSpan | null {
  if (index < 0 || index >= GENOME_SIZE) return null;
  for (const b of GENOME_BLOCK_SPANS) {
    if (index >= b.offset && index < b.offset + b.count) return b;
  }
  return null;
}

/** Genome index of a named gene within a block (e.g. block 'Phenotype', 'diet'). */
export function geneIndex(blockName: string, geneName: string): number | null {
  const block = GENOME_BLOCKS.find((b) => b.name === blockName);
  if (!block) return null;
  const g = block.genes.find((x) => x.name === geneName);
  return g ? g.index : null;
}