const os = require('node:os');
const { execFileSync } = require('node:child_process');

let lockStateCache = { expiresAt: 0, sessionId: null, locked: null, checked: false };

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

  const match = output.match(/MachineGuid\\s+REG_SZ\\s+(.+)/i);
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

function getWtsLockInfo(sessionId) {
  if (process.platform !== 'win32' || !Number.isFinite(Number(sessionId))) {
    return { locked: null, checked: false };
  }

  const numericSessionId = Number(sessionId);
  const now = Date.now();
  if (
    lockStateCache.expiresAt > now &&
    lockStateCache.sessionId === numericSessionId
  ) {
    return { locked: lockStateCache.locked, checked: lockStateCache.checked };
  }

  // Keep the PowerShell source as a plain string plus concatenation. This avoids
  // JavaScript template interpolation inside the embedded PowerShell script and
  // prevents runtime errors such as "$script is not defined" in packaged builds.
  const script = [
    "Add-Type -ErrorAction Stop -TypeDefinition @'",
    'using System;',
    'using System.Runtime.InteropServices;',
    '',
    'public enum WtsInfoClass { WTSSessionInfoEx = 25 }',
    '',
    '[StructLayout(LayoutKind.Sequential)]',
    'public struct WtsInfoExLevel1 {',
    '  public UInt32 SessionId;',
    '  public Int32 SessionState;',
    '  public Int32 SessionFlags;',
    '}',
    '',
    '[StructLayout(LayoutKind.Sequential)]',
    'public struct WtsInfoExLevel {',
    '  public WtsInfoExLevel1 Level1;',
    '}',
    '',
    '[StructLayout(LayoutKind.Sequential)]',
    'public struct WtsInfoEx {',
    '  public UInt32 Level;',
    '  public UInt32 Reserved;',
    '  public WtsInfoExLevel Data;',
    '}',
    '',
    'public static class WtsNative {',
    '  [DllImport("wtsapi32.dll", SetLastError = true)]',
    '  public static extern bool WTSQuerySessionInformationW(',
    '    IntPtr hServer,',
    '    UInt32 sessionId,',
    '    WtsInfoClass infoClass,',
    '    out IntPtr buffer,',
    '    out UInt32 bytesReturned);',
    '',
    '  [DllImport("wtsapi32.dll")]',
    '  public static extern void WTSFreeMemory(IntPtr buffer);',
    '}',
    "'@;",
    '$buffer = [IntPtr]::Zero;',
    '$bytes = 0;',
    '$ok = [WtsNative]::WTSQuerySessionInformationW([IntPtr]::Zero, ' + String(numericSessionId) + ', [WtsInfoClass]::WTSSessionInfoEx, [ref]$buffer, [ref]$bytes);',
    'if ($ok -and $buffer -ne [IntPtr]::Zero -and $bytes -ge 12) {',
    '  try {',
    '    $info = [Runtime.InteropServices.Marshal]::PtrToStructure($buffer, [type][WtsInfoEx]);',
    '    Write-Output ($info.Level.ToString() + "|" + $info.Data.Level1.SessionFlags.ToString() + "|" + $info.Data.Level1.SessionState.ToString());',
    '  } finally {',
    '    [WtsNative]::WTSFreeMemory($buffer);',
    '  }',
    '}',
  ].join('\n');

  const output = run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script]);
  let locked = null;
  let checked = false;

  if (output) {
    const [level, flags] = output.split('|').map(Number);
    if (level === 1 && Number.isFinite(flags)) {
      checked = flags === 0 || flags === 1;
      if (checked) locked = flags === 0;
    }
  }

  lockStateCache = {
    expiresAt: now + 3000,
    sessionId: numericSessionId,
    locked,
    checked,
  };

  return { locked, checked };
}

function getEventLockState(sessionId) {
  if (process.platform !== 'win32' || !Number.isFinite(Number(sessionId))) return null;

  const numericSessionId = Number(sessionId);
  const script = [
    "$events = @(Get-WinEvent -FilterHashtable @{ LogName = 'Security'; Id = @(4800,4801) } -MaxEvents 40 -ErrorAction Stop);",
    'foreach ($event in $events) {',
    '  [xml]$xml = $event.ToXml();',
    "  $session = ($xml.Event.EventData.Data | Where-Object { $_.Name -eq 'SessionId' } | Select-Object -First 1).'#text';",
    '  if ($session) {',
    '    Write-Output ($event.Id.ToString() + "|" + $event.TimeCreated.ToUniversalTime().ToString(\'o\') + "|" + $session);',
    '  }',
    '}',
  ].join('\n');

  const output = run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script]);
  if (!output) return null;

  const events = output.split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => {
      const [id, timestamp, eventSessionId] = line.split('|');
      return {
        id: Number(id),
        timestamp: new Date(timestamp).getTime(),
        sessionId: Number(eventSessionId),
      };
    })
    .filter(event =>
      Number.isFinite(event.timestamp) &&
      Number.isFinite(event.sessionId) &&
      event.sessionId === numericSessionId
    )
    .sort((a, b) => b.timestamp - a.timestamp);

  if (!events.length) return null;
  return events[0].id === 4800;
}

