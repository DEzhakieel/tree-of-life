# Scientific modes — determinism → debugging → reproducibility → research

The simulated world is a **pure function** of its world definition. Every stochastic draw comes from SplitMix64 streams seeded by (world seed, tick, agent id); agents iterate in ascending id order; all physics advance by the fractional `timeScale` timestep. Therefore:

**S(run) = run( seed, timestep, population, parameters ) — and, in research mode, the OPT-IN stochastic world module (itself seed-driven). Identical inputs ⇒ bit-identical trajectories: `S(run1) = S(run2)` at every tick.**

- seed — terrain, habitat, founders, every per-agent/tick draw.
- timestep — `params.timeScale`; floating-point work runs in fixed order.
- population — `spawnCount` plus ascending-id founder order.
- parameters — every world parameter; folded into the world fingerprint.

## The four modes

| mode | stochastic world | purpose | gate |
| --- | --- | --- | --- |
| determinism | off | prove S(run1) = S(run2) across the seed/timestep/population/parameters axes | test/determinism.test.ts |
| debugging | off | replay a seed with a per-tick trace; any bug reproduces on first sight | modes.ts (trace section) |
| reproducibility | off | a run is its (world, params) fixture; rerun any fixture → identical trajectory | modes.ts (fixture table) |
| research | on | stochastic worlds; sample space = seeds; same-seed control; each run still self-reproducible | modes.ts (research table) |

The debugging tier derives from determinism, reproducibility from debugging, and research from reproducibility: each tier inherits the guarantees of the tiers below it.

## 1 · determinism

Two worlds built from the same spec and run independently must produce the same full-state hash at every tick (16,384-cell terrain grid + chemistry field + every agent + brains + tick fold). **ALL CASES PASSED.**

| case | seed | spawn | ticks | world fp (8) | S(run1)=S(run2) | final alive |
| --- | --- | --- | --- | --- | --- | --- |
| baseline | `modes.d1` | 8 | 40 | `5f8fafc7` | ✓ same | 1 |
| timestep 0.5× | `modes.d1` | 8 | 40 | `d82a55a9` | ✓ same | 1 |
| timestep 2× | `modes.d1` | 8 | 40 | `cee63412` | ✓ same | 2 |
| population 16 | `modes.d1` | 16 | 40 | `ee1b7e9e` | ✓ same | 3 |
| params energy | `modes.d1` | 8 | 40 | `6456f4b6` | ✓ same | 1 |

The timestep, population, and parameter axes are each part of the world identity: changing any one yields a different (but still self-identical) trajectory. Paired experiments gate on identical (seed, timestep, population, params) and change exactly one knob.

## 2 · debugging

Replay of seed `modes.debug` (12 founders, 8 ticks). Trace available above; replay-of-trace identical: **yes**. A bug appearing on this seed is bit-reproducible — rerunning the trace replays the identical hash column.

| t | alive | births | deaths | species |
| --- | --- | --- | --- | --- |
| 0 | `12` | `0` | `0` | 12 |
| 1 | `11` | `0` | `1` | 11 |
| 2 | `9` | `0` | `2` | 9 |
| 3 | `6` | `0` | `3` | 6 |
| 4 | `5` | `0` | `1` | 5 |
| 5 | `5` | `0` | `0` | 5 |
| 6 | `5` | `0` | `0` | 5 |
| 7 | `5` | `0` | `0` | 5 |

## 3 · reproducibility

A run is identified by its fixture = (seed, world fingerprint = hash of every world parameter). Re-running a fixture reproduces the identical hash trajectory and identical outcome fingerprint — verified here *across two independent processes* (all `modes.json` data fields match; only the timestamp differs). Conditional on the same IEEE-754 arithmetic, trajectories are byte-for-byte stable across processes and machines.

| fixture | stochastic world | ticks | world fp (16) | outcome(run1) | outcome(run2) | match |
| --- | --- | --- | --- | --- | --- | --- |
| deterministic twin | off | 40 | `ed84eb45` | `7f809f2e` | `7f809f2e` | ✓ identical |
| stochastic twin | on | 40 | `ed84eb45` | `7f809f2e` | `7f809f2e` | ✓ identical |

**Both fixtures reproduce exactly.** The stochastic twin reproduces itself bit-for-bit (the world-stoch module is seed-driven), so reproducibility is preserved when stochasticity is added.

## 4 · research (stochastic worlds)

Research mode turns the stochastic world module ON. The unit of evidence is a world (seed), not within-world noise:

- Same seed, stochastic twin vs deterministic twin → **diverges** (first divergent tick per seed).
- Stochastic double-run of the same seed → **identical** (controlled stochasticity).
- Different seeds → independent worlds.

| seed | det alive | det species | stoch alive | stoch species | divergence tick | outcome fp (det) | outcome fp (stoch) | stoch repro |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `modes.r1` | 4 | 4 | 4 | 4 | 0 | `12b365ea` | `d88ae966` | ✓ |
| `modes.r2` | 4 | 4 | 4 | 4 | 0 | `3b232a47` | `c83e4343` | ✓ |
| `modes.r3` | 2 | 1 | 2 | 1 | 0 | `4940c08c` | `89b96c63` | ✓ |
| `modes.r4` | 4 | 4 | 4 | 4 | 0 | `42271692` | `fcaf78df` | ✓ |
| `modes.r5` | 4 | 3 | 4 | 3 | 0 | `4caa6d41` | `bed9d00c` | ✓ |
| `modes.r6` | 4 | 4 | 4 | 4 | 0 | `f75b0fd8` | `1e181d8a` | ✓ |

Across 6 seeds: deterministic final alive = 3.7 ± 0.8 (range 2–4); stochastic final alive = 3.7 ± 0.8 (range 2–4); trajectory diverged from the deterministic twin at tick 0–0 (every seed); outcome fingerprint (the 12-number telemetry the experiments report) differs between the twins on 6/6 seeds.

The stochastic layer perturbs micro-state from the first tick (div@0: the OU resource field and Markov weather are live from the start), and the perturbation propagates to the recorded telemetry: even where final alive matches, the outcome fingerprint (energy, entropy, complexity, food gradients, CA field, variance) differs — the twins are different worlds with the same census.

## Replicating an experiment

1. Choose a seed, a biome/topology, a knob, and a baseline fixture (any row above fingerprints one).
2. Run the fixture twice — the (run1, run2) outcome fingerprints must match (measurement repeatability).
3. Change exactly one knob by rerunning the fixture with that parameter overridden; the same-axis comparison is then a pure test of the knob.
4. For research claims, sample ≥ 6 seeds; each is one world, and each world self-reproduces.
