/** Fundamental physical constants (SI). */
export const CONSTANTS = {
  /** Gravitational constant, m^3 kg^-1 s^-2 */
  G: 6.67430e-11,
  /** Speed of light, m/s */
  C: 2.99792458e8,
  /** Planck constant, J s */
  H: 6.62607015e-34,
  /** Reduced Planck constant, J s */
  HBAR: 1.054571817e-34,
  /** Boltzmann constant, J/K */
  KB: 1.380649e-23,
  /** Elementary charge, C */
  E: 1.602176634e-19,
  /** Proton mass, kg */
  PROTON_MASS: 1.67262192369e-27,
  /** Electron mass, kg */
  ELECTRON_MASS: 9.1093837015e-31,
  /** Stefan-Boltzmann constant, W m^-2 K^-4 */
  SIGMA_SB: 5.670374419e-8,
  /** Astronomical unit, m */
  AU: 1.495978707e11,
  /** Light-year, m */
  LY: 9.4607304725808e15,
  /** Parsec, m */
  PC: 3.08567758149137e16,
} as const;

/** Solar system reference (SI). */
export const SOLAR = {
  /** Solar mass, kg */
  MASS: 1.98892e30,
  /** Solar radius, m */
  RADIUS: 6.957e8,
  /** Solar luminosity, W */
  LUMINOSITY: 3.828e26,
  /** Effective photosphere temperature, K */
  T_EFFECTIVE: 5772,
} as const;

/** Earth reference (SI). */
export const EARTH = {
  /** Mean equatorial radius, m */
  RADIUS: 6.3781e6,
  /** Mass, kg */
  MASS: 5.9722e24,
  /** Standard surface gravity, m/s^2 */
  GRAVITY: 9.80665,
  /** Orbital semi-major axis, m */
  SEMI_MAJOR: CONSTANTS.AU,
  /** Sidereal rotation period, s */
  DAY_SEC: 86164.09,
  /** Mean orbital velocity, m/s */
  ORBITAL_VELOCITY: 29784.8,
  /** Surface atmospheric pressure, Pa */
  ATM_PRESSURE: 101325.0,
  /** Bond albedo */
  ALBEDO: 0.306,
  /** Greenhouse effective temperature boost, K */
  GREENHOUSE_DELTA: 33.0,
} as const;

export interface UniverseConfig {
  /** Local gravitational acceleration at the world surface, m/s^2. */
  localGravity?: number;
  /** Parent star mass, kg. */
  parentMass?: number;
  /** Parent star luminosity, W. */
  parentLuminosity?: number;
  /** Parent star effective temperature, K. */
  parentTeffective?: number;
  /** Planet mean radius, m. */
  planetRadius?: number;
  /** Planet mass, kg. */
  planetMass?: number;
  /** Planet semi-major axis around parent star, m. */
  semiMajorAxis?: number;
  /** Planet orbital eccentricity, dimensionless [0,1). */
  eccentricity?: number;
  /** Planet sidereal day length, seconds. */
  dayLengthSec?: number;
  /** Surface atmospheric pressure, Pa. */
  atmospherePressure?: number;
  /** Bond albedo, dimensionless [0,1). */
  albedo?: number;
  /** Effective greenhouse temperature boost, K. */
  greenhouseDelta?: number;
}

export interface WorldPhysics {
  /** Local gravitational acceleration (m/s^2). */
  localGravity: number;
  /** Escape velocity at the world surface (m/s). */
  escapeVelocity: number;
  /** Escape velocity in world-units per tick (SI m/s ÷ WORLD_UNIT_METERS). */
  escapeVelocityWorldUnits: number;
  /** Gravitational potential energy per unit mass per world-unit climb (dimensionless for engine: energy per tick^2 / (world unit * unit_mass^2)). */
  gravityAccel: number;
  /** Equivalent energy cost in engine units for climbing one world-unit height.
   *  When universe is absent this equals the legacy CLIMB_COST constant. */
  climbCostScale: number;
  /** Local insolation flux (W m^-2) from the parent star. */
  insolationFlux: number;
  /** Effective equilibrium surface temperature, K. */
  equilibriumTemperature: number;
  /** Keplerian orbital period, s. */
  orbitalPeriod: number;
  /** Planetary day length, s (fallback to EARTH.DAY_SEC). */
  dayLengthSec: number;
  /** Atmospheric scale height (m) = R T / (mu g). Uses dry air mu ≈ 0.02897 kg/mol. */
  scaleHeight: number;
  /** Derived conservation laws for this world. */
  conservationLaws: ConservationLaws;
  /** Derived symmetry laws for this world. */
  symmetryLaws: SymmetryLaws;
}

/** Conservation laws: how strictly the world's energy, mass, and momentum
 *  budgets are balanced.  All values in [0.5, 1]; legacy (no universe) = 1.0
 *  → zero engine effect. */
