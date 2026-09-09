# install.ps1 - install DeepSkrin as a Command Code mod (Windows)
# Usage: powershell -ExecutionPolicy Bypass -File install.ps1

$ErrorActionPreference = "Stop"

$Src = Split-Path -Parent $MyInvocation.MyCommand.Path
$Dest = Join-Path $env:USERPROFILE ".commandcode\mods\deepshrink"

Write-Host "==> Installing DeepSkrin to $Dest"

if (Test-Path $Dest) {
    $Backup = "${Dest}.bak"
    Write-Host "==> Existing install found, backing up to $Backup"
    if (Test-Path $Backup) { Remove-Item -Recurse -Force $Backup }
    Copy-Item -Recurse -Force $Dest $Backup
}

New-Item -ItemType Directory -Force -Path $Dest | Out-Null

foreach ($item in @("core", "runtime", "entry", "package.json")) {
    Copy-Item -Recurse -Force (Join-Path $Src $item) $Dest
}

Write-Host "==> DeepSkrin installed. Restart your Command Code session to activate it."
Write-Host "==> Assets, tests and docs were intentionally not copied: they are useless at runtime."
Write-Host "==> Verify with: /deepshrink status"
