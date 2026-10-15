use fractal_life_shared::constants::{TERRAIN_CELL, TERRAIN_GRID};
use fractal_life_shared::types::WorldParams;
use fractal_life_shared::world_config::world_to_complex64;

#[derive(Clone)]
pub struct FractalSample {
    pub nu: f64,
    pub it: u32,
    pub phase: f64,
}

pub fn hash2i(x: i32, y: i32, seed: u32) -> u32 {
    let mut h = seed ^ (x as u32).wrapping_mul(0x27d4eb2d) ^ (y as u32).wrapping_mul(0x165667b1);
    h = (h ^ (h >> 13)).wrapping_mul(0x5bd1e995);
    h = h ^ (h >> 16);
    h
}

fn noise2(gx: i32, gy: i32, seed: u32) -> f64 {
    let h = hash2i(gx, gy, seed);
    (h & 0x7fffffff) as f64 * (2.0 / 2147483647.0) - 1.0
}

fn smooth(t: f64) -> f64 {
    t * t * (3.0 - 2.0 * t)
}

fn noise_at(x: f64, y: f64, seed: u32) -> f64 {
    let ix = x.floor() as i32;
    let iy = y.floor() as i32;
    let fx = x - ix as f64;
    let fy = y - iy as f64;
    let ux = smooth(fx);
    let uy = smooth(fy);
    let a = noise2(ix, iy, seed);
    let b = noise2(ix + 1, iy, seed);
    let c = noise2(ix, iy + 1, seed);
    let d = noise2(ix + 1, iy + 1, seed);
    let ab = a + (b - a) * ux;
    let cd = c + (d - c) * ux;
    ab + (cd - ab) * uy
}

fn fbm(x: f64, y: f64, seed: u32) -> f64 {
    let mut amp = 1.0f64;
    let mut freq = 1.0f64;
    let mut sum = 0.0f64;
    let mut norm = 0.0f64;
    for _ in 0..4 {
        sum += amp * noise_at(x * freq, y * freq, seed);
        norm += amp;
        amp *= 0.5;
        freq *= 2.0;
    }
    sum / norm
}

fn perlin_escape(re: f64, im: f64, p: &WorldParams, seed: u32) -> FractalSample {
    let v = fbm(re * 1.5, im * 1.5, seed);
    let nu = (v * 0.5 + 0.5) * p.max_iter as f64;
    FractalSample {
        nu,
        it: nu.round() as u32,
        phase: v * std::f64::consts::PI,
    }
}

fn escape_time(
    re: f64,
    im: f64,
    p: &WorldParams,
    fractal_type: &str,
    perlin_seed: u32,
) -> FractalSample {
    if p.max_iter == 0 {
        return FractalSample {
            nu: 0.0,
            it: 0,
            phase: 0.0,
        };
    }
    if fractal_type == "perlin" {
        return perlin_escape(re, im, p, perlin_seed);
    }

    let b = p.escape_radius;
    let b2 = b * b;
    let (mut zre, mut zim) = if fractal_type == "julia" {
        (re, im)
    } else {
        (0.0, 0.0)
    };
    let (cre, cim) = if fractal_type == "julia" {
        (p.c_real, p.c_imag)
    } else {
        (re, im)
    };
    let mut it = 0u32;
    let mut zre2 = zre * zre;
    let mut zim2 = zim * zim;

    while it < p.max_iter && zre2 + zim2 < b2 {
        let next_re = zre2 - zim2 + cre;
        let next_im = 2.0 * zre * zim + cim;
        zre = next_re;
        zim = next_im;
        zre2 = zre * zre;
        zim2 = zim * zim;
        it += 1;
    }

    let mag2 = zre2 + zim2;
    if it >= p.max_iter || mag2 <= 1.0 {
        return FractalSample {
            nu: p.max_iter as f64,
            it,
            phase: zim.atan2(zre),
        };
    }
    let nu = it as f64 + 1.0 - (mag2.ln() / b.ln()).log2();
    FractalSample {
        nu: nu.max(0.0).min(p.max_iter as f64),
        it,
        phase: zim.atan2(zre),
    }
}

#[derive(Clone)]
pub struct TerrainGrid {
    pub size: usize,
    pub cell: f32,
    pub height: Vec<f32>,
    pub energy: Vec<f32>,
    pub moisture: Vec<f32>,
    pub hazard: Vec<f32>,
    pub chem: Vec<f32>,
    pub base_minerals: Vec<f32>,
    pub minerals: Vec<f32>,
    pub food: Vec<f32>,
    pub meat: Vec<f32>,
    pub signal: Vec<f32>,
    pub cap: Vec<f32>,
}

