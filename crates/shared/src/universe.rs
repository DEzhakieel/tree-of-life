use serde::{Deserialize, Serialize};

/// Fundamental physical constants (SI).
pub struct Constants;

impl Constants {
    pub const G: f64 = 6.67430e-11; // m^3 kg^-1 s^-2
    pub const C: f64 = 2.99792458e8; // m/s
    pub const H: f64 = 6.62607015e-34; // J s
    pub const HBAR: f64 = 1.054571817e-34; // J s
    pub const KB: f64 = 1.380649e-23; // J/K
    pub const E: f64 = 1.602176634e-19; // C
    pub const PROTON_MASS: f64 = 1.67262192369e-27; // kg
    pub const ELECTRON_MASS: f64 = 9.1093837015e-31; // kg
    pub const SIGMA_SB: f64 = 5.670374419e-8; // W m^-2 K^-4
    pub const AU: f64 = 1.495978707e11; // m
    pub const LY: f64 = 9.4607304725808e15; // m
    pub const PC: f64 = 3.08567758149137e16; // m
}

pub struct Solar;

impl Solar {
    pub const MASS: f64 = 1.98892e30; // kg
    pub const RADIUS: f64 = 6.957e8; // m
    pub const LUMINOSITY: f64 = 3.828e26; // W
    pub const T_EFFECTIVE: f64 = 5772.0; // K
}

pub struct Earth;

impl Earth {
    pub const RADIUS: f64 = 6.3781e6; // m
    pub const MASS: f64 = 5.9722e24; // kg
    pub const GRAVITY: f64 = 9.80665; // m/s^2
    pub const SEMI_MAJOR: f64 = Constants::AU; // m
    pub const DAY_SEC: f64 = 86164.09; // s
    pub const ORBITAL_VELOCITY: f64 = 29784.8; // m/s
    pub const ATM_PRESSURE: f64 = 101325.0; // Pa
    pub const ALBEDO: f64 = 0.306;
    pub const GREENHOUSE_DELTA: f64 = 33.0; // K
}

/// Optional per-world astrophysical frame.
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct UniverseConfig {
    pub local_gravity: Option<f64>,
    pub parent_mass: Option<f64>,
    pub parent_luminosity: Option<f64>,
    pub parent_teffective: Option<f64>,
    pub planet_radius: Option<f64>,
    pub planet_mass: Option<f64>,
    pub semi_major_axis: Option<f64>,
    pub eccentricity: Option<f64>,
    pub day_length_sec: Option<f64>,
    pub atmosphere_pressure: Option<f64>,
    pub albedo: Option<f64>,
    pub greenhouse_delta: Option<f64>,
}

/// Derived world physics parameters from the astrophysical frame.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct WorldPhysics {
    pub local_gravity: f64,
    pub escape_velocity: f64,
    pub escape_velocity_world_units: f64,
    pub gravity_accel: f64,
    pub climb_cost_scale: f64,
    pub insolation_flux: f64,
    pub equilibrium_temperature: f64,
    pub orbital_period: f64,
    pub day_length_sec: f64,
    pub scale_height: f64,
    /// Derived conservation laws for this world.
    pub conservation_laws: ConservationLaws,
    /// Derived symmetry laws for this world.
    pub symmetry_laws: SymmetryLaws,
}

/// Conservation laws: how strictly the world's energy, mass, and momentum
/// budgets are balanced. All values in [0.5, 1]; legacy (no universe) = 1.0
/// → zero engine effect.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct ConservationLaws {
    /// Normalised energy input: insolation_flux / solar constant at Earth.
    pub energy_budget_ratio: f64,
    /// Gravity-dependent mass return rate: min(1, g / g_earth).
    pub mass_recycling_rate: f64,
    /// Atmosphere-dependent momentum preservation: 1 / (1 + (atm/atm_earth) × 0.3).
    pub momentum_retention: f64,
    /// Rotation-dependent angular momentum: day_sec / day_earth.
    pub angular_momentum_factor: f64,
}

