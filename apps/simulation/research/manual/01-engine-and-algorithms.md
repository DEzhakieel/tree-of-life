# 01 — Engine and Algorithms

*Tree of Life — technical manual, part 1.*

This part specifies the **whole simulation engine**: the runtimes, the data
model, the exact ordered tick algorithm, and the mechanism + algorithm of every
subsystem. For the mathematical derivation of the equations see
[03-mathematical-foundations.md](03-mathematical-foundations.md); for how the
phases were added over time see [04-model-evolution.md](04-model-evolution.md).

---

## 1. Architecture and runtimes

The same model runs in five places; three are first-class and must stay in
lock-step.

| Surface | Path | Role |
|---|---|---|
| **TS reference engine** | `src/engine.ts` | canonical, testable implementation; the source of truth for research. |
| **Rust authority** | `crates/simulation/src/*.rs` | native engine; mirrors the TS update order. |
| **WASM build** | `crates/wasm/src/lib.rs` | Rust compiled to WASM; runs the *full* physics/bio stack in the browser/server. |
| **Worker engine** | `src/…` worker entry | runs the TS/WASM engine off the main thread. |
| **Server engine** | `apps/server/src/engine/wasmEngine.ts` | headless world hosting over WS/REST. |

**Parity contract.** The TS engine and the Rust engine must produce identical
results for the same seed. This forces deliberate matching of RNG draw
*counts* (e.g. `recombineGenomes` performs a fixed number of draws regardless
of branch, `genome.ts`), identical tie-breaking, and identical float order.
Everything stochastic is keyed from `(worldSeed, streamTag, tick[, agentId])`
via FNV-1a-32 (`rng.ts:68-93`).

**Opt-in depth.** `WorldConfig` (`types.ts:124`) gates the heavy layers:
`cellBio`, `biophysics`, `omics`, `omicsStochastic`, `combinatorial`,
`discovery`, `folding`, `recombination`, plus Phase-M `environment` and
`topology` (`types.ts:124-167`). With a flag off, its state is absent and its
observables read zero. In the **TS reference**, the biophysics / discovery /
quantum / subatomic / stat-mech observables are written as zeros on purpose
(`engine.ts:1626-1630`, `:2379-2383`) — those are computed only by the Rust/WASM
engine. Detectors must therefore treat those channels as *absent/DORMANT*, not
zero (see `lifeOrganization.ts:11`).

---

## 2. Data model

### 2.1 World

- Grid: `WORLD_SIZE = 2048`, `SPATIAL_CELL = 32`, `TERRAIN_CELL = 16`,
  `TERRAIN_GRID = 128`, `TICK_RATE = 60`, `MAX_AGENTS = 12000`
  (`constants.ts:307-347`).
- Terrain grids (per `TERRAIN_GRID²` cell): `height`, `food`, `minerals`,
  `cap`, plus chemical terrain `O2`, `pH`, `toxin`, `minerals`
  (`chemistry.ts`).
- Fixed-point bookkeeping: `FIXED_POINT = 64` (`constants.ts:337`).

### 2.2 Agent (`agent.ts:171-256`)

An agent aggregates: genome (`Float32Array`), phenotype, physics state
`(x,y,vx,vy)`, `energy`/`water`/`age`, drives + strategy vectors, Mandelbrot
niche `(cRe,cIm,zRe,zIm,orbitDepth)`, chemistry, optional omics, `dna`, `cell`,
`immune`, `predPrey`, `repro`, `metabolism` sub-states, trophic level, fitness
components, per-domain gene blocks, and `brain: BrainState`. Sub-state bounds
include `immune.pathogenLoad ∈ [0, MAX_PATHOGEN_LOAD = 100]` (`agent.ts:13-30`).

### 2.3 Genome layout (`constants.ts:17-293`)

