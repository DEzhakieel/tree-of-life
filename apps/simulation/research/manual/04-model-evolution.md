# 04 — Model Evolution

*Tree of Life — technical manual, part 4.*

How the model grew: the **Phase A–M layer stack** (the feature taxonomy of the
extended chemistry/biology/physics layers), the **commit history**, what each
update added, the **working-tree additions** not yet committed, and
**version/provenance** facts.

---

## 1. Two senses of "phase"

The word *phase* is used in the codebase in two distinct ways; do not confuse
them.

1. **Model layer phases (A–M)** — the incremental depth stacked onto the
   simulation: chemistry observables → active flux coupling → regulatory /
   stochastic / combinatorial layers → folding / discovery → quantum →
   subatomic → condensed matter → statistical mechanics → nanosystems →
   phylogeny → physiology → environments. These are *design scopes*, visible as
   "Phase X" comment headers in `omics.ts`, `engine.ts`, `genome.ts`,
   `physics.ts`, `crates/**`.
2. **Physical phase transitions** — bifurcations/regimes measured by the
   complexity lab, emergence detector, and hysteresis analysis (a
   *scientific* object, not a design scope).

Sections 2–3 cover sense (1); the catalogs cover sense (2).

---

## 2. The Phase A–M layer stack

Each phase adds a self-contained capability, usually behind a `WorldConfig`
flag, and each computes a block of observables appended to `SimStats`
**in a fixed wire order** that must match `crates/shared/src/protocol/binary.rs`.

| Phase | Capability | Where | Flag / notes |
|---|---|---|---|
| **A** | Chemistry / interactomics **observables only** (no feedback) | `chemistry.ts`, `constants.ts:210` | always-on telemetry. |
| **B** | **Active fluxome**: computed reaction fluxes are applied back onto molecule pools | `omics.ts:1566`, `constants.rs:223` | fluxomics feedback. |
| **C** | Regulatory protein folding (transfer-function/TF), **stochastic gene expression** (per-block OU), **combinatorial** oligomer chemistry, **recombination** operators | `omics.ts:66-98`, `genome.ts:323-406`, `constants.rs:231` | flags `omics`, `omicsStochastic`, `combinatorial`, `recombination`. |
| **D** | **Discovery/curiosity** subsystem, **stochastic dynamics** (behaviour noise), **protein-folding mechanics** (chaperone pool + aggregate cascade), **combinatorial selection** (pairwise binding), **cultural channel** (meme copy), **communication gain**, **chemical-terrain environment** | `engine.ts:1797,2410`, `discovery.rs`, `omics.ts` | flags `discovery`, `stochasticDynamics`, `folding`, `combinatorial`; Phase-D observables (13 keys). |
| **E** | **Quantum** observables (decoherence, coherence lifetime, tunnelling, ZPE, superposition/entanglement entropy, …) read from the same fold-cluster pools | `omics.ts:1184`, `engine.ts:2426` | via omics fold-cluster; zeroed in TS. |
| **F** | **Quantum gate**: fidelity/tunnelling/decoherence *perturbs the flux* (couples E back onto B) | `omics.ts:1567` ("Phase E (+F)") | active coupling. |
| **G** | **Subatomic** observables (boson field, photon transport, gluon confinement, strong/weak coupling, Higgs mass floor, quark flavor population, proton stability, …) | `omics.ts:1214`, `engine.ts:2442` | zeroed in TS. |
| **H** | **Quantum materials** / condensed-matter observables | `omics.ts:1245`, `crates/.../omics.rs:1479` | zeroed in TS. |
| **I** | **Statistical mechanics / information theory** (Boltzmann/Shannon entropies, dS production) | `omics.ts:1266` | order preserved vs Rust `omics.rs`. |
| **J** | **Nanosystems**: nanochemistry / nanobiology / nanosystems | `omics.ts:1295`, `omics.rs:1548` | zeroed in TS. |
| **K** | **Reverse-engineered phylogeny**: score each lineage against a real phylogenetic model | `omics.ts:1338`, `omics.rs:1596` | zeroed in TS. |
| **L** | **Reverse-engineered physiology**: score each physiological system | `omics.ts:1388`, `omics.rs:1637` | zeroed in TS. |
| **M** | **Environments**: 17 biome presets × 5 topological spaces × fractal-dimension sweep; the **statistics layer**, **analysis/reporting layer**, and **plotting layer** | `environments.ts`, `physics.ts:59-67`, `analyze.ts`, `statistics.ts`, `charts.ts`, `dimensional_worlds.ts`, `cosmos.ts` | flags `environment`, `topology`; `statistics.ts:4` "Phase M measurement layer". |

**Why this matters for interpretation.** Phases E, G, H, I, J, K, L are
*readings of the same underlying fold-cluster/quantum/chemistry pools*, layered
on top of D. They do not add independent dynamics; they re-express the same
state at different scales. That is why the TS reference writes them as zeros
(`engine.ts:1626-1630`, `:2379-2383`) and why the life-organization detector
must mark them `DORMANT`, not `ABSENT` (`lifeOrganization.ts:11`).

**Wire-order discipline.** The Phase-D 13-key block and the E/G/H/I/J/K/L
blocks are appended in a strict order shared by:
`packages/shared/src/types.ts` (type), `.../protocol/binary.ts` (encode/decode),
`.../worldConfig.ts` (empty defaults), `engine.ts` (populate), `crates/**`.
The debug history in [05](05-evaluations-and-debugs.md) (§D3) is largely about
keeping this order intact.

---

## 3. Commit history (newest → oldest)