/// Laws of symmetry (Noether correspondences): spatial and temporal
/// uniformity of the physics. All values in [0, 1]; legacy = 1.0.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct SymmetryLaws {
    /// Directional uniformity: 1 − eccentricity × 0.5.
    pub spatial_isotropy: f64,
    /// Temporal uniformity: sqrt(1 − eccentricity²).
    pub temporal_uniformity: f64,
    /// Position uniformity: always 1.0 (toroidal world).
    pub translational_invariance: f64,
    /// Angular uniformity: always 1.0 (isotropic world).
    pub rotational_symmetry: f64,
}

const DRY_AIR_MU: f64 = 0.0289644;
/// Universal gas constant, J/(mol·K).
const R_UNIVERSAL: f64 = 8.314462618;
const LEGACY_CLIMB_COST: f64 = 4.0;
const ENGINE_SCALE: f64 = LEGACY_CLIMB_COST / Earth::GRAVITY;
/// One world-unit corresponds to this many metres of physical length.
pub const WORLD_UNIT_METERS: f64 = 1000.0;
const SOLAR_CONSTANT_AT_EARTH: f64 =
    Solar::LUMINOSITY / (4.0 * std::f64::consts::PI * Constants::AU * Constants::AU);

fn legacy_conservation() -> ConservationLaws {
    ConservationLaws {
        energy_budget_ratio: 1.0,
        mass_recycling_rate: 1.0,
        momentum_retention: 1.0,
        angular_momentum_factor: 1.0,
    }
}

fn legacy_symmetry() -> SymmetryLaws {
    SymmetryLaws {
        spatial_isotropy: 1.0,
        temporal_uniformity: 1.0,
        translational_invariance: 1.0,
        rotational_symmetry: 1.0,
    }
}

fn kepler_period(parent_mass: f64, semi_major: f64) -> f64 {
    let mu = Constants::G * parent_mass;
    2.0 * std::f64::consts::PI * (semi_major.powi(3) / mu).sqrt()
}

fn escape_velocity(mass: f64, radius: f64) -> f64 {
    (2.0 * Constants::G * mass / radius).sqrt()
}

fn equilibrium_temperature(flux: f64, albedo: f64, greenhouse_delta: f64) -> f64 {
    // spherical planet: intercepted flux averaged over the surface (/4)
    let absorbed = flux * (1.0 - albedo) / 4.0;
    (absorbed / Constants::SIGMA_SB).powf(0.25) + greenhouse_delta
}

fn scale_height(temperature: f64, gravity: f64) -> f64 {
    R_UNIVERSAL * temperature / (DRY_AIR_MU * gravity)
}

fn derive_conservation_laws(
    universe: &UniverseConfig,
    local_gravity: f64,
    insolation_flux: f64,
) -> ConservationLaws {
    let atmosphere = universe.atmosphere_pressure.unwrap_or(Earth::ATM_PRESSURE);
    let day_length = universe.day_length_sec.unwrap_or(Earth::DAY_SEC);
    ConservationLaws {
        energy_budget_ratio: insolation_flux / SOLAR_CONSTANT_AT_EARTH,
        mass_recycling_rate: (local_gravity / Earth::GRAVITY).min(1.0),
        momentum_retention: 1.0 / (1.0 + (atmosphere / Earth::ATM_PRESSURE) * 0.3),
        angular_momentum_factor: day_length / Earth::DAY_SEC,
    }
}

fn derive_symmetry_laws(universe: &UniverseConfig) -> SymmetryLaws {
    let ecc = universe.eccentricity.unwrap_or(0.0).clamp(0.0, 0.99);
    SymmetryLaws {
        spatial_isotropy: 1.0 - ecc * 0.5,
        temporal_uniformity: (1.0 - ecc * ecc).sqrt(),
        translational_invariance: 1.0,
        rotational_symmetry: 1.0,
    }
}

