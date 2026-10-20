# Builds the release installer from dist\: release\wispy-setup.exe (+ .sha256). Run `npm run pack` first.
# Needs Inno Setup 6 (ISCC.exe): GitHub's Windows runners have it; locally `winget install JRSoftware.InnoSetup`.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$version = (Get-Content (Join-Path $root 'package.json') -Raw | ConvertFrom-Json).version
if (-not (Test-Path (Join-Path $root 'dist\wispy-win32-x64\wispy.exe'))) { throw "Run 'npm run pack' first." }

$iscc = @(
  (Get-Command ISCC.exe -ErrorAction SilentlyContinue).Source,
  "$env:LOCALAPPDATA\Programs\Inno Setup 6\ISCC.exe",
  "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe",
  "$env:ProgramFiles\Inno Setup 6\ISCC.exe"
) | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
if (-not $iscc) { throw 'Inno Setup 6 not found. Install it: winget install JRSoftware.InnoSetup' }

$out = Join-Path $root 'release'
if (Test-Path $out) { Remove-Item $out -Recurse -Force }
& $iscc "/DAppVersion=$version" /Q (Join-Path $PSScriptRoot 'installer.iss')
if ($LASTEXITCODE -ne 0) { throw "ISCC failed ($LASTEXITCODE)" }

$exe = Join-Path $out 'wispy-setup.exe'
# .NET directly: Get-FileHash isn't always loadable in CI's Windows PowerShell
$sha = [System.Security.Cryptography.SHA256]::Create()
$stream = [System.IO.File]::OpenRead($exe)
$hash = ([BitConverter]::ToString($sha.ComputeHash($stream)) -replace '-', '').ToLower()
$stream.Close()
"$hash  wispy-setup.exe" | Set-Content "$exe.sha256" -Encoding ASCII
Write-Host ("built {0} ({1} MB)" -f $exe, [math]::Round((Get-Item $exe).Length / 1MB))
