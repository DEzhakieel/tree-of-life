# 03 — Mathematical Foundations

*Tree of Life — technical manual, part 3.*

Every equation the model uses, **with its derivation**. Part I derives the
mechanism dynamics; Part II derives the measurement/statistics layer; Part III
derives the composite detectors. Notation as in the [manual README](README.md).

---

# Part I — Mechanism derivations

## I.1 Fractal terrain: escape time and smooth colouring

The Mandelbrot/Julia map is the complex quadratic

```
z_{n+1} = z_n^2 + c ,   z_0 = 0 (Mandelbrot) or z_0 = p (Julia).
```

Writing `z = x + iy`, `c = a + ib`:

```
x_{n+1} = x_n^2 − y_n^2 + a
y_{n+1} = 2 x_n y_n + b
```

The escape-time `ν` is the first `n` with `|z_n|² > B²` (`B = escapeRadius`).
Interior points (`n ≥ maxIter`, or `|z|² ≤ 1`) are assigned `ν = maxIter`.

*Smooth escape (renormalised iteration count).* For large `|z|` the map is
dominated by `|z|²`, so `log|z_n| ≈ 2ⁿ log|z_0|` and the fractional iteration
count to reach a fixed `|z|` is

```
ν = n + 1 − log_2( ln|z_n|² / ln B ) .
```

This removes the integer banding. The angle `phase = atan2(y, x)` gives the
chemical-terrain phase input.

*Per-cell derivatives.* `moisture = min(1, 3·|ν(x+Δ) − ν(x−Δ)|)` is a forward
central difference of `ν` in `x`; `baseMinerals = min(1, 6·(|ν_x+ − ν_x−| +
|ν_y+ − ν_y−|))` approximates `|∇ν|`. `hazard` is the normalised standard
deviation of the four diagonal raw iteration counts:
`hazard = min(1, 10·sd(it_diag)/maxIter)`.

*Perlin alternative.* Value noise with hash
`h = imul(h ^ (h≫13), 0x5bd1e995)`, `h ^= h≫16`; smoothstep `s(t)=t²(3−2t)`;
4-octave fBm with `amp_{k+1}=0.5 amp_k`, `freq_{k+1}=2 freq_k`, normalised to
`[−1,1]`.

## I.2 Movement: drag dynamics and steady state

Per tick,

```
v_{t+1} = ( v_t + A ) · d ,     0 < d < 1 ,
```

where `d = drag = DRAG^{1/retention}` and
`A = thrust·speed·thrustScale·thrustMod·throttle`.

*Derivation of the fixed point.* Set `v_{t+1} = v_t = v*`:

```
v* = (v* + A) d  ⇒  v*(1 − d) = A d  ⇒  v* = A d / (1 − d).
```

Because `thrustScale = (1 − d)/d`, the factor `thrustScale·d/(1−d) = 1`, so the
steady speed simplifies to

```
v* = thrust · speed · thrustMod · throttle .
```

*Closed form.* Iterating the affine recurrence from `v_0`:

```
v_t = v* + (v_0 − v*) d^t ,
```

i.e. exponential approach to `v*` with per-tick decay `d`. The relaxation time
is `τ = −1/ln d` ticks. A momentum-retention world sets
`d = DRAG^{1/retention}`, so `retention>1` raises `d` (heavier, more slippery);
`retention=1` recovers `d = DRAG = 0.86`.

*Slope forcing.* With preview slope `dh = h(x+Δ) − h(x)`,

```
thrustMod = max(0.25, 1 − 0.4·dh)      (uphill)
thrustMod = min(1.6,  1 − 0.5·dh)      (downhill)
simplifies each line to a saturating linear response around 1.
```

The energy ledger charges `climbCost = dh·CLIMB_COST·size` for `dh>0` only —
descent is irreversible work (energy lost, never refunded).

## I.3 Ornstein–Uhlenbeck resource fluctuation

Euler–Maruyama discretisation of `dx = θ(μ − x)dt + σ dW` with `μ = 1`:

```
x_{t+1} = x_t + θ(1 − x_t)Δ + σ√Δ · z ,   z ~ N(0,1).
```

*Mean reversion.* Let `y_t = x_t − 1`; then `y_{t+1} = (1 − θΔ) y_t + σ√Δ z`.
The mean is `E[x_t] = 1` for all `t`.