/// Compute the physically-derived world parameters.
/// When `universe` is `None` or empty, returns legacy-equivalent values so
/// existing simulations are completely unchanged.
pub fn derive_world_physics(universe: Option<&UniverseConfig>) -> WorldPhysics {
    let u = match universe {
        Some(u)
            if u.local_gravity.is_some() || u.planet_mass.is_some() || u.parent_mass.is_some() =>
        {
            u
        }
        _ => {
            return WorldPhysics {
                local_gravity: 0.0,
                escape_velocity: f64::INFINITY,
                escape_velocity_world_units: f64::INFINITY,
                gravity_accel: 0.0,
                climb_cost_scale: LEGACY_CLIMB_COST,
                insolation_flux: 0.0,
                equilibrium_temperature: 0.0,
                orbital_period: 0.0,
                day_length_sec: Earth::DAY_SEC,
                scale_height: 0.0,
                conservation_laws: legacy_conservation(),
                symmetry_laws: legacy_symmetry(),
            };
        }
    };

    let planet_mass = u.planet_mass.unwrap_or(Earth::MASS);
    let planet_radius = u.planet_radius.unwrap_or(Earth::RADIUS);
    let semi_major = u.semi_major_axis.unwrap_or(Constants::AU);
    let parent_mass = u.parent_mass.unwrap_or(Solar::MASS);
    let parent_lum = u.parent_luminosity.unwrap_or(Solar::LUMINOSITY);
    let albedo = u.albedo.unwrap_or(Earth::ALBEDO);
    let greenhouse = u.greenhouse_delta.unwrap_or(Earth::GREENHOUSE_DELTA);

    let local_gravity = u
        .local_gravity
        .unwrap_or_else(|| Constants::G * planet_mass / (planet_radius * planet_radius));

    let ev = escape_velocity(planet_mass, planet_radius);
    let flux = parent_lum / (4.0 * std::f64::consts::PI * semi_major * semi_major);
    let t_eq = equilibrium_temperature(flux, albedo, greenhouse);
    let period = kepler_period(parent_mass, semi_major);
    let sh = scale_height(t_eq, local_gravity);

    let climb_cost_scale = if u.local_gravity.is_none() && u.planet_mass.is_none() {
        LEGACY_CLIMB_COST
    } else {
        local_gravity * ENGINE_SCALE
    };

    WorldPhysics {
        local_gravity,
        escape_velocity: ev,
        escape_velocity_world_units: ev / WORLD_UNIT_METERS,
        gravity_accel: local_gravity,
        climb_cost_scale,
        insolation_flux: flux,
        equilibrium_temperature: t_eq,
        orbital_period: period,
        day_length_sec: u.day_length_sec.unwrap_or(Earth::DAY_SEC),
        scale_height: sh,
        conservation_laws: derive_conservation_laws(u, local_gravity, flux),
        symmetry_laws: derive_symmetry_laws(u),
    }
}

