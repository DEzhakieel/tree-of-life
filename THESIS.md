# Engineering Emergence

### A deterministic instrument for the physics of open-ended evolution

> **Thesis.** A bit-deterministic artificial-life system is not merely a simulator
> but a *causal instrument*: because a world is a pure function of its seed and
> configuration, one can run the same history twice with exactly one thing
> changed. That capability turns questions about emergence — which indicators
> anticipate a critical transition, what selection does to a warning signal, how
> complexity scales with system size — into controlled experiments rather than
> natural-history observations. We use it to test whether the generic theory of
> critical transitions *transports* from low-dimensional stochastic models to a
> high-dimensional evolving ecology. It does not, in a specific and measurable
> way: variance survives as an early-warning indicator, autocorrelation-based
> indicators are at chance, skewness inverts, and warning skill **degrades** as
> the tipping point is approached more slowly. The negative result is the
> scientific product; the instrument is the contribution that makes it credible.

> **Formal write-up:** [`thesis/main.tex`](thesis/main.tex) (build:
> `latexmk -pdf main`). Task-oriented docs: [`docs/`](docs/index.md).
> Charter for the current vertical: [`docs/SPECIALIZATION.md`](docs/SPECIALIZATION.md).

---

## Abstract

Artificial-life systems generate rich, open-ended phenomena but weak inference:
results are typically single trajectories, are sensitive to undocumented
mechanics, and are described in language ("emergence", "complexity") that admits
no falsifier. Complex-systems research has the opposite problem: its theories of
criticality, critical slowing down, and open-ended evolution are derived from
low-dimensional or idealized models, and their domain of validity is rarely
tested against systems with genomes, selection, and history.

This thesis joins the two. We specify a deterministic artificial ecology in
which every stochastic draw is keyed by `(seed, tag, tick, id)`, the tick is a
fixed ordered pipeline, and a rolling state hash fingerprints every step; a
TypeScript reference engine and a Rust/WebAssembly authority reproduce each
world bit-for-bit from `(seed, config)`. On that substrate we built a
measurement stack (documented observables, detectors, a pre-registered claim
ledger) and an experiment runner whose manifests are sha256 digests over the
world fingerprint, trajectory, summary, and synthesis, re-verified bit-for-bit.

We then ask a question with a real chance of coming out negative: *do generic
early-warning indicators give calibrated advance notice of extinction in an
evolving ecology?* In 48 runs (8 seeds × 6 ramp durations) plus an 8-run no-ramp
control, the ecology is bistable, the control never collapses, and variance is
the only indicator clearly above chance (pooled AUC 0.659); flicker is a distant
second (0.562); lag-1 autocorrelation and recovery rate are at chance (0.493);
skewness is anti-predictive (0.361). The registered calibration prediction — that
lead time in control-parameter units is invariant to ramp duration — is
**rejected**: skill falls monotonically with slower forcing (AUC ≈ 0.72 → 0.54,
slope −0.0003, R² 0.69) and the lead in stress units shrinks (CV slope −0.013,
R² 0.89). We treat this as evidence that the generic theory does not transport
unchanged across the dimensionality, noise colour, and adaptive response of an
evolving system, and we specify the discriminating experiments that would decide
whether the mechanism is threshold drift, detrending artifact, vanishing order
parameter, or evolutionary rescue.

The broader claim is methodological. Emergence should be adjudicated by a
falsifier-first ledger with artifact-level reproducibility, not by narrative or
internal "rigor" scores; and deterministic replay should be treated as an
instrument for measuring response functions, not as an engineering nicety.

---

## 1. The inference problem

Artificial-life and digital-evolution platforms (Tierra, Avida, Polyworld,
Lenia-like ecologies) have produced self-replication, speciation, cooperation,
and open-ended growth of complexity. Their evidentiary status, however, is
uneven:

- **Single histories.** A striking run is a sample of one; replicates are often
  absent, and the space of configurations is enormous.
- **Mechanism opacity.** When the update rule is a 20-stage per-agent pipeline,
  a phenomenon can be produced by several subsystems at once, and ablation is
  rarely performed.
