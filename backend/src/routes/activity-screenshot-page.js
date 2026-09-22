import { Router } from 'express';
import { db } from '../db.js';
import { requireAuth, requireRole } from '../auth.js';
import { purgeOldActivity } from './activity.js';

export const screenshotPageRouter = Router();

function teamIdsOf(managerId) {
  return new Set(db.data.users.filter(u => u.managerId === managerId).map(u => u.id));
}

function scopedEmployeeIds(user) {
  if (user.role === 'Admin') return null;
  if (user.role === 'Manager') return teamIdsOf(user.id);
  return new Set([user.id]);
}

function userName(id) {
  const user = db.data.users.find(item => item.id === id);
  return user ? user.name : 'Unknown Employee';
}

function currentDomainUser(item) {
  if (item.domainUser) return item.domainUser;
  const device = db.data.devices.find(device => Number(device.id) === Number(item.deviceId));
  return device?.domainUser || null;
}

screenshotPageRouter.get('/screenshots-page', requireAuth(db), requireRole('Admin', 'Manager'), (req, res) => {
  purgeOldActivity();

  const allowed = scopedEmployeeIds(req.user);
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(60, Math.max(1, Number(req.query.pageSize) || 60));
  const deviceId = req.query.deviceId ? Number(req.query.deviceId) : null;
  const date = String(req.query.date || '').trim();

  let list = db.data.screenshots.filter(item => !allowed || allowed.has(item.employeeId));
  if (deviceId && Number.isFinite(deviceId)) list = list.filter(item => Number(item.deviceId) === deviceId);
  if (date) list = list.filter(item => String(item.capturedAt || '').slice(0, 10) === date);

  list.sort((a, b) => new Date(b.capturedAt || 0).getTime() - new Date(a.capturedAt || 0).getTime());

  const total = list.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, totalPages);
  const start = (safePage - 1) * pageSize;
  const items = list.slice(start, start + pageSize).map(item => ({
    ...item,
    employeeName: `${userName(item.employeeId)}${item.displayName ? ` · ${item.displayName}` : ''}`,\n    deviceName: db.data.devices.find(device => Number(device.id) === Number(item.deviceId))?.deviceName || db.data.devices.find(device => Number(device.id) === Number(item.deviceId))?.hostname || `Device #${item.deviceId || '—'}`,
    domainUser: currentDomainUser(item),
  }));

  res.json({
    items,
    page: safePage,
    pageSize,
    total,
    totalPages,
  });
});
