# Mathematics of the engine

> **Status: engineering contract, not evidence.**
> This page states the domains, units, update order, invariants, and measured
> properties that the simulation's mathematics actually satisfies. It is the
> reference for `apps/simulation/src/mathAudit.ts` and
> `apps/simulation/test/mathContracts.test.ts`. Per [`CLAIMS.md`](CLAIMS.md),
> engineering checks (typecheck, test counts, internal scores) are **not**
> scientific claims and cannot support one. Nothing here adjudicates T1, T2 or
> T3; it only says what the instrument is.

## 1. What this pass changed

The hardening pass was **behaviour-preserving** by construction:

| Change | Production caller? | Can it move a trajectory? |
|---|---|---|
| Rewrote `distributions.ts` (correct Poisson, multivariate normal, von Mises, guards) | no — only tests import it | no |
| `SplitMix64.nextInt` throws for non-integer or `> 2^32` bounds | only out-of-domain calls | no |
| Added read-only `Engine.audit()` + `mathAudit.ts` | no draws, no mutation, no reordering | no |
| Corrected `genomeSimilarity` docstring (`[-1,1]`, not `[0,1]`) | comment only | no |
| Re-exported `distributions` / `mathAudit` from the package index | no | no |
| Added `test/mathContracts.test.ts` (27 tests) | no | no |

The engine's own stochastic primitives are `SplitMix64.next`,
`nextGaussian`, `nextInt`, and the bounded product draw in `worldStoch.ts`
(`poissonDraw`). Their in-domain behaviour is unchanged (`nextInt` only gained a
guard for invalid bounds). Evidence that the trajectory did not move: the
49-file fast suite passes, including `determinism`, `reproducibility`,
`rescueAblation`, and the inert-audit test added here. The M4 ×1 lever check
(registered arm equals the cached Q5 series) remains the authority for the
ablation artifacts and was not re-run by this pass.

## 2. State and units

The state is a finite collection of agents on a square torus plus continuous
fields on a terrain grid. Time is discrete. There is **no conservation of
energy**: the world is open, plants are injected by regeneration, and metabolism
dissipates energy as heat. Matter (soil minerals) is recycled, but that is a
model bookkeeping rule, not a physical conservation law.

| Object | Domain | Units / notes |
|---|---|---|
| `t` (tick) | `0, 1, 2, …` | integer; incremented at the **start** of `tick()` |
| `timeScale` (`ts`) | `> 0`, default `1` | rates are multiplied by `ts`; it is an explicit Euler step, not a wall-clock rescale |
| `(x, y)` | `[0, 2048)²`, torus | logical units; `WORLD_SIZE = 2048` |
| terrain grid | `128 × 128` cells | `TERRAIN_CELL = 16` logical units per cell; bilinear sampling |
| `(vx, vy)` | finite | logical units per tick; momentum with drag `0.86` |
| `energy` | `[0, cap]` for alive agents | capacity units, `cap = params.energyCapacity` (default `100`) |
| `water` | `[0, cap]` for alive agents | same capacity units |
| `age` | `≥ 0` | ticks advanced by `ts`; death when `age > agentMaxAge · longevity` |
| `genome` | `ℝ^217`, `float32` | `GENOME_SIZE = 192 + BRAIN_BLOCK_COUNT = 217`; nominally `[-1,1]` after mutation |
| brain weights | `float32` | plastic recurrent MLP + critic; learned within life |
| orbit `(zRe, zIm)` | `ℂ` | one Mandelbrot iteration per tick; escape when `|z|² > 4` |
| `meme` | `[0,1]` | cultural tag, clipped |
| population | `≤ maxPopulation` | alive agents only; dead agents are retained for `deadRetention` ticks |

Phenotypes are decoded from genes by affine maps into bounded physical ranges
(speed 0.5–4.5, sense 8–64, metabolism 0.02–0.25, size 0.5–2.5, diet `[0,1]`,
fertility 0.4–2.0, longevity 0.5–1.5, mutability 0.25–2.0). A scenario may
inject genes outside `[-1,1]` (for example `feedGenome` writes threshold genes at
±5); the decode maps clamp them, which is why the auditor checks genome
*finiteness* but not the mutation kernel's nominal range.

