[CmdletBinding(SupportsShouldProcess)]
param()
$ErrorActionPreference = 'Stop'
$targetDirectory = Join-Path $env:LOCALAPPDATA 'PARC\Notify\App'
$targetExe = Join-Path $targetDirectory 'ParcNotify.Agent.exe'
if (Test-Path -LiteralPath $targetExe) {
    Start-Process -FilePath $targetExe -ArgumentList '--remove-startup' -Wait -WindowStyle Hidden
    Get-Process -Name 'ParcNotify.Agent' -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $targetExe } | Stop-Process -Force
}
if ($PSCmdlet.ShouldProcess($targetDirectory, 'Remove installed PARC Notify application files')) {
    Remove-Item -LiteralPath $targetDirectory -Recurse -Force -ErrorAction SilentlyContinue
}
Write-Output 'PARC Notify removed. The DPAPI credential and diagnostic state were preserved.'