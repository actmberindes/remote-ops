import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { db, nextId } from '../db.js';
import { requireAuth, requireRole, publicUser } from '../auth.js';

export const usersRouter = Router();
usersRouter.use(requireAuth(db));

// Any signed-in user can see the directory (needed for manager names, team lists, etc.)
usersRouter.get('/', (req, res) => {
  res.json(db.data.users.map(publicUser));
});

// Self-service: the time tracker flips the caller's own live status (active/idle/inactive)
usersRouter.patch('/me/status', async (req, res) => {
  const { status } = req.body || {};
  if (!['active', 'idle', 'inactive'].includes(status)) {
    return res.status(400).json({ error: 'status must be active, idle, or inactive.' });
  }
  const user = db.data.users.find(u => u.id === req.user.id);
  user.status = status;
  await db.write();
  res.json(publicUser(user));
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
  };
  db.data.users.push(user);
  await db.write();
  res.status(201).json(publicUser(user));
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
  res.json(publicUser(user));
});

usersRouter.delete('/:id', requireRole('Admin'), async (req, res) => {
  const id = Number(req.params.id);
  if (id === req.user.id) return res.status(400).json({ error: 'You cannot remove your own account.' });
  db.data.users = db.data.users.filter(u => u.id !== id);
  await db.write();
  res.json({ ok: true });
});
