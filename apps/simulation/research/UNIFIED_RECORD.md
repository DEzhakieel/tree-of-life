# Unified Research Record — Tree of Life

*(Tree of Life — formerly "Fractal Life v2".)*

Single system-of-record for the simulation's **instruments**, the **sections** they
live in, the **hierarchies** they read, the two named **processes**
(reinforcing/balancing loop, reciprocity), and the **experiments / phases /
categories / classification catalog** that the instruments produce.

This file **pegs** every instrument to a stable id, a section, a hierarchy node,
its source module, and the records it emits. It consolidates (by reference, not
duplication) the companion catalogs:

- `research/SYSTEM_MAP.md` — section map (§1…§7)
- `research/SYSTEM_ATLAS.md` — deep atlas: engines/runtimes, tick-pipeline mechanisms, biomimicry map, detectors, agents, experiments, tooling
- `research/manual/` — technical manual: engine + algorithms, processes, mathematical foundations & derivations, model evolution (Phase A–M), evaluations & debugs
- `research/REGIME_CATALOG.md` — regimes, macro/micro/hierarchical, reciprocity, phases/transitions
- `research/SCALING_CATALOG.md` — scaling laws, derivation, dimensional engine, discovery
- `research/TEST_MATRIX.md` — the 12 multi-aspect gates
- `apps/simulation/research/README.md` — per-module documentation
- `research/SCOPE.md` — claims/scope ledger; `research/HIGHN_SELECTION_PLAN.md` — high-N selection
- `research/output/` — the generated records bank (incl. `bench.*`, `rigor.*`)

Legend for the *section* column: **S1** core engine · **S2** physics/biochem/omics ·
**S3** research & validation · **S4** API & transport · **S5** client/UI ·
**S6** data flow · **S7** integrity checks.

---

## 1. Instrument roles (the four actors)

The program separates four instrument roles. Each is a class of code, not a noun
about a person: **detectors** decide *whether* a capability is present,
**observers** produce the raw measured series, **documenters** turn a run into a
persisted record, **LLM/agents** propose and steer but never adjudicate.

### 1.1 Detectors — "is the capability there?" (D-*)

| id | detector | reads | decides | source | section | hierarchy |
|---|---|---|---|---|---|---|
| `D-RADAR` | Emergence radar level detectors | raw observables → primitives → per-level score | `L0…L10` status `EMERGENT/PARTIAL/ABSENT/DORMANT` | `packages/shared/src/emergenceRadar.ts` (`LevelDef` 90, `LEVELS` 105, `computePrimitives` 423) | S3 | H0–H10 |
| `D-RADAR-ABL` | Detector ablation validator | baseline vs faculty-removed peak | detector validated iff peak collapses | `src/research/emergenceRadar.ts` (`ABLATIONS` 87, `validateDetector` 188, `RADAR_MARGIN` 0.25) | S3, S7 | H0–H10, Habl |
| `D-NOVELTY` | Novelty residual | surprisal across all primitives | change that no named detector captures | `packages/shared/src/emergenceRadar.ts` (`noveltyResidual` 596) | S3 | H1 |
| `D-ORG` | Life-organization detector | `SimStats` observables → per-level score | `O0…O9` status `EMERGENT/PARTIAL/ABSENT/DORMANT` | `packages/shared/src/lifeOrganization.ts` (`LIFE_LEVELS`, `lifeSeries`, `summarizeLife`) | S3 | Horg |
| `D-MACRO` | Macro-state detector (population level) | per-tick aggregates + coarse occupancy | `random→clustered→organized→specialized→collapsed` | `src/research/emergence.ts` (`MACRO_REGIMES` 451, `classifyMacroRegime` 601, `detectMacroStates` 640) | S3, S6 | Hmacro |
| `D-LADDER` | Emergence ladder verdicts | trajectory summary | `L0/L1/L2/L3` verdict + score (1/0.5/0) | `src/research/ladder.ts` (level verdicts) + `design/objectives.ts` (prefix match) | S3 | H1–H3 |
| `D-PHASE` | Phase-transition detector | sampled order parameters | sharpest adjacent-change locales (`locus`, `sharp`) | `src/research/aiRun.ts` (`findLoci` 233) + `ai/phaseAnalyst.ts` | S3 | Hphase |
| `D-CRITICAL` | Criticality detectors | macro series | `fitLogLog` exponent, `halfMaxWidth`, `attractorModes`, `hysteresisLoop` | `src/research/complexity.ts` | S3 | Hcrit |
| `D-CHANNEL` | Channel-exercise verdict | live mechanism counters | `exercised/partial/closed` | `src/research/perturb.ts` | S3 | Hproc |
| `D-CLAIM` | Claim adjudicator | every module's evidence | `supported/refuted/inconclusive` | `src/research/claims.ts` | S3, S7 | Hclaim |
| `D-RIGOR` | Rigor checks | model analytic/empirical refs | `PASS/WARN/FAIL` | `src/research/benchmarks/rigor/*` | S3 | Hrigor a–d |
| `D-GATE` | Test gates | pure estimators + runs | pass/fail per assertion | `test/*.test.ts` (see `TEST_MATRIX.md`) | S7 | Hall |

