use crate::rng::SplitMix64;
use fractal_life_shared::constants::*;

#[derive(Clone, Debug)]
pub struct Phenotype {
    pub speed: f64,
    pub sense_radius: f64,
    pub metabolism: f64,
    pub color: [f64; 3],
    pub size: f64,
    pub diet: f64,
    pub fertility: f64,
    pub longevity: f64,
    pub mutability: f64,
    pub capacity: f64,
}

#[derive(Clone, Debug, Default)]
pub struct PatternDrives {
    pub alignment: f64,
    pub cohesion: f64,
    pub separation: f64,
    pub circulation: f64,
    pub oscillation: f64,
    pub noise: f64,
}

#[derive(Clone, Debug, Default)]
pub struct StrategyGenes {
    pub aggression: f64,
    pub cooperation: f64,
    pub risk: f64,
    pub deception: f64,
}

#[derive(Clone, Debug, Default)]
pub struct ImmuneGenes {
    pub innate: f64,
    pub adaptive: f64,
    pub memory: f64,
    pub inflammation: f64,
    pub autoimmunity: f64,
    pub pathogen_detect: f64,
    pub quarantine: f64,
    pub symbiont_tolerance: f64,
}

#[derive(Clone, Debug, Default)]
pub struct PredPreyGenes {
    pub stealth: f64,
    pub pursuit: f64,
    pub ambush: f64,
    pub pack_hunting: f64,
    pub escape_urgency: f64,
    pub warning_call: f64,
    pub mimicry: f64,
    pub aposematism: f64,
}

#[derive(Clone, Debug, Default)]
pub struct ReproGenes {
    pub sexual: f64,
    pub mate_selectivity: f64,
    pub parental_investment: f64,
    pub clutch_size: f64,
    pub generation_time: f64,
    pub senescence: f64,
    pub fecundity: f64,
    pub dormancy: f64,
}

#[derive(Clone, Debug, Default)]
pub struct MetabGenes {
    pub basal_rate: f64,
    pub aerobic: f64,
    pub anaerobic: f64,
    pub thermoregulation: f64,
    pub fat_storage: f64,
    pub sugar_metab: f64,
    pub protein_metab: f64,
    pub lipid_metab: f64,
}

#[derive(Clone, Debug, Default)]
pub struct DnaGenes {
    pub replication_fidelity: f64,
    pub repair_rate: f64,
    pub repair_accuracy: f64,
    pub gene_expression: f64,
    pub epigenetic_noise: f64,
    pub horizontal_transfer: f64,
    pub transposon_rate: f64,
    pub dna_stability: f64,
}

#[derive(Clone, Debug, Default)]
pub struct CellGenes {
    pub cell_size: f64,
    pub membrane_thickness: f64,
    pub ribosome_count: f64,
    pub mitochondria_count: f64,
    pub nucleus_size: f64,
    pub cytoskeleton: f64,
    pub vesicle_traffic: f64,
    pub cell_adhesion: f64,
}

#[derive(Clone, Debug, Default)]
pub struct MembraneGenes {
    pub permeability: f64,
    pub active_transport: f64,
    pub endocytosis: f64,
    pub exocytosis: f64,
    pub receptor_density: f64,
    pub channel_density: f64,
    pub pump_density: f64,
    pub lipid_composition: f64,
}

#[derive(Clone, Debug, Default)]
pub struct EcosystemGenes {
    pub niche_specialization: f64,
    pub competitive_ability: f64,
    pub mutualism: f64,
    pub parasitism: f64,
    pub migration: f64,
    pub territoriality: f64,
    pub keystone: f64,
    pub invasiveness: f64,
}

#[derive(Clone, Debug, Default)]
pub struct FractalGenes {
    pub c_re: f64,
    pub c_im: f64,
}

fn weight(genome: &[f32], index: usize) -> f64 {
    let v = genome.get(index).copied().unwrap_or(0.0) as f64;
    clamp01((v + 1.0) / 2.0)
}

fn clamp01(v: f64) -> f64 {
    v.max(0.0).min(1.0)
}

fn lerp(a: f64, b: f64, t: f64) -> f64 {
    a + (b - a) * t
}