pub fn build_terrain_grid(p: &WorldParams, fractal_type: &str, perlin_seed: u32) -> TerrainGrid {
    let size = TERRAIN_GRID;
    let cell = TERRAIN_CELL;
    let n = size * size;
    let mut grid = TerrainGrid {
        size,
        cell,
        height: vec![0.0; n],
        energy: vec![0.0; n],
        moisture: vec![0.0; n],
        hazard: vec![0.0; n],
        chem: vec![0.0; n],
        base_minerals: vec![0.0; n],
        minerals: vec![0.0; n],
        food: vec![0.0; n],
        meat: vec![0.0; n],
        signal: vec![0.0; n],
        cap: vec![0.0; n],
    };

    for gy in 0..size {
        for gx in 0..size {
            let wx = (gx as f64 + 0.5) * cell as f64;
            let wy = (gy as f64 + 0.5) * cell as f64;
            let idx = gy * size + gx;
            let (cre, cim) = world_to_complex64(p, wx, wy);
            let s0 = escape_time(cre, cim, p, fractal_type, perlin_seed);

            let (cpp_r, cpp_i) = world_to_complex64(p, wx + cell as f64, wy);
            let (cpm_r, cpm_i) = world_to_complex64(p, wx - cell as f64, wy);
            let nu_p = escape_time(cpp_r, cpp_i, p, fractal_type, perlin_seed).nu;
            let nu_m = escape_time(cpm_r, cpm_i, p, fractal_type, perlin_seed).nu;
            let moisture = (nu_p - nu_m).abs() * 3.0;

            let (cqq_r, cqq_i) = world_to_complex64(p, wx, wy + cell as f64);
            let (crr_r, crr_i) = world_to_complex64(p, wx, wy - cell as f64);
            let nu_q = escape_time(cqq_r, cqq_i, p, fractal_type, perlin_seed).nu;
            let nu_r = escape_time(crr_r, crr_i, p, fractal_type, perlin_seed).nu;
            let base_minerals = ((nu_p - nu_m).abs() + (nu_q - nu_r).abs()) * 6.0;

            let (d1_r, d1_i) = world_to_complex64(p, wx + cell as f64, wy + cell as f64);
            let (d2_r, d2_i) = world_to_complex64(p, wx - cell as f64, wy + cell as f64);
            let (d3_r, d3_i) = world_to_complex64(p, wx + cell as f64, wy - cell as f64);
            let (d4_r, d4_i) = world_to_complex64(p, wx - cell as f64, wy - cell as f64);
            let others: [f64; 4] = [
                escape_time(d1_r, d1_i, p, fractal_type, perlin_seed).it as f64,
                escape_time(d2_r, d2_i, p, fractal_type, perlin_seed).it as f64,
                escape_time(d3_r, d3_i, p, fractal_type, perlin_seed).it as f64,
                escape_time(d4_r, d4_i, p, fractal_type, perlin_seed).it as f64,
            ];
            let mean = others.iter().sum::<f64>() / 4.0;
            let vari = others.iter().map(|o| (o - mean).powi(2)).sum::<f64>() / 4.0;
            let hazard = (vari.sqrt() / p.max_iter as f64 * 10.0).min(1.0);

            let height = s0.nu / p.max_iter as f64;
            let energy = 0.5 + 0.5 * (s0.nu * std::f64::consts::PI * 2.0).cos();
            let cell_cap = energy * p.energy_capacity * 4.0;
            let chem = (s0.phase / std::f64::consts::PI + 1.0) / 2.0;

            grid.height[idx] = height as f32;
            grid.energy[idx] = energy as f32;
            grid.moisture[idx] = (moisture.min(1.0)) as f32;
            grid.hazard[idx] = hazard as f32;
            grid.chem[idx] = chem as f32;
            grid.base_minerals[idx] = (base_minerals.min(1.0)) as f32;
            grid.minerals[idx] = (base_minerals.min(1.0) * cell_cap * 0.3) as f32;
            grid.cap[idx] = cell_cap as f32;
            grid.food[idx] = (cell_cap * 0.35) as f32;
        }
    }
    grid
}

#[derive(Default, Clone)]
pub struct GridSample {
    pub height: f64,
    pub energy: f64,
    pub moisture: f64,
    pub hazard: f64,
    pub food: f64,
    pub meat: f64,
    pub signal: f64,
    pub cap: f64,
    pub chem: f64,
    pub minerals: f64,
}

fn bilinear(arr: &[f32], size: usize, cell: f32, wx: f64, wy: f64) -> f64 {
    let gx = wx / cell as f64;
    let gy = wy / cell as f64;
    let ix = (gx.floor() as usize).min(size - 1);
    let iy = (gy.floor() as usize).min(size - 1);
    let fx = (gx - ix as f64).max(0.0).min(1.0);
    let fy = (gy - iy as f64).max(0.0).min(1.0);
    let x1 = (ix + 1).min(size - 1);
    let y1 = (iy + 1).min(size - 1);
    let a = arr[iy * size + ix] as f64;
    let b = arr[iy * size + x1] as f64;
    let c = arr[y1 * size + ix] as f64;
    let d = arr[y1 * size + x1] as f64;
    a + (b - a) * fx + (c - a) * fy + (d - b - c + a) * fx * fy
}

