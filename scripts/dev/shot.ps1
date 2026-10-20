param([int]$X = -1, [int]$Y = -1, [int]$Wait = 900, [string]$Out = 'shot.png', [int]$Crop = 360)
Add-Type -AssemblyName System.Windows.Forms, System.Drawing
Add-Type @"
using System; using System.Runtime.InteropServices;
public static class D { [DllImport("user32.dll")] public static extern bool SetProcessDPIAware(); [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y); [DllImport("user32.dll")] public static extern int GetSystemMetrics(int i); }
"@
[void][D]::SetProcessDPIAware()
$w = [D]::GetSystemMetrics(0); $h = [D]::GetSystemMetrics(1)
if ($X -ge 0) { [void][D]::SetCursorPos($X, $Y) }
Start-Sleep -Milliseconds $Wait
$cw = [Math]::Min($w, 1500)
$bmp = New-Object System.Drawing.Bitmap $cw, $Crop
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen([int](($w - $cw) / 2), $h - $Crop, 0, 0, $bmp.Size)
$bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
"screen ${w}x${h} saved $Out"
