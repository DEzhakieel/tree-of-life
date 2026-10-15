use crate::agent::SimAgent;
use crate::chemistry::AgentChemistry;
use crate::genome::decode_metab_genes;
use fractal_life_shared::constants::*;
use std::collections::HashMap;

/// Opt-in mesoscale biophysics (WorldConfig.biophysics). Phase 1 computed
/// *observable telemetry only*; Phase 2 also couples the Lennard-Jones force
/// pass into the movement steering (equal-and-opposite per pair, min-image on
/// the torus, softened + magnitude-clamped so overlap never blows up), still
/// gated entirely behind the flag.  Conservation and thermodynamic bookkeeping
/// remain read-only at stats time.  Every pass is deterministic: agents are
/// processed in ascending-id order and no RNG is drawn here.
///
/// When `WorldConfig.biophysics` is absent/false the engine calls none of
/// these functions, so the legacy trajectory is bit-identical.

/// A thin position/affinity snapshot of one alive agent.
#[derive(Clone, Copy, Debug)]
pub struct Pt {
    pub id: u32,
    pub x: f64,
    pub y: f64,
    /// Trait-derived hydrophilicity in [0,1] (carb-bias gene CHEM_OFFSET+0).
    /// Drives the attractive envelope of the pairwise force.
    pub aff: f64,
}

/// Force-field + spatial-organization aggregate for one tick.
#[derive(Clone, Copy, Debug, Default)]
pub struct BioAgg {
    pub mean_force: f64,
    pub cluster_count: u32,
    pub cluster_order: f64,
    pub rotational_order: f64,
    pub spatial_entropy: f64,
    pub dimensional_entropy: f64,
    pub org_index: f64,
    pub symmetry_drift: f64,
}

/// One full force pass: telemetry aggregate plus the per-agent net force
/// vectors aligned 1:1 with the input point snapshot.  The vectors are
/// equal-and-opposite across every pair (Newton's third law) so the sum over
/// all alive agents is ~zero; the engine applies them as a steering drive.
#[derive(Debug, Default)]
pub struct FieldPass {
    pub agg: BioAgg,
    pub fx: Vec<f64>,
    pub fy: Vec<f64>,
}

/// Per-agent thermodynamic / cascade aggregate for one tick.
#[derive(Clone, Copy, Debug, Default)]
pub struct ThermoAgg {
    pub cascade_rate: f64,
    pub bond_energy: f64,
    pub reaction_enthalpy: f64,
    pub entropy_production: f64,
    pub carnot_efficiency: f64,
    pub heat_waste: f64,
    pub engine_power: f64,
    pub radiation_field: f64,
    pub thermal_balance: f64,
}

fn clamp(v: f64, lo: f64, hi: f64) -> f64 {
    lo.max(v.min(hi))
}

/// Build the sorted (by id) position snapshot for alive agents, with affinity
/// read from the hydrophilic carb-bias gene (CHEM_OFFSET + 0).
pub fn build_points(agents: &HashMap<u32, SimAgent>, alive_ids: &[u32]) -> Vec<Pt> {
    let mut pts: Vec<Pt> = alive_ids
        .iter()
        .filter_map(|id| agents.get(id))
        .filter(|a| a.alive)
        .map(|a| {
            let gene = a.genome.get(CHEM_OFFSET).copied().unwrap_or(0.5) as f64;
            let aff = clamp(0.25 + 0.75 * gene, 0.0, 1.0);
            Pt {
                id: a.id,
                x: a.x,
                y: a.y,
                aff,
            }
        })
        .collect();
    pts.sort_by_key(|p| p.id);
    pts
}

/// Cohesive clustering radius (union-find membership): a strict fraction of
/// the force cutoff so "clusters" are spatially meaningful blobs.
const CLUSTER_EPS: f64 = FORCE_REP_SIGMA as f64 * 1.5;

