# AI World Controller
Generated: 2026-10-15T14:25:43.574Z
Provider: ollama (qwen2.5:3b) [cached]
Objective: sustain a large, healthy population with high trait diversity and no energy collapse
Design: 120-tick unsteered warmup, then 3 steered windows of 120 ticks, against an unsteered control run of the same tick budget.

## Trajectory
| window | applied | alive | pop | species | energy | effDim |
|---|---|---|---|---|---|---|
| 1 | foodRegenRate=0.0001, maxPopulation=4000, metabolismBase=1.5, energyCapacity=400 | 50 | 224 | 37 | 72.5 | 5.4 |
| 2 | maxPopulation=5000, foodRegenRate=0.00005, metabolismBase=1.2 | 49 | 226 | 34 | 112.5 | 5.3 |
| 3 | foodRegenRate=0.0001, maxPopulation=5500 | 54 | 236 | 34 | 131.7 | 5.1 |

## Decisions
**Window 1** — sustain a large, healthy population with high trait diversity and no energy collapse
  Adjust parameters to ensure a stable, sustainable population with diverse traits and avoid energy collapse
  outcome: tick=240 pop=224 alive=50 species=37 energy=72.5 coop=0.000 caComplexity=0.000 effDim=5.4
  species:
    - Herbivore: conserve (Focus on energy efficiency and resource conservation)
    - Carnivore: compete (Competitive strategy to secure limited resources)
    - Plankton: explore (Explore diverse niches to ensure food availability)
    - Herbivore: explore (Diversify diet to avoid over-reliance on one food source)
    - Carnivore: cooperate (Form symbiotic relationships to enhance hunting efficiency)
    - Plankton: cooperate (Form symbiotic relationships to enhance growth and survival)
    - Herbivore: explore (Diversify diet to avoid over-reliance on one food source)
    - Carnivore: explore (Diversify diet to avoid over-reliance on one food source)

**Window 2** — sustain a large, healthy population with high trait diversity and no energy collapse
  Current population is at 224 out of 4000, which is about 56%. To sustain a large, healthy population, we need to increase the population cap and possibly adjust the metabolism and food regeneration rates to ensure a stable environment.
  outcome: tick=360 pop=226 alive=49 species=34 energy=112.5 coop=0.000 caComplexity=0.000 effDim=5.3
  species:
    - SpeciesA: conserve (SpeciesA is a conservative species that prefers stable environments.)
    - SpeciesB: explore (SpeciesB is an exploratory species that seeks new resources.)
    - SpeciesC: compete (SpeciesC is a competitive species that often competes for resources.)

**Window 3** — sustain a large, healthy population with high trait diversity and no energy collapse
  Current population is stable but low, need to increase food availability and population size to support diversity
  outcome: tick=480 pop=236 alive=54 species=34 energy=131.7 coop=0.000 caComplexity=0.000 effDim=5.1
  species:
    - Herbivore: cooperate (promote herbivore cooperation to support plant regrowth)
    - Carnivore: compete (maintain competitive balance with herbivores)
    - Primary Producer: explore (increase exploration to find new resources)

## Steered vs unsteered control
control: tick=480 pop=429 alive=139 species=45 energy=45.3 coop=0.000 caComplexity=0.001 effDim=4.6
steered: tick=480 pop=236 alive=54 species=34 energy=131.7 coop=0.000 caComplexity=0.000 effDim=5.1

| metric | control (unsteered) | steered |
|---|---|---|
| population | 429 | 236 |
| aliveCount | 139 | 54 |
| speciesCount | 45 | 34 |
| avgEnergy | 45.27770635263159 | 131.6567091378066 |
| cooperation | 0.00029275220424298723 | 0 |
| caComplexity | 0.0007667918352835681 | 0.0001863234794203924 |
| traitEffectiveDim | 4.642050931618811 | 5.071955973530158 |
| traitTotalVariance | 1.0540004651149426 | 1.2173074493217315 |

<sub>tick: 480 → 480; population: 429 → 236; aliveCount: 139 → 54; speciesCount: 45 → 34; avgEnergy: 45.27770635263159 → 131.6567091378066; cooperation: 0.00029275220424298723 → 0; caComplexity: 0.0007667918352835681 → 0.0001863234794203924; traitEffectiveDim: 4.642050931618811 → 5.071955973530158; traitTotalVariance: 1.0540004651149426 → 1.2173074493217315</sub>