## 3. One tick, in order

`Engine.tick()` is the only place time advances. The order below is the
determinism contract; changing it changes every recorded run.

1. `tickNum++`; compute day/night and seasonal phase; advance optional weather,
   OU resource field, and Poisson burst process from `envSeed(seed, t)`.
2. Rebuild the spatial hash from agents with `alive === true`; snapshot their
   ids in **ascending order**; clear the birth queue.
3. For each live agent in ascending id order:
   1. `age += ts`; **early death check** (`energy ≤ 0`, `water ≤ 0`, or age).
   2. One fractal orbit step; **escape death** if `|z|² > 4` (boundedness is a
      survival pressure, not decoration).
   3. Sample 15 sensors, run the plastic brain forward, emit 7 actions.
   4. Move with momentum/drag/terrain physics, then `wrap` into `[0, 2048)²`.
   5. Evaporate/absorb water (clamped), feed on plant food and carrion
      (clamped), optionally hunt (may kill prey **mid-tick**).
   6. Pay metabolism, crowding, climb, and optional chemistry/DNA/cell-bio costs
      (all clamps are to `[0, cap]`).
   7. If the reproduction thresholds hold, build the child's genome
      (crossover → mutation → optional lateral transfer), pay parental energy and
      water, and **queue** the child. The child is not inserted into the
      iteration order of the current tick.
   8. **Late death check** (same three conditions).
   9. Learning update from the tick's net energy reward.
4. Append queued births to `aliveIds`; resource regeneration and carrion decay;
   pheromone and chemical-terrain diffusion; optional biome re-injection.
5. Auxiliary math modules (Lyapunov, replicator, vector field, cellular
   automaton, tensors); ecosystem grid; fitness; selection pressure.
6. Emit `SimStats`, including the coarse `stateHash`.

Deaths leave the agent object in the `agents` map with `alive = false` until
retention evicts it. Agents that died **this** tick stay in the spatial hash,
because neighbouring predators may still hold their ids; eviction is deferred by
`tickDeaths` (`engine.ts`, `kill()`).

New agents receive monotonically increasing ids, and iteration order is the
insertion order of the `Map` (ids were inserted in ascending order at spawn and
birth), so the update is independent of hash-table bucket order. This, plus
fixed draw counts per branch, is what makes a replay exact.

## 4. Invariants enforced by `Engine.audit()`

`auditWorld` is a *witness*: it walks the current state and returns a list of
violations, drawing nothing and mutating nothing. Call it after a tick:

```ts
const { stats } = engine.tick();
const violations = engine.audit(stats);
if (violations.length) throw new Error(describeViolations(violations));
```

| Rule | Applies to | Why it holds |
|---|---|---|
| `x, y` finite and in `[0, 2048)` | every agent | `wrap` and `stepMovement`; topology tests cover torus and sphere |
| `energy`, `water`, `age` finite | every agent | clamps on every gain/loss path |
| alive ⇒ `energy ∈ (0, cap]` | alive | late death check runs after all gains; every gain path clamps to `cap` |
| alive ⇒ `water ∈ (0, cap]` | alive | same, with water evaporation/absorption clipped |
| alive ⇒ `age ≥ 0` | alive | initialized at 0, advanced by `ts > 0` |
| alive count `≤ maxPopulation` | world | reproduction is gated on capacity |
| genome length `= 217`, all finite | every agent | `GENOME_SIZE`, float32 storage |
| all numeric `SimStats` fields finite | stats | division guards use `max(1, …)` |

`maxPopulation` is a ceiling for **births**, not for construction:
`spawnFounders` trusts `params.spawnCount`, so a world configured with
`spawnCount > maxPopulation` is correctly reported as out of domain. That is a
configuration error, not a dynamics violation.