217 genes (`GENOME_SIZE`) laid out as `[0..10]` phenotype; `[11..109]` the
static MLP (`MLP_WEIGHTS = 99` = `W1[60]+b1[4]+W2[28]+b2[7]`, `MLP_INPUTS=15`,
`MLP_HIDDEN=4`, `MLP_OUTPUTS=7`); `[110..115]` drives; `[116..119]` strategy;
`[120..127]` chemistry; `[128..135]` DNA; `[136..143]` immune; `[144..151]`
predator-prey; `[152..159]` reproduction; `[160..167]` metabolism;
`[168..175]` cell; `[176..183]` ecosystem; `[184..191]` membrane; `[192..207]`
Elman recurrent `rec[16]`; `[208..212]` critic `cv[4]+cb`; `[213..216]`
plasticity `(inherit, lr, γ, λ)`. Offsets: `BRAIN_OFFSET=11`,
`DRIVE_OFFSET=110`, `STRATEGY_OFFSET=116`, `CHEM_OFFSET=120`, `DNA_OFFSET=128`,
`IMMUNE_OFFSET=136`, `PREDPREY_OFFSET=144`, `REPRO_OFFSET=152`,
`METAB_OFFSET=160`, `CELL_OFFSET=168`, `ECOSYSTEM_OFFSET=176`,
`MEMBRANE_OFFSET=184`. Note `GENOME_SIZE = 217` but `baselineGenome()` returns a
length-256 array; `NOISE_IDX = 115`, `COOP_IDX = 117`.

### 2.4 Default world parameters (`types.ts:708-725`)

`cReal=-0.8`, `cImag=0.156`, `maxIter=256`, `escapeRadius=2**16`,
`centerX=-0.6`, `centerY=0`, `worldScale=4`, `spawnCount=300`,
`metabolismBase=1`, `maxPopulation=4000`, `foodRegenRate=0.0003`,
`energyCapacity=100`, `agentMaxAge=4000`, `timeScale=1`, `dayLength=2400`,
`seasonLength=20000`.

### 2.5 Environment presets (`types.ts:76-94`)

`ENV_PROFILES` maps a name to `(o2, ph, toxin, minerals, waterFactor, heat)`;
19 presets span `calm`, `anoxicTrench`, `hyperthermal`, `hypersaline`,
`acidicCrater`, `sodaLake`, `cryoFrozen`, `irradiated`, `toxicSump`,
`limestoneCave`, `gutLumen`, `termiteMound`, `rhizosphere`, `wetlandMarsh`,
`desertDune`, `hotSpring`, `canopyTop` (1 control + 8 + 10 `EnvironmentPreset`
values). `BiomeClass = 'control'|'extreme'|'underrated'`.

---

## 3. The canonical tick algorithm

`Engine.tick()` (`engine.ts`) executes subsystems in a **fixed order**. Agents
are visited in ascending id within the per-agent block; the world block runs
once after. The order matters for parity and for the direction of causality.

```
tick():
  1  day/night + season fields                       engine.ts:618
  2  stochastic world (weather, OU, burst)           engine.ts:626
  3  ecology-grounding crowding pressure             engine.ts:671
  -- per agent (ascending id) -------------------------------------------------
  4  Mandelbrot orbit update  z <- z^2 + c           engine.ts:736
  5  sample chemical terrain at (x,y)                engine.ts:769
  6  neighbour scan (spatial hash)                   engine.ts:776
  7  pattern-drives -> thrust vector                 engine.ts:875-963
  8  movement + slope physics (+ climb cost)         engine.ts:966
  9  metabolism + climb tax                          engine.ts:1003
 10  water balance                                   engine.ts:1025
 11  feed (food/meat intake)                         engine.ts:1031
 12  chemistry tick                                  engine.ts:1055
 13  DNA tick                                        engine.ts:1067
 14  omics tick (opt-in)                             engine.ts:1076
 15  cells tick                                      engine.ts:1095
 16  cell-bio tick (opt-in)                          engine.ts:1101
 17  immune tick                                     engine.ts:1120
 18  metabolism tick                                 engine.ts:1137
 19  predator-prey interaction                       engine.ts:1151
 20  dormancy                                        engine.ts:1164
 21  reproduction gene tracking                      engine.ts:1173
 22  costly signalling                               engine.ts:1247
 23  greenbeard donation loop                        engine.ts:1263
 24  memetic imitation                               engine.ts:1298
 25  reproduction                                    engine.ts:1318
 26  brain learning                                  engine.ts:1446
  -- end per-agent ------------------------------------------------------------
 27  biome re-injection (Phase M)                    engine.ts:1497
 28  replicator projection (every 100 ticks)         engine.ts:1524
 29  fitness / birth / events                         engine.ts:1536-1560
 30  math / biophysics / phase observables            engine.ts:1604-2474
  -- world half ---------------------------------------------------------------
 31  carrion -> meat                                  engine.ts:1687
 32  decomposition -> soil                            engine.ts:1728
 33  plant growth (weather/growth mods)               engine.ts:1736
 34  weathering                                      engine.ts:1752
 35  signal diffusion                                 engine.ts:1772
 36  stats()  -> SimStats                             engine.ts:1787
```

