# System Atlas — Tree of Life

*(Tree of Life — formerly "Fractal Life v2".)*

The complete map of the project: the **engines** that run it, the **mechanisms**
inside them, the real-world biology/physics each one **biomimics**, the
**detectors** that measure it, the **agents** that steer it, the **experiments**
that test it, and the surrounding **tooling**.

Where this sits relative to the other records:

| document | scope |
|---|---|
| `SYSTEM_MAP.md` | one-screen section map (S1–S7), the quick index |
| **`SYSTEM_ATLAS.md`** (this file) | deep inventory: files, mechanisms, biomimicry, runtimes |
| `UNIFIED_RECORD.md` | instrument system-of-record: stable ids (`D-*`/`O-*`/`R-*`/`A-*`), hierarchies, processes, matrix |
| `README.md` (this dir) | per-module prose documentation of the research harness |
| `REGIME_CATALOG.md` / `SCALING_CATALOG.md` / `TEST_MATRIX.md` / `SCOPE.md` | regimes, scaling laws, gates, claims |

Everything below is cited to a real file. Line numbers are anchors, not contracts.

---

## 0. Navigation — repo layout & entry points

### 0.1 Layout

| path | what lives there |
|---|---|
| `apps/simulation/src/` | **the engine** — TS reference simulation, its subsystems, research CLIs |
| `apps/simulation/src/research/` | measurement/experiment harness (ladder, radar, benchmarks, AI, design, catalogs) |
| `apps/simulation/test/` | 52 test files (fast/slow tiers via `test/tiers.json`) |
| `apps/simulation/research/` | the docs + `output/` report bank (generated `.md/.json/.csv/.svg`) |
| `apps/server/src/` | REST + WebSocket gateway, storage (memory/Postgres), WASM engine host |
| `apps/web/src/` | React client, canvas renderer, worker engine, panels |
| `packages/shared/src/` | wire types, constants, radar/life detectors, protocol, grounding schema |
| `packages/shaders/src/` | GLSL escape-time shaders (terrain parity with the TS grid) |
| `crates/shared/` | Rust wire types/constants/hash/universe/protocol |
| `crates/simulation/` | **Rust authority engine** (1:1 with the TS reference) |
| `crates/wasm/` | `wasm-bindgen` glue exposing the Rust engine to JS |
| `scripts/` | `run-tests.mjs` (tiered runner), `browser-check.ts`, `ws-smoke.ts` |
| `probe/` | parity/bisect/trace probes (TS↔Rust debugging instruments) |
| `infra/` | Dockerfiles, compose, nginx |
| `data/` | `enrichment.json` — offline-grounded real-world priors |

### 0.2 Entry points

| entry | command |
|---|---|
| typecheck | `npx tsc --noEmit` (in `packages/shared`, `apps/simulation`) |
| fast tests | `node ..\..\scripts\run-tests.mjs --fast --jobs 4` (from `apps/simulation`) |
| canonical research | `npm run research -w @fractal-life/simulation` |
| every research CLI | see §6.8 |

Log in the worker: TS engine (`apps/web/src/net/workerSource.ts`); remote:
WASM in the server (`apps/server/src/engine/wasmEngine.ts`).

---

## 1. Engines & runtimes

Three implementations of the *same* deterministic simulation, plus hosts.

| engine | location | role | notes |
|---|---|---|---|
| **TS reference** | `apps/simulation/src/engine.ts` (2659 lines) | the readable, instrumentable model; research runs on it | opt-in observables (biophysics/quantum/subatomic) are **zeroed here** — see §1.2 |
| **Rust authority** | `crates/simulation/src/*.rs` | bit-faithful authority lane; TS mirrors it crate-for-crate | "the Rust lane is ALWAYS the authority" (`quantum.rs`) |
| **WASM runtime** | `crates/wasm/src/lib.rs` (1022 lines) | `wasm-bindgen` facade: `tick` / `stats` / snapshot / `agent_summaries_json` / `terrain_grid_json` | consumed by the web client and the node radar harness |
| **Worker engine** | `apps/web/src/sim/engineWorker.ts`, `apps/web/src/net/workerSource.ts` | TS engine in a Web Worker for local mode | same parity surface |
| **Server engine** | `apps/server/src/engine/wasmEngine.ts` | WASM engine per world for remote mode | |
| **Shaders** | `packages/shaders/src/index.ts` | GLSL escape-time terrain; **same formulas** as `src/terrain.ts` | rendered terrain ≡ simulated biology |

