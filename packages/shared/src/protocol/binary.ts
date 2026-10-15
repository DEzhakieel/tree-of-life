/**
 * Binary wire protocol for the simulation gateway.
 *
 * Server -> Client (binary frames):
 *   SNAPSHOT      [u8 0][u32 tick][u8 timeScale*100][u16 speciesCount][u16 aliveCount][u16 n]
 *                 n x packed agent
 *   DELTA         [u8 1][u32 tick][u16 n] n x packed agent
 *   STATS         [u8 2][u32 tick][u16 pop][u16 alive][u16 dead][u16 species][f32 avgEnergy][f32 avgWater][f32 tickRate][u32 stateHash][u16 births][u16 deaths][f32 entropy][f32 diversity][f32 complexity][f32 cooperation][f32 predatorFraction][u16 cultureCount][f32 meanAltruism][f32 memeEntropy][f32 speciesMemeMI]
 *   WORLD         [u8 3][json: world config + status]
 *   EVENT         [u8 4][json: event]
 *   INTERVENE_ACK [u8 5][u32 sequence]
 *   SET           [u8 6][u32 tick][u16 size] size*size depth bytes, size*size escape bytes
 *
 * Packed agent (agents are sorted by id, so id is stored as a varint delta):
 *   [varint idDelta][varint x*FIXED_POINT][varint y*FIXED_POINT][u8 energy*255][u8 state][u32 species][u8 meme*255]
 *
 * The SET frame carries the "evolved set" — a per-cell aggregate of the live
 * fractal orbits drawn by the population itself: `depth` is the orbit depth of
 * the currently-alive lineage with the deepest orbit in each cell (0 = no life
 * in that niche), `escape` marks cells where a lineage has diverged and escaped.
 */
import { MT, FIXED_POINT, STATE } from '../constants.js';
import type { AgentState, SimStats, SimEvent, WorldStatus } from '../types.js';
import type { WorldConfig } from '../types.js';

// ---------------------------------------------------------------------------
// Byte writer / reader
// ---------------------------------------------------------------------------

export class ByteWriter {
  buf: Uint8Array;
  off = 0;
  private view: DataView;

  constructor(initial = 256) {
    this.buf = new Uint8Array(initial);
    this.view = new DataView(this.buf.buffer);
  }

  private ensure(n: number): void {
    if (this.off + n <= this.buf.length) return;
    let cap = this.buf.length * 2;
    while (cap < this.off + n) cap *= 2;
    const next = new Uint8Array(cap);
    next.set(this.buf);
    this.buf = next;
    this.view = new DataView(this.buf.buffer);
  }

  u8(v: number): this {
    this.ensure(1);
    this.buf[this.off++] = v & 0xff;
    return this;
  }

  u16(v: number): this {
    this.ensure(2);
    this.view.setUint16(this.off, v, true);
    this.off += 2;
    return this;
  }

  u32(v: number): this {
    this.ensure(4);
    this.view.setUint32(this.off, v >>> 0, true);
    this.off += 4;
    return this;
  }

  f32(v: number): this {
    this.ensure(4);
    this.view.setFloat32(this.off, v, true);
    this.off += 4;
    return this;
  }

  varint(v: number): this {
    let value = v >>> 0;
    this.ensure(5);
    while (value >= 0x80) {
      this.buf[this.off++] = (value & 0x7f) | 0x80;
      value >>>= 7;
    }
    this.buf[this.off++] = value;
    return this;
  }

  bytes(b: Uint8Array): this {
    this.ensure(b.length);
    this.buf.set(b, this.off);
    this.off += b.length;
    return this;
  }

  patchU16(offset: number, value: number): this {
    this.view.setUint16(offset, value, true);
    return this;
  }

  finish(): Uint8Array {
    return this.buf.subarray(0, this.off);
  }
}

export class ByteReader {
  private view: DataView;
  off = 0;

  constructor(private buf: Uint8Array) {
    this.view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  }

  u8(): number {
    return this.buf[this.off++];
  }

  u16(): number {
    const v = this.view.getUint16(this.off, true);
    this.off += 2;
    return v;
  }

  u32(): number {
    const v = this.view.getUint32(this.off, true);
    this.off += 4;
    return v;
  }

  f32(): number {
    const v = this.view.getFloat32(this.off, true);
    this.off += 4;
    return v;
  }

  varint(): number {
    let result = 0;
    let shift = 0;
    let b: number;
    do {
      b = this.buf[this.off++];
      result |= (b & 0x7f) << shift;
      shift += 7;
    } while ((b & 0x80) !== 0);
    return result >>> 0;
  }
}

// ---------------------------------------------------------------------------
// Encoding
// ---------------------------------------------------------------------------

// Local alias: exported module binding reads defeat V8 constant folding.
const FP = FIXED_POINT;

function packAgent(w: ByteWriter, prevId: number, a: AgentState): void {
  w.varint(a.id - prevId);
  w.varint(Math.round(a.x * FP));
  w.varint(Math.round(a.y * FP));
  w.u8(Math.max(0, Math.min(255, Math.round(a.energy * 255))));
  w.u8(a.state & 0xff);
  w.u32(a.species ?? 0);
  w.u8(Math.max(0, Math.min(255, Math.round((a.meme ?? 0.5) * 255))));
}

