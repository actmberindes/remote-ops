import { Router } from 'express';
import { db } from '../db.js';
import { requireAuth, requireRole } from '../auth.js';
import { purgeOldActivity } from './activity.js';

export const screenshotPaginationRouter = Router();

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

screenshotPaginationRouter.get('/screenshots-page', requireAuth(db), requireRole('Admin', 'Manager'), (req, res) => {
  purgeOldActivity();

  const allowed = scopedEmployeeIds(req.user);
  const employeeId = req.query.employeeId ? Number(req.query.employeeId) : null;
  const date = String(req.query.date || '').trim();
  const pageSize = Math.min(Math.max(Number(req.query.pageSize) || 60, 1), 100);
  const page = Math.max(Number(req.query.page) || 1, 1);

  let list = db.data.screenshots.filter(item => !allowed || allowed.has(item.employeeId));

  if (employeeId) list = list.filter(item => item.employeeId === employeeId);
  if (date) list = list.filter(item => String(item.capturedAt || '').slice(0, 10) === date);

  list.sort((a, b) => (a.capturedAt < b.capturedAt ? 1 : -1));

  const total = list.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, totalPages);
  const offset = (safePage - 1) * pageSize;

  const items = list.slice(offset, offset + pageSize).map(item => ({
    ...item,
    employeeName: `${userName(item.employeeId)}${item.displayName ? ` · ${item.displayName}` : ''}`,
  }));

  res.json({
    items,
    total,
    page: safePage,
    pageSize,
    totalPages,
  });
});
