import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { db, nextId } from '../db.js';
import { requireAuth, requireRole, publicUser } from '../auth.js';

export const usersRouter = Router();
usersRouter.use(requireAuth(db));

const DEVICE_OFFLINE_MS = 90 * 1000;

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

function currentEmployee(device) {
  const direct = device?.currentEmployeeId
    ? db.data.users.find(u => u.id === device.currentEmployeeId && u.role === 'Employee')
    : null;
  return direct || resolveCurrentEmployee(device?.domainUser);
}

function deviceStatus(device) {
  if (!device || device.revoked || device.enrolled === false) return 'inactive';
  if (!device.lastSeenAt) return 'offline';
  const lastSeen = new Date(device.lastSeenAt).getTime();
  if (Number.isNaN(lastSeen) || Date.now() - lastSeen > DEVICE_OFFLINE_MS) return 'offline';
  return device.state || 'active';
}

function publicUserWithDeviceStatus(user) {
  if (user.role !== 'Employee') return publicUser(user);

  // For shared workstations, attribute the device only to the Windows user
  // currently logged in. Fall back to the registered employee only when the
  // device has no resolved current user.
  const matchingDevices = db.data.devices.filter(d => {
    if (d.revoked || d.enrolled === false) return false;
    const current = currentEmployee(d);
    return current ? current.id === user.id : d.employeeId === user.id;
  });

  if (matchingDevices.length === 0) return publicUser(user);

  const ranked = matchingDevices
    .map(device => ({
      device,
      status: deviceStatus(device),
      lastSeenMs: new Date(device.lastSeenAt || 0).getTime(),
      changedMs: new Date(device.lastStateChangedAt || device.lastSeenAt || 0).getTime(),
    }))
    .filter(item => item.status !== 'offline')
    .sort((a, b) => {
      const rank = { active: 4, idle: 3, 'logged-out': 2, inactive: 1, offline: 0 };
      return (rank[b.status] || 0) - (rank[a.status] || 0) || b.lastSeenMs - a.lastSeenMs;
    });

  const offlineFallback = matchingDevices
    .map(device => ({
      device,
      status: deviceStatus(device),
      lastSeenMs: new Date(device.lastSeenAt || 0).getTime(),
      changedMs: new Date(device.lastStateChangedAt || device.lastSeenAt || 0).getTime(),
    }))
    .sort((a, b) => b.lastSeenMs - a.lastSeenMs)[0];

  const selected = ranked[0] || offlineFallback;
  const status = selected?.status || 'offline';
  const statusSince = selected?.changedMs && selected.changedMs > 0
    ? new Date(selected.changedMs).toISOString()
    : null;

  return {
    ...publicUser(user),
    status,
    statusSince,
    deviceName: selected?.device?.deviceName || null,
    currentEmployeeId: currentEmployee(selected?.device)?.id || null,
    currentEmployeeName: currentEmployee(selected?.device)?.name || null,
    deviceStatus: status,
    deviceLastSeenAt: selected?.device?.lastSeenAt || null,
  };
}

// Any signed-in user can see the directory. Employee live status is derived from
// managed-device heartbeats rather than the retired employee Start/Stop session control.
usersRouter.get('/', (req, res) => {
  res.json(db.data.users.map(publicUserWithDeviceStatus));
});

// Legacy compatibility endpoint. Employee Start/Stop is no longer used to control monitoring.
usersRouter.patch('/me/status', async (req, res) => {
  const { status } = req.body || {};
  if (!['active', 'idle', 'inactive'].includes(status)) {
    return res.status(400).json({ error: 'status must be active, idle, or inactive.' });
  }

  const user = db.data.users.find(u => u.id === req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found.' });

  const now = new Date().toISOString();

  if (status === 'active') {
    if (user.status !== 'active' || !user.sessionStartedAt) user.sessionStartedAt = now;
    user.sessionEndedAt = null;
  } else if (status === 'inactive') {
    if (user.status === 'active' && user.sessionStartedAt) user.sessionEndedAt = now;
    else if (!user.sessionEndedAt) user.sessionEndedAt = now;
  }

  user.status = status;
  await db.write();
  res.json(publicUserWithDeviceStatus(user));
});

usersRouter.post('/', requireRole('Admin'), async (req, res) => {
  const { name, email, password, role, department, jobTitle, managerId, status } = req.body || {};
  if (!name || !email || !password) return res.status(400).json({ error: 'Name, email, and password are required.' });
  const normalizedEmail = String(email).trim().toLowerCase();
  if (db.data.users.some(u => u.email.toLowerCase() === normalizedEmail)) {
    return res.status(409).json({ error: 'A user with that email already exists.' });
  }
  const user = {
    id: nextId(), name: name.trim(), email: normalizedEmail, passwordHash: bcrypt.hashSync(password, 10),
    role: role || 'Employee', department: department || 'Operations', jobTitle: jobTitle || '',
    managerId: managerId || null, status: status || 'active',
    sessionStartedAt: null,
    sessionEndedAt: null,
  };
  db.data.users.push(user);
  await db.write();
  res.status(201).json(publicUserWithDeviceStatus(user));
});

usersRouter.put('/:id', requireRole('Admin'), async (req, res) => {
  const id = Number(req.params.id);
  const user = db.data.users.find(u => u.id === id);
  if (!user) return res.status(404).json({ error: 'User not found.' });
  const { name, email, role, department, jobTitle, managerId, status, password } = req.body || {};
  if (name) user.name = name;
  if (email) user.email = String(email).trim().toLowerCase();
  if (role) user.role = role;
  if (department) user.department = department;
  if (jobTitle !== undefined) user.jobTitle = jobTitle;
  if (managerId !== undefined) user.managerId = managerId;
  if (status) user.status = status;
  if (password) user.passwordHash = bcrypt.hashSync(password, 10);
  await db.write();
  res.json(publicUserWithDeviceStatus(user));
});

usersRouter.delete('/:id', requireRole('Admin'), async (req, res) => {
  const id = Number(req.params.id);
  if (id === req.user.id) return res.status(400).json({ error: 'You cannot remove your own account.' });
  db.data.users = db.data.users.filter(u => u.id !== id);
  await db.write();
  res.json({ ok: true });
});
