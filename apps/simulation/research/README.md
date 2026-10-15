# Fractal Life — research harness documentation

This directory is the measurement + experiment arm of the simulation. It runs
deterministic, seedable experiments and writes a self-contained report bank to
`research/output/` — statistics, probabilities, SVG plots, CSV, JSON.

## Modules

| file | role |
|---|---|
| `scenarios.ts` | shared world builders (`makeWorld`, genome kits, cell helpers) |
| `environments.ts` | Phase M experiments: 17 biome presets × 5 topological spaces × fractal-dimension sweep → `environments.*`, `topologies.*`, `dimensions.*` |
| `dimensional_worlds.ts` | 1D–4D lattice harness (volume fixed at 4096) → `lattice.*` |
| `statistics.ts` | measurement layer: summaries, Welch/paired t, ANOVA-F, bootstrap (seeded), exact binomial (Clopper–Pearson) |
| `charts.ts` | dependency-free deterministic SVG renderers (bar+CI, box, heatmap) |
| `analyze.ts` | consumes canonical outputs, runs the replicate sweep, assembles `analysis.md/json` + `plots/` |
| `cosmos.ts` | world-definition axes: universe constants, energy, constraints, physical laws, supply/destruction, black-swan events, equilibria → `cosmos.*` (78 runs) |
| `bayes.ts` | Bayesian ledger: Sellke–Berger–Pericchi minimal BF + binomial LR, sequential idempotent updates → `bayes.md`, `hypotheses.json`, `plots/posterior.svg` |
| `snapshot.ts` | strict bit-exact `fullStateHash(engine)` (terrain + chemistry + agents + brains + stoch state), outcome + world fingerprints; the `S(run)` of `S(run1) = S(run2)` |
| `modes.ts` | the four scientific modes — determinism → debugging → reproducibility → research → `modes.md/json/csv`, `plots/modes.svg` |
| `archetypes.ts` | the agent complexity ladder — simple rules → constraints → cognition → systems → `archetypes.md/json/csv`, `plots/archetypes.svg` |
| `complexity.ts` | the virtual complexity lab — partial differentiation of macro order w.r.t. a micro parameter, two-parameter design (cell capacity + supply) × 4 rule sets → phase transitions, attractors, feedback, hysteresis, scaling, stability, cooperation, plus a 2-D capacity×supply interaction surface (∂² cross-term) and zoomed critical-point refinement → `complexity.md/json/csv`, `plots/complexity.svg` |
| `emergence.ts` | emergence as a measurable object — five axes (information in the micro level, information in the macro level, LMC complexity, self-organization, temporal persistence) + emergent information (sync/predictive NMI) + composite emergence index/verdict, plus phase-2 metric axes (order polarization, spatial clustering, diversity, information, complexity) and a **population-level macro-state detector** (random → clustered → organized → specialized → collapsed) that never reads an individual agent, all from a deterministic double-run per world over the archetype ladder → `emergence.md/json/csv`, `plots/emergence.svg` |

| `perturb.ts` | single-axis perturbation engine — one baseline (100 agents / capacity 100 / noise 0.1 / cooperation 0.5) with cooperation removed, noise doubled, 20% culled and communication switched off in turn, each paired on the seed and reported as `deltaY = Y_perturbed - Y_baseline` with across-seed sd, sign-reversal flags and a per-axis channel verdict so an unexercised pathway cannot be mistaken for an inert perturbation → `perturbation.md/json/csv`, `plots/perturbation.svg` |
| `benchmarks/` | canonical A-Life benchmark suite — ten self-contained deterministic micro-models A–J (`benchRun.ts`) with literature-defined signatures and bootstrap-CI gated checks, plus the known-systems reverse-engineering registry (`knownRun.ts`) → `bench.*`, `known.*`, `plots/bench.svg`, `plots/known.svg` |
| `benchmarks/rigor/` | research-rigor layer over A–J — verification (impl ≈ analytic, per-key declared tolerance), validation (model → empirical), reproducibility (fingerprints + seed cohort), sensitivity (OAT + Morris elementary-effects screen), ablation (structural/param interventions), significance (one-sided t + Holm–Bonferroni + Bayes factor + Clopper–Pearson), novelty/impact scorecard (`rigorRun.ts`) → `rigor.*`, `rigor-hypotheses.json` |
| `ai/` | LLM / AI-agent layer over the research stack — content-addressed cached calls to open-source models through Ollama (`qwen2.5:3b` default) with a deterministic `mock` backend for tests/CI: a **world controller** running a closed observe → direct → actuate → measure loop against an unsteered control (`controller.ts`, `worldAI.ts`), a **phase analyst** that interprets measured critical loci (`phaseAnalyst.ts`), and an iterative **research loop** whose proposals are scored by the real benchmark harness and fed back across rounds (`researchAgent.ts`) → `aiRun.ts` → `ai-world.*`, `ai-phase.*`, `ai-loop.*` |
| `scope.ts` | the **research scope** — seven research questions, ten scope boundaries (in/conditional/out), seven method commitments, and the fixed ledger of falsifiable claims; `benchmarkClaims()`/`empiricalClaims()` derive the per-model and per-system claims from the registries; `validateScope()` blocks on a claim with no falsifier, a question with no claim, or a duplicate id |
| `claims.ts` | the **unified claims ledger** — one schema for every claim's verdict regardless of which module produced the evidence; typed mappers turn the benchmark scorecard, known-systems report, rigor checks, determinism reports, the AI loop and the world controller into `supported`/`refuted`/`inconclusive` verdicts (a claim id the scope did not pre-register is dropped, so evidence cannot invent a claim) |
| `scopeRun.ts` | the scope CLI — runs the whole evidence bank (benchmarks, known systems, rigor, determinism) and joins it with the stored AI artifacts, then writes `SCOPE.md` + `output/claims.json` |

## Experiments

### Causal decomposition of collective behaviour (`causal.ts`)

An intervention study, distinct from the observational modules above. The engine
builds every agent thrust from `clamp(brain + drive * DRIVE_SCALE, -1, 1)` and
the 15-input sensor vector carries no neighbour velocity, heading or position
offset, so the drive block is the only channel from one agent's motion to
another's. Zeroing a drive gene deletes that pathway outright.

Each arm is a set of founders with an identical genome and reproduction switched
off, so nothing is born and no gene drifts. Every arm is executed twice from an
identical seed; no causal claim is emitted from a non-reproducing arm.

Every arm is then repeated across five independent seeds. This is not
belt-and-braces: **13 of 16 arms were seed-dependent on a single draw**, so the
single-seed labels are reported as superseded and every claim is gated on
replication. Determinism proves an arm replays; it does not prove the behaviour
belongs to the gene set rather than to one lucky initial condition. The first
version of the study ran each arm once and produced a clean, exception-free
density threshold that did not survive a second seed.

**The tick budget is a third axis of fragility, and it caught me.** An early
version was made faster by halving the run from 400 ticks to 200, on the
reasonable grounds that the trajectories look flat early. That inverted a
conclusion: `cohesion` alone at low density reads as a flock at 200 ticks and as
a clot at 400, because at 200 the measurement window is still drifting. Cost
reduction is a change to the experiment, not to the runtime. The study now fixes
400 ticks and reports `convergenceError` beside every label, defined as the
disagreement between the two halves of the measurement window. That error does
*not* shrink with run length (0.42 at 200 ticks, 1.27 at 400, 2.83 at 600) -
because most arms are not converging to a fixed point and are not meant to: a
dispersed arm keeps expanding, a swirling arm keeps rotating, and both are
legitimate behaviour classes.

