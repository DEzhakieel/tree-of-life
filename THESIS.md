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
> indicators are at chance, skewness inverts, and the warning lead **shrinks** as
> the tipping point is approached more slowly. Re-analysing the same data under
> 1,056 defensible specifications shows which half of that result is load-bearing:
> the shrinking lead survives, the decline in AUC-based skill does not. The
> negative result is the scientific product; the instrument is what makes it
> credible, and the multiverse is what keeps us honest about its size.

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
**rejected**: skill falls with slower forcing (AUC ≈ 0.72 → 0.54, slope −0.0003,
R² 0.69) and the lead in stress units shrinks (CV slope −0.013, R² 0.89). We then
stress-test that rejection against 1,056 specifications of the analysis (order
parameter, window, detrender, baseline, threshold) over the same data. The result
is narrower than the registered one and more interesting for it: the lead-in-stress
shrinkage survives (60% of specifications reproduce its sign; seed bootstrap
[−0.0203, −0.0120]), while the AUC decline does not (27% of specifications give a
non-negative slope; bootstrap [−0.0005, 0.0000]). No analysis level explains the
effect away, but the multiverse median is a third of the registered magnitude. We
treat this as evidence that the generic theory does not transport unchanged across
the dimensionality, noise colour, and adaptive response of an evolving system. A
first ablation runs against one mechanism candidate: removing de-novo mutation
and lateral gene transfer leaves the lead slope unchanged (clonal retains 100%,
bootstrap [−0.0181, −0.0088] vs [−0.0203, −0.0120]), although quadrupling the
mutation supply cuts collapse from 43/48 to 25/48 (Fisher exact p = 9.1×10⁻⁵).
Evolutionary rescue changes whether the system collapses, not the warning lead,
so the mechanism question stays open and narrows to standing variation, crossover,
and detection-bar rigidity.

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
autocorrelation family is at chance; skewness moves the wrong way; and the warning
lead shrinks with slower forcing rather than staying calibrated in
control-parameter units. A 1,056-specification multiverse over the same data
sharpens the claim: the *lead* shrinkage survives the analysis space, while the
decline in AUC-based skill does not. The result is a boundary condition on the
theory, reported with the size the data support rather than the size the first
specification suggested.

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
| **Q5** | Is the Q3 failure bar rigidity, detrending artifact, vanishing order parameter, or evolutionary rescue? | Pre-registered multiverse + ablation leaves the slope unexplained | **Open** — multiverse run (1,056 specs), bar rigidity leading at 89% (bar 90%); M4 mutation-supply ablation refuted (E-EWS-12) |
| **Q6** | Do spatial indicators transport where temporal ones fail? | Spatial AUC ≤ 0.5 or no gain over temporal | **Open** |
| **Q7** | Does a direct response-function measure of critical slowing down succeed where AR(1) proxies fail? | Perturbation recovery time does not rise before collapse | **Open** |
| **Q8** | Does warning skill scale with system size (finite-size scaling)? | AUC independent of N across 100–2000 | **Open** |

### 4.1 Decisive tests for Q5

The Q3 rejection is a *phenomenological* result: the registered analysis rejects
calibration, but does not identify the mechanism. The first test has now been run
and it changed the statement of the problem.

**What the multiverse settled.** `npm run research:multiverse` re-analyses the same
48 runs under **1,056 specifications** (4 order parameters × 3 windows × 8
detrenders × 4 baseline estimators × 3 thresholds), holding the data fixed. Under
the pre-registered rule of E-EWS-11 — a level of an axis explains the failure only
if its median removes ≥50% of the registered slope **and** ≥90% of its
specifications are flattened — **no level qualifies**. The closest is an adaptive
(EWMA) detection bar: 100% median reduction, 89% of specifications flattened, one
percentage point short. Two consequences:

- the AUC half of the registered result is **specification-dependent** (median
  slope −0.0001 vs registered −0.0003; 27% of specifications non-negative;
  seed bootstrap [−0.0005, 0.0000]);
- the lead-in-stress half **survives** (median −0.0047, 60% negative, seed
  bootstrap [−0.0203, −0.0120]) but at a third of the registered magnitude.

So the robust claim is the *shrinking lead*, not the declining AUC, and the
mechanism question is narrowed rather than closed.

**M1 has to be restated.** The original wording — a slowly drifting baseline
widens the pre-ramp SD — is not identifiable in this design: the pre-ramp series
are bit-identical across τ for all 8 seeds (the ramp begins at the end of
burn-in, and the baseline window ends before it). A slow ramp cannot inflate a
baseline it never touches. The surviving mechanism is **bar rigidity**: the
detector's scale is fixed while the number of pre-collapse windows over which the
sustain rule acts grows with τ. *Test:* an adaptive (EWMA) bar or a baseline
estimated in stress units; there the median slope goes to zero (100% reduction)
but only 89% of specifications are flattened to within half the registered
magnitude — one point short of the pre-registered 90% bar — and 26% remain
negative, which is why the verdict is "leading candidate", not "supported".

