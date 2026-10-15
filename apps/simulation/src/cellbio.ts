/**
 * Cell biochemistry module — opt-in deep biochemistry running inside each
 * agent's cell (enabled via `WorldConfig.cellBio`). OFF by default: when the
 * flag is absent the simulation is bit-identical to the legacy model.
 *
 * Adds:
 *   • a 4-class proteome whose fold quality is maintained by chaperone-driven
 *     refolding and damaged by pH / osmotic tension / sulfur scarcity;
 *   • Michaelis-Menten enzyme kinetics with end-product inhibition;
 *   • a membrane-surface chemical gradient (per molecule) with passive
 *     diffusion from the external medium and cytoskeletal transport to the
 *     bulk pool (mass-conserved);
 *   • active Na+/K+ pumping, mitochondrial respiration, lipid-based membrane
 *     repair, endocytosis and exocytosis.
 *
 * All math mirrors crates/simulation/src/cellbio.rs exactly; every f32 store
 * mirrors the Float32Array semantics of the TS reference.
 */
import {
  PROTEOME_SIZE,
  CHAPERONE_FOLD_RATE,
  CHAPERONE_ATP_COST,
  MISFOLD_STRESS_DECAY,
  MISFOLD_MEMBRANE_DAMAGE,
  PROTEIN_TURNOVER_RATE,
  GRADIENT_PROPAGATION_RATE,
  PASSIVE_DIFFUSION_RATE,
  MM_KM,
  MM_INHIBITION,
  LIPID_REPAIR_RATE,
  LIPID_REPAIR_ATP,
  FOLDING_SULFUR_SENSITIVITY,
  ELEMENTS,
  MOLECULES,
  IONS,
  MOLECULE_COUNT,
  MEMBRANE_TRANSPORT_COST,
  PH_NEUTRAL,
} from '@fractal-life/shared';
import type { AgentChemistry } from './chemistry.js';
import type { CellGenes, CellState, MembraneGenes } from './cells.js';
import type { SplitMix64 } from './rng.js';

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Proteome classes (index into the `proteome` array). */
export const PROTEOME_CLASS = {
  ENZYMATIC: 0,    // catalysts — gates metabolic yield
  STRUCTURAL: 1,   // membrane / cytoskeleton scaffolding — gates passive flux + repair
  CHAPERONE: 2,    // heat-shock protein pool — gates refolding + its own synthesis
  SIGNALING: 3,    // receptor machinery — gates exocytosis / endocytosis
} as const;

/** Fold-quality seed genes are the four membrane-protein genes. */
const PROTEOME_SEED = ['receptorDensity', 'channelDensity', 'pumpDensity', 'lipidComposition'] as const;

export interface CellBioState {
  /** Fold quality per proteome class in [0,1]. */
  proteome: Float32Array;
  /** Accumulated misfolded-protein stress (>= 0). */
  misfoldStress: number;
  /** Membrane-surface concentration per molecule (drives passive / active flux). */
  gradient: Float32Array;
}

/** Local environmental concentrations the membrane "sees". */
export interface ApplyEnv {
  O2Local: number;
  mineralLocal: number;
  toxinLocal: number;
  pHLocal: number;
  waterAvailable: number;
}

/**
 * Michaelis-Menten rate with non-competitive end-product inhibition.
 * Pure function — returns a rate (not clamped) for downstream scaling.
 */
export function michaelisMentenRate(Vmax: number, substrate: number, product: number): number {
  const s = Math.max(0, substrate);
  const p = Math.max(0, product);
  return Vmax * (s / (s + MM_KM)) * (1 / (1 + MM_INHIBITION * (p / 100)));
}

/**
 * Create the initial cell-biochemistry state: proteome fold quality seeded from
 * the four membrane-protein genes, gradient initialized equal to the bulk
 * molecule pool (thermodynamic equilibrium at birth).
 */