Detector discipline (from `D-RADAR`): levels are **pure conjunctions of measured
primitives**, never flags an engine sets about itself; run-relative min-max
stretching plus a dead-sensor floor; hysteresis on onset/offset. A substrate that
cannot carry a primitive reads `DORMANT`, not `ABSENT`. `D-ORG` is the biological
twin of `D-RADAR`: same discipline over the `SimStats` observables, with an added
**coverage floor** (a level needs ≥ 25 % of its channels wired before it is
assayed), so an unwired rung reads `DORMANT` with the coverage reported alongside.

### 1.2 Observers — "what is being measured" (O-*)

| id | observer | output type | source | section | feeds |
|---|---|---|---|---|---|
| `O-STATS` | Engine stats | `SimStats` (per tick) | `src/engine.ts` `stats()` | S1, S6 | all detectors |
| `O-TRAJ` | Ladder trajectory | `TrajectoryPoint` (sampled) | `src/research/ladder.ts` 65-113 | S3 | `D-MACRO`, `D-LADDER` |
| `O-RADARRAW` | Radar raw observables | `RadarRaw → RadarSample → RadarPoint` | `packages/shared/src/emergenceRadar.ts` (`RadarRaw` 240, `RadarSample` 248, `RadarPoint` 254) | S3 | `D-RADAR`, `D-NOVELTY` |
| `O-LIFE` | Life stats stream | `LifeRaw` (`SimStats` samples) → `LifePoint` | `packages/shared/src/lifeOrganization.ts` (`LifeRaw`, `lifeSeries`) | S3 | `D-ORG` |
| `O-WORLD` | World sample (AI) | `WorldSample` | `src/research/ai/world.ts` 6-16 | S3 | `A-WORLD`, `D-PHASE` |
| `O-CONTROL` | Control window | `ControlWindow` | `src/research/ai/controller.ts` 13-24 | S3 | `A-WORLD` |
| `O-FEEDBACK` | Feedback series | `rhoBirthAliveLag1`, `overdispersion` | `src/research/complexity.ts` (`feedbackReport`) | S3 | `D-CRITICAL`, `P-LOOP` |
| `O-OMICS` | Omics telemetry | transcript/proteome/flux observables | `src/omics.ts` | S2 | `D-MACRO`, benchmarks |
| `O-BIO` | Bio-chem observables | ATP/enzyme/toxin/pH paths | `src/engine.ts`, `src/chemistry.ts`, `src/cells.ts` | S2 | `O-STATS` |
| `O-SNAPSHOT` | Bit-exact state | `fullStateHash`, world/outcome fingerprints | `src/research/snapshot.ts` | S3, S7 | `D-GATE`, `D-CLAIM` |
| `O-EVENT` | Event log | typed events + probabilities | `src/research/eventLog.ts`, `eventProbability.ts`, `blackSwans.ts` | S3 | `D-CLAIM` |

### 1.3 Documenters — "what gets written down" (R-*)

Each documenter is a CLI or function that turns a run into a persisted record
(`.md`/`.json`/`.csv` under `research/output/`). This is the **records** half of
the file; the full mapping is in §9.

