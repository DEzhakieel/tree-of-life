# Research-Grade System Mapping: Fractal Life v2

## 1. Core Engine Systems
| System | Location | Purpose | State |
|---|---|---|---|
| Deterministic TS Engine | apps/simulation/src/engine.ts | Primary simulation loop, agents, terrain, chemistry, culture, cognition. | Stable |
| Rust Engine | crates/simulation/src/engine.rs | High-fidelity parity engine; 1:1 behavior with TS. | Stable |
| WASM Runtime | crates/wasm/ | Browser/server parity via wasm-bindgen; exposes tick/stats/snapshot. | Stable |
| Brain/Plasticity | apps/simulation/src/brain.ts, crates/simulation/src/brain.rs | Hebbian/backprop, policy/POMDP, belief updates, plasticity stats. | Stable |
| Stochastic World | world_stoch.ts/rs | Weather/OU fields, Poisson bursts, deterministic seeded streams. | Stable |

## 2. Physics, Biochem, Omics (Opt-in)
| System | Location | Purpose | State |
|---|---|---|---|
| Universe/Physics Frame | universe.ts/rs, physics.ts/rs | Real climb cost, escape velocity, drag, seasons; Conservation/Symmetry laws. | Stable |
| Cell Biochemistry | cellbio.ts/rs | Protein folding/chaperones, membrane transport, gradients, MM kinetics; foldEffect gates aerobic ATP. | Stable |
| Omics (telemetry) | omics.ts/rs | Transcriptomics/proteomics/fluxomics observables; 8 omics stats. | Stable |
| Grounding | data/enrichment.json + groundingService | Offline scientific priors (PubChem/GBIF/Kazusa); deterministic grounding. | Stable |

## 3. Research & Validation
| System | Location | Purpose | State |
|---|---|---|---|
| Ladder (L1–L3) | research/ladder.ts (+ ladderCli) | Emergence ladder: life/interaction/cognition + controlled scenarios. | Stable |
| Benchmarks A–J | research/benchmarks/*, knownSystems/* | Replicated canonical systems + literature targets; AIC/BIC parsimony. | Stable |
| Scope/Claims | research/scope.ts, claims.ts, scopeRun.ts | Unified claims ledger; SCOPE.md (23/34 supported, 2 refuted, 9 inconclusive). | Stable |
| Rigor/Validation | research/rigor/* | Validation vs literature targets (emp-report), significance, novelty. | Stable |
| Design/Search | research/design/* | Objectives, candidates, evaluation, random search (elite). | New/Stable |
| Black Swans | research/blackSwans.ts | Rare high-impact detection + surprise scoring. | New/Stable |
| Event Probability | research/eventProbability.ts | Joint event-set probs (independence + Fréchet bounds). | New/Stable |

## 4. API & Transport
| System | Location | Purpose | State |
|---|---|---|---|
| REST API | apps/server/src/api/* | Worlds CRUD, events/batch, control/play/pause/step, rate, interventions, snapshots (octet-stream + headers). | Stable |
| WebSocket Gateway | apps/server/src/gateway/* | Binary frames (world/snapshot/stats/delta/events/setmap/ack); uWS/ws fallback. | Stable |
| Storage | apps/server/src/store/* | Memory/Postgres; snapshots/events/agents with deleteWorld support. | Stable |

## 5. Client/UI
| System | Location | Purpose | State |
|---|---|---|---|
| Web App | apps/web/src/* | Research-grade UI (simplified layout), local/remote modes, charts, controls. | Stable |
| Worker Engine | apps/web/src/net/workerSource.ts | TS engine in worker for local mode; same parity surface. | Stable |

## 6. Data Flow (canonical)
1. Create world (seed+config) ? Engine (TS or WASM) constructed.
2. Tick loop ? stats/frames/events; interventions recorded in log.
3. Snapshots persisted (binary); replays use log+config ? bit-exact.
4. REST/WS expose state/control; client decodes binary frames.
5. Research CLIs run ladder/compare/scope/ai/blackSwans/design.

## 7. Mapping Integrity Checks
- TS?WASM parity: `apps/simulation/test/parity.test.ts`.
- Scope claims: `test/scope.test.ts` + `research/scopeRun.ts`.
- Rigor: `test/rigor.test.ts`.
- Server API: `apps/server/test/*.test.ts`.
- Fast tier green: 29/37 simulation files pass quickly; full suite deterministic.

*This map is a living artifact: update when adding systems/modules.*
