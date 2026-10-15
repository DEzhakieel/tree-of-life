# Agent archetypes — simple rules → constraints → cognition → systems

A progressive complexity ladder for the INDIVIDUAL. The engine already contains every faculty; each archetype turns one on as a layer that the previous tier inherits. Every tier runs the same world shape, the same physics baseline (`foodRegenRate=3e-3`, `metabolismBase=0.5`, `energyCapacity=150`) and the same 3 seeds across the same habitat jitter — the tiers differ ONLY by the faculty added, so per-individual complexity is attributable to that faculty.

| tier | the agent in this archetype | faculty added (inherited from below) |
| --- | --- | --- |
| **T0 · simple rules** | fixed genome-reflex (forwardGenome) | fixed genome reflex; founders are clones of one calm genome |
| **T1 · constraints** | genome mutation + biome chemistry reinjection (O2, pH, toxin, water) | fixed genome reflex + calm biome chemistry |
| **T2 · cognition** | plastic MLP brain (backprop + surprise-modulated learning) | learned MLP policy + calm biome chemistry |
| **T3 · systems** | stochastic expression, combinatorial chemistry, recombination, cell biochemistry | learned MLP policy + calm biome chemistry + intracellular omics |

The engine is a pure function of its world definition (SplitMix64 streams seeded by (seed, tick, agent id); ascending-id iteration), so every archetype is verified determinism-first: two runs of the same world reproduce bit-for-bit.

## T0 · simple rules

identical reflex agents on a plain fractal world. Faculty: fixed genome-reflex (forwardGenome); no diversity, chemistry or learning.

| seed | alive | species | births | deaths | genomeDist | memeCV | energyCV | proteomeCV | plastic | surprise | deterministic |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| `archetypes.s1` | 8 | 8 | 0 | 32 | 0.0000 | 0.000 | 0.218 | 0.0000 | 0 | 0.000 | ✓ identical double-run |
| `archetypes.s2` | 5 | 5 | 0 | 35 | 0.0000 | 0.000 | 0.361 | 0.0000 | 0 | 0.000 | ✓ identical double-run |
| `archetypes.s3` | 15 | 15 | 0 | 25 | 0.0000 | 0.000 | 0.276 | 0.0000 | 0 | 0.000 | ✓ identical double-run |

layer effect — population 9.3 ± 5.1; genome distance 0.0000; cultural CV 0.000; energy CV 0.285; protein CV 0.0000; plastic agents 0.0; mean surprise 0.000.

## T1 · constraints

heritable genomes coupled to a calm biome. Faculty: genome mutation + biome chemistry reinjection (O2, pH, toxin, water).

| seed | alive | species | births | deaths | genomeDist | memeCV | energyCV | proteomeCV | plastic | surprise | deterministic |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| `archetypes.s1` | 11 | 9 | 3 | 32 | 0.6220 | 0.812 | 0.722 | 0.0000 | 0 | 0.000 | ✓ identical double-run |
| `archetypes.s2` | 19 | 9 | 15 | 36 | 0.2548 | 0.261 | 0.466 | 0.0000 | 0 | 0.000 | ✓ identical double-run |
| `archetypes.s3` | 19 | 17 | 5 | 26 | 0.6432 | 0.537 | 0.519 | 0.0000 | 0 | 0.000 | ✓ identical double-run |

layer effect — population 16.3 ± 4.6; genome distance 0.5067; cultural CV 0.536; energy CV 0.569; protein CV 0.0000; plastic agents 0.0; mean surprise 0.000.

## T2 · cognition

per-agent learned policy instead of the fixed reflex. Faculty: plastic MLP brain (backprop + surprise-modulated learning).

| seed | alive | species | births | deaths | genomeDist | memeCV | energyCV | proteomeCV | plastic | surprise | deterministic |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| `archetypes.s1` | 10 | 9 | 2 | 32 | 0.6403 | 0.722 | 0.650 | 0.0000 | 1 | 0.121 | ✓ identical double-run |
| `archetypes.s2` | 12 | 10 | 7 | 35 | 0.3724 | 0.335 | 0.697 | 0.0000 | 1 | 0.311 | ✓ identical double-run |
| `archetypes.s3` | 41 | 25 | 75 | 74 | 0.5323 | 0.363 | 0.689 | 0.0000 | 1 | 0.612 | ✓ identical double-run |

layer effect — population 21.0 ± 17.3; genome distance 0.5150; cultural CV 0.473; energy CV 0.679; protein CV 0.0000; plastic agents 1.0; mean surprise 0.348.

## T3 · systems

intracellular omics on top of the learned brain. Faculty: stochastic expression, combinatorial chemistry, recombination, cell biochemistry.

| seed | alive | species | births | deaths | genomeDist | memeCV | energyCV | proteomeCV | plastic | surprise | deterministic |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| `archetypes.s1` | 11 | 9 | 3 | 32 | 0.6335 | 0.749 | 0.583 | 0.0430 | 1 | 0.130 | ✓ identical double-run |
| `archetypes.s2` | 23 | 14 | 19 | 36 | 0.2615 | 0.235 | 0.358 | 0.0179 | 1 | 0.451 | ✓ identical double-run |
| `archetypes.s3` | 18 | 14 | 105 | 127 | 0.6380 | 0.614 | 0.484 | 0.0311 | 1 | 0.581 | ✓ identical double-run |

layer effect — population 17.3 ± 6.0; genome distance 0.5110; cultural CV 0.533; energy CV 0.475; protein CV 0.0306; plastic agents 1.0; mean surprise 0.388.

## What the ladder shows

The measurement columns are constant across tiers, so a faculty's contribution is a column that moves from `0` to `>0` exactly where the faculty is introduced:

| metric (mean over seeds) | T0 | T1 | T2 | T3 |
| --- | ---: | ---: | ---: | ---: |
| genomeDist | 0 | **>0** | **>0** | **>0** |
| memeCV | 0 | **>0** | **>0** | **>0** |
| plastic + surprise | 0 | 0 | **>0** | **>0** |
| proteomeCV | 0 | 0 | 0 | **>0** |

- **T0 → T1 (simple rules → constraints)** — `genomeDist` and `memeCV` leave zero: heritable genomes under a calm-biome constraint regime differentiate the individuals; the reflex itself is unchanged.
- **T1 → T2 (constraints → cognition)** — `plastic` and `surprise` leave zero: behaviour is no longer a fixed reflex but a per-agent learned policy; genome distance is inherited unchanged (cognition does not need new genes).
- **T2 → T3 (cognition → systems)** — `proteomeCV` leaves zero: intracellular protein pools (stochastic expression, combinatorial chemistry) add a second, non-genetic state dimension inside each individual.

The ladder is incremental and monotone by construction — every tier re-runs the exact same worlds and physics as the tier below, so a faculty is added, never replaced.

All 12 (tier, seed) worlds self-reproduced bit-for-bit across the double-run (determinism: PASS).

