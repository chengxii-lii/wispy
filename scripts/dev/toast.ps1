param([string]$Title = 'probe', [string]$Out = '', [string]$Aumid = 'Microsoft.Windows.Explorer')
[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null
$x = New-Object Windows.Data.Xml.Dom.XmlDocument
$x.LoadXml("<toast><visual><binding template=`"ToastGeneric`"><text>$Title</text><text>banner test</text></binding></visual></toast>")
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($Aumid).Show([Windows.UI.Notifications.ToastNotification]::new($x))
if ($Out) {
  Start-Sleep -Milliseconds 1500
  Add-Type -AssemblyName System.Drawing
  Add-Type 'using System;using System.Runtime.InteropServices;public static class DP{[DllImport("user32.dll")]public static extern bool SetProcessDPIAware();[DllImport("user32.dll")]public static extern int GetSystemMetrics(int i);}'
  [void][DP]::SetProcessDPIAware()
  $w = [DP]::GetSystemMetrics(0); $h = [DP]::GetSystemMetrics(1)
  $bmp = New-Object System.Drawing.Bitmap 2560, 420
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.CopyFromScreen(0, $h - 420, 0, 0, $bmp.Size)
  $small = New-Object System.Drawing.Bitmap $bmp, 1280, 210
  $small.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
  "saved $Out"
}