/// Defined universe profiles for testing / CLI presets.
pub fn earth_like() -> UniverseConfig {
    UniverseConfig {
        local_gravity: Some(Earth::GRAVITY),
        parent_mass: Some(Solar::MASS),
        parent_luminosity: Some(Solar::LUMINOSITY),
        parent_teffective: Some(Solar::T_EFFECTIVE),
        planet_radius: Some(Earth::RADIUS),
        planet_mass: Some(Earth::MASS),
        semi_major_axis: Some(Constants::AU),
        eccentricity: Some(0.0167),
        day_length_sec: Some(Earth::DAY_SEC),
        atmosphere_pressure: Some(Earth::ATM_PRESSURE),
        albedo: Some(Earth::ALBEDO),
        greenhouse_delta: Some(Earth::GREENHOUSE_DELTA),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn close(a: f64, b: f64, rel_tol: f64, abs_tol: f64) -> bool {
        (a - b).abs() <= abs_tol + rel_tol * a.abs().max(b.abs())
    }

    #[test]
    fn legacy_frame_is_unchanged() {
        let wp = derive_world_physics(None);
        assert_eq!(wp.climb_cost_scale, 4.0);
        assert!(wp.escape_velocity_world_units.is_infinite());
        assert_eq!(wp.day_length_sec, Earth::DAY_SEC);
        assert_eq!(wp.local_gravity, 0.0);
    }

    #[test]
    fn earth_like_matches_reference_values() {
        let wp = derive_world_physics(Some(&earth_like()));
        assert!(close(wp.local_gravity, 9.80665, 1e-9, 1e-9));
        assert!(close(wp.escape_velocity, 11180.0, 1e-2, 1.0));
        assert!(close(wp.climb_cost_scale, 4.0, 1e-9, 1e-9));
        assert!(close(wp.orbital_period, 365.25 * 86400.0, 1e-3, 100.0));
        assert!(close(wp.day_length_sec, Earth::DAY_SEC, 1e-12, 1e-9));
        assert!(wp.insolation_flux > 1350.0 && wp.insolation_flux < 1375.0);
        assert!(wp.equilibrium_temperature > 250.0 && wp.equilibrium_temperature < 300.0);
        assert!(wp.scale_height > 6000.0 && wp.scale_height < 12000.0);
        assert!(wp.escape_velocity_world_units > 10.0 && wp.escape_velocity_world_units < 15.0);
    }

    #[test]
    fn moon_like_physics_are_coherent() {
        let u = UniverseConfig {
            planet_mass: Some(7.342e22),
            planet_radius: Some(1.7374e6),
            ..Default::default()
        };
        let wp = derive_world_physics(Some(&u));
        assert!(close(wp.local_gravity, 1.62, 1e-2, 1e-2));
        assert!(close(wp.escape_velocity, 2376.0, 1e-2, 1.0));
        assert!(wp.escape_velocity_world_units < 3.0);
        assert!(wp.climb_cost_scale < 1.0);
    }

    #[test]
    fn mars_like_greenhouse_is_lower_than_earth() {
        let earth_wp = derive_world_physics(Some(&earth_like()));
        let mars = UniverseConfig {
            planet_mass: Some(6.417e23),
            planet_radius: Some(3.390e6),
            semi_major_axis: Some(2.279e11),
            greenhouse_delta: Some(5.0),
            ..Default::default()
        };
        let mars_wp = derive_world_physics(Some(&mars));
        assert!(mars_wp.equilibrium_temperature < earth_wp.equilibrium_temperature);
        assert!(mars_wp.local_gravity < earth_wp.local_gravity);
        assert!(mars_wp.escape_velocity < earth_wp.escape_velocity);
        assert!(mars_wp.scale_height > 8000.0);
    }

    #[test]
    fn empty_universe_config_returns_legacy() {
        let u = UniverseConfig {
            ..Default::default()
        };
        let wp = derive_world_physics(Some(&u));
        assert_eq!(wp.climb_cost_scale, 4.0);
        assert!(wp.escape_velocity_world_units.is_infinite());
    }

    #[test]
    fn world_unit_conversion() {
        let wp = derive_world_physics(Some(&earth_like()));
        assert!(
            close(
                wp.escape_velocity / WORLD_UNIT_METERS,
                wp.escape_velocity_world_units,
                1e-12,
                1e-12
            ),
            "m/s conversion inconsistent"
        );
    }

    #[test]
    fn legacy_conservation_and_symmetry_are_neutral() {
        let wp = derive_world_physics(None);
        assert_eq!(wp.conservation_laws, legacy_conservation());
        assert_eq!(wp.symmetry_laws, legacy_symmetry());
        assert_eq!(wp.conservation_laws.momentum_retention, 1.0);
        assert_eq!(wp.symmetry_laws.temporal_uniformity, 1.0);
    }

    #[test]
    fn earth_like_conservation_laws() {
        let wp = derive_world_physics(Some(&earth_like()));
        // insolation normalised to the solar constant at Earth ≈ 1.0
        assert!(close(
            wp.conservation_laws.energy_budget_ratio,
            1.0,
            1e-2,
            1e-2
        ));
        // surface gravity equals Earth's → full mass recycling
        assert!(close(
            wp.conservation_laws.mass_recycling_rate,
            1.0,
            1e-9,
            1e-9
        ));
        // Earth atmosphere → momentum retention ≈ 1/1.3
        assert!(close(
            wp.conservation_laws.momentum_retention,
            1.0 / 1.3,
            1e-9,
            1e-9
        ));
        // sidereal day magnitude ≈ Earth's
        assert!(close(
            wp.conservation_laws.angular_momentum_factor,
            1.0,
            1e-9,
            1e-9
        ));
    }

    #[test]
    fn moon_like_conservation_laws_are_lower() {
        let moon = UniverseConfig {
            planet_mass: Some(7.342e22),
            planet_radius: Some(1.7374e6),
            ..Default::default()
        };
        let moon_wp = derive_world_physics(Some(&moon));
        let earth_wp = derive_world_physics(Some(&earth_like()));
        // lower gravity → slower mass recycling
        assert!(
            moon_wp.conservation_laws.mass_recycling_rate
                < earth_wp.conservation_laws.mass_recycling_rate
        );
        // no atmosphere supplied → full momentum retention (vacuum)
        assert!(close(
            moon_wp.conservation_laws.momentum_retention,
            1.0 / 1.3,
            1e-9,
            1e-9
        ));
        assert!(moon_wp.conservation_laws.mass_recycling_rate < 0.2);
    }

    #[test]
    fn vacuous_atmosphere_retains_all_momentum() {
        let u = UniverseConfig {
            local_gravity: Some(Earth::GRAVITY),
            atmosphere_pressure: Some(0.0),
            ..Default::default()
        };
        let wp = derive_world_physics(Some(&u));
        assert!(close(
            wp.conservation_laws.momentum_retention,
            1.0,
            1e-12,
            1e-12
        ));
    }

    #[test]
    fn circular_orbit_has_full_symmetry() {
        let u = UniverseConfig {
            local_gravity: Some(Earth::GRAVITY),
            eccentricity: Some(0.0),
            ..Default::default()
        };
        let wp = derive_world_physics(Some(&u));
        assert!(close(wp.symmetry_laws.spatial_isotropy, 1.0, 1e-12, 1e-12));
        assert!(close(
            wp.symmetry_laws.temporal_uniformity,
            1.0,
            1e-12,
            1e-12
        ));
        assert_eq!(wp.symmetry_laws.translational_invariance, 1.0);
        assert_eq!(wp.symmetry_laws.rotational_symmetry, 1.0);
    }

    #[test]
    fn eccentric_orbit_breaks_symmetry() {
        let u = UniverseConfig {
            local_gravity: Some(Earth::GRAVITY),
            eccentricity: Some(0.5),
            ..Default::default()
        };
        let wp = derive_world_physics(Some(&u));
        assert!(close(wp.symmetry_laws.spatial_isotropy, 0.75, 1e-12, 1e-12));
        assert!(close(
            wp.symmetry_laws.temporal_uniformity,
            (1.0f64 - 0.25).sqrt(),
            1e-12,
            1e-12
        ));
        assert!(wp.symmetry_laws.temporal_uniformity < 1.0);
    }

    #[test]
    fn eccentricity_is_clamped_to_valid_range() {
        let u = UniverseConfig {
            local_gravity: Some(Earth::GRAVITY),
            eccentricity: Some(1.5),
            ..Default::default()
        };
        let wp = derive_world_physics(Some(&u));
        // clamped to 0.99 → spatial isotropy 1 - 0.495
        assert!(close(
            wp.symmetry_laws.spatial_isotropy,
            1.0 - 0.99 * 0.5,
            1e-12,
            1e-12
        ));
        assert!(wp.symmetry_laws.temporal_uniformity >= 0.0);
    }
}