### 1.1 Determinism contract

The simulator is a pure function of its world definition:
`S(run) = run(seed, timestep, population, params[, worldStoch])`.
All randomness flows through `SplitMix64` (`src/rng.ts`) seeded from
`(worldSeed, tick, agentId)`; agents iterate in ascending-id order; the only
opt-in stochasticity is the still-seeded `worldStoch` module. Verified bit-exact
by `O-SNAPSHOT` (`src/research/snapshot.ts` `fullStateHash`) in
`test/determinism.test.ts` and the four scientific modes (`src/research/modes.ts`).

### 1.2 TS ↔ Rust mirror discipline

The TS engine `engine.ts:1621-1630`, `2374-2383`, `2410-2474` deliberately
**zeroes** the opt-in observables it does not compute (biophysics, discovery,
Phase-E quantum, Phase-G subatomic, Phase-I stat-mech) so that its `SimStats`
JSON stays a *valid, wire-compatible* row and `engine.ts` ↔ `wasm` **stats JSON
parity holds bit-for-bit**. Those fields light up only under the WASM lane.
`crates/wasm/src/lib.rs` exposes the browser/server surface.

### 1.3 Parity instruments

`probe/parity.ts`, `probe/parity-blades.ts`, `probe/parity-lineage.ts`,
`probe/bisect.ts`, `probe/replay-grounding.ts`, `probe/trace.ts` — bisect and
replay TS-vs-Rust divergence down to a single tick/blade. Gated by
`apps/simulation/test/parity.test.ts`.

---

## 2. Mechanisms — the engine subsystems

### 2.1 The tick pipeline (order matters)

From the section headers in `src/engine.ts`, each tick runs:

```
tick()
 ├ day/night + seasons cycle                          (L618)
 ├ stochastic world: Markov weather · OU field · Poisson regen  (L626)
 ├ ecology grounding: per-level crowding penalty       (L671)
 └ per-agent loop (ascending id):
    ├ orbit step  z → z² + c   (THE FRACTAL IS THE SYSTEM)  (L736)
    ├ chemistry terrain sample (O2/pH/toxin/minerals)  (L769)
    ├ neighbor scan (tick-start snapshot, deterministic)(L776)
    ├ pattern drives → thrust                           (L875-963)
    ├ movement + slope physics (momentum, drag)         (L966)
    ├ metabolism + movement cost (+climb tax)           (L1003)
    ├ water balance (evaporate / drink)                 (L1025)
    ├ feed (plants / carrion, diet-driven)              (L1031)
    ├ agent chemistry tick                              (L1055)
    ├ DNA tick (fidelity/repair/expression)             (L1067)
    ├ molecular-omics tick (opt-in)                     (L1076)
    ├ cell system tick                                  (L1095)
    ├ cell biochemistry tick (opt-in)                   (L1101)
    ├ immune system tick                                (L1120)
    ├ metabolism tick                                   (L1137)
    ├ predator-prey behavior (hunt/escape/warn)         (L1151)
    ├ dormancy check                                    (L1164)
    ├ reproduction gene tracking                        (L1173)
    ├ costly signalling (pheromone)                     (L1247)
    ├ memetic greenbeard altruism (donation)            (L1263)
    ├ memetic transmission (prestige-bias imitation)    (L1298)
    ├ reproduction (asexual/sexual + recombination)     (L1318)
    └ plastic brain learning (reward = net energy)      (L1446)
 ├ biome regime re-injection (opt-in)                  (L1497)
 ├ replicator dynamics projection (every 100 ticks)    (L1524)
 ├ fitness + birth bookkeeping + events                (L1536-1560)
 └ math / biophysics / phase observables                (L1604-2474)
```