The donation loop (`engine.ts:1269-1293`) is the model's one exact identity:
`Σ totalDonated === Σ totalReceived`. Reproducing agents pay a cooperative
throttle; the guard uses `params.maxPopulation` and `MAX_AGENTS`
(`engine.ts:2200`).

---

## 4. Subsystem specifications

Each entry gives the **mechanism** (what real process it models), the
**algorithm** (the update in words + key expressions), and **parameters**.

### 4.1 Terrain — fractal escape-time field (`terrain.ts`)

*Mechanism:* a Mandelbrot/Julia escape-time field supplies terrain height,
energy, and hazard; fBm value-noise is an alternative.

- `CELL=16`, `GRID=128` (`terrain.ts:13-14`).
- `escapeTime` (`terrain.ts:25-53`): iterate `z ← z² + c`. Mandelbrot `z₀=0`,
  `c=(re,im)`; Julia `z₀=(re,im)`, `c=params`. Recurrence
  `nextRe = z_re² − z_im² + c_re`, `nextIm = 2·z_re·z_im + c_im`. Interior
  (`it ≥ maxIter` or `|z|² ≤ 1`): `ν = maxIter`, `phase = atan2(z_im,z_re)`.
  Smooth escape: `ν = it + 1 − log₂(ln|z|² / ln B)`, `B = escapeRadius`;
  `phase = atan2(z_im,z_re)` (`terrain.ts:50-52`).
- Perlin mode (`terrain.ts:63-111`): integer hash (mulberry finalizers),
  smoothstep `t²(3−2t)`, bilinear value noise, 4-octave fBm (`amp*=0.5`,
  `freq*=2`); `ν = (v·0.5+0.5)·maxIter`, `phase = v·π`.
- `buildTerrainGrid` (`terrain.ts:140-222`), `Δc = worldScale/size`:
  - `moisture = min(1, 3·|ν(x+Δ) − ν(x−Δ)|)` (central diff in x).
  - `baseMinerals = min(1, 6·(|ν_xP − ν_xM| + |ν_yQ − ν_yR|))` ≈ `|∇ν|`.
  - `hazard = min(1, 10·sqrt(Var[4 diagonal it counts]) / maxIter)`.
  - `height = ν/maxIter`; `energy = 0.5 + 0.5·cos(2πν)`;
    `cellCap = energy·energyCapacity·4`; `chem = (phase/π + 1)/2`.
  - `minerals = baseMinerals·cellCap·0.3`; `food = 0.35·cellCap`; `cap = cellCap`.
- Bilinear sampling (`terrain.ts:243-322`) uses the standard
  `a + (b−a)f_x + (c−a)f_y + (d−b−c+a)f_x f_y` with clamped indices.

### 4.2 Stochastic world (`worldStoch.ts`)

*Mechanism:* Markov weather regimes, Ornstein–Uhlenbeck resource fluctuations,
Poisson burst regeneration.

- Defaults: `poissonRate=40`, `ouTheta=0.01`, `ouSigma=0.02`, `ouBand=0.25`
  (`worldStoch.ts:45-52`).
- Weather transition matrix P (`worldStoch.ts:34-39`), one uniform draw:
  `next = min{k : U < Σ_{j≤k} P[weather][j]}` (`stepWeather`). States
  `clear/rain/drought/heat`; `WEATHER_MOISTURE=[1.0,1.25,0.7,0.9]`,
  `WEATHER_GROWTH=[1.0,1.15,0.8,1.3]`.
- OU (`stepOu`): `x ← x + θ(1−x)·ts + σ·√ts·z`; multiplier
  `mul = clamp(x, 1−band, 1+band) ∈ [0.75,1.25]`.
- Poisson (`poissonDraw`): Knuth, capped `k<1000`.
- Burst (`stepBurst`): rejection-sample `min(count,n)` distinct cells.

