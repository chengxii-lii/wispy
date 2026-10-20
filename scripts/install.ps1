# Installs neon for the current user: copies it to %LOCALAPPDATA%\Programs\neon, adds a Start Menu
# shortcut and launch-at-login, and starts it. Runs from a release zip (a `neon` folder sits next to this
# script) or from a source checkout after `npm run pack`. No admin rights needed.
param([switch]$NoLaunch, [switch]$NoStartup)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$src = Join-Path $PSScriptRoot 'neon'
if (-not (Test-Path (Join-Path $src 'neon.exe'))) { $src = Join-Path $root 'dist\neon-win32-x64' }
if (-not (Test-Path (Join-Path $src 'neon.exe'))) { throw "Nothing to install: run 'npm run pack' first (or use the release zip)." }
$dest = Join-Path $env:LOCALAPPDATA 'Programs\neon'

# stop a running copy and put the taskbar back before swapping files
Get-Process neon, neon-helper, tinybar, tinybar-helper -ErrorAction SilentlyContinue | Stop-Process -Force   # tinybar: neon's name before release
Start-Sleep -Milliseconds 600
& "$PSScriptRoot\restore-taskbar.ps1" | Out-Null

if (Test-Path $dest) { Remove-Item $dest -Recurse -Force }
New-Item -ItemType Directory -Force $dest | Out-Null
Copy-Item "$src\*" $dest -Recurse -Force
foreach ($f in 'restore-taskbar.ps1', 'uninstall.ps1') {
  if (Test-Path "$PSScriptRoot\$f") { Copy-Item "$PSScriptRoot\$f" (Join-Path $dest $f) -Force }
}

# Start Menu shortcut
$lnk = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\neon.lnk'
$sh = New-Object -ComObject WScript.Shell
$s = $sh.CreateShortcut($lnk)
$s.TargetPath = Join-Path $dest 'neon.exe'
$s.WorkingDirectory = $dest
$s.Description = 'neon: a home bar that replaces the taskbar'
$s.Save()

# launch at login (HKCU\...\Run), the same entry the app's own toggle writes
$run = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
# neon was called tinybar before its public release: clear out an old copy's leftovers
foreach ($old in 'com.cheng.tinybar', 'com.thinktrout.tinybar') { Remove-ItemProperty -Path $run -Name $old -ErrorAction SilentlyContinue }
Remove-Item (Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\tinybar.lnk') -ErrorAction SilentlyContinue
Remove-Item (Join-Path $env:LOCALAPPDATA 'Programs\tinybar') -Recurse -Force -ErrorAction SilentlyContinue
if (-not $NoStartup) {
  Set-ItemProperty -Path $run -Name 'com.thinktrout.neon' -Value ('"' + (Join-Path $dest 'neon.exe') + '"')
}
Write-Host "installed -> $dest"
if (-not $NoLaunch) { Start-Process (Join-Path $dest 'neon.exe') }
