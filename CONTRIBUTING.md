# Contributing to Tree of Life

Thanks for your interest. This project is **modular and experimentable** by
design; the easiest way to contribute is to add a *self-contained* experiment,
detector, or mechanic without disturbing the core tick order.

## Ground rules

1. **Determinism is sacred.** Any new stochastic path must draw from the seeded
   `Rng` (`apps/simulation/src/rng.ts`) keyed by
   `(worldSeed, streamTag, tick[, agentId])`. Never call `Math.random` in engine
   or research code.
2. **Parity matters.** If you touch `apps/simulation/src/*` you must mirror the
   change in `crates/simulation/src/*` (and vice-versa), keeping RNG draw counts
   and update order identical. Add a parity test when possible.
3. **Opt-in depth.** Heavy subsystems go behind a `WorldConfig` flag and must be
   inert (and reported as neutral/DORMANT) when disabled.
4. **Reproducibility.** Research processes must write deterministic artifacts and
   must not write shared outputs (the runner is parallel-safe).
5. **No comments unless necessary** in code; document in `docs/` and
   `apps/simulation/research/manual/` instead.

## Local workflow

```bash
# install (Node >= 18)
npm install

# typecheck everything
npm run typecheck

# run the fast test tier (parallel)
npm run test:fast

# run the dashboard (web)
npm run dev:web        # http://localhost:5173

# run the server (API + WS)
npm run dev:server

# console dashboard + terminal
npm run terminal
```

## Adding an experiment

1. Add `apps/simulation/src/research/<name>.ts` exporting a `run<Name>()` that
   builds worlds via `new Engine(config, overrides?)` and returns structured
   results.
2. Add a CLI guard (`process.argv[1]?.endsWith('<name>.ts')`) and a `research:<name>`
   npm script.
3. Add a test under `apps/simulation/test/` and register it in `test/tiers.json`
   if it is slow.
4. Document it in `docs/RESULTS.md` and `apps/simulation/research/manual/02-processes.md`.

## Pull requests

- Keep PRs focused; one experiment/mechanic/fix per PR.
- Include the exact commands you ran and their output (typecheck + test tier).
- Update the relevant catalog (`REGIME_CATALOG`, `SCALING_CATALOG`, `MAPPING`).

## Code of conduct

By participating you agree to the [Code of Conduct](CODE_OF_CONDUCT.md).