The hypothesis was that `alignment + separation + cohesion` is the collective
flock. **It is sufficient but not minimal.** At high density the one clean
sufficient set is `cohesion+separation` - a bounded even lattice, no rotation -
because `none` and `separation` are inert on every seed and `cohesion` never
flocks. The triad reaches the same outcome, so alignment contributes nothing the
other two do not already achieve. `circulation` alone reaches a flock on most but
not all seeds, suggesting a second, rotating route that replication has not yet
established.

A geometric mechanism is real and reproducible but does **not** decide the
outcome. `feedGenome` pins gene 6 to -1, giving minimum body size 0.5, so
separation only fires inside `8 * 0.5 = 4` units while the sense radius is 36 - a
9x mismatch that makes separation a collision term rather than a spacing term. Mean
nearest-neighbour variability tracks the ratio of mean spacing to that radius,
falling from above 3.5 to below 0.7, and that relationship survives every seed.
What does not survive is the claim that the ratio flips the behaviour: the density
boundary is a **band** roughly one to four nearest-neighbour radii wide, not a
constant. The sweep is unanimous at every density it samples, but the seeded
replication lands between two of its rows and is only 60% there, which is how a
band gets mistaken for a threshold when only one seed is drawn.

**Replication over seeds only tests one of the three assumptions this study rests
on.** The other two are the genome background and the classifier's own thresholds,
and neither can be checked by re-running the same experiment. Both are now checked
directly.

*Classifier thresholds.* Every label is a cut on a continuous readout, and none of
those cuts was validated against anything except this run. A label reads like a
measurement, so this is easy to forget. Each of the five cuts is swept over x0.8 to
x1.25 and all 160 stored settled states are re-classified - no new simulation. The
polarization floor is completely stable, but **lattice neighbour CV is the most
exposed cut in the whole classifier: at x0.8 it relabels 11% of runs**, moving runs
in both directions across the flocking/cohesive boundary. So the ordering of the arms
is not an artefact of threshold placement, but any statement about the *identity* of
a class near one of these boundaries is a statement about where the line was drawn.

That sweep also falsifies a tidy reading of the milling result. The raw separation
margin is only 0.04 (milling runs start at rotational order 0.28, the highest
non-milling run reads 0.24, cut at 0.25), and it would be easy to report "nothing
lands on the wrong side" as if the count were robust. Sweeping the milling cut alone
moves 10 runs across the milling boundary. **Milling membership depends on where
that cut sits**, so a per-seed count of 1/5 is not a robustly non-milling arm, it is
one arm that missed on one seed by a margin smaller than the perturbation swept here.

*A second genome background.* Every claim above is about `feedGenome`. The check
that matters is gene 6, because it sets body size and therefore the separation
radius - the one background parameter the geometric explanation leans on. Setting it
to -0.5 decodes to body size 1.0 and doubles the separation radius from 4 to 8,
cutting the sense/separation mismatch from 9x to 4.5x. Two findings survive:

- All 3 arms that flock reliably at high density on the default background still do
  on the variant, and `none` and `separation` stay inert on all 5 seeds. The
  sufficient sets *grow* rather than shuffle (5 rather than 3 at high density),
  which is what the mechanism predicts: more separation per body means the spacing
  term bites earlier, so weaker routes become sufficient too.
- Seed instability is comparable on both (11 unstable on the default, 10 on the
  variant), so the fragility documented above is a property of the dynamics and not
  an artefact of the one background.

This is one alternative geometry, not a general claim. The sense radius and every
gene outside the drive block are still single-valued, so "the causal ordering is a
property of the drive genes" is still stronger than the evidence allows.

Two readout properties had to be handled before any of this was measurable:

- **Polarization is saturated.** Cohesion and circulation both read 0.98-0.99,
  so a polarization-based flock test would score a collapsing clot and an evenly
  spaced swirl as identical and confirm any pre-chosen story. The classifier
  rests on spread, nearest-neighbour regularity and rotational order instead.
- **Alignment cannot bootstrap from rest.** It sums *neighbour* velocities, so
  with every agent stationary it never fires and the population stays frozen;
  measured from rest it scores exactly 0.000 in every configuration. A seeded
  heading, identical in every arm, is what makes the term switchable.

See `research/output/causal.md` for the full 16-arm tables, both densities, the
density sweep, ablation deltas, pairwise interactions, the threshold sweep, and the
second-background comparison.

**Reading the report.** Sections are ordered by how much evidence stands behind
them: robust claims first, then the density boundary, then the single-seed tables
kept only for their geometry and explicitly marked superseded. `convergenceError`
sits beside every label, `--strict` makes the CLI exit non-zero on any
seed-dependent arm, and `--arena`/`--spawn` set the high-density endpoint with the
low one scaled by the default pair's ratios.

### What the study cost in wrong claims

Three findings here were asserted before they were checked, and each was caught by
a test rather than by reading the numbers. They are worth recording because the
mistakes are ordinary:

1. **"Separation is necessary for flocking."** Wrong. `circulation` alone flocks on
   80% of dense seeds. The flock is over-determined - a rotating swirl and a
   bounded even lattice reach it through routes that share no components.
2. **"The density flip is governed by a fixed geometric constant."** The transition
   is real; the precision was invented. It is a band, and a single-seed sweep
   cannot tell a band from an edge.
3. **"Halving the tick budget is free because the trajectories look flat early."**
   Wrong, and it inverted a result: `cohesion` alone reads as a flock at 200 ticks
   and as a clot at 400. Making a study faster is a change to the experiment.

And one was caught only because the check was written down in advance:

4. **"Nothing lands on the wrong side of the milling cut, so the counts are
   robust."** The separation margin is 0.04 and the cut is right in it. Sweeping
   that single threshold moves 10 runs across the boundary. A correct-looking
   separation between two populations says nothing about whether the line you drew
   sits in the gap - only sweeping the line does.

The recurring lesson is that determinism is the weakest form of evidence the
engine offers. Every arm here replays bit-identically from a fixed seed, and 13 of
16 were still seed-dependent. A reproducible number is not a robust one, and a fast
run is not a shorter one. Seed replication is also not sufficient on its own: it
tests the initial condition and leaves the genome background and the classifier
thresholds untouched, and both of those turned out to move results when they were
finally varied.

### Biomes (Phase M, `environments.ts`)
17 biome presets under the environment regime (`ENV_REINJECT_RATE = 0.02`),
same seed stream, per-preset jittered habitat window: calm control, 8 extreme
(anoxic, hyperthermal, hypersaline, acidic, soda, cryo, irradiated, toxic), 8
underrated (cave, gut, mound, rhizosphere, marsh, dune, spring, canopy).
240 ticks, 40 founders.

### Topological spaces
Every biome × every space: **torus** (wrap×2, legacy), **cylinder** (longitude
wrap, latitude reflect), **sphere** (wrap + pole reflect), **möbius** (reflect
+ half-twist longitude flip), **klein bottle** (latitude loop + longitude
flip). World is 2048²; a mid-world colony never meets an edge in 240 ticks, so
the topology runs are **edge-seeded** — founders line up on the northern cap —
to force boundary engagement (see §Validated findings → boundary bug).

