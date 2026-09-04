import { Router } from 'express';
import crypto from 'node:crypto';
import { db, nextId } from '../db.js';
import { requireAuth, requireRole, requireDevice, signDeviceToken } from '../auth.js';

export const agentRouter = Router();

const VALID_INTERVALS = [5, 10, 30];
const DEVICE_OFFLINE_MS = 90 * 1000;
const ENROLLMENT_TTL_MS = 30 * 60 * 1000;

function generateEnrollmentCode() {
  return crypto.randomInt(10000000, 100000000).toString();
}

function userName(id) {
  const u = db.data.users.find(x => x.id === id);
  return u ? u.name : 'Unknown';
}

function resolveCurrentEmployee(domainUser) {
  const normalized = String(domainUser || '').trim().toLowerCase();
  if (!normalized) return null;

  const slash = normalized.lastIndexOf('\\');
  const username = slash >= 0 ? normalized.slice(slash + 1) : normalized;

  return db.data.users.find(u => {
    if (u.role !== 'Employee') return false;
    const emailLocal = String(u.email || '').split('@')[0].trim().toLowerCase();
    return emailLocal && emailLocal === username;
  }) || null;
}

function currentEmployee(device) {
  const direct = device?.currentEmployeeId
    ? db.data.users.find(u => u.id === device.currentEmployeeId && u.role === 'Employee')
    : null;
  if (direct) return direct;
  return resolveCurrentEmployee(device?.domainUser);
}

function resolveDeviceState(device) {
  if (device.revoked) return 'revoked';
  if (!device.enrolled) return 'pending';
  if (!device.lastSeenAt) return 'offline';

  const lastSeen = new Date(device.lastSeenAt).getTime();
  if (Number.isNaN(lastSeen) || Date.now() - lastSeen > DEVICE_OFFLINE_MS) return 'offline';

  return device.state || 'active';
}

function publicDevice(device) {
  const { enrollmentCode, enrollmentExpiresAt, ...safe } = device;
  const current = currentEmployee(device);
  return {
    ...safe,
    status: resolveDeviceState(device),
    employeeName: current?.name || userName(device.employeeId),
    registeredEmployeeName: userName(device.employeeId),
    currentEmployeeId: current?.id || null,
    currentEmployeeName: current?.name || null,
    currentDomainUser: device.domainUser || null,
    connectionType: device.isRdp ? 'RDP' : (device.domainUser ? 'Local' : null),
    isRdp: device.isRdp === true,
    sessionName: device.sessionName || null,
  };
}

function recordStateChange(device, nextState, timestamp = new Date().toISOString()) {
  const previousState = device.state || 'offline';
  if (previousState === nextState) return;
  db.data.deviceStateHistory = db.data.deviceStateHistory || [];
  db.data.deviceStateHistory.push({
    id: nextId(),
    deviceId: device.id,
    employeeId: device.currentEmployeeId || device.employeeId,
    from: previousState,
    to: nextState,
    timestamp,
  });
  device.state = nextState;
  device.lastStateChangedAt = timestamp;
}

agentRouter.post('/devices/register', requireAuth(db), requireRole('Admin'), async (req, res) => {
  const { employeeId, deviceName, deviceType = 'desktop-agent' } = req.body || {};
  const employee = db.data.users.find(u => u.id === Number(employeeId) && u.role === 'Employee');

  if (!employee) return res.status(400).json({ error: 'A valid Employee must be selected.' });
  if (!deviceName || !String(deviceName).trim()) return res.status(400).json({ error: 'deviceName is required.' });
  if (!['desktop-agent', 'browser-extension'].includes(deviceType)) {
    return res.status(400).json({ error: 'deviceType must be desktop-agent or browser-extension.' });
  }

  const device = {
    id: nextId(), employeeId: employee.id, type: deviceType, deviceName: String(deviceName).trim(),
    pairedAt: null, registeredAt: new Date().toISOString(), enrolledAt: null,
    enrollmentCode: generateEnrollmentCode(), enrollmentExpiresAt: Date.now() + ENROLLMENT_TTL_MS,
    machineId: null, hostname: null, domain: null, domainUser: null, agentVersion: null,
    currentEmployeeId: null, currentSessionStartedAt: null,
    isRdp: false, sessionName: null,
    lastSeenAt: null, lastStateChangedAt: null, state: 'pending', enrolled: false, revoked: false,
  };

  db.data.devices.push(device);
  await db.write();
  res.status(201).json({ ...publicDevice(device), enrollmentCode: device.enrollmentCode, enrollmentExpiresAt: new Date(device.enrollmentExpiresAt).toISOString() });
});