- **Unfalsifiable vocabulary.** "Emergence" is frequently a description of the
  author's surprise rather than a measurable property.
- **Weak transport.** Theories imported from dynamical systems (critical slowing
  down, edge-of-chaos, power laws) assume low dimensionality, stationary noise,
  and fixed parameters — assumptions an evolving ecology violates by
  construction.

Complex-systems research has developed exactly the missing standards — order
parameters, response functions, finite-size scaling, null models, early-warning
statistics — but usually applies them to physical or low-dimensional systems.
The gap this thesis occupies is the intersection: **use a deterministic
artificial system as a controlled instrument to test whether complexity theory
transports to systems with genomes and selection.**

## 2. Thesis statement

Three claims, in decreasing order of confidence.

**T1 — Instrument.** Bit-exact determinism plus exact replay converts a
simulator into a *counterfactual instrument*. Because a world is a pure function
of `(seed, config, intervention log)`, the same history can be branched at any
tick with a single intervention, and the divergence measured without
confounding. This licenses causal statements (dose–response, impulse response,
placebo controls) that field ecology cannot obtain, and it makes negative
results expensive to explain away.

**T2 — Non-transport.** The generic early-warning theory of critical transitions
does not transport unchanged to a high-dimensional evolving ecology. Under a
pre-registered analysis, only variance retains discriminative skill; the
autocorrelation family is at chance; skewness moves the wrong way; and warning
skill degrades with slower forcing rather than staying calibrated in
control-parameter units. The result is a boundary condition on the theory, not a
failure to detect a signal.

**T3 — Method.** Open-endedness and emergence claims should be adjudicated by a
pre-registered ledger: claim → falsifier → registered analysis → artifact →
status, with refutations reported as results. Internal composite scores
("rigor", "novelty") are engineering QA, not evidence, and should be labelled as
such.

## 3. The instrument

### 3.1 Specification

A world is a fixpoint of `(seed, config)`. One tick is a fixed ordered pipeline:
day/night and seasons → stochastic world → ecology grounding → per-agent stages
(orbit, chem-terrain sampling, neighbour scan, pattern drives, movement,
metabolism, water, feeding, chemistry, DNA, omics, cells, immune, predator–prey,
dormancy, reproductive gene tracking, costly signalling, green-beard donation,
memetic imitation, reproduction, learning) → biome re-injection → replicator
projection → fitness/births/events → observables → world half (carrion,
decomposition, plant growth, weathering, signal diffusion, statistics).

Every stochastic path draws from a `SplitMix64` stream keyed by
`(seed, tag, t, id)`; there is no global RNG. A rolling FNV-1a state hash
fingerprints each tick. Two engines — a readable TypeScript reference and a
Rust/WASM authority — implement the same protocol and are checked for
bit-identical digests.

### 3.2 What determinism buys

- **Exact counterfactuals.** Branch at tick `t` with one intervention; the
  difference between branches is attributable to that intervention.
- **Replayable snapshots.** Any historical state can be reconstructed and
  perturbed (`Engine.replay(config, interventionLog, t)`).
- **Manifest-level reproduction.** An experiment records sha256 over world
  fingerprint + trajectory + summary + synthesis; `--verify` re-runs and
  compares. A refutation cannot be dismissed as "a different run".
- **Cheap null models.** Same seed, mechanism disabled (a "dormant" subsystem);
  the null is matched on everything except the mechanism.

### 3.3 Measurement

Observables have documented formulas (Shannon entropy, Simpson, LMC complexity,
Gini, correlation dimension, NMI between meme and species, Price selection,
Lyapunov exponents, physiology). Detectors convert series into discrete claims.
The scope ledger registers each claim with a falsifier and a status
(supported / refuted / inconclusive). Current ledger: 23 supported, 2 refuted,
9 inconclusive of 34 — including two honest refutations (the learned steerer was
worse than a do-nothing control; a costly-signalling prediction failed in the
tested regime).

## 4. Research questions and registered falsifiers

