# Thesis: Engineering Emergence in a Deterministic Fractal-Life Sandbox

## Abstract
This work reframes a research-oriented fractal-life simulation as an *emergence
engineering* platform. A deterministic two-engine stack (TypeScript + Rust/WASM)
enables reproducible experiments. We formalize L1-L3 emergence, introduce a
design/search loop over controllable parameters (brain/paradigms, stochasticity,
cell biochemistry, astrophysical physics frame, omics), define quantitative
objectives, add a documented, bit-reproducible experiment runner, and extend
analysis to rare high-impact (black swan) events with joint event-set
probability. The result is a practical testbed for steering toward robust,
replicable emergence.

## Contributions
1. **Deterministic parity** - TS/WASM agreement with guarded replays; grounding
   preserved across paths.
2. **Ladder of emergence** - automated L1-L3 scoring with controlled causal
   scenarios and rich observables.
3. **Design/search** - objective functions, candidate parameterization,
   multi-seed evaluation, elite selection.
4. **Reproducible experiments** - immutable experiment records, a manifest with
   per-seed sha256 digests (world fingerprint + trajectory + summary +
   synthesis), and a `--verify` path that re-runs and compares bit-for-bit.
5. **Risk analysis** - black swan detection, surprise heuristic, independence +
   bounds for co-occurring events.
6. **API surface** - REST/WebSocket control/interventions/snapshots for
   programmatic campaigns.

## Methods
- **Reproducibility**: seed+config fixpoint; intervention log + snapshot replay;
  experiment manifests whose digests include the full world fingerprint
  (`LadderResult.worldFingerprint`), so distinct seeds never collide even when
  their summary is degenerate.
- **Objectives**: EMERGENT flags (L1-L3), adaptation, steady-state, speciation,
  hazard/signal, culture-species MI (normalized).
- **Search**: random (baseline) with elite; extensible to grid/hillclimb/Pareto.
- **Black swans**: detectors (extinction, complexity collapse, cooperation drop,
  culture loss); impact and surprise `S = impact*(1-p)/(p+eps)`; joint `P` via
  independence + Frechet bounds.
- **Validation**: fast-tier + full suite; ladder/experiment runs produce
  structured JSON/MD; a design regression test pins the ladder level-name
  contract.

## Results (representative)
- Fast tier green across workspaces; server API end-to-end; web build clean.
- The experiment runner reproduces real ladder runs bit-for-bit (`--verify`),
  and different seeds yield different digests.
- Black swan analysis surfaces rare, high-impact trajectories and co-occurring
  event sets with bounded probabilities.
- Testing found and fixed a real defect: emergence objectives matched level ids
  as `'L1'` while the ladder emits `'L1 life'`, silently scoring zero; prefix
  matching + a regression test now guard it.

## Discussion
Treating emergence as an *engineering objective* (not merely observed) demands:
(a) determinism + parity, (b) explicit objectives/thresholds, (c) multi-seed
aggregation to avoid single-seed overfitting, (d) documented, re-runnable
experiments, and (e) principled handling of rare events. The platform enables
falsifiable claims about what conditions tend to produce robust L3 emergence.

## Conclusion
Fractal Life v2 is ready for systematic emergence-engineering campaigns: define
objectives, search candidates, evaluate across seeds, document experiments that
reproduce bit-for-bit, and quantify tail-risk (black swans). The scaffold is
minimal, typed, and reproducible.

## References
- Engine/ladder, design, experiments, black swans, event probability (see code).
