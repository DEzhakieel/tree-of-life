# 05 — Evaluations and Debugs

*Tree of Life — technical manual, part 5.*

What the project **measured** (evaluations), what it **found and fixed**
(debugs), the **caveats** it documents, and the **regression tests** that guard
each fix. Every number is quoted from a repo artifact.

---

# Part 1 — Evaluations

## 1.1 Scope ledger — the headline result

Source: `../SCOPE.md:7`, `../output/claims.json:5-10` (scope v1.0.0, generated
2026-10-16).

| metric | value |
|---|---|
| claims tested | **34** |
| supported | **23** |
| refuted | **2** |
| inconclusive | **9** |
| undefined / untested | **0** (`untested: []`, `issues: []`) |

Per research question:

| RQ | topic | total | supported | refuted | inconclusive |
|---|---|---|---|---|---|
| RQ1 | determinism | 2 | 2 | 0 | 0 |
| RQ2 | canonical A-Life benchmarks | 11 | 11 | 0 | 0 |
| RQ3 | literature systems | 15 | 6 | 0 | **9** |
| RQ4 | causality | 1 | 1 | 0 | 0 |
| RQ5 | statistics / novelty | 2 | 1 | **1** | 0 |
| RQ6 | LLM as proposer | 2 | 2 | 0 | 0 |
| RQ7 | LLM as steerer | 1 | 0 | **1** | 0 |

**The two refutations are reported, not hidden:**
- **C-AI-03** — the AI world controller *under-performs* doing nothing: steered
  `aliveCount` 54 vs unsteered control 139 (Δ −85); population 429→236, species
  45→34.
- **C-SIG-01** — 19/20 directional claims survive Holm–Bonferroni FWER 0.05;
  one does not.

**The nine inconclusive** are known systems whose source publishes only a
*qualitative* regime (Boids/FlamEGPU, Pedestrian, Ants, Wolf–Sheep, Spatial PD,
Sugarscape, Turing/Gray–Scott, Vicsek). The ledger refuses to promote a gated
PASS to an empirical claim without a numeric reference.

## 1.2 Determinism (RQ1)

- `C-DET-01`: 3/3 seeded experiment families reproduced bit-for-bit (first-order
  ×2, third-order ×2, stochastic ×2).
- `C-DET-02`: 10/10 A–J models reproduced their fingerprint bit-for-bit across
  two runs.
- Stochastic mode is seeded: same-seed stochastic twins replay identically;
  stochastic-vs-deterministic twin diverges.

## 1.3 Canonical benchmark suite (RQ2)

- **Quick mode, 5 seeds → PASS; all A–J fidelity 1.00; 15214 ms**; deterministic
  each. Every claim `C-BENCH-A…J` supported.
- Exact reproductions include: glider shift `(−/+1)/4 gens`, blinker p2, block
  p1, pulsar p3, Gosper gun p30.

## 1.4 Rigor layer

Source: `../output/rigor.md` (7 modules, full scale, **Overall: PASS**).

- **Verification:** 16/16 analytic checks within declared tolerance. Exact
  zero-error: glider/blinker/block/pulsar/gun periods, E mass-conservation, D
  invariant drift.
- **Validation:** 10/10 linked; 14/26 known systems replicated at 1.00.
- **Reproducibility:** 10/10 double-run fingerprints pass.
- **Sensitivity:** 9/9 models respond to ≥1 knob (Morris μ* + OAT), with some
  WARN where a knob is inert.
- **Ablation:** 13/13 interventions matched predictions (`C-ABL-01`).
- **Significance:** 8/9 families supported.
- **Novelty scorecard:** **0.933**; coverage 10/10, discrimination 0.67 (≥0.6),
  fidelity 1.00, grounding 26/26.

## 1.5 Other evaluation artifacts

- `output/complexity.md`: 624 experiments, 208 s, 24 worlds double-run, **0
  divergences**.
- `output/emergence.md`: determinism PASS across T0–T3 × capacities {60,150,400}
  × 36 worlds.
- `output/conservation.md`: `meat_decayed` 0.1000 = expected 0.1000; mineral
  0.0500; error ≈ 0.
- `output/bayes.md`: H-BANK 0.72 support, H-NUKE-IRRECOVERABLE 0.89 support,
  H-METEOR-SURVIVABLE 0.89 support; H-SUPPLY/H-BOUNTY/H-EARTH-CALIBRATED
  undecided (n=4 caps posterior ≈0.71).
