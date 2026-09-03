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

function hasExplicitDisplayMetadata(frame = {}) {
  return frame.displayId !== undefined && frame.displayId !== null && frame.displayId !== '';
}

function filterLegacyFrames(frames) {
  if (!frames.some(hasExplicitDisplayMetadata)) return frames;
  // Ignore pre-multi-display frames that had no displayId/display metadata.
  return frames.filter(hasExplicitDisplayMetadata);
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
    if (!existing || new Date(frame.capturedAt || 0).getTime() > new Date(existing.capturedAt || 0).getTime()) {
      latest.set(key, frame);
    }
  }
  return [...latest.values()].sort(displaySort);
}

function latestHistoryFramesForDevice(deviceId) {
  const frames = filterLegacyFrames((db.data.liveFrameHistory || []).filter(item => item.deviceId === deviceId));
  const latest = new Map();
  for (const frame of frames) {
    const key = displayKey(frame);
    const existing = latest.get(key);
    if (!existing || new Date(frame.capturedAt || 0).getTime() > new Date(existing.capturedAt || 0).getTime()) {
      latest.set(key, frame);
    }
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
  const employeeId = req.device.employeeId;
  const normalizedIndex = Math.max(1, Number(displayIndex) || 1);
  const normalizedId = displayId ? String(displayId) : `display-${normalizedIndex}`;
  const frames = db.data.liveFrames || (db.data.liveFrames = []);
  const existing = frames.find(frame =>
    frame.deviceId === req.device.id &&
    displayKey(frame) === normalizedId
  ) || (!displayId && normalizedIndex === 1
    ? frames.find(frame => frame.deviceId === req.device.id && !frame.displayId && (Number(frame.displayIndex) || 1) === 1)
    : null);

  const nextFrame = {
    employeeId,
    deviceId: req.device.id,
    url,
    capturedAt: ts,
    displayId: normalizedId,
    displayName: displayName ? String(displayName) : `Display ${normalizedIndex}`,
    displayIndex: normalizedIndex,
  };

  if (existing) {
    const oldUrl = existing.url;
    Object.assign(existing, nextFrame);
    if (oldUrl && oldUrl !== url) {
      const stillUsedByHistory = (db.data.liveFrameHistory || []).some(frame => frame.url === oldUrl);
      const stillUsedByScreenshot = db.data.screenshots.some(screenshot => screenshot.url === oldUrl);
      if (!stillUsedByHistory && !stillUsedByScreenshot) {
        // The main activity route owns the file cleanup logic; leave orphan cleanup to retention.
      }
    }
  } else {
    frames.push(nextFrame);
  }

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
  const entry = {
    id: nextId(),
    employeeId: req.device.employeeId,
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
    .filter(device => !allowed || allowed.has(device.employeeId));

  const chosen = new Map();
  for (const device of eligible) {
    const existing = chosen.get(device.employeeId);
    if (!existing || new Date(device.lastSeenAt).getTime() > new Date(existing.lastSeenAt).getTime()) {
      chosen.set(device.employeeId, device);
    }
  }

  const result = [...chosen.values()].map(device => {
    const emp = db.data.users.find(u => u.id === device.employeeId);
    const currentFrames = latestFramesForDevice(device.id);
    const historyFrames = latestHistoryFramesForDevice(device.id);
    const usableFrames = currentFrames.length > 0 ? currentFrames : historyFrames;
    const displays = usableFrames.map((frame, index) => serializeFrame(frame, index + 1));
    const first = displays[0] || null;

    return {
      employeeId: device.employeeId,
      employeeName: emp?.name || userName(device.employeeId),
      department: emp?.department || '',
      deviceId: device.id,
      deviceName: device.deviceName,
      hostname: device.hostname,
      domainUser: device.domainUser,
      deviceStatus: deviceState(device),
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
