# Known-systems reverse-engineering registry

Mode: **quick** · 17 scientific + 9 platform systems · 14 replicated · mean fidelity **1.00** · 5738 ms

Canonical artificial-life / complex-systems models from the literature and the major ABM platforms, mapped to the executable fractal-life replications. Fidelity is the gated-check pass rate of the linked benchmark; `documented` entries are catalogued but not yet instrumented.

| id | system | domain | framework | year | status | fidelity | bench |
| --- | --- | --- | --- | ---: | --- | ---: | --- |
| random-walk-pearson | Random walk | scientific | — | 1905 | replicated | 1.00 | A |
| reynolds-boids | Boids | scientific | — | 1987 | replicated | 1.00 | B |
| conway-life | Conway's Game of Life | scientific | — | 1970 | replicated | 1.00 | C |
| lotka-volterra | Lotka–Volterra predator–prey | scientific | — | 1925 | replicated | 1.00 | D |
| diffusion-fick | Diffusion equation | scientific | — | 1855 | replicated | 1.00 | E |
| turing-reaction-diffusion | Turing / Gray–Scott reaction–diffusion | scientific | — | 1952 | replicated | 1.00 | F |
| nowak-may-ipd | Spatial Prisoner’s Dilemma | scientific | — | 1992 | replicated | 1.00 | G |
| tilman-rstar | R* resource competition | scientific | — | 1982 | replicated | 1.00 | H |
| vicsek-model | Vicsek self-propelled particles | scientific | — | 1995 | replicated | 1.00 | I |
| wolfram-eca | Elementary cellular automata | scientific | — | 1983 | documented | — | — |
| langton-ant | Langton's ant | scientific | — | 1986 | documented | — | — |
| schelling-segregation | Schelling segregation | scientific | — | 1971 | documented | — | — |
| kauffman-nk | NK fitness landscapes | scientific | — | 1989 | documented | — | — |
| mitchell-ga | Evolving cellular automata (GA) | scientific | — | 1993 | documented | — | — |
| avida | Avida digital evolution | scientific | — | 2004 | documented | — | — |
| tierra | Tierra | scientific | — | 1991 | documented | — | — |
| lenia | Lenia | scientific | — | 2019 | documented | — | — |
| netlogo-wolf-sheep | Wolf–Sheep Predation | platform | NetLogo | 1997 | replicated | 1.00 | D |
| netlogo-fire | Fire | platform | NetLogo | 1997 | documented | — | — |
| netlogo-ants | Ants (stigmergy) | platform | NetLogo | 1997 | replicated | 1.00 | J |
| mesa-schelling | Schelling Segregation | platform | Mesa | 2015 | documented | — | — |
| mesa-boltzmann | Boltzmann Wealth | platform | Mesa | 2015 | documented | — | — |
| repast-zombies | Zombies | platform | Repast Simphony | 2013 | documented | — | — |
| repast-sugarscape | Sugarscape | platform | Repast Simphony | 1996 | replicated | 1.00 | H |
| flamegpu-boids | Boids (GPU) | platform | FLAME GPU | 2010 | replicated | 1.00 | B |
| flamegpu-pedestrian | Pedestrian Flow | platform | FLAME GPU | 2014 | replicated | 1.00 | I |

## Scientific systems

### Random walk — Karl Pearson (1905)

- **demonstrates:** diffusive transport: mean-squared displacement growing linearly in time
- **reference:** Pearson, K. (1905). The problem of the random walk. Nature 72, 294.
- **replication:** benchmark A — 2-D step random walkers on a torus; fits MSD slope and diffusion exponent against theory.
- **notes:** Idealised, toolless walkers; no excluded volume or persistence term.

### Boids — Craig Reynolds (1987)

- **demonstrates:** emergent flocking from three local steering rules (separation, alignment, cohesion)
- **reference:** Reynolds, C. W. (1987). Flocks, herds and schools: a distributed behavioral model. SIGGRAPH.
- **replication:** benchmark B — grid-accelerated synchronous flocking with positional relaxation; order parameter Φ and minimum separation.
- **notes:** Fixed-radius topological interaction with periodic bounds; no predator or goal terms.

### Conway's Game of Life — John Horton Conway (1970)

- **demonstrates:** universal computation and emergent structure from a B3/S23 2-D CA
- **reference:** Gardner, M. (1970). Mathematical Games. Scientific American 223(4), 120–123.
- **replication:** benchmark C — reuses the engine GoL; verifies glider/blinker/block/pulsar periods and Gosper-gun emission.
- **notes:** Fixed finite torus; exact integer CA so validation is deterministic.

### Lotka–Volterra predator–prey — Alfred J. Lotka / Vito Volterra (1925)