export interface ConservationLaws {
  /** Normalised energy input: insolationFlux / SOLAR_CONSTANT_AT_EARTH.
   *  Earth-like ≈ 1.0; drives food-regrowth scaling. */
  energyBudgetRatio: number;
  /** Gravity-dependent mass return rate: min(1, localGravity / EARTH.GRAVITY).
   *  Earth-like = 1.0; drives decomposition scaling. */
  massRecyclingRate: number;
  /** Atmosphere-dependent momentum preservation: 1 / (1 + (atm/ATM_EARTH) × 0.3).
   *  Earth ≈ 0.77; drives drag modulation (higher → less drag). */
  momentumRetention: number;
  /** Rotation-dependent angular momentum: dayLengthSec / EARTH.DAY_SEC.
   *  Earth-like = 1.0; reserved for future Coriolis effects. */
  angularMomentumFactor: number;
}

/** Laws of symmetry (Noether correspondences): spatial and temporal
 *  uniformity of the physics.  All values in [0, 1]; legacy = 1.0. */
export interface SymmetryLaws {
  /** Directional uniformity: 1 − eccentricity × 0.5.
   *  Circular orbit = 1.0; drives thrust-direction isotropy. */
  spatialIsotropy: number;
  /** Temporal uniformity: sqrt(1 − eccentricity²).
   *  Circular orbit = 1.0; drives seasonal-amplitude modulation. */
  temporalUniformity: number;
  /** Position uniformity: always 1.0 (toroidal world). */
  translationalInvariance: number;
  /** Angular uniformity: always 1.0 (isotropic world). */
  rotationalSymmetry: number;
}

const DRY_AIR_MU = 0.0289644;
/** Universal gas constant, J/(mol·K). */
const R_UNIVERSAL = 8.314462618;
const SOLAR_CONSTANT_AT_EARTH = SOLAR.LUMINOSITY / (4 * Math.PI * CONSTANTS.AU * CONSTANTS.AU);
const LEGACY_CLIMB_COST = 4.0;
/** One world-unit corresponds to this many metres of physical length, matching
 *  the engine scale (spawn ~600 agents, cell-capacity 100 energy, WORLD_SIZE
 *  2048 units ≈ 2048 km planet diameter). Used to convert SI velocities (m/s)
 *  into world-units per tick. */
export const WORLD_UNIT_METERS = 1000;
/** The legacy CLIMB_COST encodes an arbitrary per-world-unit energy penalty.
 *  Real physics: climbCost = gravity_accel * worldUnitInMetres.
 *  We calibrate to 1 world-unit = 1 metre for scale (agents move world-units;
 *  typical displacement ~1 unit/tick at timeScale=1).
 *  To remain dimension-consistent with the existing engine energy (units of
 *  "engine-energy", where cell capacity ≈ 100) we scale the Joule-derived
 *  term so that the real Earth value matches the legacy magnitude.
 *  Legacy: climbCost = dh * 4.0 * size.
 *  Real (Earth): dh * 9.80665 * (scaleToEngine) * size => scaleToEngine = 4.0 / 9.80665 ≈ 0.408. */
const ENGINE_SCALE = LEGACY_CLIMB_COST / EARTH.GRAVITY;

const LEGACY_CONSERVATION: ConservationLaws = {
  energyBudgetRatio: 1.0,
  massRecyclingRate: 1.0,
  momentumRetention: 1.0,
  angularMomentumFactor: 1.0,
};

const LEGACY_SYMMETRY: SymmetryLaws = {
  spatialIsotropy: 1.0,
  temporalUniformity: 1.0,
  translationalInvariance: 1.0,
  rotationalSymmetry: 1.0,
};

function keplerPeriod(parentMass: number, semiMajor: number): number {
  const mu = CONSTANTS.G * parentMass;
  return 2 * Math.PI * Math.sqrt((semiMajor * semiMajor * semiMajor) / mu);
}

function escapeVelocity(mass: number, radius: number): number {
  return Math.sqrt((2 * CONSTANTS.G * mass) / radius);
}

function equilibriumTemperature(flux: number, albedo: number, greenhouseDelta: number): number {
  // spherical planet: intercepted flux averaged over the surface (/4)
  const absorbed = (flux * (1 - albedo)) / 4;
  return Math.pow(absorbed / CONSTANTS.SIGMA_SB, 0.25) + greenhouseDelta;
}

function scaleHeight(temperature: number, gravity: number): number {
  return (R_UNIVERSAL * temperature) / (DRY_AIR_MU * gravity);
}

function deriveConservationLaws(universe: UniverseConfig, physics: {
  localGravity: number;
  insolationFlux: number;
}): ConservationLaws {
  const atmosphere = universe.atmospherePressure ?? EARTH.ATM_PRESSURE;
  const dayLength = universe.dayLengthSec ?? EARTH.DAY_SEC;
  return {
    energyBudgetRatio: physics.insolationFlux / SOLAR_CONSTANT_AT_EARTH,
    massRecyclingRate: Math.min(1.0, physics.localGravity / EARTH.GRAVITY),
    momentumRetention: 1.0 / (1.0 + (atmosphere / EARTH.ATM_PRESSURE) * 0.3),
    angularMomentumFactor: dayLength / EARTH.DAY_SEC,
  };
}

