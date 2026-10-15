# Causal decomposition of collective behaviour

## What makes this an intervention rather than an observation

Every agent thrust in the engine is `clamp(brain + drive * DRIVE_SCALE, -1, 1)`,
and the 15-input sensor vector contains no neighbour velocity, heading or position
offset. The drive block is therefore the only causal channel from one agent's motion
to another's. Setting a drive gene to its zero weight deletes that pathway outright,
so a behavioural change under ablation is attributable to that term.

## The tick budget is a third axis of fragility, next to the seed and the density

Labels are reported as the state measured at tick 400. That number is a modelling
choice, and it is not innocent: re-running the same arms at 200 ticks changes some
labels outright, because at 200 ticks the measurement window is still drifting.
An early version of this study was made faster by halving the budget and silently
inverted a conclusion.

The `convergenceError` column, in arena widths, is the disagreement between the two
halves of the measurement window on the readouts the classifier uses. It is reported
rather than gated on, because it does not shrink with run length - it is 0.42 at 200
ticks, 1.27 at 400 and 2.83 at 600 on the dense arms. The arms are not converging to a
fixed point, and that is not a defect: a dispersed arm is still expanding, a swirling
arm is still rotating, and both are legitimate behaviour classes. What the column
buys is the ability to see how much of any given label is budget-dependent.


Every arm is a set of founders carrying an identical genome with reproduction
switched off, so no agent is born during a run and no gene can drift. Each arm is
executed twice from an identical seed; all replays identical:
**true**.

## Two properties of the readout that a naive test would have missed

**Polarization is saturated and cannot carry the result.** Cohesion and circulation
both read 0.98-0.99 polarized, because each drags the whole population along a common
heading. At the low-density arm they differ by less than 0.05 in polarization while
differing by more than 0.4 in neighbour-spacing variability, and they land in different
behaviour classes. A flock test built on polarization alone would have scored a
collapsing clot and an evenly spaced swirl as equally flocking, and would have
confirmed whatever story was written down first. The discriminating axes are spread,
nearest-neighbour regularity, and rotational order; polarization enters only as a floor.

**Alignment cannot bootstrap from rest.** Agents spawn at rest and alignment sums the
velocities of *neighbours*. With every agent stationary the neighbour velocity sum is
zero, the term never fires, and the population stays frozen indefinitely. Measured
from rest, alignment scores exactly 0.000 in every configuration - not a weak effect but
a dead pathway. Alignment is a coupling term, not a motive force. A seeded heading of
magnitude 2, identical in every arm, is what makes it switchable at all.

## Headline: what survives replication, and what does not

The first version of this study ran every arm once. Repeating each arm across
5 independent seeds (101, 202, 303, 404, 505) invalidated most of
those single-seed labels, so the claims below are ordered by how much evidence stands
behind them.

**13 of 16 arms are seed-dependent**, while every arm replays bit-identically.
That contrast is the single most important number in this report, and it is why the
single-seed tables further down are marked superseded rather than deleted.

**The two densities are not asking the same question.** The sufficiency search anchors to the
full set's modal class, which is `flocking` at high density but `cohesive` at low density -
because the full set is itself seed-dependent, reading one class on some seeds and the
other on the rest. So the two robust-sufficient lists below are not comparable to each
other. The target-independent answer, which is comparable, is given immediately below.

### Robust: what reliably flocks, at both densities

Anchored to `flocking` explicitly, so these two lists mean the same thing and can be
compared directly. An arm is listed only if it reached a flock on all
5 seeds.

- **High density** (3 arms): `cohesion+separation`, `alignment+cohesion+separation`, `cohesion+separation+circulation`
- **Low density** (1 arm): `cohesion+separation+circulation`

`cohesion+separation+circulation` is the overlap: the one arm that flocks at **both** densities on every seed.
That is the density-invariant answer, and it is a stronger claim than either list makes
on its own.

Anchored instead to each density's own target (`flocking` high, `cohesive` low),
the sufficient sets are:
- high: `cohesion+separation`
- high: `alignment+cohesion+separation`
- high: `cohesion+separation+circulation`
- low: `alignment+circulation`

### Robust: the triad is sufficient but not minimal

At high density these arms flocked on **every** seed:
- `cohesion+separation`
- `alignment+cohesion+separation`
- `cohesion+separation+circulation`

