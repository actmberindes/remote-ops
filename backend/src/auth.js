import jwt from 'jsonwebtoken';

const SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';

export function signToken(user) {
  return jwt.sign({ id: user.id, role: user.role }, SECRET, { expiresIn: '7d' });
}

export function requireAuth(db) {
  return (req, res, next) => {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Missing authentication token.' });
    try {
      const payload = jwt.verify(token, SECRET);
      const user = db.data.users.find(u => u.id === payload.id);
      if (!user) return res.status(401).json({ error: 'User no longer exists.' });
      req.user = user;
      next();
    } catch (e) {
      return res.status(401).json({ error: 'Invalid or expired session, please sign in again.' });
    }
  };
}

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) return res.status(403).json({ error: 'You do not have permission to perform this action.' });
    next();
  };
}

export function publicUser(u) {
  const { passwordHash, ...rest } = u;
  return rest;
}

/* ---- Device auth: the desktop agent and browser extension authenticate as a
   paired device, not as a logged-in user. Tokens are long-lived (1 year) and
   individually revocable from Admin > User Management > Devices. ---- */

export function signDeviceToken(device) {
  return jwt.sign({ deviceId: device.id, employeeId: device.employeeId, kind: 'device' }, SECRET, { expiresIn: '365d' });
}

export function requireDevice(db) {
  return (req, res, next) => {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Missing device token.' });
    try {
      const payload = jwt.verify(token, SECRET);
      if (payload.kind !== 'device') return res.status(401).json({ error: 'Not a device token.' });
      const device = db.data.devices.find(d => d.id === payload.deviceId && d.revoked !== true);
      if (!device) return res.status(401).json({ error: 'This device has been unpaired or no longer exists.' });
      const employee = db.data.users.find(u => u.id === device.employeeId);
      if (!employee) return res.status(401).json({ error: 'Associated employee account no longer exists.' });
      device.lastSeenAt = new Date().toLocaleString('en-US');
      req.device = device;
      req.employee = employee;
      next();
    } catch (e) {
      return res.status(401).json({ error: 'Invalid or expired device token.' });
    }
  };
}

// Accepts either a normal user session token OR a paired-device token. Used by shared
// infrastructure (like file uploads) that both the web app and the desktop agent/extension call.
export function requireAuthOrDevice(db) {
  return (req, res, next) => {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Missing authentication token.' });
    try {
      const payload = jwt.verify(token, SECRET);
      if (payload.kind === 'device') {
        const device = db.data.devices.find(d => d.id === payload.deviceId && d.revoked !== true);
        if (!device) return res.status(401).json({ error: 'This device has been unpaired.' });
        const employee = db.data.users.find(u => u.id === device.employeeId);
        if (!employee) return res.status(401).json({ error: 'Associated employee account no longer exists.' });
        req.device = device;
        req.user = employee;
        return next();
      }
      const user = db.data.users.find(u => u.id === payload.id);
      if (!user) return res.status(401).json({ error: 'User no longer exists.' });
      req.user = user;
      next();
    } catch (e) {
      return res.status(401).json({ error: 'Invalid or expired session, please sign in again.' });
    }
  };
}