function deriveSymmetryLaws(universe: UniverseConfig): SymmetryLaws {
  const ecc = universe.eccentricity ?? 0;
  const clampedEcc = Math.min(0.99, Math.max(0, ecc));
  return {
    spatialIsotropy: 1.0 - clampedEcc * 0.5,
    temporalUniformity: Math.sqrt(1.0 - clampedEcc * clampedEcc),
    translationalInvariance: 1.0,
    rotationalSymmetry: 1.0,
  };
}

/** Compute the physically-derived world parameters.
 *  When `universe` is omitted or empty, returns legacy-equivalent values so
 *  existing simulations are completely unchanged. */
export function deriveWorldPhysics(
  universe?: UniverseConfig,
): WorldPhysics {
  if (!universe || Object.keys(universe).length === 0) {
    return {
      localGravity: 0,
      escapeVelocity: Infinity,
      escapeVelocityWorldUnits: Infinity,
      gravityAccel: 0,
      climbCostScale: LEGACY_CLIMB_COST,
      insolationFlux: 0,
      equilibriumTemperature: 0,
      orbitalPeriod: 0,
      dayLengthSec: EARTH.DAY_SEC,
      scaleHeight: 0,
      conservationLaws: LEGACY_CONSERVATION,
      symmetryLaws: LEGACY_SYMMETRY,
    };
  }
  const planetMass = universe.planetMass ?? EARTH.MASS;
  const planetRadius = universe.planetRadius ?? EARTH.RADIUS;
  const semiMajor = universe.semiMajorAxis ?? CONSTANTS.AU;
  const parentMass = universe.parentMass ?? SOLAR.MASS;
  const parentLum = universe.parentLuminosity ?? SOLAR.LUMINOSITY;
  const albedo = universe.albedo ?? EARTH.ALBEDO;
  const greenhouse = universe.greenhouseDelta ?? EARTH.GREENHOUSE_DELTA;
  const localGravity = universe.localGravity
    ?? (CONSTANTS.G * planetMass) / (planetRadius * planetRadius);
  const ev = escapeVelocity(planetMass, planetRadius);
  const flux = parentLum / (4 * Math.PI * semiMajor * semiMajor);
  const tEq = equilibriumTemperature(flux, albedo, greenhouse);
  const period = keplerPeriod(parentMass, semiMajor);
  const sh = scaleHeight(tEq, localGravity);

  return {
    localGravity,
    escapeVelocity: ev,
    escapeVelocityWorldUnits: ev / WORLD_UNIT_METERS,
    gravityAccel: localGravity,
    climbCostScale: (universe.localGravity === undefined && universe.planetMass === undefined)
      ? LEGACY_CLIMB_COST
      : localGravity * ENGINE_SCALE,
    insolationFlux: flux,
    equilibriumTemperature: tEq,
    orbitalPeriod: period,
    dayLengthSec: universe.dayLengthSec ?? EARTH.DAY_SEC,
    scaleHeight: sh,
    conservationLaws: deriveConservationLaws(universe, { localGravity, insolationFlux: flux }),
    symmetryLaws: deriveSymmetryLaws(universe),
  };
}

/** Defined universe profiles (for testing, research, and CLI presets). */
export const UNIVERSE_EARTH_LIKE: UniverseConfig = {
  localGravity: EARTH.GRAVITY,
  parentMass: SOLAR.MASS,
  parentLuminosity: SOLAR.LUMINOSITY,
  parentTeffective: SOLAR.T_EFFECTIVE,
  planetRadius: EARTH.RADIUS,
  planetMass: EARTH.MASS,
  semiMajorAxis: CONSTANTS.AU,
  eccentricity: 0.0167,
  dayLengthSec: EARTH.DAY_SEC,
  atmospherePressure: EARTH.ATM_PRESSURE,
  albedo: EARTH.ALBEDO,
  greenhouseDelta: EARTH.GREENHOUSE_DELTA,
};

/** Luna (Earth's Moon): ~0.17 g, essentially no atmosphere. */
export const UNIVERSE_LUNA: UniverseConfig = {
  localGravity: 1.62,
  parentMass: SOLAR.MASS,
  parentLuminosity: SOLAR.LUMINOSITY,
  parentTeffective: SOLAR.T_EFFECTIVE,
  planetRadius: 1.7374e6,
  planetMass: 7.342e22,
  semiMajorAxis: 3.844e8,
  eccentricity: 0.0549,
  dayLengthSec: 2.360515e6,
  atmospherePressure: 0,
  albedo: 0.12,
  greenhouseDelta: 0,
};

/** Mars: ~0.38 g, thin CO2 atmosphere. */
export const UNIVERSE_MARS: UniverseConfig = {
  localGravity: 3.71,
  parentMass: SOLAR.MASS,
  parentLuminosity: SOLAR.LUMINOSITY,
  parentTeffective: SOLAR.T_EFFECTIVE,
  planetRadius: 3.390e6,
  planetMass: 6.417e23,
  semiMajorAxis: 2.279e11,
  eccentricity: 0.0934,
  dayLengthSec: 8.8775244e4,
  atmospherePressure: 610,
  albedo: 0.25,
  greenhouseDelta: 0,
};
