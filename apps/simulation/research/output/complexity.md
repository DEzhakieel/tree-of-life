# The virtual complexity lab

A deterministic instrument for complex-systems measurement. **Rule set → experiments → phase transition**: the agent ladder (archetypes.ts) is the rule set (T0 simple rules … T3 systems); TWO micro parameters are each air-gapped into a mega-experiment and their effect on macro behaviour is measured by PARTIAL DIFFERENTIATION, `∂O/∂(log₁₀ p)`, via central finite differences.

- **Micro parameter #1 — cell capacity** `energyCapacity` (PRIMARY). Every cell’s carrying capacity and every agent’s initial reserve scale linearly with it. Swept on a log₁₀ grid over [10, 600], ~×60. Medium stays natural.
- **Micro parameter #2 — supply** `foodRegenRate`. Food energy released per cell per tick. Swept on a log₁₀ grid over [1e-5, 3e-2], ~×3000. On this axis the lab imposes a SCARCITY regime — agent reserves are capped at 25 and the food ENDOWMENT is calibrated ∝ the rate — so the parameter governs total supply while the population runs close to its energy floor and the effect of the micro parameter is NOT swamped by a fixed stock.

**Ledger:** 624 deterministic experiments · 208 s · audit: 24 worlds double-run, 0 divergences — bit-reproducible (PASS).

## 1 · Phase scan (mean-over-seed macro columns, both axes)

`aliveFrac` is the population order parameter. Rows sample each axis at matching log-decades.

