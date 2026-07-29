[CmdletBinding()]
param([string]$Version = '1.2.0')
$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path $PSScriptRoot -Parent
$project = Join-Path $repoRoot 'src\ParcNotify.Agent\ParcNotify.Agent.csproj'
$artifactsRoot = [IO.Path]::GetFullPath((Join-Path $repoRoot 'artifacts'))
$releaseRoot = [IO.Path]::GetFullPath((Join-Path $artifactsRoot "PARC-Notify-$Version"))
if (-not $releaseRoot.StartsWith($artifactsRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Unsafe release output path.' }
if (Test-Path -LiteralPath $releaseRoot) { Remove-Item -LiteralPath $releaseRoot -Recurse -Force }
$appDirectory = Join-Path $releaseRoot 'app'
New-Item -ItemType Directory -Path $appDirectory -Force | Out-Null
dotnet publish $project -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -p:DebugType=None -p:DebugSymbols=false -p:Version=$Version -o $appDirectory
if ($LASTEXITCODE -ne 0) { throw 'dotnet publish failed.' }
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'Install-ParcNotify.ps1') -Destination $releaseRoot
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'Uninstall-ParcNotify.ps1') -Destination $releaseRoot
$exe = Join-Path $appDirectory 'ParcNotify.Agent.exe'
$manifest = [ordered]@{
    version = (Get-Item -LiteralPath $exe).VersionInfo.FileVersion
    executable = 'app\ParcNotify.Agent.exe'
    sha256 = (Get-FileHash -LiteralPath $exe -Algorithm SHA256).Hash
    startupTask = 'PARC Notify'
    startupTarget = '%LOCALAPPDATA%\PARC\Notify\App\ParcNotify.Agent.exe --background'
    builtAtUtc = [DateTime]::UtcNow.ToString('o')
}
$manifest | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $releaseRoot 'release-manifest.json') -Encoding utf8
$zipPath = "$releaseRoot.zip"
if (Test-Path -LiteralPath $zipPath) { Remove-Item -LiteralPath $zipPath -Force }
Compress-Archive -LiteralPath $releaseRoot -DestinationPath $zipPath -CompressionLevel Optimal
Write-Output $releaseRoot
Write-Output $zipPath