export function createCellBioState(
  memGenes: MembraneGenes,
  chemistry: AgentChemistry,
): CellBioState {
  const proteome = new Float32Array(PROTEOME_SIZE);
  for (let i = 0; i < PROTEOME_SIZE; i++) {
    proteome[i] = 0.6 + 0.4 * memGenes[PROTEOME_SEED[i]!];
  }
  const gradient = new Float32Array(MOLECULE_COUNT);
  for (let i = 0; i < MOLECULE_COUNT; i++) gradient[i] = chemistry.molecules[i] ?? 0;
  return { proteome, misfoldStress: 0, gradient };
}

/**
 * Protein-folding dynamics for one tick. Chaperone refolding repairs damaged
 * proteome classes; pH / tension / sulfur scarcity damage them. De-novo chaperone
 * synthesis is Michaelis-Menten (amino-acid substrate-limited, protein
 * product-inhibited). Returns ATP cost (energy units), the enzymatic class fold
 * quality (gates aerobic metabolism in the engine) and membrane damage from
 * misfold stress.
 */
export function tickFolding(
  chemistry: AgentChemistry,
  cell: CellState,
  bio: CellBioState,
  catalysisGene: number,
  dt: number,
): { atpCost: number; foldEffect: number; misfoldDamage: number } {
  let atpCost = 0;
  const sulfur = chemistry.elements[ELEMENTS.SULFUR] ?? 0;
  const sulfurFactor = sulfur < 3 ? 1 + FOLDING_SULFUR_SENSITIVITY : 1;
  const phStress = Math.abs((chemistry.pH ?? PH_NEUTRAL) - PH_NEUTRAL) * 0.01;
  const tensionStress = cell.tension * 0.02;
  const stress = (phStress + tensionStress) * sulfurFactor * dt;

  const chaperoneQuality = bio.proteome[PROTEOME_CLASS.CHAPERONE] ?? 0;

  // de-novo chaperone synthesis (biomolecule conservation: amino acids + ATP → protein)
  const synth =
    michaelisMentenRate(
      catalysisGene,
      chemistry.molecules[MOLECULES.AMINO_ACID] ?? 0,
      chemistry.molecules[MOLECULES.PROTEIN] ?? 0,
    ) * 0.04 * dt;
  const synthAa = Math.min(synth * 2, chemistry.molecules[MOLECULES.AMINO_ACID] ?? 0);
  const synthAtp = Math.min(synth * 0.5, chemistry.molecules[MOLECULES.ATP] ?? 0);
  chemistry.molecules[MOLECULES.AMINO_ACID]! -= synthAa;
  chemistry.molecules[MOLECULES.ATP]! -= synthAtp;
  bio.proteome[PROTEOME_CLASS.CHAPERONE] = clamp(
    (bio.proteome[PROTEOME_CLASS.CHAPERONE] ?? 0) + synth * 0.2,
    0,
    1,
  );
  atpCost += synthAtp * CHAPERONE_ATP_COST;

  for (let i = 0; i < PROTEOME_SIZE; i++) {
    let q = bio.proteome[i] ?? 0;
    q -= PROTEIN_TURNOVER_RATE * dt;
    q -= stress * 0.25;
    q += CHAPERONE_FOLD_RATE * chaperoneQuality * (1 - q) * dt;
    bio.proteome[i] = clamp(q, 0, 1);
  }

  let misfoldSum = 0;
  for (let i = 0; i < PROTEOME_SIZE; i++) misfoldSum += 1 - (bio.proteome[i] ?? 0);

  bio.misfoldStress = Math.max(
    0,
    (bio.misfoldStress ?? 0) +
      misfoldSum * 0.002 * dt -
      MISFOLD_STRESS_DECAY * (bio.misfoldStress ?? 0) * dt,
  );

  const foldEffect = bio.proteome[PROTEOME_CLASS.ENZYMATIC] ?? 0;
  const misfoldDamage = (bio.misfoldStress ?? 0) * MISFOLD_MEMBRANE_DAMAGE * dt;
  cell.membraneIntegrity = clamp(cell.membraneIntegrity - misfoldDamage, 0, 1);

  return { atpCost, foldEffect, misfoldDamage };
}

