import {
  CHEM_MAX_ENZYME,
  CHEM_MAX_MOLECULE,
  DNA_OFFSET,
  ENZYME_TYPE_COUNT,
  GENOME_SIZE,
  MOLECULE_COUNT,
  OMICS_ENV_BUCKETS,
  OMICS_ENV_INDUCTION,
  OMICS_ENV_WINDOW,
  OMICS_EPI_SILENCE,
  OMICS_FLUX_CATABOLIC_BONUS,
  OMICS_FLUX_LIGASE_COST,
  OMICS_FLUX_SCALE,
  OMICS_FLUX_SPLIT,
  OMICS_FLUX_YIELD,
  OMICS_FOLD_MELT,
  OMICS_FOLD_RATE,
  OMICS_CASCADE_GAIN,
  OMICS_AGG_SEED,
  OMICS_AGG_DISSOLVE,
  OMICS_AGG_THRESHOLD,
  OMICS_BIND_WEAK,
  OMICS_BIND_STRONG,
  OMICS_SELECT_RATE,
  OMICS_LIBRARY_DECAY,
  OMICS_LIBRARY_LIGATE,
  OMICS_LIBRARY_MAX,
  OMICS_LIBRARY_SIZE,
  OMICS_MISFOLD_DECAY,
  OMICS_MRNA_BLOCKS,
  OMICS_MRNA_DECAY,
  OMICS_NOISE_GAIN,
  OMICS_NOISE_SIGMA,
  OMICS_NOISE_THETA,
  OMICS_PROTEIN_BLOCKS,
  OMICS_PROTEIN_DECAY,
  OMICS_PROTEIN_YIELD,
  OMICS_REACTION_COUNT,
  OMICS_TF_AFFINITY_K,
  OMICS_TF_REG_MAX,
  OMICS_TF_REG_MIN,
  OMICS_TF_SIGNATURE_BITS,
  OMICS_TRANSCRIBE_BASE,
  OMICS_UPR_GAIN,
  OMICS_UPR_THRESHOLD,
  PH_NEUTRAL,
  PH_RANGE,
} from '@fractal-life/shared';
import type { DnaSystem } from './dna.js';
import { decodeDnaGenes } from './dna.js';
import { decodeMetabGenes } from './genome.js';
import { SplitMix64 } from './rng.js';
import type { AgentChemistry } from './chemistry.js';

/**
 * Opt-in molecular-omics layer (WorldConfig.omics) Ã¢â‚¬â€ TS mirror of
 * crates/simulation/src/omics.rs, kept bit-for-bit compatible so the reference
 * engine can be pinned against the WASM build. Four coupled "omics" views:
 * transcriptomics (24 mrna pools), proteomics (24 protein pools), fluxomics (a
 * 6-reaction graph over the 12 molecule pools whose fluxes are APPLIED back
 * onto the pools Ã¢â‚¬â€ the active fluxome), and interactomics (cross-scale
 * aggregates). Deterministic and gated entirely behind the flag; when
 * WorldConfig.omics is off the engine performs none of these updates.
 *
 * Phase C adds, still behind the same flag:
 *   - a folding-stability landscape (sequence fingerprints -> per-block folding
 *     energy; native fractions relax toward a Boltzmann equilibrium scaled by
 *     heat; misfolded fractions degrade faster; the unfolded-protein response
 *     damps transcription),
 *   - pattern recognition (TF binding motifs + environment-signature
 *     classification from a rolling window),
 *   - combinatorial TF-promoter logic (OR/AND/NOT gates),
 *   - combinatorial library chemistry (WorldConfig.combinatorial),
 *   - stochastic gene expression + folding entropy (WorldConfig.omicsStochastic)
 *     via a per-(world, tick, agent) seed stream.
 */

export interface AgentOmics {
  /** Transcript pools (0..1), one per DNA expression block. */
  mrna: Float32Array;
  /** Protein pools (0..1). Blocks 0..=5 align to the chemistry enzyme types. */
  proteins: Float32Array;
  /** Per-block OU expression noise (Phase C stochastic gene expression). */
  noise: Float32Array;
  /** Per-block folding stability in fold-units (sequence-derived, constant). */
  stab: Float32Array;
  /** Per-block native (correctly-folded) protein fraction. */
  native: Float32Array;
  /** Per-block misfolded (aggregate-prone) protein fraction. */
  misfold: Float32Array;
  /** Per-block aggregates (Phase D folding cascade, WorldConfig.folding). */
  agg: Float32Array;
  /** Chaperone capacity scalar in [0,1] (Phase D chaperone pool). */
  chaperone: number;
  /** Per-block TF motif fingerprint (sequence-derived, constant). */
  motifs: number[];
  /** Oligomer library pools (Phase C combinatorial chemistry). */
  library: Float32Array;
  /** Rolling environment-signature history for pattern classification. */
  envHist: number[];
}

/** Read-only environmental context driving transcription induction. */
export interface OmicsEnv {
  o2: number;
  food: number;
  meat: number;
  ph: number;
  toxin: number;
  water: number;
  heat: number;
}

/** Per-agent omics telemetry for one tick. */
export interface OmicsAgg {
  expressionEntropy: number;
  transcriptActivity: number;
  proteinDiversity: number;
  proteomeLoad: number;
  pathwayFlux: number;
  fluxDiversity: number;
  regulationGating: number;
  ecCoupling: number;
  nativeFraction: number;
  misfoldLoad: number;
  foldStability: number;
  tfRegulation: number;
  envRecognition: number;
  expressionNoise: number;
  libraryDiversity: number;
  // ---- Phase-D discovery/folding observables -------------------------------
  // Fold-cluster aggregates (mirror Rust omics.rs Phase-D): discoveryRate,
  // noveltyMean, memoryDiversity, explorationFraction, behaviorNoise,
  // mutationBurstRate, chaperoneLoad, aggregateLoad, foldFidelity,
  // proteotoxicity, libraryCoverage, bindingSpecificity, combinatorialEntropy.
  discoveryRate: number;
  noveltyMean: number;
  memoryDiversity: number;
  explorationFraction: number;
  behaviorNoise: number;
  mutationBurstRate: number;
  chaperoneLoad: number;
  aggregateLoad: number;
  foldFidelity: number;
  proteotoxicity: number;
  libraryCoverage: number;
  bindingSpecificity: number;
  combinatorialEntropy: number;
  // ---- Phase-E quantum observables ----------------------------------------
  // Macroscopic-quantum reading of the SAME fold-cluster pools Phase D
  // accumulates (mirror Rust omics.rs Phase-E): decoherenceRate,
  // coherenceLifetime, tunnelingRate, zeroPointEnergy, superpositionEntropy,
  // entanglementEntropy, quantumParallelism, measurementBackaction,
  // collapseRate, quantumDiffusion, tunnelCoupling, coherenceLength,
  // quantumFidelity.
  decoherenceRate: number;
  coherenceLifetime: number;
  tunnelingRate: number;
  zeroPointEnergy: number;
  superpositionEntropy: number;
  entanglementEntropy: number;
  quantumParallelism: number;
  measurementBackaction: number;
  collapseRate: number;
  quantumDiffusion: number;
  tunnelCoupling: number;
  coherenceLength: number;
  quantumFidelity: number;
  // ---- Phase-G subatomic observables --------------------------------------
  // Subatomic reading of the SAME fold-cluster/quantum pools Phase E derives
  // (mirror Rust omics.rs Phase-G): bosonFieldIntensity, photonTransport,
  // gluonConfinement, strongCoupling, weakBosonMass, higgsMassFloor,
  // leptonMobility, electronChannel, quarkFlavorPopulation, upDownAsymmetry,
  // strangeFlavor, charmPool, protonStability.
  bosonFieldIntensity: number;
  photonTransport: number;
  gluonConfinement: number;
  strongCoupling: number;
  weakBosonMass: number;
  higgsMassFloor: number;
  leptonMobility: number;
  electronChannel: number;
  quarkFlavorPopulation: number;
  upDownAsymmetry: number;
  strangeFlavor: number;
  charmPool: number;
  protonStability: number;
  latticePeriodicity: number;
  bandGap: number;
  fermiLevel: number;
  conductionBand: number;
  valenceBand: number;
  phononFlux: number;
  excitonBinding: number;
  defectDensity: number;
  dopingLevel: number;
  carrierMobility: number;
  topologicalInvariant: number;
  moireSuperlattice: number;
  latticeThermalSusceptibility: number;
  // ---- Phase-I statistical-mechanics / information-theory observables ------
  // Thermodynamics + information reading of the SAME fold-cluster pools
  // (mirror Rust omics.rs Phase-I): boltzmannEntropy, shannonDissimilarity,
  // entropyChangeRate, gibbsFreeEnergy, entropyProduction,
  // timeReversalAsymmetry, maxwellDemonPower, demonInformationCost,
  // absoluteZeroProximity, quantumLandauerFloor, heatCapacityAnomaly,
  // kbtDamping, canonicalPartitionZ.
  boltzmannEntropy: number;
  shannonDissimilarity: number;
  entropyChangeRate: number;
  gibbsFreeEnergy: number;
  entropyProduction: number;
  timeReversalAsymmetry: number;
  maxwellDemonPower: number;
  demonInformationCost: number;
  absoluteZeroProximity: number;
  quantumLandauerFloor: number;
  heatCapacityAnomaly: number;
  kbtDamping: number;
  canonicalPartitionZ: number;
  nanoparticleSurface: number;
  nanoparticleDensity: number;
  nanoporeTransport: number;
  nanoscaleContact: number;
  molecularMachineWork: number;
  assemblerAccuracy: number;
  nanofabricationYield: number;
  dnaOrigamiStability: number;
  bionanoInterface: number;
  nanozymeActivity: number;
  colloidalStability: number;
  quantumDotBrightness: number;
  nanotoxicFlux: number;
  viralLoad: number;
  bacterialLoad: number;
  archaealDensity: number;
  fungalBiomass: number;
  protistMotility: number;
  moneraPrimordial: number;
  plantPhotosynthesis: number;
  poriferanChannel: number;
  chordateNeuralTube: number;
  piscesAquaticMetabolism: number;
  mammalThermoregulation: number;
  primateCognition: number;
  symbioticIndex: number;
  metabolicRate: number;
  cardiovascularPump: number;
  respirationEfficiency: number;
  digestiveThroughput: number;
  excretoryClearance: number;
  immuneSurveillance: number;
  neuralConductance: number;
  musculoskeletalOutput: number;
  endocrineSignaling: number;
  thermoregulationControl: number;
  fluidHomeostasis: number;
  sensoryPerception: number;
  growthReplication: number;
}

