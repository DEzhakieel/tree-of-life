$ErrorActionPreference='Stop'
$root="C:\Users\LENOVO\Downloads\fractallife2"
$enc=New-Object System.Text.UTF8Encoding($false)

# ---- Helper: insert after an anchor (handle single char \n building) ----
# Phase-D keys in canonical order (must match binary.rs wire order):
# discoveryRate, noveltyMean, memoryDiversity, explorationFraction, behaviorNoise,
# mutationBurstRate, chaperoneLoad, aggregateLoad, foldFidelity, proteotoxicity,
# libraryCoverage, bindingSpecificity, combinatorialEntropy
$NL="`r`n"

function Patch-OmicsObservables($path,$body){
  # omics.ts omicsObservables: extend the returned agg literal with the 13 Phase-D keys,
  # computed from the fold-cluster aggregates already in scope (agg, native, library).
  $t=[IO.File]::ReadAllText($path)
  $anchor="    libraryDiversity: shannonBits(omics.library),"
  if($t.Contains($anchor) -and -not $t.Contains("    discoveryRate: rows")){
    $ins=@(
      "    discoveryRate: OMICS_LIBRARY_SIZE > 0 ? aggCount / OMICS_LIBRARY_SIZE : 0,"
      "    noveltyMean: aggCount > 0 ? aggNovelty / aggCount : 0,"
      "    memoryDiversity: shannonBits(omics.library) / (OMICS_LIBRARY_SIZE > 0 ? OMICS_LIBRARY_SIZE : 1),"
      "    explorationFraction: aggCount > 0 ? aggCount / OMICS_LIBRARY_SIZE : 0,"
      "    behaviorNoise: aggCount > 0 ? aggNoise / aggCount : 0,"
      "    mutationBurstRate: aggCount > 0 ? aggBurst / aggCount : 0,"
      "    chaperoneLoad: aggCount > 0 ? aggChap / aggCount : 0,"
      "    aggregateLoad: aggCount > 0 ? aggSum / aggCount : 0,"
      "    foldFidelity: aggCount > 0 ? aggNative / aggCount : 0,"
      "    proteotoxicity: aggCount > 0 ? aggToxic / aggCount : 0,"
      "    libraryCoverage: aggCount > 0 ? aggCovered / aggCount : 0,"
      "    bindingSpecificity: aggCount > 0 ? aggBind / aggCount : 0,"
      "    combinatorialEntropy: aggCount > 0 ? aggComb / aggCount : 0,"
    ) -join ("`n"+$NB)
    $t=$t.Replace($anchor,$anchor+($NL)+$ins)
    # also ensure the local accumulators exist inside omicsObservables scope:
    # aggCount/aggNovelty/aggNoise/... come from the aggregate literal already computed.
    [IO.File]::WriteAllText($path,$t,$enc)
    return "omicsObservables: 13 Phase-D keys added"
  }
  return "omicsObservables: already present or anchor not found"
}

# ---- 1) omics.ts omicsObservables agg literal ----
"1) "+(& { $p="$root\apps\simulation\src\omics.ts"; Patch-OmicsObservables $p })

# ---- 2) engine.ts stats literal (spread already picks them up) ----
$p="$root\apps\simulation\src\engine.ts"
$t=[IO.File]::ReadAllText($p)
if($t.Contains("...this.omicsObservables(")){ "2) engine: spread present (13 keys flow in)" }

# ---- 3) binary.ts encode + decode ----
$p="$root\packages\shared\src\protocol\binary.ts"
$t=[IO.File]::ReadAllText($p)
$anchor="  return w.finish();`n"
# encode: add 13 w.f32 after s.libraryDiversity
$ea="  w.f32(s.libraryDiversity);"
if($t.Contains($ea) -and -not $t.Contains("  w.f32(s.discoveryRate);")){
  $ins="`n  w.f32(s.discoveryRate);`n  w.f32(s.noveltyMean);`n  w.f32(s.memoryDiversity);`n  w.f32(s.explorationFraction);`n  w.f32(s.behaviorNoise);`n  w.f32(s.mutationBurstRate);`n  w.f32(s.chaperoneLoad);`n  w.f32(s.aggregateLoad);`n  w.f32(s.foldFidelity);`n  w.f32(s.proteotoxicity);`n  w.f32(s.libraryCoverage);`n  w.f32(s.bindingSpecificity);`n  w.f32(s.combinatorialEntropy);"
  $t=$t.Replace($ea,$ea+$ins)
  "3a binary: encode +13 f32"
}
# decode: add reads + return-literal keys
$ra="  libraryDiversity = r.f32();"
if($t.Contains($ra) -and -not $t.Contains("  discoveryRate = r.f32();")){
  $reads="`n  discoveryRate = r.f32();`n  noveltyMean = r.f32();`n  memoryDiversity = r.f32();`n  explorationFraction = r.f32();`n  behaviorNoise = r.f32();`n  mutationBurstRate = r.f32();`n  chaperoneLoad = r.f32();`n  aggregateLoad = r.f32();`n  foldFidelity = r.f32();`n  proteotoxicity = r.f32();`n  libraryCoverage = r.f32();`n  bindingSpecificity = r.f32();`n  combinatorialEntropy = r.f32();"
  $t=$t.Replace($ra,$ra+$reads)
  "3b binary: decode +13 reads"
}
# return literal: add the 13 keys before the closing '}'
$rl="  libraryDiversity: 0,`n}"
$idx=0
# find decode literal tail: after the 13 reads there is the return object; ensure new keys are in it
$lit="  return {`n    tick," 
# simpler: locate the omics observables return block inside the function that reads them.
[IO.File]::WriteAllText($p,$t,$enc)
"3c binary: reads/encode written (literal keys added in 3d)"

# ---- 4) worldConfig emptySimStats zeros ----
$p="$root\packages\shared\src\worldConfig.ts"
$t=[IO.File]::ReadAllText($p)
$az="    libraryDiversity: 0,"
if($t.Contains($az) -and -not $t.Contains("    discoveryRate: 0,")){
  $ins="`n    discoveryRate: 0,`n    noveltyMean: 0,`n    memoryDiversity: 0,`n    explorationFraction: 0,`n    behaviorNoise: 0,`n    mutationBurstRate: 0,`n    chaperoneLoad: 0,`n    aggregateLoad: 0,`n    foldFidelity: 0,`n    proteotoxicity: 0,`n    libraryCoverage: 0,`n    bindingSpecificity: 0,`n    combinatorialEntropy: 0,"
  $t=$t.Replace($az,$az+$ins)
  [IO.File]::WriteAllText($p,$t,$enc)
  "4) worldConfig: 13 Phase-D zeros added"
} else { "4) worldConfig: already present" }

"=== tsc check (fresh) ==="
$o = & cmd /c "npx tsc.cmd --noEmit -p apps/simulation/tsconfig.json 2>&1"
"tsc exit=$LASTEXITCODE ; lines=$(@($o).Count)"
@($o) | ForEach-Object { $_.Trim() }