*Stationary variance.* With `a = 1 − θΔ`, `Var(y_{t+1}) = a² Var(y_t) + σ²Δ`,
so at the fixed point

```
Var(x) = σ²Δ / (1 − a²) = σ²Δ / (1 − (1−θΔ)²) ≈ σ² / (2θ)   (small θΔ).
```

The multiplier is clamped to `clamp(x, 1−band, 1+band) ∈ [0.75, 1.25]`.

## I.4 Markov weather

Categorical draw with one uniform: `next = min{k : U < Σ_{j≤k} P[weather][j]}`.
`P` is row-stochastic (rows sum to 1); the diagonal ≈ 0.75–0.85 is the expected
sojourn fraction. Moisture/growth multipliers are read from
`WEATHER_MOISTURE`, `WEATHER_GROWTH`.

## I.5 Enzyme kinetics: Michaelis–Menten and inhibition

Mass-action mechanism `E + S ⇌ ES → E + P` with rates `k₁, k₋₁, k₂`. Under the
**quasi-steady-state assumption** `d[ES]/dt = 0`:

```
k₁[E][S] = (k₋₁ + k₂)[ES]   ⇒   [ES] = [E][S]/K_m ,   K_m = (k₋₁+k₂)/k₁ .
```

With `[E]_t = [E] + [ES]` and `V_max = k₂[E]_t`:

```
v = k₂[ES] = V_max [S] / (K_m + [S]) .
```

The engine uses `K_m = MM_KM = 10`. **End-product (non-competitive)
inhibition** retains the form `1/(1 + p/K_i)`:

```
v = V_max · s/(s+10) · 1/(1 + 0.3·(p/100)) ,   K_i = 100/0.3 ≈ 333.3 .
```

Generalised reaction rate used throughout chemistry:
`rate = enzyme · catMod · pHmod · REACTION_RATE · dt`,
`catMod = 0.3 + 1.4·catalysisGene`, `pHmod = max(0.1, 1 − |pH−7|/4)`.

## I.6 Reaction–diffusion on the torus

Explicit 5-point scheme: `u^{n+1} = u^n + r(u_l + u_r + u_u + u_d − 4u_c)`
with `r = DΔt/Δx²` scaled per field (×1 O2, ×0.5 toxin, ×0.3 minerals). For a
uniform `Δx=1`, `r = 0.08`.

*Stability (von Neumann).* The amplification factor is `g = 1 − 4r(1 −
(cos k_x + cos k_y)/2)`; worst case `k_x=π, k_y=π` gives `g = 1 − 8r`, so
stability requires `r ≤ 1/4`. `r = 0.08` is comfortably stable.

## I.7 Chemistry energy ledger

`ΔE = ATP·0.002·dt − (Σ molecules)·0.00005·dt`. This is a *net* metabolic
balance: ATP produced from flux minus a small molecule-crowding overhead. All
pools are then hard-clamped at their caps (explicit Euler + saturation).

## I.8 DNA: damage, repair, fidelity

Damage accumulates `D ← D + 0.001(1 − 0.8 s)·dt` (`s = dnaStability`). If
`D>0.1`, integrity decays `integrity ← integrity − 0.01·D·dt` and
`D ← 0.95 D`. Repair (if `D>0.01 ∧ ATP>0.5`), efficiency `η = repairRate ·
repairAccuracy`:

```
repaired = min(D, 0.1·η·dt),  D ← D − repaired,
integrity ← min(1, integrity + 0.5·repaired),  ATP cost = 0.5·dt.
```

*Replication error probability*

```
p_mut = 0.001·(1 − 0.9·replicationFidelity)·(1 − 0.5·integrity).
```

Transposons fire Bernoulli with `p = 1e−4·transposonRate·dt`; epigenetic marks
toggle with `p = 0.005·epigeneticNoise·dt`; HGT accepted iff
`U ≤ 0.001·hgtGene`, copying a block of `4 + ⌊13U⌋` genes.

## I.9 Genome: mutation, crossover, similarity, MLP

- *Phenotype.* `u = (g+1)/2` then linear maps (e.g.
  `speed = 0.5 + 4u ∈ [0.5,4.5]`).
- *Mutation.* Per locus: if `U<rate`, `g ← clamp(g + N(0,1)σ, −1, 1)`,
  defaults `rate=0.05`, `σ=0.05`.