/** Shared packed-agent writer (agents must be visited in ascending id order). */
export function writePackedAgent(w: ByteWriter, prevId: number, a: AgentState): void {
  packAgent(w, prevId, a);
}

export function encodeSnapshot(
  tick: number,
  timeScale: number,
  speciesCount: number,
  aliveCount: number,
  agents: AgentState[],
): Uint8Array {
  const sorted = [...agents].sort((a, b) => a.id - b.id);
  const w = new ByteWriter(128 + sorted.length * 8);
  w.u8(MT.SNAPSHOT);
  w.u32(tick);
  w.u8(Math.max(0, Math.min(255, Math.round(timeScale * 100))));
  w.u16(speciesCount);
  w.u16(aliveCount);
  w.u16(sorted.length);
  let prevId = 0;
  for (const a of sorted) {
    packAgent(w, prevId, a);
    prevId = a.id;
  }
  return w.finish();
}

export function encodeDelta(tick: number, agents: AgentState[]): Uint8Array {
  const sorted = [...agents].sort((a, b) => a.id - b.id);
  const w = new ByteWriter(16 + sorted.length * 8);
  w.u8(MT.DELTA);
  w.u32(tick);
  w.u16(sorted.length);
  let prevId = 0;
  for (const a of sorted) {
    packAgent(w, prevId, a);
    prevId = a.id;
  }
  return w.finish();
}

