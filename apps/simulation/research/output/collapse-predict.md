# Experiment D - predicting collapse before it is visible

Generated 2026-10-31T10:30:15.686Z. 600-tick agent-engine runs; features from ticks 40-140; outcome from ticks 500-600. Collapse: late mean alive < 10; persistence: late mean alive >= 30; the interval between is reported as ambiguous and excluded from fit and scoring.

## Design

24 conditions = 3 rules (clonal x0, legacy x1, elevated x4 mutation supply) x 8 parameter regimes (metabolismBase, foodRegenRate). Training: clonal/legacy x P0,P1,P2,P6,P7 (10 conditions, seeds d.c0..d.c7 (8)). Test: elevated x all 8 (unseen rule) plus clonal/legacy x P3,P4,P5 (unseen parameter regimes) (14 conditions, seeds d.c8..d.c15 (8)). No seed and no condition is shared between training and test.

| regime | metabolismBase | foodRegenRate | split |
| :-- | ---: | ---: | :-- |
| P0 | 6 | 0.0027 | train |
| P1 | 8 | 0.0027 | train |
| P2 | 10 | 0.0027 | train |
| P3 | 12 | 0.0027 | test (unseen parameter) |
| P4 | 8 | 0.0018 | test (unseen parameter) |
| P5 | 10 | 0.0018 | test (unseen parameter) |
| P6 | 12 | 0.0018 | train |
| P7 | 16 | 0.0018 | train |

## Features

All predictors are computed inside the early window only. Population features: level, log trend, CV, lag-1 autocorrelation, mean-crossing rate, trough/mean. Entropy: species Shannon entropy and normalised spatial entropy on a 16 x 16 torus grid. Spatial structure: Moran's I with rook weights, occupied-neighbour fraction, occupancy, largest 4-connected component, radius of gyration around the circular centroid. Energy: mean energy / capacity. No condition label or late-window value is a predictor.

| feature | family |
| :-- | :-- |
| log mean population | population / temporal |
| population trend (per 100 ticks) | population / temporal |
| population CV | population / temporal |
| population AR(1) | population / temporal |
| population flicker | population / temporal |
| population trough / mean | population / temporal |
| species entropy (bits) | entropy |
| spatial entropy (normalised) | entropy |
| Moran's I | spatial structure |
| occupied-neighbour fraction | spatial structure |
| occupied bins | spatial structure |
| largest component / occupied | spatial structure |
| radius of gyration / world | spatial structure |
| mean energy / capacity | energy |

## Training and test labels

Training: 62 labelled runs (39 collapse, 23 persist, 18 ambiguous); training base rate 62.9%. Test: 92 labelled runs (59 collapse, 33 persist, 20 ambiguous); test base rate 64.1%.

## Label gate

**Passed.** Training 62 labelled (39 collapse / 23 persist); test 92 labelled (59 collapse / 33 persist). The gate requires at least 8 labelled runs and at least 3 of each class in both splits.

## Held-out performance

| model | features | AUC | 95% cluster CI | Brier | Brier skill | ECE | slope |
| :-- | ---: | ---: | :--: | ---: | ---: | ---: | ---: |
| full | 14 | 0.885 | [0.825, 0.941] | 0.244 | -0.060 | 0.250 | 379685.813 |
| population | 2 | 0.712 | [0.593, 0.805] | 0.220 | 0.043 | 0.149 | 355302.122 |
| temporal | 6 | 0.775 | [0.659, 0.857] | 0.198 | 0.141 | 0.145 | 0.495 |
| entropy | 2 | 0.812 | [0.733, 0.881] | 0.178 | 0.225 | 0.104 | 2.093 |
| structure | 5 | 0.627 | [0.526, 0.730] | 0.300 | -0.304 | 0.268 | 250788.710 |
| noEntropy | 12 | 0.885 | [0.826, 0.940] | 0.244 | -0.058 | 0.247 | 436372.738 |
| noStructure | 9 | 0.713 | [0.589, 0.810] | 0.267 | -0.160 | 0.250 | 478307.626 |

## Pre-registered claims