- *Crossover.* Multi-point with `RECOMB_MAX_POINTS=5` alternating parents;
  block shuffle swaps 4 block pairs of `⌊217/8⌋ = 21` genes; combinatorial
  assembly draws each block from parent A/B by a fair coin. The operator chain
  fixes the RNG draw count for parity.
- *Species.* Cosine `⟨a,b⟩/(‖a‖‖b‖) > 0.9`.
- *Static MLP.* `h_j = fastTanh(b1_j + Σ_{i=0}^{14} s_i W1[i,j])`,
  `W1[i,j] = g[11+4i+j]`, `b1_j = g[71+j]`; outputs
  `o_j = j<2 ? fastTanh(z_j) : σ(z_j)`. `fastTanh(x) ≈ x(27+x²)/(27+9x²)` is the
  `[3/2]` Padé approximant of `tanh` (matching value and slope at 0, saturating
  to ±1 beyond `|x|=4`).

## I.10 Brain: Elman RNN, TD(0), Hebbian and backprop

*Forward pass.*

```
h_j^t = fastTanh( b1_j + Σ_i s_i w_{ij} + Σ_k h_k^{t−1} rec_{kj} )
z_j   = b2_j + Σ_i h_i w2_{ij},   o_j = j<2 ? fastTanh(z_j) : σ(z_j)
V     = cb + Σ_i h_i cv_i
```

(`rec` frozen at birth; `w2` lives in the `MLP_HOUT_W = 35` block.)

*TD(0) critic.* With reward `r` and discount `γ`:

```
δ_t = r_{t−1} + γ V_t − V_{t−1} ,     V ← V + α δ_t .
```

*Eligibility traces* are the exponentially-weighted history of co-activation,
`e_{ij}^{t} = λ e_{ij}^{t−1} + h_i o_j`, whose unrolled solution is the geometric
series `e_{ij}^t = Σ_{k≥0} λ^k h_i^{t−k} o_j^{t−k}`.

*Three-factor Hebbian update.*

```
w_{ij} ← clamp( w_{ij} + lr · rpe · e_{ij}, −2, 2 ),   rpe = clamp(δ, −1, 1).
```

The three factors are pre-synaptic activity `h_i`, post-synaptic activity `o_j`,
and the global neuromodulator `rpe` — the reward-modulated Hebbian rule.

*Backprop SGD.* For a motor head `o_m = tanh(z_m)`, `d o_m/d z_m = 1 − o_m²`;
for a sigmoid head, `o_m(1 − o_m)`. The engine treats `−rpe` (plus an entropy
term `ent = entropy·o_m` on motor heads) as the loss gradient:

```
dz_m   = (−rpe + ent_m)·dAct_m
w2_{mj} ← clamp(w2_{mj} − lr·dz_m·h_j, −2, 2) ,  b2_m ← b2_m − lr·dz_m
gH_j   = Σ_m dz_m w2_{mj}^{old}                  (back-propagated error)
g_j    = gH_j·(1 − h_j²)
w1_{ij} ← clamp(w1_{ij} − lr·g_j·s_i, −2, 2) ,  b1_j ← b1_j − lr·g_j
cv_j   ← clamp(cv_j + lr·rpe·h_j, ±4) ,  cb ← cb + lr·rpe
```

*Policy noise.* `σ(t) = σ_min + (σ₀ − σ_min)(1 − t/T)` for `t<T`; action
`act_m = clamp(o_m + σ ε, −1, 1)` (reparameterisation trick).

*POMDP belief.* `obs = clamp01(raw + η·noise)`,
`belief ← belief + gain(obs − belief)`,
`sensor = (1−w)·obs + w·belief` — a leaky integrator over a hidden channel.

## I.11 Cells: membrane potential, tension, cycle

Resting potential as a reduced Goldman/Nernst ratio:

```
r = K/(Na + 0.001) ,    V_m = −70 + 30(r − 1)   [mV].
```

At the resting ratio `r=1`, `V_m = −70 mV`. Tension integrates osmotic
imbalance `tension += 0.001·dt·|Na + K − Cl|` and relaxes `tension ← 0.99·tension`.
Integrity `integrity ← clamp(integrity − 0.01·tension·dt +
0.0003·membraneThickness·dt, 0, 1)`; lysis damage at `tension>0.5`.

*Cell cycle.* `divisionProgress += 0.0005·cellSize·dt·energy·0.1`; mitosis when
`progress ≥ 1 ∧ energy > 0.8`.

