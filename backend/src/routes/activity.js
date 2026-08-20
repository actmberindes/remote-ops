import { Router } from 'express';
import { db, nextId } from '../db.js';
import { requireAuth, requireRole, requireDevice } from '../auth.js';

export const activityRouter = Router();

const DEVICE_OFFLINE_MS = 90 * 1000;

function teamIdsOf(managerId) {
  return new Set(db.data.users.filter(u => u.managerId === managerId).map(u => u.id));
}

function userName(id) {
  const u = db.data.users.find(x => x.id === id);
  return u ? u.name : 'Unknown';
}

function retentionCutoff(days) {
  return Date.now() - Number(days || 7) * 24 * 60 * 60 * 1000;
}

function retentionCutoffDate(days) {
  return new Date(retentionCutoff(days)).toISOString().slice(0, 10);
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

function purgeOldActivity() {
  const screenshotCutoff = retentionCutoff(db.data.agentConfig.screenshotRetentionDays);
  const liveCutoff = retentionCutoff(db.data.agentConfig.liveViewRetentionDays);
  const webUsageCutoffDate = retentionCutoffDate(db.data.agentConfig.webUsageRetentionDays);

  db.data.screenshots = db.data.screenshots.filter(s => {
    const ts = new Date(s.capturedAt).getTime();
    return Number.isNaN(ts) || ts > screenshotCutoff;
  });

  db.data.liveFrameHistory = (db.data.liveFrameHistory || []).filter(f => {
    const ts = new Date(f.capturedAt).getTime();
    return Number.isNaN(ts) || ts > liveCutoff;
  });

  db.data.webUsageLogs = (db.data.webUsageLogs || []).filter(r => {
    return !r.date || r.date >= webUsageCutoffDate;
  });
}

// Monitoring uploads are controlled by device enrollment/authorization.
// Employee Start/Stop Session is no longer a prerequisite.
activityRouter.post('/screenshots', requireDevice(db), async (req, res) => {
  const { url, filename, capturedAt } = req.body || {};
  if (!url) return res.status(400).json({ error: 'url is required (upload the file to /api/uploads first).' });

  const entry = {
    id: nextId(),
    employeeId: req.device.employeeId,
    deviceId: req.device.id,
    url,
    filename: filename || '',
    capturedAt: capturedAt || new Date().toISOString(),
    type: 'scheduled',
  };

  db.data.screenshots.push(entry);
  purgeOldActivity();
  await db.write();
  res.status(201).json(entry);
});

activityRouter.post('/live-frame', requireDevice(db), async (req, res) => {
  const { url, capturedAt } = req.body || {};
  if (!url) return res.status(400).json({ error: 'url is required.' });

  const ts = capturedAt || new Date().toISOString();
  const employeeId = req.device.employeeId;
  const existing = db.data.liveFrames.find(f => f.deviceId === req.device.id);

  if (existing) {
    existing.employeeId = employeeId;
    existing.url = url;
    existing.capturedAt = ts;
  } else {
    db.data.liveFrames.push({
      employeeId,
      deviceId: req.device.id,
      url,
      capturedAt: ts,
    });
  }

  db.data.liveFrameHistory = db.data.liveFrameHistory || [];
  db.data.liveFrameHistory.push({
    id: nextId(),
    employeeId,
    deviceId: req.device.id,
    url,
    capturedAt: ts,
  });

  purgeOldActivity();
  await db.write();
  res.status(201).json({ ok: true });
});

activityRouter.post('/web-usage', requireDevice(db), async (req, res) => {
  const { entries } = req.body || {};
  if (!Array.isArray(entries) || entries.length === 0) return res.status(400).json({ error: 'entries array is required.' });

  for (const e of entries) {
    if (!e.domain || !e.seconds || !e.date) continue;

    if (e.url) {
      db.data.webUsageLogs.push({
        id: nextId(),
        employeeId: req.device.employeeId,
        deviceId: req.device.id,
        date: e.date,
        domain: e.domain,
        url: e.url,
        seconds: Number(e.seconds) || 0,
        startedAt: e.startedAt || null,
        endedAt: e.endedAt || null,
      });
    } else {
      let row = db.data.webUsageLogs.find(
        r => r.employeeId === req.device.employeeId &&
             r.date === e.date &&
             !r.url &&
             r.domain === e.domain &&
             (r.deviceId || null) === (req.device.id || null)
      );

      if (!row) {
        row = {
          id: nextId(),
          employeeId: req.device.employeeId,
          deviceId: req.device.id,
          date: e.date,
          domain: e.domain,
          url: null,
          seconds: 0,
          startedAt: null,
          endedAt: null,
        };
        db.data.webUsageLogs.push(row);
      }

      row.seconds += Number(e.seconds) || 0;
    }
  }

  purgeOldActivity();
  await db.write();
  res.status(201).json({ ok: true });
});

function scopedEmployeeIds(user) {
  if (user.role === 'Admin') return null;
  if (user.role === 'Manager') return teamIdsOf(user.id);
  return new Set([user.id]);
}

activityRouter.get('/live-view', requireAuth(db), requireRole('Admin', 'Manager'), (req, res) => {
  const allowed = scopedEmployeeIds(req.user);
  const eligible = db.data.devices
    .filter(device => device.employeeId && deviceIsOnline(device) && deviceState(device) === 'active')
    .filter(device => !allowed || allowed.has(device.employeeId));

  const chosen = new Map();
  for (const device of eligible) {
    const existing = chosen.get(device.employeeId);
    if (!existing || new Date(device.lastSeenAt).getTime() > new Date(existing.lastSeenAt).getTime()) {
      chosen.set(device.employeeId, device);
    }
  }

  const result = [...chosen.values()].map(device => {
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
      deviceStatus: deviceState(device),
      frameUrl: frame ? frame.url : null,
      capturedAt: frame ? frame.capturedAt : null,
      lastSeenAt: device.lastSeenAt,
    };
  });

  res.json(result);
});