| id | documenter | command / entry | output records | section |
|---|---|---|---|---|
| `R-CANON` | canonical harness | `src/research/cli.ts` | `README.md`, `report.json`, per-scenario `*.md/json/csv` | S3, S6 |
| `R-RADAR` | radar report | `src/research/radarRun.ts` (renders `emergenceRadar.ts` `renderRadarReport`) | `radar.md/json/csv` | S3 |
| `R-LIFE` | life-organization report | `src/research/lifeRun.ts` (renders `lifeOrganization.ts` `renderLifeReport`) | `lifeorg.md/json/csv`, `plots/lifeorg.svg` | S3 |
| `R-ATLAS` | emergence atlas | `src/research/atlasRun.ts` (`emergenceAtlas.ts` `renderAtlasReport`) | `atlas.md/json` | S3 |
| `R-EMERGE` | emergence measurement | `src/research/emergence.ts` | `emergence.md/json/csv` | S3 |
| `R-COMPLEX` | complexity lab | `src/research/complexity.ts` | `complexity.md/json/csv`, `plots/complexity.svg` | S3 |
| `R-ARCH` | archetypes ladder | `src/research/archetypes.ts` (`renderArchetypesReport`, `writeArchetypesReport`) | `archetypes.*`, `plots/archetypes.svg` | S3 |
| `R-MODES` | scientific modes | `src/research/modes.ts` | `modes.md/json/csv`, `plots/modes.svg` | S3 |
| `R-ENV` | Phase M environments | `src/research/environments.ts` | `environments.*`, `topologies.*`, `dimensions.*` | S3 |
| `R-LATTICE` | dimensional worlds | `src/research/dimensional_worlds.ts` | `lattice.md/json/csv` | S3 |
| `R-COSMOS` | world-definition axes | `src/research/cosmos.ts` | `cosmos.*` | S3 |
| `R-BAYES` | Bayesian ledger | `src/research/bayes.ts` | `bayes.md`, `hypotheses.json`, `plots/posterior.svg` | S3 |
| `R-PERTURB` | perturbation engine | `src/research/perturb.ts` (`perturbRun.ts` CLI) | `perturbation.*`, `plots/perturbation.svg` | S3 |
| `R-CAUSAL` | causal decomposition | `src/research/causal.ts` (`causalRun.ts`), `eventCausal.ts` (`eventRun.ts`) | `causal.*`, `events.*` | S3 |
| `R-BENCH` | A–J benchmark | `src/research/benchmarks/benchRun.ts` | `bench.*`, `plots/bench.svg` | S3 |
| `R-KNOWN` | known-systems registry | `src/research/benchmarks/knownRun.ts` | `known.md/json` | S3 |
| `R-RIGOR` | rigor layer | `src/research/benchmarks/rigor/rigorRun.ts` | `rigor.*`, `rigor-hypotheses.*` | S3 |
| `R-SCOPE` | scope + claims | `src/research/scopeRun.ts` | `SCOPE.md`, `claims.json` | S3, S7 |
| `R-EXP` | experiment runner | `src/research/experimentCli.ts` | experiment manifests (run/verify) | S3 |
| `R-LADDER` | ladder CLI | `src/research/ladderCli.ts` | `ladder-report.md` | S3 |
| `R-AI` | LLM/agent CLI | `src/research/aiRun.ts` | `ai-world.*`, `ai-phase.*`, `ai-loop.*`, `ai-loop-ledger.json`, `ai-cache/` | S3 |
| `R-HIGHN` | high-N selection | `src/research/highN.ts` | `highN_selection.json` | S3 |
| `R-ALLOC` | phase-budget allocation | `src/research/allocCompute.ts` | `allocCompute.json` | S3 |
| `R-ANALYZE` | replicate analysis | `src/research/analyze.ts` | `analysis.md/json`, `replicates.*`, `plots/` | S3 |

### 1.4 LLM / agents — "propose and steer, never adjudicate" (A-*)

Provider abstraction `src/research/ai/client.ts`; deterministic cache
`ai/cache.ts` + `ai/hash.ts` (`ai-cache/`); offline `mock`; Ollama `qwen2.5:3b`.

| id | agent role | may | may **not** | source | section |
|---|---|---|---|---|---|
| `A-WORLD` | world mind (controller) | issue clamped population-level `WorldParams` overrides + one line per species | touch the per-agent core; write construction-only knobs | `ai/worldAI.ts`, `ai/controller.ts`, `ai/knobs.ts` | S3 |
| `A-PHASE` | phase analyst | interpret measured loci, recommend refinements | compute the loci (code does) | `ai/phaseAnalyst.ts` | S3 |
| `A-RESEARCH` | research agent | propose falsifiable experiments, refine rounds | issue a verdict (harness does) | `ai/researchAgent.ts` | S3 |

