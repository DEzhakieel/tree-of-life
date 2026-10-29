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

## 2. Legacy scope claims (v1.0.0, 2026-10-16)

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

## 3. Revision log

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

## 4. What is deliberately not claimed

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

## 5. Reproduce

```bash
# from apps/simulation
npm run research:ews                 # full grid -> research/output/ews.*
npm run research:ews -- --quick      # smoke
npm run research:multiverse          # Q5: 1,056 analyses of one dataset (~20 min)
npm run research:multiverse -- --from-cache   # re-analysis only (seconds)
npm run research:ablation            # M4: clonal / registered / elevated (~20 min)
npm run research:ablation -- --from-cache     # re-analysis only (seconds)
npm run research:scope               # legacy ledger -> research/output/scope.*
npm run research:experiment -- --verify
```

Manifests: `research/experiments/*.json` (sha256 over world fingerprint,
trajectory, summary, synthesis).
