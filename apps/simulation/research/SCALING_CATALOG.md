# Scaling Laws, Derivation, Dimensional Engine, Estimation/Approximation, Discovery & Experimentation Catalog

*Tree of Life — research catalog (formerly "Fractal Life v2").*

All items derive from source code (complexity.ts, dimensional_worlds.ts, emergence.ts, ladder.ts, scenarios.ts, engine.ts, worldStoch.ts, statistics/stats/bayes.ts, perturb.ts, experiment.ts).

## 1) Scaling Laws

### 1.1 Power-law (log-log) scaling
- **fitLogLog(xs, ys)** (complexity.ts:536-574): linear regression in log space on valid pairs with `xs>0, ys>0`. Returns `{ slope, intercept, se, r2, n }`. 
  - Exact identities: for y = A x^b, slope = b, r^2 -> 1.
- **Discovery target**: power-law regime (SOC-like) detected by high r^2 on log-log and plausible exponent range; use with sufficient n>=3 valid points.

### 1.2 Temporal/rigidity scaling (macrostructure)
- **macroRigidity(states)** (514-527): concentration of macro-states = (sum of counts in top k)/n where `k = ceil(|hist|/4)`. Scales with how strongly trajectory locks into few states (top quartile share). Ranges [0,1].
- **macroStatePersistence(states)** (530-536): lag-1 agreement `same/(n-1)` for n>=2 (temporal repeatability). [0,1].
- **Sustained series/peak with window** (567-595): trailing window fraction `MACRO_WINDOW=0.1` gives `w=floor(n*0.1)`; scaling with window length affects collapse detection.

### 1.3 Dimensional scaling (lattice)
- **Geometry** (dimensional_worlds.ts): `volume = ∏ dims`, `side = max dims`, `connectivity = 2*N` where `N = dims.length` (edge-count per cell). Volume scales as product; connectivity linear in dimension.
- **Mixing length proxy**: `side^2` mentioned in comment (LatticeOutcome.side comment line 52) — useful for diffusion/mixing time scaling intuition.
- **Topology scaling**: torus (wrapped) vs box (with `wallFlux`) changes boundary effects (resource leakage/gradients).

### 1.4 Cultural/reciprocity scaling
- Effective copy rate: `MEME_COPY_RATE*config.memeCopyRate` (1311). Culture enabled when `(memeCopyRate??1)>0` (1802).
- Donation magnitude: `gift = min(energy - cap*0.5, DONATION_RATE * size * ts * cap * coopScale)` with `coopScale = 0.4 + coop*0.6`, `DONATION_RATE=0.02` (1286,1270). Scales linearly with `ts` (timestep), `cap`, `size` (grid size?), and cooperation.

### 1.5 Statistical scaling
- Standard errors: `T.se([x]) = sd/sqrt(n)`. Welch degrees of freedom approximated (statistics.ts welch). Bootstrap CI scales with B (default 5000) and seedKey for reproducibility.

## 2) Derivation

### 2.1 Macro-regime classification derivation (decision rules)
From (601-607): priority by collapse first (dominant), then specialized needs both spatial≥0.55 and rigidity≥0.6; else organized≥0.42; else clustered≥0.3; else random. Thresholds 0.3/0.42/0.55/0.6 chosen as stage boundaries; rigidity is top-quartile concentration (top-k where k=ceil(n/4)), so "specialized" requires both high spatial structure and high temporal rigidity (concentrated state trajectory).

### 2.2 Rigidity derivation (514-527)
For states sequence: build histogram of state values; counts sorted desc; k = max(1, ceil(m/4)) where m = number of distinct states (or total bins) — `counts.length` is number of distinct buckets with count>0. Top-k share of time: `∑_{i<k} counts_i / n`. Rationale: concentration in top quartile of distinct states.

### 2.3 Ladder verdict derivation (484-522)
- L1: self-sustaining = (totalBirths>0 AND minAlive>0 AND cycling). cycling is matter loops/carrion loop true. PARTIAL if persists (minAlive>0) but incomplete loop; ABSENT if extinct (finalAlive<=0).
- L2: differentiation + interaction = maxSpecies>=2 AND (predation OR cooperation/altruism signals) with thresholds 0.01 (predatorFraction) and 1e-6 (cooperation/meanAltruism). PARTIAL if species>=2 but no interaction above thresholds.
- L3: information use + communication/culture + adaptation = three conjuncts with exact thresholds: foragingMean>0.005 OR hazardCorr<-0.03 OR headingEntropyMean>0.3; AND (signalTotalMean>1e-6 OR cultureCountMax>1 OR memeEntropyMax>0); AND (adaptationDelta>0). PARTIAL if only first holds.

### 2.4 Reciprocity accounting derivation (1288-1293)
Energy transfer: donor loses `gift`, recipient gains `min(cap - kin.energy, gift)` in clamping but counters add full `gift`: `a.totalDonated += gift; kin.totalReceived += gift`. So ledger conservation `∑totalDonated == ∑totalReceived` is algebraically exact at the moment of transfer (sum over all agents changes by 0 net). The energy cap only truncates energy placement, not the recorded gift amount — invariant is by construction.