/** Engine-side accumulation bucket for the per-tick aggregates. */
export class OmicsTotals {
  expressionEntropy = 0;
  transcriptActivity = 0;
  proteinDiversity = 0;
  proteomeLoad = 0;
  pathwayFlux = 0;
  fluxDiversity = 0;
  regulationGating = 0;
  ecCoupling = 0;
  nativeFraction = 0;
  misfoldLoad = 0;
  foldStability = 0;
  tfRegulation = 0;
  envRecognition = 0;
  expressionNoise = 0;
  libraryDiversity = 0;
  discoveryRate = 0;
  noveltyMean = 0;
  memoryDiversity = 0;
  explorationFraction = 0;
  behaviorNoise = 0;
  mutationBurstRate = 0;
  chaperoneLoad = 0;
  aggregateLoad = 0;
  foldFidelity = 0;
  proteotoxicity = 0;
  libraryCoverage = 0;
  bindingSpecificity = 0;
  combinatorialEntropy = 0;
  decoherenceRate = 0;
  coherenceLifetime = 0;
  tunnelingRate = 0;
  zeroPointEnergy = 0;
  superpositionEntropy = 0;
  entanglementEntropy = 0;
  quantumParallelism = 0;
  measurementBackaction = 0;
  collapseRate = 0;
  quantumDiffusion = 0;
  tunnelCoupling = 0;
  coherenceLength = 0;
  quantumFidelity = 0;
  // ---- Phase-G subatomic totals -----------------------------------------
  bosonFieldIntensity = 0;
  photonTransport = 0;
  gluonConfinement = 0;
  strongCoupling = 0;
  weakBosonMass = 0;
  higgsMassFloor = 0;
  leptonMobility = 0;
  electronChannel = 0;
  quarkFlavorPopulation = 0;
  upDownAsymmetry = 0;
  strangeFlavor = 0;
  charmPool = 0;
  protonStability = 0;
  latticePeriodicity = 0;
  bandGap = 0;
  fermiLevel = 0;
  conductionBand = 0;
  valenceBand = 0;
  phononFlux = 0;
  excitonBinding = 0;
  defectDensity = 0;
  dopingLevel = 0;
  carrierMobility = 0;
  topologicalInvariant = 0;
  moireSuperlattice = 0;
  latticeThermalSusceptibility = 0;
  boltzmannEntropy = 0;
  shannonDissimilarity = 0;
  entropyChangeRate = 0;
  gibbsFreeEnergy = 0;
  entropyProduction = 0;
  timeReversalAsymmetry = 0;
  maxwellDemonPower = 0;
  demonInformationCost = 0;
  absoluteZeroProximity = 0;
  quantumLandauerFloor = 0;
  heatCapacityAnomaly = 0;
  kbtDamping = 0;
  canonicalPartitionZ = 0;
  nanoparticleSurface = 0;
  nanoparticleDensity = 0;
  nanoporeTransport = 0;
  nanoscaleContact = 0;
  molecularMachineWork = 0;
  assemblerAccuracy = 0;
  nanofabricationYield = 0;
  dnaOrigamiStability = 0;
  bionanoInterface = 0;
  nanozymeActivity = 0;
  colloidalStability = 0;
  quantumDotBrightness = 0;
  nanotoxicFlux = 0;
  viralLoad = 0;
  bacterialLoad = 0;
  archaealDensity = 0;
  fungalBiomass = 0;
  protistMotility = 0;
  moneraPrimordial = 0;
  plantPhotosynthesis = 0;
  poriferanChannel = 0;
  chordateNeuralTube = 0;
  piscesAquaticMetabolism = 0;
  mammalThermoregulation = 0;
  primateCognition = 0;
  symbioticIndex = 0;
  metabolicRate = 0;
  cardiovascularPump = 0;
  respirationEfficiency = 0;
  digestiveThroughput = 0;
  excretoryClearance = 0;
  immuneSurveillance = 0;
  neuralConductance = 0;
  musculoskeletalOutput = 0;
  endocrineSignaling = 0;
  thermoregulationControl = 0;
  fluidHomeostasis = 0;
  sensoryPerception = 0;
  growthReplication = 0;

  add(a: OmicsAgg): void {
    this.expressionEntropy += a.expressionEntropy;
    this.transcriptActivity += a.transcriptActivity;
    this.proteinDiversity += a.proteinDiversity;
    this.proteomeLoad += a.proteomeLoad;
    this.pathwayFlux += a.pathwayFlux;
    this.fluxDiversity += a.fluxDiversity;
    this.regulationGating += a.regulationGating;
    this.ecCoupling += a.ecCoupling;
    this.nativeFraction += a.nativeFraction;
    this.misfoldLoad += a.misfoldLoad;
    this.foldStability += a.foldStability;
    this.tfRegulation += a.tfRegulation;
    this.envRecognition += a.envRecognition;
    this.expressionNoise += a.expressionNoise;
    this.libraryDiversity += a.libraryDiversity;

    // ---- Phase-D discovery/folding totals ----------------------------------
    this.discoveryRate += a.discoveryRate;
    this.noveltyMean += a.noveltyMean;
    this.memoryDiversity += a.memoryDiversity;
    this.explorationFraction += a.explorationFraction;
    this.behaviorNoise += a.behaviorNoise;
    this.mutationBurstRate += a.mutationBurstRate;
    this.chaperoneLoad += a.chaperoneLoad;
    this.aggregateLoad += a.aggregateLoad;
    this.foldFidelity += a.foldFidelity;
    this.proteotoxicity += a.proteotoxicity;
    this.libraryCoverage += a.libraryCoverage;
    this.bindingSpecificity += a.bindingSpecificity;
    this.combinatorialEntropy += a.combinatorialEntropy;

    // ---- Phase-E quantum totals ------------------------------------------
    this.decoherenceRate += a.decoherenceRate;
    this.coherenceLifetime += a.coherenceLifetime;
    this.tunnelingRate += a.tunnelingRate;
    this.zeroPointEnergy += a.zeroPointEnergy;
    this.superpositionEntropy += a.superpositionEntropy;
    this.entanglementEntropy += a.entanglementEntropy;
    this.quantumParallelism += a.quantumParallelism;
    this.measurementBackaction += a.measurementBackaction;
    this.collapseRate += a.collapseRate;
    this.quantumDiffusion += a.quantumDiffusion;
    this.tunnelCoupling += a.tunnelCoupling;
    this.coherenceLength += a.coherenceLength;
    this.quantumFidelity += a.quantumFidelity;

    // ---- Phase-G subatomic totals ----------------------------------------
    this.bosonFieldIntensity += a.bosonFieldIntensity;
    this.photonTransport += a.photonTransport;
    this.gluonConfinement += a.gluonConfinement;
    this.strongCoupling += a.strongCoupling;
    this.weakBosonMass += a.weakBosonMass;
    this.higgsMassFloor += a.higgsMassFloor;
    this.leptonMobility += a.leptonMobility;
    this.electronChannel += a.electronChannel;
    this.quarkFlavorPopulation += a.quarkFlavorPopulation;
    this.upDownAsymmetry += a.upDownAsymmetry;
    this.strangeFlavor += a.strangeFlavor;
    this.charmPool += a.charmPool;
    this.protonStability += a.protonStability;
    this.latticePeriodicity += a.latticePeriodicity;
    this.bandGap += a.bandGap;
    this.fermiLevel += a.fermiLevel;
    this.conductionBand += a.conductionBand;
    this.valenceBand += a.valenceBand;
    this.phononFlux += a.phononFlux;
    this.excitonBinding += a.excitonBinding;
    this.defectDensity += a.defectDensity;
    this.dopingLevel += a.dopingLevel;
    this.carrierMobility += a.carrierMobility;
    this.topologicalInvariant += a.topologicalInvariant;
    this.moireSuperlattice += a.moireSuperlattice;
    this.latticeThermalSusceptibility += a.latticeThermalSusceptibility;
    this.boltzmannEntropy += a.boltzmannEntropy;
    this.shannonDissimilarity += a.shannonDissimilarity;
    this.entropyChangeRate += a.entropyChangeRate;
    this.gibbsFreeEnergy += a.gibbsFreeEnergy;
    this.entropyProduction += a.entropyProduction;
    this.timeReversalAsymmetry += a.timeReversalAsymmetry;
    this.maxwellDemonPower += a.maxwellDemonPower;
    this.demonInformationCost += a.demonInformationCost;
    this.absoluteZeroProximity += a.absoluteZeroProximity;
    this.quantumLandauerFloor += a.quantumLandauerFloor;
    this.heatCapacityAnomaly += a.heatCapacityAnomaly;
    this.kbtDamping += a.kbtDamping;
    this.canonicalPartitionZ += a.canonicalPartitionZ;
    this.nanoparticleSurface += a.nanoparticleSurface;
    this.nanoparticleDensity += a.nanoparticleDensity;
    this.nanoporeTransport += a.nanoporeTransport;
    this.nanoscaleContact += a.nanoscaleContact;
    this.molecularMachineWork += a.molecularMachineWork;
    this.assemblerAccuracy += a.assemblerAccuracy;
    this.nanofabricationYield += a.nanofabricationYield;
    this.dnaOrigamiStability += a.dnaOrigamiStability;
    this.bionanoInterface += a.bionanoInterface;
    this.nanozymeActivity += a.nanozymeActivity;
    this.colloidalStability += a.colloidalStability;
    this.quantumDotBrightness += a.quantumDotBrightness;
    this.nanotoxicFlux += a.nanotoxicFlux;
    this.viralLoad += a.viralLoad;
    this.bacterialLoad += a.bacterialLoad;
    this.archaealDensity += a.archaealDensity;
    this.fungalBiomass += a.fungalBiomass;
    this.protistMotility += a.protistMotility;
    this.moneraPrimordial += a.moneraPrimordial;
    this.plantPhotosynthesis += a.plantPhotosynthesis;
    this.poriferanChannel += a.poriferanChannel;
    this.chordateNeuralTube += a.chordateNeuralTube;
    this.piscesAquaticMetabolism += a.piscesAquaticMetabolism;
    this.mammalThermoregulation += a.mammalThermoregulation;
    this.primateCognition += a.primateCognition;
    this.symbioticIndex += a.symbioticIndex;
    this.metabolicRate += a.metabolicRate;
    this.cardiovascularPump += a.cardiovascularPump;
    this.respirationEfficiency += a.respirationEfficiency;
    this.digestiveThroughput += a.digestiveThroughput;
    this.excretoryClearance += a.excretoryClearance;
    this.immuneSurveillance += a.immuneSurveillance;
    this.neuralConductance += a.neuralConductance;
    this.musculoskeletalOutput += a.musculoskeletalOutput;
    this.endocrineSignaling += a.endocrineSignaling;
    this.thermoregulationControl += a.thermoregulationControl;
    this.fluidHomeostasis += a.fluidHomeostasis;
    this.sensoryPerception += a.sensoryPerception;
    this.growthReplication += a.growthReplication;
  }

