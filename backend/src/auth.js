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
