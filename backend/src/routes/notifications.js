import { Router } from 'express';
import { db } from '../db.js';
import { requireAuth } from '../auth.js';

export const notificationsRouter = Router();
notificationsRouter.use(requireAuth(db));

function scopedNotifications(user) {
  return db.data.notifications.filter(n =>
    (n.audience === 'role' && n.role === user.role) || (n.audience === 'user' && n.userId === user.id)
  );
}

notificationsRouter.get('/', (req, res) => {
  res.json(scopedNotifications(req.user));
});

notificationsRouter.post('/mark-all-read', async (req, res) => {
  db.data.notifications.forEach(n => {
    if ((n.audience === 'role' && n.role === req.user.role) || (n.audience === 'user' && n.userId === req.user.id)) {
      n.read = true;
    }
  });
  await db.write();
  res.json({ ok: true });
});
