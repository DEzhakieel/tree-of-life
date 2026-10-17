# Tree of Life — Technical Manual

*(Tree of Life — formerly "Fractal Life v2".)*

This folder is the **deep technical manual** of the project. Where
[`../SYSTEM_ATLAS.md`](../SYSTEM_ATLAS.md) is the *map* (what exists, where it
lives, how it is wired), this manual is the *specification*: the exact
algorithms, the mathematical formulation and derivation of every mechanism and
metric, the phase-by-phase model evolution, the evaluation results, and the
debug history.

Read in order, or jump directly:

| # | Document | Covers |
|---|---|---|
| 00 | [README.md](README.md) | This index + notation + reading guide. |
| 01 | [01-engine-and-algorithms.md](01-engine-and-algorithms.md) | The whole engine: runtimes, data model, the full ordered tick algorithm, and every subsystem mechanism + algorithm (physics, chemistry, cell biology, DNA, cells, genome, brain, replicator, tensors, Lyapunov, terrain, ecosystem, selection, RNG, spatial hash, stochastic world, CA, vector field). |
| 02 | [02-processes.md](02-processes.md) | Every *process*: the simulation's stochastic/biological processes and the research processes (ladder, archetypes, complexity lab, radar, life-organization, causal, perturbation, high-N, benchmarks, rigor, AI loop, scope, Bayes). |
| 03 | [03-mathematical-foundations.md](03-mathematical-foundations.md) | Mathematical formulation **and derivation** of the mechanisms and the estimators/metrics, with justifications. |
| 04 | [04-model-evolution.md](04-model-evolution.md) | Model evolution: the Phase A–M layer stack, commit history, what each update added, and version/provenance facts. |
| 05 | [05-evaluations-and-debugs.md](05-evaluations-and-debugs.md) | Evaluations (findings, scope ledger), debugs (symptom → root cause → fix → guard), caveats, and the regression tests that protect them. |

Companion catalogs (kept separate for historical reasons):
[`../REGIME_CATALOG.md`](../REGIME_CATALOG.md),
[`../SCALING_CATALOG.md`](../SCALING_CATALOG.md),
[`../TEST_MATRIX.md`](../TEST_MATRIX.md),
[`../UNIFIED_RECORD.md`](../UNIFIED_RECORD.md),
[`../HIGHN_SELECTION_PLAN.md`](../HIGHN_SELECTION_PLAN.md),
[`../ai_agents_inventory.md`](../ai_agents_inventory.md).

---

## Notation

| Symbol | Meaning |
|---|---|
| `U`, `U(0,1)` | one uniform draw on `[0,1)` from the seeded SplitMix64 `Rng`. |
| `N(0,1)`, `z` | standard-normal draw (Box–Muller). |
| `dt`, `ts` | per-tick timestep (usually `1`); `ts` = `WorldParams.timeScale`. |
| `g[i]` | genome locus `i` (a `Float32Array`, values clipped to `[-1,1]`). |
| `u(x) = clamp01((x+1)/2)` | the standard gene→`[0,1]` decoder. |
| `clamp01`, `clamp(x,a,b)` | saturating clip. |
| `H(p)` | Shannon entropy, base 2 unless stated. |
| `‖·‖` | Euclidean norm; `⟨·,·⟩` inner product. |
| `L` | world edge length (`WORLD_SIZE = 2048`). |
| `N`, `K` | population and carrying capacity. |
| `∂`, `∇²` | central-difference gradient / 5-point Laplacian on the torus. |

Files are cited as `name.ts:line` relative to `apps/simulation/src/` unless a
fuller path is given. Shared constants are `packages/shared/src/constants.ts`
(cited `constants.ts:line`) and defaults are `packages/shared/src/types.ts`
(cited `types.ts:line`).

## Guiding invariants

1. **Determinism.** All stochasticity flows through the seeded `Rng`
   (`rng.ts`) keyed by `(worldSeed, streamTag, tick[, agentId])`. No core path
   calls `Math.random`. Same seed ⇒ bit-identical run.
2. **Two-engine parity.** `apps/simulation` (TypeScript reference) and
   `crates/simulation` (Rust authority) implement the *same* update order; the
   WASM build overlays the Rust engine. RNG draw *counts* are deliberately
   matched (e.g. `recombineGenomes` fixes its draw count).
3. **Explicit Euler.** Integrators are forward-Euler with hard clamps at pool
   maxima; no energy-conservation projection except `tickGradientFlux` and the
   ion-pump affordability gate.
4. **Opt-in depth.** The heavy biology/physics layers (cell bio, omics,
   biophysics, combinatorics) sit behind `WorldConfig` flags and, in the TS
   reference, several observables are zeroed on purpose (WASM-only).
