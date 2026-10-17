<#
.SYNOPSIS
  Commit and publish the Tree of Life repository to GitHub.

.DESCRIPTION
  Stages all changes, commits them, ensures the `origin` remote, and pushes the
  current branch. It never force-pushes and never rewrites history. Safe to run
  repeatedly. Use -DryRun to preview.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts/publish.ps1 -DryRun

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts/publish.ps1 `
    -Remote https://github.com/DEzhakieel/tree-of-life.git `
    -Message "Tree of Life v1.0.0"
#>
param(
  [string]$Remote = "https://github.com/DEzhakieel/tree-of-life.git",
  [string]$Branch = "master",
  [string]$Message = "",
  [switch]$SkipCommit,
  [switch]$DryRun
)

$ErrorActionPreference = "Stop"

function Info($m) { Write-Host "[publish] $m" -ForegroundColor Cyan }
function Warn($m) { Write-Host "[publish] $m" -ForegroundColor Yellow }
function Fail($m) { Write-Host "[publish] ERROR: $m" -ForegroundColor Red; exit 1 }

function Invoke-Git([string[]]$Args, [switch]$AllowFail) {
  & git @Args
  if ($LASTEXITCODE -ne 0 -and -not $AllowFail) { Fail "git $($Args -join ' ') failed" }
  return $LASTEXITCODE
}

# --- preflight ----------------------------------------------------------------
Invoke-Git @("rev-parse", "--is-inside-work-tree") | Out-Null
$root = (& git rev-parse --show-toplevel)
Info "repo: $root"

# --- stage + commit -----------------------------------------------------------
$status = (& git status --porcelain)
if ([string]::IsNullOrWhiteSpace($status)) {
  Info "working tree clean; nothing to commit"
} elseif ($SkipCommit) {
  Warn "changes present but -SkipCommit set; skipping commit"
} else {
  if ([string]::IsNullOrWhiteSpace($Message)) {
    $Message = "Tree of Life: dashboard, research lab, shared terminal layer"
  }
  if ($DryRun) {
    Info "DRY RUN: git add -A; git commit -m `"$Message`""
  } else {
    Invoke-Git @("add", "-A") | Out-Null
    Invoke-Git @("commit", "-m", $Message) | Out-Null
    Info "committed"
  }
}

# --- ensure branch ------------------------------------------------------------
$current = (& git rev-parse --abbrev-ref HEAD)
if ($current -ne $Branch) {
  if ($DryRun) { Info "DRY RUN: git branch -M $Branch" }
  else { Invoke-Git @("branch", "-M", $Branch) | Out-Null; Info "branch -> $Branch" }
}

# --- ensure remote ------------------------------------------------------------
$remotes = (& git remote)
if ($remotes -notcontains "origin") {
  if ($DryRun) { Info "DRY RUN: git remote add origin $Remote" }
  else { Invoke-Git @("remote", "add", "origin", $Remote) | Out-Null; Info "remote origin added" }
} else {
  $existing = (& git remote get-url origin)
  if ($existing -ne $Remote) {
    Warn "origin is '$existing' (expected '$Remote')"
    if (-not $DryRun) { Info "leaving origin as-is; run: git remote set-url origin $Remote" }
  } else {
    Info "origin: $Remote"
  }
}

# --- push ---------------------------------------------------------------------
if ($DryRun) {
  Info "DRY RUN: git push -u origin $Branch"
} else {
  Invoke-Git @("push", "-u", "origin", $Branch)
  Info "pushed to origin/$Branch"
}

Write-Host ""
Info "Done. Next: enable GitHub Pages (Settings -> Pages -> Source = GitHub Actions)."
Info "Dashboard URL: https://dezhakieel.github.io/tree-of-life/"