/**
 * Membrane biology for one tick:
 *   • passive diffusion of the external medium across the surface gradient;
 *   • active Na+/K+ pumping against the electrochemical gradient (ATP-gated);
 *   • mitochondrial respiration (glucose + O2 → ATP, MM-limited);
 *   • lipid-based membrane repair;
 *   • RNG-gated endocytosis (imports from the surface medium);
 *   • exocytosis (releases signal molecules onto the surface).
 * Returns ATP cost (energy units).
 */
export function tickMembraneBiochemistry(
  cell: CellState,
  bio: CellBioState,
  chemistry: AgentChemistry,
  memGenes: MembraneGenes,
  env: ApplyEnv,
  rng: SplitMix64,
  dt: number,
): { atpCost: number } {
  let atpCost = 0;
  const molecules = chemistry.molecules;
  const ions = chemistry.ions;
  const surface = bio.gradient;

  // --- external medium concentrations (derived from local terrain) ---
  const externalMolecule = new Float32Array(MOLECULE_COUNT);
  externalMolecule[MOLECULES.OSMOLYTE] = env.waterAvailable * 20;
  externalMolecule[MOLECULES.AMINO_ACID] = env.mineralLocal * 10;
  externalMolecule[MOLECULES.SUGAR] = env.mineralLocal * 5;
  externalMolecule[MOLECULES.GLUCOSE] = env.mineralLocal * 3;
  externalMolecule[MOLECULES.SIGNAL_MOL] = env.toxinLocal * 5;
  const externalIons = new Float32Array(5);
  externalIons[IONS.SODIUM] = 12 + env.mineralLocal * 5;
  externalIons[IONS.POTASSIUM_ION] = 6;
  externalIons[IONS.CALCIUM] = 2;
  externalIons[IONS.IRON_ION] = 1;
  externalIons[IONS.CHLORIDE] = 10 + env.mineralLocal * 3;

  // --- passive diffusion: medium ↔ surface gradient ---
  const structuralQuality = bio.proteome[PROTEOME_CLASS.STRUCTURAL] ?? 0;
  const diffRate = memGenes.permeability * PASSIVE_DIFFUSION_RATE * (0.5 + structuralQuality) * dt;
  for (let i = 0; i < MOLECULE_COUNT; i++) {
    surface[i]! += (externalMolecule[i]! - surface[i]!) * diffRate;
  }

  // --- active ion pump: Na+ out / K+ in against the gradient, ATP-gated ---
  const pumpRate = memGenes.pumpDensity * memGenes.activeTransport * 2.0 * dt;
  const naExcess = Math.max(0, (ions[IONS.SODIUM] ?? 0) - externalIons[IONS.SODIUM]!);
  const kDeficit = Math.max(0, externalIons[IONS.POTASSIUM_ION]! - (ions[IONS.POTASSIUM_ION] ?? 0));
  const naPump = Math.min(naExcess, pumpRate);
  const kPump = Math.min(kDeficit, pumpRate * 0.8);
  const atpUse = (naPump + kPump) * MEMBRANE_TRANSPORT_COST;
  const atpAvail = molecules[MOLECULES.ATP] ?? 0;
  if (atpUse <= atpAvail) {
    ions[IONS.SODIUM]! -= naPump;
    ions[IONS.POTASSIUM_ION]! += kPump;
    molecules[MOLECULES.ATP]! = atpAvail - atpUse;
    atpCost += atpUse;
  }

  // --- mitochondrial respiration: glucose + O2 → ATP (MM substrate/product limited) ---
  const glucose = molecules[MOLECULES.GLUCOSE] ?? 0;
  const enzymeQuality = bio.proteome[PROTEOME_CLASS.ENZYMATIC] ?? 0;
  const mitoBase =
    cell.mitoEfficiency * 0.02 * Math.min(glucose, 40) * env.O2Local * (0.5 + enzymeQuality) * dt;
  const mito = mitoBase * michaelisMentenRate(1, glucose, molecules[MOLECULES.ATP] ?? 0);
  const glucoseUsed = Math.min(mito * 5, glucose);
  molecules[MOLECULES.GLUCOSE]! -= glucoseUsed;
  molecules[MOLECULES.ATP]! = (molecules[MOLECULES.ATP] ?? 0) + mito;

  // --- lipid-based membrane repair ---
  if (cell.membraneIntegrity < 1) {
    const repairMag =
      memGenes.lipidComposition * LIPID_REPAIR_RATE * dt * (0.5 + structuralQuality);
    const lipidSpent = repairMag * 0.5;
    const lipidAvail = molecules[MOLECULES.LIPID] ?? 0;
    if (lipidSpent <= lipidAvail) {
      molecules[MOLECULES.LIPID]! -= lipidSpent;
      cell.membraneIntegrity = clamp(cell.membraneIntegrity + repairMag, 0, 1);
      atpCost += LIPID_REPAIR_ATP * dt;
    }
  }

  // --- endocytosis: engulf external rich medium (RNG-gated; same gate as cells.endocytosis) ---
  const nearby = externalMolecule[MOLECULES.GLUCOSE]! + externalMolecule[MOLECULES.AMINO_ACID]! +
    externalMolecule[MOLECULES.SUGAR]!;
  if (nearby > 0 && rng.nextFloat() < memGenes.endocytosis * 0.02) {
    const gain = nearby * 0.2;
    const gGlc = Math.min(gain * 0.4, externalMolecule[MOLECULES.GLUCOSE]!);
    const gAa = Math.min(gain * 0.4, externalMolecule[MOLECULES.AMINO_ACID]!);
    const gSugar = Math.min(gain * 0.2, externalMolecule[MOLECULES.SUGAR]!);
    surface[MOLECULES.GLUCOSE]! -= gGlc;
    surface[MOLECULES.AMINO_ACID]! -= gAa;
    surface[MOLECULES.SUGAR]! -= gSugar;
    molecules[MOLECULES.GLUCOSE]! += gGlc;
    molecules[MOLECULES.AMINO_ACID]! += gAa;
    molecules[MOLECULES.SUGAR]! += gSugar;
  }

  // --- exocytosis: release signal molecules onto the surface ---
  const signalOut = memGenes.exocytosis * (bio.proteome[PROTEOME_CLASS.SIGNALING] ?? 0) * 0.005 * dt;
  const amt = Math.min(signalOut, molecules[MOLECULES.SIGNAL_MOL] ?? 0);
  molecules[MOLECULES.SIGNAL_MOL]! -= amt;
  surface[MOLECULES.SIGNAL_MOL]! += amt;

  return { atpCost };
}

