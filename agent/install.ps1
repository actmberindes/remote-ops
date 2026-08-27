# Remote Ops Agent - Windows per-user installer
# Run from PowerShell without administrator rights.

$ErrorActionPreference = "Stop"

$InstallDir = Join-Path $env:LOCALAPPDATA "RemoteOpsAgent"
$ExeName = "remote-ops-agent.exe"
$VbsName = "start-agent.vbs"

$SourceExe = Join-Path $PSScriptRoot $ExeName
$SourceVbs = Join-Path $PSScriptRoot $VbsName

$TargetExe = Join-Path $InstallDir $ExeName
$TargetVbs = Join-Path $InstallDir $VbsName

# --------------------------------------------------
# Verify source files
# --------------------------------------------------

if (-not (Test-Path -LiteralPath $SourceExe -PathType Leaf)) {
    throw "Agent executable not found: $SourceExe"
}

if (-not (Test-Path -LiteralPath $SourceVbs -PathType Leaf)) {
    throw "Silent launcher not found: $SourceVbs"
}

# --------------------------------------------------
# Create installation directory
# --------------------------------------------------

Write-Host "Installing Remote Ops Agent to $InstallDir..."

New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null

Copy-Item -Path $SourceExe -Destination $TargetExe -Force
Copy-Item -Path $SourceVbs -Destination $TargetVbs -Force

# --------------------------------------------------
# Check enrollment
# --------------------------------------------------

$configDir = Join-Path $env:APPDATA "RemoteOpsAgent"
$configPath = Join-Path $configDir "config.json"

$isAlreadyEnrolled = Test-Path -LiteralPath $configPath -PathType Leaf

if (-not $isAlreadyEnrolled) {

    Write-Host ""
    Write-Host "==========================================="
    Write-Host "  Remote Ops - Device Enrollment"
    Write-Host "==========================================="
    Write-Host ""
    Write-Host "Have the Admin enrollment code ready."
    Write-Host "The enrollment window will remain visible while the code is entered."
    Write-Host ""

    $process = Start-Process `
        -FilePath $TargetExe `
        -ArgumentList "--enroll" `
        -WorkingDirectory $InstallDir `
        -Wait `
        -PassThru

    if ($process.ExitCode -ne 0) {
        throw "Device enrollment did not complete successfully. Exit code: $($process.ExitCode)"
    }

    Write-Host ""
    Write-Host "Device enrollment completed successfully."
}
else {
    Write-Host "An existing enrollment was found. Skipping the enrollment prompt."
}

# --------------------------------------------------
# Create Startup shortcut
# --------------------------------------------------

$StartupDir = [Environment]::GetFolderPath("Startup")
$ShortcutPath = Join-Path $StartupDir "RemoteOpsAgent.lnk"

$WScriptShell = New-Object -ComObject WScript.Shell

$Shortcut = $WScriptShell.CreateShortcut($ShortcutPath)

$Shortcut.TargetPath = Join-Path $env:WINDIR "System32\wscript.exe"
$Shortcut.Arguments = "`"$TargetVbs`""
$Shortcut.WorkingDirectory = $InstallDir
$Shortcut.WindowStyle = 1
$Shortcut.Description = "Remote Ops desktop monitoring agent"

$Shortcut.Save()

Write-Host ""
Write-Host "Startup shortcut registered: $ShortcutPath"
Write-Host "The agent will start silently at the next Windows sign-in."
Write-Host ""

# --------------------------------------------------
# Start agent now
# --------------------------------------------------

$runNow = Read-Host "Start the background agent now? (y/n)"

if ($runNow -eq "y") {

    $WScriptPath = Join-Path $env:WINDIR "System32\wscript.exe"

    Start-Process `
        -FilePath $WScriptPath `
        -ArgumentList "`"$TargetVbs`"" `
        -WorkingDirectory $InstallDir `
        -WindowStyle Hidden

    Write-Host "Background agent started. Check the Windows system tray for Remote Ops."
}

Write-Host ""
Write-Host "Installation complete."