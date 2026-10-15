#!/usr/bin/env pwsh
# Fractal Life Sandbox — local startup script
# Usage: .\start.ps1

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

Write-Host "=== Fractal Life Sandbox ===" -ForegroundColor Cyan
Write-Host ""

# Kill anything on our ports
$ports = @(8080, 3000)
foreach ($port in $ports) {
    $conn = Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue
    if ($conn) {
        $conn | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
        Write-Host "Killed process on port $port"
    }
}

Write-Host "Starting server on :8080..." -ForegroundColor Yellow
$serverProc = Start-Process -FilePath "node" -ArgumentList "apps/server/dist/index.js" -WorkingDirectory $PSScriptRoot -PassThru -WindowStyle Minimized

Write-Host "Starting web preview on :3000..." -ForegroundColor Yellow
$webProc = Start-Process -FilePath "npx" -ArgumentList "vite preview --port 3000 --host" -WorkingDirectory "$PSScriptRoot/apps/web" -PassThru -WindowStyle Minimized

Start-Sleep -Seconds 4

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host " Web UI:     http://localhost:3000" -ForegroundColor Green
Write-Host " Server API: http://localhost:8080" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Write-Host "Server PID: $($serverProc.Id)  |  Web PID: $($webProc.Id)"
Write-Host "Press Ctrl+C to stop, or close this window."
Write-Host ""

# Wait forever
try {
    while ($true) { Start-Sleep -Seconds 5 }
} finally {
    Write-Host "Shutting down..." -ForegroundColor Yellow
    Stop-Process -Id $serverProc.Id -Force -ErrorAction SilentlyContinue
    Stop-Process -Id $webProc.Id -Force -ErrorAction SilentlyContinue
}
