# 02 — Processes

*Tree of Life — technical manual, part 2.*

Two families of processes: the **in-simulation processes** (the dynamics the
world runs every tick) and the **research processes** (the pipelines that
measure, test, and score the world). Each entry lists inputs, steps, outputs,
files, and the key constants.

---

## A. In-simulation processes

### A.1 Reproduction (birth)

*Steps (per reproducing agent, `engine.ts:1318`):* gate on energy/age/fertility;
build child genome via cloning + mutation (`mutateGenomeScaled`) or, when
`WorldConfig.recombination` is on, the Phase-C operator chain
(`recombineGenomes` = multi-point → combinatorial assembly → block shuffle);
transfer `OFFSPRING_ENERGY_TRANSFER = 0.3` of parent energy; pay a sexual cost
`SEXUAL_COST_MULT = 1.5` when recombining; guard
`aliveCount() >= min(maxPopulation, MAX_AGENTS)` (`engine.ts:2200`).

### A.2 Greenbeard donation (cooperation)

The model's exact conservation identity: `Σ totalDonated === Σ totalReceived`
(`engine.ts:1269-1293`). Gate: donor `energy > cap·coopThreshold ∧ strategy[5] > 0.3`;
needy neighbour `energy ≤ cap·0.3` and `|meme diff| ≤ MEME_TOLERANCE = 0.05`;
`gift = min(energy − cap·0.5, DONATION_RATE·size·ts·cap·coopScale)`,
`DONATION_RATE = 0.02`. The `P-RECIP` process pegs the reciprocity records
S1/S3 (`Hproc`/`H2`).

### A.3 Memetic imitation (culture)

If a neighbour's meme differs by more than `MEME_TOLERANCE = 0.05`, copy it
with probability `MEME_COPY_RATE = 0.02` (`engine.ts` imitation block,
`MEME_*` constants). Suite knob: `WorldConfig.memeCopyGain` (Phase D culture
channel); `0` freezes memes.

### A.4 Costly signalling / communication

Signal molecules are produced and diffused (`SIGNAL_DEPOSIT = 0.08`); the
Phase-D communication channel gain scales per-tick signal energy
(`emergenceRadar.ts:50`); signal diffusion runs in the world half
(`engine.ts:1772`).

### A.5 Predation, carrion, decomposition, plant growth

- Predator–prey interaction (`engine.ts:1151`): damage `PREDATION_DAMAGE = 0.015`,
  escape cost `ESCAPE_COST = 0.008`, pack bonus `PACK_BONUS = 0.12`.
- Carrion → meat (`engine.ts:1687`), meat decay `MEAT_DECAY = 0.002`.
- Decomposition → soil (`engine.ts:1728`), fraction `DECOMP_FRACTION = 0.5`.
- Plant growth (`engine.ts:1736`), modulated by weather growth and OU multiplier.

### A.6 Dormancy and metabolism

- Dormancy (`engine.ts:1164`): conservation `DORMANCY_CONSERVATION = 0.3`.
- Metabolism (`engine.ts:1137`): `BASAL_METABOLIC_COST = 0.003`, aerobic/anaerobic
  ATP rates `AEROBIC_ATP_RATE = 0.01`, `ANAEROBIC_ATP_RATE = 0.003`,
  thermoregulation `THERMOREGULATION_COST = 0.001`.

### A.7 Stochastic world

Weather Markov chain + OU resource modulation + Poisson bursts (see
[01 §4.2](01-engine-and-algorithms.md)). Every draw is seeded from `envSeed`.

### A.8 Learning loop

Per agent each tick: `forwardBrain` (Elman recurrence) → action sampling →
`observeBrain`/`backpropBrain` update using reward + TD error
(see [01 §4.10](01-engine-and-algorithms.md)). Weights inherit Lamarckian-style
(`spawnBrain`).

### A.9 Cellular / molecular processes

Cell cycle + membrane transport (`cells.ts`), DNA damage/repair/replication
fidelity (`dna.ts`), and, when `cellBio` is on, proteostasis + MM kinetics +
Na/K pump + mitochondria (`cellbio.ts`). Omics adds transcription/proteome/flux
dynamics behind `WorldConfig.omics`.

---

## B. Research processes

All research processes run the reference (or WASM) engine offline and write
deterministic artifacts to `research/output/`. Each has a CLI and an npm script.

### B.1 Ladder (`ladder.ts`)