## I.12 Ecosystem: carrying capacity and Lindeman transfer

Trophic assignment by thresholds on `(aggression, diet)`; carrying capacity `K`
per level (e.g. producer `20 + 80·plant`, herbivore `10 + 40·plant`, carnivore
`5 + 30·herbivoreDensity`). Competition
`competitionPressure = max(0, (N/K)/nicheWidth − 1)·comp·0.01`.
Biodiversity (Pielou evenness) `= H/ln S`. **Lindeman's 10% law**:
`foodChainEfficiency = 0.1^{toLevel − fromLevel}` — energy retention decays by a
factor 10 per trophic level.

## I.13 Selection and fitness

```
total = 0.3·E·wE + 0.25·S + 0.25·R·wR + 0.1·So·wS + 0.1·M ,
wE = 1 − 0.3·sexualSelection ,  wR = 0.3 + 0.4·sexualSelection ,
wS = 0.1 + 0.2·competitionPressure ,  clamp(total, 0, 1).
```

*Hamilton's rule* `r·B > C` with `r` = genome cosine similarity. *Sexual
selection* `w(z) = exp(−½ z²)`, `z = (trait − preference)/max(0.01, var)` (a
Gaussian preference kernel), and Fisherian runaway `a = ρ·trait·preference·0.01`.

## I.14 Replicator dynamics and the Price equation

Let strategy space be binned into `i = 0…11` with frequency `x_i = n_i/N`,
per-bin mean fitness `f_i`, and `φ = Σ_j x_j f_j`. The replicator equation is

```
ẋ_i = x_i ( f_i − φ ) .
```

*Derivation.* Let bin `i` grow per-capita at rate `f_i`: `ṅ_i = n_i f_i`. Then
`N = Σ n_j` satisfies `Ṅ = Σ n_j f_j = N φ`, so
`ẋ_i = (ṅ_i N − n_i Ṅ)/N² = x_i f_i − x_i φ = x_i(f_i − φ)`. Note `Σ_i ẋ_i = φ − φ = 0`,
so frequencies are conserved.

*Price equation* (total change decomposes into selection + transmission):

```
Δ z̄ = Cov(w, z)/w̄  +  E[ w Δz ]/w̄ ,
```

implemented as `selection = Σ x_i (f_i − φ)²` (fitness variance) and
`transmission = Σ x_i ẋ_i`. Selection entropy `H = −Σ x_i ln x_i`.

## I.15 Tensors: covariance, Jacobi eigen, volumes

Population covariance `Σ_{jk} = (1/N) Σ_i (θ_{ij} − μ_j)(θ_{ik} − μ_k)`. The
**Jacobi** eigenvalue algorithm zeroes the largest off-diagonal `a_{pq}` with the
rotation

```
τ = (a_{qq} − a_{pp})/(2 a_{pq}) ,  t = sign(τ)/(|τ| + √(1+τ²)) ,
c = 1/√(1+t²) ,  s = t c ,
```

iterated until `max|off-diag| < 1e-12`. Then:

- `tr(Σ) = Σ λ_i`.
- Mahalanobis volume `= exp( (Σ_{λ_i>0} ln λ_i)/8 )` (geometric mean of the
  significant eigenvalues — the 8-D generalised variance).
- Effective dimensionality `= exp(H)`, `H = −Σ p_i ln p_i`, `p_i = λ_i/tr`
  (participation ratio / perplexity of the spectrum).
- Anisotropy `= λ_max/λ_min`.
- Trait–fitness correlation `= Cov(θ_d, f)/√(Var θ_d · Var f)`.

## I.16 Largest Lyapunov exponent

For nearby trajectories separated by `δ(t)`, `δ(t) ≈ δ_0 e^{λt}`, so

```
λ = lim_{t→∞} (1/t) ln( |δ(t)| / |δ_0| ) .
```

The Rosenstein estimator averages `ln(d1/d0)` over many nearest-neighbour pairs
between successive renormalisation snapshots:

```
λ_local = Σ_pairs ln(d1/d0) / ( pairs · RENORM_INTERVAL · dt ) ,
λ ← 0.95 λ + 0.05 λ_local   (EMA, first sample sets λ directly).
```

Pairs are accepted when `1e−10 < d0 ≤ MAX_DIST = 0.05` in normalised
`(x/L, y/L, (v_x+5)/10, (v_y+5)/10)` coordinates.

