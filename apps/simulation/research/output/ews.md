# Early-warning signals for critical transitions

Engine: TS reference. Control parameter: metabolismBase ramped 1 -> 40 after a 350-tick burn-in. Order parameter: population (spawn 300, cap 500, food 0.0018).

EWS: rolling window 60 ticks (step 15, detrend 25). Ramp duration tau in ticks sets how slowly the bifurcation is approached.

## Collapse

| tau | runs | collapsed | mean collapse tick | mean stress at collapse | mean plateau |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 350 | 4 | 100% | 597 | 26.41 | 241 |
| 600 | 4 | 75% | 710 | 23.71 | 205 |
| 900 | 4 | 75% | 1203 | 33.99 | 205 |

## No-ramp control

With metabolismBase held at 1 (no ramp) for the same tick budget, mean final population is 500 and 4/4 worlds survive. The collapse is therefore caused by the ramp, not the environment.

## Pooled headline (all ramps)

10/12 runs crossed the collapse threshold.

| indicator | AUC | detect | mean lead (ticks) | mean lead (stress) |
| :-- | ---: | ---: | ---: | ---: |
| variance | 0.613 | 20% | 191 | 11.72 |
| AR(1) | 0.537 | 10% | 42 | 0.00 |
| recovery rate | 0.537 | 10% | 42 | 0.00 |
| CV | 0.486 | 90% | 118 | 7.07 |
| skewness | 0.409 | 30% | 82 | 8.30 |
| flicker | 0.624 | 10% | 88 | 9.81 |

## Indicator performance (per tau)

| tau | indicator | detect | lead (ticks) | lead (stress) | AUC | trend tau |
| ---: | :-- | ---: | ---: | ---: | ---: | ---: |
| 350 | variance | 25% | 315 ± 0 | 21.17 ± 0.00 | 0.651 | 0.16 |
| 350 | AR(1) | 25% | 42 ± 0 | 0.00 ± 0.00 | 0.532 | 0.04 |
| 350 | recovery rate | 25% | 42 ± 0 | 0.00 ± 0.00 | 0.532 | -0.04 |
| 350 | CV | 75% | 137 ± 108 | 11.29 ± 10.66 | 0.494 | 0.16 |
| 350 | skewness | 50% | 97 ± 73 | 10.75 ± 8.12 | 0.373 | 0.03 |
| 350 | flicker | 25% | 88 ± 0 | 9.81 ± 0.00 | 0.615 | 0.04 |
| 600 | variance | 25% | 67 ± 0 | 2.27 ± 0.00 | 0.791 | 0.15 |
| 600 | AR(1) | 0% | 0 ± 0 | 0.00 ± 0.00 | 0.638 | 0.13 |
| 600 | recovery rate | 0% | 0 ± 0 | 0.00 ± 0.00 | 0.638 | -0.13 |
| 600 | CV | 75% | 175 ± 113 | 9.27 ± 6.05 | 0.587 | 0.26 |
| 600 | skewness | 25% | 52 ± 0 | 3.38 ± 0.00 | 0.401 | 0.07 |
| 600 | flicker | 0% | 0 ± 0 | 0.00 ± 0.00 | 0.553 | -0.09 |
| 900 | variance | 0% | 0 ± 0 | 0.00 ± 0.00 | 0.384 | -0.27 |
| 900 | AR(1) | 0% | 0 ± 0 | 0.00 ± 0.00 | 0.443 | 0.03 |
| 900 | recovery rate | 0% | 0 ± 0 | 0.00 ± 0.00 | 0.443 | -0.03 |
| 900 | CV | 75% | 43 ± 14 | 0.64 ± 0.92 | 0.373 | -0.04 |
| 900 | skewness | 0% | 0 ± 0 | 0.00 ± 0.00 | 0.466 | -0.06 |
| 900 | flicker | 0% | 0 ± 0 | 0.00 ± 0.00 | 0.708 | 0.08 |

## Reading the table

- detect = fraction of runs where the indicator crossed mean+1.5SD of its pre-ramp baseline and stayed there (>=70% of the remaining pre-collapse windows).
- lead (ticks) = ticks between the warning and the collapse; lead (stress) = the same interval in metabolismBase units (distance-to-bifurcation).
- AUC = per-run ROC area separating windows 40-250 ticks before collapse from early-stationary windows, averaged over runs.
- trend tau = Kendall tau of the indicator over [baseline, collapse]; +1 is a monotone rise toward the transition.

If early warning is real, lead (stress) should be roughly constant across tau while lead (ticks) grows with tau, and AUC should exceed 0.5.
