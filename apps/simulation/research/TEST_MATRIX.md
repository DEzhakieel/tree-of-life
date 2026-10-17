# Test matrix

*Tree of Life — research catalog (formerly "Fractal Life v2").*

This document links the 12 new test files to their scientific gates: every test
asserts a boundary, identity or invariants that, if broken, directly undercuts a
claim in the research ladder.

The tests are **fast tier** (under ~16 s wall), pure where possible, and exercise
the real engine only where a claim requires a live run. Run them:

```powershell
cd apps/simulation
npx tsx --test test/<file>.test.ts
node ..\..\scripts\run-tests.mjs --fast  # all fast-tier (includes these)
```

## Aspects

| Aspect | File | What it gates | Source/API | Status |
|---|---|---|---|---|
| Mathematical consistency | `test/mathematics.test.ts` | exact identities: mean/sd/se/quantile/median monotonicity; `stats.ts` resampling reproducible (mulberry32 replay, bootstrapCI); classical tests at identities (Clopper–Pearson bounds, t-CDF via incomplete beta, lgamma, welch/pairedT, ANOVA F=0/p=1); minimal Bayes factor `sbpBF` (capped 1e6, monotone); complexity-lab math (entropy, corr, central derivative, cross-partial, peak finding, attractor modes, half-max width, hysteresis loop). | `src/research/stats.ts`, `src/research/statistics.ts`, `src/research/bayes.ts`, `src/research/complexity.ts` | PASS |
| Conservation of matter | `test/conservation.test.ts` | carrion decay: `runConservation` reports meatDecayed ≈ injected*0.002 and mineral gain ≈ decay*DECOMP_FRACTION with tiny errors; linear scaling; reproducible; food/meat/minerals/signal non-negative; food ≤ cap; alive agent energy ∈ [0, cap]; `worldFingerprint` pure. | `src/research/scenarios.ts::runConservation`, `src/engine.ts`, `src/research/snapshot.ts::worldFingerprint` | PASS |
| Hierarchy (levels) | `test/hierarchy.test.ts` | `ladder.ts` level ids (e.g. 'L1 life', 'L2 interaction', 'L3 cognition'); objective-prefix matching and verdict ordering (EMERGENT>PENDING/ABSENT-weighted in scoring); `resolveObjectives` throws on unknown ids; registry consistency, monotonicity of thresholds and continuous scaling. | `src/research/ladder.ts`, `src/research/design/objectives.ts`, `src/research/design/index.ts` | PASS |
| Reciprocity | `test/reciprocity.test.ts` | gift ledger identity: ∑`totalDonated` == ∑`totalReceived` over all agents at every tick; counters non-negative and monotone; donor+recipient both recorded when firing; gene dose-response (cooperation 0.5 > 0 at identical placement); telemetry well-formed. | `src/engine.ts` (donation loop 1263-1293; ledger identity), `src/research/scenarios.ts::makeWorld/placeAgentsAt`, `src/research/perturb.ts` | PASS |
| Ablation (faculty switches) | `test/ablation.test.ts` | `reproduction: false` → births 0 and population non-increasing; `sensing: false` → founders hold position; `memeCopyRate: 0` → cultureCount≤1, memeEntropy≈0; `signalDeposit: 0` → grid.signal max≈0; `setBrainConfig({enabled:false})` → brainStats zeros; ablated worlds remain bit-identical across twins. | `src/engine.ts` (cultureOn/reproductionOn/sensingOn; brainStats), `src/research/snapshot.ts::fullStateHash` | PASS |
| Perturbation (causal interventions) | `test/perturbation.test.ts` | `baselineGenome` deterministic, writes correct biases, honours spec; `perturbedGenome` returns copy and edits only its target per kind (baseline no-op, cooperation zeroes gene only, noise sets noise drive, communication turns signal off, cull no genome edit); registry has unique ids with exactly one baseline; outcome keys unique. | `src/research/perturb.ts`, `@fractal-life/shared` | PASS |
| Reproducibility (identity) | `test/reproducibility.test.ts` | `worldFingerprint` stable and key-order independent; seed/params distinguish; identical worlds replay bit-for-bit (fullStateHash); outcomeFingerprint matches; stochastic research mode: same-seed stochastic twins replay identically; stochastic vs deterministic twin diverges. | `src/research/snapshot.ts`, `src/engine.ts`, `src/worldStoch.ts` | PASS |
| Disaster / rare events | `test/disaster.test.ts` | `surpriseScore` monotone in impact and rarity, clamped [0,1], handles edge cases; `blackSwanSuite` has 4 detectors with required fields; `probEventSet` multiplies rates, respects Fréchet bounds (min=0 for multi, max=sum; min=max for single); `jointSurprise` ranks rarer joints higher. | `src/research/blackSwans.ts`, `src/research/eventProbability.ts` | PASS |
| Phases & regimes (classification) | `test/phases.test.ts` | `biomeClass` partitions all ENV_PROFILES into control/extreme/underrated; EXTREME_PRESETS complete with no calm/no dupes; WEATHER_NAMES/arrays form valid 4-state Markov distribution (each row sums to 1, positive factors); `MODE_DEFS` gives 4 ladder modes with stochastic flags (determinism/debugging off, reproducibility/research on) and purpose+gate. | `src/research/environments.ts`, `src/worldStoch.ts`, `src/research/modes.ts` | PASS |
| Transitions (macro-regime) | `test/transitions.test.ts` | `classifyMacroRegime` honours collapsed→collapsed, specialized threshold (spatial≥0.55 and rig≥0.6), boundaries at 0.42/0.30, and monotonicity in spatial; `MACRO_REGIMES` ordered; `macroRigidity` counts top quartile (degenerate cases), `macroStatePersistence` repeatability. | `src/research/emergence.ts` | PASS |
| Criticality (scaling + nonlinear) | `test/criticality.test.ts` | `fitLogLog` recovers exponents and perfect r² for power laws, ignores non-positive, reports n<3; `halfMaxWidth` correct on symmetric peak; `findPeaks` prominence-aware, rejects plateaus; `attractorModes` detects unimodal/bimodal and filters [0,1]; `hysteresisLoop` integrates sweep gaps (path dependence); `corr` limits, `feedbackReport` lag-1 response, `derivativeCentral` analytic slope. | `src/research/complexity.ts` | PASS |
| Dimensionality (lattice geometry) | `test/dimensionality.test.ts` | `flatIndex`↔`cellCoords` bijection (row-major); geometry exact (volume, side, connectivity 2N); `solveLattice` deterministic, doesn't mutate input; registries span 1–4D; topology (torus default, explicit box) honoured; observables in physical ranges. | `src/research/dimensional_worlds.ts` | PASS |

## Notes on constraints

- TS: `tsconfig.base.json` lib ES2022, `apps/simulation` has types node; no DOM `fetch` (use node:http). Typecheck clean.
- Runner: PowerShell (no &&); use the shared runner `scripts/run-tests.mjs` for --fast/full/record. Files default to fast when not in tiers.json; fast tier uses bounded pool (`--jobs 4`).
- Determinism: all engine/world tests use identical-world twins (double-run) and fingerprint/state hash; stochastic mode is seeded-driven (self-reproducing).
- Pure-first: most aspects (mathematics/disaster/phases/transitions/criticality/dimensionality/hierarchy in part) avoid running a full world; engine-only where needed (reciprocity/ablation/reproducibility/conservation).
- Reciprocity identity: the donation counters are updated with full gift amounts on both sides, so `ΣtotalDonated == ΣtotalReceived` is exact by construction (nontrivial only when same-tag needy neighbours exist).