The three remaining mechanisms are separable with the existing instrument:

- **M2 — detrending artifact.** The detrender may remove precisely the slow
  variance growth that is supposed to be the signal. *Test:* the detrender axis
  above; `none` and `ma50` preserve the slope (medians −0.0132, −0.0138) while
  `gauss10` removes it (0.0000). The inconsistency across smoothers is itself
  informative — the effect is not a monotone function of detrending strength.
- **M3 — vanishing order parameter.** Extinction drives absolute variance to
  zero, so the informative window is bounded away from the fold. *Test:* the
  order-parameter axis; `log` population leaves the slope negative (median
  −0.0062) but attenuates it, so scale explains part, not all.
- **M4 — evolutionary rescue.** Selection on metabolic efficiency buffers the
  stress, so the system is never as close to the fold as the ramp schedule
  implies. *Test (run):* `npm run research:ablation`, a dose–response in mutation
  supply — clonal ×0 / registered ×1 / elevated ×4, 8 seeds × 6 τ, with the
  registered arm re-simulated to prove the lever inert at ×1 and mutation supply
  counted directly as loci changed per birth (0 / 12.4 / 48.3, a 3.90× positive
  control). **Result: refuted (E-EWS-12).** The clonal arm retains 100% of the
  lead slope (−0.01422 vs −0.01419) and the two seed-bootstrap intervals nearly
  coincide, so removing de-novo mutation and lateral transfer does not flatten
  the shrinkage. Adaptation is nevertheless real: the ×4 arm collapses in 25/48
  runs against 43/48 for clonal (Fisher exact p = 9.1×10⁻⁵). Rescue changes
  *whether* the system collapses, not the warning lead. Mutation supply accounts
  for about half of the fragile AUC decline (clonal retains 52%) and none of the
  robust lead decline, and selection on standing founder variation and crossover
  remain untested.

The registered decision rule (E-EWS-11, fixed before the run): a mechanism is
supported only if its manipulation removes at least half of the slope **and** at
least 90% of its specifications are flattened to within half the registered
magnitude. No mechanism is declared on the basis of the current 8-seed data; the
89% result is reported as 89%, not rounded up to a finding.

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

**Calibration.** AUC declines with τ (≈0.72 for τ ≤ 750, ≈0.54 for τ ≥ 900;
slope −0.0003, R² 0.69). Lead in stress units shrinks with τ (CV slope −0.013,
R² 0.89; variance −0.014, R² 0.34). The fixed-distance prediction fails.

**Multiverse (1,056 specifications, same data).** Re-analysing rather than
re-simulating separates the robust half of that result from the fragile half:

| statistic | registered | median | 5–95% | negative | seed bootstrap |
|---|---:|---:|---|---:|---|
| AUC vs τ (variance) | −0.0003 | −0.0001 | −0.0003 to 0.0003 | 73% | [−0.0005, 0.0000] |
| lead(stress) vs τ (variance) | −0.0142 | −0.0047 | −0.0179 to 0.0047 | 60% | [−0.0203, −0.0120] |

The registered AUC interval reaches zero, and substituting log population removes
the AUC decline entirely; the lead shrinkage keeps its sign under most
specifications and its bootstrap interval excludes zero. Neither is rescued or
destroyed by changing the detection rule, because AUC is a rank statistic while
lead is not.

**Ablation (M4, 144 runs).** A dose–response in mutation supply — ×0 clonal / ×1
registered / ×4 elevated — tests whether adaptation produces the shrinkage. The
×1 arm reproduces the cached population series bit-for-bit and the supply is
counted at birth (0 / 12.4 / 48.3 loci per birth, 3.90×), so the manipulation is
verified rather than assumed. The clonal arm retains 100% of the lead slope
(−0.01422 vs −0.01419; bootstrap [−0.0181, −0.0088] vs [−0.0203, −0.0120]):
**refuted**. But the ×4 arm collapses in 25/48 runs against 43/48 (Fisher exact
p = 9.1×10⁻⁵), so adaptation is real and changes *whether* the system collapses.
Its lead slope is not reported — 8% detection and zero bootstrap resamples — which
is itself the honest handling of an unestimable quantity.

**What this does and does not license.** It licenses the statement that, under
this registered analysis in this ecology, the autocorrelation family carries no
warning and the lead in control-parameter units shrinks as the fold is approached
more slowly. It does **not** license "warning skill degrades" as a general claim:
that is the specification-dependent part. It also does not identify the mechanism
— no axis level met the pre-registered bar, and the closest (an adaptive bar, 89%
of specifications flattened against a 90% bar) is reported as close, not as
established.

## 6. From platform to programme: the inference gap

Programme-level complex-systems work is not defined by topic but by a standard
of inference: a sharp question, a mechanism, a null, a scaling argument, and
artifacts that let a skeptical reader redo the analysis. The gap analysis:

| Requirement | Current state | Next artifact |
|---|---|---|
| **Theory** | Verbal expectation of critical slowing down | Derive AUC(τ) for a ramped fold with demographic noise; predict the slope sign and magnitude |
| **Mechanism** | Q3 rejection is phenomenological; 1,056-spec multiverse run, no axis level met the bar; M4 mutation-supply ablation refuted (E-EWS-12) | Q5 M1–M4 ablations: standing-variation and crossover arms (M4), 32–64 seeds |
| **Causal identification** | Determinism + replay implemented | Q7 impulse-response experiment; placebo ramps; dose–response |
| **Scaling** | Single N ≈ 300–500 | Q8 finite-size sweep, 100–2000 |
| **Generalization** | One ecology, one genotype–phenotype map | Substrate (agents/particles/lattice/graph) and topology (torus/cylinder/sphere/Möbius/Klein) replication |
| **Statistics** | n = 8 seeds; hierarchical bootstrap + 1,056-spec multiverse implemented | 32–64 seeds; power analysis pre-registered |
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
- **Internal.** The detection threshold is estimated from the pre-ramp plateau,
  which is bit-identical across τ, so baseline drift cannot be the mechanism;
  the surviving internal explanation is bar rigidity, and an adaptive bar removes
  most of the effect (89% of specifications flattened). Detrending strength does
  not act monotonically (M2), so "the detrender eats the signal" is too simple.
- **External.** One ecology, one genome map, one topology, one noise model. The
  claim is about *this* class of systems until replicated.
- **Statistical.** Eight seeds per cell; windows within a run are not
  independent (pseudoreplication); five indicators × six ramp lengths is a
  multiple-comparison surface. The seed bootstrap gives the AUC slope an interval
  that reaches zero.
- **Specification.** This is the threat the multiverse measures: the registered
  lead slope (−0.0142) sits at the edge of its own specification space (median
  −0.0047), and 40% of defensible analyses give a non-negative slope. A single
  specification overstates certainty, including this thesis's first draft of the
  result.
- **Conclusion.** The mechanism is unidentified. "The theory does not transport"
  is supported for the *lead*; "because of adaptation" is not; "warning skill
  degrades" is specification-dependent.

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
baseline; (2) complete M2–M4 with 32 seeds, since the multiverse has already
narrowed M1 to bar rigidity and the M4 mutation-supply arm is refuted, leaving
the standing-variation and crossover arms; (3) run Q7's impulse-response measurement; (4) publish B with
A as the methods appendix; (5) only then extend to substrates and topologies.

## 10. What would falsify the thesis

- **T1** would fail if replay were not exact under interventions, or if
  counterfactual divergence were dominated by floating-point or scheduler
  effects. (Current evidence: cross-engine digests are bit-identical.)
- **T2** would collapse to a methods caveat if a pre-registered multiverse
  showed the lead-in-stress slope is an artifact of the threshold rule or
  detrender and vanishes under every reasonable specification. The 1,056-spec
  multiverse did not: no axis level met the bar, though the AUC decline did not
  survive either, which is why T2 is now stated in lead units only.
- **T3** would fail if ledger statuses could be revised after seeing the data
  without recording the revision. (Current practice: append-only ledger with
  claim IDs and artifacts — E-EWS-11 was registered before its run and resolved
  against its own author's expectation.)

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
npm run research:multiverse -w @fractal-life/simulation            # Q5: 1,056 analyses
npm run research:multiverse -w @fractal-life/simulation -- --from-cache  # re-analysis only
npm run research:ablation -w @fractal-life/simulation              # M4: mutation-supply ablation
npm run research:ablation -w @fractal-life/simulation -- --from-cache    # re-analysis only
npm run research:scope -w @fractal-life/simulation
npm run research:experiment -- --verify          # bit-exact reproduction
```

Outputs: `research/output/ews.{md,json,csv}`, `ews-multiverse.{md,json,csv}`,
`ews-multiverse-series.json` (the stored series that makes `--from-cache`
possible), `ews-ablation.{md,json,csv}`, `ews-ablation-series.json`, `scope.*`,
`plots/ews.svg`, `plots/ews-multiverse.svg`, `plots/ews-ablation.svg`; manifests
under `apps/simulation/research/experiments/`. The dashboard shows the same
observables live, and the terminal exposes the same commands.

## References

See [`docs/REFERENCES.md`](docs/REFERENCES.md) and
[`thesis/references.bib`](thesis/references.bib). Core citations: Simon (1962);
Holland (1995); Crutchfield (1994); Bedau (1998, 2003); Fontana & Buss (1994);
Taylor et al. (2016); Kauffman (1993); Bak et al. (1987); May (1972); Price
(1970); Szathmáry & Maynard Smith (1995); Scheffer et al. (2009); Dakos et al.
(2008, 2012); Drake & Griffen (2010); Boettiger & Hastings (2012); Hastings &
Wysham (2010); Lenton (2011); Carpenter et al. (2011).