/// Fast tanh (Padé approx, ~0.5% error) at full f64 precision — mirrors the TS
/// reference's `fastTanh`, which operates on JS `number` (= f64).
pub fn fast_tanh(x: f64) -> f64 {
    if x > 4.0 {
        return 1.0;
    }
    if x < -4.0 {
        return -1.0;
    }
    let x2 = x * x;
    (x * (27.0 + x2)) / (27.0 + 9.0 * x2)
}

pub fn decode_phenotype(genome: &[f32]) -> Phenotype {
    let g = |i: usize| genome.get(i).copied().unwrap_or(0.0) as f64;
    Phenotype {
        speed: lerp(0.5, 4.5, clamp01((g(0) + 1.0) / 2.0)),
        sense_radius: lerp(8.0, 64.0, clamp01((g(1) + 1.0) / 2.0)),
        metabolism: lerp(0.02, 0.25, clamp01((g(2) + 1.0) / 2.0)),
        color: [
            clamp01((g(3) + 1.0) / 2.0),
            clamp01((g(4) + 1.0) / 2.0),
            clamp01((g(5) + 1.0) / 2.0),
        ],
        size: lerp(0.5, 2.5, clamp01((g(6) + 1.0) / 2.0)),
        diet: clamp01((g(7) + 1.0) / 2.0),
        fertility: lerp(0.4, 2.0, clamp01((g(8) + 1.0) / 2.0)),
        longevity: lerp(0.5, 1.5, clamp01((g(9) + 1.0) / 2.0)),
        mutability: lerp(0.25, 2.0, clamp01((g(10) + 1.0) / 2.0)),
        capacity: 0.0,
    }
}

pub fn fractal_genes(genome: &[f32]) -> FractalGenes {
    let g = |i: usize| genome.get(i).copied().unwrap_or(0.0) as f64;
    FractalGenes {
        c_re: -2.0 + 3.0 * clamp01((g(0) + 1.0) / 2.0),
        c_im: -1.25 + 2.5 * clamp01((g(1) + 1.0) / 2.0),
    }
}

pub fn decode_drives(genome: &[f32]) -> PatternDrives {
    PatternDrives {
        alignment: weight(genome, DRIVE_OFFSET + drives::ALIGNMENT),
        cohesion: weight(genome, DRIVE_OFFSET + drives::COHESION),
        separation: weight(genome, DRIVE_OFFSET + drives::SEPARATION),
        circulation: genome
            .get(DRIVE_OFFSET + drives::CIRCULATION)
            .copied()
            .unwrap_or(0.0) as f64,
        oscillation: weight(genome, DRIVE_OFFSET + drives::OSCILLATION),
        noise: weight(genome, DRIVE_OFFSET + drives::NOISE),
    }
}

pub fn decode_strategies(genome: &[f32]) -> StrategyGenes {
    StrategyGenes {
        aggression: weight(genome, STRATEGY_OFFSET + strategies::AGGRESSION),
        cooperation: weight(genome, STRATEGY_OFFSET + strategies::COOPERATION),
        risk: weight(genome, STRATEGY_OFFSET + strategies::RISK),
        deception: weight(genome, STRATEGY_OFFSET + strategies::DECEPTION),
    }
}

pub fn decode_immune_genes(genome: &[f32]) -> ImmuneGenes {
    ImmuneGenes {
        innate: weight(genome, IMMUNE_OFFSET),
        adaptive: weight(genome, IMMUNE_OFFSET + 1),
        memory: weight(genome, IMMUNE_OFFSET + 2),
        inflammation: weight(genome, IMMUNE_OFFSET + 3),
        autoimmunity: weight(genome, IMMUNE_OFFSET + 4),
        pathogen_detect: weight(genome, IMMUNE_OFFSET + 5),
        quarantine: weight(genome, IMMUNE_OFFSET + 6),
        symbiont_tolerance: weight(genome, IMMUNE_OFFSET + 7),
    }
}

pub fn decode_predprey_genes(genome: &[f32]) -> PredPreyGenes {
    PredPreyGenes {
        stealth: weight(genome, PREDPREY_OFFSET),
        pursuit: weight(genome, PREDPREY_OFFSET + 1),
        ambush: weight(genome, PREDPREY_OFFSET + 2),
        pack_hunting: weight(genome, PREDPREY_OFFSET + 3),
        escape_urgency: weight(genome, PREDPREY_OFFSET + 4),
        warning_call: weight(genome, PREDPREY_OFFSET + 5),
        mimicry: weight(genome, PREDPREY_OFFSET + 6),
        aposematism: weight(genome, PREDPREY_OFFSET + 7),
    }
}

