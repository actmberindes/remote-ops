const os = require('node:os');
const { execFileSync } = require('node:child_process');
const { getActiveWindowsSession } = require('./windows-session');

const LOCK_STATE_CACHE_MS = 1000;
let lockStateCache = { value: false, checkedAt: 0, sessionId: null };

function run(command, args) {
  try { return execFileSync(command, args, { encoding: 'utf8', windowsHide: true, timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
  catch (_) { return ''; }
}

function getMachineId() {
  if (process.platform !== 'win32') return os.hostname();
  const output = run('reg.exe', ['query', 'HKLM\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid']);
  const match = output.match(/MachineGuid\s+REG_SZ\s+(.+)/i);
  return match ? match[1].trim() : os.hostname();
}

function getPrimaryIPv4() {
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries || []) if (entry.family === 'IPv4' && !entry.internal && entry.address) return entry.address;
  }
  return '';
}

function getConnectionType() {
  if (process.platform !== 'win32') return { isRdp: false, sessionName: null };
  const sessionName = String(process.env.SESSIONNAME || '').trim() || null;
  return { isRdp: /^RDP-Tcp#/i.test(sessionName || ''), sessionName };
}

function getSecurityLockState(currentSessionId) {
  const output = run('wevtutil.exe', ['qe', 'Security', '/q:*[System[(EventID=4800 or EventID=4801)]]', '/c:1', '/rd:true', '/f:text']);
  const event = output.match(/Event ID:\s*(4800|4801)/i);
  if (!event) return null;
  const session = output.match(/Session ID:\s*(\d+)/i);
  const eventSessionId = session ? Number(session[1]) : null;
  if (eventSessionId !== null && currentSessionId !== null && eventSessionId !== currentSessionId) return false;
  return event[1] === '4800';
}

function isLogonUiRunning() {
  const output = run('tasklist.exe', ['/FI', 'IMAGENAME eq LogonUI.exe', '/NH']);
  return /(?:^|\s)LogonUI\.exe\s+/i.test(output);
}

function getWorkstationLocked(currentSessionId) {
  if (process.platform !== 'win32') return false;
  const now = Date.now();
  if (now - lockStateCache.checkedAt < LOCK_STATE_CACHE_MS && lockStateCache.sessionId === currentSessionId) return lockStateCache.value;
  const securityLocked = getSecurityLockState(currentSessionId);
  const locked = securityLocked !== null ? securityLocked : (currentSessionId === null ? isLogonUiRunning() : false);
  lockStateCache = { value: locked, checkedAt: now, sessionId: currentSessionId };
  return locked;
}

function getIdentity() {
  const hostname = process.env.COMPUTERNAME || os.hostname();
  const interactive = getActiveWindowsSession();
  const connection = getConnectionType();
  const match = String(interactive.domainUser || '').match(/^([^\\]+)\\(.+)$/);
  return {
    machineId: getMachineId(), hostname,
    domain: match ? match[1] : null,
    domainUser: interactive.domainUser || null,
    username: match ? match[2] : (interactive.domainUser || null),
    sessionId: interactive.sessionId,
    ipAddress: getPrimaryIPv4() || null,
    operatingSystem: `${os.platform()} ${os.release()}`,
    isRdp: connection.isRdp, sessionName: connection.sessionName,
    sessionLocked: getWorkstationLocked(interactive.sessionId),
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