/// Estimate reaction-cascade activity from the current chemical pool
/// (read-only): how many molecular species are above the reaction floor,
/// amplified by the enzyme pool and scaled to a rate-like magnitude.
fn reaction_activity(chem: &AgentChemistry) -> f64 {
    let active = chem.molecules.iter().filter(|&&m| m as f64 > 2.0).count() as f64;
    let enz_sum: f64 = chem.enzymes.iter().map(|&e| e as f64).sum();
    let enz_factor = enz_sum / (ENZYME_TYPE_COUNT as f64 * CHEM_MAX_ENZYME as f64);
    active * 0.25 + enz_factor * 0.5
}

/// Per-agent thermodynamic bookkeeping, evaluated read-only at stats time.
/// `dt` is the tick time-step (`time_scale`), `cap` the energy capacity, and
/// `o2_local` the local terrain oxygen driving aerobic yield.
pub fn agent_thermo(a: &SimAgent, dt: f64, cap: f64, _o2_local: f64) -> ThermoAgg {
    let chem = &a.chemistry;
    let metab_g = decode_metab_genes(&a.genome);

    let activity = reaction_activity(chem).max(0.0);

    let mol = &chem.molecules;
    let mut bond_energy = 0.0f64;
    for (i, &m) in mol.iter().enumerate() {
        let weight = 2.0 + (i % 4) as f64;
        bond_energy += m as f64 * BOND_ENERGY_K as f64 * weight;
    }
    let reaction_enthalpy = BOND_ENERGY_K as f64
        * (2.0 * mol.get(6).copied().unwrap_or(0.0) as f64
            + 1.5 * mol.get(3).copied().unwrap_or(0.0) as f64
            + 1.0 * mol.get(9).copied().unwrap_or(0.0) as f64
            - 1.0 * mol.get(7).copied().unwrap_or(0.0) as f64);

    let t_hot = CARNOT_TEMP_MIN as f64
        + metab_g.thermoregulation * (CARNOT_TEMP_MAX as f64 - CARNOT_TEMP_MIN as f64);
    let carnot_efficiency = clamp(1.0 - CARNOT_TEMP_MIN as f64 / t_hot, 0.0, 1.0);

    let basal_spend = BASAL_METABOLIC_COST as f64 * metab_g.basal_rate * dt;
    let entropy_production = ENTROPY_PRODUCTION_K as f64 * activity * (1.0 - carnot_efficiency);
    let heat_waste = HEAT_WASTE_FRACTION as f64 * basal_spend;
    let engine_power = ENGINE_POWER_K as f64
        * clamp(a.energy / cap.max(1e-9), 0.0, 1.0)
        * dt
        * (1.0 - HEAT_WASTE_FRACTION as f64);
    let radiation_field =
        RADIATION_EMISSIVITY as f64 * RADIATION_STEFAN_BOLTZMANN as f64 * (t_hot / 100.0).powi(4);
    let thermal_balance = heat_waste + radiation_field - engine_power;

    ThermoAgg {
        cascade_rate: activity,
        bond_energy,
        reaction_enthalpy,
        entropy_production,
        carnot_efficiency,
        heat_waste,
        engine_power,
        radiation_field,
        thermal_balance,
    }
}

