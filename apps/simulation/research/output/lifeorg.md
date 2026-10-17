# life-organization ladder: life.o1, life.o2, life.o3

400 ticks, spawn 60, sample every 10 ticks, 6 run(s).

Each level is a pure composition of measured `SimStats` observables (never an
engine self-flag). Observables are min-max stretched across the run; a level
turns EMERGENT when its mean stretched score crosses 0.6 and stays until it
falls below 0.4 (hysteresis). A channel that is all-zero across the whole run
(its subsystem is switched off) is excluded, and a level with < 25% of its
channels wired reads DORMANT — the substrate for that scale was never assayed,
so a zero is not reported as a failure.

**Substrate note.** This runner drives the TS *reference* engine, which leaves
the mesoscale-biophysics observables (`orgIndex`, `clusterOrder`,
`rotationalOrder`, `meanForce`) and the discovery/novelty observables at zero —
they are wired only in the Rust/WASM engine. Consequently O7 (organ) is assayed
here through its omics `metabolicRate` channel alone (coverage 0.25); the WASM
engine would flesh it out. Low coverage is reported, not smoothed over.

## ladder — legacy arm

| level | organization | scale | status | onset t | peak | coverage |
|---|---|---|---|---:|---:|---:|
| O0 | Subatomic / quantum | 1e-18–1e-10 m | DORMANT/DORMANT/DORMANT | n/a | 0.000 | 0.00 |
| O1 | Atomic / ionic | 1e-10 m | EMERGENT/EMERGENT/EMERGENT | 50 | 0.899 | 1.00 |
| O2 | Molecular | 1e-9 m | EMERGENT/EMERGENT/PARTIAL | 20 | 0.736 | 0.63 |
| O3 | Macromolecular (DNA/protein) | 1e-9–1e-7 m | DORMANT/DORMANT/DORMANT | n/a | 0.000 | 0.09 |
| O4 | Organellar | 1e-8–1e-6 m | EMERGENT/EMERGENT/PARTIAL | 160 | 0.800 | 0.29 |
| O5 | Cellular | 1e-5 m | EMERGENT/EMERGENT/EMERGENT | 160 | 0.808 | 0.75 |
| O6 | Tissue / specialization | 1e-3 m | EMERGENT/EMERGENT/EMERGENT | 10 | 0.706 | 0.67 |
| O7 | Organ | 1e-2 m | DORMANT/DORMANT/DORMANT | n/a | 0.000 | 0.00 |
| O8 | Organ system (loop/feedback) | 1e-1 m | DORMANT/DORMANT/DORMANT | n/a | 0.000 | 0.00 |
| O9 | Organism | 1 m | PARTIAL/EMERGENT/EMERGENT | 60 | 0.657 | 0.78 |

- life.o1: ceiling O9, dominant O1

- life.o2: ceiling O9, dominant O5

- life.o3: ceiling O9, dominant O1

## ladder — full arm

| level | organization | scale | status | onset t | peak | coverage |
|---|---|---|---|---:|---:|---:|
| O0 | Subatomic / quantum | 1e-18–1e-10 m | EMERGENT/PARTIAL/EMERGENT | 20 | 0.745 | 1.00 |
| O1 | Atomic / ionic | 1e-10 m | EMERGENT/EMERGENT/EMERGENT | 20 | 0.856 | 1.00 |
| O2 | Molecular | 1e-9 m | PARTIAL/PARTIAL/ABSENT | 20 | 0.722 | 0.63 |
| O3 | Macromolecular (DNA/protein) | 1e-9–1e-7 m | EMERGENT/PARTIAL/EMERGENT | 20 | 0.875 | 1.00 |
| O4 | Organellar | 1e-8–1e-6 m | EMERGENT/PARTIAL/PARTIAL | 30 | 0.609 | 0.71 |
| O5 | Cellular | 1e-5 m | EMERGENT/EMERGENT/EMERGENT | 80 | 0.802 | 0.75 |
| O6 | Tissue / specialization | 1e-3 m | PARTIAL/EMERGENT/PARTIAL | 10 | 0.652 | 0.78 |
| O7 | Organ | 1e-2 m | EMERGENT/EMERGENT/EMERGENT | 20 | 1.000 | 0.25 |
| O8 | Organ system (loop/feedback) | 1e-1 m | EMERGENT/PARTIAL/EMERGENT | 30 | 0.955 | 1.00 |
| O9 | Organism | 1 m | EMERGENT/EMERGENT/EMERGENT | 30 | 0.670 | 0.94 |

- life.o1: ceiling O9, dominant O8

- life.o2: ceiling O9, dominant O8

- life.o3: ceiling O9, dominant O8
