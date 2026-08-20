const os = require('node:os');
const { execFileSync } = require('node:child_process');

function run(command, args) {
  try {
    return execFileSync(command, args, {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 5000,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch (_) {
    return '';
  }
}

function getMachineId() {
  if (process.platform !== 'win32') return os.hostname();

  const output = run('reg.exe', [
    'query',
    'HKLM\\SOFTWARE\\Microsoft\\Cryptography',
    '/v',
    'MachineGuid',
  ]);

  const match = output.match(/MachineGuid\s+REG_SZ\s+(.+)/i);
  return match ? match[1].trim() : os.hostname();
}

function getInteractiveUser() {
  if (process.platform !== 'win32') {
    try { return os.userInfo().username || ''; } catch (_) { return ''; }
  }

  // Do not rely on process.env.USERNAME because a Windows background service
  // may run as LocalSystem or another service account. Ask Windows which
  // interactive user is actually logged on to the machine.
  const output = run('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    '$cs = Get-CimInstance Win32_ComputerSystem; if ($cs.UserName) { $cs.UserName }',
  ]);

  return output || '';
}

function getIdentity() {
  const hostname = process.env.COMPUTERNAME || os.hostname();
  const interactiveUser = getInteractiveUser();

  const match = interactiveUser.match(/^([^\\]+)\\(.+)$/);
  const domain = match ? match[1] : null;
  const username = match ? match[2] : (interactiveUser || null);
  const domainUser = interactiveUser || null;

  return {
    machineId: getMachineId(),
    hostname,
    domain,
    domainUser,
    username,
  };
}

function getIdleSeconds() {
  if (process.platform !== 'win32') return 0;

  const script = `Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class IdleNative {
  [StructLayout(LayoutKind.Sequential)] public struct LASTINPUTINFO { public uint cbSize; public uint dwTime; }
  [DllImport("user32.dll")] public static extern bool GetLastInputInfo(ref LASTINPUTINFO plii);
  [DllImport("kernel32.dll")] public static extern uint GetTickCount();
}
"@; $info = New-Object IdleNative+LASTINPUTINFO; $info.cbSize = [Runtime.InteropServices.Marshal]::SizeOf($info); if([IdleNative]::GetLastInputInfo([ref]$info)){ [math]::Round((([IdleNative]::GetTickCount() - $info.dwTime) / 1000), 0) }`;
  const output = run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script]);
  const value = Number(output);
  return Number.isFinite(value) ? value : 0;
}

function getDeviceState() {
  const identity = getIdentity();
  const idleSeconds = getIdleSeconds();

  if (!identity.domainUser) return { ...identity, state: 'logged-out', idleSeconds };
  if (idleSeconds >= 300) return { ...identity, state: 'idle', idleSeconds };
  return { ...identity, state: 'active', idleSeconds };
}

module.exports = { getIdentity, getIdleSeconds, getDeviceState };
