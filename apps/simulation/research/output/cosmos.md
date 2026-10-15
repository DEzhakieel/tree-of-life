# Cosmos experiments (78 runs)

Cosmos experiments — world-definition axes (universe constants, energy levels, constraints, physical laws, supply/destruction, black-swan treatments, equilibria).
Habitat = f(seed, biome) only; 0.6-scale jitter. Baseline = calm torus, 240 ticks, 40 founders.
4 replicate seeds for the paired families (n = 4 per contrast); black swans fire at tick 80 of 300; equilibria runs are 480 ticks with full time-series.

| axis | knob | value | rep | biome | topology | ticks | alive | dPop | species | births | deaths | escapes | ATP | H | Simpson | LMC | food | CV | lateCV | slope | event | at | alive@E | minAfter | recover | recoveryT |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| universeConstants | baseline | defaults | - | calm | torus | 240 | 31 | -9 | 24 | 0 | 0 | 0 | 0.221 | 4.45 | 0.949 | 0.042 | 76.95 | 0.229 | 0.090 | 0.333 | none | 0 | 0 | 0 | 0 | -1 |
| universeConstants | escape.small | escapeRadius=4096 | - | calm | torus | 240 | 36 | -4 | 19 | 0 | 0 | 0 | 0.208 | 3.65 | 0.877 | 0.258 | 90.81 | 0.255 | 0.083 | -0.140 | none | 0 | 0 | 0 | 0 | -1 |
| universeConstants | escape.large | escapeRadius=16777216 | - | calm | torus | 240 | 32 | -8 | 16 | 0 | 0 | 0 | 0.212 | 3.51 | 0.883 | 0.192 | 90.82 | 0.218 | 0.065 | 0.169 | none | 0 | 0 | 0 | 0 | -1 |
| universeConstants | time.slow | timeScale=0.5 | - | calm | torus | 240 | 19 | -21 | 15 | 0 | 0 | 0 | 0.198 | 3.79 | 0.920 | 0.052 | 73.66 | 0.158 | 0.016 | 0.491 | none | 0 | 0 | 0 | 0 | -1 |
| universeConstants | time.fast | timeScale=2 | - | calm | torus | 240 | 59 | 19 | 26 | 0 | 0 | 0 | 0.246 | 3.99 | 0.898 | 0.254 | 83.36 | 0.433 | 0.144 | -1.268 | none | 0 | 0 | 0 | 0 | -1 |
| universeConstants | day.short | dayLength=600 | - | calm | torus | 240 | 32 | -8 | 21 | 0 | 0 | 0 | 0.216 | 4.15 | 0.932 | 0.086 | 75.00 | 0.227 | 0.091 | 0.348 | none | 0 | 0 | 0 | 0 | -1 |
| universeConstants | day.long | dayLength=9600 | - | calm | torus | 240 | 31 | -9 | 24 | 0 | 0 | 0 | 0.221 | 4.45 | 0.949 | 0.042 | 77.12 | 0.229 | 0.090 | 0.333 | none | 0 | 0 | 0 | 0 | -1 |
| universeConstants | world.small | worldScale=2 | - | calm | torus | 240 | 31 | -9 | 17 | 0 | 0 | 0 | 0.226 | 3.72 | 0.903 | 0.141 | 86.72 | 0.239 | 0.053 | -0.059 | none | 0 | 0 | 0 | 0 | -1 |
| universeConstants | world.big | worldScale=12 | - | calm | torus | 240 | 40 | 0 | 21 | 0 | 0 | 0 | 0.195 | 3.82 | 0.897 | 0.210 | 68.41 | 0.317 | 0.100 | -0.408 | none | 0 | 0 | 0 | 0 | -1 |
| energy | meta.low | metabolismBase=0.5 | - | calm | torus | 240 | 40 | 0 | 21 | 0 | 0 | 0 | 0.206 | 3.93 | 0.911 | 0.162 | 76.93 | 0.292 | 0.109 | -0.152 | none | 0 | 0 | 0 | 0 | -1 |
| energy | meta.high | metabolismBase=1.5 | - | calm | torus | 240 | 24 | -16 | 15 | 0 | 0 | 0 | 0.234 | 3.57 | 0.889 | 0.159 | 76.97 | 0.183 | 0.040 | 0.500 | none | 0 | 0 | 0 | 0 | -1 |
| energy | meta.extreme | metabolismBase=2.5 | - | calm | torus | 240 | 14 | -26 | 11 | 0 | 1 | 0 | 0.242 | 3.32 | 0.888 | 0.071 | 77.00 | 0.195 | 0.065 | 0.405 | none | 0 | 0 | 0 | 0 | -1 |
| energy | bank.small | energyCapacity=25 | - | calm | torus | 240 | 7 | -33 | 7 | 0 | 0 | 0 | 0.220 | 2.81 | 0.857 | 0.000 | 19.26 | 0.438 | 0.000 | 0.192 | none | 0 | 0 | 0 | 0 | -1 |
| energy | bank.huge | energyCapacity=400 | - | calm | torus | 240 | 49 | 9 | 21 | 1 | 0 | 0 | 0.200 | 3.80 | 0.900 | 0.200 | 307.60 | 0.354 | 0.110 | -0.731 | none | 0 | 0 | 0 | 0 | -1 |
| constraints | founders.few | spawnCount=10 | - | calm | torus | 240 | 11 | -29 | 7 | 0 | 0 | 0 | 0.215 | 2.55 | 0.793 | 0.163 | 77.02 | 0.175 | 0.079 | 0.308 | none | 0 | 0 | 0 | 0 | -1 |
| constraints | founders.many | spawnCount=160 | - | calm | torus | 240 | 82 | 42 | 47 | 1 | 0 | 0 | 0.204 | 5.09 | 0.957 | 0.110 | 76.81 | 0.196 | 0.079 | -1.419 | none | 0 | 0 | 0 | 0 | -1 |
| constraints | pop.cap | maxPopulation=350 | - | calm | torus | 240 | 31 | -9 | 24 | 0 | 0 | 0 | 0.221 | 4.45 | 0.949 | 0.042 | 76.95 | 0.229 | 0.090 | 0.333 | none | 0 | 0 | 0 | 0 | -1 |
| laws | law.earth | gravity=Earth 9.81 m/s² | - | calm | torus | 240 | 30 | -10 | 20 | 0 | 0 | 0 | 0.224 | 4.05 | 0.924 | 0.104 | 76.95 | 0.224 | 0.084 | 0.344 | none | 0 | 0 | 0 | 0 | -1 |
| laws | law.mars | gravity=Mars 3.71 m/s² | - | calm | torus | 240 | 29 | -11 | 17 | 0 | 0 | 0 | 0.221 | 3.67 | 0.892 | 0.181 | 73.12 | 0.206 | 0.081 | 0.423 | none | 0 | 0 | 0 | 0 | -1 |
| laws | law.moon | gravity=Luna 1.62 m/s² | - | calm | torus | 240 | 587 | 547 | 75 | 13 | 0 | 0 | 0.170 | 4.04 | 0.847 | 0.563 | 200.89 | 1.282 | 0.444 | -1.073 | none | 0 | 0 | 0 | 0 | -1 |
| supply | supply.low | foodRegenRate=3e-5 | - | calm | torus | 240 | 31 | -9 | 21 | 0 | 0 | 0 | 0.219 | 4.08 | 0.922 | 0.124 | 70.89 | 0.210 | 0.082 | 0.411 | none | 0 | 0 | 0 | 0 | -1 |
| supply | supply.high | foodRegenRate=3e-3 | - | calm | torus | 240 | 51 | 11 | 26 | 0 | 0 | 0 | 0.201 | 4.09 | 0.905 | 0.231 | 135.46 | 0.378 | 0.154 | -0.679 | none | 0 | 0 | 0 | 0 | -1 |
| controls | control | defaults | rep-1 | calm | torus | 240 | 9 | -31 | 9 | 0 | 0 | 0 | 0.337 | 3.17 | 0.889 | 0.000 | 88.07 | 0.387 | 0.055 | 0.239 | none | 0 | 0 | 0 | 0 | -1 |
| energy | meta.high | metabolismBase=1.5 | rep-1 | calm | torus | 240 | 7 | -33 | 6 | 0 | 0 | 0 | 0.321 | 2.52 | 0.816 | 0.043 | 88.07 | 0.462 | 0.053 | 0.209 | none | 0 | 0 | 0 | 0 | -1 |
| energy | bank.small | energyCapacity=25 | rep-1 | calm | torus | 240 | 2 | -38 | 2 | 0 | 0 | 0 | 0.365 | 1.00 | 0.500 | 0.000 | 22.02 | 0.739 | 0.282 | 0.069 | none | 0 | 0 | 0 | 0 | -1 |
| supply | supply.low | foodRegenRate=3e-5 | rep-1 | calm | torus | 240 | 8 | -32 | 8 | 0 | 0 | 0 | 0.349 | 3.00 | 0.875 | 0.000 | 81.41 | 0.392 | 0.000 | 0.222 | none | 0 | 0 | 0 | 0 | -1 |
| supply | supply.high | foodRegenRate=3e-3 | rep-1 | calm | torus | 240 | 11 | -29 | 10 | 0 | 0 | 0 | 0.311 | 3.28 | 0.893 | 0.024 | 152.48 | 0.344 | 0.048 | 0.306 | none | 0 | 0 | 0 | 0 | -1 |
| laws | law.earth | gravity=Earth 9.81 m/s² | rep-1 | calm | torus | 240 | 10 | -30 | 9 | 0 | 0 | 0 | 0.322 | 3.12 | 0.880 | 0.028 | 88.07 | 0.385 | 0.090 | 0.249 | none | 0 | 0 | 0 | 0 | -1 |
| universeConstants | escape.small | escapeRadius=4096 | rep-1 | calm | torus | 240 | 8 | -32 | 7 | 0 | 0 | 0 | 0.302 | 2.75 | 0.844 | 0.037 | 75.94 | 0.434 | 0.027 | 0.225 | none | 0 | 0 | 0 | 0 | -1 |
| controls | control | defaults | rep-2 | calm | torus | 240 | 24 | -16 | 12 | 0 | 0 | 0 | 0.180 | 3.12 | 0.851 | 0.206 | 77.74 | 0.292 | 0.064 | 0.500 | none | 0 | 0 | 0 | 0 | -1 |
| energy | meta.high | metabolismBase=1.5 | rep-2 | calm | torus | 240 | 14 | -26 | 8 | 0 | 0 | 0 | 0.201 | 2.56 | 0.765 | 0.280 | 77.76 | 0.217 | 0.046 | 0.406 | none | 0 | 0 | 0 | 0 | -1 |
| energy | bank.small | energyCapacity=25 | rep-2 | calm | torus | 240 | 2 | -38 | 2 | 0 | 0 | 0 | 0.194 | 1.00 | 0.500 | 0.000 | 19.45 | 0.594 | 0.233 | 0.078 | none | 0 | 0 | 0 | 0 | -1 |
| supply | supply.low | foodRegenRate=3e-5 | rep-2 | calm | torus | 240 | 23 | -17 | 11 | 0 | 0 | 0 | 0.182 | 3.08 | 0.854 | 0.168 | 71.55 | 0.277 | 0.032 | 0.480 | none | 0 | 0 | 0 | 0 | -1 |
| supply | supply.high | foodRegenRate=3e-3 | rep-2 | calm | torus | 240 | 89 | 49 | 23 | 3 | 0 | 0 | 0.159 | 3.30 | 0.822 | 0.444 | 137.39 | 0.722 | 0.252 | -1.280 | none | 0 | 0 | 0 | 0 | -1 |
| laws | law.earth | gravity=Earth 9.81 m/s² | rep-2 | calm | torus | 240 | 22 | -18 | 10 | 0 | 0 | 0 | 0.188 | 2.90 | 0.826 | 0.213 | 77.75 | 0.270 | 0.040 | 0.515 | none | 0 | 0 | 0 | 0 | -1 |
| universeConstants | escape.small | escapeRadius=4096 | rep-2 | calm | torus | 240 | 71 | 31 | 19 | 0 | 0 | 0 | 0.164 | 3.31 | 0.843 | 0.345 | 87.01 | 0.636 | 0.158 | -1.301 | none | 0 | 0 | 0 | 0 | -1 |
| controls | control | defaults | rep-3 | calm | torus | 240 | 16 | -24 | 10 | 0 | 0 | 0 | 0.329 | 3.02 | 0.844 | 0.170 | 76.37 | 0.290 | 0.059 | 0.437 | none | 0 | 0 | 0 | 0 | -1 |
| energy | meta.high | metabolismBase=1.5 | rep-3 | calm | torus | 240 | 12 | -28 | 8 | 0 | 0 | 0 | 0.350 | 2.79 | 0.833 | 0.116 | 76.39 | 0.339 | 0.072 | 0.328 | none | 0 | 0 | 0 | 0 | -1 |
| energy | bank.small | energyCapacity=25 | rep-3 | calm | torus | 240 | 3 | -37 | 2 | 0 | 0 | 0 | 0.489 | 0.92 | 0.444 | 0.051 | 19.11 | 0.917 | 0.000 | 0.078 | none | 0 | 0 | 0 | 0 | -1 |
| supply | supply.low | foodRegenRate=3e-5 | rep-3 | calm | torus | 240 | 15 | -25 | 8 | 0 | 0 | 0 | 0.335 | 2.61 | 0.782 | 0.242 | 70.30 | 0.294 | 0.064 | 0.414 | none | 0 | 0 | 0 | 0 | -1 |
| supply | supply.high | foodRegenRate=3e-3 | rep-3 | calm | torus | 240 | 12 | -28 | 8 | 0 | 0 | 0 | 0.406 | 2.86 | 0.847 | 0.079 | 134.93 | 0.353 | 0.180 | 0.328 | none | 0 | 0 | 0 | 0 | -1 |
| laws | law.earth | gravity=Earth 9.81 m/s² | rep-3 | calm | torus | 240 | 15 | -25 | 9 | 0 | 0 | 0 | 0.330 | 2.87 | 0.827 | 0.178 | 76.37 | 0.305 | 0.045 | 0.422 | none | 0 | 0 | 0 | 0 | -1 |
| universeConstants | escape.small | escapeRadius=4096 | rep-3 | calm | torus | 240 | 17 | -23 | 10 | 0 | 0 | 0 | 0.337 | 3.03 | 0.851 | 0.148 | 88.72 | 0.264 | 0.093 | 0.481 | none | 0 | 0 | 0 | 0 | -1 |
| controls | control | defaults | rep-4 | calm | torus | 240 | 8 | -32 | 6 | 0 | 0 | 0 | 0.226 | 2.41 | 0.781 | 0.125 | 83.08 | 0.376 | 0.058 | 0.229 | none | 0 | 0 | 0 | 0 | -1 |
| energy | meta.high | metabolismBase=1.5 | rep-4 | calm | torus | 240 | 6 | -34 | 4 | 0 | 0 | 0 | 0.136 | 1.79 | 0.667 | 0.149 | 83.08 | 0.461 | 0.064 | 0.165 | none | 0 | 0 | 0 | 0 | -1 |
| energy | bank.small | energyCapacity=25 | rep-4 | calm | torus | 240 | 2 | -38 | 1 | 0 | 0 | 0 | 0.122 | 0.00 | 0.000 | 0.000 | 20.77 | 0.948 | 0.000 | 0.051 | none | 0 | 0 | 0 | 0 | -1 |
| supply | supply.low | foodRegenRate=3e-5 | rep-4 | calm | torus | 240 | 8 | -32 | 7 | 0 | 0 | 0 | 0.226 | 2.75 | 0.844 | 0.037 | 76.81 | 0.377 | 0.059 | 0.229 | none | 0 | 0 | 0 | 0 | -1 |
| supply | supply.high | foodRegenRate=3e-3 | rep-4 | calm | torus | 240 | 9 | -31 | 6 | 0 | 0 | 0 | 0.224 | 2.28 | 0.741 | 0.211 | 143.87 | 0.364 | 0.038 | 0.244 | none | 0 | 0 | 0 | 0 | -1 |
| laws | law.earth | gravity=Earth 9.81 m/s² | rep-4 | calm | torus | 240 | 8 | -32 | 6 | 0 | 0 | 0 | 0.226 | 2.41 | 0.781 | 0.125 | 83.08 | 0.377 | 0.059 | 0.229 | none | 0 | 0 | 0 | 0 | -1 |
| universeConstants | escape.small | escapeRadius=4096 | rep-4 | calm | torus | 240 | 9 | -31 | 7 | 0 | 0 | 0 | 0.307 | 2.73 | 0.840 | 0.048 | 88.60 | 0.334 | 0.000 | 0.252 | none | 0 | 0 | 0 | 0 | -1 |
| equilibria | eq.calmTorus | calm torus 480t | - | calm | torus | 480 | 85 | 45 | 41 | 0 | 0 | 0 | 0.232 | 4.75 | 0.940 | 0.171 | 82.34 | 0.528 | 0.150 | -0.089 | none | 0 | 0 | 0 | 0 | -1 |
| equilibria | eq.calmKlein | calm kleinBottle 480t | - | calm | kleinBottle | 480 | 75 | 35 | 35 | 0 | 0 | 0 | 0.236 | 4.59 | 0.940 | 0.142 | 82.38 | 0.494 | 0.119 | 0.086 | none | 0 | 0 | 0 | 0 | -1 |
| equilibria | eq.hyperthermal | hyperthermal 480t | - | hyperthermal | torus | 480 | 111 | 71 | 32 | 0 | 0 | 0 | 0.238 | 3.46 | 0.808 | 0.558 | 90.15 | 0.606 | 0.217 | -0.629 | none | 0 | 0 | 0 | 0 | -1 |
| equilibria | eq.cryoFrozen | cryoFrozen 480t | - | cryoFrozen | torus | 480 | 34 | -6 | 13 | 1 | 0 | 0 | 0.230 | 2.41 | 0.637 | 0.689 | 101.05 | 0.398 | 0.226 | 0.354 | none | 0 | 0 | 0 | 0 | -1 |
| blackswan | swan.none | no event | rep-1 | calm | torus | 300 | 10 | -30 | 10 | 0 | 0 | 0 | 0.354 | 3.32 | 0.900 | 0.000 | 89.78 | 0.349 | 0.053 | 0.218 | none | 0 | 0 | 0 | 0 | -1 |
| blackswan | swan.meteor | meteor r=250 at colony | rep-1 | calm | torus | 300 | 10 | -30 | 10 | 0 | 0 | 0 | 0.354 | 3.32 | 0.900 | 0.000 | 89.78 | 0.349 | 0.053 | 0.218 | meteor | 80 | 9 | 8 | 1.1111111111111112 | 1 |
| blackswan | swan.famine | food ×0.05 | rep-1 | calm | torus | 300 | 8 | -32 | 8 | 0 | 0 | 0 | 0.371 | 3.00 | 0.875 | 0.000 | 10.76 | 0.376 | 0.000 | 0.175 | famine | 80 | 9 | 8 | 0.8888888888888888 | 1 |
| blackswan | swan.storm | toxin → 0.92 | rep-1 | calm | torus | 300 | 10 | -30 | 10 | 0 | 0 | 0 | 0.354 | 3.32 | 0.900 | 0.000 | 89.78 | 0.349 | 0.053 | 0.218 | storm | 80 | 9 | 8 | 1.1111111111111112 | 1 |
| blackswan | swan.bounty | food +50 r=400 | rep-1 | calm | torus | 300 | 10 | -30 | 10 | 0 | 0 | 0 | 0.349 | 3.32 | 0.900 | 0.000 | 94.23 | 0.328 | 0.041 | 0.232 | bounty | 80 | 9 | 9 | 1.1111111111111112 | 1 |
| blackswan | swan.nuke | total cull | rep-1 | calm | torus | 300 | 0 | -40 | 0 | 0 | 0 | 0 | 0.000 | 0.00 | 0.000 | 0.000 | 89.80 | 1.910 | NaN | 0.000 | nuke | 80 | 9 | 0 | 0 | -1 |
| blackswan | swan.none | no event | rep-2 | calm | torus | 300 | 37 | -3 | 14 | 0 | 0 | 0 | 0.177 | 3.11 | 0.825 | 0.321 | 79.29 | 0.329 | 0.150 | 0.606 | none | 0 | 0 | 0 | 0 | -1 |
| blackswan | swan.meteor | meteor r=250 at colony | rep-2 | calm | torus | 300 | 36 | -4 | 13 | 0 | 0 | 0 | 0.176 | 3.01 | 0.816 | 0.321 | 79.29 | 0.327 | 0.156 | 0.611 | meteor | 80 | 14 | 13 | 2.5714285714285716 | 1 |
| blackswan | swan.famine | food ×0.05 | rep-2 | calm | torus | 300 | 7 | -33 | 6 | 0 | 0 | 0 | 0.229 | 2.52 | 0.816 | 0.043 | 9.80 | 0.321 | 0.063 | 0.160 | famine | 80 | 14 | 7 | 0.5 | 1 |
| blackswan | swan.storm | toxin → 0.92 | rep-2 | calm | torus | 300 | 38 | -2 | 13 | 1 | 0 | 0 | 0.176 | 3.00 | 0.812 | 0.334 | 79.29 | 0.336 | 0.140 | 0.592 | storm | 80 | 14 | 14 | 2.7142857142857144 | 1 |
| blackswan | swan.bounty | food +50 r=400 | rep-2 | calm | torus | 300 | 121 | 81 | 38 | 0 | 0 | 0 | 0.160 | 3.98 | 0.870 | 0.413 | 84.28 | 0.807 | 0.277 | -1.275 | bounty | 80 | 14 | 14 | 8.642857142857142 | 1 |
| blackswan | swan.nuke | total cull | rep-2 | calm | torus | 300 | 0 | -40 | 0 | 0 | 0 | 0 | 0.000 | 0.00 | 0.000 | 0.000 | 79.41 | 1.806 | NaN | 0.000 | nuke | 80 | 14 | 0 | 0 | -1 |
| blackswan | swan.none | no event | rep-3 | calm | torus | 300 | 17 | -23 | 10 | 0 | 0 | 0 | 0.347 | 3.13 | 0.872 | 0.088 | 77.90 | 0.271 | 0.042 | 0.379 | none | 0 | 0 | 0 | 0 | -1 |
| blackswan | swan.meteor | meteor r=250 at colony | rep-3 | calm | torus | 300 | 17 | -23 | 10 | 0 | 0 | 0 | 0.347 | 3.13 | 0.872 | 0.088 | 77.90 | 0.271 | 0.042 | 0.379 | meteor | 80 | 11 | 10 | 1.5454545454545454 | 1 |
| blackswan | swan.famine | food ×0.05 | rep-3 | calm | torus | 300 | 8 | -32 | 7 | 0 | 0 | 0 | 0.517 | 2.75 | 0.844 | 0.037 | 9.62 | 0.367 | 0.040 | 0.179 | famine | 80 | 11 | 8 | 0.7272727272727273 | 1 |
| blackswan | swan.storm | toxin → 0.92 | rep-3 | calm | torus | 300 | 17 | -23 | 10 | 0 | 0 | 0 | 0.347 | 3.13 | 0.872 | 0.088 | 77.90 | 0.271 | 0.042 | 0.379 | storm | 80 | 11 | 10 | 1.5454545454545454 | 1 |
| blackswan | swan.bounty | food +50 r=400 | rep-3 | calm | torus | 300 | 17 | -23 | 10 | 0 | 0 | 0 | 0.347 | 3.13 | 0.872 | 0.088 | 83.27 | 0.271 | 0.042 | 0.379 | bounty | 80 | 11 | 10 | 1.5454545454545454 | 1 |
| blackswan | swan.nuke | total cull | rep-3 | calm | torus | 300 | 0 | -40 | 0 | 0 | 0 | 0 | 0.000 | 0.00 | 0.000 | 0.000 | 78.00 | 1.859 | NaN | 0.000 | nuke | 80 | 11 | 0 | 0 | -1 |
| blackswan | swan.none | no event | rep-4 | calm | torus | 300 | 8 | -32 | 5 | 0 | 0 | 0 | 0.203 | 2.00 | 0.688 | 0.225 | 84.70 | 0.366 | 0.061 | 0.154 | none | 0 | 0 | 0 | 0 | -1 |
| blackswan | swan.meteor | meteor r=250 at colony | rep-4 | calm | torus | 300 | 5 | -35 | 5 | 0 | 0 | 0 | 0.229 | 2.32 | 0.800 | 0.000 | 84.71 | 0.473 | 0.080 | 0.106 | meteor | 80 | 9 | 5 | 0.5555555555555556 | 1 |
| blackswan | swan.famine | food ×0.05 | rep-4 | calm | torus | 300 | 6 | -34 | 5 | 0 | 0 | 0 | 0.192 | 2.25 | 0.778 | 0.050 | 10.15 | 0.402 | 0.074 | 0.130 | famine | 80 | 9 | 6 | 0.6666666666666666 | 1 |
| blackswan | swan.storm | toxin → 0.92 | rep-4 | calm | torus | 300 | 8 | -32 | 5 | 0 | 0 | 0 | 0.203 | 2.00 | 0.688 | 0.225 | 84.70 | 0.366 | 0.061 | 0.154 | storm | 80 | 9 | 7 | 0.8888888888888888 | 1 |
| blackswan | swan.bounty | food +50 r=400 | rep-4 | calm | torus | 300 | 8 | -32 | 5 | 0 | 0 | 0 | 0.204 | 2.00 | 0.688 | 0.225 | 88.89 | 0.343 | 0.014 | 0.175 | bounty | 80 | 9 | 7 | 0.8888888888888888 | 1 |
| blackswan | swan.nuke | total cull | rep-4 | calm | torus | 300 | 0 | -40 | 0 | 0 | 0 | 0 | 0.000 | 0.00 | 0.000 | 0.000 | 84.71 | 1.897 | NaN | 0.000 | nuke | 80 | 9 | 0 | 0 | -1 |