---

# Part II — Measurement and statistics derivations

## II.1 Shannon entropy

From the Khinchin axioms (continuity, maximality at uniform, additivity), the
unique functional is `H = −k Σ p_i log p_i`. The engine takes base-2 and `k=1`:

```
H = −Σ_{p_i>0} p_i log_2 p_i ,   p_i = c_i / Σ c_j .
```

## II.2 LMC complexity

López-Ruiz–Mancini–Calbet define complexity as the product of **information**
(entropy) and **disequilibrium** (distance from uniform):

```
C = H · D ,   D = Σ_{i=1}^{n} ( p_i − 1/n )² .
```

`H` is Shannon (base e in the original; base 2 here), `n` the number of occupied
categories. `C = 0` for both ordered (`H=0`) and uniform (`D=0`) states — the
signature of a complexity measure that peaks at the "edge of chaos". The engine
returns `0` when `tot=0` or `n<2`.

## II.3 Moran's I

Global spatial autocorrelation on the coarse grid with rook weights `w_{ij}`:

```
I = (N / W₀) · ( Σ_{i,j} w_{ij} z_i z_j ) / ( Σ_i z_i² ) ,   z_i = g_i − ḡ ,
W₀ = Σ_{i,j} w_{ij} .
```

The implementation traverses each undirected edge in both directions, adding
`2 z_i z_j` to the numerator and `2` to `W₀`, which cancels in the ratio,
yielding the standard `I`. `I>0` = clustering, `I≈0` = random, `I<0` =
dispersion. Clamped to `[−1,1]`.

## II.4 Contagion index

Fraction of rook-neighbour slots around occupied cells that are also occupied:

```
Q = hits / slots ,   slots counted only for cells with g>0 .
```

`Q` is a local-clustering analogue of Moran's I.

## II.5 Radial correlation length

Define the distance-binned normalised autocovariance

```
C(d) = ( 1/n_d ) Σ_{pairs, dist=d} z_i z_j ,   C_norm(d) = C(d) / z² .
```

The correlation length is the first Chebyshev lag `d ≥ 1` where the
autocovariance has decayed to `1/e` of its zero-lag value (exponential decay
`C(d) ≈ C(0) e^{−d/ξ}`, so `C(d)/C(0) = 1/e ⇒ d ≈ ξ`). The engine returns the
crossing lag with interpolation around a unit step.

## II.6 Lempel–Ziv complexity

LZ76 production complexity `c(n)` counts distinct phrases in the incremental
parse; normalised to a `[0,1]` rate by the alphabet:

```
LZ_norm = c(n)·log_2(α) / n .
```

For a random sequence `c(n) ≈ n/log_α n`, so `LZ_norm → 1`; periodic sequences
give `LZ_norm → 0`.

## II.7 Simpson diversity and Pielou evenness

```
Simpson:  1 − Σ p_i² = 1 − Σ c_i² / (Σ c_j)²          (collision probability)
Evenness: J = H / ln S                                  (biodiversity index)
Polarization: P = 1 − H/H_max .
```

## II.8 Normalised mutual information (micro↔macro coupling)

```
I(X;Y) = Σ_{i,j} p_{ij} log_2 ( p_{ij} / (p_i p_j) ) ,
NMI = I(X;Y) / H(Y)   (0 if H(Y) or I ≤ 1e−9), clamped [0,1].
```

`NMI` is the emergent-information sync: the fraction of macro-state uncertainty
explained by the micro state.

## II.9 Aggregation order

```
A = 1 − H / log_2(nBins) ∈ [0,1] .
```

`A=1` when all counts sit in one bin (maximal order), `A=0` at uniform spread.

## II.10 Pearson correlation

```
r = Σ (x_i − x̄)(y_i − ȳ) / √( Σ(x_i−x̄)² · Σ(y_i−ȳ)² ) ,   n≥3 finite pairs else 0.
```

## II.11 Log–log power-law fit

Fit `ln y = a + b ln x` by OLS on positive pairs. With
`S_xx = Σ(lx_i − l̄x)²`, `S_xy = Σ(lx_i − l̄x)(ly_i − l̄y)`:

```
b = S_xy / S_xx ,   a = l̄y − b l̄x ,
SSR = Σ(ly_i − (a + b lx_i))² ,   SST = Σ(ly_i − l̄y)² ,
SE(b) = √( SSR / ((n−2) S_xx) ) ,   R² = 1 − SSR/SST .
```

