# Specialization — Critical transitions and early-warning signals

> **Field:** nonlinear dynamics / complex systems — *critical transitions* (regime shifts).
> **One question:** do generic early-warning indicators give reliable, calibrated
> advance notice of a macroscopic collapse in this artificial ecology, and does the
> warning scale with how slowly the bifurcation is approached?
> © 2026 Daven Ezhakieel · MIT.

This document is the charter for the project's single research vertical. Everything
else in Tree of Life (engine, dashboard, terminal, tests) exists to *instrument and
reproduce* the experiment described here.

## 1. The question, made falsifiable

A **critical transition** is a large, abrupt, and often hard-to-reverse change in the
state of a system as a control parameter drifts across a tipping point (a fold or
saddle-node bifurcation). Scheffer and co-workers proposed that such transitions are
preceded by generic, model-free signatures — **critical slowing down** — reflected in
*rising variance*, *rising lag-1 autocorrelation*, *falling recovery rate*, and
*rising flickering* of the state variable.

**Question.** In the Tree of Life ecology, when a control parameter is ramped until
the population collapses to extinction, do these generic indicators (a) discriminate
pre-collapse windows from background, and (b) yield a *lead time* that is calibrated —
i.e. that grows with the duration of the ramp (the "distance-to-bifurcation")?

**Falsifiers.** The hypothesis is rejected if (i) indicator AUC is not better than
chance (0.5) for the pre-collapse window, or (ii) lead time does not scale with the
forcing rate, or (iii) indicators fire equally often in a no-ramp control.

## 2. Why this system admits the question

The ecology is **bistable**. Sweeping the founder cohort leaves the system in one of
two well-separated states (measured empirically, seed-averaged):

| founders | low state (~35–50) | high state |
| ---: | :--: | :--: |
| 60–120 | yes | — |
| 240 | — | ~180–470 |
| 400 | — | ~500–600 (cap) |

Food supply and the fractal parameter `c` are **not** effective collapse drivers here
(agents saturate `maxPopulation` on non-food energy pathways; `escapeRadius = 2^16`
means escape deaths never occur). The clean, monotone killer is **metabolic load**:
raising `metabolismBase` past a threshold drives a deterministic die-off to extinction,
while a no-ramp control at `metabolismBase = 1` survives indefinitely. That makes
metabolic load the control parameter and population the order parameter.

## 3. Hypotheses

- **H1 (detectability).** At least one generic indicator separates pre-collapse windows
  (40–250 ticks before collapse) from early-stationary windows with AUC > 0.5, pooled
  over replicates.
- **H2 (ranking).** Variance and its scale-free counterpart (CV) outperform AR(1) /
  recovery rate, which are contaminated by the slow deterministic trend.
- **H3 (calibration).** The lead time measured in **control-parameter units**
  (metabolismBase) is roughly invariant to the ramp duration τ, while the lead time in
  **ticks** grows with τ.
- **H4 (specificity).** The no-ramp control neither collapses nor produces sustained
  warnings.

## 4. Indicators (definitions as implemented)

Series `x[t]` = alive population per tick. For a window, let `r[t] = x[t] - MA_m(x)[t]`
be the **detrended residual** (causal moving average of length `m`), so the slow
deterministic drift does not masquerade as slowing down:

| indicator | definition | expected sign |
| --- | --- | --- |
| variance | `Var(r)` | rising |
| AR(1) | lag-1 autocorrelation of `r` | rising |
| recovery rate | `-ln(AR(1))` | falling |
| CV | `sd(x)/mean(x)` | rising |
| skewness | standardised third moment of `x` | rising |
| flicker | mean-crossings of `x` per sample | rising |

Windows: length 60 ticks, step 15, detrend length 25. Implemented once, in
`packages/shared/src/criticalTransitions.ts`, and shared by the runner and tests.

Detection threshold per indicator: baseline mean + 1.5·SD over the pre-ramp plateau,
with a **sustain** rule (≥ 70% of the remaining pre-collapse windows exceed the
threshold). AUC is computed per run (Mann–Whitney / rank form) and averaged; the
indicator's pre-registered direction is applied before scoring, so a below-chance AUC
means the indicator moves the *wrong* way.

## 5. Experiment

- Engine: TypeScript reference (`apps/simulation`).
- World: `spawn = 300`, `maxPopulation = 500`, `foodRegenRate = 0.0018`, habitat jitter
  seeded per replicate (`makeWorld`). Brain and stochastic layers at defaults.