- `output/ai-loop.md`: 3 rounds, supported 4 / refuted 0 / inconclusive 1; 5/5
  verdicts adjudicated by deterministic code (`C-AI-01`).
- `output/causal.md`: field induction converges only above budget —
  `convergenceError` 0.42 @200, 1.27 @400, 2.83 @600 ticks.
- `output/lifeorg.md`: legacy — O0/O3/O7/O8 `DORMANT`, O1/O5/O6 `EMERGENT`;
  full — all 10 levels measured (O7 coverage 0.25).

---

# Part 2 — Debugs (symptom → root cause → fix → guard)

### D1. L1–L3 emergence objectives silently scored zero
- **Symptom:** every emergence objective returned 0.
- **Root cause:** `objectives.ts` matched the bare id `'L1'`, but the engine
  emits `'L1 life'`, `'L2 interaction'`, `'L3 cognition'`.
- **Fix:** prefix match — `objectives.ts` `l.level.startsWith(prefix)` (commit
  `e1b6ef7`).
- **Guard:** `test/design.test.ts:21-33`, `test/hierarchy.test.ts:15-17,66-85`.

### D2. Experiment digest seed collision
- **Symptom:** different seeds produced the same digest.
- **Root cause:** the digest hashed only the degenerate summary, not world state.
- **Fix:** include `LadderResult.worldFingerprint` (full grid + alive agents).
- **Guard:** `test/experiment.test.ts:161-166`.

### D3. Phase-D omics port: missing keys / corrupted edits
Recovered from `logs/apply_phase_d.ps1`, `logs/fix_omics.ps1`,
`logs/fix_phased.ps1`, `logs/probe_ticks.ps1`, `logs/fix_ticks.ps1`. The 13
Phase-D observables had to be threaded through four surfaces in a fixed wire
order matching `binary.rs`:
`src/omics.ts` (factory `agg` buffer + `chaperone`, `aggSum`),
`src/engine.ts` `SimStats` literal, `packages/shared/src/protocol/binary.ts`
(13 encodes + 13 decodes), `packages/shared/src/worldConfig.ts`
`emptySimStats`.
- **Sub-bug A:** a corrupted patch wrote `…: ás,` (stray characters).
- **Sub-bug B:** the patch tool wrote literal backtick-`n` sequences into
  `omics.ts` instead of newlines (`fix_ticks.ps1` rewrites them).
- **Sub-bug C:** `libraryDiversity` was emitted twice; ordering patched so
  `combinatorialEntropy` reads last.
- **Verified final state:** all 13 keys present in `omics.ts:1456-1468`,
  `engine.ts:2413-2425`, `binary.ts:317-329`/`:834-846`,
  `worldConfig.ts:113-125`, typed in `packages/shared/src/types.ts:436-460`.

### D4. Digest / fingerprint hardening (runner)
Commit `e1b6ef7` added `worldFingerprint` to the runner path (guards D2).

### D5. CLI flags silently discarded
- **Symptom:** `--arena` / `--spawn` accepted but ignored.
- **Guard:** `test/causal.test.ts:188,205`.

### D6. `spawn` tool bypassed `maxPopulation`
- **Guard:** `test/engine.test.ts:158`.

### D7. Causal gene encoding — writing `g[1]` set `cIm=1`
- **Root cause:** genes 0/1 encode the agent's Mandelbrot point `c`; touching
  `cIm` sent agents off the orbit and killed the population at tick 1.
- **Guard:** `test/causal.test.ts:110-111`.

### D8. `robustSufficientSparse` reported arms reaching full
- **Guard:** `test/causal.test.ts:212`.

### D9. `windowInput` indexed out of range on short series
- **Guard:** `test/forecast.test.ts:46`.

### D10. Events returned the live buffer, not a snapshot
- **Guard:** `test/events.test.ts:97`.

### D11. Server event-batch test body was broken
- `logs/eventBatch.fixed` is the repaired copy. The committed
  `apps/server/test/eventBatch.test.ts` covers NDJSON batches, plain-JSON
  arrays, invalid-line counting, path-`worldId` override, empty body, and
  browser-local worlds.

### D12. Physics boundary-condition bug (both lanes)
- **Symptom:** every topology behaved as a torus.
- **Root cause:** coordinates were wrapped *before* the topology `case`, so
  reflection/loop branches never fired.
