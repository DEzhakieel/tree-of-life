//! The CSR uniform grid must be observationally identical to the `HashMap`-of-`Vec`
//! layout it replaced, *including candidate order*.
//!
//! The engine cuts neighbour lists off at `NEIGHBOR_MAX`, so which neighbours survive
//! depends on traversal order - and that choice feeds the cohesion centroid, the
//! warning broadcast, and the parent drawn for a birth. An order change would be a
//! silent change in simulation results, so it is pinned here rather than trusted.

use fractal_life_simulation::spatial_hash::reference::assert_same_order;
use fractal_life_simulation::spatial_hash::SpatialHash;

const WORLD: f64 = 2048.0;
const CELL: f32 = 32.0;
const CELL_COUNT: usize = 64;

/// deterministic LCG
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

fn population(n: usize, seed: u64) -> Vec<(i32, f64, f64)> {
    let mut rng = Lcg(seed);
    (0..n)
        .map(|i| (i as i32, rng.next_f64() * WORLD, rng.next_f64() * WORLD))
        .collect()
}

fn queries(
    agents: &[(i32, f64, f64)],
    per_radius: &[f64],
    max: usize,
) -> Vec<(f64, f64, f64, usize)> {
    let mut out = Vec::new();
    // query from real agent positions *and* near the edges, where the window runs
    // off the dense array and the bounds skip has to match the old hash lookup
    let edge = [0.5, 1.0, 31.9, 32.1, 2016.0, 2047.5];
    for &(id, x, y) in agents.iter().step_by(7) {
        let _ = id;
        for &r in per_radius {
            out.push((x, y, r, max));
        }
    }
    for &x in &edge {
        for &y in &edge {
            for &r in per_radius {
                out.push((x, y, r, max));
            }
        }
    }
    out
}

#[test]
fn csr_matches_reference_order_at_every_density() {
    // spans empty, sparse, capped (k saturates) and fully saturated populations
    for &n in &[0usize, 1, 2, 17, 200, 2000, 20000] {
        let agents = population(n, 0xabcd_0000 + n as u64);
        let radii = [8.0, 32.0, 64.0];
        for &max in &[1usize, 8, 24, 64, 4096] {
            assert_same_order(&agents, CELL, CELL_COUNT, &queries(&agents, &radii, max));
        }
    }
}

#[test]
fn csr_matches_reference_with_clustered_and_degenerate_input() {
    // all agents in one cell, and a full line of agents: pathological bucket occupancy
    let mut agents: Vec<(i32, f64, f64)> = (0..500)
        .map(|i| (i, 100.0 + (i % 3) as f64 * 0.5, 100.0))
        .collect();
    let mut more: Vec<(i32, f64, f64)> = (0..2000)
        .map(|i| (500 + i, 1000.0, 500.0 + i as f64 * 0.01))
        .collect();
    agents.append(&mut more);
    assert_same_order(
        &agents,
        CELL,
        CELL_COUNT,
        &queries(&agents, &[16.0, 64.0], 24),
    );
}

#[test]
fn queries_agree_with_brute_force_when_nothing_is_truncated() {
    // with max above the true count, the result must be *every* agent within radius,
    // which is checkable against an O(N^2) scan
    let agents = population(400, 0x5150);
    let mut grid = SpatialHash::new(CELL, CELL_COUNT);
    for &(id, x, y) in &agents {
        grid.insert(id, x, y);
    }
    grid.seal();
    let mut scratch = vec![0i32; 4096];
    for &r in &[8.0f64, 64.0] {
        for &(i, x, y) in agents.iter().take(60) {
            let n = grid.query_neighbors(x, y, r, &mut scratch, 4096);
            let mut got: Vec<i32> = scratch[..n].to_vec();
            // The grid deliberately includes the query point itself; the engine filters
            // `nb.id === a.id` at every use site (engine.rs). So the reference must
            // include self too, otherwise this test asserts a contract that does not exist.
            let mut want: Vec<i32> = agents
                .iter()
                .filter(|&&(_, jx, jy)| {
                    let dx = jx - x;
                    let dy = jy - y;
                    dx * dx + dy * dy < r * r
                })
                .map(|&(j, _, _)| j)
                .collect();
            // order is compared against the reference map in the tests above; here only
            // the set is compared, since brute force walks insertion order
            got.sort_unstable();
            want.sort_unstable();
            assert_eq!(got, want, "grid missed agents within r={r} from agent {i}");
        }
    }
}

#[test]
fn seal_is_idempotent_and_clear_resets_it() {
    let agents = population(500, 0x7777);
    let mut grid = SpatialHash::new(CELL, CELL_COUNT);
    for &(id, x, y) in &agents {
        grid.insert(id, x, y);
    }
    grid.seal();
    let mut a = vec![0i32; 512];
    let n1 = grid.query_neighbors(500.0, 500.0, 64.0, &mut a, 24);
    grid.seal();
    let mut b = vec![0i32; 512];
    let n2 = grid.query_neighbors(500.0, 500.0, 64.0, &mut b, 24);
    assert_eq!(n1, n2);
    assert_eq!(a[..n1], b[..n2], "re-sealing changed the answer");
    grid.clear();
    assert_eq!(grid.len(), 0);
    assert!(!grid.is_sealed());
    assert_eq!(
        grid.query_neighbors(500.0, 500.0, 64.0, &mut b, 24),
        0,
        "queries after clear must see nothing"
    );
}

#[test]
fn rebuild_after_clear_matches_first_build() {
    // the engine clears and refills every tick; a stale cell_start would leak agents
    // from the previous tick into this one's queries
    let first = population(900, 0x1234);
    let second = population(700, 0x5678);

    let probe = |round: &[(i32, f64, f64)]| -> Vec<i32> {
        let mut fresh = SpatialHash::new(CELL, CELL_COUNT);
        for &(id, x, y) in round {
            fresh.insert(id, x, y);
        }
        fresh.seal();
        let mut scratch = vec![0i32; 512];
        let mut got = Vec::new();
        for i in [0usize, 100, 400, round.len() - 1] {
            let n = fresh.query_neighbors(round[i].1, round[i].2, 64.0, &mut scratch, 24);
            got.extend_from_slice(&scratch[..n]);
        }
        got
    };

    let want_first = probe(&first);
    let want_second = probe(&second);

    // one grid reused across rounds that change population size
    let mut grid = SpatialHash::new(CELL, CELL_COUNT);
    let mut scratch = vec![0i32; 512];
    let mut run = |grid: &mut SpatialHash, round: &[(i32, f64, f64)]| -> Vec<i32> {
        grid.clear();
        for &(id, x, y) in round {
            grid.insert(id, x, y);
        }
        grid.seal();
        let mut got = Vec::new();
        for i in [0usize, 100, 400, round.len() - 1] {
            let n = grid.query_neighbors(round[i].1, round[i].2, 64.0, &mut scratch, 24);
            got.extend_from_slice(&scratch[..n]);
        }
        got
    };

    assert_eq!(run(&mut grid, &first), want_first, "first fill");
    assert_eq!(
        run(&mut grid, &second),
        want_second,
        "refill with a different population"
    );
    assert_eq!(
        run(&mut grid, &first),
        want_first,
        "refill back to the first population"
    );
}

#[test]
fn growth_beyond_the_initial_capacity_keeps_order() {
    // insert() reallocates its slot arrays; cell_of must grow with them or the CSR
    // scatter reads a stale cell assignment
    let n = 5000;
    let agents = population(n, 0x9999);
    assert_same_order(&agents, CELL, CELL_COUNT, &queries(&agents, &[64.0], 24));
}
