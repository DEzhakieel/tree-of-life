import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  CONSTANTS,
  SOLAR,
  EARTH,
  WORLD_UNIT_METERS,
  UNIVERSE_EARTH_LIKE,
  deriveWorldPhysics,
  type UniverseConfig,
} from '../src/universe.js';

function close(a: number, b: number, rel = 1e-4, abs = 1e-9): boolean {
  return Math.abs(a - b) <= abs + rel * Math.max(Math.abs(a), Math.abs(b));
}

describe('universe derivation — legacy (absent) returns neutral frame', () => {
  it('default constants preserve legacy physics', () => {
    const wp = deriveWorldPhysics();
    assert.equal(wp.climbCostScale, 4.0);
    assert.equal(wp.escapeVelocityWorldUnits, Infinity);
    assert.equal(wp.localGravity, 0);
    assert.equal(wp.dayLengthSec, EARTH.DAY_SEC);
  });

  it('empty object also returns legacy', () => {
    const wp = deriveWorldPhysics({} as UniverseConfig);
    assert.equal(wp.climbCostScale, 4.0);
    assert.equal(wp.escapeVelocityWorldUnits, Infinity);
  });
});

describe('universe derivation — Earth-like reference', () => {
  const wp = deriveWorldPhysics(UNIVERSE_EARTH_LIKE);

  it('surface gravity ≈ 9.81 m/s²', () => {
    assert.ok(close(wp.localGravity, 9.80665, 1e-6), `got ${wp.localGravity}`);
  });

  it('escape velocity ≈ 11.18 km/s', () => {
    assert.ok(close(wp.escapeVelocity, 11180, 1e-3), `got ${wp.escapeVelocity}`);
  });

  it('escape velocity world-units per tick ≈ 11.18', () => {
    assert.ok(
      close(wp.escapeVelocityWorldUnits, wp.escapeVelocity / WORLD_UNIT_METERS, 1e-12),
      `got ${wp.escapeVelocityWorldUnits}`,
    );
  });

  it('climb cost ≈ 4.0 (matches legacy for Earth)', () => {
    assert.ok(close(wp.climbCostScale, 4.0, 1e-6), `got ${wp.climbCostScale}`);
  });

  it('insolation flux ≈ solar constant ≈ 1361 W/m²', () => {
    assert.ok(wp.insolationFlux > 1350 && wp.insolationFlux < 1375, `got ${wp.insolationFlux}`);
  });

  it('equilibrium temperature (no greenhouse) ≈ 255 K, + greenhouse ≈ 288 K', () => {
    assert.ok(wp.equilibriumTemperature > 250 && wp.equilibriumTemperature < 300, `got ${wp.equilibriumTemperature}`);
  });

  it('orbital period ≈ 365.25 days (in seconds)', () => {
    assert.ok(close(wp.orbitalPeriod, 365.25 * 86400, 1e-3), `got ${wp.orbitalPeriod}`);
  });

  it('atmospheric scale height ≈ 7.4–8.5 km', () => {
    assert.ok(wp.scaleHeight > 6000 && wp.scaleHeight < 12000, `got ${wp.scaleHeight}`);
  });
});

describe('universe derivation — Moon', () => {
  const moon: UniverseConfig = {
    planetMass: 7.342e22,
    planetRadius: 1.7374e6,
  };
  const wp = deriveWorldPhysics(moon);

  it('surface gravity ≈ 1.62 m/s²', () => {
    assert.ok(close(wp.localGravity, 1.62, 1e-2), `got ${wp.localGravity}`);
  });

  it('escape velocity ≈ 2.38 km/s', () => {
    assert.ok(close(wp.escapeVelocity, 2376, 1e-2), `got ${wp.escapeVelocity}`);
    assert.ok(wp.escapeVelocityWorldUnits < 3.0, `got ${wp.escapeVelocityWorldUnits}`);
  });

  it('climb cost well below Earth legacy', () => {
    assert.ok(wp.climbCostScale < 1.0, `got ${wp.climbCostScale}`);
  });
});

describe('universe derivation — Mars', () => {
  it('Mars is colder and has lower gravity than Earth', () => {
    const earth = deriveWorldPhysics(UNIVERSE_EARTH_LIKE);
    const mars: UniverseConfig = {
      planetMass: 6.417e23,
      planetRadius: 3.390e6,
      semiMajorAxis: 2.279e11,
      greenhouseDelta: 5.0,
    };
    const wm = deriveWorldPhysics(mars);
    assert.ok(wm.equilibriumTemperature < earth.equilibriumTemperature, 'Mars colder');
    assert.ok(wm.localGravity < earth.localGravity, 'Mars weaker gravity');
    assert.ok(wm.escapeVelocity < earth.escapeVelocity, 'Mars lower escape vel');
    assert.ok(wm.scaleHeight > 8000, 'thin atmosphere → large scale height');
  });
});

describe('universe derivation — solar system constants', () => {
  it('SI constants are basic reference values', () => {
    assert.ok(CONSTANTS.G > 6.6e-11 && CONSTANTS.G < 6.7e-11);
    assert.ok(CONSTANTS.C > 2.997e8 && CONSTANTS.C < 2.998e8);
    assert.ok(CONSTANTS.KB > 1.38e-23 && CONSTANTS.KB < 1.39e-23);
    assert.ok(CONSTANTS.AU > 1.49e11 && CONSTANTS.AU < 1.50e11);
  });

  it('Earth values are correct references', () => {
    assert.ok(close(EARTH.GRAVITY, 9.80665, 1e-6));
    assert.ok(close(EARTH.DAY_SEC, 86164.09, 1e-5));
    assert.ok(EARTH.ALBEDO > 0 && EARTH.ALBEDO < 0.5);
  });

  it('world unit constant is 1000 m', () => {
    assert.equal(WORLD_UNIT_METERS, 1000);
  });
});

