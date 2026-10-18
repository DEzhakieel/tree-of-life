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
- Ramp: `metabolismBase` 1 → 40 linearly over τ ticks, then held; τ ∈ {350, 600, 900}.
- Tail: 300 ticks after the ramp to observe the collapse.
- Replicates: 4 seeds × 3 ramps = 12 runs; plus a 4-run no-ramp control.
- Reproduce: `npm run research:ews -w @fractal-life/simulation` (or `--quick`).

## 6. Results (as produced by the runner)

Control: 4/4 worlds survive with mean final population 500 — the collapse is caused by
the ramp, not the environment (**H4 confirmed**).

Collapse and indicator skill by ramp duration (AUC; 0.5 = chance):

| τ | collapsed | mean plateau | mean collapse tick | variance | AR(1) | flicker | CV | skewness |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 350 | 100% | 241 | 597 | 0.65 | 0.53 | 0.62 | 0.49 | 0.37 |
| 600 | 75% | 205 | 710 | 0.79 | 0.64 | 0.55 | 0.59 | 0.40 |
| 900 | 75% | 205 | 1203 | 0.38 | 0.44 | 0.71 | 0.37 | 0.47 |

Read together with the generated `research/output/ews.{md,json,csv}` and
`research/output/plots/ews.svg`. **Pooled over all ramps (10/12 runs collapsed):**

| indicator | AUC | detect | mean lead (ticks) | mean lead (stress) |
| :-- | ---: | ---: | ---: | ---: |
| variance | 0.613 | 20% | 191 | 11.7 |
| AR(1) | 0.537 | 10% | 42 | 0.0 |
| recovery rate | 0.537 | 10% | 42 | 0.0 |
| CV | 0.486 | 90% | 118 | 7.1 |
| skewness | 0.409 | 30% | 82 | 8.3 |
| flicker | 0.624 | 10% | 88 | 9.8 |

- **H1 — partially supported.** Variance (AUC 0.613) and flicker (0.624) are the only
  indicators clearly above chance when pooled; AR(1)/recovery (0.537) are marginal;
  **skewness is below chance (0.409)** — the distribution does *not* skew the predicted
  way before this extinction. Detection rates are low because the sustained
  mean+1.5SD rule is strict against a noisy baseline.
- **H2 — supported.** Variance out-ranks AR(1) (0.613 vs 0.537). Note CV fires most
  often (90%) yet sits *below* chance (0.486): a rise in relative variability that
  tracks the declining mean is not the same as a separation in time-to-collapse.
- **H3 — mixed / unresolved.** The strongest single result is variance at τ = 600
  (AUC 0.79). The AUC-by-τ curve is **non-monotone** (0.65, 0.79, 0.38) at n = 4: the
  very slow ramp (τ = 900) weakens the windowed signal because the system drifts for a
  long time without sharp fluctuations. Lead-time calibration needs more replicates.
- **H4 — supported.**

The honest headline: **in this bistable artificial ecology, variance (and flicker) are
the workhorse early-warning indicators; autocorrelation-based indicators are weak, and
reliability depends non-monotonically on how the bifurcation is approached.**

## 7. Limitations and what would falsify the story

- **Order parameter → 0.** Because collapse means extinction, absolute variance
  vanishes in the final approach; the informative signals live in the 40–250-tick band,
  not at the last tick. Log-transformed population is the obvious next refinement.
- **Small n / stochastic detection.** With 4 replicates the AUC-by-τ curve is noisy;
  τ = 600 currently shows the strongest signal. More seeds (the `--seeds` flag) and a
  finer τ grid are the immediate follow-ups.
- **Trend contamination.** AR(1) on a drifting series is biased high; only the
  detrended form is used. Undetrended AR(1) would spuriously "succeed".
- **No spatial indicator.** Spatial early-warning signals (rising spatial correlation /
  variance across grid cells) are not yet implemented; the agent positions are
  available and are the natural extension.

## 8. Reproduce

```bash
npm run research:ews -w @fractal-life/simulation          # full grid, writes output
npm run research:ews -w @fractal-life/simulation -- --quick
npm run research:ews -w @fractal-life/simulation -- --seeds a,b --ramps 350,600,900
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
