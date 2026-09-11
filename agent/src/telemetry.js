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

  // Prefer the Windows session identity reported by whoami.exe. The agent is
  // expected to run in the signed-in user's interactive session, including RDP.
  const processUser = run('whoami.exe', []);
  if (processUser && !/^(NT AUTHORITY\\)?(SYSTEM|LOCAL SERVICE|NETWORK SERVICE)$/i.test(processUser)) {
    return processUser;
  }

  // Fallback to the environment identity when whoami.exe is unavailable.
  const envUsername = String(process.env.USERNAME || '').trim();
  if (envUsername) {
    const envDomain = String(process.env.USERDOMAIN || '').trim();
    return envDomain ? `${envDomain}\\${envUsername}` : envUsername;
  }

  // Last-resort fallback: query the interactive sessions directly. This is
  // useful if the process environment does not contain USERNAME/USERDOMAIN.
  const queryUser = run('query', ['user']);
  if (queryUser) {
    const lines = queryUser.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    for (const line of lines) {
      if (/^USERNAME\s+/i.test(line)) continue;
      if (/^(?:services|console|rdp-tcp|>)/i.test(line)) continue;

      const match = line.match(/^>?(\S+)\s+/);
      if (match && match[1]) return match[1];
    }
  }

  return '';
}

function getConnectionType() {
  if (process.platform !== 'win32') return { isRdp: false, sessionName: null };

  // SESSIONNAME is populated per interactive Windows session. RDP sessions use
  // names such as RDP-Tcp#4, while a locally signed-in console uses Console.
  const sessionName = String(process.env.SESSIONNAME || '').trim() || null;
  const isRdp = /^RDP-Tcp#/i.test(sessionName || '');
  return { isRdp, sessionName };
}

function getIdentity() {
  const hostname = process.env.COMPUTERNAME || os.hostname();
  const interactiveUser = getInteractiveUser();
  const connection = getConnectionType();

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
    isRdp: connection.isRdp,
    sessionName: connection.sessionName,
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