# Removes neon and gives you the Windows taskbar back. Add -RemoveData to also delete your settings.
param([switch]$RemoveData)
$ErrorActionPreference = 'SilentlyContinue'
Get-Process neon, neon-helper, tinybar, tinybar-helper | Stop-Process -Force
Start-Sleep -Milliseconds 600

# put the taskbar and Windows' notification banners back the way they were
$restore = Join-Path $PSScriptRoot 'restore-taskbar.ps1'
if (-not (Test-Path $restore)) { $restore = Join-Path $env:LOCALAPPDATA 'Programs\neon\restore-taskbar.ps1' }
if (Test-Path $restore) { & $restore | Out-Null }

$run = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
Remove-ItemProperty -Path $run -Name 'com.thinktrout.neon'
foreach ($old in 'com.cheng.tinybar', 'com.thinktrout.tinybar') { Remove-ItemProperty -Path $run -Name $old }   # neon's name before release
Remove-Item (Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\neon.lnk')

$dest = Join-Path $env:LOCALAPPDATA 'Programs\neon'
# this script may be running from inside $dest, so remove it from a copy that outlives the folder
if ($PSScriptRoot -and ($PSScriptRoot -like "$dest*")) {
  $tmp = Join-Path $env:TEMP 'neon-uninstall-finish.cmd'
  "@echo off`r`ntimeout /t 2 /nobreak >nul`r`nrmdir /s /q `"$dest`"`r`ndel `"%~f0`"" | Set-Content $tmp -Encoding ASCII
  Start-Process cmd.exe -ArgumentList '/c', $tmp -WindowStyle Hidden
} else {
  Remove-Item $dest -Recurse -Force
}
if ($RemoveData) {
  Remove-Item (Join-Path $env:APPDATA 'neon') -Recurse -Force
  Write-Host 'Settings removed.'
}
Write-Host 'neon removed. The Windows taskbar is back.'
