/**
 * Chemistry module — emergent molecular biochemistry for agent-based life.
 *
 * Design:
 *   Each agent carries a fixed-size internal inventory of:
 *     • 8 elements (C, H, O, N, P, S, Fe, K)
 *     • 12 molecules (glucose, ATP, amino acid, lipid, nucleotide, enzyme,
 *       protein, toxin, signal molecule, sugar, fatty acid, osmolyte)
 *     • 5 ions (Na+, K+, Ca2+, Fe2+/-, Cl-)
 *     • 6 enzyme types (oxidase, synthase, hydrolase, ligase, transferase, lyase)
 *     • pH (float, controls reaction rate modulation)
 *
 *   The environment carries 4 chemical terrain grids (O2, pH, toxins, dissolved
 *   minerals) that diffuse, decay, and interact with agents.
 *
 *   All chemistry is deterministic (uses SplitMix64 via the engine's RNG) and
 *   designed for O(1) per-agent per-tick cost.
 */
import {
  ELEMENT_COUNT,
  MOLECULE_COUNT,
  ION_COUNT,
  ENZYME_TYPE_COUNT,
  CHEM_MAX_ELEMENT,
  CHEM_MAX_MOLECULE,
  CHEM_MAX_ION,
  CHEM_MAX_ENZYME,
  REACTION_RATE,
  TRANSPORT_RATE,
  CHEM_DIFFUSE_RATE,
  CHEM_DECAY_RATE,
  PH_NEUTRAL,
  PH_RANGE,
  MINERAL_ION_RATE,
  TERRAIN_GRID,
  ENV_PROFILES,
  type EnvProfile,
} from '@fractal-life/shared';
import { SplitMix64 } from './rng.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AgentChemistry {
  /** Raw elemental inventory [0..CHEM_MAX_ELEMENT]. */
  elements: Float32Array;   // length = ELEMENT_COUNT
  /** Molecular concentrations [0..CHEM_MAX_MOLECULE]. */
  molecules: Float32Array;  // length = MOLECULE_COUNT
  /** Ion concentrations [0..CHEM_MAX_ION]. */
  ions: Float32Array;       // length = ION_COUNT
  /** Enzyme concentrations [0..CHEM_MAX_ENZYME]. */
  enzymes: Float32Array;    // length = ENZYME_TYPE_COUNT
  /** Internal pH (neutral 7.0). */
  pH: number;
}

export interface ChemTerrain {
  /** Dissolved oxygen in [0,1]. Produced by plant photosynthesis. */
  O2: Float32Array;
  /** Soil water pH in [3,11]. Neutral 7.0. */
  pH: Float32Array;
  /** Toxin concentration in [0,1]. Produced by agents, decays. */
  toxin: Float32Array;
  /** Dissolved mineral ions in [0,1]. Weathered from soil. */
  minerals: Float32Array;
  size: number;
}

export interface ReactionResult {
  moleculeDeltas: Float32Array;
  elementDeltas: Float32Array;
  energyDelta: number;
}

// ---------------------------------------------------------------------------
// Creation
// ---------------------------------------------------------------------------

