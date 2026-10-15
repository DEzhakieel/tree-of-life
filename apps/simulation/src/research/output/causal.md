# Causal decomposition of collective behaviour

## What makes this an intervention rather than an observation

Every agent thrust in the engine is `clamp(brain + drive * DRIVE_SCALE, -1, 1)`,
and the 15-input sensor vector contains no neighbour velocity, heading or position
offset. The drive block is therefore the only causal channel from one agent's motion
to another's. Setting a drive gene to its zero weight deletes that pathway outright,
so a behavioural change under ablation is attributable to that term.

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

## The headline result: the answer depends on density, not on the gene set

The hypothesis was that `alignment + separation + cohesion` is the collective flock.
That holds at high density and fails at low density, and the reason is a fixed
geometric constant rather than anything about the drives.

`feedGenome` pins gene 6 to -1, which decodes to the minimum body size 0.5, so the
separation drive only fires for neighbours inside `8 * 0.5 = 4` units,
while the sense radius is 36 - a ratio of 9x.
Separation is a *collision* term, not a spacing term: it can push two overlapping agents
apart, but it cannot organise agents into a formation, because the agents it can see at
flock scale are all outside its reach. Whether it functions as a spacing term at all
depends entirely on whether density brings mean spacing down to it.

| arena | spawn | triad nn | nnCV | separation in reach | triad | triad minus cohesion | circulation alone | cohesion alone |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 220 | 60 | 25.5 | 3.67 | false | **cohesive** | dispersed | cohesive | cohesive |
| 160 | 60 | 12.7 | 4.88 | false | **cohesive** | dispersed | cohesive | cohesive |
| 120 | 60 | 18.3 | 5.62 | false | **cohesive** | dispersed | cohesive | clumped |
| 90 | 60 | 4.7 | 0.41 | true | **flocking** | dispersed | clumped | clumped |
| 70 | 60 | 4.2 | 0.40 | true | **flocking** | flocking | clumped | clumped |
| 90 | 24 | 6.0 | 0.69 | true | **flocking** | flocking | flocking | cohesive |
| 60 | 24 | 5.2 | 0.54 | true | **flocking** | flocking | flocking | clumped |

The `nnCV` column is the pivot. While mean spacing sits well outside the separation
radius, nearest-neighbour variability stays above 1 and the triad is a ragged mass.
Once spacing falls to roughly twice the separation radius, variability collapses below
1 and the same three terms produce a genuine evenly spaced flock.

## Study at high density (arena 90, 24 agents) - target: flocking

Minimal sufficient sets: `alignment`, `circulation`, `cohesion+separation`

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

## Study at low density (arena 140, 60 agents) - target: flocking

Minimal sufficient sets: `circulation`

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

## What the two studies together say

At low density the triad fails and `circulation` alone flocks. Cohesion is what breaks
it: cohesion pulls every agent onto the group centroid, which raises nearest-neighbour
variability from below 1 to above 5 and destroys the even spacing that separation had
established. At high density separation finally gains the reach to hold spacing open,
and cohesion can no longer overwhelm it.

So the predicted triad is real but conditional, and the condition is a geometric
constant of the engine rather than a property of the drives. Reporting the triad as
the mechanism, without a density, would have been true at one operating point and
false at another.
