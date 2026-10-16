# Start the playlist server as a hidden background process
# The server keeps cycling GIF playlists even when the WebUI is closed

$ErrorActionPreference = "Stop"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$pidFile = Join-Path $scriptDir ".server.pid"

# Check if already running
if (Test-Path $pidFile) {
    $oldPid = Get-Content $pidFile -Raw
    $proc = Get-Process -Id $oldPid.Trim() -ErrorAction SilentlyContinue
    if ($proc) {
        Write-Host "Server is already running (PID $($oldPid.Trim()))"
        exit 0
    }
    Remove-Item $pidFile
}

$proc = Start-Process -FilePath "bun" `
    -ArgumentList "server.ts" `
    -WorkingDirectory $scriptDir `
    -WindowStyle Hidden `
    -PassThru

$proc.Id | Out-File -FilePath $pidFile -Encoding ascii -NoNewline
Write-Host "Server started in background (PID $($proc.Id))"
Write-Host "Playlist will keep cycling even when WebUI is closed."
Write-Host "Run .\stop-server.ps1 to stop it."