/** Create a default agent chemistry with baseline concentrations. */
export function createAgentChemistry(genome: Float32Array, seed: number): AgentChemistry {
  const rng = new SplitMix64(seed);
  const elements = new Float32Array(ELEMENT_COUNT);
  const molecules = new Float32Array(MOLECULE_COUNT);
  const ions = new Float32Array(ION_COUNT);
  const enzymes = new Float32Array(ENZYME_TYPE_COUNT);

  // initial concentrations derived from genome
  const carbBias = genome[120] ?? 0.5;     // C preference
  const nitroBias = genome[121] ?? 0.5;    // N preference
  const phosphoBias = genome[122] ?? 0.5;  // P preference
  const sulfurBias = genome[123] ?? 0.5;   // S preference
  const catalysisRate = genome[124] ?? 0.5; // enzyme efficiency gene
  const toxResist = genome[125] ?? 0.5;     // toxin resistance / production
  const ionPump = genome[126] ?? 0.5;       // active ion transport efficiency
  const redoxBalance = genome[127] ?? 0.5;  // redox (oxidation/reduction) preference

  // baseline elements (small starting pool)
  elements[0] = 15 + carbBias * 20;          // C
  elements[1] = 20 + rng.nextFloat() * 10;        // H
  elements[2] = 15 + (1 - redoxBalance) * 15; // O
  elements[3] = 10 + nitroBias * 15;          // N
  elements[4] = 5 + phosphoBias * 10;         // P
  elements[5] = 3 + sulfurBias * 7;           // S
  elements[6] = 2 + rng.nextFloat() * 3;           // Fe
  elements[7] = 5 + ionPump * 10;             // K

  // baseline molecules
  molecules[0] = 20 + rng.nextFloat() * 15;  // glucose (fuel)
  molecules[1] = 10 + rng.nextFloat() * 10;  // ATP (energy)
  molecules[2] = 5 + nitroBias * 10;    // amino acid
  molecules[3] = 3 + carbBias * 8;      // lipid
  molecules[4] = 2 + phosphoBias * 5;   // nucleotide
  molecules[5] = 2 + catalysisRate * 5;  // enzyme
  molecules[6] = 3;                      // protein
  molecules[7] = toxResist * 5;          // toxin
  molecules[8] = 2;                      // signal molecule
  molecules[9] = 15 + rng.nextFloat() * 10;  // sugar
  molecules[10] = 2 + carbBias * 5;     // fatty acid
  molecules[11] = 5 + ionPump * 5;      // osmolyte

  // baseline ions
  ions[0] = 10 + ionPump * 5;  // Na+
  ions[1] = 8 + ionPump * 5;   // K+
  ions[2] = 2 + rng.nextFloat() * 3; // Ca2+
  ions[3] = 1 + rng.nextFloat() * 2; // Fe2+/3+
  ions[4] = 8 + ionPump * 4;   // Cl-

  // baseline enzymes
  enzymes[0] = 3 + catalysisRate * 5;  // oxidase
  enzymes[1] = 2 + catalysisRate * 4;  // synthase
  enzymes[2] = 2 + catalysisRate * 3;  // hydrolase
  enzymes[3] = 1 + catalysisRate * 3;  // ligase
  enzymes[4] = 1 + catalysisRate * 2;  // transferase
  enzymes[5] = 1 + catalysisRate * 2;  // lyase

  return { elements, molecules, ions, enzymes, pH: PH_NEUTRAL + (rng.nextFloat() - 0.5) * 0.6 };
}

/** Create the environmental chemistry grids. */
export function createChemTerrain(gridSize: number, env: EnvProfile = ENV_PROFILES.calm): ChemTerrain {
  return {
    O2: new Float32Array(gridSize * gridSize).fill(env.o2),
    pH: new Float32Array(gridSize * gridSize).fill(env.ph),
    toxin: new Float32Array(gridSize * gridSize).fill(env.toxin),
    minerals: new Float32Array(gridSize * gridSize).fill(env.minerals),
    size: gridSize,
  };
}

// ---------------------------------------------------------------------------
// Tick: per-agent chemistry update
// ---------------------------------------------------------------------------

/**
 * Run one tick of agent chemistry.  Called once per alive agent per tick.
 *
 * Returns a net energy delta (positive = energy gain from metabolism, negative =
 * energy cost of maintaining chemistry).
 */
export interface ChemStoichiometry {
  /** plant-food element ratios [C,H,O,N,P,S,Fe,K] */
  plant?: number[];
  /** meat-food element ratios [C,H,O,N,P,S,Fe,K] */
  meat?: number[];
}

const DEFAULT_PLANT_STOICH = [6, 4, 3, 1.5, 0, 0, 0, 0];
const DEFAULT_MEAT_STOICH = [5, 3, 0, 3, 1.5, 1, 0.8, 0];