Then the **world** half: carrion → meat pool (L1687), decomposition → soil
nutrients closed loop (L1728), plant growth gated by soil minerals + weather +
OU field (L1736), weathering (L1752), signal diffusion with toroidal wrap
(L1772), then `stats()` (L1787).

### 2.2 World, terrain & topology

| module | mechanism |
|---|---|
| `src/terrain.ts` | deterministic escape-time terrain (Mandelbrot / Julia / Perlin); smooth iteration `nu`, phase = soil-chemistry axis; 128² grid |
| `packages/shaders/src/index.ts` | GLSL twins of the terrain formulas |
| `src/spatialHash.ts` | uniform grid (typed arrays, zero-alloc) for O(1) neighbour queries |
| `src/physics.ts` | momentum + linear drag (`DRAG=0.86`), slope tax (`0.4`) / boost (`0.5`), climb metered as heat (energy-conservative) |
| `src/worldStoch.ts` | opt-in seeded stochastic world (see §2.11) |
| topologies | torus / cylinder / sphere / möbius / kleinBottle (`packages/shared/src/types.ts:118`) |

### 2.3 Chemistry & metabolism

`src/chemistry.ts` (503 lines): each agent carries 8 elements (C,H,O,N,P,S,Fe,K),
12 molecules (glucose, ATP, amino acid, lipid, nucleotide, enzyme, protein,
toxin, signal, sugar, fatty acid, osmolyte), 5 ions (Na⁺,K⁺,Ca²⁺,Fe²ᐟ³⁺,Cl⁻),
6 enzyme types and pH. The environment carries 4 chemical terrain grids (O2, pH,
toxins, minerals) that diffuse/decay/interact. Deterministic, O(1)/agent/tick.

### 2.4 DNA & genome

| module | mechanism |
|---|---|
| `src/genome.ts` | 217-locus genome; phenotype block, drive genes, strategy genes, immune/predprey/repro/metab blocks; mutation, speciation (`SPECIATION_THRESHOLD`), genome similarity |
| `packages/shared/src/genomeBlueprint.ts` | the genome layout / block offsets (single source of truth) |
| `src/dna.ts` | `DnaSystem`: integrity [0,1], damage accumulation, 24-block expression profile, epigenetic methylation, repair, horizontal transfer, transposons |

### 2.5 Cells & deep cell biology (opt-in)

| module | mechanism |
|---|---|
| `src/cells.ts` | `CellState`: radius, membrane potential/integrity, mito efficiency, ribosomes, cytoskeleton, vesicle buffer, tension, cell cycle G1→S→G2→M, division |
| `src/cellbio.ts` (opt-in `WorldConfig.cellBio`) | 4-class proteome + chaperone refolding; Michaelis-Menten enzyme kinetics with end-product inhibition; membrane surface gradient + cytoskeletal transport (mass-conserved); Na⁺/K⁺ pumping, mitochondrial respiration, lipid repair, endo/exocytosis. Mirrors `crates/simulation/src/cellbio.rs` |

### 2.6 Molecular omics (opt-in)

`src/omics.ts` (1734 lines, `WorldConfig.omics`): four views —
**transcriptomics** (24 mRNA pools driven by DNA expression blocks + epigenetic
silencing + inducible transcription), **proteomics** (translation to protein
pools, folding, aggregation, chaperone load), **fluxomics** (6-reaction pathway
graph over the 12 molecules), and **interactomics** telemetry. Phase A is
observational: pools advance and aggregate but never feed energy back (legacy
trajectory unchanged). Mirrors `crates/simulation/src/omics.rs`.

### 2.7 Ecosystem & selection

| module | mechanism |
|---|---|
| `src/ecosystem.ts` | trophic levels: producer → primary/secondary/tertiary consumer → decomposer |
| `src/selection.ts` | fitness decomposition: energy / survival / reproductive / social / metabolic → composite |
| `src/replicator.ts` | replicator dynamics `dxᵢ/dt = xᵢ(fᵢ − φ)`; 4-D strategy space projected on the dominant covariance eigenvector, binned into 12 |