The programme is organized as questions with pre-registered analyses. Status is
reported as of this writing. The operational ledger — with claim IDs, artifacts,
and the append-only revision log — is [`docs/CLAIMS.md`](docs/CLAIMS.md).

| # | Question | Registered falsifier | Status |
|---|---|---|---|
| **Q1** | Does at least one generic indicator separate pre-collapse from stationary windows? | No indicator with AUC > 0.5 pooled over replicates | **Supported** (variance 0.659) |
| **Q2** | Does variance out-rank autocorrelation-based indicators? | AR(1)/recovery ≥ variance | **Supported** (0.493 vs 0.659) |
| **Q3** | Is lead time calibrated in control-parameter units (invariant to ramp duration)? | Lead in stress units varies systematically with τ | **Rejected** (CV slope −0.013, R² 0.89) |
| **Q4** | Is the warning specific to the forcing? | No-ramp control collapses or warns | **Supported** (8/8 survive) |
| **Q5** | Is the Q3 failure threshold drift, detrending artifact, vanishing order parameter, or evolutionary rescue? | Pre-registered multiverse + ablation leaves the slope unexplained | **Open** — decisive tests below |
| **Q6** | Do spatial indicators transport where temporal ones fail? | Spatial AUC ≤ 0.5 or no gain over temporal | **Open** |
| **Q7** | Does a direct response-function measure of critical slowing down succeed where AR(1) proxies fail? | Perturbation recovery time does not rise before collapse | **Open** |
| **Q8** | Does warning skill scale with system size (finite-size scaling)? | AUC independent of N across 100–2000 | **Open** |

### 4.1 Decisive tests for Q5

The Q3 rejection is currently a *phenomenological* result: the registered
analysis rejects calibration, but does not identify the mechanism. Four
hypotheses are separable with the existing instrument:

- **M1 — threshold drift.** A slowly drifting baseline widens the pre-ramp SD,
  raising the mean + 1.5 SD detection bar. *Test:* replace the fixed baseline
  with an EWMA baseline, or fix the threshold in stress units; if the AUC–τ
  slope collapses, M1 is the mechanism.
- **M2 — detrending artifact.** The 25-tick moving-average detrender removes
  precisely the slow variance growth that is supposed to be the signal. *Test:*
  multiverse over detrenders (none, MA lengths 10/25/50, Gaussian, wavelet, SSA)
  and report the distribution of slopes, not one specification.
- **M3 — vanishing order parameter.** Extinction drives absolute variance to
  zero, so the informative window is bounded away from the fold. *Test:* repeat
  with log population and with CV as the order parameter; if skill still
  degrades, the effect is not merely scale.
- **M4 — evolutionary rescue.** Selection on metabolic efficiency buffers the
  stress, so the system is never as close to the fold as the ramp schedule
  implies. *Test:* clonal, mutation-off ablation and a measured genetic-variance
  trajectory; if the slope flattens without adaptation, M4 is implicated.

The registered decision rule: a mechanism is supported only if its manipulation
removes at least half of the AUC–τ slope *and* the remaining slope is not
significant under a hierarchical bootstrap. No mechanism is declared on the
basis of the current 8-seed data.

### 4.2 Q7 in practice

Determinism makes a direct measurement of critical slowing down possible, which
is the measurement the AR(1) proxy is trying to approximate. At selected ticks
along the ramp, branch the run, apply a calibrated impulse (e.g. remove 10% of
the population, or inject a fixed food pulse), and measure the return time to the
unperturbed trajectory. The recovery rate `λ(t) = −ln(‖δx(t+Δ)‖/‖δx(t)‖)/Δ` is a
response function. Critical slowing down predicts `λ(t) → 0` before the fold;
if `λ(t)` stays bounded while AUC falls, the proxy failure is explained by the
proxy, not by the absence of slowing down. This is the kind of experiment that
motivates the instrument claim T1.

## 5. The beachhead result, honestly stated