export function tickAgentChemistry(
  chem: AgentChemistry,
  foodIntake: number,      // amount of plant food absorbed this tick (0..1)
  meatIntake: number,      // amount of meat absorbed this tick (0..1)
  waterAvailable: number,  // surrounding moisture [0,1]
  O2Local: number,         // environmental O2 [0,1]
  pHLocal: number,         // environmental pH
  toxinLocal: number,      // environmental toxin [0,1]
  mineralLocal: number,    // environmental dissolved minerals [0,1]
  diet: number,            // genome diet gene [0,1]: <0.4 herbivore, >0.6 carnivore
  catalysisGene: number,   // genome[124]: catalysis efficiency
  toxGene: number,         // genome[125]: toxin resistance / production
  ionGene: number,         // genome[126]: ion pump efficiency
  redoxGene: number,       // genome[127]: redox balance
  dt: number,              // time step (usually 1)
  stoich?: ChemStoichiometry, // real-world acceptance (enrichment)
): number {
  const { elements, molecules, ions, enzymes, pH: pHin } = chem;

  // pH equilibration with environment (slow)
  chem.pH = pHin + (pHLocal - pHin) * 0.002 * dt;

  // pH rate modifier: reactions are fastest at neutral pH
  const pHDist = Math.abs(chem.pH - PH_NEUTRAL);
  const pHmod = Math.max(0.1, 1.0 - pHDist / PH_RANGE);

  // --- 1. Elemental uptake from environment ---
  // minerals dissolve into element pool
  const mineralUptake = mineralLocal * 0.3 * dt;
  elements[4] = Math.min(CHEM_MAX_ELEMENT, elements[4] + mineralUptake * 0.3);  // P
  elements[5] = Math.min(CHEM_MAX_ELEMENT, elements[5] + mineralUptake * 0.15); // S
  elements[6] = Math.min(CHEM_MAX_ELEMENT, elements[6] + mineralUptake * 0.1);  // Fe
  elements[7] = Math.min(CHEM_MAX_ELEMENT, elements[7] + mineralUptake * 0.45); // K

  // water brings H and O
  const waterUptake = waterAvailable * 0.15 * dt;
  elements[1] = Math.min(CHEM_MAX_ELEMENT, elements[1] + waterUptake * 0.67); // H
  elements[2] = Math.min(CHEM_MAX_ELEMENT, elements[2] + waterUptake * 0.33); // O

  // O2 from environment
  const o2Uptake = O2Local * 0.2 * dt;
  elements[2] = Math.min(CHEM_MAX_ELEMENT, elements[2] + o2Uptake);

  // --- 2. Food digestion: food → raw elements + simple sugars ---
  const digestionRate = REACTION_RATE * 8;
  // Real-world stoichiometry (element ratios per unit of digested food). The
  // sim's element order is [C,H,O,N,P,S,Fe,K]; we index explicitly so the
  // arrays can come from real molecular formulas without ambiguity.
  const p = stoich?.plant ?? DEFAULT_PLANT_STOICH;
  const m = stoich?.meat ?? DEFAULT_MEAT_STOICH;
  if (foodIntake > 0) {
    const digested = foodIntake * digestionRate * pHmod * dt;
    // plants are C/H/O/N rich — stoichiometry element flux
    elements[0] = Math.min(CHEM_MAX_ELEMENT, elements[0] + digested * (p[0] ?? 6));   // C
    elements[1] = Math.min(CHEM_MAX_ELEMENT, elements[1] + digested * (p[1] ?? 4));   // H
    elements[2] = Math.min(CHEM_MAX_ELEMENT, elements[2] + digested * (p[2] ?? 3));   // O
    elements[3] = Math.min(CHEM_MAX_ELEMENT, elements[3] + digested * (p[3] ?? 1.5)); // N
    elements[4] = Math.min(CHEM_MAX_ELEMENT, elements[4] + digested * (p[4] ?? 0));   // P
    elements[5] = Math.min(CHEM_MAX_ELEMENT, elements[5] + digested * (p[5] ?? 0));   // S
    elements[6] = Math.min(CHEM_MAX_ELEMENT, elements[6] + digested * (p[6] ?? 0));   // Fe
    elements[7] = Math.min(CHEM_MAX_ELEMENT, elements[7] + digested * (p[7] ?? 0));   // K
    molecules[9] = Math.min(CHEM_MAX_MOLECULE, molecules[9] + digested * 5); // sugar
    molecules[0] = Math.min(CHEM_MAX_MOLECULE, molecules[0] + digested * 3); // glucose
  }
  if (meatIntake > 0) {
    const digested = meatIntake * digestionRate * pHmod * dt;
    // meat is richer in N, S, P, Fe — stoichiometry element flux
    elements[0] = Math.min(CHEM_MAX_ELEMENT, elements[0] + digested * (m[0] ?? 5));   // C
    elements[1] = Math.min(CHEM_MAX_ELEMENT, elements[1] + digested * (m[1] ?? 3));   // H
    elements[2] = Math.min(CHEM_MAX_ELEMENT, elements[2] + digested * (m[2] ?? 0));   // O
    elements[3] = Math.min(CHEM_MAX_ELEMENT, elements[3] + digested * (m[3] ?? 3));   // N
    elements[4] = Math.min(CHEM_MAX_ELEMENT, elements[4] + digested * (m[4] ?? 1.5)); // P
    elements[5] = Math.min(CHEM_MAX_ELEMENT, elements[5] + digested * (m[5] ?? 1));   // S
    elements[6] = Math.min(CHEM_MAX_ELEMENT, elements[6] + digested * (m[6] ?? 0.8)); // Fe
    elements[7] = Math.min(CHEM_MAX_ELEMENT, elements[7] + digested * (m[7] ?? 0));   // K
    molecules[2] = Math.min(CHEM_MAX_MOLECULE, molecules[2] + digested * 4); // amino acid
    molecules[10] = Math.min(CHEM_MAX_MOLECULE, molecules[10] + digested * 2); // fatty acid
  }

  // --- 3. Catalysed reactions (enzyme-gated) ---
  const catMod = 0.3 + catalysisGene * 1.4; // genome-modulated catalytic power

  // Oxidase: sugar + O2 → ATP + CO2 (energy production)
  {
    const oxRate = enzymes[0] * catMod * pHmod * REACTION_RATE * dt;
    const substrate = Math.min(molecules[9], O2Local * 30 * oxRate);
    const produced = substrate * 0.8;
    molecules[9] -= substrate;
    elements[2] = Math.min(CHEM_MAX_ELEMENT, elements[2] + substrate * 0.5); // O2 consumed → waste
    molecules[1] = Math.min(CHEM_MAX_MOLECULE, molecules[1] + produced); // ATP
    elements[0] = Math.min(CHEM_MAX_ELEMENT, elements[0] + substrate * 0.3); // CO2 released (C back to pool)
  }

  // Synthase: amino acid → protein
  {
    const synRate = enzymes[1] * catMod * pHmod * REACTION_RATE * dt;
    const substrate = Math.min(molecules[2] * 0.3, synRate * 5);
    molecules[2] -= substrate;
    molecules[6] = Math.min(CHEM_MAX_MOLECULE, molecules[6] + substrate * 0.9);
    elements[1] = Math.min(CHEM_MAX_ELEMENT, elements[1] + substrate * 0.1); // H2O byproduct
  }

  // Ligase: fatty acid + glycerol → lipid (uses ATP)
  {
    const ligRate = enzymes[3] * catMod * pHmod * REACTION_RATE * dt;
    const atpCost = Math.min(molecules[1] * 0.2, ligRate * 3);
    const substrate = Math.min(molecules[10] * 0.4, ligRate * 4);
    if (atpCost > 0.5 && substrate > 0.5) {
      molecules[1] -= atpCost;
      molecules[10] -= substrate;
      molecules[3] = Math.min(CHEM_MAX_MOLECULE, molecules[3] + substrate * 0.8);
    }
  }

  // Transferase: nucleotide → DNA repair / replication
  {
    const trRate = enzymes[4] * catMod * pHmod * REACTION_RATE * dt;
    const substrate = Math.min(molecules[4] * 0.2, trRate * 3);
    molecules[4] -= substrate;
    // nucleotide use generates ATP demand
    const atpCost = Math.min(molecules[1] * 0.1, substrate * 2);
    molecules[1] -= atpCost;
  }

  // Lyase: glucose → fatty acid + sugar (branching metabolism)
  {
    const lyRate = enzymes[5] * catMod * pHmod * REACTION_RATE * dt * (1 - diet); // preferential in herbivores
    const substrate = Math.min(molecules[0] * 0.15, lyRate * 2);
    molecules[0] -= substrate;
    molecules[10] = Math.min(CHEM_MAX_MOLECULE, molecules[10] + substrate * 0.5);
    molecules[9] = Math.min(CHEM_MAX_MOLECULE, molecules[9] + substrate * 0.5);
  }

  // Hydrolase: protein → amino acid (catabolism, when energy is low)
  {
    const hydRate = enzymes[2] * catMod * pHmod * REACTION_RATE * dt;
    const needATP = molecules[1] < CHEM_MAX_MOLECULE * 0.2;
    if (needATP && molecules[6] > 5) {
      const substrate = Math.min(molecules[6] * 0.2, hydRate * 4);
      molecules[6] -= substrate;
      molecules[2] = Math.min(CHEM_MAX_MOLECULE, molecules[2] + substrate * 0.9);
      molecules[1] = Math.min(CHEM_MAX_MOLECULE, molecules[1] + substrate * 0.3); // some ATP
    }
  }

  // --- 4. Enzyme synthesis (anabolic, requires ATP + amino acids) ---
  {
    const synthCost = 0.8;
    if (molecules[1] > 5 && molecules[2] > 3) {
      const catE = catMod * 0.02 * dt;
      for (let e = 0; e < ENZYME_TYPE_COUNT; e++) {
        const uptake = Math.min(catE, molecules[2] * 0.05, molecules[1] * 0.05);
        if (uptake > 0.01) {
          enzymes[e] = Math.min(CHEM_MAX_ENZYME, enzymes[e] + uptake * synthCost);
          molecules[2] -= uptake * 0.5;
          molecules[1] -= uptake * 0.3;
        }
      }
    }
  }

  // --- 5. Enzyme decay ---
  for (let e = 0; e < ENZYME_TYPE_COUNT; e++) {
    enzymes[e] = Math.max(0, enzymes[e] - 0.01 * dt);
  }

  // --- 5b. ATP decay (depletes without ongoing oxidase/digestion input) ---
  molecules[1] = Math.max(0, molecules[1] - 0.015 * dt);

  // --- 6. Toxin metabolism ---
  {
    // production: toxin synthesis from amino acids (costly, gated by toxGene)
    const toxProd = toxGene * 0.03 * dt;
    if (molecules[2] > 3) {
      molecules[7] = Math.min(CHEM_MAX_MOLECULE, molecules[7] + toxProd);
      molecules[2] -= toxProd * 0.5;
    }
    // environmental toxin absorption (reduced by resistance gene)
    const toxAbsorb = toxinLocal * 0.05 * (1 - toxGene * 0.7) * dt;
    molecules[7] = Math.min(CHEM_MAX_MOLECULE, molecules[7] + toxAbsorb);
    // toxin decay
    molecules[7] = Math.max(0, molecules[7] - 0.005 * dt);
  }

  // --- 7. Ion pump (active transport, costs ATP) ---
  {
    const pumpRate = ionGene * 0.05 * dt;
    const atpAvail = molecules[1] > 2;
    if (atpAvail) {
      // pump K+ in, Na+ out, maintain gradient
      ions[1] = Math.min(CHEM_MAX_ION, ions[1] + pumpRate);  // K+ in
      ions[0] = Math.max(0, ions[0] - pumpRate * 0.8);        // Na+ out
      ions[4] = Math.max(0, ions[4] - pumpRate * 0.5);        // Cl- follows
      molecules[1] -= pumpRate * 0.3; // ATP cost
    }
    // Ca2+ signalling: increases with crowding, decays
    ions[2] = Math.max(0, ions[2] - 0.01 * dt);
    // Fe redox
    ions[3] = Math.min(CHEM_MAX_ION, ions[3] + redoxGene * 0.01 * dt);
  }

  // --- 8. Osmolyte production (protects against water stress) ---
  {
    if (waterAvailable < 0.2 && molecules[1] > 3) {
      molecules[11] = Math.min(CHEM_MAX_MOLECULE, molecules[11] + 0.03 * dt);
      molecules[1] -= 0.01 * dt;
    } else {
      molecules[11] = Math.max(0, molecules[11] - 0.005 * dt);
    }
  }

  // --- 9. Signal molecule production (costly, honest signal) ---
  {
    if (molecules[8] < CHEM_MAX_MOLECULE * 0.5) {
      const sigCost = 0.002 * dt;
      molecules[8] = Math.min(CHEM_MAX_MOLECULE, molecules[8] + sigCost);
      molecules[1] = Math.max(0, molecules[1] - sigCost * 0.5);
    }
    molecules[8] = Math.max(0, molecules[8] - 0.003 * dt); // signal decay
  }

  // --- 10. Compute energy delta from ATP pool ---
  // ATP is the universal energy currency: each unit of ATP spent → energy
  const atpEnergyGain = molecules[1] * 0.002 * dt;
  // chemistry maintenance cost (proportional to total molecule inventory)
  let totalMolecules = 0;
  for (let m = 0; m < MOLECULE_COUNT; m++) totalMolecules += molecules[m]!;
  const maintenanceCost = totalMolecules * 0.00005 * dt;

  return atpEnergyGain - maintenanceCost;
}