### 2.8 Brain & cognition

`src/brain.ts` (408 lines): plastic recurrent MLP (15 inputs → 4 hidden → 7
outputs), Elman feedback weights [192..207], learned critic [208..212],
plasticity genes [213..216]; Hebbian **and** backprop; optional stochastic
policy sampling; optional **POMDP** perception (noisy hidden channels +
belief filter + belief-guided action). Learning reward = net energy change over
the tick. `src/forecast.ts` is a separate small online-trained MLP forecaster for
one-or-more observables.

### 2.9 Social behaviour, culture & cooperation

- **Costly signalling** (`engine.ts:1247`): pheromone emission burns energy — an
  honest indicator (handicap); the deception gene cheapens it.
- **Memetic greenbeard altruism** (`engine.ts:1263`, `P-RECIP`): donate to the
  nearest *needy* neighbour sharing your cultural tag; identity
  `ΣtotalDonated == ΣtotalReceived`. Constants `ALTRUISM_THRESHOLD=0.75`,
  `DONATION_RATE=0.02`, `MEME_TOLERANCE=0.05`.
- **Prestige-bias imitation** (`engine.ts:1298`): copy the most successful
  neighbour's meme (culture spreads by success, not kinship).
- **Predator–prey** (`engine.ts:1151-1231`): pursuit bonus, ambush damage, pack
  hunting, stealth, enhanced escape, same-species warning calls.

### 2.10 Cellular automaton & field math

| module | mechanism |
|---|---|
| `src/gameoflife.ts` | Conway CA overlaid on the terrain grid; fed back as terrain modifier + sensor + complexity observable (self-referential loop) |
| `src/vectorfield.ts` | gradient / laplacian of the resource field; divergence / curl of the velocity field → extra MLP sensors + emergence observables |
| `src/lyapunov.ts` | largest Lyapunov exponent (Rosenstein) — chaos hallmark |
| `src/tensors.ts` | trait covariance tensor, eigenvalues/det, fitness Hessian |
| `src/distributions.ts` | Box-Muller Gaussian, exponential inter-events, gamma resource clumps, von Mises heading, multivariate Gaussian |

### 2.11 Stochastic world & discovery

| module | mechanism |
|---|---|
| `src/worldStoch.ts` | opt-in `WorldStochasticConfig`: Poisson regen bursts (point process), OU mean-reverting resource field (banded), 4-state Markov weather (`clear/rain/drought/heat`) |
| discovery (`crates/simulation/src/discovery.rs`) | Phase-D curiosity: per-agent 16-bit context signature vs a bounded 8-slot codebook; novel prototype (>35% Hamming) → recognition reward + exploration window. Rust/WASM-only; TS zeroes its observables |

### 2.12 Physics-grade substrates (Rust authority lane)

| module | mechanism |
|---|---|
| `crates/simulation/src/biophysics.rs` (796 lines) | opt-in mesoscale biophysics: Lennard-Jones pairwise force field (equal-and-opposite, min-image torus, softened/clamped) that steers movement **and** feeds clustering/rotational-order, thermodynamic bookkeeping (Carnot, entropy production, heat waste), conservation/symmetry tie-outs |
| `crates/simulation/src/quantum.rs` (195 lines) | Phase-E quantum-chemistry: tunneling, coherence lifetime, ZPE floor, quantum yield, dephasing — derived from real Phase-D fold-cluster pools, not stubs |
| Phase-G subatomic & Phase-I stat-mech | boson fields, gluon confinement, Higgs mass floor, quark flavors, leptons; information-theoretic observables — read from `SimStats`, computed in the WASM lane |

---

## 3. Biomimicry map

What each mechanism emulates from the real world. (The whole program is artificial
life, so this is "what biology/physics it is a model *of*".)