Closed loop: `A-WORLD` runs one engine over warmup → (observe → direct → actuate
→ measure) windows against an unsteered control. `A-RESEARCH` runs
propose → evaluate → feed-back rounds with a deduplicated ledger; `harnessScored`
vs `harnessRuns` separates code-adjudicated from code-executed verdicts. Cache
modes: `on` (default), `refresh` (`--live`), `off` (`--no-cache`), `replay`.

---

## 2. Sections (S1–S7) — where every instrument lives

| section | name | instrument ids pegged here |
|---|---|---|
| **S1** | Core engine systems | `O-STATS`, `O-BIO`, engine determinism (`O-SNAPSHOT`) |
| **S2** | Physics / biochem / omics (opt-in) | `O-OMICS`, `O-BIO`, universe/physics observables |
| **S3** | Research & validation | all `D-*`, all `R-*`, all `A-*`, `O-TRAJ`, `O-RADARRAW`, `O-WORLD`, `O-CONTROL`, `O-FEEDBACK` |
| **S4** | API & transport | server control endpoints feeding `O-STATS` (interventions) |
| **S5** | Client / UI | worker engine (same parity surface as S1) |
| **S6** | Data flow (canonical) | `O-STATS`, `D-MACRO`, `R-CANON` (tick → stats → records) |
| **S7** | Mapping-integrity checks | `D-GATE`, `D-RADAR-ABL`, `D-CLAIM`, `O-SNAPSHOT`, `R-SCOPE` |

Flow (S6): world spec → engine (S1) → tick loop → `O-STATS`/events → **observers**
→ **detectors** decide → **documenters** persist → **LLM/agents** read records to
propose/steer (never to decide).

---

## 3. Hierarchy pegs

The same instruments are also pegged to five hierarchies, each with its own
nodes and detector.

### 3.1 Capability radar `H0–H10` (detector `D-RADAR`)

Primitives (`packages/shared/src/emergenceRadar.ts`, primitive union 41, catalogue 74):
`matterFlux,
homeostasis, feedback, memoryUpdate, heredity, selection, copyFidelity,
infoTransfer, culture, integration, novelty, richness`.

| node | level | primitives | deps | ablation key |
|---|---|---|---|---|
| `H0` | Particle | matterFlux | — | `world` |
| `H1` | Agent | matterFlux, homeostasis | H0 | `spawn` |
| `H2` | Adaptive agent | homeostasis, feedback | H1 | `reflex` |
| `H3` | Learning agent | feedback, memoryUpdate | H2 | `brain` |
| `H4` | Ecosystem | homeostasis, richness, selection | H1 | `monoculture` |
| `H5` | Evolution | heredity, selection | H4 | `clonal` |
| `H6` | Self-replication | heredity, copyFidelity | H5 | `no-birth` |
| `H7` | Communication | infoTransfer | H2 | `signal-zero` |
| `H8` | Culture | culture, infoTransfer | H7 | `meme-zero` |
| `H9` | Collective intelligence | integration, feedback | H7 | `group-scaling` |
| `H10` | Artificial ecosystem | matterFlux, richness, novelty | H4, H6 | `open-ended` |

Status thresholds: `EMERGENT ≥ 0.6` with hysteresis. Peg: `D-RADAR` per node,
`D-RADAR-ABL` validation, `D-NOVELTY` escape hatch, records `R-RADAR`, observer
`O-RADARRAW`.

### 3.2 Emergence ladder `H1–H3` (detector `D-LADDER`)

| node | level | EMERGENT rule |
|---|---|---|
| `H1` | life | `totalBirths>0 ∧ minAlive>0 ∧ cycling` |
| `H2` | interaction | `maxSpecies≥2 ∧ (predFrac>0.01 ∨ coop>1e-6 ∨ altruism>1e-6)` |
| `H3` | cognition | `(foragingMean>0.005 ∨ hazardCorr<−0.03 ∨ headingEntropyMean>0.3) ∧ (signalTotalMean>1e-6 ∨ cultureCountMax>1 ∨ memeEntropyMax>0) ∧ adaptationDelta>0` |

Verdict scores `EMERGENT=1 / PARTIAL=0.5 / ABSENT=0`; prefix-matched by level
name (`design/objectives.ts`). Peg: `O-TRAJ` → `D-LADDER` → `R-LADDER`.