**Design.** `spawn = 300`, `maxPopulation = 500`, burn-in 350 ticks at
`metabolismBase = 1`, ramp `1 → 40` over τ ∈ {300, 450, 600, 750, 900, 1050},
tail 300 ticks. 8 seeds per τ (48 runs) + 8 no-ramp controls. Indicators are
computed on detrended 60-tick windows, step 15, MA length 25; detection is
baseline mean + 1.5 SD with a 70% sustain rule; skill is ROC AUC against
early-stationary windows; directions are applied before scoring.

**Control.** 8/8 controls survive (mean final population 500): the collapse is
ramp-caused.

**Pooled skill (43/48 collapsed runs).**

| indicator | AUC | detect | mean lead (ticks) | mean lead (stress) |
|---|---:|---:|---:|---:|
| variance | 0.659 | 28% | 207 | 13.9 |
| flicker | 0.562 | 2% | 32 | 2.8 |
| CV | 0.512 | 86% | 160 | 8.6 |
| AR(1) / recovery | 0.493 | 5% | 39 | 1.4 |
| skewness | 0.361 | 7% | 50 | 3.9 |

**Calibration.** AUC declines monotonically with τ (≈0.72 for τ ≤ 750, ≈0.54 for
τ ≥ 900; slope −0.0003, R² 0.69). Lead in stress units shrinks with τ (CV slope
−0.013, R² 0.89; variance −0.014, R² 0.34). The fixed-distance prediction fails.

**What this does and does not license.** It licenses the statement that, under
this registered analysis in this ecology, the autocorrelation family carries no
warning and calibration fails. It does **not** yet identify why; with 8 seeds the
confidence interval on a mean AUC is wide (order ±0.1), and the detection rule is
one choice among many. That is why Q5 is registered as open, with a multiverse
and ablation rather than a narrative.

## 6. From platform to programme: the inference gap

Programme-level complex-systems work is not defined by topic but by a standard
of inference: a sharp question, a mechanism, a null, a scaling argument, and
artifacts that let a skeptical reader redo the analysis. The gap analysis:

| Requirement | Current state | Next artifact |
|---|---|---|
| **Theory** | Verbal expectation of critical slowing down | Derive AUC(τ) for a ramped fold with demographic noise; predict the slope sign and magnitude |
| **Mechanism** | Q3 rejection is phenomenological | Q5 multiverse + M1–M4 ablations |
| **Causal identification** | Determinism + replay implemented | Q7 impulse-response experiment; placebo ramps; dose–response |
| **Scaling** | Single N ≈ 300–500 | Q8 finite-size sweep, 100–2000 |
| **Generalization** | One ecology, one genotype–phenotype map | Substrate (agents/particles/lattice/graph) and topology (torus/cylinder/sphere/Möbius/Klein) replication |
| **Statistics** | n = 8 seeds, one analysis path | 32–64 seeds; hierarchical bootstrap; multiverse; power analysis pre-registered |
| **Open-endedness** | Ladder O0–O9, internal rungs | Bedau evolutionary activity, novelty rate, major-transition detector, with falsifiers |
| **Artifacts** | Digests, manifests, dashboard | One-command replication package; archived manifests; analysis code frozen before data |

The point of the table is not self-flagellation; it is that each row is
*actionable with the existing instrument*. Determinism is what makes rows 3–6
feasible at all.

## 7. Threats to validity

- **Construct.** AUC is not lead time, and extinction is not a fold
  bifurcation. A ramped die-off can be a transcritical or saddle-node crossing;
  the theory's predictions differ. The order parameter (population) is bounded
  below, so absolute variance must vanish at extinction.
- **Internal.** The detection threshold is estimated from the pre-ramp plateau;
  a slow ramp inflates that baseline (M1). Detrending removes slow variance
  (M2). Both are testable and currently untested.
- **External.** One ecology, one genome map, one topology, one noise model. The
  claim is about *this* class of systems until replicated.
- **Statistical.** Eight seeds per cell; windows within a run are not
  independent (pseudoreplication); five indicators × six ramp lengths is a
  multiple-comparison surface. The registered analysis averages per run, which
  mitigates but does not remove these.
