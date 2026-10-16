# Fractal Life v2: Emergence Engineering Sandbox

A deterministic, two-engine (TypeScript + Rust/WASM) simulation for studying how
interactions produce life and cognition, now extended to *engineer* emergence:
search over controllable parameters, measure L1-L3 emergence, document and
reproduce experiments, and analyze rare/high-impact (black swan) events.

## Core concepts
- Deterministic by `(seed, config)`: replays reproduce byte-exact trajectories.
- TS reference engine + Rust/WASM parity (brain, stochastics, cellBio, universe, omics).
- Research ladder: L1-L3 emergence scoring with controlled causal scenarios.
- Design/search: objectives + candidate evaluation + multi-seed aggregation.
- Reproducible experiments: documented hypotheses + bit-exact digests + verify.
- Black swans: rare high-impact event detection + joint event-set probability.

## Quick start
```bash
npm install
npm run test:fast   # cheap tier across workspaces (fast feedback)
npm test            # full suite
```

## Key commands
- `npm run test:fast` / `npm test` - fast tier / full suite.
- `npm run research:scope` - validate and generate scope/claims outputs (apps/simulation).
- `npm run research:experiment -- --list` - document/run/reproduce experiments.
- Other research CLIs: `research:ladder`, `research:bench`, `research:rigor`, `research:ai`
  (see `apps/simulation/package.json`).
- Build server: `npm run build:server`; web: `npm run build:web`.

## Reproducible experiments
Experiments are immutable, documented records (`hypothesis + config + seeds +
objectives`) that can be run, saved as a manifest, and reproduced bit-for-bit.

```bash
cd apps/simulation
npx tsx src/research/experimentCli.ts --list
npx tsx src/research/experimentCli.ts --run l3-baseline
npx tsx src/research/experimentCli.ts --verify l3-baseline
```

- `run` executes the ladder per seed, scores the objectives, records a sha256
  *digest* (world fingerprint + trajectory + summary + synthesis), and writes
  `research/experiments/<id>.json`. A double-run of the first seed proves
  determinism at run time.
- `verify` re-runs a saved manifest and reports whether every digest is
  bit-identical (`REPRODUCED`) or differs (`FAILED`).
- The digest includes `LadderResult.worldFingerprint` (full grid + alive agents),
  so different seeds never collide even when their summary is degenerate.

Modules: `src/research/experiment.ts` (runner/digest/manifest),
`experimentRegistry.ts` (documented experiments), `experimentCli.ts` (CLI).

## Architecture
- `apps/simulation/` - TS engine, research CLIs, design/search, experiments, black swans.
- `crates/` - Rust engine + WASM crate (parity with TS).
- `apps/server/` - REST/WebSocket API (worlds, snapshots, events, interventions).
- `apps/web/` - browser UI and worker engine.
- `packages/shared/` - types/constants/protocol.

## Emergence engineering
- `src/research/design/` - objectives, candidates, evaluation, search.
- `src/research/experiment.ts` - documented, reproducible experiment runner.
- `src/research/blackSwans.ts` - rare/high-impact detection + surprise scoring.
- `src/research/eventProbability.ts` - joint event-set probability (independence + bounds).
- `research/SYSTEM_MAP.md` - research-grade map of every subsystem.
- `THESIS.md` - thesis framing of the platform.

## Testing
`scripts/run-tests.mjs` discovers `test/*.test.ts` per workspace. `--fast` runs
the cheap tier (from `test/tiers.json`); the default full run includes the long
poles (causal, parity, experiment, ...). Research tests never write shared state.

## Research outputs
Generated artifacts live under `apps/simulation/research/` (SCOPE.md, output/,
experiments/, ladder/) and are committed where appropriate.

## License
MIT.
