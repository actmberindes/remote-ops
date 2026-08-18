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

agentRouter.post('/pairing-code', requireAuth(db), async (req, res) => {
  db.data.pairingCodes = db.data.pairingCodes.filter(c => c.employeeId !== req.user.id || c.used);

  const code = generateCode();
  const expiresAt = Date.now() + 10 * 60 * 1000;
  db.data.pairingCodes.push({ id: nextId(), code, employeeId: req.user.id, expiresAt, used: false, createdAt: new Date().toLocaleString('en-US') });
  await db.write();
  res.status(201).json({ code, expiresAtISO: new Date(expiresAt).toISOString() });
});

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

agentRouter.get('/session-status', requireDevice(db), (req, res) => {
  res.json({ status: req.employee.status, employeeName: req.employee.name });
});

agentRouter.get('/config-admin', requireAuth(db), requireRole('Admin'), (req, res) => {
  res.json(db.data.agentConfig);
});

agentRouter.put('/config', requireAuth(db), requireRole('Admin'), async (req, res) => {
  const {
    screenshotIntervalMinutes,
    liveViewFrameIntervalSeconds,
    screenshotRetentionDays,
    liveViewRetentionDays,
    webUsageRetentionDays,
  } = req.body || {};

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
  if (liveViewRetentionDays !== undefined) {
    const v = Number(liveViewRetentionDays);
    if (!(v >= 1 && v <= 365)) return res.status(400).json({ error: 'liveViewRetentionDays must be between 1 and 365.' });
    db.data.agentConfig.liveViewRetentionDays = v;
  }
  if (webUsageRetentionDays !== undefined) {
    const v = Number(webUsageRetentionDays);
    if (!(v >= 1 && v <= 365)) return res.status(400).json({ error: 'webUsageRetentionDays must be between 1 and 365.' });
    db.data.agentConfig.webUsageRetentionDays = v;
  }
  await db.write();
  res.json(db.data.agentConfig);
});

agentRouter.get('/my-devices', requireAuth(db), async (req, res) => {
  const devices = db.data.devices
    .filter(d => d.employeeId === req.user.id)
    .map(d => ({ ...d, employeeName: userName(d.employeeId) }));
  res.json(devices);
});

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

agentRouter.delete('/devices/:id', requireAuth(db), requireRole('Admin'), async (req, res) => {
  const id = Number(req.params.id);
  const index = db.data.devices.findIndex(d => d.id === id);
  if (index === -1) return res.status(404).json({ error: 'Device not found.' });

  db.data.devices.splice(index, 1);
  await db.write();
  res.json({ ok: true, deviceId: id });
});
