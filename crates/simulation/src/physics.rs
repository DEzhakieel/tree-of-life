use crate::terrain::TerrainGrid;
use fractal_life_shared::types::WorldTopology;
use fractal_life_shared::universe::WorldPhysics;

pub const DRAG: f64 = 0.86;
const SLOPE_TAX: f64 = 0.4;
const SLOPE_BOOST: f64 = 0.5;
const SLOPE_CAP: f64 = 1.6;
pub const CLIMB_COST: f64 = 4.0;

pub struct MoveResult {
    pub x: f64,
    pub y: f64,
    pub vx: f64,
    pub vy: f64,
    pub distance: f64,
    pub dh: f64,
    pub climb_cost: f64,
}

pub fn step_movement(
    x: f64,
    y: f64,
    vx: f64,
    vy: f64,
    thrust_x: f64,
    thrust_y: f64,
    speed: f64,
    size: f64,
    ts: f64,
    water_frac: f64,
    hazard: f64,
    grid: &TerrainGrid,
    world_physics: &WorldPhysics,
    topology: WorldTopology,
) -> MoveResult {
    let world = grid.size as f64 * grid.cell as f64;

    // apply the world's edge-identification rule to a candidate position and
    // velocity, returning the in-bounds (nx, ny) and the post-boundary velocity
    let boundary = |x: f64, y: f64, vx: f64, vy: f64| -> (f64, f64, f64, f64) {
        let wrap = |v: f64| -> f64 {
            if v < 0.0 {
                v + world
            } else if v >= world {
                v - world
            } else {
                v
            }
        };
        // NOTE: run the topology case on RAW coordinates FIRST — a cap
        // crossing arrives with y < 0 or y >= world, and pre-wrapping would
        // erase the crossing and make every topology behave like the torus.
        // Coordinates are re-normalized into [0, world) afterwards.
        let mut nx = x;
        let mut ny = y;
        let mut nvx = vx;
        let mut nvy = vy;
        match topology {
            // legacy wrap: both axes loop
            WorldTopology::Torus => {}
            // polar caps: latitude reflects (velocity reverses), longitude
            // (wrapped below) is the free direction
            WorldTopology::Cylinder | WorldTopology::Sphere => {
                if y < 0.0 {
                    ny = -y;
                    nvy = -vy;
                } else if y >= world {
                    ny = 2.0 * world - y;
                    nvy = -vy;
                }
            }
            // Möbius strip: latitude reflects and flips longitude
            // (half-twist) at each cap crossing
            WorldTopology::Mobius => {
                if y < 0.0 || y >= world {
                    ny = if y < 0.0 { -y } else { 2.0 * world - y };
                    nvy = -vy;
                    nx = world - x;
                }
            }
            // Klein bottle: latitude loops (wraps) and flips longitude
            WorldTopology::Klein => {
                if y < 0.0 || y >= world {
                    nx = world - x;
                }
            }
        }
        nx = wrap(nx);
        ny = wrap(ny);
        (nx, ny, nvx, nvy)
    };

    // atmospheric drag scales with the environment's momentum retention
    // (1.0 = legacy/vacuum → unchanged DRAG; denser air erodes momentum faster).
    // thrust scale is re-derived so steady-state velocity stays ≈ phenotype speed.
    let retention = world_physics.conservation_laws.momentum_retention.max(1e-2);
    let drag = DRAG.powf(1.0 / retention);
    let thrust_scale = (1.0 - drag) / drag;

    let resist = (1.0 + hazard * 1.2) * (1.0 + (size - 1.0) * 0.4);
    let throttle = if water_frac < 0.2 { 0.6 } else { 1.0 } / resist;

    let pvx = (vx + thrust_x * speed * thrust_scale * throttle) * drag;
    let pvy = (vy + thrust_y * speed * thrust_scale * throttle) * drag;
    let (px, py, _, _) = boundary(x + pvx * ts, y + pvy * ts, pvx, pvy);
    let h_old = crate::terrain::sample_height(grid, x, y);
    let h_new = crate::terrain::sample_height(grid, px, py);
    let dh = h_new - h_old;

    let thrust_mod = if dh > 0.0 {
        (0.25_f64).max(1.0 - SLOPE_TAX * dh)
    } else if dh < 0.0 {
        SLOPE_CAP.min(1.0 - SLOPE_BOOST * dh)
    } else {
        1.0
    };

    let ax = thrust_x * speed * thrust_scale * thrust_mod * throttle;
    let ay = thrust_y * speed * thrust_scale * thrust_mod * throttle;
    let mut nvx = (vx + ax) * drag;
    let mut nvy = (vy + ay) * drag;

    // when a physics frame is present, cap velocity at the local escape speed
    // (derived in world-units per tick by the shared universe module)
    if world_physics.escape_velocity_world_units < f64::INFINITY {
        let max_v = world_physics.escape_velocity_world_units;
        let v_mag = (nvx * nvx + nvy * nvy).sqrt();
        if v_mag > max_v {
            let scale = max_v / v_mag;
            nvx *= scale;
            nvy *= scale;
        }
    }

    let (nx, ny, nvx, nvy) = boundary(x + nvx * ts, y + nvy * ts, nvx, nvy);

    let mut dx = nx - x;
    let mut dy = ny - y;
    // correct for wrap-around displacement only on the axes that loop:
    // longitude wraps everywhere; latitude loops only on torus / klein
    if topology.wraps_x() {
        if dx > world / 2.0 {
            dx -= world;
        } else if dx < -world / 2.0 {
            dx += world;
        }
    }
    if topology.wraps_y() {
        if dy > world / 2.0 {
            dy -= world;
        } else if dy < -world / 2.0 {
            dy += world;
        }
    }
    let distance = (dx * dx + dy * dy).sqrt();

    let climb_cost_per_unit = world_physics.climb_cost_scale;

    MoveResult {
        x: nx,
        y: ny,
        vx: nvx,
        vy: nvy,
        distance,
        dh,
        climb_cost: if dh > 0.0 {
            dh * climb_cost_per_unit * size
        } else {
            0.0
        },
    }
}
