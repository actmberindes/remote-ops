# Remote Ops Agent — uninstaller
#   powershell -ExecutionPolicy Bypass -File uninstall.ps1

$InstallDir = Join-Path $env:LOCALAPPDATA "RemoteOpsAgent"
$StartupDir = [Environment]::GetFolderPath("Startup")
$ShortcutPath = Join-Path $StartupDir "RemoteOpsAgent.lnk"

Get-Process -Name "remote-ops-agent" -ErrorAction SilentlyContinue | Stop-Process -Force

if (Test-Path $ShortcutPath) { Remove-Item $ShortcutPath -Force }
if (Test-Path $InstallDir) { Remove-Item $InstallDir -Recurse -Force }

Write-Host "Remote Ops Agent has been removed from this computer."
Write-Host "Don't forget to revoke this device from Admin > User Management > Devices."
