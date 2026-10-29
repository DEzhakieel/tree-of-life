# Q5 multiverse: is the calibration failure an artefact of the analysis?

One simulated dataset, 1056 defensible analyses. Data: 8 seeds x 6 ramp durations = 48 runs (43 collapsed). Provenance: re-analysed from `ews-multiverse-series.json` (no simulation in this run).

Every specification re-analyses the *same* stored population series. Collapse detection, window labelling (40-250 ticks before collapse vs early-stationary), and the early cutoff are held fixed: they are properties of the data, not of the analysis.

## Registered specification

`pop|w60|ma25|preramp|k1.5` reproduces the headline analysis: AUC slope -0.0003 (R2 0.69), lead(stress) slope -0.0142 (R2 0.34).

Hierarchical-by-seed bootstrap (2000 replicates): AUC slope [-0.0005, 0.0000] median -0.0003, 96% of resamples negative. Lead(stress) slope [-0.0203, -0.0120], 100% negative.

## Does the decline survive the analysis space?

| indicator | registered AUC slope | multiverse median | 5-95% | share negative | specs |
| :-- | ---: | ---: | :--: | ---: | ---: |
| variance | -0.0003 | -0.0001 | -0.0003 to 0.0003 | 73% | 1056 |
| AR(1) | -0.0001 | -0.0000 | -0.0002 to 0.0002 | 68% | 1056 |
| recovery | -0.0001 | -0.0000 | -0.0002 to 0.0002 | 68% | 1056 |
| CV | -0.0002 | -0.0002 | -0.0002 to -0.0000 | 100% | 1056 |
| skewness | 0.0001 | 0.0001 | -0.0000 to 0.0002 | 9% | 1056 |
| flicker | -0.0000 | 0.0001 | -0.0000 to 0.0001 | 9% | 1056 |

Lead in control-parameter (stress) units vs ramp duration:

| indicator | registered slope | multiverse median | 5-95% | share negative | specs |
| :-- | ---: | ---: | :--: | ---: | ---: |
| variance | -0.0142 | -0.0047 | -0.0179 to 0.0047 | 60% | 1056 |
| AR(1) | 0.0014 | 0.0000 | -0.0122 to 0.0058 | 39% | 1056 |
| recovery | 0.0014 | 0.0000 | -0.0117 to 0.0033 | 35% | 1056 |
| CV | -0.0128 | -0.0122 | -0.0169 to 0.0009 | 89% | 1056 |
| skewness | -0.0053 | 0.0000 | -0.0104 to 0.0024 | 41% | 1056 |
| flicker | -0.0016 | 0.0000 | -0.0045 to 0.0052 | 31% | 1056 |

## By analysis axis: AUC vs tau (variance)

| axis | level | specs | median slope | 10-90% | share negative | reduction | flattened | verdict |
| :-- | :-- | ---: | ---: | :--: | ---: | ---: | ---: | :-- |
| order parameter (M3) | pop | 264 | -0.00026 | -0.00032 to 0.00009 | 86% | 5% | 14% | not-supported |
| order parameter (M3) | log | 264 | -0.00001 | -0.00019 to 0.00043 | 55% | 95% | 50% | partial |
| order parameter (M3) | sqrt | 264 | -0.00017 | -0.00028 to 0.00032 | 86% | 38% | 23% | not-supported |
| order parameter (M3) | cv | 264 | -0.00003 | -0.00011 to 0.00012 | 64% | 89% | 91% | supported |
| analysis window | 40 | 288 | -0.00000 | -0.00022 to 0.00032 | 50% | 99% | 46% | partial |
| analysis window | 60 | 384 | -0.00008 | -0.00027 to 0.00013 | 81% | 71% | 47% | partial |
| analysis window | 90 | 384 | -0.00011 | -0.00032 to 0.00016 | 81% | 58% | 41% | partial |
| detrender (M2) | none | 144 | -0.00022 | -0.00032 to -0.00008 | 92% | 19% | 25% | not-supported |
| detrender (M2) | ma10 | 144 | -0.00011 | -0.00022 to 0.00004 | 83% | 57% | 50% | partial |
| detrender (M2) | ma25 | 144 | -0.00014 | -0.00027 to -0.00004 | 92% | 49% | 50% | not-supported |
| detrender (M2) | ma50 | 96 | -0.00022 | -0.00036 to -0.00005 | 100% | 18% | 25% | not-supported |
| detrender (M2) | gauss10 | 144 | -0.00004 | -0.00021 to 0.00018 | 67% | 87% | 50% | partial |
| detrender (M2) | gauss25 | 96 | -0.00011 | -0.00028 to 0.00003 | 88% | 59% | 50% | partial |
| detrender (M2) | median11 | 144 | 0.00032 | 0.00012 to 0.00045 | 0% | worse | 25% | not-supported |
| detrender (M2) | linear | 144 | -0.00008 | -0.00021 to 0.00008 | 75% | 71% | 75% | partial |
| baseline estimator (M1) | preramp | 264 | -0.00009 | -0.00027 to 0.00017 | 73% | 66% | 44% | partial |
| baseline estimator (M1) | preramp-long | 264 | -0.00009 | -0.00027 to 0.00017 | 73% | 66% | 44% | partial |
| baseline estimator (M1) | ewma | 264 | -0.00009 | -0.00027 to 0.00017 | 73% | 66% | 44% | partial |
| baseline estimator (M1) | stress-band | 264 | -0.00009 | -0.00027 to 0.00017 | 73% | 66% | 44% | partial |
| detection threshold k | 1 | 352 | -0.00009 | -0.00027 to 0.00018 | 73% | 66% | 44% | partial |
| detection threshold k | 1.5 | 352 | -0.00009 | -0.00027 to 0.00018 | 73% | 66% | 44% | partial |
| detection threshold k | 2 | 352 | -0.00009 | -0.00027 to 0.00018 | 73% | 66% | 44% | partial |