| ID | claim | verdict | result |
| :-- | :-- | :-- | :-- |
| D-PRED-01 | The full early-window model discriminates collapse from persistence on unseen conditions (test AUC >= 0.70, cluster-bootstrap lower bound > 0.50). | **supported** | test AUC 0.885 [0.825, 0.941] on 92 labelled runs (59 collapses). |
| D-PRED-02 | The full model beats the population-size-plus-trend baseline by at least 0.05 AUC and has Brier skill >= 0.10. | **inconclusive** | delta AUC 0.173 [0.103, 0.288]; Brier skill -0.060 (population AUC 0.712). |
| D-PRED-03 | The full model remains calibrated on unseen conditions (ECE <= 0.10 and calibration slope in [0.5, 1.5]). | **refuted** | ECE 0.250; calibration slope 379685.813, intercept -15268131.603; Brier 0.244 vs base 0.230. |
| D-PRED-04 | Entropy alone is not a universal collapse indicator: the entropy-only model fails the same discrimination bar (AUC < 0.70). | **refuted** | entropy-only test AUC 0.812 [0.733, 0.881]; full minus entropy delta 0.073 [0.027, 0.156]. |
| D-PRED-05 | Spatial structure adds predictive value beyond population and temporal features (full minus temporal AUC >= 0.05, bootstrap lower bound > 0). | **supported** | full minus temporal delta AUC 0.110 [0.046, 0.238] (temporal AUC 0.775). |

## Reliability (full model)

| predicted bin | n | mean predicted | observed collapse |
| :-- | ---: | ---: | ---: |
| 0.0-0.2 | 3 | 0.041 | 0.0% |
| 0.2-0.4 | 4 | 0.293 | 0.0% |
| 0.4-0.6 | 7 | 0.434 | 28.6% |
| 0.6-0.8 | 1 | 0.765 | 100.0% |
| 0.8-1.0 | 77 | 0.993 | 72.7% |

## Conditions

| condition | split | unseen | n | collapse | persist | ambiguous | mean predicted | observed | early alive | late alive | late / early |
| :-- | :-- | :-- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| clonal.P0 | train | none | 8 | 0 | 6 | 2 | 0.026 | 0.0% | 43.9 | 109.3 | 2.19 |
| clonal.P1 | train | none | 8 | 2 | 2 | 4 | 0.463 | 50.0% | 31.0 | 53.9 | 1.49 |
| clonal.P2 | train | none | 8 | 4 | 2 | 2 | 0.643 | 66.7% | 24.0 | 36.5 | 1.64 |
| clonal.P3 | test | parameter | 8 | 5 | 1 | 2 | 1.000 | 83.3% | 8.5 | 13.9 | 2.71 |
| clonal.P4 | test | parameter | 8 | 3 | 4 | 1 | 0.821 | 42.9% | 17.6 | 60.1 | 3.26 |
| clonal.P5 | test | parameter | 8 | 5 | 2 | 1 | 0.992 | 71.4% | 11.0 | 32.6 | 3.04 |
| clonal.P6 | train | none | 8 | 6 | 1 | 1 | 0.849 | 85.7% | 17.0 | 15.5 | 0.71 |
| clonal.P7 | train | none | 8 | 7 | 1 | 0 | 0.878 | 87.5% | 10.4 | 7.6 | 0.64 |
| elevated.P0 | test | rule | 8 | 0 | 4 | 4 | 0.132 | 0.0% | 30.1 | 191.2 | 6.57 |
| elevated.P1 | test | rule | 8 | 2 | 4 | 2 | 0.739 | 33.3% | 19.0 | 125.9 | 6.30 |
| elevated.P2 | test | rule | 8 | 3 | 4 | 1 | 0.985 | 42.9% | 11.9 | 45.4 | 4.82 |
| elevated.P3 | test | both | 8 | 5 | 1 | 2 | 1.000 | 83.3% | 8.3 | 20.4 | 3.80 |
| elevated.P4 | test | both | 8 | 4 | 4 | 0 | 0.760 | 50.0% | 15.7 | 44.3 | 2.91 |
| elevated.P5 | test | both | 8 | 5 | 1 | 2 | 0.991 | 83.3% | 10.6 | 22.0 | 3.29 |
| elevated.P6 | test | rule | 8 | 5 | 1 | 2 | 0.999 | 83.3% | 6.9 | 7.7 | 1.77 |
| elevated.P7 | test | rule | 8 | 8 | 0 | 0 | 0.999 | 100.0% | 4.0 | 1.3 | 0.91 |
| legacy.P0 | train | none | 8 | 0 | 5 | 3 | 0.037 | 0.0% | 43.8 | 88.5 | 1.78 |
| legacy.P1 | train | none | 8 | 2 | 2 | 4 | 0.464 | 50.0% | 30.5 | 50.2 | 1.50 |
| legacy.P2 | train | none | 8 | 4 | 2 | 2 | 0.706 | 66.7% | 24.3 | 38.6 | 1.70 |
| legacy.P3 | test | parameter | 8 | 5 | 2 | 1 | 1.000 | 71.4% | 8.4 | 18.4 | 3.20 |
| legacy.P4 | test | parameter | 8 | 4 | 4 | 0 | 0.755 | 50.0% | 17.6 | 42.3 | 2.22 |
| legacy.P5 | test | parameter | 8 | 5 | 1 | 2 | 0.994 | 83.3% | 11.1 | 17.7 | 2.38 |
| legacy.P6 | train | none | 8 | 7 | 1 | 0 | 0.862 | 87.5% | 16.6 | 13.8 | 0.70 |
| legacy.P7 | train | none | 8 | 7 | 1 | 0 | 0.875 | 87.5% | 10.2 | 8.4 | 0.67 |

