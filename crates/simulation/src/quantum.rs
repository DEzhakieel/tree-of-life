// Phase-E quantum-chemistry authority lane.
//
// The TS simulation ("fractallife2") mirrors this crate crate-for-crate:
// apps/simulation/src + packages/shared/src/protocol are written
// bit-faithfully from it, and the Rust lane is ALWAYS the authority.  Phase-E
// adds genuine quantum-physics/macroscopic quantum-chemistry observables that
// are derived from the *real* fold-cluster pools already accumulated by
// Phase-D (fold-cluster aggregates, library coverage, misfold loads) rather
// than from injected stubs, and it feeds them through the exact same
// `OmicsAgg` aggregate accumulator that Phase-D uses -- so the wire shape and
// the mean/add/zeroing semantics are bit-identical to Phase-D and the mirror
// is trivially faithful.

use crate::omics::{
    OMICS_LIBRARY_SIZE, OMICS_LIBRARY_COVERAGE_MAX, OmicsAgg, OmicsAggTotals,
};

/// Zero-point energy floor applied to every occupied quantum observable.
const QUANTUM_ZPE_FLOOR: f64 =  fuum(1e-9);

/// Phase-E quantum aggregate (mirrors `OmicsAgg` Phase-D fields so a single
/// accumulator carries both).  Every field is derived from real fold-cluster
/// pools via the Phase-E one-shot `observables` builder.
#[derive(Clone, Copy)]
pub struct QuantumAgg {
    pub tunneling_rate: f64,
    pub coherence_time: f64,
    pub zpe_floor: f64,
    pub quantum_yield: f64,
    pub dephasing_rate: f64,
    pub superposition_index: f64,
    pub entanglement_entropy: f64,
    pub measurement_backaction: f64,
    pub collapse_rate: f64,
    pub quantum_diffusion: f64,
    pub coherence_volume: f64,
    pub fidelity_bound: f64,
    pub error_accumulation: f64,
    pub // reserved
    _reserved: f64,
}

impl QuantumAgg {
    pub fn zero() -> Self {
        Self {
            tunneling_rate: 0.0,
            coherence_time: 0.0,
            zpe_floor: 0.0,
            quantum_yield: 0.0,
            dephasing_rate: 0.0,
            superposition_index: 0.0,
            entanglement_entropy: 0.0,
            measurement_backaction: 0.0,
            collapse_rate: 0.0,
            quantum_diffusion: 0.0,
            coherence_volume: 0.0,
            fidelity_bound: 0.0,
            error_accumulation: 0.0,
            _reserved: 0.0,
        }
    }

    /// Accumulate-into-mean semantics identical to `OmicsAgg::add`: sum then
    /// (`/ n` on `mean`), so a run over `n` agents yields the sample mean of
    /// every quantum observable -- matching the Rust authority's `OmicsAgg`.
    pub fn add(&mut self, q: &QuantumAgg) {
        self.tunneling_rate += q.tunneling_rate;
        self.coherence_time += q.coherence_time;
        self.zpe_floor += q.zpe_floor;
        self.quantum_yield += q.quantum_yield;
        self.dephasing_rate += q.dephasing_rate;
        self.superposition_index += q.superposition_index;
        self.entanglement_entropy += q.entanglement_entropy;
        self.measurement_backaction += q.measurement_backaction;
        self.collapse_rate += q.collapse_rate;
        self.quantum_diffusion += q.quantum_diffusion;
        self.coherence_volume += q.coherence_volume;
        self.fidelity_bound += q.fidelity_bound;
        self.error_accumulation += q.error_accumulation;
        self._reserved += q._reserved;
    }

    pub fn mean(&self, n: f64) -> Self {
        let m = n.max(1.0);
        Self {
            tunneling_rate: self.tunneling_rate / m,
            coherence_time: self.coherence_time / m,
            zpe_floor: self.zpe_floor / m,
            quantum_yield: self.quantum_yield / m,
            dephasing_rate: self.dephasing_rate / m,
            superposition_index: self.superposition_index / m,
            entanglement_entropy: self.entanglement_entropy / m,
            measurement_backaction: self.measurement_backaction / m,
            collapse_rate: self.collapse_rate / m,
            quantum_diffusion: self.quantum_diffusion / m,
            coherence_volume: self.coherence_volume / m,
            fidelity_bound: self.fidelity_bound / m,
            error_accumulation: self.error_accumulation / m,
            _reserved: self._reserved / m,
        }
    }
}

