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

function isServiceIdentity(value) {
  return /^(NT AUTHORITY\\)?(SYSTEM|LOCAL SERVICE|NETWORK SERVICE)$/i.test(String(value || '').trim());
}

function getInteractiveUser() {
  if (process.platform !== 'win32') {
    try { return os.userInfo().username || ''; } catch (_) { return ''; }
  }

  // Prefer whoami.exe when the agent is running in the interactive user's
  // session. This normally returns DOMAIN\\username for both console and RDP.
  const processUser = run('whoami.exe', []);
  if (processUser && !isServiceIdentity(processUser)) {
    return processUser;
  }

  // If the agent is elevated or running as a service, whoami may report the
  // service account instead of the person currently using the workstation.
  // `query user` reports the interactive Windows sessions directly.
  const queryUser = run('query.exe', ['user']);
  if (queryUser) {
    const lines = queryUser.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    for (const line of lines) {
      if (/^USERNAME\s+/i.test(line)) continue;

      // The active session line begins with the username (possibly prefixed by
      // >), followed by session name, session ID, state, idle time, and logon.
      const match = line.match(/^>?\s*(\S+)\s+\S+\s+\d+\s+(ACTIVE|DISC|DISCONNECTED)\b/i);
      if (match && match[1] && !isServiceIdentity(match[1])) {
        return match[1];
      }
    }
  }

  // Last fallback for a normal interactive process.
  const envUsername = String(process.env.USERNAME || '').trim();
  if (envUsername && !isServiceIdentity(envUsername)) {
    const envDomain = String(process.env.USERDOMAIN || '').trim();
    return envDomain ? `${envDomain}\\${envUsername}` : envUsername;
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