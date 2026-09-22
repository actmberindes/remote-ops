import { Router } from 'express';
import { db } from '../db.js';
import { requireAuth, requireRole } from '../auth.js';

export const activityLiveLockRouter = Router();

const DEVICE_OFFLINE_MS = 90 * 1000;

function teamIdsOf(managerId) {
  return new Set(db.data.users.filter(u => u.managerId === managerId).map(u => u.id));
}

function userName(id) {
  const u = db.data.users.find(x => x.id === id);
  return u ? u.name : 'Unknown';
}

function deviceIsOnline(device) {
  if (!device || device.revoked || !device.enrolled || !device.lastSeenAt) return false;
  const ts = new Date(device.lastSeenAt).getTime();
  return !Number.isNaN(ts) && Date.now() - ts <= DEVICE_OFFLINE_MS;
}

function deviceState(device) {
  if (!device || device.revoked) return 'revoked';
  if (!device.enrolled) return 'pending';
  if (!deviceIsOnline(device)) return 'offline';
  if (device.sessionLocked === true) return 'locked';
  return device.state || 'active';
}

function deviceIsRdp(device) {
  return device?.isRdp === true || /^RDP-Tcp#/i.test(String(device?.sessionName || '').trim());
}

function deviceCanMonitor(device) {
  const state = deviceState(device);
  return ['active', 'idle'].includes(state) || (state === 'locked' && deviceIsRdp(device));
}

activityLiveLockRouter.get('/live-view', requireAuth(db), requireRole('Admin', 'Manager'), (req, res) => {
  const allowed = req.user.role === 'Admin'
    ? null
    : teamIdsOf(req.user.id);

  const eligible = db.data.devices
    .filter(device => device.employeeId && deviceIsOnline(device))
    .filter(device => deviceCanMonitor(device))
    .filter(device => !allowed || allowed.has(device.employeeId));

  const chosen = new Map();
  for (const device of eligible) {
    const existing = chosen.get(device.employeeId);
    if (!existing || new Date(device.lastSeenAt).getTime() > new Date(existing.lastSeenAt).getTime()) {
      chosen.set(device.employeeId, device);
    }
  }

  const result = [...chosen.values()].map(device => {
    const state = deviceState(device);
    const frame = db.data.liveFrames.find(f => f.deviceId === device.id);
    const emp = db.data.users.find(u => u.id === device.employeeId);
    return {
      employeeId: device.employeeId,
      employeeName: emp?.name || userName(device.employeeId),
      department: emp?.department || '',
      deviceId: device.id,
      deviceName: device.deviceName,
      hostname: device.hostname,
      domainUser: device.domainUser,
      deviceStatus: state,
      frameUrl: frame ? frame.url : null,
      capturedAt: frame ? frame.capturedAt : null,
      lastSeenAt: device.lastSeenAt,
      isRdp: deviceIsRdp(device),
      sessionName: device.sessionName || null,
      sessionLocked: device.sessionLocked === true,
      monitoringActive: deviceCanMonitor(device),
    };
  });

  res.json(result);
});