agentRouter.post('/enroll', async (req, res) => {
  const { code, machineId, hostname, domain, domainUser, isRdp = false, sessionName = null, deviceType = 'desktop-agent', agentVersion = null } = req.body || {};
  if (!code) return res.status(400).json({ error: 'Enrollment code is required.' });
  if (!machineId) return res.status(400).json({ error: 'machineId is required.' });
  if (!hostname) return res.status(400).json({ error: 'hostname is required.' });

  const device = db.data.devices.find(d => String(d.enrollmentCode || '') === String(code).trim() && !d.revoked && d.enrolled !== true);
  if (!device) return res.status(404).json({ error: 'Invalid or already-used enrollment code.' });
  if (!device.enrollmentExpiresAt || device.enrollmentExpiresAt < Date.now()) return res.status(410).json({ error: 'This enrollment code has expired. Ask an Admin to register the device again.' });
  if (device.type !== deviceType) return res.status(400).json({ error: `This enrollment code is for a ${device.type} device.` });

  const existing = db.data.devices.find(d => d.id !== device.id && d.machineId && d.machineId === machineId && !d.revoked);
  if (existing) return res.status(409).json({ error: 'This computer is already enrolled as another managed device.' });

  const now = new Date().toISOString();
  const resolvedEmployee = resolveCurrentEmployee(domainUser);
  device.enrolled = true; device.enrolledAt = now; device.pairedAt = now;
  device.enrollmentCode = null; device.enrollmentExpiresAt = null;
  device.machineId = String(machineId); device.hostname = String(hostname);
  device.domain = domain ? String(domain) : null; device.domainUser = domainUser ? String(domainUser) : null;
  device.currentEmployeeId = resolvedEmployee?.id || device.employeeId;
  device.currentSessionStartedAt = now;
  device.isRdp = Boolean(isRdp);
  device.sessionName = sessionName ? String(sessionName) : null;
  device.agentVersion = agentVersion ? String(agentVersion) : null; device.lastSeenAt = now;
  recordStateChange(device, 'active', now);

  await db.write();
  const deviceToken = signDeviceToken(device);
  res.status(201).json({ deviceToken, deviceId: device.id, employeeId: device.employeeId, employeeName: userName(device.employeeId) });
});

agentRouter.post('/pairing-code', requireAuth(db), requireRole('Admin'), async (req, res) => {
  return res.status(410).json({ error: 'Employee pairing has been retired. Admins must register devices from Device Management.' });
});

agentRouter.post('/pair', (req, res) => {
  return res.status(410).json({ error: 'Employee pairing has been retired. Use an Admin-generated device enrollment code.' });
});

agentRouter.get('/config', requireDevice(db), (req, res) => {
  res.json(db.data.agentConfig);
});

agentRouter.get('/session-status', requireDevice(db), (req, res) => {
  const current = currentEmployee(req.device);
  res.json({
    status: resolveDeviceState(req.device),
    employeeName: current?.name || userName(req.device.employeeId),
    currentEmployeeId: current?.id || null,
    domainUser: req.device.domainUser || null,
    deviceName: req.device.deviceName,
    isRdp: req.device.isRdp === true,
    connectionType: req.device.isRdp ? 'RDP' : (req.device.domainUser ? 'Local' : null),
    sessionName: req.device.sessionName || null,
  });
});

agentRouter.post('/heartbeat', requireDevice(db), async (req, res) => {
  const { state = 'active', hostname, machineId, domain, domainUser, isRdp, sessionName, agentVersion } = req.body || {};
  const allowedStates = new Set(['active', 'idle', 'logged-out']);
  const nextState = allowedStates.has(state) ? state : 'active';
  const now = new Date().toISOString();
  const previousDomainUser = String(req.device.domainUser || '').trim().toLowerCase();
  const previousRdp = req.device.isRdp === true;

  if (hostname) req.device.hostname = String(hostname);
  if (machineId) req.device.machineId = String(machineId);
  if (domain !== undefined) req.device.domain = domain ? String(domain) : null;
  if (domainUser !== undefined) req.device.domainUser = domainUser ? String(domainUser) : null;
  if (isRdp !== undefined) req.device.isRdp = Boolean(isRdp);
  if (sessionName !== undefined) req.device.sessionName = sessionName ? String(sessionName) : null;
  if (agentVersion) req.device.agentVersion = String(agentVersion);

  const nextDomainUser = String(req.device.domainUser || '').trim().toLowerCase();
  const resolvedEmployee = resolveCurrentEmployee(req.device.domainUser);
  const nextEmployeeId = resolvedEmployee?.id || null;

  if (nextDomainUser !== previousDomainUser || req.device.currentEmployeeId !== nextEmployeeId || previousRdp !== req.device.isRdp) {
    req.device.currentEmployeeId = nextEmployeeId;
    req.device.currentSessionStartedAt = nextEmployeeId ? now : null;
  }

  if (nextState === 'logged-out') {
    req.device.currentEmployeeId = null;
    req.device.currentSessionStartedAt = null;
  }

  req.device.lastSeenAt = now;
  recordStateChange(req.device, nextState, now);
  await db.write();
  res.json({
    ok: true,
    status: resolveDeviceState(req.device),
    currentEmployeeId: req.device.currentEmployeeId,
    currentEmployeeName: req.device.currentEmployeeId ? userName(req.device.currentEmployeeId) : null,
    domainUser: req.device.domainUser || null,
    isRdp: req.device.isRdp === true,
    connectionType: req.device.isRdp ? 'RDP' : (req.device.domainUser ? 'Local' : null),
    sessionName: req.device.sessionName || null,
    serverTime: now,
  });
});