### 3.3 Macro regime ladder `Hmacro` (detector `D-MACRO`)

Nodes: `random < clustered < organized < specialized`, plus terminal
`collapsed`. Spatial thresholds `0.30 / 0.42 / 0.55`, rigidity `0.60`,
collapse `< 0.6·refAlive` (window `0.1`, q `0.75`) — all
`emergence.ts` 454-464, 601-607. Read at the **population** level only; contrasted
with `agentOrder` via `divergence`. Peg: `D-MACRO` → `R-EMERGE`, `R-ATLAS`.

### 3.4 Rigor hierarchy `a–d` (detector `D-RIGOR`)

| node | domain | benchmark evidence |
|---|---|---|
| `Ha` | fundamental dynamics | A, C, D, E, F |
| `Hb` | multi-agent world | B, H, I |
| `Hc` | emergence analysis | J |
| `Hd` | macro phenomena | G |

Reporting axis, not a code partition; modules (`verification, validation,
reproducibility, sensitivity, ablation, significance, novelty`) cross-cut all
levels. Peg: `D-RIGOR` → `R-RIGOR`, `D-CLAIM` → `R-SCOPE`.

### 3.5 Life-organization ladder `Horg` (detector `D-ORG`)

The biological twin of `H0–H10`: ordered **simple → complex** rungs, each a level
of organization composed of `SimStats` observables. Source
`packages/shared/src/lifeOrganization.ts` (`LIFE_LEVELS`).

| node | level | scale | channels (representative) | deps |
|---|---|---|---|---|
| `O0` | Subatomic / quantum | 1e-18–1e-10 m | bosonFieldIntensity, tunnelingRate, superpositionEntropy, protonStability, coherenceLifetime | — |
| `O1` | Atomic / ionic | 1e-10 m | chemicalDiversity, meanPH, terrainOxygen/PH/Toxin | O0 |
| `O2` | Molecular | 1e-9 m | meanGlucose, meanATP, meanEnzyme, meanProtein, reactionEnthalpy | O1 |
| `O3` | Macromolecular (DNA/protein) | 1e-9–1e-7 m | meanDNAIntegrity, expressionEntropy, proteinDiversity, nativeFraction, pathwayFlux | O2 |
| `O4` | Organellar | 1e-8–1e-6 m | meanMembranePot, meanATP, chaperoneLoad, foldFidelity, enginePower | O3 |
| `O5` | Cellular | 1e-5 m | meanDivisionProgress, meanMembranePot, activeSynthesisFraction | O4 |
| `O6` | Tissue / specialization | 1e-3 m | speciesCount, biodiversityIndex, meanTrophicLevel, traitEffectiveDim, symbioticIndex | O5 |
| `O7` | Organ | 1e-2 m | orgIndex, clusterOrder, rotationalOrder, metabolicRate | O6 |
| `O8` | Organ system (loop/feedback) | 1e-1 m | cardiovascularPump, respirationEfficiency, immuneSurveillance, neuralConductance, endocrineSignaling | O7 |
| `O9` | Organism | 1 m | growthReplication, meanFitness, cooperation, meanPlasticity, meanSurprise | O8 |

`O0` + `O3` (omics) + `O7`–`O8` (omics/biophysics) are opt-in substrates: on the
first-order/legacy path they read `DORMANT` (wired off), not `ABSENT`. The CLI's
`full` arm enables `cellBio + biophysics + omics` so all ten rungs are assayed.
Status thresholds `EMERGENT ≥ 0.6` (hysteresis, off `< 0.4`), coverage floor
`0.25`. Peg: `O-LIFE` → `D-ORG` → `R-LIFE`.

---

## 4. Processes

### 4.1 Reinforcing / balancing loop `P-LOOP`

A **feedback loop** is whether births reinforce population or damp it.

- **Observer** `O-FEEDBACK`: `feedbackReport(aliveSeries, birthsSeries)` →
  `rhoBirthAliveLag1 = corr(alive[:-1], births[1:])` and
  `overdispersion = var(births)/mean(births)` (`complexity.ts` `feedbackReport` 503).
- **Sign is the classification**: `rho > 0` → **reinforcing** (positive) loop —
  more individuals produce more births; `rho < 0` → **balancing** (negative) loop
  — crowding suppresses births. `overdispersion > 1` marks bursty, punctuated
  recruitment.