### 4.3 Movement and topology (`physics.ts`)

*Mechanism:* momentum transport with drag plus gravitational work against
terrain; a conservative energy ledger (climb spends energy, descent never
refunds).

- Constants: `DRAG=0.86`, `SLOPE_TAX=0.4`, `SLOPE_BOOST=0.5`, `SLOPE_CAP=1.6`,
  `CLIMB_COST=4` (`physics.ts:21-28`).
- Retention retune (`physics.ts:118-120`):
  `retention = conservationLaws.momentumRetention ?? 1`;
  `drag = DRAG^(1/max(retention,1e−2))`; `thrustScale = (1−drag)/drag`.
- Resistance/throttle (`:123-124`): `resist = (1+1.2·hazard)(1+0.4·(size−1))`;
  `throttle = (waterFrac<0.2 ? 0.6 : 1)/resist`.
- Preview + slope (`:127-137`): `p_v = (v + thrust·speed·thrustScale·throttle)·drag`;
  `dh = h(p) − h(x,y)`; uphill `thrustMod = max(0.25, 1−0.4·dh)`, downhill
  `thrustMod = min(1.6, 1−0.5·dh)`, else 1.
- Velocity update (`:139-142`): `v_{t+1} = (v_t + thrust·speed·thrustScale·thrustMod·throttle)·drag`
  (thrust is **not** scaled by `ts`; drag is a per-tick factor, not `e^{−k·ts}`).
  Steady state `v* = thrust·speed·thrustMod·throttle` (derivation in part 03).
- Escape clamp (`:146-154`): `|v| > v_esc ⇒ v ← v·v_esc/|v|`.
- Position (`:156`): `x_{t+1} = boundary(x + v_x·ts)`.
- Topology (`:74-113`): longitude always wraps mod `L`; `cylinder/sphere`
  reflect `y` (and flip `v_y`); `mobius` reflects `y` + `x→L−x`; `kleinBottle`
  reflects `y` *without* flipping `v_y` and `x→L−x`; `torus` wraps both.
- Displacement (`:167-173`): torus minimal image `|dx|>L/2 ⇒ dx∓L`.
- Climb cost (`:176,185`): `dh>0 ⇒ climbCost = dh·climbCostScale·size`.

### 4.4 Spatial hash (`spatialHash.ts`)

Uniform cell-list neighbour grid. `cellSize = 32`, `cellCount = ⌈2048/32⌉ = 64`;
key `k = (cx + cy·cellCount) >>> 0`; `cx=⌊x/32⌋`. Queries scan
`(2·span+1)²` cells with `span = ⌈radius/cellSize⌉` and a squared-distance test.
Plain (non-wrapping) distances — no torus minimum-image here. Typed arrays grow
×2.

### 4.5 Chemistry (`chemistry.ts`)

*Mechanism:* stoichiometric digestion, enzyme-catalysed metabolism
(respiration, synthesis, ion pumps), reaction–diffusion of O2/toxin/minerals/pH.

- Counts: `ELEMENT_COUNT=8` (C,H,O,N,P,S,Fe,K), `MOLECULE_COUNT=12`
  (glucose,ATP,aminoAcid,lipid,nucleotide,enzyme,protein,toxin,signal,sugar,
  fattyAcid,osmolyte), `ION_COUNT=5`, `ENZYME_TYPE_COUNT=6`
  (`constants.ts:354-394`). Caps `100/100/50/20`; `REACTION_RATE=0.004`,
  `CHEM_DIFFUSE_RATE=0.08`, `PH_NEUTRAL=7`, `PH_RANGE=4`,
  `MINERAL_ION_RATE=0.0005`.
- Stoichiometry (`chemistry.ts:168-169`): plant `[6,4,3,1.5,0,0,0,0]`, meat
  `[5,3,0,3,1.5,1,0.8,0]`.
- `tickAgentChemistry` (`:171-401`): pH relax `pH += (pH_env−pH)·0.002·dt`;
  `pHmod = max(0.1, 1−|pH−7|/4)`; uptake, digestion `intake·0.032·pHmod·dt`;
  enzyme-gated reactions with `rate = enzyme·catMod·pHmod·0.004·dt`,
  `catMod = 0.3+1.4·catalysisGene` (oxidase, synthase, ligase, transferase,
  lyase, hydrolase); enzyme synthesis, decay, toxin production/absorption, ion
  pump, osmolyte, signal, and an energy ledger `ΔE = ATP·0.002·dt − (Σmol)·0.00005·dt`.