---

# Qualitative findings → concrete hypotheses

Determinism note: every row is a fixed world (seed, biome). "Replicate" rows are distinct worlds; contrasts between a knob and its same-seed control describe the effect ACROSS worlds. The Bayesian ledger (`bayes.md`, `hypotheses.json`, `plots/posterior.svg`) is the quantitative synthesis; this section is the qualitative reading.

## 1. Universe constants — time beats space
- `time.fast` (timeScale=2) is the single biggest dial on the whole axis: alive 59 vs 31 control (Δ+19 vs −9), species 26, CV 0.433, lateCV 0.144 — doubling the season-rate inside the fixed 240-tick window packs in ~2× growth-pass cycles. `time.slow` (0.5) starves growth (−21). **Qualitative claim:** the colony grows per seasonal pass, not per tick; the *number of passes inside the observation horizon* is the dominant universe constant.
- **Hypothesis:** *observing any world for T ticks under timeScale s is nearly equivalent to observing it for T·s ticks under timeScale 1* (growth-clock transposition).
- `world.big` (worldScale=12): 0 vs −9 — a bigger habitat gives vanished colonies room to absorb the same income into survivors. `world.small` ≡ control.
- `day.short`/`day.long` and the escape radius reshape terrain texture but not outcomes (identical dPop, zero escapes). **Qualitative claim:** escape dynamics never activate at these speeds — escapes=0 everywhere — so the escape radius is a *surface-change* knob, not a life-or-death one. **Hypothesis:** escape-window size is weakly coupled to growth (ledger: H-ESCAPE still undecided) but cannot produce a directional bias because it only re-textures which fractal window is sampled.

