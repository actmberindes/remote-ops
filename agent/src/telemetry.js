const os = require('node:os');
const { execFileSync } = require('node:child_process');

const WTS_SESSIONSTATE_LOCK = 0;
const WTS_RDP_PROTOCOL = 2;
const WTS_SCRIPT = String.raw`
Add-Type -TypeDefinition @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;

public static class RemoteOpsWts {
  [StructLayout(LayoutKind.Sequential)]
  public struct SESSION_INFO {
    public uint SessionId;
    public IntPtr WinStationName;
    public int State;
  }

  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct INFOEX_LEVEL1 {
    public uint SessionId;
    public int SessionState;
    public int SessionFlags;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 33)] public string WinStationName;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 21)] public string UserName;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 18)] public string DomainName;
    public long LogonTime;
    public long ConnectTime;
    public long DisconnectTime;
    public long LastInputTime;
    public long CurrentTime;
    public uint IncomingBytes;
    public uint OutgoingBytes;
    public uint IncomingFrames;
    public uint OutgoingFrames;
    public uint IncomingCompressedBytes;
    public uint OutgoingCompressedBytes;
  }

  [StructLayout(LayoutKind.Sequential)]
  public struct INFOEX {
    public uint Level;
    public INFOEX_LEVEL1 Data;
  }

  [DllImport("wtsapi32.dll", CharSet = CharSet.Unicode)]
  static extern bool WTSEnumerateSessionsW(IntPtr hServer, uint Reserved, uint Version, out IntPtr ppSessionInfo, out uint pCount);

  [DllImport("wtsapi32.dll", CharSet = CharSet.Unicode)]
  static extern bool WTSQuerySessionInformationW(IntPtr hServer, uint SessionId, int WTSInfoClass, out IntPtr ppBuffer, out uint pBytesReturned);

  [DllImport("wtsapi32.dll")]
  static extern void WTSFreeMemory(IntPtr pMemory);

  [DllImport("wtsapi32.dll")]
  static extern uint WTSGetActiveConsoleSessionId();

  const int WTSUserName = 5;
  const int WTSDomainName = 7;
  const int WTSConnectState = 8;
  const int WTSClientProtocolType = 16;
  const int WTSSessionInfoEx = 25;

  static string QueryString(uint sessionId, int infoClass) {
    IntPtr p = IntPtr.Zero;
    uint bytes = 0;
    try {
      if (!WTSQuerySessionInformationW(IntPtr.Zero, sessionId, infoClass, out p, out bytes) || p == IntPtr.Zero) return "";
      return Marshal.PtrToStringUni(p) ?? "";
    } finally {
      if (p != IntPtr.Zero) WTSFreeMemory(p);
    }
  }

  static int QueryProtocol(uint sessionId) {
    IntPtr p = IntPtr.Zero;
    uint bytes = 0;
    try {
      if (!WTSQuerySessionInformationW(IntPtr.Zero, sessionId, WTSClientProtocolType, out p, out bytes) || p == IntPtr.Zero || bytes < 2) return -1;
      return Marshal.ReadInt16(p);
    } finally {
      if (p != IntPtr.Zero) WTSFreeMemory(p);
    }
  }

  static INFOEX_LEVEL1 QueryInfoEx(uint sessionId) {
    IntPtr p = IntPtr.Zero;
    uint bytes = 0;
    try {
      if (!WTSQuerySessionInformationW(IntPtr.Zero, sessionId, WTSSessionInfoEx, out p, out bytes) || p == IntPtr.Zero) {
        return new INFOEX_LEVEL1 { SessionId = sessionId, SessionState = -1, SessionFlags = -1 };
      }
      var info = (INFOEX)Marshal.PtrToStructure(p, typeof(INFOEX));
      return info.Data;
    } finally {
      if (p != IntPtr.Zero) WTSFreeMemory(p);
    }
  }

  static string Escape(string value) {
    return (value ?? "").Replace("|", "\\|");
  }

  public static string GetRows() {
    IntPtr p = IntPtr.Zero;
    uint count = 0;
    try {
      if (!WTSEnumerateSessionsW(IntPtr.Zero, 0, 1, out p, out count) || p == IntPtr.Zero) return "";

      int size = Marshal.SizeOf(typeof(SESSION_INFO));
      uint consoleSessionId = WTSGetActiveConsoleSessionId();
      var rows = new List<string>();

      for (uint i = 0; i < count; i++) {
        var row = (SESSION_INFO)Marshal.PtrToStructure(
          IntPtr.Add(p, checked((int)(i * (uint)size))),
          typeof(SESSION_INFO)
        );

        // NOTE: Do not skip non-Active (row.State != 0) sessions here. A session
        // that has been disconnected via Fast User Switching (another user took
        // over the console) or a dropped RDP connection is exactly the case this
        // agent needs to detect, so that the instance running inside that session
        // can pause itself instead of assuming it is still the active user.
        string user = QueryString(row.SessionId, WTSUserName).Trim();
        if (String.IsNullOrWhiteSpace(user)) continue;

        string domain = QueryString(row.SessionId, WTSDomainName).Trim();
        string domainUser = String.IsNullOrWhiteSpace(domain) ? user : domain + "\\" + user;
        int protocol = QueryProtocol(row.SessionId);

        // WTSINFOEX is optional. A failure here must never discard identity.
        int sessionFlags = -1;
        long logonTime = 0;
        long lastInputTime = 0;
        try {
          var info = QueryInfoEx(row.SessionId);
          if (info.SessionId == row.SessionId) {
            sessionFlags = info.SessionFlags;
            logonTime = info.LogonTime;
            lastInputTime = info.LastInputTime;
          }
        } catch {
        }

        rows.Add(
          row.SessionId.ToString() + "|" +
          Escape(domainUser) + "|" +
          protocol.ToString() + "|" +
          sessionFlags.ToString() + "|" +
          logonTime.ToString() + "|" +
          lastInputTime.ToString() + "|" +
          (row.SessionId == consoleSessionId ? "1" : "0") + "|" +
          row.State.ToString()
        );
      }

      return String.Join("\n", rows);
    } finally {
      if (p != IntPtr.Zero) WTSFreeMemory(p);
    }
  }
}
"@
[RemoteOpsWts]::GetRows()
`;
let cachedSessions = { checkedAt: 0, sessions: [] };
const SESSION_CACHE_MS = 1000;