- `tickChemTerrain` (`:411-480`): explicit diffusion with a toroidal 5-point
  Laplacian, `diffRate=0.08·dt`, scaled ×1 O2, ×0.5 toxin, ×0.3 minerals; O2
  driven by `food·daylight·0.001`; pH toward neutral; toxin by `meat`; minerals
  by supply + acidity.

### 4.6 Cells (`cells.ts`)

*Mechanism:* resting potential from the K/Na ratio, osmotic tension, cell-cycle
progression, passive/active transport, endo/exocytosis.

- `MEMBRANE_TRANSPORT_COST=0.001`, `CELL_DIVISION_THRESHOLD=0.8`.
- `createCellState` (`:108-124`): `radius = 3+5·cellSize`,
  `membranePotential = −70 mV`, `integrity=1`, `mitoEfficiency=mitoCount`,
  `ribosomes=ribosomeCount`.
- `tickCell` (`:130-193`): `V_m = −70 + 30·(K/(Na+0.001) − 1)`;
  `tension += 0.001·dt·|Na+K−Cl|`, `tension *= 0.99`;
  `integrity ← clamp(integrity − 0.01·tension·dt + 0.0003·membraneThickness·dt, 0, 1)`;
  lysis if `tension>0.5`; cell cycle
  `divisionProgress += 0.0005·cellSize·dt·energy·0.1`, divide if `progress ≥ 1 ∧ energy>0.8`
  (timer 60).
- Helpers: `membraneTransport`, `activeTransport`, `endocytosis`, `exocytosis`,
  `proteinSynthesisRate`, `mitochondrialAtp`, `receptorSensing`.

### 4.7 Cell biochemistry (`cellbio.ts`, opt-in `cellBio`)

*Mechanism:* proteostasis (chaperone refolding), enzyme kinetics with
end-product inhibition, membrane transport, Na/K pump, mitochondrial
respiration.

- Constants: `MM_KM=10`, `MM_INHIBITION=0.3`, `CHAPERONE_FOLD_RATE=0.02`,
  `CHAPERONE_ATP_COST=0.05`, `PROTEIN_TURNOVER_RATE=0.005`,
  `MISFOLD_STRESS_DECAY=0.01`, `MISFOLD_MEMBRANE_DAMAGE=0.005`,
  `PASSIVE_DIFFUSION_RATE=0.005`, `GRADIENT_PROPAGATION_RATE=0.01`,
  `LIPID_REPAIR_RATE=0.01`, `LIPID_REPAIR_ATP=0.03`,
  `FOLDING_SULFUR_SENSITIVITY=0.3`.
- `michaelisMentenRate` (`:79-83`): `v = Vmax·s/(s+10)·1/(1+0.3·(p/100))`.
- `tickFolding` (`:111-168`): stress from pH/tension × sulfur factor; chaperone
  synthesis via MM; per-class fold quality
  `q ← clamp(q − 0.005·dt − 0.25·stress + 0.02·q_CHAP·(1−q)·dt, 0, 1)`;
  misfold accumulation and membrane damage.
- `tickMembraneBiochemistry` (`:180-276`): external medium from terrain; passive
  diffusion; Na/K pump (`naPump=min(naExcess,pumpRate)`,
  `kPump=min(kDeficit,0.8·pumpRate)`, cost `(naPump+kPump)·0.001`); mitochondria
  `mito = mitoBase·MM(1,glucose,ATP)`; lipid repair; endo/exocytosis.
- `tickGradientFlux` (`:282-300`): `flux_i = (gradient_i−bulk_i)·0.01·(0.5+cyto)(0.5+vesicle)·dt`,
  mass-conserving except at zero clamps.

### 4.8 DNA (`dna.ts`)

*Mechanism:* mutagenic damage accumulation, ATP-costed repair, expression
drift, methylation silencing, transposons, horizontal gene transfer.

