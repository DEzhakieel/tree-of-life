//! Neighbor-search benchmark: measures build + query cost of the uniform grid
//! against agent count, so the O(Nk) claim is measured rather than asserted.
//!
//! Also measures the full `Engine::tick` with the MT_DELTA render frame on vs
//! off, i.e. how much wall-clock the render payload costs a headless run.
//!
//! Run: cargo run --release --example bench_neighbors -p fractal-life-simulation

use fractal_life_shared::types::{WorldConfig, WorldParams};
use fractal_life_simulation::engine::Engine;
use fractal_life_simulation::spatial_hash::SpatialHash;
use std::time::Instant;

const WORLD: f64 = 2048.0;
const CELL: f32 = 32.0;
/// widest sense radius the genome can express (genome.rs: lerp(8, 64))
const MAX_RADIUS: f64 = 64.0;

/// deterministic LCG so runs are comparable across rebuilds
struct Lcg(u64);
impl Lcg {
    fn next_f64(&mut self) -> f64 {
        self.0 = self
            .0
            .wrapping_mul(6364136223846793005)
            .wrapping_add(1442695040888963407);
        ((self.0 >> 11) as f64) / ((1u64 << 53) as f64)
    }
}

fn bench(n: usize) -> (f64, f64, f64, usize) {
    let mut rng = Lcg(0x5eed_1234);
    let xs: Vec<f64> = (0..n).map(|_| rng.next_f64() * WORLD).collect();
    let ys: Vec<f64> = (0..n).map(|_| rng.next_f64() * WORLD).collect();

    let cell_count = (WORLD as f32 / CELL) as usize;
    let mut grid = SpatialHash::new(CELL, cell_count);
    let mut scratch = vec![0i32; 64];

    // build: what every tick pays to re-bin the live population
    let mut best_build = f64::INFINITY;
    for _ in 0..5 {
        let t = Instant::now();
        grid.clear();
        for i in 0..n {
            grid.insert(i as i32, xs[i], ys[i]);
        }
        grid.seal();
        best_build = best_build.min(t.elapsed().as_secs_f64());
    }

    // query: one radius scan per agent, the actual neighbour search
    let mut best_query = f64::INFINITY;
    let mut found = 0usize;
    for _ in 0..5 {
        let t = Instant::now();
        let mut total = 0usize;
        for i in 0..n {
            total += grid.query_neighbors(xs[i], ys[i], MAX_RADIUS, &mut scratch, 24);
        }
        let e = t.elapsed().as_secs_f64();
        best_query = best_query.min(e);
        found = total;
    }
    (best_build, best_query, found as f64 / n as f64, found)
}

fn main() {
    println!(
        "uniform grid: cell={} world={} radius={} (max sense)",
        CELL, WORLD, MAX_RADIUS
    );
    println!();
    println!(
        "{:>8}  {:>12}  {:>12}  {:>10}  {:>12}  {:>8}",
        "N", "build ms", "query ms", "avg k", "query us/agent", "rel"
    );
    let mut prev: Option<(usize, f64)> = None;
    for &n in &[500usize, 1000, 2000, 4000, 8000, 16000, 32000] {
        let (build, query, k, _) = bench(n);
        let rel = match prev {
            None => String::from("-"),
            Some((pn, pq)) => {
                let dn = n as f64 / pn as f64;
                format!("{:>7.2}x", query / pq / dn)
            }
        };
        println!(
            "{:>8}  {:>12.3}  {:>12.3}  {:>10.1}  {:>12.4}  {:>8}",
            n,
            build * 1e3,
            query * 1e3,
            k,
            query / n as f64 * 1e6,
            rel
        );
        prev = Some((n, query));
    }
    println!();
    println!(
        "'rel' is query time growth per doubling of N; 1.00x means linear, 4.00x means quadratic."
    );

    field_bench();
}