| mechanism (module) | real-world phenomenon | grounding |
|---|---|---|
| terrain = escape-time fractal; agent = orbit point `z→z²+c` (`terrain.ts`, `engine.ts:736`) | boundedness as survival; the fractal set as a persistence map | author metaphor ("THE FRACTAL IS THE SYSTEM") |
| `physics.ts` | Newtonian momentum, drag, gravitational climb tax / escape velocity | `universe.ts` real SI constants |
| `chemistry.ts` | cellular metabolism: glycolysis/ATP, enzymes, pH, ions | 8 elements / 12 molecules / 6 enzyme classes |
| `cellbio.ts` | protein folding + chaperones, membrane transport, Na⁺/K⁺ pump, mitochondria, exo/endocytosis | Michaelis-Menten kinetics |
| `dna.ts` | replication fidelity, DNA repair, gene expression, epigenetics, horizontal transfer, transposons | molecular genetics |
| `cells.ts` | membrane potential, cell cycle (G1/S/G2/M), division, organelles | cell biology |
| `omics.ts` | multi-omics systems biology: transcriptome / proteome / fluxome / interactome | systems biology |
| `ecosystem.ts` | trophic pyramid, producers → apex predators → decomposers | ecology |
| `selection.ts` | Darwinian fitness components | evolutionary biology |
| `replicator.ts` | replicator equation `x(f−φ)` | Taylor & Jonker (1978) |
| cooperation / greenbeard donation (`engine.ts:1263`) | tag-based / greenbeard altruism, reciprocal food sharing | behavioral ecology |
| costly signalling (`engine.ts:1247`) | handicap principle (Zahavi) honest signalling | behavioral ecology |
| prestige-bias imitation (`engine.ts:1298`) | cultural transmission / prestige bias | cultural evolution |
| predator-prey block (`engine.ts:1151`) | pursuit, ambush, pack hunting, warning calls | behavioral ecology |
| immune tick (`agent.ts` `ImmuneState`) | innate vs adaptive immunity, memory, inflammation, autoimmunity | immunology |
| `brain.ts` (MLP + Elman + critic + POMDP) | cortical policy learning, actor-critic reward, partially observable perception | computational neuroscience / RL |
| `gameoflife.ts` | emergent computation in cellular automata | Conway (1970) |
| `vectorfield.ts` | fluid-dynamics structure (gradient/curl/divergence) | vector calculus |
| `lyapunov.ts` | chaos / sensitive dependence on initial conditions | Rosenstein et al. (1993) |
| `tensors.ts` | quantitative-genetics G-matrix, principal components, fitness landscape curvature | Lande / multivariate evolution |
| `distributions.ts` | Gaussian mutation, Poisson events, clumped (gamma) resources, circular (von Mises) headings | probability theory |
| `worldStoch.ts` | environmental stochasticity: OU resource noise, Poisson disturbance, Markov weather | stochastic processes |
| `biophysics.rs` | intermolecular forces + statistical-mechanics thermodynamics | Lennard-Jones potential |
| `quantum.rs` | quantum chemistry (tunneling, coherence, ZPE, decoherence) | quantum physics |
| Phase-G subatomic | particle physics (bosons, gluons, Higgs, quarks, leptons) | Standard Model |
| `discovery.rs` | curiosity / intrinsic motivation (novelty reward) | cognitive science |
| `forecast.ts` | short-horizon time-series prediction | ML |

---

## 4. Detectors (the `D-*` instruments)

Full pegging lives in `UNIFIED_RECORD.md` §1.1. Plain-language summary:

| id | detects | source | hierarchy |
|---|---|---|---|
| `D-RADAR` | capability levels L0 Particle … L10 Artificial ecosystem | `packages/shared/src/emergenceRadar.ts` | H0–H10 |
| `D-RADAR-ABL` | whether a radar level collapses when its faculty is removed (ablation contract) | `src/research/emergenceRadar.ts` (ABLATIONS) | H0–H10 |
| `D-NOVELTY` | change no named detector captures | `emergenceRadar.ts` (`noveltyResidual`) | H1 |
| `D-ORG` | biological organization O0 subatomic … O9 organism | `packages/shared/src/lifeOrganization.ts` | Horg |
| `D-MACRO` | population-level regime random→clustered→organized→specialized→collapsed | `src/research/emergence.ts` | Hmacro |
| `D-LADDER` | L0 matter / L1 life / L2 interaction / L3 cognition verdicts | `src/research/ladder.ts` | H1–H3 |
| `D-PHASE` | sharpest order-parameter transition loci | `src/research/aiRun.ts` (`findLoci`) | Hphase |
| `D-CRITICAL` | power-law exponents, half-max width, attractor modes, hysteresis area | `src/research/complexity.ts` | Hcrit |
| `D-CHANNEL` | whether a perturbation's pathway was actually live (`exercised/partial/closed`) | `src/research/perturb.ts` | Hproc |
| `D-CLAIM` | supported / refuted / inconclusive verdict per pre-registered claim | `src/research/claims.ts` | Hclaim |
| `D-RIGOR` | PASS / WARN / FAIL per rigor check | `src/research/benchmarks/rigor/*` | Ha–Hd |
| `D-GATE` | test assertions | `test/*.test.ts` | Hall |

**Detector discipline** (from `D-RADAR`, reused by `D-ORG`): a level is a *pure
conjunction of measured primitives*, never a flag the engine sets about itself;
run-relative min-max stretching with a dead-sensor floor; hysteresis on
onset/offset; an unwired substrate reads `DORMANT`, not `ABSENT`. `D-ORG` adds a
**coverage floor** (≥25% of channels wired before a rung is assayed). `D-RADAR-ABL`
accepts a detector only if removing its enabling faculty collapses it.

---

## 5. Agents (the LLM / AI layer, `A-*`)

Source `apps/simulation/src/research/ai/`; provider abstraction `client.ts`;
deterministic content-addressed cache `cache.ts`+`hash.ts` (`output/ai-cache/`);
providers `ollama` (`qwen2.5:3b` default) and offline `mock`.

| id | role | may | may **not** | modules |
|---|---|---|---|---|
| `A-WORLD` | world mind / controller | issue clamped population-level `WorldParams` overrides + one line per species | touch the per-agent core; write construction-only knobs | `worldAI.ts`, `controller.ts`, `knobs.ts` |
| `A-PHASE` | phase analyst | interpret measured loci, recommend refinements | compute the loci (code does) | `phaseAnalyst.ts` |
| `A-RESEARCH` | research agent | propose falsifiable experiments, refine across rounds | issue a verdict (the benchmark harness does) | `researchAgent.ts` |

Closed loop: `A-WORLD` runs one engine over warmup → (observe → direct → actuate →
measure) windows against an unsteered control. `A-RESEARCH` runs
propose → evaluate → feed-back rounds with a deduplicated ledger; proposals are
parsimony-scored (`benchmarks/parsimony.ts`) so a five-knob fit can't beat two on
accuracy alone. Cache modes: `on` (default), `refresh` (`--live`), `off`
(`--no-cache`), `replay` (miss = error). CLI `aiRun.ts` → `ai-world.*`,
`ai-phase.*`, `ai-loop.*`.

---

## 6. Experiments & benchmarks

### 6.1 Emergence ladder (`src/research/ladder.ts`)

One long unscripted run measured against L0 matter / L1 life / L2 interaction /
L3 cognition. `LadderResult.synthesis.levels` gives per-level verdicts; scores
`EMERGENT=1 / PARTIAL=0.5 / ABSENT=0`. CLI `ladderCli.ts` → `ladder-report.md`.

### 6.2 Agent archetypes (`src/research/archetypes.ts`)

Individual complexity ladder — same world/seed, one faculty added per tier:
**T0 simple rules → T1 constraints → T2 cognition → T3 systems**. Gated by
`test/archetypes.test.ts` (asserts the `0 → >0` unlock order).

### 6.3 Virtual complexity lab (`src/research/complexity.ts`)

