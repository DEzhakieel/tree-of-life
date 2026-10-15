/// Uniform grid over agent positions, stored as a CSR (counting-sorted) bucket list.
///
/// Build is O(N) with two flat passes and no allocation once warm; a query walks
/// only the cells within `span` of the point, so cost is O(k) in the occupancy of
/// those cells. `cell_count` is 64 for the engine world (2048 / 32), so the cell
/// axis is a dense `cell_count * cell_count` array rather than a hash map - 4096
/// buckets indexed directly, no hashing on the query path.
///
/// **Candidate order is load-bearing.** The engine truncates a neighbour list at
/// `NEIGHBOR_MAX`, and the choice of which neighbours survive the cut feeds the
/// cohesion centroid, the warning broadcast and even the parent drawn for a birth.
/// The CSR scatter therefore walks agents in insertion order, which makes the
/// within-cell order ascending-by-slot exactly as the previous `Vec`-per-cell map
/// produced it. Any change to this ordering changes simulation results, not just
/// speed, so it is covered by `tests/spatial_grid.rs` against a reference map.
pub struct SpatialHash {
    pub cell_size: f32,
    pub cell_count: usize,
    /// CSR bucket boundaries, length `cell_count * cell_count + 1`.
    cell_start: Vec<u32>,
    /// Slot indices grouped by cell, ascending within each cell.
    items: Vec<u32>,
    /// Per-cell population, reused by `seal`.
    counts: Vec<u32>,
    /// Cell of each slot, filled by `insert`, consumed by `seal`.
    cell_of: Vec<u32>,
    slots_id: Vec<i32>,
    xs: Vec<f32>,
    ys: Vec<f32>,
    n: usize,
    /// true once `cell_start`/`items` reflect every inserted agent.
    sealed: bool,
}

impl SpatialHash {
    pub fn new(cell_size: f32, cell_count: usize) -> Self {
        let cells = cell_count * cell_count;
        Self {
            cell_size,
            cell_count,
            cell_start: vec![0; cells + 1],
            items: Vec::new(),
            counts: vec![0; cells],
            cell_of: Vec::new(),
            slots_id: Vec::new(),
            xs: Vec::new(),
            ys: Vec::new(),
            n: 0,
            sealed: false,
        }
    }

    pub fn clear(&mut self) {
        self.n = 0;
        // The per-cell counts must go too. `seal` prefix-sums them to lay out the CSR
        // buckets, so leaving them behind would make the next seal size its buckets for
        // this tick's population plus the previous tick's - overrunning `items` and
        // scattering live agents into the wrong buckets.
        for c in self.counts.iter_mut() {
            *c = 0;
        }
        self.sealed = false;
    }

    /// live agent count
    pub fn len(&self) -> usize {
        self.n
    }

    pub fn is_empty(&self) -> bool {
        self.n == 0
    }

    fn grow(&mut self) {
        let cap = (self.slots_id.len() * 2).max(1024);
        self.slots_id.resize(cap, 0);
        self.xs.resize(cap, 0.0);
        self.ys.resize(cap, 0.0);
        self.cell_of.resize(cap, 0);
    }

    fn key(&self, cx: i32, cy: i32) -> u32 {
        ((cx + cy * self.cell_count as i32) as u32).wrapping_add(0)
    }

    pub fn insert(&mut self, id: i32, x: f64, y: f64) {
        if self.n >= self.slots_id.len() {
            self.grow();
        }
        self.slots_id[self.n] = id;
        self.xs[self.n] = x as f32;
        self.ys[self.n] = y as f32;
        // The engine wraps positions into [0, world) before inserting, so this
        // always lands in range. Clamping keeps a stray coordinate from indexing
        // past the dense bucket array; it is a safety net, not a code path.
        let cx = ((x / self.cell_size as f64).floor() as i32).clamp(0, self.cell_count as i32 - 1);
        let cy = ((y / self.cell_size as f64).floor() as i32).clamp(0, self.cell_count as i32 - 1);
        let k = self.key(cx, cy) as usize;
        self.counts[k] += 1;
        self.cell_of[self.n] = k as u32;
        self.n += 1;
        self.sealed = false;
    }

