import { Router } from 'express';
import { db, nextId } from '../db.js';
import { requireAuth, requireRole, requireDevice } from '../auth.js';

export const activityRouter = Router();

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

function purgeOldActivity() {
  const screenshotCutoff = retentionCutoff(db.data.agentConfig.screenshotRetentionDays);
  const liveCutoff = retentionCutoff(db.data.agentConfig.liveViewRetentionDays);
  db.data.screenshots = db.data.screenshots.filter(s => {
    const ts = new Date(s.capturedAt).getTime();
    return Number.isNaN(ts) || ts > screenshotCutoff;
  });
  db.data.liveFrameHistory = (db.data.liveFrameHistory || []).filter(f => {
    const ts = new Date(f.capturedAt).getTime();
    return Number.isNaN(ts) || ts > liveCutoff;
  });
}

/* ---- Ingestion: called by the desktop agent / browser extension (device auth) ---- */

activityRouter.post('/screenshots', requireDevice(db), async (req, res) => {
  const { url, filename, capturedAt } = req.body || {};
  if (!url) return res.status(400).json({ error: 'url is required (upload the file to /api/uploads first).' });
  const entry = {
    id: nextId(), employeeId: req.employee.id, deviceId: req.device.id,
    url, filename: filename || '', capturedAt: capturedAt || new Date().toISOString(), type: 'scheduled',
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
  const existing = db.data.liveFrames.find(f => f.employeeId === req.employee.id);
  if (existing) {
    existing.url = url;
    existing.capturedAt = ts;
    existing.deviceId = req.device.id;
  } else {
    db.data.liveFrames.push({ employeeId: req.employee.id, deviceId: req.device.id, url, capturedAt: ts });
  }
  // Keep every live frame as historical data as well as the latest frame used by Live View.
  db.data.liveFrameHistory = db.data.liveFrameHistory || [];
  db.data.liveFrameHistory.push({ id: nextId(), employeeId: req.employee.id, deviceId: req.device.id, url, capturedAt: ts });
  purgeOldActivity();
  await db.write();
  res.status(201).json({ ok: true });
});

activityRouter.post('/web-usage', requireDevice(db), async (req, res) => {
  const { entries } = req.body || {};
  if (!Array.isArray(entries) || entries.length === 0) return res.status(400).json({ error: 'entries array is required.' });

  for (const e of entries) {
    if (!e.domain || !e.seconds || !e.date) continue;
    let row = db.data.webUsageLogs.find(r => r.employeeId === req.employee.id && r.date === e.date && r.domain === e.domain);
    if (!row) {
      row = { id: nextId(), employeeId: req.employee.id, date: e.date, domain: e.domain, seconds: 0 };
      db.data.webUsageLogs.push(row);
    }
    row.seconds += Number(e.seconds) || 0;
  }
  await db.write();
  res.status(201).json({ ok: true });
});

/* ---- Consumption: called by the Admin/Manager/Employee web app (user auth) ---- */

function scopedEmployeeIds(user) {
  if (user.role === 'Admin') return null;
  if (user.role === 'Manager') return teamIdsOf(user.id);
  return new Set([user.id]);
}

activityRouter.get('/live-view', requireAuth(db), requireRole('Admin', 'Manager'), (req, res) => {
  const allowed = scopedEmployeeIds(req.user);
  const activeEmployees = db.data.users.filter(u =>
    u.role === 'Employee' && u.status === 'active' && (!allowed || allowed.has(u.id))
  );
  const result = activeEmployees.map(emp => {
    const frame = db.data.liveFrames.find(f => f.employeeId === emp.id);
    return {
      employeeId: emp.id, employeeName: emp.name, department: emp.department,
      frameUrl: frame ? frame.url : null, capturedAt: frame ? frame.capturedAt : null,
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

activityRouter.get('/web-usage', requireAuth(db), (req, res) => {
  const { employeeId, date } = req.query;
  let allowed = scopedEmployeeIds(req.user);
  if (req.user.role === 'Employee') allowed = new Set([req.user.id]);

  let list = db.data.webUsageLogs.filter(r => !allowed || allowed.has(r.employeeId));
  if (employeeId) list = list.filter(r => r.employeeId === Number(employeeId));
  if (date) list = list.filter(r => r.date === date);

  res.json(list.map(r => ({ ...r, minutes: Math.round((r.seconds / 60) * 10) / 10, employeeName: userName(r.employeeId) })));
});