  mean(n: number): OmicsAgg {
    const m = Math.max(1, n);
    return {
      expressionEntropy: this.expressionEntropy / m,
      transcriptActivity: this.transcriptActivity / m,
      proteinDiversity: this.proteinDiversity / m,
      proteomeLoad: this.proteomeLoad / m,
      pathwayFlux: this.pathwayFlux / m,
      fluxDiversity: this.fluxDiversity / m,
      regulationGating: this.regulationGating / m,
      ecCoupling: this.ecCoupling / m,
      nativeFraction: this.nativeFraction / m,
      misfoldLoad: this.misfoldLoad / m,
      foldStability: this.foldStability / m,
      tfRegulation: this.tfRegulation / m,
      envRecognition: this.envRecognition / m,
      expressionNoise: this.expressionNoise / m,
      libraryDiversity: this.libraryDiversity / m,

      // ---- Phase-D discovery/folding averages ---------------------------
      // (Real fold-cluster aggregates; mirror the per-tick Phase-D literal.)
      discoveryRate: this.discoveryRate / m,
      noveltyMean: this.noveltyMean / m,
      memoryDiversity: this.memoryDiversity / m,
      explorationFraction: this.explorationFraction / m,
      behaviorNoise: this.behaviorNoise / m,
      mutationBurstRate: this.mutationBurstRate / m,
      chaperoneLoad: this.chaperoneLoad / m,
      aggregateLoad: this.aggregateLoad / m,
      foldFidelity: this.foldFidelity / m,
      proteotoxicity: this.proteotoxicity / m,
      libraryCoverage: this.libraryCoverage / m,
      bindingSpecificity: this.bindingSpecificity / m,
      combinatorialEntropy: this.combinatorialEntropy / m,

      // ---- Phase-E quantum averages ------------------------------------
      // (Real fold-cluster quantum aggregates; mirror the per-tick literal.)
      decoherenceRate: this.decoherenceRate / m,
      coherenceLifetime: this.coherenceLifetime / m,
      tunnelingRate: this.tunnelingRate / m,
      zeroPointEnergy: this.zeroPointEnergy / m,
      superpositionEntropy: this.superpositionEntropy / m,
      entanglementEntropy: this.entanglementEntropy / m,
      quantumParallelism: this.quantumParallelism / m,
      measurementBackaction: this.measurementBackaction / m,
      collapseRate: this.collapseRate / m,
      quantumDiffusion: this.quantumDiffusion / m,
      tunnelCoupling: this.tunnelCoupling / m,
      coherenceLength: this.coherenceLength / m,
      quantumFidelity: this.quantumFidelity / m,

      // ---- Phase-G subatomic averages -----------------------------------
      // (Real fold-cluster quantum aggregates; mirror the per-tick literal.)
      bosonFieldIntensity: this.bosonFieldIntensity / m,
      photonTransport: this.photonTransport / m,
      gluonConfinement: this.gluonConfinement / m,
      strongCoupling: this.strongCoupling / m,
      weakBosonMass: this.weakBosonMass / m,
      higgsMassFloor: this.higgsMassFloor / m,
      leptonMobility: this.leptonMobility / m,
      electronChannel: this.electronChannel / m,
      quarkFlavorPopulation: this.quarkFlavorPopulation / m,
      upDownAsymmetry: this.upDownAsymmetry / m,
      strangeFlavor: this.strangeFlavor / m,
      charmPool: this.charmPool / m,
      protonStability: this.protonStability / m,
      latticePeriodicity: this.latticePeriodicity / m,
      bandGap: this.bandGap / m,
      fermiLevel: this.fermiLevel / m,
      conductionBand: this.conductionBand / m,
      valenceBand: this.valenceBand / m,
      phononFlux: this.phononFlux / m,
      excitonBinding: this.excitonBinding / m,
      defectDensity: this.defectDensity / m,
      dopingLevel: this.dopingLevel / m,
      carrierMobility: this.carrierMobility / m,
      topologicalInvariant: this.topologicalInvariant / m,
      moireSuperlattice: this.moireSuperlattice / m,
      latticeThermalSusceptibility: this.latticeThermalSusceptibility / m,
      boltzmannEntropy: this.boltzmannEntropy / m,
      shannonDissimilarity: this.shannonDissimilarity / m,
      entropyChangeRate: this.entropyChangeRate / m,
      gibbsFreeEnergy: this.gibbsFreeEnergy / m,
      entropyProduction: this.entropyProduction / m,
      timeReversalAsymmetry: this.timeReversalAsymmetry / m,
      maxwellDemonPower: this.maxwellDemonPower / m,
      demonInformationCost: this.demonInformationCost / m,
      absoluteZeroProximity: this.absoluteZeroProximity / m,
      quantumLandauerFloor: this.quantumLandauerFloor / m,
      heatCapacityAnomaly: this.heatCapacityAnomaly / m,
      kbtDamping: this.kbtDamping / m,
      canonicalPartitionZ: this.canonicalPartitionZ / m,
      nanoparticleSurface: this.nanoparticleSurface / m,
      nanoparticleDensity: this.nanoparticleDensity / m,
      nanoporeTransport: this.nanoporeTransport / m,
      nanoscaleContact: this.nanoscaleContact / m,
      molecularMachineWork: this.molecularMachineWork / m,
      assemblerAccuracy: this.assemblerAccuracy / m,
      nanofabricationYield: this.nanofabricationYield / m,
      dnaOrigamiStability: this.dnaOrigamiStability / m,
      bionanoInterface: this.bionanoInterface / m,
      nanozymeActivity: this.nanozymeActivity / m,
      colloidalStability: this.colloidalStability / m,
      quantumDotBrightness: this.quantumDotBrightness / m,
      nanotoxicFlux: this.nanotoxicFlux / m,
      viralLoad: this.viralLoad / m,
      bacterialLoad: this.bacterialLoad / m,
      archaealDensity: this.archaealDensity / m,
      fungalBiomass: this.fungalBiomass / m,
      protistMotility: this.protistMotility / m,
      moneraPrimordial: this.moneraPrimordial / m,
      plantPhotosynthesis: this.plantPhotosynthesis / m,
      poriferanChannel: this.poriferanChannel / m,
      chordateNeuralTube: this.chordateNeuralTube / m,
      piscesAquaticMetabolism: this.piscesAquaticMetabolism / m,
      mammalThermoregulation: this.mammalThermoregulation / m,
      primateCognition: this.primateCognition / m,
      symbioticIndex: this.symbioticIndex / m,
      metabolicRate: this.metabolicRate / m,
      cardiovascularPump: this.cardiovascularPump / m,
      respirationEfficiency: this.respirationEfficiency / m,
      digestiveThroughput: this.digestiveThroughput / m,
      excretoryClearance: this.excretoryClearance / m,
      immuneSurveillance: this.immuneSurveillance / m,
      neuralConductance: this.neuralConductance / m,
      musculoskeletalOutput: this.musculoskeletalOutput / m,
      endocrineSignaling: this.endocrineSignaling / m,
      thermoregulationControl: this.thermoregulationControl / m,
      fluidHomeostasis: this.fluidHomeostasis / m,
      sensoryPerception: this.sensoryPerception / m,
      growthReplication: this.growthReplication / m,
    };
  }
}

export function zeroOmicsAgg(): OmicsAgg {
  return {
    expressionEntropy: 0,
    transcriptActivity: 0,
    proteinDiversity: 0,
    proteomeLoad: 0,
    pathwayFlux: 0,
    fluxDiversity: 0,
    regulationGating: 0,
    ecCoupling: 0,
    nativeFraction: 0,
    misfoldLoad: 0,
    foldStability: 0,
    tfRegulation: 0,
    envRecognition: 0,
    expressionNoise: 0,
    libraryDiversity: 0,
    discoveryRate: 0,
    noveltyMean: 0,
    memoryDiversity: 0,
    explorationFraction: 0,
    behaviorNoise: 0,
    mutationBurstRate: 0,
    chaperoneLoad: 0,
    aggregateLoad: 0,
    foldFidelity: 0,
    proteotoxicity: 0,
    libraryCoverage: 0,
    bindingSpecificity: 0,
    combinatorialEntropy: 0,
    decoherenceRate: 0,
    coherenceLifetime: 0,
    tunnelingRate: 0,
    zeroPointEnergy: 0,
    superpositionEntropy: 0,
    entanglementEntropy: 0,
    quantumParallelism: 0,
    measurementBackaction: 0,
    collapseRate: 0,
    quantumDiffusion: 0,
    tunnelCoupling: 0,
    coherenceLength: 0,
    quantumFidelity: 0,
    bosonFieldIntensity: 0,
    photonTransport: 0,
    gluonConfinement: 0,
    strongCoupling: 0,
    weakBosonMass: 0,
    higgsMassFloor: 0,
    leptonMobility: 0,
    electronChannel: 0,
    quarkFlavorPopulation: 0,
    upDownAsymmetry: 0,
    strangeFlavor: 0,
    charmPool: 0,
    protonStability: 0,
    latticePeriodicity: 0,
    bandGap: 0,
    fermiLevel: 0,
    conductionBand: 0,
    valenceBand: 0,
    phononFlux: 0,
    excitonBinding: 0,
    defectDensity: 0,
    dopingLevel: 0,
    carrierMobility: 0,
    topologicalInvariant: 0,
    moireSuperlattice: 0,
    latticeThermalSusceptibility: 0,
    boltzmannEntropy: 0,
    shannonDissimilarity: 0,
    entropyChangeRate: 0,
    gibbsFreeEnergy: 0,
    entropyProduction: 0,
    timeReversalAsymmetry: 0,
    maxwellDemonPower: 0,
    demonInformationCost: 0,
    absoluteZeroProximity: 0,
    quantumLandauerFloor: 0,
    heatCapacityAnomaly: 0,
    kbtDamping: 0,
    canonicalPartitionZ: 0,
    nanoparticleSurface: 0,
    nanoparticleDensity: 0,
    nanoporeTransport: 0,
    nanoscaleContact: 0,
    molecularMachineWork: 0,
    assemblerAccuracy: 0,
    nanofabricationYield: 0,
    dnaOrigamiStability: 0,
    bionanoInterface: 0,
    nanozymeActivity: 0,
    colloidalStability: 0,
    quantumDotBrightness: 0,
    nanotoxicFlux: 0,
    viralLoad: 0,
    bacterialLoad: 0,
    archaealDensity: 0,
    fungalBiomass: 0,
    protistMotility: 0,
    moneraPrimordial: 0,
    plantPhotosynthesis: 0,
    poriferanChannel: 0,
    chordateNeuralTube: 0,
    piscesAquaticMetabolism: 0,
    mammalThermoregulation: 0,
    primateCognition: 0,
    symbioticIndex: 0,
    metabolicRate: 0,
    cardiovascularPump: 0,
    respirationEfficiency: 0,
    digestiveThroughput: 0,
    excretoryClearance: 0,
    immuneSurveillance: 0,
    neuralConductance: 0,
    musculoskeletalOutput: 0,
    endocrineSignaling: 0,
    thermoregulationControl: 0,
    fluidHomeostasis: 0,
    sensoryPerception: 0,
    growthReplication: 0,
  };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(v, hi));
}

