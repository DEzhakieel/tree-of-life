# Claim ledger

> **Policy.** This ledger is append-only. A claim enters with an ID, a
> falsifier, a registered analysis, and the artifact that will decide it. A
> status may change only by appending a dated revision that names the analysis
> and the artifact; the prior entry stays visible. Engineering checks (test
> counts, typecheck, internal novelty heuristics) are **not** claims and are
> never used as evidence.

The ledger operationalises the methodological claim of
[`../THESIS.md`](../THESIS.md): emergence is adjudicated by falsifiers and
artifacts, not by narrative. The thesis states the questions; this page keeps
score.

## 1. Early-warning claims (current vertical)

Experiment: `npm run research:ews -w @fractal-life/simulation` (from
`apps/simulation`). Design: 8 seeds × 6 ramp durations τ ∈ {300, 450, 600, 750,
900, 1050} = 48 runs, plus 8 no-ramp controls. Artifacts:
`research/output/ews.{md,json,csv}`, `research/plots/ews.svg`.

| ID | Claim | Falsifier | Registered analysis | Status |
|---|---|---|---|---|
| **E-EWS-01** | At least one generic indicator separates pre-collapse windows (40–250 ticks before collapse) from early-stationary windows. | No indicator with pooled AUC > 0.5 | ROC AUC per run, averaged over replicates; direction applied before scoring | **Supported** — variance 0.659 |
| **E-EWS-02** | Variance out-ranks lag-1 autocorrelation and recovery rate. | AR(1)/recovery ≥ variance | Same AUC, paired across runs | **Supported** — 0.659 vs 0.493 |
| **E-EWS-03** | Lead time is calibrated in control-parameter units: invariant to ramp duration τ. | Lead in stress units varies systematically with τ | Linear regression of lead (stress units) on τ; report slope and R² | **Rejected** — CV slope −0.013, R² 0.89 |
| **E-EWS-04** | The warning is specific to the forcing, not the environment. | No-ramp control collapses or sustains warnings | 8 no-ramp controls, 350+ ticks at `metabolismBase = 1` | **Supported** — 8/8 survive |
| **E-EWS-05** | The E-EWS-03 failure is explained by threshold drift (M1). | An EWMA baseline or a stress-unit-fixed threshold leaves the AUC–τ slope unchanged | Re-analysis of stored series + a fresh 32–64 seed run | **Open** |
| **E-EWS-06** | The E-EWS-03 failure is explained by the detrender (M2). | The slope survives a pre-registered multiverse of detrenders (none, MA 10/25/50, Gaussian, wavelet, SSA) | Multiverse analysis; distribution of slopes reported, not one specification | **Open** |
| **E-EWS-07** | The E-EWS-03 failure is explained by the vanishing order parameter (M3). | Log population and CV show the same or a steeper AUC–τ decline | Re-analysis with alternative order parameters | **Open** |
| **E-EWS-08** | The E-EWS-03 failure is explained by evolutionary rescue (M4). | A clonal, mutation-off ablation reproduces the slope | Ablation run at 8 seeds × 6 τ | **Open — narrowed** (2026-10-29): the mutation-supply component is refuted by E-EWS-12 (clonal retains 100% of the lead); standing founder variation and crossover are untested |
| **E-EWS-09** | Direct critical slowing down is measurable as a response function. | Perturbation recovery time does not rise before collapse | Branch-and-impulse at ticks along the ramp; λ(t) = −ln(‖δx(t+Δ)‖/‖δx(t)‖)/Δ | **Open** |
| **E-EWS-10** | Warning skill scales with system size. | AUC independent of N across 100–2000 | Finite-size sweep at fixed τ; hierarchical model | **Open** |
| **E-EWS-11** | The calibration failure is a property of the ecology, not of the analysis: it survives the space of defensible analysis choices. | Some level of some analysis axis removes ≥50% of the registered slope in ≥90% of its specifications | 1,056 specifications over one stored dataset (4 order parameters × 3 windows × 8 detrenders × 4 baselines × 3 thresholds); median/IQR, per-axis reduction, hierarchical-by-seed bootstrap | **Not supported** (2026-10-29): no axis level met both bars; best is EWMA baseline at 89% (bar 90%) |
| **E-EWS-12** | Evolutionary rescue (M4): removing the mutation supply flattens the lead-in-stress slope. | Clonal arm (`mutationScale` 0) retains < 50% of the registered lead slope, with a seed-bootstrap interval containing zero | 3 conditions (clonal ×0 / registered ×1 / elevated ×4) × 8 seeds × 6 ramp durations; registered spec plus the 1,056-spec multiverse per condition; mutation supply counted as loci changed per birth, plus genetic-variance trajectory; the ×1 arm must reproduce the cached Q5 series bit-exactly | **Refuted** (2026-10-29): clonal retains 100% of the lead slope (−0.01422 vs −0.01419), bootstrap [−0.0181, −0.0088] excludes zero; mutation supply 0 / 12.4 / 48.3 loci per birth (3.90×) |

**E-EWS-11 decision rule (registered before the data).** A level of an analysis
axis (order parameter, window, detrender, baseline, threshold) *explains* the
failure only if (a) its median slope removes at least half of the registered
slope and (b) at least 90% of its specifications are flattened to within half the
registered magnitude. Anything less leaves the mechanism open. Without (b), a
single lucky specification would be enough to "explain" a result — which is the
failure mode the multiverse exists to prevent.

Two structural facts about this design, registered with it:

1. **The AUC half is detection-rule independent by construction.** ROC AUC is a
   rank statistic over windows; only (order parameter, window, detrender) can
   move it. Any claim that the AUC–τ decline is a threshold artefact is therefore
   false *a priori*, and the multiverse reports the AUC and lead slopes
   separately for that reason.
2. **M1 as originally stated is not identifiable here.** The ramp begins at the
   end of burn-in and the baseline window ends before it, so the pre-ramp series
   are bit-identical across τ. A slow ramp cannot inflate the pre-ramp baseline.
   What the baseline axis can test is a different mechanism — *bar rigidity*, a
   detection bar whose scale is fixed while the number of pre-collapse windows
   grows with τ. The runner checks the identity of the pre-ramp series rather than
   assuming it.

**Registered decision rule (E-EWS-05…08).** A mechanism is supported only if its
manipulation removes at least half of the AUC–τ slope **and** the residual slope
is not significant under a hierarchical bootstrap over seeds. No mechanism will
be declared from the current 8-seed data.

**E-EWS-12 decision rule (registered before the data).** M4 predicts that
adaptation buffers the stress, so removing the *supply* of new variation should
restore lead invariance (slope toward zero). Three checks, all fixed in advance:

1. **Estimability.** The clonal arm must collapse in ≥ 50% of its runs and
   contribute ≥ 4 collapsed runs to the registered analysis. If it does not, the
   slope is not estimable and the verdict is *unresolved* regardless of the sign.
2. **Manipulation.** Mutation supply, counted directly as loci changed per birth
   (measured against the post-recombination genome, so sex is not mistaken for
   mutation), must be zero in the clonal arm and ≥ 1.5× the registered arm in
   the elevated arm. A clonal arm that still mutates, or an elevated arm that
   does not, has not been manipulated, and the verdict is *unresolved*.
3. **Effect.** M4 is **supported** only if the clonal arm retains < 50% of the
   registered lead slope and its seed-bootstrap interval contains zero; it is
   **refuted** if the clonal arm retains ≥ 50%; otherwise *unresolved*.

Two limits are registered with the rule. The ablation removes de-novo mutation
and lateral gene transfer but **not selection on the standing variation of the
300 founders**, so a null result bounds one component of M4, not the whole
hypothesis. And the clonal world is not a clean counterfactual: if it collapses
at a different rate, the slope is estimated on a different subset of runs, which
is why the collapse fraction is a check rather than a footnote. A monotone
dose–response in |slope| across ×0 / ×1 / ×4 is reported as supporting evidence
but cannot carry the verdict on 8 seeds.

**E-EWS-12 result (2026-10-29).** All three checks passed and the effect went the
wrong way, so the rule returns *refuted* rather than *unresolved*:

| arm | supply (loci/birth) | collapsed | lead slope | seed bootstrap | detection |
| :-- | ---: | ---: | ---: | :--: | ---: |
| clonal (×0) | 0.0 | 43/48 | −0.01422 | [−0.0181, −0.0088] | 33% |
| registered (×1) | 12.4 | 43/48 | −0.01419 | [−0.0203, −0.0120] | 28% |
| elevated (×4) | 48.3 | 25/48 | n/a | n/a | 8% |