## Univariate test AUCs (descriptive, not the model)

| feature | train AUC | test AUC | test direction |
| :-- | ---: | ---: | :-- |
| log mean population | 0.125 | 0.243 | lower in collapse |
| population trend (per 100 ticks) | 0.144 | 0.417 | lower in collapse |
| population CV | 0.711 | 0.652 | higher in collapse |
| population AR(1) | 0.396 | 0.365 | lower in collapse |
| population flicker | 0.264 | 0.576 | higher in collapse |
| population trough / mean | 0.321 | 0.380 | lower in collapse |
| species entropy (bits) | 0.500 | 0.500 | higher in collapse |
| spatial entropy (normalised) | 0.287 | 0.188 | lower in collapse |
| Moran's I | 0.521 | 0.721 | higher in collapse |
| occupied-neighbour fraction | 0.256 | 0.411 | lower in collapse |
| occupied bins | 0.229 | 0.218 | lower in collapse |
| largest component / occupied | 0.708 | 0.832 | higher in collapse |
| radius of gyration / world | 0.486 | 0.124 | lower in collapse |
| mean energy / capacity | 0.553 | 0.798 | higher in collapse |

## Reading the table

- AUC is the probability that a randomly chosen collapse run scores above a randomly chosen persistence run; 0.5 is chance. The 95% interval is a cluster bootstrap over test conditions, not over runs, because runs within a condition are not independent.
- Brier skill is 1 - Brier(model) / Brier(training base rate on the same test runs); positive means the model beats always predicting the training collapse rate. ECE is the weighted gap between predicted and observed collapse frequency over five probability bins.
- Calibration slope comes from a logistic fit of outcome on the model logit on the test split; 1 is perfect, below 1 means predictions are too extreme, above 1 too timid.

## Honest reading

The run-level labels are noisy by construction: the same condition can persist or collapse on different seeds, and that seed-to-seed variation is exactly what the early features have to anticipate. The test split also changes the base rate and the mutation rule, so a model that only memorises condition-level stress will lose calibration even if its ranking survives. A positive result is therefore about transportable early structure, not about a deterministic forecast. An ambiguous label is not a hidden success: those runs are excluded and counted above.

## Pilot disclosure (exploratory, not evidence)

The condition grid and the 10/30 alive outcome thresholds were chosen after 3 pilot seeds (`d.p0`..`d.p2`) and a small number of single-seed grids. Those runs are not reused here: the confirmatory seeds `d.c0`..`d.c15` are fresh, and the split was frozen before they were opened. The pilot showed that constant high metabolism alone does not guarantee collapse within 600 ticks (some worlds settle at a low but nonzero population), which is why the outcome is an absolute late-window alive count rather than a ratio to the founder peak.

## Artifacts

`research/output/collapse-predict.{md,json,csv}` and `research/output/collapse-predict-cache.jsonl`. Reproduce with `npm run research:collapse` (from `apps/simulation`) or `-- --from-cache` to re-render without simulating.
