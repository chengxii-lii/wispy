param([string]$Action = 'get', [string]$Kind = '', [string]$State = '')
$ErrorActionPreference = 'Stop'
try {
  Add-Type -AssemblyName System.Runtime.WindowsRuntime
  $asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
      $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]
  function Await($op, $type) {
    $t = $asTask.MakeGenericMethod($type).Invoke($null, @($op))
    $t.Wait(-1) | Out-Null
    $t.Result
  }
  [Windows.Devices.Radios.Radio, Windows.System.Devices, ContentType = WindowsRuntime] | Out-Null
  [Windows.Devices.Radios.RadioAccessStatus, Windows.System.Devices, ContentType = WindowsRuntime] | Out-Null
  [Windows.Devices.Radios.RadioState, Windows.System.Devices, ContentType = WindowsRuntime] | Out-Null
  Await ([Windows.Devices.Radios.Radio]::RequestAccessAsync()) ([Windows.Devices.Radios.RadioAccessStatus]) | Out-Null
  $radios = Await ([Windows.Devices.Radios.Radio]::GetRadiosAsync()) ([System.Collections.Generic.IReadOnlyList[Windows.Devices.Radios.Radio]])
  if ($Action -eq 'set') {
    $target = if ($State -eq 'on') { [Windows.Devices.Radios.RadioState]::On } else { [Windows.Devices.Radios.RadioState]::Off }
    foreach ($r in $radios) {
      if ($Kind -eq 'all' -or $r.Kind.ToString() -eq $Kind -or ($Kind -eq 'wifibt' -and ($r.Kind.ToString() -eq 'WiFi' -or $r.Kind.ToString() -eq 'Bluetooth'))) {
        Await ($r.SetStateAsync($target)) ([Windows.Devices.Radios.RadioAccessStatus]) | Out-Null
      }
    }
  }
  $list = @()
  foreach ($r in $radios) { $list += [pscustomobject]@{ kind = $r.Kind.ToString(); state = $r.State.ToString() } }
  ConvertTo-Json -InputObject @($list) -Compress
} catch {
  '[]'
}