pub fn sample_grid(grid: &TerrainGrid, wx: f64, wy: f64) -> GridSample {
    let s = grid.size;
    let c = grid.cell;
    GridSample {
        height: bilinear(&grid.height, s, c, wx, wy),
        energy: bilinear(&grid.energy, s, c, wx, wy),
        moisture: bilinear(&grid.moisture, s, c, wx, wy),
        hazard: bilinear(&grid.hazard, s, c, wx, wy),
        food: bilinear(&grid.food, s, c, wx, wy),
        meat: bilinear(&grid.meat, s, c, wx, wy),
        signal: bilinear(&grid.signal, s, c, wx, wy),
        cap: bilinear(&grid.cap, s, c, wx, wy),
        chem: bilinear(&grid.chem, s, c, wx, wy),
        minerals: bilinear(&grid.minerals, s, c, wx, wy),
    }
}

pub fn sample_grid_into(grid: &TerrainGrid, wx: f64, wy: f64, out: &mut GridSample) {
    let size = grid.size;
    let cell = grid.cell;
    let gx = wx / cell as f64;
    let gy = wy / cell as f64;
    let ix = (gx.floor() as usize).min(size - 1);
    let iy = (gy.floor() as usize).min(size - 1);
    let fx = (gx - ix as f64).max(0.0).min(1.0);
    let fy = (gy - iy as f64).max(0.0).min(1.0);
    let x1 = (ix + 1).min(size - 1);
    let y1 = (iy + 1).min(size - 1);
    let i00 = iy * size + ix;
    let i10 = iy * size + x1;
    let i01 = y1 * size + ix;
    let i11 = y1 * size + x1;
    let w00 = (1.0 - fx) * (1.0 - fy);
    let w10 = fx * (1.0 - fy);
    let w01 = (1.0 - fx) * fy;
    let w11 = fx * fy;

    out.height = grid.height[i00] as f64 * w00
        + grid.height[i10] as f64 * w10
        + grid.height[i01] as f64 * w01
        + grid.height[i11] as f64 * w11;
    out.energy = grid.energy[i00] as f64 * w00
        + grid.energy[i10] as f64 * w10
        + grid.energy[i01] as f64 * w01
        + grid.energy[i11] as f64 * w11;
    out.moisture = grid.moisture[i00] as f64 * w00
        + grid.moisture[i10] as f64 * w10
        + grid.moisture[i01] as f64 * w01
        + grid.moisture[i11] as f64 * w11;
    out.hazard = grid.hazard[i00] as f64 * w00
        + grid.hazard[i10] as f64 * w10
        + grid.hazard[i01] as f64 * w01
        + grid.hazard[i11] as f64 * w11;
    out.food = grid.food[i00] as f64 * w00
        + grid.food[i10] as f64 * w10
        + grid.food[i01] as f64 * w01
        + grid.food[i11] as f64 * w11;
    out.meat = grid.meat[i00] as f64 * w00
        + grid.meat[i10] as f64 * w10
        + grid.meat[i01] as f64 * w01
        + grid.meat[i11] as f64 * w11;
    out.signal = grid.signal[i00] as f64 * w00
        + grid.signal[i10] as f64 * w10
        + grid.signal[i01] as f64 * w01
        + grid.signal[i11] as f64 * w11;
    out.cap = grid.cap[i00] as f64 * w00
        + grid.cap[i10] as f64 * w10
        + grid.cap[i01] as f64 * w01
        + grid.cap[i11] as f64 * w11;
    out.chem = grid.chem[i00] as f64 * w00
        + grid.chem[i10] as f64 * w10
        + grid.chem[i01] as f64 * w01
        + grid.chem[i11] as f64 * w11;
    out.minerals = grid.minerals[i00] as f64 * w00
        + grid.minerals[i10] as f64 * w10
        + grid.minerals[i01] as f64 * w01
        + grid.minerals[i11] as f64 * w11;
}

pub fn sample_height(grid: &TerrainGrid, wx: f64, wy: f64) -> f64 {
    let size = grid.size;
    let cell = grid.cell;
    let gx = wx / cell as f64;
    let gy = wy / cell as f64;
    let ix = (gx.floor() as usize).min(size - 1);
    let iy = (gy.floor() as usize).min(size - 1);
    let fx = (gx - ix as f64).max(0.0).min(1.0);
    let fy = (gy - iy as f64).max(0.0).min(1.0);
    let x1 = (ix + 1).min(size - 1);
    let y1 = (iy + 1).min(size - 1);
    let a = grid.height[iy * size + ix] as f64;
    let b = grid.height[iy * size + x1] as f64;
    let c = grid.height[y1 * size + ix] as f64;
    let d = grid.height[y1 * size + x1] as f64;
    a + (b - a) * fx + (c - a) * fy + (d - b - c + a) * fx * fy
}