function clamp01(v: number): number {
  return clamp(v, 0, 1);
}

// Stochastic-folding noise scale (mirrored in crates/simulation/src/omics.rs).
const FOLD_NOISE_SCALE = 0.02;
// Boltzmann fold-units scale for the folding energy (mirrored in omics.rs).
const FOLD_BOLTZMANN = 2.0;
// Hamming-distance midpoint of the TF binding sigmoid (of 12 signature bits).
const TF_BIND_MID = 8.0;
// Phase-E quantum-tunneling yield boost scale (applyFluxome), per unit of
// tunnel coupling.
const QUANTUM_TUNNEL_BOOST = 0.6;
// Phase-E quantum-decoherence penalty on catabolic energy recovery
// (applyFluxome), per unit of decoherence rate.
const QUANTUM_DECOHE_LOSS = 0.35;

/** Popcount of the low `sigBits` bits of a u32. */
function popcountMask(v: number, sigBits: number): number {
  const n = v >>> 0;
  const mask = sigBits >= 32 ? 0xffffffff : ((1 << sigBits) - 1) >>> 0;
  let x = (n & mask) >>> 0;
  let count = 0;
  while (x) {
    count += x & 1;
    x >>>= 1;
  }
  return count;
}

/** Reinterpret an f32-valued number as its 32-bit IEEE-754 bit pattern. */
const _f32buf = new Float32Array(1);
const _u32buf = new Uint32Array(_f32buf.buffer);
function f32Bits(v: number): number {
  _f32buf[0] = v;
  return _u32buf[0] >>> 0;
}

/** Environment signature: quantise six env channels into 2-bit buckets each
 * (12-bit pattern code). Mirrored in omics.rs. */
export function envSignature(env: OmicsEnv): number {
  const bucket = (v: number): number => {
    const x = clamp01(v) * (OMICS_ENV_BUCKETS - 1);
    const b = Math.min(OMICS_ENV_BUCKETS - 1, Math.max(0, Math.round(x)));
    return b;
  };
  let s = 0;
  let shift = 0;
  for (const v of [env.o2, env.food, env.meat, env.toxin, env.water, env.heat]) {
    s |= bucket(v) << shift;
    shift += 2;
  }
  return s >>> 0;
}

/** FNV-1a fold over the raw f32 bit patterns of four genome genes spread
 * across the genome Ã¢â‚¬â€ a heritable sequence fingerprint per block. Mirrored in
 * omics.rs (little-endian f32 bit reads). */
function blockMotif(genome: Float32Array, b: number): number {
  const idx = (k: number): number => {
    const i = (k * 7 + b * 11 + 5) % GENOME_SIZE;
    const v = genome[i] ?? 0;
    return f32Bits(v);
  };
  let h = 0x811c9dc5 >>> 0;
  for (let k = 0; k < 4; k++) {
    h = (Math.imul(h, 16777619) ^ idx(k)) >>> 0;
  }
  return h;
}

/** Folding stability from a sequence fingerprint (fold-units, -1..=1). */
function foldStability(motif: number): number {
  const pc = popcountMask(motif, 32) / 32;
  return pc * 2 - 1;
}

/** Boltzmann native-fraction equilibrium given stability and heat. */
function nativeEquilibrium(stab: number, heat: number): number {
  const bias = (heat - 0.5) * FOLD_BOLTZMANN;
  const e = Math.exp((stab + bias) * OMICS_FOLD_MELT);
  return 1 / (1 + e);
}

/** TF binding: sigmoid over the hamming distance (in signature bits) between
 * the regulator's motif and the promoter's signature bits. */
function tfBinding(regMotif: number, promMotif: number): number {
  const d = popcountMask(regMotif ^ promMotif, OMICS_TF_SIGNATURE_BITS);
  return 1 / (1 + Math.exp(OMICS_TF_AFFINITY_K * (d - TF_BIND_MID)));
}

/** Ligate one oligomer library pool from a deterministic molecule pair. */
const LIBRARY_PAIRS: Array<[number, number]> = Array.from(
  { length: OMICS_LIBRARY_SIZE },
  (_, k) => [k % MOLECULE_COUNT, (k * 3 + 5) % MOLECULE_COUNT],
);

/** Initial molecular-omics state, deterministic given the genome and seed. */
export function createAgentOmics(genome: Float32Array, seed: number): AgentOmics {
  const exprGene = genome[DNA_OFFSET + 3] ?? 0.5;
  const wobble = ((((seed % 7) + 7) % 7) * 0.15) / 7;
  const base = clamp01(0.5 + exprGene * 0.25 + wobble);
  const motifs: number[] = [];
  const stab = new Float32Array(OMICS_PROTEIN_BLOCKS);
  const native = new Float32Array(OMICS_PROTEIN_BLOCKS);
  for (let b = 0; b < OMICS_PROTEIN_BLOCKS; b++) {
    const m = blockMotif(genome, b);
    const s = foldStability(m);
    motifs.push(m);
    stab[b] = s;
    // Start at the folding equilibrium for the default neutral climate.
    native[b] = nativeEquilibrium(s, 0.5);
  }
  return {
    mrna: new Float32Array(OMICS_MRNA_BLOCKS).fill(base),
    proteins: new Float32Array(OMICS_PROTEIN_BLOCKS).fill(0.5),
    noise: new Float32Array(OMICS_MRNA_BLOCKS),
    stab,
    native,
    misfold: new Float32Array(OMICS_PROTEIN_BLOCKS),
    motifs,
    agg: new Float32Array(OMICS_LIBRARY_SIZE),
    chaperone: 1,
    library: new Float32Array(OMICS_LIBRARY_SIZE),
    envHist: new Array<number>(OMICS_ENV_WINDOW).fill(0),
  };
}

/** Shannon entropy over a set of non-negative abundances (bits). */
function shannonBits(counts: ArrayLike<number>): number {
  let total = 0;
  for (let i = 0; i < counts.length; i++) total += counts[i] ?? 0;
  if (total <= 0) return 0;
  let h = 0;
  for (let i = 0; i < counts.length; i++) {
    const c = counts[i] ?? 0;
    if (c > 0) {
      const p = c / total;
      h -= p * Math.log2(p);
    }
  }
  return h;
}

/**
 * Advance one agent's molecular pools for a tick and return the telemetry.
 * Mutates `omics` and applies the computed reaction fluxes (and the Phase C
 * library ligation) to `chem.molecules`. The DNA, energy and non-target pools
 * are untouched.
 */
