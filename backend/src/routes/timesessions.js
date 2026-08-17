import { Router } from 'express';
import { db, nextId } from '../db.js';
import { requireAuth } from '../auth.js';

export const timeSessionsRouter = Router();
timeSessionsRouter.use(requireAuth(db));

function scopedSessions(user) {
  if (user.role === 'Admin') return db.data.timeSessions;
  if (user.role === 'Manager') {
    const teamIds = new Set(db.data.users.filter(u => u.managerId === user.id).map(u => u.id));
    return db.data.timeSessions.filter(s => teamIds.has(s.userId));
  }
  return db.data.timeSessions.filter(s => s.userId === user.id);
}

timeSessionsRouter.get('/', (req, res) => {
  res.json(scopedSessions(req.user));
});

timeSessionsRouter.post('/', async (req, res) => {
  const { date, startTime, endTime, totalHours } = req.body || {};
  if (!date || !startTime || !endTime || totalHours == null) {
    return res.status(400).json({ error: 'date, startTime, endTime, and totalHours are required.' });
  }
  const session = { id: nextId(), userId: req.user.id, date, startTime, endTime, totalHours, status: 'Completed' };
  db.data.timeSessions.unshift(session);
  await db.write();
  res.status(201).json(session);
});
