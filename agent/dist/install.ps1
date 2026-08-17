# Remote Ops Agent — Windows installer
# Run this from PowerShell (no admin rights required — installs for the current user only).
#
#   powershell -ExecutionPolicy Bypass -File install.ps1

$ErrorActionPreference = "Stop"

$InstallDir = Join-Path $env:LOCALAPPDATA "RemoteOpsAgent"
$ExeName = "remote-ops-agent.exe"
$SourceExe = Join-Path $PSScriptRoot $ExeName
$TargetExe = Join-Path $InstallDir $ExeName

Write-Host "Installing Remote Ops Agent to $InstallDir ..."
New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
Copy-Item -Path $SourceExe -Destination $TargetExe -Force

# Register a Startup-folder shortcut so the agent launches automatically at login.
$StartupDir = [Environment]::GetFolderPath("Startup")
$ShortcutPath = Join-Path $StartupDir "RemoteOpsAgent.lnk"
$WScriptShell = New-Object -ComObject WScript.Shell
$Shortcut = $WScriptShell.CreateShortcut($ShortcutPath)
$Shortcut.TargetPath = $TargetExe
$Shortcut.WorkingDirectory = $InstallDir
$Shortcut.WindowStyle = 7  # minimized
$Shortcut.Description = "Remote Ops desktop monitoring agent"
$Shortcut.Save()

Write-Host "Installed. The agent will start automatically the next time you log in."
Write-Host ""
$runNow = Read-Host "Pair this device and start the agent now? (y/n)"
if ($runNow -eq "y") {
    Start-Process -FilePath $TargetExe -WorkingDirectory $InstallDir
}