// ---------------------------------------------------------------------------
// Environmental chemistry: terrain grid updates
// ---------------------------------------------------------------------------

/**
 * Diffuse + decay the four chemical terrain grids.
 * Also handles: plant O2 production, decomposition, mineral weathering.
 */
export function tickChemTerrain(
  chem: ChemTerrain,
  foodField: Float32Array,
  meatField: Float32Array,
  daylight: number,
  seasonMoisture: number,
  dt: number,
): void {
  const sz = chem.size;
  const n = sz * sz;
  const diffRate = CHEM_DIFFUSE_RATE * dt;
  const decayRate = CHEM_DECAY_RATE;

  // temporary buffer for diffusion
  const tmpO2 = new Float32Array(n);
  const tmpTox = new Float32Array(n);
  const tmpMin = new Float32Array(n);

  for (let y = 0; y < sz; y++) {
    for (let x = 0; x < sz; x++) {
      const i = y * sz + x;
      const xp = (x + 1) % sz;
      const xm = (x - 1 + sz) % sz;
      const yp = (y + 1) % sz;
      const ym = (y - 1 + sz) % sz;

      // Laplacian (toroidal)
      const lapO2 = chem.O2[yp * sz + x]! + chem.O2[ym * sz + x]! +
                    chem.O2[y * sz + xp]! + chem.O2[y * sz + xm]! -
                    4 * chem.O2[i]!;
      const lapTox = chem.toxin[yp * sz + x]! + chem.toxin[ym * sz + x]! +
                     chem.toxin[y * sz + xp]! + chem.toxin[y * sz + xm]! -
                     4 * chem.toxin[i]!;
      const lapMin = chem.minerals[yp * sz + x]! + chem.minerals[ym * sz + x]! +
                     chem.minerals[y * sz + xp]! + chem.minerals[y * sz + xm]! -
                     4 * chem.minerals[i]!;

      tmpO2[i] = chem.O2[i]! + diffRate * lapO2;
      tmpTox[i] = chem.toxin[i]! + diffRate * lapTox * 0.5; // toxins diffuse slower
      tmpMin[i] = chem.minerals[i]! + diffRate * lapMin * 0.3; // minerals diffuse slowest
    }
  }

  // Apply diffusion + source/sink terms
  for (let i = 0; i < n; i++) {
    // O2: produced by plants (food > 0) in daylight, consumed by decay
    const plantO2 = foodField[i]! * daylight * 0.001;
    const decayO2 = chem.O2[i]! * 0.0005; // organic decay consumes O2
    chem.O2[i] = Math.max(0, Math.min(1, tmpO2[i]! + plantO2 - decayO2));

    // pH: driven by chemistry, mineral weathering buffers toward neutral
    const phDrift = (PH_NEUTRAL - chem.pH[i]!) * 0.0002;
    const acidInput = chem.toxin[i]! * 0.001; // toxins acidify
    chem.pH[i] += (phDrift - acidInput + (seasonMoisture - 0.5) * 0.0001) * dt;
    chem.pH[i] = Math.max(3, Math.min(11, chem.pH[i]));

    // Toxins: decay + production from meat decomposition
    const meatToxin = meatField[i]! * 0.0005;
    chem.toxin[i] = Math.max(0, Math.min(1, tmpTox[i]! + meatToxin));

    // Dissolved minerals: weathering from soil + plant uptake
    const weathering = MINERAL_ION_RATE * dt;
    const plantUptake = foodField[i]! > 0 ? 0.0002 * dt : 0;
    chem.minerals[i] = Math.max(0, Math.min(1, tmpMin[i]! + weathering - plantUptake));

    // pH affects mineral dissolution (acidic = more dissolution)
    const acidBonus = Math.max(0, (PH_NEUTRAL - chem.pH[i]!) * 0.0001);
    chem.minerals[i] = Math.min(1, chem.minerals[i] + acidBonus);
  }
}

