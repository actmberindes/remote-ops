import { Router } from 'express';
import { db, nextId } from '../db.js';
import { requireAuth, requireRole } from '../auth.js';

export const licensesRouter = Router();
licensesRouter.use(requireAuth(db), requireRole('Admin'));

function statusOf(license) {
  return license.expirationDate && license.expirationDate < new Date().toISOString().slice(0, 10)
    ? 'Expired'
    : 'Active';
}

function enrich(license) {
  return { ...license, status: statusOf(license), assignedSeats: db.data.licenseAssignments.filter(a => a.licenseId === license.id && a.status === 'Active').reduce((sum, a) => sum + a.seats, 0) };
}

function log(licenseId, action, user, message) {
  db.data.licenseLogs ||= [];
  db.data.licenseLogs.push({ id: nextId(), licenseId, action, performedBy: user.id, performedByName: user.name, message, timestamp: new Date().toISOString() });
}

function validate(body, partial = false) {
  const data = body || {};
  if (!partial && !String(data.name || '').trim()) return 'License name is required.';
  if (data.seats !== undefined && (!Number.isInteger(Number(data.seats)) || Number(data.seats) < 1)) return 'Number of seats must be a whole number greater than zero.';
  if (data.purchaseDate && !/^\d{4}-\d{2}-\d{2}$/.test(data.purchaseDate)) return 'Purchase date must be a valid date.';
  if (data.expirationDate && !/^\d{4}-\d{2}-\d{2}$/.test(data.expirationDate)) return 'Expiration date must be a valid date.';
  if (data.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) return 'Enter a valid license email address.';
  return null;
}

licensesRouter.get('/', (req, res) => {
  db.data.licenseAssignments ||= [];
  res.json((db.data.licenses || []).map(enrich));
});

licensesRouter.post('/', async (req, res) => {
  const error = validate(req.body);
  if (error) return res.status(400).json({ error });
  const body = req.body;
  const license = {
    id: nextId(), name: String(body.name).trim(), vendor: String(body.vendor || '').trim(),
    productKey: String(body.productKey || '').trim(), email: String(body.email || '').trim(),
    seats: Number(body.seats || 1), purchaseDate: body.purchaseDate || '',
    expirationDate: body.expirationDate || '', notes: String(body.notes || '').trim(),
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
  };
  db.data.licenses ||= [];
  db.data.licenseAssignments ||= [];
  db.data.licenses.push(license);
  log(license.id, 'Created', req.user, `${license.name} was added.`);
  await db.write();
  res.status(201).json(enrich(license));
});