`b` is the scaling exponent (slope on the log-log plot); `SE(b)` the standard
error; `R²` the goodness of fit. See `SCALING_CATALOG.md` for the scientific
uses.

## II.12 Hysteresis loop area

Given an up-sweep and down-sweep of a response `u(p), d(p)` over `lp = log10 p`
and the gap `Δ_i = |u_i − d_i|`, the trapezoidal loop area is

```
A = Σ_{i=2}^{n} ( (Δ_{i−1} + Δ_i)/2 ) · |lp_i − lp_{i−1}| ,
```

and the path-dependence index counts the fraction of steps whose gap exceeds 5%
of the response span:

```
pathIndex = |{ i : Δ_i > 0.05·span }| / n .
```

`A>0` with a consistent sign is the signature of a first-order (discontinuous)
transition; a smooth crossover gives `A≈0`.

## II.13 Feedback loop and overdispersion

```
ρ_birth,alive(1) = corr( alive[0..n−2], births[1..n−1] )     (lag-1 cross)
ρ_birth(1)       = corr( births[0..n−2], births[1..n−1] )     (lag-1 auto)
overdispersion    = Var(births) / mean(births)                 (Fano factor).
```

The sign of `ρ_birth,alive(1)` distinguishes a negative-feedback (stabilising)
from a positive-feedback (amplifying) loop; the Fano factor `>1` indicates
over-dispersed (clustered/bursty) births. Pegs `Hcrit`.

## II.14 Half-max width

For a response sweep `d(p)` peaking at index `center`, `half = |d_center|/2`;
expand left while `|d_{l−1}| ≥ half` and right while `|d_{r+1}| ≥ half`. The
width `= lp_r − lp_l` measures the transition sharpness.

## II.15 KDE mode counting

Gaussian kernel density on `[0,1]`:

```
pdf(t) = Σ_{x∈sample} exp( −½ ((t − x)/bw)² ) ,   bw = 0.08, 200 grid points.
```

Peaks are local maxima with prominence `≥ 0.02·max(pdf)`; peaks closer than
`1.5·bw` are merged. The survivor count is the number of attractor modes
(bistability ⇒ 2).

## II.16 Welch's t-test

Unequal-variance two-sample test:

```
t = (x̄_A − x̄_B) / √( s_A²/n_A + s_B²/n_B ) ,
```

with the Welch–Satterthwaite degrees of freedom

```
ν = ( s_A²/n_A + s_B²/n_B )² / ( (s_A²/n_A)²/(n_A−1) + (s_B²/n_B)²/(n_B−1) ) .
```

Effect size is Cohen's `d` with pooled SD
`√(((n_A−1)s_A² + (n_B−1)s_B²)/(n_A+n_B−2))`.

## II.17 Paired t-test

Over matched differences `d_i = a_i − b_i`: `t = d̄ / (s_d/√n)`, `df = n−1`,
effect size `d_z = d̄/s_d`.

## II.18 One-way ANOVA

```
SS_between = Σ_g n_g (x̄_g − x̄)² ,  SS_within = Σ_g Σ_{x∈g} (x − x̄_g)² ,
F = (SS_between/df₁) / (SS_within/df₂) ,  df₁ = k−1, df₂ = n−k .
```

`F` is the variance ratio; its p-value follows below.

## II.19 t and F p-values via the incomplete beta

The regularised incomplete beta `I_x(a,b)` is defined by
`I_x(a,b) = B(x;a,b)/B(a,b)`, `B(x;a,b) = ∫₀ˣ t^{a−1}(1−t)^{b−1} dt`. The
engine computes it with the Lanczos `ln Γ` and Lentz continued fraction for
`betacf`, using the symmetry
`I_x(a,b) = 1 − I_{1−x}(b,a)`.

*t distribution.* For `T ~ t_ν`, `T² ~ F(1,ν)`, giving the two-sided p

```
P(|T| > t) = I_{ ν/(ν+t²) }( ν/2, ½ ) .
```

The code calls `betai(df/2, 0.5, df/(df+t²))`, the same identity.

*F distribution.* `P(F > f) = I_{ ν₂/(ν₂+ν₁f) }( ν₂/2, ν₁/2 )`.

