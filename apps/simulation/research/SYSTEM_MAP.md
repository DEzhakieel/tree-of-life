# Research-Grade System Mapping: Tree of Life

*(Tree of Life — formerly "Fractal Life v2".)*

> **Deep atlas:** `research/SYSTEM_ATLAS.md` is the full inventory behind this
> section map — engines/runtimes, the tick-pipeline mechanisms, the biomimicry
> map (mechanism → real-world biology/physics), detectors, agents, experiments,
> and tooling, each cited to a source file.

## 1. Core Engine Systems
| System | Location | Purpose | State |
|---|---|---|---|
| Deterministic TS Engine | apps/simulation/src/engine.ts | Primary simulation loop, agents, terrain, chemistry, culture, cognition. | Stable |
| Rust Engine | crates/simulation/src/engine.rs | High-fidelity parity engine; 1:1 behavior with TS. | Stable |
| WASM Runtime | crates/wasm/ | Browser/server parity via wasm-bindgen; exposes tick/stats/snapshot. | Stable |
| Brain/Plasticity | engine brain modules (TS/RS) | Hebbian/backprop, policy/POMDP, belief updates, plasticity stats. | Stable |
| Stochastic World | worldStoch modules (TS/RS) | Weather/OU fields, Poisson bursts, deterministic seeded streams. | Stable |

## 2. Physics, Biochem, Omics (Opt-in)
| System | Location | Purpose | State |
|---|---|---|---|
| Universe/Physics Frame | universe/physics modules (TS/RS) | Real climb cost, escape velocity, drag, seasons; conservation/symmetry laws. | Stable |
| Cell Biochemistry | cellbio modules (TS/RS) | Folding/chaperones, membrane transport, gradients, MM kinetics. | Stable |
| Omics (telemetry) | omics modules (TS/RS) | Transcriptomics/proteomics/fluxomics observables. | Stable |
| Grounding | data/enrichment.json + grounding service | Offline scientific priors (PubChem/GBIF/Kazusa); deterministic grounding. | Stable |

## 3. Research & Validation
| System | Location | Purpose | State |
|---|---|---|---|
| Ladder (L1-L3) | research/ladder.ts (+ ladderCli) | Emergence ladder: life/interaction/cognition + controlled scenarios + worldFingerprint. | Stable |
| Benchmarks A-J | research/benchmarks/*, knownSystems/* | Replicated canonical systems + literature targets; AIC/BIC parsimony. | Stable |
| Scope/Claims | research/scope.ts, claims.ts, scopeRun.ts | Unified claims ledger; SCOPE.md. | Stable |
| Rigor/Validation | research/rigor/* | Validation vs literature targets, significance, novelty. | Stable |
| Design/Search | research/design/* | Objectives, candidates, evaluation, random search (elite). | Stable |
| Experiments | research/experiment.ts, experimentRegistry.ts, experimentCli.ts | Documented, bit-reproducible experiment runner + manifests. | New/Stable |
| Black Swans | research/blackSwans.ts | Rare high-impact detection + surprise scoring. | Stable |
| Event Probability | research/eventProbability.ts | Joint event-set probs (independence + Frechet bounds). | Stable |

## 4. API & Transport
| System | Location | Purpose | State |
|---|---|---|---|
| REST API | apps/server/src/api/* | Worlds CRUD, events, control/play/pause/step, rate, interventions, snapshots. | Stable |
| WebSocket Gateway | apps/server/src/gateway/* | Binary frames (world/snapshot/stats/delta/events/setmap/ack). | Stable |
| Storage | apps/server/src/store/* | Memory/Postgres; snapshots/events/agents with deleteWorld support. | Stable |

## 5. Client/UI
| System | Location | Purpose | State |
|---|---|---|---|
| Web App | apps/web/src/* | Research-grade UI, local/remote modes, charts, controls. | Stable |
| Worker Engine | apps/web/src/net/workerSource.ts | TS engine in worker for local mode; same parity surface. | Stable |

## 6. Data Flow (canonical)
1. Create world (seed+config) -> Engine (TS or WASM) constructed.
2. Tick loop -> stats/frames/events; interventions recorded in log.
3. Snapshots persisted (binary); replays use log+config -> bit-exact.
4. REST/WS expose state/control; client decodes binary frames.
5. Research CLIs run ladder/compare/scope/ai/experiment/blackSwans/design.

## 7. Mapping Integrity Checks
- TS <-> WASM parity: `apps/simulation/test/parity.test.ts`.
- Scope claims: `test/scope.test.ts` + `research/scopeRun.ts`.
- Rigor: `test/rigor.test.ts`.
- Multi-aspect gates: `research/TEST_MATRIX.md` (conservation, mathematical consistency, hierarchy, reciprocity, ablation, perturbation, reproducibility, disaster, phases, transitions, criticality, dimensionality). 
- Regime catalog: `research/REGIME_CATALOG.md` (regimes, macro/micro/hierarchical, reciprocity, phases/transitions, regime vector, strict params).
- Scaling/derivation catalog: `research/SCALING_CATALOG.md` (scaling laws, derivation, dimensional engine, estimation/approximation, discovery, experimentation).
- Unified record: `research/UNIFIED_RECORD.md` (pegs every instrument — detectors, observers, documenters, LLM/agents — to these sections, the hierarchies, the reinforcing/balancing loop, reciprocity, experiments, phases, categories, and the classification catalog; master cross-reference matrix + records index).
- System atlas: `research/SYSTEM_ATLAS.md` (deep file-level inventory of engines/runtimes, tick-pipeline mechanisms, the biomimicry map, detectors, agents, experiments, and server/web/scripts/probe/infra tooling).
- Objectives contract: `test/design.test.ts` (ladder level-name regression).
- Reproducibility: `test/experiment.test.ts` (bit-exact digests; cross-seed).
- Server API: `apps/server/test/*.test.ts`.
- Fast tier green; full suite deterministic.

*This map is a living artifact: update when adding systems/modules.*