/// Compute the force-field + spatial-organization telemetry over the sorted
/// point snapshot, together with per-agent force vectors for steering.
/// Deterministic: every pair is counted exactly once (deduped across torus-edge
/// ghosts) and deposited on both endpoints with opposite sign.
pub fn compute_field(pts: &[Pt]) -> FieldPass {
    if pts.is_empty() {
        return FieldPass::default();
    }
    let n = pts.len();
    let cutoff = FORCE_CUTOFF as f64;
    let cutoff2 = cutoff * cutoff;
    let eps = CLUSTER_EPS;
    let world = WORLD_SIZE as f64;
    let half_world = world * 0.5;

    // Minimum-image separation on the torus ([0, WORLD_SIZE) in both axes).
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

    // Grid index over the point snapshot (cell size = cutoff so a 3x3 window
    // always contains every interaction partner).  Points within `cutoff` of a
    // torus edge also get ghost entries one world-period over, so cross-edge
    // neighbours are reachable from the window search.
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

    let mut sum_force = 0.0f64;
    let mut pairs = 0u64;
    let mut psi6_sum = 0.0f64;
    let mut psi6_n = 0u64;
    // union-find over cohesion pairs
    let mut parent: Vec<usize> = (0..n).collect();
    fn find(parent: &mut Vec<usize>, mut x: usize) -> usize {
        while parent[x] != x {
            parent[x] = parent[parent[x]];
            x = parent[x];
        }
        x
    }
    let mut neighbors: Vec<usize> = Vec::with_capacity(64);
    // Exactly-once pair accounting without a hash set.
    //
    // The previous code guarded this with a `HashSet<(usize, usize)>` of every pair it
    // had already handled. That set has a hidden consequence: since a pair is consumed
    // during the outer iteration of its *lower* index, by the time the loop reaches `i`
    // every neighbour `j < i` within cutoff is already in the set, so `neighbors` only
    // ever held `j > i`. The set was therefore computing "half the neighbourhood" - it
    // halves the work, but it also means the hexatic order below is summed over
    // higher-index neighbours only, which is not the symmetric quantity psi6 is
    // supposed to be. `j <= i` reproduces the old behaviour bit-for-bit, so the change
    // here is performance-only; the asymmetry is reported, not silently fixed.
    let mut fx = vec![0.0f64; n];
    let mut fy = vec![0.0f64; n];

    for i in 0..n {
        let (cx, cy) = cell_of[i];
        neighbors.clear();
        for dy in -1..=1 {
            for dx in -1..=1 {
                if let Some(bucket) = grid.get(&(cx + dx, cy + dy)) {
                    for &j in bucket {
                        if j <= i {
                            continue;
                        }
                        let (wdx, wdy) = min_image(pts[j].x - pts[i].x, pts[j].y - pts[i].y);
                        let d2 = wdx * wdx + wdy * wdy;
                        if d2 < cutoff2 {
                            neighbors.push(j);
                        }
                    }
                }
            }
        }
        // LJ force for each pair (counted once, from the lower id).
        let sigma = FORCE_REP_SIGMA as f64;
        let soften = FORCE_SOFTEN_R as f64;
        let f_max = FORCE_MAX as f64;
        for &j in &neighbors {
            let (wdx, wdy) = min_image(pts[j].x - pts[i].x, pts[j].y - pts[i].y);
            let r = (wdx * wdx + wdy * wdy).sqrt();
            if r < 1e-6 {
                continue;
            }
            let aff_pair = 0.5 * (pts[i].aff + pts[j].aff);
            let rep_w = FORCE_REP_K as f64 * REPULSION_WEIGHT as f64 * (1.0 - aff_pair);
            let att_w = FORCE_ATTRACT_K as f64 * AFFINITY_WEIGHT as f64 * aff_pair;
            let sr = sigma / r.max(soften);
            let sr6 = sr.powi(6);
            let sr12 = sr6 * sr6;
            let f_net = rep_w * sr12 - att_w * sr6;
            let f = f_net.clamp(-f_max, f_max);
            sum_force += f_net.abs();
            pairs += 1;
            // cohesion (clustering) union
            if r < eps {
                let ri = find(&mut parent, i);
                let rj = find(&mut parent, j);
                if ri != rj {
                    parent[ri] = rj;
                }
            }
            // deposit the equal-and-opposite steering force (f > 0 repels)
            let inv = 1.0 / r;
            let ux = wdx * inv;
            let uy = wdy * inv;
            fx[i] -= f * ux;
            fy[i] -= f * uy;
            fx[j] += f * ux;
            fy[j] += f * uy;
        }
        // hexatic (rotational) order from all in-window neighbours
        if !neighbors.is_empty() {
            let mut sr6 = 0.0f64;
            let mut si6 = 0.0f64;
            for &j in &neighbors {
                let (wdx, wdy) = min_image(pts[j].x - pts[i].x, pts[j].y - pts[i].y);
                let th = wdy.atan2(wdx);
                sr6 += (6.0 * th).cos();
                si6 += (6.0 * th).sin();
            }
            let k = neighbors.len() as f64;
            psi6_sum += (sr6 / k).hypot(si6 / k);
            psi6_n += 1;
        }
    }

    let mean_force = if pairs > 0 {
        sum_force / pairs as f64
    } else {
        0.0
    };

    // cluster membership per agent, then occupancy-weighted cluster order
    let mut comp_of = vec![0usize; n];
    for i in 0..n {
        comp_of[i] = find(&mut parent, i);
    }
    let mut comp_size: HashMap<usize, usize> = HashMap::new();
    for &c in &comp_of {
        *comp_size.entry(c).or_insert(0) += 1;
    }
    let mut cohesion = 0.0f64;
    let mut cohesion_n = 0u64;
    for i in 0..n {
        let c = comp_of[i];
        let members = (comp_size.get(&c).copied().unwrap_or(1) as f64 - 1.0).max(0.0);
        cohesion += members / n as f64;
        cohesion_n += 1;
    }
    let cluster_order = if cohesion_n > 0 {
        cohesion / cohesion_n as f64
    } else {
        0.0
    };

    // spatial entropy over a WORLD_SIZE/SPATIAL_CELL occupancy grid
    let b = (WORLD_SIZE_USIZE as f64 / SPATIAL_CELL as f64) as usize;
    let mut occ = vec![0u64; b * b];
    for p in pts.iter() {
        let gx = clamp(
            ((p.x + WORLD_SIZE as f64 * 0.5) / SPATIAL_CELL as f64).floor(),
            0.0,
            b as f64 - 1.0,
        ) as usize;
        let gy = clamp(
            ((p.y + WORLD_SIZE as f64 * 0.5) / SPATIAL_CELL as f64).floor(),
            0.0,
            b as f64 - 1.0,
        ) as usize;
        occ[gy * b + gx] += 1;
    }
    let spatial_entropy = shannon_bits(occ.iter().map(|&c| c as f64));

    // dimensional entropy from the 2D position covariance
    let cx = pts.iter().map(|p| p.x).sum::<f64>() / n as f64;
    let cy = pts.iter().map(|p| p.y).sum::<f64>() / n as f64;
    let mut sxx = 0.0f64;
    let mut syy = 0.0f64;
    let mut sxy = 0.0f64;
    for p in pts.iter() {
        let dx = p.x - cx;
        let dy = p.y - cy;
        sxx += dx * dx;
        syy += dy * dy;
        sxy += dx * dy;
    }
    sxx /= n as f64;
    syy /= n as f64;
    sxy /= n as f64;
    let trace = sxx + syy;
    let det = (sxx * syy - sxy * sxy).max(0.0);
    let disc = (trace * trace - 4.0 * det).sqrt();
    let l1 = 0.5 * (trace + disc).max(0.0);
    let l2 = 0.5 * (trace - disc).max(0.0);
    let tt = l1 + l2 + 1e-12;
    let p1 = l1 / tt;
    let p2 = l2 / tt;
    let dimensional_entropy = shannon_bits([p1, p2].iter().copied());

    // organizational index: how far spatial entropy sits below uniform
    let h_max = (b as f64 * b as f64).log2();
    let org_index = if h_max > 0.0 {
        clamp(1.0 - spatial_entropy / h_max, 0.0, 1.0)
    } else {
        0.0
    };

    // circular asymmetry about the centroid (0 = radially symmetric)
    let mut sx = 0.0f64;
    let mut sy = 0.0f64;
    for p in pts.iter() {
        let dx = p.x - cx;
        let dy = p.y - cy;
        let r = dx.hypot(dy);
        if r > 1e-9 {
            sx += dx / r;
            sy += dy / r;
        }
    }
    let symmetry_drift = clamp(sx.hypot(sy) / n as f64, 0.0, 1.0);

    FieldPass {
        agg: BioAgg {
            mean_force,
            cluster_count: comp_size.len() as u32,
            cluster_order,
            rotational_order: if psi6_n > 0 {
                psi6_sum / psi6_n as f64
            } else {
                0.0
            },
            spatial_entropy,
            dimensional_entropy,
            org_index,
            symmetry_drift,
        },
        fx,
        fy,
    }
}