| axis | rule set | lg p | aliveFrac | species | coop | donation | memeEnt | trophic | traitVar |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| capacity | T0 · simple rules | 1.00 | 0.229 | 3.7 | 0.408 | 0.000 | 0.000 | 1.061 | 0.7081 |
| capacity | T1 · constraints | 1.00 | 0.208 | 3.3 | 0.425 | 0.000 | 1.667 | 1.104 | 0.6873 |
| capacity | T2 · cognition | 1.00 | 0.188 | 3.0 | 0.422 | 0.000 | 1.528 | 0.833 | 0.6728 |
| capacity | T3 · systems | 1.00 | 0.188 | 3.0 | 0.422 | 0.000 | 1.528 | 0.833 | 0.6728 |
| supply | T0 · simple rules | -5.00 | 0.125 | 2.0 | 0.510 | 0.000 | 0.000 | 0.500 | 0.3994 |
| supply | T1 · constraints | -5.00 | 0.094 | 1.5 | 0.564 | 0.000 | 0.500 | 0.000 | 0.3994 |
| supply | T2 · cognition | -5.00 | 0.094 | 1.5 | 0.564 | 0.000 | 0.500 | 0.000 | 0.3994 |
| supply | T3 · systems | -5.00 | 0.125 | 2.0 | 0.510 | 0.000 | 1.000 | 0.500 | 0.3994 |
| capacity | T0 · simple rules | 1.41 | 0.229 | 3.7 | 0.408 | 0.000 | 0.000 | 1.061 | 0.7081 |
| capacity | T1 · constraints | 1.41 | 0.271 | 4.0 | 0.387 | 0.000 | 1.613 | 1.060 | 0.7252 |
| capacity | T2 · cognition | 1.41 | 0.250 | 3.7 | 0.400 | 0.000 | 1.615 | 1.031 | 0.7031 |
| capacity | T3 · systems | 1.41 | 0.271 | 3.7 | 0.387 | 0.000 | 1.613 | 1.060 | 0.7309 |
| supply | T0 · simple rules | -4.01 | 0.125 | 2.0 | 0.510 | 0.000 | 0.000 | 0.500 | 0.3994 |
| supply | T1 · constraints | -4.01 | 0.125 | 2.0 | 0.510 | 0.000 | 1.000 | 0.500 | 0.3994 |
| supply | T2 · cognition | -4.01 | 0.094 | 1.5 | 0.564 | 0.000 | 0.500 | 0.000 | 0.3994 |
| supply | T3 · systems | -4.01 | 0.125 | 2.0 | 0.510 | 0.000 | 1.000 | 0.500 | 0.3994 |
| capacity | T0 · simple rules | 1.96 | 0.229 | 3.7 | 0.408 | 0.000 | 0.000 | 1.061 | 0.7081 |
| capacity | T1 · constraints | 1.96 | 0.292 | 4.0 | 0.390 | 0.000 | 1.723 | 1.126 | 0.7304 |
| capacity | T2 · cognition | 1.96 | 0.292 | 4.0 | 0.390 | 0.000 | 1.723 | 1.126 | 0.7304 |
| capacity | T3 · systems | 1.96 | 0.292 | 4.3 | 0.390 | 0.000 | 1.723 | 1.126 | 0.7310 |
| supply | T0 · simple rules | -3.01 | 0.125 | 2.0 | 0.510 | 0.000 | 0.000 | 0.500 | 0.3994 |
| supply | T1 · constraints | -3.01 | 0.125 | 2.0 | 0.510 | 0.000 | 1.000 | 0.500 | 0.3994 |
| supply | T2 · cognition | -3.01 | 0.125 | 2.0 | 0.510 | 0.000 | 1.000 | 0.500 | 0.3994 |
| supply | T3 · systems | -3.01 | 0.125 | 2.0 | 0.510 | 0.000 | 1.000 | 0.500 | 0.3994 |
| capacity | T0 · simple rules | 2.37 | 0.229 | 3.7 | 0.408 | 0.000 | 0.000 | 1.061 | 0.7081 |
| capacity | T1 · constraints | 2.37 | 0.313 | 4.7 | 0.383 | 0.000 | 1.698 | 1.099 | 0.7286 |
| capacity | T2 · cognition | 2.37 | 0.313 | 4.3 | 0.383 | 0.000 | 1.829 | 1.099 | 0.7286 |
| capacity | T3 · systems | 2.37 | 0.292 | 4.0 | 0.390 | 0.000 | 1.723 | 1.126 | 0.7288 |
| supply | T0 · simple rules | -2.52 | 0.125 | 2.0 | 0.510 | 0.000 | 0.000 | 0.500 | 0.3994 |
| supply | T1 · constraints | -2.52 | 0.125 | 2.0 | 0.510 | 0.000 | 1.000 | 0.500 | 0.3994 |
| supply | T2 · cognition | -2.52 | 0.125 | 2.0 | 0.510 | 0.000 | 1.000 | 0.500 | 0.3994 |
| supply | T3 · systems | -2.52 | 0.125 | 2.0 | 0.510 | 0.000 | 1.000 | 0.500 | 0.3994 |
| capacity | T0 · simple rules | 2.78 | 0.229 | 3.7 | 0.408 | 0.000 | 0.000 | 1.061 | 0.7081 |
| capacity | T1 · constraints | 2.78 | 0.313 | 4.7 | 0.383 | 0.000 | 1.698 | 1.099 | 0.7317 |
| capacity | T2 · cognition | 2.78 | 0.313 | 4.7 | 0.383 | 0.000 | 1.698 | 1.099 | 0.7323 |
| capacity | T3 · systems | 2.78 | 0.313 | 4.3 | 0.383 | 0.000 | 1.698 | 1.099 | 0.7279 |
| supply | T0 · simple rules | -1.52 | 0.156 | 2.5 | 0.506 | 0.000 | 0.000 | 0.959 | 0.4385 |
| supply | T1 · constraints | -1.52 | 0.125 | 2.0 | 0.510 | 0.000 | 1.000 | 0.500 | 0.3994 |
| supply | T2 · cognition | -1.52 | 0.125 | 2.0 | 0.510 | 0.000 | 1.000 | 0.500 | 0.3994 |
| supply | T3 · systems | -1.52 | 0.125 | 2.0 | 0.510 | 0.000 | 1.000 | 0.500 | 0.3994 |

## 2 · Partial differentials & critical points

Capacity axis: max |∂(aliveFrac)/∂lg p| = 0.343; supply axis: max |∂(aliveFrac)/∂lg p| = 0.008. All candidate critical loci (local maxima ≥35% of the axis’s strongest derivative with an order step ≥15% of its range, tested at a ×3 horizon — `rebound` = the SAME macro column O at the ×3 horizon minus its short-scan mean at the same p):

