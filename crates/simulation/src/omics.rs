use crate::chemistry::AgentChemistry;
use crate::dna::DnaSystem;
use crate::genome::{decode_dna_genes, decode_metab_genes};
use crate::rng::SplitMix64;
use fractal_life_shared::constants::*;

/// Opt-in molecular-omics layer (WorldConfig.omics).
///
/// Four coupled "omics" views over one per-agent state:
///   - **Transcriptomics**: 24 mrna pools whose synthesis is driven by the
///     DNA expression blocks, modulated by the epigenetic marks (gating), the
///     local environment (inducible/repressible transcription) and the
///     gene-expression gene.  This is the first consumer of `dna.expression`
///     and `dna.epigenetic`, which previously drifted without consequences.
///   - **Proteomics**: 24 protein pools translated from the transcriptome
///     (yield driven by the protein-metabolism + gene-expression genes) with
///     first-order turnover.  Blocks 0..=5 are the catalysts aligned 1:1 with
///     the chemistry enzyme types.
///   - **Fluxomics**: a 6-reaction pathway graph over the 12 molecule pools
///     mirroring the legacy catalysed reactions.  Throughput =
///     catalyst abundance x substrate mass-action x cofactor gate.  The fluxes
///     are then APPLIED back onto the pools (Phase B active fluxome): each
///     reaction consumes its substrate(s) and credits its product(s), clamped
///     to [0, CHEM_MAX_MOLECULE], so the omics layer genuinely alters
///     metabolism (and, via `tick_agent_chemistry`, the energy balance).
///   - **Interactomics**: cross-scale aggregates — expression entropy,
///     protein diversity, pathway flux, epigenetic regulation gating, and the
///     proteome<->enzyme coupling.
///
/// Phase C adds the regulatory protein-folding layer on top, still behind the
/// same flag:
///   - **Folding stability landscape**: every protein block derives a folding
///     stability (sequence fingerprint -> folding energy); the *native*
///     fraction relaxes toward a Boltzmann equilibrium scaled by heat, and a
///     misfolded fraction degrades faster.  The unfolded-protein response
///     damps transcription when misfold load crosses the threshold.  Native
///     fractions are what drive catalysis, coupling and regulation.
///   - **Pattern recognition**: each block's TF carries a motif fingerprint
///     that binds to other blocks' promoter addresses (hamming-affinity) AND
///     to the quantised environment signature — the same machinery classifies
///     the current environment pattern from a rolling signature window.
///   - **Combinatorial TF-promoter logic**: each promoter combines two
///     regulators through OR / AND / NOT gates into a transcription multiplier.
///   - **Combinatorial library chemistry** (WorldConfig.combinatorial): an
///     oligomer library ligated from molecule-pair pools, screened by the
///     folded (native) catalyst fraction.
///   - **Stochastic gene expression + folding entropy**
///     (WorldConfig.omicsStochastic): a per-block OU noise process on both
///     transcription and the native fraction, seeded per (world, tick, agent)
///     so identical genomes diverge cell-to-cell while staying reproducible.
///
/// Everything is deterministic (per-seed RNG, ascending-id engine loop) and
/// gated entirely behind the flag: when `WorldConfig.omics` is absent/false
/// the engine performs none of these updates, so the legacy trajectory is
/// bit-identical.

/// Stochastic-folding noise scale (mirrored in apps/simulation/src/omics.ts).
const FOLD_NOISE_SCALE: f64 = 0.02;
/// Boltzmann fold-units scale for the folding energy (mirrored in omics.ts).
const FOLD_BOLTZMANN: f64 = 2.0;
/// Hamming-distance midpoint of the TF binding sigmoid (of 12 signature bits).
const TF_BIND_MID: f64 = 8.0;
/// Phase E quantum-tunneling yield boost scale (apply_fluxome), per unit of
/// tunnel coupling.
const QUANTUM_TUNNEL_BOOST: f64 = 0.6;
/// Phase E quantum-decoherence penalty on catabolic energy recovery
/// (apply_fluxome), per unit of decoherence rate.
const QUANTUM_DECOHE_LOSS: f64 = 0.35;

#[derive(Clone)]
pub struct AgentOmics {
    /// Transcript pools (0..1), one per DNA expression block.
    pub mrna: Vec<f32>,
    /// Protein pools (0..1), one per expression block. Blocks 0..=5 align to
    /// the chemistry enzyme types; the rest are functional proteins.
    pub proteins: Vec<f32>,
    /// Per-block OU expression noise (Phase C stochastic gene expression).
    pub noise: Vec<f32>,
    /// Per-block folding stability in fold-units (sequence-derived, constant).
    pub stab: Vec<f32>,
    /// Per-block native (correctly-folded) protein fraction.
    pub native: Vec<f32>,
    /// Per-block misfolded (aggregate-prone) protein fraction.
    pub misfold: Vec<f32>,
    /// Per-block TF motif fingerprint (sequence-derived, constant).
    pub motifs: Vec<u32>,
    /// Oligomer library pools (Phase C combinatorial chemistry).
    pub library: Vec<f32>,
    /// Rolling environment-signature history for pattern classification.
    pub env_hist: Vec<u32>,
    /// Phase D aggregates per protein block (chaperone-clients of misfolded
    /// protein, WorldConfig.folding). Zero when the folding flag is off.
    pub agg: Vec<f32>,
    /// Phase D chaperone capacity utilisation in [0, 1] (WorldConfig.folding).
    pub chaperone: f32,
}

/// Read-only environmental context driving transcription induction (the
/// "signalling environment" of the cell).
#[derive(Clone, Copy, Debug)]
pub struct OmicsEnv {
    pub o2: f64,
    pub food: f64,
    pub meat: f64,
    pub ph: f64,
    pub toxin: f64,
    pub water: f64,
    pub heat: f64,
}

impl Default for OmicsEnv {
    fn default() -> Self {
        Self {
            o2: 0.3,
            food: 0.0,
            meat: 0.0,
            ph: PH_NEUTRAL as f64,
            toxin: 0.0,
            water: 0.5,
            heat: 0.5,
        }
    }
}

/// Per-agent omics telemetry for one tick.
#[derive(Clone, Copy, Debug, Default)]
pub struct OmicsAgg {
    /// Shannon entropy (bits) of the transcript-abundance distribution.
    pub expression_entropy: f64,
    /// Mean transcript synthesis rate this tick (transcription throughput).
    pub transcript_activity: f64,
    /// Hill effective number of protein species (1..=OMICS_PROTEIN_BLOCKS).
    pub protein_diversity: f64,
    /// Mean protein pool abundance (proteome size proxy).
    pub proteome_load: f64,
    /// Total flux across the 6-reaction fluxome (pathway throughput).
    pub pathway_flux: f64,
    /// Shannon entropy (bits) of the reaction-flux distribution.
    pub flux_diversity: f64,
    /// Mean proportion of transcription allowed through epigenetic gating.
    /// 1.0 = fully expressed, 0.0 = fully silenced.
    pub regulation_gating: f64,
    /// Alignment of the proteome catalyst blocks (0..=5) with the chemistry
    /// enzyme pool (protein<->enzyme coupling, 0..1).
    pub ec_coupling: f64,
    /// Mean native fraction across the proteome (folded-protein yield).
    pub native_fraction: f64,
    /// Mean misfolded fraction across the proteome (unfolded-protein load).
    pub misfold_load: f64,
    /// Mean equilibrium native fraction (proteome folding stability).
    pub fold_stability: f64,
    /// Mean regulator transcription multiplier (TF regulatory load).
    pub tf_regulation: f64,
    /// Mean environment-recognition affinity (pattern classification score).
    pub env_recognition: f64,
    /// Mean |expression noise| across the blocks (0 when deterministic).
    pub expression_noise: f64,
    /// Shannon entropy (bits) of the oligomer library distribution.
    pub library_diversity: f64,
    /// Phase D chaperone capacity utilisation (0 when folding mechanics off).
    pub chaperone_load: f64,
    /// Phase D mean per-block aggregate load (aggregated misfolded protein).
    pub aggregate_load: f64,
    /// Phase D folding fidelity: native / (native + misfold + aggregate).
    pub fold_fidelity: f64,
    /// Phase D proteotoxicity proxy (misfold + 2x aggregate, normalised).
    pub proteotoxicity: f64,
    /// Phase D combinatorial selection: fraction of library pools occupied.
    pub library_coverage: f64,
    /// Phase D combinatorial selection: mean |deviation| of pair-binding affinity.
    pub binding_specificity: f64,
    /// Phase D combinatorial entropy: Shannon of the pair-binding configuration.
    pub combinatorial_entropy: f64,
    /// Phase E quantum: rate at which the folded-coherence dephases (heat,
    /// proteotoxicity and expression jitter). 0 = perfect coherence.
    pub decoherence_rate: f64,
    /// Phase E quantum: mean tick-lifetime of the folded coherent state.
    pub coherence_lifetime: f64,
    /// Phase E quantum: fold-barrier tunneling rate of the catalyst pair.
    pub tunneling_rate: f64,
    /// Phase E quantum: residual fold-well energy at the ground state.
    pub zero_point_energy: f64,
    /// Phase E quantum: Shannon entropy (bits) of the native/misfold/aggregate
    /// occupancy superposition.
    pub superposition_entropy: f64,
    /// Phase E quantum: transcriptome<->fold-disorder correlation entropy.
    pub entanglement_entropy: f64,
    /// Phase E quantum: effective proteome parallelism (coherent fold branches).
    pub quantum_parallelism: f64,
    /// Phase E quantum: probe/selection disturbance of the fold state.
    pub measurement_backaction: f64,
    /// Phase E quantum: rate the fold superposition collapses to an outcome.
    pub collapse_rate: f64,
    /// Phase E quantum: fluxome random-walk broadening (diffusion).
    pub quantum_diffusion: f64,
    /// Phase E quantum: substrate/product well tunneling coupling of the pools.
    pub tunnel_coupling: f64,
    /// Phase E quantum: structural extent of coherent folding (library scale).
    pub coherence_length: f64,
    /// Phase E quantum: fidelity of the observed phase vs the ideal native
    /// outcome (native-fraction reference).
    pub quantum_fidelity: f64,
    /// Phase G subatomic: mediated-exchange strength of the gauge fields —
    /// the boson sector's coupling weight on the proteome<->enzyme overlap.
    pub boson_field_intensity: f64,
    /// Phase G subatomic: electromagnetic energy channel — the folded fraction
    /// surviving decoherence times the jitter energy, blended with the real
    /// activated flux (photon transport as the resident EM energy current).
    pub photon_transport: f64,
    /// Phase G subatomic: strong color binding — native binder fitness times
    /// folding fidelity, amplified by the toxic misfold pressure that glues
    /// the aggregate glue (confinement of the unfolded colour charge).
    pub gluon_confinement: f64,
    /// Phase G subatomic: strong-coupling scale — folded fidelity and native
    /// yield set how strongly the strong force binds across the proteome.
    pub strong_coupling: f64,
    /// Phase G subatomic: heavy vector-boson (W/Z) mass generation — the
    /// vacuum zero-point curvature renormalised by the surviving (uncollapsed)
    /// sector of the fold superposition.
    pub weak_boson_mass: f64,
    /// Phase G subatomic: Higgs mass floor — mass acquisition from the fold
    /// vacuum field: the unfolded (low-stability) fraction plus the zero-point
    /// energy floor of the wells.
    pub higgs_mass_floor: f64,
    /// Phase G subatomic: light charged-channel (lepton) mobility — transcript
    /// and protein occupancy entropy (per log2 species) blended with the free,
    /// un-aggregated capacity left to carry the charge.
    pub lepton_mobility: f64,
    /// Phase G subatomic: oxidative electron carrier — the enzyme<pool coupling
    /// fused with the electromagnetic photon-transport channel (redox shuttling).
    pub electron_channel: f64,
    /// Phase G subatomic: quark-flavor population — oligomer-library species
    /// entropy (per log2 slot) plus the combinatorial pair-binding entropy as
    /// the flavour occupancy of the condensate.
    pub quark_flavor_population: f64,
    /// Phase G subatomic: up/down charge asymmetry — binder specificity lifts,
    /// misfold load drags, both around the neutral half of the charge split.
    pub up_down_asymmetry: f64,
    /// Phase G subatomic: strange-flavor off-diagonal mixing — coherence
    /// lifetime mixed with tunnelling coupling through the surviving coherence
    /// fraction (strangeness oscillation under the collapse floor).
    pub strange_flavor: f64,
    /// Phase G subatomic: charm-pool population — heavy excited-state weight
    /// from the zero-point energy and the fold-superposition Shannon depth.
    pub charm_pool: f64,
    /// Phase G subatomic: proton-stability bound — composite integrity is the
    /// free (un-aggregated) load scaled by the coherence that survives
    /// dephasing (confinement of the hadron interior).
    pub proton_stability: f64,
    /// Phase H quantum materials & material systems: the atom/particle
    /// arrangement of the fold-cluster condensate read as a condensed-matter
    /// lattice — atomic ordering and lattice periodicity, band structure
    /// (gap / Fermi level / conduction-valence occupancy), phonon energy
    /// transport, defect disorder, doping, carrier mobility, topological bulk
    /// order, the two-period moire interference and the thermal susceptibility
    /// of the ordered phase.
    /// Phase H quantum materials: ordered atom arrangement — native fold
    /// fidelity and folded yield, suppressed by the aggregate disorder
    /// (periodicity of the crystal).
    pub lattice_periodicity: f64,
    /// Phase H quantum materials: energy gap between the band states — low
    /// lepton mobility (few drifting charges) and the zero-point well floor
    /// open a wider insulator gap.
    pub band_gap: f64,
    /// Phase H quantum materials: occupied-state boundary — filled by the
    /// folded yield, drained by the aggregate disorder (Fermi bound).
    pub fermi_level: f64,
    /// Phase H quantum materials: mobile-carrier population of the conduction
    /// band — oxidative electron shuttling plus jitter injection across the gap.
    pub conduction_band: f64,
    /// Phase H quantum materials: bound-state filling of the valence band —
    /// binder specificity fills, electron-channel drain empties.
    pub valence_band: f64,
    /// Phase H quantum materials: lattice-vibration energy transport — thermal
    /// jitter riding the charged channel, blended with the tunnel coupling.
    pub phonon_flux: f64,
    /// Phase H quantum materials: electron-hole bound pair — binder affinity
    /// pairs across the photon channel while decoherence dissociates.
    pub exciton_binding: f64,
    /// Phase H quantum materials: lattice disorder — misfold and aggregate
    /// load as the vacancy/interstitial defects of the crystal.
    pub defect_density: f64,
    /// Phase H quantum materials: impurity carriers — strange- and charm-flavor
    /// population as the dopant species of the condensate.
    pub doping_level: f64,
    /// Phase H quantum materials: charged-transport rate — electron channel
    /// over the (defect-suppressed) lattice, scaled by the coherent lifetime.
    pub carrier_mobility: f64,
    /// Phase H quantum materials: non-trivial bulk order — quantum parallelism
    /// against the strange mixing, eroded by collapse (topological index).
    pub topological_invariant: f64,
    /// Phase H quantum materials: interference of two incommensurate periods —
    /// the fold-superposition depth per log2(3) over the library coverage.
    pub moire_superlattice: f64,
    /// Phase H quantum materials: order-vs-temperature response — thermal
    /// agitation destroys the lattice periodicity (critical susceptibility).
    pub lattice_thermal_susceptibility: f64,
    /// Phase I statistical mechanics & information theory: Boltzmann/Shannon
    /// entropies, dS production, Maxwell's demon, absolute-zero limit and the
    /// Landauer floor — a thermodynamics reading of the SAME fold-cluster pools
    /// Phase D/E/G/H accumulate (never stubs).
    /// Phase I statistical mechanics: macrostate occupancy entropy S_B = k ln W
    /// over the protein native/misfold space — Shannon depth of the proteome
    /// scaled per log2 species, blended with the unfolded (non-native) fraction.
    pub boltzmann_entropy: f64,
    /// Phase I statistical mechanics: Jensen-analog transcriptome<->proteome
    /// divergence — normalised absolute difference of the two occupancy
    /// entropies (H(mrna) vs H(protein)) per log2 species.
    pub shannon_dissimilarity: f64,
    /// Phase I statistical mechanics: entropy change across the tick — the
    /// transcriptome-proteome entropy drift blended with thermal-jittered
    /// expression noise (dS production rate).
    pub entropy_change_rate: f64,
    /// Phase I statistical mechanics: Gibbs free energy (available work G) —
    /// the non-thermal fraction of the folded proteome, discounted by
    /// aggregate load.
    pub gibbs_free_energy: f64,
    /// Phase I statistical mechanics: irreversible entropy production S_gen —
    /// misfolding and aggregation plus the quantum dephasing losses.
    pub entropy_production: f64,
    /// Phase I statistical mechanics: time-reversal asymmetry (arrow of time) —
    /// entropy change rides the dephasing rate of the fold superposition.
    pub time_reversal_asymmetry: f64,
    /// Phase I information theory: Maxwell's-demon sorting power — the
    /// measurement (backaction) gates ordered products over a coherent lattice
    /// (measured information converted into ordered work).
    pub maxwell_demon_power: f64,
    /// Phase I information theory: demon information cost — kT ln(2) energy
    /// expended per bit read/gated: superposition depth plus expression noise.
    pub demon_information_cost: f64,
    /// Phase I statistical mechanics: absolute-zero proximity index — motion
    /// freezes and irreversible entropy production vanishes as T falls to 0.
    pub absolute_zero_proximity: f64,
    /// Phase I information theory: quantum Landauer floor — minimum energy to
    /// erase one bit, widened by fold-fidelity error and the thermal bath.
    pub quantum_landauer_floor: f64,
    /// Phase I statistical mechanics: heat-capacity anomaly — divergent response
    /// near the folding transitions (fidelity crossing the Fermi level).
    pub heat_capacity_anomaly: f64,
    /// Phase I statistical mechanics: kT damping — thermal agitation overcomes
    /// the ordered lattice periodicity.
    pub kbt_damping: f64,
    /// Phase I statistical mechanics: canonical partition-function occupancy Z —
    /// normalised flux-occupancy entropy blended with the free (un-aggregated)
    /// load.
    pub canonical_partition_z: f64,
    /// Phase J nanosystems: nanoparticle surface area — free enthalpy of the
    /// dispersed RESTRIPPED crystallite surfaces, discounted by precipitation
    /// (lost to aggregation) and the cryogenic freeze.
    pub nanoparticle_surface: f64,
    /// Phase J nanoparticles: nanoparticle number density — dosing fraction
    /// laced onto the enzymatic reaction surface.
    pub nanoparticle_density: f64,
    /// Phase J nanochemistry: nanopore transport — gated molecular passage
    /// through the defect-templated channel.
    pub nanopore_transport: f64,
    /// Phase J nanosystems: nanoscale contact — junction conductance across the
    /// topological band edge.
    pub nanoscale_contact: f64,
    /// Phase J nanobiology: molecular-machine work — assembled protein acted on
    /// by the demon-ordered (low-entropy) lattice, riding the superimposed
    /// quantum states.
    pub molecular_machine_work: f64,
    /// Phase J nanosystems: assembler accuracy — positional control of the
    /// molecular assembler, shaded by protein-folding fidelity noise.
    pub assembler_accuracy: f64,
    /// Phase J nanochemistry: nanofabrication yield — chaperone-quality strands
    /// forged per solvated protein.
    pub nanofabrication_yield: f64,
    /// Phase J nanobiology: DNA-origami stability — self-assembled fold lattice
    /// kept rigid by lattice thermal inertia against thermal agitation.
    pub dna_origami_stability: f64,
    /// Phase J nanobiology: bio-nano interface — fidelity of the folded
    /// machinery docking onto the dispersed crystallite surface.
    pub bionano_interface: f64,
    /// Phase J nanochemistry: nanozyme activity — enzyme-like nanocatalyst
    /// turnover, from the oxide surface exposed by lattice periodicity.
    pub nanozyme_activity: f64,
    /// Phase J nanoparticles: colloidal stability — dispersed nanotherapeutics
    /// surviving jitter, precipitation and proteotoxic overload.
    pub colloidal_stability: f64,
    /// Phase J nanosystems: quantum-dot brightness — colloidally-stable
    /// emissive nanocrystal yield under the quantum gate.
    pub quantum_dot_brightness: f64,
    /// Phase J nanoparticles: nanotoxic flux — cytopside hazard shed by the
    /// particle dispersion into the nervous stream.
    pub nanotoxic_flux: f64,
    /// Phase K reverse-engineered phylogeny: viral load — naked host-hijacking
    /// genome that reads as the unfolded, decoherent, noisy residue of the
    /// proteome.
    pub viral_load: f64,
    /// Phase K reverse-engineered phylogeny: bacterial load — simple
    /// high-turnover prokaryote lifestyle scored on disordered (non-lattice)
    /// heat-driven coupling.
    pub bacterial_load: f64,
    /// Phase K reverse-engineered phylogeny: archaeal density — extremophile
    /// heat tolerance of a robust, natively-folded proteome.
    pub archaeal_density: f64,
    /// Phase K reverse-engineered phylogeny: fungal biomass — hyphal mycelium
    /// scored as ordered long-range transport resistant to aggregation.
    pub fungal_biomass: f64,
    /// Phase K reverse-engineered phylogeny: protist motility — motile
    /// unicellular eukaryote scored on carrier motility in a warm, disordered
    /// cytosol.
    pub protist_motility: f64,
    /// Phase K reverse-engineered phylogeny: monera primordium — the
    /// pre-cellular prokaryote cradle: unfolded, low-occupancy and photon-simple.
    pub monera_primordial: f64,
    /// Phase K reverse-engineered phylogeny: plant photosynthesis — photonic
    /// capture channelled through the electron transport chain on an ordered
    /// lattice.
    pub plant_photosynthesis: f64,
    /// Phase K reverse-engineered phylogeny: poriferan channel (sponge anatomy)
    /// — nanopore plumbing washed by the photonic stream.
    pub poriferan_channel: f64,
    /// Phase K reverse-engineered phylogeny: chordate neural tube — dorsal-nerve
    /// signalling scored on coherent (low-dephasing) measurement power.
    pub chordate_neural_tube: f64,
    /// Phase K reverse-engineered phylogeny: pisces aquatic metabolism — gill
    /// grade aqueous ectotherm metabolism: cool, motile and low-entropy.
    pub pisces_aquatic_metabolism: f64,
    /// Phase K reverse-engineered phylogeny: mammalian thermoregulation —
    /// endotherm warm-bloodedness over a folded, quantum-coherent proteome.
    pub mammal_thermoregulation: f64,
    /// Phase K reverse-engineered phylogeny: primate cognition (towards Homo) —
    /// collective intelligence scored on ordered-measurement parallelism over a
    /// high-fidelity proteome.
    pub primate_cognition: f64,
    /// Phase K reverse-engineered phylogeny: symbiotic index — the
    /// cross-taxa cooperation signal of a natively-folded, well-coupled
    /// metabolic network.
    pub symbiotic_index: f64,
    /// Phase L reverse-engineered physiology: metabolic rate — the basal
    /// oxidative engine power scored on warmth over irreversible entropy.
    pub metabolic_rate: f64,
    /// Phase L reverse-engineered physiology: cardiovascular pump — circulatory
    /// delivery scored on carrier mobility through the nanopore transport.
    pub cardiovascular_pump: f64,
    /// Phase L reverse-engineered physiology: respiration efficiency — gas
    /// exchange scored on photonic input through a coherent, un-aggregated
    /// proteome.
    pub respiration_efficiency: f64,
    /// Phase L reverse-engineered physiology: digestive throughput — substrate
    /// processing scored on nanozyme catalysis over a low-misfold cytosol.
    pub digestive_throughput: f64,
    /// Phase L reverse-engineered physiology: excretory clearance — waste
    /// efflux scored on low proteotoxicity and nanopore drainage.
    pub excretory_clearance: f64,
    /// Phase L reverse-engineered physiology: immune surveillance — foreign /
    /// proteotoxic clearance scored on metabolic coupling against viral load.
    pub immune_surveillance: f64,
    /// Phase L reverse-engineered physiology: neural conductance — signal
    /// transmission scored on the electron channel with coherent, parallel
    /// states.
    pub neural_conductance: f64,
    /// Phase L reverse-engineered physiology: musculoskeletal output — generated
    /// force scored on nanoscale contact coupling to molecular-machine work.
    pub musculoskeletal_output: f64,
    /// Phase L reverse-engineered physiology: endocrine signaling — systemic
    /// chemical control scored on ordered occupancy and demon-ordered work.
    pub endocrine_signaling: f64,
    /// Phase L reverse-engineered physiology: thermoregulation control — heat
    /// balance scored as endothermy over the heat-capacity anomaly on a rigid
    /// lattice.
    pub thermoregulation_control: f64,
    /// Phase L reverse-engineered physiology: fluid homeostasis — water / ion
    /// balance scored on colloidal stability against nanotoxic flux.
    pub fluid_homeostasis: f64,
    /// Phase L reverse-engineered physiology: sensory perception —
    /// environmental sensing scored on measurement backaction over expression
    /// noise.
    pub sensory_perception: f64,
    /// Phase L reverse-engineered physiology: growth / replication — anabolic
    /// doubling scored on assembler accuracy over a low-aggregate, high-fidelity
    /// proteome.
    pub growth_replication: f64,
}