`none` and `separation` are inert on every seed at every density, and `cohesion`
never flocks on any seed at either density. That leaves one clean sufficient set:
**`cohesion+separation`**, a bounded even lattice with no rotation. The triad
`alignment+cohesion+separation` is sufficient as well, but not minimal, because that
strict subset already reaches the same outcome. The prediction was right that these
terms produce a flock and wrong that all three are needed: alignment contributes
nothing the other two do not already achieve.

A second route exists but is *not* robust: `circulation` alone reaches a flock on
80% of seeds at high density and
60% at low density, so a rotating swirl is a
plausible second mechanism rather than an established one. It is worth noting that a
swirl keeps agents evenly spaced by construction, which is why it reaches the same
behavioural class as the lattice without sharing any of its components.

### Robust: two components are dead ends, for different reasons

`none` and `separation` are inert on every seed at every density. Separation fails
because from rest it has nothing to push against, and because its
4-unit radius sits 9x below the 36-unit sense radius,
making it a collision term rather than a spacing term. Cohesion alone never flocks on
any seed at either density: it collapses agents onto the centroid, which maximises
heading agreement while destroying the even spacing that defines a flock.

### The density boundary is a band, not a constant

A single-seed sweep produced a clean, exception-free transition - the triad was a ragged
mass at low density and a flock at high density, with the flip landing exactly where
mean spacing entered separation reach. The transition is real and the sweep reproduces
it, but calling it one geometric constant was an overclaim. The sweep agrees on every
density it samples, and the seeded replication lands *between* two of its rows:

| arena | spawn | mean nn | nn / sep radius | mean nnCV | triad | agreement | fraction flocking |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 220 | 60 | 17.4 | 4.4x | 4.95 | cohesive | 100% | 0% |
| 160 | 60 | 5.9 | 1.5x | 0.60 | flocking | 100% | 100% |
| 120 | 60 | 5.5 | 1.4x | 0.52 | flocking | 100% | 100% |
| 90 | 60 | 4.6 | 1.1x | 0.47 | flocking | 100% | 100% |
| 70 | 60 | 4.6 | 1.2x | 0.54 | flocking | 100% | 100% |
| 90 | 24 | 6.9 | 1.7x | 0.66 | flocking | 100% | 100% |
| 60 | 24 | 5.4 | 1.3x | 0.45 | flocking | 100% | 100% |

`arena 160` and `arena 220` are both unanimous in the sweep, yet the seeded
replication at `arena 140` - the low-density arm - puts the triad in `flocking` on only
60% of 5 seeds. The boundary is therefore a band roughly one to four
nearest-neighbour radii wide, and inside the band the label is seed-dependent. A
single-seed sweep cannot distinguish a threshold from a band, because it samples
exactly one point of it.

The geometric mechanism itself is robust: mean nearest-neighbour variability tracks the
ratio of mean spacing to the separation radius, falling from above 3.5 while spacing is
several radii out to below 0.7 once it is within two. That relationship survives every
seed. What does not survive is the claim that the ratio *decides* the outcome - it
predicts the regularity of the spacing reliably, and predicts the behaviour label only
outside the boundary band.

## Single-seed arm tables (seed 999), superseded by the replication above

These tables are kept because they show each arm's geometry in full, but each is a
single draw. Where the replication table marks an arm seed-dependent, the class shown
here is not a result.

### High density (arena 90, 24 agents) - single-seed target: flocking

Single-seed minimal sufficient sets: `alignment`, `circulation`, `cohesion+separation`

**Replicated** sufficient sets, every seed: `cohesion+separation`, `alignment+cohesion+separation`, `cohesion+separation+circulation`

Necessary out of the full set: cohesion

Dispensable: alignment, separation, circulation