function getActiveSession() {
  const sessions = getSessionRows().filter(session =>
    session.state === 'active' &&
    session.username &&
    !isServiceIdentity(session.username)
  );

  if (!sessions.length) return null;

  const enriched = sessions.map(session => ({
    ...session,
    lockInfo: getWtsLockInfo(session.sessionId),
  }));

  // Prefer an active + unlocked user session. This prevents a locked session
  // from being selected while another interactive session is available.
  const unlocked = enriched.filter(session => session.lockInfo.locked === false);
  const candidates = unlocked.length ? unlocked : enriched;
  return candidates.find(session => session.current) || candidates[0] || null;
}

function qualifyInteractiveUser(username) {
  const normalized = String(username || '').trim();
  if (!normalized) return '';
  if (normalized.includes('\\')) return normalized;

  const systemUser = run('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    '(Get-CimInstance Win32_ComputerSystem -ErrorAction SilentlyContinue).UserName',
  ]);

  if (systemUser && /\\/.test(systemUser)) {
    const systemUsername = systemUser.split('\\').pop().trim().toLowerCase();
    if (systemUsername === normalized.toLowerCase()) return systemUser;
  }

  return normalized;
}

function getInteractiveUser(activeSession) {
  if (process.platform !== 'win32') {
    try { return os.userInfo().username || ''; } catch (_) { return ''; }
  }

  if (activeSession?.username) {
    const normalized = activeSession.username.trim();
    if (!isServiceIdentity(normalized)) return qualifyInteractiveUser(normalized);
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

function getConnectionType(activeSession) {
  if (process.platform !== 'win32') return { isRdp: false, sessionName: null };

  const sessionName = activeSession?.sessionName || String(process.env.SESSIONNAME || '').trim() || null;
  const isRdp = /^RDP-Tcp#/i.test(sessionName || '');
  return { isRdp, sessionName };
}

function getIdentity() {
  const hostname = process.env.COMPUTERNAME || os.hostname();
  const activeSession = getActiveSession();
  const interactiveUser = getInteractiveUser(activeSession);
  const connection = getConnectionType(activeSession);
  const match = interactiveUser.match(/^([^\\]+)\\(.+)$/);
  const domain = match ? match[1] : null;
  const username = match ? match[2] : (interactiveUser || null);
  const domainUser = interactiveUser || null;
  const sessionId = activeSession?.sessionId ?? null;

  let sessionLocked = Boolean(activeSession?.lockInfo?.locked);
  if (activeSession && activeSession.lockInfo.checked !== true) {
    const eventState = getEventLockState(sessionId);
    if (eventState !== null) sessionLocked = eventState;
    else {
      const logonUi = run('tasklist.exe', ['/FI', 'IMAGENAME eq LogonUI.exe', '/FO', 'CSV', '/NH']);
      sessionLocked = Boolean(logonUi && !/^INFO:/i.test(logonUi));
    }
  }

  return {
    machineId: getMachineId(),
    hostname,
    domain,
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

  const script = [
    'Add-Type @"',
    'using System;',
    'using System.Runtime.InteropServices;',
    'public static class IdleNative {',
    '  [StructLayout(LayoutKind.Sequential)] public struct LASTINPUTINFO { public uint cbSize; public uint dwTime; }',
    '  [DllImport("user32.dll")] public static extern bool GetLastInputInfo(ref LASTINPUTINFO plii);',
    '  [DllImport("kernel32.dll")] public static extern uint GetTickCount();',
    '}',
    '"@;',
    '$info = New-Object IdleNative+LASTINPUTINFO;',
    '$info.cbSize = [Runtime.InteropServices.Marshal]::SizeOf($info);',
    'if([IdleNative]::GetLastInputInfo([ref]$info)){ [math]::Round((([IdleNative]::GetTickCount() - $info.dwTime) / 1000), 0) }',
  ].join('\n');

  const output = run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script]);
  const value = Number(output);
  return Number.isFinite(value) ? value : 0;
}

function getDeviceState() {
  const identity = getIdentity();
  const idleSeconds = getIdleSeconds();

  if (identity.sessionLocked) {
    return { ...identity, state: 'logged-out', idleSeconds };
  }

  if (!identity.domainUser) return { ...identity, state: 'logged-out', idleSeconds };
  if (idleSeconds >= 300) return { ...identity, state: 'idle', idleSeconds };
  return { ...identity, state: 'active', idleSeconds };
}

module.exports = { getIdentity, getIdleSeconds, getDeviceState };