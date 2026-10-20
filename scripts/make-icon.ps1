Add-Type -AssemblyName System.Drawing
$root = Split-Path -Parent $PSScriptRoot
$assets = Join-Path $root 'assets'
New-Item -ItemType Directory -Force $assets | Out-Null

function Draw([int]$size) {
  $bmp = New-Object System.Drawing.Bitmap $size, $size, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = 'AntiAlias'; $g.Clear([System.Drawing.Color]::Transparent)
  $s = $size / 256.0
  function RR($x, $y, $w, $h, $r) {
    $p = New-Object System.Drawing.Drawing2D.GraphicsPath
    $d = $r * 2
    $p.AddArc($x, $y, $d, $d, 180, 90); $p.AddArc($x + $w - $d, $y, $d, $d, 270, 90)
    $p.AddArc($x + $w - $d, $y + $h - $d, $d, $d, 0, 90); $p.AddArc($x, $y + $h - $d, $d, $d, 90, 90)
    $p.CloseFigure(); $p
  }
  $bg = New-Object System.Drawing.Drawing2D.LinearGradientBrush ((New-Object System.Drawing.PointF 0, 0), (New-Object System.Drawing.PointF 0, $size), [System.Drawing.Color]::FromArgb(255, 44, 46, 56), [System.Drawing.Color]::FromArgb(255, 22, 23, 28))
  $g.FillPath($bg, (RR (8 * $s) (8 * $s) (240 * $s) (240 * $s) (58 * $s)))
  # dock capsule
  $cap = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 58, 60, 72))
  $g.FillPath($cap, (RR (44 * $s) (118 * $s) (168 * $s) (52 * $s) (26 * $s)))
  $cols = @([System.Drawing.Color]::FromArgb(255, 109, 93, 252), [System.Drawing.Color]::FromArgb(255, 76, 194, 255), [System.Drawing.Color]::FromArgb(255, 245, 179, 36))
  for ($i = 0; $i -lt 3; $i++) {
    $b = New-Object System.Drawing.SolidBrush $cols[$i]
    $g.FillPath($b, (RR ((68 + $i * 42) * $s) (130 * $s) (28 * $s) (28 * $s) (8 * $s)))
  }
  # home bar
  $pill = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 245, 245, 247))
  $g.FillPath($pill, (RR (88 * $s) (196 * $s) (80 * $s) (12 * $s) (6 * $s)))
  $g.Dispose(); $bmp
}

$sizes = 16, 32, 48, 64, 128, 256
$pngs = @{}
foreach ($sz in $sizes) {
  $b = Draw $sz
  $ms = New-Object System.IO.MemoryStream
  $b.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
  $pngs[$sz] = $ms.ToArray()
  if ($sz -eq 256) { $b.Save((Join-Path $assets 'icon.png'), [System.Drawing.Imaging.ImageFormat]::Png) }
  if ($sz -eq 32) { $b.Save((Join-Path $assets 'tray.png'), [System.Drawing.Imaging.ImageFormat]::Png) }
  $b.Dispose()
}
# ICO container with PNG-compressed images
$out = New-Object System.IO.MemoryStream
$w = New-Object System.IO.BinaryWriter $out
$w.Write([uint16]0); $w.Write([uint16]1); $w.Write([uint16]$sizes.Count)
$offset = 6 + 16 * $sizes.Count
foreach ($sz in $sizes) {
  $dim = if ($sz -ge 256) { 0 } else { $sz }
  $w.Write([byte]$dim); $w.Write([byte]$dim); $w.Write([byte]0); $w.Write([byte]0)
  $w.Write([uint16]1); $w.Write([uint16]32); $w.Write([uint32]$pngs[$sz].Length); $w.Write([uint32]$offset)
  $offset += $pngs[$sz].Length
}
foreach ($sz in $sizes) { $w.Write($pngs[$sz]) }
[System.IO.File]::WriteAllBytes((Join-Path $assets 'icon.ico'), $out.ToArray())
Write-Host 'icons written'