/// Engine-side accumulation bucket for the per-tick aggregates.
#[derive(Clone, Copy, Debug, Default)]
pub struct OmicsTotals {
    pub expression_entropy: f64,
    pub transcript_activity: f64,
    pub protein_diversity: f64,
    pub proteome_load: f64,
    pub pathway_flux: f64,
    pub flux_diversity: f64,
    pub regulation_gating: f64,
    pub ec_coupling: f64,
    pub native_fraction: f64,
    pub misfold_load: f64,
    pub fold_stability: f64,
    pub tf_regulation: f64,
    pub env_recognition: f64,
    pub expression_noise: f64,
    pub library_diversity: f64,
    pub chaperone_load: f64,
    pub aggregate_load: f64,
    pub fold_fidelity: f64,
    pub proteotoxicity: f64,
    pub library_coverage: f64,
    pub binding_specificity: f64,
    pub combinatorial_entropy: f64,
    pub decoherence_rate: f64,
    pub coherence_lifetime: f64,
    pub tunneling_rate: f64,
    pub zero_point_energy: f64,
    pub superposition_entropy: f64,
    pub entanglement_entropy: f64,
    pub quantum_parallelism: f64,
    pub measurement_backaction: f64,
    pub collapse_rate: f64,
    pub quantum_diffusion: f64,
    pub tunnel_coupling: f64,
    pub coherence_length: f64,
    pub quantum_fidelity: f64,
    pub boson_field_intensity: f64,
    pub photon_transport: f64,
    pub gluon_confinement: f64,
    pub strong_coupling: f64,
    pub weak_boson_mass: f64,
    pub higgs_mass_floor: f64,
    pub lepton_mobility: f64,
    pub electron_channel: f64,
    pub quark_flavor_population: f64,
    pub up_down_asymmetry: f64,
    pub strange_flavor: f64,
    pub charm_pool: f64,
    pub proton_stability: f64,
    pub lattice_periodicity: f64,
    pub band_gap: f64,
    pub fermi_level: f64,
    pub conduction_band: f64,
    pub valence_band: f64,
    pub phonon_flux: f64,
    pub exciton_binding: f64,
    pub defect_density: f64,
    pub doping_level: f64,
    pub carrier_mobility: f64,
    pub topological_invariant: f64,
    pub moire_superlattice: f64,
    pub lattice_thermal_susceptibility: f64,
    pub boltzmann_entropy: f64,
    pub shannon_dissimilarity: f64,
    pub entropy_change_rate: f64,
    pub gibbs_free_energy: f64,
    pub entropy_production: f64,
    pub time_reversal_asymmetry: f64,
    pub maxwell_demon_power: f64,
    pub demon_information_cost: f64,
    pub absolute_zero_proximity: f64,
    pub quantum_landauer_floor: f64,
    pub heat_capacity_anomaly: f64,
    pub kbt_damping: f64,
    pub canonical_partition_z: f64,
    pub nanoparticle_surface: f64,
    pub nanoparticle_density: f64,
    pub nanopore_transport: f64,
    pub nanoscale_contact: f64,
    pub molecular_machine_work: f64,
    pub assembler_accuracy: f64,
    pub nanofabrication_yield: f64,
    pub dna_origami_stability: f64,
    pub bionano_interface: f64,
    pub nanozyme_activity: f64,
    pub colloidal_stability: f64,
    pub quantum_dot_brightness: f64,
    pub nanotoxic_flux: f64,
    pub viral_load: f64,
    pub bacterial_load: f64,
    pub archaeal_density: f64,
    pub fungal_biomass: f64,
    pub protist_motility: f64,
    pub monera_primordial: f64,
    pub plant_photosynthesis: f64,
    pub poriferan_channel: f64,
    pub chordate_neural_tube: f64,
    pub pisces_aquatic_metabolism: f64,
    pub mammal_thermoregulation: f64,
    pub primate_cognition: f64,
    pub symbiotic_index: f64,
    pub metabolic_rate: f64,
    pub cardiovascular_pump: f64,
    pub respiration_efficiency: f64,
    pub digestive_throughput: f64,
    pub excretory_clearance: f64,
    pub immune_surveillance: f64,
    pub neural_conductance: f64,
    pub musculoskeletal_output: f64,
    pub endocrine_signaling: f64,
    pub thermoregulation_control: f64,
    pub fluid_homeostasis: f64,
    pub sensory_perception: f64,
    pub growth_replication: f64,
}

impl OmicsTotals {
    pub fn add(&mut self, a: &OmicsAgg) {
        self.expression_entropy += a.expression_entropy;
        self.transcript_activity += a.transcript_activity;
        self.protein_diversity += a.protein_diversity;
        self.proteome_load += a.proteome_load;
        self.pathway_flux += a.pathway_flux;
        self.flux_diversity += a.flux_diversity;
        self.regulation_gating += a.regulation_gating;
        self.ec_coupling += a.ec_coupling;
        self.native_fraction += a.native_fraction;
        self.misfold_load += a.misfold_load;
        self.fold_stability += a.fold_stability;
        self.tf_regulation += a.tf_regulation;
        self.env_recognition += a.env_recognition;
        self.expression_noise += a.expression_noise;
        self.library_diversity += a.library_diversity;
        self.chaperone_load += a.chaperone_load;
        self.aggregate_load += a.aggregate_load;
        self.fold_fidelity += a.fold_fidelity;
        self.proteotoxicity += a.proteotoxicity;
        self.library_coverage += a.library_coverage;
        self.binding_specificity += a.binding_specificity;
        self.combinatorial_entropy += a.combinatorial_entropy;
        self.decoherence_rate += a.decoherence_rate;
        self.coherence_lifetime += a.coherence_lifetime;
        self.tunneling_rate += a.tunneling_rate;
        self.zero_point_energy += a.zero_point_energy;
        self.superposition_entropy += a.superposition_entropy;
        self.entanglement_entropy += a.entanglement_entropy;
        self.quantum_parallelism += a.quantum_parallelism;
        self.measurement_backaction += a.measurement_backaction;
        self.collapse_rate += a.collapse_rate;
        self.quantum_diffusion += a.quantum_diffusion;
        self.tunnel_coupling += a.tunnel_coupling;
        self.coherence_length += a.coherence_length;
        self.quantum_fidelity += a.quantum_fidelity;
        self.boson_field_intensity += a.boson_field_intensity;
        self.photon_transport += a.photon_transport;
        self.gluon_confinement += a.gluon_confinement;
        self.strong_coupling += a.strong_coupling;
        self.weak_boson_mass += a.weak_boson_mass;
        self.higgs_mass_floor += a.higgs_mass_floor;
        self.lepton_mobility += a.lepton_mobility;
        self.electron_channel += a.electron_channel;
        self.quark_flavor_population += a.quark_flavor_population;
        self.up_down_asymmetry += a.up_down_asymmetry;
        self.strange_flavor += a.strange_flavor;
        self.charm_pool += a.charm_pool;
        self.proton_stability += a.proton_stability;
        self.lattice_periodicity += a.lattice_periodicity;
        self.band_gap += a.band_gap;
        self.fermi_level += a.fermi_level;
        self.conduction_band += a.conduction_band;
        self.valence_band += a.valence_band;
        self.phonon_flux += a.phonon_flux;
        self.exciton_binding += a.exciton_binding;
        self.defect_density += a.defect_density;
        self.doping_level += a.doping_level;
        self.carrier_mobility += a.carrier_mobility;
        self.topological_invariant += a.topological_invariant;
        self.moire_superlattice += a.moire_superlattice;
        self.lattice_thermal_susceptibility += a.lattice_thermal_susceptibility;
        self.boltzmann_entropy += a.boltzmann_entropy;
        self.shannon_dissimilarity += a.shannon_dissimilarity;
        self.entropy_change_rate += a.entropy_change_rate;
        self.gibbs_free_energy += a.gibbs_free_energy;
        self.entropy_production += a.entropy_production;
        self.time_reversal_asymmetry += a.time_reversal_asymmetry;
        self.maxwell_demon_power += a.maxwell_demon_power;
        self.demon_information_cost += a.demon_information_cost;
        self.absolute_zero_proximity += a.absolute_zero_proximity;
        self.quantum_landauer_floor += a.quantum_landauer_floor;
        self.heat_capacity_anomaly += a.heat_capacity_anomaly;
        self.kbt_damping += a.kbt_damping;
        self.canonical_partition_z += a.canonical_partition_z;
        self.nanoparticle_surface += a.nanoparticle_surface;
        self.nanoparticle_density += a.nanoparticle_density;
        self.nanopore_transport += a.nanopore_transport;
        self.nanoscale_contact += a.nanoscale_contact;
        self.molecular_machine_work += a.molecular_machine_work;
        self.assembler_accuracy += a.assembler_accuracy;
        self.nanofabrication_yield += a.nanofabrication_yield;
        self.dna_origami_stability += a.dna_origami_stability;
        self.bionano_interface += a.bionano_interface;
        self.nanozyme_activity += a.nanozyme_activity;
        self.colloidal_stability += a.colloidal_stability;
        self.quantum_dot_brightness += a.quantum_dot_brightness;
        self.nanotoxic_flux += a.nanotoxic_flux;
        self.viral_load += a.viral_load;
        self.bacterial_load += a.bacterial_load;
        self.archaeal_density += a.archaeal_density;
        self.fungal_biomass += a.fungal_biomass;
        self.protist_motility += a.protist_motility;
        self.monera_primordial += a.monera_primordial;
        self.plant_photosynthesis += a.plant_photosynthesis;
        self.poriferan_channel += a.poriferan_channel;
        self.chordate_neural_tube += a.chordate_neural_tube;
        self.pisces_aquatic_metabolism += a.pisces_aquatic_metabolism;
        self.mammal_thermoregulation += a.mammal_thermoregulation;
        self.primate_cognition += a.primate_cognition;
        self.symbiotic_index += a.symbiotic_index;
        self.metabolic_rate += a.metabolic_rate;
        self.cardiovascular_pump += a.cardiovascular_pump;
        self.respiration_efficiency += a.respiration_efficiency;
        self.digestive_throughput += a.digestive_throughput;
        self.excretory_clearance += a.excretory_clearance;
        self.immune_surveillance += a.immune_surveillance;
        self.neural_conductance += a.neural_conductance;
        self.musculoskeletal_output += a.musculoskeletal_output;
        self.endocrine_signaling += a.endocrine_signaling;
        self.thermoregulation_control += a.thermoregulation_control;
        self.fluid_homeostasis += a.fluid_homeostasis;
        self.sensory_perception += a.sensory_perception;
        self.growth_replication += a.growth_replication;
    }