### Fractal-dimension sweep
3 fractal types × 3 escape-time resolutions (i32/i256/i1024) × 2 zooms × 2
biomes (calm, hyperthermal). Same habitat within a biome — only the fractal
regime differs. `worldScale`, `maxIter` are the knobs.

### Dimensionality lattice (`dimensional_worlds.ts`)
A minimal N-dimensional consumer–resource world held at fixed volume 4096 so
only the geometry of space changes: `[4096]`, `[64,64]`, `[16,16,16]`,
`[8,8,8,8]`, torus + reflecting-box variants. Counts 2N neighbours/cell,
logistic resource, diffusion, colony dispersal, Shannon entropy, paired
distance, spread. The full engine is 2-D by construction, so dimensionality is
studied here rather than in-engine.

### Replicate sweep (`analyze.ts`)
6 seeds × 3 biomes × 5 topologies = 90 edge-seeded runs. Each seed draws a new
habitat window, so this is the **across-habitat** replication unit — the
natural one, because a fixed (seed, biome) world is fully deterministic.

### Cosmos axes (`cosmos.ts`)
World-definition knobs over the calm-biotope torus baseline — universe
constants (escape radius, time scale, day length, world scale), energy levels
(metabolism, energy bank), constraints (founders, population cap), physical
laws (Earth/Mars/Luna gravity), supply/destruction (food regen, famine,
bounty), black-swan events (meteor/storm/famine/bounty/nuke at tick 80 of
300), and equilibria (480-tick horizon). 4 replicate seeds per paired family
give n=4 matched contrasts; 78 runs total. `cosmos.md` carries the raw table
plus the qualitatively-derived hypothesis list.

### Bayesian ledger (`bayes.ts`)
Prior 0.5 per claim; each independent dataset updates via the **minimal** Bayes
factor BF = 1/(−e·p·ln p) for p < 1/e (Sellke–Berger–Pericchi), exact binomial
LR for recovery claims (meteor/nuke), direction-gated for directional claims.
`hypotheses.json` is an absorbing ledger: re-runs over identical data are
idempotent (evidence IDs absorb once), and new datasets multiply the stored
odds — true sequential Bayes. Note the bound: with n=4 worlds, even p=0.05
caps the posterior at ≈0.71, so posteriors here are deliberately conservative.

### Scientific modes — the determinism ladder (`snapshot.ts`, `modes.ts`)
The whole program rests on one contract, verified at the engine and experiment
levels: the simulator is a pure function of its world definition —

**S(run) = run(seed, timestep, population, parameters)**, with stochasticity
only from an OPT-IN, still-seeded stochastic world module (OU resource field,
Poisson regen bursts, Markov weather). The four modes climb the ladder
`determinism → debugging → reproducibility → research`:

1. **determinism** — two worlds from the same spec give `S(run1) = S(run2)`
   at *every* tick, on the strict bit-exact full-state hash (grid + chemistry
   + agents + brains + stoch state). Timestep (0.5/1/2), population, and
   parameter overrides each change the world identity but stay self-identical.
   Locked in by `test/determinism.test.ts` and T1 of `modes.ts`.
2. **debugging** — short replay with a per-tick trace; bugs reproduce on the
   first seed they appear in, and the trace column is byte-stable across reruns.
3. **reproducibility** — a run is identified by its fixture `(seed, world
   fingerprint = hash of all params)`; rerunning a fixture reproduces the
   identical hash trajectory and outcome fingerprint. Verified for both
   deterministic and stochastic twins.
4. **research** — the stochastic world is ON; sample space = seeds/worlds
   (each deterministic), same-seed stochastic twins still reproduce themselves
   bit-for-bit yet differ from their deterministic twin in micro-state from
   tick 0 and usually in the outcome fingerprint. This is the stochastic-mode
   discipline: measurable, controlled, and repeatable.

### Agent archetypes — the individual-complexity ladder (`archetypes.ts`)
Agents **start from simple rules**, then the ladder integrates constraints,
intelligence and systems ONTO the same individual, as inherited layers over the
same world shape, physics baseline and seeds:

1. **T0 · simple rules** — every founder is a clone of one calm genome driving a
   fixed genome-reflex (`forwardGenome`): no heritable diversity, no chemistry,
   no learning (genomeDist = memeCV = proteomeCV = surprise = 0).
2. **T1 · constraints** — heritable genomes (founders from random seeds) under a
   calm-biome regime that reinjects O2/pH/toxin/water every tick. `genomeDist`
   and `memeCV` leave zero: individuals differentiate against the constraints.
3. **T2 · cognition** — behaviour moves from the fixed reflex to a per-agent
   learned MLP policy (backprop + surprise-modulated plasticity). Plasticity and
   meanSurprise leave zero; the genome layer is inherited unchanged.
4. **T3 · systems** — intracellular omics (stochastic expression, combinatorial
   chemistry, recombination, cell biochemistry). `proteomeCV` leaves zero: a
   second, non-genetic state dimension inside each individual.

Each tier is verified determinism-first (double-run, bit-for-bit on the
full-state hash) and gated by `test/archetypes.test.ts`, which asserts the
`0 → >0` unlock order: heritable diversity@T1, learning@T2, chemistry@T3.

### Virtual complexity lab (`complexity.ts`) — partial differentiation over a micro parameter
The lab sweeps a **micro parameter** of the world definition (what you can tune
in `buildWorld(true)`/`buildArchetypeWorld` args) and measures how the **macro
order** (aliveFrac, species, cooperation, donation, meme entropy, trophic
entropy, trait variance) responds. It runs each of the four rule sets A
(`TIER_DEFS`) against the sweep and detects **phase transitions** by partial
differentiation **∂O/∂(log₁₀ p)**:

- **Axis 1 — cell capacity** `energyCapacity`, log₁₀ grid [1.0, 2.78] (10 → 600).
  A single cell-trait constant; natural food endowment; this is the ACTIVE
  parameter (aliveFrac rises 0.19 → 0.31, species 3.0 → 4.7 across T1–T3).
- **Axis 2 — supply** `foodRegenRate`, log₁₀ grid [1e-5, 3e-2] (~×3000), run
  under a **scarcity regime** (agent reserves capped at 25, food endowment
  calibrated ∝ rate) so flux governs after reserves burn; needs the longer
  160–200-tick horizon. It separates agent *structure* transitions (species /
  meme-entropy loci, survival at the rich end) from density.
- Sweep, per (axis, point): seeds × rule sets, deterministic worlds, e.g.
  quick = 472 experiments (~2.5 min), full = ~2900 (~35 min),
  dense = ~5500 (~60+ min). Modes via `--quick` / `--dense` / default (full).

Measurement layer (all deterministic, gated by `test/complexity.test.ts`):
`derivativeCentral`, `findPeaks` (prominence-filtered), `attractorModes`
(KDE mode counter), `feedbackReport` (lagged correlations + overdispersion),
`hysteresisLoop` (loop area + path index on up vs down sweeps),
`fitLogLog` (power-law exponent), `entropyOf`/`mean`/`stddev`/`corr`.

Phenomena reported: critical points per macro column (max |∂|, order step,
rebound at a ×3 horizon), attractor mode counting (seed-density bimodality =
bifurcation fingerprint), feedback loops (births ↔ population lag-1 + burst
overdispersion), **stability** (twin infusion worlds — same spec, founders
from a divergent lineage — basin overlap), **hysteresis** (down-sweep founders
inherit the rich end via `richLineage`; same p differs only in heritable
history), scaling laws (capacity → aliveFrac via log-log), a rule-set ensemble
(cooperation, specialization, collective intelligence, living fraction), and a
phenomenon map per tier. Determinism is audited in-run (24 double-runs).