// WTS connect states (WTS_CONNECTSTATE_CLASS): 0=Active, 1=Connected,
// 2=ConnectQuery, 3=Shadow, 4=Disconnected, 5=Idle, 6=Listen, 7=Reset,
// 8=Down, 9=Init. Only 0 (Active) means "this is the session currently
// driving the console/RDP display right now".
const WTS_CONNECTSTATE_ACTIVE = 0;

function parseWtsSessions(output) {
  return String(output || '')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => {
      const parts = line.split('|');
      if (parts.length < 8) return null;

      const sessionId = Number(parts[0]);
      const domainUser = parts[1].replace(/\\\|/g, '|');
      const protocol = Number(parts[2]);
      const sessionFlags = Number(parts[3]);
      const logonTime = Number(parts[4]);
      const lastInputTime = Number(parts[5]);
      const isConsole = parts[6] === '1';
      const connectState = Number(parts[7]);

      if (!Number.isFinite(sessionId) || !domainUser) return null;

      return {
        sessionId,
        domainUser,
        protocol,
        isRdp: protocol === WTS_RDP_PROTOCOL,
        isConsole: isConsole || protocol === 0,
        locked: sessionFlags === 0,
        sessionFlags,
        logonTime,
        lastInputTime,
        connectState,
        // Disconnected covers Fast User Switching (another user took the
        // console) as well as a dropped-but-not-logged-off RDP connection.
        disconnected: Number.isFinite(connectState) && connectState !== WTS_CONNECTSTATE_ACTIVE,
      };
    })
    .filter(Boolean);
}