    pub fn mean(&self, n: f64) -> OmicsAgg {
        let n = n.max(1.0);
        OmicsAgg {
            expression_entropy: self.expression_entropy / n,
            transcript_activity: self.transcript_activity / n,
            protein_diversity: self.protein_diversity / n,
            proteome_load: self.proteome_load / n,
            pathway_flux: self.pathway_flux / n,
            flux_diversity: self.flux_diversity / n,
            regulation_gating: self.regulation_gating / n,
            ec_coupling: self.ec_coupling / n,
            native_fraction: self.native_fraction / n,
            misfold_load: self.misfold_load / n,
            fold_stability: self.fold_stability / n,
            tf_regulation: self.tf_regulation / n,
            env_recognition: self.env_recognition / n,
            expression_noise: self.expression_noise / n,
            library_diversity: self.library_diversity / n,
            chaperone_load: self.chaperone_load / n,
            aggregate_load: self.aggregate_load / n,
            fold_fidelity: self.fold_fidelity / n,
            proteotoxicity: self.proteotoxicity / n,
            library_coverage: self.library_coverage / n,
            binding_specificity: self.binding_specificity / n,
            combinatorial_entropy: self.combinatorial_entropy / n,
            decoherence_rate: self.decoherence_rate / n,
            coherence_lifetime: self.coherence_lifetime / n,
            tunneling_rate: self.tunneling_rate / n,
            zero_point_energy: self.zero_point_energy / n,
            superposition_entropy: self.superposition_entropy / n,
            entanglement_entropy: self.entanglement_entropy / n,
            quantum_parallelism: self.quantum_parallelism / n,
            measurement_backaction: self.measurement_backaction / n,
            collapse_rate: self.collapse_rate / n,
            quantum_diffusion: self.quantum_diffusion / n,
            tunnel_coupling: self.tunnel_coupling / n,
            coherence_length: self.coherence_length / n,
            quantum_fidelity: self.quantum_fidelity / n,
            boson_field_intensity: self.boson_field_intensity / n,
            photon_transport: self.photon_transport / n,
            gluon_confinement: self.gluon_confinement / n,
            strong_coupling: self.strong_coupling / n,
            weak_boson_mass: self.weak_boson_mass / n,
            higgs_mass_floor: self.higgs_mass_floor / n,
            lepton_mobility: self.lepton_mobility / n,
            electron_channel: self.electron_channel / n,
            quark_flavor_population: self.quark_flavor_population / n,
            up_down_asymmetry: self.up_down_asymmetry / n,
            strange_flavor: self.strange_flavor / n,
            charm_pool: self.charm_pool / n,
            proton_stability: self.proton_stability / n,
            lattice_periodicity: self.lattice_periodicity / n,
            band_gap: self.band_gap / n,
            fermi_level: self.fermi_level / n,
            conduction_band: self.conduction_band / n,
            valence_band: self.valence_band / n,
            phonon_flux: self.phonon_flux / n,
            exciton_binding: self.exciton_binding / n,
            defect_density: self.defect_density / n,
            doping_level: self.doping_level / n,
            carrier_mobility: self.carrier_mobility / n,
            topological_invariant: self.topological_invariant / n,
            moire_superlattice: self.moire_superlattice / n,
            lattice_thermal_susceptibility: self.lattice_thermal_susceptibility / n,
            boltzmann_entropy: self.boltzmann_entropy / n,
            shannon_dissimilarity: self.shannon_dissimilarity / n,
            entropy_change_rate: self.entropy_change_rate / n,
            gibbs_free_energy: self.gibbs_free_energy / n,
            entropy_production: self.entropy_production / n,
            time_reversal_asymmetry: self.time_reversal_asymmetry / n,
            maxwell_demon_power: self.maxwell_demon_power / n,
            demon_information_cost: self.demon_information_cost / n,
            absolute_zero_proximity: self.absolute_zero_proximity / n,
            quantum_landauer_floor: self.quantum_landauer_floor / n,
            heat_capacity_anomaly: self.heat_capacity_anomaly / n,
            kbt_damping: self.kbt_damping / n,
            canonical_partition_z: self.canonical_partition_z / n,
            nanoparticle_surface: self.nanoparticle_surface / n,
            nanoparticle_density: self.nanoparticle_density / n,
            nanopore_transport: self.nanopore_transport / n,
            nanoscale_contact: self.nanoscale_contact / n,
            molecular_machine_work: self.molecular_machine_work / n,
            assembler_accuracy: self.assembler_accuracy / n,
            nanofabrication_yield: self.nanofabrication_yield / n,
            dna_origami_stability: self.dna_origami_stability / n,
            bionano_interface: self.bionano_interface / n,
            nanozyme_activity: self.nanozyme_activity / n,
            colloidal_stability: self.colloidal_stability / n,
            quantum_dot_brightness: self.quantum_dot_brightness / n,
            nanotoxic_flux: self.nanotoxic_flux / n,
            viral_load: self.viral_load / n,
            bacterial_load: self.bacterial_load / n,
            archaeal_density: self.archaeal_density / n,
            fungal_biomass: self.fungal_biomass / n,
            protist_motility: self.protist_motility / n,
            monera_primordial: self.monera_primordial / n,
            plant_photosynthesis: self.plant_photosynthesis / n,
            poriferan_channel: self.poriferan_channel / n,
            chordate_neural_tube: self.chordate_neural_tube / n,
            pisces_aquatic_metabolism: self.pisces_aquatic_metabolism / n,
            mammal_thermoregulation: self.mammal_thermoregulation / n,
            primate_cognition: self.primate_cognition / n,
            symbiotic_index: self.symbiotic_index / n,
            metabolic_rate: self.metabolic_rate / n,
            cardiovascular_pump: self.cardiovascular_pump / n,
            respiration_efficiency: self.respiration_efficiency / n,
            digestive_throughput: self.digestive_throughput / n,
            excretory_clearance: self.excretory_clearance / n,
            immune_surveillance: self.immune_surveillance / n,
            neural_conductance: self.neural_conductance / n,
            musculoskeletal_output: self.musculoskeletal_output / n,
            endocrine_signaling: self.endocrine_signaling / n,
            thermoregulation_control: self.thermoregulation_control / n,
            fluid_homeostasis: self.fluid_homeostasis / n,
            sensory_perception: self.sensory_perception / n,
            growth_replication: self.growth_replication / n,
        }
    }
}

fn clamp(v: f64, lo: f64, hi: f64) -> f64 {
    lo.max(v.min(hi))
}

fn clamp01(v: f64) -> f64 {
    clamp(v, 0.0, 1.0)
}

/// Popcount of the low `sig_bits` bits of a u32 (mirrored in omics.ts).
fn popcount_mask(v: u32, sig_bits: u32) -> u32 {
    let mask = if sig_bits >= 32 {
        u32::MAX
    } else {
        (1u32 << sig_bits) - 1
    };
    (v & mask).count_ones()
}

/// Environment signature: quantise six env channels into 2-bit buckets each
/// (12-bit pattern code), mirrored in omics.ts.
fn env_signature(env: &OmicsEnv) -> u32 {
    let bucket = |v: f64| -> u32 {
        let x = clamp01(v) * (OMICS_ENV_BUCKETS as f64 - 1.0);
        let b = (x.round() as i64).clamp(0, OMICS_ENV_BUCKETS as i64 - 1) as u32;
        b
    };
    let mut s: u32 = 0;
    let mut shift: u32 = 0;
    for v in [env.o2, env.food, env.meat, env.toxin, env.water, env.heat] {
        s |= bucket(v) << shift;
        shift += 2;
    }
    s
}

/// FNV-1a fold over the raw f32 bit patterns of four genome genes spread
/// across the genome — a heritable sequence fingerprint per block. Mirrored
/// in omics.ts (little-endian f32 bit reads).
fn block_motif(genome: &[f32], b: usize) -> u32 {
    let idx = |k: usize| -> u32 {
        let i = (k * 7 + b * 11 + 5) % GENOME_SIZE;
        genome.get(i).copied().unwrap_or(0.0).to_bits()
    };
    let mut h: u32 = 0x811c_9dc5;
    for k in 0..4 {
        h = h.wrapping_mul(16777619) ^ idx(k);
    }
    h
}

/// Folding stability from a sequence fingerprint (fold-units, -1..=1).
fn fold_stability(motif: u32) -> f64 {
    let pc = motif.count_ones() as f64 / 32.0;
    pc * 2.0 - 1.0
}

/// Boltzmann native-fraction equilibrium given stability and heat.
fn native_equilibrium(stab: f64, heat: f64) -> f64 {
    let bias = (heat - 0.5) * FOLD_BOLTZMANN;
    let e = ((stab + bias) * OMICS_FOLD_MELT as f64).exp();
    1.0 / (1.0 + e)
}

/// TF binding: sigmoid over the hamming distance (in signature bits) between
/// the regulator's motif and the promoter's signature bits. Mirrored omics.ts.
fn tf_binding(reg_motif: u32, prom_motif: u32) -> f64 {
    let d = popcount_mask(reg_motif ^ prom_motif, OMICS_TF_SIGNATURE_BITS as u32) as f64;
    1.0 / (1.0 + (OMICS_TF_AFFINITY_K as f64 * (d - TF_BIND_MID)).exp())
}

/// Ligate one oligomer library pool from a deterministic molecule pair.
const LIBRARY_PAIRS: [(usize, usize); OMICS_LIBRARY_SIZE] = {
    let mut pairs = [(0usize, 0usize); OMICS_LIBRARY_SIZE];
    let mut k = 0;
    while k < OMICS_LIBRARY_SIZE {
        pairs[k] = (k % MOLECULE_COUNT, (k * 3 + 5) % MOLECULE_COUNT);
        k += 1;
    }
    pairs
};

/// Initial molecular-omics state. Deterministic given the genome and seed;
/// baseline transcripts = 0.5 with a small genome/seed-driven offset.
pub fn create_agent_omics(genome: &[f32], seed: u32) -> AgentOmics {
    let expr_gene = genome.get(DNA_OFFSET + 3).copied().unwrap_or(0.5) as f64;
    let wobble = (seed.rem_euclid(7)) as f64 / 7.0 * 0.15;
    let base = clamp01(0.5 + expr_gene * 0.25 + wobble);
    let mut motifs = Vec::with_capacity(OMICS_PROTEIN_BLOCKS);
    let mut stab = Vec::with_capacity(OMICS_PROTEIN_BLOCKS);
    let mut native = Vec::with_capacity(OMICS_PROTEIN_BLOCKS);
    for b in 0..OMICS_PROTEIN_BLOCKS {
        let m = block_motif(genome, b);
        let s = fold_stability(m);
        motifs.push(m);
        stab.push(s as f32);
        // Start at the folding equilibrium for the default neutral climate.
        native.push(native_equilibrium(s, 0.5) as f32);
    }
    AgentOmics {
        mrna: vec![base as f32; OMICS_MRNA_BLOCKS],
        proteins: vec![0.5; OMICS_PROTEIN_BLOCKS],
        noise: vec![0.0; OMICS_MRNA_BLOCKS],
        stab,
        native,
        misfold: vec![0.0; OMICS_PROTEIN_BLOCKS],
        motifs,
        library: vec![0.0; OMICS_LIBRARY_SIZE],
        env_hist: vec![0; OMICS_ENV_WINDOW],
        agg: vec![0.0; OMICS_PROTEIN_BLOCKS],
        chaperone: 0.0,
    }
}

/// Shannon entropy over a set of non-negative abundances (bits).
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

