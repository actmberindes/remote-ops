# Remote Ops Agent — Windows per-user installer
# Run this from PowerShell (no admin rights required).
# Installs the agent for the current Windows user and registers a silent startup launcher.
#
#   powershell -ExecutionPolicy Bypass -File .\install.ps1

$ErrorActionPreference = "Stop"

$InstallDir = Join-Path $env:LOCALAPPDATA "RemoteOpsAgent"
$ExeName = "remote-ops-agent.exe"
$VbsName = "start-agent.vbs"
$SourceExe = Join-Path $PSScriptRoot $ExeName
$SourceVbs = Join-Path $PSScriptRoot $VbsName
$TargetExe = Join-Path $InstallDir $ExeName
$TargetVbs = Join-Path $InstallDir $VbsName

if (-not (Test-Path -LiteralPath $SourceExe -PathType Leaf)) {
    throw "Agent executable not found: $SourceExe"
}

if (-not (Test-Path -LiteralPath $SourceVbs -PathType Leaf)) {
    throw "Silent launcher not found: $SourceVbs"
}

Write-Host "Installing Remote Ops Agent to $InstallDir ..."
New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null

Copy-Item -Path $SourceExe -Destination $TargetExe -Force
Copy-Item -Path $SourceVbs -Destination $TargetVbs -Force

# Register a Startup-folder shortcut that launches wscript.exe against the VBS launcher.
# This avoids exposing the Node/pkg console window at user logon.
$StartupDir = [Environment]::GetFolderPath("Startup")
$ShortcutPath = Join-Path $StartupDir "RemoteOpsAgent.lnk"
$WScriptShell = New-Object -ComObject WScript.Shell
$Shortcut = $WScriptShell.CreateShortcut($ShortcutPath)
$Shortcut.TargetPath = Join-Path $env:WINDIR "System32\wscript.exe"
$Shortcut.Arguments = '"' + $TargetVbs + '"'
$Shortcut.WorkingDirectory = $InstallDir
$Shortcut.WindowStyle = 1
$Shortcut.Description = "Remote Ops desktop monitoring agent"
$Shortcut.Save()

Write-Host "Installed successfully."
Write-Host "Agent executable: $TargetExe"
Write-Host "Silent launcher:   $TargetVbs"
Write-Host "Startup shortcut:  $ShortcutPath"
Write-Host "The agent will start silently at the next Windows sign-in."
Write-Host ""
$runNow = Read-Host "Start the agent now? (y/n)"
if ($runNow -eq "y") {
    Start-Process -FilePath (Join-Path $env:WINDIR "System32\wscript.exe") -ArgumentList ('"' + $TargetVbs + '"') -WorkingDirectory $InstallDir -WindowStyle Hidden
}
