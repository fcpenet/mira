import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import config from '../config';
import { AuthUser, UserRole } from '../types';

interface JwtPayload {
  sub: string;
  orgId: string;
  role: UserRole;
  email: string;
}

/**
 * Verifies the Bearer JWT from the Authorization header.
 * Attaches `req.user = { id, orgId, role, email }` on success.
 */
export function authenticate(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    res.status(401).json({ error: 'missing or malformed Authorization header' });
    return;
  }

  const token = header.slice(7);
  try {
    const payload = jwt.verify(token, config.jwtSecret) as JwtPayload;
    req.user = {
      id:    payload.sub,
      orgId: payload.orgId,
      role:  payload.role,
      email: payload.email,
    } satisfies AuthUser;
    next();
  } catch {
    res.status(401).json({ error: 'invalid or expired token' });
  }
}

/**
 * Factory: returns middleware that requires the caller to have one of `roles`.
 * Must be used after `authenticate`.
 */
export function requireRole(...roles: UserRole[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user || !roles.includes(req.user.role)) {
      res.status(403).json({ error: `requires role: ${roles.join(' or ')}` });
      return;
    }
    next();
  };
}