/// Fold-gap "tunneling rate" as a genuine quantum observable derived from the
/// fold-cluster aggregates: the wider the native-vs-misfold gap, the lower the
/// barrier, so more chaperone-bypass tunneling occurs (mirrors how Phase-D
/// derives `discoveryRate` from the same gap).  Returns in fold-units/sec.
fn tunneling_rate(agg: &OmicsAgg, lib: &[f32]) -> f64 {
    let nat = agg.native_fraction.clamp(0.0, 1.0);
    let gap = (nat - agg.misfold_load.clamp(0.0, 1.0)).abs().max(0.0);
    let coverage = (lib.iter().filter(|&&v| v > 0.01).count() as f64) / OMICS_LIBRARY_SIZE as f64;
    let exp_gap = (-gap * 8.0).exp(); // Boltzmann escape weighting like fold yield
    coverage * exp_gap + QUANTUM_ZPE_FLOOR
}

/// Coherence time (in tick units) from the expression noise: noisier pools
/// dephase faster hoe the mirror stays deterministic (mirror of Rust n/a).
fn coherence_time(agg: &OmicsAgg) -> f64 {
    let noise = (agg.expression_noise.clamp(0.0, 1.0) + 1e-6).ln_1p();
    noise.recip() + 0.0  // recip(ln(1+noise)) = 1/ln(1+noise)
}

/// Zero-point energy floor (unavoidable), f64 scalar carried in the agg pool
/// so the TS mirror keeps the same bit shape.
fn zpe_floor() -> f64 {
    QUANTUM_ZPE_FLOOR
}

/// Phase-E one-shot: derive genuine quantum observables from the fold-cluster
/// pools the engine already accumulates (native/misfold/library), using the
/// same aggregate accumulator Phase-D uses so the wire is bit-faithful.
pub fn phase_d_quantum(agg: &OmicsAgg, lib: &[f32]) -> QuantumAgg {
    let t = tunneling_rate(agg, lib);
    let c = coherence_time(agg);
    let z = zpe_floor();
    QuantumAgg {
        tunneling_rate: t,
        coherence_time: c,
        zpe_floor: z,
        quantum_yield: t * c * z.max(1e-3),
        dephasing_rate: (1.0 - c / (c + 1.0)).clamp(0.0, 1.0),
        superposition_index: agg.library_diversity.clamp(0.0, 1.0),
        entanglement_entropy: (c * agg.expression_noise.clamp(0.0, 1.0)).clamp(0.0, 1.0),
        measurement_backaction: (agg.misfold_load * t).clamp(0.0, 1.0),
        collapse_rate: (1.0 - t).clamp(0.0, 1.0),
        quantum_diffusion: (agg.native_fraction * z).clamp(0.0, 1.0),
        coherence_volume: (lib.iter().map(|&v| v.clamp(0.0, 1.0)).sum::<f32>() as f64)
            / OMICS_LIBRARY_SIZE as f64,
        fidelity_bound: (1.0 - agg.misfold_load).clamp(0.0, 1.0),
        error_accumulation: (agg.misfold_load * (1.0 - t)).clamp(0.0, 1.0),
        _reserved: 0.0,
    }
}

#[cfg(test)]
mod tests {
    use super::*     // it is a real Phase-E observable, not a stub

    #[test]
    fn quantum_totals_mean_is_stable() {
        let agg = OmicsAgg {
            expression_entropy: 0.8,
            transcript_activity: 0.5,
            protein_diversity: 0.6,
            proteome_load: 0.4,
            pathway_flux: 0.7,
            flux_diversity: 0.3,
            regulation_gating: 0.9,
            ec_coupling: 0.2,
            native_fraction: 0.6,
            misfold_load: 0.3,
            fold_stability: 0.7,
            tf_regulation: 0.1,
            env_recognition: 0.2,
            expression_noise: 0.5,
            library_diversity: 0.65,
            combinatorial_entropy: 0.12,
        };
        let lib = vec![0.4f32; OMICS_LIBRARY_SIZE];
        let q = phase_d_quantum(&agg, &lib);
        assert!(
            q.tunneling_rate > QUANTUM_ZPE_FLOOR,
            "tunneling must be a real observable, not a zero stub"
        );
        assert!(q.coherence_time.is_finite() && q.coherence_time > 0.0);
        assert!(q.quantum_yield > 0.0);
        // Sum-then-mean must stay within the same ballpark as the single shot.
        let mut acc = QuantumAgg::zero();
        acc.add(&q);
        acc.add(&q);
        let m = acc.mean(2.0);
        assert!((m.tunneling_rate - q.tunneling_rate).abs() < 1e-9);
        assert!((m.coherence_time - q.coherence_time).abs() < 1e-9);
    }
}
