# Installs tinybar for the current user: copies it to %LOCALAPPDATA%\Programs\tinybar, adds a Start Menu
# shortcut and launch-at-login, and starts it. Runs from a release zip (a `tinybar` folder sits next to this
# script) or from a source checkout after `npm run pack`. No admin rights needed.
param([switch]$NoLaunch, [switch]$NoStartup)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$src = Join-Path $PSScriptRoot 'tinybar'
if (-not (Test-Path (Join-Path $src 'tinybar.exe'))) { $src = Join-Path $root 'dist\tinybar-win32-x64' }
if (-not (Test-Path (Join-Path $src 'tinybar.exe'))) { throw "Nothing to install: run 'npm run pack' first (or use the release zip)." }
$dest = Join-Path $env:LOCALAPPDATA 'Programs\tinybar'

# stop a running copy and put the taskbar back before swapping files
Get-Process tinybar, tinybar-helper -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Milliseconds 600
& "$PSScriptRoot\restore-taskbar.ps1" | Out-Null

if (Test-Path $dest) { Remove-Item $dest -Recurse -Force }
New-Item -ItemType Directory -Force $dest | Out-Null
Copy-Item "$src\*" $dest -Recurse -Force
foreach ($f in 'restore-taskbar.ps1', 'uninstall.ps1') {
  if (Test-Path "$PSScriptRoot\$f") { Copy-Item "$PSScriptRoot\$f" (Join-Path $dest $f) -Force }
}

# Start Menu shortcut
$lnk = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\tinybar.lnk'
$sh = New-Object -ComObject WScript.Shell
$s = $sh.CreateShortcut($lnk)
$s.TargetPath = Join-Path $dest 'tinybar.exe'
$s.WorkingDirectory = $dest
$s.Description = 'tinybar: a home bar that replaces the taskbar'
$s.Save()

# launch at login (HKCU\...\Run), the same entry the app's own toggle writes
$run = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
Remove-ItemProperty -Path $run -Name 'com.cheng.tinybar' -ErrorAction SilentlyContinue   # name used by pre-release builds
if (-not $NoStartup) {
  Set-ItemProperty -Path $run -Name 'com.thinktrout.tinybar' -Value ('"' + (Join-Path $dest 'tinybar.exe') + '"')
}
Write-Host "installed -> $dest"
if (-not $NoLaunch) { Start-Process (Join-Path $dest 'tinybar.exe') }