The clonal arm retains **100%** of the registered lead slope (1.0018), and the
two bootstrap intervals nearly coincide, so removing the mutation supply does not
flatten it. The AUC half behaves differently: clonal retains 52% of the
registered AUC slope, so mutation supply accounts for about half of the *fragile*
AUC decline and none of the robust lead decline.

Two results sit beside the verdict and must not be collapsed into it:

- **Rescue is real.** Quadrupling the supply cut collapse from 43/48 to 25/48
  (two-sided Fisher exact p = 9.1e-5). Adaptation changes *whether* the system
  collapses. It does not change the warning lead at the registered supply.
- **The elevated arm has no slope.** With 8% detection and a zero-replicate
  bootstrap, its -0.0182 is fitted from two pre-collapse windows. It is reported
  as `n/a`, not as an estimate. A slope is only read above 20% detection and 100
  bootstrap resamples.

The honest reading is narrow: mutation supply is not the mechanism of the lead
shrinkage. Selection on standing founder variation and crossover remain
untested, so M4 as a family of mechanisms is not refuted - only its
mutation-supply component.

## 2. Experiment A - evolutionary doomsday

Question: **can a system that evolves to maximise reproduction become more
fragile?** Model: a Life-like cellular automaton on a 32×32 torus (B0
forbidden). The heritable unit is the 18-bit rule, not the cell; a rule's
offspring count is the number of 0 → 1 transitions it produces after a warm-up.
Eight lineage seeds × four arms (drift / weak 50% / moderate 25% / strong 12.5%
truncation), 20 generations, 14 rules per generation, two training soups, two
held-out soups. The ancestor is Conway plus 1–3 bit flips, viability-gated, and
is shared by all four arms of a seed. The environment is fixed for every
generation; the shock is applied only afterwards. `drift` is a
viability-filtered neutral walk with no selection on reproduction. The model is
self-contained in `research/`; it does not touch the agent engine.

Assay: 100-tick benign warm-up, then one sudden shock - per-cell noise
(0.2% / 1% / 5%), a one-off mortality pulse (20% / 50% / 80% of live cells), or a
compute budget that updates 50% / 25% / 10% of cells per tick. Endpoint: mean
population over the last 30 of 150 post-shock ticks divided by the pre-shock
population. Every shock level starts from the same post-warm-up snapshot, so the
comparison is paired.

| ID | Claim | Falsifier | Registered analysis | Status |
|---|---|---|---|---|
| **A-DOOM-01** | Reproduction gain is traded against robustness: lineages selected harder lose more retention under the primary shock. | Paired Spearman rho between held-out reproduction gain and retention change > −0.3, or its 95% interval includes 0 | Noise family first; death and compute reported beside it; 4,000-resample bootstrap over lineages | **Not supported** (2026-10-30): raw births rho −0.087 [−0.461, 0.286]; established offspring −0.282 [−0.645, 0.122] |
| **A-DOOM-02** | Selection itself causes the loss: selected endpoints retain less than their own drift controls. | selected − drift > −0.10, or interval includes 0, or selected endpoints do not fall below their own ancestors | Paired by lineage seed; median difference with bootstrap interval; `retentionDelta = final − ancestor`, so a loss is negative | **Not supported** (2026-10-30): raw births +0.018 [−0.028, 0.100]; established −0.034 [−0.059, −0.010], below the 0.10 floor |
| **A-DOOM-03** | The loss is dose-dependent across truncation intensities. | Dose rho > −0.8 or permutation p ≥ 0.05 | Spearman of retention change on dose (drift 0, weak 1, moderate 2, strong 3); 4,000 label permutations | **Not supported** (2026-10-30): dose rho 0.13 (p = 0.51) raw, −0.19 (p = 0.35) established |
| **A-DOOM-04** | Any loss is explained by elevated turnover rather than by specialisation. | Turnover–retention rho > −0.3 or interval includes 0, or the selected–drift contrast does not at least halve after adjustment | Spearman(turnover gain, retention change) + Theil–Sen turnover adjustment of the selected–drift median | **Not supported** (2026-10-30): raw rho −0.111 [−0.511, 0.281]; established −0.364 [−0.707, 0.044]; adjustment does not halve the contrast |

**Registered decision rule (fixed before the final run).** Three gates precede
the claim. *Manipulation*: the median held-out reproduction gain of selected
lineages must be positive and exceed the drift arm's. *Viability*: at least 60%
of selected endpoints must leave an assayable population after the benign
warm-up. *Meaningful effect*: the median selected − drift retention difference
must be at most −0.10, its interval must exclude zero, and selected endpoints
must fall below their own ancestors. The 0.10 floor is about twice the median
between-replicate SD of the family mean (0.048 / 0.054 / 0.060 for noise / death
/ compute), measured on the pilot; a statistically nonzero contrast smaller than
that is reported but is not a doomsday.

A-DOOM-04's adjustment uses a **Theil–Sen slope**, not least squares, because
three ancestors regrow from a few dozen cells after the shock and produce
retention ratios of 2–5; OLS is set by those points. The adjustment subtracts
`slope × turnoverGain` from every lineage's retention change and re-takes the
selected − drift median.

**Design revisions (recorded, not hidden).**

1. *Raw births saturate.* The first pilot selected on raw 0 → 1 counts and
   converged on the period-2 global flipper `B12345678/S-`: 40,960 births = 1,024
   cells × 40 ticks, the hard ceiling. Every selected endpoint was identical, so
   the dose axis carried no information. The final design runs **two fitness
   definitions over the same ancestors**: `births` (primary, the question as
   asked) and `established` (newborn cells still alive 5 ticks later). The
   second removes the flipper and grades the axis, but partly conflates
   reproduction with survival; neither is allowed to carry the verdict alone.
2. *Near-empty pre-shock populations are not assayable.* One ancestor (dd.e)
   held 3 live cells after the warm-up and scored a "retention" of 9.7 by
   regrowing, which dominated means and OLS fits. Replicates below 32 live cells
   before the shock (≈18% relative SD on the tail mean) are now excluded from
   retention and from every paired statistic: 28 of 32 lineages remain. The
   verdict under the previous, unfiltered assay was also *no-trade-off*, so the
   floor did not decide the outcome.
3. *Mediation statistic.* The three-predictor OLS was replaced by the robust
   adjustment above. The prior fit produced arm coefficients outside the
   possible range (1.9–2.3 on a 0/1 arm for a retention difference in [−1, 1]),
   a symptom of the same outliers. The verdict was unchanged.

**Result (2026-10-30).** All gates pass; nothing else does.

| endpoint | arm | held-out reproduction gain | retention delta (noise, median) | viable |
| :-- | :-- | ---: | ---: | ---: |
| raw births | drift | +7,550 | −0.023 | 100% |
| raw births | weak / moderate / strong | +32,882 / +32,876 / +32,894 | −0.041 / −0.052 / −0.057 | 100% |
| established | drift | +532 | −0.027 | 100% |
| established | weak / moderate / strong | +3,416 / +3,430 / +3,381 | −0.048 / −0.025 / −0.068 | 100% |

Under raw births the selected arms sit at the same near-ceiling gain, so the
three doses are effectively one treatment; under established offspring the gain
is graded but the retention cost is still under 0.07 at every dose and the dose
trend is non-monotone in sign (rho −0.19, p = 0.35).

The primary family (noise) gives rho −0.087 [−0.461, 0.286] for raw births and
−0.282 [−0.645, 0.122] for established offspring: the point estimate is negative
in both, the interval includes zero in both. Death and compute are not better:
raw-birth rho +0.194 and −0.033; established +0.068 and −0.215. The one interval
that excludes zero is the established selected − drift contrast under noise
(−0.034 [−0.059, −0.010]) — a **3.4-point** median retention cost, one third of
the pre-registered floor, and not accompanied by a dose trend. Median final
retention of the selected endpoints is 1.01 / 1.01 / 1.03 (noise / death /
compute) under raw births and 1.00 / 1.01 / 1.06 under established offspring:
the shocks barely dent them. The same assay does discriminate for other rules —
Conway retains 2.20 under noise, **0.37 under the mortality pulse**, and 2.16
under the compute budget — so the null is not an insensitive instrument.

**Honest reading.** In this class of replicators, selection for reproduction did
not buy fragility at any dose we could apply. The best-supported statement is a
direction, not an effect: better replicators were *slightly* less robust under
noise once reproduction was scored as surviving offspring, and the effect is an
order of magnitude below the noise floor of the assay. The trade-off may exist
outside this regime — larger lattices, longer evolution, selection on
multi-species ecologies, or shocks that persist instead of arriving once.
Nothing here rules it out; it rules out the strong version, in this model, at
this scale.