- **demonstrates:** neutral predator–prey cycles with a conserved first integral
- **reference:** Volterra, V. (1926). Fluctuations in the abundance of a species considered mathematically. Nature.
- **replication:** benchmark D — RK4 integration of the classic ODEs; checks cycle period, quarter-phase lag and invariant drift.
- **notes:** Deterministic ODE plus tiny seeded perturbation; no stochasticity or spatial structure.

### Diffusion equation — Adolf Fick / Albert Einstein (1855)

- **demonstrates:** macroscopic diffusion from microscopic Brownian motion; 2-D Gaussian spreading
- **reference:** Einstein, A. (1905). Über die von der molekularkinetischen Theorie… Annalen der Physik 17, 549.
- **replication:** benchmark E — FTCS integration of a 2-D Gaussian; L2 error vs analytic solution, mass conservation and MSD growth.
- **notes:** Explicit scheme on a periodic grid; validated against a closed-form solution.

### Turing / Gray–Scott reaction–diffusion — Alan Turing / Peter Gray & Stephen Scott (1952)

- **demonstrates:** Turing instability: spontaneous pattern formation from a homogeneous state
- **reference:** Gray, P. & Scott, S. K. (1984). Autocatalytic reactions… Chemical Engineering Science 39, 1087.
- **replication:** benchmark F — Gray–Scott FTCS on a torus; in-regime spot patterns, out-regime decay to the trivial state.
- **notes:** Fixed diffusion ratio Du/Dv = 2; seeded nuclei for the in-regime case.

### Spatial Prisoner’s Dilemma — Martin Nowak & Robert May (1992)

- **demonstrates:** spatial reciprocity: cooperation sustained on a lattice where the well-mixed game collapses
- **reference:** Nowak, M. A. & May, R. M. (1992). Evolutionary games and spatial chaos. Nature 359, 826–829.
- **replication:** benchmark G — synchronous imitate-best on a Moore lattice vs. a well-mixed population; cooperation fraction contrast.
- **notes:** Weak temptation b = 1.05; no mutation, migration or noise.

### R* resource competition — David Tilman (1982)

- **demonstrates:** competitive exclusion and coexistence governed by the lowest required resource level R*
- **reference:** Tilman, D. (1982). Resource Competition and Community Structure. Princeton University Press.
- **replication:** benchmark H — two-species chemostat; the smaller-R* species excludes the larger, symmetric K coexists.
- **notes:** Monod uptake, single limiting resource, constant dilution and supply.

### Vicsek self-propelled particles — Tamás Vicsek (1995)

- **demonstrates:** order–disorder transition in self-propelled particles with local alignment plus noise
- **reference:** Vicsek, T. et al. (1995). Novel type of phase transition in a system of self-driven particles. PRL 75, 1226.
- **replication:** benchmark I — Vicsek alignment with a destination pull; measures polarisation Φ and group arrival.
- **notes:** Added goal-directed bias; interaction is a fixed neighbourhood radius.

### Elementary cellular automata — Stephen Wolfram (1983)

- **demonstrates:** four classes of 1-D CA behaviour, including Rule 110 universality
- **reference:** Wolfram, S. (1983). Statistical mechanics of cellular automata. Reviews of Modern Physics 55, 601.
- **replication:** not separately instrumented; the CA class is exercised indirectly via the Game-of-Life benchmark (C).
- **notes:** Planned: a 1-D ECA checker for Rules 30/90/110 class membership.

### Langton's ant — Chris Langton (1986)

- **demonstrates:** a simple turmite exhibiting a long transient followed by emergent highway construction
- **reference:** Langton, C. G. (1986). Studying artificial life with cellular automata. Physica D 22, 120–149.
- **replication:** not yet instrumented.
- **notes:** Planned: highway detection after the ~10⁴-step transient.

### Schelling segregation — Thomas Schelling (1971)

- **demonstrates:** macroscopic segregation emerging from mild individual preferences
- **reference:** Schelling, T. C. (1971). Dynamic models of segregation. Journal of Mathematical Sociology 1, 143–186.
- **replication:** not yet instrumented.
- **notes:** Planned: threshold sensitivity of the segregation index.

### NK fitness landscapes — Stuart Kauffman (1989)

- **demonstrates:** tunable ruggedness and the conflict between adaptation and complexity
- **reference:** Kauffman, S. A. & Weinberger, E. D. (1989). The NK model of rugged fitness landscapes. J. Theor. Biol. 141, 211.
- **replication:** not yet instrumented.
- **notes:** Planned: walk length / fitness vs K.

### Evolving cellular automata (GA) — Melanie Mitchell (1993)

- **demonstrates:** genetic-algorithm design of CA that perform global computation
- **reference:** Mitchell, M., Crutchfield, J. & Hraber, P. (1993). Evolving cellular automata to perform computations. Physica D 75, 361.
- **replication:** not yet instrumented.
- **notes:** Planned: majority-classification task.

### Avida digital evolution — Charles Ofria & Christoph Adami (2004)