## 2. Energy — the bank decides
- Graded response to basal metabolism: 0.5 → 0, 1.5 → −16, 2.5 → −26 with a first death. **Qualitative claim:** income rises with metabolism, but charge rate does not — so cost-growth is a pure tax until the colony dies.
- Energy bank: `bank.small` (25) → −33 and the standing food pool collapses to 19 (control 77); `bank.huge` (400) → +9 with food 308. **Qualitative claim:** the bank is the colony's *mortality buffer* against stochastic cost spikes. Below ≈30 energy, ordinary jitter is fatal; above ≈level, agents survive the dry spells and get repaid by later income.
- **Hypotheses (ledger):** H-BANK (bank 100→25 suppresses dPop) **posterior 0.72, support**; H-META (metabolism 1.0→1.5 suppresses dPop) **0.62, lean**.

## 3. Constraints — thresholds, not gradients
- Founders set the *diversification floor*: 10 founders → Δ−29 with 7 species; 160 founders → Δ+42 with Simpson 0.957 (near-even, 47 species). `pop.cap=350` is a pure no-op (never binds in 240 ticks; bit-identical to control).
- **Qualitative claim:** capacity/founder constraints are saturating: founder number matters only up to the window's absorptive capacity, and the population cap matters only when a colony is big enough to hit it.
- **Hypothesis (future work):** the founder→species→Simpson curve is concave with a saturation knee near the standing-capacity of the habitat (cross this axis with biome absorptivity).

