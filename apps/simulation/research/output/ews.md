# Early-warning signals for critical transitions

Engine: TS reference. Control parameter: metabolismBase ramped 1 -> 40 after a 350-tick burn-in. Order parameter: population (spawn 300, cap 500, food 0.0018).

EWS: rolling window 60 ticks (step 15, detrend 25). Ramp duration tau in ticks sets how slowly the bifurcation is approached.

## Collapse

| tau | runs | collapsed | mean collapse tick | mean stress at collapse | mean plateau |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 300 | 8 | 100% | 554 | 24.37 | 237 |
| 450 | 8 | 88% | 641 | 23.47 | 221 |
| 600 | 8 | 88% | 682 | 22.28 | 221 |
| 750 | 8 | 88% | 773 | 22.05 | 221 |
| 900 | 8 | 88% | 942 | 24.98 | 221 |
| 1050 | 8 | 88% | 993 | 24.33 | 221 |

## No-ramp control

With metabolismBase held at 1 (no ramp) for the same tick budget, mean final population is 500 and 8/8 worlds survive. The collapse is therefore caused by the ramp, not the environment.

## Pooled headline (all ramps)

43/48 runs crossed the collapse threshold.

| indicator | AUC | detect | mean lead (ticks) | mean lead (stress) |
| :-- | ---: | ---: | ---: | ---: |
| variance | 0.659 | 28% | 207 | 13.89 |
| AR(1) | 0.493 | 5% | 39 | 1.43 |
| recovery rate | 0.493 | 2% | 40 | 1.49 |
| CV | 0.512 | 86% | 160 | 8.58 |
| skewness | 0.361 | 7% | 50 | 3.93 |
| flicker | 0.562 | 2% | 32 | 2.77 |

## Indicator performance (per tau)

| tau | indicator | detect | lead (ticks) | lead (stress) | AUC | trend tau |
| ---: | :-- | ---: | ---: | ---: | ---: | ---: |
| 300 | variance | 50% | 171 ± 71 | 18.33 ± 5.27 | 0.720 ± 0.273 | 0.28 |
| 300 | AR(1) | 0% | 0 ± 0 | 0.00 ± 0.00 | 0.521 ± 0.179 | 0.05 |
| 300 | recovery rate | 0% | 0 ± 0 | 0.00 ± 0.00 | 0.521 ± 0.179 | -0.05 |
| 300 | CV | 88% | 138 ± 79 | 14.45 ± 7.69 | 0.548 ± 0.194 | 0.28 |
| 300 | skewness | 13% | 51 ± 0 | 6.63 ± 0.00 | 0.309 ± 0.110 | -0.03 |
| 300 | flicker | 0% | 0 ± 0 | 0.00 ± 0.00 | 0.582 ± 0.101 | -0.08 |
| 450 | variance | 38% | 223 ± 97 | 16.00 ± 5.45 | 0.708 ± 0.181 | 0.17 |
| 450 | AR(1) | 0% | 0 ± 0 | 0.00 ± 0.00 | 0.505 ± 0.136 | 0.07 |
| 450 | recovery rate | 0% | 0 ± 0 | 0.00 ± 0.00 | 0.505 ± 0.136 | -0.07 |
| 450 | CV | 88% | 153 ± 99 | 9.90 ± 7.50 | 0.541 ± 0.196 | 0.29 |
| 450 | skewness | 0% | 0 ± 0 | 0.00 ± 0.00 | 0.305 ± 0.095 | -0.02 |
| 450 | flicker | 13% | 32 ± 0 | 2.77 ± 0.00 | 0.586 ± 0.135 | -0.08 |
| 600 | variance | 13% | 67 ± 0 | 2.27 ± 0.00 | 0.731 ± 0.116 | 0.13 |
| 600 | AR(1) | 0% | 0 ± 0 | 0.00 ± 0.00 | 0.509 ± 0.168 | 0.04 |
| 600 | recovery rate | 0% | 0 ± 0 | 0.00 ± 0.00 | 0.509 ± 0.168 | -0.04 |
| 600 | CV | 75% | 176 ± 117 | 9.52 ± 5.67 | 0.536 ± 0.215 | 0.27 |
| 600 | skewness | 13% | 52 ± 0 | 3.38 ± 0.00 | 0.340 ± 0.071 | 0.02 |
| 600 | flicker | 0% | 0 ± 0 | 0.00 ± 0.00 | 0.539 ± 0.086 | -0.15 |
| 750 | variance | 25% | 318 ± 6 | 13.55 ± 0.85 | 0.705 ± 0.143 | 0.02 |
| 750 | AR(1) | 0% | 0 ± 0 | 0.00 ± 0.00 | 0.565 ± 0.154 | 0.03 |
| 750 | recovery rate | 0% | 0 ± 0 | 0.00 ± 0.00 | 0.565 ± 0.154 | -0.03 |
| 750 | CV | 63% | 182 ± 144 | 7.16 ± 6.41 | 0.606 ± 0.171 | 0.27 |
| 750 | skewness | 0% | 0 ± 0 | 0.00 ± 0.00 | 0.430 ± 0.111 | 0.06 |
| 750 | flicker | 0% | 0 ± 0 | 0.00 ± 0.00 | 0.475 ± 0.078 | -0.14 |
| 900 | variance | 13% | 353 ± 0 | 13.13 ± 0.00 | 0.539 ± 0.224 | -0.09 |
| 900 | AR(1) | 0% | 0 ± 0 | 0.00 ± 0.00 | 0.421 ± 0.090 | -0.00 |
| 900 | recovery rate | 0% | 0 ± 0 | 0.00 ± 0.00 | 0.421 ± 0.090 | 0.00 |
| 900 | CV | 75% | 136 ± 177 | 3.94 ± 5.05 | 0.437 ± 0.205 | 0.16 |
| 900 | skewness | 0% | 0 ± 0 | 0.00 ± 0.00 | 0.406 ± 0.097 | -0.02 |
| 900 | flicker | 0% | 0 ± 0 | 0.00 ± 0.00 | 0.604 ± 0.127 | -0.05 |
| 1050 | variance | 13% | 78 ± 0 | 2.90 ± 0.00 | 0.544 ± 0.099 | -0.08 |
| 1050 | AR(1) | 25% | 39 ± 2 | 1.43 ± 0.08 | 0.430 ± 0.093 | 0.03 |
| 1050 | recovery rate | 13% | 40 ± 0 | 1.49 ± 0.00 | 0.430 ± 0.093 | -0.03 |
| 1050 | CV | 75% | 182 ± 226 | 5.04 ± 6.06 | 0.400 ± 0.247 | 0.13 |
| 1050 | skewness | 13% | 48 ± 0 | 1.78 ± 0.00 | 0.384 ± 0.077 | 0.01 |
| 1050 | flicker | 0% | 0 ± 0 | 0.00 ± 0.00 | 0.584 ± 0.122 | -0.06 |