- **Detectors** `D-CRITICAL`: `attractorModes` (bistability/bifurcation),
  `hysteresisLoop(up, down)` (path dependence = loop area + path index; a
  first-order transition signature), `fitLogLog` (scaling).
- **Gates** `D-GATE`: `test/criticality.test.ts` (exact exponents, half-max
  width, mode counting, hysteresis area 2, corr limits), `test/transitions.test.ts`
  (regime boundaries and monotone rank).
- **Peg**: section S3; nodes `Hcrit`, `Hmacro`; records `R-COMPLEX`
  (`complexity.md`, feedback-loops panel + hysteresis), `R-EMERGE`.

### 4.2 Reciprocity process `P-RECIP`

The donation ledger — the only channel from one agent's energy to another's.

- **Gate** (`engine.ts` 1269-1293): donor `energy > cap·coopThreshold` and
  `out[5] > 0.3`; nearest neighbour with `energy ≤ cap·0.3` and
  `|meme_a − meme_nb| ≤ MEME_TOLERANCE`; `gift = min(surplus to cap·0.5,
  DONATION_RATE·size·ts·cap·coopScale) > 0`.
- **Parameters**: `ALTRUISM_THRESHOLD=0.75`, `DONATION_RATE=0.02`,
  `MEME_TOLERANCE=0.05`, `coopThreshold = 0.75 − (coop−0.5)·0.2`,
  `coopScale = 0.4 + coop·0.6`; culture `MEME_COPY_RATE=0.02·memeCopyRate`.
- **Ledger invariant**: `totalDonated`/`totalReceived` increment by the full gift,
  so **`ΣtotalDonated == ΣtotalReceived`** over all agents (exact identity).
- **Detectors**: `D-CLAIM` (reciprocity claim), `D-CHANNEL` (`no-cooperation`
  channel verdict — `exercised/partial/closed`, so a zero delta is never mistaken
  for an inert pathway), `D-LADDER` interaction level via `maxMeanAltruism`.
- **Gates** `D-GATE`: `test/reciprocity.test.ts` (identity each tick, monotone
  counters, donor+recipient recorded, cooperation raises donations), plus
  `test/ablation.test.ts` (`memeCopyRate:0` ⇒ culture collapsed).
- **Peg**: section S1/S3; node `Hproc`, `H2`; records `R-PERTURB`, `R-EMERGE`.

---

## 5. Experiments

Documented, bit-reproducible experiment pipeline:

- **Runner** `src/research/experiment.ts`: `Experiment` (immutable doc) →
  `runExperiment` (123) → `ExperimentManifest`; `runDigest` (61) is the sha256
  over world fingerprint + trajectory + summary + synthesis; `reproduceExperiment`
  (178) verifies bit-exactness; `ladderOptsFor` (110) applies documented defaults
  (`ticks 12000, spawnCount 60, maxPopulation 400, sampleEvery 400`) <
  `experiment.ladder` < seed.
- **Objectives**: `design/objectives.ts` (`objectives`: `l1-emergent`, `l2-emergent`,
  `l3-emergent`, `adaptation`, `life-steady`, `speciation`, `hazard-avoidance`,
  `signal-use`, `culture-mi`); `meetsThresholds`, `scoreMulti` (experiment.ts adds `resolveObjectives`).
- **Registry** `src/research/experimentRegistry.ts` (`defaultExperiments`):
  `l3-baseline`, `abundance-lift`.
- **CLI** `src/research/experimentCli.ts` (`R-EXP`) → run/verify manifests.
- **Search** `design/search.ts` + `design/candidate.ts` + `design/evaluate.ts`
  (elite random search over objectives).
- **High-N selection** `src/research/highN.ts` (`R-HIGHN`): 10^n agent sweep with
  G0–G8 selection → `highN_selection.json`.
- **Peg**: section S3; experiments feed `D-LADDER`, `A-RESEARCH`, `D-CLAIM`.

---

## 6. Phases