Artifacts: `research/output/doomsday.{md,json,csv}`,
`research/output/plots/doomsday.svg` (primary endpoint). JSON holds both
endpoints (`primary`, `secondary`). Reproduce with
`npm run research:doomsday` (~2 min) or `-- --from-cache` (seconds).

## 3. Experiment B - self-replication that attacks itself

Question: **can a first-level structure reproduce while its own offspring
destroy the second-level reproduction mechanism?** Model: a probabilistic
birth–death process on a 40×40 torus with two explicit scales of reproduction.
The model is self-contained in `research/`; it does not touch the agent engine.

- **Scale 1 (local).** A cell divides into a nearby empty site (8-neighbourhood,
  then Chebyshev radius 2). Heritable traits are `build ∈ {0,1,2}` (investment in
  the scale-2 organ; 0 is a defector) and `fec ∈ {1,2,3}` (local fecundity). Birth
  probability is `0.06 × (1 + 0.25·(fec−2)) × (1 − 0.25·build)`; death is
  crowding-driven, `0.012 + 0.16·(n/8)²`, and a dead site is barren for 25 ticks.
- **Scale 2 (collective).** A **nest** is a persistent site-level individual. It is
  initiated by a builder with a quorum of four same-tag builders, spaced at
  Chebyshev radius 2. Its integrity rises with the local builder fraction and
  decays otherwise; it gives its lineage a birth bonus in the 3×3 block, charges
  from that local builder fraction, and at full charge releases a propagule at
  dispersal range 6–12. The propagule carries the nest's **current modal
  genotype**, not its founder's.

The self-attack is structural, not imposed: a nest is a club good for its tag. A
non-builder mutant of that tag keeps the benefit, skips the build burden and
divides faster; it dilutes the builder fraction, integrity falls, the nest stops
reproducing, and because the propagule carries that genotype the defection
travels to the next generation of nests.

Three interventions act on three distinct links, singly and in all combinations
(full 2³ factorial, eight conditions):

| key | link | manipulation |
|---|---|---|
| `cost` | small structure | birth probability multiplied by `1 − 0.20·(fec−1)`, so fast local reproduction pays per birth |
| `boundary` | cross-scale boundary | the propagule carries the nest's **founding `build` genotype** (germline sequestration); fecundity still evolves through the bottleneck |
| `signal` | inter-scale signal | nests emit a field (decay 0.8, spread 0.5) that halves `build=0` births within reach, at 60% of their charge rate |

`boundary` is deliberately narrow: it seals transmission of the cooperative
trait only. Its result does not generalise to other boundary mechanisms
(spatial sealing, membership policing), which are not implemented.

**Registered design.** 8 fresh seeds `sa.0`…`sa.7` × 8 conditions × 1,200 ticks.
Early window ticks 170–319 (after a 120-tick burn-in); late window the final 150
ticks. Every run is paired by seed. The pilot seeds (`sb.`, `sc.`, `chk.`) are
**excluded** from the confirmatory run: they were used to design the model and
are exploratory only. The module's RNG stream differs from the prototype's, so
prototype pilot seeds are not reproducible in the module in any case.

| ID | Claim | Falsifier | Registered analysis | Status |
|---|---|---|---|---|
| **B-SELF-01** | In the unmanaged control, local reproduction persists to the end of the run while scale-2 reproduction collapses and the builder fraction is more than halved. | Local birth retention < 0.50, or propagule retention > 0.50, or builder retention > 0.75, each read as a confidently contrary interval | Control only, `n = 8`; late/early ratios; 2,000-resample bootstrap over seeds. Pass: birth retention ≥ 0.80 with lo > 0.50; propagule retention ≤ 0.25 with hi < 0.50; builder retention ≤ 0.50 with hi < 0.75 | **Supported** (2026-10-31): birth retention 1.078 [1.072, 1.085]; propagule 0.113 [0.049, 0.194]; builder 0.161 [0.094, 0.247] |
| **B-SELF-02a** | Intervening on the small structure alone raises late scale-2 reproduction above control by at least the between-seed floor, with a paired interval above zero. | Point difference < 0 | `cost` vs control, paired by seed; floor = 2 × between-seed SD of the control late propagule rate; 2,000-resample bootstrap of the paired difference | **Inconclusive** (2026-10-31): delta +0.258 [+0.049, +0.508], a positive effect below the 0.351 floor |
| **B-SELF-02b** | Intervening on the cross-scale boundary alone does the same. | Point difference < 0 | as 02a, `boundary` vs control | **Refuted** (2026-10-31): delta −0.074 [−0.202, +0.034]; no rescue, point estimate below zero |
| **B-SELF-02c** | Intervening on the inter-scale signal alone does the same. | Point difference < 0 | as 02a, `signal` vs control | **Supported** (2026-10-31): delta +0.462 [+0.260, +0.635] |
| **B-SELF-03** | Late scale-2 reproduction is gated by the local builder fraction (Spearman rho ≥ 0.70, interval lo > 0.50) and not by the late local birth rate (\|rho\| < 0.50). The causal bottleneck separating local from hierarchical reproduction is the collective's builder supply. | Builder rho < 0.50, or \|birth rho\| ≥ 0.70 | Spearman over all 64 runs; 2,000-resample bootstrap over runs | **Inconclusive** (2026-10-31): builder rho 0.868 [0.778, 0.924] passes, but birth rho −0.527 [−0.709, −0.293] fails the \|rho\| < 0.50 clause |
| **B-SELF-04** | The three interventions are super-additive: applying all three exceeds the sum of the three single-link gains over control by at least the between-seed floor, with a paired interval above zero. | Interaction < 0 (sub-additive) | Interaction contrast `all − cost − boundary − signal + 2·control` on the late propagule rate, paired by seed; same floor as 02a; 2,000-resample bootstrap | **Refuted** (2026-10-31): interaction −0.090 [−0.460, +0.269]; sub-additive, and the combination adds nothing over signal alone |

**Decision rule (fixed before the confirmatory run).** A claim is *supported*
only when its point estimate meets the registered threshold **and** the 2,000-
resample bootstrap interval is on the required side of zero. It is *refuted*
when its registered falsifier fires — for 01, a confidently contrary interval on
any gate; for 02a–c, a negative point difference; for 03, builder rho < 0.50 or
absolute birth rho ≥ 0.70; for 04, a negative interaction. Everything else is
*inconclusive*: an underpowered null is not evidence for the null, and a
supported-direction interval that misses the floor is not a rescue.

**Effect floor.** `2 × between-seed SD of the control late propagule rate`,
computed on the confirmatory controls. It is a noise floor derived from
between-seed variability, not a value fitted to the observed effects. The
super-additivity floor is the same quantity. At 8 seeds the paired bootstrap has
limited resolution; this is registered as a limitation, not repaired by
increasing the seed count after seeing the result.

**Result (2026-10-31).** 64 runs completed; the registered rule was applied
unchanged. The effect floor is 0.351 propagules/tick (control late rate 0.170,
between-seed SD 0.176).

- **B-SELF-01 supported.** Control local births 30.5 → 32.8 per tick (retention
  1.078 [1.072, 1.085]), propagule rate 1.43 → 0.17 (0.113 [0.049, 0.194]),
  builder fraction 0.87 → 0.15 (0.161 [0.094, 0.247]); defectors 0.15 → 0.86 and
  population 695 → 715. The decoupled state is reached in 6 of 8 runs, at median
  tick 895. One seed (sa.6) kept 0.36 of its early rate, so this is a mean effect
  with escapes, not a uniform extinction.
- **B-SELF-02a inconclusive.** `cost` adds 0.258 [0.049, 0.508] propagules/tick.
  The interval excludes zero, but the effect is below the pre-registered 0.351
  meaningful floor. The floor, not the sign, decided this claim.
- **B-SELF-02b refuted.** `boundary` adds −0.074 [−0.202, 0.034]: sealing the
  build trait at the cross-scale transmission did not rescue scale-2
  reproduction in this implementation, and the point estimate is negative.
- **B-SELF-02c supported.** `signal` adds 0.462 [0.260, 0.635] propagules/tick,
  the only single-link intervention above the floor.
- **B-SELF-03 inconclusive.** The builder fraction tracks the late propagule
  rate strongly (rho 0.868 [0.778, 0.924]), but the local birth rate does not
  meet the registered "unrelated" clause (rho −0.527 [−0.709, −0.293],
  |rho| > 0.50). The builder-supply link is real; the claim that it is the
  *exclusive* gate is not established. The negative birth correlation is
  consistent with the build burden — builder-rich runs divide less locally yet
  reproduce more at scale 2 — but that reading was not the registered test.