    /// Turn the per-slot cell assignments into the CSR bucket array.
    ///
    /// Separate from `insert` because the bucket array cannot be built until every
    /// agent is known: it is a prefix sum over per-cell counts followed by a scatter.
    /// Two linear passes, no reallocation, and the scatter preserves insertion order
    /// so within-cell traversal matches the previous `Vec`-per-cell layout.
    pub fn seal(&mut self) {
        let cells = self.cell_count * self.cell_count;
        debug_assert!(self.counts.len() >= cells);
        let mut running = 0u32;
        for k in 0..cells {
            self.cell_start[k] = running;
            running += self.counts[k];
            self.counts[k] = 0;
        }
        self.cell_start[cells] = running;
        self.items.clear();
        self.items.resize(running as usize, 0);
        // insertion order => ascending slot within each cell, matching the old map
        for slot in 0..self.n {
            let k = self.cell_of[slot] as usize;
            let at = self.cell_start[k] as usize + self.counts[k] as usize;
            self.items[at] = slot as u32;
            self.counts[k] += 1;
        }
        self.sealed = true;
    }

    pub fn is_sealed(&self) -> bool {
        self.sealed
    }

    pub fn query_nearest(&self, x: f64, y: f64, radius: f64) -> i32 {
        if !self.sealed {
            return -1;
        }
        let r2 = radius * radius;
        let cx = (x / self.cell_size as f64).floor() as i32;
        let cy = (y / self.cell_size as f64).floor() as i32;
        let span = (radius / self.cell_size as f64).ceil() as i32;
        let mut best_slot: i32 = -1;
        let mut best_d2 = r2;

        for dy in -span..=span {
            let gy = cy + dy;
            if gy < 0 || gy >= self.cell_count as i32 {
                continue;
            }
            for dx in -span..=span {
                let gx = cx + dx;
                if gx < 0 || gx >= self.cell_count as i32 {
                    continue;
                }
                let k = (gy as usize) * self.cell_count + gx as usize;
                let (lo, hi) = (self.cell_start[k], self.cell_start[k + 1]);
                for &slot in &self.items[lo as usize..hi as usize] {
                    let s = slot as usize;
                    let ddx = self.xs[s] as f64 - x;
                    let ddy = self.ys[s] as f64 - y;
                    let d2 = ddx * ddx + ddy * ddy;
                    if d2 < best_d2 {
                        best_d2 = d2;
                        best_slot = s as i32;
                    }
                }
            }
        }
        if best_slot >= 0 {
            self.slots_id[best_slot as usize]
        } else {
            -1
        }
    }

    pub fn query_neighbors(
        &self,
        x: f64,
        y: f64,
        radius: f64,
        ids: &mut [i32],
        max: usize,
    ) -> usize {
        if !self.sealed {
            return 0;
        }
        let r2 = radius * radius;
        let cx = (x / self.cell_size as f64).floor() as i32;
        let cy = (y / self.cell_size as f64).floor() as i32;
        let span = (radius / self.cell_size as f64).ceil() as i32;
        let mut n = 0;
        let cap = max.min(ids.len());

        for dy in -span..=span {
            let gy = cy + dy;
            if gy < 0 || gy >= self.cell_count as i32 {
                continue;
            }
            for dx in -span..=span {
                let gx = cx + dx;
                if gx < 0 || gx >= self.cell_count as i32 {
                    continue;
                }
                let k = (gy as usize) * self.cell_count + gx as usize;
                let (lo, hi) = (self.cell_start[k], self.cell_start[k + 1]);
                for &slot in &self.items[lo as usize..hi as usize] {
                    if n >= cap {
                        return n;
                    }
                    let s = slot as usize;
                    let ddx = self.xs[s] as f64 - x;
                    let ddy = self.ys[s] as f64 - y;
                    if ddx * ddx + ddy * ddy < r2 {
                        ids[n] = self.slots_id[s];
                        n += 1;
                    }
                }
            }
        }
        n
    }

