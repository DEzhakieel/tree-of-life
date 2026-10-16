# Fractal Life v2: Emergence Engineering Sandbox

A deterministic, two-engine (TypeScript + Rust/WASM) simulation for studying how interactions produce life and cognition, now extended to *engineer* emergence: search over controllable knobs, measure L1–L3 emergence, and analyze rare/high-impact (black swan) events.

## Core concepts
- Deterministic by (seed, config); replays reproduce byte-exact trajectories.
- TS reference + Rust/WASM parity (brain/stochastics/cellBio/universe/omics).
- Research ladder: L1–L3 emergence scoring with controlled scenarios.
- Design/search: objectives + candidate evaluation + multi-seed aggregation.
- Black swans: detection of rare high-impact events + joint event-set probability.

## Quick start
```bash
npm install
# Run fast tests (recommended for iteration)
npm run test:fast
# Run full suite
npm test
```

## Key commands
- `npm run test:fast` — run cheap tier across workspaces (fast feedback).
- `npm run research:scope` — validate and generate scope/claims outputs (apps/simulation).
- `npm run ladder` / `npm run compare` — see `apps/simulation/package.json` for more research CLIs.
- Build server: `npm run build:server`; web: `npm run build:web`.

## Architecture
- `apps/simulation/` — TS engine, research CLIs, design/search, black swans.
- `crates/` — Rust engine + WASM crate (parity with TS).
- `apps/server/` — REST/WebSocket API (worlds, snapshots, events, interventions, forecast).
- `apps/web/` — browser UI and worker engine.
- `packages/shared/` — types/constants/protocol.

## Emergence engineering (new)
- `apps/simulation/src/research/design/` — objectives, candidates, evaluation, search (random/grid ready).
- `apps/simulation/src/research/blackSwans.ts` — rare/high-impact detection + surprise scoring.
- `apps/simulation/src/research/eventProbability.ts` — joint event-set probability (independence + bounds).

## Research outputs
Outputs live under `apps/simulation/research/output/` and are committed where appropriate.

## License
MIT.