*Purpose:* measure the emergence levels L0–L3 of a single run.
*Steps:* build engine from `WorldParams` + ladder opts; run `ticks`; sample every
`sampleEvery`; accumulate `LadderResult { trajectory, summary: LadderSummary,
synthesis: LadderSynthesis }`. **`LadderSummary` has four fields**
(`life, interaction, cognition, gameTheory`) — **no `macro`, no `levels`**.
Levels live at `r.synthesis.levels: LadderLevelVerdict[] = {level, verdict,
evidence, note}` (`ladder.ts:122`). `TrajectoryPoint` at `ladder.ts:65`.
Defaults (`ladderOptsFor`, `experiment.ts:110`): `ticks:12000, spawnCount:60,
maxPopulation:400, sampleEvery:400`.

### B.2 Archetypes (`archetypes.test.ts` / emergence suite)

Three seeded founder worlds (`EMERGENCE_SEEDS = ['archetypes.s1', …]`),
`EMERGENCE_TICKS = 240`, `EMERGENCE_SPAWN = 40`, capacities `[60,150,400]`.
Feeds the emergence detector.

### B.3 Emergence detector (`research/emergence.ts`)

*Purpose:* quantify self-organisation. Computes Shannon entropy, LMC
complexity, Moran's I, contagion index, radial correlation length, Lempel–Ziv
complexity, Simpson diversity, aggregation order, NMI between micro and macro
information, and classifies a **macro regime** from spatial structure ×
rigidity × collapse (thresholds 0.3/0.42/0.55, rigidity 0.6, collapse 0.6).
`MACRO_REGIMES = ['random','clustered','organized','specialized','collapsed']`.
`detectMacroStates` needs per-tick `MacroFrame` occupancy (not available from a
trajectory; high-N uses a proxy).

### B.4 Complexity lab (`research/complexity.ts`)

*Purpose:* partial differentiation of macro order w.r.t. a micro parameter.
Two-parameter design (cell capacity × supply) × 4 rule sets (`TIER_DEFS`).
Produces phase transitions, attractors, feedback, hysteresis, scaling,
stability, cooperation, a 2-D capacity×supply interaction surface, and zoomed
critical-point refinement (`complexity.md/json/csv`, `plots/complexity.svg`).
624 experiments, 208 s, 0 divergences across 24 double-run worlds.

### B.5 Emergence radar (`research/emergenceRadar.ts` + `packages/shared`)

*Purpose:* a 12-primitive / 11-level (L0–L10) unfolding radar.
`RADAR_MARGIN = 0.25`; `RADAR_SEEDS=['radar.s1','radar.s2','radar.s3']`,
`RADAR_SPAWN=50`, `RADAR_TICKS=300`, `RADAR_SAMPLE_EVERY=10`. Validation requires
`baselinePeak ≥ 0.6` and `baselinePeak − ablatedPeak ≥ RADAR_MARGIN`.

### B.6 Life-organization (`lifeOrganization.ts` + `packages/shared`)

*Purpose:* a 10-level (O0–O9) organisation detector over `SimStats`
(Subatomic/quantum → Organism). Per-level mean of min–max-stretched channels;
`REL_FLOOR=1e-3`, `ZERO_FLOOR=1e-6`, `MIN_COVERAGE=0.25`, `ON=0.6/OFF=0.4/
PARTIAL=0.2`. `LIFE_SEEDS=['life.o1'..]`, `LIFE_SPAWN=60`, `LIFE_TICKS=400`,
`LIFE_SAMPLE_EVERY=10`, `LIFE_MAX_POP=300`. `LifeProfile='legacy'|'full'`; the
`full` arm sets `cellBio/biophysics/omics/omicsStochastic/combinatorial=true`.
Writes `lifeorg.{md,json,csv}` + `plots/lifeorg.svg`. npm `research:life`.
**Findings:** legacy — O0/O3/O7/O8 `DORMANT`, O1/O5/O6 `EMERGENT`; full — all 10
measured (O7 coverage 0.25; biophysics zeroed in TS).

### B.7 Causal induction (`research/causal.ts`)

*Purpose:* induce behavioural fields (alignment/cohesion/separation/circulation)
from movement and test sufficiency.
Constants `SPEED_EPS=0.05`, `MIN_MOVERS=4`, `MILL_ROTATION_THRESHOLD=0.25`,
`CONVERGENCE_TOLERANCE=0.12`; default arm `spawn=60, arena=140, ticks=400,
sampleEvery=20, seedSpeed=2.0`. Metrics: polarization
`P=|\Σ \hat v_i|/N_movers`, rotational order (angular-velocity fraction),
torus-aware centroid/spread, and a behaviour classifier. **Convergence is
budget-dependent** (`convergenceError` 0.42@200, 1.27@400, 2.83@600 ticks).

