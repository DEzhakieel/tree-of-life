# Emergence — an object that can be measured

Emergence is typed here as a measurement object over five observable axes, all computed from one deterministic double-run of a world:

1. **information in the micro level** — Shannon entropy of the species composition *among living individuals* plus the entropy of their positions on the fine 128² terrain lattice (bits; upper-bound proxy of the joint micro state).
2. **information in the macro level** — Shannon entropy of the quantized aggregate macro-state sequence the system visits (aliveFrac · species · energyMean · cooperation · memeEntropy, each 8 bins).
3. **complexity** — LMC of the species abundance (entropy × disequilibrium; the engine's `stats().complexity` formula, re-derived here).
4. **self-organization** — deviation from the maximum-entropy uniform arrangement: aggregation order `1−H/logBins` of the coarse 16² occupancy, and the coarse-to-fine entropy ratio `1−H_coarse/H_fine`.
5. **temporal persistence** — survival fraction, mean lag-1..8 population autocorrelation, and first-half vs second-half species-overlap (Sørensen).

The object also carries the **emergent information** signature (NMI between the quantized micro-information value and the macro state, sync + predictive) and a composite **emergence index** (mean of the five normalised axes), with an **ABSENT / PARTIAL / EMERGENT** verdict.

Every world is measured twice and must reproduce bit-for-bit (outcome fingerprint + macro-state sequence): determinism **PASS**.
Grid: tiers T0–T3 × capacities [60, 150, 400] × 36 worlds, 240 ticks, 40 spawn each.

## Emergence by tier (mean ± sd over capacities × seeds)

| tier | emergence index | verdict | microInfo (bits) | macroInfo (bits) | complexity | self-organization | persistence | EI sync NMI | EI predictive NMI |
| --- | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| **T0 · simple rules** | 0.420 | EMERGENT | 6.29 ± 1.28 | 2.57 | 0.000 | 0.307 | 0.759 | 0.119 | 0.116 |
| **T1 · constraints** | 0.447 | EMERGENT | 6.74 ± 1.10 | 3.78 | 0.065 | 0.359 | 0.698 | 0.191 | 0.182 |
| **T2 · cognition** | 0.450 | EMERGENT | 6.71 ± 1.09 | 3.64 | 0.114 | 0.383 | 0.716 | 0.176 | 0.168 |
| **T3 · systems** | 0.478 | EMERGENT | 6.81 ± 0.92 | 4.19 | 0.152 | 0.424 | 0.728 | 0.210 | 0.202 |

## Normalised axes by tier

| tier | microInfo | macroInfo | complexity | self-organization | persistence | index |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| T0 · simple rules | 0.326 | 0.707 | 0.000 | 0.307 | 0.759 | 0.420 |
| T1 · constraints | 0.349 | 0.818 | 0.012 | 0.359 | 0.698 | 0.447 |
| T2 · cognition | 0.347 | 0.783 | 0.022 | 0.383 | 0.716 | 0.450 |
| T3 · systems | 0.353 | 0.856 | 0.029 | 0.424 | 0.728 | 0.478 |

## Phase-2 metric axes (mean over capacities and seeds)

Each world additionally carries five named metric groups computed from the same deterministic double-run. Spatial metrics read the coarse occupancy lattice; complexity mixes Lempel-Ziv 76 production complexity, a compressed-size ratio, and temporal variability.

| tier | order | species polar. | trait polar. | aggregation | Moran I | fill factor | corr. length | Shannon div. | Simpson div. | evenness | total bits | compress. | LZ-76 c(n) | LZ norm. | temporal cx. |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| T0 · simple rules | 0.609 | 0.000 | 0.332 | 0.364 | 0.209 | 0.221 | 1.000 | 3.147 | 0.876 | 1.000 | 6.293 | 0.906 | 14.778 | 0.225 | 0.025 |
| T1 · constraints | 0.610 | 0.036 | 0.382 | 0.464 | 0.279 | 0.271 | 1.000 | 3.254 | 0.871 | 0.964 | 9.346 | 0.825 | 30.556 | 0.597 | 0.025 |
| T2 · cognition | 0.622 | 0.058 | 0.389 | 0.470 | 0.293 | 0.290 | 1.000 | 3.157 | 0.853 | 0.942 | 9.311 | 0.800 | 36.667 | 0.614 | 0.029 |
| T3 · systems | 0.643 | 0.079 | 0.424 | 0.455 | 0.310 | 0.282 | 1.000 | 3.178 | 0.848 | 0.921 | 9.245 | 0.755 | 47.556 | 0.776 | 0.032 |

## Macro-state detector (population level, not agent level)

A second instrument, deliberately distinct from the metric axes above. Those read individual agents: which species each one is, where it sits, what its traits and energy are. This one never touches an agent. It reads only population aggregates per tick (alive fraction, species count, mean energy, donation ratio, meme entropy), the coarse occupancy lattice, and the quantized macro-state sequence, then places the run in one of five stages:

- **random** — no macroscopic structure; coarse occupancy near uniform.
- **clustered** — the population condenses in space while macro states are still fluid.
- **organized** — spatial structure plus coordination: donations and a settled cultural field.
- **specialized** — spatial structure *and* temporal rigidity: the macro-state sequence collapses onto a few recurrent states.
- **collapsed** — the population cannot hold its own median level of alive fraction, species count or mean energy. Judged on trailing-window levels so the spawn burst cannot masquerade as normal, and not absorbing, because these populations do recover.

The last two columns are the point of the instrument: `macroOrder` is spatial order read at the population scale, `agentOrder` is the agent-scale order blend, and `divergence` is how far the two levels of description disagree.

| tier | structure | coordination | rigidity | persistence | organization | macroOrder | agentOrder | divergence | vitality |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| T0 · simple rules | 0.307 | 0.000 | 0.741 | 0.946 | 0.499 | 0.609 | 0.314 | 0.295 | 0.645 |
| T1 · constraints | 0.359 | 0.082 | 0.660 | 0.876 | 0.494 | 0.610 | 0.343 | 0.267 | 0.852 |
| T2 · cognition | 0.383 | 0.071 | 0.711 | 0.840 | 0.501 | 0.622 | 0.357 | 0.266 | 0.803 |
| T3 · systems | 0.424 | 0.115 | 0.632 | 0.768 | 0.485 | 0.643 | 0.382 | 0.261 | 0.740 |

### Progression by tier (distinct stages in order of first appearance)

| tier | dominant | final | progression | collapsed worlds |
| --- | --- | --- | --- | ---: |
| T0 · simple rules | clustered, random | clustered, random | random > clustered | 0/9 |
| T1 · constraints | clustered, organized, random, specialized | clustered, organized, random, specialized | random > clustered > organized > collapsed > specialized | 3/9 |
| T2 · cognition | organized, random, specialized | clustered, organized, random, specialized | random > clustered > organized > specialized | 0/9 |
| T3 · systems | clustered, organized, random, specialized | clustered, collapsed, organized, random, specialized | random > clustered > collapsed > organized > specialized | 5/9 |

## Detail — per world

| tier | capacity | seed | index | verdict | micro | macro | complexity | S.O. | persist. | EI sync | EI pred | determin. |
| --- | ---: | --- | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| T0 · simple rules | 60 | `archetypes.s1` | 0.427 | EMERGENT | 6.1281 / 0.3166 | 2.7273 / 0.7608 | 0.0000 / 0.0000 | 0.3093 / 0.3093 | 0.7485 / 0.7485 | 0.1334 | 0.1273 | ✓ |
| T0 · simple rules | 150 | `archetypes.s1` | 0.432 | EMERGENT | 6.1281 / 0.3166 | 2.8128 / 0.7846 | 0.0000 / 0.0000 | 0.3093 / 0.3093 | 0.7485 / 0.7485 | 0.1293 | 0.1235 | ✓ |
| T0 · simple rules | 400 | `archetypes.s1` | 0.435 | EMERGENT | 6.1281 / 0.3166 | 2.8615 / 0.7982 | 0.0000 / 0.0000 | 0.3093 / 0.3093 | 0.7485 / 0.7485 | 0.1305 | 0.1230 | ✓ |
| T0 · simple rules | 60 | `archetypes.s2` | 0.406 | EMERGENT | 4.8993 / 0.2550 | 2.8017 / 0.7359 | 0.0000 / 0.0000 | 0.3471 / 0.3471 | 0.6920 / 0.6920 | 0.1131 | 0.1176 | ✓ |
| T0 · simple rules | 150 | `archetypes.s2` | 0.409 | EMERGENT | 4.8993 / 0.2550 | 2.7699 / 0.7485 | 0.0000 / 0.0000 | 0.3471 / 0.3471 | 0.6920 / 0.6920 | 0.1112 | 0.1087 | ✓ |
| T0 · simple rules | 400 | `archetypes.s2` | 0.418 | EMERGENT | 4.8993 / 0.2550 | 2.9381 / 0.7940 | 0.0000 / 0.0000 | 0.3471 / 0.3471 | 0.6920 / 0.6920 | 0.1098 | 0.1036 | ✓ |
| T0 · simple rules | 60 | `archetypes.s3` | 0.382 | PARTIAL | 7.8526 / 0.4064 | 1.4483 / 0.4040 | 0.0000 / 0.0000 | 0.2639 / 0.2639 | 0.8359 / 0.8359 | 0.1565 | 0.1516 | ✓ |
| T0 · simple rules | 150 | `archetypes.s3` | 0.431 | EMERGENT | 7.8526 / 0.4064 | 2.3338 / 0.6510 | 0.0000 / 0.0000 | 0.2639 / 0.2639 | 0.8359 / 0.8359 | 0.0968 | 0.0935 | ✓ |
| T0 · simple rules | 400 | `archetypes.s3` | 0.438 | EMERGENT | 7.8526 / 0.4064 | 2.4516 / 0.6839 | 0.0000 / 0.0000 | 0.2639 / 0.2639 | 0.8359 / 0.8359 | 0.0948 | 0.0917 | ✓ |
| T1 · constraints | 60 | `archetypes.s1` | 0.394 | PARTIAL | 6.4525 / 0.3333 | 2.5073 / 0.6134 | 0.0044 / 0.0008 | 0.3076 / 0.3076 | 0.7167 / 0.7167 | 0.1458 | 0.1383 | ✓ |
| T1 · constraints | 150 | `archetypes.s1` | 0.429 | EMERGENT | 6.5204 / 0.3368 | 3.6291 / 0.7915 | 0.0273 / 0.0051 | 0.3140 / 0.3140 | 0.6981 / 0.6981 | 0.1007 | 0.0956 | ✓ |
| T1 · constraints | 400 | `archetypes.s1` | 0.437 | EMERGENT | 6.5741 / 0.3396 | 3.7800 / 0.8476 | 0.0231 / 0.0043 | 0.3180 / 0.3180 | 0.6767 / 0.6767 | 0.0967 | 0.0895 | ✓ |
| T1 · constraints | 60 | `archetypes.s2` | 0.469 | EMERGENT | 5.2752 / 0.2746 | 4.6005 / 0.9043 | 0.1572 / 0.0302 | 0.4539 / 0.4539 | 0.6841 / 0.6841 | 0.2796 | 0.2666 | ✓ |
| T1 · constraints | 150 | `archetypes.s2` | 0.479 | EMERGENT | 5.8359 / 0.3038 | 4.4664 / 0.8708 | 0.1063 / 0.0204 | 0.4791 / 0.4791 | 0.7208 / 0.7208 | 0.2549 | 0.2524 | ✓ |
| T1 · constraints | 400 | `archetypes.s2` | 0.488 | EMERGENT | 5.6844 / 0.2959 | 4.4377 / 0.9044 | 0.2033 / 0.0390 | 0.4925 / 0.4925 | 0.7072 / 0.7072 | 0.2812 | 0.2687 | ✓ |
| T1 · constraints | 60 | `archetypes.s3` | 0.420 | EMERGENT | 8.0278 / 0.4155 | 3.0782 / 0.7246 | 0.0127 / 0.0024 | 0.2735 / 0.2735 | 0.6856 / 0.6856 | 0.2448 | 0.2293 | ✓ |
| T1 · constraints | 150 | `archetypes.s3` | 0.447 | EMERGENT | 8.1595 / 0.4223 | 3.4885 / 0.8366 | 0.0135 / 0.0025 | 0.2949 / 0.2949 | 0.6791 / 0.6791 | 0.1777 | 0.1709 | ✓ |
| T1 · constraints | 400 | `archetypes.s3` | 0.461 | EMERGENT | 8.0937 / 0.4189 | 4.0506 / 0.8723 | 0.0402 / 0.0075 | 0.2933 / 0.2933 | 0.7151 / 0.7151 | 0.1374 | 0.1274 | ✓ |
| T2 · cognition | 60 | `archetypes.s1` | 0.414 | EMERGENT | 6.5211 / 0.3369 | 2.8740 / 0.7031 | 0.0238 / 0.0044 | 0.3103 / 0.3103 | 0.7146 / 0.7146 | 0.1272 | 0.1218 | ✓ |
| T2 · cognition | 150 | `archetypes.s1` | 0.429 | EMERGENT | 6.5265 / 0.3372 | 3.2051 / 0.7686 | 0.0237 / 0.0044 | 0.3096 / 0.3096 | 0.7235 / 0.7235 | 0.1129 | 0.1107 | ✓ |
| T2 · cognition | 400 | `archetypes.s1` | 0.424 | EMERGENT | 6.5288 / 0.3373 | 3.0483 / 0.7802 | 0.0249 / 0.0046 | 0.3097 / 0.3097 | 0.6906 / 0.6906 | 0.1187 | 0.1109 | ✓ |
| T2 · cognition | 60 | `archetypes.s2` | 0.390 | PARTIAL | 5.4612 / 0.2843 | 2.3761 / 0.6241 | 0.0813 / 0.0156 | 0.4199 / 0.4199 | 0.6057 / 0.6057 | 0.2198 | 0.2062 | ✓ |
| T2 · cognition | 150 | `archetypes.s2` | 0.451 | EMERGENT | 5.8870 / 0.3065 | 3.5272 / 0.8161 | 0.0701 / 0.0134 | 0.4896 / 0.4896 | 0.6288 / 0.6288 | 0.2043 | 0.1799 | ✓ |
| T2 · cognition | 400 | `archetypes.s2` | 0.459 | EMERGENT | 5.3481 / 0.2784 | 3.8008 / 0.8402 | 0.2278 / 0.0437 | 0.4890 / 0.4890 | 0.6456 / 0.6456 | 0.0870 | 0.0817 | ✓ |
| T2 · cognition | 60 | `archetypes.s3` | 0.491 | EMERGENT | 8.2439 / 0.4267 | 4.7664 / 0.8679 | 0.0594 / 0.0112 | 0.3314 / 0.3314 | 0.8181 / 0.8181 | 0.3236 | 0.3229 | ✓ |
| T2 · cognition | 150 | `archetypes.s3` | 0.500 | EMERGENT | 7.8720 / 0.4074 | 4.7559 / 0.8515 | 0.2741 / 0.0515 | 0.3771 / 0.3771 | 0.8114 / 0.8114 | 0.2696 | 0.2631 | ✓ |
| T2 · cognition | 400 | `archetypes.s3` | 0.494 | EMERGENT | 7.9590 / 0.4119 | 4.4155 / 0.7994 | 0.2404 / 0.0452 | 0.4064 / 0.4064 | 0.8054 / 0.8054 | 0.1188 | 0.1155 | ✓ |
| T3 · systems | 60 | `archetypes.s1` | 0.429 | EMERGENT | 6.6294 / 0.3425 | 3.1479 / 0.8057 | 0.0230 / 0.0043 | 0.3396 / 0.3396 | 0.6519 / 0.6519 | 0.1129 | 0.1038 | ✓ |
| T3 · systems | 150 | `archetypes.s1` | 0.428 | EMERGENT | 6.5564 / 0.3387 | 3.1620 / 0.7905 | 0.0280 / 0.0052 | 0.3364 / 0.3364 | 0.6691 / 0.6691 | 0.1156 | 0.1070 | ✓ |
| T3 · systems | 400 | `archetypes.s1` | 0.424 | EMERGENT | 6.6022 / 0.3411 | 3.1685 / 0.7752 | 0.0271 / 0.0051 | 0.3453 / 0.3453 | 0.6549 / 0.6549 | 0.2386 | 0.2343 | ✓ |
| T3 · systems | 60 | `archetypes.s2` | 0.496 | EMERGENT | 5.7919 / 0.3015 | 4.3929 / 0.8952 | 0.2164 / 0.0415 | 0.5389 / 0.5389 | 0.7035 / 0.7035 | 0.3531 | 0.3369 | ✓ |
| T3 · systems | 150 | `archetypes.s2` | 0.503 | EMERGENT | 6.3543 / 0.3308 | 4.6809 / 0.8796 | 0.0805 / 0.0154 | 0.5316 / 0.5316 | 0.7585 / 0.7585 | 0.3189 | 0.3141 | ✓ |
| T3 · systems | 400 | `archetypes.s2` | 0.474 | EMERGENT | 5.5332 / 0.2880 | 4.2840 / 0.8818 | 0.2738 / 0.0526 | 0.4769 / 0.4769 | 0.6695 / 0.6695 | 0.2076 | 0.2061 | ✓ |
| T3 · systems | 60 | `archetypes.s3` | 0.501 | EMERGENT | 8.0287 / 0.4155 | 4.6665 / 0.8548 | 0.1391 / 0.0261 | 0.3808 / 0.3808 | 0.8303 / 0.8303 | 0.2223 | 0.2187 | ✓ |
| T3 · systems | 150 | `archetypes.s3` | 0.518 | EMERGENT | 7.9669 / 0.4123 | 5.1056 / 0.9093 | 0.2524 / 0.0474 | 0.4060 / 0.4060 | 0.8127 / 0.8127 | 0.1783 | 0.1676 | ✓ |
| T3 · systems | 400 | `archetypes.s3` | 0.528 | EMERGENT | 7.7922 / 0.4033 | 5.0837 / 0.9103 | 0.3322 / 0.0624 | 0.4589 / 0.4589 | 0.8056 / 0.8056 | 0.1453 | 0.1268 | ✓ |