### 2.5 Perturbation genome derivation (perturb.ts 91-143)
baselineGenome sets specific genes: g[0]=1/3 (c=0 bounded), g[105]=5 (eat on), g[108]=5 (signal on), g[107]=-5 (hunt off herbivore), diet g[7]=-1, noise/cooperation via encodeWeight. perturbedGenome returns `new Float32Array(base)` (copy). Cooperation perturbation sets gene to `encodeWeight(0)=-1` (threshold-raising effect per comment), noise sets to `encodeWeight(factor??...)`, communication sets g[108]=-5, cull no edit.

## 3) Dimensional Engine

### 3.1 Lattice indexing (87-102)
Row-major over dims: `flat = f* d_k + idx_k`. Inverse divides by dims from high to low. Bijection for integer coords in [0,d_k).
### 3.2 Topology/folding (104-113, torus/box)
Torus: `((dim % side)+side)%side` (wrap). Box: reflect on edges (no wrap), with `wallFlux` parameter affecting resource flux at walls (solveLattice uses `wallFlux` in spec).
### 3.3 Geometry (117-119)
`N = dims.length`, `volume = ∏ dims`, `side = max dims`, `connectivity = 2*N`. These are exact dimensional measures.

### 3.4 SolveLattice (sketch of engine)
`solveLattice(spec)` runs a deterministic lattice simulation (uses seeded RNG class LWorldRng with mulberry-like sequence line 75-83). Returns `LatticeOutcome` with survivors/survival, finalBiomass, resourceMean/Var, shannon (bits), finalColonies, meanColonyDist, spread, esdRes. The dimensional engine maps geometry (dims/topology) to dynamics.

## 4) Estimation/Approximation

### 4.1 Statistical approximation
- Welch’s t: approximate df (Satterthwaite) via formula in welch() (statistics.ts).
- t-CDF via incomplete beta: `pFromT(t,df)` uses `betai(df/2,0.5, x)` with transformation x = df/(df+t^2) (line ~240-260 in statistics.ts). Exact in terms of the beta integral approximation used.
- Clopper–Pearson: binomial exact confidence intervals (uses F/incomplete beta forms) (clopperPearson).
- Normal CDF: `erf` approximation Abramowitz–Stegun 7.1.26 (statistics.ts 390-406), error < 1.5e-7 typical.
- Bootstrap: percentile method on resampled statistic; B samples (configurable), reproducible via seedKey.

### 4.2 Complexity estimation
- KDE for attractor modes: Gaussian kernel N(t,x)=exp(-0.5*((t-x)/bw)^2), sum over filled points, evaluated on 200 grid points (472-487). Bandwidth `bw=0.08` fixed; approximation of density.
- Peak prominence: local search left/right until crossing current peak value? Loops while `v[j]! > v[i]!` break, else update valley min (457-464) — standard topographic prominence approximation.
- Hysteresis: trapezoidal area over log10-p axis (518-526); pathIndex = fraction of points where `delta > 0.05*span`.

### 4.3 Macrostructure estimation
- Sustained reference: q-quantile of values array at `q=0.75` (543-548), approximated by linear interpolation via rounding.
- Sustained peak/series: moving average over trailing window of length `floor(n*0.1)` (567-595).

### 4.5 Bayesian approximation
- `sbpBF(p)`: Sellke–Berger–Pericchi minimal Bayes factor. Formula: if `p >= 1/e` return 1 else return `-e*p*Math.log(p)`. Capped at 1e6 (bayes.ts). Closed form approximation for “worst case” BF under certain priors.

## 5) Equation/Proportion/Correlation Discovery

### 5.1 Equation discovery (structure)
- Power laws: `fitLogLog` discovers exponent b (slope) and coefficient A (exp(intercept)), reports r^2 and n. Filters non-positive (540-546). Valid for `n>=3`.
- Linear relations via corr: `corr(x,y)` near ±1 indicates linear; near 0 uncorrelated (linear). Also `derivativeCentral` tests local linear slopes.
- Mixed partial: `crossPartial` computes discrete second mixed partial ∂²v/(∂c∂g) ≈ (v_{i+1,j+1}-v_{i+1,j-1}-v_{i-1,j+1}+v_{i-1,j-1})/(4*Δc*Δg) on grid; locates max |cross| (575-591) — discovers interaction strength/location.

### 5.2 Proportion discovery
- Macro regime fractions: `fractions[r]/n` per MACRO_REGIMES (708). Dominant by max fraction, tie -> later stage.
- Survival: `survivors/volume` (LatticeOutcome.survival). 
- Birth/death rates implicit in life summary (`reproductionRate`, `netBirths`).
- Clopper–Pearson gives exact binomial proportion CIs.

