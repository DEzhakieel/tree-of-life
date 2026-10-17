# Setup — install, run, build, test

This is the tutorial. Everything below runs from the **repository root** unless
noted. The stack is a **npm‑workspaces monorepo** (`apps/*`, `packages/*`).

## 0. Prerequisites

| Tool | Version | Needed for |
|---|---|---|
| **Node.js** | ≥ 18 (20 recommended) | everything |
| **npm** | ≥ 9 (ships with Node) | workspaces |
| Rust + `wasm-pack` | stable | *only* to rebuild the WASM engine (optional) |
| Python + MkDocs | 3.10+ / Material | *only* to build this docs site (optional) |

Check:

```bash
node --version      # v18.x or v20.x
npm --version
```

## 1. Install

```bash
git clone https://github.com/DEzhakieel/tree-of-life.git
cd tree-of-life
npm install
```

`npm install` links every workspace. The prebuilt WASM engine is committed
(`apps/web/public/wasm/`), so **no Rust toolchain is required** to run or
deploy the dashboard.

## 2. Run the dashboard (web)

```bash
npm run dev:web        # Vite dev server -> http://localhost:5173
```

The page boots a **local world in a Web Worker** automatically. Open the
in‑browser terminal with the **`> terminal`** button (bottom‑right) and type
`help`.

To also run the HTTP/WS backend:

```bash
npm run dev:server     # REST + WS gateway -> http://localhost:8080
```

With the server up, the dashboard can run in `remote` mode (Vite proxies
`/api` and `/ws` to it).

## 3. Run the console dashboard (terminal)

The console exposes the **same command set** as the browser, with an ANSI TUI:

```bash
npm run terminal                 # interactive dashboard, pause/play/step
npm run terminal -- --seed abc   # fixed seed
npm run terminal -- --tps 60     # target ticks/second
```

Batch / scriptable modes (no TTY required):

```bash
# simulate N ticks and print a one-shot dashboard
npm run terminal -- --steps 500

# … or the raw state as JSON (great for CI snapshots)
npm run terminal -- --steps 500 --json

# pipe a command script
"status`nstats tick`nversion" | npm run terminal
```

Individual commands:

```
help · status · stats [key] · params · set <k> <v> · play · pause · step <n>
spawn <n> · reset · speed <tps> · turbo [on|off] · export · caps · version
about · license · cite · docs · platform · echo · clear · quit
```

## 4. Build

```bash
npm run build:web       # tsc --noEmit && vite build -> apps/web/dist
npm run build:server    # compile the server
npm run build           # server then web
```

Preview the production build locally with the zero‑dependency server:

```bash
npm run preview         # serves apps/web/dist -> http://localhost:3000
PORT=4173 npm run preview
```

## 5. Test and typecheck

```bash
npm run typecheck       # tsc --noEmit in every workspace
npm run test:fast       # the cheap tier (~1 min, all files < 16 s)
npm run test            # everything (includes long integration tiers)
```

Test tiers are data‑driven (`apps/simulation/test/tiers.json`); a new test file
is picked up automatically. The research lab adds its own scripts
(`research:*`) — see [GUIDE](GUIDE.md).

## 6. Rebuild the WASM engine (optional)

Only if you change `crates/simulation` or `crates/wasm`:

```bash
rustup target add wasm32-unknown-unknown
cargo install wasm-pack
wasm-pack build crates/wasm --target web --out-dir ../../apps/web/public/wasm
# then refresh the glue import used by the adapter
```

The dashboard falls back to the TypeScript engine whenever no WASM module is
present, so the app always runs.

## 7. Troubleshooting

| Symptom | Fix |
|---|---|
| `Boot Error (worker failed to start)` | run `npm install` at the root; hard‑refresh the page |
| Terminal dashboard garbled | use a UTF‑8 terminal; set `NO_COLOR=1` to disable ANSI |
| WASM mismatches after an engine edit | rebuild WASM (§6) or the adapter uses the TS fallback |
| `Cannot find module 'tsx'` | run `npm install` (tsx is a root devDependency) |

Next: the [GUIDE](GUIDE.md).
