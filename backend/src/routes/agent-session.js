import { Router } from 'express';
import { db, nextId } from '../db.js';
import { requireDevice } from '../auth.js';

export const agentSessionRouter = Router();

const DEVICE_OFFLINE_MS = 90 * 1000;
const allowedStates = new Set(['active', 'idle', 'logged-out']);

function userName(id) {
  const user = db.data.users.find(item => item.id === id);
  return user ? user.name : 'Unknown';
}

function resolveCurrentEmployee(domainUser) {
  const normalized = String(domainUser || '').trim().toLowerCase();
  if (!normalized) return null;
  const slash = normalized.lastIndexOf('\\');
  const username = slash >= 0 ? normalized.slice(slash + 1) : normalized;
  return db.data.users.find(user => {
    if (user.role !== 'Employee') return false;
    const emailLocal = String(user.email || '').split('@')[0].trim().toLowerCase();
    return emailLocal && emailLocal === username;
  }) || null;
}

function resolveDeviceState(device) {
  if (device.revoked) return 'revoked';
  if (!device.enrolled) return 'pending';
  if (!device.lastSeenAt) return 'offline';
  const lastSeen = new Date(device.lastSeenAt).getTime();
  if (Number.isNaN(lastSeen) || Date.now() - lastSeen > DEVICE_OFFLINE_MS) return 'offline';
  return device.state || 'active';
}

function closeCurrentSession(device, endedAt, reason = 'switched') {
  if (device.currentSessionId === null || device.currentSessionId === undefined) return;
  const current = (db.data.deviceSessions || []).find(session =>
    Number(session.deviceId) === Number(device.id) &&
    Number(session.sessionId) === Number(device.currentSessionId) &&
    !session.endedAt
  );
  if (current) {
    current.endedAt = endedAt;
    current.lastSeenAt = endedAt;
    current.status = reason;
  }
}

function recordStateChange(device, nextState, domainUser, employeeId, timestamp) {
  const previousState = device.state || 'offline';
  const previousDomainUser = device.domainUser || device.lastDomainUser || null;
  if (previousState === nextState && String(previousDomainUser || '').toLowerCase() === String(domainUser || '').toLowerCase()) return;
  db.data.deviceStateHistory = db.data.deviceStateHistory || [];
  db.data.deviceStateHistory.push({
    id: nextId(),
    deviceId: device.id,
    employeeId: employeeId || device.employeeId,
    domainUser: domainUser || null,
    from: previousState,
    to: nextState,
    timestamp,
  });
  device.state = nextState;
  device.lastStateChangedAt = timestamp;
}