## H3: does the warning track distance-to-bifurcation?

Linear fit of each metric against ramp duration tau across the grid (300, 450, 600, 750, 900, 1050 ticks; 8 replicates each). A fixed distance-to-bifurcation would give lead(stress) slope ~ 0 with lead(ticks) slope > 0.

| indicator | lead (stress) slope | R2 | lead (ticks) slope | R2 | AUC slope | R2 |
| :-- | ---: | ---: | ---: | ---: | ---: | ---: |
| variance | -0.0142 | 0.34 | 0.034 | 0.01 | -0.0003 | 0.69 |
| AR(1) | 0.0014 | 0.43 | 0.037 | 0.43 | -0.0001 | 0.39 |
| recovery rate | 0.0014 | 0.43 | 0.038 | 0.43 | -0.0001 | 0.39 |
| CV | -0.0128 | 0.89 | 0.034 | 0.19 | -0.0002 | 0.46 |
| skewness | -0.0053 | 0.31 | -0.013 | 0.02 | 0.0001 | 0.62 |
| flicker | -0.0016 | 0.15 | -0.018 | 0.15 | -0.0000 | 0.00 |

## Reading the table

- detect = fraction of runs where the indicator crossed mean+1.5SD of its pre-ramp baseline and stayed there (>=70% of the remaining pre-collapse windows).
- lead (ticks) = ticks between the warning and the collapse; lead (stress) = the same interval in metabolismBase units (distance-to-bifurcation).
- AUC = per-run ROC area separating windows 40-250 ticks before collapse from early-stationary windows, averaged over runs.
- trend tau = Kendall tau of the indicator over [baseline, collapse]; +1 is a monotone rise toward the transition.

If early warning is real, lead (stress) should be roughly constant across tau while lead (ticks) grows with tau, and AUC should exceed 0.5.
