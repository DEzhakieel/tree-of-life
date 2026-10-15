# Dimensionality experiment — same volume (4096 cells), N = 1..4 spatial dimensions, torus vs box

Minimal N-D consumer–resource lattice: logistic growth, colonial consumption, diffusion over the 2N nearest neighbours. Fixed volume so only the geometry of space changes with N. Torus = all axes wrap (engine default); box = reflecting walls.

| dims | volume | side len | faces/cell | topology | survival | biomass | res μ | res var | Shannon bits | colonies | mean dist | spread | total res |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 4096 | 4096 | 4096 | 2 | torus | 0.276 | 2570.6 | 0.756 | 0.160 | 0.850 | 1131 | 996.81 | 1163.20 | 3095.20 |
| 64×64 | 4096 | 64 | 4 | torus | 1.000 | 9210.1 | 0.100 | 0.000 | 0.000 | 4096 | 24.50 | 26.12 | 411.18 |
| 16×16×16 | 4096 | 16 | 6 | torus | 1.000 | 9263.0 | 0.102 | 0.000 | 0.000 | 4096 | 7.71 | 7.98 | 419.26 |
| 8×8×8×8 | 4096 | 8 | 8 | torus | 1.000 | 9295.6 | 0.101 | 0.000 | 0.000 | 4096 | 4.55 | 4.58 | 415.13 |
| 64×64 | 4096 | 64 | 4 | box | 1.000 | 9170.6 | 0.100 | 0.000 | 0.000 | 4096 | 33.37 | 26.12 | 408.22 |
| 16×16×16 | 4096 | 16 | 6 | box | 1.000 | 9194.8 | 0.102 | 0.000 | 0.000 | 4096 | 10.57 | 7.98 | 417.64 |

