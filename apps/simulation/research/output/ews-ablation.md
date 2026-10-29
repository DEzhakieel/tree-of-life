# M4 ablation: does evolutionary rescue flatten the warning-lead slope?

Three mutation-supply conditions, 8 seeds × 6 ramp durations each. Registered specification `pop|w60|ma25|preramp|k1.5`. Provenance: re-analysed from `ews-ablation-series.json` (no simulation in this run).

The clonal arm removes de-novo mutation and lateral gene transfer; the elevated arm quadruples the mutation supply as a positive control. The registered arm is re-simulated, not reused: it must reproduce the cached Q5 series bit-for-bit or the comparison is void.

**Lever check:** the ×1 arm reproduces the cached Q5 population series **exactly**.

## Per-condition results (variance indicator)

| condition | mutation | runs | collapse | detect | AUC slope | lead slope | lead 95% boot | multiverse lead negative | multiverse lead median |
| :-- | ---: | ---: | ---: | ---: | ---: | ---: | :--: | ---: | ---: |
| clonal | ×0 | 48 | 90% | 33% | -0.0001 | -0.0142 | [-0.0181, -0.0088] | 60% | -0.0058 |
| registered | ×1 | 48 | 90% | 28% | -0.0003 | -0.0142 | [-0.0203, -0.0120] | 60% | -0.0047 |
| elevated | ×4 | 48 | 52% | 8% | n/a | n/a | n/a | 54% | -0.0009 |

`lead slope` is the registered in-control-parameter (stress-unit) slope; negative means the lead shrinks with slower forcing. `n/a` marks a slope that is not interpretable: either the arm collapsed too rarely for a slope to mean anything, the detection rate is below 20%, or the seed bootstrap produced fewer than 100 resamples.

**elevated has no interpretable slope.** That is a result, not a missing number: if quadrupling the mutation supply prevents the collapse, adaptation can rescue this system, which is exactly what M4 claims is possible. It does not by itself explain the registered lead shrinkage, because the clonal-versus-registered comparison is the one that tests whether removing the mutation supply flattens it.

## Did adaptation change whether the system collapses?

The two ends of the dose–response, on the only outcome that is unambiguous: **clonal 43/48** collapsed versus **elevated 25/48**, two-sided Fisher exact **p = 9.13e-5**.

This is the one part of M4 that the data support: the mutation supply changes the probability of collapse. It is also why the elevated arm has no slope — with most runs surviving, there is no pre-collapse window to fit. Rescue and lead shrinkage are therefore separate questions, and only the second one is about the early-warning calibration failure.

## Did the manipulation bite? (mutation supply)

| condition | mutation | loci/birth (plateau) | loci/birth (final) | founder locus var | plateau locus var | retention | plateau basal-rate var |
| :-- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| clonal | ×0 | 0.000 | 0.000 | 0.32734 | 0.28557 | 87% | 0.077207 |
| registered | ×1 | 12.383 | 12.431 | 0.32729 | 0.28406 | 87% | 0.075227 |
| elevated | ×4 | 48.269 | 48.316 | 0.32830 | 0.29414 | 90% | 0.068135 |

Mutation supply is counted at birth against the post-recombination genome, so sexual crossover is not mistaken for mutation. Standing variance is founder-dominated for hundreds of ticks and is reported as context, not as the manipulation check: the first smoke run showed it barely moves between ×0 and ×1.

## Decision rule (E-EWS-12, registered before the run)

M4 predicts that removing adaptation restores lead invariance. The clonal arm must be estimable (≥ 50% of runs collapse, ≥ 4 collapsed runs), the mutation supply counted as loci per birth must be zero in the clonal arm and ≥ 1.5× the registered arm when elevated, and M4 is supported only if the clonal arm retains < 50% of the registered lead slope. Otherwise it is refuted or unresolved, as stated.

**Verdict: refuted.** The clonal arm retains 100% of the registered lead slope, so removing the mutation supply does not flatten it.

| check | value |
| :-- | ---: |
| clonal estimable | yes |
| mutation-supply contrast (elevated / registered) | 3.90× |
| manipulation bit (clonal 0, elevated ≥ 1.5×) | yes |
| lead slope retained by clonal | 100% |
| AUC slope retained by clonal | 52% |
| clonal lead interval contains zero | no |
| dose–response monotone in \|lead\| | no |

## What this does and does not establish

- It manipulates the **supply** of new variation, not selection on the standing variation of the 300 founders. A null result therefore bounds one component of M4, not the whole hypothesis.
- The clonal arm is a harder world, not a clean counterfactual: if it collapses at a different rate, the slope is estimated on a different subset of runs. The collapse fraction is reported for exactly that reason.
- The multiverse median is reported beside the registered slope for each condition, because Q5 showed the registered slope sits at the edge of its own analysis space.

## Reproduce

```bash
npm run research:ablation                 # simulate + analyse (~20 min)
npm run research:ablation -- --from-cache # re-analyse stored series (seconds)
```