/// The biophysics force pass, which used to dedupe candidate pairs through a
/// `HashSet<(usize, usize)>`. It is only run when `WorldConfig.biophysics` is on, so
/// it is off the default hot path, but when it *is* on the set was the dominant cost.
fn field_bench() {
    use fractal_life_simulation::biophysics::{compute_field, Pt};

    println!();
    println!("biophysics::compute_field (WorldConfig.biophysics = true)");
    println!();
    println!(
        "{:>8}  {:>12}  {:>12}  {:>10}",
        "N", "pass ms", "legacy ms", "speedup"
    );
    let mut rng = Lcg(0xf1e1_d);
    for &n in &[200usize, 400, 800, 1600, 3200] {
        // mixed spread: bulk, a dense blob, and edge-hugging agents
        let pts: Vec<Pt> = (0..n)
            .map(|i| {
                let (x, y) = match i % 4 {
                    0 => (rng.next_f64() * WORLD, rng.next_f64() * WORLD),
                    1 => (100.0 + rng.next_f64() * 60.0, 100.0 + rng.next_f64() * 60.0),
                    2 => (rng.next_f64() * 20.0, rng.next_f64() * WORLD),
                    _ => (WORLD - rng.next_f64() * 20.0, WORLD - rng.next_f64() * 20.0),
                };
                Pt {
                    id: i as u32,
                    x,
                    y,
                    aff: rng.next_f64(),
                }
            })
            .collect();
        let mut best = f64::INFINITY;
        for _ in 0..5 {
            let t = Instant::now();
            let pass = compute_field(&pts);
            let e = t.elapsed().as_secs_f64();
            std::hint::black_box(&pass);
            best = best.min(e);
        }
        let mut legacy = f64::INFINITY;
        for _ in 0..5 {
            let t = Instant::now();
            let (fx, fy) = legacy_field(&pts);
            let e = t.elapsed().as_secs_f64();
            std::hint::black_box((&fx, &fy));
            legacy = legacy.min(e);
        }
        println!(
            "{:>8}  {:>12.3}  {:>12.3}  {:>9.2}x",
            n,
            best * 1e3,
            legacy * 1e3,
            legacy / best
        );
    }

    bench_tick();
}

/// Engine-level tick cost with the render payload on vs off. Same world, same
/// seed, same number of ticks — the only difference is whether `tick` builds the
/// per-agent MT_DELTA frame.
fn bench_tick() {
    println!();
    println!("Engine::tick — render frame ON vs OFF (identical trajectory)");
    println!();
    println!(
        "{:>8}  {:>10}  {:>10}  {:>9}  {:>12}  {:>12}  {:>10}",
        "spawn", "on ms", "off ms", "speedup", "on tps", "off tps", "frame B"
    );

    fn cfg(seed: &str, spawn: usize) -> WorldConfig {
        WorldConfig {
            id: "bench".to_string(),
            seed: seed.to_string(),
            fractal_type: "julia",
            params: WorldParams {
                spawn_count: spawn,
                ..WorldParams::default()
            },
            created_at: 0.0,
            current_tick: 0,
            universe: None,
            cell_bio: None,
            biophysics: None,
            omics: Some(true),
            omics_stochastic: Some(true),
            combinatorial: Some(true),
            recombination: Some(true),
            discovery: Some(true),
            folding: Some(true),
            stochastic_dynamics: Some(true),
            environment: None,
            topology: None,
            signal_deposit: None,
            meme_copy_rate: None,
            reproduction: None,
            sensing: None,
        }
    }

    let ticks = 40usize;
    for &spawn in &[500usize, 2000, 8000, 32000] {
        let mut on = f64::INFINITY;
        let mut off = f64::INFINITY;
        let mut frame_bytes = 0usize;
        for record in [true, false] {
            let mut e = Engine::new(cfg("bench-tick", spawn));
            e.set_record_delta(record);
            // warm up so the first-touch page faults don't skew the result
            for _ in 0..5 {
                e.tick();
            }
            let mut best = f64::INFINITY;
            for _ in 0..3 {
                let t = Instant::now();
                for _ in 0..ticks {
                    let r = e.tick();
                    std::hint::black_box(r.delta.len());
                    if record {
                        frame_bytes = r.delta.len();
                    }
                }
                best = best.min(t.elapsed().as_secs_f64());
            }
            if record {
                on = best;
            } else {
                off = best;
            }
        }
        let per = on / ticks as f64;
        println!(
            "{:>8}  {:>10.3}  {:>10.3}  {:>8.2}x  {:>12.0}  {:>12.0}  {:>10}",
            spawn,
            per * 1e3,
            off / ticks as f64 * 1e3,
            on / off,
            1.0 / per,
            1.0 / (off / ticks as f64),
            frame_bytes
        );
    }
}