/// Advance one agent's molecular pools for a tick and return the telemetry.
///
/// Reads `dna.expression` (previously unused beyond a passive drift) and
/// `dna.epigenetic` to drive transcription; reads the chemistry pools (and the
/// enzyme pool + the local environment) to drive translation and flux.  It
/// MUTATES `omics` itself and — Phase B — applies the computed reaction fluxes
/// to `chem.molecules` (consume substrates, produce products).  The DNA,
/// energy and non-target pools are untouched; the fluxome only moves the
/// molecule pools, so the observable computation above stays legible.
pub fn tick_omics(
    omics: &mut AgentOmics,
    genome: &[f32],
    dna: &DnaSystem,
    chem: &mut AgentChemistry,
    env: &OmicsEnv,
    dt: f64,
    seed: u32,
    stochastic: bool,
    combinatorial: bool,
    folding: bool,
) -> OmicsAgg {
    let dna_genes = decode_dna_genes(genome);
    let metab_genes = decode_metab_genes(genome);

    let base_scale = (0.5 + 0.5 * dna_genes.gene_expression) as f64;
    let protein_yield = OMICS_PROTEIN_YIELD as f64 * (0.5 + 0.5 * metab_genes.protein_metab);

    // Environment signals (inducible/repressible transcription).
    let o2_s = clamp01(env.o2);
    let food_s = clamp01(env.food);
    let meat_s = clamp01(env.meat);
    let tox_s = clamp01(env.toxin);
    let ph_mod = (1.0 - (env.ph - PH_NEUTRAL as f64).abs() / PH_RANGE as f64).max(0.1);
    let heat = clamp01(env.heat);
    let atp_frac = clamp01(
        chem.molecules.first().map(|m| *m as f64).unwrap_or(0.0) / CHEM_MAX_MOLECULE as f64,
    );

    let n_t = OMICS_MRNA_BLOCKS;
    let n_p = OMICS_PROTEIN_BLOCKS;

    // ---- Pattern recognition: environment signature + classification --------
    // Quantise the current env channels into a 12-bit pattern code and keep a
    // rolling window of the recent signatures.  Blocks whose motif fingerprint
    // matches the current code are induced (environment pattern recognition).
    let env_sig = env_signature(env);
    omics.env_hist.push(env_sig);
    if omics.env_hist.len() > OMICS_ENV_WINDOW {
        omics.env_hist.remove(0);
    }
    let env_affinity = |motif: u32| -> f64 {
        1.0 - popcount_mask(motif ^ env_sig, OMICS_TF_SIGNATURE_BITS as u32) as f64
            / OMICS_TF_SIGNATURE_BITS as f64
    };

    // ---- Translation (proteomics) + folding stability landscape ------------
    // New protein partitions into native (functional) and misfolded fractions;
    // the native fraction relaxes toward its Boltzmann equilibrium and carries
    // an optional folding-entropy OU (stochastic folding).  The total pool
    // keeps the Phase B dynamics; misfold is a faster-decaying view of the
    // same increment.  Phase D (WorldConfig.folding) adds per-block aggregation
    // of misfolded protein (seeded proportionally to the misfold, amplified by
    // existing aggregate — a proteinopathy cascade) which the chaperone pass
    // below dissolves back toward native.
    let mut total_prot = 0.0f64;
    let mut total_mis = 0.0f64;
    for b in 0..n_p {
        total_prot += omics.proteins.get(b).copied().unwrap_or(0.0) as f64;
        total_mis += omics.misfold.get(b).copied().unwrap_or(0.0) as f64;
    }
    let misfold_pre = total_mis / (total_prot + 1e-9);
    let upr = clamp01((misfold_pre - OMICS_UPR_THRESHOLD as f64) / OMICS_UPR_THRESHOLD as f64);
    let upr_damp = 1.0 / (1.0 + OMICS_UPR_GAIN as f64 * upr);
    // Phase D: the aggregate load also feeds the UPR (aggregation is toxic).
    let mut agg_sum_pre = 0.0f64;
    for b in 0..n_p {
        agg_sum_pre += omics.agg.get(b).copied().unwrap_or(0.0) as f64;
    }
    let agg_frac_pre = agg_sum_pre / n_p as f64;
    let upr_damp = if folding {
        let agg_upr =
            clamp01((agg_frac_pre - OMICS_AGG_THRESHOLD as f64) / OMICS_AGG_THRESHOLD as f64);
        1.0 / (1.0 + OMICS_UPR_GAIN as f64 * (upr + agg_upr))
    } else {
        upr_damp
    };

    // Stochastic draws (per-block OU process).  When the flag is off no RNG is
    // consumed, keeping the deterministic core bit-stable.
    let mut rng = SplitMix64::new(seed as u64);
    let mut noise_mean = 0.0f64;
    let mut tf_reg_sum = 0.0f64;
    let mut env_rec_sum = 0.0f64;
    let mut nat_sum = 0.0f64;
    let mut mis_sum = 0.0f64;
    let mut nat_eq_sum = 0.0f64;
    let mut agg_sum = 0.0f64;

    // ---- Transcription (transcriptomics) ---------------------------------
    let mut synth = [0.0f64; 24];
    for b in 0..n_t {
        let sig_b = match b {
            0 => 0.3 + 0.7 * o2_s,                  // oxidase: O2-inducible
            1 => 0.3 + 0.5 * food_s + 0.2 * meat_s, // synthase: fed / amino-acid rich
            2 => 0.3 + 0.5 * (1.0 - food_s),        // hydrolase: catabolic, hunger-gated
            3 => 0.3 + 0.5 * food_s,                // ligase: anabolic, fed
            4 => 0.3 + 0.5 * food_s + 0.2 * o2_s,   // polymerase: growth, well-fed
            5 => 0.3 + 0.5 * (1.0 - food_s),        // lyase: gluconeogenesis under scarcity
            _ => 0.5 + 0.25 * food_s + 0.25 * o2_s,
        };
        let sig = clamp01(sig_b);
        let epi_gate =
            1.0 - (dna.epigenetic.get(b).copied().unwrap_or(0.0) as f64) * OMICS_EPI_SILENCE as f64;
        let base = dna.expression.get(b).copied().unwrap_or(0.5) as f64;
        let env_factor = (0.6 + OMICS_ENV_INDUCTION as f64 * sig)
            * (1.0 - tox_s * 0.5)
            * (0.7 + 0.3 * clamp01(env.water));

        // Stochastic gene expression: per-block OU noise into the transcription
        // rate.  Identical genomes diverge cell-to-cell (per-seed reproducible).
        if stochastic {
            let nb = omics.noise.get(b).copied().unwrap_or(0.0) as f64;
            let g = rng.next_gaussian64();
            let no = clamp(
                nb + (0.0 - nb) * OMICS_NOISE_THETA as f64 * dt
                    + OMICS_NOISE_SIGMA as f64 * dt.sqrt() * g,
                -1.0,
                1.0,
            );
            omics.noise[b] = no as f32;
            noise_mean += no.abs();
        }

        // Combinatorial TF-promoter logic: two regulators gate the promoter
        // through OR / AND / NOT by block index, weighted by regulator native
        // abundance and motif<>promoter binding affinity.
        let r1 = (b * 3 + 1 + 5) % 24;
        let r2 = (b * 5 + 2 + 5) % 24;
        let m_b = omics.motifs.get(b).copied().unwrap_or(0);
        let b1 = tf_binding(omics.motifs.get(r1).copied().unwrap_or(0), m_b)
            * omics.native.get(r1).copied().unwrap_or(0.0) as f64;
        let b2 = tf_binding(omics.motifs.get(r2).copied().unwrap_or(0), m_b)
            * omics.native.get(r2).copied().unwrap_or(0.0) as f64;
        let gate = match b % 3 {
            0 => 1.0 - (1.0 - b1) * (1.0 - b2), // OR
            1 => b1 * b2,                       // AND
            _ => 1.0 - 0.5 * (b1 + b2),         // NOT regulator pair
        };
        let reg_factor =
            OMICS_TF_REG_MIN as f64 + (OMICS_TF_REG_MAX - OMICS_TF_REG_MIN) as f64 * clamp01(gate);
        tf_reg_sum += reg_factor;

        // Environment pattern recognition: induced when the block's fingerprint
        // matches the current environment signature.
        let env_aff = env_affinity(m_b);
        let env_mod = 0.7 + 1.3 * env_aff;
        env_rec_sum += env_aff;

        let noise_mod = if stochastic {
            clamp(
                1.0 + 2.0 * OMICS_NOISE_GAIN as f64 * omics.noise[b] as f64,
                0.1,
                3.0,
            )
        } else {
            1.0
        };

        let s = OMICS_TRANSCRIBE_BASE as f64
            * base
            * epi_gate
            * env_factor
            * base_scale
            * reg_factor
            * env_mod
            * upr_damp
            * noise_mod
            * dt;
        synth[b] = s;
        let old = omics.mrna[b] as f64;
        omics.mrna[b] = clamp(old + s - old * OMICS_MRNA_DECAY as f64 * dt, 0.0, 1.0) as f32;
    }

    // ---- Translation (proteomics) + folding stability landscape ------------
    // New protein partitions into native (functional) and misfolded fractions;
    // the native fraction relaxes toward its Boltzmann equilibrium and carries
    // an optional folding-entropy OU (stochastic folding).  The total pool
    // keeps the Phase B dynamics; misfold is a faster-decaying view of the
    // same increment.
    for b in 0..n_p {
        let m = omics.mrna[b] as f64;
        let old = omics.proteins[b] as f64;
        let prot_new = clamp(
            old + m * protein_yield * dt - old * OMICS_PROTEIN_DECAY as f64 * dt,
            0.0,
            1.0,
        );
        omics.proteins[b] = prot_new as f32;

        let stab = omics.stab.get(b).copied().unwrap_or(0.0) as f64;
        let nat_eq = native_equilibrium(stab, heat);
        let nat_cur = omics.native.get(b).copied().unwrap_or(0.0) as f64;
        let mut nat_tgt = nat_cur + (nat_eq - nat_cur) * OMICS_FOLD_RATE as f64 * dt;
        if stochastic {
            let g = rng.next_gaussian64();
            nat_tgt += g * FOLD_NOISE_SCALE * dt.sqrt();
        }
        let nat_tgt = clamp01(nat_tgt);
        let dm = m * protein_yield * dt;
        let add_nat = dm * nat_tgt;
        let add_mis = dm * (1.0 - nat_tgt);
        let nat_next = clamp(
            nat_cur + add_nat - nat_cur * OMICS_PROTEIN_DECAY as f64 * dt,
            0.0,
            1.0,
        );
        let mis_cur = omics.misfold.get(b).copied().unwrap_or(0.0) as f64;
        let mis_next = clamp(
            mis_cur + add_mis - mis_cur * OMICS_MISFOLD_DECAY as f64 * dt,
            0.0,
            1.0,
        );
        // Phase D aggregate seeding: misfolded protein aggregates at a rate
        // amplified by any existing aggregate (proteinopathy cascade).
        let agg_cur = omics.agg.get(b).copied().unwrap_or(0.0) as f64;
        let agg_next = if folding {
            let cascade =
                1.0 + OMICS_CASCADE_GAIN as f64 * clamp01(agg_cur - OMICS_AGG_THRESHOLD as f64);
            clamp(
                agg_cur + mis_next * OMICS_AGG_SEED as f64 * dt * cascade
                    - agg_cur * OMICS_AGG_DISSOLVE as f64 * dt,
                0.0,
                1.0,
            )
        } else {
            agg_cur
        };
        omics.agg[b] = agg_next as f32;
        agg_sum += agg_next;
        omics.native[b] = nat_next as f32;
        omics.misfold[b] = mis_next as f32;
        nat_sum += nat_next;
        mis_sum += mis_next;
        nat_eq_sum += nat_eq;
    }

    // ---- Phase D: chaperone-mediated folding (WorldConfig.folding) --------
    // A cell-level chaperone capacity refolds misfolded protein first, then
    // dissolves aggregates, crediting both back to the native fractions and
    // renormalising the load metrics. It only reorganises the fold state (no
    // energy / pool mutation), so the fluxome and energy balance are untouched.
    let chap_load = if folding {
        let chap_eff = OMICS_CHAP_RATE as f64 * dt * atp_frac * (1.0 - omics.chaperone as f64);
        let refold_mis = mis_sum.min(chap_eff * 0.5);
        let refold_agg = agg_sum.min(chap_eff * 0.5);
        let work = refold_mis + refold_agg;
        if chap_eff > 0.0 {
            let inv_mis = if mis_sum > 1e-12 { 1.0 / mis_sum } else { 0.0 };
            let inv_agg = if agg_sum > 1e-12 { 1.0 / agg_sum } else { 0.0 };
            for b in 0..n_p {
                let mb = omics.misfold.get(b).copied().unwrap_or(0.0) as f64;
                let ab = omics.agg.get(b).copied().unwrap_or(0.0) as f64;
                let dmis = mb * refold_mis * inv_mis;
                let dagg = ab * refold_agg * inv_agg;
                omics.misfold[b] = (mb - dmis) as f32;
                omics.agg[b] = (ab - dagg) as f32;
                omics.native[b] = clamp01(omics.native[b] as f64 + dmis + dagg) as f32;
                nat_sum += dmis + dagg;
                mis_sum -= dmis;
                agg_sum -= dagg;
            }
            (work / chap_eff).min(1.0)
        } else {
            0.0
        }
    } else {
        0.0
    };
    omics.chaperone = chap_load as f32;

    // ---- Fluxomics ---------------------------------------------------------
    // Reactions indexed by enzyme type. substrate drive = mass-action over its
    // reactant pool(s); cofactor gate = O2 / ATP / hunger / diet / none.  The
    // catalyst is the NATIVE (folded) protein + the enzyme pool.
    let mol = &chem.molecules;
    let mol_at = |i: usize| mol.get(i).copied().unwrap_or(0.0) as f64;
    let drive = |a: usize, b: Option<usize>| {
        let v = match b {
            Some(b) => mol_at(a).min(mol_at(b)),
            None => mol_at(a),
        };
        clamp01(v / 10.0)
    };
    let mut flux = [0.0f64; 6];
    let mut total_flux = 0.0f64;
    for i in 0..OMICS_REACTION_COUNT.min(6) {
        let catalyst = clamp01(
            0.5 * omics.native[i] as f64
                + 0.5
                    * (chem.enzymes.get(i).copied().unwrap_or(0.0) as f64 / CHEM_MAX_ENZYME as f64),
        );
        let (sub_a, sub_b, cofactor) = match i {
            0 => (9, None, o2_s),                                    // oxidase: sugar + O2
            1 => (2, None, 1.0), // synthase: amino acid -> protein
            2 => (6, None, if atp_frac < 0.2 { 1.0 } else { 0.35 }), // hydrolase hunger gate
            3 => (10, None, atp_frac), // ligase: fatty acid + ATP -> lipid
            4 => (0, Some(4), atp_frac * 0.8), // polymerase: monomer + nucleotide
            5 => (0, None, 1.0 - food_s * 0.7), // lyase: glucose -> sugar + fat
            _ => unreachable!(),
        };
        let f = OMICS_FLUX_SCALE as f64 * catalyst * drive(sub_a, sub_b) * cofactor * ph_mod * dt;
        flux[i] = f;
        total_flux += f;
    }

    // ---- Combinatorial library chemistry --------------------------------
    // An oligomer library ligated from molecule-pair pools, screened by the
    // natively-folded catalyst fraction (folding-dependent combinatorial
    // exploration of the molecular pool space).  Phase D adds a pairwise
    // binding-configuration *selection* loop: binders whose pair affinity is
    // weak are depleted, strong ones are replenished — the library becomes a
    // combinatorial search solved against the folded proteome.
    let (mut library_coverage, mut binding_specificity, mut combinatorial_entropy) =
        (0.0f64, 0.0f64, 0.0f64);
    if combinatorial {
        let mut screen = 0.0f64;
        for i in 0..ENZYME_TYPE_COUNT.min(6) {
            screen += omics.native.get(i).copied().unwrap_or(0.0) as f64;
        }
        screen /= ENZYME_TYPE_COUNT.min(6) as f64;
        let molm = &mut chem.molecules;
        let mut affs = [0.0f64; OMICS_LIBRARY_SIZE];
        let mut covered = 0usize;
        let mut aff_sum = 0.0f64;
        for k in 0..OMICS_LIBRARY_SIZE {
            let (i, j) = LIBRARY_PAIRS[k];
            let av = clamp01(molm.get(i).copied().unwrap_or(0.0) as f64 / 10.0)
                * clamp01(molm.get(j).copied().unwrap_or(0.0) as f64 / 10.0);
            let lig = OMICS_LIBRARY_LIGATE as f64 * av * screen * dt;
            molm[i] = (molm[i] as f64 - lig).max(0.0) as f32;
            molm[j] = (molm[j] as f64 - lig).max(0.0) as f32;
            let old = omics.library.get(k).copied().unwrap_or(0.0) as f64;
            let mut lib_new = clamp(
                old + lig - old * OMICS_LIBRARY_DECAY as f64 * dt,
                0.0,
                OMICS_LIBRARY_MAX as f64,
            );
            // Pairwise binding affinity of this library species (its folded
            // catalyst pair) drives the selection pressure.
            let ni = omics.native.get(i).copied().unwrap_or(0.0) as f64;
            let nj = omics.native.get(j).copied().unwrap_or(0.0) as f64;
            let aff = clamp01(ni) * clamp01(nj);
            affs[k] = aff;
            aff_sum += aff;
            if aff < OMICS_BIND_WEAK as f64 {
                lib_new = (lib_new
                    - OMICS_SELECT_RATE as f64 * dt * (OMICS_BIND_WEAK as f64 - aff))
                    .max(0.0);
            } else if aff >= OMICS_BIND_STRONG as f64 {
                lib_new = clamp(
                    lib_new + OMICS_SELECT_RATE as f64 * dt * (aff - OMICS_BIND_STRONG as f64),
                    0.0,
                    OMICS_LIBRARY_MAX as f64,
                );
            }
            if lib_new > 0.01 {
                covered += 1;
            }
            omics.library[k] = lib_new as f32;
        }
        let mean_aff = aff_sum / OMICS_LIBRARY_SIZE as f64;
        let mut dev = 0.0f64;
        for &a in &affs {
            dev += (a - mean_aff).abs();
        }
        library_coverage = covered as f64 / OMICS_LIBRARY_SIZE as f64;
        binding_specificity = dev / OMICS_LIBRARY_SIZE as f64;
        combinatorial_entropy = shannon_bits(affs.iter().copied());
    }

    // ---- Interactomics aggregates ------------------------------------------
    let expression_entropy = shannon_bits(omics.mrna.iter().map(|&v| v as f64));
    let transcript_activity = synth.iter().sum::<f64>() / n_t as f64;
    let protein_h = shannon_bits(omics.proteins.iter().map(|&v| v as f64));
    let protein_diversity = if protein_h > 0.0 {
        protein_h.exp()
    } else {
        1.0
    };
    let proteome_load = omics.proteins.iter().map(|&v| v as f64).sum::<f64>() / n_p as f64;
    let native_fraction = nat_sum / n_p as f64;
    let misfold_load = mis_sum / n_p as f64;
    let fold_stability = nat_eq_sum / n_p as f64;
    let tf_regulation = tf_reg_sum / n_t as f64;
    let env_recognition = env_rec_sum / n_t as f64;
    let expression_noise = if stochastic {
        noise_mean / n_t as f64
    } else {
        0.0
    };

    // regulation gating: 1 - fraction of transcription silenced by marks
    let mut silence = 0.0f64;
    for b in 0..n_t {
        silence +=
            (dna.epigenetic.get(b).copied().unwrap_or(0.0) as f64) * OMICS_EPI_SILENCE as f64;
    }
    let regulation_gating = 1.0 - silence / n_t as f64;

    // proteome <-> enzyme coupling: cosine similarity of the NATIVE catalyst
    // blocks to the enzyme pool.
    let mut cp = 0.0f64;
    let mut up = 0.0f64;
    let mut ue = 0.0f64;
    for i in 0..ENZYME_TYPE_COUNT {
        let p = omics.native.get(i).copied().unwrap_or(0.0) as f64;
        let e = chem.enzymes.get(i).copied().unwrap_or(0.0) as f64 / CHEM_MAX_ENZYME as f64;
        cp += p * e;
        up += p * p;
        ue += e * e;
    }
    let ec_coupling = if up > 1e-9 && ue > 1e-9 {
        cp / (up.sqrt() * ue.sqrt())
    } else {
        0.0
    };

    // Phase D folding-fidelity & toxicity metrics (post-chaperone sums).
    let fold_total = nat_sum + mis_sum + agg_sum + 1e-9;
    let fold_fidelity = nat_sum / fold_total;
    let aggregate_load = agg_sum / n_p as f64;
    let proteotoxicity =
        clamp01((mis_sum + 2.0 * agg_sum) / (n_p as f64 * OMICS_AGG_THRESHOLD as f64));

    // ---- Phase E: quantum observables ------------------------------------
    // Macroscopic-quantum reading of the SAME fold-cluster pools Phase D
    // accumulates: the native/misfold/aggregate occupancy is treated as a
    // genuine superposition, and every observable below is derived from the
    // pool geometry and folding physics computed above (never a stub).
    let decoherence_rate = clamp01(0.45 * heat + 0.35 * proteotoxicity + 0.20 * expression_noise);
    let coherence_lifetime =
        clamp01(fold_fidelity * (1.0 - decoherence_rate) * (0.6 + 0.4 * chap_load));
    let tunneling_barrier =
        (2.0 * (1.0 - ec_coupling) + 1.5 * misfold_load + 0.5 * (1.0 - library_coverage)).max(0.0);
    let tunneling_rate = clamp01((-tunneling_barrier).exp());
    let zero_point_energy = clamp01(0.6 * (1.0 - fold_stability) + 0.4 * proteotoxicity);
    let superposition_entropy = shannon_bits([nat_sum, mis_sum, agg_sum]);
    let entanglement_entropy =
        clamp01((expression_entropy / n_t as f64) * (misfold_load + aggregate_load) * 4.0);
    let quantum_parallelism =
        clamp01((protein_diversity / n_p as f64) * fold_fidelity * (0.5 + 0.5 * library_coverage));
    let measurement_backaction =
        clamp01(0.5 * (binding_specificity + (1.0 - fold_fidelity)) + 0.25 * expression_noise);
    let collapse_rate = clamp01(1.0 - superposition_entropy / 3.0f64.log2());
    let quantum_diffusion = clamp01(
        0.75 * shannon_bits(flux.iter().copied()) / (OMICS_REACTION_COUNT as f64).log2()
            + 0.25 * heat * expression_noise,
    );
    let tunnel_coupling = clamp01(
        0.4 * ec_coupling
            + 0.3 * (total_flux / (OMICS_FLUX_SCALE as f64 * OMICS_REACTION_COUNT as f64)).min(1.0)
            + 0.3 * native_fraction,
    );
    let coherence_length = clamp01(fold_fidelity * (0.4 + 0.6 * library_coverage));
    let quantum_fidelity =
        clamp01(native_fraction) * (1.0 - decoherence_rate) * (1.0 - 0.5 * aggregate_load);

    // ---- Phase G subatomic layer ------------------------------------------
    // Subatomic reading of the SAME fold-cluster pools Phase D/Phase E already
    // accumulate: every observable below maps boson / lepton / quark
    // phenomenology onto the real chemistry and quantum aggregates computed
    // above (never stubs).  `photon_transport`, `gluon_confinement` and
    // `quark_flavor_population` additionally feed forward into `apply_fluxome`
    // as the Phase-G chemistry couplings (EM channel / strong binding / flavor
    // population).
    //   Boson sector (strength, transport, confinement, coupling, masses):
    //   the field intensity rides the enzyme coupling and native yield; the
    //   photon current is dephasing-attenuated jitter energy blended with flux;
    //   glue follows binder fitness and innate toxicity; the strong scale lifts
    //   with folded fidelity; W/Z masses come from the zero-point curvature and
    //   the Higgs floor from the unfolded vacuum fraction.
    let boson_field_intensity = clamp01(0.6 * ec_coupling + 0.4 * native_fraction);
    let photon_transport = clamp01(
        0.7 * clamp01(1.0 - decoherence_rate) * clamp01(heat * expression_noise)
            + 0.3 * (total_flux / (OMICS_FLUX_SCALE as f64 * OMICS_REACTION_COUNT as f64)).min(1.0),
    );
    let gluon_confinement = clamp01(binding_specificity * fold_fidelity + 0.4 * proteotoxicity);
    let strong_coupling = clamp01(0.7 * fold_fidelity + 0.3 * native_fraction);
    let weak_boson_mass = clamp01(zero_point_energy * (1.0 - 0.5 * collapse_rate));
    let higgs_mass_floor = clamp01((1.0 - fold_stability) * 0.5 + 0.5 * zero_point_energy);
    //   Lepton sector (mobility, electron channel): charged channels run on the
    //   transcript/protein occupancy entropy per log2 species, fused with the
    //   un-aggregated capacity; the oxidative electron carrier combines enzyme
    //   coupling with the EM photon transport.
    let lepton_mobility = clamp01(
        0.25 * expression_entropy / (n_t as f64).log2()
            + 0.25 * protein_h / (n_p as f64).log2()
            + 0.5 * (1.0 - aggregate_load),
    );
    let electron_channel = clamp01(0.5 * ec_coupling + 0.5 * photon_transport);
    //   Quark sector (flavor occupancy, charge asymmetry, mixing, heavy states,
    //   composite stability): flavor fills the library slots against the
    //   combinatorial binding entropy; up/down asymmetry balances specificity
    //   against misfold load; strangeness mixes the coherent and tunneling
    //   channels; charm weights the excited fold states; the proton floor is the
    //   un-aggregated load scaled by the surviving coherence.
    let library_h = shannon_bits(omics.library.iter().map(|&v| v as f64));
    let quark_flavor_population =
        clamp01(0.5 * library_h / (OMICS_LIBRARY_SIZE as f64).log2() + 0.5 * combinatorial_entropy);
    let up_down_asymmetry = clamp01(0.5 + 0.5 * (binding_specificity - misfold_load));
    let strange_flavor =
        clamp01(0.4 * coherence_lifetime + 0.6 * tunnel_coupling * (1.0 - collapse_rate));
    let charm_pool = clamp01(0.3 * zero_point_energy + 0.7 * superposition_entropy / 3.0f64.log2());
    let proton_stability = clamp01((1.0 - aggregate_load) * (1.0 - 0.5 * decoherence_rate));

    // ---- Phase H quantum-materials layer -----------------------------------
    // Condensed-matter reading of the SAME fold-cluster pools Phase D/E/G
    // already accumulate: atom/particle ordering (lattice periodicity), band
    // theory (gap, Fermi level, conduction/valence occupancy), phonon energy
    // transport, defect disorder, doping, carrier mobility, topological bulk
    // order, the two-period moire interference and the thermal susceptibility
    // of the ordered phase — every observable maps condensed-matter physics
    // onto the real chemistry and quantum aggregates computed above (never
    // stubs).  `lattice_periodicity`, `doping_level` and `carrier_mobility`
    // additionally feed forward into `apply_fluxome` as the Phase-H chemistry
    // couplings (periodic-lattice anabolic yield / doped conductive
    // leakage-recovery / carrier energy escape).
    let lattice_periodicity =
        clamp01((0.5 * fold_fidelity + 0.5 * native_fraction) * (1.0 - 0.5 * aggregate_load));
    let band_gap = clamp01((1.0 - lepton_mobility) * (0.5 + 0.5 * zero_point_energy));
    let fermi_level = clamp01(0.6 * native_fraction + 0.4 * (1.0 - aggregate_load));
    let conduction_band =
        clamp01(0.4 * electron_channel + 0.6 * expression_noise * (1.0 - band_gap));
    let valence_band = clamp01(0.5 * binding_specificity + 0.5 * (1.0 - electron_channel));
    let phonon_flux = clamp01(0.6 * clamp01(heat * lepton_mobility) + 0.4 * tunnel_coupling);
    let exciton_binding =
        clamp01(binding_specificity * photon_transport * (1.0 - decoherence_rate));
    let defect_density = clamp01(0.5 * misfold_load + 0.5 * aggregate_load);
    let doping_level = clamp01(0.5 * strange_flavor + 0.5 * charm_pool);
    let carrier_mobility =
        clamp01(electron_channel * (1.0 - defect_density) * (0.5 + 0.5 * coherence_lifetime));
    let topological_invariant = clamp01(
        (0.5 * quantum_parallelism + 0.5 * (1.0 - strange_flavor)) * (1.0 - 0.25 * collapse_rate),
    );
    let moire_superlattice =
        clamp01(0.5 * superposition_entropy / 3.0f64.log2() + 0.5 * library_coverage);
    let lattice_thermal_susceptibility = clamp01((1.0 - heat) * lattice_periodicity);

    // ---- Phase I statistical mechanics & information theory ----------------
    // Thermodynamics + information reading of the SAME fold-cluster pools
    // Phase D/E/G/H accumulate: Boltzmann/Shannon entropies, dS production,
    // the Maxwell's-demon sorting output and its Landauer information cost,
    // the absolute-zero limit and the kT damping of the ordered phase — every
    // observable maps statistical physics onto the real chemistry and quantum
    // aggregates computed above (never stubs).  `maxwell_demon_power`,
    // `absolute_zero_proximity` and `kbt_damping` additionally feed forward
    // into `apply_fluxome` as the Phase-I chemistry couplings (demon sorting /
    // cryogenic ATP preservation / thermal degradation cost).
    let boltzmann_entropy = clamp01(
        0.7 * shannon_bits(omics.proteins.iter().map(|&v| v as f64)) / (n_p as f64).log2()
            + 0.3 * (1.0 - native_fraction),
    );
    let shannon_dissimilarity =
        clamp01((expression_entropy - protein_h).abs() / (n_p as f64).log2());
    let entropy_change_rate =
        clamp01(0.5 * shannon_dissimilarity + 0.5 * clamp01(heat * expression_noise));
    let gibbs_free_energy = clamp01((1.0 - heat) * fold_fidelity * (1.0 - 0.4 * aggregate_load));
    let entropy_production =
        clamp01(0.4 * misfold_load + 0.4 * aggregate_load + 0.2 * decoherence_rate);
    let time_reversal_asymmetry = clamp01(0.5 * entropy_change_rate + 0.5 * decoherence_rate);
    let maxwell_demon_power = clamp01(
        measurement_backaction * (1.0 - decoherence_rate) * (0.5 + 0.5 * lattice_periodicity),
    );
    let demon_information_cost =
        clamp01(0.4 * superposition_entropy / 3.0f64.log2() + 0.6 * expression_noise);
    // absolute_zero_proximity depends on entropy_production -> define after it.
    let absolute_zero_proximity = clamp01((1.0 - heat) * (1.0 - 0.5 * entropy_production));
    let quantum_landauer_floor = clamp01((1.0 - quantum_fidelity) * (0.5 + 0.5 * heat));
    let heat_capacity_anomaly = clamp01((1.0 - (fold_fidelity - fermi_level).abs()) * (1.0 - heat));
    let kbt_damping = clamp01(heat * (1.0 - lattice_periodicity));
    let canonical_partition_z = clamp01(
        0.6 * shannon_bits(flux.iter().copied()) / (OMICS_REACTION_COUNT as f64).log2()
            + 0.4 * (1.0 - aggregate_load),
    );
    // Phase J nanosystems: nanochemistry / nanobiology / nanosystems /
    // nanoparticles — the dispersed crystallite RESTRIPPED surfaces, the
    // molecular assembler and the intra-cell therapeutic delivery lane —
    // every observable maps nanometer-scale engineering onto the real pools
    // and quantum/materials aggregates above (never stubs).
    // `nanoparticle_surface`, `assembler_accuracy` and `colloidal_stability`
    // additionally feed forward into `apply_fluxome` as the Phase-J chemistry
    // couplings (reaction-surface catalysis / assembler protein yield /
    // colloid delivery preservation).
    let nanoparticle_surface =
        clamp01((1.0 - lattice_thermal_susceptibility) * (1.0 - 0.4 * absolute_zero_proximity));
    let nanoparticle_density = clamp01((0.5 + 0.5 * heat) * (0.5 + 0.5 * nanoparticle_surface));
    let nanopore_transport = clamp01(
        (0.5 + 0.5 * electron_channel) * (1.0 - defect_density) * (1.0 - 0.4 * kbt_damping),
    );
    let nanoscale_contact = clamp01(
        (1.0 - (band_gap * fermi_level - topological_invariant).abs()) * (0.5 + 0.5 * heat),
    );
    let molecular_machine_work =
        clamp01(maxwell_demon_power * (0.5 + 0.5 * superposition_entropy) * (0.3 + 0.7 * heat));
    let assembler_accuracy = clamp01((0.7 - fold_fidelity) + 0.5 * (1.0 - expression_noise));
    let nanofabrication_yield =
        clamp01(0.5 * (fold_fidelity - aggregate_load) + 0.5 * (1.0 - proteotoxicity));
    let dna_origami_stability = clamp01(
        lattice_thermal_susceptibility * (1.0 - 0.3 * expression_noise) - 0.2 * kbt_damping + 0.35,
    );
    let bionano_interface =
        clamp01((0.6 * native_fraction + 0.4 * nanoparticle_surface) * fold_fidelity);
    // nanozyme_activity depends on electron_channel and binding_specificity
    // (both defined in earlier phases) -> fall-through order is safe here.
    let nanozyme_activity =
        clamp01((0.5 + 0.5 * electron_channel) * (0.5 + 0.5 * binding_specificity) * (1.0 - heat));
    let colloidal_stability = clamp01(
        (1.0 - misfold_load - aggregate_load)
            * (1.0 - 0.5 * canonical_partition_z)
            * (0.7 + 0.3 * (1.0 - proteotoxicity)),
    );
    let quantum_dot_brightness = clamp01(
        colloidal_stability
            * (0.5 + 0.5 * quantum_parallelism)
            * (1.0 - heat)
            * lattice_periodicity,
    );
    let nanotoxic_flux = clamp01(
        nanoparticle_density
            * (0.5 + 0.5 * (1.0 - canonical_partition_z))
            * (1.0 - 0.5 * (proteotoxicity * misfold_load)),
    );
    // Phase K reverse-engineered phylogeny: score each lineage as a REAL
    // signature of the same fold-cluster, quantum, materials and statistical
    // aggregates above — virus, bacteria, archaea, fungi, protists, monera,
    // plants, animals from porifera up through chordates, pisces and mammals
    // to (toward) humans, plus the cross-taxa symbiotic coupling signal.
    // `viral_load`, `symbiotic_index` and `mammal_thermoregulation`
    // additionally feed forward into `apply_fluxome` as the Phase-K chemistry
    // couplings (lytic amino-acid release / symbiotic cooperativity / warm-blood
    // oxidative throughput).
    let viral_load = clamp01(
        (1.0 - fold_fidelity) * (0.5 + 0.5 * expression_noise) * (0.5 + 0.5 * decoherence_rate),
    );
    let bacterial_load =
        clamp01((1.0 - lattice_periodicity) * (0.5 + 0.5 * heat) * (0.6 + 0.4 * expression_noise));
    let archaeal_density =
        clamp01((0.5 + 0.5 * heat) * (1.0 - 0.5 * misfold_load) * (0.5 + 0.5 * native_fraction));
    let fungal_biomass =
        clamp01(lattice_periodicity * (0.5 + 0.5 * heat) * (1.0 - 0.4 * aggregate_load));
    let protist_motility =
        clamp01((0.5 + 0.5 * carrier_mobility) * (0.5 + 0.5 * heat) * (1.0 - lattice_periodicity));
    let monera_primordial = clamp01(
        (1.0 - fold_fidelity) * (1.0 - canonical_partition_z) * (0.5 + 0.5 * photon_transport),
    );
    let plant_photosynthesis =
        clamp01(photon_transport * electron_channel * (1.0 - heat) * lattice_periodicity);
    let poriferan_channel =
        clamp01(nanopore_transport * (0.5 + 0.5 * photon_transport) * (1.0 - heat));
    let chordate_neural_tube = clamp01(
        measurement_backaction * (1.0 - decoherence_rate) * (0.5 + 0.5 * quantum_parallelism),
    );
    let pisces_aquatic_metabolism =
        clamp01((1.0 - heat) * (0.5 + 0.5 * carrier_mobility) * (1.0 - 0.3 * entropy_production));
    let mammal_thermoregulation =
        clamp01(heat * (0.5 + 0.5 * fold_fidelity) * (0.5 + 0.5 * quantum_fidelity));
    let primate_cognition = clamp01(
        (0.5 + 0.5 * maxwell_demon_power)
            * (0.5 + 0.5 * quantum_parallelism)
            * (0.3 + 0.7 * fold_fidelity),
    );
    let symbiotic_index =
        clamp01(native_fraction * (0.5 + 0.5 * ec_coupling) * (1.0 - 0.5 * misfold_load));
    // Phase L reverse-engineered physiology: score each physiological system as
    // a REAL aggregate over the same pools and the phylogeny / quantum /
    // materials / statistical / nanosystems readings above — metabolism,
    // circulation, respiration, digestion, excretion, immunity, neural control,
    // musculoskeletal work, endocrine signalling, thermoregulation, fluid
    // balance, sensation and growth/replication (never stubs).
    // `metabolic_rate`, `digestive_throughput` and `immune_surveillance`
    // additionally feed forward into `apply_fluxome` as the Phase-L chemistry
    // couplings (anabolic drive / hydrolytic throughput / membrane defence).
    let metabolic_rate = clamp01((0.5 + 0.5 * heat) * (1.0 - 0.5 * entropy_production));
    let cardiovascular_pump =
        clamp01((0.5 + 0.5 * carrier_mobility) * (0.5 + 0.5 * nanopore_transport));
    let respiration_efficiency =
        clamp01(photon_transport * (0.5 + 0.5 * quantum_fidelity) * (1.0 - 0.3 * aggregate_load));
    let digestive_throughput =
        clamp01((0.5 + 0.5 * nanozyme_activity) * (1.0 - 0.4 * misfold_load) * (0.5 + 0.5 * heat));
    let excretory_clearance = clamp01(
        (1.0 - proteotoxicity) * (1.0 - 0.5 * aggregate_load) * (0.5 + 0.5 * nanopore_transport),
    );
    let immune_surveillance =
        clamp01((0.5 + 0.5 * ec_coupling) * (1.0 - viral_load) * (1.0 - 0.5 * proteotoxicity));
    let neural_conductance = clamp01(
        (0.5 + 0.5 * electron_channel)
            * (1.0 - decoherence_rate)
            * (0.5 + 0.5 * quantum_parallelism),
    );
    let musculoskeletal_output = clamp01(
        (0.5 + 0.5 * nanoscale_contact) * (0.5 + 0.5 * molecular_machine_work) * (0.3 + 0.7 * heat),
    );
    let endocrine_signaling =
        clamp01((0.5 + 0.5 * canonical_partition_z) * (0.5 + 0.5 * maxwell_demon_power));
    let thermoregulation_control = clamp01(
        mammal_thermoregulation
            * (1.0 - heat_capacity_anomaly)
            * (0.5 + 0.5 * lattice_thermal_susceptibility),
    );
    let fluid_homeostasis = clamp01(
        colloidal_stability * (0.5 + 0.5 * canonical_partition_z) * (1.0 - 0.4 * nanotoxic_flux),
    );
    let sensory_perception =
        clamp01(measurement_backaction * (1.0 - expression_noise) * (0.5 + 0.5 * quantum_fidelity));
    let growth_replication =
        clamp01((0.5 + 0.5 * assembler_accuracy) * (1.0 - 0.5 * aggregate_load) * fold_fidelity);

    let agg = OmicsAgg {
        expression_entropy,
        transcript_activity,
        protein_diversity,
        proteome_load,
        pathway_flux: total_flux,
        flux_diversity: shannon_bits(flux.iter().copied()),
        regulation_gating,
        ec_coupling,
        native_fraction,
        misfold_load,
        fold_stability,
        tf_regulation,
        env_recognition,
        expression_noise,
        library_diversity: shannon_bits(omics.library.iter().map(|&v| v as f64)),
        chaperone_load: chap_load,
        aggregate_load,
        fold_fidelity,
        proteotoxicity,
        library_coverage,
        binding_specificity,
        combinatorial_entropy,
        decoherence_rate,
        coherence_lifetime,
        tunneling_rate,
        zero_point_energy,
        superposition_entropy,
        entanglement_entropy,
        quantum_parallelism,
        measurement_backaction,
        collapse_rate,
        quantum_diffusion,
        tunnel_coupling,
        coherence_length,
        quantum_fidelity,
        boson_field_intensity,
        photon_transport,
        gluon_confinement,
        strong_coupling,
        weak_boson_mass,
        higgs_mass_floor,
        lepton_mobility,
        electron_channel,
        quark_flavor_population,
        up_down_asymmetry,
        strange_flavor,
        charm_pool,
        proton_stability,
        lattice_periodicity,
        band_gap,
        fermi_level,
        conduction_band,
        valence_band,
        phonon_flux,
        exciton_binding,
        defect_density,
        doping_level,
        carrier_mobility,
        topological_invariant,
        moire_superlattice,
        lattice_thermal_susceptibility,
        boltzmann_entropy,
        shannon_dissimilarity,
        entropy_change_rate,
        gibbs_free_energy,
        entropy_production,
        time_reversal_asymmetry,
        maxwell_demon_power,
        demon_information_cost,
        absolute_zero_proximity,
        quantum_landauer_floor,
        heat_capacity_anomaly,
        kbt_damping,
        canonical_partition_z,
        nanoparticle_surface,
        nanoparticle_density,
        nanopore_transport,
        nanoscale_contact,
        molecular_machine_work,
        assembler_accuracy,
        nanofabrication_yield,
        dna_origami_stability,
        bionano_interface,
        nanozyme_activity,
        colloidal_stability,
        quantum_dot_brightness,
        nanotoxic_flux,
        viral_load,
        bacterial_load,
        archaeal_density,
        fungal_biomass,
        protist_motility,
        monera_primordial,
        plant_photosynthesis,
        poriferan_channel,
        chordate_neural_tube,
        pisces_aquatic_metabolism,
        mammal_thermoregulation,
        primate_cognition,
        symbiotic_index,
        metabolic_rate,
        cardiovascular_pump,
        respiration_efficiency,
        digestive_throughput,
        excretory_clearance,
        immune_surveillance,
        neural_conductance,
        musculoskeletal_output,
        endocrine_signaling,
        thermoregulation_control,
        fluid_homeostasis,
        sensory_perception,
        growth_replication,
    };

    // Phase B active fluxome: apply the computed fluxes back onto the pools.
    // Phase E: the quantum gate (fidelity / tunneling / decoherence) perturbs
    // how much of that flux actually lands until the pools, so the quantum
    // lane is not just telemetry — it materially shifts chemistry.
    apply_fluxome(
        chem,
        &flux,
        quantum_fidelity,
        tunnel_coupling,
        decoherence_rate,
        zero_point_energy,
        coherence_lifetime,
        measurement_backaction,
        photon_transport,
        gluon_confinement,
        quark_flavor_population,
        lattice_periodicity,
        doping_level,
        carrier_mobility,
        maxwell_demon_power,
        absolute_zero_proximity,
        kbt_damping,
        assembler_accuracy,
        nanoparticle_surface,
        colloidal_stability,
        viral_load,
        symbiotic_index,
        mammal_thermoregulation,
        metabolic_rate,
        digestive_throughput,
        immune_surveillance,
    );

    agg
}