/**
 * Cytoskeleton-driven transport between the surface gradient and the bulk
 * molecule pool. Surface + bulk are conserved for every molecule species.
 */
export function tickGradientFlux(
  bio: CellBioState,
  chemistry: AgentChemistry,
  cellGenes: CellGenes,
  dt: number,
): void {
  const rate =
    GRADIENT_PROPAGATION_RATE *
    (0.5 + cellGenes.cytoskeleton) *
    (0.5 + cellGenes.vesicleTraffic) *
    dt;
  const molecules = chemistry.molecules;
  for (let i = 0; i < MOLECULE_COUNT; i++) {
    const d = bio.gradient[i]! - molecules[i]!;
    const flux = d * rate;
    bio.gradient[i] = Math.max(0, bio.gradient[i]! - flux);
    molecules[i] = Math.max(0, molecules[i]! + flux);
  }
}

/** Orchestrator: folding → membrane biochemistry → gradient flux. */
export function applyCellBioTick(
  chemistry: AgentChemistry,
  cell: CellState,
  bio: CellBioState,
  memGenes: MembraneGenes,
  cellGenes: CellGenes,
  catalysisGene: number,
  env: ApplyEnv,
  rng: SplitMix64,
  dt: number,
): { atpCost: number; membraneDamage: number; foldEffect: number } {
  const fold = tickFolding(chemistry, cell, bio, catalysisGene, dt);
  const mem = tickMembraneBiochemistry(cell, bio, chemistry, memGenes, env, rng, dt);
  tickGradientFlux(bio, chemistry, cellGenes, dt);
  return { atpCost: fold.atpCost + mem.atpCost, membraneDamage: fold.misfoldDamage, foldEffect: fold.foldEffect };
}