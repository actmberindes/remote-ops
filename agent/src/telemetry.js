const os = require('node:os');
const { execFileSync } = require('node:child_process');

const LOCK_STATE_CACHE_MS = 1000;
let lockStateCache = { value: false, checkedAt: 0 };

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

function getPrimaryIPv4() {
  const interfaces = os.networkInterfaces();
  for (const entries of Object.values(interfaces)) {
    for (const entry of entries || []) {
      if (entry.family === 'IPv4' && !entry.internal && entry.address) return entry.address;
    }
  }
  return '';
}

function isServiceIdentity(value) {
  return /^(NT AUTHORITY\\)?(SYSTEM|LOCAL SERVICE|NETWORK SERVICE)$/i.test(String(value || '').trim());
}

const WTS_SESSION_CACHE_MS = 1000;
let activeSessionCache = { value: null, checkedAt: 0 };

function getActiveConsoleSessionViaWts() {
  if (process.platform !== 'win32') return null;

  const now = Date.now();
  if (now - activeSessionCache.checkedAt < WTS_SESSION_CACHE_MS) {
    return activeSessionCache.value;
  }

  // WTSGetActiveConsoleSessionId identifies the Windows console session that
  // is currently attached to the physical/interactive desktop. This is
  // session-specific and therefore works across Fast User Switching, unlike
  // LogonUI.exe or the last global Security 4800 event.
  const script = `Add-Type @"
using System;
using System.Runtime.InteropServices;

public static class RemoteOpsWts {
  public enum WTS_INFO_CLASS {
    WTSInitialProgram = 0,
    WTSApplicationName = 1,
    WTSWorkingDirectory = 2,
    WTSOEMId = 3,
    WTSSessionId = 4,
    WTSUserName = 5,
    WTSWinStationName = 6,
    WTSDomainName = 7
  }

  [DllImport("kernel32.dll")]
  public static extern uint WTSGetActiveConsoleSessionId();

  [DllImport("wtsapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  public static extern bool WTSQuerySessionInformation(
    IntPtr hServer,
    uint sessionId,
    WTS_INFO_CLASS infoClass,
    out IntPtr buffer,
    out uint bytesReturned
  );

  [DllImport("wtsapi32.dll")]
  public static extern void WTSFreeMemory(IntPtr memory);

  public static string Query(uint sessionId, WTS_INFO_CLASS infoClass) {
    IntPtr buffer;
    uint bytes;
    if (!WTSQuerySessionInformation(IntPtr.Zero, sessionId, infoClass, out buffer, out bytes) || buffer == IntPtr.Zero) {
      return "";
    }

    try {
      return Marshal.PtrToStringUni(buffer) ?? "";
    } finally {
      WTSFreeMemory(buffer);
    }
  }

  public static string GetActiveConsoleIdentity() {
    uint sessionId = WTSGetActiveConsoleSessionId();
    if (sessionId == 0xFFFFFFFF) return "";

    string username = Query(sessionId, WTS_INFO_CLASS.WTSUserName);
    string domain = Query(sessionId, WTS_INFO_CLASS.WTSDomainName);
    string station = Query(sessionId, WTS_INFO_CLASS.WTSWinStationName);
    if (String.IsNullOrWhiteSpace(username)) return "";

    string identity = String.IsNullOrWhiteSpace(domain)
      ? username
      : domain + "\\" + username;

    return identity + "|" + station + "|" + sessionId.ToString();
  }
}
"@; [RemoteOpsWts]::GetActiveConsoleIdentity()`;
  const output = run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script]);
  const parts = output.split('|');
  if (parts.length >= 3 && parts[0] && /^\\d+$/.test(parts[2])) {
    activeSessionCache = {
      value: {
        username: parts[0],
        sessionName: parts[1] || 'Console',
        sessionId: Number(parts[2]),
        idleSeconds: null,
      },
      checkedAt: now,
    };
    return activeSessionCache.value;
  }

  activeSessionCache = { value: null, checkedAt: now };
  return null;
}

function parseActiveSession(output) {
  const lines = String(output || '').split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || /^USERNAME\s+/i.test(line)) continue;
    const match = line.match(/^>?\s*(\S+)\s+(\S+)\s+(\d+)\s+(ACTIVE)\b(?:\s+(\S+))?/i);
    if (!match || isServiceIdentity(match[1])) continue;
    return {
      username: match[1],
      sessionName: match[2],
      sessionId: Number(match[3]),
      idleSeconds: null,
    };
  }
  return null;
}