pub fn decode_repro_genes(genome: &[f32]) -> ReproGenes {
    ReproGenes {
        sexual: weight(genome, REPRO_OFFSET),
        mate_selectivity: weight(genome, REPRO_OFFSET + 1),
        parental_investment: weight(genome, REPRO_OFFSET + 2),
        clutch_size: weight(genome, REPRO_OFFSET + 3),
        generation_time: weight(genome, REPRO_OFFSET + 4),
        senescence: weight(genome, REPRO_OFFSET + 5),
        fecundity: weight(genome, REPRO_OFFSET + 6),
        dormancy: weight(genome, REPRO_OFFSET + 7),
    }
}

pub fn decode_metab_genes(genome: &[f32]) -> MetabGenes {
    MetabGenes {
        basal_rate: weight(genome, METAB_OFFSET),
        aerobic: weight(genome, METAB_OFFSET + 1),
        anaerobic: weight(genome, METAB_OFFSET + 2),
        thermoregulation: weight(genome, METAB_OFFSET + 3),
        fat_storage: weight(genome, METAB_OFFSET + 4),
        sugar_metab: weight(genome, METAB_OFFSET + 5),
        protein_metab: weight(genome, METAB_OFFSET + 6),
        lipid_metab: weight(genome, METAB_OFFSET + 7),
    }
}

pub fn decode_dna_genes(genome: &[f32]) -> DnaGenes {
    DnaGenes {
        replication_fidelity: weight(genome, DNA_OFFSET),
        repair_rate: weight(genome, DNA_OFFSET + 1),
        repair_accuracy: weight(genome, DNA_OFFSET + 2),
        gene_expression: weight(genome, DNA_OFFSET + 3),
        epigenetic_noise: weight(genome, DNA_OFFSET + 4),
        horizontal_transfer: weight(genome, DNA_OFFSET + 5),
        transposon_rate: weight(genome, DNA_OFFSET + 6),
        dna_stability: weight(genome, DNA_OFFSET + 7),
    }
}

pub fn decode_cell_genes(genome: &[f32]) -> CellGenes {
    CellGenes {
        cell_size: weight(genome, CELL_OFFSET),
        membrane_thickness: weight(genome, CELL_OFFSET + 1),
        ribosome_count: weight(genome, CELL_OFFSET + 2),
        mitochondria_count: weight(genome, CELL_OFFSET + 3),
        nucleus_size: weight(genome, CELL_OFFSET + 4),
        cytoskeleton: weight(genome, CELL_OFFSET + 5),
        vesicle_traffic: weight(genome, CELL_OFFSET + 6),
        cell_adhesion: weight(genome, CELL_OFFSET + 7),
    }
}

pub fn decode_membrane_genes(genome: &[f32]) -> MembraneGenes {
    MembraneGenes {
        permeability: weight(genome, MEMBRANE_OFFSET),
        active_transport: weight(genome, MEMBRANE_OFFSET + 1),
        endocytosis: weight(genome, MEMBRANE_OFFSET + 2),
        exocytosis: weight(genome, MEMBRANE_OFFSET + 3),
        receptor_density: weight(genome, MEMBRANE_OFFSET + 4),
        channel_density: weight(genome, MEMBRANE_OFFSET + 5),
        pump_density: weight(genome, MEMBRANE_OFFSET + 6),
        lipid_composition: weight(genome, MEMBRANE_OFFSET + 7),
    }
}

pub fn decode_ecosystem_genes(genome: &[f32]) -> EcosystemGenes {
    EcosystemGenes {
        niche_specialization: weight(genome, ECOSYSTEM_OFFSET),
        competitive_ability: weight(genome, ECOSYSTEM_OFFSET + 1),
        mutualism: weight(genome, ECOSYSTEM_OFFSET + 2),
        parasitism: weight(genome, ECOSYSTEM_OFFSET + 3),
        migration: weight(genome, ECOSYSTEM_OFFSET + 4),
        territoriality: weight(genome, ECOSYSTEM_OFFSET + 5),
        keystone: weight(genome, ECOSYSTEM_OFFSET + 6),
        invasiveness: weight(genome, ECOSYSTEM_OFFSET + 7),
    }
}