**Two-parameter interaction (∂² cross-term).** A separate coarse surface
O(cap, g) on the full (cell capacity × food flux) parameter domain — no
scarcity cage, so storage and flux both act — yields the central MIXED partial
**∂²O/∂lg(cap)·∂lg(g)** at interior cells: whether supply *amplifies* or
*suppresses* the capacity transition, and at which (cap, g) regime. Only
|∂²| above a 1e-6 numerical floor is reported.

**Critical-point refinement.** The top critical loci are re-sampled at higher
log resolution (±0.35 lg around p*, odd-point window) to estimate the true
transition locus lp*, its **half-max width** (lg-units) and **curvature**
(second central difference). A locus is *sharp* when width < 0.3 lg — this
separates resolved, transition-like loci from gradual, grid-alignment
artifacts (a coarse peak that dissolves on zoom is explicitly reported as
such).

### Emergence measurement layer (`emergence.ts`) — emergence as an object
Emergence is not a label here but a typed measurement object over **five
observable axes**, each computed from one deterministic double-run of a world
(bit-identical passes, audited per world):

1. **information in the micro level** — Shannon entropy of the species
   composition *among living individuals* plus the entropy of their positions
   on the fine 128² terrain lattice (sum of marginal entropies ≈ upper bound of
   the joint micro state);
2. **information in the macro level** — Shannon entropy of the visited sequence
   of quantized aggregate macro states (aliveFrac · species · energy ·
   cooperation · meme entropy, each 8 bins);
3. **complexity** — LMC of the species abundance (entropy × disequilibrium),
   re-derived here to equal the engine's `stats().complexity`;
4. **self-organization** — deviation from the maximum-entropy uniform
   arrangement: aggregation order `1−H/logBins` of the coarse 16² occupancy,
   plus the coarse-to-fine entropy ratio `1−H_coarse/H_fine`;
5. **temporal persistence** — survival fraction, mean lag-1..8 population
   autocorrelation, and first-half vs second-half species-overlap (Sørensen).

On top of the axes the object carries the **emergent information** signature —
NMI between the run-calibrated quantized micro-information value and the macro
state: sync `I(µ;M)` and predictive `I(µ(t);M(t+1))` — and a composite
**emergence index** (mean of the five normalised axes) with an
**ABSENT / PARTIAL / EMERGENT** verdict by threshold. Worlds run the archetype
ladder (T0 simple rules → T3 systems) × 3 seeds × capacities (60/150/400),
attributing emergence to the faculty each tier adds.