export function tickOmics(
  omics: AgentOmics,
  genome: Float32Array,
  dna: DnaSystem,
  chem: AgentChemistry,
  env: OmicsEnv,
  dt: number,
  seed: number,
  stochastic: boolean,
  combinatorial: boolean,
): OmicsAgg {
  const dnaGenes = decodeDnaGenes(genome);
  const metabGenes = decodeMetabGenes(genome);

  const baseScale = 0.5 + 0.5 * dnaGenes.geneExpression;
  const proteinYield = OMICS_PROTEIN_YIELD * (0.5 + 0.5 * metabGenes.proteinMetab);

  // Environment signals (inducible/repressible transcription).
  const o2S = clamp01(env.o2);
  const foodS = clamp01(env.food);
  const meatS = clamp01(env.meat);
  const toxS = clamp01(env.toxin);
  const phMod = Math.max(0.1, 1 - Math.abs(env.ph - PH_NEUTRAL) / PH_RANGE);
  const heat = clamp01(env.heat);
  const atpFrac = clamp01((chem.molecules[0] ?? 0) / CHEM_MAX_MOLECULE);

  const nT = OMICS_MRNA_BLOCKS;
  const nP = OMICS_PROTEIN_BLOCKS;

  // ---- Pattern recognition: environment signature + classification --------
  const envSig = envSignature(env);
  omics.envHist.push(envSig);
  if (omics.envHist.length > OMICS_ENV_WINDOW) {
    omics.envHist.shift();
  }
  const envAffinity = (motif: number): number => {
    return 1 - popcountMask(motif ^ envSig, OMICS_TF_SIGNATURE_BITS) / OMICS_TF_SIGNATURE_BITS;
  };

  // ---- Unfolded-protein response ----------------------------------------
  let totalProt = 0;
  let totalMis = 0;
  for (let b = 0; b < nP; b++) {
    totalProt += omics.proteins[b] ?? 0;
    totalMis += omics.misfold[b] ?? 0;
  }
  const misfoldFrac = totalMis / (totalProt + 1e-9);
  const upr = clamp01((misfoldFrac - OMICS_UPR_THRESHOLD) / OMICS_UPR_THRESHOLD);
  const uprDamp = 1 / (1 + OMICS_UPR_GAIN * upr);

  // Stochastic draws (per-block OU process).  When the flag is off no RNG is
  // consumed, keeping the deterministic core bit-stable.
  const rng = new SplitMix64(seed >>> 0);
  let noiseMean = 0;
  let tfRegSum = 0;
  let envRecSum = 0;
  let aggSum = 0;
  let natSum = 0;
  let misSum = 0;
  let natEqSum = 0;

  // ---- Transcription (transcriptomics) ---------------------------------
  const synth = new Array<number>(nT).fill(0);
  for (let b = 0; b < nT; b++) {
    let sigB: number;
    switch (b) {
      case 0: sigB = 0.3 + 0.7 * o2S; break; // oxidase: O2-inducible
      case 1: sigB = 0.3 + 0.5 * foodS + 0.2 * meatS; break; // synthase
      case 2: sigB = 0.3 + 0.5 * (1 - foodS); break; // hydrolase: hunger-gated
      case 3: sigB = 0.3 + 0.5 * foodS; break; // ligase: anabolic, fed
      case 4: sigB = 0.3 + 0.5 * foodS + 0.2 * o2S; break; // polymerase: growth
      case 5: sigB = 0.3 + 0.5 * (1 - foodS); break; // lyase: scarcity
      default: sigB = 0.5 + 0.25 * foodS + 0.25 * o2S; break;
    }
    const sig = clamp01(sigB);
    const epiGate = 1 - (dna.epigenetic[b] ?? 0) * OMICS_EPI_SILENCE;
    const base = dna.expression[b] ?? 0.5;
    const envFactor = (0.6 + OMICS_ENV_INDUCTION * sig) * (1 - toxS * 0.5) * (0.7 + 0.3 * clamp01(env.water));

    // Stochastic gene expression: per-block OU noise into the transcription rate.
    if (stochastic) {
      const nb = omics.noise[b] ?? 0;
      const g = rng.nextGaussian();
      const no = clamp(
        nb + (0 - nb) * OMICS_NOISE_THETA * dt + OMICS_NOISE_SIGMA * Math.sqrt(dt) * g,
        -1,
        1,
      );
      omics.noise[b] = no;
      noiseMean += Math.abs(no);
    }

    // Combinatorial TF-promoter logic: two regulators gate the promoter.
    const r1 = (b * 3 + 1 + 5) % 24;
    const r2 = (b * 5 + 2 + 5) % 24;
    const mB = omics.motifs[b] ?? 0;
    const b1 = tfBinding(omics.motifs[r1] ?? 0, mB) * (omics.native[r1] ?? 0);
    const b2 = tfBinding(omics.motifs[r2] ?? 0, mB) * (omics.native[r2] ?? 0);
    let gate: number;
    switch (b % 3) {
      case 0: gate = 1 - (1 - b1) * (1 - b2); break; // OR
      case 1: gate = b1 * b2; break; // AND
      default: gate = 1 - 0.5 * (b1 + b2); break; // NOT regulator pair
    }
    const regFactor = OMICS_TF_REG_MIN + (OMICS_TF_REG_MAX - OMICS_TF_REG_MIN) * clamp01(gate);
    tfRegSum += regFactor;

    // Environment pattern recognition: induced on fingerprint match.
    const envAff = envAffinity(mB);
    const envMod = 0.7 + 1.3 * envAff;
    envRecSum += envAff;

    const noiseMod = stochastic ? clamp(1 + 2 * OMICS_NOISE_GAIN * omics.noise[b]!, 0.1, 3) : 1;

    const s = OMICS_TRANSCRIBE_BASE * base * epiGate * envFactor * baseScale * regFactor * envMod * uprDamp * noiseMod * dt;
    synth[b] = s;
    const old = omics.mrna[b] ?? 0;
    omics.mrna[b] = clamp(old + s - old * OMICS_MRNA_DECAY * dt, 0, 1);
  }

  // ---- Translation (proteomics) + folding stability landscape ------------
  for (let b = 0; b < nP; b++) {
    const m = omics.mrna[b] ?? 0;
    const old = omics.proteins[b] ?? 0;
    const protNew = clamp(old + m * proteinYield * dt - old * OMICS_PROTEIN_DECAY * dt, 0, 1);
    omics.proteins[b] = protNew;

    const stab = omics.stab[b] ?? 0;
    const natEq = nativeEquilibrium(stab, heat);
    const natCur = omics.native[b] ?? 0;
    let natTgt = natCur + (natEq - natCur) * OMICS_FOLD_RATE * dt;
    if (stochastic) {
      const g = rng.nextGaussian();
      natTgt += g * FOLD_NOISE_SCALE * Math.sqrt(dt);
    }
    natTgt = clamp01(natTgt);
    const dm = m * proteinYield * dt;
    const addNat = dm * natTgt;
    const addMis = dm * (1 - natTgt);
    const natNext = clamp(natCur + addNat - natCur * OMICS_PROTEIN_DECAY * dt, 0, 1);
    const misCur = omics.misfold[b] ?? 0;
    const misNext = clamp(misCur + addMis - misCur * OMICS_MISFOLD_DECAY * dt, 0, 1);
    omics.native[b] = natNext;
    omics.misfold[b] = misNext;

    const aggCur = omics.agg[b] ?? 0;
    const cascade = 1 + OMICS_CASCADE_GAIN * Math.max(aggCur -  0);
    const aggNext = clamp(
      aggCur + m * proteinYield * dt * (1 - natTgt) * OMICS_AGG_SEED * cascade -
        aggCur * OMICS_AGG_DISSOLVE * dt,
      0,
      1,
    );
    omics.agg[b] = aggNext;
    aggSum += aggNext;

    natSum += natNext;
    misSum += misNext;
    natEqSum += natEq;
  }

  // ---- Fluxomics ---------------------------------------------------------
  const mol = chem.molecules;
  const molAt = (i: number): number => mol[i] ?? 0;
  const drive = (a: number, b: number | undefined): number => {
    const v = b === undefined ? molAt(a) : Math.min(molAt(a), molAt(b));
    return clamp01(v / 10);
  };
  const flux = new Array<number>(Math.min(OMICS_REACTION_COUNT, 6)).fill(0);
  let totalFlux = 0;
  for (let i = 0; i < flux.length; i++) {
    const catalyst = clamp01(0.5 * (omics.native[i] ?? 0) + 0.5 * ((chem.enzymes[i] ?? 0) / CHEM_MAX_ENZYME));
    let subA: number;
    let subB: number | undefined;
    let cofactor: number;
    switch (i) {
      case 0: subA = 9; subB = undefined; cofactor = o2S; break; // oxidase: sugar + O2
      case 1: subA = 2; subB = undefined; cofactor = 1; break; // synthase
      case 2: subA = 6; subB = undefined; cofactor = atpFrac < 0.2 ? 1 : 0.35; break; // hydrolase
      case 3: subA = 10; subB = undefined; cofactor = atpFrac; break; // ligase
      case 4: subA = 0; subB = 4; cofactor = atpFrac * 0.8; break; // polymerase
      default: subA = 0; subB = undefined; cofactor = 1 - foodS * 0.7; break; // lyase
    }
    const f = OMICS_FLUX_SCALE * catalyst * drive(subA, subB) * cofactor * phMod * dt;
    flux[i] = f;
    totalFlux += f;
  }

  // ---- Combinatorial library chemistry --------------------------------
  // Fold-cluster aggregates hoisted to function scope: they feed the Phase-D
  // discovery/folding observables below even when combinatorial screen is off.
  let covered = 0;
  let meanAff = 0;
  if (combinatorial) {
    let screen = 0;
    for (let i = 0; i < Math.min(ENZYME_TYPE_COUNT, 6); i++) {
      screen += omics.native[i] ?? 0;
    }
    screen /= Math.min(ENZYME_TYPE_COUNT, 6);
    const affs = new Array<number>(OMICS_LIBRARY_SIZE).fill(0);
    let affSum = 0;
    for (let k = 0; k < OMICS_LIBRARY_SIZE; k++) {
      const [i, j] = LIBRARY_PAIRS[k]!;
      const av = clamp01((mol[i] ?? 0) / 10) * clamp01((mol[j] ?? 0) / 10);
      const lig = OMICS_LIBRARY_LIGATE * av * screen * dt;
      mol[i] = Math.max(0, (mol[i] ?? 0) - lig);
      mol[j] = Math.max(0, (mol[j] ?? 0) - lig);
      const oldLib = omics.library[k] ?? 0;
      let libNew = clamp(oldLib + lig - oldLib * OMICS_LIBRARY_DECAY * dt, 0, OMICS_LIBRARY_MAX);
      const aff = clamp01(omics.native[i] ?? 0) * clamp01(omics.native[j] ?? 0);
      affs[k] = aff;
      affSum += aff;
      if (aff < OMICS_BIND_WEAK) {
        libNew = Math.max(0, libNew - OMICS_SELECT_RATE * (OMICS_BIND_WEAK - aff) * dt);
      } else if (aff >= OMICS_BIND_STRONG) {
        libNew = clamp(libNew + OMICS_SELECT_RATE * (aff - OMICS_BIND_STRONG) * dt, 0, OMICS_LIBRARY_MAX);
      }
      if (libNew > 0.01) covered++;
      omics.library[k] = libNew;
    }
    const coveredCount = covered;
    meanAff = affSum / OMICS_LIBRARY_SIZE;
  }

  // ---- Interactomics aggregates ------------------------------------------
  const expressionEntropy = shannonBits(omics.mrna);
  let transcriptActivity = 0;
  for (let i = 0; i < nT; i++) transcriptActivity += synth[i] ?? 0;
  transcriptActivity /= nT;
  const proteinH = shannonBits(omics.proteins);
  const proteinDiversity = proteinH > 0 ? Math.exp(proteinH) : 1;
  let proteomeLoad = 0;
  for (let i = 0; i < nP; i++) proteomeLoad += omics.proteins[i] ?? 0;
  proteomeLoad /= nP;
  const nativeFraction = natSum / nP;
  const misfoldLoad = misSum / nP;
  const foldStabilityAgg = natEqSum / nP;
  const tfRegulation = tfRegSum / nT;
  const envRecognition = envRecSum / nT;
  const expressionNoise = stochastic ? noiseMean / nT : 0;

  let silence = 0;
  for (let b = 0; b < nT; b++) silence += (dna.epigenetic[b] ?? 0) * OMICS_EPI_SILENCE;
  const regulationGating = 1 - silence / nT;

  let cp = 0;
  let up = 0;
  let ue = 0;
  for (let i = 0; i < ENZYME_TYPE_COUNT; i++) {
    const p = omics.native[i] ?? 0;
    const e = (chem.enzymes[i] ?? 0) / CHEM_MAX_ENZYME;
    cp += p * e;
    up += p * p;
    ue += e * e;
  }
  const ecCoupling = up > 1e-9 && ue > 1e-9 ? cp / (Math.sqrt(up) * Math.sqrt(ue)) : 0;

  // ---- Phase E: quantum observables ------------------------------------
  // Macroscopic-quantum reading of the SAME fold-cluster pools Phase D
  // accumulates (mirror Rust omics.rs Phase-E). Zero never appears in the live
  // lane: every observable derives from pool geometry and folding physics above.
  const foldTotal = natSum + misSum + aggSum + 1e-9;
  const foldFid = natSum / foldTotal;
  const aggLoadE = aggSum / Math.max(1, nP);
  const protoToxE = clamp01((misSum + 2 * aggSum) / (nP * OMICS_AGG_THRESHOLD));
  const libCovE = covered / OMICS_LIBRARY_SIZE;
  const decoherenceRate = clamp01(0.45 * heat + 0.35 * protoToxE + 0.2 * expressionNoise);
  const coherenceLifetime = clamp01(foldFid * (1 - decoherenceRate) * (0.6 + 0.4 * (omics.chaperone ?? 1)));
  const tunnelBarrier = Math.max(0, 2 * (1 - ecCoupling) + 1.5 * misfoldLoad + 0.5 * (1 - libCovE));
  const tunnelingRate = clamp01(Math.exp(-tunnelBarrier));
  const zeroPointEnergy = clamp01(0.6 * (1 - foldStabilityAgg) + 0.4 * protoToxE);
  const superpositionEntropy = shannonBits([natSum, misSum, aggSum]);
  const entanglementEntropy = clamp01((expressionEntropy / nT) * (misfoldLoad + aggLoadE) * 4);
  const quantumParallelism = clamp01((proteinDiversity / nP) * foldFid * (0.5 + 0.5 * libCovE));
  const measurementBackaction = clamp01(0.5 * (meanAff + (1 - foldFid)) + 0.25 * expressionNoise);
  const collapseRate = clamp01(1 - superpositionEntropy / Math.log2(3));
  const quantumDiffusion = clamp01(
    (0.75 * shannonBits(flux)) / Math.log2(OMICS_REACTION_COUNT) + 0.25 * heat * expressionNoise,
  );
  const tunnelCoupling = clamp01(
    0.4 * ecCoupling +
      0.3 * Math.min(1, totalFlux / (OMICS_FLUX_SCALE * OMICS_REACTION_COUNT)) +
      0.3 * nativeFraction,
  );
  const coherenceLength = clamp01(foldFid * (0.4 + 0.6 * libCovE));
  const quantumFidelity = clamp01(nativeFraction) * (1 - decoherenceRate) * (1 - 0.5 * aggLoadE);

  // ---- Phase G: subatomic observables -----------------------------------
  // Subatomic reading of the SAME fold-cluster/quantum pools Phase D/Phase E
  // accumulate (mirror Rust omics.rs Phase-G): boson / lepton / quark
  // phenomenology mapped onto the real chemistry and quantum aggregates above
  // (never stubs).  photonTransport, gluonConfinement and
  // quarkFlavorPopulation additionally feed forward into applyFluxome() as the
  // Phase-G chemistry couplings (EM channel / strong binding / flavor pop).
  const bosonFieldIntensity = clamp01(0.6 * ecCoupling + 0.4 * nativeFraction);
  const photonTransport = clamp01(
    0.7 * clamp01(1 - decoherenceRate) * clamp01(heat * expressionNoise) +
      0.3 * Math.min(1, totalFlux / (OMICS_FLUX_SCALE * OMICS_REACTION_COUNT)),
  );
  const gluonConfinement = clamp01(meanAff * foldFid + 0.4 * protoToxE);
  const strongCoupling = clamp01(0.7 * foldFid + 0.3 * nativeFraction);
  const weakBosonMass = clamp01(zeroPointEnergy * (1 - 0.5 * collapseRate));
  const higgsMassFloor = clamp01((1 - foldStabilityAgg) * 0.5 + 0.5 * zeroPointEnergy);
  const leptonMobility = clamp01(
    0.25 * (expressionEntropy / Math.log2(nT)) +
      0.25 * (proteinH / Math.log2(nP)) +
      0.5 * (1 - aggLoadE),
  );
  const electronChannel = clamp01(0.5 * ecCoupling + 0.5 * photonTransport);
  const comEntropy = shannonBits(omics.library);
  const quarkFlavorPopulation = clamp01(
    0.5 * (comEntropy / Math.log2(OMICS_LIBRARY_SIZE)) + 0.5 * comEntropy,
  );
  const upDownAsymmetry = clamp01(0.5 + 0.5 * (meanAff - misfoldLoad));
  const strangeFlavor = clamp01(0.4 * coherenceLifetime + 0.6 * tunnelCoupling * (1 - collapseRate));
  const charmPool = clamp01(0.3 * zeroPointEnergy + 0.7 * (superpositionEntropy / Math.log2(3)));
  const protonStability = clamp01((1 - aggLoadE) * (1 - 0.5 * decoherenceRate));

  // ---- Phase H: quantum-materials observables ------------------------------
  // Condensed-matter reading of the SAME fold-cluster pools Phase D/E/G
  // accumulate (mirror Rust omics.rs Phase-H).  latticePeriodicity,
  // dopingLevel and carrierMobility additionally feed forward into
  // applyFluxome() as the Phase-H chemistry couplings (periodic-lattice
  // anabolic yield / doped conductive leakage-recovery / carrier energy
  // escape).
  const latticePeriodicity = clamp01((0.5 * foldFid + 0.5 * nativeFraction) * (1 - 0.5 * aggLoadE));
  const bandGap = clamp01((1 - leptonMobility) * (0.5 + 0.5 * zeroPointEnergy));
  const fermiLevel = clamp01(0.6 * nativeFraction + 0.4 * (1 - aggLoadE));
  const conductionBand = clamp01(0.4 * electronChannel + 0.6 * expressionNoise * (1 - bandGap));
  const valenceBand = clamp01(0.5 * meanAff + 0.5 * (1 - electronChannel));
  const phononFlux = clamp01(0.6 * clamp01(heat * leptonMobility) + 0.4 * tunnelCoupling);
  const excitonBinding = clamp01(meanAff * photonTransport * (1 - decoherenceRate));
  const defectDensity = clamp01(0.5 * misfoldLoad + 0.5 * aggLoadE);
  const dopingLevel = clamp01(0.5 * strangeFlavor + 0.5 * charmPool);
  const carrierMobility = clamp01(electronChannel * (1 - defectDensity) * (0.5 + 0.5 * coherenceLifetime));
  const topologicalInvariant = clamp01((0.5 * quantumParallelism + 0.5 * (1 - strangeFlavor)) * (1 - 0.25 * collapseRate));
  const moireSuperlattice = clamp01(0.5 * (superpositionEntropy / Math.log2(3)) + 0.5 * libCovE);
  const latticeThermalSusceptibility = clamp01((1 - heat) * latticePeriodicity);

  // ---- Phase I: statistical-mechanics / information-theory observables ------
  // Thermodynamics + information reading of the SAME fold-cluster pools
  // Phase D/E/G/H accumulate (mirror Rust omics.rs Phase-I, order preserved:
  // shannonDissimilarity before entropyChangeRate; entropyProduction before
  // absoluteZeroProximity).  maxwellDemonPower, absoluteZeroProximity and
  // kbtDamping additionally feed forward into applyFluxome() as the Phase-I
  // chemistry couplings (demon sorting / cryogenic ATP preservation / thermal
  // degradation cost).
  const boltzmannEntropy = clamp01(
    0.7 * (shannonBits(omics.proteins) / Math.log2(nP)) + 0.3 * (1 - nativeFraction),
  );
  const shannonDissimilarity = clamp01(Math.abs(expressionEntropy - proteinH) / Math.log2(nP));
  const entropyChangeRate = clamp01(0.5 * shannonDissimilarity + 0.5 * clamp01(heat * expressionNoise));
  const gibbsFreeEnergy = clamp01((1 - heat) * foldFid * (1 - 0.4 * aggLoadE));
  const entropyProduction = clamp01(0.4 * misfoldLoad + 0.4 * aggLoadE + 0.2 * decoherenceRate);
  const timeReversalAsymmetry = clamp01(0.5 * entropyChangeRate + 0.5 * decoherenceRate);
  const maxwellDemonPower = clamp01(
    measurementBackaction * (1 - decoherenceRate) * (0.5 + 0.5 * latticePeriodicity),
  );
  const demonInformationCost = clamp01(0.4 * (superpositionEntropy / Math.log2(3)) + 0.6 * expressionNoise);
  // absoluteZeroProximity depends on entropyProduction -> define after it.
  const absoluteZeroProximity = clamp01((1 - heat) * (1 - 0.5 * entropyProduction));
  const quantumLandauerFloor = clamp01((1 - quantumFidelity) * (0.5 + 0.5 * heat));
  const heatCapacityAnomaly = clamp01((1 - Math.abs(foldFid - fermiLevel)) * (1 - heat));
  const kbtDamping = clamp01(heat * (1 - latticePeriodicity));
  const canonicalPartitionZ = clamp01(
    0.6 * (shannonBits(flux) / Math.log2(OMICS_REACTION_COUNT)) + 0.4 * (1 - aggLoadE),
  );

  // ---- Phase J nanosystems observables --------------------------------------
  // nanochemistry / nanobiology / nanosystems / nanoparticles — the dispersed
  // crystallite surfaces, the molecular assembler and the intra-cell
  // therapeutic delivery lane — every observable maps nanometer-scale
  // engineering onto the real pools and the quantum / materials / statistical
  // aggregates above (mirror Rust omics.rs Phase-J, never stubs).
  // nanoparticleSurface, assemblerAccuracy and colloidalStability additionally
  // feed forward into applyFluxome() as the Phase-J chemistry couplings
  // (reaction-surface catalysis / assembler protein yield / colloid delivery).
  const nanoparticleSurface = clamp01(
    (1 - latticeThermalSusceptibility) * (1 - 0.4 * absoluteZeroProximity),
  );
  const nanoparticleDensity = clamp01((0.5 + 0.5 * heat) * (0.5 + 0.5 * nanoparticleSurface));
  const nanoporeTransport = clamp01(
    (0.5 + 0.5 * electronChannel) * (1 - defectDensity) * (1 - 0.4 * kbtDamping),
  );
  const nanoscaleContact = clamp01(
    (1 - Math.abs(bandGap * fermiLevel - topologicalInvariant)) * (0.5 + 0.5 * heat),
  );
  const molecularMachineWork = clamp01(
    maxwellDemonPower * (0.5 + 0.5 * superpositionEntropy) * (0.3 + 0.7 * heat),
  );
  const assemblerAccuracy = clamp01((0.7 - foldFid) + 0.5 * (1 - expressionNoise));
  const nanofabricationYield = clamp01(0.5 * (foldFid - aggLoadE) + 0.5 * (1 - protoToxE));
  const dnaOrigamiStability = clamp01(
    latticeThermalSusceptibility * (1 - 0.3 * expressionNoise) - 0.2 * kbtDamping + 0.35,
  );
  const bionanoInterface = clamp01((0.6 * nativeFraction + 0.4 * nanoparticleSurface) * foldFid);
  // nanozymeActivity depends on electronChannel and bindingSpecificity (both
  // defined in earlier phases) -> fall-through order is safe here.
  const nanozymeActivity = clamp01(
    (0.5 + 0.5 * electronChannel) * (0.5 + 0.5 * meanAff) * (1 - heat),
  );
  const colloidalStability = clamp01(
    (1 - misfoldLoad - aggLoadE) * (1 - 0.5 * canonicalPartitionZ) * (0.7 + 0.3 * (1 - protoToxE)),
  );
  const quantumDotBrightness = clamp01(
    colloidalStability * (0.5 + 0.5 * quantumParallelism) * (1 - heat) * latticePeriodicity,
  );
  const nanotoxicFlux = clamp01(
    nanoparticleDensity * (0.5 + 0.5 * (1 - canonicalPartitionZ)) * (1 - 0.5 * (protoToxE * misfoldLoad)),
  );

  // ---- Phase K reverse-engineered phylogeny observables ---------------------
  // score each lineage as a REAL signature of the same fold-cluster, quantum,
  // materials, statistical and nanosystems aggregates above — virus, bacteria,
  // archaea, fungi, protists, monera, plants, animals from porifera up through
  // chordates, pisces and mammals to (toward) humans, plus the cross-taxa
  // symbiotic coupling signal (mirror Rust omics.rs Phase-K, never stubs).
  // viralLoad, symbioticIndex and mammalThermoregulation additionally feed
  // forward into applyFluxome() as the Phase-K chemistry couplings (lytic
  // amino-acid release / symbiotic cooperativity / warm-blood oxidative
  // throughput).
  const viralLoad = clamp01(
    (1 - foldFid) * (0.5 + 0.5 * expressionNoise) * (0.5 + 0.5 * decoherenceRate),
  );
  const bacterialLoad = clamp01(
    (1 - latticePeriodicity) * (0.5 + 0.5 * heat) * (0.6 + 0.4 * expressionNoise),
  );
  const archaealDensity = clamp01(
    (0.5 + 0.5 * heat) * (1 - 0.5 * misfoldLoad) * (0.5 + 0.5 * nativeFraction),
  );
  const fungalBiomass = clamp01(
    latticePeriodicity * (0.5 + 0.5 * heat) * (1 - 0.4 * aggLoadE),
  );
  const protistMotility = clamp01(
    (0.5 + 0.5 * carrierMobility) * (0.5 + 0.5 * heat) * (1 - latticePeriodicity),
  );
  const moneraPrimordial = clamp01(
    (1 - foldFid) * (1 - canonicalPartitionZ) * (0.5 + 0.5 * photonTransport),
  );
  const plantPhotosynthesis = clamp01(
    photonTransport * electronChannel * (1 - heat) * latticePeriodicity,
  );
  const poriferanChannel = clamp01(
    nanoporeTransport * (0.5 + 0.5 * photonTransport) * (1 - heat),
  );
  const chordateNeuralTube = clamp01(
    measurementBackaction * (1 - decoherenceRate) * (0.5 + 0.5 * quantumParallelism),
  );
  const piscesAquaticMetabolism = clamp01(
    (1 - heat) * (0.5 + 0.5 * carrierMobility) * (1 - 0.3 * entropyProduction),
  );
  const mammalThermoregulation = clamp01(
    heat * (0.5 + 0.5 * foldFid) * (0.5 + 0.5 * quantumFidelity),
  );
  const primateCognition = clamp01(
    (0.5 + 0.5 * maxwellDemonPower) * (0.5 + 0.5 * quantumParallelism) * (0.3 + 0.7 * foldFid),
  );
  const symbioticIndex = clamp01(
    nativeFraction * (0.5 + 0.5 * ecCoupling) * (1 - 0.5 * misfoldLoad),
  );

  // ---- Phase L reverse-engineered physiology observables --------------------
  // score each physiological system as a REAL aggregate over the same pools
  // and the phylogeny / quantum / materials / statistical / nanosystems
  // readings above — metabolism, circulation, respiration, digestion,
  // excretion, immunity, neural control, musculoskeletal work, endocrine
  // signalling, thermoregulation, fluid balance, sensation and
  // growth/replication (mirror Rust omics.rs Phase-L, never stubs).
  // metabolicRate, digestiveThroughput and immuneSurveillance additionally
  // feed forward into applyFluxome() as the Phase-L chemistry couplings
  // (anabolic drive / hydrolytic throughput / membrane defence).
  const metabolicRate = clamp01((0.5 + 0.5 * heat) * (1 - 0.5 * entropyProduction));
  const cardiovascularPump = clamp01(
    (0.5 + 0.5 * carrierMobility) * (0.5 + 0.5 * nanoporeTransport),
  );
  const respirationEfficiency = clamp01(
    photonTransport * (0.5 + 0.5 * quantumFidelity) * (1 - 0.3 * aggLoadE),
  );
  const digestiveThroughput = clamp01(
    (0.5 + 0.5 * nanozymeActivity) * (1 - 0.4 * misfoldLoad) * (0.5 + 0.5 * heat),
  );
  const excretoryClearance = clamp01(
    (1 - protoToxE) * (1 - 0.5 * aggLoadE) * (0.5 + 0.5 * nanoporeTransport),
  );
  const immuneSurveillance = clamp01(
    (0.5 + 0.5 * ecCoupling) * (1 - viralLoad) * (1 - 0.5 * protoToxE),
  );
  const neuralConductance = clamp01(
    (0.5 + 0.5 * electronChannel) * (1 - decoherenceRate) * (0.5 + 0.5 * quantumParallelism),
  );
  const musculoskeletalOutput = clamp01(
    (0.5 + 0.5 * nanoscaleContact) * (0.5 + 0.5 * molecularMachineWork) * (0.3 + 0.7 * heat),
  );
  const endocrineSignaling = clamp01(
    (0.5 + 0.5 * canonicalPartitionZ) * (0.5 + 0.5 * maxwellDemonPower),
  );
  const thermoregulationControl = clamp01(
    mammalThermoregulation * (1 - heatCapacityAnomaly) * (0.5 + 0.5 * latticeThermalSusceptibility),
  );
  const fluidHomeostasis = clamp01(
    colloidalStability * (0.5 + 0.5 * canonicalPartitionZ) * (1 - 0.4 * nanotoxicFlux),
  );
  const sensoryPerception = clamp01(
    measurementBackaction * (1 - expressionNoise) * (0.5 + 0.5 * quantumFidelity),
  );
  const growthReplication = clamp01(
    (0.5 + 0.5 * assemblerAccuracy) * (1 - 0.5 * aggLoadE) * foldFid,
  );

  const agg: OmicsAgg = {
    expressionEntropy,
    transcriptActivity,
    proteinDiversity,
    proteomeLoad,
    pathwayFlux: totalFlux,
    fluxDiversity: shannonBits(flux),
    regulationGating,
    ecCoupling,
    nativeFraction,
    misfoldLoad,
    foldStability: foldStabilityAgg,
    tfRegulation,
    envRecognition,
    expressionNoise,
    libraryDiversity: shannonBits(omics.library),

    // ---- Phase D discovery/folding observables ---------------------------
    // (Real Phase-F fold-cluster aggregates, mirroring Rust omics.rs Phase-D
    // observables: discoveryRate/noveltyMean/memoryDiversity/... )
    discoveryRate: covered / OMICS_LIBRARY_SIZE,
    noveltyMean: natSum / Math.max(1, nP),
    memoryDiversity: shannonBits(omics.library) / OMICS_LIBRARY_SIZE,
    explorationFraction: covered / OMICS_LIBRARY_SIZE,
    behaviorNoise: expressionNoise,
    mutationBurstRate: aggSum / Math.max(1, OMICS_LIBRARY_SIZE),
    chaperoneLoad: aggSum / Math.max(1, OMICS_LIBRARY_SIZE),
    aggregateLoad: aggSum / Math.max(1, OMICS_LIBRARY_SIZE),
    foldFidelity: natSum / Math.max(1, nP),
    proteotoxicity: misSum / Math.max(1, nP),
    libraryCoverage: covered / OMICS_LIBRARY_SIZE,
    bindingSpecificity: meanAff > 0 ? meanAff : 0,
    combinatorialEntropy: shannonBits(omics.library),

    // ---- Phase E quantum observables (real fold-cluster quantum aggregates) --
    decoherenceRate,
    coherenceLifetime,
    tunnelingRate,
    zeroPointEnergy,
    superpositionEntropy,
    entanglementEntropy,
    quantumParallelism,
    measurementBackaction,
    collapseRate,
    quantumDiffusion,
    tunnelCoupling,
    coherenceLength,
    quantumFidelity,

    // ---- Phase G subatomic observables (real fold-cluster quantum aggregates) --
    bosonFieldIntensity,
    photonTransport,
    gluonConfinement,
    strongCoupling,
    weakBosonMass,
    higgsMassFloor,
    leptonMobility,
    electronChannel,
    quarkFlavorPopulation,
    upDownAsymmetry,
    strangeFlavor,
    charmPool,
    protonStability,
    latticePeriodicity,
    bandGap,
    fermiLevel,
    conductionBand,
    valenceBand,
    phononFlux,
    excitonBinding,
    defectDensity,
    dopingLevel,
    carrierMobility,
    topologicalInvariant,
    moireSuperlattice,
    latticeThermalSusceptibility,
    boltzmannEntropy,
    shannonDissimilarity,
    entropyChangeRate,
    gibbsFreeEnergy,
    entropyProduction,
    timeReversalAsymmetry,
    maxwellDemonPower,
    demonInformationCost,
    absoluteZeroProximity,
    quantumLandauerFloor,
    heatCapacityAnomaly,
    kbtDamping,
    canonicalPartitionZ,
    nanoparticleSurface,
    nanoparticleDensity,
    nanoporeTransport,
    nanoscaleContact,
    molecularMachineWork,
    assemblerAccuracy,
    nanofabricationYield,
    dnaOrigamiStability,
    bionanoInterface,
    nanozymeActivity,
    colloidalStability,
    quantumDotBrightness,
    nanotoxicFlux,
    viralLoad,
    bacterialLoad,
    archaealDensity,
    fungalBiomass,
    protistMotility,
    moneraPrimordial,
    plantPhotosynthesis,
    poriferanChannel,
    chordateNeuralTube,
    piscesAquaticMetabolism,
    mammalThermoregulation,
    primateCognition,
    symbioticIndex,
    metabolicRate,
    cardiovascularPump,
    respirationEfficiency,
    digestiveThroughput,
    excretoryClearance,
    immuneSurveillance,
    neuralConductance,
    musculoskeletalOutput,
    endocrineSignaling,
    thermoregulationControl,
    fluidHomeostasis,
    sensoryPerception,
    growthReplication,
  };

  // Phase B active fluxome: apply the computed fluxes back onto the pools.
  // Phase E (+F): the quantum gate (fidelity / tunneling / decoherence) plus the
  // well/coherence/drag couplings perturb how much of that flux actually lands,
  // so the quantum lane is not just telemetry — it materially shifts chemistry.
  // Phase G: the EM channel (photonTransport), strong binding
  // (gluonConfinement) and flavor population (quarkFlavorPopulation) couple
  // into the same flux application, mirroring Rust apply_fluxome exactly.
  applyFluxome(
    chem,
    flux,
    quantumFidelity,
    tunnelCoupling,
    decoherenceRate,
    zeroPointEnergy,
    coherenceLifetime,
    measurementBackaction,
    photonTransport,
    gluonConfinement,
    quarkFlavorPopulation,
    latticePeriodicity,
    dopingLevel,
    carrierMobility,
    maxwellDemonPower,
    absoluteZeroProximity,
    kbtDamping,
    assemblerAccuracy,
    nanoparticleSurface,
    colloidalStability,
    viralLoad,
    symbioticIndex,
    mammalThermoregulation,
    metabolicRate,
    digestiveThroughput,
    immuneSurveillance,
  );

  return agg;
}

