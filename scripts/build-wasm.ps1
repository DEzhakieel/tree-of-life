# Rebuild the prebuilt wasm-pack outputs committed to the repo, so typecheck,
# parity tests and the dashboard all work without a Rust toolchain in CI.
# Requires: rustup (wasm32-unknown-unknown target) + wasm-pack - see docs/SETUP.md.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot

Push-Location $root
try {
    wasm-pack build crates/wasm --target web --out-dir pkg

    $src = Join-Path $root 'crates\wasm\pkg'
    $dst = Join-Path $root 'apps\web\public\wasm'
    foreach ($f in 'fractal_life_wasm.js', 'fractal_life_wasm.d.ts', 'fractal_life_wasm_bg.wasm', 'fractal_life_wasm_bg.wasm.d.ts', 'package.json') {
        Copy-Item -Force (Join-Path $src $f) (Join-Path $dst $f)
    }

    # wasm-pack rewrites .gitignore to '*'; keep both outputs tracked
    $note = @(
        '# Prebuilt wasm-pack output is committed so typecheck, parity tests and'
        '# deployment work without a Rust toolchain.'
        '# Rebuild with: scripts/build-wasm.ps1  (requires rust + wasm-pack)'
    )
    Set-Content -Path (Join-Path $src '.gitignore') -Value $note
    Set-Content -Path (Join-Path $dst '.gitignore') -Value $note
    Write-Output 'wasm rebuilt: crates/wasm/pkg + apps/web/public/wasm'
} finally {
    Pop-Location
}
