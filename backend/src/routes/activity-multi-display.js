import { Router } from 'express';
import { db, nextId } from '../db.js';
import { requireAuth, requireRole, requireDevice } from '../auth.js';
import { purgeOldActivity } from './activity.js';

export const multiDisplayActivityRouter = Router();

const DEVICE_OFFLINE_MS = 90 * 1000;

function teamIdsOf(managerId) {
  return new Set(db.data.users.filter(u => u.managerId === managerId).map(u => u.id));
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

function currentEmployeeForDevice(device) {
  const direct = device?.currentEmployeeId
    ? db.data.users.find(u => u.id === device.currentEmployeeId && u.role === 'Employee')
    : null;
  return direct || resolveCurrentEmployee(device?.domainUser);
}

function currentEmployeeIdForDevice(device) {
  return currentEmployeeForDevice(device)?.id || null;
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
  return device.state || 'active';
}

function displayKey(frame = {}) {
  if (frame.displayId !== undefined && frame.displayId !== null && frame.displayId !== '') return String(frame.displayId);
  return `display-${Number(frame.displayIndex) || 1}`;
}

function hasPhysicalWindowsDisplayId(frame = {}) {
  const id = String(frame.displayId || '').trim();
  return /^\\\\\.\\DISPLAY\d+$/i.test(id);
}

function filterLegacyFrames(frames) {
  const physical = frames.filter(hasPhysicalWindowsDisplayId);
  if (physical.length > 0) return physical;
  return frames.filter(frame => frame.displayId !== undefined && frame.displayId !== null && frame.displayId !== '');
}

function displaySort(a, b) {
  const ai = Number(a.displayIndex) || 1;
  const bi = Number(b.displayIndex) || 1;
  if (ai !== bi) return ai - bi;
  return String(a.displayName || '').localeCompare(String(b.displayName || ''));
}

function latestFramesForDevice(deviceId) {
  const frames = filterLegacyFrames((db.data.liveFrames || []).filter(frame => frame.deviceId === deviceId));
  const latest = new Map();
  for (const frame of frames) {
    const key = displayKey(frame);
    const existing = latest.get(key);
    if (!existing || new Date(frame.capturedAt || 0).getTime() > new Date(existing.capturedAt || 0).getTime()) latest.set(key, frame);
  }
  return [...latest.values()].sort(displaySort);
}

function latestHistoryFramesForDevice(deviceId, employeeId) {
  const frames = filterLegacyFrames((db.data.liveFrameHistory || []).filter(item => item.deviceId === deviceId && item.employeeId === employeeId));
  const latest = new Map();
  for (const frame of frames) {
    const key = displayKey(frame);
    const existing = latest.get(key);
    if (!existing || new Date(frame.capturedAt || 0).getTime() > new Date(existing.capturedAt || 0).getTime()) latest.set(key, frame);
  }
  return [...latest.values()].sort(displaySort);
}

function serializeFrame(frame, fallbackIndex = 1) {
  return {
    displayId: frame?.displayId ?? `display-${Number(frame?.displayIndex) || fallbackIndex}`,
    displayName: frame?.displayName || `Display ${Number(frame?.displayIndex) || fallbackIndex}`,
    displayIndex: Number(frame?.displayIndex) || fallbackIndex,
    frameUrl: frame?.url || null,
    capturedAt: frame?.capturedAt || null,
  };
}

function scopedEmployeeIds(user) {
  if (user.role === 'Admin') return null;
  if (user.role === 'Manager') return teamIdsOf(user.id);
  return new Set([user.id]);
}

multiDisplayActivityRouter.post('/live-frame', requireDevice(db), async (req, res) => {
  const { url, capturedAt, displayId = null, displayName = null, displayIndex = 1 } = req.body || {};
  if (!url) return res.status(400).json({ error: 'url is required.' });

  const ts = capturedAt || new Date().toISOString();
  const employeeId = currentEmployeeIdForDevice(req.device) || req.device.employeeId;
  const normalizedIndex = Math.max(1, Number(displayIndex) || 1);
  const normalizedId = displayId ? String(displayId) : `display-${normalizedIndex}`;
  const frames = db.data.liveFrames || (db.data.liveFrames = []);
  const existing = frames.find(frame => frame.deviceId === req.device.id && displayKey(frame) === normalizedId);

  const nextFrame = {
    employeeId,
    deviceId: req.device.id,
    url,
    capturedAt: ts,
    displayId: normalizedId,
    displayName: displayName ? String(displayName) : `Display ${normalizedIndex}`,
    displayIndex: normalizedIndex,
  };

  if (existing) Object.assign(existing, nextFrame);
  else frames.push(nextFrame);

  db.data.liveFrameHistory = db.data.liveFrameHistory || [];
  db.data.liveFrameHistory.push({ ...nextFrame, id: nextId() });
  purgeOldActivity();
  await db.write();
  res.status(201).json({ ok: true });
});

multiDisplayActivityRouter.post('/screenshots', requireDevice(db), async (req, res) => {
  const { url, filename, capturedAt, displayId = null, displayName = null, displayIndex = 1 } = req.body || {};
  if (!url) return res.status(400).json({ error: 'url is required (upload the file to /api/uploads/monitoring first).' });

  const normalizedIndex = Math.max(1, Number(displayIndex) || 1);
  const currentEmployeeId = currentEmployeeIdForDevice(req.device) || req.device.employeeId;
  const entry = {
    id: nextId(),
    employeeId: currentEmployeeId,
    deviceId: req.device.id,
    url,
    filename: filename || '',
    capturedAt: capturedAt || new Date().toISOString(),
    type: 'scheduled',
    displayId: displayId ? String(displayId) : `display-${normalizedIndex}`,
    displayName: displayName ? String(displayName) : `Display ${normalizedIndex}`,
    displayIndex: normalizedIndex,
  };

  db.data.screenshots.push(entry);
  purgeOldActivity();
  await db.write();
  res.status(201).json(entry);
});

multiDisplayActivityRouter.get('/live-view', requireAuth(db), requireRole('Admin', 'Manager'), (req, res) => {
  const allowed = scopedEmployeeIds(req.user);
  const eligible = db.data.devices
    .filter(device => device.employeeId && deviceIsOnline(device) && ['active', 'idle'].includes(deviceState(device)))
    .filter(device => {
      const currentId = currentEmployeeIdForDevice(device);
      return !allowed || allowed.has(currentId || device.employeeId);
    });

  const chosen = new Map();
  for (const device of eligible) {
    const employeeId = currentEmployeeIdForDevice(device) || device.employeeId;
    const existing = chosen.get(employeeId);
    if (!existing || new Date(device.lastSeenAt).getTime() > new Date(existing.lastSeenAt).getTime()) chosen.set(employeeId, device);
  }

  const result = [...chosen.entries()].map(([employeeId, device]) => {
    const emp = db.data.users.find(u => u.id === employeeId);
    const currentFrames = latestFramesForDevice(device.id).filter(frame => frame.employeeId === employeeId);
    const historyFrames = latestHistoryFramesForDevice(device.id, employeeId);
    const usableFrames = currentFrames.length > 0 ? currentFrames : historyFrames;
    const allDisplays = usableFrames.map((frame, index) => serializeFrame(frame, index + 1));
    // RDP sessions are intentionally represented as one monitored display.
    // Even when the physical host has multiple monitors, only the primary
    // display frame is exposed while the current session is RDP.
    const displays = device.isRdp ? allDisplays.filter(display => display.displayIndex === 1).slice(0, 1) : allDisplays;
    const first = displays[0] || null;

    return {
      employeeId,
      employeeName: emp?.name || userName(employeeId),
      department: emp?.department || '',
      deviceId: device.id,
      deviceName: device.deviceName,
      hostname: device.hostname,
      domainUser: device.domainUser,
      registeredEmployeeId: device.employeeId,
      registeredEmployeeName: userName(device.employeeId),
      deviceStatus: deviceState(device),
      connectionType: device.isRdp ? 'RDP' : (device.domainUser ? 'Local' : null),
      isRdp: device.isRdp === true,
      sessionName: device.sessionName || null,
      frameUrl: first?.frameUrl || null,
      capturedAt: first?.capturedAt || null,
      lastSeenAt: device.lastSeenAt,
      displays,
    };
  });

  res.json(result);
});

multiDisplayActivityRouter.get('/screenshots', requireAuth(db), requireRole('Admin', 'Manager'), (req, res) => {
  purgeOldActivity();
  const allowed = scopedEmployeeIds(req.user);
  const { employeeId, date, limit } = req.query;
  let list = db.data.screenshots.filter(item => !allowed || allowed.has(item.employeeId));
  if (employeeId) list = list.filter(item => item.employeeId === Number(employeeId));
  if (date) list = list.filter(item => item.capturedAt.slice(0, 10) === date);
  list.sort((a, b) => (a.capturedAt < b.capturedAt ? 1 : -1));
  const cap = Math.min(Number(limit) || 30, 200);

  res.json(list.slice(0, cap).map(item => ({
    ...item,
    employeeName: `${userName(item.employeeId)}${item.displayName ? ` · ${item.displayName}` : ''}`,
  })));
});
