import { Router } from 'express';
import { db, nextId } from '../db.js';
import { requireAuth, requireRole, requireDevice, signDeviceToken } from '../auth.js';

export const agentRouter = Router();

const VALID_INTERVALS = [5, 10, 30];

function generateCode() {
  return String(Math.floor(100000 + Math.random() * 900000)); // 6-digit
}

function userName(id) {
  const u = db.data.users.find(x => x.id === id);
  return u ? u.name : 'Unknown';
}

// Employee (or anyone signed in) generates a short-lived pairing code from their portal,
// then types it into the desktop agent / browser extension installer to link the device
// to their account without ever sharing their actual login password with the agent.
agentRouter.post('/pairing-code', requireAuth(db), async (req, res) => {
  // Invalidate any earlier unused codes for this user to avoid confusion.
  db.data.pairingCodes = db.data.pairingCodes.filter(c => c.employeeId !== req.user.id || c.used);

  const code = generateCode();
  const expiresAt = Date.now() + 10 * 60 * 1000; // 10 minutes
  db.data.pairingCodes.push({ id: nextId(), code, employeeId: req.user.id, expiresAt, used: false, createdAt: new Date().toLocaleString('en-US') });
  await db.write();
  res.status(201).json({ code, expiresAtISO: new Date(expiresAt).toISOString() });
});

// The agent/extension itself calls this — it has no user token yet, only the pairing code
// the employee typed in during setup.
agentRouter.post('/pair', async (req, res) => {
  const { code, deviceName, type } = req.body || {};
  if (!code || !type) return res.status(400).json({ error: 'code and type are required.' });
  if (!['desktop-agent', 'browser-extension'].includes(type)) return res.status(400).json({ error: 'type must be desktop-agent or browser-extension.' });

  const entry = db.data.pairingCodes.find(c => c.code === String(code) && !c.used);
  if (!entry) return res.status(404).json({ error: 'Invalid pairing code.' });
  if (entry.expiresAt < Date.now()) return res.status(410).json({ error: 'This pairing code has expired. Generate a new one from your portal.' });

  entry.used = true;
  const employee = db.data.users.find(u => u.id === entry.employeeId);
  const device = {
    id: nextId(), employeeId: entry.employeeId, type, deviceName: deviceName || `${type} device`,
    pairedAt: new Date().toLocaleString('en-US'), lastSeenAt: null, revoked: false,
  };
  db.data.devices.push(device);
  await db.write();

  const deviceToken = signDeviceToken(device);
  res.status(201).json({ deviceToken, employeeId: employee.id, employeeName: employee.name, deviceId: device.id });
});

agentRouter.get('/config', requireDevice(db), (req, res) => {
  res.json(db.data.agentConfig);
});

// The agent polls this to know whether it should be capturing right now — tied to
// the same Start/Stop session status the employee controls from the web portal.
agentRouter.get('/session-status', requireDevice(db), (req, res) => {
  res.json({ status: req.employee.status, employeeName: req.employee.name });
});

// Admin-facing read (the route above is for the device itself, authenticated with a device token).
agentRouter.get('/config-admin', requireAuth(db), requireRole('Admin'), (req, res) => {
  res.json(db.data.agentConfig);
});

agentRouter.put('/config', requireAuth(db), requireRole('Admin'), async (req, res) => {
  const { screenshotIntervalMinutes, liveViewFrameIntervalSeconds, screenshotRetentionDays } = req.body || {};
  if (screenshotIntervalMinutes !== undefined) {
    if (!VALID_INTERVALS.includes(Number(screenshotIntervalMinutes))) {
      return res.status(400).json({ error: `screenshotIntervalMinutes must be one of ${VALID_INTERVALS.join(', ')}.` });
    }
    db.data.agentConfig.screenshotIntervalMinutes = Number(screenshotIntervalMinutes);
  }
  if (liveViewFrameIntervalSeconds !== undefined) {
    const v = Number(liveViewFrameIntervalSeconds);
    if (!(v >= 2 && v <= 60)) return res.status(400).json({ error: 'liveViewFrameIntervalSeconds must be between 2 and 60.' });
    db.data.agentConfig.liveViewFrameIntervalSeconds = v;
  }
  if (screenshotRetentionDays !== undefined) {
    const v = Number(screenshotRetentionDays);
    if (!(v >= 1 && v <= 365)) return res.status(400).json({ error: 'screenshotRetentionDays must be between 1 and 365.' });
    db.data.agentConfig.screenshotRetentionDays = v;
  }
  await db.write();
  res.json(db.data.agentConfig);
});

// Admin: list/revoke paired devices (e.g. when an employee gets a new laptop, or offboards).
agentRouter.get('/devices', requireAuth(db), requireRole('Admin'), (req, res) => {
  res.json(db.data.devices.map(d => ({ ...d, employeeName: userName(d.employeeId) })));
});

agentRouter.patch('/devices/:id/revoke', requireAuth(db), requireRole('Admin'), async (req, res) => {
  const id = Number(req.params.id);
  const device = db.data.devices.find(d => d.id === id);
  if (!device) return res.status(404).json({ error: 'Device not found.' });
  device.revoked = true;
  await db.write();
  res.json(device);
});
