const os = require('node:os');
const { execFileSync } = require('node:child_process');

// Session-aware monitoring rebuild marker: 2026-10-02
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
  if (now - activeSessionCache.checkedAt < WTS_SESSION_CACHE_MS) return activeSessionCache.value;

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
    WTSDomainName = 7,
    WTSConnectState = 8,
    WTSClientProtocolType = 16
  }

  public enum WTS_CONNECTSTATE_CLASS {
    WTSActive = 0,
    WTSConnected = 1,
    WTSConnectQuery = 2,
    WTSShadow = 3,
    WTSDisconnected = 4,
    WTSIdle = 5,
    WTSListen = 6,
    WTSReset = 7,
    WTSDown = 8,
    WTSInit = 9
  }

  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct WTS_SESSION_INFO {
    public uint SessionId;
    public IntPtr WinStationName;
    public WTS_CONNECTSTATE_CLASS State;
  }

  [DllImport("kernel32.dll")]
  public static extern uint WTSGetActiveConsoleSessionId();

  [DllImport("wtsapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  public static extern bool WTSQuerySessionInformation(
    IntPtr hServer, uint sessionId, WTS_INFO_CLASS infoClass,
    out IntPtr buffer, out uint bytesReturned);

  [DllImport("wtsapi32.dll")]
  public static extern void WTSFreeMemory(IntPtr memory);

  [DllImport("wtsapi32.dll", SetLastError = true)]
  public static extern bool WTSEnumerateSessions(
    IntPtr hServer, uint reserved, uint version,
    out IntPtr sessionInfo, out uint count);

  public static string Query(uint sessionId, WTS_INFO_CLASS infoClass) {
    IntPtr buffer; uint bytes;
    if (!WTSQuerySessionInformation(IntPtr.Zero, sessionId, infoClass, out buffer, out bytes) || buffer == IntPtr.Zero)
      return "";
    try { return Marshal.PtrToStringUni(buffer) ?? ""; }
    finally { WTSFreeMemory(buffer); }
  }

  public static string GetActiveConsoleIdentity() {
    uint consoleId = WTSGetActiveConsoleSessionId();

    // Prefer the API's explicit physical-console session ID.
    if (consoleId != 0xFFFFFFFF) {
      string username = Query(consoleId, WTS_INFO_CLASS.WTSUserName);
      string domain = Query(consoleId, WTS_INFO_CLASS.WTSDomainName);
      string station = Query(consoleId, WTS_INFO_CLASS.WTSWinStationName);
      string state = Query(consoleId, WTS_INFO_CLASS.WTSConnectState);
      if (!String.IsNullOrWhiteSpace(username)) {
        string identity = String.IsNullOrWhiteSpace(domain) ? username : domain + "\\" + username;
        return identity + "|" + station + "|" + consoleId.ToString() + "|" + state + "|console";
      }
    }

    // During a console attach/detach, enumerate sessions instead of falling
    // back to a machine-wide lock indicator. Select an active console session.
    IntPtr buffer; uint count;
    if (!WTSEnumerateSessions(IntPtr.Zero, 0, 1, out buffer, out count) || buffer == IntPtr.Zero)
      return "";

    try {
      int size = Marshal.SizeOf(typeof(WTS_SESSION_INFO));
      for (int i = 0; i < count; i++) {
        IntPtr current = IntPtr.Add(buffer, i * size);
        WTS_SESSION_INFO info = (WTS_SESSION_INFO)Marshal.PtrToStructure(current, typeof(WTS_SESSION_INFO));
        if (info.State != WTS_CONNECTSTATE_CLASS.WTSActive) continue;

        string username = Query(info.SessionId, WTS_INFO_CLASS.WTSUserName);
        string domain = Query(info.SessionId, WTS_INFO_CLASS.WTSDomainName);
        string station = Query(info.SessionId, WTS_INFO_CLASS.WTSWinStationName);
        string protocol = Query(info.SessionId, WTS_INFO_CLASS.WTSClientProtocolType);

        // Client protocol 0 is the physical console. Keep RDP handling separate.
        if (protocol != "0" && !String.Equals(station, "Console", StringComparison.OrdinalIgnoreCase))
          continue;

        if (!String.IsNullOrWhiteSpace(username)) {
          string identity = String.IsNullOrWhiteSpace(domain) ? username : domain + "\\" + username;
          return identity + "|" + station + "|" + info.SessionId.ToString() + "|0|enumerated";
        }
      }
    } finally {
      WTSFreeMemory(buffer);
    }

    return "";
  }
}
"@; [RemoteOpsWts]::GetActiveConsoleIdentity()`;

  const output = run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script]);
  const parts = output.split('|');
  if (parts.length >= 3 && parts[0] && /^\d+$/.test(parts[2])) {
    activeSessionCache = {
      value: {
        username: parts[0],
        sessionName: parts[1] || 'Console',
        sessionId: Number(parts[2]),
        wtsState: parts[3] || null,
        detectionSource: parts[4] || 'wts',
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
      wtsState: 'ACTIVE',
      detectionSource: 'query-user',
      idleSeconds: null,
    };
  }
  return null;
}

