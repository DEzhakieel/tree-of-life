$p="C:\Users\LENOVO\Downloads\fractallife2\apps\simulation\src\omics.ts"
$enc=New-Object System.Text.UTF8Encoding($false)
$L=Get-Content -LiteralPath $p
"total lines={0}" -f $L.Count
"lines containing a backtick:"
$hits=@()
for($i=0;$i -lt $L.Count;$i++){
  if($L[$i].Contains('`')){ $hits += $i; "{0}: {1}" -f ($i+1), $L[$i] }
}
"hits={0}" -f ($hits -join ",")
"backtick count total = {0}" -f (([io.File]::ReadAllText($p).ToCharArray() | Where-Object { $_ -eq '`' }).Count)