function syncSession(device, telemetry, now) {
  db.data.deviceSessions = db.data.deviceSessions || [];

  const incomingSessionId = telemetry.sessionId === null || telemetry.sessionId === undefined
    ? null
    : Number(telemetry.sessionId);
  const incomingUser = telemetry.domainUser ? String(telemetry.domainUser).trim() : null;
  const previousSessionId = device.currentSessionId;
  const previousUser = device.domainUser || device.lastDomainUser || null;
  const sameSession = incomingSessionId !== null &&
    previousSessionId !== null &&
    previousSessionId !== undefined &&
    Number(previousSessionId) === incomingSessionId &&
    String(previousUser || '').toLowerCase() === String(incomingUser || '').toLowerCase();

  if (telemetry.sessionLocked && previousSessionId !== null && previousSessionId !== undefined) {
    const current = (db.data.deviceSessions || []).find(session =>
      Number(session.deviceId) === Number(device.id) &&
      Number(session.sessionId) === Number(previousSessionId) &&
      !session.endedAt
    );
    if (current) {
      current.lastSeenAt = now;
      current.status = 'locked';
    }
    device.currentSessionLocked = true;
    device.domainUser = null;
    device.currentEmployeeId = null;
    return;
  }

  if (!sameSession && (previousSessionId !== null && previousSessionId !== undefined)) {
    closeCurrentSession(device, now, 'switched');
  }

  if (incomingUser && incomingSessionId !== null) {
    let session = sameSession
      ? (db.data.deviceSessions || []).find(item =>
          Number(item.deviceId) === Number(device.id) &&
          Number(item.sessionId) === incomingSessionId &&
          !item.endedAt
        )
      : null;

    if (!session) {
      const employee = resolveCurrentEmployee(incomingUser);
      session = {
        id: nextId(),
        deviceId: device.id,
        employeeId: employee?.id || null,
        domainUser: incomingUser,
        sessionId: incomingSessionId,
        startedAt: now,
        lastSeenAt: now,
        endedAt: null,
        status: telemetry.state,
      };
      db.data.deviceSessions.push(session);
    } else {
      session.lastSeenAt = now;
      session.status = telemetry.state;
      session.endedAt = null;
    }

    device.currentSessionId = incomingSessionId;
    device.currentSessionStartedAt = session.startedAt;
    device.currentSessionLocked = false;
    device.lastDomainUser = incomingUser;
    device.domain = telemetry.domain ? String(telemetry.domain) : device.domain || null;
    device.currentEmployeeId = resolveCurrentEmployee(incomingUser)?.id || null;
    device.domainUser = incomingUser;
    return;
  }

  if (previousSessionId !== null && previousSessionId !== undefined) {
    closeCurrentSession(device, now, 'logged-out');
  }
  device.currentSessionId = null;
  device.currentSessionStartedAt = null;
  device.currentSessionLocked = false;
  device.currentEmployeeId = null;
  device.domainUser = null;
}

agentSessionRouter.post('/heartbeat', requireDevice(db), async (req, res) => {
  const body = req.body || {};
  const state = allowedStates.has(body.state) ? body.state : 'active';
  const now = new Date().toISOString();
  const telemetry = {
    state,
    domain: body.domain ? String(body.domain) : null,
    domainUser: body.domainUser ? String(body.domainUser) : null,
    sessionId: body.sessionId === null || body.sessionId === undefined || body.sessionId === '' ? null : Number(body.sessionId),
    sessionLocked: body.sessionLocked === true,
    isRdp: body.isRdp === true,
    sessionName: body.sessionName ? String(body.sessionName) : null,
  };

  if (body.hostname) req.device.hostname = String(body.hostname);
  if (body.machineId) req.device.machineId = String(body.machineId);
  if (body.ipAddress !== undefined) req.device.ipAddress = body.ipAddress ? String(body.ipAddress) : null;
  if (body.operatingSystem !== undefined) req.device.operatingSystem = body.operatingSystem ? String(body.operatingSystem) : null;
  if (body.agentVersion) req.device.agentVersion = String(body.agentVersion);
  req.device.isRdp = telemetry.isRdp;
  req.device.sessionName = telemetry.sessionName;
  req.device.lastSeenAt = now;

  const previousUser = req.device.domainUser || req.device.lastDomainUser || null;
  syncSession(req.device, telemetry, now);
  recordStateChange(req.device, state, req.device.domainUser || previousUser, req.device.currentEmployeeId, now);
  await db.write();

  res.json({
    ok: true,
    status: resolveDeviceState(req.device),
    currentEmployeeId: req.device.currentEmployeeId || null,
    currentEmployeeName: req.device.currentEmployeeId ? userName(req.device.currentEmployeeId) : null,
    domainUser: req.device.domainUser || null,
    lastDomainUser: req.device.lastDomainUser || null,
    sessionId: req.device.currentSessionId ?? null,
    sessionLocked: req.device.currentSessionLocked === true,
    isRdp: req.device.isRdp === true,
    connectionType: req.device.isRdp ? 'RDP' : (req.device.domainUser ? 'Local' : null),
    sessionName: req.device.sessionName || null,
    serverTime: now,
  });
});