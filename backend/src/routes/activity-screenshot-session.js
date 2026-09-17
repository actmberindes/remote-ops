import { Router } from 'express';
import { db, nextId } from '../db.js';
import { requireDevice } from '../auth.js';

export const activityScreenshotSessionRouter = Router();

function resolveCurrentEmployee(domainUser) {
  const normalized = String(domainUser || '').trim().toLowerCase();
  if (!normalized) return null;
  const slash = normalized.lastIndexOf('\\');
  const username = slash >= 0 ? normalized.slice(slash + 1) : normalized;
  return db.data.users.find(user => {
    if (user.role !== 'Employee') return false;
    const emailLocal = String(user.email || '').split('@')[0].trim().toLowerCase();
    return emailLocal && emailLocal === username;
  }) || null;
}

activityScreenshotSessionRouter.post('/screenshots', requireDevice(db), async (req, res) => {
  const {
    url,
    filename,
    capturedAt,
    displayId,
    displayName,
    displayIndex,
    domainUser,
  } = req.body || {};

  if (!url) {
    return res.status(400).json({ error: 'url is required (upload the file to /api/uploads/monitoring first).' });
  }

  // The device remains registered to its original owner, but each capture is
  // attributed to the Windows user who actually created that capture. This is
  // what makes one physical device able to retain separate screenshot history
  // for User A and User B.
  const capturedDomainUser = domainUser || req.device.domainUser || null;
  const resolvedEmployee = resolveCurrentEmployee(capturedDomainUser);
  const capturedEmployeeId = resolvedEmployee?.id || req.device.currentEmployeeId || req.device.employeeId;

  const entry = {
    id: nextId(),
    employeeId: capturedEmployeeId,
    registeredEmployeeId: req.device.employeeId,
    deviceId: req.device.id,
    url,
    filename: filename || '',
    displayId: displayId ?? null,
    displayName: displayName ?? null,
    displayIndex: displayIndex ?? null,
    domainUser: capturedDomainUser,
    capturedAt: capturedAt || new Date().toISOString(),
    type: 'scheduled',
  };

  db.data.screenshots.push(entry);
  await db.write();
  res.status(201).json(entry);
});
