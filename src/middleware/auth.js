const jwt = require('jsonwebtoken');
const config = require('../config');

/**
 * Verifies the Bearer JWT from the Authorization header.
 * Attaches `req.user = { id, orgId, role, email }` on success.
 */
function authenticate(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'missing or malformed Authorization header' });
  }

  const token = header.slice(7);
  try {
    const payload = jwt.verify(token, config.jwtSecret);
    req.user = {
      id:    payload.sub,
      orgId: payload.orgId,
      role:  payload.role,
      email: payload.email,
    };
    next();
  } catch (err) {
    return res.status(401).json({ error: 'invalid or expired token' });
  }
}

/**
 * Factory: returns middleware that requires the caller to have one of `roles`.
 * Must be used after `authenticate`.
 */
function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: `requires role: ${roles.join(' or ')}` });
    }
    next();
  };
}

module.exports = { authenticate, requireRole };