| phase family | states | source | detector / record |
|---|---|---|---|
| Biome | `control` (`calm`) · `extreme` (8 presets) · `underrated` (10) | `environments.ts` `biomeClass`, `EXTREME_PRESETS` | `R-ENV` |
| Weather | `clear · rain · drought · heat` (4-state Markov) | `worldStoch.ts` matrix; moisture `[1,1.25,0.7,0.9]`, growth `[1,1.15,0.8,1.3]` | `O-STATS` → `R-ENV` |
| Scientific modes | `determinism → debugging → reproducibility → research` | `modes.ts` `MODE_DEFS` | `D-GATE`, `R-MODES` |
| Macro transitions | `random→clustered→organized→specialized`; `→collapsed` | `emergence.ts` 454-464, 601-607 | `D-MACRO` → `R-EMERGE` |
| Hierarchy transitions | `L0 cycling → L1 life → L2 interaction → L3 cognition` | `ladder.ts` | `D-LADDER` → `R-LADDER` |
| Parameter phases | critical loci per order parameter | `aiRun.ts` `findLoci`, `complexity.ts` | `D-PHASE`, `D-CRITICAL` |
| AI-analyzed phases | LLM interpretation of measured loci | `ai/phaseAnalyst.ts` | `A-PHASE` → `ai-phase.*` |

---

## 7. Categories & catalog of classifications

Category sets (each maps to a detector verdict and a record):

| category | values | owner |
|---|---|---|
| Ladder verdict | `EMERGENT / PARTIAL / ABSENT` | `D-LADDER` |
| Radar status | `EMERGENT / PARTIAL / ABSENT / DORMANT` | `D-RADAR` |
| Life-organization level | `O0 / O1 / O2 / O3 / O4 / O5 / O6 / O7 / O8 / O9` (subatomic → organism) | `D-ORG` |
| Life-organization status | `EMERGENT / PARTIAL / ABSENT / DORMANT` (coverage-gated) | `D-ORG` |
| Macro regime | `random / clustered / organized / specialized / collapsed` | `D-MACRO` |
| Claim / proposal verdict | `supported / refuted / inconclusive` | `D-CLAIM`, `A-RESEARCH` |
| Channel verdict | `exercised / partial / closed` | `D-CHANNEL` |
| Rigor verdict | `PASS / WARN / FAIL` | `D-RIGOR` |
| Biome class | `control / underrated / extreme` | `R-ENV` |
| Weather state | `clear / rain / drought / heat` | `R-ENV` |
| Scientific mode | `determinism / debugging / reproducibility / research` | `R-MODES` |
| Perturbation kinds | `baseline / cooperation / noise / communication / cull` | `R-PERTURB` |
| Benchmark families | `A…J` (A random walk, B boids, C game of life, D predator-prey, E diffusion, F reaction-diffusion, G cooperation, H resource competition, I collective navigation, J novel composite) | `R-BENCH` |
| Rigor domains | `a / b / c / d` | `D-RIGOR` |

**Catalog of classifications** = the full regime/identification catalog in
`REGIME_CATALOG.md` (mechanism A–F, catalogs §2.1–2.6, regime vector R, strict
params), extended by `SCALING_CATALOG.md` (laws, dimensional engine, discovery)
and the primitive/level catalogue in `emergenceRadar.ts`. This file is the index
into all of them.

---

## 8. Master cross-reference matrix

| instrument | section | hierarchy node | observer | record |
|---|---|---|---|---|
| `D-RADAR` | S3 | `H0–H10` | `O-RADARRAW` | `radar.*` |
| `D-RADAR-ABL` | S3,S7 | `H0–H10` + ablated | `O-SNAPSHOT` | `radar.*` |
| `D-NOVELTY` | S3 | `H1` | `O-RADARRAW` | `radar.*` |
| `D-ORG` | S3 | `Horg` (`O0–O9`) | `O-LIFE` | `lifeorg.*` |
| `D-MACRO` | S3,S6 | `Hmacro` | `O-TRAJ` | `emergence.*`, `atlas.*` |
| `D-LADDER` | S3 | `H1–H3` | `O-TRAJ` | `ladder-report.md` |
| `D-PHASE` | S3 | `Hphase` | `O-WORLD` | `ai-phase.*` |
| `D-CRITICAL` | S3 | `Hcrit` | `O-FEEDBACK` | `complexity.*` |
| `D-CHANNEL` | S3 | `Hproc` | `O-STATS` | `perturbation.*` |
| `D-CLAIM` | S3,S7 | `Hclaim` | `O-SNAPSHOT` | `claims.json`, `SCOPE.md` |
| `D-RIGOR` | S3 | `Ha–Hd` | `O-SNAPSHOT` | `rigor.*` |
| `D-GATE` | S7 | `Hall` | `O-SNAPSHOT` | test output |
| `O-STATS` | S1,S6 | all | — | `report.json` |
| `O-TRAJ` | S3 | `H1–H3`, `Hmacro` | — | `ladder-report.md` |
| `O-FEEDBACK` | S3 | `Hcrit`, `Hmacro` | — | `complexity.*` |
| `A-WORLD` | S3 | `Hproc`, `Hmacro` | `O-WORLD`, `O-CONTROL` | `ai-world.*` |
| `A-PHASE` | S3 | `Hphase` | `O-WORLD` | `ai-phase.*` |
| `A-RESEARCH` | S3 | `Ha–Hd` | `O-STATS` | `ai-loop.*` |
| `P-LOOP` | S3 | `Hcrit` | `O-FEEDBACK` | `complexity.md` |
| `P-RECIP` | S1,S3 | `Hproc`,`H2` | `O-STATS` | `emergence.*`, `perturbation.*` |

