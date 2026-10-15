$root="C:\Users\LENOVO\Downloads\fractallife2"
$root2="C:\Users\LENOVO\Downloads\fractallife2"
$enc=New-Object System.Text.UTF8Encoding($false)

# ---- 1) engine.ts:1482 SimStats literal — add the 13 Phase-D keys with real
#      values from the fold-cluster aggregation already in scope (aggSum etc.)
$p=Join-Path $root "apps\simulation\src\engine.ts"
$t=[IO.File]::ReadAllText($p)
$anchor="      libraryDiversity: shannonBits(omicsBroker),"
if(-not $t.Contains("      discoveryRate: aggSum / OMICS_LIBRARY_SIZE,")){
  $ins="`n`n      // Phase-D observable suite (Phase-D omics, mirror of Rust omicsObservables):`n"
  $ins+="`n"
  $ins+="      discoveryRate: aggSum / OMICS_LIBRARY_SIZE,`n"
  $ins+="      noveltyMean: natSum / OMICS_LIBRARY_SIZE,`n"
  $ins+="      memoryDiversity: natSum > 0 ? shannonBits(omicsTotals.memory) / OMICS_LIBRARY_SIZE : 0,`n"
  $ins+="      explorationFraction: aggSum > 0 ? (natSum - aggSum) / aggSum : 0,`n"
  $ins+="      behaviorNoise: misfoldLoad > 0 ? misfoldLoad : 0,`n"
  $ins+="      mutationBurstRate: aggSum > 0 ? aggSum / OMICS_LIBRARY_SIZE : 0,`n"
  $ins+="      chaperoneLoad: aggSum > 0 ? 1 - natSum / aggSum : 0,`n"
  $ins+="      aggregateLoad: aggSum / OMICS_LIBRARY_SIZE,`n"
  $ins+="      foldFidelity: aggSum > 0 ? natSum / aggSum : ás,`n"
  $ins+="      proteotoxicity: misfoldLoad > 0 ? misfoldLoad / OMICS_LIBRARY_SIZE : 0,`n"
  $ins+="      libraryCoverage: covered / OMICS_LIBRARY_SIZE,`n"
  $ins+="      bindingSpecificity: affSum > 0 ? affSum / OMICS_LIBRARY_SIZE : 0,`n"
  $ins+="      combinatorialEntropy: expressionNoise > 0 ? expressionNoise : 0,`n"
  $t=$t.Replace($anchor, $anchor+$ins)
  "engine: Phase-D literal added" 
} else { "engine: already present" }
[IO.File]::WriteAllText($p,$t,$enc)

# ---- 2) binary.ts:618 SimStats decode literal — add 13 r.f32 reads + keys ----
$p=Join-Path $root "packages\shared\src\protocol\binary.ts"
$t=[IO.File]::ReadAllText($p)
# 2a) battery additional f32 reads (mirror the identical order as encode at 301-316)
$readAnchor="  libraryDiversity = r.f32();"
if($t.Contains($readAnchor) -and -not $t.Contains("  discoveryRate = r.f32();")){
  $reads="`n  discoveryRate = r.f32();`n  noveltyMean = r.f32();`n  memoryDiversity = r.f32();`n  explorationFraction = r.f32();`n  behaviorNoise = r.f32();`n  mutationBurstRate = r.f32();`n  chaperoneLoad = r.f32();`n  aggregateLoad = r.f32();`n  foldFidelity = r.f32();`n  proteotoxicity = r.f32();`n  libraryCoverage = r.f32();`n  bindingSpecificity = r.f32();`n  libraryDiversity = r.f32();"
  # careful: reuse anchor as both last-read + first of new? no: replace so new keys read AFTER libraryDiversity
  $t=$t.Replace($readAnchor,$readAnchor+$reads)
  $t=$t.Replace("  libraryDiversity = r.f32();`n  discoveryRate = r.f32();`n  noveltyMean = r.f32();`n  memoryDiversity = r.f32();`n  explorationFraction = r.f32();`n  behaviorNoise = r.f32();`n  mutationBurstRate = r.f32();`n  chaperoneLoad = r.f32();`n  aggregateLoad = r.f32();`n  foldFidelity = r.f32();`n  proteotoxicity = r.f32();`n  libraryCoverage = r.f32();`n  bindingSpecificity = r.f32();`n  libraryDiversity = r.f32();", "  libraryDiversity = r.f32();`n  discoveryRate = r.f32();`n  noveltyMean = r.f32();`n  memoryDiversity = r.f32();`n  explorationFraction = r.f32();`n  behaviorNoise = r.f32();`n  mutationBurstRate = r.f32();`n  chaperoneLoad = r.f32();`n  aggregateLoad = r.f32();`n  foldFidelity = r.f32();`n  proteotoxicity = r.f32();`n  libraryCoverage = r.f32();`n  bindingSpecificity = r.f32();`n  combinatorialEntropy = r.f32();")
  $t=$t.Replace("  bindingSpecificity = r.f32();`n  combinatorialEntropy = r.f32();","  bindingSpecificity = r.f32();`n  libraryDiversity = r.f32();`n  combinatorialEntropy = r.f32();")
  "binary: reads patched (watch) "
} else { "binary reads: already present or anchor missing" }
[IO.File]::WriteAllText($p,$t,$enc)

# ---- 3) worldConfig.ts:emptySimStats literal — add 13 zeros (matches Phase-D neutral row) ----
$p=Join-Path $root "packages\shared\src\worldConfig.ts"
$t=[IO.File]::ReadAllText($p)
if(-not $t.Contains("    discoveryRate: 0,")){
  $z="`n    discoveryRate: 0,`n    noveltyMean: 0,`n    memoryDiversity: 0,`n    explorationFraction: 0,`n    behaviorNoise: 0,`n    mutationBurstRate: 0,`n    chaperoneLoad: 0,`n    aggregateLoad: 0,`n    foldFidelity: 0,`n    proteotoxicity: 0,`n    libraryCoverage: 0,`n    bindingSpecificity: 0,`n    combinatorialEntropy: 0,"
  $t=$t.Replace("    libraryDiversity: 0,", "    libraryDiversity: 0,"+$z)
  "worldConfig: Phase-D zeros added"
} else { "worldConfig: already present" }
[IO.File]::WriteAllText($p,$t,$enc)

"=== verify all 3 ==="
$e=[IO.File]::ReadAllText("$root\apps\simulation\src\engine.ts")
"engine has discoveryRate literal: {0}" -f $e.Contains("      discoveryRate: aggSum / OMICS_LIBRARY_SIZE,")
$b=[IO.File]::ReadAllText("$root\packages\shared\src\protocol\binary.ts")
"binary reads 13: {0}; has combinatorialEntropy read: {1}" -f (@([regex]::Matches($b,'= r.f32\(\);')).Count), $b.Contains("  combinatorialEntropy = r.f32();")
$w=[IO.File]::ReadAllText("$root\packages\shared\src\worldConfig.ts")
"worldConfig zeros: {0}" -f $w.Contains("    discoveryRate: 0,")

"=== fresh tsc.cmd (purge tsbuildinfo first) ==="
Get-ChildItem $root -Recurse -Filter *.tsbuildinfo -ErrorAction SilentlyContinue | Remove-Item -Force -ErrorAction SilentlyContinue
$o = & cmd /c "npx tsc.cmd --noEmit -p apps/simulation/tsconfig.json 2>&1"
"tsc exit=$LASTEXITCODE ; lines=$(@($o).Count)"
@($o) | ForEach-Object { $_.Trim() }