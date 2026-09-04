# Remote Ops Agent - Windows machine-wide installer
# Run PowerShell as Administrator.
# The agent is installed once per physical device and starts in each interactive user session.

$ErrorActionPreference = "Stop"

$InstallDir = Join-Path ($env:ProgramData) "RemoteOpsAgent"
$ExeName = "remote-ops-agent.exe"
$VbsName = "start-agent.vbs"
$SourceExe = Join-Path $PSScriptRoot $ExeName
$SourceVbs = Join-Path $PSScriptRoot $VbsName
$TargetExe = Join-Path $InstallDir $ExeName
$TargetVbs = Join-Path $InstallDir $VbsName
$ConfigDir = Join-Path ($env:ProgramData) "RemoteOpsAgent"
$ConfigPath = Join-Path $ConfigDir "config.json"
$LegacyConfigPath = Join-Path ($env:APPDATA) "RemoteOpsAgent\config.json"
$CommonStartupDir = [Environment]::GetFolderPath("CommonStartup")
$ShortcutPath = Join-Path $CommonStartupDir "RemoteOpsAgent.lnk"

$currentIdentity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($currentIdentity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw "Please run install.ps1 from an elevated PowerShell window (Run as Administrator)."
}

if (-not (Test-Path -LiteralPath $SourceExe -PathType Leaf)) { throw "Agent executable not found: $SourceExe" }
if (-not (Test-Path -LiteralPath $SourceVbs -PathType Leaf)) { throw "Silent launcher not found: $SourceVbs" }

Get-Process -Name "remote-ops-agent" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Milliseconds 700

Write-Host "Installing Remote Ops Agent to $InstallDir..."
New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
Copy-Item -Path $SourceExe -Destination $TargetExe -Force
Copy-Item -Path $SourceVbs -Destination $TargetVbs -Force
try { Unblock-File -LiteralPath $TargetExe -ErrorAction Stop } catch { }

& icacls.exe $InstallDir /inheritance:e /grant:r "Users:(OI)(CI)(RX)" "Administrators:(OI)(CI)(F)" "SYSTEM:(OI)(CI)(F)" | Out-Null

# Migrate an existing per-user enrollment created by the previous installer.
if (-not (Test-Path -LiteralPath $ConfigPath -PathType Leaf) -and (Test-Path -LiteralPath $LegacyConfigPath -PathType Leaf)) {
    Write-Host "Migrating existing per-user enrollment into the machine-wide configuration..."
    & icacls.exe $ConfigDir /grant:r "$($currentIdentity.Name):(OI)(CI)(M)" | Out-Null
    Copy-Item -LiteralPath $LegacyConfigPath -Destination $ConfigPath -Force
}

$isAlreadyEnrolled = Test-Path -LiteralPath $ConfigPath -PathType Leaf
if (-not $isAlreadyEnrolled) {
    Write-Host ""
    Write-Host "==========================================="
    Write-Host "  Remote Ops - Device Enrollment"
    Write-Host "==========================================="
    Write-Host ""
    Write-Host "This enrollment is for the physical computer, not one employee."
    Write-Host "Any supported Windows user who later signs in can be monitored automatically."
    Write-Host ""
    & icacls.exe $ConfigDir /grant:r "$($currentIdentity.Name):(OI)(CI)(M)" | Out-Null
    & $TargetExe --enroll
    $exitCode = $LASTEXITCODE
    if ($exitCode -ne 0) { throw "Device enrollment did not complete successfully. Exit code: $exitCode" }
    Write-Host ""
    Write-Host "Device enrollment completed successfully."
}
else {
    Write-Host "An existing machine enrollment was found. Skipping the enrollment prompt."
}

& icacls.exe $InstallDir /grant:r "Users:(OI)(CI)(RX)" "Administrators:(OI)(CI)(F)" "SYSTEM:(OI)(CI)(F)" | Out-Null

# Remove legacy per-user Startup shortcuts so the same user does not launch the agent twice.
$usersRoot = Join-Path $env:SystemDrive 'Users'
if (Test-Path -LiteralPath $usersRoot) {
    Get-ChildItem -LiteralPath $usersRoot -Directory -Force -ErrorAction SilentlyContinue | ForEach-Object {
        $legacyShortcut = Join-Path $_.FullName 'AppData\Roaming\Microsoft\Windows\Start Menu\Programs\Startup\RemoteOpsAgent.lnk'
        if (Test-Path -LiteralPath $legacyShortcut -PathType Leaf) {
            Remove-Item -LiteralPath $legacyShortcut -Force -ErrorAction SilentlyContinue
        }
    }
}

New-Item -ItemType Directory -Force -Path $CommonStartupDir | Out-Null
$WScriptShell = New-Object -ComObject WScript.Shell
$Shortcut = $WScriptShell.CreateShortcut($ShortcutPath)
$Shortcut.TargetPath = Join-Path $env:WINDIR "System32\wscript.exe"
$Shortcut.Arguments = "`"$TargetVbs`""
$Shortcut.WorkingDirectory = $InstallDir
$Shortcut.WindowStyle = 1
$Shortcut.Description = "Remote Ops desktop monitoring agent (shared device)"
$Shortcut.Save()

Write-Host ""
Write-Host "Machine-wide Startup shortcut registered: $ShortcutPath"
Write-Host "The agent will start for every Windows user at sign-in, including RDP users."
Write-Host ""

$runNow = Read-Host "Start the background agent now for the current user? (y/n)"
if ($runNow -eq "y") {
    $WScriptPath = Join-Path $env:WINDIR "System32\wscript.exe"
    Start-Process -FilePath $WScriptPath -ArgumentList "`"$TargetVbs`"" -WorkingDirectory $InstallDir -WindowStyle Hidden
    Write-Host "Background agent started for the current session."
}

Write-Host ""
Write-Host "Installation complete."
Write-Host "Shared-device monitoring is enabled for future Windows/RDP sign-ins."