/// Phase B (+ Phase E quantum gate): apply the (already computed) reaction
/// fluxes to the molecule pools — consume the substrate(s) of each reaction
/// and credit its product(s).  Every mutation mirrors the legacy chemistry
/// clamp style (subtracts floor at 0, adds cap at CHEM_MAX_MOLECULE) and
/// stores f32.  The topology mirrors `tick_agent_chemistry`:
///   R0 oxidase       sugar[9]        -> ATP[1]
///   R1 synthase      amino_acid[2]   -> protein[6]
///   R2 hydrolase     protein[6]      -> amino_acid[2] + ATP[1] (catabolic)
///   R3 ligase        fatty_acid[10]  - ATP[1] -> lipid[3]
///   R4 polymerase    glucose[0] + nucleotide[4] -> protein[6]
///   R5 lyase         glucose[0]      -> fatty_acid[10] + sugar[9]
///
/// The three Phase-E quantum scalars couple into the chemistry: the coherent
/// catalytic power `fidelity` scales every anabolic yield (half weight, so a
/// zero-fidelity agent still catalyses at 0.5x), `tunnel` adds a quantum-
/// escape yield boost on product formation, and `decoherence` taxes the
/// catabolic energy-recovery step (incoherent energy is lost to the
/// environment instead of crediting ATP).
///
/// Phase-F deepening adds three more real couplings.  The zero-point energy
/// well-shift `zpe` deepens the ground state under the anabolic wells, so the
/// polymerase/ligase escape bonus (their product credits) is suppressed for a
/// high-ZPE agent.  The coherence lifetime `coherence` gates the folding
/// kinetics: a coherent enzyme-state survives misfolding more often, boosting
/// the hydrolase and lyase product credits.  The measurement backaction `drag`
/// disturbs the pools under readout, taxing the catabolic ATP-energy recovery
/// in the oxidase and hydrolase channels.
///
/// Phase-G subatomic layer adds three more real couplings threaded from the
/// subatomic observables at the call site: the electromagnetic strength
/// `photons` boosts the R0 oxidase ATP credit (`em`), the strong binding
/// `gluons` gates the R3 ligase lipid credit and the R4 polymerase protein
/// credit (`strong`, half-weight so a null-gluon agent still ligates at 0.5x),
/// and the flavor population `quarks` raises the R5 lyase product credits
/// (`flavor`).  R1 and R2 are untouched by the subatomic layer.
///
/// Phase-H quantum-materials layer adds three more real couplings threaded from
/// the materials observables at the call site: the lattice periodicity
/// `periodicity` stabilises long-range product formation (its `band` scalar
/// scales the R1 synthase and R4 polymerase protein credits), the impurity
/// doping `doping` boosts the conductive leakage-recovery (its `doping` scalar
/// scales the R2 hydrolase amino-acid credit and the R5 lyase fatty-acid
/// credit), and the carrier mobility `mobility` lets energy escape the lattice
/// sooner (its `mob` scalar taxes the R0 oxidase ATP credit).  R3 is untouched
/// by the materials layer.
///
/// Phase-I statistical-mechanics / information-theory layer adds three more
/// real couplings threaded from the thermodynamic observables at the call
/// site: the Maxwell's-demon sorting output `demon_ordering` boosts the R1
/// synthase protein credit (its `demon` scalar — demon-sorted order is
/// crystallised into product), the absolute-zero proximity `abs_zero` preserves
/// ATP effort near the frozen limit (its `cryo` scalar boosts the R0 oxidase
/// ATP credit), and the kT damping `kbt` taxes the thermal-catabolic recovery
/// of the ordered phase (its `thermal` scalar taxes the R2 hydrolase
/// amino-acid credit).  R3-R5 keep their existing scalars unmodified.
fn apply_fluxome(
    chem: &mut AgentChemistry,
    flux: &[f64; 6],
    fidelity: f64,
    tunnel: f64,
    decoherence: f64,
    zpe: f64,            // zero-point energy (0..1)
    coherence: f64,      // coherence lifetime (0..1)
    backaction: f64,     // measurement backaction (0..1)
    photons: f64,        // photon transport / EM channel (0..1)
    gluons: f64,         // gluon confinement / strong binding (0..1)
    quarks: f64,         // quark flavor population (0..1)
    periodicity: f64,    // lattice periodicity (0..1)
    doping: f64,         // doping level (0..1)
    mobility: f64,       // carrier mobility (0..1)
    demon_ordering: f64, // maxwell demon sorting output (0..1)
    abs_zero: f64,       // absolute-zero proximity (0..1)
    kbt: f64,            // kT damping agitation (0..1)
    assembler: f64,      // assembler accuracy (0..1)
    surface: f64,        // nanoparticle surface area (0..1)
    colloid_disp: f64,   // colloidal stability (0..1)
    viral_pressure: f64, // viral-load lytic pressure (0..1)
    symbiont: f64,       // symbiotic cooperation index (0..1)
    warm: f64,           // endotherm thermoregulation (0..1)
    metabolic: f64,      // basal metabolic drive (0..1)
    digestive: f64,      // digestive throughput (0..1)
    defense: f64,        // immune surveillance (0..1)
) {
    let mol = &mut chem.molecules;
    let y = OMICS_FLUX_YIELD as f64;
    let s = OMICS_FLUX_SPLIT as f64;
    let cat = OMICS_FLUX_CATABOLIC_BONUS as f64;
    let lig = OMICS_FLUX_LIGASE_COST as f64;
    let max_mol = CHEM_MAX_MOLECULE as f64;
    let gate = 0.5 + 0.5 * clamp01(fidelity);
    let boost = 1.0 + clamp01(tunnel) * QUANTUM_TUNNEL_BOOST;
    let loss = 1.0 - clamp01(decoherence) * QUANTUM_DECOHE_LOSS;
    let well = 1.0 - 0.25 * clamp01(zpe);
    let kin = 0.6 + 0.4 * clamp01(coherence);
    let drag = 1.0 - 0.35 * clamp01(backaction);
    let em = 1.0 + 0.3 * clamp01(photons);
    let strong = 0.5 + 0.5 * clamp01(gluons);
    let flavor = 1.0 + 0.25 * clamp01(quarks);
    let band = 0.5 + 0.5 * clamp01(periodicity);
    let doping = 1.0 + 0.3 * clamp01(doping);
    let mob = 1.0 - 0.3 * clamp01(mobility);
    let demon = 1.0 + 0.35 * clamp01(demon_ordering);
    let cryo = 1.0 + 0.3 * clamp01(abs_zero);
    let thermal = 1.0 - 0.4 * clamp01(kbt);
    let nano = 1.0 + 0.3 * clamp01(assembler);
    let surface_area = 1.0 + 0.25 * clamp01(surface);
    let colloid = 1.0 + 0.3 * clamp01(colloid_disp);
    let viral = 1.0 + 0.3 * clamp01(viral_pressure);
    let symbiosis = 1.0 + 0.35 * clamp01(symbiont);
    let thermo = 1.0 + 0.25 * clamp01(warm);
    let drive = 1.0 + 0.3 * clamp01(metabolic);
    let digest = 1.0 + 0.25 * clamp01(digestive);
    let shield = 1.0 + 0.35 * clamp01(defense);
    macro_rules! bleed {
        ($i:expr, $d:expr) => {
            mol[$i] = (mol[$i] as f64 - $d).max(0.0) as f32
        };
    }
    macro_rules! feed {
        ($i:expr, $d:expr) => {
            mol[$i] = (mol[$i] as f64 + $d).min(max_mol) as f32
        };
    }
    // R0: oxidase consumes sugar, credits ATP.
    let f = flux[0];
    bleed!(9, f);
    feed!(
        1,
        f * y * gate * boost * drag * em * mob * cryo * surface_area * thermo * drive
    );
    // R1: synthase consumes amino acid, credits protein.
    let f = flux[1];
    bleed!(2, f);
    feed!(6, f * y * gate * boost * band * demon * nano);
    // R2: hydrolase consumes protein, credits amino acid + ATP.
    let f = flux[2];
    bleed!(6, f);
    feed!(
        2,
        f * y * gate * kin * doping * thermal * colloid * viral * digest
    );
    feed!(1, f * cat * loss * boost * kin * drag);
    // R3: ligase consumes fatty acid + ATP, credits lipid.
    let f = flux[3];
    bleed!(10, f);
    bleed!(1, f * lig);
    feed!(3, f * y * gate * boost * well * strong * shield);
    // R4: polymerase consumes glucose + nucleotide, credits protein.
    let f = flux[4];
    bleed!(0, f * s);
    bleed!(4, f * s);
    feed!(
        6,
        f * y * s * gate * boost * well * strong * band * symbiosis
    );
    // R5: lyase consumes glucose, credits fatty acid + sugar.
    let f = flux[5];
    bleed!(0, f);
    feed!(10, f * s * boost * kin * flavor * doping);
    feed!(9, f * s * boost * kin * flavor);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn genome() -> Vec<f32> {
        vec![0.5; GENOME_SIZE]
    }

    fn dna_of(expr: f32, epi: f32) -> DnaSystem {
        DnaSystem {
            integrity: 1.0,
            damage_accum: 0.0,
            expression: vec![expr; 24],
            total_errors: 0,
            total_repairs: 0,
            epigenetic: vec![epi; 24],
        }
    }

    fn chem_of(molecules: f32, enzymes: f32) -> AgentChemistry {
        AgentChemistry {
            elements: vec![0.0; ELEMENT_COUNT],
            molecules: vec![molecules; MOLECULE_COUNT],
            ions: vec![0.0; ION_COUNT],
            enzymes: vec![enzymes; ENZYME_TYPE_COUNT],
            ph: PH_NEUTRAL as f64,
        }
    }

    fn tick(
        o: &mut AgentOmics,
        genome: &[f32],
        dna: &DnaSystem,
        chem: &mut AgentChemistry,
        env: &OmicsEnv,
        dt: f64,
    ) -> OmicsAgg {
        tick_omics(o, genome, dna, chem, env, dt, 1, false, false, false)
    }

    #[test]
    fn creation_is_size_consistent() {
        let o = create_agent_omics(&genome(), 42);
        assert_eq!(o.mrna.len(), OMICS_MRNA_BLOCKS);
        assert_eq!(o.proteins.len(), OMICS_PROTEIN_BLOCKS);
        assert_eq!(o.noise.len(), OMICS_MRNA_BLOCKS);
        assert_eq!(o.stab.len(), OMICS_PROTEIN_BLOCKS);
        assert_eq!(o.native.len(), OMICS_PROTEIN_BLOCKS);
        assert_eq!(o.misfold.len(), OMICS_PROTEIN_BLOCKS);
        assert_eq!(o.motifs.len(), OMICS_PROTEIN_BLOCKS);
        assert_eq!(o.library.len(), OMICS_LIBRARY_SIZE);
        assert_eq!(
            o.env_hist.len(),
            OMICS_ENV_WINDOW,
            "rolling env history starts zero-filled"
        );
        // native starts at the folding equilibrium for the neutral climate
        assert!(o.native.iter().all(|&v| (0.0..=1.0).contains(&v)));
    }

    #[test]
    fn motifs_are_heritable_fingerprints() {
        let spread: Vec<f32> = (0..GENOME_SIZE)
            .map(|i| (i as f32 * 0.618_f32).sin() * 0.9)
            .collect();
        let a = create_agent_omics(&spread, 1);
        let b = create_agent_omics(&spread, 1);
        assert_eq!(a.motifs, b.motifs, "same genome -> same fingerprints");
        // distinct blocks have distinct fingerprints (spread genome sampling)
        let distinct = a.motifs.iter().collect::<std::collections::HashSet<_>>();
        assert!(
            distinct.len() > 1,
            "blocks must diverge in sequence fingerprint"
        );
        // a genome edit changes the fingerprint of at least one block
        let mut g = spread;
        g[5] = 0.9;
        let c = create_agent_omics(&g, 1);
        assert!(
            a.motifs != c.motifs,
            "sequence edits must alter folding/regulation"
        );
    }

    #[test]
    fn expression_drives_transcription() {
        let dna = dna_of(1.0, 0.0);
        let mut o = create_agent_omics(&genome(), 1);
        let agg = tick(
            &mut o,
            &genome(),
            &dna,
            &mut chem_of(0.0, 0.0),
            &OmicsEnv::default(),
            1.0,
        );
        assert!(
            agg.transcript_activity > 0.03,
            "high expression -> high mrna synth"
        );
        assert!(o.mrna.iter().all(|&v| (0.0..=1.0).contains(&v)));
        assert!(agg.tf_regulation >= OMICS_TF_REG_MIN as f64 - 1e-6);
        assert!(agg.tf_regulation <= OMICS_TF_REG_MAX as f64 + 1e-6);
    }

    #[test]
    fn epigenetic_marks_silence_their_block() {
        let env = OmicsEnv {
            food: 0.5,
            o2: 0.5,
            ..OmicsEnv::default()
        };
        let mut chem = chem_of(10.0, 5.0);
        let mut a = create_agent_omics(&genome(), 1);
        let g_un = tick(&mut a, &genome(), &dna_of(0.8, 0.0), &mut chem, &env, 1.0);
        let mut b = create_agent_omics(&genome(), 1);
        let g_ma = tick(&mut b, &genome(), &dna_of(0.8, 1.0), &mut chem, &env, 1.0);
        assert!(
            g_un.regulation_gating > g_ma.regulation_gating,
            "marks gate transcription"
        );
        assert!(
            g_ma.regulation_gating < 0.999,
            "fully marked blocks are silenced"
        );
        // marked agent accumulates less mrna
        let sum_un: f64 = a.mrna.iter().map(|&v| v as f64).sum();
        let sum_ma: f64 = b.mrna.iter().map(|&v| v as f64).sum();
        assert!(sum_un > sum_ma, "silencing lowers the transcriptome");
    }

    #[test]
    fn fluxomics_follows_substrates_and_catalysts() {
        let env = OmicsEnv {
            o2: 0.8,
            food: 0.5,
            ..OmicsEnv::default()
        };
        let dna = dna_of(1.0, 0.0);
        let mut chem = chem_of(30.0, 10.0);
        let mut o = create_agent_omics(&genome(), 1);
        for _ in 0..60 {
            tick(&mut o, &genome(), &dna, &mut chem, &env, 0.05);
        }
        assert!(o.proteins[0] > 0.3, "catalysts accumulate from mrna");
        let agg = tick(&mut o, &genome(), &dna, &mut chem, &env, 1.0);
        assert!(agg.pathway_flux > 0.0, "substrate-rich pools should flux");
        assert!((0.0..=10.0f64.log2()).contains(&agg.flux_diversity));
        assert!(agg.native_fraction > 0.0, "native fraction is positive");
        assert!(
            agg.ec_coupling > 0.001,
            "folded catalysts couple to the enzyme pool"
        );
    }

    #[test]
    fn empty_pools_give_zero_flux() {
        let mut o = create_agent_omics(&genome(), 1);
        let agg = tick(
            &mut o,
            &genome(),
            &dna_of(0.5, 0.0),
            &mut chem_of(0.0, 0.0),
            &OmicsEnv::default(),
            1.0,
        );
        assert_eq!(agg.pathway_flux, 0.0);
        assert_eq!(agg.flux_diversity, 0.0);
        assert_eq!(agg.ec_coupling, 0.0, "no enzymes -> no coupling");
    }

    #[test]
    fn active_fluxome_moves_pools() {
        let env = OmicsEnv {
            o2: 0.8,
            food: 0.5,
            ..OmicsEnv::default()
        };
        let dna = dna_of(1.0, 0.0);
        let start = 50.0f32;
        let mut chem = chem_of(start, 10.0);
        let mut o = create_agent_omics(&genome(), 1);
        for _ in 0..120 {
            tick(&mut o, &genome(), &dna, &mut chem, &env, 1.0);
        }
        let mol = &chem.molecules;
        assert!(mol[9] < start, "oxidase consumes sugar, got {}", mol[9]);
        assert!(
            mol[0] < start,
            "lyase/polymerase consume glucose, got {}",
            mol[0]
        );
        assert!(
            mol[6] > start,
            "synthase/polymerase build protein, got {}",
            mol[6]
        );
        assert!(mol[3] > start, "ligase builds lipid, got {}", mol[3]);
        // ATP is both drained (ligase) and credited (oxidase/hydrolase) -> bounded.
        assert!(
            (0.0..=CHEM_MAX_MOLECULE as f32).contains(&mol[1]),
            "ATP stays bounded"
        );
        for (i, &v) in mol.iter().enumerate() {
            assert!(
                (0.0..=CHEM_MAX_MOLECULE as f32).contains(&v),
                "pool {i} bounded, got {v}"
            );
        }
    }

    #[test]
    fn deterministic_core_repeated_calls() {
        let env = OmicsEnv {
            o2: 0.6,
            food: 0.4,
            ..OmicsEnv::default()
        };
        let dna = dna_of(0.7, 0.2);
        let mut chem_a = chem_of(12.0, 5.0);
        let mut chem_b = chem_of(12.0, 5.0);
        let mut a = create_agent_omics(&genome(), 1);
        let mut b = create_agent_omics(&genome(), 1);
        let ga = tick(&mut a, &genome(), &dna, &mut chem_a, &env, 0.5);
        let gb = tick(&mut b, &genome(), &dna, &mut chem_b, &env, 0.5);
        assert_eq!(a.mrna, b.mrna);
        assert_eq!(a.proteins, b.proteins);
        assert_eq!(a.native, b.native);
        assert_eq!(a.misfold, b.misfold);
        assert_eq!(
            chem_a.molecules, chem_b.molecules,
            "fluxome must be deterministic"
        );
        assert_eq!(ga.proteome_load, gb.proteome_load);
        // the stochastic flag must not leak into the deterministic core
        assert_eq!(ga.expression_noise, 0.0);
    }

    #[test]
    fn stochastic_expression_and_folding_noise() {
        let env = OmicsEnv {
            o2: 0.6,
            food: 0.4,
            ..OmicsEnv::default()
        };
        let dna = dna_of(1.0, 0.0);
        let seed = 7u32;
        let mut a = create_agent_omics(&genome(), 1);
        let mut b = create_agent_omics(&genome(), 1);
        let mut c = create_agent_omics(&genome(), 1);
        let ga = tick_omics(
            &mut a,
            &genome(),
            &dna,
            &mut chem_of(20.0, 5.0),
            &env,
            1.0,
            seed,
            true,
            false,
            false,
        );
        let _gb = tick_omics(
            &mut b,
            &genome(),
            &dna,
            &mut chem_of(20.0, 5.0),
            &env,
            1.0,
            seed,
            true,
            false,
            false,
        );
        assert_eq!(a.noise, b.noise, "same seed -> same stochastic draws");
        assert_eq!(a.native, b.native);
        assert!(
            ga.expression_noise > 0.0,
            "stochastic flag adds expression noise"
        );
        let gdet = tick_omics(
            &mut c,
            &genome(),
            &dna,
            &mut chem_of(20.0, 5.0),
            &env,
            1.0,
            seed,
            false,
            false,
            false,
        );
        assert_eq!(
            gdet.expression_noise, 0.0,
            "deterministic core has no noise"
        );
        assert!(
            a.noise.iter().any(|&v| v != 0.0),
            "noise state mutated with flag on"
        );
        assert!(
            c.noise.iter().all(|&v| v == 0.0),
            "noise state untouched without flag"
        );
    }

    #[test]
    fn folding_stability_tracks_sequence() {
        // a uniformly-unstable genome (high popcount) folds worse than a
        // uniformly-stable one; native fraction follows the per-block stability.
        let heat = 0.5f64;
        let eq_s = native_equilibrium(-1.0, heat);
        let eq_u = native_equilibrium(1.0, heat);
        assert!(
            eq_s > 0.8,
            "stable sequences should fold well, got {}",
            eq_s
        );
        assert!(
            eq_u < 0.2,
            "unstable sequences should misfold, got {}",
            eq_u
        );
    }

    #[test]
    fn upr_damps_transcription_under_misfold_load() {
        let env = OmicsEnv {
            o2: 0.6,
            food: 0.4,
            ..OmicsEnv::default()
        };
        let dna = dna_of(1.0, 0.0);
        let mut chem = chem_of(30.0, 10.0);
        let mut o = create_agent_omics(&genome(), 1);
        // Push the misfolded fraction across the UPR threshold.
        for b in 0..OMICS_PROTEIN_BLOCKS {
            o.proteins[b] = 1.0;
            o.misfold[b] = 0.5;
        }
        let agg = tick(&mut o, &genome(), &dna, &mut chem, &env, 1.0);
        assert!(
            agg.misfold_load > OMICS_UPR_THRESHOLD as f64,
            "misfold load above threshold"
        );
        // transcription collapses vs an healthy twin at the same conditions
        let mut h = create_agent_omics(&genome(), 1);
        for b in 0..OMICS_PROTEIN_BLOCKS {
            h.proteins[b] = 1.0;
        }
        let agg_h = tick(&mut h, &genome(), &dna, &mut chem_of(30.0, 10.0), &env, 1.0);
        assert!(
            agg_h.transcript_activity > agg.transcript_activity,
            "UPR damps transcription"
        );
        assert!(
            agg_h.native_fraction > agg.native_fraction,
            "healthy twin folds better"
        );
    }

    #[test]
    fn environment_patterns_classify() {
        let env_a = OmicsEnv {
            o2: 0.9,
            food: 0.8,
            water: 0.2,
            ..OmicsEnv::default()
        };
        let envsam = OmicsEnv {
            o2: 0.9,
            food: 0.8,
            water: 0.2,
            ..OmicsEnv::default()
        };
        assert_eq!(env_signature(&env_a), env_signature(&envsam));
        let env_b = OmicsEnv {
            o2: 0.1,
            food: 0.1,
            water: 0.9,
            ..OmicsEnv::default()
        };
        assert_ne!(
            env_signature(&env_a),
            env_signature(&env_b),
            "distinct env patterns differ"
        );
        // agent keeps a bounded rolling window of past signatures
        let mut o = create_agent_omics(&genome(), 1);
        let dna = dna_of(0.7, 0.0);
        let mut chem = chem_of(10.0, 5.0);
        for _ in 0..30 {
            tick_omics(
                &mut o,
                &genome(),
                &dna,
                &mut chem,
                &env_a,
                0.5,
                1,
                false,
                false,
                false,
            );
        }
        assert!(
            o.env_hist.len() <= OMICS_ENV_WINDOW,
            "env history stays bounded"
        );
    }

    #[test]
    fn combinatorial_library_ligates_and_screens() {
        let env = OmicsEnv {
            o2: 0.6,
            food: 0.4,
            ..OmicsEnv::default()
        };
        let dna = dna_of(1.0, 0.0);
        let mut chem = chem_of(30.0, 10.0);
        let mut o = create_agent_omics(&genome(), 1);
        for _ in 0..60 {
            tick_omics(
                &mut o,
                &genome(),
                &dna,
                &mut chem,
                &env,
                1.0,
                1,
                false,
                true,
                false,
            );
        }
        let total: f64 = o.library.iter().map(|&v| v as f64).sum();
        assert!(
            total > 0.0,
            "substrate-rich pools should ligate oligomers, got {}",
            total
        );
        assert!(o
            .library
            .iter()
            .all(|&v| v >= 0.0 && v <= OMICS_LIBRARY_MAX as f32));
        // deterministic core: library untouched when the flag is off
        let mut d = create_agent_omics(&genome(), 1);
        let mut dchem = chem_of(30.0, 10.0);
        for _ in 0..60 {
            tick_omics(
                &mut d,
                &genome(),
                &dna,
                &mut dchem,
                &env,
                1.0,
                1,
                false,
                false,
                false,
            );
        }
        assert!(
            d.library.iter().all(|&v| v == 0.0),
            "library gated behind the flag"
        );
    }

    #[test]
    fn folding_mechanics_seed_aggregates_and_run_chaperones() {
        let env = OmicsEnv {
            o2: 0.6,
            food: 0.4,
            ..OmicsEnv::default()
        };
        let dna = dna_of(1.0, 0.0);
        let mut chem = chem_of(30.0, 10.0);
        let mut fold = create_agent_omics(&genome(), 1);
        for b in 0..OMICS_PROTEIN_BLOCKS {
            fold.proteins[b] = 1.0;
            fold.misfold[b] = 0.6;
        }
        let agg = tick_omics(
            &mut fold,
            &genome(),
            &dna,
            &mut chem,
            &env,
            1.0,
            1,
            false,
            false,
            true,
        );
        assert!(
            fold.agg.iter().any(|&v| v > 0.0),
            "misfold seeds aggregates"
        );
        assert!(agg.aggregate_load > 0.0);
        assert!(agg.chaperone_load >= 0.0);
        assert!((0.0..=1.0).contains(&agg.fold_fidelity));
        assert!((0.0..=1.0).contains(&agg.proteotoxicity));
        // without the flag: no aggregate state, no chaperone use
        let mut plain = create_agent_omics(&genome(), 1);
        for b in 0..OMICS_PROTEIN_BLOCKS {
            plain.proteins[b] = 1.0;
            plain.misfold[b] = 0.6;
        }
        let agg_p = tick_omics(
            &mut plain,
            &genome(),
            &dna,
            &mut chem_of(30.0, 10.0),
            &env,
            1.0,
            1,
            false,
            false,
            false,
        );
        assert!(
            plain.agg.iter().all(|&v| v == 0.0),
            "no aggregates without folding flag"
        );
        assert_eq!(plain.chaperone, 0.0);
        assert_eq!(agg_p.chaperone_load, 0.0);
        assert_eq!(agg_p.aggregate_load, 0.0);
    }

    #[test]
    fn combinatorial_selection_keeps_and_spreads_affinity() {
        let env = OmicsEnv {
            o2: 0.6,
            food: 0.4,
            ..OmicsEnv::default()
        };
        let dna = dna_of(1.0, 0.0);
        let mut chem = chem_of(30.0, 10.0);
        let mut o = create_agent_omics(&genome(), 1);
        let mut any_specificity = false;
        let mut any_coverage = false;
        for _ in 0..120 {
            let a = tick_omics(
                &mut o,
                &genome(),
                &dna,
                &mut chem,
                &env,
                1.0,
                1,
                false,
                true,
                false,
            );
            if a.binding_specificity > 0.0 {
                any_specificity = true;
            }
            if a.library_coverage > 0.0 {
                any_coverage = true;
            }
        }
        assert!(any_coverage, "substrate-rich pools occupy library species");
        assert!(
            any_specificity,
            "pairwise affinity spread -> specificity > 0"
        );
        assert!(o
            .library
            .iter()
            .all(|&v| v >= 0.0 && v <= OMICS_LIBRARY_MAX as f32));
        // without the flag the metrics stay zero
        let mut d = create_agent_omics(&genome(), 1);
        let mut dchem = chem_of(30.0, 10.0);
        let a0 = tick_omics(
            &mut d,
            &genome(),
            &dna,
            &mut dchem,
            &env,
            1.0,
            1,
            false,
            false,
            false,
        );
        assert_eq!(a0.library_coverage, 0.0);
        assert_eq!(a0.binding_specificity, 0.0);
        assert_eq!(a0.combinatorial_entropy, 0.0);
    }

    #[test]
    fn quantum_observables_accumulate_and_mean() {
        let env = OmicsEnv {
            o2: 0.6,
            food: 0.4,
            ..OmicsEnv::default()
        };
        let dna = dna_of(1.0, 0.0);
        let mut chem = chem_of(30.0, 10.0);
        let mut o = create_agent_omics(&genome(), 1);
        for _ in 0..60 {
            tick_omics(
                &mut o,
                &genome(),
                &dna,
                &mut chem,
                &env,
                1.0,
                1,
                true,
                true,
                true,
            );
        }
        let a = tick_omics(
            &mut o,
            &genome(),
            &dna,
            &mut chem,
            &env,
            1.0,
            1,
            true,
            true,
            true,
        );
        // every phase-E quantum observable is a genuine computed aggregate.
        assert!(
            a.decoherence_rate > 0.0 && a.decoherence_rate <= 1.0,
            "heat drives decoherence"
        );
        assert!(a.coherence_lifetime > 0.0 && a.coherence_lifetime <= 1.0);
        assert!(a.tunneling_rate > 0.0 && a.tunneling_rate <= 1.0);
        assert!(a.zero_point_energy > 0.0 && a.zero_point_energy <= 1.0);
        assert!(
            a.superposition_entropy > 0.0,
            "fold occupancy superposition is live"
        );
        assert!(a.quantum_parallelism > 0.0);
        assert!(a.measurement_backaction >= 0.0 && a.measurement_backaction <= 1.0);
        assert!(a.collapse_rate >= 0.0 && a.collapse_rate <= 1.0);
        assert!(a.quantum_diffusion >= 0.0 && a.quantum_diffusion <= 1.0);
        assert!(a.tunnel_coupling >= 0.0 && a.tunnel_coupling <= 1.0);
        assert!(a.coherence_length >= 0.0 && a.coherence_length <= 1.0);
        assert!(
            a.quantum_fidelity > 0.0 && a.quantum_fidelity <= 1.0,
            "fidelity follows native fraction"
        );
        // zero -> add -> mean parity across all 13 phase-E fields.
        let mut t = OmicsTotals::default();
        assert_eq!(t.decoherence_rate, 0.0, "fresh totals are zeroed");
        assert_eq!(t.quantum_fidelity, 0.0);
        t.add(&a);
        t.add(&a);
        let m = t.mean(2.0);
        assert!((m.decoherence_rate - a.decoherence_rate).abs() < 1e-9);
        assert!((m.coherence_lifetime - a.coherence_lifetime).abs() < 1e-9);
        assert!((m.tunneling_rate - a.tunneling_rate).abs() < 1e-9);
        assert!((m.zero_point_energy - a.zero_point_energy).abs() < 1e-9);
        assert!((m.superposition_entropy - a.superposition_entropy).abs() < 1e-9);
        assert!((m.entanglement_entropy - a.entanglement_entropy).abs() < 1e-9);
        assert!((m.quantum_parallelism - a.quantum_parallelism).abs() < 1e-9);
        assert!((m.measurement_backaction - a.measurement_backaction).abs() < 1e-9);
        assert!((m.collapse_rate - a.collapse_rate).abs() < 1e-9);
        assert!((m.quantum_diffusion - a.quantum_diffusion).abs() < 1e-9);
        assert!((m.tunnel_coupling - a.tunnel_coupling).abs() < 1e-9);
        assert!((m.coherence_length - a.coherence_length).abs() < 1e-9);
        assert!((m.quantum_fidelity - a.quantum_fidelity).abs() < 1e-9);
    }

    #[test]
    fn quantum_gate_perturbs_flux_application() {
        let flux = [10.0; 6];
        // Poor-fidelity / weak-tunnel / high-decoherence twin.
        let mut lo = chem_of(30.0, 10.0);
        let mut hi = chem_of(30.0, 10.0);
        apply_fluxome(
            &mut lo, &flux, 0.1, 0.1, 0.9, 0.9, 0.1, 0.9, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1,
            0.9, 0.05, 0.05, 0.05, 0.05, 0.05, 0.05, 0.05, 0.05, 0.05,
        );
        apply_fluxome(
            &mut hi, &flux, 0.95, 0.95, 0.05, 0.05, 0.95, 0.05, 0.95, 0.95, 0.95, 0.95, 0.95, 0.95,
            0.95, 0.95, 0.05, 0.95, 0.95, 0.95, 0.95, 0.95, 0.95, 0.95, 0.95, 0.95,
        );
        // Anabolic yields scale with coherent catalysis + tunneling: protein[6]
        // and lipid[3] accrue strictly more in the coherent twin.
        assert!(
            hi.molecules[6] > lo.molecules[6],
            "quantum gate gates synthase/polymerase yield"
        );
        assert!(
            hi.molecules[3] > lo.molecules[3],
            "tunneling boosts ligase yield"
        );
        // Decoherence taxes the catabolic energy recovery -> coherent twin keeps
        // strictly more ATP (same ligase drain, higher oxidase/hydrolase credit).
        assert!(
            hi.molecules[1] > lo.molecules[1],
            "decoherence loses energy to the environment"
        );
        // Consumption is untouched: substrate bleeds that receive no product
        // credit (glucose[0] feeds via R4, nucleotide[4] only drains) stay
        // bit-identical across the gate.
        assert_eq!(hi.molecules[0], lo.molecules[0]);
        assert_eq!(hi.molecules[4], lo.molecules[4]);
    }

    #[test]
    fn subatomic_observables_accumulate_and_mean() {
        let env = OmicsEnv {
            o2: 0.6,
            food: 0.4,
            ..OmicsEnv::default()
        };
        let dna = dna_of(1.0, 0.0);
        let mut chem = chem_of(30.0, 10.0);
        let mut o = create_agent_omics(&genome(), 1);
        for _ in 0..60 {
            tick_omics(
                &mut o,
                &genome(),
                &dna,
                &mut chem,
                &env,
                1.0,
                1,
                true,
                true,
                true,
            );
        }
        let a = tick_omics(
            &mut o,
            &genome(),
            &dna,
            &mut chem,
            &env,
            1.0,
            1,
            true,
            true,
            true,
        );
        // every phase-G subatomic observable is a genuine derived aggregate,
        // clamped into (0..1] bounds from the real pools.
        assert!(a.boson_field_intensity > 0.0 && a.boson_field_intensity <= 1.0);
        assert!(
            a.photon_transport > 0.0 && a.photon_transport <= 1.0,
            "EM jitter survives decoherence"
        );
        assert!(a.gluon_confinement > 0.0 && a.gluon_confinement <= 1.0);
        assert!(a.strong_coupling > 0.0 && a.strong_coupling <= 1.0);
        assert!(a.weak_boson_mass > 0.0 && a.weak_boson_mass <= 1.0);
        assert!(a.higgs_mass_floor > 0.0 && a.higgs_mass_floor <= 1.0);
        assert!(a.lepton_mobility > 0.0 && a.lepton_mobility <= 1.0);
        assert!(a.electron_channel > 0.0 && a.electron_channel <= 1.0);
        assert!(
            a.quark_flavor_population > 0.0,
            "flavor fills the combinatorial library"
        );
        assert!(a.quark_flavor_population <= 1.0);
        assert!(a.up_down_asymmetry >= 0.0 && a.up_down_asymmetry <= 1.0);
        assert!(a.strange_flavor > 0.0 && a.strange_flavor <= 1.0);
        assert!(
            a.charm_pool > 0.0,
            "heavy states sit above the zero-point floor"
        );
        assert!(a.charm_pool <= 1.0);
        assert!(a.proton_stability > 0.0 && a.proton_stability <= 1.0);
        // zero -> add -> mean parity across all 13 phase-G fields.
        let mut t = OmicsTotals::default();
        assert_eq!(t.boson_field_intensity, 0.0, "fresh totals are zeroed");
        assert_eq!(t.proton_stability, 0.0);
        t.add(&a);
        t.add(&a);
        let m = t.mean(2.0);
        assert!((m.boson_field_intensity - a.boson_field_intensity).abs() < 1e-9);
        assert!((m.photon_transport - a.photon_transport).abs() < 1e-9);
        assert!((m.gluon_confinement - a.gluon_confinement).abs() < 1e-9);
        assert!((m.strong_coupling - a.strong_coupling).abs() < 1e-9);
        assert!((m.weak_boson_mass - a.weak_boson_mass).abs() < 1e-9);
        assert!((m.higgs_mass_floor - a.higgs_mass_floor).abs() < 1e-9);
        assert!((m.lepton_mobility - a.lepton_mobility).abs() < 1e-9);
        assert!((m.electron_channel - a.electron_channel).abs() < 1e-9);
        assert!((m.quark_flavor_population - a.quark_flavor_population).abs() < 1e-9);
        assert!((m.up_down_asymmetry - a.up_down_asymmetry).abs() < 1e-9);
        assert!((m.strange_flavor - a.strange_flavor).abs() < 1e-9);
        assert!((m.charm_pool - a.charm_pool).abs() < 1e-9);
        assert!((m.proton_stability - a.proton_stability).abs() < 1e-9);
    }

    #[test]
    fn subatomic_coupling_perturbs_flux_application() {
        let flux = [10.0; 6];
        // Weak subatomic / poor-coherence twin.
        let mut lo = chem_of(30.0, 10.0);
        let mut hi = chem_of(30.0, 10.0);
        apply_fluxome(
            &mut lo, &flux, 0.1, 0.1, 0.9, 0.9, 0.1, 0.9, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1,
            0.9, 0.05, 0.05, 0.05, 0.05, 0.05, 0.05, 0.05, 0.05, 0.05,
        );
        apply_fluxome(
            &mut hi, &flux, 0.95, 0.95, 0.05, 0.05, 0.95, 0.05, 0.95, 0.95, 0.95, 0.95, 0.95, 0.95,
            0.95, 0.95, 0.05, 0.95, 0.95, 0.95, 0.95, 0.95, 0.95, 0.95, 0.95, 0.95,
        );
        // Electromagnetic channel boosts the oxidative ATP recovery, strong
        // binding gates the ligase/polymerase anabolic credits and flavor
        // population lifts the lyase product credits.
        assert!(
            hi.molecules[1] > lo.molecules[1],
            "photon channel boosts oxidative ATP credit"
        );
        assert!(
            hi.molecules[3] > lo.molecules[3],
            "strong binding gates the ligase lipid credit"
        );
        assert!(
            hi.molecules[6] > lo.molecules[6],
            "strong binding gates polymerase protein credit"
        );
        assert!(
            hi.molecules[10] > lo.molecules[10],
            "flavor population boosts the lyase product credit"
        );
        // Consumption is untouched: glucose[0] and nucleotide[4] bleed only.
        assert_eq!(hi.molecules[0], lo.molecules[0]);
        assert_eq!(hi.molecules[4], lo.molecules[4]);
    }

    #[test]
    fn materials_observables_accumulate_and_mean() {
        let env = OmicsEnv {
            o2: 0.6,
            food: 0.4,
            ..OmicsEnv::default()
        };
        let dna = dna_of(1.0, 0.0);
        let mut chem = chem_of(30.0, 10.0);
        let mut o = create_agent_omics(&genome(), 1);
        for _ in 0..60 {
            tick_omics(
                &mut o,
                &genome(),
                &dna,
                &mut chem,
                &env,
                1.0,
                1,
                true,
                true,
                true,
            );
        }
        let a = tick_omics(
            &mut o,
            &genome(),
            &dna,
            &mut chem,
            &env,
            1.0,
            1,
            true,
            true,
            true,
        );
        // every phase-H quantum-materials observable is a genuine derived
        // aggregate, clamped into (0..1] bounds from the real lattice pools.
        assert!(a.lattice_periodicity > 0.0 && a.lattice_periodicity <= 1.0);
        assert!(
            a.band_gap > 0.0 && a.band_gap <= 1.0,
            "lepton mobility leaves a band gap"
        );
        assert!(a.fermi_level > 0.0 && a.fermi_level <= 1.0);
        assert!(a.conduction_band >= 0.0 && a.conduction_band <= 1.0);
        assert!(a.valence_band >= 0.0 && a.valence_band <= 1.0);
        assert!(a.phonon_flux >= 0.0 && a.phonon_flux <= 1.0);
        assert!(a.exciton_binding >= 0.0 && a.exciton_binding <= 1.0);
        assert!(a.defect_density >= 0.0 && a.defect_density <= 1.0);
        assert!(a.doping_level >= 0.0 && a.doping_level <= 1.0);
        assert!(a.carrier_mobility >= 0.0 && a.carrier_mobility <= 1.0);
        assert!(a.topological_invariant >= 0.0 && a.topological_invariant <= 1.0);
        assert!(a.moire_superlattice >= 0.0 && a.moire_superlattice <= 1.0);
        assert!(a.lattice_thermal_susceptibility >= 0.0 && a.lattice_thermal_susceptibility <= 1.0);
        // zero -> add -> mean parity across all 13 phase-H fields.
        let mut t = OmicsTotals::default();
        assert_eq!(t.lattice_periodicity, 0.0, "fresh totals are zeroed");
        assert_eq!(t.lattice_thermal_susceptibility, 0.0);
        t.add(&a);
        t.add(&a);
        let m = t.mean(2.0);
        assert!((m.lattice_periodicity - a.lattice_periodicity).abs() < 1e-9);
        assert!((m.band_gap - a.band_gap).abs() < 1e-9);
        assert!((m.fermi_level - a.fermi_level).abs() < 1e-9);
        assert!((m.conduction_band - a.conduction_band).abs() < 1e-9);
        assert!((m.valence_band - a.valence_band).abs() < 1e-9);
        assert!((m.phonon_flux - a.phonon_flux).abs() < 1e-9);
        assert!((m.exciton_binding - a.exciton_binding).abs() < 1e-9);
        assert!((m.defect_density - a.defect_density).abs() < 1e-9);
        assert!((m.doping_level - a.doping_level).abs() < 1e-9);
        assert!((m.carrier_mobility - a.carrier_mobility).abs() < 1e-9);
        assert!((m.topological_invariant - a.topological_invariant).abs() < 1e-9);
        assert!((m.moire_superlattice - a.moire_superlattice).abs() < 1e-9);
        assert!((m.lattice_thermal_susceptibility - a.lattice_thermal_susceptibility).abs() < 1e-9);
    }

    #[test]
    fn materials_coupling_perturbs_flux_application() {
        let flux = [10.0; 6];
        // Disordered / undoped / high-mobility twin (energy escapes the lattice).
        let mut lo = chem_of(30.0, 10.0);
        let mut hi = chem_of(30.0, 10.0);
        apply_fluxome(
            &mut lo, &flux, 0.1, 0.1, 0.9, 0.9, 0.1, 0.9, 0.1, 0.1, 0.1, 0.1, 0.1, 0.9, 0.1, 0.1,
            0.9, 0.05, 0.05, 0.05, 0.05, 0.05, 0.05, 0.05, 0.05, 0.05,
        );
        apply_fluxome(
            &mut hi, &flux, 0.95, 0.95, 0.05, 0.05, 0.95, 0.05, 0.95, 0.95, 0.95, 0.95, 0.95, 0.05,
            0.95, 0.95, 0.05, 0.95, 0.95, 0.95, 0.95, 0.95, 0.95, 0.95, 0.95, 0.95,
        );
        // Periodic-lattice stabilisation gates the synthase/polymerase protein
        // credits, doping lifts the hydrolase amino-acid and lyase fatty-acid
        // credits.
        assert!(
            hi.molecules[6] > lo.molecules[6],
            "lattice periodicity stabilises protein formation"
        );
        assert!(
            hi.molecules[2] > lo.molecules[2],
            "doping boosts hydrolase amino-acid recovery"
        );
        assert!(
            hi.molecules[10] > lo.molecules[10],
            "doping lifts the lyase fatty-acid credit"
        );
        // Consumption is untouched: glucose[0] and nucleotide[4] bleed only.
        assert_eq!(hi.molecules[0], lo.molecules[0]);
        assert_eq!(hi.molecules[4], lo.molecules[4]);
    }

    #[test]
    fn statistical_observables_accumulate_and_mean() {
        let env = OmicsEnv {
            o2: 0.6,
            food: 0.4,
            ..OmicsEnv::default()
        };
        let dna = dna_of(1.0, 0.0);
        let mut chem = chem_of(30.0, 10.0);
        let mut o = create_agent_omics(&genome(), 1);
        for _ in 0..60 {
            tick_omics(
                &mut o,
                &genome(),
                &dna,
                &mut chem,
                &env,
                1.0,
                1,
                true,
                true,
                true,
            );
        }
        let a = tick_omics(
            &mut o,
            &genome(),
            &dna,
            &mut chem,
            &env,
            1.0,
            1,
            true,
            true,
            true,
        );
        // every phase-I statistical/IT observable is a genuine derived aggregate
        // clamped into (0..1] bounds from the real pools; the live proteome and
        // jitter keep the Shannon/Boltzmann and demon terms positive.
        assert!(
            a.boltzmann_entropy >= 0.0 && a.boltzmann_entropy <= 1.0,
            "macrostate occupancy entropy"
        );
        assert!(a.shannon_dissimilarity >= 0.0 && a.shannon_dissimilarity <= 1.0);
        assert!(a.entropy_change_rate >= 0.0 && a.entropy_change_rate <= 1.0);
        assert!(a.gibbs_free_energy >= 0.0 && a.gibbs_free_energy <= 1.0);
        assert!(a.entropy_production >= 0.0 && a.entropy_production <= 1.0);
        assert!(a.time_reversal_asymmetry >= 0.0 && a.time_reversal_asymmetry <= 1.0);
        assert!(a.maxwell_demon_power >= 0.0 && a.maxwell_demon_power <= 1.0);
        assert!(a.demon_information_cost > 0.0 && a.demon_information_cost <= 1.0);
        assert!(a.absolute_zero_proximity >= 0.0 && a.absolute_zero_proximity <= 1.0);
        assert!(a.quantum_landauer_floor >= 0.0 && a.quantum_landauer_floor <= 1.0);
        assert!(a.heat_capacity_anomaly >= 0.0 && a.heat_capacity_anomaly <= 1.0);
        assert!(a.kbt_damping >= 0.0 && a.kbt_damping <= 1.0);
        assert!(a.canonical_partition_z >= 0.0 && a.canonical_partition_z <= 1.0);
        // zero -> add -> mean parity across all 13 phase-I fields.
        let mut t = OmicsTotals::default();
        assert_eq!(t.boltzmann_entropy, 0.0, "fresh totals are zeroed");
        assert_eq!(t.canonical_partition_z, 0.0);
        t.add(&a);
        t.add(&a);
        let m = t.mean(2.0);
        assert!((m.boltzmann_entropy - a.boltzmann_entropy).abs() < 1e-9);
        assert!((m.shannon_dissimilarity - a.shannon_dissimilarity).abs() < 1e-9);
        assert!((m.entropy_change_rate - a.entropy_change_rate).abs() < 1e-9);
        assert!((m.gibbs_free_energy - a.gibbs_free_energy).abs() < 1e-9);
        assert!((m.entropy_production - a.entropy_production).abs() < 1e-9);
        assert!((m.time_reversal_asymmetry - a.time_reversal_asymmetry).abs() < 1e-9);
        assert!((m.maxwell_demon_power - a.maxwell_demon_power).abs() < 1e-9);
        assert!((m.demon_information_cost - a.demon_information_cost).abs() < 1e-9);
        assert!((m.absolute_zero_proximity - a.absolute_zero_proximity).abs() < 1e-9);
        assert!((m.quantum_landauer_floor - a.quantum_landauer_floor).abs() < 1e-9);
        assert!((m.heat_capacity_anomaly - a.heat_capacity_anomaly).abs() < 1e-9);
        assert!((m.kbt_damping - a.kbt_damping).abs() < 1e-9);
        assert!((m.canonical_partition_z - a.canonical_partition_z).abs() < 1e-9);
    }

    #[test]
    fn statistical_coupling_perturbs_flux_application() {
        let flux = [10.0; 6];
        // Weak-demon / warm (non-cryogenic) / thermally-agitated twin.
        let mut lo = chem_of(30.0, 10.0);
        let mut hi = chem_of(30.0, 10.0);
        apply_fluxome(
            &mut lo, &flux, 0.1, 0.1, 0.9, 0.9, 0.1, 0.9, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1,
            0.9, 0.05, 0.05, 0.05, 0.05, 0.05, 0.05, 0.05, 0.05, 0.05,
        );
        apply_fluxome(
            &mut hi, &flux, 0.95, 0.95, 0.05, 0.05, 0.95, 0.05, 0.95, 0.95, 0.95, 0.95, 0.95, 0.95,
            0.95, 0.95, 0.05, 0.95, 0.95, 0.95, 0.95, 0.95, 0.95, 0.95, 0.95, 0.95,
        );
        // Demon sorting boosts the R1 synthase protein credit, the absolute-zero
        // proximity preserves the R0 oxidative ATP credit and the kT damping
        // taxes the R2 hydrolase amino-acid credit.
        assert!(
            hi.molecules[6] > lo.molecules[6],
            "demon sorting boosts the synthase protein credit"
        );
        assert!(
            hi.molecules[1] > lo.molecules[1],
            "cryogenic preservation boosts oxidative ATP credit"
        );
        assert!(
            hi.molecules[2] > lo.molecules[2],
            "thermal agitation taxes hydrolase amino-acid credit"
        );
        // Consumption is untouched: glucose[0] and nucleotide[4] bleed only.
        assert_eq!(hi.molecules[0], lo.molecules[0]);
        assert_eq!(hi.molecules[4], lo.molecules[4]);
    }

    #[test]
    fn nano_observables_accumulate_and_mean() {
        let env = OmicsEnv {
            o2: 0.6,
            food: 0.4,
            ..OmicsEnv::default()
        };
        let dna = dna_of(1.0, 0.0);
        let mut chem = chem_of(30.0, 10.0);
        let mut o = create_agent_omics(&genome(), 1);
        for _ in 0..60 {
            tick_omics(
                &mut o,
                &genome(),
                &dna,
                &mut chem,
                &env,
                1.0,
                1,
                true,
                true,
                true,
            );
        }
        let a = tick_omics(
            &mut o,
            &genome(),
            &dna,
            &mut chem,
            &env,
            1.0,
            1,
            true,
            true,
            true,
        );
        // every phase-J nanosystems observable is a genuine derived aggregate
        // clamped into (0..1] bounds from the real pools, quantum and
        // materials or statistical aggregates above (never stubs).
        assert!(
            a.nanoparticle_surface >= 0.0 && a.nanoparticle_surface <= 1.0,
            "dispersed crystallite enthalpy"
        );
        assert!(a.nanoparticle_density >= 0.0 && a.nanoparticle_density <= 1.0);
        assert!(a.nanopore_transport >= 0.0 && a.nanopore_transport <= 1.0);
        assert!(a.nanoscale_contact >= 0.0 && a.nanoscale_contact <= 1.0);
        assert!(a.molecular_machine_work >= 0.0 && a.molecular_machine_work <= 1.0);
        assert!(a.assembler_accuracy >= 0.0 && a.assembler_accuracy <= 1.0);
        assert!(a.nanofabrication_yield >= 0.0 && a.nanofabrication_yield <= 1.0);
        assert!(a.dna_origami_stability >= 0.0 && a.dna_origami_stability <= 1.0);
        assert!(a.bionano_interface >= 0.0 && a.bionano_interface <= 1.0);
        assert!(a.nanozyme_activity >= 0.0 && a.nanozyme_activity <= 1.0);
        assert!(a.colloidal_stability >= 0.0 && a.colloidal_stability <= 1.0);
        assert!(a.quantum_dot_brightness >= 0.0 && a.quantum_dot_brightness <= 1.0);
        assert!(a.nanotoxic_flux >= 0.0 && a.nanotoxic_flux <= 1.0);
        // zero -> add -> mean parity across all 13 phase-J fields.
        let mut t = OmicsTotals::default();
        assert_eq!(t.nanoparticle_surface, 0.0, "fresh totals are zeroed");
        assert_eq!(t.nanotoxic_flux, 0.0);
        t.add(&a);
        t.add(&a);
        let m = t.mean(2.0);
        assert!((m.nanoparticle_surface - a.nanoparticle_surface).abs() < 1e-9);
        assert!((m.nanoparticle_density - a.nanoparticle_density).abs() < 1e-9);
        assert!((m.nanopore_transport - a.nanopore_transport).abs() < 1e-9);
        assert!((m.nanoscale_contact - a.nanoscale_contact).abs() < 1e-9);
        assert!((m.molecular_machine_work - a.molecular_machine_work).abs() < 1e-9);
        assert!((m.assembler_accuracy - a.assembler_accuracy).abs() < 1e-9);
        assert!((m.nanofabrication_yield - a.nanofabrication_yield).abs() < 1e-9);
        assert!((m.dna_origami_stability - a.dna_origami_stability).abs() < 1e-9);
        assert!((m.bionano_interface - a.bionano_interface).abs() < 1e-9);
        assert!((m.nanozyme_activity - a.nanozyme_activity).abs() < 1e-9);
        assert!((m.colloidal_stability - a.colloidal_stability).abs() < 1e-9);
        assert!((m.quantum_dot_brightness - a.quantum_dot_brightness).abs() < 1e-9);
        assert!((m.nanotoxic_flux - a.nanotoxic_flux).abs() < 1e-9);
    }

    #[test]
    fn nano_coupling_perturbs_flux_application() {
        let flux = [10.0; 6];
        // Low-surface / imprecise-assembler / poorly-dispersed twin.
        let mut lo = chem_of(30.0, 10.0);
        let mut hi = chem_of(30.0, 10.0);
        apply_fluxome(
            &mut lo, &flux, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5,
            0.5, 0.05, 0.05, 0.05, 0.05, 0.05, 0.05, 0.05, 0.05, 0.05,
        );
        apply_fluxome(
            &mut hi, &flux, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5,
            0.5, 0.95, 0.95, 0.95, 0.95, 0.95, 0.95, 0.95, 0.95, 0.95,
        );
        // Assembler accuracy boosts the R1 synthase protein credit, the
        // nanoparticle surface laces the R0 oxidative ATP credit and the
        // colloidal dispersion preserves the R2 hydrolase amino-acid credit.
        assert!(
            hi.molecules[6] > lo.molecules[6],
            "assembler accuracy boosts the synthase protein credit"
        );
        assert!(
            hi.molecules[1] > lo.molecules[1],
            "nanoparticle surface laces the oxidative ATP credit"
        );
        assert!(
            hi.molecules[2] > lo.molecules[2],
            "colloidal dispersion preserves the hydrolase amino-acid credit"
        );
        // Consumption is untouched: glucose[0] and nucleotide[4] bleed only.
        assert_eq!(hi.molecules[0], lo.molecules[0]);
        assert_eq!(hi.molecules[4], lo.molecules[4]);
    }

    #[test]
    fn phylogeny_observables_accumulate_and_mean() {
        let env = OmicsEnv {
            o2: 0.6,
            food: 0.4,
            ..OmicsEnv::default()
        };
        let dna = dna_of(1.0, 0.0);
        let mut chem = chem_of(30.0, 10.0);
        let mut o = create_agent_omics(&genome(), 1);
        for _ in 0..60 {
            tick_omics(
                &mut o,
                &genome(),
                &dna,
                &mut chem,
                &env,
                1.0,
                1,
                true,
                true,
                true,
            );
        }
        let a = tick_omics(
            &mut o,
            &genome(),
            &dna,
            &mut chem,
            &env,
            1.0,
            1,
            true,
            true,
            true,
        );
        // every phase-K phylogeny observable is a genuine derived aggregate
        // clamped into (0..1] bounds from the real pools and the quantum /
        // materials / statistical / nanosystems aggregates above (never stubs).
        assert!(
            a.viral_load >= 0.0 && a.viral_load <= 1.0,
            "naked host-hijacking residue"
        );
        assert!(a.bacterial_load >= 0.0 && a.bacterial_load <= 1.0);
        assert!(a.archaeal_density >= 0.0 && a.archaeal_density <= 1.0);
        assert!(a.fungal_biomass >= 0.0 && a.fungal_biomass <= 1.0);
        assert!(a.protist_motility >= 0.0 && a.protist_motility <= 1.0);
        assert!(a.monera_primordial >= 0.0 && a.monera_primordial <= 1.0);
        assert!(a.plant_photosynthesis >= 0.0 && a.plant_photosynthesis <= 1.0);
        assert!(a.poriferan_channel >= 0.0 && a.poriferan_channel <= 1.0);
        assert!(a.chordate_neural_tube >= 0.0 && a.chordate_neural_tube <= 1.0);
        assert!(a.pisces_aquatic_metabolism >= 0.0 && a.pisces_aquatic_metabolism <= 1.0);
        assert!(a.mammal_thermoregulation >= 0.0 && a.mammal_thermoregulation <= 1.0);
        assert!(a.primate_cognition >= 0.0 && a.primate_cognition <= 1.0);
        assert!(a.symbiotic_index >= 0.0 && a.symbiotic_index <= 1.0);
        // zero -> add -> mean parity across all 13 phase-K fields.
        let mut t = OmicsTotals::default();
        assert_eq!(t.viral_load, 0.0, "fresh totals are zeroed");
        assert_eq!(t.symbiotic_index, 0.0);
        t.add(&a);
        t.add(&a);
        let m = t.mean(2.0);
        assert!((m.viral_load - a.viral_load).abs() < 1e-9);
        assert!((m.bacterial_load - a.bacterial_load).abs() < 1e-9);
        assert!((m.archaeal_density - a.archaeal_density).abs() < 1e-9);
        assert!((m.fungal_biomass - a.fungal_biomass).abs() < 1e-9);
        assert!((m.protist_motility - a.protist_motility).abs() < 1e-9);
        assert!((m.monera_primordial - a.monera_primordial).abs() < 1e-9);
        assert!((m.plant_photosynthesis - a.plant_photosynthesis).abs() < 1e-9);
        assert!((m.poriferan_channel - a.poriferan_channel).abs() < 1e-9);
        assert!((m.chordate_neural_tube - a.chordate_neural_tube).abs() < 1e-9);
        assert!((m.pisces_aquatic_metabolism - a.pisces_aquatic_metabolism).abs() < 1e-9);
        assert!((m.mammal_thermoregulation - a.mammal_thermoregulation).abs() < 1e-9);
        assert!((m.primate_cognition - a.primate_cognition).abs() < 1e-9);
        assert!((m.symbiotic_index - a.symbiotic_index).abs() < 1e-9);
    }

    #[test]
    fn phylogeny_coupling_perturbs_flux_application() {
        let flux = [10.0; 6];
        // Low-viral / low-symbiosis / ectotherm twin.
        let mut lo = chem_of(30.0, 10.0);
        let mut hi = chem_of(30.0, 10.0);
        apply_fluxome(
            &mut lo, &flux, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5,
            0.5, 0.5, 0.5, 0.5, 0.05, 0.05, 0.05, 0.05, 0.05, 0.05,
        );
        apply_fluxome(
            &mut hi, &flux, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5,
            0.5, 0.5, 0.5, 0.5, 0.95, 0.95, 0.95, 0.95, 0.95, 0.95,
        );
        // Viral lysis releases the R2 hydrolase amino-acid credit, the
        // symbiotic cooperativity lifts the R4 polymerase protein credit and
        // warm-blooded metabolism raises the R0 oxidative ATP credit.
        assert!(
            hi.molecules[2] > lo.molecules[2],
            "viral lysis releases hydrolase amino-acid credit"
        );
        assert!(
            hi.molecules[6] > lo.molecules[6],
            "symbiotic cooperativity lifts the polymerase protein credit"
        );
        assert!(
            hi.molecules[1] > lo.molecules[1],
            "warm-blood metabolism raises the oxidative ATP credit"
        );
        // Consumption is untouched: glucose[0] and nucleotide[4] bleed only.
        assert_eq!(hi.molecules[0], lo.molecules[0]);
        assert_eq!(hi.molecules[4], lo.molecules[4]);
    }

    #[test]
    fn physiology_observables_accumulate_and_mean() {
        let env = OmicsEnv {
            o2: 0.6,
            food: 0.4,
            ..OmicsEnv::default()
        };
        let dna = dna_of(1.0, 0.0);
        let mut chem = chem_of(30.0, 10.0);
        let mut o = create_agent_omics(&genome(), 1);
        for _ in 0..60 {
            tick_omics(
                &mut o,
                &genome(),
                &dna,
                &mut chem,
                &env,
                1.0,
                1,
                true,
                true,
                true,
            );
        }
        let a = tick_omics(
            &mut o,
            &genome(),
            &dna,
            &mut chem,
            &env,
            1.0,
            1,
            true,
            true,
            true,
        );
        // every phase-L physiology observable is a genuine derived aggregate
        // clamped into (0..1] bounds from the real pools and the phylogeny /
        // quantum / materials / statistical / nanosystems aggregates above.
        assert!(
            a.metabolic_rate >= 0.0 && a.metabolic_rate <= 1.0,
            "basal oxidative engine"
        );
        assert!(a.cardiovascular_pump >= 0.0 && a.cardiovascular_pump <= 1.0);
        assert!(a.respiration_efficiency >= 0.0 && a.respiration_efficiency <= 1.0);
        assert!(a.digestive_throughput >= 0.0 && a.digestive_throughput <= 1.0);
        assert!(a.excretory_clearance >= 0.0 && a.excretory_clearance <= 1.0);
        assert!(a.immune_surveillance >= 0.0 && a.immune_surveillance <= 1.0);
        assert!(a.neural_conductance >= 0.0 && a.neural_conductance <= 1.0);
        assert!(a.musculoskeletal_output >= 0.0 && a.musculoskeletal_output <= 1.0);
        assert!(a.endocrine_signaling >= 0.0 && a.endocrine_signaling <= 1.0);
        assert!(a.thermoregulation_control >= 0.0 && a.thermoregulation_control <= 1.0);
        assert!(a.fluid_homeostasis >= 0.0 && a.fluid_homeostasis <= 1.0);
        assert!(a.sensory_perception >= 0.0 && a.sensory_perception <= 1.0);
        assert!(a.growth_replication >= 0.0 && a.growth_replication <= 1.0);
        // zero -> add -> mean parity across all 13 phase-L fields.
        let mut t = OmicsTotals::default();
        assert_eq!(t.metabolic_rate, 0.0, "fresh totals are zeroed");
        assert_eq!(t.growth_replication, 0.0);
        t.add(&a);
        t.add(&a);
        let m = t.mean(2.0);
        assert!((m.metabolic_rate - a.metabolic_rate).abs() < 1e-9);
        assert!((m.cardiovascular_pump - a.cardiovascular_pump).abs() < 1e-9);
        assert!((m.respiration_efficiency - a.respiration_efficiency).abs() < 1e-9);
        assert!((m.digestive_throughput - a.digestive_throughput).abs() < 1e-9);
        assert!((m.excretory_clearance - a.excretory_clearance).abs() < 1e-9);
        assert!((m.immune_surveillance - a.immune_surveillance).abs() < 1e-9);
        assert!((m.neural_conductance - a.neural_conductance).abs() < 1e-9);
        assert!((m.musculoskeletal_output - a.musculoskeletal_output).abs() < 1e-9);
        assert!((m.endocrine_signaling - a.endocrine_signaling).abs() < 1e-9);
        assert!((m.thermoregulation_control - a.thermoregulation_control).abs() < 1e-9);
        assert!((m.fluid_homeostasis - a.fluid_homeostasis).abs() < 1e-9);
        assert!((m.sensory_perception - a.sensory_perception).abs() < 1e-9);
        assert!((m.growth_replication - a.growth_replication).abs() < 1e-9);
    }

    #[test]
    fn physiology_coupling_perturbs_flux_application() {
        let flux = [10.0; 6];
        // Low-drive / low-digestive / weak-immune twin.
        let mut lo = chem_of(30.0, 10.0);
        let mut hi = chem_of(30.0, 10.0);
        apply_fluxome(
            &mut lo, &flux, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5,
            0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.05, 0.05, 0.05,
        );
        apply_fluxome(
            &mut hi, &flux, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5,
            0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.95, 0.95, 0.95,
        );
        // Metabolic drive raises the R0 oxidative ATP credit, the digestive
        // throughput lifts the R2 hydrolase amino-acid credit and the immune
        // defence shields the R3 ligase lipid credit.
        assert!(
            hi.molecules[1] > lo.molecules[1],
            "metabolic drive raises the oxidative ATP credit"
        );
        assert!(
            hi.molecules[2] > lo.molecules[2],
            "digestive throughput lifts hydrolase amino-acid credit"
        );
        assert!(
            hi.molecules[3] > lo.molecules[3],
            "immune defence shields the ligase lipid credit"
        );
        // Consumption is untouched: glucose[0] and nucleotide[4] bleed only.
        assert_eq!(hi.molecules[0], lo.molecules[0]);
        assert_eq!(hi.molecules[4], lo.molecules[4]);
    }
}
