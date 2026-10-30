# Experiment B - self-replication that attacks itself

Generated 2026-10-30T17:39:45.036Z. simulated in this run (8 seeds x 8 conditions x 1200 ticks).

8 confirmatory seeds x 8 conditions x 1200 ticks on a 40x40 torus. Early window ticks 170-319; late window the final 150 ticks.

## What this measures

Two scales of reproduction are tracked separately. **Scale 1** is cell division into a nearby empty site. **Scale 2** is a nest releasing a propagule; nests are persistent site-level individuals that decay unless local builders maintain them, and the propagule carries the nest's current modal genotype.

The self-attack is structural: a nest is a club good for its lineage tag. A non-builder mutant of that tag keeps the benefit, skips the build cost and divides faster; it dilutes the builder fraction, the nest loses integrity and stops reproducing. Because the propagule carries that genotype, the defection propagates at the second level while local cells persist.

Three interventions target distinct links: `cost` penalises fast local reproduction (small structure); `boundary` seals transmission of the founding build genotype (cross-scale boundary); `signal` lets nests suppress defector births nearby at a cost to their own charge rate (inter-scale signal).

## Pre-registered claims

Effect floor: 0.351 propagules/tick = 2 x the between-seed SD of the control late rate. Super-additivity floor: 0.351.

| claim | verdict | result |
|---|---|---|
| B-SELF-01 | **supported** | local birth retention 1.078 [1.072, 1.085] (need >= 0.80, lo > 0.50); propagule retention 0.113 [0.049, 0.194] (need <= 0.25, hi < 0.50); builder retention 0.161 [0.094, 0.247] (need <= 0.50, hi < 0.75). |
| B-SELF-02a | **inconclusive** | delta 0.258 [0.049, 0.508]; floor 0.351. |
| B-SELF-02b | **refuted** | delta -0.074 [-0.202, 0.034]; floor 0.351. |
| B-SELF-02c | **supported** | delta 0.462 [0.260, 0.635]; floor 0.351. |
| B-SELF-03 | **inconclusive** | rho(localBuild, propagules) = 0.868 [0.778, 0.924]; rho(births, propagules) = -0.527 [-0.709, -0.293]; n = 64. |
| B-SELF-04 | **refuted** | interaction -0.090 [-0.460, 0.269]; floor 0.351. |

## Conditions

| condition | late pop | late births | late builders | late nests | late propagules | propagule retention | decoupled runs | median decouple tick |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| control | 715 | 32.8 | 0.15 | 15.8 | 0.170 | 0.11 | 75% | 895 |
| cost | 665 | 28.1 | 0.30 | 31.2 | 0.428 | 0.31 | 25% | 959 |
| boundary | 717 | 32.8 | 0.10 | 9.1 | 0.096 | 0.06 | 100% | 885 |
| signal | 710 | 32.1 | 0.75 | 91.0 | 0.632 | 0.92 | 0% | n/a |
| cost+boundary | 654 | 27.5 | 0.33 | 32.8 | 0.398 | 0.29 | 0% | n/a |
| cost+signal | 646 | 26.4 | 0.89 | 101.6 | 0.718 | 1.58 | 0% | n/a |
| boundary+signal | 711 | 31.8 | 0.93 | 112.3 | 0.855 | 1.17 | 0% | n/a |
| all | 652 | 26.8 | 0.88 | 100.4 | 0.727 | 1.42 | 0% | n/a |

## Two-scale lineages

| condition | scale-2 lineages alive | still reproducing | max chain depth | mediator: late builder frac |
|---|---:|---:|---:|---:|
| control | 5.8 | 3.4 | 2.3 | 0.38 |
| cost | 7.5 | 5.3 | 2.8 | 0.51 |
| boundary | 5.3 | 2.6 | 2.0 | 0.42 |
| signal | 6.3 | 5.4 | 1.6 | 0.65 |
| cost+boundary | 9.5 | 7.4 | 3.3 | 0.47 |
| cost+signal | 9.6 | 8.9 | 2.0 | 0.67 |
| boundary+signal | 6.3 | 5.4 | 2.0 | 0.68 |
| all | 10.1 | 8.6 | 1.9 | 0.69 |

## Bottleneck

Spearman rho(late local builder fraction, late propagule rate) = 0.868 [0.778, 0.924]; rho(late local birth rate, late propagule rate) = -0.527 [-0.709, -0.293].

## Reading

- Control: local births go from 30.5 to 32.8 per tick (retention 1.08), while propagule rate goes from 1.43 to 0.17 (retention 0.11). The decoupled state is reached in 75% of control runs, at median tick 895, and 1 of 8 control runs retained more than a quarter of their early rate (max 0.36): the collapse is a mean effect with seed-to-seed escapes, not a uniform extinction.
- Signal alone: late propagule rate 0.632 vs control 0.170; late builder fraction 0.65. Cost alone: 0.428; boundary alone: 0.096. Combined (all three): 0.727, which is not above signal alone.
- The bottleneck: rho(late builder fraction, late propagules) = 0.868 [0.778, 0.924], so builder supply tracks scale-2 output strongly. But rho(late local births, late propagules) = -0.527 [-0.709, -0.293], outside the pre-registered |rho| < 0.50 bound, so B-SELF-03 is inconclusive rather than supported. The boundary result is a refutation of the registered direction (point estimate below zero, interval spanning zero), not evidence that sealing can never work.

## Not claimed

- That this is a general law of major evolutionary transitions. The model implements three specific mechanisms; their relative strength is a property of this ecology, not a universal ranking.
- That the boundary intervention is ineffective in general. It is implemented as germline sequestration of the build trait; other boundary mechanisms (spatial sealing, policing at membership) were not tested.
- That a collapse in the control is "adaptive" or "inevitable". It is a parameter-dependent outcome of the mutation rate, the build burden and the nest bonus.

## Reproduce

```bash
npm run research:selfattack
npm run research:selfattack -- --from-cache
npm run research:selfattack -- --quick   # smoke test only
```