- **Fix:** run the topology case on raw coordinates, then re-normalise; Rust test
  `caps_reflect_latitude_and_loop_wraps` asserts reflect-vs-wrap-vs-flip.

### D13. Lattice RNG overflow
- **Root cause:** the splitmix64 constant overflows JS doubles.
- **Reference:** fixed (bootstrap RNG cites "the lattice RNG fix").

### D14. Conway glider target mis-entered as `1`, model reports `10`
- **Caught by:** the scope ledger's target-vs-declared-signature check — a real
  bug the gates did not catch. `rigor.md` now shows `obs=10.000000 ref=10`.

### D15. Tests never run by `npm test`; CI blind
- **Root cause:** `scripts/run-tests.mjs` note — tests were never executed by
  `npm test`, so CI could not catch the regression.

### D16. TS reference zeros for WASM-only observables (by design)
- Biophysics/discovery/quantum/subatomic/stat-mech observables are written as
  zeros in the TS engine (`engine.ts:1626-1630`, `:2379-2383`). Detectors must
  treat those channels as absent/`DORMANT`, not zero — otherwise a level reads
  `ABSENT` instead of `DORMANT` (`lifeOrganization.ts:11`).

---

# Part 3 — Caveats / known limitations

1. **Determinism is the weakest evidence.** Every arm replays bit-identically,
   yet 13/16 arms were still seed-dependent; a reproducible number is not a
   robust one (`README.md:192-198`).
2. **Bayesian posteriors describe across-world belief, not within-world noise**
   (`output/bayes.md:9`; `bayes.ts:442`).
3. **n=4 caps the posterior ≈0.71**, so H-BANK / H-EARTH-CALIBRATED read
   conservative/undecided (`README.md:249-250`; `cosmos.md:111`).
4. **Causal convergence is budget-dependent** — halving the tick budget inverted
   a conclusion (`README.md:180-182`; `causal.md`).
5. **Alignment cannot bootstrap from rest** — it sums neighbour velocities
   (`README.md:152-155`; `causal.md:44`).
6. **Findings asserted before checked.** Three were false when finally tested:
   separation-necessary (circulation alone flocks 80% of dense seeds), a fixed
   geometric density constant (it is a band), and "halving budget is free"
   (it inverted a result); a fourth survived only because the check was
   pre-registered (`README.md:168-190`).
7. **Scope boundaries** limit claims: real-world biology OUT (SB-06), open-ended
   evolution OUT (SB-07), performance/scaling OUT (SB-08); LLM conditional
   (SB-03/SB-10).
8. **AI controller honestly negative** — steered run was worse than control
   (`README.md:600-620`, `ai-world.md`).
9. **Clopper–Pearson spatial caveat** — lattice intervals are anti-conservative
   as ecological uncertainty (cell-level draw noise only) (`statistics.ts:16-19`).

---

# Part 4 — Regression tests guarding the fixes

| debug | guard test / location |
|---|---|
| D1 L1–L3 objective | `test/design.test.ts:21-33`, `test/hierarchy.test.ts:15-17,66-85` |
| D2 digest collision | `test/experiment.test.ts:161-166` |
| D3 Phase-D keys | presence across `omics.ts`, `engine.ts`, `binary.ts`, `worldConfig.ts`; `tsc --noEmit` gate in `logs/fix_phased.ps1:64-68` |
| D5 CLI `--arena/--spawn` | `test/causal.test.ts:188,205` |
| D6 spawn maxPopulation | `test/engine.test.ts:158` |
| D7 causal gene encoding | `test/causal.test.ts:110-111` |
| D8 robustSufficientSparse | `test/causal.test.ts:212` |
| D9 forecast window input | `test/forecast.test.ts:46` |
| D10 events snapshot | `test/events.test.ts:97` |
| D11 event batch endpoint | `apps/server/test/eventBatch.test.ts` |
| D12 physics boundary | Rust `caps_reflect_latitude_and_loop_wraps` |
| D14 Conway target | `output/rigor.md` verification + scope ledger |
| 12 aspect gates | [`../TEST_MATRIX.md`](../TEST_MATRIX.md) (all PASS); fast tier **43/43** (UNIFIED_RECORD) |

---

## Cross-reference

- The exact algorithms behind these results: [01](01-engine-and-algorithms.md).
- The estimators used to compute them: [03](03-mathematical-foundations.md).
- The phase scopes referenced (D/E/G/…): [04](04-model-evolution.md).
