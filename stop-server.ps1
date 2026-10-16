# Stop the background playlist server

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$pidFile = Join-Path $scriptDir ".server.pid"

if (-not (Test-Path $pidFile)) {
    Write-Host "No running server found."
    exit 0
}

$oldPid = (Get-Content $pidFile -Raw).Trim()
$proc = Get-Process -Id $oldPid -ErrorAction SilentlyContinue

if ($proc) {
    Stop-Process -Id $oldPid -Force
    Write-Host "Server stopped (PID $oldPid)"
} else {
    Write-Host "Server process not found (may have already stopped)"
}

Remove-Item $pidFile