export function encodeStats(s: SimStats): Uint8Array {
  const w = new ByteWriter(48);
  w.u8(MT.STATS);
  w.u32(s.tick);
  w.u16(s.population);
  w.u16(s.aliveCount);
  w.u16(s.deadCount);
  w.u16(s.speciesCount);
  w.f32(s.avgEnergy);
  w.f32(s.avgWater);
  w.f32(s.tickRate);
  w.u32(s.stateHash >>> 0);
  w.u16(Math.min(65535, s.births));
  w.u16(Math.min(65535, s.deaths));
  w.u16(Math.min(65535, s.escapeDeaths ?? 0));
  w.f32(s.entropy);
  w.f32(s.diversity);
  w.f32(s.complexity);
  w.f32(s.cooperation);
  w.f32(s.predatorFraction);
  w.u16(Math.min(65535, s.cultureCount));
  w.f32(s.meanAltruism);
  w.f32(s.memeEntropy);
  w.f32(s.speciesMemeMI);
  // game theory observables
  w.f32(s.meanAggression);
  w.f32(s.meanCooperation);
  w.f32(s.meanRisk);
  w.f32(s.meanDeception);
  w.f32(s.predatorGeneFraction);
  w.f32(s.preyGeneFraction);
  w.f32(s.energyInequality);
  w.f32(s.donationRatio);
  // math observables
  w.f32(s.lyapunovExponent);
  w.f32(s.selectionEntropy);
  w.f32(s.fixationIndex);
  w.f32(s.priceEquationSelection);
  w.f32(s.foodGradMagMean);
  w.f32(s.foodLapMean);
  w.f32(s.velocityDivMean);
  w.f32(s.velocityCurlMagMean);
  w.f32(s.caAliveFraction);
  w.f32(s.caComplexity);
  w.f32(s.traitTotalVariance);
  w.f32(s.traitEffectiveDim);
  w.f32(s.traitAnisotropy);
  // chemistry observables
  w.f32(s.meanATP);
  w.f32(s.meanEnzyme);
  w.f32(s.meanToxin);
  w.f32(s.meanPH);
  w.f32(s.chemicalDiversity);
  w.f32(s.meanGlucose);
  w.f32(s.meanProtein);
  w.f32(s.activeSynthesisFraction);
  w.f32(s.terrainOxygen);
  w.f32(s.terrainPH);
  w.f32(s.terrainToxin);
  // biology observables
  w.f32(s.meanDNAIntegrity);
  w.f32(s.meanPathogenLoad);
  w.f32(s.meanMembranePot);
  w.f32(s.meanBodyTemp);
  w.f32(s.meanTrophicLevel);
  w.f32(s.speciationRate);
  w.f32(s.extinctionRate);
  w.f32(s.biodiversityIndex);
  w.f32(s.meanFitness);
  w.f32(s.meanDivisionProgress);
  // neural observables (plastic recurrent brains)
  w.f32(s.meanPlasticity);
  w.f32(s.meanSurprise);
  w.f32(s.plasticAgents);
  // biophysics observables
  w.f32(s.meanForce);
  w.f32(s.clusterCount);
  w.f32(s.clusterOrder);
  w.f32(s.rotationalOrder);
  w.f32(s.spatialEntropy);
  w.f32(s.dimensionalEntropy);
  w.f32(s.orgIndex);
  w.f32(s.massConservation);
  w.f32(s.symmetryDrift);
  w.f32(s.cascadeRate);
  w.f32(s.bondEnergy);
  w.f32(s.reactionEnthalpy);
  w.f32(s.entropyProduction);
  w.f32(s.carnotEfficiency);
  w.f32(s.heatWaste);
  w.f32(s.enginePower);
  w.f32(s.radiationField);
  w.f32(s.thermalBalance);
  // omics observables (opt-in via WorldConfig.omics)
  w.f32(s.expressionEntropy);
  w.f32(s.transcriptActivity);
  w.f32(s.proteinDiversity);
  w.f32(s.proteomeLoad);
  w.f32(s.pathwayFlux);
  w.f32(s.fluxDiversity);
  w.f32(s.regulationGating);
  w.f32(s.ecCoupling);
  w.f32(s.nativeFraction);
  w.f32(s.misfoldLoad);
  w.f32(s.foldStability);
  w.f32(s.tfRegulation);
  w.f32(s.envRecognition);
  w.f32(s.expressionNoise);
  w.f32(s.libraryDiversity);
  // Phase-D aggregates (fold-cluster observables, opt-in Phase D).
  w.f32(s.discoveryRate);
  w.f32(s.noveltyMean);
  w.f32(s.memoryDiversity);
  w.f32(s.explorationFraction);
  w.f32(s.behaviorNoise);
  w.f32(s.mutationBurstRate);
  w.f32(s.chaperoneLoad);
  w.f32(s.aggregateLoad);
  w.f32(s.foldFidelity);
  w.f32(s.proteotoxicity);
  w.f32(s.libraryCoverage);
  w.f32(s.bindingSpecificity);
  w.f32(s.combinatorialEntropy);
  // Phase-E quantum aggregates (macroscopic-quantum fold-cluster observables).
  w.f32(s.decoherenceRate);
  w.f32(s.coherenceLifetime);
  w.f32(s.tunnelingRate);
  w.f32(s.zeroPointEnergy);
  w.f32(s.superpositionEntropy);
  w.f32(s.entanglementEntropy);
  w.f32(s.quantumParallelism);
  w.f32(s.measurementBackaction);
  w.f32(s.collapseRate);
  w.f32(s.quantumDiffusion);
  w.f32(s.tunnelCoupling);
  w.f32(s.coherenceLength);
  w.f32(s.quantumFidelity);
  // Phase-G subatomic aggregates (subatomic fold-cluster observables).
  w.f32(s.bosonFieldIntensity);
  w.f32(s.photonTransport);
  w.f32(s.gluonConfinement);
  w.f32(s.strongCoupling);
  w.f32(s.weakBosonMass);
  w.f32(s.higgsMassFloor);
  w.f32(s.leptonMobility);
  w.f32(s.electronChannel);
  w.f32(s.quarkFlavorPopulation);
  w.f32(s.upDownAsymmetry);
  w.f32(s.strangeFlavor);
  w.f32(s.charmPool);
  w.f32(s.protonStability);
  // Phase-H quantum-materials aggregates.
  w.f32(s.latticePeriodicity);
  w.f32(s.bandGap);
  w.f32(s.fermiLevel);
  w.f32(s.conductionBand);
  w.f32(s.valenceBand);
  w.f32(s.phononFlux);
  w.f32(s.excitonBinding);
  w.f32(s.defectDensity);
  w.f32(s.dopingLevel);
  w.f32(s.carrierMobility);
  w.f32(s.topologicalInvariant);
  w.f32(s.moireSuperlattice);
  w.f32(s.latticeThermalSusceptibility);
  // Phase-I statistical-mechanics / information-theory aggregates.
  w.f32(s.boltzmannEntropy);
  w.f32(s.shannonDissimilarity);
  w.f32(s.entropyChangeRate);
  w.f32(s.gibbsFreeEnergy);
  w.f32(s.entropyProduction);
  w.f32(s.timeReversalAsymmetry);
  w.f32(s.maxwellDemonPower);
  w.f32(s.demonInformationCost);
  w.f32(s.absoluteZeroProximity);
  w.f32(s.quantumLandauerFloor);
  w.f32(s.heatCapacityAnomaly);
  w.f32(s.kbtDamping);
  w.f32(s.canonicalPartitionZ);
  w.f32(s.nanoparticleSurface);
  w.f32(s.nanoparticleDensity);
  w.f32(s.nanoporeTransport);
  w.f32(s.nanoscaleContact);
  w.f32(s.molecularMachineWork);
  w.f32(s.assemblerAccuracy);
  w.f32(s.nanofabricationYield);
  w.f32(s.dnaOrigamiStability);
  w.f32(s.bionanoInterface);
  w.f32(s.nanozymeActivity);
  w.f32(s.colloidalStability);
  w.f32(s.quantumDotBrightness);
  w.f32(s.nanotoxicFlux);
  w.f32(s.viralLoad);
  w.f32(s.bacterialLoad);
  w.f32(s.archaealDensity);
  w.f32(s.fungalBiomass);
  w.f32(s.protistMotility);
  w.f32(s.moneraPrimordial);
  w.f32(s.plantPhotosynthesis);
  w.f32(s.poriferanChannel);
  w.f32(s.chordateNeuralTube);
  w.f32(s.piscesAquaticMetabolism);
  w.f32(s.mammalThermoregulation);
  w.f32(s.primateCognition);
  w.f32(s.symbioticIndex);
  w.f32(s.metabolicRate);
  w.f32(s.cardiovascularPump);
  w.f32(s.respirationEfficiency);
  w.f32(s.digestiveThroughput);
  w.f32(s.excretoryClearance);
  w.f32(s.immuneSurveillance);
  w.f32(s.neuralConductance);
  w.f32(s.musculoskeletalOutput);
  w.f32(s.endocrineSignaling);
  w.f32(s.thermoregulationControl);
  w.f32(s.fluidHomeostasis);
  w.f32(s.sensoryPerception);
  w.f32(s.growthReplication);
  return w.finish();
}