pub fn random_genome(rng: &mut SplitMix64) -> Vec<f32> {
    (0..GENOME_SIZE).map(|_| rng.next_signed()).collect()
}

pub fn mutate_genome_scaled(
    genome: &[f32],
    rng: &mut SplitMix64,
    rate: f64,
    sigma: f64,
) -> Vec<f32> {
    let mut child: Vec<f32> = genome.to_vec();
    while child.len() < GENOME_SIZE {
        child.push(0.0);
    }
    for i in 0..GENOME_SIZE {
        if rng.next_float64() < rate {
            let mut v = child[i] as f64 + rng.next_gaussian64() * sigma;
            v = v.max(-1.0).min(1.0);
            child[i] = v as f32;
        }
    }
    child
}

pub fn crossover_genome(a: &[f32], b: &[f32], rng: &mut SplitMix64) -> Vec<f32> {
    let point = rng.next_int(GENOME_SIZE as u32 + 1) as usize;
    let mut child = vec![0.0f32; GENOME_SIZE];
    for i in 0..GENOME_SIZE {
        child[i] = if i < point {
            a.get(i).copied().unwrap_or(0.0)
        } else {
            b.get(i).copied().unwrap_or(0.0)
        };
    }
    child
}

pub fn splice_genome(child: &mut [f32], donor: &[f32], rng: &mut SplitMix64, block_size: usize) {
    let start = rng.next_int((GENOME_SIZE - block_size + 1) as u32) as usize;
    for i in 0..block_size {
        if start + i < child.len() {
            child[start + i] = donor.get(start + i).copied().unwrap_or(0.0);
        }
    }
}

/// Phase C recombination operators (WorldConfig.recombination). Each operator
/// consumes a FIXED, documented number of random draws so the TS mirror
/// (`apps/simulation/src/genome.ts`) reproduces the child byte-for-byte.
///
/// Block layout: the genome is divided into `RECOMB_BLOCK_COUNT` contiguous
/// blocks of `GENOME_SIZE / RECOMB_BLOCK_COUNT` genes; the residual tail gene
/// (217 = 8 * 27 + 1) is left untouched by block operators, matching the TS
/// reference exactly.

/// Multi-point crossover: `n_points` segment switches between `a` (even
/// segments) and `b` (odd segments). Consumes `n_points` draws.
pub fn multi_point_crossover(
    a: &[f32],
    b: &[f32],
    rng: &mut SplitMix64,
    n_points: usize,
) -> Vec<f32> {
    let mut points: Vec<usize> = Vec::with_capacity(n_points);
    for _ in 0..n_points {
        points.push(rng.next_int(GENOME_SIZE as u32 + 1) as usize);
    }
    let mut child = vec![0.0f32; GENOME_SIZE];
    let mut from_a = true;
    let mut pi = 0;
    for (i, slot) in child.iter_mut().enumerate() {
        if pi < points.len() && i >= points[pi] {
            pi += 1;
            from_a = !from_a;
        }
        let src = if from_a { a } else { b };
        *slot = src.get(i).copied().unwrap_or(0.0);
    }
    child
}

/// Block-level shuffle: swap `RECOMB_BLOCK_COUNT / 2` random block pairs.
/// Consumes 2 draws per swap (2 * RECOMB_BLOCK_COUNT / 2 total).
pub fn block_shuffle(genome: &mut [f32], rng: &mut SplitMix64) {
    let genes = GENOME_SIZE / RECOMB_BLOCK_COUNT;
    for _ in 0..(RECOMB_BLOCK_COUNT / 2) {
        let i1 = rng.next_int(RECOMB_BLOCK_COUNT as u32) as usize;
        let i2 = rng.next_int(RECOMB_BLOCK_COUNT as u32) as usize;
        if i1 == i2 {
            continue;
        }
        for k in 0..genes {
            let pa = i1 * genes + k;
            let pb = i2 * genes + k;
            if pa < genome.len() && pb < genome.len() {
                genome.swap(pa, pb);
            }
        }
    }
}