Only **13 commits** exist; the bulk of the model lives in the initial commit.
The research catalogs and the manual in this folder are **uncommitted**
working-tree additions.

| Hash | Message | Notable additions |
|---|---|---|
| `e1b6ef7` | Add reproducible experiment runner; fix L1-L3 level-name objective bug | `experiment.ts` runner (`runDigest`/`reproduceExperiment`); `worldFingerprint` in the digest; objectives prefix-match fix (`startsWith`). |
| `079f6ee` | Update scope outputs after verification | refreshed `SCOPE.md` / `output/claims.json` to 23/34 supported. |
| `9ad8096` | Add research-grade system mapping | `SYSTEM_MAP.md`. |
| `df141de` | Polish UI layout and keep research-grade controls (build verified) | web client layout + research controls. |
| `f5f3c66` | Add clean README and thesis; remove opencode/plan artifacts | `README.md`, `THESIS.md`. |
| `9ec558f` | Add black swan detection + joint event-set probability | black-swan detector; joint event-set probability. |
| `d0136ff` | Add emergence engineering design module (objectives + candidate search) and CLI | `design/` objectives + candidate search; `RESEARCH_OBJECTIVES`. |
| `e86da4d` | Finish and ship the server API: REST parity endpoints, storage deleteWorld, harden CORS, ship built dist | server REST + storage + CORS + dist. |
| `7571b6c` | Add a fast/full split to the shared test runner: tier manifest, modes, process pool | `scripts/run-tests.mjs`, `test/tiers.json`, modes. |
| `ccef4de` | Add research scope and unified claims ledger, empirical literature targets, parsimony control | `scope.ts`, `bayes.ts`, parsimony control. |
| `711fcfb` | Make the AI layer iterative: closed-loop world controller and multi-round research loop | `ai/controller.ts`, `worldAI.ts`, `researchAgent.ts`. |
| `1385663` | Add LLM/AI-agent research layer: cached open-source model calls (Ollama + deterministic mock), clamped world-mind directives, phase-locus analyst, harness-scored research agent | `ai/` layer, cache modes, `phaseAnalyst.ts`. |
| `91baef8` | Initial commit: fractal-life simulation (Rust/WASM + TS) with benchmark and research-rigor layers | the entire engine (TS + Rust/WASM), benchmarks A–J, rigor layer, the ladder/archetypes/complexity/emergence/causal/perturbation/research harnesses. |

**Reading the history.** The order is: engine + rigor (initial) → AI layer →
AI iterative → scope/Bayes → test-runner split → server API → design module →
black swans → docs → UI → system map → scope refresh → experiment runner. This
is a *research-tooling* evolution wrapped around a large initial engine, not a
long incremental model build.

## 4. Working-tree additions (uncommitted)

Added after `e1b6ef7`, present on disk but not yet committed:

- **Docs:** `research/SYSTEM_ATLAS.md`, `UNIFIED_RECORD.md`, `REGIME_CATALOG.md`,
  `SCALING_CATALOG.md`, `TEST_MATRIX.md`, `HIGHN_SELECTION_PLAN.md`,
  `ai_agents_inventory.md`, and this `manual/` folder.
- **Code:** `packages/shared/src/lifeOrganization.ts`,
  `src/research/{lifeOrganization,lifeRun,highN,allocCompute}.ts`;
  `packages/shared/src/index.ts` export update.
- **Tests (13 new):** `ablation`, `conservation`, `criticality`,
  `dimensionality`, `disaster`, `hierarchy`, `life-organization`,
  `mathematics`, `perturbation`, `phases`, `reciprocity`, `reproducibility`,
  `transitions`.
- **Outputs:** `output/lifeorg.{md,json,csv}`, `plots/lifeorg.svg`,
  `output/highN_selection.json`.
- **Branding:** "Tree of Life" naming applied to `README.md`, `THESIS.md`,
  research docs, and the root `package.json` description (identifiers
  unchanged).
- **Housekeeping:** patch/recovery scripts and logs moved into `logs/`
  (`apply_phase_d.ps1`, `fix_omics.ps1`, `fix_phased.ps1`, `fix_ticks.ps1`,
  `probe_ticks.ps1`, `eventBatch.fixed`, `chk.txt`, `*.log`, `vite_*.txt`).

## 5. Version and provenance facts

| Package | Name | Version |
|---|---|---|
| root | `fractal-life-sandbox` (description now "Tree of Life …") | 1.0.0 |
| `apps/simulation` | `@fractal-life/simulation` | 1.0.0 |
| `apps/server` | `@fractal-life/server` | 1.0.0 |
| `apps/web` | `@fractal-life/web` | 1.0.0 |
| `packages/shared` | `@fractal-life/shared` | 1.0.0 |
| `packages/shaders` | `@fractal-life/shaders` | 1.0.0 |
| WASM crate (`public/wasm`) | `fractal-life-wasm` | 0.1.0 |

- **Scope ledger** claims version `1.0.0`, generated `2026-10-16`.
- **Node:** `>=18.0.0` (running v18.12.1). **Runtime deps:** Ollama 0.35.0 /
  `qwen2.5:3b` default LLM, plus a deterministic `mock` backend. **Rust/WASM**
  built via the workspace crate `fractal-life-wasm` 0.1.0.
- **Test tiers:** `test/tiers.json` (`thresholdSec: 16`); files not listed
  default to **fast**. Full fast tier = **43/43 files** green.

### Naming note
"Tree of Life" is the **project name / branding** applied to docs. Code
identifiers (`@fractal-life/*` npm scopes, `fractal_life_*` crate names,
`fractallife2` repo dir) were deliberately left unchanged so nothing breaks.