fn shannon_bits<I: IntoIterator<Item = f64>>(counts: I) -> f64 {
    let counts: Vec<f64> = counts.into_iter().collect();
    let total: f64 = counts.iter().sum();
    if total <= 0.0 {
        return 0.0;
    }
    let mut h = 0.0f64;
    for &c in &counts {
        if c > 0.0 {
            let p = c / total;
            h -= p * p.log2();
        }
    }
    h
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mk_pt(id: u32, x: f64, y: f64, aff: f64) -> Pt {
        Pt { id, x, y, aff }
    }

    #[test]
    fn two_agents_close_repel_hard() {
        // Two agents at sigma distance: repulsion dominates the net force.
        let pts = vec![
            mk_pt(0, 0.0, 0.0, 0.5),
            mk_pt(1, FORCE_REP_SIGMA as f64, 0.0, 0.5),
        ];
        let pass = compute_field(&pts);
        assert!(pass.agg.mean_force > 0.0, "repulsion should be nonzero");
        assert_eq!(pass.agg.cluster_count, 1, "within eps they are one cluster");
    }

    #[test]
    fn far_agents_do_not_interact() {
        let pts = vec![
            mk_pt(0, 0.0, 0.0, 0.5),
            mk_pt(1, FORCE_CUTOFF as f64 * 4.0, 0.0, 0.5),
        ];
        let pass = compute_field(&pts);
        assert_eq!(pass.agg.mean_force, 0.0);
        assert_eq!(pass.agg.cluster_count, 2);
        assert_eq!(pass.fx[0], 0.0);
        assert_eq!(pass.fy[0], 0.0);
    }

    #[test]
    fn single_agent_is_neutral() {
        let pts = vec![mk_pt(7, 0.0, 0.0, 0.5)];
        let pass = compute_field(&pts);
        assert_eq!(pass.agg.mean_force, 0.0);
        assert_eq!(pass.agg.cluster_count, 1);
        assert_eq!(pass.agg.spatial_entropy, 0.0);
        assert_eq!(pass.agg.symmetry_drift, 0.0);
        assert_eq!(pass.fx[0], 0.0);
        assert_eq!(pass.fy[0], 0.0);
    }

    #[test]
    fn empty_field_is_zero() {
        let pass = compute_field(&[]);
        assert_eq!(pass.agg.mean_force, 0.0);
        assert_eq!(pass.agg.cluster_count, 0);
        assert!(pass.fx.is_empty());
        assert!(pass.fy.is_empty());
    }

    #[test]
    fn forces_are_antisymmetric_and_saturate() {
        // Overlapping agents: strongly repulsive in opposite directions, and
        // the pair torque sums to zero.
        let pts = vec![
            mk_pt(0, 0.0, 0.0, 0.5),
            mk_pt(1, FORCE_SOFTEN_R as f64, 0.0, 0.5),
        ];
        let pass = compute_field(&pts);
        assert!(
            pass.fx[0] < 0.0,
            "agent 0 pushed away (-x), got {}",
            pass.fx[0]
        );
        assert!(
            pass.fx[1] > 0.0,
            "agent 1 pushed away (+x), got {}",
            pass.fx[1]
        );
        assert!((pass.fx[0] + pass.fx[1]).abs() < 1e-9, "equal and opposite");
        assert!(pass.fx[0].abs() <= FORCE_MAX as f64, "magnitude clamped");
        assert_eq!(pass.fy[0], 0.0);
        assert_eq!(pass.fy[1], 0.0);
    }

    #[test]
    fn shared_affinity_pulls_across_x() {
        // High-affinity pair beyond sigma: the net force points from j toward
        // i (attraction along -x for the lower-id agent).
        let aff = 0.9;
        let sigma = FORCE_REP_SIGMA as f64;
        let d = sigma * 1.5;
        let pts = vec![mk_pt(0, 0.0, 0.0, aff), mk_pt(1, d, 0.0, aff)];
        let pass = compute_field(&pts);
        assert!(
            pass.fx[0] > 0.0,
            "affine agents should attract toward +x (fx0 = {})",
            pass.fx[0]
        );
        assert!(
            pass.fx[1] < 0.0,
            "affine agents should attract (fx1 = {})",
            pass.fx[1]
        );
    }

    #[test]
    fn wrap_around_edge_is_sane() {
        // Same agents separated across the torus boundary are seen as close;
        // the resulting force stays finite and the pair cohesive.
        let pts = vec![
            mk_pt(0, WORLD_SIZE as f64 - 5.0, 0.0, 0.5),
            mk_pt(1, 5.0, 0.0, 0.5),
        ];
        let pass = compute_field(&pts);
        for (i, (x, y)) in pass.fx.iter().zip(pass.fy.iter()).enumerate() {
            assert!(x.is_finite(), "fx[{i}] finite");
            assert!(y.is_finite(), "fy[{i}] finite");
        }
        // wrapped distance is 12 (< sigma*1.5) -> cohesive, repulsive net
        assert!(pass.agg.mean_force > 0.0);
        assert_eq!(pass.agg.cluster_count, 1);
    }

    /// The pre-optimisation field pass, kept verbatim as a reference.
    ///
    /// It dedupes candidate pairs with a `HashSet` of every pair already handled. The
    /// production code replaced that with `j <= i`, on the reasoning that a pair is
    /// consumed at the outer iteration of its lower index, so by the time `i` runs every
    /// in-range `j < i` is already in the set. If that reasoning is wrong the two
    /// implementations select different neighbours, and every force below differs - so
    /// this compares the whole force field, bit-for-bit, rather than a proxy.
    fn reference_field(pts: &[Pt]) -> (Vec<f64>, Vec<f64>, u64, f64, f64) {
        use std::collections::HashSet;
        let n = pts.len();
        let cutoff = FORCE_CUTOFF as f64;
        let cutoff2 = cutoff * cutoff;
        let world = WORLD_SIZE as f64;
        let half_world = world * 0.5;
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
        let mut sum_force = 0.0f64;
        let mut pairs = 0u64;
        let mut psi6_sum = 0.0f64;
        let mut psi6_n = 0u64;
        let mut counted: HashSet<(usize, usize)> = HashSet::new();
        let mut neighbors: Vec<usize> = Vec::with_capacity(64);
        let eps = 1.0f64; // cohesion radius used by the caller
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
            let sigma = FORCE_REP_SIGMA as f64;
            let soften = FORCE_SOFTEN_R as f64;
            let f_max = FORCE_MAX as f64;
            for &j in &neighbors {
                let (wdx, wdy) = min_image(pts[j].x - pts[i].x, pts[j].y - pts[i].y);
                let r = (wdx * wdx + wdy * wdy).sqrt();
                if r < 1e-6 {
                    continue;
                }
                let aff_pair = 0.5 * (pts[i].aff + pts[j].aff);
                let rep_w = FORCE_REP_K as f64 * REPULSION_WEIGHT as f64 * (1.0 - aff_pair);
                let att_w = FORCE_ATTRACT_K as f64 * AFFINITY_WEIGHT as f64 * aff_pair;
                let sr = sigma / r.max(soften);
                let sr6 = sr.powi(6);
                let sr12 = sr6 * sr6;
                let f_net = rep_w * sr12 - att_w * sr6;
                let f = f_net.clamp(-f_max, f_max);
                sum_force += f_net.abs();
                pairs += 1;
                let _ = eps;
                let inv = 1.0 / r;
                let ux = wdx * inv;
                let uy = wdy * inv;
                fx[i] -= f * ux;
                fy[i] -= f * uy;
                fx[j] += f * ux;
                fy[j] += f * uy;
            }
            if !neighbors.is_empty() {
                let mut sr6 = 0.0f64;
                let mut si6 = 0.0f64;
                for &j in &neighbors {
                    let (wdx, wdy) = min_image(pts[j].x - pts[i].x, pts[j].y - pts[i].y);
                    let th = wdy.atan2(wdx);
                    sr6 += (6.0 * th).cos();
                    si6 += (6.0 * th).sin();
                }
                let k = neighbors.len() as f64;
                psi6_sum += (sr6 / k).hypot(si6 / k);
                psi6_n += 1;
            }
        }
        let mean_force = if pairs > 0 {
            sum_force / pairs as f64
        } else {
            0.0
        };
        let psi6 = if psi6_n > 0 {
            psi6_sum / psi6_n as f64
        } else {
            0.0
        };
        (fx, fy, pairs, mean_force, psi6)
    }

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

    fn clustered_pts(n: usize, seed: u64) -> Vec<Pt> {
        let mut rng = Lcg(seed);
        let world = WORLD_SIZE as f64;
        let cutoff = FORCE_CUTOFF as f64;
        (0..n)
            .map(|i| {
                // mixed regimes: uniform bulk, a dense blob, and agents hugging both
                // torus edges so the ghost cells are exercised
                let (x, y) = match i % 4 {
                    0 => (rng.next_f64() * world, rng.next_f64() * world),
                    1 => (100.0 + rng.next_f64() * 60.0, 100.0 + rng.next_f64() * 60.0),
                    2 => (rng.next_f64() * cutoff * 0.9, rng.next_f64() * world),
                    _ => (
                        world - rng.next_f64() * cutoff * 0.9,
                        world - rng.next_f64() * cutoff * 0.9,
                    ),
                };
                Pt {
                    id: i as u32,
                    x,
                    y,
                    aff: rng.next_f64(),
                }
            })
            .collect()
    }

    #[test]
    fn force_field_is_bit_identical_to_the_hashset_reference() {
        for &n in &[0usize, 1, 2, 5, 40, 300] {
            let pts = clustered_pts(n, 0xfeed_0000 + n as u64);
            let (rfx, rfy, _rpairs, rmean, rpsi) = reference_field(&pts);
            let pass = compute_field(&pts);
            assert_eq!(pass.fx, rfx, "fx diverged at n={n}");
            assert_eq!(pass.fy, rfy, "fy diverged at n={n}");
            assert_eq!(pass.agg.mean_force, rmean, "mean force diverged at n={n}");
            assert_eq!(
                pass.agg.rotational_order, rpsi,
                "hexatic order diverged at n={n}"
            );
        }
    }

    #[test]
    fn net_force_still_cancels() {
        // equal-and-opposite pair deposits must leave no net momentum behind
        for &n in &[2usize, 40, 300] {
            let pts = clustered_pts(n, 0xabcd_0000 + n as u64);
            let pass = compute_field(&pts);
            let total: f64 = pass.fx.iter().sum();
            let total_y: f64 = pass.fy.iter().sum();
            assert!(total.abs() < 1e-9, "net x force should cancel, got {total}");
            assert!(
                total_y.abs() < 1e-9,
                "net y force should cancel, got {total_y}"
            );
        }
    }
}