| set | behaviour | alive | movers | pol | rot | spread | nn | nnCV | drift |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `none` | inert | 24 | 0 | 0.000 | 0.000 | 36.9 | 10.6 | 0.62 | 0.00 |
| `alignment` | flocking | 24 | 24 | 0.999 | 0.048 | 66.5 | 11.9 | 0.64 | 1.88 |
| `circulation` | flocking | 24 | 24 | 0.998 | 0.051 | 44.9 | 8.5 | 0.78 | 1.80 |
| `cohesion` | cohesive | 24 | 24 | 1.000 | 0.148 | 50.8 | 5.4 | 1.07 | 2.12 |
| `separation` | inert | 24 | 0 | 0.000 | 0.000 | 36.8 | 11.1 | 0.55 | 0.00 |
| `alignment+circulation` | cohesive | 24 | 24 | 0.959 | 0.077 | 60.5 | 14.4 | 2.01 | 3.68 |
| `alignment+cohesion` | clumped | 24 | 24 | 1.000 | 0.005 | 35.7 | 3.1 | 1.81 | 4.10 |
| `alignment+separation` | flocking | 24 | 24 | 1.000 | 0.080 | 60.3 | 13.6 | 0.47 | 1.90 |
| `cohesion+circulation` | flocking | 24 | 24 | 0.985 | 0.108 | 40.8 | 6.0 | 0.89 | 2.80 |
| `cohesion+separation` | flocking | 24 | 24 | 1.000 | 0.105 | 51.0 | 7.0 | 0.54 | 2.13 |
| `separation+circulation` | flocking | 24 | 24 | 0.998 | 0.034 | 43.7 | 10.5 | 0.47 | 1.80 |
| `alignment+cohesion+circulation` | flocking | 24 | 24 | 0.987 | 0.104 | 46.8 | 4.6 | 0.63 | 3.53 |
| `alignment+cohesion+separation` | flocking | 24 | 24 | 0.995 | 0.067 | 38.9 | 6.0 | 0.69 | 3.95 |
| `alignment+separation+circulation` | cohesive | 24 | 24 | 0.967 | 0.069 | 62.1 | 15.5 | 1.72 | 3.68 |
| `cohesion+separation+circulation` | flocking | 24 | 24 | 0.971 | 0.084 | 43.5 | 8.1 | 0.66 | 2.79 |
| `alignment+cohesion+separation+circulation` | flocking | 24 | 24 | 0.989 | 0.072 | 47.6 | 7.0 | 0.46 | 3.52 |

### Ablation out of the full set

| removed | behaviour without | changed | d spread | d nn | d nnCV | d pol |
| --- | --- | --- | --- | --- | --- | --- |
| alignment | flocking | false | 4.1 | -1.1 | -0.20 | 0.018 |
| cohesion | cohesive | true | -14.4 | -8.5 | -1.26 | 0.021 |
| separation | flocking | false | 0.8 | 2.3 | -0.17 | 0.001 |
| circulation | flocking | false | 8.7 | 1.0 | -0.23 | -0.007 |

### Pairwise interactions

| pair | neither | a only | b only | both | synergistic |
| --- | --- | --- | --- | --- | --- |
| alignment + cohesion | inert | flocking | cohesive | clumped | true |
| alignment + separation | inert | flocking | inert | flocking | false |
| alignment + circulation | inert | flocking | flocking | cohesive | true |
| cohesion + separation | inert | cohesive | inert | flocking | true |
| cohesion + circulation | inert | cohesive | flocking | flocking | false |
| separation + circulation | inert | inert | flocking | flocking | false |

### Low density (arena 140, 60 agents) - single-seed target: flocking

Single-seed minimal sufficient sets: `circulation`

**Replicated** sufficient sets, every seed: `alignment+circulation`

Necessary out of the full set: cohesion, circulation

Dispensable: alignment, separation

