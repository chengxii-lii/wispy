$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$csc = "$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
$out = Join-Path $root 'helper\wispy-helper.exe'
& $csc /nologo /optimize+ /platform:x64 /target:winexe "/out:$out" `
  /r:System.dll /r:System.Core.dll /r:System.Drawing.dll /r:System.Windows.Forms.dll `
  /r:System.Data.dll /r:System.Web.Extensions.dll `
  "/r:$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319\System.Runtime.dll" `
  "/r:$env:WINDIR\System32\WinMetadata\Windows.Foundation.winmd" "/r:$env:WINDIR\System32\WinMetadata\Windows.Media.winmd" "/r:$env:WINDIR\System32\WinMetadata\Windows.Storage.winmd" `
  (Join-Path $root 'helper\Helper.cs') (Join-Path $root 'helper\Extras.cs') (Join-Path $root 'helper\Extras2.cs') (Join-Path $root 'helper\Media.cs')
if ($LASTEXITCODE -ne 0) { throw "csc failed ($LASTEXITCODE)" }
Write-Host "built $out"
