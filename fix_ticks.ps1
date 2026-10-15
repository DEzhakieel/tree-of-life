$p="C:\Users\LENOVO\Downloads\fractallife2\apps\simulation\src\omics.ts"
$enc=New-Object System.Text.UTF8Encoding($false)
$L=Get-Content -LiteralPath $p
"total lines={0}" -f $L.Count
$fixes=0
for($i=0;$i -lt $L.Count;$i++){
  $li=$L[$i]
  if($li.Contains('`n')){
    "FIX [{0}]: {1}" -f ($i+1), $li
    $li=$li.Replace('`n',"`n")   # backtick-n -> real newline
    $L[$i]=$li
    $fixes++
  }
  if($li.Contains('`r')){
    "WARN [$(($i+1))] cr artifact: $li"
  }
}
"backtick-n fixes applied: $fixes"
$sep=[Environment]::NewLine
if($fixes -gt 0){ [IO.File]::WriteAllLines($p,$L,$enc) }
"n written"
# verify on disk after write
$d=[IO.File]::ReadAllText($p)
"backtick count now: {0}" -f ([regex]::Matches($d,'`')).Count
"AggSum decls clean (no `n artifact): {0}" -f (-not $d.Contains('`n'))
"aggSum lines:"
for($i=0;$i -lt $L.Count;$i++){ if($L[$i] -match 'aggSum'){ "{0}: {1}" -f ($i+1),$L[$i].Trim() } }