## 4. Physical laws — the lunar phase transition
- Earth (−10) and Mars (−11) reproduce legacy physics exactly (control −9; within-world jitter). **Qualitative claim:** legacy climb-cost was calibrated to ~Earth gravity, so the earth law is a *calibration tie-out*, not an effect. Ledger H-EARTH-CALIBRATED: **0.50, undecided** (n=4 cannot separate a null from a small effect — exactly the honest outcome for a tie-out).
- Moon (1.62 m/s²): **Δ+547**, births 13, deaths 0, CV 1.28, lateCV 0.444, LMC 0.563. Movement is nearly free; agents do not burn up. **Qualitative claim:** below ~2 m/s² the climb economy stops taxing motion and the colony switches from metabolically-constrained to growth-dominated — a *phase transition* between Mars (3.71, legacy) and Luna (1.62, explosive).
- **Hypothesis:** *on frictionless/low-gravity regimes the colony growth order (Δpop relative to alive-at-t0) is O(exp) instead of O(1) as mass recycling removes death-charges*. Locate the gravity threshold by a gravity sweep in [1.6, 3.7] in a future run.

## 5. Supply & destruction — regen is only as good as the absorber
- `supply.low` (3e-5) ≡ control: the regen floor is never binding at this horizon — colonies consume the same standing pool either way.
- `supply.high` (3e-3): baseline +11 but replicate spread −29 / +49 / −28 / −31. **Qualitative claim:** high regen only converts into headcount on worlds with absorptive capacity; on barren windows the pool floods and is idle. Ledger H-SUPPLY: **0.50, undecided — the effect is *wet*, not monotone**.
- **Hypothesis:** *regen elasticity is moderated by habitat absorptive capacity — cross the supply axis with the biome axis; expect supply×absorptivity interaction in Δpop but no main effect on barren biomes.*

