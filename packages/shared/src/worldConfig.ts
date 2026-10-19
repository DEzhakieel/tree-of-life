import type { WorldConfig, WorldParams, SimStats, SubstrateKind } from './types.js';
import { WORLD_SIZE } from './constants.js';

/** The world's substrate kind; absent `substrate` means the full agent engine. */
export function substrateKind(world: Pick<WorldConfig, 'substrate'>): SubstrateKind {
  return world.substrate?.kind ?? 'agents';
}

/** True when the world runs on a pure-TS substrate instead of the agent engine. */
export function isSubstrateWorld(world: Pick<WorldConfig, 'substrate'>): boolean {
  return substrateKind(world) !== 'agents';
}

/**
 * Neutral zero-row for SimStats, used when a wasm/remote engine is asked for
 * stats before its first tick (no observables have been computed yet). Real
 * values arrive with the first stats broadcast; timeScale keeps the frame's
 * cadence accurate.
 */
export function emptySimStats(tick: number, timeScale: number, patch?: Partial<SimStats>): SimStats {
  return {
    tick,
    population: 0,
    aliveCount: 0,
    deadCount: 0,
    speciesCount: 0,
    avgEnergy: 0,
    avgWater: 0,
    tickRate: 0,
    stateHash: 0,
    timeScale,
    energySum: 0,
    births: 0,
    deaths: 0,
    escapeDeaths: 0,
    entropy: 0,
    diversity: 0,
    complexity: 0,
    cooperation: 0,
    predatorFraction: 0,
    cultureCount: 0,
    meanAltruism: 0,
    memeEntropy: 0,
    speciesMemeMI: 0,
    meanAggression: 0,
    meanCooperation: 0,
    meanRisk: 0,
    meanDeception: 0,
    predatorGeneFraction: 0,
    preyGeneFraction: 0,
    energyInequality: 0,
    donationRatio: 0,
    lyapunovExponent: 0,
    selectionEntropy: 0,
    fixationIndex: 0,
    priceEquationSelection: 0,
    foodGradMagMean: 0,
    foodLapMean: 0,
    velocityDivMean: 0,
    velocityCurlMagMean: 0,
    caAliveFraction: 0,
    caComplexity: 0,
    traitTotalVariance: 0,
    traitEffectiveDim: 0,
    traitAnisotropy: 0,
    meanATP: 0,
    meanEnzyme: 0,
    meanToxin: 0,
    meanPH: 0,
    chemicalDiversity: 0,
    meanGlucose: 0,
    meanProtein: 0,
    activeSynthesisFraction: 0,
    terrainOxygen: 0,
    terrainPH: 0,
    terrainToxin: 0,
    meanDNAIntegrity: 1,
    meanPathogenLoad: 0,
    meanMembranePot: -70,
    meanBodyTemp: 37,
    meanTrophicLevel: 0,
    speciationRate: 0,
    extinctionRate: 0,
    biodiversityIndex: 0,
    meanFitness: 0,
    meanDivisionProgress: 0,
    meanPlasticity: 0,
    meanSurprise: 0,
    plasticAgents: 0,
    meanForce: 0,
    clusterCount: 0,
    clusterOrder: 0,
    rotationalOrder: 0,
    spatialEntropy: 0,
    dimensionalEntropy: 0,
    orgIndex: 0,
    massConservation: 0,
    symmetryDrift: 0,
    cascadeRate: 0,
    bondEnergy: 0,
    reactionEnthalpy: 0,
    entropyProduction: 0,
    carnotEfficiency: 0,
    heatWaste: 0,
    enginePower: 0,
    radiationField: 0,
    thermalBalance: 0,
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
    ...patch,
  };
}

/**
 * Mapping between world space and the complex (fractal) plane.
 *
 * World position p in [0, WORLD_SIZE)^2 maps to:
 *   z = center + ((p - WORLD_SIZE/2) / WORLD_SIZE) * worldScale
 *
 * This is a pure function of the world config, so the JS simulation engine,
 * the GLSL shaders and any client can agree on identical terrain.
 */
export function worldToComplex(world: Pick<WorldParams, 'centerX' | 'centerY' | 'worldScale'>, x: number, y: number): { re: number; im: number } {
  const nx = (x / WORLD_SIZE - 0.5) * world.worldScale;
  const ny = (y / WORLD_SIZE - 0.5) * world.worldScale;
  return { re: world.centerX + nx, im: world.centerY + ny };
}

export function complexToWorld(world: Pick<WorldParams, 'centerX' | 'centerY' | 'worldScale'>, re: number, im: number): { x: number; y: number } {
  return {
    x: (re - world.centerX) / world.worldScale * WORLD_SIZE + WORLD_SIZE / 2,
    y: (im - world.centerY) / world.worldScale * WORLD_SIZE + WORLD_SIZE / 2,
  };
}

export function clampWorld(v: number): number {
  if (v < 0) return v + WORLD_SIZE;
  if (v >= WORLD_SIZE) return v - WORLD_SIZE;
  return v;
}

/** Deterministic seed string from a numeric seed (used by clients for ad-hoc worlds). */
export function normalizeSeed(seed?: string): string {
  if (seed && seed.length > 0) return seed;
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}
