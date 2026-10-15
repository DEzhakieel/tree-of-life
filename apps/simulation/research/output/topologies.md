# Topological spaces experiment (5 topologies × 17 biomes)

Biome × topology full cross (85 runs @ 240 ticks). Founders edge-seeded at the northern cap; same world/grid per (seed, environment); only the edge-identification differs. edgeHits = y-cap crossings handled by the topology.
- **torus** — planet-style: both axes wrap (legacy)
- **cylinder** — band: longitude wraps, polar caps reflect
- **sphere** — globe: longitude wraps, poles reflect
- **mobius** — non-orientable: longitude wraps, caps reflect with a half-twist
- **kleinBottle** — non-orientable: longitude wraps, latitude loops flipped

| topology | biome | class | alive | dPop | species | births | fitness | ATP | O2 | pH | toxin | edgeHits |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| torus | calm | control | 33 | -7 | 17 | 1 | 0.518 | 0.213 | 0.928 | 7.00 | 0.000 | 0 |
| cylinder | calm | control | 34 | -6 | 19 | 0 | 0.523 | 0.214 | 0.928 | 7.00 | 0.000 | 438 |
| sphere | calm | control | 34 | -6 | 19 | 0 | 0.523 | 0.214 | 0.928 | 7.00 | 0.000 | 438 |
| mobius | calm | control | 36 | -4 | 18 | 1 | 0.519 | 0.215 | 0.928 | 7.00 | 0.000 | 334 |
| kleinBottle | calm | control | 38 | -2 | 19 | 0 | 0.521 | 0.210 | 0.928 | 7.00 | 0.000 | 141 |
| torus | anoxicTrench | extreme | 36 | -4 | 19 | 0 | 0.541 | 0.213 | 0.879 | 7.39 | 0.250 | 0 |
| cylinder | anoxicTrench | extreme | 47 | +7 | 22 | 0 | 0.535 | 0.198 | 0.879 | 7.39 | 0.251 | 620 |
| sphere | anoxicTrench | extreme | 47 | +7 | 22 | 0 | 0.535 | 0.198 | 0.879 | 7.39 | 0.251 | 620 |
| mobius | anoxicTrench | extreme | 49 | +9 | 18 | 1 | 0.539 | 0.192 | 0.879 | 7.39 | 0.251 | 581 |
| kleinBottle | anoxicTrench | extreme | 64 | +24 | 24 | 0 | 0.545 | 0.188 | 0.879 | 7.39 | 0.250 | 96 |
| torus | hyperthermal | extreme | 37 | -3 | 19 | 0 | 0.531 | 0.162 | 0.909 | 4.50 | 0.500 | 0 |
| cylinder | hyperthermal | extreme | 35 | -5 | 19 | 1 | 0.526 | 0.167 | 0.909 | 4.50 | 0.501 | 506 |
| sphere | hyperthermal | extreme | 35 | -5 | 19 | 1 | 0.526 | 0.167 | 0.909 | 4.50 | 0.501 | 506 |
| mobius | hyperthermal | extreme | 38 | -2 | 17 | 0 | 0.535 | 0.164 | 0.909 | 4.50 | 0.501 | 630 |
| kleinBottle | hyperthermal | extreme | 31 | -9 | 16 | 0 | 0.541 | 0.167 | 0.909 | 4.50 | 0.500 | 113 |
| torus | hypersaline | extreme | 20 | -20 | 17 | 0 | 0.494 | 0.228 | 0.952 | 8.18 | 0.100 | 0 |
| cylinder | hypersaline | extreme | 33 | -7 | 19 | 0 | 0.513 | 0.200 | 0.952 | 8.18 | 0.100 | 610 |
| sphere | hypersaline | extreme | 33 | -7 | 19 | 0 | 0.513 | 0.200 | 0.952 | 8.18 | 0.100 | 610 |
| mobius | hypersaline | extreme | 31 | -9 | 15 | 0 | 0.506 | 0.195 | 0.952 | 8.18 | 0.100 | 491 |
| kleinBottle | hypersaline | extreme | 19 | -21 | 15 | 0 | 0.483 | 0.234 | 0.952 | 8.18 | 0.100 | 128 |
| torus | acidicCrater | extreme | 27 | -13 | 17 | 0 | 0.510 | 0.189 | 0.972 | 3.02 | 0.350 | 0 |
| cylinder | acidicCrater | extreme | 19 | -21 | 14 | 0 | 0.444 | 0.190 | 0.972 | 3.02 | 0.350 | 419 |
| sphere | acidicCrater | extreme | 19 | -21 | 14 | 0 | 0.444 | 0.190 | 0.972 | 3.02 | 0.350 | 419 |
| mobius | acidicCrater | extreme | 20 | -20 | 15 | 0 | 0.456 | 0.209 | 0.972 | 3.02 | 0.350 | 383 |
| kleinBottle | acidicCrater | extreme | 34 | -6 | 18 | 0 | 0.519 | 0.182 | 0.972 | 3.02 | 0.350 | 142 |
| torus | sodaLake | extreme | 53 | +13 | 20 | 1 | 0.560 | 0.195 | 0.953 | 10.46 | 0.100 | 0 |
| cylinder | sodaLake | extreme | 56 | +16 | 20 | 1 | 0.551 | 0.188 | 0.953 | 10.46 | 0.101 | 693 |
| sphere | sodaLake | extreme | 56 | +16 | 20 | 1 | 0.551 | 0.188 | 0.953 | 10.46 | 0.101 | 693 |
| mobius | sodaLake | extreme | 51 | +11 | 26 | 0 | 0.544 | 0.193 | 0.953 | 10.46 | 0.101 | 634 |
| kleinBottle | sodaLake | extreme | 59 | +19 | 24 | 0 | 0.568 | 0.192 | 0.953 | 10.46 | 0.101 | 142 |
| torus | cryoFrozen | extreme | 54 | +14 | 21 | 0 | 0.539 | 0.228 | 0.974 | 7.00 | 0.051 | 0 |
| cylinder | cryoFrozen | extreme | 46 | +6 | 17 | 0 | 0.543 | 0.237 | 0.974 | 7.00 | 0.051 | 582 |
| sphere | cryoFrozen | extreme | 46 | +6 | 17 | 0 | 0.543 | 0.237 | 0.974 | 7.00 | 0.051 | 582 |
| mobius | cryoFrozen | extreme | 47 | +7 | 21 | 0 | 0.560 | 0.249 | 0.974 | 7.00 | 0.051 | 496 |
| kleinBottle | cryoFrozen | extreme | 35 | -5 | 17 | 0 | 0.547 | 0.258 | 0.974 | 7.00 | 0.051 | 124 |
| torus | irradiated | extreme | 42 | +2 | 17 | 0 | 0.538 | 0.212 | 0.962 | 5.97 | 0.801 | 0 |
| cylinder | irradiated | extreme | 30 | -10 | 16 | 0 | 0.547 | 0.235 | 0.962 | 5.97 | 0.800 | 513 |
| sphere | irradiated | extreme | 30 | -10 | 16 | 0 | 0.547 | 0.235 | 0.962 | 5.97 | 0.800 | 513 |
| mobius | irradiated | extreme | 24 | -16 | 17 | 0 | 0.538 | 0.252 | 0.962 | 5.97 | 0.800 | 266 |
| kleinBottle | irradiated | extreme | 53 | +13 | 25 | 0 | 0.548 | 0.197 | 0.962 | 5.97 | 0.801 | 115 |
| torus | toxicSump | extreme | 47 | +7 | 20 | 1 | 0.531 | 0.181 | 0.896 | 4.00 | 0.701 | 0 |
| cylinder | toxicSump | extreme | 46 | +6 | 24 | 0 | 0.546 | 0.185 | 0.896 | 4.00 | 0.701 | 412 |
| sphere | toxicSump | extreme | 46 | +6 | 24 | 0 | 0.546 | 0.185 | 0.896 | 4.00 | 0.701 | 412 |
| mobius | toxicSump | extreme | 54 | +14 | 19 | 0 | 0.532 | 0.181 | 0.896 | 4.00 | 0.700 | 369 |
| kleinBottle | toxicSump | extreme | 36 | -4 | 18 | 0 | 0.538 | 0.194 | 0.896 | 4.00 | 0.701 | 120 |
| torus | limestoneCave | underrated | 34 | -6 | 19 | 0 | 0.549 | 0.214 | 0.907 | 7.59 | 0.051 | 0 |
| cylinder | limestoneCave | underrated | 32 | -8 | 18 | 0 | 0.522 | 0.224 | 0.907 | 7.59 | 0.051 | 485 |
| sphere | limestoneCave | underrated | 32 | -8 | 18 | 0 | 0.522 | 0.224 | 0.907 | 7.59 | 0.051 | 485 |
| mobius | limestoneCave | underrated | 29 | -11 | 18 | 0 | 0.519 | 0.227 | 0.907 | 7.59 | 0.051 | 318 |
| kleinBottle | limestoneCave | underrated | 26 | -14 | 18 | 0 | 0.522 | 0.227 | 0.907 | 7.59 | 0.051 | 86 |
| torus | gutLumen | underrated | 25 | -15 | 15 | 0 | 0.533 | 0.217 | 0.890 | 6.00 | 0.150 | 0 |
| cylinder | gutLumen | underrated | 49 | +9 | 23 | 0 | 0.540 | 0.185 | 0.890 | 6.00 | 0.151 | 682 |
| sphere | gutLumen | underrated | 49 | +9 | 23 | 0 | 0.540 | 0.185 | 0.890 | 6.00 | 0.151 | 682 |
| mobius | gutLumen | underrated | 48 | +8 | 19 | 0 | 0.530 | 0.180 | 0.890 | 6.00 | 0.151 | 516 |
| kleinBottle | gutLumen | underrated | 23 | -17 | 15 | 0 | 0.538 | 0.224 | 0.890 | 6.00 | 0.150 | 130 |
| torus | termiteMound | underrated | 24 | -16 | 15 | 0 | 0.519 | 0.216 | 0.885 | 6.50 | 0.100 | 0 |
| cylinder | termiteMound | underrated | 21 | -19 | 17 | 0 | 0.507 | 0.216 | 0.885 | 6.50 | 0.100 | 501 |
| sphere | termiteMound | underrated | 21 | -19 | 17 | 0 | 0.507 | 0.216 | 0.885 | 6.50 | 0.100 | 501 |
| mobius | termiteMound | underrated | 30 | -10 | 18 | 0 | 0.534 | 0.193 | 0.885 | 6.50 | 0.101 | 536 |
| kleinBottle | termiteMound | underrated | 30 | -10 | 18 | 0 | 0.500 | 0.201 | 0.885 | 6.50 | 0.100 | 136 |
| torus | rhizosphere | underrated | 38 | -2 | 19 | 0 | 0.525 | 0.193 | 0.924 | 6.21 | 0.051 | 0 |
| cylinder | rhizosphere | underrated | 29 | -11 | 16 | 1 | 0.535 | 0.220 | 0.924 | 6.21 | 0.050 | 526 |
| sphere | rhizosphere | underrated | 29 | -11 | 16 | 1 | 0.535 | 0.220 | 0.924 | 6.21 | 0.050 | 526 |
| mobius | rhizosphere | underrated | 20 | -20 | 15 | 0 | 0.533 | 0.236 | 0.924 | 6.21 | 0.050 | 267 |
| kleinBottle | rhizosphere | underrated | 52 | +12 | 22 | 3 | 0.520 | 0.187 | 0.924 | 6.21 | 0.051 | 87 |
| torus | wetlandMarsh | underrated | 34 | -6 | 25 | 1 | 0.507 | 0.189 | 0.920 | 5.21 | 0.200 | 0 |
| cylinder | wetlandMarsh | underrated | 26 | -14 | 15 | 1 | 0.475 | 0.197 | 0.920 | 5.21 | 0.200 | 454 |
| sphere | wetlandMarsh | underrated | 26 | -14 | 15 | 1 | 0.475 | 0.197 | 0.920 | 5.21 | 0.200 | 454 |
| mobius | wetlandMarsh | underrated | 21 | -19 | 16 | 0 | 0.482 | 0.195 | 0.920 | 5.21 | 0.200 | 343 |
| kleinBottle | wetlandMarsh | underrated | 30 | -10 | 17 | 1 | 0.513 | 0.193 | 0.920 | 5.21 | 0.200 | 124 |
| torus | desertDune | underrated | 24 | -16 | 18 | 1 | 0.485 | 0.212 | 0.978 | 7.99 | 0.050 | 0 |
| cylinder | desertDune | underrated | 18 | -22 | 16 | 0 | 0.453 | 0.222 | 0.978 | 7.99 | 0.050 | 484 |
| sphere | desertDune | underrated | 18 | -22 | 16 | 0 | 0.453 | 0.222 | 0.978 | 7.99 | 0.050 | 484 |
| mobius | desertDune | underrated | 22 | -18 | 16 | 0 | 0.500 | 0.201 | 0.978 | 7.99 | 0.050 | 505 |
| kleinBottle | desertDune | underrated | 24 | -16 | 16 | 1 | 0.491 | 0.213 | 0.978 | 7.99 | 0.050 | 113 |
| torus | hotSpring | underrated | 39 | -1 | 19 | 1 | 0.541 | 0.191 | 0.972 | 8.48 | 0.100 | 0 |
| cylinder | hotSpring | underrated | 42 | +2 | 21 | 0 | 0.548 | 0.206 | 0.972 | 8.48 | 0.100 | 457 |
| sphere | hotSpring | underrated | 42 | +2 | 21 | 0 | 0.548 | 0.206 | 0.972 | 8.48 | 0.100 | 457 |
| mobius | hotSpring | underrated | 24 | -16 | 16 | 0 | 0.531 | 0.234 | 0.972 | 8.48 | 0.100 | 303 |
| kleinBottle | hotSpring | underrated | 53 | +13 | 19 | 0 | 0.525 | 0.187 | 0.972 | 8.48 | 0.100 | 82 |
| torus | canopyTop | underrated | 45 | +5 | 21 | 0 | 0.532 | 0.203 | 0.993 | 7.00 | 0.020 | 0 |
| cylinder | canopyTop | underrated | 48 | +8 | 18 | 1 | 0.533 | 0.201 | 0.993 | 7.00 | 0.020 | 621 |
| sphere | canopyTop | underrated | 48 | +8 | 18 | 1 | 0.533 | 0.201 | 0.993 | 7.00 | 0.020 | 621 |
| mobius | canopyTop | underrated | 40 | 0 | 20 | 0 | 0.548 | 0.212 | 0.993 | 7.00 | 0.020 | 384 |
| kleinBottle | canopyTop | underrated | 44 | +4 | 17 | 0 | 0.534 | 0.206 | 0.993 | 7.00 | 0.020 | 120 |