Deliberately **not** checked: genome values within `[-1,1]` (scenario overrides),
velocity magnitude (physics caps escape speed only when a `universe` frame is
present), energy conservation (there is none), and equality of hashes (that is a
determinism test, not a state invariant). Dead agents are checked for finiteness
only; a dead agent may legitimately hold `energy ≤ 0` and a stale position.

## 5. Randomness

### 5.1 SplitMix64

All stochastic draws come from `SplitMix64`:

```
state ← (state + 0x9E3779B97F4A7C15) mod 2^64
z     ← state
z     ← ((z xor (z >> 30)) · 0xBF58476D1CE4E5B9) mod 2^64
z     ← ((z xor (z >> 27)) · 0x94D049BB133111EB) mod 2^64
out   ← (z xor (z >> 31)) mod 2^32
```

The final mask is applied **in BigInt before** converting to `Number`; converting
first loses precision above `2^53` and was the historical cause of TS/Rust
divergence. `nextFloat() = next() / 2^32` is exact in binary64 (a dyadic
rational), so the uniform stream has no rounding gap. The constructor warms up
one draw so adjacent seeds diverge immediately. A numeric seed is truncated to
32 bits (`seed >>> 0`); a `bigint` seed uses the full 64-bit state.

Streams are separated by domain:

```
streamSeed(seed, t, i) = FNV1a32(`${seed}:${t}:${i}`)
memeSeed  (seed, t, i) = FNV1a32(`${seed}:meme:${t}:${i}`)
omicsSeed (seed, t, i) = FNV1a32(`${seed}:omics:${t}:${i}`)
envSeed   (seed, t)    = FNV1a32(`${seed}:env:${t}`)
initSeed  (seed)        = FNV1a32(`${seed}:init`)
```

### 5.2 Measured quality

These are measurements, not assumptions. Reproduce them with
`test/mathContracts.test.ts` (it pins the same order of magnitude with fixed
seeds).

| Check | Sample | Measured | Reference |
|---|---|---|---|
| occupancy, 65,536 buckets | 2²⁰ draws, seed 12345 | χ² = 65,400.5 | df 65,535: mean 65,535, sd 362 |
| `nextFloat` mean / variance | 200,000 draws, seed 999 | 0.500909 / 0.083315 | 0.5 / 0.083333 |
| `nextFloat` lag-1 autocorrelation | same | 0.00183 | `0 ± 0.0022` (1/√n) |
| `nextGaussian` mean / variance | 50,000 draws, seed 7 | 0.0092 / 0.9958 | 0 / 1 |
| `nextGaussian` KS distance | same | 0.00546 | 5% critical 0.0061 |
| `nextInt(7)` | 700,000 draws, seed 3 | χ² = 3.48 | df 6: 5% critical 12.59 |

### 5.3 The 32-bit seed limit

A 32-bit stream id cannot be collision-free. Over 500,000 realistic
`(tick, agent)` pairs the birthday expectation is
`n(n−1)/(2·2³²) ≈ 29.1`; measured:

| Stream | Collisions | Rate |
|---|---|---|
| `streamSeed('ews.a')`, 1000 ticks × 500 agents | 92 | 0.0184% |
| `memeSeed` | 24 | 0.0048% |
| `omicsSeed` | 172 | 0.0344% |

The excess over the birthday baseline is FNV-1a's non-uniformity on structured
decimal strings, not a bias in the output stream. The practical consequence is
local coupling: two agents (or two ticks) that collide receive the *same* draw
sequence for that stream. It is not fixed here because widening the seed to 64
bits would change the stream for **every** recorded run and invalidate the
artifacts. It is a documented limitation of the instrument, not a silent one.

### 5.4 Samplers

Only `nextGaussian` and the engine's own bounded product draw are on the
production path. The corrected `distributions.ts` samplers are verified so the
first caller inherits a correct distribution.