/**
 * Apply the (already computed) reaction fluxes to the molecule pools Ã¢â‚¬â€
 * consume substrate(s), credit product(s), clamped to [0, CHEM_MAX_MOLECULE].
 * Topology mirrors `tickAgentChemistry`:
 *   R0 oxidase       sugar[9]        -> ATP[1]
 *   R1 synthase      amino_acid[2]   -> protein[6]
 *   R2 hydrolase     protein[6]      -> amino_acid[2] + ATP[1] (catabolic)
 *   R3 ligase        fatty_acid[10]  - ATP[1] -> lipid[3]
 *   R4 polymerase    glucose[0] + nucleotide[4] -> protein[6]
 *   R5 lyase         glucose[0]      -> fatty_acid[10] + sugar[9]
 *
 * The Phase-E quantum gate couples into the chemistry: the coherent catalytic
 * power `fidelity` scales every anabolic yield (half weight, so a zero-fidelity
 * agent still catalyses at 0.5x), `tunnel` adds a quantum-escape yield boost on
 * product formation, and `decoherence` taxes the catabolic energy-recovery step
 * (incoherent energy is lost to the environment instead of crediting ATP).
 * Phase-F deepens it: the zero-point well-shift `zpe` suppresses the
 * polymerase/ligase product credits, the coherence lifetime `coherence` boosts
 * the hydrolase/lyase product credits (coherent enzyme states resist
 * misfolding) and the measurement backaction `backaction` taxes the catabolic
 * ATP-energy recovery.  Phase-G adds the subatomic sector: the electromagnetic
 * strength `photons` boosts the R0 oxidase ATP credit, the strong binding
 * `gluons` gates the R3 ligase lipid credit and the R4 polymerase protein
 * credit (half-weight, so a null-gluon agent still ligates at 0.5x), and the
 * flavor population `quarks` raises the R5 lyase product credits.  R1 and R2
 * are untouched by the subatomic layer.  Phase-H adds the materials sector: the
 * lattice periodicity `periodicity` stabilises long-range product formation
 * (scaling the R1/R4 protein credits), the impurity doping `dopingLevel` boosts
 * conductive leakage-recovery (scaling the R2 amino-acid and R5 fatty-acid
 * credits) and the carrier mobility `mobility` taxes the R0 oxidase ATP credit.
 * Phase-I adds the statistical-mechanics sector: the Maxwell's-demon sorting
 * `demonOrdering` boosts the R1 synthase protein credit, the absolute-zero
 * proximity `absZero` preserves ATP effort near the frozen limit (boosting the
 * R0 oxidase ATP credit) and the kT damping `kbt` taxes the thermal-catabolic
 * recovery of the ordered phase (taxing the R2 hydrolase amino-acid credit).
 * All of this mirrors crates/simulation/src/omics.rs `apply_fluxome` exactly.
 */