### 5.3 Correlation discovery
- Pearson `corr(xs,ys)` (complexity.ts 408-434, statistics.ts has variants): formula `cov/(sx*sy)`, uses sample means, requires >=3 finite pairs, returns 0 if constant/degenerate.
- Lag-1 correlations: `rhoBirthAliveLag1=corr(alive[:-1], births[1:])`, `rhoBirthLag1=corr(births[:-1], births[1:])` (503-505).
- Macro-level: `hazardCorr`, `signalCorr` appear in cognition summary (ladder).

## 6) Experimentation

### 6.1 Experiment runner (experiment.ts)
- `DEFAULT_OBJECTIVES = ['l1-emergent','l2-emergent','l3-emergent','adaptation']` (43)
- `resolveObjectives(ids?)` validates against registry; throws `unknown objective '${id}'` for bad ids (does NOT ignore) (experiment.ts). Registry built from `objectivesRegistry`.
- `ladderOptsFor(id, ticks?, spawnCount?, maxPopulation?, sampleEvery?)` returns `LadderOptions` with defaults ticks=12000, spawnCount=60, maxPopulation=400, sampleEvery=400 (experiment.ts).
- `runExperiment(name, seeds, opts?)` runs each seed via `runLadder`, computes `runDigest` = sha256 of `{worldFingerprint,trajectory,summary,synthesis}`, writes manifest to `research/experiments/<name>.json` with `manifestVersion: '2.0.0'`, includes `provenance.git`, `worldStoch`, `cellBio`, etc. (experiment.ts)
- `reproduceExperiment(manifest)` re-runs and compares digests (bit-identical required). CLI: `--list/--run/--verify/--ticks/--out`.
- Manifest fields include `options`, `results` per seed (worldFingerprint, ladderDigest, outcomeFingerprint), `env`, `createdAt`, `durationMs`.

### 6.2 Perturbation experimentation (perturb.ts)
- Suite: `PERTURBATIONS` has 5 conditions (baseline + 4 interventions), each with kind/id/axis/factor/fraction; `PERTURB_SEEDS` (5), `PERTURB_TICKS=200`. 
- `runDelta(seed,p,spec,doubleRun=false)` runs condition and baseline, returns deltas across `OUTCOME_KEYS` (10). `runPerturbationSuite(spec)` aggregates, `summarizePerturbation` computes mean/stddev/Cohen-ish and `channelVerdict` ('exercised'/'partial'/'closed') per channel exercise (donations, richAgentTicks, poorAgentTicks, signalDeposited, noiseAgentTicks, culled, neighboursPerAgent). `runPerturbationReport` produces full report; render/write SVG/MD/JSON.
- Interventions: cooperation sets gene to encodeWeight(0); noise sets to encoded factor; communication sets g[108]=-5; cull is runtime (no genome edit). Deterministic via seeded RNG/world.

### 6.3 Design/search experimentation (design module)
- `randomCandidate(params, seed)`, `evaluateCandidate(candidate, seeds, opts)` multi-seed, `randomSearch(params, budget, seeds, opts)` returns top-K elite by score. Objectives pluggable via registry.

### 6.4 Modes experimentation (modes.ts)
- Scientific modes ladder (determinism/debugging/reproducibility/research). Generates modes.md/json/csv/svg with twin comparisons (det vs stoch divergence, double-run identity). Research requires stochastic twins diverge at some tick and same-seed stochastic replays identically.

## 7) Catalog Index (own catalog)

This document is the **SCALING & DERIVATION CATALOG** (`research/SCALING_CATALOG.md`). It complements:
- `research/REGIME_CATALOG.md` (regimes, macro/micro/hierarchical/reciprocity/phases/transitions + vector + strict params)
- `research/TEST_MATRIX.md` (gates/assertions)
- `research/SYSTEM_MAP.md` (system mapping)
- `research/UNIFIED_RECORD.md` (instrument record: detectors/observers/documenters/LLM-agents pegged to sections, hierarchies, loops, reciprocity, experiments, phases, categories + records index)

Key exported mechanisms:
- Scaling laws: log-log power law (fitLogLog), top-quartile rigidity, windowed sustained metrics, dimensional (volume/connectivity/side), cultural/donation linear scaling, statistical SE/bootstrap.
- Derivations: decision rules for classification/ladder/reciprocity/perturbation (with exact thresholds).
- Dimensional engine: indexing, topology (torus/box+wallFlux), geometry, solveLattice.
- Estimation/approximation: Welch/Satterthwaite, beta/incomplete-beta t-CDF, Clopper–Pearson, A&S erf, KDE+prominence, trapezoidal hysteresis, q-quantile, trailing window, SBP BF.
- Discovery: equation (power law exponent/r^2, mixed partial), proportion (fractions/survival/CIs), correlation (Pearson, lag-1).
- Experimentation: experiment runner (manifests/digests/repro), perturbation suite (deltas/channel verdicts), design/search, scientific modes.

All numeric thresholds/constants listed verbatim from source.