function parseQuserSessions(output) {
  const sessions = [];

  for (const rawLine of String(output || '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || /^USERNAME\s+/i.test(line)) continue;

    const normalized = line.replace(/^>/, '').trim();
    const parts = normalized.split(/\s+/);
    if (parts.length < 4) continue;

    const username = parts[0];
    const sessionName = parts.length >= 5 ? parts[1] : '';
    const sessionIdIndex = sessionName ? 2 : 1;
    const sessionId = Number(parts[sessionIdIndex]);
    const state = String(parts[sessionIdIndex + 1] || '').toLowerCase();

    if (!username || !Number.isFinite(sessionId)) continue;
    if (!['active', 'disc', 'disconnected', 'idle'].includes(state)) continue;

    const isRdp = /^(rdp-tcp|rdp)/i.test(sessionName);
    const isConsole = !isRdp || /^console$/i.test(sessionName);

    sessions.push({
      sessionId,
      domainUser: username,
      protocol: isRdp ? WTS_RDP_PROTOCOL : 0,
      isRdp,
      isConsole,
      locked: false,
      sessionFlags: null,
      logonTime: 0,
      lastInputTime: 0,
      fallback: true,
      disconnected: state === 'disc' || state === 'disconnected',
    });
  }

  return sessions;
}

function parseSessionCommand(output) {
  const sessions = [];

  for (const rawLine of String(output || '').split(/\r?\n/)) {
    const line = rawLine.replace(/^\s*>?\s*/, '').trim();
    if (!line || /^(SESSIONNAME|USERNAME)\s+/i.test(line)) continue;

    const parts = line.split(/\s+/);
    const idIndex = parts.findIndex((part, index) => index > 0 && /^\d+$/.test(part));
    if (idIndex < 1 || !parts[idIndex + 1]) continue;

    const username = parts[0];
    const sessionName = idIndex > 1 ? parts[1] : '';
    const sessionId = Number(parts[idIndex]);
    const state = String(parts[idIndex + 1]).toLowerCase();

    if (!username || !Number.isFinite(sessionId)) continue;

    const isRdp = /^(rdp-tcp|rdp)/i.test(sessionName);
    sessions.push({
      sessionId,
      domainUser: username,
      protocol: isRdp ? WTS_RDP_PROTOCOL : 0,
      isRdp,
      isConsole: !isRdp || /^console$/i.test(sessionName),
      locked: false,
      sessionFlags: null,
      logonTime: 0,
      lastInputTime: 0,
      fallback: true,
      disconnected: /^(disc|disconnected|listen|down|init|reset)$/i.test(state),
    });
  }

  return sessions;
}

function parseExplorerSessions(output) {
  const sessions = [];

  for (const rawLine of String(output || '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    const parts = line.split('|');
    if (parts.length < 3) continue;

    const sessionId = Number(parts[0]);
    const domainUser = parts[1].trim();
    if (!Number.isFinite(sessionId) || !domainUser) continue;

    sessions.push({
      sessionId,
      domainUser,
      protocol: 0,
      isRdp: false,
      isConsole: true,
      locked: false,
      sessionFlags: null,
      logonTime: 0,
      lastInputTime: 0,
      fallback: true,
      disconnected: false,
    });
  }

  return sessions;
}

function getWindowsSessions() {
  if (process.platform !== 'win32') return [];

  const now = Date.now();
  if (now - cachedSessions.checkedAt < SESSION_CACHE_MS) return cachedSessions.sessions;

  let sessions = [];

  try {
    const output = execFileSync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', WTS_SCRIPT],
      {
        encoding: 'utf8',
        windowsHide: true,
        timeout: 5000,
        stdio: ['ignore', 'pipe', 'ignore'],
      }
    ).trim();

    sessions = parseWtsSessions(output);
  } catch (_) {
    sessions = [];
  }

  // The WTS helper is authoritative, but keep a native Windows fallback.
  // This prevents a transient WTS/PowerShell problem from making a valid
  // interactive user look logged out.
  if (sessions.length === 0) {
    try {
      const output = execFileSync('quser.exe', [], {
        encoding: 'utf8',
        windowsHide: true,
        timeout: 5000,
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      sessions = parseQuserSessions(output);
    } catch (_) {
      sessions = [];
    }
  }

  if (sessions.length === 0) {
    try {
      const output = execFileSync('query.exe', ['session'], {
        encoding: 'utf8',
        windowsHide: true,
        timeout: 5000,
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      sessions = parseSessionCommand(output);
    } catch (_) {
      sessions = [];
    }
  }

  // Final fallback: Explorer processes expose both the Windows session ID
  // and the interactive user's domain-qualified identity even when the agent
  // itself runs outside the user's desktop session.
  if (sessions.length === 0) {
    try {
      const output = execFileSync(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-ExecutionPolicy',
          'Bypass',
          '-Command',
          "$ErrorActionPreference='Stop'; Get-Process -Name explorer -IncludeUserName | ForEach-Object { \"$($_.SessionId)|$($_.UserName)\" }",
        ],
        {
          encoding: 'utf8',
          windowsHide: true,
          timeout: 5000,
          stdio: ['ignore', 'pipe', 'ignore'],
        }
      );
      sessions = parseExplorerSessions(output);
    } catch (_) {
      sessions = [];
    }
  }

  cachedSessions = { checkedAt: now, sessions };
  return sessions;
}

function chooseInteractiveSession(sessions) {
  if (!Array.isArray(sessions) || sessions.length === 0) return null;

  const unlockedConsole = sessions
    .filter(session => session.isConsole && !session.locked && !session.disconnected)
    .sort((a, b) => b.logonTime - a.logonTime)[0];
  if (unlockedConsole) return unlockedConsole;

  const unlockedRdp = sessions
    .filter(session => session.isRdp && !session.locked && !session.disconnected)
    .sort((a, b) => b.logonTime - a.logonTime)[0];
  if (unlockedRdp) return unlockedRdp;

  const lockedRdp = sessions
    .filter(session => session.isRdp && !session.disconnected)
    .sort((a, b) => b.logonTime - a.logonTime)[0];
  if (lockedRdp) return lockedRdp;

  return sessions
    .filter(session => !session.disconnected)
    .sort((a, b) => b.logonTime - a.logonTime)[0] || null;
}

function getActiveWindowsSession() {
  return chooseInteractiveSession(getWindowsSessions());
}

function run(command, args = []) {
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

function getCurrentProcessSession() {
  if (process.platform !== 'win32') return null;

  try {
    const output = run(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        '[Diagnostics.Process]::GetCurrentProcess().SessionId',
      ]
    );
    const sessionId = Number(output);
    return Number.isFinite(sessionId) ? sessionId : null;
  } catch (_) {
    return null;
  }
}

function getCurrentProcessDomainUser() {
  if (process.platform !== 'win32') return '';

  const username = String(process.env.USERNAME || '').trim();
  const domain = String(process.env.USERDOMAIN || '').trim();

  if (username && domain) return domain + '\\' + username;
  if (username) return username;

  try {
    return run('whoami.exe', []);
  } catch (_) {
    return '';
  }
}

function getIdentity() {
  const hostname = process.env.COMPUTERNAME || os.hostname();

  // The agent is launched from the Windows Startup folder, so this process
  // is already running inside the signed-in user's interactive session.
  // Do not require WTSEnumerateSessions to discover the current user.
  const processSessionId = getCurrentProcessSession();
  const processDomainUser = getCurrentProcessDomainUser();

  let interactive = null;
  if (processSessionId !== null) {
    interactive = getWindowsSessions().find(
      session => Number(session.sessionId) === Number(processSessionId)
    ) || null;
  }

  // WTS enumeration now returns this process's session row even when that
  // session has been disconnected (e.g. another user switched in on the same
  // physical console, or an RDP connection dropped), so `interactive` is only
  // ever null here when WTS genuinely could not be queried at all. In that
  // case, fall back to a usable record built from the process's own
  // environment — but never assume it is still the active/unlocked session,
  // since we have no way to verify that.
  if (!interactive && processDomainUser) {
    interactive = {
      sessionId: processSessionId,
      domainUser: processDomainUser,
      protocol: 0,
      isRdp: false,
      isConsole: true,
      locked: false,
      sessionFlags: null,
      logonTime: 0,
      lastInputTime: 0,
      disconnected: false,
      fallback: true,
    };
  }

  const domainUser = processDomainUser || interactive?.domainUser || '';
  const match = domainUser.match(/^([^\\]+)\\(.+)$/);
  const domain = match ? match[1] : null;
  const username = match ? match[2] : (domainUser || null);

  // Prefer the WTS record for the current process session when available.
  const sessionId = processSessionId ?? interactive?.sessionId ?? null;

  return {
    machineId: getMachineId(),
    hostname,
    domain,
    domainUser: domainUser || null,
    username,
    sessionId,
    sessionLocked: interactive?.locked === true,
    sessionDisconnected: interactive?.disconnected === true,
    isRdp: interactive?.isRdp === true,
    sessionName: interactive?.isRdp
      ? 'RDP-Tcp#' + sessionId
      : (interactive?.isConsole ? 'console' : null),
    ipAddress: getPrimaryIPv4() || null,
    operatingSystem: os.platform() + ' ' + os.release(),
    lastInputTime: interactive?.lastInputTime || null,
    sessionLogonTime: interactive?.logonTime || null,
  };
}

function fileTimeToUnixMs(fileTime) {
  if (!Number.isFinite(fileTime) || fileTime <= 0) return null;
  return Math.round(fileTime / 10000 - 11644473600000);
}

function getIdleSeconds() {
  if (process.platform !== 'win32') return 0;

  const identity = getIdentity();
  const session = identity.sessionId !== null
    ? getWindowsSessions().find(item => Number(item.sessionId) === Number(identity.sessionId))
    : null;
  if (!session?.lastInputTime) return 0;

  const lastInputMs = fileTimeToUnixMs(session.lastInputTime);
  if (!Number.isFinite(lastInputMs)) return 0;

  return Math.max(0, Math.round((Date.now() - lastInputMs) / 1000));
}

function getDeviceState() {
  const identity = getIdentity();
  const idleSeconds = getIdleSeconds();

  if (!identity.domainUser) return { ...identity, state: 'logged-out', idleSeconds };
  // This agent instance belongs to a Windows session that is no longer the
  // one driving the console/RDP display — e.g. a second user signed in on
  // the same device (Fast User Switching) or this RDP connection dropped.
  // Report it distinctly from 'locked' so monitoring for THIS user pauses
  // immediately rather than continuing to capture a background session.
  if (identity.sessionDisconnected) return { ...identity, state: 'disconnected', idleSeconds };
  if (identity.sessionLocked) return { ...identity, state: 'locked', idleSeconds };
  if (idleSeconds >= 300) return { ...identity, state: 'idle', idleSeconds };
  return { ...identity, state: 'active', idleSeconds };
}

module.exports = {
  getWindowsSessions,
  getActiveWindowsSession,
  getIdentity,
  getIdleSeconds,
  getDeviceState,
};