A 10⁴-scale grid over a *micro* parameter, measuring *macro* response
(partial differentiation). Detects phase transitions, attractors, bifurcations,
feedback loops, hysteresis, scaling laws, cooperation, specialization. Also holds
the criticality estimators (`feedbackReport`, `hysteresisLoop`, `fitLogLog`,
`halfMaxWidth`, `attractorModes`). `P-LOOP` (reinforcing/balancing) lives here.

### 6.4 Emergence measurement (`src/research/emergence.ts`)

Emergence as a typed object over five axes (micro info, macro info, LMC
complexity, self-organization, temporal persistence) + emergent information
(NMI) + composite index, plus the population-level `D-MACRO` detector.

### 6.5 Canonical A–J benchmark suite (`src/research/benchmarks/`)

Ten self-contained deterministic micro-models, each gated against a
literature-defined signature:

| ID | model | family |
|---|---|---|
| A | random walkers (MSD exponent) | diffusion |
| B | boids (polarization) | flocking |
| C | Conway Game of Life (glider/blinker/gun) | cellular automaton |
| D | Lotka–Volterra predator–prey | ODE dynamics |
| E | diffusion (heat equation) | PDE |
| F | Gray–Scott reaction–diffusion | pattern formation |
| G | spatial Iterated Prisoner's Dilemma | evolutionary games |
| H | resource competition (R*) | community ecology |
| I | collective navigation | active matter |
| J | novel fractal-life composite (CA + stigmergy) | hybrid |

Harness `benchmarks/harness.ts`: fixed seed cohort, bootstrap-CI gates
(`gte`/`lte`/`range`/`eqAbs`), double-run fingerprint determinism. `benchRun.ts`
→ `bench.*`.

### 6.6 Known-systems registry (`benchmarks/knownSystems/`)

26 canonical systems (17 scientific: Pearson/Reynolds/Conway/Lotka–Volterra/
Fick–Einstein/Turing–GrayScott/Nowak–May/Tilman/Vicsek/Wolfram/Langton/Schelling/
Kauffman/Mitchell/Avida/Tierra/Lenia; 9 platform: NetLogo/Mesa/Repast/FLAME GPU).
Each replicated entry carries empirical targets (`measured`/`derived`/`expected`).
`knownRun.ts` → `known.*`. Validation scores engine output vs literature bands,
distinct from verification (vs our own gates).

### 6.7 Research-rigor layer (`benchmarks/rigor/`)

Seven cross-cutting modules over A–J: `verification`, `validation`,
`reproducibility`, `sensitivity` (OAT + Morris elementary effects), `ablation`,
`significance` (one-sided t + Holm–Bonferroni + Bayes factor + Clopper–Pearson),
`novelty` scorecard. `rigorRun.ts` → `rigor.*`, `rigor-hypotheses.json`.

### 6.8 Other research instruments

| instrument | file | output |
|---|---|---|
| canonical harness | `src/research/cli.ts` | `report.json`, per-scenario `*.md/json/csv` |
| environments (biomes/topologies/dimensions) | `src/research/environments.ts` | `environments.*`, `topologies.*`, `dimensions.*` |
| dimensional lattice | `src/research/dimensional_worlds.ts` | `lattice.*` |
| cosmos axes | `src/research/cosmos.ts` | `cosmos.*` |
| Bayesian ledger | `src/research/bayes.ts` | `bayes.md`, `hypotheses.json` |
| perturbation engine | `src/research/perturb.ts` | `perturbation.*` |
| causal decomposition | `src/research/causal.ts`, `eventCausal.ts` | `causal.*`, `events.*` |
| scope + claims | `src/research/scope.ts`, `claims.ts`, `scopeRun.ts` | `SCOPE.md`, `claims.json` |
| reproducible experiments | `src/research/experiment.ts`, `experimentCli.ts` | manifests (run/verify) |
| high-N selection | `src/research/highN.ts` | `highN_selection.json` |
| phase-budget allocation | `src/research/allocCompute.ts` | `allocCompute.json` |
| replicate analysis | `src/research/analyze.ts` | `analysis.*`, `replicates.*` |
| emergence atlas | `src/research/emergenceAtlas.ts`, `atlasRun.ts` | `atlas.*` |
| emergence radar | `src/research/emergenceRadar.ts`, `radarRun.ts` | `radar.*` |
| life organization | `src/research/lifeOrganization.ts`, `lifeRun.ts` | `lifeorg.*` |
| black swans / event sets | `src/research/blackSwans.ts`, `eventProbability.ts` | — |
| design search | `src/research/design/*` | candidates scored by `ladder` objectives |