export function encodeWorld(world: WorldConfig, status: WorldStatus): Uint8Array {
  const payload = JSON.stringify({ world, status });
  const w = new ByteWriter(payload.length + 8);
  w.u8(MT.WORLD);
  w.bytes(new TextEncoder().encode(payload));
  return w.finish();
}

export function encodeEvent(e: SimEvent): Uint8Array {
  const payload = JSON.stringify(e);
  const w = new ByteWriter(payload.length + 8);
  w.u8(MT.EVENT);
  w.bytes(new TextEncoder().encode(payload));
  return w.finish();
}

export function encodeAck(sequence: number): Uint8Array {
  const w = new ByteWriter(8);
  w.u8(MT.INTERVENE_ACK);
  w.u32(sequence);
  return w.finish();
}

export interface SetMapMessage {
  type: number;
  tick: number;
  size: number;
  /** per-cell max orbit depth among currently alive lineages (0 = no life). */
  depth: Uint8Array;
  /** per-cell escape marks (255 = a lineage recently diverged here, decays over emits). */
  escape: Uint8Array;
}

export function encodeSetMap(tick: number, size: number, depth: Uint8Array, escape: Uint8Array): Uint8Array {
  const cells = size * size;
  const w = new ByteWriter(8 + cells * 2);
  w.u8(MT.SET);
  w.u32(tick);
  w.u16(size);
  w.bytes(depth.subarray(0, cells));
  w.bytes(escape.subarray(0, cells));
  return w.finish();
}

// ---------------------------------------------------------------------------
// Decoding
// ---------------------------------------------------------------------------

function readAgents(r: ByteReader, count: number): AgentState[] {
  const out: AgentState[] = [];
  let id = 0;
  for (let i = 0; i < count; i++) {
    id += r.varint();
    const x = r.varint() / FIXED_POINT;
    const y = r.varint() / FIXED_POINT;
    const energy = r.u8() / 255;
    const state = r.u8();
    const species = r.u32();
    const meme = r.u8() / 255;
    out.push({ id, x, y, energy, state, species, meme });
  }
  return out;
}

export interface SnapshotMessage {
  type: number;
  tick: number;
  timeScale: number;
  speciesCount: number;
  aliveCount: number;
  agents: AgentState[];
}

export interface DeltaMessage {
  type: number;
  tick: number;
  agents: AgentState[];
}

export function decodeSnapshot(bytes: Uint8Array): SnapshotMessage {
  const r = new ByteReader(bytes);
  r.u8(); // type
  const tick = r.u32();
  const timeScale = r.u8() / 100;
  const speciesCount = r.u16();
  const aliveCount = r.u16();
  const n = r.u16();
  return { type: MT.SNAPSHOT, tick, timeScale, speciesCount, aliveCount, agents: readAgents(r, n) };
}

export function decodeDelta(bytes: Uint8Array): DeltaMessage {
  const r = new ByteReader(bytes);
  r.u8(); // type
  const tick = r.u32();
  const n = r.u16();
  return { type: MT.DELTA, tick, agents: readAgents(r, n) };
}

