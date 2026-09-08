import { Router } from 'express';
import { db, nextId } from '../db.js';
import { requireAuth, requireRole, requireDevice } from '../auth.js';
import { getLiveFrame, getLiveFramesForDevice, clearLiveFramesForDevice } from '../live-frame-store.js';

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

function deviceIsRdp(device) {
  return device?.isRdp === true || /^RDP-Tcp#/i.test(String(device?.sessionName || '').trim());
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

function serializeFrame(frame, fallbackIndex = 1) {
  const token = frame?.liveFrameToken || frame?.token || null;
  return {
    displayId: frame?.displayId ?? `display-${Number(frame?.displayIndex) || fallbackIndex}`,
    displayName: frame?.displayName || `Display ${Number(frame?.displayIndex) || fallbackIndex}`,
    displayIndex: Number(frame?.displayIndex) || fallbackIndex,
    frameUrl: token ? `/api/activity/live-frame/${encodeURIComponent(token)}` : null,
    capturedAt: frame?.capturedAt || null,
  };
}

function scopedEmployeeIds(user) {
  if (user.role === 'Admin') return null;
  if (user.role === 'Manager') return teamIdsOf(user.id);
  return new Set([user.id]);
}

// Live View frames are served from memory only. No frame URL is persisted to
// the database and no frame file is retained on disk.
multiDisplayActivityRouter.get('/live-frame/:token', (req, res) => {
  const frame = getLiveFrame(req.params.token);
  if (!frame) return res.status(404).end();

  res.setHeader('Content-Type', frame.mimeType || 'image/png');
  res.setHeader('Content-Length', frame.buffer.length);
  res.setHeader('Cache-Control', 'private, max-age=3, must-revalidate');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.end(frame.buffer);
});

multiDisplayActivityRouter.post('/live-frame', requireDevice(db), (req, res) => {
  const { liveFrameToken, displayId = null, displayName = null, displayIndex = 1, capturedAt } = req.body || {};
  if (!liveFrameToken) return res.status(400).json({ error: 'liveFrameToken is required.' });

  const frame = getLiveFrame(liveFrameToken);
  if (!frame) return res.status(410).json({ error: 'Live frame is no longer available.' });
  if (frame.deviceId !== req.device.id) return res.status(403).json({ error: 'Live frame does not belong to this device.' });

  frame.employeeId = currentEmployeeIdForDevice(req.device) || req.device.employeeId;
  frame.displayId = displayId ? String(displayId) : frame.displayId;
  frame.displayName = displayName ? String(displayName) : frame.displayName;
  frame.displayIndex = Math.max(1, Number(displayIndex) || frame.displayIndex || 1);
  frame.capturedAt = capturedAt || frame.capturedAt;

  res.status(201).json({ ok: true, liveFrameToken });
});

multiDisplayActivityRouter.post('/screenshots', requireDevice(db), async (req, res) => {
  const { url, filename, capturedAt, displayId = null, displayName = null, displayIndex = 1 } = req.body || {};
  if (!url) return res.status(400).json({ error: 'url is required (upload the file to /api/uploads/monitoring first).' });

  const rdp = deviceIsRdp(req.device);
  const normalizedIndex = rdp ? 1 : Math.max(1, Number(displayIndex) || 1);
  const currentEmployeeId = currentEmployeeIdForDevice(req.device) || req.device.employeeId;
  const entry = {
    id: nextId(),
    employeeId: currentEmployeeId,
    deviceId: req.device.id,
    url,
    filename: filename || '',
    capturedAt: capturedAt || new Date().toISOString(),
    type: 'scheduled',
    displayId: rdp ? '\\\\.\\DISPLAY1' : (displayId ? String(displayId) : `display-${normalizedIndex}`),
    displayName: rdp ? '\\\\.\\DISPLAY1' : (displayName ? String(displayName) : `Display ${normalizedIndex}`),
    displayIndex: normalizedIndex,
  };

  db.data.screenshots.push(entry);
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
    const rdp = deviceIsRdp(device);
    const memoryFrames = getLiveFramesForDevice(device.id, employeeId);
    const allDisplays = memoryFrames.map((frame, index) => serializeFrame(frame, index + 1));

    // RDP: one primary display. Local: preserve all currently detected physical displays.
    const displays = rdp
      ? allDisplays.filter(display => Number(display.displayIndex) === 1 || /DISPLAY1$/i.test(String(display.displayId || ''))).slice(0, 1)
      : allDisplays;
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
      connectionType: rdp ? 'RDP' : (device.domainUser ? 'Local' : null),
      isRdp: rdp,
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
  const allowed = scopedEmployeeIds(req.user);
  const { employeeId, date, limit, offset } = req.query;
  let list = db.data.screenshots.filter(item => !allowed || allowed.has(item.employeeId));
  if (employeeId) list = list.filter(item => item.employeeId === Number(employeeId));
  if (date) list = list.filter(item => item.capturedAt.slice(0, 10) === date);
  list.sort((a, b) => (a.capturedAt < b.capturedAt ? 1 : -1));

  const cap = Math.min(Math.max(Number(limit) || 30, 1), 200);
  const start = Math.max(Number(offset) || 0, 0);
  const page = list.slice(start, start + cap);

  res.json(page.map(item => ({
    ...item,
    currentUser: userName(item.employeeId),
    display: item.displayName || `Display ${Number(item.displayIndex) || 1}`,
    date: item.capturedAt ? item.capturedAt.slice(0, 10) : null,
    employeeName: userName(item.employeeId),
  })));
});

export function clearLiveFrameStoreForDevice(deviceId) {
  clearLiveFramesForDevice(deviceId);
}