- **Conclusion.** The mechanism is unidentified. "The theory does not transport"
  is supported; "because of adaptation" is not.

## 8. Relation to prior work

The programme inherits from four lines.

**Sciences of the artificial.** Simon's argument that artificial systems are
legitimate objects of science when their goals and mechanisms are specified;
Holland's emergence as constrained generation; Crutchfield's intrinsic
computation as a measure of structure in a process.

**Open-ended evolution.** Bedau's evolutionary activity statistics and the
distinction between adaptive and open-ended dynamics; Fontana and Buss on the
organization of innovation; Taylor et al.'s operational criteria for
open-endedness; Kauffman's NK landscapes and the edge-of-chaos hypothesis;
Bak's self-organized criticality as the competing null.

**Critical transitions.** Scheffer et al.'s generic indicators; Dakos et al.'s
detection methods; Drake and Griffen's extinction experiment; Boettiger and
Hastings on limits to detection; Hastings and Wysham on warnings without
warning; Lenton on climate tipping points; Carpenter et al.'s whole-ecosystem
test. Our contribution is a transport test in a system with genomes and
selection, plus a direct response-function measurement that the proxies
approximate.

**Evolutionary theory.** Price's selection–transmission decomposition; the
replicator equation; major transitions in individuality; May's stability
criterion as the null against which claims of adaptive complexity must be
measured.

## 9. Programme

**Paper A (instrument).** Deterministic replay as a causal instrument for
artificial life: specification, parity, manifests, and the counterfactual
protocol. Target: ALife / GECCO / Artificial Life.

**Paper B (negative result and mechanism).** "Generic early-warning signals do
not transport to an evolving ecology: a registered multiverse and ablation."
Target: Oikos / Ecology and Evolution / PNAS Nexus; registered report for Q5–Q8.

**Paper C (open-endedness).** A falsifier-first ledger for open-ended evolution:
evolutionary activity, novelty, and major transitions, each with a null.

**Immediate sequence.** (1) Freeze the current analysis as the registered
baseline; (2) run Q5's multiverse + M1–M4 with 32 seeds; (3) run Q7's
impulse-response measurement; (4) publish B with A as the methods appendix;
(5) only then extend to substrates and topologies.

## 10. What would falsify the thesis

- **T1** would fail if replay were not exact under interventions, or if
  counterfactual divergence were dominated by floating-point or scheduler
  effects. (Current evidence: cross-engine digests are bit-identical.)
- **T2** would collapse to a methods caveat if a pre-registered multiverse
  showed the AUC–τ slope is an artifact of the threshold rule or detrender and
  vanishes under every reasonable specification.
- **T3** would fail if ledger statuses could be revised after seeing the data
  without recording the revision. (Current practice: append-only ledger with
  claim IDs and artifacts.)

A thesis that names its own failure modes is the minimum price of admission to
the conversation this project wants to join.

---

## Reproduce

```bash
npm install
npm run typecheck
npm run test:fast
npm run dev:web                                  # dashboard
npm run research:ews -w @fractal-life/simulation  # critical-transition grid
npm run research:scope -w @fractal-life/simulation
npm run research:experiment -- --verify          # bit-exact reproduction
```

Outputs: `research/output/ews.{md,json,csv}`, `scope.*`, `plots/ews.svg`;
manifests under `apps/simulation/research/experiments/`. The dashboard shows the
same observables live, and the terminal exposes the same commands.

## References

See [`docs/REFERENCES.md`](docs/REFERENCES.md) and
[`thesis/references.bib`](thesis/references.bib). Core citations: Simon (1962);
Holland (1995); Crutchfield (1994); Bedau (1998, 2003); Fontana & Buss (1994);
Taylor et al. (2016); Kauffman (1993); Bak et al. (1987); May (1972); Price
(1970); Szathmáry & Maynard Smith (1995); Scheffer et al. (2009); Dakos et al.
(2008, 2012); Drake & Griffen (2010); Boettiger & Hastings (2012); Hastings &
Wysham (2010); Lenton (2011); Carpenter et al. (2011).