activityRouter.get('/screenshots', requireAuth(db), requireRole('Admin', 'Manager'), (req, res) => {
  purgeOldActivity();
  const allowed = scopedEmployeeIds(req.user);
  const { employeeId, date, limit } = req.query;

  let list = db.data.screenshots.filter(s => !allowed || allowed.has(s.employeeId));
  if (employeeId) list = list.filter(s => s.employeeId === Number(employeeId));
  if (date) list = list.filter(s => s.capturedAt.slice(0, 10) === date);

  list = list.sort((a, b) => (a.capturedAt < b.capturedAt ? 1 : -1));
  const cap = Math.min(Number(limit) || 30, 200);
  res.json(list.slice(0, cap).map(s => ({ ...s, employeeName: userName(s.employeeId) })));
});

activityRouter.get('/live-history', requireAuth(db), requireRole('Admin', 'Manager'), (req, res) => {
  purgeOldActivity();
  const allowed = scopedEmployeeIds(req.user);
  const { employeeId, date, limit } = req.query;
  let list = (db.data.liveFrameHistory || []).filter(f => !allowed || allowed.has(f.employeeId));
  if (employeeId) list = list.filter(f => f.employeeId === Number(employeeId));
  if (date) list = list.filter(f => f.capturedAt.slice(0, 10) === date);
  list.sort((a, b) => (a.capturedAt < b.capturedAt ? 1 : -1));
  const cap = Math.min(Number(limit) || 100, 500);
  res.json(list.slice(0, cap).map(f => ({ ...f, employeeName: userName(f.employeeId) })));
});

// Web Usage is an administrator/manager monitoring function. Employees no longer
// have a portal or API access to their monitoring history.
activityRouter.get('/web-usage', requireAuth(db), requireRole('Admin', 'Manager'), (req, res) => {
  purgeOldActivity();
  const { employeeId, date } = req.query;
  const allowed = scopedEmployeeIds(req.user);

  let list = db.data.webUsageLogs.filter(r => !allowed || allowed.has(r.employeeId));
  if (employeeId) list = list.filter(r => r.employeeId === Number(employeeId));
  if (date) list = list.filter(r => r.date === date);

  list.sort((a, b) => {
    const aTime = new Date(a.startedAt || `${a.date}T00:00:00Z`).getTime();
    const bTime = new Date(b.startedAt || `${b.date}T00:00:00Z`).getTime();
    return bTime - aTime;
  });

  res.json(list.map(r => ({
    ...r,
    minutes: Math.round((r.seconds / 60) * 10) / 10,
    employeeName: userName(r.employeeId),
  })));
});
