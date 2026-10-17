# High-N Agent Selection (10^n scaling) with G0–G8 Criteria

*Tree of Life — research plan (formerly "Fractal Life v2").*

This plan increases simulation agents (without touching UI/rendering interface), runs large-N simulations to generate candidates, then selects 1–3 based on the criteria.

## 1) Scale dimensions (10^n agents)
Target population scales: consider 10^0 up to ~10^4 depending on runtime/engine constraints (current MAX_AGENTS=12000 in shared/constants.ts). Engine spawnCount and maxPopulation control N. We can scale via LadderOptions/params without changing public render interfaces.

Constraints observed:
- MAX_AGENTS = 12000 (shared/src/constants.ts:347)
- Engine enforces spawn limit at 2200: `if (aliveCount() >= Math.min(this.params.maxPopulation, MAX_AGENTS)) break`
- Ladder defaults: ticks=12000, spawnCount=60, maxPopulation=400 (experiment.ts ladderOptsFor)
- Time per run grows with N/ticks; need to balance (fast tier preference)

Define N regimes: N1~10^2 (baseline), N2~10^3, N3~10^4 (up to ~12000). Run ladder with larger spawnCount/maxPopulation to scale agents while keeping interface/render unchanged.

## 2) Selection criteria (G0–G8)
- G0 validity: produces valid LadderResult (no throws), all required fields present, consistent (e.g. ∑ accounted, no NaN/inf). 
- G1 nontriviality: shows nonzero structure/activity (e.g. births>0, species>=2, or cooperation>0) — avoids degenerate empty runs.
- G2 distinctness: differs from baseline (fingerprint/worldFingerprint or regime vector differs; avoid duplicates).
- G3 persistence: stable over time (minAlive>0, life not immediately extinct, macro persistence/rigidity indicators reasonable).
- G4 reproducibility: same seed gives identical digest/worldFingerprint (double-run check).
- G5 robustness + correlation: robust across small perturbations? or shows meaningful correlations (e.g. coop-donation correlated, hazardCorr consistent). Use correlation discovery (Pearson/lag-1) and robustness via perturbation-lite if needed.
- G6 causality: causal chain satisfied per ladder (L0 cycling -> L1 -> L2 -> L3 consistent with evidence) or controlled evidence supports.
- G7 novelty: regime/macro state different from baselines (new regime vector R or different dominant regime/progression).
- G8 scientific value: supports interesting claim (e.g. clear reciprocity with exact ledger invariant holds, scaling behavior visible, dimensional effects) — qualitative but operationalizable.

## 3) Identification/selection mechanism (compute per candidate)
For each high-N run R:
1. Validity (G0): LadderResult valid, no NaN in key stats, synthesis present.
2. Regime vector Rv from REGIME_CATALOG (macro regime, spatial/rigidity/persistence, biome/weather/mode context, L1-L3 scores, dim/connectivity, coop/donation).
3. Nontriviality (G1): check ladder verdicts/evidence (e.g. L1 EMERGENT or PARTIAL with activity; interaction present; culture/reciprocity signals).
4. Distinctness (G2): compare Rv to baseline set (euclidean over numeric normalized + Hamming over categorical) — require distance > threshold.
5. Persistence (G3): life.minAlive>0, terminal alive reasonable, macro persistence>0 or regime stable.
6. Reproducibility (G4): verify digest match on re-run of same seed (use experiment.reproduceExperiment logic or double-run ladder).
7. Robustness+correlation (G5): compute corr for key pairs (births-alive lag1, hazardCorr magnitude, coop vs donation indicators) and check perturbation delta small under minor param change? Or use existing perturbation on a subset.
8. Causality (G6): ladder chain consistent (L1 requires cycling/minAlive; L2 needs species>=2 with interaction; L3 needs information+culture+adaptation per thresholds).
9. Novelty (G7): regime different from known baselines (e.g. reaches specialized with high rigidity, or strong reciprocity with large ledger activity).
10. Scientific value (G8): score weighted sum of G0-G7 (pass/fail + strength) and pick top 1–3.

## 4) Implementation plan (code changes, minimal interface impact)
Changes (simulation-side only, no render/UI changes):
- Add `research/highN.ts` (or extend experiment/ladder) to sweep N = spawnCount,maxPopulation in {100,500,1000,2000,5000,10000} but clamp to MAX_AGENTS. Keep ticks/sampleEvery reasonable (e.g. 2000-4000) to stay fast enough.
- For each config, run ladder with fixed seeds (e.g. 3-5 seeds) to get stable picture.
- Compute regime vector + G0-G8 scores; select top 1–3 by weighted composite (e.g. validity*2 + nontrivial*1 + distinct*1 + persistence*1 + repro*2 + robust/corr*1 + causality*1 + novelty*1 + value*1).
- Write manifest `research/output/highN_selection.json` with candidates (full LadderResult summary + scores + regime vector).
- Optionally add npm script `research:highn`.

Also consider engine can already handle up to MAX_AGENTS; no interface fields needed.

## 5) Execution (test)
Run small sweep first (100,500,1000) to verify timing, then larger. Ensure no changes to render paths (only research modules). Typecheck clean.

This gives "from 10^n agents/simulation, to 1-3 candidates" selected by G0–G8.

## 6) Executed results

Implemented in `src/research/highN.ts` (CLI + `research:highn` npm script), sweep run to
completion over 6 scales × 3 seeds (18 candidates), `ticks=2000`, `sampleEvery=200`,
`verifyRepro=2`, agents clamped to `MAX_AGENTS=12000`. Output:
`research/output/highN_selection.json`.

Selected 1–3 candidates (composite G0–G8, descending):

| rank | candidate id | total | reproducible | macro | structure | L1/L2/L3 | maxSpecies | final pop |
|---|---|---|---|---|---|---|---|---|
| 1 | `highn_n100_mp120_highn.s1` | 10.100 | yes | organized | 0.539 | E/E/E | 43 | 120 |
| 2 | `highn_n10000_mp12000_highn.s3` | 9.816 | yes | organized | 0.639 | E/E/E | 2307 | 5101 |
| 3 | `highn_n2000_mp2400_highn.s2` | 9.776 | no | organized | 0.722 | E/E/E | 576 | 2400 |

All 18 candidates produced valid `LadderResult`s (G0=1), all reached L1/L2/L3 EMERGENT,
and every scale/seed sat in an `organized`/`specialized` macro regime — so the selection
is driven mainly by G2 distinctness, G4 reproducibility and G5 robustness. Two of the three
selected were double-run bit-identical (G4=1); the third (rank 3) was not repro-verified in
this pass. The 10^4-agent candidate is the notable high-N result: 5101 survivors, 2307 peak
species, still reproducibility-verified.

Note: runtime is dominated by the large-N runs (~4.5 min for a single 10^4 run at 2000 ticks,
~70 min for the full 18-candidate sweep + 2 repro re-runs), so this is a slow-tier /
offline research job, never part of the fast test tier.