| axis | rule set | column | lg p* | p* | max|∂O| | step | rebound |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: |
| cellCap | T1 · constraints | species | 2.23 | 1.70e+2 | 2.437 | 0.667 | +1.000 |
| cellCap | T1 · constraints | memeEntropy | 1.68 | 4.83e+1 | 0.808 | 0.110 | +0.528 |
| cellCap | T2 · cognition | memeEntropy | 1.68 | 4.83e+1 | 0.808 | 0.109 | +0.528 |
| cellCap | T3 · systems | memeEntropy | 1.55 | 3.52e+1 | 0.402 | 0.110 | +0.309 |
| cellCap | T3 · systems | memeEntropy | 1.68 | 4.83e+1 | 0.402 | 0.110 | +0.528 |
| cellCap | T1 · constraints | trophicEntropy | 1.55 | 3.52e+1 | 0.239 | 0.065 | -0.338 |
| cellCap | T1 · constraints | trophicEntropy | 1.68 | 4.83e+1 | 0.239 | 0.065 | -0.208 |
| supply | T1 · constraints | species | -4.50 | 3.14e-5 | 0.503 | 0.500 | +0.500 |
| supply | T1 · constraints | species | -4.01 | 9.85e-5 | 0.503 | 0.500 | +0.000 |
| supply | T1 · constraints | memeEntropy | -4.50 | 3.14e-5 | 0.503 | 0.500 | +0.500 |
| supply | T1 · constraints | memeEntropy | -4.01 | 9.85e-5 | 0.503 | 0.500 | +0.000 |
| supply | T1 · constraints | trophicEntropy | -4.50 | 3.14e-5 | 0.503 | 0.500 | +0.000 |
| supply | T1 · constraints | trophicEntropy | -4.01 | 9.85e-5 | 0.503 | 0.500 | -0.500 |
| supply | T0 · simple rules | species | -2.52 | 3.05e-3 | 0.503 | 0.500 | +0.000 |
| supply | T0 · simple rules | species | -2.02 | 9.56e-3 | 0.503 | 0.500 | +0.500 |
| supply | T2 · cognition | species | -3.01 | 9.70e-4 | 0.503 | 0.500 | +0.000 |
| supply | T2 · cognition | memeEntropy | -3.01 | 9.70e-4 | 0.503 | 0.500 | +0.000 |
| supply | T2 · cognition | trophicEntropy | -3.01 | 9.70e-4 | 0.503 | 0.500 | -0.500 |
| supply | T0 · simple rules | trophicEntropy | -2.52 | 3.05e-3 | 0.462 | 0.459 | -0.500 |
| supply | T0 · simple rules | trophicEntropy | -2.02 | 9.56e-3 | 0.462 | 0.459 | -0.041 |

Critical-exponent estimates near the strongest loci (log–log slope of O vs |p − p*| over ±0.5 lg window):

| axis | rule set | p* | β | R² | n |
| --- | --- | ---: | ---: | ---: | ---: |
| cellCap | T1 · constraints | 1.70e+2 | 0.05 | 0.00 | 18 |
| cellCap | T1 · constraints | 4.83e+1 | 0.01 | 0.00 | 18 |
| cellCap | T2 · cognition | 4.83e+1 | 0.01 | 0.00 | 18 |
| supply | T1 · constraints | 3.14e-5 | 0.30 | 0.33 | 4 |
| supply | T1 · constraints | 9.85e-5 | 0.30 | 0.33 | 4 |
| supply | T1 · constraints | 3.14e-5 | 0.00 | 0.00 | 0 |

## 3 · Attractors & bifurcations

End-state modes (kernel-density peaks of final alive fraction over all scan worlds per rule set) and bistable windows in which seeds split onto ≥ 2 modes — co-existing branches are the fingerprint of a first-order transition.

| axis | rule set | attractor modes | peak locations | bistable windows |
| --- | --- | ---: | --- | ---: |
| capacity | T0 · simple rules | 1 | 0.26 | 0 |
| capacity | T1 · constraints | 2 | 0.14, 0.38 | 9 |
| capacity | T2 · cognition | 2 | 0.14, 0.37 | 9 |
| capacity | T3 · systems | 2 | 0.14, 0.36 | 9 |
| supply | T0 · simple rules | 1 | 0.13 | 0 |
| supply | T1 · constraints | 1 | 0.12 | 0 |
| supply | T2 · cognition | 1 | 0.11 | 0 |
| supply | T3 · systems | 1 | 0.13 | 0 |

## 4 · Feedback loops (capacity axis)

Lag-1 birth↔population correlation per log-decade (ρ > 0 = the boom amplifies itself; ρ < 0 = density regulation). Overdispersion V(births)/E(births): >1 clustered bursts, ≈1 near-random, <1 regularized.