| set | behaviour | alive | movers | pol | rot | spread | nn | nnCV | drift |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `none` | inert | 60 | 0 | 0.000 | 0.000 | 57.0 | 9.5 | 0.61 | 0.00 |
| `alignment` | dispersed | 60 | 59 | 0.292 | 0.161 | 419.9 | 16.6 | 2.78 | 3.11 |
| `circulation` | flocking | 60 | 60 | 0.995 | 0.063 | 56.8 | 7.6 | 0.87 | 1.78 |
| `cohesion` | cohesive | 60 | 60 | 0.983 | 0.148 | 115.6 | 13.9 | 6.16 | 2.13 |
| `separation` | inert | 60 | 0 | 0.000 | 0.000 | 56.9 | 10.4 | 0.48 | 0.00 |
| `alignment+circulation` | cohesive | 60 | 60 | 0.966 | 0.075 | 117.9 | 19.3 | 4.52 | 3.77 |
| `alignment+cohesion` | milling | 60 | 60 | 0.976 | 0.264 | 122.8 | 15.9 | 7.16 | 3.88 |
| `alignment+separation` | dispersed | 60 | 60 | 0.314 | 0.044 | 412.8 | 12.5 | 0.55 | 3.05 |
| `cohesion+circulation` | clumped | 60 | 60 | 0.975 | 0.097 | 56.5 | 4.0 | 0.83 | 2.81 |
| `cohesion+separation` | cohesive | 60 | 60 | 0.981 | 0.072 | 115.8 | 16.7 | 5.13 | 2.24 |
| `separation+circulation` | flocking | 60 | 60 | 0.997 | 0.044 | 56.8 | 8.8 | 0.57 | 1.79 |
| `alignment+cohesion+circulation` | flocking | 60 | 60 | 0.976 | 0.121 | 72.7 | 4.1 | 0.88 | 3.52 |
| `alignment+cohesion+separation` | cohesive | 60 | 60 | 0.936 | 0.176 | 133.5 | 19.2 | 5.52 | 3.76 |
| `alignment+separation+circulation` | cohesive | 60 | 60 | 0.966 | 0.089 | 117.5 | 20.9 | 4.17 | 3.76 |
| `cohesion+separation+circulation` | flocking | 60 | 60 | 0.964 | 0.087 | 56.4 | 6.3 | 0.48 | 2.79 |
| `alignment+cohesion+separation+circulation` | flocking | 60 | 60 | 0.977 | 0.126 | 71.0 | 6.1 | 0.46 | 3.51 |

### Ablation out of the full set

| removed | behaviour without | changed | d spread | d nn | d nnCV | d pol |
| --- | --- | --- | --- | --- | --- | --- |
| alignment | flocking | false | 14.6 | -0.2 | -0.03 | 0.013 |
| cohesion | cohesive | true | -46.5 | -14.8 | -3.71 | 0.011 |
| separation | flocking | false | -1.7 | 2.0 | -0.42 | 0.001 |
| circulation | cohesive | true | -62.5 | -13.1 | -5.07 | 0.041 |

### Pairwise interactions

| pair | neither | a only | b only | both | synergistic |
| --- | --- | --- | --- | --- | --- |
| alignment + cohesion | inert | dispersed | cohesive | milling | true |
| alignment + separation | inert | dispersed | inert | dispersed | false |
| alignment + circulation | inert | dispersed | flocking | cohesive | true |
| cohesion + separation | inert | cohesive | inert | cohesive | false |
| cohesion + circulation | inert | cohesive | flocking | clumped | true |
| separation + circulation | inert | inert | flocking | flocking | false |

## Seed replication detail

Determinism proves an arm replays. It does not prove the arm's behaviour is a property
of its gene set rather than of the one initial condition it happened to receive. Every
arm was therefore repeated across 5 independent seeds
(101, 202, 303, 404, 505). An arm whose class differs between seeds has no class,
and no sufficiency claim may rest on it.

| set | dense modal | dense agreement | sparse modal | sparse agreement |
| --- | --- | --- | --- | --- |
| `none` | inert | 1.00 | inert | 1.00 |
| `alignment` | flocking | 0.40 (seed-dependent) | dispersed | 0.40 (seed-dependent) |
| `circulation` | flocking | 0.80 (seed-dependent) | flocking | 0.60 (seed-dependent) |
| `cohesion` | cohesive | 0.60 (seed-dependent) | clumped | 0.60 (seed-dependent) |
| `separation` | inert | 1.00 | inert | 1.00 |
| `alignment+circulation` | cohesive | 0.40 (seed-dependent) | cohesive | 1.00 |
| `alignment+cohesion` | clumped | 0.80 (seed-dependent) | clumped | 0.60 (seed-dependent) |
| `alignment+separation` | flocking | 0.40 (seed-dependent) | dispersed | 0.40 (seed-dependent) |
| `cohesion+circulation` | cohesive | 0.40 (seed-dependent) | cohesive | 0.40 (seed-dependent) |
| `cohesion+separation` | flocking | 1.00 | flocking | 0.80 (seed-dependent) |
| `separation+circulation` | flocking | 0.80 (seed-dependent) | flocking | 0.60 (seed-dependent) |
| `alignment+cohesion+circulation` | cohesive | 0.40 (seed-dependent) | cohesive | 0.60 (seed-dependent) |
| `alignment+cohesion+separation` | flocking | 1.00 | flocking | 0.60 (seed-dependent) |
| `alignment+separation+circulation` | cohesive | 0.40 (seed-dependent) | cohesive | 0.80 (seed-dependent) |
| `cohesion+separation+circulation` | flocking | 1.00 | flocking | 1.00 |
| `alignment+cohesion+separation+circulation` | flocking | 0.60 (seed-dependent) | cohesive | 0.60 (seed-dependent) |