    pub fn query_circle(&self, x: f64, y: f64, radius: f64) -> Vec<i32> {
        if !self.sealed {
            return Vec::new();
        }
        let r2 = radius * radius;
        let cx = (x / self.cell_size as f64).floor() as i32;
        let cy = (y / self.cell_size as f64).floor() as i32;
        let span = (radius / self.cell_size as f64).ceil() as i32;
        let mut out = Vec::new();

        for dy in -span..=span {
            let gy = cy + dy;
            if gy < 0 || gy >= self.cell_count as i32 {
                continue;
            }
            for dx in -span..=span {
                let gx = cx + dx;
                if gx < 0 || gx >= self.cell_count as i32 {
                    continue;
                }
                let k = (gy as usize) * self.cell_count + gx as usize;
                let (lo, hi) = (self.cell_start[k], self.cell_start[k + 1]);
                for &slot in &self.items[lo as usize..hi as usize] {
                    let s = slot as usize;
                    let ddx = self.xs[s] as f64 - x;
                    let ddy = self.ys[s] as f64 - y;
                    if ddx * ddx + ddy * ddy < r2 {
                        out.push(self.slots_id[s]);
                    }
                }
            }
        }
        out
    }
}

/// The pre-CSR implementation, kept as the behavioural reference.
///
/// It is the literal previous layout - a hash map of per-cell `Vec`s in insertion
/// order - so tests can assert the CSR grid returns the identical neighbour list,
/// in the identical order, for every query. Any divergence here is a change in
/// simulation results, because the engine truncates neighbour lists at
/// `NEIGHBOR_MAX`.
///
/// Public rather than `#[cfg(test)]` because it lives in the library while the
/// assertions that use it run as an integration test.
pub mod reference {
    use super::SpatialHash;

    pub struct RefGrid {
        pub cell_size: f32,
        pub cell_count: usize,
        map: std::collections::HashMap<u32, Vec<usize>>,
        slots_id: Vec<i32>,
        xs: Vec<f32>,
        ys: Vec<f32>,
        n: usize,
    }

    impl RefGrid {
        pub fn new(cell_size: f32, cell_count: usize) -> Self {
            Self {
                cell_size,
                cell_count,
                map: std::collections::HashMap::new(),
                slots_id: Vec::new(),
                xs: Vec::new(),
                ys: Vec::new(),
                n: 0,
            }
        }

        fn key(&self, cx: i32, cy: i32) -> u32 {
            (cx + cy * self.cell_count as i32) as u32
        }

        pub fn insert(&mut self, id: i32, x: f64, y: f64) {
            self.slots_id.push(id);
            self.xs.push(x as f32);
            self.ys.push(y as f32);
            let cx = (x / self.cell_size as f64).floor() as i32;
            let cy = (y / self.cell_size as f64).floor() as i32;
            self.map.entry(self.key(cx, cy)).or_default().push(self.n);
            self.n += 1;
        }

        /// returns (ids, truncated_at_max) for the same traversal order as the CSR grid
        pub fn query_neighbors(&self, x: f64, y: f64, radius: f64, max: usize) -> Vec<i32> {
            let r2 = radius * radius;
            let cx = (x / self.cell_size as f64).floor() as i32;
            let cy = (y / self.cell_size as f64).floor() as i32;
            let span = (radius / self.cell_size as f64).ceil() as i32;
            let mut out = Vec::new();
            for dy in -span..=span {
                for dx in -span..=span {
                    if let Some(bucket) = self.map.get(&self.key(cx + dx, cy + dy)) {
                        for &slot in bucket {
                            if out.len() >= max {
                                return out;
                            }
                            let ddx = self.xs[slot] as f64 - x;
                            let ddy = self.ys[slot] as f64 - y;
                            if ddx * ddx + ddy * ddy < r2 {
                                out.push(self.slots_id[slot]);
                            }
                        }
                    }
                }
            }
            out
        }
    }

    /// build both grids from the same agents and compare neighbour lists
    pub fn assert_same_order(
        agents: &[(i32, f64, f64)],
        cell_size: f32,
        cell_count: usize,
        queries: &[(f64, f64, f64, usize)],
    ) {
        let mut csr = SpatialHash::new(cell_size, cell_count);
        let mut reff = RefGrid::new(cell_size, cell_count);
        for &(id, x, y) in agents {
            csr.insert(id, x, y);
            reff.insert(id, x, y);
        }
        csr.seal();
        let mut scratch = vec![0i32; 4096];
        for &(qx, qy, r, max) in queries {
            let n = csr.query_neighbors(qx, qy, r, &mut scratch, max);
            let got = &scratch[..n];
            let want = reff.query_neighbors(qx, qy, r, max);
            assert_eq!(
                got,
                &want[..],
                "CSR and reference disagree at ({qx},{qy}) r={r} max={max}"
            );
        }
    }
}
