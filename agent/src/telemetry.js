const os = require('node:os');
const { execFileSync } = require('node:child_process');

let lockStateCache = { expiresAt: 0, sessionId: null, locked: false, checked: false };

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

function getSessionRows() {
  if (process.platform !== 'win32') return [];

  const output = run('query.exe', ['session']);
  if (!output) return [];

  const rows = [];
  const lines = output.split(/\r?\n/).map(line => line.replace(/\r/g, '')).filter(Boolean);

  for (const rawLine of lines) {
    if (/^\s*SESSIONNAME\s+/i.test(rawLine)) continue;

    const line = rawLine.trim();
    const match = line.match(/^>?\s*(\S+)\s+(\S*)\s+(\d+)\s+(active|disc|disconnected|idle|listen|down|init)\b/i);
    if (!match) continue;

    const sessionName = match[1];
    const username = match[2] || '';
    const sessionId = Number(match[3]);
    const state = match[4].toLowerCase();

    if (!Number.isFinite(sessionId)) continue;

    rows.push({
      current: /^>/.test(rawLine),
      sessionName,
      username,
      sessionId,
      state,
    });
  }

  return rows;
}

function getActiveSession() {
  const sessions = getSessionRows();
  const active = sessions.filter(session =>
    session.state === 'active' &&
    session.username &&
    !isServiceIdentity(session.username)
  );

  if (!active.length) return null;

  // Prefer the session marked as current by Windows, then the first active user session.
  return active.find(session => session.current) || active[0];
}

function getLockedState(sessionId) {
  if (process.platform !== 'win32' || !Number.isFinite(Number(sessionId))) {
    return false;
  }

  const numericSessionId = Number(sessionId);
  const now = Date.now();

  if (
    lockStateCache.expiresAt > now &&
    lockStateCache.sessionId === numericSessionId
  ) {
    return lockStateCache.locked;
  }

  const script = `$events = @(Get-WinEvent -FilterHashtable @{ LogName = 'Security'; Id = @(4800,4801) } -MaxEvents 40 -ErrorAction Stop); foreach ($event in $events) { [xml]$xml = $event.ToXml(); $session = ($xml.Event.EventData.Data | Where-Object { $_.Name -eq 'SessionId' } | Select-Object -First 1).'#text'; if ($session) { Write-Output (\"$($event.Id)|$($event.TimeCreated.ToUniversalTime().ToString('o'))|$session\") } }`;
  const output = run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script]);

  let checked = false;
  let locked = false;

  if (output) {
    const events = output.split(/\r?\n/).map(line => line.trim()).filter(Boolean).map(line => {
      const [id, timestamp, eventSessionId] = line.split('|');
      return {
        id: Number(id),
        timestamp: new Date(timestamp).getTime(),
        sessionId: Number(eventSessionId),
      };
    }).filter(event =>
      Number.isFinite(event.timestamp) &&
      Number.isFinite(event.sessionId)
    );

    const sessionEvents = events
      .filter(event => event.sessionId === numericSessionId)
      .sort((a, b) => b.timestamp - a.timestamp);

    if (sessionEvents.length) {
      checked = true;
      locked = sessionEvents[0].id === 4800;
    }
  }

  // If lock auditing is unavailable for this session, LogonUI is a useful fallback
  // indicator that Windows is currently presenting the secure sign-in desktop.
  if (!checked) {
    const logonUi = run('tasklist.exe', ['/FI', 'IMAGENAME eq LogonUI.exe', '/FO', 'CSV', '/NH']);
    checked = true;
    locked = Boolean(logonUi && !/^INFO:/i.test(logonUi));
  }

  lockStateCache = {
    expiresAt: now + 5000,
    sessionId: numericSessionId,
    locked,
    checked,
  };

  return locked;
}

function getInteractiveUser() {
  if (process.platform !== 'win32') {
    try { return os.userInfo().username || ''; } catch (_) { return ''; }
  }

  const activeSession = getActiveSession();
  if (activeSession?.username) {
    const normalized = activeSession.username.trim();
    if (!isServiceIdentity(normalized)) return normalized;
  }

  const processUser = run('whoami.exe', []);
  if (processUser && !isServiceIdentity(processUser)) return processUser;

  const envUsername = String(process.env.USERNAME || '').trim();
  if (envUsername && !isServiceIdentity(envUsername)) {
    const envDomain = String(process.env.USERDOMAIN || '').trim();
    return envDomain ? `${envDomain}\\${envUsername}` : envUsername;
  }

  return '';
}

function getConnectionType() {
  if (process.platform !== 'win32') return { isRdp: false, sessionName: null };

  const activeSession = getActiveSession();
  const sessionName = activeSession?.sessionName || String(process.env.SESSIONNAME || '').trim() || null;
  const isRdp = /^RDP-Tcp#/i.test(sessionName || '');
  return { isRdp, sessionName };
}

function getIdentity() {
  const hostname = process.env.COMPUTERNAME || os.hostname();
  const interactiveUser = getInteractiveUser();
  const activeSession = getActiveSession();
  const connection = getConnectionType();
  const match = interactiveUser.match(/^([^\\]+)\\(.+)$/);
  const domain = match ? match[1] : null;
  const username = match ? match[2] : (interactiveUser || null);
  const domainUser = interactiveUser || null;
  const sessionId = activeSession?.sessionId ?? null;
  const sessionLocked = sessionId !== null ? getLockedState(sessionId) : false;

  return {
    machineId: getMachineId(),
    hostname,
    domain: sessionLocked ? null : domain,
    domainUser: sessionLocked ? null : domainUser,
    username: sessionLocked ? null : username,
    ipAddress: getPrimaryIPv4() || null,
    operatingSystem: `${os.platform()} ${os.release()}`,
    isRdp: connection.isRdp,
    sessionName: connection.sessionName,
    sessionId,
    sessionLocked,
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

  // A locked workstation is treated like offline/logged-out for monitoring.
  // The previous user's session remains logged in to Windows, but it is not the
  // interactive desktop and should not generate activity or screenshots.
  if (identity.sessionLocked) {
    return { ...identity, state: 'logged-out', idleSeconds };
  }

  if (!identity.domainUser) return { ...identity, state: 'logged-out', idleSeconds };
  if (idleSeconds >= 300) return { ...identity, state: 'idle', idleSeconds };
  return { ...identity, state: 'active', idleSeconds };
}

module.exports = { getIdentity, getIdleSeconds, getDeviceState };