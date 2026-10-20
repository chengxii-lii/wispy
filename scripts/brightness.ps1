param([string]$Action = 'get', [int]$Value = 50)
$ErrorActionPreference = 'Stop'
try {
  if ($Action -eq 'set') {
    $m = Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightnessMethods
    Invoke-CimMethod -InputObject $m -MethodName WmiSetBrightness -Arguments @{ Timeout = 0; Brightness = [byte][Math]::Max(0, [Math]::Min(100, $Value)) } | Out-Null
  } else {
    (Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightness | Select-Object -First 1).CurrentBrightness
  }
} catch {
  'NA'
}