licensesRouter.post('/:id/clone', async (req, res) => {
  const source = (db.data.licenses || []).find(x => x.id === Number(req.params.id));
  if (!source) return res.status(404).json({ error: 'License not found.' });
  const clone = { ...source, id: nextId(), name: `${source.name} (Copy)`, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  db.data.licenses.push(clone);
  log(clone.id, 'Cloned', req.user, `Cloned from license ${source.id}.`);
  await db.write();
  res.status(201).json(enrich(clone));
});

licensesRouter.put('/:id', async (req, res) => {
  const license = (db.data.licenses || []).find(x => x.id === Number(req.params.id));
  if (!license) return res.status(404).json({ error: 'License not found.' });
  const error = validate(req.body, true);
  if (error) return res.status(400).json({ error });
  const before = { ...license };
  for (const key of ['name', 'vendor', 'productKey', 'email', 'purchaseDate', 'expirationDate', 'notes']) {
    if (req.body[key] !== undefined) license[key] = String(req.body[key] ?? '').trim();
  }
  if (req.body.seats !== undefined) {
    const seats = Number(req.body.seats);
    const assigned = (db.data.licenseAssignments || []).filter(a => a.licenseId === license.id && a.status === 'Active').reduce((sum, a) => sum + a.seats, 0);
    if (seats < assigned) return res.status(409).json({ error: `Seats cannot be lower than the ${assigned} currently assigned.` });
    license.seats = seats;
  }
  if (!String(license.name || '').trim()) return res.status(400).json({ error: 'License name is required.' });
  license.updatedAt = new Date().toISOString();
  log(license.id, 'Edited', req.user, `Updated license details for ${before.name}.`);
  await db.write();
  res.json(enrich(license));
});

licensesRouter.post('/:id/renew', async (req, res) => {
  const license = (db.data.licenses || []).find(x => x.id === Number(req.params.id));
  if (!license) return res.status(404).json({ error: 'License not found.' });
  const expirationDate = String(req.body?.expirationDate || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(expirationDate) || expirationDate < new Date().toISOString().slice(0, 10)) {
    return res.status(400).json({ error: 'Choose a valid expiration date today or later.' });
  }
  const previous = license.expirationDate || 'No expiration date';
  license.expirationDate = expirationDate;
  if (req.body.purchaseDate) license.purchaseDate = req.body.purchaseDate;
  license.updatedAt = new Date().toISOString();
  log(license.id, 'Renewed', req.user, `Renewed license; expiration changed from ${previous} to ${expirationDate}.`);
  await db.write();
  res.json(enrich(license));
});

licensesRouter.get('/:id/history', (req, res) => {
  const license = (db.data.licenses || []).find(x => x.id === Number(req.params.id));
  if (!license) return res.status(404).json({ error: 'License not found.' });
  res.json((db.data.licenseLogs || []).filter(x => x.licenseId === license.id).slice().reverse());
});

licensesRouter.post('/:id/assign', async (req, res) => {
  const license = (db.data.licenses || []).find(x => x.id === Number(req.params.id));
  if (!license) return res.status(404).json({ error: 'License not found.' });
  if (statusOf(license) === 'Expired') return res.status(409).json({ error: 'Expired licenses must be renewed before assigning seats.' });
  const employeeId = Number(req.body?.employeeId);
  const seats = Number(req.body?.seats || 1);
  if (!Number.isInteger(employeeId) || !db.data.users.some(u => u.id === employeeId && u.role === 'Employee')) return res.status(400).json({ error: 'Select a valid employee.' });
  if (!Number.isInteger(seats) || seats < 1) return res.status(400).json({ error: 'Assigned seats must be a whole number greater than zero.' });
  db.data.licenseAssignments ||= [];
  const active = db.data.licenseAssignments.filter(a => a.licenseId === license.id && a.status === 'Active');
  if (active.some(a => a.employeeId === employeeId)) return res.status(409).json({ error: 'This license is already assigned to that employee.' });
  const assigned = active.reduce((sum, a) => sum + a.seats, 0);
  if (assigned + seats > Number(license.seats)) return res.status(409).json({ error: 'Not enough seats available.' });
  const employee = db.data.users.find(u => u.id === employeeId);
  const assignment = { id: nextId(), licenseId: license.id, employeeId, employeeName: employee.name, seats, assignedBy: req.user.id, assignedAt: new Date().toISOString(), status: 'Active' };
  db.data.licenseAssignments.push(assignment);
  log(license.id, 'Assigned', req.user, `Assigned ${seats} seat(s) to ${employee.name}.`);
  await db.write();
  res.status(201).json({ assignment, license: enrich(license) });
});

licensesRouter.get('/:id/assignments', (req, res) => {
  const license = (db.data.licenses || []).find(x => x.id === Number(req.params.id));
  if (!license) return res.status(404).json({ error: 'License not found.' });
  res.json((db.data.licenseAssignments || []).filter(a => a.licenseId === license.id && a.status === 'Active'));
});

licensesRouter.delete('/:id/assignments/:assignmentId', async (req, res) => {
  const license = (db.data.licenses || []).find(x => x.id === Number(req.params.id));
  if (!license) return res.status(404).json({ error: 'License not found.' });
  const assignment = (db.data.licenseAssignments || []).find(a => a.id === Number(req.params.assignmentId) && a.licenseId === license.id && a.status === 'Active');
  if (!assignment) return res.status(404).json({ error: 'Active license assignment not found.' });
  assignment.status = 'Released';
  assignment.releasedAt = new Date().toISOString();
  log(license.id, 'Unassigned', req.user, `Released ${assignment.seats} seat(s) from ${assignment.employeeName}.`);
  await db.write();
  res.json({ ok: true, license: enrich(license) });
});

licensesRouter.delete('/:id', async (req, res) => {
  const id = Number(req.params.id);
  const index = (db.data.licenses || []).findIndex(x => x.id === id);
  if (index < 0) return res.status(404).json({ error: 'License not found.' });
  if ((db.data.licenseAssignments || []).some(a => a.licenseId === id && a.status === 'Active')) return res.status(409).json({ error: 'Release all assigned seats before deleting this license.' });
  const [license] = db.data.licenses.splice(index, 1);
  log(id, 'Deleted', req.user, `${license.name} was deleted.`);
  await db.write();
  res.json({ ok: true });
});
