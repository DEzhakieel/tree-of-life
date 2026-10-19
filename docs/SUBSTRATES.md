# Life Substrates

> One world, four rule sets. Pick a substrate when you create a world and the
> whole dashboard — renderer, stats, terminal, events — follows along.

A **substrate** is the rule set that advances a world's bodies each tick. The
default (`agents`) is the full research engine: terrain, genomes, learning,
lineage. Three lighter substrates run on a pure-TypeScript kernel for when you
want a different *kind* of life — faster to start, no server, different
emergence — with the same measurement surface.

## The four substrates

| Kind | Rule set | Emergence to watch | Auto representation |
|---|---|---|---|
| `agents` | full agent engine (WASM/TS reference) | speciation, culture, critical transitions | `particle` |
| `particles` | attraction–repulsion bodies on a depleting food grid | flocks, chasing fronts, boom–bust cycles | `particle` |
| `lattice` | Conway-style cellular automaton on the 128×128 grid | gliders, still lifes, soup→structure relaxation | `lattice` |
| `graph` | excitable-medium nodes on a nearest-neighbour proximity graph | waves of activity, budding colonies, clustering | `graph` |

### `particles`

Bodies attract at mid-range, repel up close, and wander with a little noise.
Energy is a life currency: bodies eat from a depleting 64×64 food grid, spend
energy moving (`metabolism = base + v²`), starve below zero, and split when
well-fed — so population tracks the food landscape. Watch `avgEnergy`,
`births`/`deaths`, `spatialEntropy`, and `metabolicRate`.

### `lattice`

Classic B3/S23 Life (optionally with per-tick noise flips) on a 128×128
torus — the same grid the set-map renders, so `representation: 'lattice'`
shows it directly. Cells have no individual event stream; birth/death churn is
reported through `caAliveFraction`, `caComplexity` (2×2 block entropy) and the
`births`/`deaths` counters. Poking cells is a test hook, not an intervention.

### `graph`

Every node excites its neighbours, refracts, and leaks back to rest; excited
nodes bud new nodes where energy is high and starve off otherwise. The
proximity graph itself is rebuilt each tick from positions (up to 8 nearest
within `linkRadius`), so layout springs and budding reshape connectivity —
watch `clusterOrder`, `entropy`, and waves of births/deaths.

## Choosing one

**Dashboard** — New World modal → *Life substrate*. The selector appears in
**local (worker) mode only**: remote worlds are created by the server, which
always runs the agent engine. Selecting a non-agent substrate hides the
agent-only options (biochemistry, physics frame, environment, genome knobs)
and switches the representation automatically after spawn.

**Console** — pass `--substrate <kind>`:

```
npx tsx src/tui.ts --substrate lattice --seed demo --steps 500
npx tsx src/tui.ts --substrate graph   --seed demo --json
```

`--substrate agents` (or omitting the flag) keeps the classic terminal world.
The dashboard's in-page terminal drives the same session, so `describe`,
`stats`, `spawn`, `reset` and the rest work unchanged.

**Config** — `WorldConfig.substrate`:

```ts
substrate?: {
  kind: 'agents' | 'particles' | 'lattice' | 'graph';
  attraction?: number;  // particles: near-field attraction gain (default 1)
  repulsion?: number;   // particles: near-field repulsion gain (default 1)
  noise?: number;       // lattice: per-tick cell flip probability (default 0)
  linkRadius?: number;  // graph: neighbour radius in world units (default 90)
}
```

## Scope and guarantees

- **Pure TS, local only.** Substrate kernels run in the web worker and the
  console TUI (`apps/simulation/src/substrates/`). The Rust/WASM engine and
  the remote server know nothing about them — `WorldConfig.substrate` is
  simply ignored server-side, so remote mode always means `agents`.
- **Same wire contract.** Frames are the shared binary codecs
  (`encodeDelta`/`encodeSnapshot`/`encodeSetMap`/`encodeStats`) and events are
  `SimEvent`s, so the renderer, stats pipeline and terminal cannot tell which
  engine produced them.
- **Deterministic.** Each kernel seeds its own `SplitMix64` from
  `fnv1a32(seed + kind)`; identical seeds tick identically, different seeds
  diverge. No wall-clock or `Math.random()` in the tick path.
- **No time travel.** Substrate states are ticked forward, never snapshotted to
  history: a `snapshot` request for a past tick returns the *current* state
  (the agent engine still replays).
- **Interventions:** `spawnAgent`, `nuke`, `meteor`, `seedFood` and
  `setTimeScale` work; `pauseRegion` and `setGene` are agent concepts and are
  no-ops. Individual birth/death events are rate-limited to 4 per tick per
  kernel; population-level events (extinction, intervention) always pass.
- **Stats fields** are filled per substrate; agent-only observables keep their
  neutral `emptySimStats` defaults (`cooperation`, `lyapunovExponent`, …).

## Code map

| File | Role |
|---|---|
| `apps/simulation/src/substrates/types.ts` | kernel interface, event budget, hash/entropy helpers |
| `apps/simulation/src/substrates/lattice.ts` | 128×128 CA kernel |
| `apps/simulation/src/substrates/particles.ts` | body + food-grid kernel |
| `apps/simulation/src/substrates/graph.ts` | excitable proximity-graph kernel |
| `apps/simulation/src/substrates/engine.ts` | `SubstrateEngine` adapter (duck-typed worker surface) |
| `apps/web/src/sim/engineWorker.ts` | picks the kernel when `isSubstrateWorld(world)` |
| `apps/simulation/src/tui/session.ts` | console session builds a substrate engine on request |

Tests: `apps/simulation/test/substrates.test.ts` (determinism, life cycle,
wire round-trips, interventions, session integration).
