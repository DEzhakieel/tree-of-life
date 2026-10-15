@echo off
title Fractal Life Sandbox
cd /d "%~dp0"
echo === Fractal Life Sandbox ===
echo.
echo Starting server on :8080 ...
start "server" /min node apps\server\dist\index.js
timeout /t 2 /nobreak >nul
echo Starting web on :3000 ...
pushd apps\web
start "web" /min cmd /c "npx vite preview --port 3000 --host"
popd
timeout /t 3 /nobreak >nul
echo.
echo ========================================
echo  Web UI:     http://localhost:3000
echo  Server API: http://localhost:8080
echo ========================================
echo.
echo Press any key to shut down...
pause >nul
taskkill /fi "WINDOWTITLE eq server*" /f >nul 2>&1
taskkill /fi "WINDOWTITLE eq web*" /f >nul 2>&1
echo Stopped.