*Student-t critical values* use a lookup table for `df ≤ 30` and the
Cornish–Fisher expansion beyond:

```
t_crit ≈ z + (z³+z)/(4ν) + (5z⁵ + 16z³ + 3z)/(96ν²) ,   z = 1.95996… (95%).
```

## II.20 Clopper–Pearson exact binomial interval

For `k` successes in `n` trials, the exact `(1−α)` interval is

```
lower = B(α/2; k, n−k+1)−quantile      (0 if k=0)
upper = B(1−α/2; k+1, n−k)−quantile    (1 if k=n)
```

equivalently the beta quantiles `Beta^{-1}(α/2; k, n−k+1)` and
`Beta^{-1}(1−α/2; k+1, n−k)`. The engine inverts `I_x` by 80-step bisection.
This is conservative (coverage ≥ 1−α). *Caveat documented:* cells in one lattice
are spatially correlated, so these intervals are anti-conservative as
*ecological* uncertainty — they describe cell-level draw noise only.

## II.21 Two-proportion z-test

Pooled standard error `√(p̄(1−p̄)(1/n_A + 1/n_B))`, `p̄ = (k_A+k_B)/(n_A+n_B)`,
`z = (k_A/n_A − k_B/n_B)/SE`; two-sided p from the normal CDF via the
Abramowitz–Stegun 7.1.26 erf approximation.

## II.22 Bootstrap intervals

Percentile bootstrap: resample `n` values with replacement `B=5000` times from a
seeded `mulberry32`, take the `α/2` and `1−α/2` quantiles of the replicate
statistics. The paired variant resamples the differences and reports
`pWin = P(mean difference > 0)`.

## II.23 Minimal Bayes factor (Sellke–Berger–Pericchi)

For a p-value `p`, the smallest Bayes factor over reasonable priors is

```
BF_min(p) = 1 / ( −e · p · ln p ) ,   for p < 1/e ;   BF_min = 1 otherwise.
```

*Why this form.* SB–P show the likelihood ratio minimised over a class of
priors under the alternative is attained by a prior concentrating a point mass
at the MLE-like alternative, and the infimum has the closed form above; it
diverges as `p → 0` and equals 1 at `p = 1/e`. Clamped to `1e6`. A p-value is
calibrated conservatively: e.g. `p=0.05` gives `BF_min ≈ 2.46`.

## II.24 Binomial recovery evidence

With a `Beta(1,1)`-regularised plug-in `θ̂ = (k+1)/(n+2)`:

```
L₁ = θ̂^k (1 − θ̂)^{n−k} ,   L₀ = 0.5^n ,   BF = L₁/L₀ .
```

When recovery is below chance (`k < n/2`) the support is inverted
(`BF = 1/min(1e6, 1/raw)`). Sequential ledger: odds `O = prior/(1−prior)`,
`O' = O·BF`, posterior `O'/(1+O')`, idempotent by evidence id.

---

# Part III — Composite detectors

## III.1 Min–max channel normalisation (radar / life-organization)

Per channel with sample values `v`, let `mn = min v`, `mx = max v`,
`span = mx − mn`, `absMax = max(|mn|,|mx|)`:

```
dead       if span ≤ REL_FLOOR·(|mn| + |mx|) + 1e−12   (⇒ returns null)
zero       if absMax ≤ ZERO_FLOOR                        (⇒ DORMANT)
constant   if span ≈ 0 but not zero                      (⇒ all norms = 1)
live       otherwise:   v' = clamp01( (v − mn)/span ) .
```

`REL_FLOOR = 1e−3`, `ZERO_FLOOR = 1e−6`. A level's live fraction is
`coverage = liveChannels/channels`; the level is measured only if `coverage ≥
MIN_COVERAGE = 0.25`, and its score is the mean of the live channel norms.

## III.2 Hysteresis status state machine

```
rawStatus = score ≥ 0.6 ? EMERGENT : score ≥ 0.2 ? PARTIAL : ABSENT
nextStatus = (prev EMERGENT ? score ≥ 0.4 : rawStatus)   (schmitt trigger)
```

The `0.6`/`0.4` band (with `0.2` for PARTIAL) prevents flicker: a level must
reach `0.6` to turn on but only fall below `0.4` to turn off.

## III.3 Novelty residual

Across samples `t`, for each feature `f`,
`d_{f,t} = v_{f,t} − v_{f,t−1}`. With a robust scale
`scale = median|d| ‖ mean|d|` (fallback to the other if 0):