/// Combinatorial assembly: rebuild each block by drawing its source parent
/// (0 -> `a`, otherwise `b`). Consumes one draw per block.
pub fn combinatorial_assembly(a: &[f32], b: &[f32], child: &mut [f32], rng: &mut SplitMix64) {
    let genes = GENOME_SIZE / RECOMB_BLOCK_COUNT;
    for block in 0..RECOMB_BLOCK_COUNT {
        let from_a = rng.next_int(2) == 0;
        let src = if from_a { a } else { b };
        let start = block * genes;
        let end = start + genes;
        for i in start..end {
            if i < child.len() {
                child[i] = src.get(i).copied().unwrap_or(0.0);
            }
        }
    }
}

/// Full Phase C sexual-reproduction operator: multi-point crossover, then
/// per-block combinatorial assembly, then block shuffle. Fixed draw count:
/// RECOMB_MAX_POINTS + RECOMB_BLOCK_COUNT + RECOMB_BLOCK_COUNT. Mirrored in
/// genome.ts.
pub fn recombine_genomes(a: &[f32], b: &[f32], rng: &mut SplitMix64) -> Vec<f32> {
    let mut child = multi_point_crossover(a, b, rng, RECOMB_MAX_POINTS);
    combinatorial_assembly(a, b, &mut child, rng);
    block_shuffle(&mut child, rng);
    child
}

/// Cosine similarity over the genome ([0,1]) at full f64 precision — mirrors
/// the TS reference which accumulates JS `number`s (f64).
pub fn genome_similarity(a: &[f32], b: &[f32]) -> f64 {
    let mut dot = 0.0f64;
    let mut na = 0.0f64;
    let mut nb = 0.0f64;
    for i in 0..GENOME_SIZE {
        let ai = a.get(i).copied().unwrap_or(0.0) as f64;
        let bi = b.get(i).copied().unwrap_or(0.0) as f64;
        dot += ai * bi;
        na += ai * ai;
        nb += bi * bi;
    }
    let denom = (na * nb).sqrt();
    if denom == 0.0 {
        1.0
    } else {
        dot / denom
    }
}

pub fn is_same_species(a: &[f32], b: &[f32]) -> bool {
    genome_similarity(a, b) > SPECIATION_THRESHOLD as f64
}

