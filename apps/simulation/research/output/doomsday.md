# Experiment A - Evolutionary doomsday

Can a system that evolves to maximise reproduction become more fragile? A Life-like cellular automaton (32x32 torus, B0 forbidden) is the world; the heritable unit is the 18-bit rule. A rule's offspring count is the number of 0 -> 1 transitions it produces after a warm-up. Four arms share each ancestor: a reproduction-selected lineage at three truncation intensities, and a no-selection (drift) control.

The primary endpoint counts **raw births**, exactly as the question is posed. A second endpoint counts **established offspring** - newborn cells still alive 5 ticks later - because a raw count has a known failure mode: it saturates at the period-2 rule that flips the whole 1,024-cell lattice (40,960 births, the hard ceiling), so every selected lineage converges to the same endpoint and the dose axis disappears. That pilot is recorded as a design revision in `docs/CLAIMS.md`; it is not hidden. Both definitions are run over the same ancestors and reported below, so the verdict cannot rest on the metric choice.

Provenance: simulated in this run (TypeScript, Life-like CA research model).

The environment is fixed for all generations. The shock is applied only afterwards, suddenly: per-cell noise (0.2% / 1% / 5%), a one-off mortality pulse (20% / 50% / 80% of live cells), or a compute budget that updates only 50% / 25% / 10% of cells per tick. Endpoint: mean population over the last 30 of 150 post-shock ticks, divided by the pre-shock population. The same post-warm-up state is used for every shock level, so the comparison is paired.

## Registered prediction

A-DOOM-02 asks for a *doomsday*: selected endpoints must retain at least 0.10 less than their own drift controls (about twice the median between-replicate SD of the family mean, 0.05) **and** less than their own ancestors, with intervals excluding zero. A statistically nonzero contrast smaller than that floor is reported, but it is not a doomsday.

## A1. Primary endpoint: raw births

Selection maximises the literal 0 -> 1 transition count on two training soups; reported gains are on two held-out soups. This is the direct test of the stated hypothesis.

### Manipulation and viability

| arm | lineages | held-out reproduction gain | turnover gain | retention delta (noise) | viable endpoints | mean distance from ancestor |
| :-- | ---: | ---: | ---: | ---: | ---: | ---: |
| drift | 8 | +7549.6 | +0.1863 | -0.023 | 100% | 8.88 |
| weak | 8 | +32882.4 | +0.8005 | -0.041 | 100% | 8.25 |
| moderate | 8 | +32875.7 | +0.8016 | -0.052 | 100% | 9.00 |
| strong | 8 | +32893.7 | +0.8017 | -0.057 | 100% | 8.13 |

Manipulation gate: **passed**. Reproduction is scored on two held-out initial conditions, never on the training seeds, so a rule that memorised a single soup does not look selected. Viability gate: **passed**.

Retention delta in the table is the median over lineages; a mean is dominated by ancestors that are nearly empty before the shock (a 3-cell ancestor can score a retention of 9.7 by regrowing). Replicates whose pre-shock population is below 32 cells are excluded from retention: below that floor the ratio is stochastic amplification, not robustness. Excluded lineages contribute no delta and are dropped from every paired statistic.

### Trade-off curve (primary family: noise)

| family | rho(repro gain, retention change) | selected - drift delta | drift delta | selected delta | dose trend | rho(turnover gain, retention change) |
| :-- | :--: | :--: | :--: | :--: | :--: | :--: |
| noise | -0.087 [-0.461, 0.286] | +0.018 [-0.028, 0.100] | -0.023 [-1.483, 0.018] | -0.052 [-0.629, 0.052] | 0.13 (p=0.514) | -0.111 [-0.511, 0.281] |
| death | 0.194 [-0.232, 0.607] | -0.008 [-0.021, 0.111] | +0.235 [0.018, 0.738] | +0.346 [0.214, 0.842] | 0.17 (p=0.386) | 0.205 [-0.239, 0.594] |
| compute | -0.033 [-0.397, 0.312] | -0.024 [-0.149, 0.199] | -0.299 [-1.211, -0.097] | -0.299 [-1.018, 0.033] | 0.15 (p=0.458) | -0.077 [-0.460, 0.291] |

A negative rho means lineages that gained more reproduction lost more retention, i.e. a trade-off. A positive rho means the better replicators were also the more robust ones. The drift control starts from the same ancestor and is viability-filtered but never selected on reproduction, so a selected-drift difference cannot be explained by distance from the ancestor alone.

### Mediation: is the loss explained by turnover?

| family | turnover slope (Theil-Sen) | selected - drift (raw) | selected - drift (turnover-adjusted) |
| :-- | ---: | ---: | ---: |
| noise | -0.205 | +0.018 | +0.134 |
| death | 0.341 | -0.008 | -0.194 |
| compute | -0.256 | -0.024 | +0.117 |

The adjustment subtracts `slope x turnoverGain` from every lineage's retention change, then re-takes the median selected-minus-drift contrast with the same by-seed pairing as the trade-off table, so the raw column equals `selected - drift delta` above. A robust slope is used because three lineages have ancestors that regrow from a few dozen cells after the shock, and least squares would be set by them. Attenuation toward zero is the mediator signature; persistence means the contrast is not simply churn.

### Conway reference (descriptive, not an arm)

`B3/S23`: 2758 raw births on the held-out soups, turnover 0.0678/cell/tick, retention noise 2.196, death 0.373, compute 2.163, viability 100%.

### Decision rule (registered before the run)