/// The pre-optimisation pair selection: identical geometry, but candidate pairs are
/// deduped through a `HashSet<(usize, usize)>` instead of a `j <= i` guard.
///
/// Kept here so the speedup is measured against the real previous algorithm rather
/// than estimated. Results are identical - `biophysics::tests` asserts that.
fn legacy_field(pts: &[fractal_life_simulation::biophysics::Pt]) -> (Vec<f64>, Vec<f64>) {
    use std::collections::{HashMap, HashSet};

    const FORCE_CUTOFF: f64 = 24.0;
    const FORCE_REP_SIGMA: f64 = 2.4;
    const FORCE_SOFTEN_R: f64 = 0.6;
    const FORCE_MAX: f64 = 3.0;
    const FORCE_REP_K: f64 = 1.0;
    const FORCE_ATTRACT_K: f64 = 0.6;
    const REPULSION_WEIGHT: f64 = 1.0;
    const AFFINITY_WEIGHT: f64 = 1.0;

    let n = pts.len();
    let world = WORLD;
    let half_world = world * 0.5;
    let cutoff = FORCE_CUTOFF;
    let cutoff2 = cutoff * cutoff;
    let min_image = |dx: f64, dy: f64| -> (f64, f64) {
        let wx = if dx > half_world {
            dx - world
        } else if dx < -half_world {
            dx + world
        } else {
            dx
        };
        let wy = if dy > half_world {
            dy - world
        } else if dy < -half_world {
            dy + world
        } else {
            dy
        };
        (wx, wy)
    };
    let cell = cutoff;
    let ncx = (world / cell) as i64;
    let mut grid: HashMap<(i64, i64), Vec<usize>> = HashMap::new();
    let mut cell_of = vec![(0i64, 0i64); n];
    for (i, p) in pts.iter().enumerate() {
        let cx = (p.x / cell).floor() as i64;
        let cy = (p.y / cell).floor() as i64;
        cell_of[i] = (cx, cy);
        grid.entry((cx, cy)).or_default().push(i);
        let mut xs = vec![0i64];
        if p.x < cutoff {
            xs.push(ncx);
        }
        if p.x > world - cutoff {
            xs.push(-ncx);
        }
        let mut ys = vec![0i64];
        if p.y < cutoff {
            ys.push(ncx);
        }
        if p.y > world - cutoff {
            ys.push(-ncx);
        }
        for &sx in &xs {
            for &sy in &ys {
                if sx == 0 && sy == 0 {
                    continue;
                }
                grid.entry((cx + sx, cy + sy)).or_default().push(i);
            }
        }
    }
    let mut fx = vec![0.0f64; n];
    let mut fy = vec![0.0f64; n];
    let mut counted: HashSet<(usize, usize)> = HashSet::new();
    let mut neighbors: Vec<usize> = Vec::with_capacity(64);
    for i in 0..n {
        let (cx, cy) = cell_of[i];
        neighbors.clear();
        for dy in -1..=1 {
            for dx in -1..=1 {
                if let Some(bucket) = grid.get(&(cx + dx, cy + dy)) {
                    for &j in bucket {
                        if j == i {
                            continue;
                        }
                        let (wdx, wdy) = min_image(pts[j].x - pts[i].x, pts[j].y - pts[i].y);
                        let d2 = wdx * wdx + wdy * wdy;
                        if d2 < cutoff2 {
                            let key = if i < j { (i, j) } else { (j, i) };
                            if counted.insert(key) {
                                neighbors.push(j);
                            }
                        }
                    }
                }
            }
        }
        for &j in &neighbors {
            let (wdx, wdy) = min_image(pts[j].x - pts[i].x, pts[j].y - pts[i].y);
            let r = (wdx * wdx + wdy * wdy).sqrt();
            if r < 1e-6 {
                continue;
            }
            let aff_pair = 0.5 * (pts[i].aff + pts[j].aff);
            let rep_w = FORCE_REP_K * REPULSION_WEIGHT * (1.0 - aff_pair);
            let att_w = FORCE_ATTRACT_K * AFFINITY_WEIGHT * aff_pair;
            let sr = FORCE_REP_SIGMA / r.max(FORCE_SOFTEN_R);
            let sr6 = sr.powi(6);
            let sr12 = sr6 * sr6;
            let f = (rep_w * sr12 - att_w * sr6).clamp(-FORCE_MAX, FORCE_MAX);
            let inv = 1.0 / r;
            let ux = wdx * inv;
            let uy = wdy * inv;
            fx[i] -= f * ux;
            fy[i] -= f * uy;
            fx[j] += f * ux;
            fy[j] += f * uy;
        }
    }
    (fx, fy)
}