// ---------------------------------------------------------------------------
// Snapshot helpers
// ---------------------------------------------------------------------------

/** Normalise agent chemistry to [0,1] for stats. */
export function normaliseChemistry(chem: AgentChemistry): {
  elements: Float32Array;
  molecules: Float32Array;
  ions: Float32Array;
  enzymes: Float32Array;
  pH: number;
} {
  const elements = new Float32Array(ELEMENT_COUNT);
  const molecules = new Float32Array(MOLECULE_COUNT);
  const ions = new Float32Array(ION_COUNT);
  const enzymes = new Float32Array(ENZYME_TYPE_COUNT);
  for (let i = 0; i < ELEMENT_COUNT; i++) elements[i] = chem.elements[i]! / CHEM_MAX_ELEMENT;
  for (let i = 0; i < MOLECULE_COUNT; i++) molecules[i] = chem.molecules[i]! / CHEM_MAX_MOLECULE;
  for (let i = 0; i < ION_COUNT; i++) ions[i] = chem.ions[i]! / CHEM_MAX_ION;
  for (let i = 0; i < ENZYME_TYPE_COUNT; i++) enzymes[i] = chem.enzymes[i]! / CHEM_MAX_ENZYME;
  return { elements, molecules, ions, enzymes, pH: chem.pH };
}
