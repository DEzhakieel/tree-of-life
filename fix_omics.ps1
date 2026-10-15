$ErrorActionPreference='Stop'
$root='C:\Users\LENOVO\Downloads\fractallife2'
$src=Join-Path $root 'apps\simulation\src'
$p=Join-Path $src 'omics.ts'
$enc=New-Object System.Text.UTF8Encoding($false)

# --- Purge any incremental caches that can serve stale diagnostics ---
Get-ChildItem $root -Recurse -Filter *.tsbuildinfo -ErrorAction SilentlyContinue | Remove-Item -Force -ErrorAction SilentlyContinue

$t=[IO.File]::ReadAllText($p)
$changed=0

# 1) Import block: add the 7 Phase-D constants after OMICS_UPR_THRESHOLD,
$anchor="  OMICS_UPR_THRESHOLD,"
if($t.Contains($anchor) -and -not $t.Contains('  OMICS_CASCADE_GAIN,')){
  $insert="`n  OMICS_CASCADE_GAIN,`n  OMICS_AGG_SEED,`n  OMICS_AGG_DISSOLVE,`n  OMICS_AGG_THRESHOLD,`n  OMICS_BIND_WEAK,`n  OMICS_BIND_STRONG,`n  OMICS_SELECT_RATE,"
  $t=$t.Replace($anchor,$anchor+$insert)
  $changed++
  'OK import: added 7 Phase-D consts'
} elseif($t.Contains('  OMICS_CASCADE_GAIN,')) { 'OK import: already present' }
else { 'WARN import: anchor missing' }

# 2) Factory literal: add agg + chaperone after the noise line (316-326)
$fnoise='    noise: new Float32Array(OMICS_MRNA_BLOCKS),'
if($t.Contains($fnoise) -and -not $t.Contains('    agg: new Float32Array(OMICS_MRNA_BLOCKS),')){
  $t=$t.Replace($fnoise,$fnoise+"`n    agg: new Float32Array(OMICS_MRNA_BLOCKS),`n    chaperone: 1,")
  $changed++
  'OK factory: added agg + chaperone'
} elseif($t.Contains('    agg: new Float32Array(')) { 'OK factory: already present' }
else { 'WARN factory: noise anchor missing' }

# 3) aggSum declaration near natSum
$nat='  let natSum = 0;'
if($t.Contains($nat) -and -not $t.Contains('  let aggSum = 0;')){
  $t=$t.Replace($nat,$nat+"`n  let aggSum = 0;")
  $changed++
  'OK aggSum: declared'
} elseif($t.Contains('  let aggSum = 0;')) { 'OK aggSum: already present' }
else { 'WARN aggSum: natSum anchor missing' }

[IO.File]::WriteAllText($p,$t,$enc)
"EDITS=$changed written to $p"

# --- Verify on disk (fresh read) ---
$d=[IO.File]::ReadAllText($p)
"disk has CASCADE_GAIN import: {0}" -f $d.Contains('  OMICS_CASCADE_GAIN,')
"disk has AGG_SEED import: {0}" -f $d.Contains('  OMICS_AGG_SEED,')
"disk factory agg: {0}" -f $d.Contains('    agg: new Float32Array(OMICS_MRNA_BLOCKS),')
"disk factory chaperone: {0}" -f $d.Contains('    chaperone: 1,')
"disk aggSum decl: {0}" -f $d.Contains('  let aggSum = 0;')