Seed-dependent arms, whose single-seed label must not be treated as a result:
- dense: `alignment`, `circulation`, `cohesion`, `alignment+circulation`, `alignment+cohesion`, `alignment+separation`, `cohesion+circulation`, `separation+circulation`, `alignment+cohesion+circulation`, `alignment+separation+circulation`, `alignment+cohesion+separation+circulation`
- sparse: `alignment`, `circulation`, `cohesion`, `alignment+cohesion`, `alignment+separation`, `cohesion+circulation`, `cohesion+separation`, `separation+circulation`, `alignment+cohesion+circulation`, `alignment+cohesion+separation`, `alignment+separation+circulation`, `alignment+cohesion+separation+circulation`

Arms reaching `flocking` on every seed - high density: `cohesion+separation`, `alignment+cohesion+separation`, `cohesion+separation+circulation`

Arms reaching `cohesive` on every seed - low density: `alignment+circulation`

Those two lines name different target classes, so they are not comparable. For a
comparison that holds, use the target-independent flocking lists:

Arms reaching `flocking` on every seed - high density: `cohesion+separation`, `alignment+cohesion+separation`, `cohesion+separation+circulation`

Arms reaching `flocking` on every seed - low density: `cohesion+separation+circulation`

The target class is the full set's modal behaviour, and the full set is itself seed-dependent,
so the target is a property of this seed set rather than of the mechanism: `flocking` across
5 seeds at high density, `cohesive` at low. A different seed set could anchor the
search elsewhere, which is why the flocking lists above are the ones to quote.

## How much of this depends on where the classifier cuts were drawn

Every label above is a threshold on a continuous readout, and none of those thresholds was
validated against anything except this run. That is the weakest assumption in the design, and it is
invisible in the tables because a label reads like a measurement. Each cut was therefore swept over
all 160 stored runs and every run re-classified - no new simulation, just re-reading the same
settled states through a moved cut.

| cut | nominal | worst relabel rate | boundaries it moves | labels it admits |
| --- | --- | --- | --- | --- |
| milling rotational order | 0.250 | 4% of runs, worst at x0.8 | `cohesive->milling`, `flocking->milling`, `milling->dispersed` | `dispersed`, `milling` |
| lattice neighbour CV | 1.000 | 11% of runs, worst at x0.8 | `flocking->cohesive`, `cohesive->flocking` | `cohesive`, `flocking` |
| flocking polarization floor | 0.600 | **0% (stable)** | none | none |
| cohesive spread (fraction of arena) | 1.000 | 1% of runs, worst at x0.8 | `cohesive->flocking`, `flocking->cohesive` | `cohesive`, `flocking` |
| dispersed spread (fraction of arena) | 1.600 | 1% of runs, worst at x1.25 | `dispersed->cohesive`, `cohesive->dispersed` | `cohesive`, `dispersed` |

4 of 5 cuts relabel something under perturbation. Reading the third column matters more than the
second: a relabel rate only tells you how much moved, not whether it moved coherently.

The most exposed cut is **lattice neighbour CV**: at x0.8 it relabels
11% of runs, moving `cohesive`, `flocking`, `milling`, `dispersed`.
The milling result above is therefore reported with an explicit separation margin rather
than as a clean cut, and any claim about the *identity* of a class near one of these
boundaries is a claim about where the classifier drew its line.

## Does this survive a different genome?

The whole study above runs on one genome background, so every claim is a statement about that
background rather than about the drive genes. The sharpest available check is gene 6, which sets
body size and therefore scales the separation radius - the one background parameter this
study's geometric explanation actually leans on.
The variant `double-size` sets gene 6 = -0.5 (body size 1.0, halving the sense/separation mismatch to 4.5x).
It moves the separation radius from 4.0 to 8.0 against a 36.0 sense
radius, i.e. from 9.0x to 4.5x.