### B.8 Perturbation harness (`research/perturb.ts`)

*Purpose:* channel-exercise + verdict. `PERTURB_TICKS=200`,
`PERTURB_SEEDS=['perturb.s1'..'s5']`, baseline `agents=100, energy=100,
noise=0.1, cooperation=0.5`. Channels: `baseline|cooperation|noise|
communication|cull`. Verdict = whether the pathway was live in the reference
runs; `partial` if conditions met but `donations==0`. Output
`perturbation.*`.

### B.9 High-N selection (`research/highN.ts`)

*Purpose:* pick high-population configs via G0–G8 and rank.
RegimeVec uses `macroRigidity`/`macroStatePersistence` and
`structure = 0.5·coopOrder + 0.5·speciesOrder`, classified by
`classifyMacroRegime`. `total = G0·2 + G1 + G2 + G3 + G4·2 + G5 + G6 + G7 + G8`.
CLI `--scales/--seeds/--ticks/--sample-every/--verify-repro`; npm
`research:highn`; writes `output/highN_selection.json`. Selected
`highn_n100_mp120_highn.s1` (10.1), `highn_n10000_mp12000_highn.s3` (9.816),
`highn_n2000_mp2400_highn.s2` (9.776); all 18 candidates G0-valid with
L1/L2/L3 `EMERGENT`.

### B.10 Benchmark harness (A–J) (`research/benchmarks/`)

Canonical models A–J (Life, logistic, Meadows, predator-prey, …) each with a
declared fingerprint and fidelity check. 10/10 reproduce bit-for-bit; quick mode
5 seeds PASS, fidelity 1.00.

### B.11 Rigor layer (`research/rigor.ts`)

Seven modules: verification (analytic checks), validation (known systems),
reproducibility (double-run fingerprints), sensitivity (Morris μ* + OAT),
ablation, significance, novelty scorecard. Overall PASS; novelty 0.933,
coverage 10/10, fidelity 1.00, grounding 26/26.

### B.12 AI processes (`research/ai/*`)

Three uses of an LLM/AI layer (providers `ollama`/`mock`; cache modes
`on|off|replay|refresh`):

- **World controller** (`worldAI.ts`, `controller.ts`): closed
  observe→direct→actuate→measure loop against an unsteered control. Directives
  steer `WorldParams`, capped at `0.95×default`; `ControlWindow` at
  `controller.ts:13`. Outcome is **honestly negative** (steered worse than
  control).
- **Phase analyst** (`phaseAnalyst.ts`): interprets measured critical loci;
  only invoked when ≥1 locus exists.
- **Research agent** (`researchAgent.ts`): proposes experiments scored by the
  real benchmark harness across iterative rounds.

CLI `aiRun.ts` (`--live`→refresh, `--replay`→replay); outputs
`ai-world.*`, `ai-phase.*`, `ai-loop.*`.

### B.13 Scope ledger (`research/scope.ts`)

A registry of falsifiable claims with thresholds; the source of truth for the
scope report (see [05](05-evaluations-and-debugs.md)).

### B.14 Bayesian ledger (`research/bayes.ts`)

Sequential odds updated by evidence ids; minimal Bayes factor
(`sbpBF`), binomial recovery evidence, and posterior bookkeeping. Idempotent by
evidence id. Output `bayes.*`.

### B.15 Experiment runner (`research/experiment.ts`)

`runExperiment(exp, opts={})` runs an experiment; `runDigest(r)` (line 61) is the
SHA-256 over `{worldFingerprint, trajectory, summary, synthesis}` — the bit-exact
reproducibility key; `reproduceExperiment(m, runner?)` (line 178) re-runs and
compares digests. `resolveObjectives` at line 44.

### B.16 Environment / topology / dimensionality (Phase M)

`environments.ts` (17 biome presets × jitter), `dimensional_worlds.ts` (minimal
N-D cellular world; `DIMENSION_WORLDS.length=4`, dims `[1,2,3,4]`,
`connectivity=2·N`), `cosmos.ts` (sweeps the axes that define a world). Outputs
`environments.*`, `topologies.*`, `dimensions.*`, `cosmos.*`.

---

## C. Output artifacts

All research outputs land in `research/output/` as `.md/.json/.csv` (+ optional
`plots/*.svg`). The runner is parallel-safe: no research process writes a shared
output. Reports are deterministic (`mulberry32`/`fnv1a32` seeds). See
[`output/README.md`](../output/README.md) for the full artifact index.