**Phase-2 metric axes.** Each world additionally carries five named metric groups
computed from the same double-run, reported as their own table: **order
polarization** (blend of species and trait polarization), **spatial clustering**
(aggregation index, Moran's I, fill factor, radial correlation length),
**diversity** (Shannon, Simpson, evenness), **information** (synergy, redundancy,
total bits), and **complexity** (compressibility, Lempel–Ziv raw/normalized,
temporal complexity). Spatial metrics read the coarse occupancy lattice; the rest
are species- and trait-level.

**Macro-state detector — population level, not agent level.** A second,
deliberately separate instrument. The five axes and the phase-2 metrics are built
from *agent-level* primitives: which species an individual is, where it sits,
what its traits and energy are. The macro-state detector never inspects an
individual. It reads only population aggregates per tick (alive fraction, species
count, mean energy, donation ratio, meme entropy), the coarse occupancy lattice,
and the sequence of quantized macro states, then labels each tick with one of five
stages — **random** (no macroscopic structure) → **clustered** (condenses in
space) → **organized** (structure plus coordination) → **specialized** (structure
*tand* temporal rigidity) → **collapsed** (the population cannot hold the level it
held for most of its life).

Two design points worth knowing when reading its output:

- Every raw scalar is normalized against the run itself, judged on trailing-window
  levels, so a run that merely settles below its spawn burst is not called a
  collapse. The yardstick is the 75th percentile of the sustained series, which is
  robust to both a spawn head start and a long dead tail.
- Collapse is **not** absorbing. These populations genuinely recover, so a
  recovered run stops reporting collapse instead of being stuck in it. Likewise
  `progression` lists *distinct* stages in order of first appearance, while
  `sequence`/`transitions` keep the honest per-tick record, including genuine
  oscillation around a threshold.

The two levels are then contrasted rather than conflated: `macroOrder` is spatial
order read at the population scale, `agentOrder` is the agent-scale order blend,
and `divergence` is |macroOrder − agentOrder|. Measured results: macro `structure`
rises 0.307 → 0.425 and `macroOrder` 0.609 → 0.642 across T0 → T3, and the full
`random > clustered > organized > specialized` ladder appears from T1 onward.

Gated by `test/emergence-measure.test.ts` (pure measurement math + determinism
smoke + LMC formula parity + macro-detector stage, collapse and determinism
cases).

### Single-axis perturbation engine (`perturb.ts`)

Asks the question the other studies do not: holding a baseline world fixed, what
happens when exactly one axis is removed? Baseline is **100 agents, energy
capacity 100, noise 0.1, cooperation 0.5**, read at tick 200, replicated over 5
seeds. Every perturbation is **paired**: the baseline and the perturbed run share a
seed, so they share the fractal habitat and founder placement and the habitat
cancels out of the delta. `deltaY = Y_perturbed - Y_baseline` per outcome key,
aggregated as mean +- sd across seeds.

The five conditions are deliberately single-axis - none of them combines two
changes, because a combined perturbation cannot be attributed to either part:

| condition | axis |
| --- | --- |
| `baseline` | reference |
| `no-cooperation` | cooperation gene 0.5 -> 0 |
| `noise-x2` | pattern-drive noise 0.1 -> 0.2 |
| `cull-20pct` | 20% of live agents killed at the run midpoint |
| `no-communication` | signal emission off |

Outcomes are `aliveFrac`, `meanEnergy`, `energyTotal`, `cooperationRate`,
`donorFrac`, `foodCv`, `spacing`, `spacingCv`, `polarization`, `memeDominance`.

**The channel verdict is the point of the module.** A delta measured through a
pathway that never opened is not a small effect, it is no measurement, and a table
of zeros is indistinguishable from an inert perturbation unless the harness says
which it is. Every run therefore counts whether the manipulated mechanism was
actually live - neighbours per agent, agent-ticks above and below the donation
thresholds, energy donated, signal deposited, moving agent-samples, agents
removed - and each perturbation is labelled `exercised`, `partial` or `closed`
with the number that decided it. The verdict is read from the **baseline** run for
noise, communication and cooperation (the reference world must already have been
using the pathway), and from the perturbed run for a cull (the removal is the
intervention). The report prints an explicit "this axis was not exercised" banner,
and `perturbRun.ts --strict` exits non-zero rather than letting an unmeasured axis
pass for a null result.

Measured results (5 seeds, `--double-run`):

- **`noise-x2` costs energy.** `energyTotal` -24.69 (sd 9.27), `meanEnergy`
  -0.247 (sd 0.093) - the only robust moves, 62% coherence. Every spatial and
  social outcome reverses sign between seeds, so none of them is attributed to the
  perturbation. Doubling the noise drive does not restructure the population here,
  it just makes each agent marginally worse fed.
- **`cull-20pct` removes 20% of the population and the survivors spread out.**
  `aliveFrac` -0.2000 (exact), `energyTotal` -1591.18 (sd 97.61), `spacing`
  +0.386 sense radii (sd 0.171) and `polarization` -0.0027 (sd 0.0001) are robust;
  `meanEnergy` is unchanged in sign terms, i.e. the survivors are not the
  desperate ones - the cull costs biomass, not per-capita condition.
- **`no-communication` *helps*.** Removing signal emission raises `energyTotal`
  +52.64 (sd 4.11) and `meanEnergy` +0.526. Signal traffic costs energy here
  without buying any measurable survival, spacing or ordering benefit; with
  `polarization` and `memeDominance` flat, the channel is pure overhead in this
  baseline.
- **`no-cooperation` is unmeasured, not inert.** The donation rule requires a
  donor above 75% capacity, a same-meme neighbour below 30%, and `out[5] > 0.3`.
  In this baseline no agent ever falls below 30% energy (0 needy agent-samples
  against 713 rich ones) and agents average 2.8 neighbours, so nothing is ever
  donated and every delta is exactly zero. The report says so rather than
  reporting a null; exercising that axis needs a poor/rich adjacency the uniform
  fractal does not produce, which is a property of the baseline, not of the engine.

Gated by `test/perturb.test.ts` (21 cases): genome round trips, single-axis gene
isolation, the cull editing no genes at all, `deltaY` arithmetic, replay
determinism, polarization staying a bounded order parameter, and the verdict logic
for closed / partial / exercised channels including which side answers each
question.

### Canonical A-Life benchmark suite (`benchmarks/`)

The benchmark suite is a **behavioral ground-truth validation** harness: ten
self-contained deterministic micro-models, each instrumenting one canonical
phenomenon and checked against a literature-defined signature. It is the
precedent of `dimensional_worlds.ts` generalised — when a phenomenon cannot be
exercised cleanly inside the full engine, build a minimal instrument and gate it.

| ID | model | family | signature / ground truth |
| --- | --- | --- | --- |
| A | Random walkers | diffusive transport | MSD exponent α ∈ [0.98, 1.02], diffusion constant within 3% |
| B | Boids | flocking | order Φ(off) < 0.15, Φ(on) ≥ 0.80, min separation ≥ 0.8·r_sep |
| C | Game of Life | cellular automaton | glider (+1,+1)/4 gens, blinker/blink/block/pulsar periods, Gosper-gun emission |
| D | Predator–prey (Lotka–Volterra) | ODE dynamics | period vs 2π/√(αγ) ≤ 2%, phase lag ∈ [0.20, 0.30]·T, invariant drift ≤ 0.5%/period |
| E | Diffusion | PDE | L2 error < 1e-3 vs analytic Gaussian, mass conserved, ⟨r²⟩/t within 1% of 4D |
| F | Reaction–diffusion (Gray–Scott) | pattern formation | in-regime occupancy/blobs, out-regime decay to the trivial state |
| G | Iterated Prisoner's Dilemma | evolutionary games | spatial cooperation ≥ 0.90, well-mixed ≤ 0.05 |
| H | Resource competition (R*) | community ecology | smaller-R* excludes, symmetric K coexists |
| I | Collective navigation | active matter | polarisation Φ ≥ 0.80, arrival fraction ≥ 0.90 |
| J | Fractal-life composite | novel hybrid | GoL + stigmergic agents: Moran's I gain ≥ 0.05 over baseline, cross-corr ≥ 0.30 |

Each model exposes a `run(seed, scale)` returning a numeric signature plus a
full-state fingerprint, and a declarative list of `gte`/`lte`/`range`/`eqAbs`
checks flagged gating or informational. The harness evaluates the seven
stochastic models (B, D, F, G, H, I, J) across the fixed cohort `bench-seed-0001..0005`
with bootstrap CIs; exact models (A, C, E) run one seed. A gating check is
CI-bound: a "should happen" (`gte`) test requires the CI **lower** bound to clear
the threshold, a "should not happen" (`lte`) test the **upper** bound. Every
model is run twice per seed and must reproduce its fingerprint bit-for-bit
(the double-run determinism gate). Fidelity is gated checks passed / total.

Full-scale run ≈ 24 s (A–J all PASS); `--quick` ≈ 12 s with smaller budgets.

### Known-systems reverse-engineering registry (`benchmarks/knownSystems/`)

An inventory of 26 canonical models — 17 from the scientific literature (Pearson
random walk, Reynolds boids, Conway's Life, Lotka–Volterra, Fick/Einstein
diffusion, Turing/Gray–Scott, Nowak–May spatial IPD, Tilman R*, Vicsek, Wolfram
ECA, Langton's ant, Schelling, Kauffman NK, Mitchell GA, Avida, Tierra, Lenia)
and 9 flagship ABM-platform models (NetLogo Wolf–Sheep/Fire/Ants, Mesa
Schelling/Boltzmann, Repast Zombies/Sugarscape, FLAME GPU Boids/Pedestrian).
Each entry records author, year, the phenomenon it demonstrates, a citation, and
— where we ship an executable replication — the linked benchmark. **Every
replicated system also carries empirical targets**: a signature key, a value, a
tolerance, a `kind` (`measured` published number, `derived` closed-form
consequence, or `expected` qualitative regime) and its source. `knownRun.ts`
re-runs every linked benchmark, computes its **fidelity**, and scores it against
those literature bands independently of the model's own gating checks; entries
without a shipped replication are reported as `documented`. Currently **14/26
replicated**; the aggregate empirical fidelity counts only the strict
(`measured`/`derived`) targets, so a system whose source reports only a
qualitative regime is reported `inconclusive` rather than silently passed.

### Research-rigor layer (`benchmarks/rigor/`)

The benchmark suite proves the ten micro-models *behave*; the rigor layer asks the
next seven questions and records each as a typed PASS/WARN/FAIL check, so a claim
cannot pass merely because its model ran. It reuses the same model registry and
declarations (`analytic`, `empirical`, `params`, `interventions`) added to
`BenchmarkModel`, so a model can carry the evidence it will be judged on.

#### Hierarchy — four domains, one pipeline

The layer is read as a four-level hierarchy running from substrate to outcome.
Each level is built on the one below it, so a claim is only as strong as the
levels it rests on; the ordering `a → b → c → d` is also the order in which
evidence grounds upward.

| # | domain | sub-themes | benchmark evidence |
| --- | --- | --- | --- |
| **a** | **fundamental dynamics** | math · physics · computation · stochastic processes · information · graph theory · structures · patterns | A random walk · C Life · D Lotka–Volterra · E diffusion · F Gray–Scott |
| **b** | **multi-agent world** | agents · learning · evolution · networks · resources · environment | B boids · H resource R* · I collective navigation |
| **c** | **emergence analysis** | information · complexity · causality · phase transitions · metrics | J fractal-life composite |
| **d** | **macro phenomena** | life · intelligence · societies · cooperation · organization | G cooperation |

The hierarchy is a **reporting axis, not a code partition**: the domains order how
the layer is read, while the modules below are **cross-cutting** — each is
evaluated across every level rather than owned by one.

#### Cross-cutting modules

| module | question | method |
| --- | --- | --- |
| `verification.ts` | does the implementation equal the mathematics? | observed seed-cohort mean vs each model's `analytic` reference, gated on the **model's own declared tolerance** (its `eqAbs`/`range`/`gte`/`lte` check for that key) — an exact check (`tol = 0`) must reproduce exactly; a miss that still overlaps the reference in the bootstrap CI is a WARN, not a FAIL |
| `validation.ts` | does the model connect to an empirical / known system? | every replicated system carries **measured/derived targets** from the literature (value + tolerance + source); the linked benchmark is scored against those bands, not against its own gates. FAIL on a broken linkage or zero hits, WARN when only qualitative (`expected`) targets exist, PASS when every strict target lands in band |
| `reproducibility.ts` | does a run replay? | double-run fingerprint gate per model at full scale |
| `sensitivity.ts` | which knobs move the readout? | one-at-a-time (OAT) sweep of the first two knobs **plus a real Morris (1991) elementary-effects screen** — `r = 3` winding-stairs trajectories over 4 levels (`Δ = 2/3`), reporting μ (mean effect), μ\* (influence ranking) and σ (interaction/non-linearity) for every declared `params` knob |
| `ablation.ts` | does removing a mechanism do what the model claims? | applies each declared `intervention` and checks the predicted qualitative `effects` (increase/decrease/change) |
| `significance.ts` | is the effect more than a lucky draw? | **one-sample one-sided Student-t** on the full-scale seed cohort against each gating threshold, **Holm–Bonferroni** adjusted within each model family (FWER 0.05), **Sellke–Berger–Pericchi minimal Bayes factor**, and an exact **Clopper–Pearson** per-seed gate-consistency interval; the whole family is written to the deterministic `rigor-hypotheses.json` ledger |
| `novelty.ts` | is the suite distinctive and well-grounded? | scorecard over coverage (gated models), discrimination (reference kinds), fidelity, grounding (registry size), reproducibility, plus a signature-space hash of the per-model readout vector |

Outcomes are three-valued and honest: PASS only when the claim clears its bar;
WARN when the direction is right but the evidence is thin (a knob is inert for
the chosen readout, or a claim does not survive Holm correction); FAIL only on a
contradiction. `rigorRun` downgrades the overall verdict only on a hard FAIL,
never on a WARN, so the layer reports rather than manufactures failure. Measured
on the current suite: verification 16/16, reproducibility 10/10, sensitivity 9/9,
significance 8/9 families (A's diffusion-constant error is deliberately flagged:
its seed-mean 0.023 sits inside 3% but is not statistically distinguishable from
3% at n = 5), and validation scored against the published targets rather than the
model's own gates. Full run (default) evaluates all modules at full scale;
`--quick` shrinks the dev budget.

### LLM / AI-agent layer (`ai/`)

The rigor layer asks whether a *claim* is sound. The AI layer puts an open
language model into the loop as a **hypothesis generator and world governor** —
never as the source of a verdict. Three roles, all built on one provider
abstraction (`client.ts`):

| role | module | what the model may do | what the code still does |
| --- | --- | --- | --- |
| world mind | `worldAI.ts` + `controller.ts` | issue a handful of population-level `WorldParams` overrides between simulation windows, plus a one-line strategy per species | clamp every override to a whitelisted knob + range (`knobs.ts`), actuate it on the running engine, and measure the outcome against an unsteered control run |
| phase analyst | `phaseAnalyst.ts` | interpret measured order-parameter loci and recommend refinements | run the parameter sweep and compute every locus from real engine statistics |
| research agent | `researchAgent.ts` | propose falsifiable experiments over A–J, refining earlier rounds | evaluate every proposal with the benchmark harness; `supported`/`refuted` comes from the acceptance checks, not from the model |

#### Closed-loop world controller

`runWorldControl` is a genuine feedback loop, not a one-shot prompt: one engine
runs the whole experiment, so population history carries forward. An unsteered
warmup yields the first observation; then each window issues a directive from the
*current* state, actuates it, and measures the result, which becomes the next
window's input. A second, unsteered engine over the identical seed and tick
budget is the control, so "the AI helped" is a measured claim rather than an
impression — on the shipped demo it is honestly reported as *worse* than doing
nothing (alive 53 vs 139), with the oscillating overrides that caused it.

Actuation is `engine.params.<knob> = v` between windows — the same mechanism the
intervention engine uses (`engine.ts`). Only knobs the engine re-reads each tick
are actuated; `spawnCount` is construction-only, so it is reported as advisory
rather than silently written. The per-agent core is untouched, so the directive
is meta/collective control and the simulation stays deterministic.

#### Iterative research loop

`runResearchLoop` repeats **propose → evaluate → feed back**: the verdicts of
earlier rounds are rendered into the next round's prompt, proposals are
deduplicated by a stable key (`id|model|params|hypothesis`), and rounds stop
early when a round contributes nothing new or nothing conclusive. The result
carries a deduplicated, timestamp-free ledger that is fully derived from the
cached responses, so re-runs are idempotent.

Every proposal is scored by **parsimony** as well as accuracy (`benchmarks/parsimony.ts`):
the residual between the proposal's signature and the model's default is charged
2k (AIC) / k·ln n (BIC) for the free parameters it moved, so a hypothesis that
fits only by retuning more knobs cannot win on accuracy alone. The loop records
`harnessScored` (verdicts adjudicated by deterministic code) separately from
`harnessRuns` (verdicts from an actual benchmark run); a proposal that names no
known model is still adjudicated by the code, never by the language model.

#### Research scope & claims ledger (`scope.ts`, `claims.ts`)

The layers above each produce evidence in their own vocabulary — gates, fidelity,
PASS/WARN/FAIL, supported/refuted. The scope layer fixes, **before** any experiment
runs, what the whole program is claiming and what would refute it, then joins every
module's output into one ledger:

- **`scope.ts`** declares the research questions, what is in / conditional / out of
  scope, the method commitments (determinism, verification, validation,
  significance, ablation, parsimony, LLM-as-proposer), and the fixed claim registry.
  Per-model benchmark claims and per-system empirical claims are **derived from the
  registries** rather than hand-listed. `validateScope` refuses a claim with no
  falsifier or a question with no claim.
- **`claims.ts`** maps each evidence source onto that registry. A claim id the scope
  did not pre-register is dropped, so evidence cannot invent a claim; a claim with no
  evidence is reported `untested`, an honest `inconclusive` is distinguished from a
  refutation, and refutations are printed, not hidden.
- **`scopeRun.ts`** runs the full evidence bank and writes `SCOPE.md` +
  `output/claims.json`.

The shipped run reads `23/34 claims supported, 2 refuted, 9 inconclusive`. Both
refutations are genuine and useful: **C-AI-03** (the world controller measurably
under-performs doing nothing — alive 54 vs 139) and **C-SIG-01** (one directional
claim does not survive Holm correction). The nine inconclusive are the honest
boundary of the suite: those known systems publish only a *qualitative* regime, so
the ledger refuses to convert their gated PASS into an empirical claim and asks for
a measured target instead. The ledger also caught a real bug the gates did not — a
Conway glider target entered as `1` where the model reports `10` — because the target
key is checked against the model's declared signature.

#### Determinism — cache by default

Every call is hashed (`hash.ts`: key-order-independent SHA-256 over provider +
model + messages + sampler options) and stored in `research/output/ai-cache/`
(`cache.ts`). The default mode replays cached bytes, so a re-run reproduces the
previous trajectory bit-for-bit even if the model would answer differently.
`--live` (`cache: refresh`) forces a fresh call and then stores it, `--no-cache`
(`cache: off`) never reads or writes, and `--replay` (`cache: replay`) turns a
cache miss into a hard error, for CI. The `mock` provider is a deterministic
offline stand-in routed by the `TASK:` tag each prompt carries, so the whole
layer — including the controller and the multi-round loop — is exercised by
`test/ai.test.ts` with no model and no network.

## Statistics & probability conventions

- 95% CIs are Student-t (small-n corrected), computed exactly.
- p-values from Welch’s t, paired t, one-way ANOVA-F, two-proportion z; the
  regularized incomplete beta (`betai`) in `statistics.ts` backs t, F and the
  binomial quantiles, so no table lookups.
- Bootstrap: seeded mulberry32 (the splitmix64 constant overflows JS
  doubles — see the lattice RNG fix), B = 5000, percentile CIs; paired
  bootstrap resamples habitats jointly.
- Binomial intervals: exact Clopper–Pearson.
- **Interpretation:** every draw is seeded, so a p-value/winring-probability
  describes variability *across worlds* (habitats, biomes, fractal windows),
  never stochastic noise within one world. This is stated in every report.
- Determinism is a feature: rerunning a command reproduces results
  bit-for-bit. To validate, the test suites assert determinism per experiment
  (`apps/simulation/test/environments.test.ts`), at the engine level via the
  strict full-state hash (`apps/simulation/test/determinism.test.ts`), and
  across all four modes (`modes.ts` → `modes.md`).

## Validated findings (Phase M)

1. **Boundary-condition bug fixed (both lanes `physics.rs`/`physics.ts`):**
   coordinates were wrapped *before* the topology case ran, so the reflection /
   loop branches never fired and every topology behaved as a torus. The fix
   runs the case on raw coordinates then re-normalizes; a new Rust test
   (`caps_reflect_latitude_and_loop_wraps`) shoves an agent across the cap and
   asserts reflect-vs-wrap-vs-flip.
2. **Edge-seeding matters:** at short horizons a mid-world colony never meets
   an edge, making all five topologies observably identical. Topology runs are
   therefore north-cap edge-seeded; `edgeHits` counts real boundary
   engagements (torus 0, cylinder/sphere ~9k, klein ~2k total across 17
   biomes).
3. **kleinBottle > torus** for growth: the bootstrap win probability sits at
   ~70–85% on the 17 sampled habitats, but the *statistical* strength is honest:
   corrected ANOVA across topologies is F=0.24, p=0.913, and the paired
   klein-vs-torus t-test is p≈0.41 (n=17). The recentering point is not that
   topology is a strong driver, but that between-habitat variance is enormous —
   a win-rate of 70–85% with p≈0.4 is exactly the fingerprint of a small,
   consistent, hard-to-separate advantage. (Bayes ledger H-KLEIN posterior 0.50:
   undecided.)
4. **möbius < torus** (the cap half-twist scrambles longitude and costs colony
   coherence).
5. **sphere ≡ cylinder** in this model by construction (flat longitude seam).
6. **Fractal terrain:** julia > perlin windows consistently; coarse mandelbrot
   under hyperthermal is the worst regime (Δ−20); zoom helps in calm only.
7. **Dimensionality:** 1D bottlenecks colonization (~28% survival with an
   exact Clopper–Pearson 95% CI entirely below 2D); 2D–4D fully colonize;
   biomass rises ~1%/dimension and resource variance with it. Box walls are a
   mild tax only.

## Reproduce

```bash
# canonical experiments (17 + 85 + 36 runs; ~10 min)
npx tsx apps/simulation/src/research/environments.ts
npx tsx apps/simulation/src/research/environments.ts topologies    # per-axis
npx tsx apps/simulation/src/research/environments.ts dimensions
npx tsx apps/simulation/src/research/environments.ts environments

# lattice (6 worlds; seconds)
npx tsx apps/simulation/src/research/dimensional_worlds.ts

# causal decomposition (all 2^n arms x 2 densities + thresholds + backgrounds; ~16 min)
npx tsx apps/simulation/src/research/causalRun.ts
npx tsx apps/simulation/src/research/causalRun.ts --strict   # fail on any seed-dependent arm

# statistics + plots + analysis (+ 90 replicate runs; ~8 min)
npx tsx apps/simulation/src/research/analyze.ts

# cosmos world-axes experiments (78 runs; ~5 min)
npx tsx apps/simulation/src/research/cosmos.ts

# Bayesian ledger update (reads canonical CSVs; idempotent)
npx tsx apps/simulation/src/research/bayes.ts

# scientific modes — the determinism ladder (4 tiers; ~1–2 min)
npx tsx apps/simulation/src/research/modes.ts

# agent archetypes — the individual-complexity ladder (12 worlds; ~1 min)
npx tsx apps/simulation/src/research/archetypes.ts

# virtual complexity lab — partial differentiation over a micro parameter
npx tsx apps/simulation/src/research/complexity.ts --quick   # 472 exps, ~2.5 min
npx tsx apps/simulation/src/research/complexity.ts           # full, ~2900 exps, ~35 min
npx tsx apps/simulation/src/research/complexity.ts --dense   # ~5500 exps, ~60+ min

# emergence measurement layer — emergence as an object (12 / 36 worlds; ~1–2 min)
npx tsx apps/simulation/src/research/emergence.ts --quick    # capacity 150 only
npx tsx apps/simulation/src/research/emergence.ts            # full, capacities 60/150/400

# perturbation engine — one baseline, four single-axis perturbations (5 seeds; ~2 min)
npx tsx apps/simulation/src/research/perturbRun.ts            # writes perturbation.{md,json,csv}
npx tsx apps/simulation/src/research/perturbRun.ts --double-run   # replay every condition
npx tsx apps/simulation/src/research/perturbRun.ts --strict       # fail if an axis never opened

# canonical A-Life benchmark suite — models A–J (~24 s full / ~12 s quick)
npx tsx apps/simulation/src/research/benchmarks/benchRun.ts          # writes bench.{md,json,csv} + plots/bench.svg
npx tsx apps/simulation/src/research/benchmarks/benchRun.ts --quick  # smaller budgets

# known-systems reverse-engineering registry (fidelity re-runs; ~6 s quick)
npx tsx apps/simulation/src/research/benchmarks/knownRun.ts          # writes known.{md,json} + plots/known.svg

# research-rigor layer — verification/validation/reproducibility/sensitivity/ablation/significance/novelty
npx tsx apps/simulation/src/research/benchmarks/rigor/rigorRun.ts          # full; writes rigor.{md,json,csv} + rigor-hypotheses.json
npx tsx apps/simulation/src/research/benchmarks/rigor/rigorRun.ts --quick  # smaller budgets (dev)

# research scope + unified claims ledger — joins the whole evidence bank (~1 min)
npx tsx apps/simulation/src/research/scopeRun.ts                          # writes SCOPE.md + output/claims.json
npx tsx apps/simulation/src/research/scopeRun.ts --full                   # full-scale evidence
npx tsx apps/simulation/src/research/scopeRun.ts --determinism-seeds 5    # wider bit-exactness cohort

# LLM / AI-agent layer (open-source models via Ollama; default model qwen2.5:3b)
ollama pull qwen2.5:3b                                                      # once
npx tsx apps/simulation/src/research/aiRun.ts world                         # closed-loop controller vs unsteered control (replays the cache)
npx tsx apps/simulation/src/research/aiRun.ts world --windows 3 --window-ticks 120 --warmup 120
npx tsx apps/simulation/src/research/aiRun.ts phase                         # sweep + computed critical loci + LLM interpretation
npx tsx apps/simulation/src/research/aiRun.ts loop                          # multi-round proposals scored by the A-J harness
npx tsx apps/simulation/src/research/aiRun.ts loop --rounds 3               # rounds of propose -> evaluate -> feed back
npx tsx apps/simulation/src/research/aiRun.ts world --live                  # fresh call, then store it (--no-cache = never touch)
npx tsx apps/simulation/src/research/aiRun.ts loop --replay                 # cache-only: a miss is a hard error (CI)
npx tsx apps/simulation/src/research/aiRun.ts world --provider mock         # deterministic offline backend


# validate determinism + engine gates
cargo test --no-fail-fast
npx tsc --noEmit -p apps/simulation/tsconfig.json
npx tsx --test apps/simulation/test/*.test.ts
```

## Output index (`research/output/`)

| artifact | contents |
|---|---|
| `environments.md/csv/json` | 17 biome runs |
| `topologies.md/csv/json` | 85 edge-seeded topology runs + `edgeHits` |
| `dimensions.md/csv/json` | 36 fractal-regime runs |
| `lattice.md/csv/json` | 1D–4D + box |
| `replicates.md/csv/json` | 90 across-habitat replicate runs |
| `cosmos.md/csv/json` | 78 world-axes runs + qualitative hypothesis section |
| `bayes.md` | Bayesian ledger report (posteriors, evidence, reading guide) |
| `hypotheses.json` | machine-readable sequential-ledger (prior/posterior/history) |
| `plots/posterior.svg` | posterior bars per hypothesis |
| `modes.md/json/csv` | the four scientific modes: determinism (5 cases), debug trace, reproducibility fixtures, research (6 stochastic seeds) |
| `plots/modes.svg` | stochastic-vs-deterministic twins: final alive bars + first-divergence ticks |
| `archetypes.md/json/csv` | the agent complexity ladder: T0 simple rules → T1 constraints → T2 cognition → T3 systems, 3 seeds per tier, determinism double-run per world |
| `plots/archetypes.svg` | ladder curves: within-population heterogeneity + survival/learning per tier |
| `complexity.md/json/csv` | the virtual complexity lab: capacity × supply micro-parameter sweeps × 4 rule sets; per-axis partial derivatives, critical loci, attractor modes, feedback, hysteresis, scaling exponents, stability basin overlap, ensemble, capacity×supply interaction surface (§9), zoomed critical refinement w/ width+curvature (§10), phenomenon map |
| `plots/complexity.svg` | per-unit (∂/∂lg p) panels for capacity (right) and supply (left), criticality markers, attractor-mode bars, plus interaction-surface heatmaps (T1/T3 aliveFrac over capacity×supply) |
| `emergence.md/json/csv` | emergence measurement layer: five axes per world (micro-information bits · macro-information bits · LMC complexity · self-organization · temporal persistence) + emergent information (sync/predictive NMI) + composite emergence index + ABSENT/PARTIAL/EMERGENT verdict; phase-2 metric axes (order · species/trait polarization · aggregation · Moran I · fill factor · correlation length · Shannon/Simpson/evenness · synergy/redundancy/total bits · compressibility · LZ) and the population-level macro-state detector (dominant/final stage, progression, spatial structure, coordination, rigidity, persistence, organization, vitality, macroOrder vs agentOrder and their divergence); archetype ladder T0–T3 × 3 seeds × capacities 60/150/400, per-world determinism double-run |
| `plots/emergence.svg` | normalised emergence axes grouped by tier, emergence-index line against the EMERGENT band, and an exemplar microInfo/complexity/aggregation trace |
| `analysis.md` | the statistics + probability report (links plots) |
| `analysis.json` | machine-readable numbers |
| `causal.md/csv/json` | causal reverse-engineering: every one of the 2^n component arms at two densities, threshold sensitivity (factors 0.8/0.9/1/1.1/1.25) with per-factor relabel rates and transition counts, density sweeps, minimal sufficient sets, leave-one-out ablations, and replication on a second (`double-size`) genome background with variant separation/sense geometry |
| `plots/causal.svg` | arm behaviour labels, threshold-sensitivity curves, background comparison |
| `perturbation.md/csv/json` | single-axis perturbation engine: baseline (100 agents / capacity 100 / noise 0.1 / cooperation 0.5, read at tick 200) against `no-cooperation`, `noise-x2`, `cull-20pct` and `no-communication`, paired per seed; `deltaY = Y_perturbed - Y_baseline` with across-seed sd, sign-reversal flags, and a per-axis channel verdict (`exercised` / `partial` / `closed`) carrying the counter that decided it |
| `plots/perturbation.svg` | per-outcome deltaY bars by perturbation, with across-seed spread |
| `bench.md/json/csv` | canonical A-Life benchmark suite: models A–J, per-seed-aggregated signatures + 95% bootstrap CIs, gated-check outcomes (test/threshold/observed/CI/pass), fidelity and determinism per model |
| `plots/bench.svg` | fidelity by benchmark model (gated checks passed) |
| `known.md/json` | known-systems registry: 26 scientific + platform models with author/year/citation, linked benchmark, and replication fidelity for the 14 shipped replications |
| `plots/known.svg` | replication fidelity of the linked known systems |
| `rigor.md/json/csv` | research-rigor layer: per-module PASS/WARN/FAIL checks for verification, validation, reproducibility, sensitivity, ablation, significance and novelty, plus the novelty scorecard and signature-space hash |
| `rigor-hypotheses.json` | deterministic significance ledger: every directional claim with mean/sd/n, one-sided + two-sided p, Holm-adjusted p, minimal Bayes factor and outcome (fully derived ⇒ idempotent re-runs) |
| `ai-world.md/json` | the closed-loop world controller: warmup → observe → directive → actuate → measure windows, each decision's rationale and per-species strategies, the resulting trajectory, and a steered-vs-unsteered control comparison |
| `ai-phase.md/json` | a parameter sweep with computed order-parameter critical loci (sharpest adjacent change, median-relative sharpness) plus the LLM's interpretation and recommended refinements |
| `ai-loop.md/json` | multi-round research-agent proposals over models A–J: per-round tables with harness-evaluated supported / refuted / inconclusive verdicts and the cumulative deduplicated ledger |
| `ai-loop-ledger.json` | the deduplicated, timestamp-free research ledger (fully derived from cached responses ⇒ idempotent re-runs), with `harnessScored` / `harnessRuns` counts and per-proposal parsimony |
| `SCOPE.md` | the generated research scope: purpose, questions, in/conditional/out boundaries, method commitments, and the full claim ledger with each claim's verdict, falsifier and evidence |
| `claims.json` | machine-readable unified ledger: every claim's status / statistic / detail / source, per-question tallies, and the untested list |
| `ai-cache/*.json` | content-addressed LLM call cache (replay-safe determinism); safe to delete, re-populated on the next run without `--no-cache` |
| `plots/*.svg` | 6 deterministic charts |
| `*.md/csv/json` (root) | earlier CLI determinism reports (first/second/third-order, conservation) |