| background | sep radius | robust flocking, high | robust flocking, low | never flocks |
| --- | --- | --- | --- | --- |
| feed-min | 4.0 | cohesion+separation, alignment+cohesion+separation, cohesion+separation+circulation | cohesion+separation+circulation | none, cohesion, separation, alignment+cohesion, alignment, alignment+circulation, alignment+separation |
| double-size | 8.0 | cohesion+separation, separation+circulation, alignment+cohesion+separation, cohesion+separation+circulation, alignment+cohesion+separation+circulation | cohesion+separation, cohesion+separation+circulation, alignment+cohesion+separation+circulation | none, cohesion, separation, alignment+cohesion, cohesion+circulation, alignment+cohesion+circulation, alignment, circulation, alignment+cohesion+separation |

At high density, 3 of the 3 arms that flock reliably on the
default background also do so on the variant: `cohesion+separation`, `alignment+cohesion+separation`, `cohesion+separation+circulation`.
Only on the variant background: `separation+circulation`, `alignment+cohesion+separation+circulation`.

Inertness is the finding that transfers most cleanly: `none` and `separation` are inert on all
5 seeds on the default background, and remain inert on the variant (`none`, `separation`).
An arm with no drive pathway cannot behave differently because of a drive-gene edit, so this
is the one prediction the variant cannot falsify - which is why it is worth saying rather than
leaning on.

Seed instability is comparable across the two (11 of 16 arms unstable on the
default, 10 on the variant across both densities).

**The causal ordering survives the background change.** Which arms are sufficient moves,
which is expected: a larger separation radius moves the density boundary by construction.
What persists is that arms with no working pathway still have none, and arms that organised
a flock still do.

## Known limits of this study

- One world parameter set. Two genome backgrounds were run (`double-size` and the default),
  which tests the drive genes against one alternative geometry but against nothing else.
  The sense radius, and every gene outside the drive block, are still single-valued, so this is
  not a claim about the drive genes in isolation.
- `drift` is reported but is not a gate on any class. A flock that hovers in place and one
  that travels are not separated, because no threshold for "travelling" was validated
  against anything independent.
- `milling` is reached by 2 of the 16 arms, each at both densities:
  - `alignment`: high-density 1/5, low-density 2/5
  - `alignment+separation`: high-density 1/5, low-density 2/5
  Every one of them omits `cohesion`, and nothing that carries cohesion ever mills.
  That is mechanistically coherent: milling needs a coherent rotation, and cohesion
  collapses the ring that carries it. It is necessary *within this study*, which is not
  the same as necessary in general, since only two genome backgrounds were run.
  The cut is internally consistent but narrow: across all 160 replicated runs, every milling
  run reads rotational order at or above 0.28 and the highest non-milling run reads
  0.24, so nothing lands on the wrong side of the 0.25 cut - but the
  margin between the two populations is only 0.04. A cut that thin is
  reproducible without being comfortable, and the absolute value of the threshold has
  never been validated against anything outside this run.

  Sweeping this specific cut shows the "milling never flakes" reading is not safe. Across the
  x0.8 to x1.25 sweep it produces:
    - `cohesive->milling` (5 runs, furthest at x0.9)
    - `flocking->milling` (3 runs, furthest at x0.9)
    - `milling->dispersed` (2 runs, furthest at x1.25)
  3 of those edges cross the milling boundary (10 runs: 8 demoted into milling, 2
  pushed out of it), so milling membership itself depends on where this cut sits. The
  per-seed milling counts above should be read as counts *against this cut*: an arm
  recorded as 1/5 is not a robustly non-milling arm, it is one arm that missed on one seed
  by a margin smaller than the perturbation swept here.

- Founders are placed uniformly, so these are flocking results for a uniform initial
  condition. Predator-prey structure, food gradients, and obstacle fields are absent.
- The tick budget is a modelling choice, not a measurement. Labels are the state at 400
  ticks, and `convergenceError` records how far the window is still drifting. A run long
  enough to reach a true steady state would report different numbers, and for the
  expanding and rotating arms no such steady state exists.
