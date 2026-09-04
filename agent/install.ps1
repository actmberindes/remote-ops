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
$CurrentUserLegacyConfigPath = Join-Path $env:APPDATA "RemoteOpsAgent\config.json"
$CommonStartupDir = [Environment]::GetFolderPath("CommonStartup")
$ShortcutPath = Join-Path $CommonStartupDir "RemoteOpsAgent.lnk"
$MachineRunKey = 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Run'
$MachineRunName = 'RemoteOpsAgent'
$MachineRunCommand = "`"$env:WINDIR\System32\wscript.exe`" `"$TargetVbs`""

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

# Existing installations created by the old per-user installer stored the
# enrollment under that Windows user's APPDATA. The new shared-device agent
# stores its enrollment under ProgramData, so scan every local profile rather
# than looking only at the Administrator's APPDATA.
function Find-LegacyEnrollment {
    param(
        [string]$UsersRoot
    )

    if (-not (Test-Path -LiteralPath $UsersRoot -PathType Container)) {
        return $null
    }

    $candidates = @()
    $profiles = Get-ChildItem -LiteralPath $UsersRoot -Directory -Force -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -notin @('Public', 'Default', 'Default User', 'All Users') }

    foreach ($profile in $profiles) {
        $candidatePath = Join-Path $profile.FullName 'AppData\Roaming\RemoteOpsAgent\config.json'
        if (-not (Test-Path -LiteralPath $candidatePath -PathType Leaf)) { continue }

        try {
            $candidate = Get-Content -LiteralPath $candidatePath -Raw -ErrorAction Stop | ConvertFrom-Json -ErrorAction Stop
            if ($candidate.deviceToken -and $candidate.deviceId) {
                $candidates += [PSCustomObject]@{
                    Path = $candidatePath
                    Data = $candidate
                    Profile = $profile.Name
                }
            }
        }
        catch {
            Write-Host "Skipping unreadable/invalid legacy config: $candidatePath"
        }
    }

    if ($candidates.Count -eq 0) {
        return $null
    }

    # Prefer a legacy enrollment that matches this physical machine.
    $machineGuidOutput = & reg.exe query 'HKLM\SOFTWARE\Microsoft\Cryptography' /v MachineGuid 2>$null
    $machineGuidMatch = [regex]::Match(($machineGuidOutput | Out-String), 'MachineGuid\s+REG_SZ\s+(.+)', [System.Text.RegularExpressions.RegexOptions]::IgnoreCase)
    $machineGuid = if ($machineGuidMatch.Success) { $machineGuidMatch.Groups[1].Value.Trim() } else { $null }

    if ($machineGuid) {
        $match = $candidates | Where-Object { $_.Data.machineId -and [string]$_.Data.machineId -eq $machineGuid } | Select-Object -First 1
        if ($match) { return $match }
    }

    # Otherwise, use the first valid existing enrollment. Only one physical
    # machine should normally have been enrolled from this computer profile set.
    return ($candidates | Select-Object -First 1)
}

# Make the machine-wide config readable/writable by the agent's signed-in users.
& icacls.exe $ConfigDir /inheritance:e /grant:r "Users:(OI)(CI)(M)" "Administrators:(OI)(CI)(F)" "SYSTEM:(OI)(CI)(F)" | Out-Null