| Function | Algorithm | Production use |
|---|---|---|
| `SplitMix64.nextGaussian` | Box–Muller, rejects `u = 0` and `v = 0` | mutation, OU field, meme innovation |
| `poissonDraw` (`worldStoch.ts`) | Knuth product, hard stop at `k = 1000` | optional Poisson burst process |
| `gaussianRng` | Box–Muller, rejects `u = 0` | none |
| `exponentialRng` | inverse CDF with `log1p` | none |
| `poissonRng` | Knuth for `λ < 30`; Ahrens–Dieter for `λ ≥ 30` | none |
| `gammaRng` | Marsaglia–Tsang (`k ≥ 1`), boost for `k < 1` | none |
| `betaRng` | ratio of two gamma variates | none |
| `vonMisesRng` | Best–Fisher rejection | none |
| `multivariateGaussianRng` | Cholesky `Σ = LLᵀ`, independent `z` | none |
| `logisticRng` | inverse CDF | none |
| `bernoulliRng` | threshold on `nextFloat` | none |

## 6. What was actually wrong, and why it could be fixed

These defects were in code with **no production caller**, so correcting them
cannot move a recorded result. Each is now covered by a contract test.

| Defect | Before | After |
|---|---|---|
| `poissonRng(λ ≥ 30)` | the "rejection" branch used a malformed envelope whose acceptance test practically never held at λ = 30 or 100, so the loop did not terminate (confirmed by timeout) | Ahrens–Dieter logistic envelope, exact pmf acceptance, O(1) per draw; verified against the pmf for λ = 30 and 1000 |
| `multivariateGaussianRng` | reused one shared `z` for every column and drew a second, unused normal per row; for `Σ = [[1,0.8],[0.8,1]]` it gave `var(y) = 1.973`, `corr = −0.005` | independent `z_j`; recovers a full 3×3 covariance within sampling error |
| `vonMisesRng` | `(sign·acos(f) + μ) mod 2π` could return a negative angle for small μ | positive modulo, `[0, 2π)` for every draw |
| `nextInt(n > 2^32)` | `limit = 0`, so `while (v >= 0)` never terminates | throws `RangeError`; non-integer bounds also throw |
| all samplers | silent `NaN`/`Infinity` on bad parameters | explicit `RangeError` guards |

`logGamma` (Lanczos, g = 7) and an exact `poissonPmf` were added as the
reference against which the Poisson sampler is tested; the pmf sums to 1 within
`1e-12` for the tested λ.

## 7. Known deviations, frozen for reproducibility

These are real mathematical limitations or model choices. Each is **not** fixed
in this pass because doing so would change children, trajectories, or stored
artifacts. They are recorded so a reader does not mistake the implementation for
the idealized model.

1. **Genome clamping.** Mutation adds `N(0, σ²)` with
   `p = min(1, 0.05·mutability·mutationScale)` and
   `σ = 0.05·mutability·mutationScale`, then clips each gene to `[-1,1]`. The
   stationary kernel is therefore *truncated* Gaussian, with mass accumulating
   exactly at the boundaries. Because `mutationLoci` counts only genes whose
   value changed, an attempted mutation that pushes an already-boundary gene
   outward is not counted. This slightly undercounts mutation supply in the M4
   manipulation check; it does not affect the M4 endpoint, which is computed
   from population series.
2. **Crossover points are not sorted.** `multiPointCrossover` draws `nPoints`
   breakpoints in draw order and advances a single cursor. A point that the
   cursor has already passed is applied at the next index instead of at its
   drawn position, duplicates become two consecutive switches (a one-gene
   segment), and a point at `GENOME_SIZE` never fires. The docstring's "segment
   switches" description is the idealized operator, not the implemented one.
   The Rust mirror has the same loop, deliberately, so fixing one side alone
   would break bit-exact parity.
3. **Empty windows return zero.** `mean([]) = 0` and `variance(<2) = 0` in
   `packages/shared/src/criticalTransitions.ts`. Downstream statistics therefore
   have defined values on empty windows instead of `NaN`. The M4 analysis does
   not read a slope unless `detectionRate ≥ 0.2` and the bootstrap produced
   `≥ 100` resamples (`MIN_DETECTION`, `MIN_BOOTSTRAP_REPS`); otherwise the
   slope is rendered `n/a` rather than as a fabricated zero.