/// Forward pass of the genome-encoded MLP (15 -> 4 -> 7). Accumulates in f64
/// (matching TS JS numbers) and stores the result back into the f32
/// `hidden`/`out` buffers exactly like the reference's Float32Arrays.
pub fn forward_genome(
    genome: &[f32],
    sensor: &[f32],
    hidden: &mut [f32; MLP_HIDDEN],
    out: &mut [f32; MLP_OUTPUTS],
) {
    let h1_offset = BRAIN_OFFSET;
    let mut k = h1_offset;

    for j in 0..MLP_HIDDEN {
        let mut acc = genome[k + MLP_INPUTS * MLP_HIDDEN + j] as f64;
        for i in 0..MLP_INPUTS {
            acc += sensor[i] as f64 * genome[k + i * MLP_HIDDEN + j] as f64;
        }
        hidden[j] = fast_tanh(acc) as f32;
    }
    k += MLP_INPUTS * MLP_HIDDEN + MLP_HIDDEN;

    for j in 0..MLP_OUTPUTS {
        let mut acc = genome[k + MLP_HIDDEN * MLP_OUTPUTS + j] as f64;
        for i in 0..MLP_HIDDEN {
            acc += hidden[i] as f64 * genome[k + i * MLP_OUTPUTS + j] as f64;
        }
        out[j] = if j < 2 {
            fast_tanh(acc) as f32
        } else {
            (1.0 / (1.0 + (-acc).exp())) as f32
        };
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parent_a() -> Vec<f32> {
        (0..GENOME_SIZE).map(|i| i as f32 * 0.01).collect()
    }

    fn parent_b() -> Vec<f32> {
        (0..GENOME_SIZE).map(|i| -0.5 - i as f32 * 0.01).collect()
    }

    #[test]
    fn single_point_matches_legacy_crossover() {
        // With RECOMB_MAX_POINTS, kids alternate segments; a one-point run must
        // equal the legacy `crossover_genome` for the same draw stream.
        let mut r1 = SplitMix64::new(1);
        let mut r2 = SplitMix64::new(1);
        let a = parent_a();
        let b = parent_b();
        let legacy = crossover_genome(&a, &b, &mut r1);
        let mp = multi_point_crossover(&a, &b, &mut r2, 1);
        assert_eq!(legacy, mp);
    }

    #[test]
    fn recombination_draws_are_fixed_and_deterministic() {
        let a = parent_a();
        let b = parent_b();
        let mut r1 = SplitMix64::new(7);
        let mut r2 = SplitMix64::new(7);
        let c1 = recombine_genomes(&a, &b, &mut r1);
        let c2 = recombine_genomes(&a, &b, &mut r2);
        assert_eq!(c1, c2, "same seed -> same child genome");
        assert_eq!(c1.len(), GENOME_SIZE);
        // every gene is parental material (block shuffle relocates genes, so
        // values must just survive the trip, not stay at their home index)
        for (i, &v) in c1.iter().enumerate() {
            assert!(
                a.contains(&v) || b.contains(&v),
                "gene {i} not from either parent"
            );
        }
    }

    #[test]
    fn recombination_reshuffles_parent_material() {
        let a = parent_a();
        let b = parent_b();
        let mut rng = SplitMix64::new(99);
        let child = recombine_genomes(&a, &b, &mut rng);
        // The child must contain genetic material from BOTH parents.
        let has_a = child.iter().any(|&v| a.contains(&v));
        let has_b = child.iter().any(|&v| b.contains(&v));
        assert!(has_a && has_b, "recombination must mix both parents");
        // And it must differ from a plain single-point crossover child.
        let mut rng2 = SplitMix64::new(99);
        let plain = crossover_genome(&a, &b, &mut rng2);
        assert_ne!(child, plain, "block assembly + shuffle alter the linkage");
    }

    #[test]
    fn block_shuffle_permutes_blocks() {
        let genes = GENOME_SIZE / RECOMB_BLOCK_COUNT;
        // one constant gene value per block is preserved by wholesale swapping
        let mut g: Vec<f32> = (0..RECOMB_BLOCK_COUNT)
            .map(|b| b as f32 * 11.0)
            .flat_map(|r| vec![r; genes])
            .collect();
        while g.len() < GENOME_SIZE {
            g.push(0.0);
        }
        let before = g.clone();
        let mut rng = SplitMix64::new(5);
        block_shuffle(&mut g, &mut rng);
        let mut sorted = g.clone();
        let mut sorted_before = before.clone();
        sorted.sort_by(|x, y| x.partial_cmp(y).unwrap());
        sorted_before.sort_by(|x, y| x.partial_cmp(y).unwrap());
        assert_eq!(
            sorted, sorted_before,
            "shuffle only permutes, never changes values"
        );
        // blocks are swapped wholesale: every block-length span stays uniform
        for block in 0..RECOMB_BLOCK_COUNT {
            let r = g[block * genes];
            assert!(
                (0..RECOMB_BLOCK_COUNT).any(|b| b as f32 * 11.0 == r),
                "uniform block constant"
            );
            for i in block * genes..(block + 1) * genes {
                assert_eq!(g[i], r, "block {block} content survived intact");
            }
        }
    }

    #[test]
    fn combinatorial_assembly_chooses_block_level() {
        let a = parent_a();
        let b = parent_b();
        let mut rng = SplitMix64::new(3);
        let mut child = vec![0.0f32; GENOME_SIZE];
        combinatorial_assembly(&a, &b, &mut child, &mut rng);
        let genes = GENOME_SIZE / RECOMB_BLOCK_COUNT;
        for block in 0..RECOMB_BLOCK_COUNT {
            // each block is a contiguous copy of exactly one parent
            let r = a[block * genes];
            let src_a = child[block * genes] == r;
            for k in 0..genes {
                let want = if src_a {
                    a[block * genes + k]
                } else {
                    b[block * genes + k]
                };
                assert_eq!(child[block * genes + k], want, "block {block} homogeneous");
            }
        }
        let diff = child.iter().zip(a.iter()).filter(|(c, x)| c != x).count();
        assert!(diff > 0, "assembly pulls from both parents");
    }
}