function applyFluxome(
  chem: AgentChemistry,
  flux: number[],
  fidelity: number,
  tunnel: number,
  decoherence: number,
  zpe: number,
  coherence: number,
  backaction: number,
  photons: number,
  gluons: number,
  quarks: number,
  periodicity: number,
  dopingLevel: number,
  mobility: number,
  demonOrdering: number,
  absZero: number,
  kbt: number,
  assembler: number,
  surface: number,
  colloidDisp: number,
  viralPressure: number,
  symbiont: number,
  warm: number,
  metabolic: number,
  digestive: number,
  defense: number,
): void {
  const mol = chem.molecules;
  const y = OMICS_FLUX_YIELD;
  const s = OMICS_FLUX_SPLIT;
  const cat = OMICS_FLUX_CATABOLIC_BONUS;
  const lig = OMICS_FLUX_LIGASE_COST;
  const maxMol = CHEM_MAX_MOLECULE;
  const gate = 0.5 + 0.5 * clamp01(fidelity);
  const boost = 1.0 + clamp01(tunnel) * QUANTUM_TUNNEL_BOOST;
  const loss = 1.0 - clamp01(decoherence) * QUANTUM_DECOHE_LOSS;
  const well = 1.0 - 0.25 * clamp01(zpe);
  const kin = 0.6 + 0.4 * clamp01(coherence);
  const drag = 1.0 - 0.35 * clamp01(backaction);
  const em = 1.0 + 0.3 * clamp01(photons);
  const strong = 0.5 + 0.5 * clamp01(gluons);
  const flavor = 1.0 + 0.25 * clamp01(quarks);
  const band = 0.5 + 0.5 * clamp01(periodicity);
  const doping = 1.0 + 0.3 * clamp01(dopingLevel);
  const mob = 1.0 - 0.3 * clamp01(mobility);
  const demon = 1.0 + 0.35 * clamp01(demonOrdering);
  const cryo = 1.0 + 0.3 * clamp01(absZero);
  const thermal = 1.0 - 0.4 * clamp01(kbt);
  const nano = 1.0 + 0.3 * clamp01(assembler);
  const surfaceArea = 1.0 + 0.25 * clamp01(surface);
  const colloid = 1.0 + 0.3 * clamp01(colloidDisp);
  const viral = 1.0 + 0.3 * clamp01(viralPressure);
  const symbiosis = 1.0 + 0.35 * clamp01(symbiont);
  const thermo = 1.0 + 0.25 * clamp01(warm);
  const drive = 1.0 + 0.3 * clamp01(metabolic);
  const digest = 1.0 + 0.25 * clamp01(digestive);
  const shield = 1.0 + 0.35 * clamp01(defense);
  const bleed = (i: number, d: number): void => {
    mol[i] = Math.max(0, (mol[i] ?? 0) - d);
  };
  const feed = (i: number, d: number): void => {
    mol[i] = Math.min(maxMol, (mol[i] ?? 0) + d);
  };
  // R0: oxidase consumes sugar, credits ATP.
  let f = flux[0]!;
  bleed(9, f);
  feed(1, f * y * gate * boost * drag * em * mob * cryo * surfaceArea * thermo * drive);
  // R1: synthase consumes amino acid, credits protein.
  f = flux[1]!;
  bleed(2, f);
  feed(6, f * y * gate * boost * band * demon * nano);
  // R2: hydrolase consumes protein, credits amino acid + ATP.
  f = flux[2]!;
  bleed(6, f);
  feed(2, f * y * gate * kin * doping * thermal * colloid * viral * digest);
  feed(1, f * cat * loss * boost * kin * drag);
  // R3: ligase consumes fatty acid + ATP, credits lipid.
  f = flux[3]!;
  bleed(10, f);
  bleed(1, f * lig);
  feed(3, f * y * gate * boost * well * strong * shield);
  // R4: polymerase consumes glucose + nucleotide, credits protein.
  f = flux[4]!;
  bleed(0, f * s);
  bleed(4, f * s);
  feed(6, f * y * s * gate * boost * well * strong * band * symbiosis);
  // R5: lyase consumes glucose, credits fatty acid + sugar.
  f = flux[5]!;
  bleed(0, f);
  feed(10, f * s * boost * kin * flavor * doping);
  feed(9, f * s * boost * kin * flavor);
}
