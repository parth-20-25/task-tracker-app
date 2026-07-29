[CmdletBinding()]
param([string]$PackageDirectory = (Join-Path $PSScriptRoot 'app'))
$ErrorActionPreference = 'Stop'
$targetDirectory = Join-Path $env:LOCALAPPDATA 'PARC\Notify\App'
$targetExe = Join-Path $targetDirectory 'ParcNotify.Agent.exe'
$sourceExe = Join-Path $PackageDirectory 'ParcNotify.Agent.exe'
if (-not (Test-Path -LiteralPath $sourceExe -PathType Leaf)) { throw "PARC Notify package is incomplete: $sourceExe" }
Get-Process -Name 'ParcNotify.Agent' -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $targetExe } | Stop-Process -Force
$deadline = [DateTime]::UtcNow.AddSeconds(15)
do {
    $running = Get-Process -Name 'ParcNotify.Agent' -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $targetExe }
    if (-not $running) { break }
    Start-Sleep -Milliseconds 250
} while ([DateTime]::UtcNow -lt $deadline)
if ($running) { throw 'The installed PARC Notify process did not stop.' }
New-Item -ItemType Directory -Path $targetDirectory -Force | Out-Null
Copy-Item -Path (Join-Path $PackageDirectory '*') -Destination $targetDirectory -Recurse -Force
if (-not (Test-Path -LiteralPath $targetExe -PathType Leaf)) { throw 'The installed executable was not created.' }
$startup = Start-Process -FilePath $targetExe -ArgumentList '--install-startup' -Wait -PassThru -WindowStyle Hidden
if ($startup.ExitCode -ne 0) { throw "Windows startup registration failed with exit code $($startup.ExitCode)." }
Start-Process -FilePath $targetExe -ArgumentList '--background' -WindowStyle Hidden
$version = (Get-Item -LiteralPath $targetExe).VersionInfo.FileVersion
Write-Output "PARC Notify $version installed at $targetExe"
Write-Output 'Windows startup task: PARC Notify'