- **B-SELF-04 refuted.** Interaction −0.090 [−0.460, 0.269]: sub-additive.
  `signal` alone gives 0.632 late propagules/tick and all three give 0.727, a
  difference the floor cannot resolve. In this ecology the inter-scale signal is
  the binding constraint, and the other two links do not add to it.

**Honest reading.** The headline question is answered yes *in this model*: local
reproduction persists (population 695 → 715, births 30.5 → 32.8) while
second-level reproduction falls by an order of magnitude (1.43 → 0.17) and the
builder fraction collapses (0.87 → 0.15). The causal claim is narrower than
registered: builder supply is strongly associated with scale-2 output, but local
birth rate is not independent of it, so the bottleneck was not isolated by the
registered correlation. Of the three links, only the inter-scale signal clears
the meaningful-effect floor; the small-structure penalty has a real but smaller
effect, and germline sequestration of the cooperative trait does not help.
Nothing here shows that boundary mechanisms are useless — only that this one, in
this ecology, is not the binding constraint.

**Exploratory pilot (not evidence).** Four earlier designs were discarded:
resource-flux cells starved; ring geometry saturated the lattice; a shared
resource still saturated; an energy economy stalled division at the threshold.
The registered model is the fifth. In the module pilot (3 `chk.` seeds, 1,200
ticks) the control went from 0.88 to 0.09 builders and retained 0.06 of its
propagule rate; `signal` held 0.73 propagules/tick late, `cost` 0.38,
`boundary` 0.43, `all` 0.83. With four `sb.` seeds `boundary` held 0.11 against
a control of 0.06. The pilot therefore predicts that 02a and 02c can pass, that
**02b is seed-sensitive and may not**, and that the three-way combination is
**sub-additive** (interaction ≈ −0.3 to −0.5, because the signal already
saturates the rescue). B-SELF-04 is registered in the super-additive direction
precisely so that this expectation can fail; a refutation there is a result, not
a null.

**Manipulation checks (engineering QA, not evidence).** Within-run determinism;
identical seeds reproduce identical series; `boundary` propagules never carry
`build = 0`; control runs do emit `build = 0` propagules; traits stay in range.
These are tests, not claims.

**Not claimed.** That this is a general law of major evolutionary transitions.
The model implements three specific mechanisms and their relative strength is a
property of this ecology. That `boundary` is ineffective in general: only
germline sequestration of `build` was tested. That the control collapse is
adaptive or inevitable: it is a parameter-dependent outcome of mutation rate,
build burden and nest bonus.

## 4. Experiment C - the kill-switch map

Question: **which directed perturbation most effectively destroys an emergent
colony, and is a cell's reproductive participation a causal necessity or only a
correlate?** The model is self-contained in `research/`; it does not touch the
agent engine.

### Model

A colony on a 48 × 48 torus, 750 ticks, perturbation at tick 250 after a shared
burn-in. The seed is a disc of radius 6. Each occupied cell contributes to a
colony-level public good in proportion to its local crowding, `(n/4)^2` with `n`
the number of occupied 4-neighbours. The good is well mixed inside each
connected component, decays by 15% per tick, caps at 8, and gates birth at the
quorum threshold `S_MIN = 3.0`. Births consume a global nutrient pool that caps
population; death rises when the good is low and when a cell is exposed (few
neighbours). Above the quorum the colony replaces itself; below it no cell can
divide and the colony decays.

Two assumptions are registered with the model. The public good is
**component-mixed, not locally diffusive**: the experiment tests colony-level
quorum maintenance, not local signalling. A cell's lifetime division count is a
**marker, not a mechanism**: it is not read by birth or death, so any difference
between the participation and matched arms is a spatial/demographic effect, not
a direct cost of dividing.

### Registered design

16 fresh seeds `ck.0` … `ck.15`. The pilot seeds `ck.p0` … `ck.p9` are
exploratory only and are excluded. Each seed contributes 46 runs:

- **12 conditions** (40% lesion unless noted): `control`, `core`, `rim`,
  `participation` (top lifetime divisions), `matched` (density-matched random),
  `ageMatched` (5-tick age-bin-matched random, excluding the target set),
  `random` (uniform), `seal` (wall ring at 0.6 × colony radius),
  `randomEdges` (the same number of random internal links),
  `delayCore`, `delayRim`, `delayParticipation` (100-tick freeze, then lifted).
- **4 dose curves × 6 doses** `{0.05, 0.10, 0.15, 0.20, 0.30, 0.40}` for
  `participation`, `matched`, `ageMatched`, `random`.
- **10 location points**: a compact 40% lesion at the centroid, eight
  mid-radius azimuths, and the rim (0.9 × colony radius).

Total 736 runs. Every comparison is paired by seed. All conditions share the
same pre-perturbation trajectory; dynamics and perturbation choices use two
independent RNG streams (`killswitch:dyn:<seed>`, `killswitch:pert:<seed>`), so a
perturbation cannot shift the noise sequence the control sees. Code:
`apps/simulation/src/research/killSwitch.ts`; runner:
`apps/simulation/src/research/killSwitchRun.ts`; tests:
`apps/simulation/test/killSwitch.test.ts`.

### Metrics

- **Destruction**: final population below 5% of the pre-lesion count.
- **Recovery**: first tick after a dip below 90% of the pre-lesion count at
  which the population is back to 90%. Runs that never dip are reported
  separately; runs still below 90% at the end are censored.
- **Loss**: `1 - final / control final` for the same seed. Positive means the
  perturbation left the colony smaller than its paired control.
- **Fragmentation**: number of connected components and the largest component
  as a fraction of surviving cells, measured immediately after the perturbation.

### Assay viability gate

The assay is valid only if the 16 controls give at least 5 runs, control
destruction at most 0.20, and at least 70% of controls at a final/pre ratio of
0.50 or more. If the gate fails, every Experiment C claim is reported
**inconclusive** regardless of its point estimate.

### Effect floors

- Destruction-probability difference: **0.30** (about 5/16 paired runs). This is
  a practical-significance floor fixed in advance, not estimated from the
  confirmatory data.
- Interface loss: `max(2 × between-seed SD of random-edge loss, 0.10)`.
- Location equivalence: **±0.15** in loss.

Paired intervals use 2,000-resample bootstrap over seeds. A claim is
**supported** only when its point estimate clears the registered floor **and**
the paired interval lies on the required side of zero. It is **refuted** when
its registered falsifier fires. Everything else is **inconclusive**; a
supported-direction interval that misses the floor is not a kill switch.

### Registered claims

| ID | Claim | Falsifier | Registered analysis | Status |
|---|---|---|---|---|
| **C-KILL-01** | Removing the 40% most participatory cells destroys the colony at least 0.30 more often than removing a uniform random 40%, with a paired 95% interval above zero. | Paired mean difference ≤ 0 | `participation − random`, paired by seed; 2,000-resample bootstrap; floor 0.30 | **Supported** (2026-10-31): participation 9/16 vs random 3/16; difference 0.38 [0.06, 0.63] |
| **C-KILL-02** | Participation is not merely age or density: removing the 40% most participatory cells destroys the colony at least 0.30 more often than either an age-matched random set or a density-matched random set, with paired intervals above zero. | Either paired mean difference ≤ 0 | `participation − ageMatched` and `participation − matched`, paired by seed; 2,000-resample bootstrap; floor 0.30 on both | **Supported** (2026-10-31): vs ageMatched 0.56 [0.31, 0.81]; vs densityMatched 0.38 [0.19, 0.63] |
| **C-KILL-03** | The interface is a partial kill switch: sealing the core–periphery boundary damages the colony more than cutting the same number of random internal links, but leaves the core alive. | Seal loss difference ≤ 0, **or** seal destruction ≥ 0.50 | `seal − randomEdges` loss, paired by seed; 2,000-resample bootstrap; floor `max(2×SD(randomEdges loss), 0.10)`; destruction gate 0.50 | **Inconclusive** (2026-10-31): seal − randomEdges loss 0.012 [−0.017, 0.040], below the 0.173 floor; seal destruction 0/16. Falsifier did not fire, but the effect did not clear the floor |
| **C-KILL-04** | A pause is weaker than a lesion: a 100-tick pause of the most participatory cells destroys the colony at least 0.30 less often than permanent removal, and at least half of paused runs end at 90% or more of their contemporaneous control final population. | Pause destruction ≥ removal destruction, **or** fewer than 30% of paused runs recover to 90% of control final | `delayParticipation` vs `participation`; recovery fraction against the paired control final; destruction floor 0.30 | **Supported** (2026-10-31): pause 0/16 vs removal 9/16; 12/16 paused runs end at ≥90% of their paired control final |
| **C-KILL-05** | Compact-lesion location is not a major determinant: centre-minus-rim loss is smaller than 0.15 in absolute value, with the paired 95% interval inside ±0.15. | Pair interval lies entirely outside ±0.15 | Centre (radius 0) minus rim (radius 0.9) loss, paired by seed; 2,000-resample bootstrap; equivalence margin 0.15. Spearman rho(distance, loss) is reported descriptively, not as the verdict | **Supported** (2026-10-31): centre − rim loss −0.002 [−0.045, 0.040]; sweep rho 0.00 [−0.12, 0.12] |

