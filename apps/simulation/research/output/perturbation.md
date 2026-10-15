# Perturbation study: one baseline, four single-axis perturbations

Baseline: **100 agents, energy 100, noise 0.1, cooperation 0.5**,
read at tick 200. 5 seeds (perturb.s1, perturb.s2, perturb.s3, perturb.s4, perturb.s5).
Every perturbation is paired on the seed and measured against the baseline run in the same
world from the same founder placement, so the habitat cancels out of every delta.

**How to read a delta.** Each cell is the mean over seeds of `Y_perturbed - Y_baseline`,
plus `+-` the standard deviation across seeds. A cell marked `(reverses)` kept the same
absolute sign on some seeds and the opposite sign on others, which means the effect is
smaller than the variation between worlds: the mean is then a description of that
variation, not of the perturbation. Only unflagged cells are claims about the perturbation.

## Baseline outcome, per seed

| seed | aliveFrac | meanEnergy | energyTotal | cooperationRate | donorFrac | foodCv | spacing | spacingCv | polarization | memeDominance |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| perturb.s1 | 1.0000 | 75.2889 | 7528.8916 | 0.0000 | 0.0000 | 0.6880 | 2.8225 | 0.5428 | 0.0725 | 0.1000 |
| perturb.s2 | 1.0000 | 77.1710 | 7717.1035 | 0.0000 | 0.0000 | 0.6941 | 2.9377 | 0.5147 | 0.0725 | 0.1100 |
| perturb.s3 | 1.0000 | 77.4270 | 7742.6963 | 0.0000 | 0.0000 | 0.6990 | 2.7208 | 0.4797 | 0.0731 | 0.1000 |
| perturb.s4 | 1.0000 | 82.1835 | 8218.3456 | 0.0000 | 0.0000 | 0.6919 | 2.8010 | 0.4940 | 0.0724 | 0.1000 |
| perturb.s5 | 1.0000 | 81.2616 | 8126.1554 | 0.0000 | 0.0000 | 0.6762 | 2.7831 | 0.5908 | 0.0725 | 0.1000 |

The baseline itself varies between worlds, which is the noise floor every delta below is
measured against:

| outcome | baseline across-seed CV |
| --- | --- |
| `aliveFrac` | 0.0% |
| `meanEnergy` | 3.7% |
| `energyTotal` | 3.7% |
| `cooperationRate` | 0.0% |
| `donorFrac` | 0.0% |
| `foodCv` | 1.2% |
| `spacing` | 2.8% |
| `spacingCv` | 8.4% |
| `polarization` | 0.4% |
| `memeDominance` | 4.4% |

## `no-cooperation` - cooperation gene 0.5 -> 0

> **Channel never opened.** the donation rule needs an agent above 75% capacity beside one below 30%; rich agent-samples peaked at 713, needy at 0, and agents average 2.80 neighbours.
> Every delta below is therefore a measurement of a pathway that did not run, not a
> finding that the perturbation has no effect. Read it as an untested axis.

No outcome moved on any seed.
Consistent with the channel verdict above - the pathway never opened, so this is not
evidence of an inert perturbation.

## `noise-x2` - pattern-drive noise 0.1 -> 0.2

Channel exercised: 2000 moving agent-samples.

| outcome | baseline | perturbed | delta Y | across-seed sd | verdict |
| --- | --- | --- | --- | --- | --- |
| `aliveFrac` | 1.0000 | 1.0000 | +0.0000 (reverses) | 0.0000 | no change |
| `meanEnergy` | 78.6664 | 78.4195 | -0.2469 | 0.0927 | **consistent** (62% coherence) |
| `energyTotal` | 7866.6385 | 7841.9469 | -24.6916 | 9.2702 | **consistent** (62% coherence) |
| `cooperationRate` | 0.0000 | 0.0000 | +0.0000 (reverses) | 0.0000 | no change |
| `donorFrac` | 0.0000 | 0.0000 | +0.0000 (reverses) | 0.0000 | no change |
| `foodCv` | 0.6898 | 0.6898 | -1.4e-5 (reverses) | 1.5e-5 | sign reverses |
| `spacing` | 2.8130 | 2.8096 | -0.0034 (reverses) | 0.0072 | sign reverses |
| `spacingCv` | 0.5244 | 0.5234 | -0.0010 (reverses) | 0.0032 | sign reverses |
| `polarization` | 0.0726 | 0.0726 | -1.9e-5 (reverses) | 0.0002 | sign reverses |
| `memeDominance` | 0.1020 | 0.1020 | +0.0000 (reverses) | 0.0000 | no change |

Robust across every seed:
- `energyTotal` -24.6916 (|delta| 14.4102 to 36.3205)
- `meanEnergy` -0.2469 (|delta| 0.1441 to 0.3632)