agentRouter.post('/quit-authorize', requireDevice(db), async (req, res) => {
  const configured = String(process.env.AGENT_ADMIN_QUIT_CODE || '').trim();
  const supplied = String(req.body?.code || '').trim();

  if (!configured) return res.status(503).json({ error: 'Administrator quit code is not configured on the server.' });
  if (!supplied || supplied.length > 128) return res.status(400).json({ error: 'Administrator code is required.' });

  const sameLength = configured.length === supplied.length;
  const matches = sameLength && crypto.timingSafeEqual(Buffer.from(configured), Buffer.from(supplied));
  if (!matches) return res.status(403).json({ error: 'Invalid administrator code.' });

  const now = new Date().toISOString();
  req.device.currentEmployeeId = null;
  req.device.currentSessionStartedAt = null;
  recordStateChange(req.device, 'offline', now);
  req.device.lastSeenAt = now;
  await db.write();

  res.json({ ok: true, authorized: true, status: 'offline', serverTime: now });
});

agentRouter.get('/config-admin', requireAuth(db), requireRole('Admin'), (req, res) => res.json(db.data.agentConfig));

agentRouter.put('/config', requireAuth(db), requireRole('Admin'), async (req, res) => {
  const { screenshotIntervalMinutes, liveViewFrameIntervalSeconds, screenshotRetentionDays, liveViewRetentionDays, webUsageRetentionDays } = req.body || {};
  if (screenshotIntervalMinutes !== undefined) {
    if (!VALID_INTERVALS.includes(Number(screenshotIntervalMinutes))) return res.status(400).json({ error: `screenshotIntervalMinutes must be one of ${VALID_INTERVALS.join(', ')}.` });
    db.data.agentConfig.screenshotIntervalMinutes = Number(screenshotIntervalMinutes);
  }
  if (liveViewFrameIntervalSeconds !== undefined) {
    const v = Number(liveViewFrameIntervalSeconds); if (!(v >= 2 && v <= 60)) return res.status(400).json({ error: 'liveViewFrameIntervalSeconds must be between 2 and 60.' });
    db.data.agentConfig.liveViewFrameIntervalSeconds = v;
  }
  if (screenshotRetentionDays !== undefined) {
    const v = Number(screenshotRetentionDays); if (!(v >= 1 && v <= 365)) return res.status(400).json({ error: 'screenshotRetentionDays must be between 1 and 365.' });
    db.data.agentConfig.screenshotRetentionDays = v;
  }
  if (liveViewRetentionDays !== undefined) {
    const v = Number(liveViewRetentionDays); if (!(v >= 1 && v <= 365)) return res.status(400).json({ error: 'liveViewRetentionDays must be between 1 and 365.' });
    db.data.agentConfig.liveViewRetentionDays = v;
  }
  if (webUsageRetentionDays !== undefined) {
    const v = Number(webUsageRetentionDays); if (!(v >= 1 && v <= 365)) return res.status(400).json({ error: 'webUsageRetentionDays must be between 1 and 365.' });
    db.data.agentConfig.webUsageRetentionDays = v;
  }
  await db.write(); res.json(db.data.agentConfig);
});

agentRouter.get('/my-devices', requireAuth(db), async (req, res) => res.json(db.data.devices.filter(d => d.employeeId === req.user.id).map(publicDevice)));
agentRouter.get('/devices', requireAuth(db), requireRole('Admin'), (req, res) => res.json(db.data.devices.map(publicDevice)));

agentRouter.get('/devices/:id/history', requireAuth(db), requireRole('Admin'), (req, res) => {
  const id = Number(req.params.id); const device = db.data.devices.find(d => d.id === id);
  if (!device) return res.status(404).json({ error: 'Device not found.' });
  const history = (db.data.deviceStateHistory || []).filter(h => h.deviceId === id).sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1)).slice(0, 500);
  res.json({ device: publicDevice(device), history });
});

agentRouter.patch('/devices/:id/revoke', requireAuth(db), requireRole('Admin'), async (req, res) => {
  const id = Number(req.params.id); const device = db.data.devices.find(d => d.id === id);
  if (!device) return res.status(404).json({ error: 'Device not found.' });
  const now = new Date().toISOString(); device.revoked = true; device.currentEmployeeId = null; recordStateChange(device, 'revoked', now);
  await db.write(); res.json(publicDevice(device));
});

agentRouter.delete('/devices/:id', requireAuth(db), requireRole('Admin'), async (req, res) => {
  const id = Number(req.params.id); const index = db.data.devices.findIndex(d => d.id === id);
  if (index === -1) return res.status(404).json({ error: 'Device not found.' });
  db.data.deviceStateHistory = (db.data.deviceStateHistory || []).filter(h => h.deviceId !== id);
  db.data.devices.splice(index, 1); await db.write(); res.json({ ok: true, deviceId: id });
});