| rule set | lg p | ρ(births, alive[t−1]) | overdispersion |
| --- | ---: | ---: | ---: |
| T0 · simple rules | 1.00 | 0.000 | 0.00 |
| T0 · simple rules | 1.14 | 0.000 | 0.00 |
| T0 · simple rules | 1.27 | 0.000 | 0.00 |
| T0 · simple rules | 1.41 | 0.000 | 0.00 |
| T0 · simple rules | 1.55 | 0.000 | 0.00 |
| T0 · simple rules | 1.68 | 0.000 | 0.00 |
| T0 · simple rules | 1.82 | 0.000 | 0.00 |
| T0 · simple rules | 1.96 | 0.000 | 0.00 |
| T0 · simple rules | 2.09 | 0.000 | 0.00 |
| T0 · simple rules | 2.23 | 0.000 | 0.00 |
| T0 · simple rules | 2.37 | 0.000 | 0.00 |
| T0 · simple rules | 2.50 | 0.000 | 0.00 |
| T0 · simple rules | 2.64 | 0.000 | 0.00 |
| T0 · simple rules | 2.78 | 0.000 | 0.00 |
| T1 · constraints | 1.00 | 0.000 | 0.00 |
| T1 · constraints | 1.14 | -0.051 | 0.67 |
| T1 · constraints | 1.27 | -0.046 | 0.66 |
| T1 · constraints | 1.41 | -0.053 | 0.66 |
| T1 · constraints | 1.55 | -0.047 | 0.66 |
| T1 · constraints | 1.68 | -0.050 | 0.66 |
| T1 · constraints | 1.82 | -0.051 | 0.66 |
| T1 · constraints | 1.96 | -0.051 | 0.66 |
| T1 · constraints | 2.09 | -0.062 | 0.66 |
| T1 · constraints | 2.23 | -0.064 | 0.66 |
| T1 · constraints | 2.37 | -0.048 | 0.66 |
| T1 · constraints | 2.50 | -0.049 | 0.66 |
| T1 · constraints | 2.64 | -0.049 | 0.66 |
| T1 · constraints | 2.78 | -0.050 | 0.66 |
| T2 · cognition | 1.00 | 0.000 | 0.00 |
| T2 · cognition | 1.14 | -0.017 | 0.33 |
| T2 · cognition | 1.27 | -0.054 | 0.67 |
| T2 · cognition | 1.41 | -0.050 | 0.66 |

## 5 · Stability & instability (density infusion)

Twins of the same (seed, p, rule set) at spawn 16 vs infused spawn 32, three regimes of cell capacity. Same basin + small Δ ⇒ the branch is stable to that density disturbance; a basin crossing marks instability.

| rule set | regime | p | ΔaliveFrac | verdict |
| --- | --- | ---: | ---: | --- |
| T1 · constraints | fragile (cap 15) | 15 | 0.063 | stable (small delta) |
| T1 · constraints | fragile (cap 15) | 15 | 0.125 | unstable (crossed basins) |
| T1 · constraints | established (cap 80) | 80 | 0.156 | unstable (crossed basins) |
| T1 · constraints | established (cap 80) | 80 | 0.125 | unstable (crossed basins) |
| T1 · constraints | luxury (cap 500) | 500 | 0.156 | unstable (crossed basins) |
| T1 · constraints | luxury (cap 500) | 500 | 0.125 | unstable (crossed basins) |
| T3 · systems | fragile (cap 15) | 15 | 0.063 | stable (small delta) |
| T3 · systems | fragile (cap 15) | 15 | 0.063 | stable (small delta) |
| T3 · systems | established (cap 80) | 80 | 0.156 | unstable (crossed basins) |
| T3 · systems | established (cap 80) | 80 | 0.125 | unstable (crossed basins) |
| T3 · systems | luxury (cap 500) | 500 | 0.188 | unstable (crossed basins) |
| T3 · systems | luxury (cap 500) | 500 | 0.125 | unstable (crossed basins) |

## 6 · Path dependence & hysteresis

At every p the two sweeps differ ONLY in heritable history: the upward sweep starts naive founders; the downward sweep seeds founders with genomes evolved for 40 ticks at the RICH end of the capacity axis (p = 600) and folded into every founding genome on the way down. A nonzero loop on the same p is path dependence; a large loop across one p is the signature of a first-order transition that must be re-funded more generously than it lost.

| rule set | loop area (lg-p) | path-dependence index | max ΔaliveFrac |
| --- | ---: | ---: | ---: |
| T1 · constraints | 0.094 | 1.00 | 0.063 |
| T3 · systems | 0.000 | 0.00 | 0.000 |

## 7 · Scaling laws

Capacity → alive fraction: b = 0.13 (SE 0.03, R² = 0.78, n = 7).
Supply → alive fraction: b = 0.00 (R² = 0.00). · Supply → species: b = 0.00 (R² = 0.00).
Group size → per-capita energy acquired: T1 b = 0.61, T3 b = 0.57 (R² = 0.73). No superlinear collective advantage observed on this axis.

