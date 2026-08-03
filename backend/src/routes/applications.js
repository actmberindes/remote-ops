import { Router } from 'express';
import { db, nextId } from '../db.js';
import { requireAuth, requireRole } from '../auth.js';

export const applicationsRouter = Router();
applicationsRouter.use(requireAuth(db));

function scopedApplications(user) {
  if (user.role === 'Admin') return db.data.applications;
  if (user.role === 'Manager') {
    const teamIds = new Set(db.data.users.filter(u => u.managerId === user.id).map(u => u.id));
    return db.data.applications.filter(a => teamIds.has(a.userId));
  }
  return db.data.applications.filter(a => a.userId === user.id);
}

applicationsRouter.get('/', (req, res) => {
  res.json(scopedApplications(req.user));
});

applicationsRouter.post('/', requireRole('Employee'), async (req, res) => {
  const { location, startDate, temporary, endDate, defaultEndDate, days, internetType, fileName, reason } = req.body || {};
  if (!location || !days) return res.status(400).json({ error: 'Location and weekly schedule are required.' });

  const already = db.data.applications.find(a => a.userId === req.user.id && a.status !== 'rejected');
  if (already) return res.status(409).json({ error: 'You already have an active or pending WFH application.' });

  const app = {
    id: nextId(), userId: req.user.id, status: 'pending', submittedDate: new Date().toISOString().slice(0, 10),
    location, startDate, defaultEndDate, temporary: !!temporary, endDate: temporary ? endDate : defaultEndDate,
    days, internetType, fileName: fileName || '', reason: reason || '',
  };
  db.data.applications.push(app);

  // Notify the employee's manager
  if (req.user.managerId) {
    db.data.notifications.push({
      id: nextId(), audience: 'user', userId: req.user.managerId,
      message: `${req.user.name} submitted a new WFH application.`, type: 'info', read: false,
      timestamp: new Date().toLocaleString('en-US'),
    });
  }
  await db.write();
  res.status(201).json(app);
});

applicationsRouter.patch('/:id', requireRole('Manager', 'Admin'), async (req, res) => {
  const id = Number(req.params.id);
  const app = db.data.applications.find(a => a.id === id);
  if (!app) return res.status(404).json({ error: 'Application not found.' });

  const applicant = db.data.users.find(u => u.id === app.userId);
  if (req.user.role === 'Manager' && applicant?.managerId !== req.user.id) {
    return res.status(403).json({ error: "You can only review applications from your direct reports." });
  }

  const { status, reason } = req.body || {};
  if (!['approved', 'rejected'].includes(status)) return res.status(400).json({ error: 'Status must be approved or rejected.' });
  app.status = status;
  if (status === 'rejected') app.reason = reason || '';

  db.data.notifications.push({
    id: nextId(), audience: 'user', userId: app.userId,
    message: status === 'approved' ? `Your WFH application was approved by ${req.user.name}.` : `Your WFH application was rejected by ${req.user.name}.`,
    type: status === 'approved' ? 'success' : 'info', read: false, timestamp: new Date().toLocaleString('en-US'),
  });

  await db.write();
  res.json(app);
});
