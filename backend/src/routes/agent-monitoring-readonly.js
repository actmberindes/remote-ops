import { Router } from 'express';
import { db } from '../db.js';
import { requireAuth, requireRole } from '../auth.js';

export const agentMonitoringReadonlyRouter = Router();
const access = [requireAuth(db), requireRole('Admin', 'Manager')];

function teamIdsOf(managerId) {
  return new Set(db.data.users.filter(u => u.managerId === managerId).map(u => u.id));
}
function canView(user, device) {
  if (user.role === 'Admin') return true;
  const team = teamIdsOf(user.id);
  return team.has(device.employeeId) || team.has(device.currentEmployeeId);
}
function domainUserOf(item, device) {
  return item?.domainUser || item?.currentDomainUser || device?.domainUser || null;
}
function deviceOr404(req, res) {
  const id = Number(req.params.id);
  const device = db.data.devices.find(item => Number(item.id) === id);
  if (!device) { res.status(404).json({ error: 'Device not found.' }); return null; }
  if (!canView(req.user, device)) { res.status(403).json({ error: 'You do not have access to this device.' }); return null; }
  return device;
}

agentMonitoringReadonlyRouter.get('/devices/:id/screenshots', ...access, (req, res) => {
  const device = deviceOr404(req, res);
  if (!device) return;
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 20));
  const date = String(req.query.date || '').trim();
  const domainUser = String(req.query.domainUser || '').trim();
  let list = (db.data.screenshots || []).filter(item => Number(item.deviceId) === Number(device.id)).map(item => ({ ...item, domainUser: domainUserOf(item, device) }));
  if (date) list = list.filter(item => String(item.capturedAt || '').slice(0, 10) === date);
  if (domainUser) list = list.filter(item => item.domainUser === domainUser);
  list.sort((a, b) => new Date(b.capturedAt || 0).getTime() - new Date(a.capturedAt || 0).getTime());
  const total = list.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, totalPages);
  const start = (safePage - 1) * pageSize;
  res.json({ items: list.slice(start, start + pageSize), page: safePage, pageSize, total, totalPages });
});

agentMonitoringReadonlyRouter.get('/devices/:id/screenshot-users', ...access, (req, res) => {
  const device = deviceOr404(req, res);
  if (!device) return;
  const users = [...new Set((db.data.screenshots || []).filter(item => Number(item.deviceId) === Number(device.id)).map(item => domainUserOf(item, device)).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  res.json({ users });
});