## 8 · Cooperation, specialization, collective intelligence across rule sets

One regime (cell capacity 150, supply 3e-3, 60-tick horizon) across the ladder: does adding constraints, cognition and systems move cooperation, donation and specialization?

| rule set | living | aliveFrac | cooperation | donation | trophic entropy | species | meme entropy |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| T0 · simple rules | 1.00 | 0.208 | 0.423 | 0.000 | 1.096 | 3.3 | 0.000 |
| T1 · constraints | 1.00 | 0.292 | 0.395 | 0.000 | 1.100 | 4.3 | 1.583 |
| T2 · cognition | 1.00 | 0.292 | 0.394 | 0.000 | 1.135 | 4.3 | 1.604 |
| T3 · systems | 1.00 | 0.292 | 0.394 | 0.000 | 1.135 | 4.3 | 1.604 |

## 9 · Two-parameter interaction (capacity × supply)

Mean alive fraction across the (cell capacity, food regen rate) surface (storage × flux). A large |∂²O/∂lg(cap)·∂lg(g)| means the two axes interact: supply can amplify or suppress the capacity transition depending on the regime.

| rule set | column | max |∂²O/∂lg(cap)·∂lg(g)| | at cap | at g |
| --- | --- | ---: | ---: | ---: |
| T2 · cognition | species | 0.106 | 60.00 | 3.00e-3 |

## 10 · Critical-point refinement (local zoom)

Top critical loci re-sampled at higher log resolution (±0.35 lg around p*) to estimate transition width and curvature. A transition is **sharp** if the half-max width w < 0.3 lg.

| axis | rule set | column | lp* | p* | |∂|peak | width (lg p) | curvature | sharp |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| cellCap | T1 · constraints | species | 1.881 | 7.60e+1 | 0.000 | 0.000 | 0.0000 | no |
| cellCap | T1 · constraints | memeEntropy | 1.567 | 3.69e+1 | 0.707 | 0.117 | 12.1115 | yes |
| cellCap | T2 · cognition | memeEntropy | 1.567 | 3.69e+1 | 0.707 | 0.117 | 12.1115 | yes |
| supply | T1 · constraints | species | -4.270 | 5.37e-5 | 2.143 | 0.117 | 36.7347 | yes |

## Phenomenon → evidence

- **critical points** — 34 candidate loci across both axes (strongest = species @ cellCap p=1.7e+2)
- **phase transitions** — 0 capacity-axis alive transitions + 5 supply-axis transitions (+ step of 0.09 across the capacity grid)
- **attractors** — T0=1 mode(s) @ [0.26] · T1=2 mode(s) @ [0.14, 0.38] · T2=2 mode(s) @ [0.14, 0.37] · T3=2 mode(s) @ [0.14, 0.36] · supply: T0=1 mode(s) @ [0.13] · T1=1 mode(s) @ [0.12] · T2=1 mode(s) @ [0.11] · T3=1 mode(s) @ [0.13]
- **bifurcations** — 27 bistable windows (capacity) + 0 (supply)
- **feedback loops** — T1@cell1.14=-0.05 · T1@cell1.41=-0.05 · T1@cell1.68=-0.05 · T1@cell1.82=-0.05 · T1@cell1.96=-0.05 · T1@cell2.09=-0.06 · T1@cell2.23=-0.06 · T3@cell1.14=-0.05
- **stability / instability** — 3/12 infusion twins settled in the SAME basin
- **scaling laws** — cap→alive b=0.13 · sup→alive b=0.00 · sup→species b=0.00
- **path dependence** — up-vs-down Δ aliveFrac up to 0.063 at identical p
- **hysteresis** — loop areas: T1 0.094 · T3 0.000
- **cooperation** — peak mean cooperation 0.423 at T0
- **specialization** — trophic entropy T0→T3: 1.10 → 1.10 → 1.14 → 1.14
- **collective intelligence** — per-capita group scaling: T1 b=0.61, T3 b=0.57 → sublinear (crowding) (R²=0.73)
- **parameter interaction** — strongest cross-term species: ∂²O/∂lg(cap)·∂lg(g) = 0.106 @ (cap 10^1.78, g 10^-2.5) (T2); a positive term means supply AMPLIFIES the capacity response, negative = suppresses
- **transition sharpness** — 3/4 refined loci are SHARP (width < 0.3 lg) — resolved transitions vs gradual gradients