### Registered interpretation

The design can return a negative map. If no small directed lesion clears the
floor, the honest result is that the colony has no small kill switch in this
model: geometric core, rim, interface seal, pause and lesion location are not
sufficient, and only large distributed removal of highly participatory cells
collapses it. C-KILL-03 and C-KILL-05 are explicitly expected-null candidates;
they are registered in the positive direction so that a null is a verdict, not
an unstated default. C-KILL-01 and C-KILL-02 are the headline tests. C-KILL-04
asks whether a temporary pause is weaker than permanent removal.

### Result (2026-10-31)

736 runs completed and the registered rule was applied unchanged. The assay is
valid: 16 controls, 0/16 destroyed, mean final/pre **0.81** (minimum 0.67).

| arm | destroyed | final / pre | loss vs control |
|---|---:|---:|---:|
| control | 0/16 | 0.81 | 0.00 |
| participation (40%) | **9/16** | 0.36 | 0.55 |
| matched, density (40%) | 3/16 | 0.68 | 0.16 |
| random (40%) | 3/16 | 0.66 | 0.17 |
| ageMatched (40%) | 0/16 | 0.82 | −0.02 |
| core (40%) | 0/16 | 0.79 | 0.02 |
| rim (40%) | 0/16 | 0.77 | 0.04 |
| seal | 0/16 | 0.79 | 0.02 |
| randomEdges | 0/16 | 0.80 | 0.01 |
| delayParticipation | 0/16 | 0.79 | 0.02 |

`delayCore` and `delayRim` also destroyed 0/16 (final/pre 0.79 and 0.77). The
location sweep destroyed 0/16 at all ten points; loss ranged from −0.022 to
+0.023, with centre +0.020 and rim +0.023.

The dose response has a sharp threshold at the top dose:

| dose | participation | matched | ageMatched | random |
|---:|---:|---:|---:|---:|
| 0.05–0.20 | 0/16 | 0/16 | 0/16 | 0/16 |
| 0.30 | 2/16 | 2/16 | 0/16 | 0/16 |
| 0.40 | **9/16** | 3/16 | 0/16 | 3/16 |

The five verdicts:

- **C-KILL-01 supported.** Participation 9/16 (56%) vs random 3/16 (19%);
  difference **0.38** [0.06, 0.63], floor 0.30. Seven participation runs
  survived, so this is not a universal kill.
- **C-KILL-02 supported.** Participation − ageMatched **0.56** [0.31, 0.81];
  participation − densityMatched **0.38** [0.19, 0.63]. All three
  density-matched kills (`ck.7`, `ck.11`, `ck.13`) are a subset of the nine
  participation kills (`ck.0`, `ck.4`–`ck.8`, `ck.11`–`ck.13`); the six
  participation-only kills carry the density contrast. The age-matched arm
  removed 305 cells on average rather than the nominal 328 (93%), because some
  5-tick age bins were exhausted; that asymmetry slightly favours participation
  in the age comparison. The density-matched arm removed exactly 328 cells and
  does not have that asymmetry.
- **C-KILL-03 inconclusive.** Seal − randomEdges loss **0.012** [−0.017, 0.040],
  below the 0.173 floor; seal destruction 0/16. The falsifier did not fire
  (the difference is positive and the colony survives), but the effect is far
  below the registered meaningful floor. Connectivity loss alone is not lethal
  here: the seal does fragment the colony (largest component 0.78 of survivors
  vs 0.98 for random edges) without destroying it.
- **C-KILL-04 supported.** Pause 0/16 vs permanent removal 9/16; **12/16**
  paused runs end at ≥90% of their paired control final. One caveat is visible
  in the summary table and must not be read as a rescue: only 4/16 paused runs
  return to 90% of *their own pre-lesion* count (median 249 ticks among those
  four; 12 censored). The controls themselves end at 0.81 of their pre-lesion
  count, so a 90%-of-own-baseline recovery is rarely reachable in any arm; the
  registered C-KILL-04 recovery clause deliberately used the contemporaneous
  control final instead. The pause leaves a small residual deficit (final/pre
  0.79, loss 0.02), not a collapse.
- **C-KILL-05 supported.** Centre − rim loss **−0.002** [−0.045, 0.040], inside
  ±0.15; sweep rho(distance, loss) 0.00 [−0.12, 0.12]. A compact 40% lesion is
  equally survivable wherever it lands.

**Honest reading.** The map is mostly negative for geometry, interface and
pause: the geometric core, the rim, the core–periphery seal, a 100-tick pause
and the lesion's location are not kill switches at this scale. The registered
positive result is narrower and larger than "a small disturbance": removing the
**40% most participatory cells** is a distributed lesion of 328 cells (about
40% of the colony), and it still leaves 7/16 colonies alive. Within that limit,
the effect is not explained by age or density alone, and the density-matched
kills are a strict subset of the participation kills. The participation arm is
also the most fragmented (111 components, largest 0.19 of survivors), but
fragmentation is not sufficient: density-matched and random lesions fragment
almost as much (95/81 components, largest 0.14/0.23) and mostly survive. The
dose curve shows that the specificity is a high-dose phenomenon: at 30% the
participation and density-matched arms each destroy 2/16; only at 40% do they
separate (9/16 vs 3/16).

**Limits.** Five contrasts were tested on 16 seeds with no family-wise
correction; the lower bounds of C-KILL-01 and the density half of C-KILL-02 are
one and three paired runs above zero (0.0625 and 0.1875), so a few seeds could
move the verdicts. The public good is component-mixed rather than locally
diffusive; lifetime division count is a marker, not a mechanism; destruction is
a 5% extinction threshold, not a functional-death assay; and the result is one
48 × 48 ecology at 750 ticks. It does not establish that participation is
causally necessary in general, only that removing the most participatory cells
is the one registered intervention that clears the floor here.

### Pilot disclosure (exploratory, not evidence)

Two 5-seed pilots (`ck.p0` … `ck.p4`, `ck.p5` … `ck.p9`) ran the full 230-run
design before registration. They are design evidence only and are not reused.
Combined: control viable, final/pre 0.79–0.83; participation destruction 5/10 vs
random 1/10, density-matched 1/10, age-matched 1/10; core, rim, seal and all
pause arms 0/10; the compact-lesion location sweep was null; the participation
dose threshold sat near 0.30–0.40. Fragmentation did not cleanly separate the
participation arm from its controls: after a 40% participation lesion the largest
component was 0.17 of survivors, versus 0.16 for density-matched and 0.20 for
random, while participation still destroyed more colonies. The pilot therefore
motivates the age/density controls in C-KILL-02; it does not establish them.

Parameter excursions during model design (production exponent 3–4, production
1.5–2.0, decay 0.19) were rejected before registration because they either
collapsed the controls or made random removal lethal. The registered parameters
are the original `PROD = 1.0`, `PROD_EXP = 2`, `DECAY = 0.15`. No model or
analysis change will be made after the confirmatory seeds are opened; any later
change is appended to the revision log and the affected claims are re-reported,
not silently folded into this pre-registration.

### Manipulation checks (engineering QA, not evidence)

Within-run determinism; identical pre-burn trajectories across conditions; exact
lesion counts; equal seal and random-edge counts; delayed cells frozen and then
lifted; destruction consistent with the 5% threshold; report reproducibility from
serialised observations. These are tests, not claims.

### Artifacts and reproduce

`research/output/kill-switch.{md,json,csv}`,
`research/output/plots/kill-switch.svg`, cache
`research/output/kill-switch-series.json`. Reproduce with
`npm run research:killswitch` (736 runs) or `-- --from-cache` (re-render only).

## 5. Legacy scope claims (v1.0.0, 2026-10-16)

Pre-registered statistical claims over the engine's behaviour, canonical-model
reproduction, and published measurements. Regenerate with
`npm run research:scope -w @fractal-life/simulation`; artifacts
`research/output/scope.*`.

| Outcome | Count |
|---|---:|
| Supported | 23 |
| Refuted | 2 |
| Inconclusive | 9 |
| **Total** | **34** |

Refutations, kept visible:

- **C-AI-03** — the learned steerer performed **worse** than a do-nothing
  control. Consequence: the AI proposer is retained for hypothesis generation,
  not online control.
- **C-SIG-01** — the costly-signalling prediction did not hold in the tested
  regime. Consequence: a boundary condition on the imported theory, not a
  platform failure.

Full per-claim effects and intervals: `research/output/scope.json` and
[`RESULTS.md`](RESULTS.md).

## 6. Experiment D - predicting collapse before it is visible

Question: **can an emergent colony's collapse be predicted from its first 100
ticks, on rules and parameter regimes the model has never seen, and does the
prediction stay calibrated?** The experiment runs the agent engine unchanged and
does not intervene; it is a held-out prediction test, not a causal claim.

### Design

24 conditions = 3 mutation rules × 8 parameter regimes. The rule is
`world.mutationScale`; the parameters are basal metabolism and food
regeneration:

| regime | `metabolismBase` | `foodRegenRate` | split |
| :-- | ---: | ---: | :-- |
| P0 | 6 | 0.0027 | train |
| P1 | 8 | 0.0027 | train |
| P2 | 10 | 0.0027 | train |
| P3 | 12 | 0.0027 | test (unseen parameter) |
| P4 | 8 | 0.0018 | test (unseen parameter) |
| P5 | 10 | 0.0018 | test (unseen parameter) |
| P6 | 12 | 0.0018 | train |
| P7 | 16 | 0.0018 | train |

Rules: `clonal` (`mutationScale = 0`), `legacy` (`1`), `elevated` (`4`).
Training conditions are `clonal`/`legacy` × P0,P1,P2,P6,P7 (10 conditions) on
fresh seeds `d.c0` … `d.c7`. Test conditions are `elevated` × all 8 regimes
(unseen rule) plus `clonal`/`legacy` × P3,P4,P5 (unseen parameter regimes), 14
conditions on seeds `d.c8` … `d.c15`. Each condition contributes 8 runs, 192 in
total. No seed and no condition is shared between fit and evaluation.

Every run is 600 ticks with 300 founders, `maxPopulation = 500`, and
`deadRetention = 0`. Dead agents are retained in the engine only for lineage and
are never read by the update equations, so the zero retention is
dynamics-preserving; it keeps the 192 sequential runs inside the memory budget.
The experiment does not modify the engine.

**Labels.** The early window is ticks 40–140, sampled every 5 ticks (21
samples); no later observation is a predictor. The outcome window is ticks
500–599. A run is a collapse if its late mean alive count is **< 10**, a
persistence if it is **≥ 30**, and ambiguous in the 10–30 interval. Ambiguous
runs are excluded from fitting and scoring and are counted in the report. The
thresholds are absolute rather than relative to the founder peak because pilot
runs showed that a stressed world can settle at a low but nonzero population.

**Features (14).** Population: log mean alive, log-population trend per 100
ticks, coefficient of variation, lag-1 autocorrelation, mean-crossing rate
("flicker"), trough/mean. Entropy: species Shannon entropy (bits) and
normalised spatial entropy on a 16 × 16 torus grid. Spatial structure: Moran's
I with rook weights, occupied-neighbour fraction, occupancy, largest 4-connected
component as a fraction of occupied bins, radius of gyration around the circular
centroid. Energy: mean energy / capacity. No condition label, rule, parameter
value, or late-window quantity enters the feature vector.

**Model.** L2-regularised logistic regression fitted by Newton–Raphson/IRLS on
the training split only, with the penalty `λ = 0.1` fixed in advance and
features standardised on the training mean and standard deviation. The
intercept is unpenalised. Baselines and ablations fit the identical
specification on the same training runs: training base rate, population
size-plus-trend (`logMeanPop`, `popTrend`), temporal-only (the six population
features), entropy-only (the two entropy features), structure-only (the five
spatial-structure features), full-minus-entropy, and full-minus-structure.

**Uncertainty.** Intervals are 95% percentile intervals from 1,000 condition-
cluster bootstrap resamples: whole test conditions are resampled, not individual
runs, because runs within a condition are not independent. The same resampling
seeds are used for every contrast.

**Label gate.** At least 8 labelled runs and at least 3 collapses and 3
persistences in **each** split are required. If the gate fails, every
Experiment D claim is reported **inconclusive**; no verdict is issued.

### Registered claims

A claim is **supported** only when its point estimate clears the registered
floor **and** its interval lies on the required side. It is **refuted** when its
falsifier fires. Everything else is **inconclusive**. All floors and the gate
are fixed before the confirmatory seeds are opened.

| ID | Claim | Falsifier | Registered analysis | Status |
|---|---|---|---|---|
| **D-PRED-01** | The full early-window model discriminates collapse from persistence on unseen conditions: test AUC ≥ 0.70 with a condition-cluster bootstrap lower bound > 0.50. | Test AUC ≤ 0.50 | Full 14-feature logistic model; test AUC; 1,000-resample condition-cluster 95% interval | **Supported** (2026-10-31): test AUC 0.885 [0.825, 0.941] on 92 labelled runs (59 collapses) |
| **D-PRED-02** | The full model beats the population-size-plus-trend baseline by ΔAUC ≥ 0.05 with a bootstrap lower bound > 0, and has Brier skill ≥ 0.10 against the training base rate. | ΔAUC ≤ 0 | `full − population` AUC, paired by condition in the same bootstrap; Brier skill on the test runs; floor 0.05 | **Inconclusive** (2026-10-31): ΔAUC 0.173 [0.103, 0.288] clears the AUC clause, but Brier skill −0.060 misses 0.10; falsifier did not fire |
| **D-PRED-03** | The full model is calibrated out of condition: ECE ≤ 0.10 over five probability bins and calibration slope in [0.5, 1.5]. | ECE > 0.20 **or** calibration slope outside [0, 2] | Test ECE and logistic recalibration slope (outcome on model logit); floors as stated | **Refuted** (2026-10-31): ECE 0.250 and slope 379,685 outside [0, 2]; Brier 0.244 vs base 0.230; predictions pile near 0/1 |
| **D-PRED-04** | Entropy alone is not a universal collapse indicator: the entropy-only model fails the same discrimination bar, test AUC < 0.70. | Entropy-only test AUC ≥ 0.70 **and** bootstrap lower bound > 0.50 | Two-feature entropy-only logistic model; test AUC and 1,000-resample interval | **Refuted** (2026-10-31): entropy-only AUC 0.812 [0.733, 0.881]; carried by spatial entropy (species entropy alone AUC 0.500) |
| **D-PRED-05** | Spatial structure adds predictive value beyond population and temporal features: full-minus-temporal ΔAUC ≥ 0.05 with a bootstrap lower bound > 0. | ΔAUC ≤ 0 | `full − temporal` AUC, paired by condition in the same bootstrap; floor 0.05 | **Supported** (2026-10-31): full−temporal ΔAUC 0.110 [0.046, 0.238]; temporal AUC 0.775 |

The registered interpretation is symmetric. D-PRED-01 and D-PRED-02 are the
headline tests of transportable prediction. D-PRED-04 is a registered
negative-direction claim: it is supported if the simple entropy model fails, and
it is refuted if entropy alone clears the AUC bar with an interval above chance.
D-PRED-03 can fail even when ranking survives, which is the calibration result
that matters for any deployment. D-PRED-05 can fail while the full model works,
which would say that the added value comes from population dynamics rather than
spatial structure.

### Result (2026-10-31)

192 runs completed and the registered rule was applied unchanged. The label
gate passed: 62 labelled training runs (39 collapse / 23 persist, 18 ambiguous)
and 92 labelled test runs (59 collapse / 33 persist, 20 ambiguous). Test base
rate 64.1%, training base rate 62.9%.

| model | features | test AUC | 95% cluster CI | Brier skill | ECE | slope |
| :-- | ---: | ---: | :--: | ---: | ---: | ---: |
| full | 14 | **0.885** | [0.825, 0.941] | −0.060 | 0.250 | 379,686 |
| population | 2 | 0.712 | [0.593, 0.805] | 0.043 | 0.149 | 355,302 |
| temporal | 6 | 0.775 | [0.659, 0.857] | 0.141 | 0.145 | 0.495 |
| entropy | 2 | 0.812 | [0.733, 0.881] | 0.225 | 0.104 | 2.093 |
| structure | 5 | 0.627 | [0.526, 0.730] | −0.304 | 0.268 | 250,789 |
| full − entropy | 12 | 0.885 | [0.826, 0.940] | −0.058 | 0.247 | 436,373 |
| full − structure | 9 | 0.713 | [0.589, 0.810] | −0.160 | 0.250 | 478,308 |

The five verdicts:

- **D-PRED-01 supported.** Test AUC **0.885** [0.825, 0.941] on 92 labelled
  runs, with 59 collapses. The features end at tick 140 and the outcome is read
  from ticks 500–599, so the ranking precedes the outcome by at least 360 ticks.
- **D-PRED-02 inconclusive.** The full model beats the population baseline by
  **0.173** AUC [0.103, 0.288], clearing the 0.05 floor with an interval above
  zero. But Brier skill is **−0.060**, below the registered 0.10 bar: on the
  shifted test set the full model's probabilities are worse than always
  predicting the training base rate. The registered conjunction is not met, and
  the falsifier (ΔAUC ≤ 0) did not fire.
- **D-PRED-03 refuted.** ECE is **0.250**, above the 0.20 falsifier threshold,
  and the calibration slope is **379,686**, far outside [0, 2]. Brier is 0.244
  versus a 0.230 base-rate score. Predictions pile at the extremes: 77 of 92 test
  runs sit in the 0.8–1.0 bin with mean prediction 0.993 and observed collapse
  72.7%; the 0.2–0.4 bin predicts 0.293 and observes 0/4.
- **D-PRED-04 refuted.** The entropy-only model reaches AUC **0.812**
  [0.733, 0.881], so entropy alone does clear the discrimination bar. The signal
  is spatial entropy, not species diversity: species entropy alone is at chance
  (AUC 0.500), while early spatial entropy is lower in collapse (univariate test
  AUC 0.188 with the sign reversed). Entropy is nevertheless redundant in the
  full model: full-minus-entropy is also 0.885, a ΔAUC of 0.073 [0.027, 0.156]
  that comes with no change in AUC at all.
- **D-PRED-05 supported.** Adding structure to the temporal features raises AUC
  by **0.110** [0.046, 0.238], from 0.775 to 0.885. This is a conditional gain,
  not a standalone structural detector: structure-only AUC is 0.627, and
  removing structure from the full model drops AUC to 0.713.

**Honest reading.** The experiment supports **transportable ranking, not
calibrated risk**. The full model separates collapse from persistence on unseen
rules and parameters, and spatial structure contributes ranking information
beyond population dynamics. But the same model's probabilities are unusable out
of condition: it is badly overconfident, its Brier skill is negative, and the
registered calibration claim is refuted. The distinction is exactly what
D-PRED-02 and D-PRED-03 were registered to expose: a model can win on AUC and
still be a worse probability forecast than the base rate. The registered
entropy-only null was also refuted; the honest statement is that early spatial
entropy carries information in this grid, not that entropy is a universal
collapse signal.

**Limits.** There are 24 conditions and only 14 held-out conditions, eight seeds
each, on one engine at 600 ticks. The unseen rule is one mutation scale (×4),
not a new engine. The condition-cluster bootstrap treats the 14 test conditions
as exchangeable even though they mix unseen-rule and unseen-parameter shifts.
The labels are absolute alive-count thresholds and are noisy: 38 of 192 runs are
ambiguous and excluded. Feature families are correlated, so the ablation deltas
are not causal effects. No intervention or rescue is tested; post-hoc Platt
scaling could improve calibration, but it is not part of the registered
analysis and is not reported as a result.

### Pilot disclosure (exploratory, not evidence)

The condition grid and the 10/30 outcome thresholds were chosen after three
exploratory seeds (`d.p0` … `d.p2`) and a small single-seed parameter sweep. A
full-pipeline pilot on those same three seeds is written to
`research/output/collapse-predict-pilot.{md,json,csv}` and is marked
exploratory. The confirmatory seeds `d.c0` … `d.c15` are fresh, and the split,
floors and decision rule were frozen before they were opened. The smoke test
uses `d.q0`/`d.q1`, a separate cache, and `collapse-predict-quick.*`; it is not
evidence and cannot overwrite these artifacts.

### Artifacts and reproduce

`research/output/collapse-predict.{md,json,csv}` and the append-only cache
`research/output/collapse-predict-cache.jsonl`. Reproduce with
`npm run research:collapse` (192 runs) or `-- --from-cache` (re-render only).
`-- --pilot` runs the exploratory pilot on `d.p0` … `d.p2`; `-- --quick` runs
the four-run smoke test. The runner refuses to mix caches with different seeds,
conditions or tick counts.

## 7. Revision log

| Date | Revision | Reason |
|---|---|---|
| 2026-10-16 | Scope ledger v1.0.0 registered (34 claims). | Initial pre-registration. |
| 2026-10-22 | EWS grid expanded from 4 to 8 seeds; the "non-monotone" AUC-vs-τ curve was superseded by a monotone decline (slope −0.0003, R² 0.69). | Four-replicate artefact; the smaller run was underpowered. |
| 2026-10-29 | E-EWS-05…10 registered as open; M1–M4 and Q7–Q8 stated with falsifiers. | Thesis refinement: separate phenomenology from mechanism. |
| 2026-10-29 | E-EWS-11 registered with its decision rule, before running the multiverse. | The registered slope could be called a specification artefact; the test must be fixed in advance. |
| 2026-10-29 | E-EWS-11 resolved **not supported**. 1,056 specifications: lead-in-stress median −0.0047 (registered −0.0142), 60% negative; AUC median −0.0001 (registered −0.0003), 73% negative. Seed bootstrap: lead [−0.0203, −0.0120], AUC [−0.0005, 0.0000]. No axis level met both bars; EWMA baseline came closest (100% reduction, 89% flattened). | Pre-registered rule applied unchanged. The multiverse narrows T2 to the lead-in-stress shrinkage and marks the AUC decline as specification-dependent. |
| 2026-10-29 | E-EWS-12 registered with its decision rule, before running the M4 ablation. | The clonal/elevated comparison could be read post hoc; the estimability, manipulation, and retention bars must be fixed in advance. |
| 2026-10-29 | E-EWS-12 manipulation check revised from standing genetic variance to direct loci-per-birth counting, after a 12-run smoke test showed standing variance is founder-dominated and cannot separate ×0 from ×1. The outcome rule (retention < 50%) is unchanged. | Better to fix a measurement that does not measure the manipulation before the full run, and record the change, than to run a test whose positive control cannot fire. |
| 2026-10-29 | E-EWS-12 resolved **refuted**. 144 runs: clonal retains 100% of the lead slope (−0.01422 vs −0.01419; boot [−0.0181, −0.0088] vs [−0.0203, −0.0120]); AUC retained 52%. Mutation supply 0 / 12.4 / 48.3 loci per birth (3.90×). Elevated arm collapsed 25/48 vs clonal 43/48 (Fisher exact p = 9.1×10⁻⁵), so rescue is real but separate from the lead. | All three pre-registered checks passed, so the verdict is an effect failure, not a measurement failure. The elevated slope is gated to `n/a` (8% detection, 0 bootstrap resamples) rather than reported. |
| 2026-10-30 | A-DOOM-01…04 registered with the three gates and the 0.10 retention floor, before the final run. | The question ("does selection for reproduction buy fragility?") is easy to answer post hoc in either direction; the floor and the sign convention must be fixed first. |
| 2026-10-30 | A-DOOM design revised to run raw births (primary) and established offspring (secondary) over the same ancestors, after the raw-birth pilot converged on the period-2 flipper at the 40,960 ceiling. | A saturated axis makes the dose comparison meaningless; running both definitions stops the verdict from resting on the metric choice. |
| 2026-10-30 | Retention assay revised to exclude pre-shock populations below 32 cells, after the first full run showed a 3-cell ancestor scoring a retention of 9.7. Verdict under the unfiltered assay was also *no-trade-off*. | Below that floor the ratio is stochastic amplification, not robustness; the change is recorded with the pre-change result so it cannot be mistaken for a rescue of the claim. |
| 2026-10-30 | A-DOOM-04 mediation changed from three-predictor OLS to a Theil–Sen turnover adjustment. Verdict unchanged. | OLS arm coefficients left the possible range (1.9–2.3 on a 0/1 arm), driven by the same regrowing ancestors; the robust adjustment is the measurement the claim can actually bear. |
| 2026-10-30 | A-DOOM-01…04 resolved **not supported**: no doomsday. Raw births rho −0.087 [−0.461, 0.286]; established −0.282 [−0.645, 0.122]; largest selected − drift contrast −0.034, below the 0.10 floor; dose p = 0.35. | All three gates passed, so this is an effect failure, not a measurement failure. |
| 2026-10-31 | Experiment B design moved from a resource-flux lattice to a probabilistic birth–death lattice with persistent nests (v5), after four prototypes failed: starvation, lattice saturation, division stalled at threshold, and no cheater spread. Pilot seeds `sb.`, `sc.`, `chk.` recorded as exploratory only. | Each failure was a mechanism failure, not an effect failure; the registered model is the first that produces local persistence with scale-2 collapse. |
| 2026-10-31 | B-SELF-01…04 registered with the two-scale model, the three interventions, the between-seed effect floor and the decision rule, **before** the confirmatory run (`sa.0`…`sa.7`). | The question is easy to answer post hoc in either direction. Recording the pilot expectation (02b seed-sensitive, 04 sub-additive) keeps a refutation visible rather than re-narrated as a rescue. |
| 2026-10-31 | B-SELF-01…04 resolved: 01 supported; 02a inconclusive (+0.258 vs floor 0.351); 02b refuted (−0.074); 02c supported (+0.462); 03 inconclusive (builder rho 0.868, birth rho −0.527); 04 refuted (interaction −0.090). | Registered rule unchanged. The floor, not the sign, decided 02a; the absolute-rho clause, not the builder correlation, decided 03. The pilot's predicted boundary weakness and sub-additivity both held, so the result was not rescued by re-reading. |
| 2026-10-31 | C-KILL-01…05 registered with the component-mixed public-good model, the assay viability gate, the 0.30 / 2-SD / ±0.15 floors and the decision rule, **before** the confirmatory run (`ck.0`…`ck.15`). The two 5-seed pilots (`ck.p0`…`ck.p9`) are disclosed as exploratory only; model parameters are frozen at `PROD = 1.0`, `PROD_EXP = 2`, `DECAY = 0.15`. | The question ("which directed disturbance kills the colony?") is easy to answer post hoc from the most lethal arm. The floor, the viability gate and the pilot disclosure have to be fixed before the confirmatory seeds are opened. |
| 2026-10-31 | C-KILL-01…05 resolved: 01 supported (0.38 [0.06, 0.63]); 02 supported (vs age 0.56 [0.31, 0.81], vs density 0.38 [0.19, 0.63]); 03 inconclusive (0.012 [−0.017, 0.040], floor 0.173); 04 supported (pause 0/16 vs removal 9/16; 12/16 within 90% of control final); 05 supported (−0.002 [−0.045, 0.040]). 736 runs, assay valid. | Registered rule unchanged. C-KILL-03's falsifier did not fire, but the interface effect is an order of magnitude below the floor. The density half of C-KILL-02 is carried by six paired runs, so the result is real but not large. |
| 2026-10-31 | D-PRED-01…05 registered with the 3 rules × 8 regimes design, the 10/30 outcome thresholds, the 14-feature logistic model, the label gate and the 0.70 / 0.05 / 0.10 / [0.5, 1.5] floors, **before** the confirmatory run (`d.c0`…`d.c15`). Pilot seeds `d.p0`…`d.p2` and smoke seeds `d.q0`/`d.q1` are disclosed as exploratory only; the pilot grid and thresholds were chosen from those seeds. | The question ("does an early-window model transport to unseen conditions?") invites post-hoc choice of the split, features and calibration bar. The split, gate, floors and decision rule have to be fixed before the confirmatory seeds are opened. |