---

## 9. Records index (documenter → artifacts)

| records | written by | kind |
|---|---|---|
| `README.md`, `report.json`, per-scenario `*.md/json/csv` | `R-CANON` (`cli.ts`) | canonical harness |
| `radar.md/json/csv` | `R-RADAR` | detector radar |
| `lifeorg.md/json/csv`, `plots/lifeorg.svg` | `R-LIFE` | life-organization ladder |
| `atlas.md/json` | `R-ATLAS` | emergence atlas |
| `emergence.md/json/csv` | `R-EMERGE` | emergence measurement |
| `complexity.md/json/csv`, `plots/complexity.svg` | `R-COMPLEX` | complexity lab + feedback/hysteresis |
| `archetypes.*`, `plots/archetypes.svg` | `R-ARCH` | agent complexity ladder |
| `modes.md/json/csv`, `plots/modes.svg` | `R-MODES` | determinism ladder |
| `environments.*`, `topologies.*`, `dimensions.*` | `R-ENV` | Phase M biomes/topologies |
| `lattice.md/json/csv` | `R-LATTICE` | dimensional worlds |
| `cosmos.*` | `R-COSMOS` | world-definition axes |
| `bayes.md`, `hypotheses.json`, `plots/posterior.svg` | `R-BAYES` | Bayesian ledger |
| `perturbation.*`, `plots/perturbation.svg` | `R-PERTURB` | perturbation engine |
| `causal.*`, `events.*` | `R-CAUSAL` | causal decomposition |
| `bench.*`, `known.*`, `plots/*.svg` | `R-BENCH`, `R-KNOWN` | A–J + known systems |
| `rigor.*`, `rigor-hypotheses.*` | `R-RIGOR` | rigor layer |
| `SCOPE.md`, `claims.json` | `R-SCOPE` | scope + claims |
| experiment manifests | `R-EXP` | experiments |
| `ladder-report.md` | `R-LADDER` | ladder CLI |
| `ai-world.*`, `ai-phase.*`, `ai-loop.*`, `ai-loop-ledger.json`, `ai-cache/` | `R-AI` | LLM/agents |
| `highN_selection.json` | `R-HIGHN` | high-N selection |
| `allocCompute.json` | `R-ALLOC` | phase-budget allocation |
| `analysis.md/json`, `replicates.*`, `plots/` | `R-ANALYZE` | replicate analysis |

---

## 10. Provenance & integrity

- **Scope before evidence**: `scope.ts` fixes questions/claims/falsifiers first;
  `claims.ts` drops any claim id not pre-registered (evidence cannot invent a
  claim); `validateScope` refuses a claim with no falsifier.
- **Determinism**: `O-SNAPSHOT` `fullStateHash`; experiments re-run bit-exactly
  (`reproduceExperiment`); AI cache replays bytes by default.
- **Ablation-first detectors**: `D-RADAR-ABL` accepts a detector only when
  removing its enabling faculty collapses it (same world, same seeds).
- **Gates**: the 12 multi-aspect gates in `TEST_MATRIX.md` (mathematics,
  conservation, hierarchy, reciprocity, ablation, perturbation, reproducibility,
  disaster, phases, transitions, criticality, dimensionality).
- **Fast tier green**: `node scripts/run-tests.mjs --fast` = 43/43 files;
  `tsc --noEmit` clean.

*Living record: when an instrument, section, hierarchy node, category, or record
changes, update the row here and the companion catalog it points to.*
