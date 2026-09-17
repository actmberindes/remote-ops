const os = require('node:os');
const { execFileSync } = require('node:child_process');

const LOCK_STATE_CACHE_MS = 1000;
let lockStateCache = { value: false, checkedAt: 0 };
let lastInteractiveUser = '';

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

function normalizeInteractiveUser(value) {
  return String(value || '').trim().replace(/^>+/, '').trim();
}

function parseRows(output, format) {
  const rows = [];
  const lines = String(output || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean);

  for (const line of lines) {
    if (/^(USERNAME|SESSIONNAME)\s+/i.test(line)) continue;
    if (/No User exists|The command completed/i.test(line)) continue;

    const match = line.match(/^>?\s*(\S+)\s+(\S+)\s+(\d+)\s+(ACTIVE|DISC|DISCONNECTED)\b/i);
    if (!match) continue;

    // query user:    USERNAME SESSIONNAME ID STATE ...
    // query session: SESSIONNAME USERNAME ID STATE ...
    const username = normalizeInteractiveUser(format === 'session' ? match[2] : match[1]);
    if (!username || isServiceIdentity(username)) continue;

    rows.push({
      username,
      state: match[4].toUpperCase(),
      sessionId: Number(match[3]),
    });
  }

  return rows;
}

function qualifyUsername(username) {
  const normalized = normalizeInteractiveUser(username);
  if (!normalized) return '';
  if (/\\/.test(normalized)) return normalized;
  const domain = String(process.env.USERDOMAIN || '').trim();
  return domain ? `${domain}\\${normalized}` : normalized;
}

function getInteractiveUser() {
  if (process.platform !== 'win32') {
    try { return os.userInfo().username || ''; } catch (_) { return ''; }
  }

  // The agent runs as a Windows service. whoami.exe therefore identifies the
  // service account and is deliberately not used to determine the desktop user.
  // query session has the columns SESSIONNAME USERNAME ID STATE, so username
  // is the second column. Prefer the explicitly ACTIVE session.
  const sessionRows = parseRows(run('query.exe', ['session']), 'session');
  const activeSession = sessionRows.find(row => row.state === 'ACTIVE');
  if (activeSession) return qualifyUsername(activeSession.username);

  // query user has USERNAME SESSIONNAME ID STATE, so username is first.
  const userRows = parseRows(run('query.exe', ['user']), 'user');
  const activeUser = userRows.find(row => row.state === 'ACTIVE');
  if (activeUser) return qualifyUsername(activeUser.username);

  // Independent fallback for the current console user.
  const computerSystemUser = run('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    '(Get-CimInstance Win32_ComputerSystem).UserName',
  ]);
  if (computerSystemUser && !isServiceIdentity(computerSystemUser)) return computerSystemUser;

  return '';
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
    '/c:5',
    '/rd:true',
    '/f:text',
  ]);

  const eventIds = [...output.matchAll(/Event ID:\s*(4800|4801)/gi)].map(match => match[1]);
  if (eventIds.length > 0) return eventIds[0] === '4800';
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

  const securityLocked = getSecurityLockState();
  const locked = securityLocked !== null ? securityLocked : isLogonUiRunning();

  lockStateCache = { value: locked, checkedAt: now };
  return locked;
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
  const currentUser = String(identity.domainUser || '').trim().toLowerCase();
  const previousUser = lastInteractiveUser;

  // Fast User Switching can leave the previous user's 4800 lock event in the
  // Security log while the new user is already active. A detected change of
  // interactive user therefore resumes monitoring for the new session.
  const userChanged = Boolean(currentUser && previousUser && currentUser !== previousUser);
  lastInteractiveUser = currentUser;

  const sessionLocked = userChanged ? false : identity.sessionLocked;
  const stateIdentity = { ...identity, sessionLocked };

  if (!stateIdentity.domainUser) return { ...stateIdentity, state: 'logged-out', idleSeconds };
  if (sessionLocked) return { ...stateIdentity, state: 'locked', idleSeconds };
  if (idleSeconds >= 300) return { ...stateIdentity, state: 'idle', idleSeconds };
  return { ...stateIdentity, state: 'active', idleSeconds };
}

module.exports = { getIdentity, getIdleSeconds, getDeviceState, getWorkstationLocked };
