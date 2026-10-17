# Thesis

A computational thesis describing the Tree of Life platform: model, algorithms,
mathematical foundations, methodology, and results.

- `main.tex` — the full document (single file).
- `references.bib` — the bibliography (shared with `docs/REFERENCES.md`).

The brief, in-repo summary lives at [`../THESIS.md`](../THESIS.md).

## Build

Requires a LaTeX distribution (TeX Live / MiKTeX) with `natbib` and `tikz`.

```bash
# either
latexmk -pdf main

# or the long way
pdflatex main
bibtex main
pdflatex main
pdflatex main
```

Output: `main.pdf`.

### Without a local TeX install

- Upload the `thesis/` folder to **Overleaf** and set `main.tex` as the main
  document.
- Or use `tectonic main.tex` (a self-contained LaTeX engine).

## Contents

| Section | Topic |
|---|---|
| Introduction | contribution and framing |
| Related work | ALife, complexity, evolution, physiology, statistics |
| System architecture | dual-engine monorepo, shared command layer |
| The model and algorithms | world, agents, ordered tick pipeline, determinism |
| Mathematical foundations | drag, OU, Michaelis–Menten, GHK, replicator, Price, LMC, Lyapunov, statistics |
| Methodology | reproducibility, objectives/search, pre-registration, rare events |
| Results | scope ledger, verification, high-N worlds |
| Discussion | limitations (omics/quantum are pool readings) |
| Conclusion | emergence as an engineering objective |

## Figures

`docs/ARCHITECTURE.md` and `docs/DESIGN.md` embed Mermaid diagrams that render
on GitHub; the lab writes SVG plots to
`apps/simulation/research/plots/`. To embed a plot in LaTeX, add it to a
`figures/` folder here and `\includegraphics` it in `main.tex`.
