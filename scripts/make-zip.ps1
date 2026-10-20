# Builds the release zip from dist\: release\wisp-vX.Y.Z-win-x64.zip, with the app in a `wisp` folder and
# an installer, an uninstaller and the taskbar-rescue script beside it. Run `npm run pack` first.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$version = (Get-Content (Join-Path $root 'package.json') -Raw | ConvertFrom-Json).version
$app = Join-Path $root 'dist\wisp-win32-x64'
if (-not (Test-Path (Join-Path $app 'wisp.exe'))) { throw "Run 'npm run pack' first." }

$out = Join-Path $root 'release'
$stage = Join-Path $out 'stage'
if (Test-Path $out) { Remove-Item $out -Recurse -Force }
New-Item -ItemType Directory -Force (Join-Path $stage 'wisp') | Out-Null
Copy-Item "$app\*" (Join-Path $stage 'wisp') -Recurse -Force
foreach ($f in 'install.ps1', 'uninstall.ps1', 'restore-taskbar.ps1') { Copy-Item (Join-Path $PSScriptRoot $f) $stage }
Set-Content (Join-Path $stage 'Install wisp.cmd') '@echo off
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1"
echo.
pause' -Encoding ASCII
Set-Content (Join-Path $stage 'README.txt') @"
wisp $version

Install:    double-click "Install wisp.cmd" (no admin rights needed).
Try first:  open the wisp folder and run wisp.exe. Nothing is installed.
Uninstall:  run uninstall.ps1 (add -RemoveData to delete your settings too).
If the Windows taskbar is ever missing: run restore-taskbar.ps1.

Windows may warn that the app is unrecognised, because it isn't code-signed yet.
Choose "More info", then "Run anyway".

https://github.com/chengxii-lii/wisp
"@ -Encoding UTF8

$zip = Join-Path $out "wisp-v$version-win-x64.zip"
Compress-Archive -Path (Join-Path $stage '*') -DestinationPath $zip -CompressionLevel Optimal
Remove-Item $stage -Recurse -Force
# .NET directly: Get-FileHash isn't always loadable in CI's Windows PowerShell
$sha = [System.Security.Cryptography.SHA256]::Create()
$stream = [System.IO.File]::OpenRead($zip)
$hash = ([BitConverter]::ToString($sha.ComputeHash($stream)) -replace '-', '').ToLower()
$stream.Close()
"$hash  $(Split-Path -Leaf $zip)" | Set-Content "$zip.sha256" -Encoding ASCII
Write-Host ("built {0} ({1} MB)" -f $zip, [math]::Round((Get-Item $zip).Length / 1MB))
