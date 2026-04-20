import jwt from 'jsonwebtoken';

const SECRET = process.env.JWT_SECRET || (process.env.NODE_ENV === 'production'
  ? (() => { throw new Error('JWT_SECRET must be set in production.'); })()
  : 'mt-propman-dev-jwt-secret');

export function signTenantToken(payload) {
  return jwt.sign(payload, SECRET, { expiresIn: '7d' });
}

export function tenantAuth(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required.' });
  }
  try {
    req.tenant = jwt.verify(auth.slice(7), SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Session expired. Please log in again.' });
  }
}