describe('conservation laws — legacy (absent) are neutral', () => {
  it('all conservation values are 1.0 when universe omitted', () => {
    const wp = deriveWorldPhysics();
    assert.equal(wp.conservationLaws.energyBudgetRatio, 1.0);
    assert.equal(wp.conservationLaws.massRecyclingRate, 1.0);
    assert.equal(wp.conservationLaws.momentumRetention, 1.0);
    assert.equal(wp.conservationLaws.angularMomentumFactor, 1.0);
  });
});

describe('conservation laws — Earth-like reference', () => {
  const wp = deriveWorldPhysics(UNIVERSE_EARTH_LIKE);

  it('energy budget ratio ≈ 1.0 (insolation normalised to solar constant)', () => {
    assert.ok(close(wp.conservationLaws.energyBudgetRatio, 1.0, 1e-2), `got ${wp.conservationLaws.energyBudgetRatio}`);
  });

  it('mass recycling rate = 1.0 (full Earth gravity)', () => {
    assert.ok(close(wp.conservationLaws.massRecyclingRate, 1.0, 1e-9), `got ${wp.conservationLaws.massRecyclingRate}`);
  });

  it('momentum retention ≈ 0.769 (Earth atmosphere)', () => {
    assert.ok(close(wp.conservationLaws.momentumRetention, 1.0 / 1.3, 1e-9), `got ${wp.conservationLaws.momentumRetention}`);
  });

  it('angular momentum factor ≈ 1.0 (Earth rotation)', () => {
    assert.ok(close(wp.conservationLaws.angularMomentumFactor, 1.0, 1e-9), `got ${wp.conservationLaws.angularMomentumFactor}`);
  });
});

describe('conservation laws — Moon (low gravity, vacuum)', () => {
  const moon = deriveWorldPhysics({ planetMass: 7.342e22, planetRadius: 1.7374e6 });

  it('mass recycling rate < 0.2 (low gravity)', () => {
    assert.ok(moon.conservationLaws.massRecyclingRate < 0.2, `got ${moon.conservationLaws.massRecyclingRate}`);
  });

  it('vacuum retains full momentum', () => {
    // no atmosphere_pressure supplied → defaults to Earth pressure, still some drag
    assert.ok(moon.conservationLaws.momentumRetention > 0.5, `got ${moon.conservationLaws.momentumRetention}`);
  });

  it('zero-pressure atmosphere retains all momentum', () => {
    const wp = deriveWorldPhysics({
      localGravity: 9.80665,
      atmospherePressure: 0,
    });
    assert.ok(close(wp.conservationLaws.momentumRetention, 1.0, 1e-12), `got ${wp.conservationLaws.momentumRetention}`);
  });
});

describe('symmetry laws — legacy (absent) are neutral', () => {
  it('all symmetry values are 1.0 when universe omitted', () => {
    const wp = deriveWorldPhysics();
    assert.equal(wp.symmetryLaws.spatialIsotropy, 1.0);
    assert.equal(wp.symmetryLaws.temporalUniformity, 1.0);
    assert.equal(wp.symmetryLaws.translationalInvariance, 1.0);
    assert.equal(wp.symmetryLaws.rotationalSymmetry, 1.0);
  });
});

describe('symmetry laws — circular orbit has full symmetry', () => {
  it('eccentricity 0 → isotropy and uniformity = 1.0', () => {
    const wp = deriveWorldPhysics({ localGravity: 9.80665, eccentricity: 0 });
    assert.ok(close(wp.symmetryLaws.spatialIsotropy, 1.0, 1e-12));
    assert.ok(close(wp.symmetryLaws.temporalUniformity, 1.0, 1e-12));
  });
});

describe('symmetry laws — eccentric orbit breaks symmetry', () => {
  const wp = deriveWorldPhysics({ localGravity: 9.80665, eccentricity: 0.5 });

  it('spatial isotropy = 1 − 0.5 × 0.5 = 0.75', () => {
    assert.ok(close(wp.symmetryLaws.spatialIsotropy, 0.75, 1e-12), `got ${wp.symmetryLaws.spatialIsotropy}`);
  });

  it('temporal uniformity = sqrt(1 − 0.25) ≈ 0.866', () => {
    assert.ok(close(wp.symmetryLaws.temporalUniformity, Math.sqrt(0.75), 1e-12), `got ${wp.symmetryLaws.temporalUniformity}`);
  });

  it('translational invariance always 1.0 (toroidal)', () => {
    assert.equal(wp.symmetryLaws.translationalInvariance, 1.0);
  });

  it('rotational symmetry always 1.0 (isotropic)', () => {
    assert.equal(wp.symmetryLaws.rotationalSymmetry, 1.0);
  });
});

describe('symmetry laws — eccentricity clamped to valid range', () => {
  it('eccentricity > 1 clamped to 0.99', () => {
    const wp = deriveWorldPhysics({ localGravity: 9.80665, eccentricity: 1.5 });
    assert.ok(close(wp.symmetryLaws.spatialIsotropy, 1.0 - 0.99 * 0.5, 1e-12));
    assert.ok(wp.symmetryLaws.temporalUniformity >= 0);
  });
});