### 6.9 npm scripts (`apps/simulation`)

`research`, `research:events`, `research:atlas`, `research:radar`,
`research:ladder`, `research:bench`, `research:known`, `research:rigor`,
`research:scope`, `research:ai`, `research:experiment`, `research:highn`,
`research:life`, `enrich`, plus `test[:fast|:slow|:record]` and `typecheck`.

---

## 7. Tooling — server, web, scripts, infra

### 7.1 Server (`apps/server/src/`)

| area | files | role |
|---|---|---|
| REST API | `api/index.ts`, `api/data.ts` | worlds CRUD, events, control/play/pause/step, rate, interventions, snapshots, forecast |
| WebSocket gateway | `gateway/index.ts`, `wsAdapter.ts`, `uwsAdapter.ts`, `types.ts` | binary frames: world/snapshot/stats/delta/events/setmap/ack |
| Engine host | `engine/wasmEngine.ts`, `engine/index.ts` | WASM engine per world |
| Storage | `store/{interface,memoryStore,postgresStore}.ts`, `db/*` | memory + Postgres (drizzle), snapshots/events/agents |
| Grounding | `data/groundingService.ts` | serves the offline enrichment priors |

### 7.2 Web (`apps/web/src/`)

| area | files | role |
|---|---|---|
| Shell | `App.tsx`, `main.tsx`, `store/useStore.ts` | app + state |
| Panels | `components/*.tsx` | inspector, atlas, radar, event timeline/scheduler, genome browser, layers, lineage, species, stats, spawn designer, model, observables, topbar |
| Net | `net/*` | worker/remote sources, frame decode, session, event feed, sinks |
| Render | `render/*` | canvas2d renderer, evolved terrain, minimap, picking, effects, frame budget |
| Sim | `sim/*` | engine worker, wasm adapter + glue |
| Lib | `lib/*` | shared emergence atlas/radar coord math (same as CLI), presets, ripple |

### 7.3 Scripts, probes, infra, data

| path | role |
|---|---|
| `scripts/run-tests.mjs` | tiered test runner (`--fast/--full/--slow/--record/--list/--jobs`) driven by `test/tiers.json` |
| `scripts/browser-check.ts`, `ws-smoke.ts` | browser/WebSocket smoke checks |
| `probe/*.ts` | TS↔Rust parity/bisect/trace/replay instruments |
| `infra/Dockerfile.{server,web}`, `docker-compose.yml`, `nginx.conf` | containerized deploy |
| `data/enrichment.json` | offline PubChem/GBIF/Kazusa priors (deterministic grounding) |
| `src/research/enrich.ts` | the fetcher that rebuilds `enrichment.json` |

---

## 8. See also

- `manual/` — the deep technical manual (start at `manual/README.md`): full tick
  algorithm + subsystem algorithms, mathematical foundations & derivations,
  Phase A–M model evolution, evaluations & debug log.
- `SYSTEM_MAP.md` — the one-screen index (sections S1–S7).
- `UNIFIED_RECORD.md` — instruments with stable ids, hierarchies, processes,
  cross-reference matrix, records index, provenance/integrity.
- `README.md` — per-module prose (ladder, complexity, emergence, benchmarks,
  rigor, AI, scope, statistics conventions, validated findings).
- `REGIME_CATALOG.md`, `SCALING_CATALOG.md`, `TEST_MATRIX.md`, `SCOPE.md`.
- `output/` — the generated report bank, incl. `plots/`.

*Living atlas: when a runtime, mechanism, detector, agent, experiment, or tool is
added or moved, update its row here and the section it points to in `SYSTEM_MAP.md`.*
