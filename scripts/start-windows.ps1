param(
    [ValidateRange(1024, 65535)][int]$Port = 5555,
    [string]$SettingsPath,
    [switch]$NoBrowser,
    [switch]$Stop
)

$ErrorActionPreference = 'Stop'
$projectDir = Split-Path -Parent $PSScriptRoot
$url = "http://127.0.0.1:$Port"

function Get-Controller {
    try { return Invoke-RestMethod "$url/api/health" -TimeoutSec 1 }
    catch { return $null }
}

$existing = Get-Controller
if ($existing) {
    # Older builds of server.ts did not report projectDir; a missing value means "same app, stale build".
    $sameDir = !$existing.projectDir -or [string]::Equals(
        ([string]$existing.projectDir).TrimEnd('\', '/'),
        $projectDir.TrimEnd('\', '/'),
        [StringComparison]::OrdinalIgnoreCase)
    if ($existing.app -ne 'terminal-theme-studio' -or !$sameDir) {
        throw "Port $Port belongs to another app/checkout. Use -Port with a free port."
    }
    if (!$existing.projectDir) {
        Write-Host "Running server (PID $($existing.pid)) predates projectDir reporting; stop and start to pick up current code."
    }
    if ($Stop) {
        Stop-Process -Id $existing.pid
        Write-Host 'Terminal Theme Studio stopped.'
    } else {
        if ($SettingsPath) { Write-Host 'Already running. Stop the controller before changing its settings path.' }
        if (!$NoBrowser) { Start-Process $url }
        Write-Host "Terminal Theme Studio: $url"
    }
    exit 0
}
if ($Stop) { Write-Host 'No controller running on this port.'; exit 0 }

$bun = Get-Command bun.exe -ErrorAction SilentlyContinue
if (!$bun) { throw 'Bun is required. Install with: winget install --id Oven-sh.Bun -e, then reopen PowerShell.' }
if ($SettingsPath) { $env:WT_SETTINGS_PATH = (Resolve-Path -LiteralPath $SettingsPath).Path }
$env:PORT = "$Port"

Push-Location $projectDir
try {
    if (!(Test-Path 'node_modules')) {
        & $bun.Source install --frozen-lockfile
        if ($LASTEXITCODE -ne 0) { throw 'bun install failed' }
    }
    & $bun.Source run build
    if ($LASTEXITCODE -ne 0) { throw 'Build failed' }
} finally { Pop-Location }

$runtime = Join-Path $projectDir '.windows-runtime'
New-Item -ItemType Directory -Path $runtime -Force | Out-Null
$stdout = Join-Path $runtime "server-$Port.log"
$stderr = Join-Path $runtime "server-$Port.err.log"
$child = Start-Process -FilePath $bun.Source -ArgumentList 'server.ts' -WorkingDirectory $projectDir `
    -WindowStyle Hidden -RedirectStandardOutput $stdout -RedirectStandardError $stderr -PassThru
try {
    $deadline = (Get-Date).AddSeconds(15)
    do {
        $health = Get-Controller
        if ($health -and $health.pid -eq $child.Id -and $health.projectDir -eq $projectDir) { break }
        if ($child.HasExited) { throw "Controller exited. $(Get-Content -LiteralPath $stderr -Raw)" }
        Start-Sleep -Milliseconds 200
    } while ((Get-Date) -lt $deadline)
    if (!$health -or $health.pid -ne $child.Id) { throw "Controller did not start. See $stderr" }
} catch {
    if (!$child.HasExited) { Stop-Process -Id $child.Id }
    throw
}
if (!$NoBrowser) { Start-Process $url }
Write-Host "Terminal Theme Studio: $url"
Write-Host "Stop with: .\start-windows.cmd -Port $Port -Stop"