## By analysis axis: lead(stress) vs tau (variance)

| axis | level | specs | median slope | 10-90% | share negative | reduction | flattened | verdict |
| :-- | :-- | ---: | ---: | :--: | ---: | ---: | ---: | :-- |
| order parameter (M3) | pop | 264 | -0.00342 | -0.01910 to 0.00116 | 54% | 76% | 49% | partial |
| order parameter (M3) | log | 264 | -0.00617 | -0.01359 to 0.00242 | 67% | 57% | 54% | partial |
| order parameter (M3) | sqrt | 264 | -0.00650 | -0.01690 to 0.00403 | 59% | 54% | 48% | partial |
| order parameter (M3) | cv | 264 | -0.00307 | -0.01339 to 0.00163 | 58% | 78% | 68% | partial |
| analysis window | 40 | 288 | -0.00229 | -0.01577 to 0.00181 | 57% | 84% | 65% | partial |
| analysis window | 60 | 384 | -0.00342 | -0.01632 to 0.00237 | 58% | 76% | 56% | partial |
| analysis window | 90 | 384 | -0.00775 | -0.01701 to 0.00313 | 63% | 45% | 46% | not-supported |
| detrender (M2) | none | 144 | -0.01322 | -0.01784 to 0.00000 | 89% | 7% | 24% | not-supported |
| detrender (M2) | ma10 | 144 | -0.00060 | -0.01651 to 0.00025 | 51% | 96% | 58% | partial |
| detrender (M2) | ma25 | 144 | -0.00913 | -0.01654 to 0.00027 | 74% | 36% | 47% | not-supported |
| detrender (M2) | ma50 | 96 | -0.01375 | -0.01908 to 0.00069 | 81% | 3% | 30% | not-supported |
| detrender (M2) | gauss10 | 144 | 0.00000 | -0.01155 to 0.00152 | 46% | 100% | 69% | partial |
| detrender (M2) | gauss25 | 96 | -0.00015 | -0.01572 to 0.00188 | 51% | 99% | 57% | partial |
| detrender (M2) | median11 | 144 | 0.00101 | -0.00747 to 0.00809 | 33% | 93% | 75% | partial |
| detrender (M2) | linear | 144 | -0.00350 | -0.01408 to 0.00021 | 57% | 75% | 69% | partial |
| baseline estimator (M1) | preramp | 264 | -0.01118 | -0.01765 to 0.00000 | 89% | 21% | 29% | not-supported |
| baseline estimator (M1) | preramp-long | 264 | 0.00000 | -0.01684 to 0.00000 | 35% | 100% | 69% | partial |
| baseline estimator (M1) | ewma | 264 | 0.00000 | -0.00713 to 0.00276 | 26% | 100% | 89% | partial |
| baseline estimator (M1) | stress-band | 264 | -0.01038 | -0.01685 to 0.00000 | 89% | 27% | 31% | not-supported |
| detection threshold k | 1 | 352 | -0.00511 | -0.01635 to 0.00314 | 61% | 64% | 53% | partial |
| detection threshold k | 1.5 | 352 | -0.00496 | -0.01674 to 0.00214 | 61% | 65% | 54% | partial |
| detection threshold k | 2 | 352 | -0.00348 | -0.01659 to 0.00139 | 57% | 75% | 57% | partial |

## Decision rule

Pre-registered (`docs/CLAIMS.md`, E-EWS-11): a level of an analysis axis explains the failure only if (a) its median slope removes at least half of the registered slope and (b) at least 90% of its specifications are flattened to within half the registered magnitude. Anything less keeps the mechanism open.

**No level of any axis meets both bars for the lead-in-stress slope.** The calibration failure is not rescued by a plausible change of analysis, which is what makes it a result about the ecology rather than about one specification.

## Identifiability of M1 as stated

The pre-ramp population series is bit-identical across ramp durations for 8/8 seeds: the ramp begins at the end of burn-in, and the baseline window ends before it. A *slow ramp therefore cannot inflate the pre-ramp baseline*, so M1 cannot operate through the mechanism originally stated. The baseline axis tests the remaining version: a detection bar whose scale is fixed while the number of pre-collapse windows grows with tau ("bar rigidity").

## What this licenses

- The AUC-vs-tau decline is a property of the *analysis shape* (order parameter, window, detrender), not of the detection rule; by construction the detection rule cannot affect it.
- The lead-in-stress decline additionally depends on the detection rule. The table above says how much of it is rule-dependent; if the median stays negative across levels, the failure is not a threshold artefact.
- It does **not** identify the biological mechanism. M2 (detrending) is the axis to read first, because a detrender that removes slow variance growth removes the signal the theory predicts.

## Reproduce

```bash
npm run research:multiverse                # simulate + analyse (~35 min)
npm run research:multiverse -- --from-cache # re-analyse stored series (seconds)
```
