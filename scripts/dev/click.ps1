# Real mouse input for tests: click.ps1 -X 100 -Y 200 [-Button right|left] [-Move]
param([int]$X, [int]$Y, [string]$Button = 'left', [switch]$Move)
Add-Type 'using System;using System.Runtime.InteropServices;public static class MI{[DllImport("user32.dll")]public static extern bool SetProcessDPIAware();[DllImport("user32.dll")]public static extern bool SetCursorPos(int x,int y);[DllImport("user32.dll")]public static extern void mouse_event(uint f,int dx,int dy,uint d,UIntPtr e);}'
[void][MI]::SetProcessDPIAware()
[void][MI]::SetCursorPos($X, $Y)
if ($Move) { return }
Start-Sleep -Milliseconds 250
if ($Button -eq 'right') { [MI]::mouse_event(0x08, 0, 0, 0, [UIntPtr]::Zero); Start-Sleep -Milliseconds 60; [MI]::mouse_event(0x10, 0, 0, 0, [UIntPtr]::Zero) }
else { [MI]::mouse_event(0x02, 0, 0, 0, [UIntPtr]::Zero); Start-Sleep -Milliseconds 60; [MI]::mouse_event(0x04, 0, 0, 0, [UIntPtr]::Zero) }