- **demonstrates:** open-ended evolution of self-replicating computer programs
- **reference:** Ofria, C. & Wilke, C. O. (2004). Avida: a software platform for research in computational evolutionary biology. Artificial Life 10, 191.
- **replication:** not yet instrumented.
- **notes:** Planned: instruction-level self-replicator with mutation.

### Tierra — Thomas S. Ray (1991)

- **demonstrates:** emergence of ecological dynamics among self-replicating machine-code organisms
- **reference:** Ray, T. S. (1991). An approach to the synthesis of life. Artificial Life II.
- **replication:** not yet instrumented.
- **notes:** Planned: memory-limited self-replicators competing for CPU.

### Lenia — Bert Wang-Chak Chan (2019)

- **demonstrates:** continuous-state, continuous-space CA supporting lifelike gliders and self-organisation
- **reference:** Chan, B. W.-C. (2019). Lenia: Biology of artificial life. Complex Systems 28, 251.
- **replication:** the closest shipped instrument is the coupled composite benchmark (J).
- **notes:** Planned: continuous CA with Gaussian kernel and growth function.


## Platform systems

### Wolf–Sheep Predation — Uri Wilensky (1997)

- **demonstrates:** coupled predator–prey population dynamics in a grid ABM
- **reference:** Wilensky, U. (1997). NetLogo Wolf Sheep Predation model. Northwestern CCL.
- **replication:** benchmark D — the continuous Lotka–Volterra backbone of the model, validated on period, phase lag and invariant.
- **notes:** Replicates the ODE limit rather than the stochastic NetLogo grid; discrete predation not modelled.

### Fire — Uri Wilensky (1997)

- **demonstrates:** percolation of a spreading process on a random grid
- **reference:** Wilensky, U. (1997). NetLogo Fire model. Northwestern CCL.
- **replication:** not yet instrumented.
- **notes:** Planned: burn-fraction vs. density percolation threshold.

### Ants (stigmergy) — Uri Wilensky (1997)

- **demonstrates:** pheromone-mediated foraging and trail formation
- **reference:** Wilensky, U. (1997). NetLogo Ants model. Northwestern CCL.
- **replication:** benchmark J — stigmergic agents laying a diffusing pheromone trail coupled to a CA layer; measures clustering and cross-correlation.
- **notes:** Replicates trail-mediated self-organisation, not the full nest/food-foraging cycle.

### Schelling Segregation — Project Mesa (2015)

- **demonstrates:** rising segregation from homophilous relocation on a grid
- **reference:** Mesa project. Schelling segregation example model.
- **replication:** not yet instrumented.
- **notes:** Planned: mean-similarity vs. desired-similarity threshold.

### Boltzmann Wealth — Project Mesa (2015)

- **demonstrates:** emergence of a Boltzmann–Gibbs wealth distribution from random exchange
- **reference:** Mesa project. Boltzmann wealth example model.
- **replication:** not yet instrumented.
- **notes:** Planned: fit of the stationary wealth distribution to an exponential law.

### Zombies — Argonne National Laboratory (2013)

- **demonstrates:** epidemic-like spread of infection across a mobile urban population
- **reference:** North, M. J. et al. (2013). Complex adaptive systems modeling with Repast Simphony. CASM 1, 3.
- **replication:** not yet instrumented.
- **notes:** Planned: infection-curve reproduction number.

### Sugarscape — Joshua Epstein & Robert Axtell (1996)

- **demonstrates:** wealth inequality and migration driven by heterogeneous resource harvesting
- **reference:** Epstein, J. M. & Axtell, R. (1996). Growing Artificial Societies. MIT Press.
- **replication:** benchmark H — the resource-competition core (R* theory); winner/coexistence under asymmetric supply.
- **notes:** Replicates the competition-for-a-limiting-resource mechanism, not the full sugar/migration economy.

### Boids (GPU) — Paul Richmond (2010)

- **demonstrates:** large-scale GPU flocking with emergent alignment
- **reference:** Richmond, P. et al. (2010). High performance cellular level agent-based simulation with FLAME GPU. Briefings in Bioinformatics 11, 334.
- **replication:** benchmark B — the same three-rule flocking reduced to a grid-accelerated CPU model; order parameter and separation.
- **notes:** CPU replication; no GPU spatial partitioning or messaging layer.

### Pedestrian Flow — Paul Richmond (2014)

- **demonstrates:** collective navigation and lane formation in a crowd of steering agents
- **reference:** Richmond, P. et al. (2014). FLAME GPU pedestrian simulation.
- **replication:** benchmark I — self-propelled alignment toward a target; polarisation and arrival fraction.
- **notes:** Replicates directed collective motion, not full collision/queue mechanics.

## Provenance

- node: `v18.12.1` (`win32/x64`)
- timestamp: `2026-10-12T12:08:14.426Z`
