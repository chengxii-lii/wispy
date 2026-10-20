# Emergency exit: stops wispy and gives the Windows taskbar back.
# Run this if the taskbar is ever missing (right-click the file > Run with PowerShell, or Win+R: powershell -File <this file>).
Get-Process wispy, wispy-helper, wisp, wisp-helper, neon, neon-helper, tinybar, tinybar-helper -ErrorAction SilentlyContinue | Stop-Process -Force   # wisp, neon, tinybar: wispy's earlier names
# wispy's saved state lives in %APPDATA%\wispy (earlier names: %APPDATA%\wisp, %APPDATA%\neon, %APPDATA%\tinybar)
function Find-State($file) {
  $dir = @('wispy', 'wisp', 'neon', 'tinybar') | ForEach-Object { Join-Path $env:APPDATA $_ } | Where-Object { Test-Path (Join-Path $_ $file) } | Select-Object -First 1
  if (-not $dir) { $dir = Join-Path $env:APPDATA 'wispy' }
  Join-Path $dir $file
}

Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class TB {
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr FindWindow(string c, string t);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr FindWindowEx(IntPtr p, IntPtr a, string c, string t);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int l, t, r, b; }
  [StructLayout(LayoutKind.Sequential)] public struct ABD { public uint cb; public IntPtr h; public uint msg; public uint edge; public RECT rc; public IntPtr lp; }
  [DllImport("shell32.dll")] public static extern UIntPtr SHAppBarMessage(uint m, ref ABD d);
}
"@
$tray = [TB]::FindWindow('Shell_TrayWnd', $null)
if ($tray -ne [IntPtr]::Zero) { [void][TB]::ShowWindow($tray, 8) }
$sec = [IntPtr]::Zero
while (($sec = [TB]::FindWindowEx([IntPtr]::Zero, $sec, 'Shell_SecondaryTrayWnd', $null)) -ne [IntPtr]::Zero) { [void][TB]::ShowWindow($sec, 8) }

# put auto-hide back to what it was before wispy (or off if we have no record)
$stateFile = Find-State 'taskbar-state.txt'
$orig = 0
if (Test-Path $stateFile) { $orig = [int](Get-Content $stateFile -Raw).Trim() }
$d = New-Object TB+ABD
$d.cb = [System.Runtime.InteropServices.Marshal]::SizeOf($d); $d.h = $tray; $d.lp = [IntPtr]$orig
[void][TB]::SHAppBarMessage(0xA, [ref]$d)
Remove-Item $stateFile -ErrorAction SilentlyContinue
Write-Host 'Windows taskbar restored.'

# turn Windows' own notification banners back on the way they were before wispy
$bannerFile = Find-State 'banners.txt'
if (Test-Path $bannerFile) {
  $root = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Notifications\Settings'
  foreach ($line in Get-Content $bannerFile) {
    $i = $line.LastIndexOf("`t"); if ($i -lt 1) { continue }
    $name = $line.Substring(0, $i); $val = $line.Substring($i + 1)
    $k = Join-Path $root $name
    if (-not (Test-Path -LiteralPath $k)) { continue }
    if ($val -eq 'absent') { Remove-ItemProperty -LiteralPath $k -Name ShowBanner -ErrorAction SilentlyContinue }
    else { Set-ItemProperty -LiteralPath $k -Name ShowBanner -Value ([int]$val) -Type DWord }
  }
  Remove-Item $bannerFile -ErrorAction SilentlyContinue
  Write-Host 'Notification banners restored.'
}
