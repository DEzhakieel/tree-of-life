# Thesis

A computational thesis arguing that a deterministic artificial ecology is a
**causal instrument** for complex-systems research, and using it to test whether
critical-transition theory transports to a system with genomes and selection.

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
| Introduction | inference problem, three claims (instrument / non-transport / method) |
| Related work | sciences of the artificial, open-ended evolution, critical transitions |
| System architecture | dual-engine monorepo, shared command layer |
| The model and algorithms | world, agents, ordered tick pipeline, determinism |
| Mathematical foundations | drag, OU, Michaelis–Menten, GHK, replicator, Price, LMC, Lyapunov, statistics |
| Methodology | reproducibility, counterfactual protocol, pre-registration, rare events |
| Research questions | Q1–Q8 with registered falsifiers and status |
| Results | scope ledger, engineering QA, early-warning evidence |
| Critical transitions | design, pooled skill, calibration rejection, what it licenses |
| Discussion | instrument epistemics, threats to validity, what would falsify it, programme |
| Conclusion | determinism changes what the substrate is *for* |

## Figures

`docs/ARCHITECTURE.md` and `docs/DESIGN.md` embed Mermaid diagrams that render
on GitHub; the lab writes SVG plots to
`apps/simulation/research/plots/`. To embed a plot in LaTeX, add it to a
`figures/` folder here and `\includegraphics` it in `main.tex`.