if (-not (Test-Path -LiteralPath $ConfigPath -PathType Leaf)) {
    $legacy = $null

    # First check the current PowerShell user's legacy path, then scan all user
    # profiles so running this installer elevated does not hide the original
    # enrollment created under Joshua/Karen/etc.
    if (Test-Path -LiteralPath $CurrentUserLegacyConfigPath -PathType Leaf) {
        try {
            $legacyData = Get-Content -LiteralPath $CurrentUserLegacyConfigPath -Raw -ErrorAction Stop | ConvertFrom-Json -ErrorAction Stop
            if ($legacyData.deviceToken -and $legacyData.deviceId) {
                $legacy = [PSCustomObject]@{ Path = $CurrentUserLegacyConfigPath; Data = $legacyData; Profile = $currentIdentity.Name }
            }
        }
        catch { }
    }

    if (-not $legacy) {
        $legacy = Find-LegacyEnrollment -UsersRoot (Join-Path $env:SystemDrive 'Users')
    }

    if ($legacy) {
        Write-Host "Migrating existing device enrollment from $($legacy.Profile) into the machine-wide configuration..."
        Copy-Item -LiteralPath $legacy.Path -Destination $ConfigPath -Force
        Write-Host "Existing enrollment migrated successfully. No new enrollment is required."
    }
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
    & $TargetExe --enroll
    $exitCode = $LASTEXITCODE
    if ($exitCode -ne 0) { throw "Device enrollment did not complete successfully. Exit code: $exitCode" }
    Write-Host ""
    Write-Host "Device enrollment completed successfully."
}
else {
    Write-Host "An existing machine enrollment was found. Skipping the enrollment prompt."
}

& icacls.exe $InstallDir /inheritance:e /grant:r "Users:(OI)(CI)(RX)" "Administrators:(OI)(CI)(F)" "SYSTEM:(OI)(CI)(F)" | Out-Null
& icacls.exe $ConfigDir /inheritance:e /grant:r "Users:(OI)(CI)(M)" "Administrators:(OI)(CI)(F)" "SYSTEM:(OI)(CI)(F)" | Out-Null

# Remove legacy per-user Startup shortcuts, then explicitly seed shortcuts for
# existing interactive profiles. This makes the launcher visible in each
# user's Startup folder while the HKLM Run entry below also covers future users
# and RDP sign-ins where Startup-folder policy may be restricted.
$usersRoot = Join-Path $env:SystemDrive 'Users'
if (Test-Path -LiteralPath $usersRoot) {
    Get-ChildItem -LiteralPath $usersRoot -Directory -Force -ErrorAction SilentlyContinue | ForEach-Object {
        if ($_.Name -in @('Public', 'Default', 'Default User', 'All Users')) { return }

        $legacyShortcut = Join-Path $_.FullName 'AppData\Roaming\Microsoft\Windows\Start Menu\Programs\Startup\RemoteOpsAgent.lnk'
        if (Test-Path -LiteralPath $legacyShortcut -PathType Leaf) {
            Remove-Item -LiteralPath $legacyShortcut -Force -ErrorAction SilentlyContinue
        }

        try {
            $userStartup = Split-Path $legacyShortcut -Parent
            New-Item -ItemType Directory -Force -Path $userStartup | Out-Null
            $userShortcut = New-Object -ComObject WScript.Shell
            $userLink = $userShortcut.CreateShortcut($legacyShortcut)
            $userLink.TargetPath = Join-Path $env:WINDIR 'System32\wscript.exe'
            $userLink.Arguments = "`"$TargetVbs`""
            $userLink.WorkingDirectory = $InstallDir
            $userLink.WindowStyle = 1
            $userLink.Description = 'Remote Ops desktop monitoring agent (shared device)'
            $userLink.Save()
        }
        catch {
            Write-Host "Could not create per-user Startup shortcut for $($_.Name): $($_.Exception.Message)"
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

# Machine Run is the primary automatic-launch mechanism. It runs the agent in
# the context of every interactive Windows user at sign-in, including users
# connecting later through RDP, without requiring a separate per-user install.
New-Item -Path $MachineRunKey -Force | Out-Null
New-ItemProperty -Path $MachineRunKey -Name $MachineRunName -PropertyType String -Value $MachineRunCommand -Force | Out-Null

Write-Host ""
Write-Host "Machine-wide Startup shortcut registered: $ShortcutPath"
Write-Host "Machine-wide Run entry registered: HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Run\$MachineRunName"
Write-Host "Per-user Startup shortcuts seeded for existing local profiles."
Write-Host "The agent will start for every Windows user at sign-in, including future RDP users."
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
