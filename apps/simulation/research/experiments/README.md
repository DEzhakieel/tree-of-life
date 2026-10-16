# Experiments

Documented, reproducible experiments. Each `<id>.json` here is an
`ExperimentManifest` written by `experimentCli.ts`:

```bash
cd apps/simulation
npx tsx src/research/experimentCli.ts --run l3-baseline     # run + write manifest
npx tsx src/research/experimentCli.ts --verify l3-baseline  # reproduce bit-for-bit
```

## Manifest format

```jsonc
{
  "experiment": { "id", "name", "hypothesis", "tags", "seeds", "ladder", "objectiveIds", "createdAt" },
  "objectiveIds": ["l3-emergent", "..."],
  "ranAt": "<ISO timestamp>",
  "runtime": { "node": "v18.x", "platform": "win32" },
  "perSeed": [
    { "seed", "digest", "score", "breakdown", "thresholdsMet", "verdicts" }
  ],
  "aggregate": { "meanScore", "sdScore", "passRate" },
  "reproducible": true
}
```

## Digest semantics

`digest` is `sha256({ worldFingerprint, trajectory, summary, synthesis })`.
`worldFingerprint` covers the full grid + alive agents after the final tick, so
two runs of the same `(seed, config)` are bit-identical while two different
seeds differ even when their summary is degenerate (e.g. an empty world).

`--verify` re-runs the manifest's seeds and compares digests: every match means
the experiment reproduced exactly; any mismatch means the run drifted and is
reported as `FAILED` (non-zero exit).