export function decodeStats(bytes: Uint8Array): SimStats {
  const r = new ByteReader(bytes);
  r.u8(); // type
  const tick = r.u32();
  const population = r.u16();
  const aliveCount = r.u16();
  const deadCount = r.u16();
  const speciesCount = r.u16();
  const avgEnergy = r.f32();
  const avgWater = r.f32();
  const tickRate = r.f32();
  const stateHash = r.u32();
  const births = r.u16();
  const deaths = r.u16();
  const escapeDeaths = r.u16();
  const entropy = r.f32();
  const diversity = r.f32();
  const complexity = r.f32();
  const cooperation = r.f32();
  const predatorFraction = r.f32();
  const cultureCount = r.u16();
  const meanAltruism = r.f32();
  const memeEntropy = r.f32();
  const speciesMemeMI = r.f32();
  // game theory observables (new fields)
  let meanAggression = 0;
  let meanCooperation = 0;
  let meanRisk = 0;
  let meanDeception = 0;
  let predatorGeneFraction = 0;
  let preyGeneFraction = 0;
  let energyInequality = 0;
  let donationRatio = 0;
  // math observables
  let lyapunovExponent = 0;
  let selectionEntropy = 0;
  let fixationIndex = 0;
  let priceEquationSelection = 0;
  let foodGradMagMean = 0;
  let foodLapMean = 0;
  let velocityDivMean = 0;
  let velocityCurlMagMean = 0;
  let caAliveFraction = 0;
  let caComplexity = 0;
  let traitTotalVariance = 0;
  let traitEffectiveDim = 0;
  let traitAnisotropy = 0;
  if (r.off < bytes.length) {
    meanAggression = r.f32();
    meanCooperation = r.f32();
    meanRisk = r.f32();
    meanDeception = r.f32();
    predatorGeneFraction = r.f32();
    preyGeneFraction = r.f32();
    energyInequality = r.f32();
    donationRatio = r.f32();
  }
  if (r.off < bytes.length) {
    lyapunovExponent = r.f32();
    selectionEntropy = r.f32();
    fixationIndex = r.f32();
    priceEquationSelection = r.f32();
    foodGradMagMean = r.f32();
    foodLapMean = r.f32();
    velocityDivMean = r.f32();
    velocityCurlMagMean = r.f32();
    caAliveFraction = r.f32();
    caComplexity = r.f32();
    traitTotalVariance = r.f32();
    traitEffectiveDim = r.f32();
    traitAnisotropy = r.f32();
  }
  // chemistry observables
  let meanATP = 0;
  let meanEnzyme = 0;
  let meanToxin = 0;
  let meanPH = 0;
  let chemicalDiversity = 0;
  let meanGlucose = 0;
  let meanProtein = 0;
  let activeSynthesisFraction = 0;
  let terrainOxygen = 0;
  let terrainPH = 0;
  let terrainToxin = 0;
  if (r.off < bytes.length) {
    meanATP = r.f32();
    meanEnzyme = r.f32();
    meanToxin = r.f32();
    meanPH = r.f32();
    chemicalDiversity = r.f32();
    meanGlucose = r.f32();
    meanProtein = r.f32();
    activeSynthesisFraction = r.f32();
    terrainOxygen = r.f32();
    terrainPH = r.f32();
    terrainToxin = r.f32();
  }
  // biology observables
  let meanDNAIntegrity = 1;
  let meanPathogenLoad = 0;
  let meanMembranePot = -70;
  let meanBodyTemp = 37;
  let meanTrophicLevel = 0;
  let speciationRate = 0;
  let extinctionRate = 0;
  let biodiversityIndex = 0;
  let meanFitness = 0;
  let meanDivisionProgress = 0;
  if (r.off < bytes.length) {
    meanDNAIntegrity = r.f32();
    meanPathogenLoad = r.f32();
    meanMembranePot = r.f32();
    meanBodyTemp = r.f32();
    meanTrophicLevel = r.f32();
    speciationRate = r.f32();
    extinctionRate = r.f32();
    biodiversityIndex = r.f32();
    meanFitness = r.f32();
    meanDivisionProgress = r.f32();
  }
  // neural observables (plastic recurrent brains)
  let meanPlasticity = 0;
  let meanSurprise = 0;
  let plasticAgents = 0;
  if (r.off < bytes.length) {
    meanPlasticity = r.f32();
    meanSurprise = r.f32();
    plasticAgents = r.f32();
  }
  // biophysics observables (opt-in; zeros on legacy frames)
  let meanForce = 0;
  let clusterCount = 0;
  let clusterOrder = 0;
  let rotationalOrder = 0;
  let spatialEntropy = 0;
  let dimensionalEntropy = 0;
  let orgIndex = 0;
  let massConservation = 0;
  let symmetryDrift = 0;
  let cascadeRate = 0;
  let bondEnergy = 0;
  let reactionEnthalpy = 0;
  let entropyProduction = 0;
  let carnotEfficiency = 0;
  let heatWaste = 0;
  let enginePower = 0;
  let radiationField = 0;
  let thermalBalance = 0;
  if (r.off < bytes.length) {
    meanForce = r.f32();
    clusterCount = r.f32();
    clusterOrder = r.f32();
    rotationalOrder = r.f32();
    spatialEntropy = r.f32();
    dimensionalEntropy = r.f32();
    orgIndex = r.f32();
    massConservation = r.f32();
    symmetryDrift = r.f32();
    cascadeRate = r.f32();
    bondEnergy = r.f32();
    reactionEnthalpy = r.f32();
    entropyProduction = r.f32();
    carnotEfficiency = r.f32();
    heatWaste = r.f32();
    enginePower = r.f32();
    radiationField = r.f32();
    thermalBalance = r.f32();
  }
  // omics observables (opt-in via WorldConfig.omics; zeros on legacy frames)
  let expressionEntropy = 0;
  let transcriptActivity = 0;
  let proteinDiversity = 0;
  let proteomeLoad = 0;
  let pathwayFlux = 0;
  let fluxDiversity = 0;
  let regulationGating = 0;
  let ecCoupling = 0;
  let nativeFraction = 0;
  let misfoldLoad = 0;
  let foldStability = 0;
  let tfRegulation = 0;
  let envRecognition = 0;
  let expressionNoise = 0;
  let libraryDiversity = 0;
  let discoveryRate = 0;
  let noveltyMean = 0;
  let memoryDiversity = 0;
  let explorationFraction = 0;
  let behaviorNoise = 0;
  let mutationBurstRate = 0;
  let chaperoneLoad = 0;
  let aggregateLoad = 0;
  let foldFidelity = 0;
  let proteotoxicity = 0;
  let libraryCoverage = 0;
  let bindingSpecificity = 0;
  let combinatorialEntropy = 0;
  // Phase-E quantum aggregates (macroscopic-quantum fold-cluster observables;
  // zeros on legacy frames decoded with omics disabled).
  let decoherenceRate = 0;
  let coherenceLifetime = 0;
  let tunnelingRate = 0;
  let zeroPointEnergy = 0;
  let superpositionEntropy = 0;
  let entanglementEntropy = 0;
  let quantumParallelism = 0;
  let measurementBackaction = 0;
  let collapseRate = 0;
  let quantumDiffusion = 0;
  let tunnelCoupling = 0;
  let coherenceLength = 0;
  let quantumFidelity = 0;
  // Phase-G subatomic aggregates (zeros on legacy frames decoded with omics
  // disabled).
  let bosonFieldIntensity = 0;
  let photonTransport = 0;
  let gluonConfinement = 0;
  let strongCoupling = 0;
  let weakBosonMass = 0;
  let higgsMassFloor = 0;
  let leptonMobility = 0;
  let electronChannel = 0;
  let quarkFlavorPopulation = 0;
  let upDownAsymmetry = 0;
  let strangeFlavor = 0;
  let charmPool = 0;
  let protonStability = 0;
  // Phase-H quantum-materials aggregates (zeros on legacy frames).
  let latticePeriodicity = 0;
  let bandGap = 0;
  let fermiLevel = 0;
  let conductionBand = 0;
  let valenceBand = 0;
  let phononFlux = 0;
  let excitonBinding = 0;
  let defectDensity = 0;
  let dopingLevel = 0;
  let carrierMobility = 0;
  let topologicalInvariant = 0;
  let moireSuperlattice = 0;
  let latticeThermalSusceptibility = 0;
  let boltzmannEntropy = 0;
  let shannonDissimilarity = 0;
  let entropyChangeRate = 0;
  let gibbsFreeEnergy = 0;
  let timeReversalAsymmetry = 0;
  let maxwellDemonPower = 0;
  let demonInformationCost = 0;
  let absoluteZeroProximity = 0;
  let quantumLandauerFloor = 0;
  let heatCapacityAnomaly = 0;
  let kbtDamping = 0;
  let canonicalPartitionZ = 0;
  let nanoparticleSurface = 0;
  let nanoparticleDensity = 0;
  let nanoporeTransport = 0;
  let nanoscaleContact = 0;
  let molecularMachineWork = 0;
  let assemblerAccuracy = 0;
  let nanofabricationYield = 0;
  let dnaOrigamiStability = 0;
  let bionanoInterface = 0;
  let nanozymeActivity = 0;
  let colloidalStability = 0;
  let quantumDotBrightness = 0;
  let nanotoxicFlux = 0;
  let viralLoad = 0;
  let bacterialLoad = 0;
  let archaealDensity = 0;
  let fungalBiomass = 0;
  let protistMotility = 0;
  let moneraPrimordial = 0;
  let plantPhotosynthesis = 0;
  let poriferanChannel = 0;
  let chordateNeuralTube = 0;
  let piscesAquaticMetabolism = 0;
  let mammalThermoregulation = 0;
  let primateCognition = 0;
  let symbioticIndex = 0;
  let metabolicRate = 0;
  let cardiovascularPump = 0;
  let respirationEfficiency = 0;
  let digestiveThroughput = 0;
  let excretoryClearance = 0;
  let immuneSurveillance = 0;
  let neuralConductance = 0;
  let musculoskeletalOutput = 0;
  let endocrineSignaling = 0;
  let thermoregulationControl = 0;
  let fluidHomeostasis = 0;
  let sensoryPerception = 0;
  let growthReplication = 0;
  if (r.off < bytes.length) {
    expressionEntropy = r.f32();
    transcriptActivity = r.f32();
    proteinDiversity = r.f32();
    proteomeLoad = r.f32();
    pathwayFlux = r.f32();
    fluxDiversity = r.f32();
    regulationGating = r.f32();
    ecCoupling = r.f32();
    nativeFraction = r.f32();
    misfoldLoad = r.f32();
    foldStability = r.f32();
    tfRegulation = r.f32();
    envRecognition = r.f32();
    expressionNoise = r.f32();
    libraryDiversity = r.f32();
    discoveryRate = r.f32();
    noveltyMean = r.f32();
    memoryDiversity = r.f32();
    explorationFraction = r.f32();
    behaviorNoise = r.f32();
    mutationBurstRate = r.f32();
    chaperoneLoad = r.f32();
    aggregateLoad = r.f32();
    foldFidelity = r.f32();
    proteotoxicity = r.f32();
    libraryCoverage = r.f32();
    bindingSpecificity = r.f32();
    combinatorialEntropy = r.f32();
    decoherenceRate = r.f32();
    coherenceLifetime = r.f32();
    tunnelingRate = r.f32();
    zeroPointEnergy = r.f32();
    superpositionEntropy = r.f32();
    entanglementEntropy = r.f32();
    quantumParallelism = r.f32();
    measurementBackaction = r.f32();
    collapseRate = r.f32();
    quantumDiffusion = r.f32();
    tunnelCoupling = r.f32();
    coherenceLength = r.f32();
    quantumFidelity = r.f32();
    bosonFieldIntensity = r.f32();
    photonTransport = r.f32();
    gluonConfinement = r.f32();
    strongCoupling = r.f32();
    weakBosonMass = r.f32();
    higgsMassFloor = r.f32();
    leptonMobility = r.f32();
    electronChannel = r.f32();
    quarkFlavorPopulation = r.f32();
    upDownAsymmetry = r.f32();
    strangeFlavor = r.f32();
    charmPool = r.f32();
    protonStability = r.f32();
    latticePeriodicity = r.f32();
    bandGap = r.f32();
    fermiLevel = r.f32();
    conductionBand = r.f32();
    valenceBand = r.f32();
    phononFlux = r.f32();
    excitonBinding = r.f32();
    defectDensity = r.f32();
    dopingLevel = r.f32();
    carrierMobility = r.f32();
    topologicalInvariant = r.f32();
    moireSuperlattice = r.f32();
    latticeThermalSusceptibility = r.f32();
    boltzmannEntropy = r.f32();
    shannonDissimilarity = r.f32();
    entropyChangeRate = r.f32();
    gibbsFreeEnergy = r.f32();
    entropyProduction = r.f32();
    timeReversalAsymmetry = r.f32();
    maxwellDemonPower = r.f32();
    demonInformationCost = r.f32();
    absoluteZeroProximity = r.f32();
    quantumLandauerFloor = r.f32();
    heatCapacityAnomaly = r.f32();
    kbtDamping = r.f32();
    canonicalPartitionZ = r.f32();
    nanoparticleSurface = r.f32();
    nanoparticleDensity = r.f32();
    nanoporeTransport = r.f32();
    nanoscaleContact = r.f32();
    molecularMachineWork = r.f32();
    assemblerAccuracy = r.f32();
    nanofabricationYield = r.f32();
    dnaOrigamiStability = r.f32();
    bionanoInterface = r.f32();
    nanozymeActivity = r.f32();
    colloidalStability = r.f32();
    quantumDotBrightness = r.f32();
    nanotoxicFlux = r.f32();
    viralLoad = r.f32();
    bacterialLoad = r.f32();
    archaealDensity = r.f32();
    fungalBiomass = r.f32();
    protistMotility = r.f32();
    moneraPrimordial = r.f32();
    plantPhotosynthesis = r.f32();
    poriferanChannel = r.f32();
    chordateNeuralTube = r.f32();
    piscesAquaticMetabolism = r.f32();
    mammalThermoregulation = r.f32();
    primateCognition = r.f32();
    symbioticIndex = r.f32();
    metabolicRate = r.f32();
    cardiovascularPump = r.f32();
    respirationEfficiency = r.f32();
    digestiveThroughput = r.f32();
    excretoryClearance = r.f32();
    immuneSurveillance = r.f32();
    neuralConductance = r.f32();
    musculoskeletalOutput = r.f32();
    endocrineSignaling = r.f32();
    thermoregulationControl = r.f32();
    fluidHomeostasis = r.f32();
    sensoryPerception = r.f32();
    growthReplication = r.f32();
  }
  return { tick, population, aliveCount, deadCount, speciesCount, avgEnergy, avgWater, tickRate, stateHash, timeScale: 1, energySum: 0, births, deaths, escapeDeaths, entropy, diversity, complexity, cooperation, predatorFraction, cultureCount, meanAltruism, memeEntropy, speciesMemeMI, meanAggression, meanCooperation, meanRisk, meanDeception, predatorGeneFraction, preyGeneFraction, energyInequality, donationRatio, lyapunovExponent, selectionEntropy, fixationIndex, priceEquationSelection, foodGradMagMean, foodLapMean, velocityDivMean, velocityCurlMagMean, caAliveFraction, caComplexity, traitTotalVariance, traitEffectiveDim, traitAnisotropy, meanATP, meanEnzyme, meanToxin, meanPH, chemicalDiversity, meanGlucose, meanProtein, activeSynthesisFraction, terrainOxygen, terrainPH, terrainToxin, meanDNAIntegrity, meanPathogenLoad, meanMembranePot, meanBodyTemp, meanTrophicLevel, speciationRate, extinctionRate, biodiversityIndex, meanFitness, meanDivisionProgress, meanPlasticity, meanSurprise, plasticAgents, meanForce, clusterCount, clusterOrder, rotationalOrder, spatialEntropy, dimensionalEntropy, orgIndex, massConservation, symmetryDrift, cascadeRate, bondEnergy, reactionEnthalpy, entropyProduction, carnotEfficiency, heatWaste, enginePower, radiationField, thermalBalance, expressionEntropy, transcriptActivity, proteinDiversity, proteomeLoad, pathwayFlux, fluxDiversity,   regulationGating, ecCoupling, nativeFraction, misfoldLoad, foldStability, tfRegulation, envRecognition, expressionNoise, libraryDiversity, discoveryRate, noveltyMean, memoryDiversity, explorationFraction, behaviorNoise, mutationBurstRate, chaperoneLoad, aggregateLoad, foldFidelity, proteotoxicity, libraryCoverage, bindingSpecificity, combinatorialEntropy, decoherenceRate, coherenceLifetime, tunnelingRate, zeroPointEnergy, superpositionEntropy, entanglementEntropy, quantumParallelism, measurementBackaction, collapseRate, quantumDiffusion, tunnelCoupling, coherenceLength, quantumFidelity, bosonFieldIntensity, photonTransport, gluonConfinement, strongCoupling, weakBosonMass, higgsMassFloor, leptonMobility, electronChannel, quarkFlavorPopulation, upDownAsymmetry, strangeFlavor, charmPool, protonStability, latticePeriodicity, bandGap, fermiLevel, conductionBand, valenceBand, phononFlux, excitonBinding, defectDensity, dopingLevel, carrierMobility, topologicalInvariant, moireSuperlattice, latticeThermalSusceptibility, boltzmannEntropy, shannonDissimilarity, entropyChangeRate, gibbsFreeEnergy, timeReversalAsymmetry, maxwellDemonPower, demonInformationCost, absoluteZeroProximity, quantumLandauerFloor, heatCapacityAnomaly, kbtDamping, canonicalPartitionZ, nanoparticleSurface, nanoparticleDensity, nanoporeTransport, nanoscaleContact, molecularMachineWork, assemblerAccuracy, nanofabricationYield, dnaOrigamiStability, bionanoInterface, nanozymeActivity, colloidalStability, quantumDotBrightness, nanotoxicFlux, viralLoad, bacterialLoad, archaealDensity, fungalBiomass, protistMotility, moneraPrimordial, plantPhotosynthesis, poriferanChannel, chordateNeuralTube, piscesAquaticMetabolism, mammalThermoregulation, primateCognition, symbioticIndex, metabolicRate, cardiovascularPump, respirationEfficiency, digestiveThroughput, excretoryClearance, immuneSurveillance, neuralConductance, musculoskeletalOutput, endocrineSignaling, thermoregulationControl, fluidHomeostasis, sensoryPerception, growthReplication };
}

