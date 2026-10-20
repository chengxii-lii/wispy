$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
if (-not (Test-Path 'helper\wispy-helper.exe')) { & "$PSScriptRoot\build-helper.ps1" }
if (-not (Test-Path 'assets\icon.ico')) { & "$PSScriptRoot\make-icon.ps1" }
$out = Join-Path $root 'dist'
if (Test-Path $out) { Remove-Item $out -Recurse -Force }
npx --no-install electron-packager . wispy --platform=win32 --arch=x64 --out=$out --overwrite `
  --icon=assets\icon.ico --asar=false `
  --ignore="^/(dist|release|node_modules|docs|\.claude|\.github|scripts/(art|dev|test)|\.git)" --ignore="helper/.*\.cs$" --ignore="\.md$"
if ($LASTEXITCODE -ne 0) { throw 'packager failed' }
Write-Host "packed -> $out\wispy-win32-x64"