function getActiveInteractiveSession() {
  if (process.platform !== 'win32') return null;
  const connection = getConnectionType();

  // Preserve the existing RDP path.
  if (connection.isRdp) {
    const processUser = run('whoami.exe', []);
    return !isServiceIdentity(processUser) && processUser
      ? {
          username: processUser,
          sessionName: connection.sessionName,
          sessionId: null,
          wtsState: 'RDP',
          detectionSource: 'rdp-process',
          idleSeconds: null,
        }
      : null;
  }

  const wtsSession = getActiveConsoleSessionViaWts();
  if (wtsSession?.username) return wtsSession;

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

function getSecurityLockStateForSession(sessionId, domainUser) {
  if (process.platform !== 'win32' || sessionId == null) return null;

  const output = run('wevtutil.exe', [
    'qe',
    'Security',
    '/q:*[System[(EventID=4800 or EventID=4801)]]',
    '/c:30',
    '/rd:true',
    '/f:xml',
  ]);

  const target = String(domainUser || '').toLowerCase();
  const blocks = String(output || '').split(/<Event xmlns=/i).slice(1);

  for (const block of blocks) {
    const eventId = block.match(/<EventID[^>]*>(4800|4801)<\/EventID>/i)?.[1];
    const eventSession = block.match(/<Data Name="SessionId">(.*?)<\/Data>/i)?.[1]?.trim();
    const username = block.match(/<Data Name="TargetUserName">(.*?)<\/Data>/i)?.[1]?.trim();
    const domain = block.match(/<Data Name="TargetDomainName">(.*?)<\/Data>/i)?.[1]?.trim();
    if (!eventId || eventSession == null || Number(eventSession) !== Number(sessionId)) continue;

    const eventUser = username
      ? (domain ? `${domain}\\${username}` : username).toLowerCase()
      : '';
    if (target && eventUser && eventUser !== target) continue;

    return eventId === '4800';
  }

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

  // For local/Fast User Switching, lock state must be tied to the
  // currently active session. Event 4800/4801 includes SessionId, so an
  // older user's lock event cannot lock the newly switched-to session.
  const activeSession = getActiveInteractiveSession();
  if (activeSession?.username) {
    const sessionLock = getSecurityLockStateForSession(activeSession.sessionId, activeSession.username);
    const locked = sessionLock === true;
    lockStateCache = { value: locked, checkedAt: now };
    return locked;
  }

  // No interactive session means the workstation is genuinely at the
  // logon/secure desktop. Do not reuse another user's session state.
  lockStateCache = { value: true, checkedAt: now };
  return true;
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
    sessionDetectionSource: activeSession?.detectionSource || null,
    sessionWtsState: activeSession?.wtsState || null,
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
