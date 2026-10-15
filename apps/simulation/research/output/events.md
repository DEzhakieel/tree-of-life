# Event causality report

Source: in-process run, seeds event.s1, 60 ticks, spawn 100.
86 events; windows are 10 ticks either side of each occurrence;
lag correlation searched ±10 ticks.

## Event census

Occurrence ticks collapse same-tick events (per-agent types like birth/death emit many
events on one tick) — that collapsed count is the windowed sample size below.

| type | events | occurrence ticks | per 100 ticks | mean significance | median gap |
| --- | --- | --- | --- | --- | --- |
| `death` | 80 | 15 | 133.3 | 0.60 | 1 |
| `birth` | 4 | 4 | 6.7 | 0.15 | 6 |
| `migration` | 2 | 2 | 3.3 | 0.78 | 2 |

## Observational pre/post attribution

For each occurrence the metric's windowed mean before (`pre`) and after (`post`) is
paired, so every occurrence is its own control; `d_z` is the paired Cohen's effect and
`p` a paired t-test over occurrences. `peak r @ lag` correlates the event's impulse train
with the metric (both linearly detrended) across ±10 ticks — the event leads the
metric at positive lags. Rows are sorted by |d_z|.

| event | metric | n | pre | post | delta | d_z | p | peak r @ lag |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `death` | `diversity` | 5 | 0.968 | 0.955 | **-0.012** | -3.25 | 0.002 | 0.631 @ -9 |
| `death` | `cultureCount` | 5 | 17.660 | 16.120 | **-1.540** | -2.29 | 0.007 | 0.639 @ -9 |
| `death` | `entropy` | 5 | 5.014 | 4.488 | **-0.526** | -2.19 | 0.008 | 0.602 @ -9 |
| `death` | `avgEnergy` | 5 | 46.692 | 50.723 | **4.031** | 1.85 | 0.014 | -0.597 @ -1 |
| `death` | `speciesCount` | 5 | 34.520 | 22.520 | **-12.000** | -1.56 | 0.025 | 0.547 @ -9 |
| `death` | `aliveCount` | 5 | 39.100 | 22.980 | **-16.120** | -1.56 | 0.025 | 0.578 @ -9 |
| `death` | `predatorFraction` | 5 | 0.393 | 0.407 | 0.014 | 1.13 | 0.064 | -0.494 @ -10 |
| `death` | `cooperation` | 5 | 0.000 | 0.000 | 0.000 | 0.00 | 1.000 | 0.000 @ 0 |

Not analyzed (kept in the census):
- `birth` — only 4 occurrence tick(s), below the minimum of 5
- `migration` — only 2 occurrence tick(s), below the minimum of 5

## What this does and does not establish

- **Observational rows are associations inside one world.** Occurrences are not
  randomized; events are endpoints of the same dynamics that move the metrics. Nearby
  occurrences share window ticks, the metric is autocorrelated (which inflates r), and
  no multiple-comparison correction is applied across the metric grid. Read a large d_z
  with a consistent lag as a *candidate* mechanism, not a proven one.

No interventions were planted (`--no-plants`), so the interventional section was skipped.
