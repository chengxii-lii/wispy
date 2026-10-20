# Removes wispy and gives you the Windows taskbar back. Add -RemoveData to also delete your settings.
param([switch]$RemoveData)
$ErrorActionPreference = 'SilentlyContinue'
Get-Process wispy, wispy-helper, wisp, wisp-helper, neon, neon-helper, tinybar, tinybar-helper | Stop-Process -Force
Start-Sleep -Milliseconds 600

# put the taskbar and Windows' notification banners back the way they were
$restore = Join-Path $PSScriptRoot 'restore-taskbar.ps1'
if (-not (Test-Path $restore)) { $restore = Join-Path $env:LOCALAPPDATA 'Programs\wispy\restore-taskbar.ps1' }
if (Test-Path $restore) { & $restore | Out-Null }

$run = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
Remove-ItemProperty -Path $run -Name 'com.thinktrout.wispy'
foreach ($old in 'com.cheng.tinybar', 'com.thinktrout.tinybar', 'com.thinktrout.neon', 'com.thinktrout.wisp') { Remove-ItemProperty -Path $run -Name $old }   # wispy's earlier names
Remove-Item (Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\wispy.lnk')

$dest = Join-Path $env:LOCALAPPDATA 'Programs\wispy'
# this script may be running from inside $dest, so remove it from a copy that outlives the folder
if ($PSScriptRoot -and ($PSScriptRoot -like "$dest*")) {
  $tmp = Join-Path $env:TEMP 'wispy-uninstall-finish.cmd'
  "@echo off`r`ntimeout /t 2 /nobreak >nul`r`nrmdir /s /q `"$dest`"`r`ndel `"%~f0`"" | Set-Content $tmp -Encoding ASCII
  Start-Process cmd.exe -ArgumentList '/c', $tmp -WindowStyle Hidden
} else {
  Remove-Item $dest -Recurse -Force
}
if ($RemoveData) {
  Remove-Item (Join-Path $env:APPDATA 'wispy') -Recurse -Force
  Write-Host 'Settings removed.'
}
Write-Host 'wispy removed. The Windows taskbar is back.'