| claim | test | verdict |
| :-- | :-- | :-- |
| A-DOOM-01 trade-off | rho <= -0.3 and 95% CI excludes 0 | not supported |
| A-DOOM-02 selection vs drift | selected - drift <= -0.10, selected < ancestor, both CIs exclude 0 | not supported |
| A-DOOM-03 dose-response | dose rho <= -0.8 and permutation p < 0.05 | not supported |
| A-DOOM-04 turnover mediation | turnover rho <= -0.3, CI excludes 0, adjusted contrast halves | not supported |

**Verdict: no-trade-off.** Reproduction gain and retention change are not negatively associated under the primary shock.

## A2. Definitional check: established offspring

Selection maximises newborn cells that survive 5 ticks. This removes the period-2 flipper and makes the reproduction axis graded, but it partly conflates reproduction with survival: a rule that keeps its children alive longer scores higher. It is a check on whether the A1 verdict is an artefact of the raw metric.

### Manipulation and viability

| arm | lineages | held-out reproduction gain | turnover gain | retention delta (noise) | viable endpoints | mean distance from ancestor |
| :-- | ---: | ---: | ---: | ---: | ---: | ---: |
| drift | 8 | +531.8 | +0.3197 | -0.027 | 100% | 7.63 |
| weak | 8 | +3415.5 | +0.1367 | -0.048 | 100% | 7.75 |
| moderate | 8 | +3430.4 | +0.1230 | -0.025 | 100% | 8.38 |
| strong | 8 | +3381.0 | +0.1470 | -0.068 | 100% | 10.25 |

Manipulation gate: **passed**. Reproduction is scored on two held-out initial conditions, never on the training seeds, so a rule that memorised a single soup does not look selected. Viability gate: **passed**.

Retention delta in the table is the median over lineages; a mean is dominated by ancestors that are nearly empty before the shock (a 3-cell ancestor can score a retention of 9.7 by regrowing). Replicates whose pre-shock population is below 32 cells are excluded from retention: below that floor the ratio is stochastic amplification, not robustness. Excluded lineages contribute no delta and are dropped from every paired statistic.

### Trade-off curve (primary family: noise)

| family | rho(repro gain, retention change) | selected - drift delta | drift delta | selected delta | dose trend | rho(turnover gain, retention change) |
| :-- | :--: | :--: | :--: | :--: | :--: | :--: |
| noise | -0.282 [-0.645, 0.122] | -0.034 [-0.059, -0.010] | -0.027 [-1.450, 0.048] | -0.048 [-0.605, -0.014] | -0.19 (p=0.352) | -0.364 [-0.707, 0.044] |
| death | 0.068 [-0.362, 0.482] | -0.007 [-0.028, 0.003] | +0.027 [0.005, 0.805] | +0.228 [0.013, 0.320] | -0.07 (p=0.726) | 0.484 [0.094, 0.804] |
| compute | -0.215 [-0.596, 0.206] | +0.046 [-0.045, 0.068] | -0.295 [-1.091, 0.012] | -0.246 [-0.889, -0.043] | -0.03 (p=0.878) | -0.325 [-0.671, 0.088] |

A negative rho means lineages that gained more reproduction lost more retention, i.e. a trade-off. A positive rho means the better replicators were also the more robust ones. The drift control starts from the same ancestor and is viability-filtered but never selected on reproduction, so a selected-drift difference cannot be explained by distance from the ancestor alone.

### Mediation: is the loss explained by turnover?

| family | turnover slope (Theil-Sen) | selected - drift (raw) | selected - drift (turnover-adjusted) |
| :-- | ---: | ---: | ---: |
| noise | -1.620 | -0.034 | -0.224 |
| death | 0.950 | -0.007 | +0.103 |
| compute | -1.505 | +0.046 | -0.449 |

The adjustment subtracts `slope x turnoverGain` from every lineage's retention change, then re-takes the median selected-minus-drift contrast with the same by-seed pairing as the trade-off table, so the raw column equals `selected - drift delta` above. A robust slope is used because three lineages have ancestors that regrow from a few dozen cells after the shock, and least squares would be set by them. Attenuation toward zero is the mediator signature; persistence means the contrast is not simply churn.

### Conway reference (descriptive, not an arm)

`B3/S23`: 158 established offspring on the held-out soups, turnover 0.0678/cell/tick, retention noise 2.196, death 0.373, compute 2.163, viability 100%.

### Decision rule (registered before the run)

| claim | test | verdict |
| :-- | :-- | :-- |
| A-DOOM-01 trade-off | rho <= -0.3 and 95% CI excludes 0 | not supported |
| A-DOOM-02 selection vs drift | selected - drift <= -0.10, selected < ancestor, both CIs exclude 0 | not supported |
| A-DOOM-03 dose-response | dose rho <= -0.8 and permutation p < 0.05 | not supported |
| A-DOOM-04 turnover mediation | turnover rho <= -0.3, CI excludes 0, adjusted contrast halves | not supported |

**Verdict: no-trade-off.** Reproduction gain and retention change are not negatively associated under the primary shock.

## What this does and does not establish

- It tests a Life-like CA, not the agent ecology. A trade-off here is a statement about this class of replicators; it does not transfer to the Tree of Life engine without its own run.
- The ancestor pool is Conway plus 1-3 bit flips, viability-gated. It is not a uniform sample of rule space, so the result is conditional on starting from a working replicator.
- The drift control is a viability-filtered neutral walk. "No selection" here means no selection on reproduction; the viability floor is a constraint, and it is why drift rules are assayable at all.
- `retention` is relative to the pre-shock population. A rule can lose 80% of a large population and still score 0.2; absolute recovery is in the JSON (`prePop`, `postPop`).

## Reproduce

```bash
npm run research:doomsday                  # simulate + analyse
npm run research:doomsday -- --quick      # smoke
npm run research:doomsday -- --from-cache # re-analyse only
```
