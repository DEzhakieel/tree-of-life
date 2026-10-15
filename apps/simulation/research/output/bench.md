# Benchmark suite — canonical A-Life signatures

Mode: **quick** · seeds: 5 (bench-seed-0001, bench-seed-0002, bench-seed-0003, bench-seed-0004, bench-seed-0005) · overall: **PASS** · 15214 ms

Each benchmark is a self-contained deterministic micro-model validated against a literature-defined signature. Gated checks are CI-bound across seeds for stochastic models (a "should happen" check requires the CI lower bound to clear the threshold; a "should not happen" check the upper bound). `~` marks informational checks.

| ID | model | family | verdict | fidelity | determinism | seeds | ms |
| --- | --- | --- | --- | ---: | --- | ---: | ---: |
| A | Random walkers | diffusion | PASS | 1.00 | PASS | 1 | 107 |
| B | Boids | collective motion | PASS | 1.00 | PASS | 5 | 5280 |
| C | Game of Life | cellular automaton | PASS | 1.00 | PASS | 1 | 858 |
| D | Predator–prey | population dynamics | PASS | 1.00 | PASS | 5 | 51 |
| E | Diffusion | continuum transport | PASS | 1.00 | PASS | 1 | 69 |
| F | Reaction–diffusion (Gray–Scott) | pattern formation | PASS | 1.00 | PASS | 5 | 2271 |
| G | Iterated Prisoner’s Dilemma | evolutionary game theory | PASS | 1.00 | PASS | 5 | 3004 |
| H | Resource competition (R*) | community ecology | PASS | 1.00 | PASS | 5 | 159 |
| I | Collective navigation | swarm intelligence | PASS | 1.00 | PASS | 5 | 388 |
| J | Fractal-life composite | novel hybrid | PASS | 1.00 | PASS | 5 | 3022 |

## Signatures

| ID | alpha | msdSlope | dRelErr | phiOn | phiOff | minDistOn | gliderShiftX | gliderShiftY | blinkerPeriod | blockPeriod | pulsarPeriod | gunPeriod | gunDelta | gunDeltaSpread | rpAlive | periodRelErr | phaseLagNorm | invariantDriftPerPeriod | relL2 | massRelErr | msdRelErr | inOccFrac | inVVar | inBlobs | outVMax | coopSpatial | coopWellMixed | winnerCorrect | loserFrac | coexistFA | coexistFB | consensus | arrival | moranCoupled | moranBaseline | selfOrgGain | crossCorr |
| --- | ---: ---: ---: ---: ---: ---: ---: ---: ---: ---: ---: ---: ---: ---: ---: ---: ---: ---: ---: ---: ---: ---: ---: ---: ---: ---: ---: ---: ---: ---: ---: ---: ---: ---: ---: ---: ---: |
| A | 0.987 | 2.028 | 0.014 | NaN | NaN | NaN | NaN | NaN | NaN | NaN | NaN | NaN | NaN | NaN | NaN | NaN | NaN | NaN | NaN | NaN | NaN | NaN | NaN | NaN | NaN | NaN | NaN | NaN | NaN | NaN | NaN | NaN | NaN | NaN | NaN | NaN | NaN |
| B | NaN | NaN | NaN | 0.946 | 0.068 | 6.350 | NaN | NaN | NaN | NaN | NaN | NaN | NaN | NaN | NaN | NaN | NaN | NaN | NaN | NaN | NaN | NaN | NaN | NaN | NaN | NaN | NaN | NaN | NaN | NaN | NaN | NaN | NaN | NaN | NaN | NaN | NaN |
| C | NaN | NaN | NaN | NaN | NaN | NaN | 10.000 | 10.000 | 2.000 | 1.000 | 3.000 | 30.000 | 5.000 | 0.000 | 148.000 | NaN | NaN | NaN | NaN | NaN | NaN | NaN | NaN | NaN | NaN | NaN | NaN | NaN | NaN | NaN | NaN | NaN | NaN | NaN | NaN | NaN | NaN |
| D | NaN | NaN | NaN | NaN | NaN | NaN | NaN | NaN | NaN | NaN | NaN | NaN | NaN | NaN | NaN | 0.000 | 0.245 | 0.000 | NaN | NaN | NaN | NaN | NaN | NaN | NaN | NaN | NaN | NaN | NaN | NaN | NaN | NaN | NaN | NaN | NaN | NaN | NaN |
| E | NaN | NaN | NaN | NaN | NaN | NaN | NaN | NaN | NaN | NaN | NaN | NaN | NaN | NaN | NaN | NaN | NaN | NaN | 0.001 | 0.000 | 0.000 | NaN | NaN | NaN | NaN | NaN | NaN | NaN | NaN | NaN | NaN | NaN | NaN | NaN | NaN | NaN | NaN |
| F | NaN | NaN | NaN | NaN | NaN | NaN | NaN | NaN | NaN | NaN | NaN | NaN | NaN | NaN | NaN | NaN | NaN | NaN | NaN | NaN | NaN | 0.335 | 0.015 | 9.000 | 0.000 | NaN | NaN | NaN | NaN | NaN | NaN | NaN | NaN | NaN | NaN | NaN | NaN |
| G | NaN | NaN | NaN | NaN | NaN | NaN | NaN | NaN | NaN | NaN | NaN | NaN | NaN | NaN | NaN | NaN | NaN | NaN | NaN | NaN | NaN | NaN | NaN | NaN | NaN | 0.931 | 0.000 | NaN | NaN | NaN | NaN | NaN | NaN | NaN | NaN | NaN | NaN |
| H | NaN | NaN | NaN | NaN | NaN | NaN | NaN | NaN | NaN | NaN | NaN | NaN | NaN | NaN | NaN | NaN | NaN | NaN | NaN | NaN | NaN | NaN | NaN | NaN | NaN | NaN | NaN | 1.000 | 0.000 | 0.503 | 0.497 | NaN | NaN | NaN | NaN | NaN | NaN |
| I | NaN | NaN | NaN | NaN | NaN | NaN | NaN | NaN | NaN | NaN | NaN | NaN | NaN | NaN | NaN | NaN | NaN | NaN | NaN | NaN | NaN | NaN | NaN | NaN | NaN | NaN | NaN | NaN | NaN | NaN | NaN | 0.912 | 1.000 | NaN | NaN | NaN | NaN |
| J | NaN | NaN | NaN | NaN | NaN | NaN | NaN | NaN | NaN | NaN | NaN | NaN | NaN | NaN | NaN | NaN | NaN | NaN | NaN | NaN | NaN | NaN | NaN | NaN | NaN | NaN | NaN | NaN | NaN | NaN | NaN | NaN | NaN | 0.384 | 0.001 | 0.384 | 0.468 |

