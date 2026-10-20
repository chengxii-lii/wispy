# Installs wispy for the current user: copies it to %LOCALAPPDATA%\Programs\wispy, adds a Start Menu
# shortcut and launch-at-login, and starts it. Runs from a release zip (a `wispy` folder sits next to this
# script) or from a source checkout after `npm run pack`. No admin rights needed.
param([switch]$NoLaunch, [switch]$NoStartup)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$src = Join-Path $PSScriptRoot 'wispy'
if (-not (Test-Path (Join-Path $src 'wispy.exe'))) { $src = Join-Path $root 'dist\wispy-win32-x64' }
if (-not (Test-Path (Join-Path $src 'wispy.exe'))) { throw "Nothing to install: run 'npm run pack' first (or use the release zip)." }
$dest = Join-Path $env:LOCALAPPDATA 'Programs\wispy'

# stop a running copy and put the taskbar back before swapping files
Get-Process wispy, wispy-helper, wisp, wisp-helper, neon, neon-helper, tinybar, tinybar-helper -ErrorAction SilentlyContinue | Stop-Process -Force   # wisp, neon, tinybar: wispy's earlier names
Start-Sleep -Milliseconds 600
& "$PSScriptRoot\restore-taskbar.ps1" | Out-Null

# keep unins* so a copy installed by wispy-setup.exe stays uninstallable from Settings, Apps
if (Test-Path $dest) { Get-ChildItem $dest -Force | Where-Object { $_.Name -notlike 'unins*' } | Remove-Item -Recurse -Force }
New-Item -ItemType Directory -Force $dest | Out-Null
Copy-Item "$src\*" $dest -Recurse -Force
foreach ($f in 'restore-taskbar.ps1', 'uninstall.ps1') {
  if (Test-Path "$PSScriptRoot\$f") { Copy-Item "$PSScriptRoot\$f" (Join-Path $dest $f) -Force }
}

# Start Menu shortcut
$lnk = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\wispy.lnk'
$sh = New-Object -ComObject WScript.Shell
$s = $sh.CreateShortcut($lnk)
$s.TargetPath = Join-Path $dest 'wispy.exe'
$s.WorkingDirectory = $dest
$s.Description = 'wispy: a home bar that replaces the taskbar'
$s.Save()

# launch at login (HKCU\...\Run), the same entry the app's own toggle writes
$run = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
# wispy was called tinybar, neon, then wisp before its public release: clear out an old copy's leftovers
foreach ($old in 'com.cheng.tinybar', 'com.thinktrout.tinybar', 'com.thinktrout.neon', 'com.thinktrout.wisp') { Remove-ItemProperty -Path $run -Name $old -ErrorAction SilentlyContinue }
foreach ($old in 'tinybar', 'neon', 'wisp') {
  Remove-Item (Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\$old.lnk") -ErrorAction SilentlyContinue
  Remove-Item (Join-Path $env:LOCALAPPDATA "Programs\$old") -Recurse -Force -ErrorAction SilentlyContinue
}
if (-not $NoStartup) {
  Set-ItemProperty -Path $run -Name 'com.thinktrout.wispy' -Value ('"' + (Join-Path $dest 'wispy.exe') + '"')
}
Write-Host "installed -> $dest"
if (-not $NoLaunch) { Start-Process (Join-Path $dest 'wispy.exe') }
