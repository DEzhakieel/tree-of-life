# emergence radar: radar.s1, radar.s2, radar.s3

300 ticks, spawn 50, sample every 10 ticks, 3 baseline run(s).

Each level is a conjunction of first-principles primitives (matter flux, homeostasis,
state->action feedback, within-lifetime memory, heredity, differential reproduction,
copy fidelity, information transfer, non-genetic transmission, integration, novelty,
richness), each primitive stretched min-max across THIS run's own envelope with a
relative dead-sensor floor. Levels cross EMERGENT at score >= 0.6 with hysteresis
(drop below 0.4 to fall). A level whose required substrate is absent reads DORMANT,
not ABSENT. Scores are run-relative: compare onsets and shapes, not absolute values.
A detector is accepted only if removing its enabling faculty (same world, same seeds)
collapses its peak by >= 0.25 from an EMERGENT baseline.

## level ladder (mean peak score over seeds)

| level | capability | status (final) | onset t | peak | ablation | validated |
|---|---|---|---|---:|---|---|
| L0 | Particle | EMERGENT/EMERGENT/EMERGENT | 190 | 1.000 | world | yes |
| L1 | Agent | EMERGENT/PARTIAL/EMERGENT | 120 | 0.791 | spawn | yes |
| L2 | Adaptive agent | PARTIAL/PARTIAL/EMERGENT | 10 | 0.843 | reflex | yes |
| L3 | Learning agent | EMERGENT/EMERGENT/EMERGENT | 40 | 0.898 | brain | yes |
| L4 | Ecosystem | ABSENT/PARTIAL/PARTIAL | 10 | 0.835 | monoculture | yes |
| L5 | Evolution | ABSENT/PARTIAL/EMERGENT | 10 | 0.997 | clonal | yes |
| L6 | Self-replication | ABSENT/ABSENT/PARTIAL | 10 | 0.833 | no-birth | yes |
| L7 | Communication | ABSENT/EMERGENT/ABSENT | 10 | 1.000 | signal-zero | yes |
| L8 | Culture | PARTIAL/EMERGENT/ABSENT | 10 | 0.846 | meme-zero | yes |
| L9 | Collective intelligence | PARTIAL/PARTIAL/EMERGENT | 10 | 0.776 | group-scaling | yes |
| L10 | Artificial ecosystem | EMERGENT/EMERGENT/EMERGENT | 260 | 0.737 | open-ended | yes |

## ablation validation

| level | faculty removed | wired | baseline peak | ablated peak | drop | verdict |
|---|---|---|---:|---:|---:|---|
| L0 | no world matter flux (spawn 0, no food regen, uniform inert terrain, no environment) | yes | 1.000 | 0.000 | 1.000 | VALIDATED |
| L1 | no agents spawned | yes | 0.791 | 0.500 | 0.291 | VALIDATED |
| L2 | sensorimotor loop disabled (agents hold position, no feedback) | yes | 0.843 | 0.000 | 0.843 | VALIDATED |
| L3 | learning disabled (brain off) | yes | 0.898 | 0.500 | 0.398 | VALIDATED |
| L4 | single founder (no ecological richness) | yes | 0.835 | 0.000 | 0.835 | VALIDATED |
| L5 | single founder clone (no heritable variation) | yes | 0.997 | 0.000 | 0.997 | VALIDATED |
| L6 | reproduction disabled (no offspring) | yes | 0.833 | 0.500 | 0.333 | VALIDATED |
| L7 | signal deposit 0 (closed communication channel) | yes | 1.000 | 0.000 | 1.000 | VALIDATED |
| L8 | meme copy rate 0 (culture transmission frozen) | yes | 0.846 | 0.500 | 0.346 | VALIDATED |
| L9 | tiny group (no collective scaling) | yes | 0.776 | 0.000 | 0.776 | VALIDATED |
| L10 | open-ended novelty off (discovery off + frozen uniform environment) | yes | 0.737 | 0.468 | 0.269 | VALIDATED |

strict: PASS — every detector ablation-validated