4. **Fitness is a score, not a probability.** In `computeFitness` the component
   weights are

   ```
   w_E   = 0.30·(1 − 0.3·s)
   w_S   = 0.25
   w_R   = 0.25·(0.3 + 0.4·s)
   w_Soc = 0.10·(0.1 + 0.2·c)
   w_M   = 0.10
   Σw    = 0.735 + 0.01·s + 0.02·c  ∈ [0.735, 0.765]
   ```

   for `s, c ∈ [0,1]`, so `total ∈ [0, 0.765]` and the `min(1, …)` clamp is
   inactive. It is a bounded composite used for reporting, not a convex
   combination and not a probability. Separately, the engine passes the mean
   **energy fraction** into the `meanAge` slot of `computeSelectionPressure`, so
   with the default `agentMaxAge = 4000` the derived `environmentalStress` is
   pinned near 1 instead of measuring age structure; that field is not used by
   `computeFitness` and has no dynamic effect. Fixing either without a
   registered revision would change the reported fitness composite (and the
   `SelectionState` field), so both are recorded rather than silently repaired.
5. **Toxin gene conflates two traits.** `genome[125]` scales both toxin
   production and resistance. Absorption is multiplied by `(1 − 0.7·g)`, so
   resistance can remove at most 70% of environmental toxin, and the same gene
   increases synthesis. This is a model choice, not a claim about biochemistry.
6. **State hashes are witnesses, not proofs.** `stats.stateHash` quantizes
   positions to 0.1, energy/water/velocity to 0.01, and meme to 0.001, and omits
   the genome. `fullStateHash` (research snapshot) hashes the terrain,
   chemistry, stochastic state, and full agent physiology/brain, but still omits
   the genome array. Genome-level replay is checked by tests that compare
   genomes directly; no single 32-bit digest is treated as proof of bit-exact
   state.
7. **No numerical-stability guarantee.** The integrator is explicit Euler with
   clamps. The tests bound the sampled distribution and the state domain; they
   do not prove that a chaotically diverging orbit stays close to a reference for
   all inputs. Cross-engine parity is asserted for recorded scenarios and checked
   by `test/parity.test.ts`; it is not a theorem about arbitrary arithmetic.

## 8. Reproducing the checks

```bash
cd apps/simulation
npx tsx test/mathContracts.test.ts     # 27 contract tests
npx tsc --noEmit
npm test -- --fast                     # 49/58 files; includes determinism + M4
```

The contract tests use fixed seeds and tolerances at roughly five standard
errors of the sampling distribution, so a pass is a statement about the
implementation rather than about luck. They cover: stream moments and
occupancy, `nextInt` bias and domain, Gaussian KS, cross-stream decorrelation,
seed-domain separation and collision order of magnitude, absence of
`Math.random` in the PRNG sources, every sampler's moments/range/pmf, parameter
rejection, exact replay from a seed, the auditor's planted-violation cases, a
120-tick nominal world, four extreme configurations, and the inertness of the
audit.

The auditor is also a useful runtime assertion in new experiments:

```ts
import { Engine, describeViolations } from '@fractal-life/simulation';

const engine = new Engine(world);
for (let i = 0; i < 200; i++) {
  const { stats } = engine.tick();
  const violations = engine.audit(stats);
  if (violations.length) throw new Error(describeViolations(violations));
}
```

## 9. What this does not establish

It does not show that the model is biologically or physically correct, that the
early-warning claims are true, or that the engine is free of numerical error. It
shows something narrower and checkable: the state stays in the domain its
equations assume, the uniform stream is uniform enough for the sampling work,
the non-uniform primitives are correct where they are used, and the known
deviations are named. Claims about the world remain in [`CLAIMS.md`](CLAIMS.md);
results and their artifacts remain in [`RESULTS.md`](RESULTS.md).
