import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { db, nextId } from '../db.js';
import { signToken, requireAuth, publicUser } from '../auth.js';

export const authRouter = Router();

// Public: list of managers, used by the sign-up form (no sensitive data exposed)
authRouter.get('/managers', (req, res) => {
  const managers = db.data.users.filter(u => u.role === 'Manager').map(u => ({ id: u.id, name: u.name, department: u.department }));
  res.json(managers);
});

authRouter.post('/register', async (req, res) => {
  const { name, email, password, department, jobTitle, managerId } = req.body || {};
  if (!name || !email || !password) return res.status(400).json({ error: 'Name, email, and password are required.' });
  if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters.' });

  const normalizedEmail = String(email).trim().toLowerCase();
  const exists = db.data.users.some(u => u.email.toLowerCase() === normalizedEmail);
  if (exists) return res.status(409).json({ error: 'An account with that email already exists.' });

  const user = {
    id: nextId(),
    name: name.trim(),
    email: normalizedEmail,
    passwordHash: bcrypt.hashSync(password, 10),
    role: 'Employee',
    department: department || 'Operations',
    jobTitle: jobTitle || 'Employee',
    managerId: managerId || null,
    status: 'active',
  };
  db.data.users.push(user);
  await db.write();

  const token = signToken(user);
  res.status(201).json({ token, user: publicUser(user) });
});

authRouter.post('/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Email and password are required.' });

  const user = db.data.users.find(u => u.email.toLowerCase() === String(email).trim().toLowerCase());
  if (!user || !bcrypt.compareSync(password, user.passwordHash)) {
    return res.status(401).json({ error: 'Invalid email or password.' });
  }

  const token = signToken(user);
  res.json({ token, user: publicUser(user) });
});

authRouter.get('/me', requireAuth(db), (req, res) => {
  res.json({ user: publicUser(req.user) });
});
