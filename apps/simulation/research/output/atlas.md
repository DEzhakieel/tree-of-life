# emergence atlas: atlas.s1, atlas.s2, atlas.s3, atlas.s4, atlas.s5, atlas.s6, atlas.s7, pipe|x

80 ticks, spawn 100, 8 run(s), x = composite disorder: mean of Simpson diversity (1 - sum p^2), Pielou evenness
(H / log2 S, falling back to raw entropy without species counts) and the lyapunov
exponent — each component stretched min-max across the run's own envelope, with
noise floors so a jittering-but-dead signal is dropped, and lyapunov admitted only
when it varies and reaches lambda > 0. Bands are thirds of x and read relative to
this run: ORDER = its most ordered stretch, CHAOS = its most disordered. y = LMC
complexity normalised to the run peak; the dashed arch is the reference curve
y = 4x(1-x), not a fit. Compare trajectory shapes and residence shares, not
absolute x across different run sets. Descriptive/correlational, not causal.

## runs

| seed | n | order | edge | chaos | dominant | peak y @ t | end x, y | end regime |
|---|---|---|---|---|---|---|---|---|
| atlas.s1 | 80 | 0% | 91% | 9% | edge | 1.00 @ 51 | 0.50, 1.00 | edge |
| atlas.s2 | 80 | 51% | 25% | 24% | order | 1.00 @ 63 | 0.16, 0.86 | order |
| atlas.s3 | 80 | 0% | 79% | 21% | edge | 1.00 @ 67 | 0.34, 0.96 | edge |
| atlas.s4 | 80 | 0% | 98% | 3% | edge | 0.00 @ 1 | 0.50, 0.00 | edge |
| atlas.s5 | 80 | 0% | 93% | 8% | edge | 1.00 @ 70 | 0.47, 1.00 | edge |
| atlas.s6 | 80 | 16% | 28% | 56% | chaos | 1.00 @ 76 | 0.14, 1.00 | order |
| atlas.s7 | 80 | 39% | 33% | 29% | order | 1.00 @ 68 | 0.22, 1.00 | order |
| pipe\|x | 80 | 0% | 96% | 4% | edge | 1.00 @ 79 | 0.42, 1.00 | edge |

## pooled residence (run-weighted)

| regime | share | mean complexity |
|---|---|---|
| order | 13% | 0.84 |
| edge | 68% | 0.40 |
| chaos | 19% | 0.05 |

## how to read this

- the dashed arch in plots/atlas.svg is the expected edge-of-chaos ridge
  y = 4x(1-x) drawn for reference — it is not fitted to the data;
- trajectories connect per-tick stats points, coloured by regime; a run that
  parks in one band is dynamically frozen (order) or featureless (chaos);
- residence share plus mean complexity per regime is the summary statistic:
  high edge-residence with high edge mean-complexity is where emergence lives.