- `DNA_BASE_ERROR_RATE=0.001`, `DNA_REPAIR_COST=0.5`, `EXPRESSION_BLOCKS=24`,
  `EPIGENETIC_SIZE=24`.
- `tickDna` (`:82-149`): damage `0.001·(1−0.8·dnaStability)·dt`; integrity decay
  if `D>0.1`; repair if `D>0.01 ∧ ATP>0.5`
  (`repaired=min(D,0.1·η·dt)`, `η=repairRate·repairAccuracy`); expression drift;
  epigenetic Bernoulli `U<0.005·epigeneticNoise·dt`; transposon Bernoulli
  `U<1e−4·transposonRate·dt`; mutation event
  `p_mut = 0.001·(1−0.9·replicationFidelity)·(1−0.5·integrity)`.
- `replicationFidelity` (`:155-173`): `errorRate = 0.001·(1−fidelity)·(1−0.3·integrity)`.
- `getEffectiveExpression` (`:179-187`): methylated ⇒ `base·0.1`.
- `horizontalGeneTransfer` (`:193-207`): accept iff `U ≤ 0.001·hgtGene`;
  `blockSize = 4 + ⌊13U⌋`.

### 4.9 Genome (`genome.ts`)

*Mechanism:* genotype→phenotype map, Gaussian point mutation, crossover,
cosine-species metric, static MLP controller.

- `decodePhenotype` (`:62-79`), with `u=clamp01((g+1)/2)`:
  `speed=0.5+4u`, `senseRadius=8+56u`, `metabolism=0.02+0.23u`,
  `size=0.5+2u`, `diet=u`, `fertility=0.4+1.6u`, `longevity=0.5+u`,
  `mutability=0.25+1.75u`.
- `fastTanh` (`:55-60`): Padé `tanh(x) ≈ x(27+x²)/(27+9x²)`, saturate `|x|>4`.
- `fractalGenes` (`:263-268`): `cRe=−2+3·u(g0) ∈ [−2,1]`,
  `cIm=−1.25+2.5·u(g1) ∈ [−1.25,1.25]`.
- `mutateGenomeScaled` (`:280-296`): per gene, if `U<rate` then
  `g ← clamp(g + N(0,1)·σ, −1, 1)`; defaults `MUTATION_RATE=0.05`,
  `MUTATION_SIGMA=0.05`.
- Recombination (`:303-406`): `spliceGenome` (block 8), `crossoverGenome`
  (single-point), `multiPointCrossover` (`RECOMB_MAX_POINTS=5`),
  `blockShuffle` (4 random block pairs), `combinatorialAssembly`, and
  `recombineGenomes = multiPoint → assembly → shuffle` with fixed draw count.
- `genomeSimilarity` (`:409-421`): cosine; `isSameSpecies` iff `> 0.9`.
- `forwardGenome` (`:436-467`): static MLP
  `h_j = fastTanh(b1_j + Σ s_i W1[i,j])`,
  `o_j = j<2 ? fastTanh(z_j) : σ(z_j)`.

### 4.10 Brain (`brain.ts`)

*Mechanism:* plastic recurrent RNN with a TD(0) value critic and either
three-factor reward-modulated Hebbian plasticity or backprop SGD; Lamarckian
weight inheritance.

- Hyperparameter genes (`:135-136`): `lr = 0.001+0.049·u`, `γ = λ = 0.8+0.19·u`.
- `spawnBrain` (`:167-178`): `w_child ← w_template + α·(w_parent − w_template)`.
- `forwardBrain` (`:190-207`): Elman recurrence
  `h_j = fastTanh(b1_j + Σ s_i w_{i,j} + Σ h_k^{t−1} rec_{k,j})` (`rec` fixed at
  birth); `o_j = fastTanh` for motor heads, `sigmoid` otherwise;
  `V = cb + Σ h_i·cv_i`.
- `observeBrain` (`:213-236`): TD error `δ = r_prev + γV_t − V_{t−1}`;
  eligibility `e ← λe + h·o`; `rpe = clamp(δ,−1,1)`;
  `w ← clamp(w + lr·rpe·e, −2, 2)` on the hidden→output block.
