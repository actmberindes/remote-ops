import { Router } from 'express';
import { db } from '../db.js';
import { requireAuth, requireRole } from '../auth.js';
import { purgeOldActivity } from './activity.js';

export const screenshotFeedRouter = Router();

function teamIdsOf(managerId) {
  return new Set(db.data.users.filter(u => u.managerId === managerId).map(u => u.id));
}

function userName(id) {
  const user = db.data.users.find(u => u.id === id);
  return user ? user.name : 'Unknown';
}

function scopedEmployeeIds(user) {
  if (user.role === 'Admin') return null;
  if (user.role === 'Manager') return teamIdsOf(user.id);
  return new Set([user.id]);
}

screenshotFeedRouter.get('/screenshots-feed', requireAuth(db), requireRole('Admin', 'Manager'), (req, res) => {
  purgeOldActivity();

  const allowed = scopedEmployeeIds(req.user);
  const employeeId = req.query.employeeId ? Number(req.query.employeeId) : null;
  const date = String(req.query.date || '').trim();
  const limit = Math.min(Math.max(Number(req.query.limit) || 200, 1), 200);
  const offset = Math.max(Number(req.query.offset) || 0, 0);

  let list = db.data.screenshots.filter(item => !allowed || allowed.has(item.employeeId));
  if (employeeId) list = list.filter(item => item.employeeId === employeeId);
  if (date) list = list.filter(item => String(item.capturedAt || '').slice(0, 10) === date);
  list.sort((a, b) => (a.capturedAt < b.capturedAt ? 1 : -1));

  const total = list.length;
  const items = list.slice(offset, offset + limit).map(item => ({
    ...item,
    employeeName: `${userName(item.employeeId)}${item.displayName ? ` · ${item.displayName}` : ''}`,
  }));

  res.json({ items, total, offset, limit, hasMore: offset + items.length < total });
});