```
z_{f,t} = |d_{f,t}| / scale ,
novelty_t = clamp01( √( (1/m) Σ_f z_{f,t}² ) / K ) ,   K = 3 .
```

This is a per-sample RMS of standardised first differences — high when the
world is changing in unexpected directions, low when it is stationary.

## III.4 Radar / level scores

Context = each primitive stretched over the sample window; a level's score is
the mean of its primitives' norms (all primitives available, else `null`).
Validation of a detector: `baselinePeak ≥ 0.6` and
`baselinePeak − ablatedPeak ≥ RADAR_MARGIN = 0.25` (the detector must *name*
the ablated capability). `RADAR_MARGIN = 0.25`.

## III.5 Life-organization

Same stretch/hysteresis machinery over `SimStats` channels grouped into
`LIFE_LEVELS` O0–O9 (Subatomic/quantum → Organism). Degrees excluded;
`coverage ≥ 0.25` required to measure; `dominant`/`ceiling` prefer
`coverage ≥ 0.5` and ever-emergent levels. Statuses as `EMERGENT|PARTIAL|
ABSENT|DORMANT`.

## III.6 High-N G0–G8 scores and total

Candidates are scored by nine sub-scores (each in `[0,1]`):

```
G0 = 1 iff all finite ∧ synthesis.levels.length == 3, else 0        (validity)
G1 = 0.3·[minAlive>0] + 0.3·[maxSpecies≥2] + 0.4·[coop>1e−6 ∨ signal>1e−6]
G2 = clamp( 2·(1/7)( |ΔmacroIdx|/4 + |Δstructure| + |Δrigidity| + |Δpersistence|
                       + |ΔhL1| + |ΔhL2| + |ΔhL3| ), 0, 1 )        (distinctness)
G3 = 0.5·[minAlive>0 ∧ finalAlive>0] + 0.5·[persistence>0.2 ∨ rigidity>0.3]
G4 = reproducible ? 1 : digest ? 0.9 : 0.8                            (reproducibility)
G5 = 0.3·[|hazardCorr|>0.01 ∨ |signalCorr|>0.01] + 0.2·[coop>0 ∧ hL2≥0.5]
G6 = 0.3·[cycling] + 0.3·[hL1≥0.5] + 0.2·[hL2≥0.5] + 0.2·[hL3≥0.5]
G7 = 0.3 + 0.3·[macroIdx≥2] + 0.2·[rigidity>0.4] + 0.2·[maxSpecies≥3]
G8 = 0.4 + 0.3·[G6≥0.7 ∧ G5≥0.6] + 0.3·[G7≥0.6 ∧ G3≥0.6]
total = 2·G0 + G1 + G2 + G3 + 2·G4 + G5 + G6 + G7 + G8 .
```

(`[·]` is the Iverson bracket.) Weights double G0 (validity) and G4
(reproducibility) — a candidate must be *real* and *replayable* before its
richness counts.

## III.7 Macro-regime classifier

With `structure` (0.5·coopOrder + 0.5·speciesOrder), `rigidity`, `collapsed`:

```
collapsed   if collapsed
specialized if structure ≥ 0.55 ∧ rigidity ≥ 0.6
organized   if structure ≥ 0.42
clustered   if structure ≥ 0.30
random      otherwise
```

*Rigidity* = share of ticks in the most-visited quarter of visited states;
*persistence* = mean lag-1 state agreement
`p₁ = (1/(n−1)) Σ_{i≥1} [state_i = state_{i−1}]`; *collapse* = a sustained level
below `0.6×` the `0.75`-quantile reference over a trailing `0.1` window.

## III.8 Reproducibility digest

`runDigest(r) = SHA-256( JSON( { worldFingerprint, trajectory, summary,
synthesis } ) )`. `worldFingerprint` hashes the full grid + alive agents, so two
runs are bit-identical iff their digests match — the experiment runner's
reproducibility key.

---

## Cross-reference

- Mechanism code + parameters: [01-engine-and-algorithms.md](01-engine-and-algorithms.md).
- Detector pipelines: [02-processes.md](02-processes.md).
- Threshold catalogs: [`../REGIME_CATALOG.md`](../REGIME_CATALOG.md),
  [`../SCALING_CATALOG.md`](../SCALING_CATALOG.md).
