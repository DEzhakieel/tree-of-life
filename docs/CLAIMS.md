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
| **E-EWS-08** | The E-EWS-03 failure is explained by evolutionary rescue (M4). | A clonal, mutation-off ablation reproduces the slope | Ablation run at 8 seeds × 6 τ | **Open** |
| **E-EWS-09** | Direct critical slowing down is measurable as a response function. | Perturbation recovery time does not rise before collapse | Branch-and-impulse at ticks along the ramp; λ(t) = −ln(‖δx(t+Δ)‖/‖δx(t)‖)/Δ | **Open** |
| **E-EWS-10** | Warning skill scales with system size. | AUC independent of N across 100–2000 | Finite-size sweep at fixed τ; hierarchical model | **Open** |
| **E-EWS-11** | The calibration failure is a property of the ecology, not of the analysis: it survives the space of defensible analysis choices. | Some level of some analysis axis removes ≥50% of the registered slope in ≥90% of its specifications | 1,056 specifications over one stored dataset (4 order parameters × 3 windows × 8 detrenders × 4 baselines × 3 thresholds); median/IQR, per-axis reduction, hierarchical-by-seed bootstrap | **Not supported** (2026-10-29): no axis level met both bars; best is EWMA baseline at 89% (bar 90%) |

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

## 4. What is deliberately not claimed

- That the early-warning theory is false in general. Only that it fails to
  transport unchanged to this class of evolving ecologies.
- That adaptation is the mechanism. M4 is one of four candidates, untested.
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
npm run research:scope               # legacy ledger -> research/output/scope.*
npm run research:experiment -- --verify
```

Manifests: `research/experiments/*.json` (sha256 over world fingerprint,
trajectory, summary, synthesis).