| 2026-10-31 | D-PRED-01…05 resolved: 01 supported (AUC 0.885 [0.825, 0.941], 59/92 test collapses); 02 inconclusive (ΔAUC 0.173 [0.103, 0.288], Brier skill −0.060); 03 refuted (ECE 0.250, slope 379,686, Brier 0.244 vs base 0.230); 04 refuted (entropy-only AUC 0.812 [0.733, 0.881]); 05 supported (full−temporal ΔAUC 0.110 [0.046, 0.238]). 192 runs, label gate passed. | Registered rule unchanged. Ranking transports but the probabilities do not: D-PRED-02's AUC clause passes while its Brier clause fails, and D-PRED-03 fails independently. D-PRED-04's null was refuted by spatial entropy, not species entropy; entropy adds no AUC to the full model. |
| 2026-10-31 | D-PRED result rendering fixed to sort seeds numerically and to print the seeds actually present in each split. No model, feature, split, label or verdict changed; artifacts re-rendered from the frozen cache. | The first rendering called the test seeds `d.c10..d.c9` because of lexicographic sorting, and the pilot rendering described the confirmatory seed ranges. Both were display errors, not analysis changes. |

## 8. What is deliberately not claimed

- That the early-warning theory is false in general. Only that it fails to
  transport unchanged to this class of evolving ecologies.
- That adaptation is the mechanism. Its mutation-supply component is refuted
  (E-EWS-12); selection on standing variation and crossover are untested, and
  the rescue effect it produced does not transfer into the warning lead.
- That the simulator has demonstrated open-ended evolution. Internal ladders are
  not a substitute for evolutionary-activity statistics with a null.
- That a "supported" verdict is proof. It is a statistical statement with the
  intervals recorded in the artifacts.
- That the AUC-vs-τ decline is robust. It is not: the 8-seed bootstrap interval
  reaches zero and 27% of the multiverse gives a non-negative slope. Only the
  lead-in-stress shrinkage is stable enough to be stated as the result, and even
  there the multiverse median is a third of the registered magnitude.
- That reproduction and robustness trade off in general. Experiment A refutes
  only the strong version, in one Life-like CA at 32×32 over 20 generations. It
  does not show that a trade-off is impossible, and it does not transfer to the
  agent ecology without its own run.
- That a major evolutionary transition requires a particular boundary or signal.
  Experiment B manipulates three specific mechanisms in one two-scale model; it
  does not rank them in general, and it does not show that hierarchy always
  collapses without management.
- That builder supply is the *exclusive* bottleneck between local and
  hierarchical reproduction. Experiment B found a strong association (rho 0.868)
  but the registered exclusivity clause failed: local birth rate was also
  associated with scale-2 output (rho −0.527).
- That geometric core, interface, pause or lesion location are generally
  irrelevant to colony death. Experiment C found them null in one 48 × 48
  quorum model at 750 ticks; the result does not transfer to other geometries,
  local signalling, or longer runs.
- That participation is a general causal necessity. Experiment C removed the
  40% most participatory cells in one model and still left 7/16 colonies alive;
  the division count is a marker, not a mechanism, and the density-matched
  control also destroyed 3/16. The supported statement is about this
  intervention in this ecology, not about participation as a law.
- That early structure is a universal collapse predictor. Experiment D tests one
  agent ecology, one 3 × 8 condition grid and one 600-tick horizon. A positive
  result is a transport statement about these rules and parameters, not a law
  about all ecologies or all collapse types.
- That the selected features are causal. Experiment D is a prediction test;
  feature weights are not intervention effects and no feature is manipulated.
- That entropy is a universal collapse signal. D-PRED-04's registered null was
  refuted in this grid: spatial entropy alone ranked collapse well (AUC 0.812),
  while species entropy alone was at chance, and entropy added no AUC to the
  full model. This is one grid, not a law.
- That the Experiment D probabilities are usable as risk forecasts. D-PRED-03
  was refuted: the full model was badly overconfident out of condition (ECE
  0.250, Brier skill −0.060). The supported statement is about ranking only.
- That predicted collapse can be acted on. No rescue or intervention is tested;
  calibration is reported because a probability is not useful if it is
  systematically wrong, not because a management rule has been validated.

## 9. Reproduce

```bash
# from apps/simulation
npm run research:ews                 # full grid -> research/output/ews.*
npm run research:ews -- --quick      # smoke
npm run research:multiverse          # Q5: 1,056 analyses of one dataset (~20 min)
npm run research:multiverse -- --from-cache   # re-analysis only (seconds)
npm run research:ablation            # M4: clonal / registered / elevated (~20 min)
npm run research:ablation -- --from-cache     # re-analysis only (seconds)
npm run research:doomsday            # Experiment A: both fitness modes (~2 min)
npm run research:doomsday -- --from-cache     # re-analysis only (seconds)
npm run research:selfattack          # Experiment B: 8 seeds x 8 conditions (~20 s)
npm run research:selfattack -- --from-cache   # re-analysis only (seconds)
npm run research:killswitch          # Experiment C: 16 seeds x 46 runs (~5 min)
npm run research:killswitch -- --from-cache   # re-render only (seconds)
npm run research:collapse            # Experiment D: 192 runs (~25 min)
npm run research:collapse -- --from-cache     # re-render only (seconds)
npm run research:collapse -- --pilot          # exploratory pilot, not evidence
npm run research:collapse -- --quick          # smoke test, not evidence
npm run research:scope               # legacy ledger -> research/output/scope.*
npm run research:experiment -- --verify
```

Manifests: `research/experiments/*.json` (sha256 over world fingerprint,
trajectory, summary, synthesis).