export function decodeSetMap(bytes: Uint8Array): SetMapMessage {
  const r = new ByteReader(bytes);
  r.u8(); // type
  const tick = r.u32();
  const size = r.u16();
  const cells = size * size;
  const depth = new Uint8Array(bytes.subarray(r.off, r.off + cells));
  r.off += cells;
  const escape = new Uint8Array(bytes.subarray(r.off, r.off + cells));
  r.off += cells;
  return { type: MT.SET, tick, size, depth, escape };
}

export function decodeJsonMessage(bytes: Uint8Array, type: number): unknown {
  return JSON.parse(new TextDecoder().decode(bytes.subarray(1)));
}

export function decodeAck(bytes: Uint8Array): number {
  const r = new ByteReader(bytes);
  r.u8();
  return r.u32();
}

export type WireMessage =
  | { kind: 'snapshot'; msg: SnapshotMessage }
  | { kind: 'delta'; msg: DeltaMessage }
  | { kind: 'stats'; msg: SimStats }
  | { kind: 'set'; msg: SetMapMessage }
  | { kind: 'world'; world: WorldConfig; status: WorldStatus }
  | { kind: 'event'; event: SimEvent }
  | { kind: 'ack'; sequence: number };

export function decodeServerFrame(bytes: Uint8Array): WireMessage {
  const type = bytes[0] ?? 0;
  switch (type) {
    case MT.SNAPSHOT:
      return { kind: 'snapshot', msg: decodeSnapshot(bytes) };
    case MT.DELTA:
      return { kind: 'delta', msg: decodeDelta(bytes) };
    case MT.STATS: {
      const s = decodeStats(bytes);
      return { kind: 'stats', msg: s };
    }
    case MT.SET:
      return { kind: 'set', msg: decodeSetMap(bytes) };
    case MT.WORLD: {
      const parsed = decodeJsonMessage(bytes, type) as { world: WorldConfig; status: WorldStatus };
      return { kind: 'world', world: parsed.world, status: parsed.status };
    }
    case MT.EVENT:
      return { kind: 'event', event: decodeJsonMessage(bytes, type) as SimEvent };
    case MT.INTERVENE_ACK:
      return { kind: 'ack', sequence: decodeAck(bytes) };
    default:
      throw new Error(`Unknown wire message type ${type}`);
  }
}