## 6. Black-swan events (tick 80 of 300, matched per seed)
- **meteor** (r=250 at colony): final populations land within 3 agents of the no-event path on every seed (ΔdPop 0, −1, 0, −3) and survivors keep the colony alive and regrow (recover ≥0.56; ledger threshold 0.5) — a local shock is absorbed, not absorbing. Survivability-held claim; ledger H-METEOR-SURVIVABLE **0.89 (support)**, Bayes factor ~7.7 (4/4 recovered).
- **storm** (toxin → 0.92): identical to `none` within 1 agent (ΔdPop 0, +1, 0, 0) — the toxin channels in this model do not alter the observed growth path here (smoke = terrain/toxiology channels, not agent health; recorded as a treatment that happened).
- **famine** (food ×0.05): uniformly depressed final counts (alive@event → final: 9→8, 14→7, 11→8, 9→6) with `recover` ≈ 0.5–0.9 — colonies partially recover but never regain the no-event path. Ledger H-FAMINE: **0.53, lean** (directionally right, minimal-BF bound is weak at n=4).
- **bounty** (+50 food, r=400): no-op on three worlds (too barren at tick 80 to absorb), but on rep-2: 14 → **121** (recovery 8.6). **Qualitative claim:** a pulse is an *option*, not a floor — it exploits only windows that already support reproduction. Ledger H-BOUNTY: **0.50, undecided**; next run should place bounties on absorptive biomes to test the mechanism.
- **nuke** (total cull): 0 alive, every world, recover=0, recoveryT=−1 — *absorbing extinction*. No immigration and no survivor ⇒ no re-seeding mechanism. Ledger H-NUKE-IRRECOVERABLE: **0.89 (support)**.