- Burn-in: 350 ticks at `metabolismBase = 1` (stationary plateau).
- Ramp: `metabolismBase` 1 → 40 linearly over τ ticks, then held; τ ∈ {300, 450, 600, 750, 900, 1050}.
- Tail: 300 ticks after the ramp to observe the collapse.
- Replicates: 8 seeds × 6 ramps = 48 runs; plus an 8-run no-ramp control.
- H3 test: linear regression of each indicator's lead time (in stress and tick units) and
  AUC against τ across the grid, reported with R².
- Reproduce: `npm run research:ews -w @fractal-life/simulation` (or `--quick`).

## 6. Results (as produced by the runner)

Control: 8/8 worlds survive with mean final population 500 — the collapse is caused by
the ramp, not the environment (**H4 confirmed**).

Collapse and indicator skill by ramp duration (AUC; 0.5 = chance):

| τ | collapsed | mean plateau | mean collapse tick | variance | AR(1) | flicker | CV | skewness |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 300 | 100% | 237 | 554 | 0.72 | 0.52 | 0.58 | 0.55 | 0.31 |
| 450 | 88% | 221 | 641 | 0.71 | 0.50 | 0.59 | 0.54 | 0.30 |
| 600 | 88% | 221 | 682 | 0.73 | 0.51 | 0.54 | 0.54 | 0.34 |
| 750 | 88% | 221 | 773 | 0.71 | 0.57 | 0.47 | 0.61 | 0.43 |
| 900 | 88% | 221 | 942 | 0.54 | 0.42 | 0.60 | 0.44 | 0.41 |
| 1050 | 88% | 221 | 993 | 0.54 | 0.43 | 0.58 | 0.40 | 0.38 |

Read together with the generated `research/output/ews.{md,json,csv}` and
`research/output/plots/ews.svg`. **Pooled over all ramps (43/48 runs collapsed):**

| indicator | AUC | detect | mean lead (ticks) | mean lead (stress) |
| :-- | ---: | ---: | ---: | ---: |
| variance | 0.659 | 28% | 207 | 13.9 |
| flicker | 0.562 | 2% | 32 | 2.8 |
| CV | 0.512 | 86% | 160 | 8.6 |
| AR(1) | 0.493 | 5% | 39 | 1.4 |
| recovery rate | 0.493 | 2% | 40 | 1.5 |
| skewness | 0.361 | 7% | 50 | 3.9 |

- **H1 — supported.** Variance (AUC 0.659) is clearly above chance pooled, and flicker
  (0.562) is a weaker second; AR(1)/recovery (0.493) are at chance; **skewness is below
  chance (0.361)** — the distribution does *not* skew the predicted way before this
  extinction. Detection rates are low because the sustained mean+1.5SD rule is strict
  against a noisy baseline (CV fires most often mainly because its relative measure
  tracks the declining mean).
- **H2 — supported.** Variance strongly out-ranks AR(1) (0.659 vs 0.493); the
  autocorrelation-based indicators are the *weakest* family here, consistent with the
  detrended series still carrying the ramped mean structure.
- **H3 — rejected.** If the warning sat a fixed *distance-to-bifurcation* ahead, the
  lead in stress units would be flat in τ (slope ≈ 0) and the lead in ticks would grow
  with τ. Instead the lead **in stress units shrinks** as the ramp slows — CV slope
  −0.013 (R² 0.89), variance slope −0.014 (R² 0.34) — while the tick-slope is nearly
  flat (≈ 0.03, R² ≤ 0.43). The warning onset drifts *closer* to the bifurcation as the
  forcing is applied more gently, and skill degrades accordingly.
- **AUC vs τ is monotone.** With 8 replicates the variance AUC falls smoothly from
  ≈ 0.72 (τ ≤ 750) to ≈ 0.54 (τ ≥ 900); a linear fit gives slope −0.0003, **R² 0.69**.
  The earlier "non-monotone" 0.65 / 0.79 / 0.38 curve was a small-sample (n = 4)
  artefact — this was the main thing the refinement resolved.
- **H4 — supported.**

### Multiverse (E-EWS-11): how much of this is the analysis?

The same 48 runs were re-analysed under 1,056 specifications (4 order parameters ×
3 windows × 8 detrenders × 4 baseline estimators × 3 thresholds), data held fixed;
`npm run research:multiverse`, or `-- --from-cache` in seconds. The registered
cell reproduces the headline exactly (AUC slope −0.0003, lead slope −0.0142).

