# Lists paired Bluetooth devices (classic + LE) with their connection state, as JSON.
$ErrorActionPreference = 'Stop'
try {
  Add-Type -AssemblyName System.Runtime.WindowsRuntime
  $asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
      $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]
  function Await($op, $type) { $t = $asTask.MakeGenericMethod($type).Invoke($null, @($op)); $t.Wait(-1) | Out-Null; $t.Result }
  [Windows.Devices.Bluetooth.BluetoothDevice, Windows.Devices.Bluetooth, ContentType = WindowsRuntime] | Out-Null
  [Windows.Devices.Bluetooth.BluetoothLEDevice, Windows.Devices.Bluetooth, ContentType = WindowsRuntime] | Out-Null
  [Windows.Devices.Enumeration.DeviceInformation, Windows.Devices.Enumeration, ContentType = WindowsRuntime] | Out-Null
  $out = @{}
  $sel = [Windows.Devices.Bluetooth.BluetoothDevice]::GetDeviceSelectorFromPairingState($true)
  foreach ($i in (Await ([Windows.Devices.Enumeration.DeviceInformation]::FindAllAsync($sel)) ([Windows.Devices.Enumeration.DeviceInformationCollection]))) {
    $d = Await ([Windows.Devices.Bluetooth.BluetoothDevice]::FromIdAsync($i.Id)) ([Windows.Devices.Bluetooth.BluetoothDevice])
    if ($d) { $out[$i.Name] = [pscustomobject]@{ name = $i.Name; connected = ($d.ConnectionStatus.ToString() -eq 'Connected'); kind = $d.ClassOfDevice.MajorClass.ToString() } }
  }
  $sel = [Windows.Devices.Bluetooth.BluetoothLEDevice]::GetDeviceSelectorFromPairingState($true)
  foreach ($i in (Await ([Windows.Devices.Enumeration.DeviceInformation]::FindAllAsync($sel)) ([Windows.Devices.Enumeration.DeviceInformationCollection]))) {
    $d = Await ([Windows.Devices.Bluetooth.BluetoothLEDevice]::FromIdAsync($i.Id)) ([Windows.Devices.Bluetooth.BluetoothLEDevice])
    if ($d -and -not $out.ContainsKey($i.Name)) { $out[$i.Name] = [pscustomobject]@{ name = $i.Name; connected = ($d.ConnectionStatus.ToString() -eq 'Connected'); kind = 'LE' } }
    elseif ($d -and $d.ConnectionStatus.ToString() -eq 'Connected') { $out[$i.Name].connected = $true }
  }
  ConvertTo-Json -InputObject @($out.Values | Sort-Object @{ e = { -not $_.connected } }, name) -Compress
} catch {
  '[]'
}