## 7. Equilibria (480-tick horizon)
- calmTorus +45, calmKlein +35, **hyperthermal +71** (LMC 0.558 — thermal jitter diversifies metabolism), cryoFrozen −6 (deaths 1, still declining: slope 0.354).
- **Qualitative claim:** the long-horizon ordering ben>thermal; *cryoFrozen does not equilibrate within 480t* — its growth slope is still negative, so time-to-equilibrium is biome-dependent and diverges for cryo.
- **Hypothesis:** *equilibria exist only above a critical metabolic-envelope temperature; subcritical (cryo) worlds have no fixed point in the observable horizon*.

## 8. Concrete hypothesis list (cross-referenced to ledger)
| id | hypothesis | ledger posterior | status |
|---|---|---|---|
| H-BANK | energy-bank capacity < ~30 makes ordinary cost jitter fatal | 0.72 | support |
| H-META | basal metabolism > 1 suppresses standing population | 0.62 | lean |
| H-ESCAPE | escape-window size only re-textures growth (no directional bias) | 0.50 | undecided (by design) |
| H-EARTH | earth-physics ≡ legacy calibration tie-out | 0.50 | tie-out (null) |
| H-MOON | gravity ≲ 2 m/s² flips colony to growth-dominated phase | n/a (single run) | strong trend — needs gravity sweep |
| H-SUPPLY | regen elasticity moderated by absorptive capacity (interaction) | 0.50 | undecided |
| H-FAMINE | supply destruction depresses standing population | 0.53 | lean |
| H-BOUNTY | resource pulses are options, not floors | 0.50 | undecided |
| H-METEOR | localized impacts are survivable | 0.89 | support |
| H-NUKE | total cull is absorbing (no re-seeding) | 0.89 | support |
| H-EQ | equilibria require a metabolic envelope; cryo diverges | n/a (single run) | descriptive