- `backpropBrain` (`:254-326`): value head `cv += lr·rpe·h`, `cb += lr·rpe`;
  output `dz_m = (−rpe + ent)·dAct_m`, `dAct_m = (m<2)?1−o²:o(1−o)`;
  hidden `g_j = gH_j·(1−h_j²)`; SGD steps with weight clamp `±2`, value clamp
  `±4`; optional dropout mask + Gaussian gradient noise.
- `policySigma` (`:329-333`): entropy anneal `σ(t)=σ_min+(σ₀−σ_min)(1−t/T)`.
- `sampleGaussianAction` (`:342-360`): `act_m = clamp(out_m + σ·ε, −1, 1)`.
- `stepPomdp` (`:384-408`): per hidden channel
  `obs = clamp01(raw + η·noise)`, `belief ← belief + gain·(obs−belief)`,
  `sensor = (1−w)·obs + w·belief`; defaults `noise=0.08`, `gain=0.2`, `weight=0.4`.

### 4.11 Ecosystem (`ecosystem.ts`)

*Mechanism:* trophic resource fields with competition/mutualism/parasitism,
carrying-capacity pyramids, and Lindeman 10% transfer.

- Grid: `TERRAIN_GRID²×4` slots (plant, herbivore, carnivore, decomposer),
  `TERRAIN_CELL=16`.
- `updateEcosystemGrid` (`:84-132`): slot decay `·0.998`; plant growth
  `min(1, plant+0.001·dt)`; agent deposition scaled by trophic slot.
- Rates (`:159-277`): `competitionPressure = max(0,(N/K)/nicheWidth − 1)·comp·0.01`,
  `nicheWidth=0.3+0.7·nicheSpecialization`; `mutualismBenefit = mutualism·n·0.005`;
  `parasitismDrain = parasitism·n·0.003`; trophic assignment thresholds
  (`aggr>0.7 ∧ diet>0.6 ⇒ APEX`, etc.); carrying capacity per level;
  `migrationForce`; `territorialDefense`; `biodiversityIndex = H/ln S`;
  `foodChainEfficiency = 0.1^{Δlevel}` (Lindeman).

### 4.12 Selection and speciation (`selection.ts`)

*Mechanism:* composite fitness, species clustering by genome cosine,
Hamilton's rule, Lande–Arnold/Fisherian sexual selection.

- `computeFitness` (`:110-138`): weights reshaped by `sexualSelection` and
  `competitionPressure`;
  `total = 0.3·E·wE + 0.25·S + 0.25·R·wR + 0.1·So·wS + 0.1·M`, clamped `[0,1]`.
- `updateSpecies` (`:143-252`): assign to the max-cosine species with `sim>0.9`,
  else found a species (`speciationEvents++`); extinction when population 0;
  adaptive-radiation trigger (≥3 speciations within ≥100 ticks).
- `computeSelectionPressure` (`:257-274`): predation/competition/
  environmentalStress/sexualSelection/frequencyDependence.
- Hamilton's rule `r·B > C` with `relatedness = cosine similarity`;
  mating success `w(z)=exp(−0.5 z²)`, `z=(trait−preference)/max(0.01,var)`;
  Fisherian runaway `a = ρ·trait·preference·0.01`.

### 4.13 Replicator (`replicator.ts`)

*Mechanism:* the replicator equation of evolutionary game theory, binned over a
1-D PCA projection of the 4-D strategy space.

- `N_BINS=12`, `EPSILON=0.01`.
- Projection `p = Σ w_i·strategy_i + offset` (dominant covariance eigenvector);
  bin `b = clamp(⌊p·12⌋, 0, 11)`; frequencies `x_i = n_i/N`; fitness `f_i`;
  mean `φ`.
- Replicator derivative `ẋ_i = x_i·(f_i − φ)` (`:133-136`).
- Price decomposition: `selection = Σ x_i(f_i−φ)²`, `transmission = Σ x_i ẋ_i`
  (`:160-170`).
- `applySelection` (`:188-211`): `strength = ε·sign(ẋ_b)·min(|ẋ_b|,1)`; each
  trait `T ← clamp01(T + strength·w_i + σ_mutation·(U−0.5))`.

### 4.14 Tensors (`tensors.ts`)

*Mechanism:* an 8-D trait covariance (G-matrix) and its spectrum.

- `TRAIT_DIM=8` (aggression, cooperation, risk, deception, speed, size, diet,
  fertility).
