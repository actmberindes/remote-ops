import { Router } from 'express';
import { db } from '../db.js';
import { requireAuth, requireRole } from '../auth.js';

export const activityScreenshotHistoryRouter = Router();

function teamIdsOf(managerId) {
  return new Set(db.data.users.filter(u => u.managerId === managerId).map(u => u.id));
}

function scopedEmployeeIds(user) {
  if (user.role === 'Admin') return null;
  if (user.role === 'Manager') return teamIdsOf(user.id);
  return new Set([user.id]);
}

function userName(id) {
  const u = db.data.users.find(x => x.id === id);
  return u ? u.name : 'Unknown';
}

activityScreenshotHistoryRouter.get('/screenshots', requireAuth(db), requireRole('Admin', 'Manager'), (req, res) => {
  const allowed = scopedEmployeeIds(req.user);
  const { employeeId, date, limit } = req.query;

  let list = db.data.screenshots.filter(s => !allowed || allowed.has(s.employeeId));
  if (employeeId) list = list.filter(s => s.employeeId === Number(employeeId));
  if (date) list = list.filter(s => s.capturedAt.slice(0, 10) === date);

  list.sort((a, b) => (a.capturedAt < b.capturedAt ? 1 : -1));
  const cap = Math.min(Number(limit) || 30, 200);

  // Historical screenshots must use the identity captured with the screenshot.
  // Never fall back to the device's CURRENT user because a shared workstation
  // can change users after the screenshot was taken.
  res.json(list.slice(0, cap).map(s => ({
    ...s,
    employeeName: userName(s.employeeId),
    domainUser: s.domainUser || null,
  })));
});
