# Installs wisp for the current user: copies it to %LOCALAPPDATA%\Programs\wisp, adds a Start Menu
# shortcut and launch-at-login, and starts it. Runs from a release zip (a `wisp` folder sits next to this
# script) or from a source checkout after `npm run pack`. No admin rights needed.
param([switch]$NoLaunch, [switch]$NoStartup)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$src = Join-Path $PSScriptRoot 'wisp'
if (-not (Test-Path (Join-Path $src 'wisp.exe'))) { $src = Join-Path $root 'dist\wisp-win32-x64' }
if (-not (Test-Path (Join-Path $src 'wisp.exe'))) { throw "Nothing to install: run 'npm run pack' first (or use the release zip)." }
$dest = Join-Path $env:LOCALAPPDATA 'Programs\wisp'

# stop a running copy and put the taskbar back before swapping files
Get-Process wisp, wisp-helper, neon, neon-helper, tinybar, tinybar-helper -ErrorAction SilentlyContinue | Stop-Process -Force   # neon, tinybar: wisp's earlier names
Start-Sleep -Milliseconds 600
& "$PSScriptRoot\restore-taskbar.ps1" | Out-Null

if (Test-Path $dest) { Remove-Item $dest -Recurse -Force }
New-Item -ItemType Directory -Force $dest | Out-Null
Copy-Item "$src\*" $dest -Recurse -Force
foreach ($f in 'restore-taskbar.ps1', 'uninstall.ps1') {
  if (Test-Path "$PSScriptRoot\$f") { Copy-Item "$PSScriptRoot\$f" (Join-Path $dest $f) -Force }
}

# Start Menu shortcut
$lnk = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\wisp.lnk'
$sh = New-Object -ComObject WScript.Shell
$s = $sh.CreateShortcut($lnk)
$s.TargetPath = Join-Path $dest 'wisp.exe'
$s.WorkingDirectory = $dest
$s.Description = 'wisp: a home bar that replaces the taskbar'
$s.Save()

# launch at login (HKCU\...\Run), the same entry the app's own toggle writes
$run = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
# wisp was called tinybar, then neon, before its public release: clear out an old copy's leftovers
foreach ($old in 'com.cheng.tinybar', 'com.thinktrout.tinybar', 'com.thinktrout.neon') { Remove-ItemProperty -Path $run -Name $old -ErrorAction SilentlyContinue }
foreach ($old in 'tinybar', 'neon') {
  Remove-Item (Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\$old.lnk") -ErrorAction SilentlyContinue
  Remove-Item (Join-Path $env:LOCALAPPDATA "Programs\$old") -Recurse -Force -ErrorAction SilentlyContinue
}
if (-not $NoStartup) {
  Set-ItemProperty -Path $run -Name 'com.thinktrout.wisp' -Value ('"' + (Join-Path $dest 'wisp.exe') + '"')
}
Write-Host "installed -> $dest"
if (-not $NoLaunch) { Start-Process (Join-Path $dest 'wisp.exe') }