- `updateTensors` (`:86-185`): mean `μ`, population covariance `Σ` (`/N`), then
  cyclic Jacobi eigen-decomposition (`:192-269`) to `max|off| < 1e-12`; sorted
  eigenvalues; `tr(Σ)=Σλ`; Mahalanobis volume `exp(mean ln λ)`; effective
  dimensionality `exp(H)`; anisotropy `λ_max/λ_min`; trait–fitness correlation.

### 4.15 Lyapunov (`lyapunov.ts`)

*Mechanism:* largest Lyapunov exponent by Rosenstein-style nearest-neighbour
divergence in normalized state space `(x/L, y/L, (v_x+5)/10, (v_y+5)/10)`.

- Constants `MAX_PAIRS=128`, `MAX_DIST=0.05`, `RENORM_INTERVAL=10`.
- `updateLyapunov` (`:96-192`): every 10 ticks snapshot up to 128 agents;
  between snapshots, for each snapshot agent find its nearest other snapshot
  agent within `(1e−10, 0.05]`; accumulate `Σ ln(d1/d0)`;
  `λ_local = Σ ln(d1/d0) / (pairs·(RENORM_INTERVAL·dt))`; EMA
  `λ ← 0.95λ + 0.05·λ_local`. (Note: helper `dist4` is dead code.)

### 4.16 Conway overlay (`gameoflife.ts`)

*Mechanism:* a B3/S23 cellular automaton coupled to agent density.

- Rules: alive survives iff `n ∈ {2,3}`; dead born iff `n = 3`; toroidal 3×3
  stencil; double-buffered.
- Observables: `aliveFraction`, still-life/oscillator counts, neighbour-count
  entropy `H₂`, `complexity = aliveFraction·H₂`.
- `seedFromAgents` (`:165-180`) sets the CA cell from each alive agent.

### 4.17 Vector field (`vectorfield.ts`)

*Mechanism:* continuum field calculus on resource fields and the coarse-grained
velocity field; toroidal central differences.

- Scalar: `∂f/∂x ≈ 0.5(f_r−f_l)`, `∂f/∂y ≈ 0.5(f_d−f_u)`,
  `∇²f ≈ f_l+f_r+f_u+f_d−4f_c`.
- Velocity: `div V ≈ 0.5(vx_r−vx_l)+0.5(vy_d−vy_u)`,
  `curl V ≈ 0.5(vy_r−vy_l)−0.5(vx_d−vx_u)`.
- Globals: mean/max food gradient, food Laplacian, signal gradient, divergence,
  curl (over occupied cells).

### 4.18 Distributions (`distributions.ts`)

Deterministic samplers over the seeded RNG:

- Gaussian (Box–Muller): `sqrt(−2 ln u₁)·cos(2πu₂)`.
- Exponential: `−ln(1−U)/rate`.
- Poisson: Knuth for `λ<30`; rejection for `λ≥30`.
- Gamma (Marsaglia–Tsang) → Beta `G(α,1)/(G(α,1)+G(β,1))`.
- Von Mises: Best–Fisher/Ahrens rejection.
- Multivariate Gaussian: Cholesky `Σ=LLᵀ`, `x = μ + Lz`.
- Logistic: `μ + s·ln(U/(1−U))`; Bernoulli `U<p`.

### 4.19 RNG (`rng.ts`)

SplitMix64: `state += GOLDEN`; `z=(z⊕(z≫30))·C1`; `z=(z⊕(z≫27))·C2`;
return low 32 bits `(z⊕(z≫31)) & 0xFFFFFFFF` (masked in BigInt before Number —
critical for parity). Streams are seeded by FNV-1a-32 over
`"worldSeed:tick:agentId"` (plus `:meme:`, `:env:`, `:omics:`, `:init:`
variants).

---

## 5. Observables (`SimStats`, `types.ts:237`)

`stats()` returns a flat `SimStats` carrying every level's telemetry: chemistry,
biology, omics/folding, thermodynamics/biophysics
(`orgIndex, clusterOrder, rotationalOrder, meanForce, …`), microbiology→organism
organs, and the opt-in Phase E/G/H/I/J/K/L channels. `DeathCause` and `SimEvent`
are at `types.ts:589` / `:606`. The measurement layer maps these channels onto
level scores (see parts 02 and 03).
