# AI World Directive
Generated: 2026-10-15T13:43:17.399Z
Provider: ollama (qwen2.5:3b) [cached]
Objective: sustain a large, healthy population with high trait diversity and no energy collapse

## Rationale
To achieve the objective, we need to set the knobs to values that promote a stable, high-population environment with diverse traits and sustainable energy levels. The strategy for each species will be determined based on their traits and the environment.

## Overrides
| knob | value |
|---|---|
| metabolismBase | 0.5 |
| foodRegenRate | 0.00005 |
| energyCapacity | 400 |
| maxPopulation | 4000 |
| agentMaxAge | 7000 |
| dayLength | 3000 |
| seasonLength | 3000 |
| spawnCount | 200 |

## Species strategies
| species | strategy | note |
|---|---|---|
| SmallHerbivore | conserve | To conserve energy and space, SmallHerbivore should reduce its metabolism and increase its energy capacity. |
| MediumHerbivore | cooperate | MediumHerbivore can benefit from cooperative behaviors to ensure food availability and reduce competition. |
| LargeHerbivore | compete | LargeHerbivore needs to be competitive to access food resources and prevent overpopulation. |
| SmallCarnivore | explore | SmallCarnivore can explore new areas and niche opportunities to maintain population diversity. |
| MediumCarnivore | explore | MediumCarnivore can also explore and find new sources of food and resources. |
| Predator | explore | Predators should continue to explore and find new prey or food sources. |

## Outcome (300 ticks)
baseline: pop=226 alive=95 species=41 energy=36.2 coop=0.001 caComplexity=0.001 effDim=4.8
directed: pop=344 alive=176 species=73 energy=156.1 coop=0.000 caComplexity=0.001 effDim=4.7

| metric | baseline | directed |
|---|---|---|
| population | 226.0000 | 344.0000 |
| aliveCount | 95.0000 | 176.0000 |
| speciesCount | 41.0000 | 73.0000 |
| avgEnergy | 36.2436 | 156.1065 |
| cooperation | 0.0010 | 0.0000 |
| caComplexity | 0.0006 | 0.0011 |
| traitEffectiveDim | 4.7690 | 4.7165 |
| traitTotalVariance | 1.1806 | 1.1459 |

<sub>population: 226 → 344; aliveCount: 95 → 176; speciesCount: 41 → 73; avgEnergy: 36.243565099721515 → 156.1064851557057; cooperation: 0.001028133304100074 → 0; caComplexity: 0.0006379315747043851 → 0.001102966739006844; traitEffectiveDim: 4.769030541343449 → 4.716520913834937; traitTotalVariance: 1.1806354759179372 → 1.1458632046886155</sub>