| statistic | registered | median | 5–95% | negative | seed bootstrap |
| :-- | ---: | ---: | :--: | ---: | :--: |
| AUC vs τ (variance) | −0.0003 | −0.0001 | −0.0003 to 0.0003 | 73% | [−0.0005, 0.0000] |
| lead(stress) vs τ (variance) | −0.0142 | −0.0047 | −0.0179 to 0.0047 | 60% | [−0.0203, −0.0120] |

The AUC decline is specification-dependent (log population removes it; a median
filter reverses it; the bootstrap reaches zero). The lead shrinkage survives but
at a third of the registered magnitude. **No axis level met the pre-registered
bar** (E-EWS-11: ≥50% median reduction *and* ≥90% of specifications flattened);
the closest, an adaptive EWMA bar, flattened 89%. Two structural points:

- M1 as originally stated is **not identifiable**: the pre-ramp series are
  bit-identical across τ for 8/8 seeds, so a slow ramp cannot inflate the
  baseline. The surviving mechanism is *bar rigidity*.
- The AUC half cannot be a detection-rule artefact **by construction**: AUC is a
  rank statistic, so only (order parameter, window, detrender) can move it.

### The honest headline, narrowed

The honest headline: **variance is the workhorse early-warning indicator here;
flicker is a distant second; autocorrelation-based indicators are at chance;
skewness is anti-predictive; and the lead in control-parameter units shrinks the
more slowly the tipping point is approached — contradicting the fixed-distance
calibration prediction.** The multiverse narrows the last clause: it is the
*lead* that shrinks robustly, not the ranking; and the effect is a third the size
of the registered estimate.

## 7. Limitations and what would falsify the story

- **Order parameter → 0.** Because collapse means extinction, absolute variance
  vanishes in the final approach; the informative signals live in the 40–250-tick band,
  not at the last tick. Log-transformed population is the obvious next refinement.
- **Bar rigidity, not baseline drift.** The bar is estimated from a fixed pre-ramp
  window, and that window is *bit-identical* across ramp durations — the ramp begins
  after it — so a slow ramp cannot inflate the baseline by itself. What does change
  with τ is the number of pre-collapse windows over which the sustain rule is applied.
  `npm run research:multiverse` (registered as E-EWS-11) varies the detrender, window,
  order parameter, baseline estimator, and threshold over one stored dataset, and
  reports the distribution of slopes rather than one specification.
- **Trend contamination.** AR(1) on a drifting series is biased high; only the
  detrended form is used. Undetrended AR(1) would spuriously "succeed".
- **No spatial indicator.** Spatial early-warning signals (rising spatial correlation /
  variance across grid cells) are not yet implemented; the agent positions are
  available and are the natural extension.

## 8. Reproduce

```bash
npm run research:ews -w @fractal-life/simulation          # full grid, writes output
npm run research:ews -w @fractal-life/simulation -- --quick
npm run research:ews -w @fractal-life/simulation -- --seeds a,b --ramps 300,600,900,1050
npm run research:multiverse -w @fractal-life/simulation  # Q5: one dataset, 1,056 analyses
npm run research:multiverse -w @fractal-life/simulation -- --from-cache  # re-analysis only
npm run test:fast  -w @fractal-life/simulation            # incl. test/ews.test.ts
```

## 9. References

1. Scheffer, M. et al. (2009). *Early-warning signals for critical transitions.* Nature 461, 53–59.
2. Dakos, V. et al. (2008). *Slowing down as an early warning signal...* PNAS 105, 14308–14312.
3. Carpenter, S. R. et al. (2011). *Early warnings of regime shifts: a whole-ecosystem experiment.* Science 332, 1079–1082.
4. Drake, J. M. & Griffen, B. D. (2010). *Early warning signals of extinction in deteriorating environments.* Nature 467, 456–459.
5. Boettiger, C. & Hastings, A. (2012). *Quantifying limits to detection of early warning for critical transitions.* J. R. Soc. Interface 9, 2527–2539.
6. Hastings, A. & Wysham, D. B. (2010). *Regime shifts in ecological systems can occur with no warning.* Ecology Letters 13, 464–472.
7. Lenton, T. M. (2011). *Early warning of climate tipping points.* Nature Climate Change 1, 201–209.