function getActiveInteractiveSession() {
  if (process.platform !== 'win32') return null;
  const connection = getConnectionType();

  // Preserve the existing RDP path. Do not replace the RDP session identity
  // with the active console session when the agent is running under RDP.
  if (connection.isRdp) {
    const processUser = run('whoami.exe', []);
    return !isServiceIdentity(processUser) && processUser
      ? {
          username: processUser,
          sessionName: connection.sessionName,
          sessionId: null,
          idleSeconds: null,
        }
      : null;
  }

  // Use the Windows Terminal Services API for the actual active console
  // session. This is reliable when the agent is running as a Windows service
  // and avoids depending on the service's Session 0 environment.
  const wtsSession = getActiveConsoleSessionViaWts();
  if (wtsSession?.username) return wtsSession;

  // Keep query user as a fallback for systems where the WTS API is unavailable.
  return parseActiveSession(run('query.exe', ['user']));
}

function getInteractiveUser() {
  if (process.platform !== 'win32') {
    try { return os.userInfo().username || ''; } catch (_) { return ''; }
  }

  const active = getActiveInteractiveSession();
  if (active?.username) return active.username;

  const processUser = run('whoami.exe', []);
  return !isServiceIdentity(processUser) ? processUser : '';
}

function getConnectionType() {
  if (process.platform !== 'win32') return { isRdp: false, sessionName: null };
  const sessionName = String(process.env.SESSIONNAME || '').trim() || null;
  const isRdp = /^RDP-Tcp#/i.test(sessionName || '');
  return { isRdp, sessionName };
}

function getSecurityLockState() {
  const output = run('wevtutil.exe', [
    'qe',
    'Security',
    '/q:*[System[(EventID=4800 or EventID=4801)]]',
    '/c:1',
    '/rd:true',
    '/f:text',
  ]);

  const eventId = output.match(/Event ID:\s*(4800|4801)/i)?.[1];
  if (eventId === '4800') return true;
  if (eventId === '4801') return false;
  return null;
}

function isLogonUiRunning() {
  const output = run('tasklist.exe', [
    '/FI',
    'IMAGENAME eq LogonUI.exe',
    '/NH',
  ]);
  return /(?:^|\s)LogonUI\.exe\s+/i.test(output);
}

function getWorkstationLocked() {
  if (process.platform !== 'win32') return false;

  const now = Date.now();
  if (now - lockStateCache.checkedAt < LOCK_STATE_CACHE_MS) {
    return lockStateCache.value;
  }

  const connection = getConnectionType();

  // Preserve the existing RDP behavior. The scheduler already allows RDP
  // monitoring while the session is locked.
  if (connection.isRdp) {
    const logonUiLocked = isLogonUiRunning();
    const securityLocked = getSecurityLockState();
    const locked = logonUiLocked || securityLocked === true;
    lockStateCache = { value: locked, checkedAt: now };
    return locked;
  }

  // Lock state is session-specific when Fast User Switching is involved.
  // A machine-wide LogonUI.exe process or Security 4800 event can belong to
  // the previously active user, so it must not mark the newly active user's
  // session as locked.
  //
  // If Windows reports an active interactive session, that is the session we
  // monitor and it is not locked. Only fall back to machine-wide lock
  // indicators when there is no active interactive session.
  const activeSession = getActiveInteractiveSession();
  if (activeSession?.username) {
    lockStateCache = { value: false, checkedAt: now };
    return false;
  }

  const logonUiLocked = isLogonUiRunning();
  const securityLocked = getSecurityLockState();
  const locked = logonUiLocked || securityLocked === true;

  lockStateCache = { value: locked, checkedAt: now };
  return locked;
}
function getIdentity() {
  const hostname = process.env.COMPUTERNAME || os.hostname();
  const activeSession = getActiveInteractiveSession();
  const interactiveUser = activeSession?.username || getInteractiveUser();
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
    sessionId: activeSession?.sessionId ?? null,
    activeSessionName: activeSession?.sessionName || null,
    ipAddress: getPrimaryIPv4() || null,
    operatingSystem: `${os.platform()} ${os.release()}`,
    isRdp: connection.isRdp,
    sessionName: connection.sessionName,
    sessionLocked: getWorkstationLocked(),
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
  if (identity.sessionLocked) return { ...identity, state: 'locked', idleSeconds };
  if (idleSeconds >= 300) return { ...identity, state: 'idle', idleSeconds };
  return { ...identity, state: 'active', idleSeconds };
}

module.exports = { getIdentity, getIdleSeconds, getDeviceState, getWorkstationLocked };
