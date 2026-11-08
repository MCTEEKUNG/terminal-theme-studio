param([switch]$AutoStart, [switch]$Uninstall)

$ErrorActionPreference = 'Stop'
$projectDir = Split-Path -Parent $PSScriptRoot
$shortcutName = 'Terminal Theme Studio.lnk'
$programs = [Environment]::GetFolderPath('Programs')
$startup = [Environment]::GetFolderPath('Startup')
if ($Uninstall) {
    foreach ($folder in @($programs, $startup)) {
        $shortcut = Join-Path $folder $shortcutName
        if (Test-Path -LiteralPath $shortcut) { Remove-Item -LiteralPath $shortcut }
    }
    Write-Host 'Start menu and auto-start shortcuts removed.'
    exit 0
}

$bun = Get-Command bun.exe -ErrorAction SilentlyContinue
if (!$bun) { throw 'Install Bun first: winget install --id Oven-sh.Bun -e' }
Push-Location $projectDir
try {
    & $bun.Source install --frozen-lockfile
    if ($LASTEXITCODE -ne 0) { throw 'bun install failed' }
    & $bun.Source run build
    if ($LASTEXITCODE -ne 0) { throw 'Build failed' }
} finally { Pop-Location }

$shell = New-Object -ComObject WScript.Shell
$launcher = Join-Path $PSScriptRoot 'start-windows.ps1'
foreach ($folder in @($programs) + $(if ($AutoStart) { @($startup) } else { @() })) {
    $shortcut = $shell.CreateShortcut((Join-Path $folder $shortcutName))
    $shortcut.TargetPath = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
    $shortcut.Arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$launcher`""
    if ($folder -eq $startup) { $shortcut.Arguments += ' -NoBrowser' }
    $shortcut.WorkingDirectory = $projectDir
    $shortcut.Description = 'Windows Terminal theme and playlist controls'
    $shortcut.Save()
}
Write-Host 'Installed Terminal Theme Studio in your Start menu (current user).'
if ($AutoStart) { Write-Host 'The controller will start at sign-in.' }
Write-Host 'Keep this checkout in place. Open the Start menu shortcut or run .\start-windows.cmd.'
