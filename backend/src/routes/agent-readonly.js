import { Router } from 'express';
import { db } from '../db.js';
import { requireAuth, requireRole } from '../auth.js';

export const agentReadonlyRouter = Router();

const access = [requireAuth(db), requireRole('Admin', 'Manager')];

function teamIdsOf(managerId) {
  return new Set(db.data.users.filter(u => u.managerId === managerId).map(u => u.id));
}

function allowedDevice(user, device) {
  if (user.role === 'Admin') return true;
  const team = teamIdsOf(user.id);
  return team.has(device.employeeId) || team.has(device.currentEmployeeId);
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
  const direct = device?.currentEmployeeId ? db.data.users.find(u => u.id === device.currentEmployeeId && u.role === 'Employee') : null;
  return direct || resolveCurrentEmployee(device?.domainUser);
}

function resolveDeviceState(device) {
  if (device.revoked) return 'revoked';
  if (!device.enrolled) return 'pending';
  if (!device.lastSeenAt) return 'offline';
  const lastSeen = new Date(device.lastSeenAt).getTime();
  if (Number.isNaN(lastSeen) || Date.now() - lastSeen > 90 * 1000) return 'offline';
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
    lastDomainUser: device.lastDomainUser || null,
    currentSessionId: device.currentSessionId ?? null,
    currentSessionLocked: device.currentSessionLocked === true,
    connectionType: device.isRdp ? 'RDP' : (device.domainUser ? 'Local' : null),
    isRdp: device.isRdp === true,
    sessionName: device.sessionName || null,
  };
}

function findDevice(req, res) {
  const id = Number(req.params.id);
  const device = db.data.devices.find(d => Number(d.id) === id);
  if (!device) {
    res.status(404).json({ error: 'Device not found.' });
    return null;
  }
  if (!allowedDevice(req.user, device)) {
    res.status(403).json({ error: 'You do not have access to this device.' });
    return null;
  }
  return device;
}

function sessionsForDevice(deviceId) {
  return (db.data.deviceSessions || [])
    .filter(session => Number(session.deviceId) === Number(deviceId))
    .sort((a, b) => new Date(b.startedAt || 0).getTime() - new Date(a.startedAt || 0).getTime())
    .slice(0, 200);
}

agentReadonlyRouter.get('/devices', ...access, (req, res) => {
  const items = db.data.devices.filter(d => allowedDevice(req.user, d)).map(publicDevice);
  res.json(items);
});

agentReadonlyRouter.get('/devices/:id/history', ...access, (req, res) => {
  const device = findDevice(req, res);
  if (!device) return;
  const history = (db.data.deviceStateHistory || [])
    .filter(h => Number(h.deviceId) === Number(device.id))
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, 5000)
    .map(item => ({ ...item, domainUser: item.domainUser || null }));
  res.json({ device: publicDevice(device), history, sessions: sessionsForDevice(device.id) });
});

agentReadonlyRouter.get('/devices/:id/details', ...access, (req, res) => {
  const device = findDevice(req, res);
  if (!device) return;
  const history = (db.data.deviceStateHistory || [])
    .filter(item => Number(item.deviceId) === Number(device.id))
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, 5000)
    .map(item => ({ ...item, domainUser: item.domainUser || null }));
  const screenshots = (db.data.screenshots || [])
    .filter(item => Number(item.deviceId) === Number(device.id))
    .sort((a, b) => new Date(b.capturedAt).getTime() - new Date(a.capturedAt).getTime())
    .slice(0, 1000)
    .map(item => ({ ...item, domainUser: item.domainUser || null }));
  const liveFrames = (db.data.liveFrameHistory || [])
    .filter(item => Number(item.deviceId) === Number(device.id))
    .sort((a, b) => new Date(b.capturedAt).getTime() - new Date(a.capturedAt).getTime())
    .slice(0, 500)
    .map(item => ({ ...item, domainUser: item.domainUser || null }));
  res.json({ device: publicDevice(device), history, sessions: sessionsForDevice(device.id), screenshots, liveFrames });
});