## Checks

### A — Random walkers (PASS)

| check | test | threshold | observed | ci95 | pass | note |
| --- | --- | --- | ---: | --- | --- | --- |
| alpha | range | [0.980, 1.020] | 0.987 | [0.987, 0.987] | yes | MSD is linear in time: log–log slope α = 1 (Einstein). |
| dRelErr | lte | 0.030 | 0.014 | [0.014, 0.014] | yes | fitted MSD slope matches 2σ² to within 3% (D = σ²/2). |

### B — Boids (PASS)

| check | test | threshold | observed | ci95 | pass | note |
| --- | --- | --- | ---: | --- | --- | --- |
| phiOn | gte | 0.800 | 0.946 | [0.941, 0.951] | yes | alignment + cohesion order the flock: Φ ≥ 0.8. |
| phiOff | lte | 0.150 | 0.068 | [0.032, 0.105] | yes | with alignment off, headings stay random: Φ ≈ 1/√N ≤ 0.15. |
| minDistOn | gte | 5.600 | 6.350 | [6.221, 6.471] | yes | separation keeps agents apart: min pairwise distance ≥ 0.8·r_sep. |

### C — Game of Life (PASS)

| check | test | threshold | observed | ci95 | pass | note |
| --- | --- | --- | ---: | --- | --- | --- |
| gliderShiftX | eqAbs | 10.000 | 10.000 | [10.000, 10.000] | yes | glider translates (+1,+1) every 4 generations: +10 cells over 10 periods. |
| blinkerPeriod | eqAbs | 2.000 | 2.000 | [2.000, 2.000] | yes | blinker has period 2. |
| blockPeriod | eqAbs | 1.000 | 1.000 | [1.000, 1.000] | yes | block is a still life (period 1). |
| pulsarPeriod | eqAbs | 3.000 | 3.000 | [3.000, 3.000] | yes | pulsar has period 3. |
| gunPeriod | eqAbs | 30.000 | 30.000 | [30.000, 30.000] | yes | Gosper gun emits one glider (+5 cells) every 30 generations. |
| gunDeltaSpread | eqAbs | 0.000 | 0.000 | [0.000, 0.000] | yes | glider emission rate is perfectly regular (all 30-generation deltas equal). |
| ~rpAlive | gte | 1.000 | 148.000 | [148.000, 148.000] | yes | R-pentomino survives 120 generations (informational; exact 116 needs an infinite plane). |

### D — Predator–prey (PASS)

