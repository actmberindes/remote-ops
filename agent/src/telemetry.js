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
      if (!WTSQuerySessionInformationW(IntPtr.Zero, sessionId, WTSClientProtocolType, out p, out bytes) || p == IntPtr.Zero) return -1;
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

  public static string GetJson() {
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

        if (row.State != 0) continue;

        string user = QueryString(row.SessionId, WTSUserName).Trim();
        if (String.IsNullOrWhiteSpace(user)) continue;

        string domain = QueryString(row.SessionId, WTSDomainName).Trim();
        string domainUser = String.IsNullOrWhiteSpace(domain) ? user : domain + "\\" + user;
        int protocol = QueryProtocol(row.SessionId);
        var info = QueryInfoEx(row.SessionId);

        rows.Add(
          row.SessionId.ToString() + "|" +
          Escape(domainUser) + "|" +
          protocol.ToString() + "|" +
          info.SessionFlags.ToString() + "|" +
          info.LogonTime.ToString() + "|" +
          info.LastInputTime.ToString() + "|" +
          (row.SessionId == consoleSessionId ? "1" : "0")
        );
      }

      return String.Join("\\n", rows);
    } finally {
      if (p != IntPtr.Zero) WTSFreeMemory(p);
    }
  }
}
"@
[RemoteOpsWts]::GetJson()

`;

let cachedSessions = { checkedAt: 0, sessions: [] };
const SESSION_CACHE_MS = 1000;

function getWindowsSessions() {
  if (process.platform !== 'win32') return [];

  const now = Date.now();
  if (now - cachedSessions.checkedAt < SESSION_CACHE_MS) return cachedSessions.sessions;

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

    const sessions = String(output || '')
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(Boolean)
      .map(line => {
        const parts = line.split('|');
        if (parts.length < 7) return null;

        const sessionId = Number(parts[0]);
        const domainUser = parts[1].replace(/\\\|/g, '|');
        const protocol = Number(parts[2]);
        const sessionFlags = Number(parts[3]);
        const logonTime = Number(parts[4]);
        const lastInputTime = Number(parts[5]);
        const isConsole = parts[6] === '1';

        if (!Number.isFinite(sessionId) || !domainUser) return null;

        return {
          sessionId,
          domainUser,
          protocol,
          isRdp: protocol === WTS_RDP_PROTOCOL,
          isConsole: isConsole || protocol === 0,
          locked: sessionFlags === WTS_SESSIONSTATE_LOCK,
          sessionFlags,
          logonTime,
          lastInputTime,
        };
      })
      .filter(Boolean);

    cachedSessions = { checkedAt: now, sessions };
    return sessions;
  } catch (_) {
    return [];
  }
}

function chooseInteractiveSession(sessions) {
  if (!Array.isArray(sessions) || sessions.length === 0) return null;

  const unlockedConsole = sessions
    .filter(session => session.isConsole && !session.locked)
    .sort((a, b) => b.logonTime - a.logonTime)[0];
  if (unlockedConsole) return unlockedConsole;

  const unlockedRdp = sessions
    .filter(session => session.isRdp && !session.locked)
    .sort((a, b) => b.logonTime - a.logonTime)[0];
  if (unlockedRdp) return unlockedRdp;

  const lockedRdp = sessions
    .filter(session => session.isRdp)
    .sort((a, b) => b.logonTime - a.logonTime)[0];
  if (lockedRdp) return lockedRdp;

  return sessions.sort((a, b) => b.logonTime - a.logonTime)[0] || null;
}

function getActiveWindowsSession() {
  return chooseInteractiveSession(getWindowsSessions());
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

function getIdentity() {
  const hostname = process.env.COMPUTERNAME || os.hostname();
  const interactive = getActiveWindowsSession();
  const domainUser = interactive?.domainUser || '';
  const match = domainUser.match(/^([^\\]+)\\(.+)$/);
  const domain = match ? match[1] : null;
  const username = match ? match[2] : (domainUser || null);

  return {
    machineId: getMachineId(),
    hostname,
    domain,
    domainUser: domainUser || null,
    username,
    sessionId: interactive?.sessionId ?? null,
    sessionLocked: interactive?.locked === true,
    isRdp: interactive?.isRdp === true,
    sessionName: interactive?.isRdp
      ? 'RDP-Tcp#' + interactive.sessionId
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

  const session = getActiveWindowsSession();
  if (!session?.lastInputTime) return 0;

  const lastInputMs = fileTimeToUnixMs(session.lastInputTime);
  if (!Number.isFinite(lastInputMs)) return 0;

  return Math.max(0, Math.round((Date.now() - lastInputMs) / 1000));
}

function getDeviceState() {
  const identity = getIdentity();
  const idleSeconds = getIdleSeconds();

  if (!identity.domainUser) return { ...identity, state: 'logged-out', idleSeconds };
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