Sign reverses between worlds, so these are **not** attributed to the perturbation:
- `spacing` mean -0.0034 (reverses) but sd 0.0072 across 5 seeds
- `spacingCv` mean -0.0010 (reverses) but sd 0.0032 across 5 seeds
- `polarization` mean -1.9e-5 (reverses) but sd 0.0002 across 5 seeds
- `foodCv` mean -1.4e-5 (reverses) but sd 1.5e-5 across 5 seeds

## `cull-20pct` - 20% of live agents killed at the run midpoint

Channel exercised: 20-20 agents removed per run.

| outcome | baseline | perturbed | delta Y | across-seed sd | verdict |
| --- | --- | --- | --- | --- | --- |
| `aliveFrac` | 1.0000 | 0.8000 | -0.2000 | 0.0000 | **consistent** (100% coherence) |
| `meanEnergy` | 78.6664 | 78.4432 | -0.2232 (reverses) | 1.1540 | sign reverses |
| `energyTotal` | 7866.6385 | 6275.4575 | -1591.1810 | 97.6100 | **consistent** (94% coherence) |
| `cooperationRate` | 0.0000 | 0.0000 | +0.0000 (reverses) | 0.0000 | no change |
| `donorFrac` | 0.0000 | 0.0000 | +0.0000 (reverses) | 0.0000 | no change |
| `foodCv` | 0.6898 | 0.6897 | -0.0001 | 3.6e-5 | **consistent** (74% coherence) |
| `spacing` | 2.8130 | 3.1986 | +0.3856 | 0.1706 | **consistent** (56% coherence) |
| `spacingCv` | 0.5244 | 0.5380 | +0.0136 (reverses) | 0.0456 | sign reverses |
| `polarization` | 0.0726 | 0.0700 | -0.0027 | 0.0001 | **consistent** (95% coherence) |
| `memeDominance` | 0.1020 | 0.1125 | +0.0105 (reverses) | 0.0060 | sign reverses |

Robust across every seed:
- `energyTotal` -1591.1810 (|delta| 1488.2272 to 1721.8340)
- `spacing` +0.3856 (|delta| 0.1571 to 0.6254)
- `aliveFrac` -0.2000 (|delta| 0.2000 to 0.2000)
- `polarization` -0.0027 (|delta| 0.0026 to 0.0029)

Sign reverses between worlds, so these are **not** attributed to the perturbation:
- `meanEnergy` mean -0.2232 (reverses) but sd 1.1540 across 5 seeds
- `spacingCv` mean +0.0136 (reverses) but sd 0.0456 across 5 seeds
- `memeDominance` mean +0.0105 (reverses) but sd 0.0060 across 5 seeds

## `no-communication` - signal emission off

Channel exercised: signal deposited, max 133.85.

| outcome | baseline | perturbed | delta Y | across-seed sd | verdict |
| --- | --- | --- | --- | --- | --- |
| `aliveFrac` | 1.0000 | 1.0000 | +0.0000 (reverses) | 0.0000 | no change |
| `meanEnergy` | 78.6664 | 79.1927 | +0.5264 | 0.0411 | **consistent** (92% coherence) |
| `energyTotal` | 7866.6385 | 7919.2742 | +52.6357 | 4.1104 | **consistent** (92% coherence) |
| `cooperationRate` | 0.0000 | 0.0000 | +0.0000 (reverses) | 0.0000 | no change |
| `donorFrac` | 0.0000 | 0.0000 | +0.0000 (reverses) | 0.0000 | no change |
| `foodCv` | 0.6898 | 0.6898 | -3.6e-6 | 1.2e-6 | **consistent** (66% coherence) |
| `spacing` | 2.8130 | 2.8130 | +0.0000 (reverses) | 0.0000 | no change |
| `spacingCv` | 0.5244 | 0.5244 | +0.0000 (reverses) | 0.0000 | no change |
| `polarization` | 0.0726 | 0.0726 | +0.0000 (reverses) | 0.0000 | no change |
| `memeDominance` | 0.1020 | 0.1020 | +0.0000 (reverses) | 0.0000 | no change |

Robust across every seed:
- `energyTotal` +52.6357 (|delta| 48.2405 to 58.9061)
- `meanEnergy` +0.5264 (|delta| 0.4824 to 0.5891)
- `foodCv` -3.6e-6 (|delta| 2.3e-6 to 5.0e-6)

## What this does and does not establish

Each perturbation moves one axis and is paired on the seed, so a sign-consistent delta is
attributable to that axis within this baseline. Three limits are structural rather than
fixable by more seeds:

- **One baseline.** Every delta is measured against 100 agents / energy
  100 / noise 0.1 / cooperation 0.5. A delta is a
  derivative at that point, not a general sensitivity.
- **Single axis only.** Nothing here separates an interaction between two perturbations,
  because no pair was run.
- **5 seeds.** Enough to expose a sign flip, not enough to estimate a distribution well.
  The `across-seed sd` column is reported precisely because n is small: treat the mean as
  indicative and the sign as the claim.

Every run was executed twice and its outcome vector compared; all replays matched.
