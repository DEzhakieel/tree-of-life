use crate::constants::WORLD_SIZE;
use crate::types::WorldParams;

pub fn world_to_complex(params: &WorldParams, x: f32, y: f32) -> (f32, f32) {
    let (re, im) = world_to_complex64(params, x as f64, y as f64);
    (re as f32, im as f32)
}

/// f64 variant matching the TS `worldToComplex` (pure f64 math) bit-for-bit.
pub fn world_to_complex64(params: &WorldParams, x: f64, y: f64) -> (f64, f64) {
    let nx = (x / WORLD_SIZE as f64 - 0.5) * params.world_scale;
    let ny = (y / WORLD_SIZE as f64 - 0.5) * params.world_scale;
    (params.center_x + nx, params.center_y + ny)
}

pub fn complex_to_world(params: &WorldParams, re: f64, im: f64) -> (f64, f64) {
    (
        (re - params.center_x) / params.world_scale * WORLD_SIZE as f64 + WORLD_SIZE as f64 / 2.0,
        (im - params.center_y) / params.world_scale * WORLD_SIZE as f64 + WORLD_SIZE as f64 / 2.0,
    )
}

pub fn clamp_world(v: f64) -> f64 {
    let w = WORLD_SIZE as f64;
    if v < 0.0 {
        v + w
    } else if v >= w {
        v - w
    } else {
        v
    }
}
