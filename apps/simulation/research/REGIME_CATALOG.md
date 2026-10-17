# Regime Catalog & Identification Mechanism

*Tree of Life — research catalog (formerly "Fractal Life v2").*

This catalog formalizes the identification logic, states, and transition rules extracted from the codebase. All thresholds/values are exact from source (TS).

Complementary catalogs:
- `research/SCALING_CATALOG.md` (scaling laws, derivation, dimensional engine, estimation/approximation, equation/proportion/correlation discovery, experimentation)
- `research/TEST_MATRIX.md` (gates/assertions)
- `research/SYSTEM_MAP.md` (system mapping)
- `research/UNIFIED_RECORD.md` (instrument record: detectors/observers/documenters/LLM-agents pegged to sections, hierarchies, loops, reciprocity, experiments, phases, categories + records index)

## 1) Identification Mechanism

The identification pipeline proceeds by reading public engine state (SimStats, agents, terrain grid) and computing derived indicators in order.

### A. Input Signals (observable)
- From engine/stats: `aliveCount, deadCount, speciesCount, energySum, births, deaths, complexity, diversity, cooperation, predatorFraction, cultureCount, meanAltruism, memeEntropy, speciesMemeMI, meanCooperation, meanAggression, meanRisk, meanDeception, meanFitness, meanATP, meanEnzyme, meanToxin, meanPH, chemicalDiversity, meanGlucose, meanProtein, activeSynthesisFraction, terrainOxygen, terrainPH, terrainToxin, meanDNAIntegrity, meanPathogenLoad, meanMembranePot, ...`
- From ladder trajectory summary (`LadderResult.summary`): `life.{finalAlive,minAlive,maxAlive,extinct,totalBirths,totalDeaths,netBirths,reproductionRate,cycling,carrionLoop,avgEnergyMean,avgEnergyCV,avgWaterMean,avgWaterCV,escapeDeaths,aliveFracFinal}`, `interaction.{maxSpecies,maxPredatorFraction,maxCooperation,maxMeanAltruism,maxKills,maxCompetition}`, `cognition.{foragingMean,foragingPositiveFrac,hazardCorr,signalCorr,signalTotalMean,headingEntropyMean,speciesMemeMIMax,cultureCountMax,memeEntropyMax,adaptationDelta,adaptationFrac}`

### B. Macro-regime identification (emergence.ts)
Compute per-tick indicators (spatial structure, coordination, macro-order proxies) and classify:
1. Let `collapsed` be true if sustained alive < `0.6 * refAlive` (weak) OR (species/energy both < 0.5*ref) (starved); window `0.1`, ref q `0.75` (699-704, 543, 567, 586). If `collapsed` → `collapsed` (dominates).
2. Let `spatial` = mean spatial structure score over run; `rigidity` = `macroRigidity(states)` where `k = ceil(|hist|/4)`, `rigidity = (sum of top-k counts)/n` (514-527).
3. Classify: `if (spatial>=0.55 && rigidity>=0.6) return 'specialized'` else `if (spatial>=0.42) return 'organized'` else `if (spatial>=0.3) return 'clustered'` else `'random'` (603-607).
4. Derive `persistence = same/(n-1)` for n>=2 else 0 (lag-1 agreement) (530-536). `dominant` = regime with largest fractional occupancy, ties broken by later stage in `['random','clustered','organized','specialized','collapsed']` (725). `progression` = distinct regimes in order of first appearance (710-719). `transitions` = count of regime changes (720-724).

### C. Hierarchical identification (ladder.ts)
Levels identified from summary/evidence:
- L0 (matter): `cycling` boolean (carrion loop + matter cycling)
- L1 life: EMERGENT if `totalBirths>0 AND minAlive>0 AND cycling==true`; PARTIAL if `minAlive>0` but not fully self-sustaining; ABSENT if `finalAlive<=0` (484-492).
- L2 interaction: EMERGENT if `maxSpecies>=2 AND (maxPredatorFraction>0.01 OR maxCooperation>1e-6 OR maxMeanAltruism>1e-6)`; PARTIAL if `maxSpecies>=2` only; ABSENT else (494-499).
- L3 cognition: EMERGENT if `(foragingMean>0.005 OR hazardCorr<-0.03 OR headingEntropyMean>0.3) AND (signalTotalMean>1e-6 OR cultureCountMax>1 OR memeEntropyMax>0) AND (adaptationDelta>0)`; PARTIAL if first conjunct true but others weaker; ABSENT else (501-513).