| check | test | threshold | observed | ci95 | pass | note |
| --- | --- | --- | ---: | --- | --- | --- |
| periodRelErr | lte | 0.020 | 0.000 | [0.000, 0.000] | yes | measured orbit period matches 2π/√(αγ) to within 2%. |
| phaseLagNorm | range | [0.200, 0.300] | 0.245 | [0.244, 0.246] | yes | predator peak lags the prey peak by T/4 = 0.25 T. |
| invariantDriftPerPeriod | lte | 0.005 | 0.000 | [0.000, 0.000] | yes | the first integral H = δx − γ ln x + βy − α ln y drifts by ≤0.5%/period. |

### E — Diffusion (PASS)

| check | test | threshold | observed | ci95 | pass | note |
| --- | --- | --- | ---: | --- | --- | --- |
| relL2 | lte | 0.001 | 0.001 | [0.001, 0.001] | yes | FTCS solution matches the analytic Gaussian to L2 relative error < 1e-3. |
| massRelErr | lte | 0.000 | 0.000 | [0.000, 0.000] | yes | total mass is conserved to machine precision. |
| msdRelErr | lte | 0.010 | 0.000 | [0.000, 0.000] | yes | second moment grows as 4Dt to within 1%. |

### F — Reaction–diffusion (Gray–Scott) (PASS)

| check | test | threshold | observed | ci95 | pass | note |
| --- | --- | --- | ---: | --- | --- | --- |
| inOccFrac | range | [0.150, 0.600] | 0.335 | [0.335, 0.335] | yes | pattern regime: 15–60% of cells are occupied by inhibitor spots. |
| inVVar | gte | 0.010 | 0.015 | [0.015, 0.015] | yes | spatial variance of v exceeds random noise: a real pattern formed. |
| inBlobs | gte | 3.000 | 9.000 | [9.000, 9.000] | yes | the pattern self-organises into ≥3 coherent spots (≥4 cells each). |
| outVMax | lte | 0.050 | 0.000 | [0.000, 0.000] | yes | outside the pattern regime v relaxes to u=1, v=0 (max < 0.05). |

### G — Iterated Prisoner’s Dilemma (PASS)

| check | test | threshold | observed | ci95 | pass | note |
| --- | --- | --- | ---: | --- | --- | --- |
| coopSpatial | gte | 0.900 | 0.931 | [0.924, 0.938] | yes | spatial reciprocity sustains cooperation: ≥90% cooperators. |
| coopWellMixed | lte | 0.050 | 0.000 | [0.000, 0.000] | yes | without spatial structure defectors sweep the population: ≤5% cooperators. |

### H — Resource competition (R*) (PASS)

| check | test | threshold | observed | ci95 | pass | note |
| --- | --- | --- | ---: | --- | --- | --- |
| winnerCorrect | eqAbs | 1.000 | 1.000 | [1.000, 1.000] | yes | the species with the lowest R* wins competitive exclusion. |
| loserFrac | lte | 0.050 | 0.000 | [0.000, 0.000] | yes | the higher-R* species is driven effectively extinct (<5% of biomass). |
| coexistFA | range | [0.100, 0.900] | 0.503 | [0.479, 0.526] | yes | equal-R* species coexist; species A holds 10–90% of biomass. |
| coexistFB | range | [0.100, 0.900] | 0.497 | [0.474, 0.521] | yes | equal-R* species coexist; species B holds 10–90% of biomass. |

### I — Collective navigation (PASS)

| check | test | threshold | observed | ci95 | pass | note |
| --- | --- | --- | ---: | --- | --- | --- |
| consensus | gte | 0.800 | 0.912 | [0.906, 0.920] | yes | the swarm becomes polarised during transit: Φ ≥ 0.8. |
| arrival | gte | 0.900 | 1.000 | [1.000, 1.000] | yes | at least 90% of agents reach the destination. |

### J — Fractal-life composite (PASS)

| check | test | threshold | observed | ci95 | pass | note |
| --- | --- | --- | ---: | --- | --- | --- |
| moranCoupled | gte | 0.200 | 0.384 | [0.347, 0.419] | yes | cross-influence produces spatial auto-correlation in agent density (Moran’s I ≥ 0.20). |
| selfOrgGain | gte | 0.050 | 0.384 | [0.352, 0.413] | yes | pattern strength exceeds the uncoupled baseline (gain ≥ 0.05). |
| crossCorr | gte | 0.300 | 0.468 | [0.431, 0.502] | yes | time-accumulated occupancy and CA activity become positively coupled (r ≥ 0.30). |

## Provenance

- node: `v18.12.1` (`win32/x64`)
- timestamp: `2026-10-15T12:38:45.789Z`
