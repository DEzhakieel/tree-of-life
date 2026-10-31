# Experiment C - the kill-switch map

Generated 2026-10-31T07:00:32.067Z. read from C:\Users\LENOVO\Downloads\fractallife2\apps\simulation\research\output\kill-switch-series.json (generated 2026-10-31T07:00:32.067Z); no runs performed in this invocation.

16 seeds x (12 conditions + 4 dose curves x 6 doses + 10 locations) on a 48x48 torus, 750 ticks per run, perturbation at tick 250.

## What this measures

A colony of cells on a torus. Each occupied cell contributes to a colony-level public good in proportion to its local crowding, `(n/4)^2`; the good is well mixed inside a connected component, decays, and gates birth at the quorum threshold `S_MIN`. Births consume a global nutrient pool. Death rises when the good is low and when a cell is exposed. The colony is a self-sustaining emergent structure: above the quorum it replaces itself, below it no cell can divide and it decays.

The map asks which directed perturbation actually breaks that structure. Conditions remove a fixed fraction of the pre-lesion colony by different rules (geometric core, rim, lifetime divisions, age-matched random, density-matched random, uniform random), seal the core-periphery interface, cut the same number of random internal links, or pause a region for 100 ticks. The dose response repeats the removal rule at 5-40%. The location sweep moves a compact 40% lesion from the centroid through eight mid-radius azimuths to the rim.

**Destruction** is final population below 5% of the pre-lesion count. **Recovery** is the first tick after a dip below 90% of the pre-lesion count at which the population is back to 90%; runs that never dip are reported separately, and runs still below that level at the end are censored. **Loss** is `1 - final / control final` at the same seed. **Fragmentation** is measured immediately after the perturbation: number of connected components and the largest component as a fraction of surviving cells.

## Viability gate

Control: destruction 0%, mean final / pre 0.81, minimum 0.67. The assay is valid. control stays above the viability gate.

## Pre-registered claims

Effect floor for a destruction difference: 0.30. Seal loss floor: max(2 x between-seed SD of random-edge loss, 0.10) = 0.173. Location equivalence margin: 0.15 in loss. Decision rule: supported requires the point estimate to clear the floor and the paired bootstrap interval to lie on the required side; refuted requires the registered falsifier to fire; otherwise inconclusive.

| claim | verdict | result |
|---|---|---|
| C-KILL-01 | **supported** | participation 0.56 vs random 0.19; difference 0.38 [0.06, 0.63]; floor 0.30. |
| C-KILL-02 | **supported** | participation - ageMatched 0.56 [0.31, 0.81]; participation - densityMatched 0.38 [0.19, 0.63]; floor 0.30. |
| C-KILL-03 | **inconclusive** | seal - randomEdges loss 0.012 [-0.017, 0.040]; floor 0.173; seal destruction 0.00. |
| C-KILL-04 | **supported** | pause 0.00 vs removal 0.56; at least 90% of control 0.75. |
| C-KILL-05 | **supported** | centre - rim loss -0.002 [-0.045, 0.040]; sweep rho(distance, loss) 0.00 [-0.12, 0.12]. |

## Conditions (40% lesion unless noted)

| condition | n | destroyed | final / pre | loss vs control | median recovery | censored | no dip | components | largest | removed |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| control | 16 | 0% | 0.81 | 0.00 | 233 | 8 | 0 | 5 | 0.99 | 0 |
| core | 16 | 0% | 0.79 | 0.02 | 195 | 13 | 0 | 7 | 0.80 | 328 |
| rim | 16 | 0% | 0.77 | 0.04 | 104 | 0 | 0 | 2 | 1.00 | 328 |
| participation | 16 | 56% | 0.36 | 0.55 | 214 | 10 | 0 | 111 | 0.19 | 328 |
| matched | 16 | 19% | 0.68 | 0.16 | 217 | 6 | 0 | 95 | 0.14 | 328 |
| ageMatched | 16 | 0% | 0.82 | -0.02 | 201 | 4 | 0 | 68 | 0.22 | 305 |
| random | 16 | 19% | 0.66 | 0.17 | 215 | 7 | 0 | 81 | 0.23 | 328 |
| seal | 16 | 0% | 0.79 | 0.02 | 103 | 9 | 0 | 7 | 0.78 | 0 |
| randomEdges | 16 | 0% | 0.80 | 0.01 | 136 | 12 | 0 | 8 | 0.98 | 0 |
| delayCore | 16 | 0% | 0.79 | 0.02 | 237 | 11 | 0 | 5 | 0.99 | 0 |
| delayRim | 16 | 0% | 0.77 | 0.04 | 351 | 14 | 0 | 5 | 0.99 | 0 |
| delayParticipation | 16 | 0% | 0.79 | 0.02 | 249 | 12 | 0 | 5 | 0.99 | 0 |

The headline contrast is participation 56% destroyed vs random 19% destroyed (difference 0.38).

## Dose response

Cells show destruction / loss vs control. Participation is the top-division rule; matched and ageMatched are the controls.

| dose | participation | matched | ageMatched | random |
|---:|---:|---:|---:|---:|
| 0.05 | 0% / -0.02 | 0% / -0.02 | 0% / -0.01 | 0% / -0.03 |
| 0.10 | 0% / -0.04 | 0% / -0.02 | 0% / -0.02 | 0% / -0.01 |
| 0.15 | 0% / -0.06 | 0% / -0.05 | 0% / -0.02 | 0% / -0.04 |
| 0.20 | 0% / -0.06 | 0% / -0.04 | 0% / -0.03 | 0% / -0.03 |
| 0.30 | 13% / 0.07 | 13% / 0.08 | 0% / -0.06 | 0% / -0.04 |
| 0.40 | 56% / 0.55 | 19% / 0.16 | 0% / -0.02 | 19% / 0.17 |

Smallest dose reaching 50% destruction: participation 0.40, random n/a.

## Location sweep

| point | radius / colony radius | n | destroyed | loss vs control |
|---|---:|---:|---:|---:|
| centre | 0.00 | 16 | 0% | 0.020 |
| mid-0 | 0.50 | 16 | 0% | -0.022 |
| mid-1 | 0.50 | 16 | 0% | 0.001 |
| mid-2 | 0.50 | 16 | 0% | -0.017 |
| mid-3 | 0.50 | 16 | 0% | 0.003 |
| mid-4 | 0.50 | 16 | 0% | -0.020 |
| mid-5 | 0.50 | 16 | 0% | 0.005 |
| mid-6 | 0.50 | 16 | 0% | 0.013 |
| mid-7 | 0.50 | 16 | 0% | -0.001 |
| rim | 0.90 | 16 | 0% | 0.023 |

## Model assumptions and limits

- The public good is well mixed within a connected component. The model therefore tests colony-level quorum maintenance, not local diffusion or spatial signalling.
- A cell's lifetime division count is a marker, not a mechanism: it is not read by birth or death. Any difference between the participation and matched arms is therefore a spatial/demographic effect, not a direct cost of dividing.
- The interface seal is a ring of blocked edges. It tests one boundary mechanism; it does not test policing, adhesion or active transport.
- A pause freezes birth, death and public-good production in the paused cells for 100 ticks. It is not a model of quiescence with maintenance.
- Destruction is an extinction threshold. A colony that loses function but stays above 5% is not counted as destroyed; the loss and recovery columns carry that information.

## Reproduce

```
npm run research:killswitch
npm run research:killswitch -- --from-cache
```