Mapping to scores: `verdictScore(EMERGENT)=1, PARTIAL=0.5, ABSENT=0` (objectives.ts 19-22). Prefix match `levelVerdict(r,prefix)` maps by level name starting with `L1`/`L2`/`L3` (fixed).

### D. Reciprocity identification (engine.ts)
Reciprocity channel active when: donor has `energy > cap * coopThreshold` and `out[5]>0.3` (signal output active), finds nearest neighbor with `energy <= cap*0.3` and `|meme_a-meme_nb| <= MEME_TOLERANCE` (0.05), and `gift>0`. Accounting: `totalDonated`/`totalReceived` increment by full gift (1288-1293); ledger invariant `∑totalDonated == ∑totalReceived` over all agents. Coop params: `coopThreshold = 0.75 - (coop-0.5)*0.2`, `coopScale = 0.4 + coop*0.6`, `DONATION_RATE=0.02`.

### E. Microstructure identification (complexity.ts)
- Attractor modes: KDE over [0,1] with `bw=0.08`, prominence filter `minProminence=0.02` (472-500); peaks via `findPeaks` (449-471, strict local maxima; prominence computed from valleys).
- Half-max width of derivative magnitude: find peak index of |d|, expand to half-height (595-607).
- Corr/feedback: lag-1 birth-population correlation `rhoBirthAliveLag1=corr(alive[:-1], births[1])`, overdispersion `stddev^2/mean` (503-509).
- Entropy: `entropyOf` bits (log2) (386-396).

### F. Phase identification (environments.ts, worldStoch.ts, modes.ts)
- Biome: `biomeClass(preset)` → `calm->control`, else if preset in EXTREME_PRESETS → `extreme`, else `underrated` (50-53).
- Weather state index `w ∈ {0,1,2,3}` for `['clear','rain','drought','heat']`; transition matrix row-sums to 1; effects on moisture/growth `[1.0,1.25,0.7,0.9]`, `[1.0,1.15,0.8,1.3]` (41-43).
- Scientific mode: `determinism|debugging (stoch=false)`, `reproducibility|research (stoch=true)` (59-80).

## 2) Catalog


### 2.1 Regimes
- Macro (emergence): random (spatial<0.3, rig arbitrary), clustered (0.3<=spatial<0.42), organized (0.42<=spatial<0.55 or 0.55<=spatial<specialized with rig<0.6), specialized (spatial>=0.55 and rig>=0.6), collapsed (dominant).
- Biome: control(calm), extreme(in EXTREME_PRESETS), underrated(other).
- Weather: clear/rain/drought/heat (4-state Markov).
- Modes: determinism/debugging(reproducible deterministic), reproducibility/research(controlled stochastic).


### 2.2 Macrostructures
- spatialStructure (mean per-tick), coordination (mean), rigidity = top-quartile concentration of regime states (k=ceil(n/4)), persistence = lag-1 agreement, organization/macroOrder, dominant (max occupancy, tie->later stage), progression (first-appearance order), transitions (count), fractions per regime. Sustained metrics: peakAliveFrac, referenceAliveFrac (q=0.75), terminalAliveFrac, firstCollapseTick. Collapse triggers at 0.6*refAlive (weak) or dual < 0.5*ref (starved); window 0.1.


### 2.3 Microstructures
- Attractor modes: KDE bw=0.08, prominence 0.02, findPeaks strict local maxima with valley prominence. Half-max width of |derivative|; corr (>=3 finite pairs); entropyOf bits (log2); feedback: rhoBirthAliveLag1 = corr(alive[:-1],births[1:]), overdispersion=var/mean. Lattice: volume=?dims, side=max dims, connectivity=2*N (N dims), topologies torus/box (wallFlux).


### 2.4 Hierarchical Structures
- Ladder: L0 matter (cycling). L1 life (EMERGENT if totalBirths>0,minAlive>0,cycling; PARTIAL if minAlive>0 incomplete; ABSENT if finalAlive<=0). L2 interaction (EMERGENT if maxSpecies>=2 and (predFrac>0.01 or coop>1e-6 or altruism>1e-6); PARTIAL if maxSpecies>=2 only; ABSENT else). L3 cognition (EMERGENT if (foragingMean>0.005 or hazardCorr<-0.03 or headingEntropyMean>0.3) and (signalTotalMean>1e-6 or cultureCountMax>1 or memeEntropyMax>0) and adaptationDelta>0; PARTIAL if first true; ABSENT else). Scores EMERGENT=1, PARTIAL=0.5, ABSENT=0; prefix-matched by level name.


### 2.5 Reciprocity
- Gate: donor energy>cap*coopThreshold and out[5]>0.3; nearest needy (energy<=cap*0.3) same-tag (|meme-meme_nb|<=0.05); gift = min(donor surplus to cap*0.5, DONATION_RATE*size*ts*cap*coopScale)>0. Accounting: totalDonated/totalReceived += gift (ledger exact identity ?donated==?received). Params: ALTRUISM_THRESHOLD=0.75, DONATION_RATE=0.02, MEME_TOLERANCE=0.05, coopThreshold=0.75-(coop-0.5)*0.2, coopScale=0.4+coop*0.6. Culture: MEME_COPY_RATE=0.02 * config.memeCopyRate (0 disables).


### 2.6 Phases & Transitions
- Biome phases: control/extreme/underrated partition of presets (calm->control; EXTREME_PRESETS -> extreme; else underrated). EXTREME_PRESETS = {anoxicTrench,hyperthermal,hypersaline,acidicCrater,sodaLake,cryoFrozen,irradiated,toxicSump}.
- Weather phases: 4-state Markov (clear/rain/drought/heat). Transition: clear->[0.85,0.08,0.04,0.03], rain->[0.18,0.75,0.02,0.05], drought->[0.10,0.03,0.82,0.05], heat->[0.15,0.06,0.05,0.74]. Effects moisture [1.0,1.25,0.7,0.9], growth [1.0,1.15,0.8,1.3].
- Macro transitions: random->clustered at spatial>=0.3; clustered->organized at >=0.42; organized->specialized at >=0.55 AND rigidity>=0.6; any->collapsed if sustained<0.6*ref or starved (0.5*ref). Collapsed is absorbing in classification (dominates). Window 0.1, q 0.75. Rigidity = top-quartile concentration (k=ceil(n/4)). Persistence = lag-1 agreement.
- Modes transitions: determinism->debugging (stoch off) -> reproducibility->research (stoch on seeded).
- Hierarchy transitions follow causal ladder (L0 cycling -> L1 life -> L2 interaction -> L3 cognition) with stated thresholds.


### 3) Regime Vector (R)
Defined in compact form:
- r_macro in {0,1,2,3,4} (random,clustered,organized,specialized,collapsed)
- s_spatial, rho_rig, pi_pers in [0,1] (spatial, rigidity, persistence)
- b_class in {0,1,2} (control, underrated, extreme)
- w_state in {0,1,2,3} (clear,rain,drought,heat)
- lambda_modes in {0,1,2,3} (determinism,debugging,reproducibility,research)
- h_{L1},h_{L2},h_{L3} in {0,0.5,1} (verdict scores)
- d_dim integer N (connectivity 2N)
- c_coop in [0,1], r_don >= 0 (cooperation/donation)

### 4) Strict Parameters (exact, manipulable)
- Macro thresholds: 0.3,0.42,0.55,0.6; collapse 0.6, window 0.1, q 0.75.
- Micro: KDE bw=0.08, prominence 0.02; findPeaks minProminence default 0; lattice dims/connectivity 2N, torus/box+wallFlux, growth/consume/yieldAv/death/ticks.
- Reciprocity: ALTRUISM_THRESHOLD=0.75, DONATION_RATE=0.02, MEME_TOLERANCE=0.05; coopThreshold=0.75-(coop-0.5)*0.2, coopScale=0.4+coop*0.6; needy cap*0.3, signal out[5]>0.3.
- Ladder: L1/L2/L3 thresholds as above; scores 1/0.5/0.
- World: spawnCount, timeScale, energyCapacity, maxPopulation, foodRegenRate, topology, switches (reproduction/sensing/signalDeposit/memeCopyRate/environment/...), brain config, world stoch (poissonRate=40, ouTheta=0.01, ouSigma=0.02, ouBand=0.25, weather matrix).
- Perturbation kinds: baseline/cooperation/noise/communication/cull.

